/**
 * @file worker/ai/canary/deepSeekDurableAuthorizationReplayLedger.ts
 * @description VELNAR — A.12B.2C-5R Durable Single-Use Authorization Replay Ledger Foundation.
 *
 * STRICT ARCHITECTURAL INVARIANTS:
 * - Pure offline contract & verifier foundation only.
 * - ZERO DeepSeek calls.
 * - ZERO Gemini calls.
 * - ZERO external provider or network calls.
 * - ZERO provider credentials (no API keys, no bearer tokens).
 * - ZERO in-memory production fallback (no process-local cache, Set, Map, or module-level array).
 * - DURABLE_AUTHORIZATION_REPLAY_LEDGER_READY remains strictly false.
 * - DURABLE_AUTHORIZATION_REPLAY_BACKEND_BOUND remains strictly false.
 * - ATOMIC_RESERVE_IF_ABSENT_IMPLEMENTED remains strictly false.
 * - reserveProductionAuthorizationReplay fails closed with BACKEND_NOT_BOUND and NEVER returns RESERVED.
 */

import crypto from 'node:crypto';
import {
  SEALED_OFF_PEAK_PROGRAM_ID,
  SEALED_PEAK_PROGRAM_ID,
  SEALED_OFF_PEAK_CANDIDATE_ID,
  SEALED_PEAK_CANDIDATE_ID,
} from './deepSeekLiveCertificationTransportContract';
import {
  isValidIsoUtcTimestamp,
  canonicalizeHumanAuthorizationPayload,
  validateRunNonce,
  type CanonicalHumanAuthorizationPayload,
  type SignedHumanAuthorizationPackage,
  type TrustedSourceAttestation,
} from './deepSeekCertificationAttestation';
import {
  verifyProductionHumanAuthorizationPackage,
} from './deepSeekProductionAuthorizationTrust';

// ============================================================================
// 1. VERSION & READINESS CONSTANTS
// ============================================================================

export const DURABLE_AUTHORIZATION_REPLAY_LEDGER_VERSION = 'a12b2c5r-v1' as const;

/**
 * Operational readiness gate: strictly false in Phase 5R.
 * Durable single-use authorization replay protection is not yet operational.
 */
export const DURABLE_AUTHORIZATION_REPLAY_LEDGER_READY = false as const;

/**
 * Backend binding gate: strictly false in Phase 5R.
 * No production durable atomic backend is bound.
 */
export const DURABLE_AUTHORIZATION_REPLAY_BACKEND_BOUND = false as const;

/**
 * Atomic reserve implementation gate: strictly false in Phase 5R.
 * Atomic reserve-if-absent operation is not implemented.
 */
export const ATOMIC_RESERVE_IF_ABSENT_IMPLEMENTED = false as const;

// ============================================================================
// 2. CRITICAL SEMANTIC BOUNDARY & FUTURE GUARDED EXECUTION ORDER
// ============================================================================

/**
 * The mandatory execution order for future guarded execution:
 * 1. Trusted source verification
 * 2. Production human authorization verification
 * 3. Derive replay identity
 * 4. Durable atomic reserve-if-absent
 * 5. Canonical execution preflight
 * 6. Credential resolution
 * 7. Network transport dispatch
 *
 * NOTE: Phase 5R creates the contract and verifier boundary only.
 * Guarded live transport is NOT modified or integrated in Phase 5R.
 */
export const FUTURE_GUARDED_EXECUTION_ORDER = Object.freeze([
  'TRUSTED_SOURCE_VERIFICATION',
  'PRODUCTION_HUMAN_AUTHORIZATION_VERIFICATION',
  'DERIVE_REPLAY_IDENTITY',
  'DURABLE_ATOMIC_RESERVE_IF_ABSENT',
  'CANONICAL_EXECUTION_PREFLIGHT',
  'CREDENTIAL_RESOLUTION',
  'NETWORK_TRANSPORT',
] as const);

// ============================================================================
// 3. SCHEMA KEY ALLOWLISTS & FORBIDDEN OVERRIDE STRINGS
// ============================================================================

export const EXACT_REPLAY_IDENTITY_KEYS = Object.freeze([
  'authorityId',
  'keyVersion',
  'runNonce',
  'authorizationPayloadDigestSha256',
  'sourceAttestationDigest',
  'targetProgram',
  'pricingWindow',
  'candidateId',
] as const);

export const EXACT_RESERVATION_REQUEST_KEYS = Object.freeze([
  'ledgerVersion',
  'replayKey',
  'authorizationPayloadDigestSha256',
  'authorityId',
  'keyVersion',
  'runNonce',
  'expiresAt',
] as const);

export const FORBIDDEN_CALLER_OVERRIDE_KEYS = Object.freeze([
  'alreadyUsed',
  'reserved',
  'accepted',
  'durable',
  'atomic',
  'backendResult',
  'skipReplayCheck',
  'allowReplay',
  'forceReserve',
  'alreadyVerified',
  'testMode',
  'dryRunBypass',
  'backend',
  'storage',
  'adapter',
  'nowUtc',
  'atomicOverride',
  'ttl',
  'ttlMs',
  'retentionSeconds',
  'retentionMs',
  'overrideExpiry',
  'replayExpiry',
] as const);

export const FORBIDDEN_BUILDER_KEYS = Object.freeze([
  'replayKey',
  'expiresAt',
  'ttl',
  'ttlMs',
  'retentionSeconds',
  'retentionMs',
  'nowUtc',
  'overrideExpiry',
  'replayExpiry',
  'backend',
  'storage',
  'adapter',
] as const);

export const FORBIDDEN_PRODUCTION_ORCHESTRATION_KEYS = Object.freeze([
  'nowUtc',
  'verified',
  'authorized',
  'alreadyVerified',
  'verificationResult',
  'authority',
  'publicKey',
  'registry',
  'backend',
  'storage',
  'adapter',
  'replayKey',
  'expiresAt',
  'bypass',
] as const);

const SAFE_IDENTIFIER_REGEX = /^[a-zA-Z0-9_-]+$/;
const SAFE_KEY_VERSION_REGEX = /^[a-zA-Z0-9_.-]+$/;
const HEX_64_LOWER_REGEX = /^[0-9a-f]{64}$/;

function isObviousPlaceholder(id: string): boolean {
  const lower = id.toLowerCase().trim();
  const placeholders = [
    'placeholder',
    'dummy',
    'unknown',
    'undefined',
    'null',
    'mock',
    'none',
    'default',
    'sample',
    'test',
    'fake',
  ];
  return placeholders.includes(lower);
}

// ============================================================================
// 4. INTERFACES & SCHEMAS
// ============================================================================

/**
 * Immutable identity of a single-use human authorization.
 * Bound to the complete cryptographic identity, not merely runNonce alone.
 */
export interface AuthorizationReplayIdentity {
  readonly authorityId: string;
  readonly keyVersion: string;
  readonly runNonce: string;
  readonly authorizationPayloadDigestSha256: string;
  readonly sourceAttestationDigest: string;
  readonly targetProgram: string;
  readonly pricingWindow: 'OFF_PEAK' | 'PEAK';
  readonly candidateId: string;
}

/**
 * Reservation request contract for atomic reserve-if-absent.
 */
export interface AuthorizationReplayReservationRequest {
  readonly ledgerVersion: string;
  readonly replayKey: string;
  readonly authorizationPayloadDigestSha256: string;
  readonly authorityId: string;
  readonly keyVersion: string;
  readonly runNonce: string;
  readonly expiresAt: string;
}

/**
 * Status union for replay reservation results.
 */
export type AuthorizationReplayReservationStatus =
  | 'RESERVED'
  | 'ALREADY_RESERVED'
  | 'BACKEND_UNAVAILABLE'
  | 'BACKEND_NOT_BOUND'
  | 'INVALID_REQUEST';

/**
 * Result structure returned by reservation operations.
 */
export interface AuthorizationReplayReservationResult {
  readonly success: boolean;
  readonly status: AuthorizationReplayReservationStatus;
  readonly errors: readonly string[];
  readonly replayKey?: string;
  readonly reservedAt?: string;
  readonly expiresAt?: string;
}

/**
 * Interface for durable authorization replay backend.
 * Future implementation must be atomic, durable, cross-process, cross-worker,
 * cross-replica, and survive restarts with no check-then-set race conditions.
 */
export interface DurableAuthorizationReplayBackend {
  reserveIfAbsent(
    request: AuthorizationReplayReservationRequest
  ): Promise<AuthorizationReplayReservationResult> | AuthorizationReplayReservationResult;
}

/**
 * Status union for production replay reservation orchestration results.
 */
export type ProductionReplayReservationStatus =
  | 'AUTHORIZATION_NOT_VERIFIED'
  | 'AUTHORIZATION_EXPIRED'
  | 'CANONICAL_REPLAY_REQUEST_INVALID'
  | 'READY_FOR_DURABLE_RESERVATION';

/**
 * Result structure returned by buildProductionReplayReservationAfterAuthorizationVerification.
 */
export type ProductionReplayReservationOrchestrationResult =
  | {
      readonly ready: false;
      readonly status: 'AUTHORIZATION_NOT_VERIFIED';
      readonly failureReason?: string;
      readonly request?: never;
    }
  | {
      readonly ready: false;
      readonly status: 'AUTHORIZATION_EXPIRED';
      readonly failureReason: string;
      readonly request?: never;
    }
  | {
      readonly ready: false;
      readonly status: 'CANONICAL_REPLAY_REQUEST_INVALID';
      readonly failureReason: string;
      readonly request?: never;
    }
  | {
      readonly ready: true;
      readonly status: 'READY_FOR_DURABLE_RESERVATION';
      readonly request: AuthorizationReplayReservationRequest;
    };

// ============================================================================
// 5. VALIDATION: REPLAY IDENTITY
// ============================================================================

export interface ValidateReplayIdentityResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

/**
 * Strictly validates an AuthorizationReplayIdentity object.
 * Rejects unknown properties, missing properties, inherited-only properties, and type coercions.
 */
export function validateAuthorizationReplayIdentity(
  candidate: unknown
): ValidateReplayIdentityResult {
  const errors: string[] = [];

  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return {
      valid: false,
      errors: ['IDENTITY_INVALID: candidate must be a non-null, non-array object'],
    };
  }

  const obj = candidate as Record<string, unknown>;

  // 1. Own properties and unknown properties check
  const candidateKeys = Object.keys(obj);
  for (const key of candidateKeys) {
    if (!EXACT_REPLAY_IDENTITY_KEYS.includes(key as any)) {
      errors.push(`UNKNOWN_PROPERTY: unexpected property '${key}' in replay identity`);
    }
  }

  for (const key of EXACT_REPLAY_IDENTITY_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) {
      errors.push(`MISSING_PROPERTY: required property '${key}' is missing or inherited`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // 2. Exact string type validation (no coercion)
  for (const key of EXACT_REPLAY_IDENTITY_KEYS) {
    if (typeof obj[key] !== 'string') {
      errors.push(`TYPE_INVALID: property '${key}' must be a string without coercion`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const authorityId = obj.authorityId as string;
  const keyVersion = obj.keyVersion as string;
  const runNonce = obj.runNonce as string;
  const authorizationPayloadDigestSha256 = obj.authorizationPayloadDigestSha256 as string;
  const sourceAttestationDigest = obj.sourceAttestationDigest as string;
  const targetProgram = obj.targetProgram as string;
  const pricingWindow = obj.pricingWindow as string;
  const candidateId = obj.candidateId as string;

  // 3. Field-specific validations
  // authorityId
  if (authorityId.length < 1 || authorityId.length > 128) {
    errors.push(`AUTHORITY_ID_LENGTH: authorityId must be between 1 and 128 characters`);
  }
  if (!SAFE_IDENTIFIER_REGEX.test(authorityId)) {
    errors.push(`AUTHORITY_ID_FORMAT: authorityId contains invalid characters`);
  }
  if (isObviousPlaceholder(authorityId)) {
    errors.push(`AUTHORITY_ID_PLACEHOLDER: authorityId is a prohibited placeholder`);
  }

  // keyVersion
  if (keyVersion.length < 1 || keyVersion.length > 64) {
    errors.push(`KEY_VERSION_LENGTH: keyVersion must be between 1 and 64 characters`);
  }
  if (!SAFE_KEY_VERSION_REGEX.test(keyVersion)) {
    errors.push(`KEY_VERSION_FORMAT: keyVersion contains invalid characters`);
  }
  if (isObviousPlaceholder(keyVersion)) {
    errors.push(`KEY_VERSION_PLACEHOLDER: keyVersion is a prohibited placeholder`);
  }

  // runNonce
  const nonceValidation = validateRunNonce(runNonce);
  if (!nonceValidation.valid) {
    errors.push(`NONCE_INVALID: ${nonceValidation.error}`);
  }

  // authorizationPayloadDigestSha256
  if (!HEX_64_LOWER_REGEX.test(authorizationPayloadDigestSha256)) {
    errors.push(
      `PAYLOAD_DIGEST_INVALID: authorizationPayloadDigestSha256 must be a 64-char lowercase hex SHA-256`
    );
  }

  // sourceAttestationDigest
  if (!HEX_64_LOWER_REGEX.test(sourceAttestationDigest)) {
    errors.push(
      `SOURCE_DIGEST_INVALID: sourceAttestationDigest must be a 64-char lowercase hex SHA-256`
    );
  }

  // pricingWindow & targetProgram & candidateId correlation
  if (pricingWindow !== 'OFF_PEAK' && pricingWindow !== 'PEAK') {
    errors.push(`PRICING_WINDOW_INVALID: pricingWindow must be 'OFF_PEAK' or 'PEAK'`);
  } else if (pricingWindow === 'OFF_PEAK') {
    if (targetProgram !== SEALED_OFF_PEAK_PROGRAM_ID) {
      errors.push(
        `TARGET_PROGRAM_MISMATCH: expected '${SEALED_OFF_PEAK_PROGRAM_ID}' for OFF_PEAK, got '${targetProgram}'`
      );
    }
    if (candidateId !== SEALED_OFF_PEAK_CANDIDATE_ID) {
      errors.push(
        `CANDIDATE_ID_MISMATCH: expected '${SEALED_OFF_PEAK_CANDIDATE_ID}' for OFF_PEAK, got '${candidateId}'`
      );
    }
  } else if (pricingWindow === 'PEAK') {
    if (targetProgram !== SEALED_PEAK_PROGRAM_ID) {
      errors.push(
        `TARGET_PROGRAM_MISMATCH: expected '${SEALED_PEAK_PROGRAM_ID}' for PEAK, got '${targetProgram}'`
      );
    }
    if (candidateId !== SEALED_PEAK_CANDIDATE_ID) {
      errors.push(
        `CANDIDATE_ID_MISMATCH: expected '${SEALED_PEAK_CANDIDATE_ID}' for PEAK, got '${candidateId}'`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ============================================================================
// 6. REPLAY KEY DERIVATION
// ============================================================================

/**
 * Deterministically computes the SHA-256 lowercase hex replay key from AuthorizationReplayIdentity.
 * Validates exact schema first, serializes in fixed key order without RFC-8785 claim.
 */
export function computeAuthorizationReplayKey(identity: AuthorizationReplayIdentity): string {
  const validation = validateAuthorizationReplayIdentity(identity);
  if (!validation.valid) {
    throw new Error(
      `REPLAY_KEY_DERIVATION_FAILED: Invalid replay identity: ${validation.errors.join('; ')}`
    );
  }

  // Fixed-order deterministic serialization
  const fixedOrder = {
    authorityId: identity.authorityId,
    keyVersion: identity.keyVersion,
    runNonce: identity.runNonce,
    authorizationPayloadDigestSha256: identity.authorizationPayloadDigestSha256,
    sourceAttestationDigest: identity.sourceAttestationDigest,
    targetProgram: identity.targetProgram,
    pricingWindow: identity.pricingWindow,
    candidateId: identity.candidateId,
  };

  const serialized = JSON.stringify(fixedOrder);
  return crypto.createHash('sha256').update(serialized, 'utf8').digest('hex');
}

// ============================================================================
// 7. VALIDATION: RESERVATION REQUEST
// ============================================================================

export interface ValidateReservationRequestResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

/**
 * Strictly validates an AuthorizationReplayReservationRequest.
 * Rejects unknown, missing, inherited, or caller-controlled bypass fields.
 */
export function validateAuthorizationReplayReservationRequest(
  candidate: unknown
): ValidateReservationRequestResult {
  const errors: string[] = [];

  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return {
      valid: false,
      errors: ['REQUEST_INVALID: candidate must be a non-null, non-array object'],
    };
  }

  const obj = candidate as Record<string, unknown>;

  // Check for forbidden caller override or bypass fields
  for (const forbiddenKey of FORBIDDEN_CALLER_OVERRIDE_KEYS) {
    if (forbiddenKey in obj) {
      errors.push(`FORBIDDEN_CALLER_OVERRIDE: caller override field '${forbiddenKey}' is strictly prohibited`);
    }
  }

  // Own properties and unknown properties check
  const candidateKeys = Object.keys(obj);
  for (const key of candidateKeys) {
    if (!EXACT_RESERVATION_REQUEST_KEYS.includes(key as any)) {
      errors.push(`UNKNOWN_PROPERTY: unexpected property '${key}' in reservation request`);
    }
  }

  for (const key of EXACT_RESERVATION_REQUEST_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) {
      errors.push(`MISSING_PROPERTY: required property '${key}' is missing or inherited`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Exact string types check
  for (const key of EXACT_RESERVATION_REQUEST_KEYS) {
    if (typeof obj[key] !== 'string') {
      errors.push(`TYPE_INVALID: property '${key}' must be a string without coercion`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const ledgerVersion = obj.ledgerVersion as string;
  const replayKey = obj.replayKey as string;
  const authorizationPayloadDigestSha256 = obj.authorizationPayloadDigestSha256 as string;
  const authorityId = obj.authorityId as string;
  const keyVersion = obj.keyVersion as string;
  const runNonce = obj.runNonce as string;
  const expiresAt = obj.expiresAt as string;

  // ledgerVersion must match exact version
  if (ledgerVersion !== DURABLE_AUTHORIZATION_REPLAY_LEDGER_VERSION) {
    errors.push(
      `LEDGER_VERSION_MISMATCH: expected '${DURABLE_AUTHORIZATION_REPLAY_LEDGER_VERSION}', got '${ledgerVersion}'`
    );
  }

  // replayKey format
  if (!HEX_64_LOWER_REGEX.test(replayKey)) {
    errors.push(`REPLAY_KEY_INVALID: replayKey must be a 64-char lowercase hex SHA-256`);
  }

  // authorizationPayloadDigestSha256 format
  if (!HEX_64_LOWER_REGEX.test(authorizationPayloadDigestSha256)) {
    errors.push(
      `PAYLOAD_DIGEST_INVALID: authorizationPayloadDigestSha256 must be a 64-char lowercase hex SHA-256`
    );
  }

  // authorityId format
  if (authorityId.length < 1 || authorityId.length > 128 || !SAFE_IDENTIFIER_REGEX.test(authorityId)) {
    errors.push(`AUTHORITY_ID_INVALID: authorityId must be a safe non-empty identifier`);
  }

  // keyVersion format
  if (keyVersion.length < 1 || keyVersion.length > 64 || !SAFE_KEY_VERSION_REGEX.test(keyVersion)) {
    errors.push(`KEY_VERSION_INVALID: keyVersion must be a safe non-empty version identifier`);
  }

  // runNonce format
  const nonceValidation = validateRunNonce(runNonce);
  if (!nonceValidation.valid) {
    errors.push(`NONCE_INVALID: ${nonceValidation.error}`);
  }

  // expiresAt must be strict ISO-8601 UTC timestamp with calendar validity
  if (!isValidIsoUtcTimestamp(expiresAt)) {
    errors.push(`EXPIRES_AT_INVALID: expiresAt must be a valid UTC ISO-8601 timestamp string`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ============================================================================
// 8. AUTHORIZATION DIGEST & REPLAY IDENTITY BUILDER
// ============================================================================

/**
 * Computes the SHA-256 lowercase hex digest of the canonical human authorization payload.
 */
export function computeCanonicalAuthorizationPayloadDigestSha256(
  payload: CanonicalHumanAuthorizationPayload
): string {
  const canonicalString = canonicalizeHumanAuthorizationPayload(payload);
  return crypto.createHash('sha256').update(canonicalString, 'utf8').digest('hex');
}

/**
 * Pure helper to derive AuthorizationReplayIdentity from canonical authorization data.
 *
 * CRITICAL SECURITY INVARIANT:
 * THESE PURE HELPERS DO NOT VERIFY SIGNATURES.
 * THESE PURE HELPERS DO NOT ESTABLISH PRODUCTION AUTHORIZATION.
 * THEY ARE CANONICAL DATA TRANSFORMATION / CONSISTENCY HELPERS ONLY.
 *
 * Input must be based on canonical authorization data.
 * Does NOT accept caller-supplied replayKey.
 * Rejects if singleUse !== true.
 */
export function deriveReplayIdentityFromCanonicalAuthorization(
  auth:
    | SignedHumanAuthorizationPackage
    | {
        payload: CanonicalHumanAuthorizationPayload;
        keyVersion: string;
        authorityId?: string;
      }
): AuthorizationReplayIdentity {
  if (!auth || typeof auth !== 'object') {
    throw new Error('DERIVE_REPLAY_IDENTITY_FAILED: auth package must be a non-null object');
  }

  const payload = 'payload' in auth ? auth.payload : null;
  if (!payload || typeof payload !== 'object') {
    throw new Error('DERIVE_REPLAY_IDENTITY_FAILED: auth package must contain a valid canonical payload');
  }

  if (payload.singleUse !== true) {
    throw new Error(
      'SINGLE_USE_REQUIRED: singleUse must be strictly true for single-use authorization replay tracking'
    );
  }

  const keyVersion = 'keyVersion' in auth && typeof auth.keyVersion === 'string' ? auth.keyVersion : '';
  if (!keyVersion) {
    throw new Error('DERIVE_REPLAY_IDENTITY_FAILED: keyVersion must be a non-empty string');
  }

  // Implementation C: Authority Consistency Hardening
  // If package-level authorityId is provided, it MUST equal payload.authorityId
  if ('authorityId' in auth && (auth as any).authorityId !== undefined) {
    const pkgAuthId = (auth as any).authorityId;
    if (typeof pkgAuthId !== 'string' || !pkgAuthId) {
      throw new Error('AUTHORITY_MISMATCH: package authorityId must be a non-empty string when present');
    }
    if (pkgAuthId !== payload.authorityId) {
      throw new Error(
        `AUTHORITY_MISMATCH: Package authorityId '${pkgAuthId}' does not match payload authorityId '${payload.authorityId}'`
      );
    }
  }

  const authorityId = payload.authorityId;

  const authorizationPayloadDigestSha256 = computeCanonicalAuthorizationPayloadDigestSha256(payload);

  const identity: AuthorizationReplayIdentity = {
    authorityId,
    keyVersion,
    runNonce: payload.runNonce,
    authorizationPayloadDigestSha256,
    sourceAttestationDigest: payload.sourceAttestationDigest,
    targetProgram: payload.targetProgram,
    pricingWindow: payload.pricingWindow,
    candidateId: payload.candidateId,
  };

  const validation = validateAuthorizationReplayIdentity(identity);
  if (!validation.valid) {
    throw new Error(
      `DERIVE_REPLAY_IDENTITY_FAILED: Derived identity is invalid: ${validation.errors.join('; ')}`
    );
  }

  return identity;
}

// ============================================================================
// 9. PHASE 5R.1: CANONICAL RESERVATION BUILDER & EXACT EXPIRY BINDING
// ============================================================================

/**
 * A durable replay reservation MUST NOT expire before the signed authorization
 * expires.
 *
 * Shorter replay retention would reopen a still-valid authorization for replay.
 *
 * Phase 5R.1 therefore uses exact signed authorization expiry binding.
 */

export interface ValidateReplayReservationBindingResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

/**
 * Canonical builder that derives an AuthorizationReplayReservationRequest
 * from a canonical human authorization package.
 *
 * CRITICAL SECURITY INVARIANT:
 * THESE PURE HELPERS DO NOT VERIFY SIGNATURES.
 * THESE PURE HELPERS DO NOT ESTABLISH PRODUCTION AUTHORIZATION.
 * THEY ARE CANONICAL DATA TRANSFORMATION / CONSISTENCY HELPERS ONLY.
 *
 * INVARIANTS:
 * - Requires canonical authorization payload
 * - Requires singleUse === true
 * - Reuses deriveReplayIdentityFromCanonicalAuthorization(auth)
 * - Computes replayKey internally using computeAuthorizationReplayKey(...)
 * - Computes/uses authorization payload digest internally
 * - Sets expiresAt EXACTLY from auth.payload.expiresAt
 * - Rejects any caller-supplied replayKey, expiresAt, ttl, retention, override, backend, etc.
 */
export function buildAuthorizationReplayReservationRequestFromCanonicalAuthorization(
  auth:
    | SignedHumanAuthorizationPackage
    | {
        payload: CanonicalHumanAuthorizationPayload;
        keyVersion: string;
        authorityId?: string;
      }
): AuthorizationReplayReservationRequest {
  if (arguments.length !== 1) {
    throw new Error(
      'FORBIDDEN_CALLER_PARAMETER: builder accepts exactly one canonical authorization parameter'
    );
  }

  if (!auth || typeof auth !== 'object' || Array.isArray(auth)) {
    throw new Error('BUILD_REPLAY_RESERVATION_REQUEST_FAILED: auth package must be a non-null object');
  }

  const authRecord = auth as Record<string, unknown>;

  // Reject forbidden caller parameters/overrides
  for (const forbiddenKey of FORBIDDEN_BUILDER_KEYS) {
    if (forbiddenKey in authRecord) {
      throw new Error(
        `FORBIDDEN_CALLER_OVERRIDE: caller parameter '${forbiddenKey}' is strictly prohibited in reservation request builder`
      );
    }
  }

  const payload = 'payload' in authRecord ? authRecord.payload : null;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('BUILD_REPLAY_RESERVATION_REQUEST_FAILED: auth package must contain a valid canonical payload');
  }

  const payloadRecord = payload as Record<string, unknown>;
  for (const forbiddenKey of ['ttl', 'ttlMs', 'retentionSeconds', 'retentionMs', 'nowUtc', 'overrideExpiry', 'replayExpiry', 'backend', 'storage', 'adapter']) {
    if (forbiddenKey in payloadRecord) {
      throw new Error(
        `FORBIDDEN_CALLER_OVERRIDE: caller parameter '${forbiddenKey}' is strictly prohibited in authorization payload`
      );
    }
  }

  // Derive replay identity (enforces singleUse === true, authority consistency, keyVersion, schema)
  const derivedIdentity = deriveReplayIdentityFromCanonicalAuthorization(auth as any);

  // Compute replay key internally
  const computedReplayKey = computeAuthorizationReplayKey(derivedIdentity);

  const request: AuthorizationReplayReservationRequest = {
    ledgerVersion: DURABLE_AUTHORIZATION_REPLAY_LEDGER_VERSION,
    replayKey: computedReplayKey,
    authorizationPayloadDigestSha256: derivedIdentity.authorizationPayloadDigestSha256,
    authorityId: derivedIdentity.authorityId,
    keyVersion: derivedIdentity.keyVersion,
    runNonce: derivedIdentity.runNonce,
    expiresAt: (payload as CanonicalHumanAuthorizationPayload).expiresAt,
  };

  const validation = validateAuthorizationReplayReservationRequest(request);
  if (!validation.valid) {
    throw new Error(
      `BUILD_REPLAY_RESERVATION_REQUEST_FAILED: Built reservation request failed validation: ${validation.errors.join('; ')}`
    );
  }

  return Object.freeze(request);
}

/**
 * Validates an AuthorizationReplayReservationRequest against the canonical authorization package.
 *
 * CRITICAL SECURITY INVARIANT:
 * THESE PURE HELPERS DO NOT VERIFY SIGNATURES.
 * THESE PURE HELPERS DO NOT ESTABLISH PRODUCTION AUTHORIZATION.
 * THEY ARE CANONICAL DATA TRANSFORMATION / CONSISTENCY HELPERS ONLY.
 *
 * INVARIANTS:
 * 1. Existing reservation request validator passes
 * 2. Auth contains canonical authorization payload
 * 3. singleUse === true
 * 4. Derives replay identity from auth using deriveReplayIdentityFromCanonicalAuthorization
 * 5. Recomputes replayKey
 * 6. EXACT equality on:
 *    - replayKey === computedReplayKey
 *    - authorizationPayloadDigestSha256 === derivedIdentity.authorizationPayloadDigestSha256
 *    - authorityId === derivedIdentity.authorityId
 *    - keyVersion === derivedIdentity.keyVersion
 *    - runNonce === derivedIdentity.runNonce
 *    - expiresAt === auth.payload.expiresAt
 *
 * Any mismatch fails closed with valid: false and descriptive error messages.
 */
export function validateReplayReservationAgainstCanonicalAuthorization(
  request: unknown,
  auth: unknown
): ValidateReplayReservationBindingResult {
  const errors: string[] = [];

  // Step 1: Existing reservation request validation
  const reqValidation = validateAuthorizationReplayReservationRequest(request);
  if (!reqValidation.valid) {
    errors.push(...reqValidation.errors);
  }

  // Step 2: Auth package validation
  if (!auth || typeof auth !== 'object' || Array.isArray(auth)) {
    errors.push('AUTH_INVALID: auth must be a non-null, non-array object');
    return { valid: false, errors };
  }

  const authRecord = auth as Record<string, unknown>;
  const payload = authRecord.payload as CanonicalHumanAuthorizationPayload | undefined;

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    errors.push('AUTH_INVALID: auth must contain a valid canonical authorization payload');
    return { valid: false, errors };
  }

  // Step 3: singleUse check
  if (payload.singleUse !== true) {
    errors.push(
      'SINGLE_USE_REQUIRED: singleUse must be strictly true for single-use authorization replay tracking'
    );
  }

  // Step 4 & 5: Derive replay identity & recompute replayKey
  let derivedIdentity: AuthorizationReplayIdentity | null = null;
  let computedReplayKey: string | null = null;

  try {
    derivedIdentity = deriveReplayIdentityFromCanonicalAuthorization(auth as any);
    computedReplayKey = computeAuthorizationReplayKey(derivedIdentity);
  } catch (err: any) {
    errors.push(`DERIVE_REPLAY_IDENTITY_FAILED: ${err?.message || String(err)}`);
  }

  // If request itself is not a valid request object or identity could not be derived, return now
  if (!reqValidation.valid || !derivedIdentity || !computedReplayKey) {
    return { valid: false, errors };
  }

  const req = request as AuthorizationReplayReservationRequest;

  // Step 6: EXACT equality checks
  if (req.replayKey !== computedReplayKey) {
    errors.push(
      `REPLAY_KEY_MISMATCH: reservation replayKey '${req.replayKey}' does not match computed authorization replay key '${computedReplayKey}'`
    );
  }

  if (req.authorizationPayloadDigestSha256 !== derivedIdentity.authorizationPayloadDigestSha256) {
    errors.push(
      `PAYLOAD_DIGEST_MISMATCH: reservation authorizationPayloadDigestSha256 '${req.authorizationPayloadDigestSha256}' does not match derived digest '${derivedIdentity.authorizationPayloadDigestSha256}'`
    );
  }

  if (req.authorityId !== derivedIdentity.authorityId) {
    errors.push(
      `AUTHORITY_ID_MISMATCH: reservation authorityId '${req.authorityId}' does not match derived authorityId '${derivedIdentity.authorityId}'`
    );
  }

  if (req.keyVersion !== derivedIdentity.keyVersion) {
    errors.push(
      `KEY_VERSION_MISMATCH: reservation keyVersion '${req.keyVersion}' does not match derived keyVersion '${derivedIdentity.keyVersion}'`
    );
  }

  if (req.runNonce !== derivedIdentity.runNonce) {
    errors.push(
      `NONCE_MISMATCH: reservation runNonce '${req.runNonce}' does not match derived runNonce '${derivedIdentity.runNonce}'`
    );
  }

  if (req.expiresAt !== payload.expiresAt) {
    errors.push(
      `EXPIRES_AT_MISMATCH: reservation expiresAt '${req.expiresAt}' does not match authorization payload expiresAt '${payload.expiresAt}'`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ============================================================================
// 10. PRODUCTION ORCHESTRATION BOUNDARY (VERIFIED AUTHORIZATION -> REPLAY RESERVATION)
// ============================================================================

/**
 * Trusted production orchestration boundary for deriving replay reservations
 * strictly following verified production human authorization.
 *
 * CRITICAL ARCHITECTURAL BOUNDARY:
 * 1. Invokes verifyProductionHumanAuthorizationPackage(pkg, sourceAttestation) internally.
 * 2. Does NOT accept caller-supplied verification booleans, results, or trust tokens.
 * 3. Fails closed immediately if verification.verified !== true.
 * 4. Performs fresh runtime clock expiry check using new Date() internally (no caller time override).
 * 5. Builds canonical replay reservation request via buildAuthorizationReplayReservationRequestFromCanonicalAuthorization(pkg).
 * 6. Validates binding via validateReplayReservationAgainstCanonicalAuthorization(request, pkg).
 * 7. Returns structured result with status 'READY_FOR_DURABLE_RESERVATION' only upon full pass.
 *
 * NOTE: A later guarded-transport integration phase MUST perform another trusted runtime
 * expiry check immediately before credential resolution.
 */
export function buildProductionReplayReservationAfterAuthorizationVerification(
  pkg: SignedHumanAuthorizationPackage,
  sourceAttestation: TrustedSourceAttestation
): ProductionReplayReservationOrchestrationResult {
  if (arguments.length !== 2) {
    return {
      ready: false,
      status: 'AUTHORIZATION_NOT_VERIFIED',
      failureReason:
        'FORBIDDEN_CALLER_PARAMETER: orchestration accepts exactly pkg and sourceAttestation',
    };
  }

  // Reject caller override fields on pkg
  if (pkg && typeof pkg === 'object') {
    const pkgRecord = pkg as Record<string, unknown>;
    for (const forbiddenKey of FORBIDDEN_PRODUCTION_ORCHESTRATION_KEYS) {
      if (forbiddenKey in pkgRecord) {
        return {
          ready: false,
          status: 'AUTHORIZATION_NOT_VERIFIED',
          failureReason: `FORBIDDEN_CALLER_OVERRIDE: caller parameter '${forbiddenKey}' is strictly prohibited`,
        };
      }
    }
  }

  // Reject caller override fields on sourceAttestation
  if (sourceAttestation && typeof sourceAttestation === 'object') {
    const sourceRecord = sourceAttestation as Record<string, unknown>;
    for (const forbiddenKey of FORBIDDEN_PRODUCTION_ORCHESTRATION_KEYS) {
      if (forbiddenKey in sourceRecord) {
        return {
          ready: false,
          status: 'AUTHORIZATION_NOT_VERIFIED',
          failureReason: `FORBIDDEN_CALLER_OVERRIDE: caller parameter '${forbiddenKey}' is strictly prohibited`,
        };
      }
    }
  }

  // 1. Verify production human authorization package internally
  const verification = verifyProductionHumanAuthorizationPackage(pkg, sourceAttestation);
  if (!verification || verification.verified !== true) {
    return {
      ready: false,
      status: 'AUTHORIZATION_NOT_VERIFIED',
      failureReason: verification?.failureReason ?? 'AUTHORIZATION_NOT_VERIFIED',
    };
  }

  // 2. Fresh runtime expiry check using new Date() internally
  // Require: Date.parse(pkg.payload.expiresAt) > runtimeNow
  const expiresAtStr = pkg?.payload?.expiresAt;
  if (!expiresAtStr || typeof expiresAtStr !== 'string') {
    return {
      ready: false,
      status: 'CANONICAL_REPLAY_REQUEST_INVALID',
      failureReason: 'EXPIRES_AT_MISSING: pkg.payload.expiresAt is missing or invalid',
    };
  }
  const runtimeNow = new Date().getTime();
  const expiresAtMs = Date.parse(expiresAtStr);
  if (isNaN(expiresAtMs) || expiresAtMs <= runtimeNow) {
    return {
      ready: false,
      status: 'AUTHORIZATION_EXPIRED',
      failureReason: 'AUTHORIZATION_EXPIRED: authorization has expired or is at exact expiry at runtime evaluation',
    };
  }

  // 3. Build canonical reservation request
  let builtRequest: AuthorizationReplayReservationRequest;
  try {
    builtRequest = buildAuthorizationReplayReservationRequestFromCanonicalAuthorization(pkg);
  } catch (err: any) {
    return {
      ready: false,
      status: 'CANONICAL_REPLAY_REQUEST_INVALID',
      failureReason: `CANONICAL_REPLAY_BUILD_FAILED: ${err?.message || String(err)}`,
    };
  }

  // 4. Validate reservation against canonical authorization
  const bindingValidation = validateReplayReservationAgainstCanonicalAuthorization(builtRequest, pkg);
  if (!bindingValidation.valid) {
    return {
      ready: false,
      status: 'CANONICAL_REPLAY_REQUEST_INVALID',
      failureReason: `CANONICAL_REPLAY_VALIDATION_FAILED: ${bindingValidation.errors.join('; ')}`,
    };
  }

  // 5. Success: ready for durable reservation
  return {
    ready: true,
    status: 'READY_FOR_DURABLE_RESERVATION',
    request: builtRequest,
  };
}

// ============================================================================
// 11. PRODUCTION RESERVATION ENTRYPOINT (FAIL-CLOSED)
// ============================================================================

/**
 * Production reservation entrypoint.
 *
 * INVARIANTS:
 * - Does NOT accept any backend parameter.
 * - Does NOT accept any storage adapter or store parameter.
 * - Does NOT accept any bypass or override flags (e.g. skipReplayCheck, allowReplay, forceReserve).
 * - Because no durable backend is bound in Phase 5R, this function MUST fail closed with
 *   status 'BACKEND_NOT_BOUND' (or 'INVALID_REQUEST' for malformed requests).
 * - NEVER returns 'RESERVED' in Phase 5R.
 */
export function reserveProductionAuthorizationReplay(
  request: unknown
): AuthorizationReplayReservationResult {
  // Step 1: Validate request structure and reject bypass flags
  const validation = validateAuthorizationReplayReservationRequest(request);
  if (!validation.valid) {
    return {
      success: false,
      status: 'INVALID_REQUEST',
      errors: validation.errors,
    };
  }

  const validatedReq = request as AuthorizationReplayReservationRequest;

  // Step 2: Fail-closed production readiness & backend bound check
  // DURABLE_AUTHORIZATION_REPLAY_BACKEND_BOUND is strictly false in Phase 5R.
  if ((DURABLE_AUTHORIZATION_REPLAY_BACKEND_BOUND as boolean) !== true) {
    return {
      success: false,
      status: 'BACKEND_NOT_BOUND',
      errors: [
        'DURABLE_REPLAY_BACKEND_NOT_BOUND: No durable authorization replay backend is bound to the production runtime.',
        'ATOMIC_RESERVE_UNAVAILABLE: Atomic reserve-if-absent is not implemented in Phase 5R.',
      ],
      replayKey: validatedReq.replayKey,
      expiresAt: validatedReq.expiresAt,
    };
  }

  // Unreachable in Phase 5R
  return {
    success: false,
    status: 'BACKEND_UNAVAILABLE',
    errors: ['BACKEND_UNAVAILABLE: Replay ledger backend is unreachable.'],
  };
}
