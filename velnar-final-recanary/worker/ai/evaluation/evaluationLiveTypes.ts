/**
 * @file worker/ai/evaluation/evaluationLiveTypes.ts
 * @description Type definitions and pricing contracts for Phase A.12B.2B Controlled Live Shadow Evaluation
 */

import { TaskType, DataClassification, AIProviderId } from '../types';
import { EvaluationScoreDimensions, EvaluationHardFailReason, HallucinationCategory } from './types';

export const A12B2B_PRICING_CATALOG_VERSION = '2026-08-31-v1';
export const A12B2B_BUDGET_CAP_MICRO_USD = 5000000; // $5.00 USD hard cap
export const A12B2B_MAX_OUTPUT_TOKENS_BOUND = 2048; // Documented safe output bound for canonical VELNAR schemas
export const A12B2B_WORST_CASE_INPUT_TOKENS_BOUND = 4000; // Conservative prompt input token upper bound
export const A12B2B_CERTIFICATION_MAX_INPUT_TOKENS_BOUND = 4000; // Supported certification max input tokens bound (fail-closed if exceeded)
export const A12B2B_MAX_SUPPORTED_INPUT_BOUND = 4000; // Alias for certification max input tokens bound

export type LiveCandidateId =
  | 'deepseek-v4-flash-offpeak-low'
  | 'gemini-3.5-flash-lite-flex-low';

export type LiveServiceProfile =
  | 'OFF_PEAK_COST_OPTIMIZED'
  | 'FLEX_COST_OPTIMIZED';

export type UsageSource = 'PROVIDER_REPORTED' | 'ESTIMATED' | 'UNAVAILABLE';

export type PricingWindow = 'OFF_PEAK' | 'PEAK';

export interface LiveCandidateConfig {
  candidateId: LiveCandidateId;
  providerId: AIProviderId;
  requestedModelIdentifier: string;
  serviceProfile: LiveServiceProfile;
  thinkingEffort: 'low';
  serviceTier?: 'flex' | 'standard';
}

export interface DeepSeekPricingRate {
  offPeakCacheHitMicroUsdPer1M: number;    // $0.007 / 1M = 7000 microUSD
  offPeakCacheMissMicroUsdPer1M: number;   // $0.22 / 1M = 220000 microUSD
  offPeakOutputMicroUsdPer1M: number;      // $0.66 / 1M = 660000 microUSD
  peakCacheHitMicroUsdPer1M: number;       // $0.014 / 1M = 14000 microUSD
  peakCacheMissMicroUsdPer1M: number;      // $0.44 / 1M = 440000 microUSD
  peakOutputMicroUsdPer1M: number;         // $1.32 / 1M = 1320000 microUSD
}

export interface GeminiPricingRate {
  standardInputMicroUsdPer1M: number;      // $0.30 / 1M = 300000 microUSD
  standardOutputMicroUsdPer1M: number;     // $2.50 / 1M = 2500000 microUSD (includes thinking)
  flexInputMicroUsdPer1M: number;          // $0.15 / 1M = 150000 microUSD
  flexOutputMicroUsdPer1M: number;         // $1.25 / 1M = 1250000 microUSD (includes thinking)
}

export interface LiveEvaluationResultRecord {
  runProtocolVersion: string;
  datasetVersion: string;
  scoringPolicyVersion: string;
  pricingCatalogVersion: string;
  caseId: string;
  taskType: TaskType;
  replicateIndex: 1 | 2;
  invocationOrdinal: number;
  candidateId: LiveCandidateId;
  providerId: AIProviderId;
  requestedModelIdentifier: string;
  returnedModelIdentifier?: string;
  providerModelVersion?: string;
  conservativeInputTokenUpperBound?: number;
  serviceProfile: LiveServiceProfile;
  thinkingEffort: 'low';
  promptVersion: string;
  originalDataClassification: DataClassification;
  effectiveDataClassification: DataClassification;
  securityDisposition: 'ELIGIBLE' | 'BLOCKED_BY_SECURITY';
  requestStartedAt: string; // UTC ISO
  pricingWindow: PricingWindow;
  latencyMs: number;
  attemptCount: number;
  usageSource: UsageSource;
  returnedServiceTier?: string;
  cacheStatus?: 'NOT_VERIFIED' | 'VERIFIED';
  promptTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  completionTokens: number;
  thinkingTokens: number;
  totalTokens: number;
  actualCostMicroUsd: number;
  normalizedCostMicroUsd: number; // e.g. cold-cache or standard tier
  dimensionScores: EvaluationScoreDimensions;
  totalScoreBp: number;
  passed: boolean;
  hardFail: boolean;
  hardFailReasons: EvaluationHardFailReason[];
  hallucinationsDetected: HallucinationCategory[];
  providerErrorCategory?: string;
  parsedOutput?: any;
  rawTextHash?: string; // SHA-256 of raw response text
}

export type ParetoClassification = 'PARETO_FRONTIER' | 'PARETO_DOMINATED';

export interface TaskTypeEvaluationSummary {
  uniqueCaseCount: number;
  invocationCount: number;
  casesTotal: number; // alias for invocationCount for backwards compatibility
  casesPassed: number;
  passCount: number; // explicit alias for passing invocations
  hardFails: number;
  hardFailCount: number;
  providerSuccess: number;
  providerSuccessRateBps: number;
  validJsonCount: number;
  validJsonRateBps: number;
  passRateBps: number;
  hardFailRateBps: number;
  meanScoreBps: number;
  meanScoreSuccessfulScorableOutputs: number;
  medianScoreBps: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  actualCostMicroUsd: number;
  normalizedCostMicroUsd: number;
  replicateInstabilityRateBps: number;
}

export interface CandidateLiveSummary {
  candidateId: LiveCandidateId;
  providerId: AIProviderId;
  requestedModelIdentifier: string;
  serviceProfile: LiveServiceProfile;
  totalInvocations: number;
  successfulInvocations: number;
  providerErrors: number;
  validJsonRateBps: number;
  providerSuccessRateBps: number;
  passRateBps: number;
  allInvocationPassRateBps: number;
  hardFailRateBps: number;
  meanScoreBps: number;
  meanScoreSuccessfulScorableOutputs: number;
  medianScoreBps: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  meanLatencyMs: number;
  totalPromptTokens: number;
  totalCacheHitTokens: number;
  totalCacheMissTokens: number;
  totalCompletionTokens: number;
  totalThinkingTokens: number;
  totalTokens: number;
  cacheHitRatioBps: number;
  actualTotalCostMicroUsd: number;
  normalizedTotalCostMicroUsd: number;
  costPerPassingCaseMicroUsd: number;
  costPerPassingInvocationMicroUsd: number;
  costPerSuccessfulInvocationMicroUsd: number;
  unstableCaseCount: number;
  instabilityRateBps: number;
  perTaskBreakdown: Record<TaskType, TaskTypeEvaluationSummary>;
}

export interface ParetoAnalysisResult {
  dimensions: {
    qualityMeanScoreBps: {
      deepseek: number;
      gemini: number;
      leader: 'deepseek' | 'gemini' | 'TIE';
    };
    passRateBps: {
      deepseek: number;
      gemini: number;
      leader: 'deepseek' | 'gemini' | 'TIE';
    };
    hardFailRateBps: {
      deepseek: number;
      gemini: number;
      leader: 'deepseek' | 'gemini' | 'TIE';
    };
    p50LatencyMs: {
      deepseek: number;
      gemini: number;
      leader: 'deepseek' | 'gemini' | 'TIE';
    };
    actualCostMicroUsd: {
      deepseek: number;
      gemini: number;
      leader: 'deepseek' | 'gemini' | 'TIE';
    };
    replicateInstabilityRateBps: {
      deepseek: number;
      gemini: number;
      leader: 'deepseek' | 'gemini' | 'TIE';
    };
  };
  frontierClassification: {
    deepseek: ParetoClassification;
    gemini: ParetoClassification;
    mathematicalProof: {
      deepseekDominatedByGemini: boolean;
      geminiDominatedByDeepSeek: boolean;
    };
  };
}

export interface LiveEvaluationCheckpoint {
  runId: string;
  executionStartTimestamp: string;
  datasetVersion: string;
  scoringPolicyVersion: string;
  pricingWindow: PricingWindow;
  expectedInvocationCount: number;
  lastCompletedInvocationOrdinal: number;
  completedResults: LiveEvaluationResultRecord[];
  cumulativeSpendMicroUsd: number;
  runCompleted: boolean;
}

export interface CostOptimizationAnalysis {
  deepseek: {
    officialOffPeakWindowVerified: boolean;
    pricingCatalogVersion: string;
    offPeakCacheHitRateMicroUsdPer1M: number;
    offPeakCacheMissRateMicroUsdPer1M: number;
    offPeakOutputRateMicroUsdPer1M: number;
    totalCacheHitTokens: number;
    totalCacheMissTokens: number;
    cacheHitRatioBps: number;
    actualOffPeakCostMicroUsd: number;
    coldCacheOffPeakCostMicroUsd: number;
    coldCachePeakCostMicroUsd: number;
    realizedCacheSavingBps: number;
    realizedOffPeakSavingBps: number;
    combinedRealizedSavingBps: number;
    specificDiscountedTokenSegment: string;
  };
  gemini: {
    flexTierConfirmed: boolean;
    pricingCatalogVersion: string;
    flexInputRateMicroUsdPer1M: number;
    flexOutputRateMicroUsdPer1M: number;
    standardInputRateMicroUsdPer1M: number;
    standardOutputRateMicroUsdPer1M: number;
    actualFlexCostMicroUsd: number;
    normalizedStandardCostMicroUsd: number;
    realizedFlexSavingBps: number;
    cacheStatus: 'NOT_VERIFIED' | 'VERIFIED';
  };
}
