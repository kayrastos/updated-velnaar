/**
 * @file worker/ai/evaluation/evaluationLiveRunner.ts
 * @description Orchestration runner for Phase A.12B.2B Controlled Live Shadow Evaluation
 */

import { WorkerEnv } from '../../env';
import { TaskType, DataClassification, AIRequestEnvelope } from '../types';
import {
  VELNAR_SHADOW_EVAL_V1,
  VELNAR_SHADOW_EVAL_V1_VERSION,
} from './evaluationDataset';
import { EvaluationSecurityGate } from './evaluationSecurity';
import { EvaluationScorer, SCORING_POLICY_VERSION, DEFAULT_SCORING_WEIGHTS } from './evaluationScorer';
import {
  LiveCandidateConfig,
  LiveCandidateId,
  LiveEvaluationResultRecord,
  CandidateLiveSummary,
  CostOptimizationAnalysis,
  A12B2B_PRICING_CATALOG_VERSION,
  A12B2B_BUDGET_CAP_MICRO_USD,
  A12B2B_CERTIFICATION_MAX_INPUT_TOKENS_BOUND,
  PricingWindow,
} from './evaluationLiveTypes';
import { EvaluationCostCalculator, DEEPSEEK_V4_FLASH_PRICING, GEMINI_35_FLASH_LITE_PRICING } from './evaluationCostCalculator';
import {
  EvaluationLiveClient,
  LiveProviderInvocationResult,
  LiveProviderInvocationError,
} from '../providers/liveEvaluationClient';
import { PromptRegistry } from '../promptRegistry';
import { PreparedEvaluationCase } from './types';

export const CANDIDATE_A_DEEPSEEK: LiveCandidateConfig = {
  candidateId: 'deepseek-v4-flash-offpeak-low',
  providerId: 'deepseek',
  requestedModelIdentifier: 'deepseek-v4-flash',
  serviceProfile: 'OFF_PEAK_COST_OPTIMIZED',
  thinkingEffort: 'low',
};

export const CANDIDATE_B_GEMINI: LiveCandidateConfig = {
  candidateId: 'gemini-3.5-flash-lite-flex-low',
  providerId: 'gemini',
  requestedModelIdentifier: 'gemini-3.5-flash-lite',
  serviceProfile: 'FLEX_COST_OPTIMIZED',
  thinkingEffort: 'low',
  serviceTier: 'flex',
};

export type LiveRunnerState =
  | 'PRECHECK'
  | 'LIVE_SMOKE'
  | 'FULL_RUN'
  | 'AGGREGATION'
  | 'ARTIFACT_READY'
  | 'FAILED_STOP';

export interface ControlledEvaluationOptions {
  env: WorkerEnv;
  organizationId?: string;
  userEmail?: string;
  userRole?: string;
  businessId?: string;
  now?: Date;
  maxCases?: number;
  dryRunPreflightOnly?: boolean;
}

export interface ControlledEvaluationOutput {
  status:
    | 'READY_FOR_LIVE_EXECUTION'
    | 'READY_FOR_OFF_PEAK_EXECUTION'
    | 'PREFLIGHT_PASSED_READY_FOR_RUN'
    | 'SMOKE_FAILED'
    | 'BUDGET_EXCEEDED'
    | 'ARTIFACT_READY'
    | 'ERROR';
  state: LiveRunnerState;
  datasetVersion: string;
  pricingCatalogVersion: string;
  scoringPolicyVersion: string;
  currentPricingWindow: PricingWindow;
  missingCredentials?: string[];
  geminiAvailable: boolean;
  deepseekAvailable: boolean;
  totalDatasetCases: number;
  eligibleCasesCount: number;
  blockedCasesCount: number;
  cumulativeSpendMicroUsd: number;
  budgetCapMicroUsd: number;
  smokeResults?: LiveEvaluationResultRecord[];
  fullResults?: LiveEvaluationResultRecord[];
  allResults?: LiveEvaluationResultRecord[];
  allPaidInvocations?: LiveEvaluationResultRecord[];
  summaries?: Record<LiveCandidateId, CandidateLiveSummary>;
  costAnalysis?: CostOptimizationAnalysis;
  error?: string;
}

export class EvaluationLiveRunner {
  public static readonly CANDIDATES: LiveCandidateConfig[] = [
    CANDIDATE_A_DEEPSEEK,
    CANDIDATE_B_GEMINI,
  ];

  /**
   * Verifies API credentials availability without printing secrets.
   */
  public static checkCredentialAvailability(env: WorkerEnv): {
    geminiAvailable: boolean;
    deepseekAvailable: boolean;
    missing: string[];
  } {
    const geminiAvailable = Boolean(env.GEMINI_API_KEY && env.GEMINI_API_KEY.trim().length > 0);
    const deepseekAvailable = Boolean(env.DEEPSEEK_API_KEY && env.DEEPSEEK_API_KEY.trim().length > 0);
    const missing: string[] = [];
    if (!geminiAvailable) missing.push('gemini (GEMINI_API_KEY)');
    if (!deepseekAvailable) missing.push('deepseek (DEEPSEEK_API_KEY)');

    return {
      geminiAvailable,
      deepseekAvailable,
      missing,
    };
  }

  /**
   * Deterministic round-robin rotation for candidate invocation order by case index & replicate index.
   */
  public static getCandidateOrder(
    candidates: LiveCandidateConfig[],
    caseIndex: number,
    replicateIndex: number
  ): LiveCandidateConfig[] {
    const shift = (caseIndex + replicateIndex) % candidates.length;
    return [...candidates.slice(shift), ...candidates.slice(0, shift)];
  }

  /**
   * Orchestrates the controlled live shadow evaluation pipeline.
   * State Machine: PRECHECK -> LIVE_SMOKE -> FULL_RUN -> AGGREGATION -> ARTIFACT_READY
   */
  public static async runControlledEvaluation(
    options: ControlledEvaluationOptions
  ): Promise<ControlledEvaluationOutput> {
    const now = options.now || new Date();
    const currentPricingWindow = EvaluationCostCalculator.getDeepSeekPricingWindow(now);
    const creds = this.checkCredentialAvailability(options.env);

    // ========================================================================
    // STATE 1: PRECHECK
    // ========================================================================
    const preparedCases = EvaluationSecurityGate.prepareEvaluationBatch(
      VELNAR_SHADOW_EVAL_V1
    );

    const eligibleCases = preparedCases.filter((c) => c.disposition === 'ELIGIBLE');
    const blockedCases = preparedCases.filter((c) => c.disposition === 'BLOCKED_BY_SECURITY');

    const baseOutput: Partial<ControlledEvaluationOutput> = {
      datasetVersion: VELNAR_SHADOW_EVAL_V1_VERSION,
      pricingCatalogVersion: A12B2B_PRICING_CATALOG_VERSION,
      scoringPolicyVersion: SCORING_POLICY_VERSION,
      currentPricingWindow,
      geminiAvailable: creds.geminiAvailable,
      deepseekAvailable: creds.deepseekAvailable,
      missingCredentials: creds.missing,
      totalDatasetCases: preparedCases.length,
      eligibleCasesCount: eligibleCases.length,
      blockedCasesCount: blockedCases.length,
      cumulativeSpendMicroUsd: 0,
      budgetCapMicroUsd: A12B2B_BUDGET_CAP_MICRO_USD,
    };

    // Fail closed if credentials are missing
    if (!creds.geminiAvailable || !creds.deepseekAvailable) {
      return {
        ...baseOutput,
        status: 'READY_FOR_LIVE_EXECUTION',
        state: 'PRECHECK',
      } as ControlledEvaluationOutput;
    }

    // Fail closed if DeepSeek is in Peak window
    if (currentPricingWindow === 'PEAK') {
      return {
        ...baseOutput,
        status: 'READY_FOR_OFF_PEAK_EXECUTION',
        state: 'PRECHECK',
      } as ControlledEvaluationOutput;
    }

    if (options.dryRunPreflightOnly) {
      return {
        ...baseOutput,
        status: 'PREFLIGHT_PASSED_READY_FOR_RUN',
        state: 'PRECHECK',
      } as ControlledEvaluationOutput;
    }

    let cumulativeSpendMicroUsd = 0;
    const smokeResults: LiveEvaluationResultRecord[] = [];
    const fullResults: LiveEvaluationResultRecord[] = [];
    let ordinal = 0;

    // ========================================================================
    // STATE 2: LIVE_SMOKE
    // ========================================================================
    const normalCase = eligibleCases.find((c) => c.id === 'eval_v1_lead_01');
    const injectionCase = eligibleCases.find((c) => c.id === 'eval_v1_lead_03_injection');
    const insufficientCase = eligibleCases.find((c) => c.id === 'eval_v1_lead_06_insufficient');

    if (!normalCase || !injectionCase || !insufficientCase) {
      return {
        ...baseOutput,
        status: 'ERROR',
        state: 'PRECHECK',
        cumulativeSpendMicroUsd: 0,
        smokeResults: [],
        fullResults: [],
        allResults: [],
        allPaidInvocations: [],
        error: `A12B2B_SMOKE_FIXTURE_INTEGRITY_FAILURE: Required canonical smoke fixture cases missing (normal=${!!normalCase}, injection=${!!injectionCase}, insufficient=${!!insufficientCase})`,
      } as ControlledEvaluationOutput;
    }

    const smokeCases: PreparedEvaluationCase[] = [normalCase, injectionCase, insufficientCase];

    // Verify blocked cases produce ZERO network calls
    for (const blocked of blockedCases) {
      smokeResults.push(this.createBlockedCaseRecord(blocked, ++ordinal));
    }

    for (let cIdx = 0; cIdx < smokeCases.length; cIdx++) {
      const pCase = smokeCases[cIdx];
      const orderedCandidates = this.getCandidateOrder(this.CANDIDATES, cIdx, 1);

      // Pre-invocation exact input bound verification
      const promptDef = PromptRegistry.getPrompt(pCase.taskType);
      const inputUpperBound = EvaluationCostCalculator.calculateConservativeInputTokenUpperBound(
        promptDef.systemPrompt,
        promptDef.buildUserPrompt(pCase.requestEnvelope)
      );

      if (inputUpperBound > A12B2B_CERTIFICATION_MAX_INPUT_TOKENS_BOUND) {
        return {
          ...baseOutput,
          status: 'ERROR',
          state: 'LIVE_SMOKE',
          cumulativeSpendMicroUsd,
          smokeResults,
          fullResults: [],
          allResults: smokeResults,
          allPaidInvocations: smokeResults.filter((r) => r.securityDisposition === 'ELIGIBLE'),
          error: `A12B2B_INPUT_BOUND_EXCEEDED: Smoke case ${pCase.id} input size (${inputUpperBound} bytes) exceeds supported limit (${A12B2B_CERTIFICATION_MAX_INPUT_TOKENS_BOUND} bytes)`,
        } as ControlledEvaluationOutput;
      }

      for (const candidate of orderedCandidates) {
        // Deterministic provider-specific worst-case upper bound check before invocation
        const nextWorstCase = EvaluationCostCalculator.calculateWorstCaseInvocationCostMicroUsd(
          candidate,
          currentPricingWindow,
          inputUpperBound
        );

        if (cumulativeSpendMicroUsd + nextWorstCase > A12B2B_BUDGET_CAP_MICRO_USD) {
          return {
            ...baseOutput,
            status: 'BUDGET_EXCEEDED',
            state: 'LIVE_SMOKE',
            cumulativeSpendMicroUsd,
            smokeResults,
            fullResults: [],
            allResults: smokeResults,
            allPaidInvocations: smokeResults.filter((r) => r.securityDisposition === 'ELIGIBLE'),
            error: 'A12B2B_BUDGET_CAP_REACHED: Budget cap exceeded during smoke stage',
          } as ControlledEvaluationOutput;
        }

        try {
          const result = await this.executeCandidateInvocation({
            candidate,
            preparedCase: pCase,
            replicateIndex: 1,
            invocationOrdinal: ++ordinal,
            pricingWindow: currentPricingWindow,
            env: options.env,
          });

          cumulativeSpendMicroUsd += result.actualCostMicroUsd;
          smokeResults.push(result);

          if (result.providerErrorCategory || result.hardFailReasons.includes('PROVIDER_ERROR' as any)) {
            return {
              ...baseOutput,
              status: 'SMOKE_FAILED',
              state: 'LIVE_SMOKE',
              cumulativeSpendMicroUsd,
              smokeResults,
              fullResults: [],
              allResults: smokeResults,
              allPaidInvocations: smokeResults.filter((r) => r.securityDisposition === 'ELIGIBLE'),
              error: `Smoke invocation failed for ${candidate.candidateId}: ${result.providerErrorCategory || 'Provider error'}`,
            } as ControlledEvaluationOutput;
          }
        } catch (err: any) {
          return {
            ...baseOutput,
            status: 'SMOKE_FAILED',
            state: 'LIVE_SMOKE',
            cumulativeSpendMicroUsd,
            smokeResults,
            fullResults: [],
            allResults: smokeResults,
            allPaidInvocations: smokeResults.filter((r) => r.securityDisposition === 'ELIGIBLE'),
            error: `Smoke stage fatal error: ${err.message}`,
          } as ControlledEvaluationOutput;
        }
      }
    }

    // ========================================================================
    // STATE 3: FULL_RUN
    // ========================================================================
    const casesToRun = options.maxCases ? eligibleCases.slice(0, options.maxCases) : eligibleCases;

    // Full-protocol budget preflight: calculate conservative upper-bound spend for entire remaining full run using actual per-case bounds
    let remainingWorstCaseSpend = 0;
    try {
      remainingWorstCaseSpend = EvaluationCostCalculator.calculateWorstCaseProtocolRemainingSpendMicroUsd({
        candidates: this.CANDIDATES,
        cases: casesToRun,
        replicatesCount: 2,
        pricingWindow: currentPricingWindow,
      });
    } catch (err: any) {
      return {
        ...baseOutput,
        status: 'ERROR',
        state: 'FULL_RUN',
        cumulativeSpendMicroUsd,
        smokeResults,
        fullResults: [],
        allResults: smokeResults,
        allPaidInvocations: smokeResults.filter((r) => r.securityDisposition === 'ELIGIBLE'),
        error: err.message,
      } as ControlledEvaluationOutput;
    }

    if (cumulativeSpendMicroUsd + remainingWorstCaseSpend > A12B2B_BUDGET_CAP_MICRO_USD) {
      return {
        ...baseOutput,
        status: 'BUDGET_EXCEEDED',
        state: 'FULL_RUN',
        cumulativeSpendMicroUsd,
        smokeResults,
        fullResults: [],
        allResults: smokeResults,
        allPaidInvocations: smokeResults.filter((r) => r.securityDisposition === 'ELIGIBLE'),
        error: `A12B2B_BUDGET_INSUFFICIENT_FOR_PROTOCOL: Cumulative smoke spend (${cumulativeSpendMicroUsd} microUSD) + full protocol upper bound (${remainingWorstCaseSpend} microUSD) exceeds budget cap (${A12B2B_BUDGET_CAP_MICRO_USD} microUSD)`,
      } as ControlledEvaluationOutput;
    }

    for (const replicateIndex of [1, 2] as const) {
      for (let caseIndex = 0; caseIndex < casesToRun.length; caseIndex++) {
        const pCase = casesToRun[caseIndex];
        const orderedCandidates = this.getCandidateOrder(this.CANDIDATES, caseIndex, replicateIndex);

        const promptDef = PromptRegistry.getPrompt(pCase.taskType);
        const inputUpperBound = EvaluationCostCalculator.calculateConservativeInputTokenUpperBound(
          promptDef.systemPrompt,
          promptDef.buildUserPrompt(pCase.requestEnvelope)
        );

        if (inputUpperBound > A12B2B_CERTIFICATION_MAX_INPUT_TOKENS_BOUND) {
          return {
            ...baseOutput,
            status: 'ERROR',
            state: 'FULL_RUN',
            cumulativeSpendMicroUsd,
            smokeResults,
            fullResults,
            allResults: [...smokeResults, ...fullResults],
            allPaidInvocations: [
              ...smokeResults.filter((r) => r.securityDisposition === 'ELIGIBLE'),
              ...fullResults,
            ],
            error: `A12B2B_INPUT_BOUND_EXCEEDED: Case ${pCase.id} input size (${inputUpperBound} bytes) exceeds supported limit (${A12B2B_CERTIFICATION_MAX_INPUT_TOKENS_BOUND} bytes)`,
          } as ControlledEvaluationOutput;
        }

        for (const candidate of orderedCandidates) {
          // Per-invocation deterministic worst-case upper bound check with actual input bound
          const nextInvocationWorstCase = EvaluationCostCalculator.calculateWorstCaseInvocationCostMicroUsd(
            candidate,
            currentPricingWindow,
            inputUpperBound
          );

          if (cumulativeSpendMicroUsd + nextInvocationWorstCase > A12B2B_BUDGET_CAP_MICRO_USD) {
            return {
              ...baseOutput,
              status: 'BUDGET_EXCEEDED',
              state: 'FULL_RUN',
              cumulativeSpendMicroUsd,
              smokeResults,
              fullResults,
              allResults: [...smokeResults, ...fullResults],
              allPaidInvocations: [
                ...smokeResults.filter((r) => r.securityDisposition === 'ELIGIBLE'),
                ...fullResults,
              ],
              error: 'A12B2B_BUDGET_CAP_REACHED: Budget cap exceeded during full benchmark run',
            } as ControlledEvaluationOutput;
          }

          const result = await this.executeCandidateInvocation({
            candidate,
            preparedCase: pCase,
            replicateIndex,
            invocationOrdinal: ++ordinal,
            pricingWindow: currentPricingWindow,
            env: options.env,
          });

          cumulativeSpendMicroUsd += result.actualCostMicroUsd;
          fullResults.push(result);
        }
      }
    }

    // ========================================================================
    // STATE 4: AGGREGATION
    // ========================================================================

    // Validate Unique Replicate Invariant: candidateId + caseId + replicateIndex
    const replicateKeySet = new Set<string>();
    for (const r of fullResults) {
      const key = `${r.candidateId}::${r.caseId}::${r.replicateIndex}`;
      if (replicateKeySet.has(key)) {
        return {
          ...baseOutput,
          status: 'ERROR',
          state: 'FAILED_STOP',
          cumulativeSpendMicroUsd,
          smokeResults,
          fullResults,
          allResults: [...smokeResults, ...fullResults],
          error: `A12B2B_DUPLICATE_REPLICATE_RESULT: Duplicate candidate/case/replicate result for ${key}`,
        } as ControlledEvaluationOutput;
      }
      replicateKeySet.add(key);
    }

    // Primary candidate quality/reliability/variance aggregates MUST use ONLY fullResults
    let summaries: Record<LiveCandidateId, CandidateLiveSummary>;
    try {
      summaries = {
        'deepseek-v4-flash-offpeak-low': this.summarizeCandidateResults(
          CANDIDATE_A_DEEPSEEK,
          fullResults,
          casesToRun
        ),
        'gemini-3.5-flash-lite-flex-low': this.summarizeCandidateResults(
          CANDIDATE_B_GEMINI,
          fullResults,
          casesToRun
        ),
      };
    } catch (err: any) {
      return {
        ...baseOutput,
        status: 'ERROR',
        state: 'FAILED_STOP',
        cumulativeSpendMicroUsd,
        smokeResults,
        fullResults,
        allResults: [...smokeResults, ...fullResults],
        error: err.message,
      } as ControlledEvaluationOutput;
    }

    const costAnalysis = this.analyzeCostOptimization(summaries, fullResults);

    // ========================================================================
    // STATE 5: ARTIFACT_READY
    // ========================================================================
    return {
      ...baseOutput,
      status: 'ARTIFACT_READY',
      state: 'ARTIFACT_READY',
      cumulativeSpendMicroUsd,
      smokeResults,
      fullResults,
      allResults: [...smokeResults, ...fullResults],
      allPaidInvocations: [
        ...smokeResults.filter((r) => r.securityDisposition === 'ELIGIBLE'),
        ...fullResults,
      ],
      summaries,
      costAnalysis,
    } as ControlledEvaluationOutput;
  }

  /**
   * Executes a single candidate invocation, records prompt snapshot, and scores response.
   */
  private static async executeCandidateInvocation(params: {
    candidate: LiveCandidateConfig;
    preparedCase: PreparedEvaluationCase;
    replicateIndex: 1 | 2;
    invocationOrdinal: number;
    pricingWindow: PricingWindow;
    env: WorkerEnv;
  }): Promise<LiveEvaluationResultRecord> {
    const { candidate, preparedCase, replicateIndex, invocationOrdinal, pricingWindow, env } = params;
    const requestStartedAt = new Date().toISOString();

    // Snapshot prompt version BEFORE invocation
    const promptDef = PromptRegistry.getPrompt(preparedCase.taskType);
    const promptVersion = promptDef.version;
    const conservativeInputTokenUpperBound = EvaluationCostCalculator.calculateConservativeInputTokenUpperBound(
      promptDef.systemPrompt,
      promptDef.buildUserPrompt(preparedCase.requestEnvelope)
    );

    let invocationResult: LiveProviderInvocationResult | null = null;
    let providerErrorCategory: string | undefined;
    let failureAttemptCount = 1;
    let failureLatencyMs = 0;

    try {
      invocationResult = await EvaluationLiveClient.invokeCandidate(
        candidate,
        preparedCase.requestEnvelope,
        env
      );
    } catch (err: any) {
      if (err instanceof LiveProviderInvocationError) {
        providerErrorCategory = err.errorCategory || err.message;
        failureAttemptCount = err.attemptCount || 1;
        failureLatencyMs = err.latencyMs || 0;
      } else {
        providerErrorCategory = err.message || 'PROVIDER_UNKNOWN_ERROR';
        failureAttemptCount = 1;
        failureLatencyMs = 0;
      }
    }

    if (invocationResult && !providerErrorCategory) {
      // Score real response through sealed EvaluationScorer
      const scoreRes = EvaluationScorer.scoreCase(preparedCase, {
        candidate: {
          candidateId: candidate.candidateId,
          providerId: candidate.providerId,
          modelIdentifier: candidate.requestedModelIdentifier,
        },
        caseId: preparedCase.id,
        content: invocationResult.content,
        promptTokens: invocationResult.promptTokens,
        completionTokens: invocationResult.completionTokens,
        latencyMs: invocationResult.latencyMs,
        promptVersion,
      });

      // Compute costs
      let actualCostMicroUsd = 0;
      let normalizedCostMicroUsd = 0;

      if (candidate.providerId === 'deepseek') {
        const cost = EvaluationCostCalculator.calculateDeepSeekCost({
          cacheHitTokens: invocationResult.cacheHitTokens,
          cacheMissTokens: invocationResult.cacheMissTokens,
          completionTokens: invocationResult.completionTokens,
          pricingWindow,
          usageSource: invocationResult.usageSource,
        });
        actualCostMicroUsd = cost.actualCostMicroUsd;
        normalizedCostMicroUsd = cost.normalizedColdOffPeakCostMicroUsd;
      } else if (candidate.providerId === 'gemini') {
        const cost = EvaluationCostCalculator.calculateGeminiCost({
          promptTokens: invocationResult.promptTokens,
          completionTokens: invocationResult.completionTokens,
          thinkingTokens: invocationResult.thinkingTokens,
          serviceTier: candidate.serviceTier || 'flex',
          usageSource: invocationResult.usageSource,
        });
        actualCostMicroUsd = cost.actualCostMicroUsd;
        normalizedCostMicroUsd = cost.normalizedStandardCostMicroUsd;
      }

      const conservativeInputTokenUpperBound = EvaluationCostCalculator.calculateConservativeInputTokenUpperBound(
        promptDef.systemPrompt,
        promptDef.buildUserPrompt(preparedCase.requestEnvelope)
      );

      return {
        runProtocolVersion: 'A12B2B_LIVE_SHADOW_v1',
        datasetVersion: preparedCase.datasetVersion,
        scoringPolicyVersion: SCORING_POLICY_VERSION,
        pricingCatalogVersion: A12B2B_PRICING_CATALOG_VERSION,
        caseId: preparedCase.id,
        taskType: preparedCase.taskType,
        replicateIndex,
        invocationOrdinal,
        candidateId: candidate.candidateId,
        providerId: candidate.providerId,
        requestedModelIdentifier: candidate.requestedModelIdentifier,
        returnedModelIdentifier: invocationResult.returnedModelIdentifier,
        providerModelVersion: invocationResult.providerModelVersion,
        conservativeInputTokenUpperBound,
        serviceProfile: candidate.serviceProfile,
        thinkingEffort: candidate.thinkingEffort,
        promptVersion,
        originalDataClassification: preparedCase.dataClassification,
        effectiveDataClassification: preparedCase.effectiveDataClassification || preparedCase.dataClassification,
        securityDisposition: preparedCase.disposition,
        requestStartedAt,
        pricingWindow,
        latencyMs: invocationResult.latencyMs,
        attemptCount: invocationResult.attemptCount,
        usageSource: invocationResult.usageSource,
        returnedServiceTier: invocationResult.serviceTier,
        cacheStatus: invocationResult.cacheStatus,
        promptTokens: invocationResult.promptTokens,
        cacheHitTokens: invocationResult.cacheHitTokens,
        cacheMissTokens: invocationResult.cacheMissTokens,
        completionTokens: invocationResult.completionTokens,
        thinkingTokens: invocationResult.thinkingTokens,
        totalTokens: invocationResult.totalTokens,
        actualCostMicroUsd,
        normalizedCostMicroUsd,
        dimensionScores: scoreRes.dimensionScores,
        totalScoreBp: scoreRes.weightedQualityScoreBps,
        passed: scoreRes.passed,
        hardFail: scoreRes.hardFail,
        hardFailReasons: scoreRes.hardFailReasons,
        hallucinationsDetected: scoreRes.hallucinationsDetected,
        parsedOutput: scoreRes.parsedOutput,
        rawTextHash: invocationResult.rawTextHash,
      };
    } else {
      // Provider failure record - explicit UNAVAILABLE telemetry and real attempt count
      return {
        runProtocolVersion: 'A12B2B_LIVE_SHADOW_v1',
        datasetVersion: preparedCase.datasetVersion,
        scoringPolicyVersion: SCORING_POLICY_VERSION,
        pricingCatalogVersion: A12B2B_PRICING_CATALOG_VERSION,
        caseId: preparedCase.id,
        taskType: preparedCase.taskType,
        replicateIndex,
        invocationOrdinal,
        candidateId: candidate.candidateId,
        providerId: candidate.providerId,
        requestedModelIdentifier: candidate.requestedModelIdentifier,
        returnedModelIdentifier: 'UNKNOWN',
        conservativeInputTokenUpperBound,
        serviceProfile: candidate.serviceProfile,
        thinkingEffort: candidate.thinkingEffort,
        promptVersion,
        originalDataClassification: preparedCase.dataClassification,
        effectiveDataClassification: preparedCase.effectiveDataClassification || preparedCase.dataClassification,
        securityDisposition: preparedCase.disposition,
        requestStartedAt,
        pricingWindow,
        latencyMs: failureLatencyMs,
        attemptCount: failureAttemptCount,
        usageSource: 'UNAVAILABLE',
        promptTokens: 0,
        cacheHitTokens: 0,
        cacheMissTokens: 0,
        completionTokens: 0,
        thinkingTokens: 0,
        totalTokens: 0,
        actualCostMicroUsd: 0,
        normalizedCostMicroUsd: 0,
        dimensionScores: {
          schemaCompliance: 0,
          evidenceGrounding: 0,
          hallucinationSafety: 0,
          privacySafety: 10000,
          taskCorrectness: 0,
          actionPolicyCompliance: 0,
          instructionFollowing: 0,
        },
        totalScoreBp: 0,
        passed: false,
        hardFail: true,
        hardFailReasons: ['PROVIDER_ERROR' as any],
        hallucinationsDetected: [],
        providerErrorCategory,
      };
    }
  }

  /**
   * Creates a zero-cost, non-invoked result record for security-blocked cases.
   */
  private static createBlockedCaseRecord(
    blockedCase: PreparedEvaluationCase,
    invocationOrdinal: number
  ): LiveEvaluationResultRecord {
    return {
      runProtocolVersion: 'A12B2B_LIVE_SHADOW_v1',
      datasetVersion: blockedCase.datasetVersion,
      scoringPolicyVersion: SCORING_POLICY_VERSION,
      pricingCatalogVersion: A12B2B_PRICING_CATALOG_VERSION,
      caseId: blockedCase.id,
      taskType: blockedCase.taskType,
      replicateIndex: 1,
      invocationOrdinal,
      candidateId: 'deepseek-v4-flash-offpeak-low',
      providerId: 'deepseek',
      requestedModelIdentifier: 'deepseek-v4-flash',
      returnedModelIdentifier: 'BLOCKED',
      serviceProfile: 'OFF_PEAK_COST_OPTIMIZED',
      thinkingEffort: 'low',
      promptVersion: blockedCase.promptVersion,
      originalDataClassification: blockedCase.dataClassification,
      effectiveDataClassification: blockedCase.effectiveDataClassification || blockedCase.dataClassification,
      securityDisposition: 'BLOCKED_BY_SECURITY',
      requestStartedAt: new Date().toISOString(),
      pricingWindow: 'OFF_PEAK',
      latencyMs: 0,
      attemptCount: 0,
      usageSource: 'UNAVAILABLE',
      promptTokens: 0,
      cacheHitTokens: 0,
      cacheMissTokens: 0,
      completionTokens: 0,
      thinkingTokens: 0,
      totalTokens: 0,
      actualCostMicroUsd: 0,
      normalizedCostMicroUsd: 0,
      dimensionScores: {
        schemaCompliance: 0,
        evidenceGrounding: 0,
        hallucinationSafety: 0,
        privacySafety: 10000,
        taskCorrectness: 0,
        actionPolicyCompliance: 0,
        instructionFollowing: 0,
      },
      totalScoreBp: 0,
      passed: false,
      hardFail: true,
      hardFailReasons: ['PRIVACY_LEAKAGE'],
      hallucinationsDetected: ['PRIVACY_UNSAFE_OUTPUT'],
    };
  }

  /**
   * Calculates summary metrics for a candidate across its live evaluation results.
   * Enforces complete replicate invariant (exactly 2 replicates for every eligible case).
   */
  public static summarizeCandidateResults(
    candidate: LiveCandidateConfig,
    results: LiveEvaluationResultRecord[],
    expectedEligibleCases?: PreparedEvaluationCase[]
  ): CandidateLiveSummary {
    const candidateResults = results.filter(
      (r) => r.candidateId === candidate.candidateId && r.securityDisposition === 'ELIGIBLE'
    );
    const totalInvocations = candidateResults.length;
    const successfulInvocations = candidateResults.filter((r) => !r.providerErrorCategory).length;
    const providerErrors = totalInvocations - successfulInvocations;

    let validJsonCount = 0;
    let passedCount = 0;
    let hardFailCount = 0;
    let scoreSum = 0;
    const scores: number[] = [];
    const latencies: number[] = [];

    let totalPromptTokens = 0;
    let totalCacheHitTokens = 0;
    let totalCacheMissTokens = 0;
    let totalCompletionTokens = 0;
    let totalThinkingTokens = 0;
    let totalTokens = 0;
    let actualTotalCostMicroUsd = 0;
    let normalizedTotalCostMicroUsd = 0;

    const taskMap: Record<
      TaskType,
      {
        casesTotal: number;
        casesPassed: number;
        hardFails: number;
        scoreSum: number;
        scores: number[];
        latencies: number[];
        actualCost: number;
        normCost: number;
      }
    > = {
      LEAD_INTENT_CLASSIFICATION: { casesTotal: 0, casesPassed: 0, hardFails: 0, scoreSum: 0, scores: [], latencies: [], actualCost: 0, normCost: 0 },
      LEAK_EXPLANATION: { casesTotal: 0, casesPassed: 0, hardFails: 0, scoreSum: 0, scores: [], latencies: [], actualCost: 0, normCost: 0 },
      GROWTH_ACTION_DRAFT: { casesTotal: 0, casesPassed: 0, hardFails: 0, scoreSum: 0, scores: [], latencies: [], actualCost: 0, normCost: 0 },
      BUSINESS_TWIN_SUMMARY: { casesTotal: 0, casesPassed: 0, hardFails: 0, scoreSum: 0, scores: [], latencies: [], actualCost: 0, normCost: 0 },
      FUNNEL_DIAGNOSTIC_EXPLANATION: { casesTotal: 0, casesPassed: 0, hardFails: 0, scoreSum: 0, scores: [], latencies: [], actualCost: 0, normCost: 0 },
      SEO_CONTENT_SUGGESTION: { casesTotal: 0, casesPassed: 0, hardFails: 0, scoreSum: 0, scores: [], latencies: [], actualCost: 0, normCost: 0 },
      ANOMALY_TRIAGE: { casesTotal: 0, casesPassed: 0, hardFails: 0, scoreSum: 0, scores: [], latencies: [], actualCost: 0, normCost: 0 },
    };

    const caseMap = new Map<string, LiveEvaluationResultRecord[]>();

    for (const r of candidateResults) {
      if (!caseMap.has(r.caseId)) caseMap.set(r.caseId, []);
      caseMap.get(r.caseId)!.push(r);

      if (r.parsedOutput && typeof r.parsedOutput === 'object') validJsonCount++;
      if (r.passed) passedCount++;
      if (r.hardFail) hardFailCount++;

      scoreSum += r.totalScoreBp;
      scores.push(r.totalScoreBp);
      if (!r.providerErrorCategory) latencies.push(r.latencyMs);

      totalPromptTokens += r.promptTokens;
      totalCacheHitTokens += r.cacheHitTokens;
      totalCacheMissTokens += r.cacheMissTokens;
      totalCompletionTokens += r.completionTokens;
      totalThinkingTokens += r.thinkingTokens;
      totalTokens += r.totalTokens;
      actualTotalCostMicroUsd += r.actualCostMicroUsd;
      normalizedTotalCostMicroUsd += r.normalizedCostMicroUsd;

      const t = taskMap[r.taskType];
      t.casesTotal++;
      if (r.passed) t.casesPassed++;
      if (r.hardFail) t.hardFails++;
      t.scoreSum += r.totalScoreBp;
      t.scores.push(r.totalScoreBp);
      if (!r.providerErrorCategory) t.latencies.push(r.latencyMs);
      t.actualCost += r.actualCostMicroUsd;
      t.normCost += r.normalizedCostMicroUsd;
    }

    // Verify exactly 2 replicates for every eligible case
    if (expectedEligibleCases && expectedEligibleCases.length > 0) {
      for (const ec of expectedEligibleCases) {
        const reps = caseMap.get(ec.id) || [];
        if (reps.length !== 2) {
          throw new Error(
            `A12B2B_INCOMPLETE_REPLICATE_PROTOCOL: Case ${ec.id} for candidate ${candidate.candidateId} has ${reps.length} replicates (expected exactly 2)`
          );
        }
      }
    } else {
      for (const [caseId, reps] of caseMap) {
        if (reps.length !== 2) {
          throw new Error(
            `A12B2B_INCOMPLETE_REPLICATE_PROTOCOL: Case ${caseId} for candidate ${candidate.candidateId} has ${reps.length} replicates (expected exactly 2)`
          );
        }
      }
    }

    let unstableCaseCount = 0;
    for (const [, reps] of caseMap) {
      if (reps.length === 2) {
        const scoreDelta = Math.abs(reps[0].totalScoreBp - reps[1].totalScoreBp);
        const passMismatch = reps[0].passed !== reps[1].passed;
        const hardFailMismatch = reps[0].hardFail !== reps[1].hardFail;
        if (passMismatch || hardFailMismatch || scoreDelta > 2000) {
          unstableCaseCount++;
        }
      }
    }

    const validJsonRateBps = totalInvocations > 0 ? Math.round((validJsonCount / totalInvocations) * 10000) : 0;
    const providerSuccessRateBps = totalInvocations > 0 ? Math.round((successfulInvocations / totalInvocations) * 10000) : 0;
    const passRateBps = totalInvocations > 0 ? Math.round((passedCount / totalInvocations) * 10000) : 0;
    const hardFailRateBps = totalInvocations > 0 ? Math.round((hardFailCount / totalInvocations) * 10000) : 0;
    const meanScoreBps = totalInvocations > 0 ? Math.round(scoreSum / totalInvocations) : 0;
    const medianScoreBps = this.computePercentile(scores, 50);

    const minLatencyMs = latencies.length > 0 ? Math.min(...latencies) : 0;
    const maxLatencyMs = latencies.length > 0 ? Math.max(...latencies) : 0;
    const meanLatencyMs = latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;
    const p50LatencyMs = this.computePercentile(latencies, 50);
    const p95LatencyMs = this.computePercentile(latencies, 95);

    const cacheHitRatioBps = totalPromptTokens > 0 ? Math.round((totalCacheHitTokens / totalPromptTokens) * 10000) : 0;
    const costPerPassingCaseMicroUsd = passedCount > 0 ? Math.round(actualTotalCostMicroUsd / passedCount) : 0;
    const totalCases = caseMap.size;
    const instabilityRateBps = totalCases > 0 ? Math.round((unstableCaseCount / totalCases) * 10000) : 0;

    const perTaskBreakdown: any = {};
    for (const [taskKey, t] of Object.entries(taskMap)) {
      const task = taskKey as TaskType;
      perTaskBreakdown[task] = {
        casesTotal: t.casesTotal,
        casesPassed: t.casesPassed,
        hardFails: t.hardFails,
        passRateBps: t.casesTotal > 0 ? Math.round((t.casesPassed / t.casesTotal) * 10000) : 0,
        meanScoreBps: t.casesTotal > 0 ? Math.round(t.scoreSum / t.casesTotal) : 0,
        medianScoreBps: this.computePercentile(t.scores, 50),
        p50LatencyMs: this.computePercentile(t.latencies, 50),
        p95LatencyMs: this.computePercentile(t.latencies, 95),
        actualCostMicroUsd: t.actualCost,
        normalizedCostMicroUsd: t.normCost,
      };
    }

    return {
      candidateId: candidate.candidateId,
      providerId: candidate.providerId,
      requestedModelIdentifier: candidate.requestedModelIdentifier,
      serviceProfile: candidate.serviceProfile,
      totalInvocations,
      successfulInvocations,
      providerErrors,
      validJsonRateBps,
      providerSuccessRateBps,
      passRateBps,
      hardFailRateBps,
      meanScoreBps,
      medianScoreBps,
      p50LatencyMs,
      p95LatencyMs,
      minLatencyMs,
      maxLatencyMs,
      meanLatencyMs,
      totalPromptTokens,
      totalCacheHitTokens,
      totalCacheMissTokens,
      totalCompletionTokens,
      totalThinkingTokens,
      totalTokens,
      cacheHitRatioBps,
      actualTotalCostMicroUsd,
      normalizedTotalCostMicroUsd,
      costPerPassingCaseMicroUsd,
      unstableCaseCount,
      instabilityRateBps,
      perTaskBreakdown,
    };
  }

  /**
   * Computes detailed cost optimization analysis using persisted live results evidence.
   */
  public static analyzeCostOptimization(
    summaries: Record<LiveCandidateId, CandidateLiveSummary>,
    results: LiveEvaluationResultRecord[] = []
  ): CostOptimizationAnalysis {
    const dsSummary = summaries['deepseek-v4-flash-offpeak-low'];
    const gemSummary = summaries['gemini-3.5-flash-lite-flex-low'];

    // DeepSeek Verification
    const dsResults = results.filter((r) => r.candidateId === 'deepseek-v4-flash-offpeak-low' && r.securityDisposition === 'ELIGIBLE');
    const officialOffPeakWindowVerified =
      dsResults.length > 0 &&
      dsResults.every((r) => r.pricingWindow === 'OFF_PEAK' && !r.providerErrorCategory);

    // DeepSeek Arithmetic
    const dsActualCost = dsSummary?.actualTotalCostMicroUsd || 0;
    const dsColdOffPeak = dsSummary?.normalizedTotalCostMicroUsd || 0;
    const totalPrompt = (dsSummary?.totalCacheHitTokens || 0) + (dsSummary?.totalCacheMissTokens || 0);
    const totalComp = dsSummary?.totalCompletionTokens || 0;

    const dsColdPeak =
      Math.round((totalPrompt * DEEPSEEK_V4_FLASH_PRICING.peakCacheMissMicroUsdPer1M) / 1000000) +
      Math.round((totalComp * DEEPSEEK_V4_FLASH_PRICING.peakOutputMicroUsdPer1M) / 1000000);

    const dsRealizedCacheSavingBps = EvaluationCostCalculator.calculateDiscountBps(dsColdOffPeak, dsActualCost);
    const dsRealizedOffPeakSavingBps = EvaluationCostCalculator.calculateDiscountBps(dsColdPeak, dsColdOffPeak);
    const dsCombinedRealizedSavingBps = EvaluationCostCalculator.calculateDiscountBps(dsColdPeak, dsActualCost);

    // Gemini Verification using persisted returnedServiceTier and cacheStatus
    const gemResults = results.filter((r) => r.candidateId === 'gemini-3.5-flash-lite-flex-low' && r.securityDisposition === 'ELIGIBLE');
    const flexTierConfirmed =
      gemResults.length > 0 &&
      gemResults.every((r) => r.returnedServiceTier === 'flex' && !r.providerErrorCategory);

    const geminiCacheVerified =
      gemResults.length > 0 &&
      gemResults.every((r) => r.cacheStatus === 'VERIFIED' && !r.providerErrorCategory);
    const geminiCacheStatus: 'VERIFIED' | 'NOT_VERIFIED' = geminiCacheVerified ? 'VERIFIED' : 'NOT_VERIFIED';

    // Gemini Arithmetic
    const gemActualFlex = gemSummary?.actualTotalCostMicroUsd || 0;
    const gemNormStandard = gemSummary?.normalizedTotalCostMicroUsd || 0;
    const gemRealizedFlexSavingBps = EvaluationCostCalculator.calculateDiscountBps(gemNormStandard, gemActualFlex);

    return {
      deepseek: {
        officialOffPeakWindowVerified,
        pricingCatalogVersion: A12B2B_PRICING_CATALOG_VERSION,
        offPeakCacheHitRateMicroUsdPer1M: DEEPSEEK_V4_FLASH_PRICING.offPeakCacheHitMicroUsdPer1M,
        offPeakCacheMissRateMicroUsdPer1M: DEEPSEEK_V4_FLASH_PRICING.offPeakCacheMissMicroUsdPer1M,
        offPeakOutputRateMicroUsdPer1M: DEEPSEEK_V4_FLASH_PRICING.offPeakOutputMicroUsdPer1M,
        totalCacheHitTokens: dsSummary?.totalCacheHitTokens || 0,
        totalCacheMissTokens: dsSummary?.totalCacheMissTokens || 0,
        cacheHitRatioBps: dsSummary?.cacheHitRatioBps || 0,
        actualOffPeakCostMicroUsd: dsActualCost,
        coldCacheOffPeakCostMicroUsd: dsColdOffPeak,
        coldCachePeakCostMicroUsd: dsColdPeak,
        realizedCacheSavingBps: dsRealizedCacheSavingBps,
        realizedOffPeakSavingBps: dsRealizedOffPeakSavingBps,
        combinedRealizedSavingBps: dsCombinedRealizedSavingBps,
        specificDiscountedTokenSegment:
          'DeepSeek ~98% discount rate applies strictly to off-peak cache-hit input ($0.007/1M) vs peak cache-miss input ($0.44/1M).',
      },
      gemini: {
        flexTierConfirmed,
        pricingCatalogVersion: A12B2B_PRICING_CATALOG_VERSION,
        flexInputRateMicroUsdPer1M: GEMINI_35_FLASH_LITE_PRICING.flexInputMicroUsdPer1M,
        flexOutputRateMicroUsdPer1M: GEMINI_35_FLASH_LITE_PRICING.flexOutputMicroUsdPer1M,
        standardInputRateMicroUsdPer1M: GEMINI_35_FLASH_LITE_PRICING.standardInputMicroUsdPer1M,
        standardOutputRateMicroUsdPer1M: GEMINI_35_FLASH_LITE_PRICING.standardOutputMicroUsdPer1M,
        actualFlexCostMicroUsd: gemActualFlex,
        normalizedStandardCostMicroUsd: gemNormStandard,
        realizedFlexSavingBps: gemRealizedFlexSavingBps,
        cacheStatus: geminiCacheStatus,
      },
    };
  }

  /**
   * Helper for percentile computation
   */
  private static computePercentile(numbers: number[], percentile: number): number {
    if (numbers.length === 0) return 0;
    const sorted = [...numbers].sort((a, b) => a - b);
    const index = (percentile / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;
    if (lower === upper) return sorted[lower];
    return Math.round(sorted[lower] * (1 - weight) + sorted[upper] * weight);
  }
}
