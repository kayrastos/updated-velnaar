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

import { TaskType, AIProviderId } from './types';
import { WorkerEnv } from '../env';

export const VELNAR_ROUTING_POLICY_VERSION = 'a12b2c-v1' as const;

export type RoutingPolicyMode = 'LEGACY' | 'SHADOW';

export interface CertifiedCandidate {
  readonly candidateId: string;
  readonly provider: AIProviderId;
  readonly certifiedModel: string;
  readonly pricingTier: string;
  readonly reasoningEffort?: 'low' | 'none' | 'medium' | 'high';
}

export const CERTIFIED_CANDIDATES: Record<'DEEPSEEK_PRIMARY' | 'GEMINI_FALLBACK', CertifiedCandidate> = {
  DEEPSEEK_PRIMARY: {
    candidateId: 'deepseek-v4-flash-offpeak-low',
    provider: 'deepseek',
    certifiedModel: 'deepseek-v4-flash',
    pricingTier: 'offpeak',
    reasoningEffort: 'low',
  },
  GEMINI_FALLBACK: {
    candidateId: 'gemini-3.5-flash-lite-flex-low',
    provider: 'gemini',
    certifiedModel: 'gemini-3.5-flash-lite',
    pricingTier: 'flex-low',
    reasoningEffort: 'low',
  },
} as const;

export interface ProviderRuntimeCompatibility {
  readonly provider: AIProviderId;
  readonly profileParityStatus: 'PROFILE_PARITY_REQUIRED' | 'PROFILE_PARITY_VERIFIED';
  readonly tierSupportGaps: readonly string[];
  readonly knownLimitations: readonly string[];
}

export interface RuntimeCompatibilityReport {
  readonly deepseek: ProviderRuntimeCompatibility;
  readonly gemini: ProviderRuntimeCompatibility;
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
 * Returns current runtime compatibility and profile parity gaps.
 */
export function getRuntimeCompatibilityReport(): RuntimeCompatibilityReport {
  return {
    deepseek: {
      provider: 'deepseek',
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
 * Always returns enforcementAllowed: false in Phase A.12B.2C-2A.
 */
export function resolveRoutingPolicyDecision(
  taskType: TaskType,
  env?: WorkerEnv
): RoutingPolicyDecision {
  const mode = resolveRoutingPolicyMode(env);
  const meta = TASK_DECISION_METADATA[taskType] || {
    confidence: 'MEDIUM' as const,
    reasonCodes: ['DEFAULT_CERTIFIED_BENCHMARK_POLICY'],
  };

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
    runtimeCompatibility: getRuntimeCompatibilityReport(),
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
