/**
 * @file worker/ai/canary/canarySpecification.ts
 * @description Formal specification, safety envelopes, kill-switch invariants, and approval contracts for Phase A.12B.2C-5 Bounded Canary.
 * 
 * STRICT CONSTRAINTS:
 * - Read-first, fail-closed specification.
 * - Categorically prohibits live network calls during Phase A.12B.2C-5A.
 * - Requires explicit human approval token for any future Phase A.12B.2C-5B live execution.
 * - Keeps enforcementAllowed strictly false in production routing.
 */

import * as crypto from 'crypto';
import { TaskType, DataClassification } from '../types';
import {
  CERTIFIED_A12B2C_TASK_TYPES,
  CertifiedProviderId,
  isCertifiedA12B2CTaskType,
} from '../providers/certifiedProviderTypes';
import {
  VELNAR_SHADOW_EVAL_V1,
} from '../evaluation/evaluationDataset';
import { EvaluationCase } from '../evaluation/types';

export const CANARY_SPECIFICATION_VERSION = 'a12b2c5-v1.2';

// ============================================================================
// AUTHORITATIVE LIVE EXECUTION POLICY (PHASE A.12B.2C-5G)
// ============================================================================

/**
 * Authoritative fail-closed policy flag for live canary execution.
 * 
 * INVARIANT: Must remain strictly `false` pending explicit future certification.
 * Version-independent: Does NOT derive enablement from specification version strings
 * or caller-controlled indicators (phase, lane, approval, environment).
 */
export const CANARY_LIVE_EXECUTION_ENABLED = false as const;

export const CANARY_LIVE_EXECUTION_STATE =
  'BLOCKED_PENDING_CERTIFICATION' as const;

export const CANARY_AUTHORITATIVE_LIVE_POLICY = {
  liveExecutionEnabled: CANARY_LIVE_EXECUTION_ENABLED,
  liveExecutionState: CANARY_LIVE_EXECUTION_STATE,
  defaultDisabled: true,
  environmentControlled: false,
  requestControlled: false,
  approvalControlled: false,
  phaseControlled: false,
  laneControlled: false,
  specificationVersionControlled: false,
  runtimeMutable: false,
  processEnvOverride: false,
  cliOverride: false,
  testOnlyBypass: false,
  providerCredentialDependency: false,
} as const;

/**
 * Execution Lanes for Canary Specification v1.2
 * ARCHITECTURAL DECISION: C_SPLIT_INTERACTIVE_AND_BACKGROUND_TIERS
 */
export type CanaryExecutionLane = 'INTERACTIVE' | 'BACKGROUND_ECONOMY';

export interface CanaryInteractiveLaneSpec {
  readonly lane: 'INTERACTIVE';
  readonly workloadType: 'SYNCHRONOUS_USER_FACING';
  readonly hardLifecycleTimeoutMs: 15000;
  readonly flexAllowed: false;
  readonly primaryCandidateId: 'deepseek-v4-flash-offpeak-low';
  readonly certifiedFallbackCandidateId: null;
  readonly fallbackCertificationStatus: 'PENDING';
  readonly liveCertificationStatus: 'INCOMPLETE';
}

export interface CanaryBackgroundEconomyLaneSpec {
  readonly lane: 'BACKGROUND_ECONOMY';
  readonly workloadType: 'LATENCY_TOLERANT_NON_URGENT';
  readonly providerInterface: 'SYNCHRONOUS';
  readonly productExecutionModel: 'ASYNC_WORKER_QUEUE_WRAPPER';
  readonly candidateId: 'gemini-3.5-flash-lite-flex-low';
  readonly providerTier: 'flex';
  readonly liveCertificationStatus: 'INCOMPLETE';
  readonly operationalJobDeadlineMs: null;
  readonly backgroundExecutionDeadlineStatus: 'PENDING_LANE_CERTIFICATION';
}

export interface ProviderOfficialLatencyMetadata {
  readonly providerId: string;
  readonly serviceTier: string;
  readonly providerInterface: 'SYNCHRONOUS';
  readonly reliabilityClass: 'BEST_EFFORT_SHEDDABLE' | 'STANDARD_HIGH' | 'PRIORITY_NON_SHEDDABLE';
  readonly officialTargetLatencyMinMs: number;
  readonly officialTargetLatencyMaxMs: number;
  readonly recommendedClientTimeoutFloorMs: number;
  readonly pricingDiscountPercent?: number;
  readonly pricingPremiumPercent?: number;
}

export const CANARY_FLEX_OFFICIAL_LATENCY_METADATA: ProviderOfficialLatencyMetadata = {
  providerId: 'gemini',
  serviceTier: 'flex',
  providerInterface: 'SYNCHRONOUS',
  reliabilityClass: 'BEST_EFFORT_SHEDDABLE',
  officialTargetLatencyMinMs: 60000,
  officialTargetLatencyMaxMs: 900000,
  recommendedClientTimeoutFloorMs: 600000,
  pricingDiscountPercent: 50,
} as const;

export const CANARY_INTERACTIVE_LANE_SPEC: CanaryInteractiveLaneSpec = {
  lane: 'INTERACTIVE',
  workloadType: 'SYNCHRONOUS_USER_FACING',
  hardLifecycleTimeoutMs: 15000,
  flexAllowed: false,
  primaryCandidateId: 'deepseek-v4-flash-offpeak-low',
  certifiedFallbackCandidateId: null,
  fallbackCertificationStatus: 'PENDING',
  liveCertificationStatus: 'INCOMPLETE',
} as const;

export const CANARY_BACKGROUND_ECONOMY_LANE_SPEC: CanaryBackgroundEconomyLaneSpec = {
  lane: 'BACKGROUND_ECONOMY',
  workloadType: 'LATENCY_TOLERANT_NON_URGENT',
  providerInterface: 'SYNCHRONOUS',
  productExecutionModel: 'ASYNC_WORKER_QUEUE_WRAPPER',
  candidateId: 'gemini-3.5-flash-lite-flex-low',
  providerTier: 'flex',
  liveCertificationStatus: 'INCOMPLETE',
  operationalJobDeadlineMs: null,
  backgroundExecutionDeadlineStatus: 'PENDING_LANE_CERTIFICATION',
} as const;

export const CANARY_LANE_SPECIFICATIONS = {
  INTERACTIVE: CANARY_INTERACTIVE_LANE_SPEC,
  BACKGROUND_ECONOMY: CANARY_BACKGROUND_ECONOMY_LANE_SPEC,
} as const;

/**
 * Deterministic helper to determine if a candidate is permitted in a given execution lane.
 */
export function isCandidateAllowedForLane(candidateId: string, lane: CanaryExecutionLane): boolean {
  if (lane === 'INTERACTIVE') {
    // DeepSeek is primary for interactive; Gemini Flex is strictly prohibited
    if (candidateId === 'deepseek-v4-flash-offpeak-low') return true;
    if (candidateId === 'gemini-3.5-flash-lite-flex-low') return false;
    return false;
  }
  if (lane === 'BACKGROUND_ECONOMY') {
    // Gemini Flex is candidate for background; DeepSeek not certified for background
    if (candidateId === 'gemini-3.5-flash-lite-flex-low') return true;
    if (candidateId === 'deepseek-v4-flash-offpeak-low') return false;
    return false;
  }
  return false;
}

/**
 * Benchmark-Only / Uncertified Candidates (Section 7)
 * Strictly uncertified for live execution, fallbacks, or routing.
 */
export interface CanaryBenchmarkCandidate {
  readonly candidateId: string;
  readonly providerId: CertifiedProviderId;
  readonly modelId: string;
  readonly serviceTier: 'standard' | 'priority';
  readonly status: 'BENCHMARK_CANDIDATE_UNCERTIFIED';
  readonly networkCallsAllowed: false;
  readonly fallbackAllowed: false;
  readonly activeCandidateMatrixAllowed: false;
  readonly officialPositioning: {
    readonly latencyDescription: string;
    readonly interface: 'SYNCHRONOUS';
    readonly reliability: string;
    readonly pricingTier: string;
    readonly downgradeSemantics?: string;
  };
}

export const CANARY_BENCHMARK_CANDIDATES: readonly CanaryBenchmarkCandidate[] = [
  {
    candidateId: 'gemini-3.5-flash-lite-standard-low',
    providerId: 'gemini',
    modelId: 'gemini-3.5-flash-lite',
    serviceTier: 'standard',
    status: 'BENCHMARK_CANDIDATE_UNCERTIFIED',
    networkCallsAllowed: false,
    fallbackAllowed: false,
    activeCandidateMatrixAllowed: false,
    officialPositioning: {
      latencyDescription: 'seconds to minutes',
      interface: 'SYNCHRONOUS',
      reliability: 'high / medium-high',
      pricingTier: 'full-price tier',
    },
  },
  {
    candidateId: 'gemini-3.5-flash-lite-priority-low',
    providerId: 'gemini',
    modelId: 'gemini-3.5-flash-lite',
    serviceTier: 'priority',
    status: 'BENCHMARK_CANDIDATE_UNCERTIFIED',
    networkCallsAllowed: false,
    fallbackAllowed: false,
    activeCandidateMatrixAllowed: false,
    officialPositioning: {
      latencyDescription: 'seconds',
      interface: 'SYNCHRONOUS',
      reliability: 'high / non-sheddable',
      pricingTier: 'premium (75-100% premium)',
      downgradeSemantics: 'may gracefully downgrade server-side to Standard',
    },
  },
] as const;

export const CANARY_BENCHMARK_CANDIDATE_MAP = new Map<string, CanaryBenchmarkCandidate>(
  CANARY_BENCHMARK_CANDIDATES.map(c => [c.candidateId, c])
);

/**
 * Priority Downgrade Certification Contract (Section 8)
 * Future certification requirement: requestedTier vs observed actualTier
 */
export interface PriorityDowngradeCertificationContract {
  readonly requestedServiceTier: 'priority';
  readonly possibleActualTiers: readonly ['priority', 'standard'];
  readonly downgradeObservationRequired: true;
  readonly exactProvenanceRequiresExactMatch: true; // A downgraded request does NOT count as Priority provenance
  readonly requiredFutureMetrics: readonly [
    'requested_service_tier',
    'provider_reported_actual_tier',
    'downgrade_detected',
    'billing_tier',
    'observed_latency_ms',
    'interactive_slo_result',
  ];
}

export const PRIORITY_DOWNGRADE_CERTIFICATION_CONTRACT: PriorityDowngradeCertificationContract = {
  requestedServiceTier: 'priority',
  possibleActualTiers: ['priority', 'standard'] as const,
  downgradeObservationRequired: true,
  exactProvenanceRequiresExactMatch: true,
  requiredFutureMetrics: [
    'requested_service_tier',
    'provider_reported_actual_tier',
    'downgrade_detected',
    'billing_tier',
    'observed_latency_ms',
    'interactive_slo_result',
  ] as const,
};

/**
 * Legacy v1.1 14-Call Matrix Status (Section 9)
 * DeepSeek 7 + Gemini Flex 7 is HISTORICAL ONLY.
 * MUST NOT be interpreted as a valid interactive production or fallback matrix in v1.2.
 */
export const LEGACY_V11_CANARY_MATRIX = {
  specificationVersion: 'a12b2c5-v1.1',
  legacyV11MatrixHistoricalOnly: true,
  totalInvocations: 14,
  deepSeekInvocations: 7,
  geminiFlexInvocations: 7,
  validInteractiveFallbackPair: false,
  status: 'HISTORICAL_ONLY',
} as const;

export const legacyV11MatrixHistoricalOnly: boolean = true;

/**
 * Real 256-bit Entropy Capability Secret Validation (64 lowercase hexadecimal characters).
 * Corresponds to exactly 32 random bytes: openssl rand -hex 32
 */
export const CAPABILITY_SECRET_HEX_REGEX = /^[0-9a-f]{64}$/;

export function isValidCapabilitySecret(secret?: string | null): boolean {
  if (!secret || typeof secret !== 'string') return false;
  return CAPABILITY_SECRET_HEX_REGEX.test(secret.trim());
}

/**
 * Deterministic Approved Synthetic Fixture Set for the 7 Certified Canary Tasks.
 * Never uses customer, personal, sensitive, secret, or arbitrary caller data.
 */
export const CANARY_SYNTHETIC_FIXTURES: Record<TaskType, EvaluationCase> = {
  LEAD_INTENT_CLASSIFICATION: VELNAR_SHADOW_EVAL_V1.find(c => c.id === 'eval_v1_lead_01')!,
  LEAK_EXPLANATION: VELNAR_SHADOW_EVAL_V1.find(c => c.id === 'eval_v1_leak_01')!,
  GROWTH_ACTION_DRAFT: VELNAR_SHADOW_EVAL_V1.find(c => c.id === 'eval_v1_growth_01')!,
  BUSINESS_TWIN_SUMMARY: VELNAR_SHADOW_EVAL_V1.find(c => c.id === 'eval_v1_twin_01')!,
  FUNNEL_DIAGNOSTIC_EXPLANATION: VELNAR_SHADOW_EVAL_V1.find(c => c.id === 'eval_v1_funnel_01')!,
  SEO_CONTENT_SUGGESTION: VELNAR_SHADOW_EVAL_V1.find(c => c.id === 'eval_v1_seo_01')!,
  ANOMALY_TRIAGE: VELNAR_SHADOW_EVAL_V1.find(c => c.id === 'eval_v1_anomaly_01')!,
};

export function computeFixtureHash(fixture: EvaluationCase): string {
  return crypto.createHash('sha256').update(JSON.stringify(fixture.requestEnvelope)).digest('hex');
}

/**
 * Baseline information and certified targets for Canary providers.
 */
export const CERTIFIED_PROVIDER_BASELINES = {
  deepseek: {
    modelId: 'deepseek-v4-flash',
    documentedVersionTarget: 'DeepSeek-V4-Flash-0731',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    certifiedPricingTier: 'offpeak',
  },
  gemini: {
    modelId: 'gemini-3.5-flash-lite',
    documentedVersionTarget: 'gemini-3.5-flash-lite',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/interactions',
    certifiedServiceTier: 'flex',
    thinkingLevel: 'low',
  },
} as const;

/**
 * 1. Scope: Allowed Certified Candidates
 */
export interface CertifiedCanaryCandidate {
  readonly candidateId: string;
  readonly providerId: CertifiedProviderId;
  readonly requestedModelIdentifier: string;
  readonly expectedReturnedModelIdentifier: string;
  readonly pricingTier: 'offpeak' | 'flex';
  readonly reasoningBudgetTokens?: number;
  readonly thinkingLevel?: 'low';
}

export const CERTIFIED_CANARY_CANDIDATES: readonly CertifiedCanaryCandidate[] = [
  {
    candidateId: 'deepseek-v4-flash-offpeak-low',
    providerId: 'deepseek',
    requestedModelIdentifier: 'deepseek-v4-flash',
    expectedReturnedModelIdentifier: 'deepseek-v4-flash',
    pricingTier: 'offpeak',
    reasoningBudgetTokens: 2048,
  },
  {
    candidateId: 'gemini-3.5-flash-lite-flex-low',
    providerId: 'gemini',
    requestedModelIdentifier: 'gemini-3.5-flash-lite',
    expectedReturnedModelIdentifier: 'gemini-3.5-flash-lite',
    pricingTier: 'flex',
    thinkingLevel: 'low',
  },
] as const;

export const CERTIFIED_CANARY_CANDIDATE_MAP = new Map<string, CertifiedCanaryCandidate>(
  CERTIFIED_CANARY_CANDIDATES.map(c => [c.candidateId, c])
);

/**
 * 2. Scope: Allowed Data Classifications
 * Strictly synthetic/pseudonymous prompts only.
 * PERSONAL, SENSITIVE, and SECRET are categorically prohibited.
 */
export const ALLOWED_CANARY_DATA_CLASSIFICATIONS: readonly DataClassification[] = [
  'PUBLIC_BUSINESS',
  'PSEUDONYMOUS_OPERATIONAL',
] as const;

export const PROHIBITED_CANARY_DATA_CLASSIFICATIONS: readonly DataClassification[] = [
  'PERSONAL',
  'SENSITIVE',
  'SECRET',
] as const;

export function isCanaryDataClassificationAllowed(classification: DataClassification): boolean {
  return (ALLOWED_CANARY_DATA_CLASSIFICATIONS as readonly string[]).includes(classification);
}

/**
 * 3. Network Allowlist: Certified Endpoints Only
 */
export const CERTIFIED_CANARY_NETWORK_HOSTS: readonly string[] = [
  'api.deepseek.com',
  'generativelanguage.googleapis.com',
] as const;

export const CERTIFIED_CANARY_NETWORK_PATHS: readonly string[] = [
  '/v1/chat/completions',
  '/chat/completions',
  '/v1beta/interactions',
  '/v1beta/models/gemini-3.5-flash-lite:generateContent',
] as const;

export const CERTIFIED_CANARY_NETWORK_ENDPOINTS: readonly string[] = [
  'https://api.deepseek.com/v1/chat/completions',
  'https://api.deepseek.com/chat/completions',
  'https://generativelanguage.googleapis.com/v1beta/interactions',
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
] as const;

/**
 * Validates outbound request URL using strict parsed URL semantics.
 * Rejects subdomains, trailing dots, userinfo, non-HTTPS protocols, alternate ports, and path traversal.
 */
export function isCanaryNetworkEndpointAllowed(rawUrl: string): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  // 1. Strict protocol: https only
  if (parsed.protocol !== 'https:') {
    return false;
  }

  // 2. Prohibit userinfo (username / password in URL)
  if (parsed.username || parsed.password) {
    return false;
  }

  // 3. Prohibit alternate ports (must be empty or default 443)
  if (parsed.port !== '' && parsed.port !== '443') {
    return false;
  }

  // 4. Strict hostname matching (case-insensitive, no trailing dot, no wildcard subdomain)
  const normalizedHostname = parsed.hostname.toLowerCase();
  if (normalizedHostname.endsWith('.')) {
    return false; // Trailing dot disallowed
  }

  if (!(CERTIFIED_CANARY_NETWORK_HOSTS as readonly string[]).includes(normalizedHostname)) {
    return false;
  }

  // 5. Strict pathname matching
  const normalizedPath = parsed.pathname;
  if (normalizedHostname === 'api.deepseek.com') {
    return normalizedPath === '/v1/chat/completions' || normalizedPath === '/chat/completions';
  }

  if (normalizedHostname === 'generativelanguage.googleapis.com') {
    return normalizedPath === '/v1beta/interactions' ||
           normalizedPath === '/v1beta/models/gemini-3.5-flash-lite:generateContent';
  }

  return false;
}

/**
 * 4. Invocation & Concurrency Limits
 */
export const CANARY_INVOCATION_LIMITS = {
  maxTotalInvocations: 14,             // 7 tasks * 2 candidates
  maxInvocationsPerProvider: 7,        // Exactly 1 per certified task
  maxSameProviderRetries: 1,           // Transient 503 only
  maxCrossProviderFallbacks: 1,        // DeepSeek -> Gemini only upon retry exhaustion
  maxConcurrentInvocations: 1,         // Strictly sequential execution
  timeoutMsPerInvocation: 15000,       // 15 seconds hard timeout
} as const;

/**
 * 5. Cost Limits (Integer MicroUSD)
 */
export const CANARY_COST_LIMITS = {
  maxEstimatedCostMicroUsd: 25000,     // $0.025 USD pre-run estimate bound
  hardCeilingMicroUsd: 50000,          // $0.050 USD hard runtime limit
  maxSingleInvocationMicroUsd: 5000,   // $0.005 USD per single call
} as const;

/**
 * 6. Kill-Switch Event Categories
 */
export type CanaryKillSwitchReason =
  | 'PROVENANCE_MISMATCH'
  | 'MODEL_SUBSTITUTION_DETECTED'
  | 'UNEXPECTED_MODEL_VERSION'
  | 'MALFORMED_USAGE_TELEMETRY'
  | 'CACHE_ARITHMETIC_INCONSISTENCY'
  | 'REASONING_TOKEN_INCONSISTENCY'
  | 'REASONING_LEAKAGE_DETECTED'
  | 'PRIVACY_CLASSIFICATION_VIOLATION'
  | 'TASK_SCOPE_VIOLATION'
  | 'UNEXPECTED_RETRY_OR_FALLBACK'
  | 'RECURSIVE_FALLBACK_ATTEMPTED'
  | 'NETWORK_DESTINATION_MISMATCH'
  | 'COST_CEILING_BREACH'
  | 'INVOCATION_LIMIT_BREACH'
  | 'HUMAN_APPROVAL_INVALID'
  | 'UNAUTHORIZED_ENVIRONMENT'
  | 'UNEXPECTED_EXCEPTION';

export interface CanaryKillSwitchEvent {
  timestamp: string;
  reason: CanaryKillSwitchReason;
  message: string;
  details?: Record<string, unknown>;
  terminatedFailClosed: true;
}

/**
 * 7. Explicit Success Criteria & Quality Thresholds
 */
export const CANARY_SUCCESS_CRITERIA = {
  minProviderProvenanceMatchRate: 1.0,  // 100% exact match
  minUsageReportedRate: 1.0,            // 100% PROVIDER_REPORTED
  minValidSchemaOutputRate: 1.0,        // 100% valid task JSON schema
  minAggregateSemanticScore: 0.85,      // >= 0.85 semantic evaluation score
  maxUnexpectedNetworkAttempts: 0,      // Exactly 0 unexpected endpoints
  maxPrivacyViolations: 0,              // Exactly 0
  maxTelemetryFailures: 0,              // Exactly 0
  maxCostMicroUsd: CANARY_COST_LIMITS.hardCeilingMicroUsd,
} as const;

/**
 * 8. Human Approval Token Specification (Required for Phase A.12B.2C-5B)
 */
export interface CanaryHumanApprovalEnvelope {
  approvedBy: string;
  approvalTimestamp: string;
  targetPhase: 'A.12B.2C-5B' | 'A.12B.2C-5D';
  approvalToken: string;
  maxBudgetMicroUsd?: number; // Integer microUSD (e.g. 50000)
  maxBudgetUsd?: number;      // Optional float for display/backward compatibility
  environmentTarget: 'CONTROLLED_CANARY';
  specificationVersion: string;
  sourceCommitSha: string;
  runNonce: string;
  capabilitySecret?: string;
  executionLane?: CanaryExecutionLane;
}

export interface HumanApprovalValidationOptions {
  capabilitySecret?: string;
  now?: () => Date;
  maxAgeSeconds?: number;
  allowSimulatedExpiryForTest?: boolean;
  require64HexSecret?: boolean;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

export function isValidCalendarDate(dateStrOrYear: string | number, maybeMonth?: number, maybeDay?: number): boolean {
  let year: number;
  let month: number;
  let day: number;

  if (typeof dateStrOrYear === 'string') {
    if (!/^\d{8}$/.test(dateStrOrYear)) return false;
    year = parseInt(dateStrOrYear.slice(0, 4), 10);
    month = parseInt(dateStrOrYear.slice(4, 6), 10);
    day = parseInt(dateStrOrYear.slice(6, 8), 10);
  } else {
    year = dateStrOrYear;
    month = maybeMonth ?? 0;
    day = maybeDay ?? 0;
  }

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 2024 || year > 2099) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1) return false;
  const daysInMonth = [31, (isLeapYear(year) ? 29 : 28), 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day > daysInMonth[month - 1]) return false;
  return true;
}

export function computeCanaryHmacSignature(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret.trim())
    .update(payload, 'utf8')
    .digest('hex')
    .toLowerCase();
}

export interface GenerateApprovalTokenParams {
  approvedBy: string;
  targetPhase: 'A.12B.2C-5B' | 'A.12B.2C-5D';
  environmentTarget: 'CONTROLLED_CANARY';
  dateYyyyMmDd: string;
  maxBudgetMicroUsd?: number;
  maxBudgetUsd?: number;
  approvalTimestamp: string;
  specificationVersion: string;
  sourceCommitSha: string;
  runNonce: string;
  capabilitySecret: string;
  executionLane?: CanaryExecutionLane;
}

/**
 * Generates a cryptographically bound human approval token using HMAC-SHA256.
 * Requires a mandatory capabilitySecret (exact 64 lowercase hexadecimal characters representing 256 bits of entropy).
 * Token format: VELNAR_CANARY_APPROVED_PHASE_A12B2C5B_<YYYYMMDD>_<64_HEX_SIGNATURE> (or PHASE_A12B2C5D)
 */
export function generateCanaryApprovalToken(params: GenerateApprovalTokenParams): string {
  if (!params.capabilitySecret || typeof params.capabilitySecret !== 'string') {
    throw new Error('generateCanaryApprovalToken: capabilitySecret is mandatory (fail-closed).');
  }
  if (!isValidCapabilitySecret(params.capabilitySecret)) {
    throw new Error('generateCanaryApprovalToken: capabilitySecret is mandatory and must be exactly 64 lowercase hexadecimal characters representing 256 bits of entropy (openssl rand -hex 32).');
  }

  const budgetMicroUsd = params.maxBudgetMicroUsd !== undefined
    ? params.maxBudgetMicroUsd
    : (typeof params.maxBudgetUsd === 'number' && Number.isFinite(params.maxBudgetUsd) ? Math.round(params.maxBudgetUsd * 1_000_000) : NaN);

  if (!Number.isInteger(budgetMicroUsd) || budgetMicroUsd <= 0 || budgetMicroUsd > 50000) {
    throw new Error(`generateCanaryApprovalToken: maxBudgetMicroUsd must be an integer between 1 and 50000 microUSD (got ${budgetMicroUsd}).`);
  }

  if (!params.sourceCommitSha || !/^[0-9a-f]{40}$/i.test(params.sourceCommitSha.trim())) {
    throw new Error(`generateCanaryApprovalToken: sourceCommitSha must be an exact 40-character hexadecimal git commit SHA.`);
  }

  const canonicalPayload = [
    params.approvedBy.trim(),
    params.targetPhase,
    params.environmentTarget,
    params.dateYyyyMmDd.trim(),
    budgetMicroUsd.toString(),
    params.approvalTimestamp.trim(),
    params.specificationVersion.trim(),
    params.sourceCommitSha.trim().toLowerCase(),
    params.runNonce.trim(),
  ].join(':');

  const signature = crypto.createHmac('sha256', params.capabilitySecret.trim())
    .update(canonicalPayload)
    .digest('hex')
    .toLowerCase();

  const phasePrefix = params.targetPhase === 'A.12B.2C-5D' ? 'A12B2C5D' : 'A12B2C5B';
  return `VELNAR_CANARY_APPROVED_PHASE_${phasePrefix}_${params.dateYyyyMmDd}_${signature}`;
}

/**
 * Validates the human approval token against cryptographic bindings.
 * Token must follow exact pattern: VELNAR_CANARY_APPROVED_PHASE_<PHASE>_<YYYYMMDD>_<64_HEX_SIGNATURE>
 * Requires valid calendar date, exact phase, exact environment, budget within bounds, valid ISO timestamp,
 * matching specification version, commit SHA, execution run nonce, and full 64-hex HMAC signature.
 */
export function validateHumanApprovalToken(
  approval?: CanaryHumanApprovalEnvelope | null,
  options?: HumanApprovalValidationOptions
): {
  valid: boolean;
  reason?: string;
} {
  if (!approval) {
    return { valid: false, reason: 'Human approval envelope is missing (fail-closed).' };
  }

  if (approval.targetPhase !== 'A.12B.2C-5B' && (approval.targetPhase as string) !== 'A.12B.2C-5D') {
    return { valid: false, reason: `Target phase must be 'A.12B.2C-5B' or 'A.12B.2C-5D', received: '${approval.targetPhase}'.` };
  }

  if (approval.environmentTarget !== 'CONTROLLED_CANARY') {
    return { valid: false, reason: `Environment target must be 'CONTROLLED_CANARY', received: '${approval.environmentTarget}'.` };
  }

  if (!approval.approvedBy || typeof approval.approvedBy !== 'string' || approval.approvedBy.trim().length < 3) {
    return { valid: false, reason: 'ApprovedBy identifier is invalid or missing.' };
  }

  const budgetMicroUsd = approval.maxBudgetMicroUsd !== undefined
    ? approval.maxBudgetMicroUsd
    : (typeof approval.maxBudgetUsd === 'number' && Number.isFinite(approval.maxBudgetUsd) ? Math.round(approval.maxBudgetUsd * 1_000_000) : NaN);

  if (!Number.isInteger(budgetMicroUsd) || budgetMicroUsd <= 0 || budgetMicroUsd > 50000) {
    return { valid: false, reason: `maxBudgetMicroUsd must be an integer <= allowable canary ceiling of 50000 microUSD (got ${budgetMicroUsd}).` };
  }

  if (!approval.specificationVersion || approval.specificationVersion.trim() !== CANARY_SPECIFICATION_VERSION) {
    return { valid: false, reason: `Specification version must match '${CANARY_SPECIFICATION_VERSION}', received: '${approval.specificationVersion}'.` };
  }

  if (!approval.sourceCommitSha || typeof approval.sourceCommitSha !== 'string' || !/^[0-9a-f]{40}$/i.test(approval.sourceCommitSha.trim())) {
    return { valid: false, reason: 'sourceCommitSha must be an exact 40-character hexadecimal git commit SHA.' };
  }

  if (!approval.runNonce || typeof approval.runNonce !== 'string' || approval.runNonce.trim().length < 8) {
    return { valid: false, reason: 'runNonce is missing or invalid.' };
  }

  // Capability Secret is strictly MANDATORY (exact 64 lowercase hexadecimal characters representing 256 bits of entropy)
  const capabilitySecret = approval.capabilitySecret || options?.capabilitySecret;
  if (!capabilitySecret || typeof capabilitySecret !== 'string') {
    return { valid: false, reason: 'Capability secret is mandatory for human approval verification (fail-closed).' };
  }
  if (!isValidCapabilitySecret(capabilitySecret)) {
    return { valid: false, reason: 'Capability secret must be exactly 64 hexadecimal characters representing 256 bits of entropy (fail-closed).' };
  }

  // Token Format: Exactly 64 hexadecimal characters for SHA-256 HMAC (256 bits)
  const tokenPattern = /^VELNAR_CANARY_APPROVED_PHASE_(?:A12B2C5B|A12B2C5D)_(\d{8})_([A-Fa-f0-9]{64})$/;
  const match = approval.approvalToken ? approval.approvalToken.match(tokenPattern) : null;
  if (!match) {
    return { valid: false, reason: 'Approval token does not match required format VELNAR_CANARY_APPROVED_PHASE_<PHASE>_<YYYYMMDD>_<64_HEX_SIGNATURE>.' };
  }

  const [, tokenDateStr, tokenSignature] = match;

  // Strict Calendar Date Validation (YYYYMMDD)
  const year = parseInt(tokenDateStr.slice(0, 4), 10);
  const month = parseInt(tokenDateStr.slice(4, 6), 10);
  const day = parseInt(tokenDateStr.slice(6, 8), 10);
  if (!isValidCalendarDate(year, month, day)) {
    return { valid: false, reason: `Approval token contains invalid calendar date '${tokenDateStr}'.` };
  }

  // Timestamp format & date alignment validation
  if (!approval.approvalTimestamp || typeof approval.approvalTimestamp !== 'string') {
    return { valid: false, reason: 'approvalTimestamp is missing or invalid.' };
  }

  const parsedTimestamp = new Date(approval.approvalTimestamp);
  if (isNaN(parsedTimestamp.getTime())) {
    return { valid: false, reason: `approvalTimestamp '${approval.approvalTimestamp}' is not a valid ISO date.` };
  }

  const isoDateStr = parsedTimestamp.toISOString().slice(0, 10).replace(/-/g, '');
  if (isoDateStr !== tokenDateStr) {
    return { valid: false, reason: `approvalTimestamp date '${isoDateStr}' does not match token date '${tokenDateStr}'.` };
  }

  // Short operational expiry window (default: 3600 seconds / 1 hour)
  const now = options?.now ? options.now() : new Date();
  const diffSeconds = (now.getTime() - parsedTimestamp.getTime()) / 1000;
  const maxAgeSeconds = options?.maxAgeSeconds ?? 3600;

  if (!options?.allowSimulatedExpiryForTest && (diffSeconds > maxAgeSeconds || diffSeconds < -60)) {
    return { valid: false, reason: `Approval token has expired or is outside active operational window (age: ${Math.round(diffSeconds)}s, max: ${maxAgeSeconds}s).` };
  }

  // Cryptographic capability HMAC-SHA256 verification
  const canonicalPayload = [
    approval.approvedBy.trim(),
    approval.targetPhase,
    approval.environmentTarget,
    tokenDateStr,
    budgetMicroUsd.toString(),
    approval.approvalTimestamp.trim(),
    approval.specificationVersion.trim(),
    approval.sourceCommitSha.trim().toLowerCase(),
    approval.runNonce.trim(),
  ].join(':');

  const expectedSignature = crypto.createHmac('sha256', capabilitySecret.trim())
    .update(canonicalPayload)
    .digest('hex');

  // Full 32-byte constant-time comparison
  const sigBuf = Buffer.from(tokenSignature.toLowerCase(), 'hex');
  const expBuf = Buffer.from(expectedSignature.toLowerCase(), 'hex');

  if (sigBuf.length !== 32 || expBuf.length !== 32 || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return {
      valid: false,
      reason: 'Approval signature failed cryptographic capability verification (tampered parameters, forged signature, or mismatched capability secret).',
    };
  }

  return { valid: true };
}

/**
 * 9. Evidence Capture Artifact Schema
 */
export interface CanaryTransportAttemptRecord {
  attemptIndex: number;
  logicalCaseId: string;
  fixtureId: string;
  fixtureHash: string;
  providerId: CertifiedProviderId;
  candidateId: string;
  taskType: TaskType;
  retryState: 'NONE' | 'SAME_PROVIDER_503_RETRY';
  fallbackState: 'NONE' | 'DEEPSEEK_TO_GEMINI_FALLBACK';
  timestamp: string;
  endpointUrl: string;
  httpStatus: number;
  statusClass: '2xx' | '3xx' | '4xx' | '5xx' | 'TRANSPORT_ERROR';
  latencyMs: number;
  requestPayloadHash: string;
  responsePayloadHash?: string;
  incurredCostMicroUsd?: number;
}

export interface CanaryInvocationEvidenceRecord {
  invocationIndex: number;
  timestamp: string;
  taskType: TaskType;
  dataClassification: DataClassification;
  providerId: CertifiedProviderId;
  candidateId: string;
  fixtureId?: string;
  fixtureHash?: string;
  requestedModelIdentifier: string;
  returnedModelIdentifier: string;
  documentedVersionTarget?: string;
  certificationBaselineModelVersion?: string;
  providerReportedBackendFingerprint?: string | null;
  providerReportedModelVersion?: string | null;
  serviceTier?: string;
  requestedServiceTier?: string;
  providerReportedServiceTier?: string | null;
  endpointUrl: string;
  requestPayloadHash: string;
  responsePayloadHash: string;
  promptTokens: number;
  completionTokens: number;
  thinkingTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  totalTokens: number;
  usageSource: 'PROVIDER_REPORTED';
  cacheStatus: 'VERIFIED' | 'NOT_VERIFIED';
  pricingWindow: 'OFF_PEAK' | 'PEAK' | 'FLEX_STANDARD';
  estimatedCostMicroUsd: number;
  observedCostMicroUsd: number;
  latencyMs: number;
  attemptCount: number;
  fallbackTriggered: boolean;
  semanticScore: number;
  schemaValid: boolean;
  pass: boolean;
  hardFailReasons?: string[];
  killSwitchTriggered?: CanaryKillSwitchReason;
}

export interface CanaryExecutionEvidencePackage {
  phase: 'A.12B.2C-5A' | 'A.12B.2C-5B' | 'A.12B.2C-5D';
  specificationVersion: string;
  executionMode: 'DRY_RUN_READINESS_VERIFICATION' | 'LIVE_CONTROLLED_CANARY';
  timestamp: string;
  humanApproval: CanaryHumanApprovalEnvelope | null;
  overallStatus: 'CANARY_READY_AWAITING_HUMAN_APPROVAL' | 'CANARY_EXECUTION_PASSED' | 'CANARY_EXECUTION_FAILED' | 'CANARY_KILL_SWITCH_TERMINATED';
  logicalCaseCount?: number;
  transportAttemptCount?: number;
  completedRequiredMatrixCases?: number;
  summaryCounts: {
    totalPlannedInvocations: number;
    executedInvocations: number;
    passedInvocations: number;
    failedInvocations: number;
    killSwitchEventsCount: number;
    totalObservedCostMicroUsd: number;
    totalEstimatedCostMicroUsd: number;
    totalPreflightWorstCaseCostMicroUsd?: number;
    aggregateSemanticScore: number;
  };
  attemptRecords?: CanaryTransportAttemptRecord[];
  invocations: CanaryInvocationEvidenceRecord[];
  killSwitchEvents: CanaryKillSwitchEvent[];
  productionRoutingEnforcementAllowed: false; // Invariant
}
