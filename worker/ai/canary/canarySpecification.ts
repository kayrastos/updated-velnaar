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

import { TaskType, DataClassification } from '../types';
import {
  CERTIFIED_A12B2C_TASK_TYPES,
  CertifiedProviderId,
  isCertifiedA12B2CTaskType,
} from '../providers/certifiedProviderTypes';

export const CANARY_SPECIFICATION_VERSION = 'a12b2c5-v1.0';

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
export const CERTIFIED_CANARY_NETWORK_ENDPOINTS: readonly string[] = [
  'https://api.deepseek.com/v1/chat/completions',
  'https://api.deepseek.com/chat/completions',
  'https://generativelanguage.googleapis.com/v1beta/interactions',
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
] as const;

export function isCanaryNetworkEndpointAllowed(url: string): boolean {
  return CERTIFIED_CANARY_NETWORK_ENDPOINTS.some(endpoint => url.startsWith(endpoint) || endpoint.startsWith(url.split('?')[0]));
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
  targetPhase: 'A.12B.2C-5B';
  approvalToken: string;
  maxBudgetUsd: number;
  environmentTarget: 'CONTROLLED_CANARY';
}

/**
 * Validates the human approval token.
 * Token must follow exact pattern: VELNAR_CANARY_APPROVED_PHASE_A12B2C5B_<YYYYMMDD>_<SIGNATURE>
 */
export function validateHumanApprovalToken(approval?: CanaryHumanApprovalEnvelope | null): {
  valid: boolean;
  reason?: string;
} {
  if (!approval) {
    return { valid: false, reason: 'Human approval envelope is missing (fail-closed).' };
  }

  if (approval.targetPhase !== 'A.12B.2C-5B') {
    return { valid: false, reason: `Target phase must be 'A.12B.2C-5B', received: '${approval.targetPhase}'.` };
  }

  if (approval.environmentTarget !== 'CONTROLLED_CANARY') {
    return { valid: false, reason: `Environment target must be 'CONTROLLED_CANARY', received: '${approval.environmentTarget}'.` };
  }

  if (!approval.approvedBy || approval.approvedBy.trim().length < 3) {
    return { valid: false, reason: 'ApprovedBy identifier is invalid or missing.' };
  }

  if (approval.maxBudgetUsd <= 0 || approval.maxBudgetUsd > 0.05) {
    return { valid: false, reason: `maxBudgetUsd exceeds allowable canary ceiling of $0.05 (got $${approval.maxBudgetUsd}).` };
  }

  const tokenPattern = /^VELNAR_CANARY_APPROVED_PHASE_A12B2C5B_\d{8}_[A-Fa-f0-9]{16,64}$/;
  if (!approval.approvalToken || !tokenPattern.test(approval.approvalToken)) {
    return { valid: false, reason: 'Approval token does not match required format VELNAR_CANARY_APPROVED_PHASE_A12B2C5B_<YYYYMMDD>_<SIGNATURE>.' };
  }

  return { valid: true };
}

/**
 * 9. Evidence Capture Artifact Schema
 */
export interface CanaryInvocationEvidenceRecord {
  invocationIndex: number;
  timestamp: string;
  taskType: TaskType;
  dataClassification: DataClassification;
  providerId: CertifiedProviderId;
  candidateId: string;
  requestedModelIdentifier: string;
  returnedModelIdentifier: string;
  providerModelVersion?: string;
  serviceTier?: string;
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
  killSwitchTriggered?: CanaryKillSwitchReason;
}

export interface CanaryExecutionEvidencePackage {
  phase: 'A.12B.2C-5A' | 'A.12B.2C-5B';
  specificationVersion: string;
  executionMode: 'DRY_RUN_READINESS_VERIFICATION' | 'LIVE_CONTROLLED_CANARY';
  timestamp: string;
  humanApproval: CanaryHumanApprovalEnvelope | null;
  overallStatus: 'CANARY_READY_AWAITING_HUMAN_APPROVAL' | 'CANARY_EXECUTION_PASSED' | 'CANARY_EXECUTION_FAILED' | 'CANARY_KILL_SWITCH_TERMINATED';
  summaryCounts: {
    totalPlannedInvocations: number;
    executedInvocations: number;
    passedInvocations: number;
    failedInvocations: number;
    killSwitchEventsCount: number;
    totalObservedCostMicroUsd: number;
    totalEstimatedCostMicroUsd: number;
    aggregateSemanticScore: number;
  };
  invocations: CanaryInvocationEvidenceRecord[];
  killSwitchEvents: CanaryKillSwitchEvent[];
  productionRoutingEnforcementAllowed: false; // Invariant
}
