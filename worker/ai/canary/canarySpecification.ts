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
  targetPhase: 'A.12B.2C-5B';
  approvalToken: string;
  maxBudgetUsd: number;
  environmentTarget: 'CONTROLLED_CANARY';
  specificationVersion: string;
  sourceCommitSha: string;
  runNonce: string;
  capabilitySecret?: string;
}

export interface HumanApprovalValidationOptions {
  capabilitySecret?: string;
  now?: () => Date;
  maxAgeSeconds?: number;
  allowSimulatedExpiryForTest?: boolean;
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
  targetPhase: 'A.12B.2C-5B';
  environmentTarget: 'CONTROLLED_CANARY';
  dateYyyyMmDd: string;
  maxBudgetUsd: number;
  approvalTimestamp: string;
  specificationVersion: string;
  sourceCommitSha: string;
  runNonce: string;
  capabilitySecret: string;
}

/**
 * Generates a cryptographically bound human approval token using HMAC-SHA256.
 * Requires a mandatory capabilitySecret. Public deterministic fallbacks are prohibited.
 * Token format: VELNAR_CANARY_APPROVED_PHASE_A12B2C5B_<YYYYMMDD>_<64_HEX_SIGNATURE>
 */
export function generateCanaryApprovalToken(params: GenerateApprovalTokenParams): string {
  if (!params.capabilitySecret || typeof params.capabilitySecret !== 'string' || params.capabilitySecret.trim().length < 16) {
    throw new Error('generateCanaryApprovalToken: capabilitySecret is mandatory and must be a secret string of at least 16 characters.');
  }

  const canonicalPayload = [
    params.approvedBy.trim(),
    params.targetPhase,
    params.environmentTarget,
    params.dateYyyyMmDd.trim(),
    params.maxBudgetUsd.toFixed(2),
    params.approvalTimestamp.trim(),
    params.specificationVersion.trim(),
    params.sourceCommitSha.trim(),
    params.runNonce.trim(),
  ].join(':');

  const signature = crypto.createHmac('sha256', params.capabilitySecret.trim())
    .update(canonicalPayload)
    .digest('hex');

  return `VELNAR_CANARY_APPROVED_PHASE_A12B2C5B_${params.dateYyyyMmDd}_${signature}`;
}

/**
 * Validates the human approval token against cryptographic bindings.
 * Token must follow exact pattern: VELNAR_CANARY_APPROVED_PHASE_A12B2C5B_<YYYYMMDD>_<64_HEX_SIGNATURE>
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

  if (approval.targetPhase !== 'A.12B.2C-5B') {
    return { valid: false, reason: `Target phase must be 'A.12B.2C-5B', received: '${approval.targetPhase}'.` };
  }

  if (approval.environmentTarget !== 'CONTROLLED_CANARY') {
    return { valid: false, reason: `Environment target must be 'CONTROLLED_CANARY', received: '${approval.environmentTarget}'.` };
  }

  if (!approval.approvedBy || typeof approval.approvedBy !== 'string' || approval.approvedBy.trim().length < 3) {
    return { valid: false, reason: 'ApprovedBy identifier is invalid or missing.' };
  }

  if (typeof approval.maxBudgetUsd !== 'number' || !Number.isFinite(approval.maxBudgetUsd) || approval.maxBudgetUsd <= 0 || approval.maxBudgetUsd > 0.05) {
    return { valid: false, reason: `maxBudgetUsd must be a finite number <= allowable canary ceiling of $0.05 (got $${approval.maxBudgetUsd}).` };
  }

  if (!approval.specificationVersion || approval.specificationVersion.trim() !== CANARY_SPECIFICATION_VERSION) {
    return { valid: false, reason: `Specification version must match '${CANARY_SPECIFICATION_VERSION}', received: '${approval.specificationVersion}'.` };
  }

  if (!approval.sourceCommitSha || typeof approval.sourceCommitSha !== 'string' || approval.sourceCommitSha.trim().length < 7) {
    return { valid: false, reason: 'sourceCommitSha is missing or invalid.' };
  }

  if (!approval.runNonce || typeof approval.runNonce !== 'string' || approval.runNonce.trim().length < 8) {
    return { valid: false, reason: 'runNonce is missing or invalid.' };
  }

  // Capability Secret is strictly MANDATORY
  const capabilitySecret = approval.capabilitySecret || options?.capabilitySecret;
  if (!capabilitySecret || typeof capabilitySecret !== 'string' || capabilitySecret.trim().length < 16) {
    return { valid: false, reason: 'Capability secret is mandatory for human approval verification and must be at least 16 characters (fail-closed).' };
  }

  // Token Format: Exactly 64 hexadecimal characters for SHA-256 HMAC (256 bits)
  const tokenPattern = /^VELNAR_CANARY_APPROVED_PHASE_A12B2C5B_(\d{8})_([A-Fa-f0-9]{64})$/;
  const match = approval.approvalToken ? approval.approvalToken.match(tokenPattern) : null;
  if (!match) {
    return { valid: false, reason: 'Approval token does not match required format VELNAR_CANARY_APPROVED_PHASE_A12B2C5B_<YYYYMMDD>_<64_HEX_SIGNATURE>.' };
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
    approval.maxBudgetUsd.toFixed(2),
    approval.approvalTimestamp.trim(),
    approval.specificationVersion.trim(),
    approval.sourceCommitSha.trim(),
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
