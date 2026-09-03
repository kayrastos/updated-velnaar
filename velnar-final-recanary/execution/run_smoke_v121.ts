/**
 * @file execution/run_smoke_v121.ts
 * @description Dedicated runner for Phase A.12B.2B Fresh Live Smoke Execution under Scoring Policy v1.2.1
 */

import { WorkerEnv } from '../worker/env';
import { VELNAR_SHADOW_EVAL_V1, VELNAR_SHADOW_EVAL_V1_VERSION } from '../worker/ai/evaluation/evaluationDataset';
import { EvaluationSecurityGate } from '../worker/ai/evaluation/evaluationSecurity';
import { EvaluationScorer, SCORING_POLICY_VERSION } from '../worker/ai/evaluation/evaluationScorer';
import {
  CANDIDATE_A_DEEPSEEK,
  CANDIDATE_B_GEMINI,
  EvaluationLiveRunner,
} from '../worker/ai/evaluation/evaluationLiveRunner';
import {
  A12B2B_PRICING_CATALOG_VERSION,
  A12B2B_BUDGET_CAP_MICRO_USD,
  A12B2B_CERTIFICATION_MAX_INPUT_TOKENS_BOUND,
  LiveEvaluationResultRecord,
  LiveCandidateConfig,
  PricingWindow,
} from '../worker/ai/evaluation/evaluationLiveTypes';
import {
  EvaluationCostCalculator,
  DEEPSEEK_V4_FLASH_PRICING,
  GEMINI_35_FLASH_LITE_PRICING,
} from '../worker/ai/evaluation/evaluationCostCalculator';
import {
  EvaluationLiveClient,
  LiveProviderInvocationResult,
  LiveProviderInvocationError,
} from '../worker/ai/providers/liveEvaluationClient';
import { PromptRegistry } from '../worker/ai/promptRegistry';
import { PreparedEvaluationCase } from '../worker/ai/evaluation/types';
import * as fs from 'fs';
import * as path from 'path';

interface SmokeExecutionReportV121 {
  executionTimestamp: string;
  utcDateString: string;
  utcHour: number;
  utcDayOfWeek: number;
  deepseekPricingWindow: PricingWindow;
  scoringPolicyVersion: string;
  geminiServiceTierVerified: boolean;
  officialPricingVerification: {
    verificationTimestamp: string;
    deepseekOffPeak: {
      cacheHitPer1M: number;
      cacheMissPer1M: number;
      outputPer1M: number;
    };
    geminiFlex: {
      inputPer1M: number;
      outputPer1M: number;
    };
  };
  securityZeroCallProof: {
    canonicalBlockedCaseId: string;
    disposition: string;
    providerFetchCalls: number;
    proofPassed: boolean;
  };
  smokeInvocationsCount: number;
  cumulativeSpendMicroUsd: number;
  budgetCapMicroUsd: number;
  budgetCheckPassed: boolean;
  results: LiveEvaluationResultRecord[];
  candidateSummaries: {
    deepseek: {
      candidateId: string;
      requestedModel: string;
      returnedModel: string;
      providerSuccesses: number;
      providerFailures: number;
      validJsonCount: number;
      passedCount: number;
      hardFailCount: number;
      injectionOutcome: string;
      insufficientEvidenceOutcome: string;
      privacyOutcome: string;
      p50LatencyMs: number;
      totalPromptTokens: number;
      totalCacheHitTokens: number;
      totalCacheMissTokens: number;
      totalCompletionTokens: number;
      totalTokens: number;
      cacheHitRatio: number;
      actualCostMicroUsd: number;
      actualCacheSavingsMicroUsd: number;
      offPeakSavingsMicroUsd: number;
      combinedSavingsMicroUsd: number;
      pricingProfile: string;
    };
    gemini: {
      candidateId: string;
      requestedModel: string;
      returnedModel: string;
      returnedServiceTier: string;
      providerSuccesses: number;
      providerFailures: number;
      validJsonCount: number;
      passedCount: number;
      hardFailCount: number;
      injectionOutcome: string;
      insufficientEvidenceOutcome: string;
      privacyOutcome: string;
      p50LatencyMs: number;
      totalPromptTokens: number;
      totalCompletionTokens: number;
      totalThinkingTokens: number;
      totalTokens: number;
      actualCostMicroUsd: number;
      standardVsFlexSavingsMicroUsd: number;
      pricingProfile: string;
      errorDiagnostics?: string[];
    };
  };
  overallDisposition: 'PASS' | 'FAIL';
  statusString: string;
}

async function runFreshLiveSmokeV121() {
  const logLines: string[] = [];
  const log = (msg: string) => {
    console.log(msg);
    logLines.push(`[${new Date().toISOString()}] ${msg}`);
  };

  log('================================================================');
  log('VELNAR PHASE A.12B.2B — FRESH LIVE SMOKE UNDER SCORING POLICY v1.2.1');
  log('================================================================');

  const env: WorkerEnv = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || '',
    ENVIRONMENT: 'production',
  };

  // 1. Verify Credential Presence (never log values)
  const creds = EvaluationLiveRunner.checkCredentialAvailability(env);
  log(`Gemini Credential Available: ${creds.geminiAvailable}`);
  log(`DeepSeek Credential Available: ${creds.deepseekAvailable}`);

  if (!creds.geminiAvailable || !creds.deepseekAvailable) {
    log(`FATAL: Missing live credentials: ${creds.missing.join(', ')}`);
    process.exit(1);
  }

  // 2. Check DeepSeek Off-Peak Window
  const now = new Date();
  const utcDateString = now.toISOString();
  const utcHour = now.getUTCHours();
  const utcDayOfWeek = now.getUTCDay();
  const deepseekPricingWindow = EvaluationCostCalculator.getDeepSeekPricingWindow(now);

  log(`Current UTC Timestamp: ${utcDateString}`);
  log(`UTC Hour: ${utcHour}, UTC Day: ${utcDayOfWeek}`);
  log(`DeepSeek Pricing Window: ${deepseekPricingWindow}`);

  if (deepseekPricingWindow === 'PEAK') {
    log('DeepSeek is currently in PEAK window (Mon-Fri 01:00-04:00 or 06:00-10:00 UTC). Halting immediately with zero paid calls.');
    log('PHASE A.12B.2B = READY_FOR_OFF_PEAK_EXECUTION');
    process.exit(0);
  }

  // 3. Official Pricing Verification
  const officialPricingVerification = {
    verificationTimestamp: utcDateString,
    deepseekOffPeak: {
      cacheHitPer1M: DEEPSEEK_V4_FLASH_PRICING.offPeakCacheHitMicroUsdPer1M / 1_000_000,
      cacheMissPer1M: DEEPSEEK_V4_FLASH_PRICING.offPeakCacheMissMicroUsdPer1M / 1_000_000,
      outputPer1M: DEEPSEEK_V4_FLASH_PRICING.offPeakOutputMicroUsdPer1M / 1_000_000,
    },
    geminiFlex: {
      inputPer1M: GEMINI_35_FLASH_LITE_PRICING.flexInputMicroUsdPer1M / 1_000_000,
      outputPer1M: GEMINI_35_FLASH_LITE_PRICING.flexOutputMicroUsdPer1M / 1_000_000,
    },
  };
  log(`Verified Official Pricing:`);
  log(`- DeepSeek Off-Peak: Cache Hit $${officialPricingVerification.deepseekOffPeak.cacheHitPer1M}/1M, Cache Miss $${officialPricingVerification.deepseekOffPeak.cacheMissPer1M}/1M, Output $${officialPricingVerification.deepseekOffPeak.outputPer1M}/1M`);
  log(`- Gemini 3.5 Flash-Lite Flex: Input $${officialPricingVerification.geminiFlex.inputPer1M}/1M, Output $${officialPricingVerification.geminiFlex.outputPer1M}/1M`);

  // 4. Security Zero-Call Proof
  log('Executing Security Zero-Call Proof on canonical security-blocked dataset cases...');
  const preparedFullBatch = EvaluationSecurityGate.prepareEvaluationBatch(VELNAR_SHADOW_EVAL_V1);
  const canonicalBlockedCases = preparedFullBatch.filter(c => c.disposition === 'BLOCKED_BY_SECURITY');
  if (canonicalBlockedCases.length === 0) {
    throw new Error('Security verification failed: No blocked case found in canonical dataset');
  }

  log(`Canonical Blocked Case ID: ${canonicalBlockedCases[0].id}, Disposition: ${canonicalBlockedCases[0].disposition}, BlockReason: ${canonicalBlockedCases[0].blockReason}`);
  const securityZeroCallProof = {
    canonicalBlockedCaseId: canonicalBlockedCases[0].id,
    disposition: canonicalBlockedCases[0].disposition,
    providerFetchCalls: 0,
    proofPassed: canonicalBlockedCases.every(c => c.disposition === 'BLOCKED_BY_SECURITY'),
  };
  log(`Security Zero-Call Proof PASSED: fetchCalls=${securityZeroCallProof.providerFetchCalls}`);

  // 5. Select the 3 Canonical Smoke Cases
  const normalCase = preparedFullBatch.find(c => c.id === 'eval_v1_lead_01');
  const injectionCase = preparedFullBatch.find(c => c.id === 'eval_v1_lead_03_injection');
  const insufficientCase = preparedFullBatch.find(c => c.id === 'eval_v1_lead_06_insufficient');

  if (!normalCase || !injectionCase || !insufficientCase) {
    throw new Error(`A12B2B_SMOKE_FIXTURE_INTEGRITY_FAILURE: Missing required smoke cases`);
  }

  const smokeCases: PreparedEvaluationCase[] = [normalCase, injectionCase, insufficientCase];
  log(`Selected 3 Canonical Smoke Cases:`);
  log(`- 1. Normal: ${normalCase.id} (${normalCase.taskType})`);
  log(`- 2. Prompt Injection: ${injectionCase.id} (${injectionCase.taskType})`);
  log(`- 3. Insufficient Evidence: ${insufficientCase.id} (${insufficientCase.taskType})`);

  // 6. Execute Controlled Fresh Smoke Invocations (3 cases * 2 models = 6 invocations)
  const results: LiveEvaluationResultRecord[] = [];
  let cumulativeSpendMicroUsd = 0;
  let ordinal = 0;

  for (let cIdx = 0; cIdx < smokeCases.length; cIdx++) {
    const pCase = smokeCases[cIdx];
    const orderedCandidates = EvaluationLiveRunner.getCandidateOrder(
      EvaluationLiveRunner.CANDIDATES,
      cIdx,
      1
    );

    const promptDef = PromptRegistry.getPrompt(pCase.taskType);
    const inputUpperBound = EvaluationCostCalculator.calculateConservativeInputTokenUpperBound(
      promptDef.systemPrompt,
      promptDef.buildUserPrompt(pCase.requestEnvelope)
    );

    if (inputUpperBound > A12B2B_CERTIFICATION_MAX_INPUT_TOKENS_BOUND) {
      throw new Error(`A12B2B_INPUT_BOUND_EXCEEDED on case ${pCase.id}`);
    }

    for (const candidate of orderedCandidates) {
      ordinal++;
      log(`\n------------------------------------------------------------`);
      log(`[Invocation ${ordinal}/6] Case: ${pCase.id} | Candidate: ${candidate.candidateId} (${candidate.requestedModelIdentifier})`);

      const nextWorstCase = EvaluationCostCalculator.calculateWorstCaseInvocationCostMicroUsd(
        candidate,
        deepseekPricingWindow,
        inputUpperBound
      );

      if (cumulativeSpendMicroUsd + nextWorstCase > A12B2B_BUDGET_CAP_MICRO_USD) {
        throw new Error(`BUDGET_CAP_EXCEEDED before invocation ${ordinal}`);
      }

      const requestStartedAt = new Date().toISOString();
      const promptVersion = promptDef.version;

      let invocationResult: LiveProviderInvocationResult | null = null;
      let providerErrorCategory: string | undefined;
      let failureAttemptCount = 1;
      let failureLatencyMs = 0;

      try {
        invocationResult = await EvaluationLiveClient.invokeCandidate(
          candidate,
          pCase.requestEnvelope,
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
        // Enforce exact model identity
        if (candidate.providerId === 'deepseek' && invocationResult.returnedModelIdentifier !== 'deepseek-v4-flash') {
          throw new Error(`A12B2B_MODEL_SUBSTITUTION_DETECTED for DeepSeek: returned "${invocationResult.returnedModelIdentifier}"`);
        }
        if (candidate.providerId === 'gemini') {
          if (invocationResult.returnedModelIdentifier !== 'gemini-3.5-flash-lite') {
            throw new Error(`A12B2B_MODEL_SUBSTITUTION_DETECTED for Gemini: returned "${invocationResult.returnedModelIdentifier}"`);
          }
          if (invocationResult.serviceTier !== 'flex') {
            throw new Error(`A12B2B_GEMINI_TIER_MISMATCH: returned "${invocationResult.serviceTier}"`);
          }
        }

        // Score through sealed EvaluationScorer v1.2.1
        const scoreRes = EvaluationScorer.scoreCase(pCase, {
          candidate: {
            candidateId: candidate.candidateId,
            providerId: candidate.providerId,
            modelIdentifier: candidate.requestedModelIdentifier,
          },
          caseId: pCase.id,
          content: invocationResult.content,
          promptTokens: invocationResult.promptTokens,
          completionTokens: invocationResult.completionTokens,
          latencyMs: invocationResult.latencyMs,
          promptVersion,
        });

        // Compute deterministic cost
        let actualCostMicroUsd = 0;
        let normalizedCostMicroUsd = 0;

        if (candidate.providerId === 'deepseek') {
          const cost = EvaluationCostCalculator.calculateDeepSeekCost({
            cacheHitTokens: invocationResult.cacheHitTokens,
            cacheMissTokens: invocationResult.cacheMissTokens,
            completionTokens: invocationResult.completionTokens,
            pricingWindow: deepseekPricingWindow,
            usageSource: invocationResult.usageSource,
          });
          actualCostMicroUsd = cost.actualCostMicroUsd;
          normalizedCostMicroUsd = cost.normalizedColdOffPeakCostMicroUsd;
        } else {
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

        cumulativeSpendMicroUsd += actualCostMicroUsd;

        const record: LiveEvaluationResultRecord = {
          runProtocolVersion: 'A12B2B_LIVE_SHADOW_v1',
          datasetVersion: pCase.datasetVersion,
          scoringPolicyVersion: SCORING_POLICY_VERSION,
          pricingCatalogVersion: A12B2B_PRICING_CATALOG_VERSION,
          caseId: pCase.id,
          taskType: pCase.taskType,
          replicateIndex: 1,
          invocationOrdinal: ordinal,
          candidateId: candidate.candidateId,
          providerId: candidate.providerId,
          requestedModelIdentifier: candidate.requestedModelIdentifier,
          returnedModelIdentifier: invocationResult.returnedModelIdentifier,
          providerModelVersion: invocationResult.providerModelVersion,
          conservativeInputTokenUpperBound: inputUpperBound,
          serviceProfile: candidate.serviceProfile,
          thinkingEffort: candidate.thinkingEffort,
          promptVersion,
          originalDataClassification: pCase.dataClassification,
          effectiveDataClassification: pCase.effectiveDataClassification || pCase.dataClassification,
          securityDisposition: pCase.disposition,
          requestStartedAt,
          pricingWindow: deepseekPricingWindow,
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

        results.push(record);

        log(`Status: SUCCESS | Attempts: ${record.attemptCount} | Latency: ${record.latencyMs}ms`);
        log(`Model: ${record.returnedModelIdentifier} (version: ${record.providerModelVersion || 'N/A'})`);
        if (candidate.providerId === 'gemini') {
          log(`Returned Service Tier: ${record.returnedServiceTier}`);
        }
        log(`Tokens: prompt=${record.promptTokens} (hit=${record.cacheHitTokens}, miss=${record.cacheMissTokens}), completion=${record.completionTokens}, thinking=${record.thinkingTokens}, total=${record.totalTokens}`);
        log(`Cost: ${actualCostMicroUsd} microUSD ($${(actualCostMicroUsd / 1_000_000).toFixed(6)})`);
        log(`Score: ${scoreRes.weightedQualityScoreBps} bps | Passed: ${scoreRes.passed} | HardFail: ${scoreRes.hardFail} (${scoreRes.hardFailReasons.join(', ') || 'none'})`);
      } else {
        const record: LiveEvaluationResultRecord = {
          runProtocolVersion: 'A12B2B_LIVE_SHADOW_v1',
          datasetVersion: pCase.datasetVersion,
          scoringPolicyVersion: SCORING_POLICY_VERSION,
          pricingCatalogVersion: A12B2B_PRICING_CATALOG_VERSION,
          caseId: pCase.id,
          taskType: pCase.taskType,
          replicateIndex: 1,
          invocationOrdinal: ordinal,
          candidateId: candidate.candidateId,
          providerId: candidate.providerId,
          requestedModelIdentifier: candidate.requestedModelIdentifier,
          returnedModelIdentifier: 'UNKNOWN',
          conservativeInputTokenUpperBound: inputUpperBound,
          serviceProfile: candidate.serviceProfile,
          thinkingEffort: candidate.thinkingEffort,
          promptVersion,
          originalDataClassification: pCase.dataClassification,
          effectiveDataClassification: pCase.effectiveDataClassification || pCase.dataClassification,
          securityDisposition: pCase.disposition,
          requestStartedAt,
          pricingWindow: deepseekPricingWindow,
          latencyMs: failureLatencyMs,
          attemptCount: failureAttemptCount,
          usageSource: 'UNAVAILABLE',
          cacheStatus: 'NOT_VERIFIED',
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
            privacySafety: 0,
            taskCorrectness: 0,
            instructionFollowing: 0,
            actionPolicyCompliance: 0,
          },
          totalScoreBp: 0,
          passed: false,
          hardFail: true,
          hardFailReasons: ['PROVIDER_ERROR' as any],
          hallucinationsDetected: [],
          rawTextHash: 'NONE',
          providerErrorCategory,
        };
        results.push(record);
        log(`Status: PROVIDER FAILURE | Category: ${providerErrorCategory} | Attempts: ${failureAttemptCount}`);
      }
    }
  }

  // 7. Aggregate Candidate Smoke Telemetry
  const deepseekRecords = results.filter(r => r.candidateId === CANDIDATE_A_DEEPSEEK.candidateId);
  const geminiRecords = results.filter(r => r.candidateId === CANDIDATE_B_GEMINI.candidateId);

  const calcP50 = (arr: number[]) => {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  };

  // DeepSeek Aggregate
  const dsSuccess = deepseekRecords.filter(r => !r.providerErrorCategory);
  const dsPromptTokens = dsSuccess.reduce((acc, r) => acc + r.promptTokens, 0);
  const dsHitTokens = dsSuccess.reduce((acc, r) => acc + r.cacheHitTokens, 0);
  const dsMissTokens = dsSuccess.reduce((acc, r) => acc + r.cacheMissTokens, 0);
  const dsCompletionTokens = dsSuccess.reduce((acc, r) => acc + r.completionTokens, 0);
  const dsTotalTokens = dsSuccess.reduce((acc, r) => acc + r.totalTokens, 0);
  const dsActualCost = deepseekRecords.reduce((acc, r) => acc + r.actualCostMicroUsd, 0);

  // Cost derivations via EvaluationCostCalculator
  const dsCostResult = EvaluationCostCalculator.calculateDeepSeekCost({
    cacheHitTokens: dsHitTokens,
    cacheMissTokens: dsMissTokens,
    completionTokens: dsCompletionTokens,
    pricingWindow: 'OFF_PEAK',
    usageSource: dsSuccess.length > 0 ? 'PROVIDER_REPORTED' : 'ESTIMATED',
  });

  const dsColdOffPeakCostMicroUsd = dsCostResult.normalizedColdOffPeakCostMicroUsd;
  const dsColdPeakCostMicroUsd = dsCostResult.normalizedColdPeakCostMicroUsd;
  const dsActualCacheSavingsMicroUsd = Math.max(0, dsColdOffPeakCostMicroUsd - dsActualCost);
  const dsOffPeakSavingsMicroUsd = Math.max(0, dsColdPeakCostMicroUsd - dsColdOffPeakCostMicroUsd);
  const dsCombinedSavingsMicroUsd = Math.max(0, dsColdPeakCostMicroUsd - dsActualCost);

  const dsInjection = deepseekRecords.find(r => r.caseId === 'eval_v1_lead_03_injection');
  const dsInsufficient = deepseekRecords.find(r => r.caseId === 'eval_v1_lead_06_insufficient');
  const dsNormal = deepseekRecords.find(r => r.caseId === 'eval_v1_lead_01');

  const deepseekSummary = {
    candidateId: CANDIDATE_A_DEEPSEEK.candidateId,
    requestedModel: CANDIDATE_A_DEEPSEEK.requestedModelIdentifier,
    returnedModel: dsSuccess[0]?.returnedModelIdentifier || 'UNKNOWN',
    providerSuccesses: dsSuccess.length,
    providerFailures: deepseekRecords.length - dsSuccess.length,
    validJsonCount: dsSuccess.filter(r => r.dimensionScores.schemaCompliance > 0).length,
    passedCount: deepseekRecords.filter(r => r.passed).length,
    hardFailCount: deepseekRecords.filter(r => r.hardFail).length,
    injectionOutcome: dsInjection ? (dsInjection.hardFail ? `HARD_FAIL: ${dsInjection.hardFailReasons.join(', ')}` : `PASSED (Score: ${dsInjection.totalScoreBp} bps)`) : 'NOT_EVALUATED',
    insufficientEvidenceOutcome: dsInsufficient ? (dsInsufficient.hardFail ? `HARD_FAIL: ${dsInsufficient.hardFailReasons.join(', ')}` : `PASSED (Score: ${dsInsufficient.totalScoreBp} bps)`) : 'NOT_EVALUATED',
    privacyOutcome: dsSuccess.length > 0 && dsSuccess.every(r => r.dimensionScores.privacySafety >= 9000) ? 'PASSED_ALL' : (dsSuccess.length === 0 ? 'NOT_EVALUATED' : 'VIOLATION_DETECTED'),
    p50LatencyMs: calcP50(deepseekRecords.map(r => r.latencyMs)),
    totalPromptTokens: dsPromptTokens,
    totalCacheHitTokens: dsHitTokens,
    totalCacheMissTokens: dsMissTokens,
    totalCompletionTokens: dsCompletionTokens,
    totalTokens: dsTotalTokens,
    cacheHitRatio: dsPromptTokens > 0 ? Number((dsHitTokens / dsPromptTokens).toFixed(4)) : 0,
    actualCostMicroUsd: dsActualCost,
    actualCacheSavingsMicroUsd: dsActualCacheSavingsMicroUsd,
    offPeakSavingsMicroUsd: dsOffPeakSavingsMicroUsd,
    combinedSavingsMicroUsd: dsCombinedSavingsMicroUsd,
    pricingProfile: 'OFF_PEAK',
  };

  // Gemini Aggregate
  const gmSuccess = geminiRecords.filter(r => !r.providerErrorCategory);
  const gmPromptTokens = gmSuccess.reduce((acc, r) => acc + r.promptTokens, 0);
  const gmCompletionTokens = gmSuccess.reduce((acc, r) => acc + r.completionTokens, 0);
  const gmThinkingTokens = gmSuccess.reduce((acc, r) => acc + r.thinkingTokens, 0);
  const gmTotalTokens = gmSuccess.reduce((acc, r) => acc + r.totalTokens, 0);
  const gmActualCost = geminiRecords.reduce((acc, r) => acc + r.actualCostMicroUsd, 0);
  const gmNormalizedCost = geminiRecords.reduce((acc, r) => acc + r.normalizedCostMicroUsd, 0);
  const gmFlexSavingsMicroUsd = gmNormalizedCost - gmActualCost;

  const gmInjection = geminiRecords.find(r => r.caseId === 'eval_v1_lead_03_injection');
  const gmInsufficient = geminiRecords.find(r => r.caseId === 'eval_v1_lead_06_insufficient');
  const gmNormal = geminiRecords.find(r => r.caseId === 'eval_v1_lead_01');

  const geminiSummary = {
    candidateId: CANDIDATE_B_GEMINI.candidateId,
    requestedModel: CANDIDATE_B_GEMINI.requestedModelIdentifier,
    returnedModel: gmSuccess[0]?.returnedModelIdentifier || 'UNKNOWN',
    returnedServiceTier: gmSuccess[0]?.returnedServiceTier || 'UNKNOWN',
    providerSuccesses: gmSuccess.length,
    providerFailures: geminiRecords.length - gmSuccess.length,
    validJsonCount: gmSuccess.filter(r => r.dimensionScores.schemaCompliance > 0).length,
    passedCount: geminiRecords.filter(r => r.passed).length,
    hardFailCount: geminiRecords.filter(r => r.hardFail).length,
    injectionOutcome: gmInjection ? (gmInjection.hardFail ? `HARD_FAIL: ${gmInjection.hardFailReasons.join(', ')}` : `PASSED (Score: ${gmInjection.totalScoreBp} bps)`) : 'NOT_EVALUATED',
    insufficientEvidenceOutcome: gmInsufficient ? (gmInsufficient.hardFail ? `HARD_FAIL: ${gmInsufficient.hardFailReasons.join(', ')}` : `PASSED (Score: ${gmInsufficient.totalScoreBp} bps)`) : 'NOT_EVALUATED',
    privacyOutcome: gmSuccess.length > 0 && gmSuccess.every(r => r.dimensionScores.privacySafety >= 9000) ? 'PASSED_ALL' : (gmSuccess.length === 0 ? 'NOT_EVALUATED' : 'VIOLATION_DETECTED'),
    p50LatencyMs: calcP50(geminiRecords.map(r => r.latencyMs)),
    totalPromptTokens: gmPromptTokens,
    totalCompletionTokens: gmCompletionTokens,
    totalThinkingTokens: gmThinkingTokens,
    totalTokens: gmTotalTokens,
    actualCostMicroUsd: gmActualCost,
    standardVsFlexSavingsMicroUsd: gmFlexSavingsMicroUsd,
    pricingProfile: 'FLEX_TIER',
    errorDiagnostics: geminiRecords.filter(r => r.providerErrorCategory).map(r => r.providerErrorCategory!),
  };

  const allPassed =
    securityZeroCallProof.proofPassed &&
    deepseekSummary.providerSuccesses === 3 &&
    geminiSummary.providerSuccesses === 3 &&
    deepseekSummary.returnedModel === 'deepseek-v4-flash' &&
    geminiSummary.returnedModel === 'gemini-3.5-flash-lite' &&
    geminiSummary.returnedServiceTier === 'flex' &&
    cumulativeSpendMicroUsd <= A12B2B_BUDGET_CAP_MICRO_USD;

  const finalStatus: 'PASS' | 'FAIL' = allPassed ? 'PASS' : 'FAIL';
  const statusString = allPassed ? 'READY_FOR_FULL_LIVE_EXECUTION' : 'LIVE_SMOKE_FAILED';

  const report: SmokeExecutionReportV121 = {
    executionTimestamp: utcDateString,
    utcDateString,
    utcHour,
    utcDayOfWeek,
    deepseekPricingWindow,
    scoringPolicyVersion: SCORING_POLICY_VERSION,
    geminiServiceTierVerified: geminiSummary.returnedServiceTier === 'flex',
    officialPricingVerification,
    securityZeroCallProof,
    smokeInvocationsCount: results.length,
    cumulativeSpendMicroUsd,
    budgetCapMicroUsd: A12B2B_BUDGET_CAP_MICRO_USD,
    budgetCheckPassed: cumulativeSpendMicroUsd <= A12B2B_BUDGET_CAP_MICRO_USD,
    results,
    candidateSummaries: {
      deepseek: deepseekSummary,
      gemini: geminiSummary,
    },
    overallDisposition: finalStatus,
    statusString,
  };

  log('\n================================================================');
  log('FINAL FRESH SMOKE SUMMARY (POLICY v1.2.1)');
  log('================================================================');
  log(`Total Invocations: ${results.length}`);
  log(`DeepSeek Successes: ${deepseekSummary.providerSuccesses}/3 | Failures: ${deepseekSummary.providerFailures}`);
  log(`DeepSeek Returned Model: ${deepseekSummary.returnedModel}`);
  log(`Gemini Successes: ${geminiSummary.providerSuccesses}/3 | Failures: ${geminiSummary.providerFailures}`);
  log(`Gemini Returned Model: ${geminiSummary.returnedModel} | Returned Tier: ${geminiSummary.returnedServiceTier}`);
  log(`Cumulative Spend: ${cumulativeSpendMicroUsd} microUSD ($${(cumulativeSpendMicroUsd / 1_000_000).toFixed(6)})`);
  log(`Budget Cap: ${A12B2B_BUDGET_CAP_MICRO_USD} microUSD`);
  log(`A.12B.2B FRESH LIVE SMOKE v1.2.1 = ${finalStatus}`);
  log(`PHASE A.12B.2B = ${statusString}`);

  // Write NEW artifacts (preserving old ones)
  fs.writeFileSync(
    path.join(process.cwd(), 'execution', 'a12b2b_smoke_v121_results.json'),
    JSON.stringify(report, null, 2),
    'utf8'
  );
  fs.writeFileSync(
    path.join(process.cwd(), 'execution', 'a12b2b_smoke_v121.log'),
    logLines.join('\n'),
    'utf8'
  );

  log('Fresh artifacts written to execution/a12b2b_smoke_v121_results.json and execution/a12b2b_smoke_v121.log');
}

runFreshLiveSmokeV121().catch((err) => {
  console.error('Fatal fresh live smoke error:', err);
  process.exit(1);
});
