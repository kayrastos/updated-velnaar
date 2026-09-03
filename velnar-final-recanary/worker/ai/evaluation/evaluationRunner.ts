/**
 * @file worker/ai/evaluation/evaluationRunner.ts
 * @description Deterministic Evaluation Runner & Aggregator for VELNAR AI Shadow Evaluation
 * 
 * ============================================================================
 * PRINCIPLES:
 * 1. PURE DETERMINISTIC AGGREGATION.
 * 2. STRICT CANDIDATE IDENTITY ENFORCEMENT (NO MIXED CANDIDATE BATCHES).
 * 3. STRICT DATASET INTEGRITY AT RUNNER BOUNDARY.
 * 4. REJECT DUPLICATE AND UNKNOWN CASE INPUTS.
 * 5. INTEGRATE EVALUATION SECURITY PREFLIGHT & SEPARATE SECURITY-BLOCKED CASES.
 * 6. ZERO NETWORK/FETCH/DB DEPENDENCIES.
 * ============================================================================
 */

import { TaskType } from '../types';
import {
  EvaluationCase,
  CandidateEvaluationInput,
  CandidateAggregateReport,
  CaseEvaluationResult,
  EvaluationScoringWeights,
  TaskTypeBreakdown,
} from './types';
import { EvaluationScorer, SCORING_POLICY_VERSION, DEFAULT_SCORING_WEIGHTS } from './evaluationScorer';
import { EvaluationSecurityGate } from './evaluationSecurity';

export class EvaluationRunner {
  /**
   * Validates dataset integrity before running evaluation.
   */
  public static validateDatasetIntegrity(dataset: EvaluationCase[]): void {
    if (!Array.isArray(dataset) || dataset.length === 0) {
      throw new Error('EVALUATION_DATASET_INTEGRITY_ERROR: Dataset must be a non-empty array of EvaluationCase.');
    }

    const seenIds = new Set<string>();
    const expectedVersion = dataset[0].datasetVersion;

    for (const item of dataset) {
      if (!item.id || typeof item.id !== 'string') {
        throw new Error('EVALUATION_DATASET_INTEGRITY_ERROR: EvaluationCase id must be a non-empty string.');
      }
      if (seenIds.has(item.id)) {
        throw new Error(`EVALUATION_DATASET_INTEGRITY_ERROR: Duplicate case ID detected: ${item.id}`);
      }
      seenIds.add(item.id);

      if (item.datasetVersion !== expectedVersion) {
        throw new Error(`EVALUATION_DATASET_INTEGRITY_ERROR: Dataset version mismatch on case ${item.id}. Expected ${expectedVersion}, got ${item.datasetVersion}`);
      }

      if (item.requestEnvelope.taskType !== item.taskType) {
        throw new Error(`EVALUATION_DATASET_INTEGRITY_ERROR: TaskType mismatch between case definition and requestEnvelope for case ${item.id}`);
      }

      if (item.requestEnvelope.dataClassification !== item.dataClassification) {
        throw new Error(`EVALUATION_DATASET_INTEGRITY_ERROR: DataClassification mismatch between case definition and requestEnvelope for case ${item.id}`);
      }
    }
  }

  /**
   * Validates candidate input batch consistency.
   */
  public static validateCandidateInputs(
    inputs: CandidateEvaluationInput[],
    validCaseIds: Set<string>
  ): void {
    if (!Array.isArray(inputs) || inputs.length === 0) {
      throw new Error('EVALUATION_INPUT_ERROR: Inputs must be a non-empty array of CandidateEvaluationInput.');
    }

    const firstCandidate = inputs[0].candidate;
    if (!firstCandidate || !firstCandidate.candidateId || !firstCandidate.providerId || !firstCandidate.modelIdentifier) {
      throw new Error('EVALUATION_CANDIDATE_IDENTITY_ERROR: Candidate must have valid candidateId, providerId, and modelIdentifier.');
    }

    const seenCaseIds = new Set<string>();

    for (const input of inputs) {
      if (!input.candidate) {
        throw new Error('EVALUATION_CANDIDATE_IDENTITY_ERROR: Missing candidate metadata on input.');
      }

      // Check candidate identity consistency
      if (
        input.candidate.candidateId !== firstCandidate.candidateId ||
        input.candidate.providerId !== firstCandidate.providerId ||
        input.candidate.modelIdentifier !== firstCandidate.modelIdentifier
      ) {
        throw new Error('EVALUATION_CANDIDATE_IDENTITY_MISMATCH: All candidate inputs in a batch must share identical candidateId, providerId, and modelIdentifier.');
      }

      // Check unknown case ID
      if (!validCaseIds.has(input.caseId)) {
        throw new Error(`EVALUATION_UNKNOWN_CASE_INPUT: Candidate input contains unknown caseId: ${input.caseId}`);
      }

      // Check duplicate input for same case ID
      if (seenCaseIds.has(input.caseId)) {
        throw new Error(`EVALUATION_DUPLICATE_CASE_INPUT: Duplicate candidate input provided for caseId: ${input.caseId}`);
      }
      seenCaseIds.add(input.caseId);
    }
  }

  /**
   * Runs evaluation on a full candidate batch against an evaluation dataset.
   */
  public static runBatch(
    dataset: EvaluationCase[],
    inputs: CandidateEvaluationInput[],
    weights: EvaluationScoringWeights = DEFAULT_SCORING_WEIGHTS
  ): CandidateAggregateReport {
    this.validateDatasetIntegrity(dataset);

    const validCaseIds = new Set(dataset.map((c) => c.id));
    this.validateCandidateInputs(inputs, validCaseIds);

    const firstInput = inputs[0];
    const candidateId = firstInput.candidate.candidateId;
    const providerId = firstInput.candidate.providerId;
    const modelIdentifier = firstInput.candidate.modelIdentifier;
    const datasetVersion = dataset[0].datasetVersion;

    const inputMap = new Map<string, CandidateEvaluationInput>();
    for (const input of inputs) {
      inputMap.set(input.caseId, input);
    }

    const caseResults: CaseEvaluationResult[] = [];
    const failedCaseIds: string[] = [];

    let datasetCasesTotal = dataset.length;
    let modelCasesEvaluated = 0;
    let securityBlockedCases = 0;
    let securityGateFailures = 0;

    let casesPassed = 0;
    let casesFailed = 0;
    let hardFails = 0;

    let qualitySumBps = 0;
    let schemaPassCount = 0;
    let groundingPassCount = 0;
    let privacyPassCount = 0;
    let hallucinationFreeCount = 0;
    let instructionFollowingPassCount = 0;
    let latencySumMs = 0;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalCostMicroUsd = 0;

    const taskAccumulators: Record<
      TaskType,
      { total: number; passed: number; qualitySum: number }
    > = {
      LEAD_INTENT_CLASSIFICATION: { total: 0, passed: 0, qualitySum: 0 },
      LEAK_EXPLANATION: { total: 0, passed: 0, qualitySum: 0 },
      GROWTH_ACTION_DRAFT: { total: 0, passed: 0, qualitySum: 0 },
      BUSINESS_TWIN_SUMMARY: { total: 0, passed: 0, qualitySum: 0 },
      FUNNEL_DIAGNOSTIC_EXPLANATION: { total: 0, passed: 0, qualitySum: 0 },
      SEO_CONTENT_SUGGESTION: { total: 0, passed: 0, qualitySum: 0 },
      ANOMALY_TRIAGE: { total: 0, passed: 0, qualitySum: 0 },
    };

    for (const evalCase of dataset) {
      // 1. Mandatory Security Preflight Evaluation
      const preparedCase = EvaluationSecurityGate.prepareEvaluationCase(evalCase);

      if (preparedCase.disposition === 'BLOCKED_BY_SECURITY') {
        securityBlockedCases++;
        // If a CandidateEvaluationInput exists for a case that canonical preflight says MUST NOT reach the external candidate:
        // the evaluation batch itself has a SECURITY INTEGRITY FAILURE.
        const input = inputMap.get(evalCase.id);
        if (input) {
          throw new Error(
            `EVALUATION_SECURITY_INTEGRITY_FAILURE: CandidateEvaluationInput supplied for security-blocked case ${evalCase.id} (${preparedCase.blockReason || 'BLOCKED_BY_SECURITY'})`
          );
        }
        continue;
      }

      // 2. Candidate Eligible Case
      const input = inputMap.get(evalCase.id);
      if (!input) {
        // Missing candidate evaluation input for an eligible case
        const emptyResult: CaseEvaluationResult = {
          caseId: evalCase.id,
          taskType: evalCase.taskType,
          promptVersion: preparedCase.promptVersion,
          passed: false,
          hardFail: true,
          hardFailReasons: ['PROVIDER_ERROR'],
          dimensionScores: {
            schemaCompliance: 0,
            evidenceGrounding: 0,
            hallucinationSafety: 0,
            privacySafety: 10000,
            taskCorrectness: 0,
            actionPolicyCompliance: 0,
            instructionFollowing: 0,
          },
          weightedQualityScoreBps: 0,
          hallucinationsDetected: [],
          latencyMs: 0,
          promptTokens: 0,
          completionTokens: 0,
          costMicroUsd: 0,
          errorDetails: 'MISSING_CANDIDATE_INPUT',
        };
        caseResults.push(emptyResult);
        failedCaseIds.push(evalCase.id);
        modelCasesEvaluated++;
        casesFailed++;
        hardFails++;
        taskAccumulators[evalCase.taskType].total++;
        continue;
      }

      modelCasesEvaluated++;
      const result = EvaluationScorer.scoreCase(preparedCase, input, weights);
      caseResults.push(result);

      if (result.passed) {
        casesPassed++;
      } else {
        casesFailed++;
        failedCaseIds.push(evalCase.id);
      }

      if (result.hardFail) {
        hardFails++;
      }

      qualitySumBps += result.weightedQualityScoreBps;
      if (result.dimensionScores.schemaCompliance === 10000) schemaPassCount++;
      if (result.dimensionScores.evidenceGrounding >= 7000) groundingPassCount++;
      if (result.dimensionScores.privacySafety === 10000) privacyPassCount++;
      if (result.dimensionScores.hallucinationSafety === 10000) hallucinationFreeCount++;
      if (result.dimensionScores.instructionFollowing >= 7000) instructionFollowingPassCount++;

      latencySumMs += result.latencyMs;
      totalPromptTokens += result.promptTokens;
      totalCompletionTokens += result.completionTokens;
      totalCostMicroUsd += result.costMicroUsd;

      taskAccumulators[evalCase.taskType].total++;
      if (result.passed) {
        taskAccumulators[evalCase.taskType].passed++;
      }
      taskAccumulators[evalCase.taskType].qualitySum += result.weightedQualityScoreBps;
    }

    const averageQualityBps =
      modelCasesEvaluated > 0 ? Math.round(qualitySumBps / modelCasesEvaluated) : 0;
    const schemaPassRateBps =
      modelCasesEvaluated > 0 ? Math.round((schemaPassCount / modelCasesEvaluated) * 10000) : 0;
    const groundingPassRateBps =
      modelCasesEvaluated > 0 ? Math.round((groundingPassCount / modelCasesEvaluated) * 10000) : 0;
    const privacyPassRateBps =
      modelCasesEvaluated > 0 ? Math.round((privacyPassCount / modelCasesEvaluated) * 10000) : 0;
    const hallucinationFreeRateBps =
      modelCasesEvaluated > 0 ? Math.round((hallucinationFreeCount / modelCasesEvaluated) * 10000) : 0;
    const instructionFollowingPassRateBps =
      modelCasesEvaluated > 0 ? Math.round((instructionFollowingPassCount / modelCasesEvaluated) * 10000) : 0;
    const averageLatencyMs =
      modelCasesEvaluated > 0 ? Math.round(latencySumMs / modelCasesEvaluated) : 0;

    const perTaskBreakdown: Record<TaskType, TaskTypeBreakdown> = {
      LEAD_INTENT_CLASSIFICATION: {
        casesTotal: taskAccumulators.LEAD_INTENT_CLASSIFICATION.total,
        casesPassed: taskAccumulators.LEAD_INTENT_CLASSIFICATION.passed,
        averageQualityBps:
          taskAccumulators.LEAD_INTENT_CLASSIFICATION.total > 0
            ? Math.round(
                taskAccumulators.LEAD_INTENT_CLASSIFICATION.qualitySum /
                  taskAccumulators.LEAD_INTENT_CLASSIFICATION.total
              )
            : 0,
      },
      LEAK_EXPLANATION: {
        casesTotal: taskAccumulators.LEAK_EXPLANATION.total,
        casesPassed: taskAccumulators.LEAK_EXPLANATION.passed,
        averageQualityBps:
          taskAccumulators.LEAK_EXPLANATION.total > 0
            ? Math.round(
                taskAccumulators.LEAK_EXPLANATION.qualitySum /
                  taskAccumulators.LEAK_EXPLANATION.total
              )
            : 0,
      },
      GROWTH_ACTION_DRAFT: {
        casesTotal: taskAccumulators.GROWTH_ACTION_DRAFT.total,
        casesPassed: taskAccumulators.GROWTH_ACTION_DRAFT.passed,
        averageQualityBps:
          taskAccumulators.GROWTH_ACTION_DRAFT.total > 0
            ? Math.round(
                taskAccumulators.GROWTH_ACTION_DRAFT.qualitySum /
                  taskAccumulators.GROWTH_ACTION_DRAFT.total
              )
            : 0,
      },
      BUSINESS_TWIN_SUMMARY: {
        casesTotal: taskAccumulators.BUSINESS_TWIN_SUMMARY.total,
        casesPassed: taskAccumulators.BUSINESS_TWIN_SUMMARY.passed,
        averageQualityBps:
          taskAccumulators.BUSINESS_TWIN_SUMMARY.total > 0
            ? Math.round(
                taskAccumulators.BUSINESS_TWIN_SUMMARY.qualitySum /
                  taskAccumulators.BUSINESS_TWIN_SUMMARY.total
              )
            : 0,
      },
      FUNNEL_DIAGNOSTIC_EXPLANATION: {
        casesTotal: taskAccumulators.FUNNEL_DIAGNOSTIC_EXPLANATION.total,
        casesPassed: taskAccumulators.FUNNEL_DIAGNOSTIC_EXPLANATION.passed,
        averageQualityBps:
          taskAccumulators.FUNNEL_DIAGNOSTIC_EXPLANATION.total > 0
            ? Math.round(
                taskAccumulators.FUNNEL_DIAGNOSTIC_EXPLANATION.qualitySum /
                  taskAccumulators.FUNNEL_DIAGNOSTIC_EXPLANATION.total
              )
            : 0,
      },
      SEO_CONTENT_SUGGESTION: {
        casesTotal: taskAccumulators.SEO_CONTENT_SUGGESTION.total,
        casesPassed: taskAccumulators.SEO_CONTENT_SUGGESTION.passed,
        averageQualityBps:
          taskAccumulators.SEO_CONTENT_SUGGESTION.total > 0
            ? Math.round(
                taskAccumulators.SEO_CONTENT_SUGGESTION.qualitySum /
                  taskAccumulators.SEO_CONTENT_SUGGESTION.total
              )
            : 0,
      },
      ANOMALY_TRIAGE: {
        casesTotal: taskAccumulators.ANOMALY_TRIAGE.total,
        casesPassed: taskAccumulators.ANOMALY_TRIAGE.passed,
        averageQualityBps:
          taskAccumulators.ANOMALY_TRIAGE.total > 0
            ? Math.round(
                taskAccumulators.ANOMALY_TRIAGE.qualitySum /
                  taskAccumulators.ANOMALY_TRIAGE.total
              )
            : 0,
      },
    };

    return {
      candidateId,
      providerId,
      modelIdentifier,
      datasetVersion,
      scoringPolicyVersion: SCORING_POLICY_VERSION,
      datasetCasesTotal,
      modelCasesEvaluated,
      securityBlockedCases,
      securityGateFailures,
      casesTotal: datasetCasesTotal,
      casesPassed,
      casesFailed,
      hardFails,
      averageQualityBps,
      schemaPassRateBps,
      groundingPassRateBps,
      privacyPassRateBps,
      hallucinationFreeRateBps,
      instructionFollowingPassRateBps,
      averageLatencyMs,
      totalPromptTokens,
      totalCompletionTokens,
      totalCostMicroUsd,
      perTaskBreakdown,
      failedCaseIds,
      caseResults,
    };
  }

  /**
   * Alias for runBatch to support evaluateCandidate calls.
   */
  public static evaluateCandidate(
    dataset: EvaluationCase[],
    inputs: CandidateEvaluationInput[],
    weights: EvaluationScoringWeights = DEFAULT_SCORING_WEIGHTS
  ): CandidateAggregateReport {
    return this.runBatch(dataset, inputs, weights);
  }
}

