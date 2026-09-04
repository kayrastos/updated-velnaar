/**
 * @file worker/ai/canary/deepSeekSuccessorCertificationStateMachine.ts
 * @description VELNAR — A.12B.2C-5H DeepSeek Successor Certification State Machine.
 * 
 * STRICT INVARIANTS:
 * - Pure, deterministic, fail-closed state machine.
 * - ZERO DeepSeek calls.
 * - ZERO Gemini calls.
 * - ZERO provider credentials.
 * - ZERO external network calls.
 * - DO NOT activate v1.3.
 * - CANARY_SPECIFICATION_VERSION remains 'a12b2c5-v1.2'.
 * - CANARY_LIVE_EXECUTION_ENABLED remains false.
 * - productionRoutingEnforcementAllowed remains false.
 * - NO raw secrets or credential material permitted in evidence structures.
 */

import {
  CANARY_SPECIFICATION_VERSION,
  CANARY_LIVE_EXECUTION_ENABLED,
  CANARY_LIVE_EXECUTION_STATE,
} from './canarySpecification';

import {
  SUCCESSOR_SPECIFICATION_VERSION,
  CURRENT_ACTIVE_TECHNICAL_SPEC,
  CURRENT_STRATEGY,
  CERTIFICATION_PROVIDER,
  CERTIFICATION_MODEL,
  DOCUMENTED_VERSION_TARGET,
  OFF_PEAK_CANDIDATE,
  PEAK_CANDIDATE,
  OFF_PEAK_PROGRAM,
  PEAK_PROGRAM,
  REASONING_EFFORT,
  MAX_TOKENS,
  INTERACTIVE_TIMEOUT_MS,
  SAME_PROVIDER_RETRIES,
  CROSS_PROVIDER_FALLBACKS,
  AUTOMATIC_RERUNS,
  QUALITY_GATES,
  CANONICAL_COST_PREFLIGHT,
} from './deepSeekSingleProviderCertificationSpecification';

import {
  CERTIFIED_A12B2C_TASK_TYPES,
  CERTIFIED_A12B2C_TASK_TYPE_SET,
} from '../providers/certifiedProviderTypes';
import { TaskType } from '../types';

export {
  CERTIFIED_A12B2C_TASK_TYPES,
  CERTIFIED_A12B2C_TASK_TYPE_SET,
  CANONICAL_COST_PREFLIGHT,
};

// ============================================================================
// 1. STATE DEFINITIONS
// ============================================================================

export type CertificationState =
  | 'DRAFT_SEALED'
  | 'OFF_PEAK_RUNNER_NOT_READY'
  | 'OFF_PEAK_RUNNER_READY'
  | 'OFF_PEAK_AUTHORIZATION_PENDING'
  | 'OFF_PEAK_AUTHORIZED'
  | 'OFF_PEAK_CERTIFIED'
  | 'OFF_PEAK_FAILED_CLOSED'
  | 'PEAK_RUNNER_NOT_READY'
  | 'PEAK_RUNNER_READY'
  | 'PEAK_AUTHORIZATION_PENDING'
  | 'PEAK_AUTHORIZED'
  | 'PEAK_CERTIFIED'
  | 'PEAK_FAILED_CLOSED'
  | 'ALL_WINDOWS_CERTIFIED'
  | 'ROUTING_ACTIVATION_ELIGIBLE';

export type TrackState =
  | 'NOT_READY'
  | 'READY'
  | 'AUTHORIZATION_PENDING'
  | 'AUTHORIZED'
  | 'CERTIFIED'
  | 'FAILED_CLOSED';

export type OverallCertificationState =
  | 'DRAFT_SEALED'
  | 'CERTIFICATION_IN_PROGRESS'
  | 'OFF_PEAK_ONLY_CERTIFIED'
  | 'PEAK_ONLY_CERTIFIED'
  | 'ALL_WINDOWS_CERTIFIED'
  | 'ROUTING_ACTIVATION_ELIGIBLE'
  | 'FAILED_CLOSED';

export const INITIAL_CERTIFICATION_STATE: CertificationState = 'DRAFT_SEALED';
export const REQUIRED_CANONICAL_INVOCATION_COUNT = 7 as const;
export const SEMANTIC_SCORE_MIN_THRESHOLD = 0.85 as const;
export const MAX_INVOCATION_LATENCY_MS = 15000 as const;

// ============================================================================
// 2. EVIDENCE INTERFACES (ZERO SECRETS / BINDINGS & DIGESTS ONLY)
// ============================================================================

export interface RunnerReadinessEvidence {
  readonly pricingWindow: 'OFF_PEAK' | 'PEAK';
  readonly successorSpecificationVersion: string;
  readonly provider: string;
  readonly model: string;
  readonly documentedVersionTarget: string;
  readonly reasoningEffort: string;
  readonly maxTokens: number;
  readonly lifecycleTimeoutMs: number;
  readonly canonicalTaskCount: number;
  readonly retries: number;
  readonly crossProviderFallback: number;
  readonly automaticRerun: number;
  readonly costPreflightAvailable: boolean;
  readonly windowSpecificCostBoundMicroUsd: number;
  readonly productionRoutingEnforcementAllowed: boolean;
  readonly globalLiveExecutionEnabled: boolean;
  readonly deterministicOfflineTestsPass: boolean;
}

export interface WindowAuthorizationEvidence {
  readonly approvedBy: string;
  readonly approvalTimestamp: string;
  readonly targetProgram: string;
  readonly pricingWindow: 'OFF_PEAK' | 'PEAK';
  readonly candidateId: string;
  readonly sourceCommitSha: string;
  readonly sourceTreeSha: string;
  readonly specificationVersion: string;
  readonly maxBudgetMicroUsd: number;
  readonly runNonce: string;
  readonly authorizationTokenDigest: string;
  readonly authorizationReusable?: boolean;
}

export interface InvocationRecordSummary {
  readonly taskId: string;
  readonly taskType: TaskType;
  readonly success: boolean;
  readonly latencyMs: number;
  readonly modelRequested: string;
  readonly modelReturned: string;
  readonly schemaValid: boolean;
  readonly providerReportedUsage: boolean;
  readonly observedCostMicroUsd: number;
  readonly semanticScore: number;
  readonly privacyViolation: boolean;
}

export interface WindowCertificationEvidence {
  readonly evidenceOrigin: 'LIVE_PROVIDER_EXECUTION';
  readonly certificationEligible: true;
  readonly pricingWindow: 'OFF_PEAK' | 'PEAK';
  readonly candidateId: string;
  readonly executedInvocations: number;
  readonly transportAttemptCount: number;
  readonly completedRequiredMatrixCases: number;
  readonly passedInvocations: number;
  readonly failedInvocations: number;
  readonly clientRetries: number;
  readonly crossProviderFallbacks: number;
  readonly automaticReruns: number;
  readonly killSwitchEvents: number;
  readonly provider: string;
  readonly modelRequested: string;
  readonly modelReturned: string;
  readonly providerReportedUsageCount: number;
  readonly schemaValidCount: number;
  readonly taskPassCount: number;
  readonly maxLatencyMs: number;
  readonly latenciesMs: readonly number[];
  readonly aggregateSemanticScore: number;
  readonly privacyViolations: number;
  readonly unexpectedNetworkAttempts: number;
  readonly observedTotalCostMicroUsd: number;
  readonly authorizedBudgetMicroUsd: number;
  readonly sourceCommitSha: string;
  readonly sourceTreeSha: string;
  readonly runNonce: string;
  readonly invocationRecords: readonly InvocationRecordSummary[];
}

export interface AllWindowsCertificationEvidence {
  readonly offPeakEvidence: WindowCertificationEvidence;
  readonly peakEvidence: WindowCertificationEvidence;
  readonly offPeakArtifactHash: string;
  readonly peakArtifactHash: string;
  readonly specificationVersion: string;
  readonly sourceCommitSha: string;
  readonly sourceTreeSha: string;
}

export interface RoutingActivationEligibilityEvidence {
  readonly allWindowsEvidence: AllWindowsCertificationEvidence;
  readonly independentAuditCompleted: boolean;
  readonly independentAuditReportId: string;
  readonly sourceSpecCompatibilityValidated: boolean;
  readonly productionRoutingEnforcementAllowed: boolean;
  readonly liveGateStatus: boolean;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export interface CertificationStateMachineSnapshot {
  readonly currentState: CertificationState;
  readonly offPeakTrackState: TrackState;
  readonly peakTrackState: TrackState;
  readonly overallState: OverallCertificationState;
  readonly consumedAuthorizations: readonly string[];
  readonly offPeakEvidence?: WindowCertificationEvidence;
  readonly peakEvidence?: WindowCertificationEvidence;
  readonly allWindowsEvidence?: AllWindowsCertificationEvidence;
  readonly routingEligibilityEvidence?: RoutingActivationEligibilityEvidence;
}

export interface TransitionResult {
  readonly success: boolean;
  readonly snapshot: CertificationStateMachineSnapshot;
  readonly errors: readonly string[];
}

// ============================================================================
// 3. TRANSITION ALLOWLIST MATRIX
// ============================================================================

export const ALLOWED_TRANSITIONS: Readonly<Record<CertificationState, readonly CertificationState[]>> = {
  DRAFT_SEALED: [
    'OFF_PEAK_RUNNER_NOT_READY',
    'PEAK_RUNNER_NOT_READY',
  ],
  OFF_PEAK_RUNNER_NOT_READY: [
    'OFF_PEAK_RUNNER_READY',
    'OFF_PEAK_FAILED_CLOSED',
  ],
  OFF_PEAK_RUNNER_READY: [
    'OFF_PEAK_AUTHORIZATION_PENDING',
    'OFF_PEAK_AUTHORIZED',
    'OFF_PEAK_FAILED_CLOSED',
  ],
  OFF_PEAK_AUTHORIZATION_PENDING: [
    'OFF_PEAK_AUTHORIZED',
    'OFF_PEAK_FAILED_CLOSED',
  ],
  OFF_PEAK_AUTHORIZED: [
    'OFF_PEAK_CERTIFIED',
    'OFF_PEAK_FAILED_CLOSED',
  ],
  OFF_PEAK_CERTIFIED: [
    'ALL_WINDOWS_CERTIFIED',
    'OFF_PEAK_FAILED_CLOSED',
  ],
  OFF_PEAK_FAILED_CLOSED: [
    // Terminal unless new authorized cycle initiated from NOT_READY
    'OFF_PEAK_RUNNER_NOT_READY',
  ],
  PEAK_RUNNER_NOT_READY: [
    'PEAK_RUNNER_READY',
    'PEAK_FAILED_CLOSED',
  ],
  PEAK_RUNNER_READY: [
    'PEAK_AUTHORIZATION_PENDING',
    'PEAK_AUTHORIZED',
    'PEAK_FAILED_CLOSED',
  ],
  PEAK_AUTHORIZATION_PENDING: [
    'PEAK_AUTHORIZED',
    'PEAK_FAILED_CLOSED',
  ],
  PEAK_AUTHORIZED: [
    'PEAK_CERTIFIED',
    'PEAK_FAILED_CLOSED',
  ],
  PEAK_CERTIFIED: [
    'ALL_WINDOWS_CERTIFIED',
    'PEAK_FAILED_CLOSED',
  ],
  PEAK_FAILED_CLOSED: [
    'PEAK_RUNNER_NOT_READY',
  ],
  ALL_WINDOWS_CERTIFIED: [
    'ROUTING_ACTIVATION_ELIGIBLE',
    'OFF_PEAK_FAILED_CLOSED',
    'PEAK_FAILED_CLOSED',
  ],
  ROUTING_ACTIVATION_ELIGIBLE: [
    // Terminal certification state in Phase 5H. Production routing NOT enabled.
  ],
} as const;

// ============================================================================
// 4. FACTORY & INITIALIZATION
// ============================================================================

export function createInitialCertificationState(): CertificationStateMachineSnapshot {
  return {
    currentState: 'DRAFT_SEALED',
    offPeakTrackState: 'NOT_READY',
    peakTrackState: 'NOT_READY',
    overallState: 'DRAFT_SEALED',
    consumedAuthorizations: [],
  };
}

// ============================================================================
// 5. VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validates Runner Readiness Evidence.
 * Proves implementation readiness without requiring live provider execution.
 */
export function validateRunnerReadinessEvidence(
  evidence: RunnerReadinessEvidence
): ValidationResult {
  const errors: string[] = [];

  if (evidence.pricingWindow !== 'OFF_PEAK' && evidence.pricingWindow !== 'PEAK') {
    errors.push(`Invalid pricingWindow: '${evidence.pricingWindow}'. Expected 'OFF_PEAK' or 'PEAK'.`);
  }

  if (evidence.successorSpecificationVersion !== SUCCESSOR_SPECIFICATION_VERSION) {
    errors.push(
      `Invalid successorSpecificationVersion: '${evidence.successorSpecificationVersion}'. Expected '${SUCCESSOR_SPECIFICATION_VERSION}'.`
    );
  }

  if (evidence.provider !== CERTIFICATION_PROVIDER) {
    errors.push(`Invalid provider: '${evidence.provider}'. Expected '${CERTIFICATION_PROVIDER}'.`);
  }

  if (evidence.model !== CERTIFICATION_MODEL) {
    errors.push(`Invalid model: '${evidence.model}'. Expected '${CERTIFICATION_MODEL}'.`);
  }

  if (evidence.documentedVersionTarget !== DOCUMENTED_VERSION_TARGET) {
    errors.push(
      `Invalid documentedVersionTarget: '${evidence.documentedVersionTarget}'. Expected '${DOCUMENTED_VERSION_TARGET}'.`
    );
  }

  if (evidence.reasoningEffort !== REASONING_EFFORT) {
    errors.push(`Invalid reasoningEffort: '${evidence.reasoningEffort}'. Expected '${REASONING_EFFORT}'.`);
  }

  if (evidence.maxTokens !== MAX_TOKENS) {
    errors.push(`Invalid maxTokens: ${evidence.maxTokens}. Expected ${MAX_TOKENS}.`);
  }

  if (evidence.lifecycleTimeoutMs !== INTERACTIVE_TIMEOUT_MS) {
    errors.push(
      `Invalid lifecycleTimeoutMs: ${evidence.lifecycleTimeoutMs}. Expected ${INTERACTIVE_TIMEOUT_MS}.`
    );
  }

  if (evidence.canonicalTaskCount !== REQUIRED_CANONICAL_INVOCATION_COUNT) {
    errors.push(
      `Invalid canonicalTaskCount: ${evidence.canonicalTaskCount}. Expected ${REQUIRED_CANONICAL_INVOCATION_COUNT}.`
    );
  }

  if (evidence.retries !== SAME_PROVIDER_RETRIES) {
    errors.push(`Invalid retries: ${evidence.retries}. Retries must be strictly 0.`);
  }

  if (evidence.crossProviderFallback !== CROSS_PROVIDER_FALLBACKS) {
    errors.push(
      `Invalid crossProviderFallback: ${evidence.crossProviderFallback}. Cross-provider fallback must be strictly 0.`
    );
  }

  if (evidence.automaticRerun !== AUTOMATIC_RERUNS) {
    errors.push(`Invalid automaticRerun: ${evidence.automaticRerun}. Automatic reruns must be strictly 0.`);
  }

  if (!evidence.costPreflightAvailable) {
    errors.push('Cost preflight arithmetic is missing or unavailable.');
  }

  const expectedCostBound =
    evidence.pricingWindow === 'OFF_PEAK'
      ? CANONICAL_COST_PREFLIGHT.offPeakSevenCallWorstCaseMicroUsd
      : evidence.pricingWindow === 'PEAK'
        ? CANONICAL_COST_PREFLIGHT.peakSevenCallWorstCaseMicroUsd
        : null;

  if (
    typeof evidence.windowSpecificCostBoundMicroUsd !== 'number' ||
    !Number.isInteger(evidence.windowSpecificCostBoundMicroUsd) ||
    evidence.windowSpecificCostBoundMicroUsd <= 0
  ) {
    errors.push('windowSpecificCostBoundMicroUsd must be a positive integer value.');
  } else if (
    expectedCostBound !== null &&
    evidence.windowSpecificCostBoundMicroUsd !== expectedCostBound
  ) {
    errors.push(
      `Invalid windowSpecificCostBoundMicroUsd: ${evidence.windowSpecificCostBoundMicroUsd}. Expected exact sealed cost bound ${expectedCostBound} for ${evidence.pricingWindow}.`
    );
  }

  if (evidence.productionRoutingEnforcementAllowed !== false) {
    errors.push('productionRoutingEnforcementAllowed must be strictly false for runner readiness.');
  }

  if (evidence.globalLiveExecutionEnabled !== false) {
    errors.push('globalLiveExecutionEnabled must be strictly false.');
  }

  if (!evidence.deterministicOfflineTestsPass) {
    errors.push('deterministicOfflineTestsPass must be strictly true.');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validates Window Authorization Evidence.
 * Enforces strict single-use binding, window-specific program isolation, and credential-free bindings.
 */
export function validateAuthorizationEvidence(
  evidence: WindowAuthorizationEvidence,
  options?: {
    expectedCommitSha?: string;
    expectedTreeSha?: string;
    expectedNonce?: string;
    maxAllowedBudgetMicroUsd?: number;
    consumedAuthorizations?: ReadonlySet<string> | readonly string[];
  }
): ValidationResult {
  const errors: string[] = [];

  // Reject raw secrets or API keys
  const serialized = JSON.stringify(evidence);
  if (
    serialized.includes('sk-') ||
    serialized.includes('capabilitySecret') ||
    serialized.includes('apiKey') ||
    serialized.includes('DEEPSEEK_API_KEY')
  ) {
    errors.push('CRITICAL_SECURITY_VIOLATION: Raw secrets or API key fragments detected in authorization evidence.');
  }

  if (!evidence.approvedBy || typeof evidence.approvedBy !== 'string' || evidence.approvedBy.trim().length === 0) {
    errors.push('approvedBy must be a valid non-empty identity string.');
  }

  if (
    !evidence.approvalTimestamp ||
    typeof evidence.approvalTimestamp !== 'string' ||
    isNaN(Date.parse(evidence.approvalTimestamp))
  ) {
    errors.push(`approvalTimestamp must be a valid ISO timestamp string (got '${evidence.approvalTimestamp}').`);
  }

  if (evidence.pricingWindow !== 'OFF_PEAK' && evidence.pricingWindow !== 'PEAK') {
    errors.push(`Invalid pricingWindow: '${evidence.pricingWindow}'. Expected 'OFF_PEAK' or 'PEAK'.`);
  }

  if (evidence.pricingWindow === 'OFF_PEAK') {
    if (evidence.targetProgram !== OFF_PEAK_PROGRAM.programId) {
      errors.push(
        `Mismatched targetProgram for OFF_PEAK: got '${evidence.targetProgram}', expected '${OFF_PEAK_PROGRAM.programId}'.`
      );
    }
    if (evidence.candidateId !== OFF_PEAK_CANDIDATE) {
      errors.push(
        `Mismatched candidateId for OFF_PEAK: got '${evidence.candidateId}', expected '${OFF_PEAK_CANDIDATE}'.`
      );
    }
  }

  if (evidence.pricingWindow === 'PEAK') {
    if (evidence.targetProgram !== PEAK_PROGRAM.programId) {
      errors.push(
        `Mismatched targetProgram for PEAK: got '${evidence.targetProgram}', expected '${PEAK_PROGRAM.programId}'.`
      );
    }
    if (evidence.candidateId !== PEAK_CANDIDATE) {
      errors.push(
        `Mismatched candidateId for PEAK: got '${evidence.candidateId}', expected '${PEAK_CANDIDATE}'.`
      );
    }
  }

  if (evidence.specificationVersion !== SUCCESSOR_SPECIFICATION_VERSION) {
    errors.push(
      `Invalid specificationVersion: '${evidence.specificationVersion}'. Expected '${SUCCESSOR_SPECIFICATION_VERSION}'.`
    );
  }

  if (
    typeof evidence.maxBudgetMicroUsd !== 'number' ||
    !Number.isInteger(evidence.maxBudgetMicroUsd) ||
    evidence.maxBudgetMicroUsd <= 0
  ) {
    errors.push(`maxBudgetMicroUsd must be a positive integer in microUSD (got ${evidence.maxBudgetMicroUsd}).`);
  }

  if (options?.maxAllowedBudgetMicroUsd !== undefined) {
    if (evidence.maxBudgetMicroUsd > options.maxAllowedBudgetMicroUsd) {
      errors.push(
        `maxBudgetMicroUsd (${evidence.maxBudgetMicroUsd}) exceeds maximum allowed ceiling (${options.maxAllowedBudgetMicroUsd}).`
      );
    }
  }

  // Exact 40-char hex commit SHA validation
  if (!evidence.sourceCommitSha || !/^[0-9a-f]{40}$/i.test(evidence.sourceCommitSha)) {
    errors.push(
      `sourceCommitSha must be an exact 40-character hexadecimal git commit SHA (got '${evidence.sourceCommitSha}').`
    );
  } else if (options?.expectedCommitSha && evidence.sourceCommitSha !== options.expectedCommitSha) {
    errors.push(
      `sourceCommitSha mismatch: expected '${options.expectedCommitSha}', got '${evidence.sourceCommitSha}'.`
    );
  }

  // Exact 40-char hex tree SHA validation
  if (!evidence.sourceTreeSha || !/^[0-9a-f]{40}$/i.test(evidence.sourceTreeSha)) {
    errors.push(
      `sourceTreeSha must be an exact 40-character hexadecimal git tree SHA (got '${evidence.sourceTreeSha}').`
    );
  } else if (options?.expectedTreeSha && evidence.sourceTreeSha !== options.expectedTreeSha) {
    errors.push(
      `sourceTreeSha mismatch: expected '${options.expectedTreeSha}', got '${evidence.sourceTreeSha}'.`
    );
  }

  if (!evidence.runNonce || typeof evidence.runNonce !== 'string' || evidence.runNonce.trim().length === 0) {
    errors.push('runNonce must be a non-empty unique string.');
  } else if (options?.expectedNonce && evidence.runNonce !== options.expectedNonce) {
    errors.push(`runNonce mismatch: expected '${options.expectedNonce}', got '${evidence.runNonce}'.`);
  }

  if (
    !evidence.authorizationTokenDigest ||
    typeof evidence.authorizationTokenDigest !== 'string' ||
    evidence.authorizationTokenDigest.trim().length === 0
  ) {
    errors.push('authorizationTokenDigest must be a non-empty digest string.');
  }

  // Single-use invariant
  if (evidence.authorizationReusable === true) {
    errors.push('AUTHORIZATION_REUSE_VIOLATION: authorizationReusable must not be true. Authorizations are strictly single-use.');
  }

  // Check against consumed authorizations
  if (options?.consumedAuthorizations) {
    const consumedSet =
      options.consumedAuthorizations instanceof Set
        ? options.consumedAuthorizations
        : new Set(options.consumedAuthorizations);

    const authKey = `${evidence.targetProgram}:${evidence.pricingWindow}:${evidence.sourceCommitSha}:${evidence.runNonce}`;
    const digestKey = evidence.authorizationTokenDigest;

    if (consumedSet.has(authKey) || consumedSet.has(digestKey)) {
      errors.push(`AUTHORIZATION_REUSE_VIOLATION: Authorization key '${authKey}' or digest has already been consumed.`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validates Window Certification Evidence.
 * Requires 7/7 clean canonical executions, 0 retries, 0 fallbacks, 0 kill-switches,
 * exact model provenance, and valid cost bounds.
 */
export function validateCertificationEvidence(
  evidence: WindowCertificationEvidence,
  options?: {
    boundAuthorization?: WindowAuthorizationEvidence;
  }
): ValidationResult {
  const errors: string[] = [];

  // Strict origin and certification eligibility check (OFFLINE_EVIDENCE_NOT_CERTIFIABLE)
  if ((evidence as any)?.evidenceOrigin !== 'LIVE_PROVIDER_EXECUTION') {
    errors.push(
      `OFFLINE_EVIDENCE_NOT_CERTIFIABLE: evidenceOrigin must be 'LIVE_PROVIDER_EXECUTION' (got '${(evidence as any)?.evidenceOrigin}'). Offline/synthetic evidence cannot certify provider.`
    );
  }

  if ((evidence as any)?.certificationEligible !== true) {
    errors.push(
      `OFFLINE_EVIDENCE_NOT_CERTIFIABLE: certificationEligible must be strictly true (got ${(evidence as any)?.certificationEligible}).`
    );
  }

  if (evidence.pricingWindow !== 'OFF_PEAK' && evidence.pricingWindow !== 'PEAK') {
    errors.push(`Invalid pricingWindow: '${evidence.pricingWindow}'. Expected 'OFF_PEAK' or 'PEAK'.`);
  }

  const expectedCandidate = evidence.pricingWindow === 'OFF_PEAK' ? OFF_PEAK_CANDIDATE : PEAK_CANDIDATE;
  if (evidence.candidateId !== expectedCandidate) {
    errors.push(`candidateId mismatch: expected '${expectedCandidate}', got '${evidence.candidateId}'.`);
  }

  if (evidence.executedInvocations !== REQUIRED_CANONICAL_INVOCATION_COUNT) {
    errors.push(
      `executedInvocations must be exactly ${REQUIRED_CANONICAL_INVOCATION_COUNT} (got ${evidence.executedInvocations}).`
    );
  }

  if (evidence.transportAttemptCount !== REQUIRED_CANONICAL_INVOCATION_COUNT) {
    errors.push(
      `transportAttemptCount must be exactly ${REQUIRED_CANONICAL_INVOCATION_COUNT} (got ${evidence.transportAttemptCount}).`
    );
  }

  if (evidence.completedRequiredMatrixCases !== REQUIRED_CANONICAL_INVOCATION_COUNT) {
    errors.push(
      `completedRequiredMatrixCases must be exactly ${REQUIRED_CANONICAL_INVOCATION_COUNT} (got ${evidence.completedRequiredMatrixCases}).`
    );
  }

  if (evidence.passedInvocations !== REQUIRED_CANONICAL_INVOCATION_COUNT) {
    errors.push(
      `passedInvocations must be exactly ${REQUIRED_CANONICAL_INVOCATION_COUNT} (got ${evidence.passedInvocations}).`
    );
  }

  if (evidence.failedInvocations !== 0) {
    errors.push(`failedInvocations must be strictly 0 (got ${evidence.failedInvocations}).`);
  }

  if (evidence.clientRetries !== 0) {
    errors.push(`clientRetries must be strictly 0 (got ${evidence.clientRetries}).`);
  }

  if (evidence.crossProviderFallbacks !== 0) {
    errors.push(`crossProviderFallbacks must be strictly 0 (got ${evidence.crossProviderFallbacks}).`);
  }

  if (evidence.automaticReruns !== 0) {
    errors.push(`automaticReruns must be strictly 0 (got ${evidence.automaticReruns}).`);
  }

  if (evidence.killSwitchEvents !== 0) {
    errors.push(`killSwitchEvents must be strictly 0 (got ${evidence.killSwitchEvents}).`);
  }

  if (evidence.provider !== CERTIFICATION_PROVIDER) {
    errors.push(`provider must be '${CERTIFICATION_PROVIDER}' (got '${evidence.provider}').`);
  }

  if (evidence.modelRequested !== CERTIFICATION_MODEL) {
    errors.push(`modelRequested must be '${CERTIFICATION_MODEL}' (got '${evidence.modelRequested}').`);
  }

  if (evidence.modelReturned !== CERTIFICATION_MODEL) {
    errors.push(`modelReturned must be '${CERTIFICATION_MODEL}' (got '${evidence.modelReturned}').`);
  }

  if (evidence.providerReportedUsageCount !== REQUIRED_CANONICAL_INVOCATION_COUNT) {
    errors.push(
      `providerReportedUsageCount must be 7/7 (got ${evidence.providerReportedUsageCount}/${REQUIRED_CANONICAL_INVOCATION_COUNT}).`
    );
  }

  if (evidence.schemaValidCount !== REQUIRED_CANONICAL_INVOCATION_COUNT) {
    errors.push(
      `schemaValidCount must be 7/7 (got ${evidence.schemaValidCount}/${REQUIRED_CANONICAL_INVOCATION_COUNT}).`
    );
  }

  if (evidence.taskPassCount !== REQUIRED_CANONICAL_INVOCATION_COUNT) {
    errors.push(
      `taskPassCount must be 7/7 (got ${evidence.taskPassCount}/${REQUIRED_CANONICAL_INVOCATION_COUNT}).`
    );
  }

  if (evidence.maxLatencyMs >= MAX_INVOCATION_LATENCY_MS) {
    errors.push(
      `maxLatencyMs (${evidence.maxLatencyMs}) exceeds hard timeout limit (${MAX_INVOCATION_LATENCY_MS} ms).`
    );
  }

  if (Array.isArray(evidence.latenciesMs)) {
    for (let i = 0; i < evidence.latenciesMs.length; i++) {
      if (evidence.latenciesMs[i] >= MAX_INVOCATION_LATENCY_MS) {
        errors.push(
          `Invocation ${i} latency (${evidence.latenciesMs[i]} ms) exceeds hard timeout (${MAX_INVOCATION_LATENCY_MS} ms).`
        );
      }
    }
  }

  if (evidence.aggregateSemanticScore < SEMANTIC_SCORE_MIN_THRESHOLD) {
    errors.push(
      `aggregateSemanticScore (${evidence.aggregateSemanticScore}) is below required threshold (${SEMANTIC_SCORE_MIN_THRESHOLD}).`
    );
  }

  if (evidence.privacyViolations !== 0) {
    errors.push(`privacyViolations must be strictly 0 (got ${evidence.privacyViolations}).`);
  }

  if (evidence.unexpectedNetworkAttempts !== 0) {
    errors.push(`unexpectedNetworkAttempts must be strictly 0 (got ${evidence.unexpectedNetworkAttempts}).`);
  }

  if (evidence.observedTotalCostMicroUsd > evidence.authorizedBudgetMicroUsd) {
    errors.push(
      `BUDGET_BREACH: observedTotalCostMicroUsd (${evidence.observedTotalCostMicroUsd}) exceeds authorized budget (${evidence.authorizedBudgetMicroUsd}).`
    );
  }

  const records = evidence.invocationRecords ?? [];

  if (records.length !== REQUIRED_CANONICAL_INVOCATION_COUNT) {
    errors.push(
      `invocationRecords must contain exactly ${REQUIRED_CANONICAL_INVOCATION_COUNT} items (got ${records.length}).`
    );
  }

  const seenCanonicalTasks = new Set<TaskType>();
  const duplicateTasks: string[] = [];
  const unknownTasks: string[] = [];

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const task = rec?.taskType as TaskType;

    if (!task || !CERTIFIED_A12B2C_TASK_TYPE_SET.has(task)) {
      unknownTasks.push(String(task ?? `record_${i}_undefined`));
    } else {
      if (seenCanonicalTasks.has(task)) {
        duplicateTasks.push(task);
      }
      seenCanonicalTasks.add(task);
    }

    if (!rec.success) {
      errors.push(`Invocation record ${i} (${rec.taskId}) failed.`);
    }
    if (rec.latencyMs >= MAX_INVOCATION_LATENCY_MS) {
      errors.push(`Invocation record ${i} latency (${rec.latencyMs} ms) breached timeout.`);
    }
    if (!rec.schemaValid) {
      errors.push(`Invocation record ${i} schema is invalid.`);
    }
    if (!rec.providerReportedUsage) {
      errors.push(`Invocation record ${i} missing provider-reported usage telemetry.`);
    }
    if (rec.privacyViolation) {
      errors.push(`Invocation record ${i} reported privacy violation.`);
    }
    if (rec.modelRequested !== CERTIFICATION_MODEL || rec.modelReturned !== CERTIFICATION_MODEL) {
      errors.push(`Invocation record ${i} model mismatch.`);
    }
  }

  if (unknownTasks.length > 0) {
    errors.push(
      `Unknown non-canonical taskTypes detected: [${unknownTasks.join(', ')}]. Expected only canonical CERTIFIED_A12B2C_TASK_TYPES.`
    );
  }

  if (duplicateTasks.length > 0) {
    errors.push(
      `Duplicate canonical taskTypes detected: [${duplicateTasks.join(', ')}]. Exactly one record per canonical task required.`
    );
  }

  const missingCanonicalTasks = CERTIFIED_A12B2C_TASK_TYPES.filter(
    (t) => !seenCanonicalTasks.has(t)
  );
  if (missingCanonicalTasks.length > 0) {
    errors.push(
      `Missing canonical taskTypes: [${missingCanonicalTasks.join(', ')}]. All ${REQUIRED_CANONICAL_INVOCATION_COUNT} canonical tasks must be present.`
    );
  }

  const passingCanonicalRecordsCount = records.filter(
    (r) => r.success && CERTIFIED_A12B2C_TASK_TYPE_SET.has(r.taskType as TaskType)
  ).length;

  if (evidence.taskPassCount !== passingCanonicalRecordsCount) {
    errors.push(
      `taskPassCount (${evidence.taskPassCount}) does not correspond to passing canonical records count (${passingCanonicalRecordsCount}).`
    );
  }

  if (evidence.completedRequiredMatrixCases !== seenCanonicalTasks.size) {
    errors.push(
      `completedRequiredMatrixCases (${evidence.completedRequiredMatrixCases}) does not correspond to unique canonical matrix cases executed (${seenCanonicalTasks.size}).`
    );
  }

  // Validate binding against authorization (mandatory for certification validation)
  if (options?.boundAuthorization) {
    const auth = options.boundAuthorization;

    // Structural validation of authorization evidence
    const authValidation = validateAuthorizationEvidence(auth);
    if (!authValidation.valid) {
      errors.push(...authValidation.errors.map((e) => `BOUND_AUTHORIZATION_INVALID: ${e}`));
    }

    // Exact program for pricing window
    const expectedProgram =
      evidence.pricingWindow === 'OFF_PEAK'
        ? OFF_PEAK_PROGRAM.programId
        : PEAK_PROGRAM.programId;
    if (auth.targetProgram !== expectedProgram) {
      errors.push(
        `targetProgram mismatch with authorization: expected '${expectedProgram}' for window '${evidence.pricingWindow}', got '${auth.targetProgram}'.`
      );
    }

    if (evidence.pricingWindow !== auth.pricingWindow) {
      errors.push(`Authorization window mismatch: auth is '${auth.pricingWindow}', evidence is '${evidence.pricingWindow}'.`);
    }
    if (evidence.candidateId !== auth.candidateId) {
      errors.push(
        `candidateId mismatch with authorization: auth is '${auth.candidateId}', evidence is '${evidence.candidateId}'.`
      );
    }
    if (evidence.sourceCommitSha !== auth.sourceCommitSha) {
      errors.push(
        `sourceCommitSha mismatch with authorization: auth is '${auth.sourceCommitSha}', evidence is '${evidence.sourceCommitSha}'.`
      );
    }
    if (evidence.sourceTreeSha !== auth.sourceTreeSha) {
      errors.push(
        `sourceTreeSha mismatch with authorization: auth is '${auth.sourceTreeSha}', evidence is '${evidence.sourceTreeSha}'.`
      );
    }
    if (evidence.runNonce !== auth.runNonce) {
      errors.push(`runNonce mismatch with authorization: auth is '${auth.runNonce}', evidence is '${evidence.runNonce}'.`);
    }
    if (evidence.authorizedBudgetMicroUsd !== auth.maxBudgetMicroUsd) {
      errors.push(
        `authorizedBudgetMicroUsd (${evidence.authorizedBudgetMicroUsd}) does not match authorization maxBudgetMicroUsd (${auth.maxBudgetMicroUsd}).`
      );
    }
  } else {
    errors.push(
      'CERTIFICATION_AUTHORIZATION_BINDING_REQUIRED: WindowCertificationEvidence requires boundAuthorization for certification validation. Standalone validation without authorization binding is prohibited.'
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validates All-Windows Certification Evidence.
 * Enforces strict AND condition between OFF_PEAK_CERTIFIED and PEAK_CERTIFIED.
 * Requires both offPeakAuthorization and peakAuthorization.
 */
export function validateAllWindowsCertificationEvidence(
  evidence: AllWindowsCertificationEvidence,
  options: {
    offPeakAuthorization: WindowAuthorizationEvidence;
    peakAuthorization: WindowAuthorizationEvidence;
  }
): ValidationResult {
  const errors: string[] = [];

  if (!options?.offPeakAuthorization) {
    errors.push('ALL_WINDOWS_AUTHORIZATION_REQUIRED: Missing required offPeakAuthorization for all-windows certification validation.');
  } else {
    if (options.offPeakAuthorization.pricingWindow !== 'OFF_PEAK') {
      errors.push(
        `Authorization window mismatch: offPeakAuthorization pricingWindow must be 'OFF_PEAK' (got '${options.offPeakAuthorization.pricingWindow}').`
      );
    }
    if (options.offPeakAuthorization.targetProgram !== OFF_PEAK_PROGRAM.programId) {
      errors.push(
        `targetProgram mismatch: offPeakAuthorization targetProgram must be '${OFF_PEAK_PROGRAM.programId}' (got '${options.offPeakAuthorization.targetProgram}').`
      );
    }
    if (options.offPeakAuthorization.candidateId !== OFF_PEAK_CANDIDATE) {
      errors.push(
        `candidateId mismatch: offPeakAuthorization candidateId must be '${OFF_PEAK_CANDIDATE}' (got '${options.offPeakAuthorization.candidateId}').`
      );
    }
  }

  if (!options?.peakAuthorization) {
    errors.push('ALL_WINDOWS_AUTHORIZATION_REQUIRED: Missing required peakAuthorization for all-windows certification validation.');
  } else {
    if (options.peakAuthorization.pricingWindow !== 'PEAK') {
      errors.push(
        `Authorization window mismatch: peakAuthorization pricingWindow must be 'PEAK' (got '${options.peakAuthorization.pricingWindow}').`
      );
    }
    if (options.peakAuthorization.targetProgram !== PEAK_PROGRAM.programId) {
      errors.push(
        `targetProgram mismatch: peakAuthorization targetProgram must be '${PEAK_PROGRAM.programId}' (got '${options.peakAuthorization.targetProgram}').`
      );
    }
    if (options.peakAuthorization.candidateId !== PEAK_CANDIDATE) {
      errors.push(
        `candidateId mismatch: peakAuthorization candidateId must be '${PEAK_CANDIDATE}' (got '${options.peakAuthorization.candidateId}').`
      );
    }
  }

  if (!evidence.offPeakEvidence) {
    errors.push('Missing offPeakEvidence artifact in all-windows evidence.');
  } else {
    const offPeakValidation = validateCertificationEvidence(evidence.offPeakEvidence, {
      boundAuthorization: options?.offPeakAuthorization,
    });
    if (!offPeakValidation.valid) {
      errors.push(...offPeakValidation.errors.map(e => `OFF_PEAK: ${e}`));
    }
    if (evidence.offPeakEvidence.pricingWindow !== 'OFF_PEAK') {
      errors.push(`offPeakEvidence pricingWindow must be 'OFF_PEAK' (got '${evidence.offPeakEvidence.pricingWindow}').`);
    }
  }

  if (!evidence.peakEvidence) {
    errors.push('Missing peakEvidence artifact in all-windows evidence.');
  } else {
    const peakValidation = validateCertificationEvidence(evidence.peakEvidence, {
      boundAuthorization: options?.peakAuthorization,
    });
    if (!peakValidation.valid) {
      errors.push(...peakValidation.errors.map(e => `PEAK: ${e}`));
    }
    if (evidence.peakEvidence.pricingWindow !== 'PEAK') {
      errors.push(`peakEvidence pricingWindow must be 'PEAK' (got '${evidence.peakEvidence.pricingWindow}').`);
    }
  }

  if (!evidence.offPeakArtifactHash || evidence.offPeakArtifactHash.trim().length === 0) {
    errors.push('offPeakArtifactHash must be a non-empty hash string.');
  }

  if (!evidence.peakArtifactHash || evidence.peakArtifactHash.trim().length === 0) {
    errors.push('peakArtifactHash must be a non-empty hash string.');
  }

  if (evidence.specificationVersion !== SUCCESSOR_SPECIFICATION_VERSION) {
    errors.push(
      `specificationVersion must be '${SUCCESSOR_SPECIFICATION_VERSION}' (got '${evidence.specificationVersion}').`
    );
  }

  if (!evidence.sourceCommitSha || !/^[0-9a-f]{40}$/i.test(evidence.sourceCommitSha)) {
    errors.push(`sourceCommitSha must be a 40-character hex commit SHA.`);
  }

  if (!evidence.sourceTreeSha || !/^[0-9a-f]{40}$/i.test(evidence.sourceTreeSha)) {
    errors.push(`sourceTreeSha must be a 40-character hex tree SHA.`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validates Routing Activation Eligibility Evidence.
 * Does NOT enable production routing; verifies prerequisite audit & certification artifacts.
 */
export function validateRoutingActivationEligibilityEvidence(
  evidence: RoutingActivationEligibilityEvidence,
  options: {
    offPeakAuthorization: WindowAuthorizationEvidence;
    peakAuthorization: WindowAuthorizationEvidence;
  }
): ValidationResult {
  const errors: string[] = [];

  const allWindowsValidation = validateAllWindowsCertificationEvidence(evidence.allWindowsEvidence, options);
  if (!allWindowsValidation.valid) {
    errors.push(...allWindowsValidation.errors);
  }

  if (!evidence.independentAuditCompleted) {
    errors.push('Independent audit must be completed before routing activation eligibility can be granted.');
  }

  if (!evidence.independentAuditReportId || evidence.independentAuditReportId.trim().length === 0) {
    errors.push('independentAuditReportId must be specified.');
  }

  if (!evidence.sourceSpecCompatibilityValidated) {
    errors.push('sourceSpecCompatibilityValidated must be true.');
  }

  // INVARIANT: productionRoutingEnforcementAllowed must remain false
  if (evidence.productionRoutingEnforcementAllowed !== false) {
    errors.push('CRITICAL_INVARIANT_VIOLATION: productionRoutingEnforcementAllowed must remain strictly false.');
  }

  // INVARIANT: live gate status must remain false
  if (evidence.liveGateStatus !== false || CANARY_LIVE_EXECUTION_ENABLED !== false) {
    errors.push('CRITICAL_INVARIANT_VIOLATION: Live gate must remain strictly disabled (false).');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ============================================================================
// 6. STATE TRANSITION PURE FUNCTIONS
// ============================================================================

/**
 * Checks whether an edge exists in the transition allowlist.
 */
export function canTransition(fromState: CertificationState, toState: CertificationState): boolean {
  const allowed = ALLOWED_TRANSITIONS[fromState];
  if (!allowed) return false;
  return allowed.includes(toState);
}

/**
 * Resolves the overall certification status given track states.
 * Proves that OFF_PEAK certification alone or PEAK certification alone does NOT yield ALL_WINDOWS_CERTIFIED.
 */
export function resolveOverallCertificationState(
  offPeakTrackState: TrackState,
  peakTrackState: TrackState,
  isRoutingEligible: boolean = false
): OverallCertificationState {
  if (isRoutingEligible) {
    return 'ROUTING_ACTIVATION_ELIGIBLE';
  }

  if (offPeakTrackState === 'FAILED_CLOSED' && peakTrackState === 'FAILED_CLOSED') {
    return 'FAILED_CLOSED';
  }

  if (offPeakTrackState === 'CERTIFIED' && peakTrackState === 'CERTIFIED') {
    return 'ALL_WINDOWS_CERTIFIED';
  }

  if (offPeakTrackState === 'CERTIFIED' && peakTrackState !== 'CERTIFIED') {
    return 'OFF_PEAK_ONLY_CERTIFIED';
  }

  if (peakTrackState === 'CERTIFIED' && offPeakTrackState !== 'CERTIFIED') {
    return 'PEAK_ONLY_CERTIFIED';
  }

  if (
    offPeakTrackState === 'NOT_READY' &&
    peakTrackState === 'NOT_READY'
  ) {
    return 'DRAFT_SEALED';
  }

  return 'CERTIFICATION_IN_PROGRESS';
}

/**
 * Deterministically verifies that supplied WindowCertificationEvidence
 * strictly matches previously-certified WindowCertificationEvidence stored in snapshot.
 */
function matchCertifiedEvidence(
  supplied: WindowCertificationEvidence,
  stored: WindowCertificationEvidence
): { matched: boolean; errors: string[] } {
  const errors: string[] = [];
  if (supplied.evidenceOrigin !== stored.evidenceOrigin) {
    errors.push(`evidenceOrigin mismatch: supplied '${supplied.evidenceOrigin}', certified '${stored.evidenceOrigin}'.`);
  }
  if (supplied.certificationEligible !== stored.certificationEligible) {
    errors.push(`certificationEligible mismatch: supplied '${supplied.certificationEligible}', certified '${stored.certificationEligible}'.`);
  }
  if (supplied.pricingWindow !== stored.pricingWindow) {
    errors.push(`pricingWindow mismatch: supplied '${supplied.pricingWindow}', certified '${stored.pricingWindow}'.`);
  }
  if (supplied.candidateId !== stored.candidateId) {
    errors.push(`candidateId mismatch: supplied '${supplied.candidateId}', certified '${stored.candidateId}'.`);
  }
  if (supplied.sourceCommitSha !== stored.sourceCommitSha) {
    errors.push(`sourceCommitSha mismatch: supplied '${supplied.sourceCommitSha}', certified '${stored.sourceCommitSha}'.`);
  }
  if (supplied.sourceTreeSha !== stored.sourceTreeSha) {
    errors.push(`sourceTreeSha mismatch: supplied '${supplied.sourceTreeSha}', certified '${stored.sourceTreeSha}'.`);
  }
  if (supplied.runNonce !== stored.runNonce) {
    errors.push(`runNonce mismatch: supplied '${supplied.runNonce}', certified '${stored.runNonce}'.`);
  }
  if (supplied.authorizedBudgetMicroUsd !== stored.authorizedBudgetMicroUsd) {
    errors.push(`authorizedBudgetMicroUsd mismatch: supplied '${supplied.authorizedBudgetMicroUsd}', certified '${stored.authorizedBudgetMicroUsd}'.`);
  }
  if (supplied.executedInvocations !== stored.executedInvocations) {
    errors.push(`executedInvocations mismatch: supplied '${supplied.executedInvocations}', certified '${stored.executedInvocations}'.`);
  }
  if (supplied.transportAttemptCount !== stored.transportAttemptCount) {
    errors.push(`transportAttemptCount mismatch: supplied '${supplied.transportAttemptCount}', certified '${stored.transportAttemptCount}'.`);
  }
  if (supplied.observedTotalCostMicroUsd !== stored.observedTotalCostMicroUsd) {
    errors.push(`observedTotalCostMicroUsd mismatch: supplied '${supplied.observedTotalCostMicroUsd}', certified '${stored.observedTotalCostMicroUsd}'.`);
  }

  const suppliedTasks = supplied.invocationRecords?.map((r) => `${r.taskId}:${r.taskType}`).join(',') ?? '';
  const storedTasks = stored.invocationRecords?.map((r) => `${r.taskId}:${r.taskType}`).join(',') ?? '';
  if (suppliedTasks !== storedTasks) {
    errors.push(`invocationRecords task identities mismatch.`);
  }

  return {
    matched: errors.length === 0,
    errors,
  };
}

/**
 * Applies a certification transition in a pure, fail-closed manner.
 * Rejects all illegal state transitions and returns an explicit rejection snapshot with error details.
 */
export function applyCertificationTransition(
  currentSnapshot: CertificationStateMachineSnapshot,
  targetState: CertificationState,
  payload?: {
    runnerReadinessEvidence?: RunnerReadinessEvidence;
    authorizationEvidence?: WindowAuthorizationEvidence;
    certificationEvidence?: WindowCertificationEvidence;
    allWindowsEvidence?: AllWindowsCertificationEvidence;
    routingEligibilityEvidence?: RoutingActivationEligibilityEvidence;
    boundAuthorization?: WindowAuthorizationEvidence;
    offPeakAuthorization?: WindowAuthorizationEvidence;
    peakAuthorization?: WindowAuthorizationEvidence;
    expectedCommitSha?: string;
    expectedTreeSha?: string;
    expectedNonce?: string;
    failureReason?: string;
  }
): TransitionResult {
  const fromState = currentSnapshot.currentState;
  const errors: string[] = [];

  // 1. Check basic graph transition validity
  if (!canTransition(fromState, targetState)) {
    return {
      success: false,
      snapshot: currentSnapshot,
      errors: [
        `ILLEGAL_STATE_TRANSITION: Cannot transition directly from '${fromState}' to '${targetState}'. Edge is not in the allowlist.`,
      ],
    };
  }

  // 2. Window-specific Runner Readiness transitions
  if (targetState === 'OFF_PEAK_RUNNER_READY' || targetState === 'PEAK_RUNNER_READY') {
    if (!payload?.runnerReadinessEvidence) {
      return {
        success: false,
        snapshot: currentSnapshot,
        errors: [`Missing RunnerReadinessEvidence for transition to '${targetState}'.`],
      };
    }

    const expectedWindow = targetState === 'OFF_PEAK_RUNNER_READY' ? 'OFF_PEAK' : 'PEAK';
    if (payload.runnerReadinessEvidence.pricingWindow !== expectedWindow) {
      return {
        success: false,
        snapshot: currentSnapshot,
        errors: [
          `Cross-window runner readiness rejected: requested '${targetState}' but evidence was for '${payload.runnerReadinessEvidence.pricingWindow}'.`,
        ],
      };
    }

    const validation = validateRunnerReadinessEvidence(payload.runnerReadinessEvidence);
    if (!validation.valid) {
      return {
        success: false,
        snapshot: currentSnapshot,
        errors: validation.errors,
      };
    }

    const newOffPeak = targetState === 'OFF_PEAK_RUNNER_READY' ? 'READY' : currentSnapshot.offPeakTrackState;
    const newPeak = targetState === 'PEAK_RUNNER_READY' ? 'READY' : currentSnapshot.peakTrackState;

    return {
      success: true,
      snapshot: {
        ...currentSnapshot,
        currentState: targetState,
        offPeakTrackState: newOffPeak,
        peakTrackState: newPeak,
        overallState: resolveOverallCertificationState(newOffPeak, newPeak),
      },
      errors: [],
    };
  }

  // 3. Window-specific Authorization Pending transitions
  if (targetState === 'OFF_PEAK_AUTHORIZATION_PENDING' || targetState === 'PEAK_AUTHORIZATION_PENDING') {
    const newOffPeak = targetState === 'OFF_PEAK_AUTHORIZATION_PENDING' ? 'AUTHORIZATION_PENDING' : currentSnapshot.offPeakTrackState;
    const newPeak = targetState === 'PEAK_AUTHORIZATION_PENDING' ? 'AUTHORIZATION_PENDING' : currentSnapshot.peakTrackState;

    return {
      success: true,
      snapshot: {
        ...currentSnapshot,
        currentState: targetState,
        offPeakTrackState: newOffPeak,
        peakTrackState: newPeak,
        overallState: resolveOverallCertificationState(newOffPeak, newPeak),
      },
      errors: [],
    };
  }

  // 4. Window-specific Authorized transitions
  if (targetState === 'OFF_PEAK_AUTHORIZED' || targetState === 'PEAK_AUTHORIZED') {
    if (!payload?.authorizationEvidence) {
      return {
        success: false,
        snapshot: currentSnapshot,
        errors: [`Missing WindowAuthorizationEvidence for transition to '${targetState}'.`],
      };
    }

    const expectedWindow = targetState === 'OFF_PEAK_AUTHORIZED' ? 'OFF_PEAK' : 'PEAK';
    if (payload.authorizationEvidence.pricingWindow !== expectedWindow) {
      return {
        success: false,
        snapshot: currentSnapshot,
        errors: [
          `Cross-window authorization rejected: requested '${targetState}' but authorization was for '${payload.authorizationEvidence.pricingWindow}'.`,
        ],
      };
    }

    const validation = validateAuthorizationEvidence(payload.authorizationEvidence, {
      expectedCommitSha: payload.expectedCommitSha,
      expectedTreeSha: payload.expectedTreeSha,
      expectedNonce: payload.expectedNonce,
      consumedAuthorizations: currentSnapshot.consumedAuthorizations,
    });

    if (!validation.valid) {
      return {
        success: false,
        snapshot: currentSnapshot,
        errors: validation.errors,
      };
    }

    // Mark authorization as consumed
    const authKey = `${payload.authorizationEvidence.targetProgram}:${payload.authorizationEvidence.pricingWindow}:${payload.authorizationEvidence.sourceCommitSha}:${payload.authorizationEvidence.runNonce}`;
    const digestKey = payload.authorizationEvidence.authorizationTokenDigest;
    const newConsumed = [...currentSnapshot.consumedAuthorizations, authKey, digestKey];

    const newOffPeak = targetState === 'OFF_PEAK_AUTHORIZED' ? 'AUTHORIZED' : currentSnapshot.offPeakTrackState;
    const newPeak = targetState === 'PEAK_AUTHORIZED' ? 'AUTHORIZED' : currentSnapshot.peakTrackState;

    return {
      success: true,
      snapshot: {
        ...currentSnapshot,
        currentState: targetState,
        offPeakTrackState: newOffPeak,
        peakTrackState: newPeak,
        overallState: resolveOverallCertificationState(newOffPeak, newPeak),
        consumedAuthorizations: newConsumed,
      },
      errors: [],
    };
  }

  // 5. Window-specific Certified transitions
  if (targetState === 'OFF_PEAK_CERTIFIED' || targetState === 'PEAK_CERTIFIED') {
    // Track state consistency enforcement (Section 7)
    if (targetState === 'OFF_PEAK_CERTIFIED') {
      if (currentSnapshot.currentState !== 'OFF_PEAK_AUTHORIZED' || currentSnapshot.offPeakTrackState !== 'AUTHORIZED') {
        return {
          success: false,
          snapshot: currentSnapshot,
          errors: [
            `TRACK_STATE_INCONSISTENCY: Transition to OFF_PEAK_CERTIFIED requires currentState === 'OFF_PEAK_AUTHORIZED' and offPeakTrackState === 'AUTHORIZED' (got currentState='${currentSnapshot.currentState}', offPeakTrackState='${currentSnapshot.offPeakTrackState}').`,
          ],
        };
      }
    }

    if (targetState === 'PEAK_CERTIFIED') {
      if (currentSnapshot.currentState !== 'PEAK_AUTHORIZED' || currentSnapshot.peakTrackState !== 'AUTHORIZED') {
        return {
          success: false,
          snapshot: currentSnapshot,
          errors: [
            `TRACK_STATE_INCONSISTENCY: Transition to PEAK_CERTIFIED requires currentState === 'PEAK_AUTHORIZED' and peakTrackState === 'AUTHORIZED' (got currentState='${currentSnapshot.currentState}', peakTrackState='${currentSnapshot.peakTrackState}').`,
          ],
        };
      }
    }

    if (!payload?.certificationEvidence) {
      return {
        success: false,
        snapshot: currentSnapshot,
        errors: [`Missing WindowCertificationEvidence for transition to '${targetState}'.`],
      };
    }

    const expectedWindow = targetState === 'OFF_PEAK_CERTIFIED' ? 'OFF_PEAK' : 'PEAK';
    if (payload.certificationEvidence.pricingWindow !== expectedWindow) {
      return {
        success: false,
        snapshot: currentSnapshot,
        errors: [
          `Cross-window certification rejected: requested '${targetState}' but evidence was for '${payload.certificationEvidence.pricingWindow}'.`,
        ],
      };
    }

    const transitionErrors: string[] = [];

    // Mandatory bound authorization check (Section 3)
    if (!payload?.boundAuthorization) {
      transitionErrors.push(
        `CERTIFICATION_AUTHORIZATION_BINDING_REQUIRED: Transition to '${targetState}' requires boundAuthorization in payload.`
      );
    } else {
      // Prove authorization was previously consumed (Section 4)
      const boundAuth = payload.boundAuthorization;
      const authKey = `${boundAuth.targetProgram}:${boundAuth.pricingWindow}:${boundAuth.sourceCommitSha}:${boundAuth.runNonce}`;
      const digestKey = boundAuth.authorizationTokenDigest;

      const consumedList = currentSnapshot.consumedAuthorizations ?? [];
      const hasAuthKey = consumedList.includes(authKey);
      const hasDigestKey = consumedList.includes(digestKey);

      if (!hasAuthKey || !hasDigestKey) {
        transitionErrors.push(
          `AUTHORIZATION_NOT_PREVIOUSLY_CONSUMED: boundAuthorization (authKey='${authKey}', digest='${digestKey}') was not previously consumed in snapshot. Consumed list contains: [${consumedList.join(', ')}].`
        );
      }
    }

    // Validate certification evidence and evidence-authorization binding (Sections 2, 5, 6, 8)
    const validation = validateCertificationEvidence(payload.certificationEvidence, {
      boundAuthorization: payload.boundAuthorization,
    });

    if (!validation.valid) {
      transitionErrors.push(...validation.errors);
    }

    if (transitionErrors.length > 0) {
      return {
        success: false,
        snapshot: currentSnapshot,
        errors: transitionErrors,
      };
    }

    const newOffPeak = targetState === 'OFF_PEAK_CERTIFIED' ? 'CERTIFIED' : currentSnapshot.offPeakTrackState;
    const newPeak = targetState === 'PEAK_CERTIFIED' ? 'CERTIFIED' : currentSnapshot.peakTrackState;

    return {
      success: true,
      snapshot: {
        ...currentSnapshot,
        currentState: targetState,
        offPeakTrackState: newOffPeak,
        peakTrackState: newPeak,
        overallState: resolveOverallCertificationState(newOffPeak, newPeak),
        offPeakEvidence: targetState === 'OFF_PEAK_CERTIFIED' ? payload.certificationEvidence : currentSnapshot.offPeakEvidence,
        peakEvidence: targetState === 'PEAK_CERTIFIED' ? payload.certificationEvidence : currentSnapshot.peakEvidence,
      },
      errors: [],
    };
  }

  // 6. Fail-Closed transitions
  if (targetState === 'OFF_PEAK_FAILED_CLOSED' || targetState === 'PEAK_FAILED_CLOSED') {
    const newOffPeak = targetState === 'OFF_PEAK_FAILED_CLOSED' ? 'FAILED_CLOSED' : currentSnapshot.offPeakTrackState;
    const newPeak = targetState === 'PEAK_FAILED_CLOSED' ? 'FAILED_CLOSED' : currentSnapshot.peakTrackState;

    return {
      success: true,
      snapshot: {
        ...currentSnapshot,
        currentState: targetState,
        offPeakTrackState: newOffPeak,
        peakTrackState: newPeak,
        overallState: resolveOverallCertificationState(newOffPeak, newPeak),
      },
      errors: payload?.failureReason ? [payload.failureReason] : [],
    };
  }

  // 7. All-Windows Certified transition
  if (targetState === 'ALL_WINDOWS_CERTIFIED') {
    // Both tracks must be in CERTIFIED state
    if (currentSnapshot.offPeakTrackState !== 'CERTIFIED' || currentSnapshot.peakTrackState !== 'CERTIFIED') {
      return {
        success: false,
        snapshot: currentSnapshot,
        errors: [
          `ALL_WINDOWS_RULE_VIOLATION: ALL_WINDOWS_CERTIFIED requires both OFF_PEAK_CERTIFIED and PEAK_CERTIFIED (current offPeak='${currentSnapshot.offPeakTrackState}', peak='${currentSnapshot.peakTrackState}').`,
        ],
      };
    }

    if (!payload?.allWindowsEvidence) {
      return {
        success: false,
        snapshot: currentSnapshot,
        errors: ['Missing AllWindowsCertificationEvidence for transition to ALL_WINDOWS_CERTIFIED.'],
      };
    }

    if (!currentSnapshot.offPeakEvidence || !currentSnapshot.peakEvidence) {
      return {
        success: false,
        snapshot: currentSnapshot,
        errors: ['ALL_WINDOWS_EVIDENCE_BINDING_ERROR: Snapshot is missing certified offPeakEvidence or peakEvidence.'],
      };
    }

    // Require both authorizations in payload (Section 6)
    if (!payload?.offPeakAuthorization || !payload?.peakAuthorization) {
      return {
        success: false,
        snapshot: currentSnapshot,
        errors: [
          'ALL_WINDOWS_AUTHORIZATION_REQUIRED: Transition to ALL_WINDOWS_CERTIFIED requires both offPeakAuthorization and peakAuthorization in payload.',
        ],
      };
    }

    const transitionErrors: string[] = [];

    // Prove OFF_PEAK authKey + digest are present in consumedAuthorizations
    const offPeakAuth = payload.offPeakAuthorization;
    const offPeakAuthKey = `${offPeakAuth.targetProgram}:${offPeakAuth.pricingWindow}:${offPeakAuth.sourceCommitSha}:${offPeakAuth.runNonce}`;
    const offPeakDigest = offPeakAuth.authorizationTokenDigest;

    // Prove PEAK authKey + digest are present in consumedAuthorizations
    const peakAuth = payload.peakAuthorization;
    const peakAuthKey = `${peakAuth.targetProgram}:${peakAuth.pricingWindow}:${peakAuth.sourceCommitSha}:${peakAuth.runNonce}`;
    const peakDigest = peakAuth.authorizationTokenDigest;

    const consumedList = currentSnapshot.consumedAuthorizations ?? [];
    if (!consumedList.includes(offPeakAuthKey) || !consumedList.includes(offPeakDigest)) {
      transitionErrors.push(
        `AUTHORIZATION_NOT_PREVIOUSLY_CONSUMED: offPeakAuthorization (authKey='${offPeakAuthKey}', digest='${offPeakDigest}') was not previously consumed in snapshot.`
      );
    }
    if (!consumedList.includes(peakAuthKey) || !consumedList.includes(peakDigest)) {
      transitionErrors.push(
        `AUTHORIZATION_NOT_PREVIOUSLY_CONSUMED: peakAuthorization (authKey='${peakAuthKey}', digest='${peakDigest}') was not previously consumed in snapshot.`
      );
    }

    // Aggregate actual certified evidence: verify match with stored snapshot evidence (Section 7)
    const offPeakMatch = matchCertifiedEvidence(
      payload.allWindowsEvidence.offPeakEvidence,
      currentSnapshot.offPeakEvidence
    );
    if (!offPeakMatch.matched) {
      transitionErrors.push(...offPeakMatch.errors.map((e) => `OFF_PEAK_EVIDENCE_SUBSTITUTION_REJECTED: ${e}`));
    }

    const peakMatch = matchCertifiedEvidence(
      payload.allWindowsEvidence.peakEvidence,
      currentSnapshot.peakEvidence
    );
    if (!peakMatch.matched) {
      transitionErrors.push(...peakMatch.errors.map((e) => `PEAK_EVIDENCE_SUBSTITUTION_REJECTED: ${e}`));
    }

    // Validate AllWindowsCertificationEvidence with authorizations
    const validation = validateAllWindowsCertificationEvidence(payload.allWindowsEvidence, {
      offPeakAuthorization: payload.offPeakAuthorization,
      peakAuthorization: payload.peakAuthorization,
    });
    if (!validation.valid) {
      transitionErrors.push(...validation.errors);
    }

    if (transitionErrors.length > 0) {
      return {
        success: false,
        snapshot: currentSnapshot,
        errors: transitionErrors,
      };
    }

    return {
      success: true,
      snapshot: {
        ...currentSnapshot,
        currentState: 'ALL_WINDOWS_CERTIFIED',
        overallState: 'ALL_WINDOWS_CERTIFIED',
        allWindowsEvidence: payload.allWindowsEvidence,
      },
      errors: [],
    };
  }

  // 8. Routing Activation Eligible transition
  if (targetState === 'ROUTING_ACTIVATION_ELIGIBLE') {
    if (currentSnapshot.currentState !== 'ALL_WINDOWS_CERTIFIED') {
      return {
        success: false,
        snapshot: currentSnapshot,
        errors: [
          `ROUTING_ACTIVATION_PRECONDITION_FAILED: currentState must be 'ALL_WINDOWS_CERTIFIED' (got '${currentSnapshot.currentState}').`,
        ],
      };
    }

    if (!payload?.routingEligibilityEvidence) {
      return {
        success: false,
        snapshot: currentSnapshot,
        errors: ['Missing RoutingActivationEligibilityEvidence.'],
      };
    }

    if (!payload?.offPeakAuthorization || !payload?.peakAuthorization) {
      return {
        success: false,
        snapshot: currentSnapshot,
        errors: [
          'ALL_WINDOWS_AUTHORIZATION_REQUIRED: Transition to ROUTING_ACTIVATION_ELIGIBLE requires both offPeakAuthorization and peakAuthorization in payload.',
        ],
      };
    }

    const validation = validateRoutingActivationEligibilityEvidence(payload.routingEligibilityEvidence, {
      offPeakAuthorization: payload.offPeakAuthorization,
      peakAuthorization: payload.peakAuthorization,
    });
    if (!validation.valid) {
      return {
        success: false,
        snapshot: currentSnapshot,
        errors: validation.errors,
      };
    }

    return {
      success: true,
      snapshot: {
        ...currentSnapshot,
        currentState: 'ROUTING_ACTIVATION_ELIGIBLE',
        overallState: 'ROUTING_ACTIVATION_ELIGIBLE',
        routingEligibilityEvidence: payload.routingEligibilityEvidence,
      },
      errors: [],
    };
  }

  // Fallback for unexpected state
  return {
    success: false,
    snapshot: currentSnapshot,
    errors: [`Unhandled transition to '${targetState}'.`],
  };
}
