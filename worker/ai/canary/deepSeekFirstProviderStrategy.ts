/**
 * @file worker/ai/canary/deepSeekFirstProviderStrategy.ts
 * @description Phase A.12B.2C-5E DeepSeek-First Single-Provider Strategy Specification.
 * 
 * STRICT ARCHITECTURAL CONSTRAINTS:
 * - PURE/OFFLINE specification only.
 * - ZERO fetch or network calls.
 * - ZERO environment credentials resolution or mutations.
 * - ZERO provider adapter calls.
 * - ZERO production routing mutations (productionRoutingEnforcementAllowed remains strictly false).
 * - Enforces DEEPSEEK_FIRST_SINGLE_PROVIDER_V1 strategy.
 */

export const STRATEGY_ID = 'DEEPSEEK_FIRST_SINGLE_PROVIDER_V1' as const;
export type StrategyId = typeof STRATEGY_ID;

export const ACTIVE_PREFERRED_PROVIDER = 'deepseek' as const;
export const ACTIVE_PREFERRED_MODEL = 'deepseek-v4-flash' as const;
export const DOCUMENTED_VERSION = 'DeepSeek-V4-Flash-0731' as const;

export const BASE_URL = 'https://api.deepseek.com' as const;
export const OPENAI_ENDPOINT = 'https://api.deepseek.com/v1/chat/completions' as const;

export const THINKING_SUPPORTED = true as const;
export const VELNAR_CURRENT_EFFORT = 'low' as const;
export const VELNAR_OUTPUT_BOUND = 2048 as const;
export const CONCURRENCY_LIMIT = 2500 as const;

export const INTERACTIVE_TIMEOUT_MS = 15000 as const;
export const CROSS_PROVIDER_FALLBACK_ENABLED = false as const;

/**
 * Gemini Strategic Status under A.12B.2C-5E:
 * Existing code, parsers, and artifacts are preserved for historical reproducibility
 * and dormant cold-standby knowledge, but Gemini is NOT active primary, fallback,
 * canary pair, or routing target.
 */
export const GEMINI_CURRENT_STATUS = 'DORMANT_UNSELECTED_PROVIDER' as const;
export type GeminiStrategicStatus = typeof GEMINI_CURRENT_STATUS;

export const OFF_PEAK_CANDIDATE = 'deepseek-v4-flash-offpeak-low' as const;
export const PEAK_CANDIDATE = 'deepseek-v4-flash-peak-low' as const;

export const OFF_PEAK_CERTIFICATION_STATUS = 'EXISTING_EVIDENCE_REQUIRES_SINGLE_PROVIDER_RESEAL' as const;
export const PEAK_CERTIFICATION_STATUS = 'REQUIRED' as const;

export const BACKGROUND_PREFERRED_PROVIDER = 'deepseek' as const;
export const BACKGROUND_PREFERRED_WINDOW = 'OFF_PEAK' as const;
export const BACKGROUND_PEAK_BEHAVIOR = 'DEFER_WHEN_SAFE' as const;

export interface TokenPricingPerMillionUsd {
  readonly cacheHitInputUsd: number;
  readonly cacheMissInputUsd: number;
  readonly outputUsd: number;
}

export const DEEPSEEK_OFF_PEAK_PRICING: TokenPricingPerMillionUsd = {
  cacheHitInputUsd: 0.007,
  cacheMissInputUsd: 0.22,
  outputUsd: 0.66,
} as const;

export const DEEPSEEK_PEAK_PRICING: TokenPricingPerMillionUsd = {
  cacheHitInputUsd: 0.014,
  cacheMissInputUsd: 0.44,
  outputUsd: 1.32,
} as const;

export interface PeakWindowIntervalUtc {
  readonly startHour: number;
  readonly endHour: number;
}

export const PEAK_WINDOW_INTERVALS_UTC: readonly PeakWindowIntervalUtc[] = [
  { startHour: 1, endHour: 4 },   // 01:00–04:00 UTC
  { startHour: 6, endHour: 10 },  // 06:00–10:00 UTC
] as const;

export const PEAK_DAYS_UTC = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] as const;

/**
 * Pure helper to classify a given UTC Date into PEAK or OFF_PEAK pricing window.
 * Monday-Friday: 01:00-04:00 UTC and 06:00-10:00 UTC are PEAK.
 * All other intervals (including weekends) are OFF_PEAK.
 */
export function getPricingWindow(date: Date = new Date()): 'PEAK' | 'OFF_PEAK' {
  const day = date.getUTCDay(); // 0 is Sunday, 6 is Saturday
  // Monday (1) to Friday (5)
  if (day >= 1 && day <= 5) {
    const hours = date.getUTCHours();
    for (const interval of PEAK_WINDOW_INTERVALS_UTC) {
      if (hours >= interval.startHour && hours < interval.endHour) {
        return 'PEAK';
      }
    }
  }
  return 'OFF_PEAK';
}

export function isPeakWindow(date: Date = new Date()): boolean {
  return getPricingWindow(date) === 'PEAK';
}

/**
 * Triggers that authorize future model re-evaluation comparison.
 * The default position is: KEEP DEEPSEEK UNTIL EVIDENCE JUSTIFIES RE-EVALUATION.
 */
export const FUTURE_MODEL_RE_EVALUATION_POLICY = {
  defaultPosition: 'KEEP_DEEPSEEK_UNTIL_EVIDENCE_JUSTIFIES_RE_EVALUATION',
  continuousComparisonAuthorized: false,
  authorizedTriggers: [
    'MATERIALLY_STRONGER_MODEL_RELEASED',
    'DEEPSEEK_QUALITY_REGRESSION',
    'DEEPSEEK_RELIABILITY_UNACCEPTABLE',
    'DEEPSEEK_AVAILABILITY_DEGRADATION',
    'PRICING_MATERIALLY_WORSE',
    'UNSATISFIED_WORKLOAD_REQUIREMENT',
    'REGULATORY_GEOGRAPHIC_CUSTOMER_REQUIREMENT',
    'CLEAR_STRATEGIC_ADVANTAGE_DEMONSTRATED',
  ],
} as const;

/**
 * Provider Outage Handling Policy
 */
export const PROVIDER_OUTAGE_POLICY = {
  secondProviderFallbackRequired: false,
  interactive: {
    behavior: 'FAIL_CLOSED',
    fabricateOutput: false,
    silentUncertifiedRoute: false,
    returnControlledUnavailableState: true,
    explicitClientRetryPermitted: true,
  },
  background: {
    behavior: 'QUEUE_JOB',
    deferWhenSafe: true,
    boundedRetryPolicyDefinedSeparately: true,
    preserveIdempotency: true,
    resumeWhenAvailable: true,
  },
} as const;

/**
 * Rate Limit / Quota Exhaustion Policy
 */
export const RATE_LIMIT_POLICY = {
  concurrencyLimit: CONCURRENCY_LIMIT,
  crossProviderFallback: false,
  sameProviderBoundedRetryStatus: 'REQUIRES_SEPARATE_CERTIFICATION',
} as const;

/**
 * Historical Decision Supersession Record
 */
export const HISTORICAL_DECISION_SUPERSEDED = {
  decision: 'C_SPLIT_INTERACTIVE_AND_BACKGROUND_TIERS',
  status: 'PRESERVED_HISTORICAL_EVIDENCE',
  reason: 'Explains why Gemini Flex was removed from the interactive path. Not deleted; superseded by DEEPSEEK_FIRST_SINGLE_PROVIDER_V1.',
} as const;

/**
 * Future Single-Provider Certification Program Specification
 * (DEFINED SPECIFICATION ONLY - NOT AUTHORIZED OR EXECUTED)
 */
export const FUTURE_CERTIFICATION_PLAN = {
  humanAuthorizationStatus: 'NOT_GRANTED',
  liveAuthorizationGranted: false,
  mixedProviderMatrixRequired: false, // 14-call mixed matrix is historical only
  stepA: {
    id: 'DEEPSEEK_OFF_PEAK_SINGLE_PROVIDER_RESEAL',
    provider: ACTIVE_PREFERRED_PROVIDER,
    targetWindow: 'OFF_PEAK',
    canonicalTaskCount: 7,
    plannedDirectCalls: 7,
    crossProviderFallbackCalls: 0,
    humanAuthorizationRequired: true,
    authorizationGranted: false,
  },
  stepB: {
    id: 'DEEPSEEK_PEAK_SINGLE_PROVIDER_CERTIFICATION',
    provider: ACTIVE_PREFERRED_PROVIDER,
    targetWindow: 'PEAK',
    canonicalTaskCount: 7,
    plannedDirectCalls: 7,
    crossProviderFallbackCalls: 0,
    humanAuthorizationRequired: true,
    authorizationGranted: false,
  },
} as const;

/**
 * Comprehensive DeepSeek-First Single-Provider Strategy Seal
 */
export const DEEPSEEK_FIRST_PROVIDER_STRATEGY = {
  strategyId: STRATEGY_ID,
  activePreferredProvider: ACTIVE_PREFERRED_PROVIDER,
  activePreferredModel: ACTIVE_PREFERRED_MODEL,
  documentedVersion: DOCUMENTED_VERSION,
  baseUrl: BASE_URL,
  openAiEndpoint: OPENAI_ENDPOINT,
  thinkingSupported: THINKING_SUPPORTED,
  velnarCurrentEffort: VELNAR_CURRENT_EFFORT,
  velnarOutputBound: VELNAR_OUTPUT_BOUND,
  concurrencyLimit: CONCURRENCY_LIMIT,
  interactiveTimeoutMs: INTERACTIVE_TIMEOUT_MS,
  crossProviderFallbackEnabled: CROSS_PROVIDER_FALLBACK_ENABLED,
  geminiCurrentStatus: GEMINI_CURRENT_STATUS,
  offPeakCandidate: OFF_PEAK_CANDIDATE,
  peakCandidate: PEAK_CANDIDATE,
  offPeakCertificationStatus: OFF_PEAK_CERTIFICATION_STATUS,
  peakCertificationStatus: PEAK_CERTIFICATION_STATUS,
  offPeakCertificationRequired: true,
  peakCertificationRequired: true,
  backgroundPreferredProvider: BACKGROUND_PREFERRED_PROVIDER,
  backgroundPreferredWindow: BACKGROUND_PREFERRED_WINDOW,
  backgroundPeakBehavior: BACKGROUND_PEAK_BEHAVIOR,
  pricing: {
    offPeak: DEEPSEEK_OFF_PEAK_PRICING,
    peak: DEEPSEEK_PEAK_PRICING,
    peakMultiplierVsOffPeak: 2.0,
  },
  peakWindows: {
    days: PEAK_DAYS_UTC,
    intervalsUtc: PEAK_WINDOW_INTERVALS_UTC,
  },
  futureCertification: FUTURE_CERTIFICATION_PLAN,
  reEvaluationPolicy: FUTURE_MODEL_RE_EVALUATION_POLICY,
  outagePolicy: PROVIDER_OUTAGE_POLICY,
  rateLimitPolicy: RATE_LIMIT_POLICY,
  historicalSupersession: HISTORICAL_DECISION_SUPERSEDED,
  securityInvariants: {
    zeroProviderCalls: true,
    zeroProviderCredentials: true,
    liveAuthorizationGranted: false,
    providerNetworkCalls: 0,
    productionRoutingEnforcementAllowed: false,
  },
} as const;

export type DeepSeekFirstProviderStrategy = typeof DEEPSEEK_FIRST_PROVIDER_STRATEGY;
