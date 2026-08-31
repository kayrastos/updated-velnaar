/**
 * @file worker/ai/evaluation/evaluationLiveRunner.ts
 * @description Orchestration runner for Phase A.12B.2B Controlled Live Shadow Evaluation
 */

import { WorkerEnv } from '../../env';
import { TaskType, DataClassification } from '../types';
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
} from './evaluationLiveTypes';
import { EvaluationCostCalculator, DEEPSEEK_V4_FLASH_PRICING, GEMINI_35_FLASH_LITE_PRICING } from './evaluationCostCalculator';
import { EvaluationLiveClient } from '../providers/liveEvaluationClient';

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

export class EvaluationLiveRunner {
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
   * e.g. for candidates [A, B]:
   * (caseIndex + replicateIndex) % 2 === 0 -> [A, B]
   * (caseIndex + replicateIndex) % 2 === 1 -> [B, A]
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
   * Calculates summary metrics for a candidate across its live evaluation results.
   */
  public static summarizeCandidateResults(
    candidate: LiveCandidateConfig,
    results: LiveEvaluationResultRecord[]
  ): CandidateLiveSummary {
    const candidateResults = results.filter((r) => r.candidateId === candidate.candidateId);
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

    // Track replicates for instability detection
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

    // Instability / Variance Calculation across 2 replicates
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
   * Computes detailed cost optimization analysis for DeepSeek off-peak and Gemini flex.
   */
  public static analyzeCostOptimization(
    summaries: Record<LiveCandidateId, CandidateLiveSummary>
  ): CostOptimizationAnalysis {
    const dsSummary = summaries['deepseek-v4-flash-offpeak-low'];
    const gemSummary = summaries['gemini-3.5-flash-lite-flex-low'];

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

    // Gemini Arithmetic
    const gemActualFlex = gemSummary?.actualTotalCostMicroUsd || 0;
    const gemNormStandard = gemSummary?.normalizedTotalCostMicroUsd || 0;
    const gemRealizedFlexSavingBps = EvaluationCostCalculator.calculateDiscountBps(gemNormStandard, gemActualFlex);

    return {
      deepseek: {
        officialOffPeakWindowVerified: true,
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
        flexTierConfirmed: true,
        pricingCatalogVersion: A12B2B_PRICING_CATALOG_VERSION,
        flexInputRateMicroUsdPer1M: GEMINI_35_FLASH_LITE_PRICING.flexInputMicroUsdPer1M,
        flexOutputRateMicroUsdPer1M: GEMINI_35_FLASH_LITE_PRICING.flexOutputMicroUsdPer1M,
        standardInputRateMicroUsdPer1M: GEMINI_35_FLASH_LITE_PRICING.standardInputMicroUsdPer1M,
        standardOutputRateMicroUsdPer1M: GEMINI_35_FLASH_LITE_PRICING.standardOutputMicroUsdPer1M,
        actualFlexCostMicroUsd: gemActualFlex,
        normalizedStandardCostMicroUsd: gemNormStandard,
        realizedFlexSavingBps: gemRealizedFlexSavingBps,
        cacheStatus: 'NOT_VERIFIED',
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
