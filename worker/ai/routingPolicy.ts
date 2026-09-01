/**
 * @file worker/ai/routingPolicy.ts
 * @description Offline Sealed Routing Policy Decision Scaffolding (a12b2c-v1) in SHADOW Mode Only
 * 
 * ============================================================================
 * PRINCIPLES & CONSTRAINTS:
 * 1. VERSION: VELNAR_ROUTING_POLICY_VERSION = "a12b2c-v1"
 * 2. ROUTING MODES: LEGACY and SHADOW only. Missing/invalid env mode defaults to LEGACY.
 * 3. ENFORCEMENT: enforcementAllowed MUST ALWAYS = false in this phase.
 * 4. CERTIFIED CANDIDATES:
 *    - DeepSeek: candidateId = 'deepseek-v4-flash-offpeak-low', provider = 'deepseek', model = 'deepseek-v4-flash'
 *    - Gemini: candidateId = 'gemini-3.5-flash-lite-flex-low', provider = 'gemini', model = 'gemini-3.5-flash-lite'
 * 5. CERTIFIED TASKS: All 7 canonical task types recommend DeepSeek primary / Gemini fallback.
 * 6. ZERO KIMI / FULGOR: Kimi and Fulgor are NOT part of the a12b2c-v1 certified routing policy.
 * 7. ZERO PROVIDER MODIFICATIONS: Adapter code is untouched in this phase.
 * 8. ZERO LIVE CALLS: Routing decisions are pure, offline, and deterministic.
 * ============================================================================
 */

import { TaskType, AIProviderId, RoutingTier, DataClassification } from './types';
import { WorkerEnv } from '../env';

export const VELNAR_ROUTING_POLICY_VERSION = 'a12b2c-v1' as const;

export type RoutingPolicyMode = 'LEGACY' | 'SHADOW';

// Provider-specific certified profile definitions
export interface DeepSeekCertifiedProfile {
  readonly candidateId: 'deepseek-v4-flash-offpeak-low';
  readonly provider: 'deepseek';
  readonly certifiedModel: 'deepseek-v4-flash';
  readonly reasoningEnabled: true;
  readonly reasoningEffort: 'low';
  readonly pricingWindow: 'offpeak';
}

export interface GeminiCertifiedProfile {
  readonly candidateId: 'gemini-3.5-flash-lite-flex-low';
  readonly provider: 'gemini';
  readonly certifiedModel: 'gemini-3.5-flash-lite';
  readonly apiFamily: 'interactions';
  readonly serviceTier: 'flex';
  readonly thinkingLevel: 'low';
}

export type CertifiedCandidateProfile = DeepSeekCertifiedProfile | GeminiCertifiedProfile;

export const DEEPSEEK_CERTIFIED_PROFILE: DeepSeekCertifiedProfile = {
  candidateId: 'deepseek-v4-flash-offpeak-low',
  provider: 'deepseek',
  certifiedModel: 'deepseek-v4-flash',
  reasoningEnabled: true,
  reasoningEffort: 'low',
  pricingWindow: 'offpeak',
} as const;

export const GEMINI_CERTIFIED_PROFILE: GeminiCertifiedProfile = {
  candidateId: 'gemini-3.5-flash-lite-flex-low',
  provider: 'gemini',
  certifiedModel: 'gemini-3.5-flash-lite',
  apiFamily: 'interactions',
  serviceTier: 'flex',
  thinkingLevel: 'low',
} as const;

export const CERTIFIED_CANDIDATES = {
  DEEPSEEK_PRIMARY: DEEPSEEK_CERTIFIED_PROFILE,
  GEMINI_FALLBACK: GEMINI_CERTIFIED_PROFILE,
} as const;

// Fallback Contract Specification Metadata
export type AllowedFallbackTrigger =
  | 'HTTP_429'
  | 'HTTP_500'
  | 'HTTP_502'
  | 'HTTP_503'
  | 'HTTP_504'
  | 'NETWORK_TRANSPORT_FAILURE'
  | 'PROVIDER_UNAVAILABLE'
  | 'TIER_UNAVAILABLE'
  | 'PRICING_PREFLIGHT_UNAVAILABLE';

export type ProhibitedFallbackTrigger =
  | 'LOW_SEMANTIC_SCORE'
  | 'POST_HOC_EVALUATOR_REJECTION'
  | 'UNSATISFACTORY_ACCEPTED_OUTPUT';

export interface FallbackContractMetadata {
  readonly version: typeof VELNAR_ROUTING_POLICY_VERSION;
  readonly allowedTriggers: readonly AllowedFallbackTrigger[];
  readonly prohibitedTriggers: readonly ProhibitedFallbackTrigger[];
}

export const A12B2C_FALLBACK_CONTRACT: FallbackContractMetadata = {
  version: VELNAR_ROUTING_POLICY_VERSION,
  allowedTriggers: [
    'HTTP_429',
    'HTTP_500',
    'HTTP_502',
    'HTTP_503',
    'HTTP_504',
    'NETWORK_TRANSPORT_FAILURE',
    'PROVIDER_UNAVAILABLE',
    'TIER_UNAVAILABLE',
    'PRICING_PREFLIGHT_UNAVAILABLE',
  ],
  prohibitedTriggers: [
    'LOW_SEMANTIC_SCORE',
    'POST_HOC_EVALUATOR_REJECTION',
    'UNSATISFACTORY_ACCEPTED_OUTPUT',
  ],
} as const;

// Explicit Compatibility States
export type RuntimeCompatibilityState =
  | 'COMPATIBLE'
  | 'PROVIDER_NOT_ALLOWED'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'DATA_CLASSIFICATION_UNSUPPORTED'
  | 'TIER_CAPABILITY_REQUIRED'
  | 'PROFILE_PARITY_REQUIRED'
  | 'PEAK_POLICY_UNRESOLVED';

export interface ProviderRuntimeCompatibility {
  readonly provider: AIProviderId;
  readonly compatibilityStates: readonly RuntimeCompatibilityState[];
  readonly profileParityStatus: 'PROFILE_PARITY_REQUIRED' | 'PROFILE_PARITY_VERIFIED';
  readonly tierSupportGaps: readonly string[];
  readonly knownLimitations: readonly string[];
}

export interface RuntimeCompatibilityReport {
  readonly deepseek: ProviderRuntimeCompatibility;
  readonly gemini: ProviderRuntimeCompatibility;
}

export interface RoutingPolicyResolutionContext {
  readonly taskType: TaskType;
  readonly routingTier?: RoutingTier;
  readonly effectiveDataClassification?: DataClassification;
  readonly allowedProviders?: readonly AIProviderId[];
  readonly configuredProviders?: {
    readonly gemini: boolean;
    readonly deepseek: boolean;
    readonly kimi?: boolean;
  };
  readonly routingPolicyMode?: RoutingPolicyMode;
  readonly env?: WorkerEnv;
}

export interface RoutingPolicyDecision {
  readonly routingPolicyVersion: typeof VELNAR_ROUTING_POLICY_VERSION;
  readonly mode: RoutingPolicyMode;
  readonly taskType: TaskType;
  readonly recommendedPrimaryCandidate: string;
  readonly recommendedFallbackCandidate: string;
  readonly recommendedPrimaryProvider: AIProviderId;
  readonly recommendedFallbackProvider: AIProviderId;
  readonly recommendationConfidence: 'HIGH' | 'MEDIUM';
  readonly decisionReasonCodes: readonly string[];
  readonly runtimeCompatibility: RuntimeCompatibilityReport;
  readonly fallbackContract: FallbackContractMetadata;
  readonly peakPolicyStatus: 'PEAK_POLICY_UNRESOLVED';
  readonly enforcementAllowed: false; // MUST ALWAYS be false in phase A.12B.2C-2A
}

export interface ShadowTelemetryEvent {
  readonly event: 'AI_ROUTING_POLICY_SHADOW';
  readonly routingPolicyVersion: typeof VELNAR_ROUTING_POLICY_VERSION;
  readonly taskType: TaskType;
  readonly recommendedPrimaryCandidate: string;
  readonly recommendedFallbackCandidate: string;
  readonly actualLegacyCandidateOrder: readonly AIProviderId[];
  readonly decisionReasonCodes: readonly string[];
  readonly runtimeCompatibility: RuntimeCompatibilityReport;
  readonly peakPolicyStatus: 'PEAK_POLICY_UNRESOLVED';
}

/**
 * Task-specific canonical decision reason codes and confidence derived from A.12B.2C benchmark evidence.
 */
const TASK_DECISION_METADATA: Record<
  TaskType,
  {
    readonly confidence: 'HIGH' | 'MEDIUM';
    readonly reasonCodes: readonly string[];
  }
> = {
  LEAD_INTENT_CLASSIFICATION: {
    confidence: 'MEDIUM',
    reasonCodes: [
      'TIED_SAFETY_AND_PASS_RATE_100_BPS',
      'DEEPSEEK_LATENCY_ADVANTAGE_P50_8X',
      'DEEPSEEK_LOWER_NORMALIZED_COST_27_PCT',
    ],
  },
  LEAK_EXPLANATION: {
    confidence: 'MEDIUM',
    reasonCodes: [
      'TIED_PASS_RATE_100_BPS',
      'DEEPSEEK_LATENCY_ADVANTAGE_P50_8_6X',
      'DEEPSEEK_LOWER_NORMALIZED_COST_19_PCT',
      'SUPERIOR_INSPECTION_METRIC_ATTRIBUTION',
    ],
  },
  GROWTH_ACTION_DRAFT: {
    confidence: 'MEDIUM',
    reasonCodes: [
      'TIED_PASS_RATE_100_BPS',
      'DEEPSEEK_LATENCY_ADVANTAGE_P50_11X',
      'DEEPSEEK_LOWER_NORMALIZED_COST_36_PCT',
      'ZERO_REPLICATE_VARIANCE',
    ],
  },
  BUSINESS_TWIN_SUMMARY: {
    confidence: 'MEDIUM',
    reasonCodes: [
      'TIED_PASS_RATE_7500_BPS',
      'TIED_HARD_FAILS_COUNT_2',
      'DEEPSEEK_LATENCY_ADVANTAGE_P50_11_7X',
      'DEEPSEEK_LOWER_NORMALIZED_COST_59_PCT',
    ],
  },
  FUNNEL_DIAGNOSTIC_EXPLANATION: {
    confidence: 'HIGH',
    reasonCodes: [
      'DEEPSEEK_SUPERIOR_PASS_RATE_9000_VS_6000_BPS',
      'DEEPSEEK_FEWER_HARD_FAILS_1_VS_4',
      'GEMINI_INJECTION_SCHEMA_FAILURES',
      'DEEPSEEK_SEMANTIC_QUALITY_LEAD_PLUS_780_BPS',
      'DEEPSEEK_LATENCY_ADVANTAGE_P50_7_9X',
    ],
  },
  SEO_CONTENT_SUGGESTION: {
    confidence: 'MEDIUM',
    reasonCodes: [
      'TIED_PASS_RATE_7500_BPS',
      'TIED_HARD_FAILS_COUNT_2',
      'DEEPSEEK_QUALITY_LEAD_PLUS_175_BPS',
      'DEEPSEEK_LATENCY_ADVANTAGE_P50_7_7X',
    ],
  },
  ANOMALY_TRIAGE: {
    confidence: 'MEDIUM',
    reasonCodes: [
      'TIED_PASS_RATE_8750_BPS',
      'TIED_HARD_FAILS_COUNT_1',
      'TIED_MEAN_SCORE_9450_BPS',
      'DEEPSEEK_LATENCY_ADVANTAGE_P50_9_4X',
      'DEEPSEEK_LOWER_NORMALIZED_COST_60_PCT',
    ],
  },
};

/**
 * Resolves the active routing policy mode from environment variables.
 * Defaults strictly to 'LEGACY' if missing, undefined, or invalid.
 */
export function resolveRoutingPolicyMode(env?: WorkerEnv): RoutingPolicyMode {
  if (!env || !env.VELNAR_AI_ROUTING_POLICY_MODE) {
    return 'LEGACY';
  }

  const rawMode = String(env.VELNAR_AI_ROUTING_POLICY_MODE).trim().toLowerCase();
  if (rawMode === 'shadow') {
    return 'SHADOW';
  }

  // Any other string or 'legacy' defaults strictly to 'LEGACY'
  return 'LEGACY';
}

/**
 * Returns context-aware runtime compatibility and profile parity reports for candidates.
 */
export function getRuntimeCompatibilityReport(
  context?: Partial<RoutingPolicyResolutionContext>
): RuntimeCompatibilityReport {
  const allowedProviders = context?.allowedProviders;
  const configuredProviders = context?.configuredProviders;
  const dataClassification = context?.effectiveDataClassification;
  const routingTier = context?.routingTier;

  // DeepSeek compatibility state evaluation
  const deepSeekStates: RuntimeCompatibilityState[] = [];

  if (allowedProviders && !allowedProviders.includes('deepseek')) {
    deepSeekStates.push('PROVIDER_NOT_ALLOWED');
  }

  if (configuredProviders && configuredProviders.deepseek === false) {
    deepSeekStates.push('PROVIDER_NOT_CONFIGURED');
  }

  if (
    dataClassification &&
    dataClassification !== 'PUBLIC_BUSINESS' &&
    dataClassification !== 'PSEUDONYMOUS_OPERATIONAL'
  ) {
    deepSeekStates.push('DATA_CLASSIFICATION_UNSUPPORTED');
  }

  if (routingTier === 'REASONING' || routingTier === 'LONG_CONTEXT') {
    deepSeekStates.push('TIER_CAPABILITY_REQUIRED');
  }

  // Certified DeepSeek profile requirement
  deepSeekStates.push('PROFILE_PARITY_REQUIRED');
  deepSeekStates.push('PEAK_POLICY_UNRESOLVED');

  // Gemini compatibility state evaluation
  const geminiStates: RuntimeCompatibilityState[] = [];

  if (allowedProviders && !allowedProviders.includes('gemini')) {
    geminiStates.push('PROVIDER_NOT_ALLOWED');
  }

  if (configuredProviders && configuredProviders.gemini === false) {
    geminiStates.push('PROVIDER_NOT_CONFIGURED');
  }

  if (
    dataClassification &&
    dataClassification !== 'PUBLIC_BUSINESS' &&
    dataClassification !== 'PSEUDONYMOUS_OPERATIONAL'
  ) {
    geminiStates.push('DATA_CLASSIFICATION_UNSUPPORTED');
  }

  // Certified Gemini Flex profile requirement
  geminiStates.push('PROFILE_PARITY_REQUIRED');

  return {
    deepseek: {
      provider: 'deepseek',
      compatibilityStates: deepSeekStates,
      profileParityStatus: 'PROFILE_PARITY_REQUIRED',
      tierSupportGaps: ['REASONING', 'LONG_CONTEXT'],
      knownLimitations: [
        'Certified profile is deepseek-v4-flash-offpeak-low.',
        'Production DeepSeek adapter requires profile parity update before live candidate invocation.',
        'Peak-period runtime routing policy is UNRESOLVED.',
      ],
    },
    gemini: {
      provider: 'gemini',
      compatibilityStates: geminiStates,
      profileParityStatus: 'PROFILE_PARITY_REQUIRED',
      tierSupportGaps: [],
      knownLimitations: [
        'Certified profile is gemini-3.5-flash-lite-flex-low with Interactions API Flex Low tier.',
        'Current production adapter requires Flex Low profile parity configuration before live parity.',
      ],
    },
  };
}

/**
 * Deterministic pure resolver for routing policy decisions.
 * Accepts either a context object or taskType.
 * Always returns enforcementAllowed: false in Phase A.12B.2C-2A.
 */
export function resolveRoutingPolicyDecision(
  contextOrTaskType: RoutingPolicyResolutionContext | TaskType,
  envParam?: WorkerEnv
): RoutingPolicyDecision {
  const context: RoutingPolicyResolutionContext =
    typeof contextOrTaskType === 'string'
      ? {
          taskType: contextOrTaskType,
          env: envParam,
        }
      : contextOrTaskType;

  const mode = context.routingPolicyMode || resolveRoutingPolicyMode(context.env || envParam);
  const taskType = context.taskType;
  const meta = TASK_DECISION_METADATA[taskType] || {
    confidence: 'MEDIUM' as const,
    reasonCodes: ['DEFAULT_CERTIFIED_BENCHMARK_POLICY'],
  };

  const runtimeCompatibility = getRuntimeCompatibilityReport(context);

  return {
    routingPolicyVersion: VELNAR_ROUTING_POLICY_VERSION,
    mode,
    taskType,
    recommendedPrimaryCandidate: CERTIFIED_CANDIDATES.DEEPSEEK_PRIMARY.candidateId,
    recommendedFallbackCandidate: CERTIFIED_CANDIDATES.GEMINI_FALLBACK.candidateId,
    recommendedPrimaryProvider: CERTIFIED_CANDIDATES.DEEPSEEK_PRIMARY.provider,
    recommendedFallbackProvider: CERTIFIED_CANDIDATES.GEMINI_FALLBACK.provider,
    recommendationConfidence: meta.confidence,
    decisionReasonCodes: meta.reasonCodes,
    runtimeCompatibility,
    fallbackContract: A12B2C_FALLBACK_CONTRACT,
    peakPolicyStatus: 'PEAK_POLICY_UNRESOLVED',
    enforcementAllowed: false,
  };
}

/**
 * Builds safe structured shadow telemetry event.
 * NEVER includes prompts, responses, PII, secrets, or API keys.
 */
export function buildShadowTelemetryEvent(
  decision: RoutingPolicyDecision,
  actualLegacyCandidateOrder: readonly AIProviderId[]
): ShadowTelemetryEvent {
  return {
    event: 'AI_ROUTING_POLICY_SHADOW',
    routingPolicyVersion: decision.routingPolicyVersion,
    taskType: decision.taskType,
    recommendedPrimaryCandidate: decision.recommendedPrimaryCandidate,
    recommendedFallbackCandidate: decision.recommendedFallbackCandidate,
    actualLegacyCandidateOrder,
    decisionReasonCodes: decision.decisionReasonCodes,
    runtimeCompatibility: decision.runtimeCompatibility,
    peakPolicyStatus: decision.peakPolicyStatus,
  };
}
