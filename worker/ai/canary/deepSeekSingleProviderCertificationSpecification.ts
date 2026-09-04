/**
 * @file worker/ai/canary/deepSeekSingleProviderCertificationSpecification.ts
 * @description VELNAR — A.12B.2C-5F DeepSeek-Only Successor Certification Contract.
 * 
 * STRICT ARCHITECTURAL CONSTRAINTS:
 * - PURE / OFFLINE specification only.
 * - ZERO DeepSeek calls.
 * - ZERO Gemini calls.
 * - ZERO provider credentials.
 * - ZERO external network calls.
 * - ZERO live canary execution.
 * - ZERO human authorization generation.
 * - ZERO production routing enforcement.
 * - Does NOT modify BoundedCanaryRunner.
 * - Does NOT modify current CANARY_SPECIFICATION_VERSION (a12b2c5-v1.2).
 */

import { CERTIFIED_A12B2C_TASK_TYPES } from '../providers/certifiedProviderTypes';
import { CANARY_SYNTHETIC_FIXTURES } from './canarySpecification';
import { PromptRegistry } from '../promptRegistry';
import type { TaskType } from '../types';

// ============================================================================
// 1. SPECIFICATION METADATA & STATUS
// ============================================================================

export const SUCCESSOR_SPECIFICATION_VERSION = 'a12b2c5-v1.3-draft' as const;
export type SuccessorSpecificationVersion = typeof SUCCESSOR_SPECIFICATION_VERSION;

export const ACTIVATION_STATUS = 'OFFLINE_DRAFT_NOT_LIVE' as const;
export type ActivationStatus = typeof ACTIVATION_STATUS;

export const CURRENT_ACTIVE_TECHNICAL_SPEC = 'a12b2c5-v1.2' as const;
export const CURRENT_STRATEGY = 'DEEPSEEK_FIRST_SINGLE_PROVIDER_V1' as const;

// ============================================================================
// 2. PROVIDER & MODEL IDENTIFICATION
// ============================================================================

export const CERTIFICATION_PROVIDER = 'deepseek' as const;
export const CERTIFICATION_MODEL = 'deepseek-v4-flash' as const;
export const DOCUMENTED_VERSION_TARGET = 'DeepSeek-V4-Flash-0731' as const;

export const BASE_URL = 'https://api.deepseek.com' as const;
export const ENDPOINT = 'https://api.deepseek.com/v1/chat/completions' as const;

export const THINKING_SUPPORTED = 'ENABLED' as const;
export const REASONING_EFFORT = 'low' as const;
export const MAX_TOKENS = 2048 as const;
export const CONCURRENCY_LIMIT = 1 as const;

export const GEMINI_CURRENT_STATUS = 'DORMANT_UNSELECTED_PROVIDER' as const;

// ============================================================================
// 3. CANDIDATES (SAME MODEL, TWO PRICING WINDOWS)
// ============================================================================

export const OFF_PEAK_CANDIDATE = 'deepseek-v4-flash-offpeak-low' as const;
export const PEAK_CANDIDATE = 'deepseek-v4-flash-peak-low' as const;

export interface SuccessorCanaryCandidate {
  readonly candidateId: string;
  readonly providerId: 'deepseek';
  readonly requestedModelIdentifier: 'deepseek-v4-flash';
  readonly expectedReturnedModelIdentifier: 'deepseek-v4-flash';
  readonly documentedVersionTarget: 'DeepSeek-V4-Flash-0731';
  readonly pricingWindow: 'OFF_PEAK' | 'PEAK';
  readonly reasoningEffort: 'low';
  readonly maxTokens: 2048;
  readonly concurrency: 1;
}

export const SUCCESSOR_CANDIDATES: readonly SuccessorCanaryCandidate[] = [
  {
    candidateId: OFF_PEAK_CANDIDATE,
    providerId: CERTIFICATION_PROVIDER,
    requestedModelIdentifier: CERTIFICATION_MODEL,
    expectedReturnedModelIdentifier: CERTIFICATION_MODEL,
    documentedVersionTarget: DOCUMENTED_VERSION_TARGET,
    pricingWindow: 'OFF_PEAK',
    reasoningEffort: REASONING_EFFORT,
    maxTokens: MAX_TOKENS,
    concurrency: CONCURRENCY_LIMIT,
  },
  {
    candidateId: PEAK_CANDIDATE,
    providerId: CERTIFICATION_PROVIDER,
    requestedModelIdentifier: CERTIFICATION_MODEL,
    expectedReturnedModelIdentifier: CERTIFICATION_MODEL,
    documentedVersionTarget: DOCUMENTED_VERSION_TARGET,
    pricingWindow: 'PEAK',
    reasoningEffort: REASONING_EFFORT,
    maxTokens: MAX_TOKENS,
    concurrency: CONCURRENCY_LIMIT,
  },
] as const;

// ============================================================================
// 4. MODEL PROVENANCE CONTRACT
// ============================================================================

export const SYSTEM_FINGERPRINT_IS_MODEL_VERSION = false;
export const FINGERPRINT_COMPARED_TO_DOCUMENTED_VERSION_TARGET = false;

export interface ModelProvenanceVerificationInput {
  requestedModelIdentifier: string;
  returnedModelIdentifier: string;
  systemFingerprint?: string | null;
  providerReportedModelVersion?: string | null;
}

export interface ModelProvenanceVerificationResult {
  isValid: boolean;
  exactModelMatch: boolean;
  documentedVersionTarget: string;
  providerReportedBackendFingerprint: string | null;
  providerReportedModelVersion: string | null;
  systemFingerprintIsModelVersion: boolean;
  fingerprintComparedToDocumentedVersionTarget: boolean;
  failureReason?: string;
}

export const MODEL_PROVENANCE_CONTRACT = {
  requestedModelIdentifier: CERTIFICATION_MODEL,
  returnedModelIdentifier: CERTIFICATION_MODEL,
  documentedVersionTarget: DOCUMENTED_VERSION_TARGET,
  systemFingerprintIsModelVersion: SYSTEM_FINGERPRINT_IS_MODEL_VERSION,
  fingerprintComparedToDocumentedVersionTarget: FINGERPRINT_COMPARED_TO_DOCUMENTED_VERSION_TARGET,
  exactMatchRequired: true,
} as const;

/**
 * Validates DeepSeek response model provenance.
 * Invariant: system_fingerprint is opaque backend configuration telemetry,
 * NOT a model version, and MUST NEVER be compared to DOCUMENTED_VERSION_TARGET.
 */
export function verifyModelProvenance(
  input: ModelProvenanceVerificationInput
): ModelProvenanceVerificationResult {
  const exactModelMatch =
    input.requestedModelIdentifier === CERTIFICATION_MODEL &&
    input.returnedModelIdentifier === CERTIFICATION_MODEL;

  const backendFingerprint = input.systemFingerprint ?? null;
  const reportedVersion = input.providerReportedModelVersion ?? null;

  let failureReason: string | undefined;
  if (!exactModelMatch) {
    failureReason = `MODEL_PROVENANCE_MISMATCH: requested '${input.requestedModelIdentifier}', returned '${input.returnedModelIdentifier}'`;
  }

  return {
    isValid: exactModelMatch,
    exactModelMatch,
    documentedVersionTarget: DOCUMENTED_VERSION_TARGET,
    providerReportedBackendFingerprint: backendFingerprint,
    providerReportedModelVersion: reportedVersion,
    systemFingerprintIsModelVersion: false,
    fingerprintComparedToDocumentedVersionTarget: false,
    failureReason,
  };
}

// ============================================================================
// 5. OFFICIAL PRICING CONTRACT
// ============================================================================

export interface TokenPricingRate {
  readonly cacheHitInputUsdPerMillion: number;
  readonly cacheMissInputUsdPerMillion: number;
  readonly outputUsdPerMillion: number;
  readonly cacheHitInputMicroUsdPerMillion: number;
  readonly cacheMissInputMicroUsdPerMillion: number;
  readonly outputMicroUsdPerMillion: number;
}

export const DEEPSEEK_OFF_PEAK_PRICING: TokenPricingRate = {
  cacheHitInputUsdPerMillion: 0.007,
  cacheMissInputUsdPerMillion: 0.22,
  outputUsdPerMillion: 0.66,
  cacheHitInputMicroUsdPerMillion: 7000,
  cacheMissInputMicroUsdPerMillion: 220000,
  outputMicroUsdPerMillion: 660000,
} as const;

export const DEEPSEEK_PEAK_PRICING: TokenPricingRate = {
  cacheHitInputUsdPerMillion: 0.014,
  cacheMissInputUsdPerMillion: 0.44,
  outputUsdPerMillion: 1.32,
  cacheHitInputMicroUsdPerMillion: 14000,
  cacheMissInputMicroUsdPerMillion: 440000,
  outputMicroUsdPerMillion: 1320000,
} as const;

// Verification invariant: PEAK == exactly 2 × OFF_PEAK across all dimensions
export const PRICING_INVARIANTS = {
  peakCacheHitMultiplier:
    DEEPSEEK_PEAK_PRICING.cacheHitInputMicroUsdPerMillion /
    DEEPSEEK_OFF_PEAK_PRICING.cacheHitInputMicroUsdPerMillion,
  peakCacheMissMultiplier:
    DEEPSEEK_PEAK_PRICING.cacheMissInputMicroUsdPerMillion /
    DEEPSEEK_OFF_PEAK_PRICING.cacheMissInputMicroUsdPerMillion,
  peakOutputMultiplier:
    DEEPSEEK_PEAK_PRICING.outputMicroUsdPerMillion /
    DEEPSEEK_OFF_PEAK_PRICING.outputMicroUsdPerMillion,
  isExactTwoX: true,
} as const;

// ============================================================================
// 6. PRICING WINDOW DETERMINATION
// ============================================================================

export interface PeakWindowIntervalUtc {
  readonly startHour: number;
  readonly endHour: number;
}

export const PEAK_WINDOW_INTERVALS_UTC: readonly PeakWindowIntervalUtc[] = [
  { startHour: 1, endHour: 4 },   // 01:00 <= UTC < 04:00
  { startHour: 6, endHour: 10 },  // 06:00 <= UTC < 10:00
] as const;

export function getPricingWindow(date: Date = new Date()): 'PEAK' | 'OFF_PEAK' {
  const day = date.getUTCDay(); // 0 = Sunday, 1 = Monday, ..., 5 = Friday, 6 = Saturday
  // Monday (1) through Friday (5) only
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

// ============================================================================
// 7. TWO SEPARATE CERTIFICATION PROGRAMS
// ============================================================================

export interface CertificationProgramDefinition {
  readonly programId: string;
  readonly candidateId: string;
  readonly pricingWindow: 'OFF_PEAK' | 'PEAK';
  readonly canonicalTaskCount: 7;
  readonly plannedDirectDeepSeekCalls: 7;
  readonly clientRetries: 0;
  readonly crossProviderFallbacks: 0;
  readonly automaticReruns: 0;
  readonly clientConcurrency: 1;
  readonly humanAuthorizationStatus: 'NOT_GRANTED';
  readonly futureBudgetCeilingMicroUsd: 'PENDING_HUMAN_APPROVAL';
  readonly requiresSeparateNonce: true;
  readonly requiresSeparateSourceBinding: true;
  readonly requiresSeparateEvidenceArtifact: true;
}

export const OFF_PEAK_PROGRAM: CertificationProgramDefinition = {
  programId: 'DEEPSEEK_OFF_PEAK_SINGLE_PROVIDER_RESEAL',
  candidateId: OFF_PEAK_CANDIDATE,
  pricingWindow: 'OFF_PEAK',
  canonicalTaskCount: 7,
  plannedDirectDeepSeekCalls: 7,
  clientRetries: 0,
  crossProviderFallbacks: 0,
  automaticReruns: 0,
  clientConcurrency: 1,
  humanAuthorizationStatus: 'NOT_GRANTED',
  futureBudgetCeilingMicroUsd: 'PENDING_HUMAN_APPROVAL',
  requiresSeparateNonce: true,
  requiresSeparateSourceBinding: true,
  requiresSeparateEvidenceArtifact: true,
} as const;

export const PEAK_PROGRAM: CertificationProgramDefinition = {
  programId: 'DEEPSEEK_PEAK_SINGLE_PROVIDER_CERTIFICATION',
  candidateId: PEAK_CANDIDATE,
  pricingWindow: 'PEAK',
  canonicalTaskCount: 7,
  plannedDirectDeepSeekCalls: 7,
  clientRetries: 0,
  crossProviderFallbacks: 0,
  automaticReruns: 0,
  clientConcurrency: 1,
  humanAuthorizationStatus: 'NOT_GRANTED',
  futureBudgetCeilingMicroUsd: 'PENDING_HUMAN_APPROVAL',
  requiresSeparateNonce: true,
  requiresSeparateSourceBinding: true,
  requiresSeparateEvidenceArtifact: true,
} as const;

export const COMBINED_LIVE_RUN_AUTHORIZED = false as const;

// ============================================================================
// 8. INTERACTIVE SLO & RETRY POLICIES
// ============================================================================

export const INTERACTIVE_TIMEOUT_MS = 15000 as const;
export const SAME_PROVIDER_RETRIES = 0 as const;
export const CROSS_PROVIDER_FALLBACKS = 0 as const;
export const AUTOMATIC_RERUNS = 0 as const;

export const QUALITY_GATES = {
  httpSuccessRequired: true,
  schemaValidRequired: true,
  providerReportedUsageRequired: true,
  requestedReturnedModelProvenanceExact: true,
  taskPassRequired: true,
  noPrivacyViolation: true,
  noUnexpectedEndpoint: true,
  noTelemetryFabrication: true,
  aggregateSemanticScoreThreshold: 0.85,
  requiredTaskCount: 7,
} as const;

// ============================================================================
// 9. COST PREFLIGHT ARITHMETIC (7 CANONICAL TASKS)
// ============================================================================

export interface TaskCostPreflightRecord {
  readonly taskType: TaskType;
  readonly fixtureId: string;
  readonly estimatedInputTokenUpperBound: number;
  readonly offPeakInputWorstCaseMicroUsd: number;
  readonly offPeakOutputWorstCaseMicroUsd: number;
  readonly offPeakTotalWorstCaseMicroUsd: number;
  readonly peakInputWorstCaseMicroUsd: number;
  readonly peakOutputWorstCaseMicroUsd: number;
  readonly peakTotalWorstCaseMicroUsd: number;
}

/**
 * Calculates conservative UTF-8 byte length of the constructed prompt.
 * Guaranteed to be >= actual token count.
 */
export function calculateConservativeInputUpperBound(taskType: TaskType): {
  fixtureId: string;
  byteLength: number;
} {
  const fixture = CANARY_SYNTHETIC_FIXTURES[taskType];
  const promptDef = PromptRegistry.getPrompt(taskType);
  const systemPrompt = promptDef.systemPrompt;
  const userPrompt = promptDef.buildUserPrompt(fixture.requestEnvelope);
  const combined = `${systemPrompt}\n${userPrompt}`;
  return {
    fixtureId: fixture.id,
    byteLength: Buffer.byteLength(combined, 'utf8'),
  };
}

/**
 * Deterministic cost preflight calculation for the 7 canonical tasks.
 * Uses ceiling arithmetic and preserves PEAK = exactly 2 × OFF_PEAK invariant.
 */
export function computeCanonicalTasksCostPreflight(): {
  taskRecords: readonly TaskCostPreflightRecord[];
  offPeakSevenCallWorstCaseMicroUsd: number;
  peakSevenCallWorstCaseMicroUsd: number;
  isExactTwoX: boolean;
} {
  const maxOutputTokens = MAX_TOKENS; // 2048
  const offPeakRates = DEEPSEEK_OFF_PEAK_PRICING;

  // Output worst-case cost per call in microUSD
  const offPeakOutputWorstCase = Math.ceil(
    (maxOutputTokens * offPeakRates.outputMicroUsdPerMillion) / 1000000
  ); // Math.ceil(2048 * 660000 / 1000000) = 1352
  const peakOutputWorstCase = 2 * offPeakOutputWorstCase; // 2704

  const records: TaskCostPreflightRecord[] = [];
  let totalOffPeak = 0;
  let totalPeak = 0;

  for (const taskType of CERTIFIED_A12B2C_TASK_TYPES) {
    const { fixtureId, byteLength: estimatedInput } = calculateConservativeInputUpperBound(taskType);

    // Off-peak input worst case: 100% cache-miss at $0.22/1M tokens
    const offPeakInputCost = Math.ceil(
      (estimatedInput * offPeakRates.cacheMissInputMicroUsdPerMillion) / 1000000
    );
    const offPeakTotal = offPeakInputCost + offPeakOutputWorstCase;

    // Peak worst case: exactly 2x off-peak rate across all dimensions.
    // Guaranteed to be >= true peak cost (never rounds downward).
    const peakInputCost = 2 * offPeakInputCost;
    const peakTotal = peakInputCost + peakOutputWorstCase;

    totalOffPeak += offPeakTotal;
    totalPeak += peakTotal;

    records.push({
      taskType,
      fixtureId,
      estimatedInputTokenUpperBound: estimatedInput,
      offPeakInputWorstCaseMicroUsd: offPeakInputCost,
      offPeakOutputWorstCaseMicroUsd: offPeakOutputWorstCase,
      offPeakTotalWorstCaseMicroUsd: offPeakTotal,
      peakInputWorstCaseMicroUsd: peakInputCost,
      peakOutputWorstCaseMicroUsd: peakOutputWorstCase,
      peakTotalWorstCaseMicroUsd: peakTotal,
    });
  }

  return {
    taskRecords: records,
    offPeakSevenCallWorstCaseMicroUsd: totalOffPeak,
    peakSevenCallWorstCaseMicroUsd: totalPeak,
    isExactTwoX: totalPeak === 2 * totalOffPeak,
  };
}

export const CANONICAL_COST_PREFLIGHT = computeCanonicalTasksCostPreflight();

// Human Budget Status: STRICTLY NOT_GRANTED in 5F
export const HUMAN_BUDGET_STATUS = {
  offPeakHumanAuthorization: 'NOT_GRANTED' as const,
  peakHumanAuthorization: 'NOT_GRANTED' as const,
  offPeakFutureBudgetCeilingMicroUsd: 'PENDING_HUMAN_APPROVAL' as const,
  peakFutureBudgetCeilingMicroUsd: 'PENDING_HUMAN_APPROVAL' as const,
};

// ============================================================================
// 10. SUCCESS STATUS MODEL
// ============================================================================

export type OffPeakCertificationResult =
  | 'DEEPSEEK_OFF_PEAK_CERTIFIED'
  | 'DEEPSEEK_OFF_PEAK_FAILED_CLOSED'
  | 'DEEPSEEK_OFF_PEAK_INCOMPLETE';

export type PeakCertificationResult =
  | 'DEEPSEEK_PEAK_CERTIFIED'
  | 'DEEPSEEK_PEAK_FAILED_CLOSED'
  | 'DEEPSEEK_PEAK_INCOMPLETE';

export type OverallV1ProviderState =
  | 'DEEPSEEK_V1_ALL_WINDOWS_CERTIFIED'
  | 'OFF_PEAK_ONLY_CERTIFIED'
  | 'PEAK_ONLY_CERTIFIED'
  | 'UNCERTIFIED';

export function resolveOverallV1ProviderState(
  offPeakResult?: OffPeakCertificationResult,
  peakResult?: PeakCertificationResult
): OverallV1ProviderState {
  if (offPeakResult === 'DEEPSEEK_OFF_PEAK_CERTIFIED' && peakResult === 'DEEPSEEK_PEAK_CERTIFIED') {
    return 'DEEPSEEK_V1_ALL_WINDOWS_CERTIFIED';
  }
  if (offPeakResult === 'DEEPSEEK_OFF_PEAK_CERTIFIED') {
    return 'OFF_PEAK_ONLY_CERTIFIED';
  }
  if (peakResult === 'DEEPSEEK_PEAK_CERTIFIED') {
    return 'PEAK_ONLY_CERTIFIED';
  }
  return 'UNCERTIFIED';
}

// ============================================================================
// 11. FUTURE ACTIVATION SAFETY INVARIANT
// ============================================================================

export const FUTURE_ACTIVATION_SAFETY_REQUIREMENT = {
  mandatoryRequirement:
    'Future runner MUST NOT rely on a hard-coded specification string like CANARY_SPECIFICATION_VERSION === "a12b2c5-v1.2". Future activation architecture must use an authoritative policy such as liveExecutionEnabled: false or equivalent fail-closed certification state. Version bumps must NEVER automatically remove the live block.',
  versionIndependentLiveGateRequired: true,
  implementedInPhase5F: false,
} as const;

// ============================================================================
// 12. COMPREHENSIVE SUCCESSOR SPECIFICATION OBJECT
// ============================================================================

export const DEEPSEEK_SUCCESSOR_CERTIFICATION_SPECIFICATION = {
  successorSpecificationVersion: SUCCESSOR_SPECIFICATION_VERSION,
  activationStatus: ACTIVATION_STATUS,
  currentActiveTechnicalSpec: CURRENT_ACTIVE_TECHNICAL_SPEC,
  currentStrategy: CURRENT_STRATEGY,
  provider: CERTIFICATION_PROVIDER,
  model: CERTIFICATION_MODEL,
  documentedVersion: DOCUMENTED_VERSION_TARGET,
  baseUrl: BASE_URL,
  endpoint: ENDPOINT,
  thinking: THINKING_SUPPORTED,
  reasoningEffort: REASONING_EFFORT,
  maxOutputTokens: MAX_TOKENS,
  concurrencyLimit: CONCURRENCY_LIMIT,
  interactiveTimeoutMs: INTERACTIVE_TIMEOUT_MS,
  geminiStatus: GEMINI_CURRENT_STATUS,
  candidates: SUCCESSOR_CANDIDATES,
  offPeakCandidate: OFF_PEAK_CANDIDATE,
  peakCandidate: PEAK_CANDIDATE,
  modelProvenanceContract: MODEL_PROVENANCE_CONTRACT,
  pricing: {
    offPeak: DEEPSEEK_OFF_PEAK_PRICING,
    peak: DEEPSEEK_PEAK_PRICING,
    invariants: PRICING_INVARIANTS,
  },
  programs: {
    offPeak: OFF_PEAK_PROGRAM,
    peak: PEAK_PROGRAM,
    combinedLiveRunAuthorized: COMBINED_LIVE_RUN_AUTHORIZED,
  },
  costPreflight: CANONICAL_COST_PREFLIGHT,
  humanBudget: HUMAN_BUDGET_STATUS,
  futureActivationSafetyRequirement: FUTURE_ACTIVATION_SAFETY_REQUIREMENT,
  securityInvariants: {
    zeroDeepSeekCalls: true,
    zeroGeminiCalls: true,
    zeroProviderCredentials: true,
    zeroExternalNetworkCalls: true,
    providerNetworkCalls: 0,
    productionRoutingEnforcementAllowed: false,
    currentLiveBlockPreserved: true,
  },
} as const;

export type DeepSeekSuccessorCertificationSpecification =
  typeof DEEPSEEK_SUCCESSOR_CERTIFICATION_SPECIFICATION;
