/**
 * @file worker/ai/canary/deepSeekCertificationAttestation.ts
 * @description VELNAR — A.12B.2C-5L Trusted Source Attestation & Cryptographic Human Authorization Foundation.
 * 
 * STRICT ARCHITECTURAL INVARIANTS:
 * - PURE OFFLINE VERIFICATION FOUNDATION ONLY.
 * - ZERO DeepSeek calls.
 * - ZERO Gemini calls.
 * - ZERO external provider or network calls.
 * - ZERO provider credentials (no API keys, no bearer tokens).
 * - ZERO private signing keys embedded or stored in production source.
 * - Public key verification ONLY (Ed25519 asymmetric cryptography).
 * - NO authorization issuance API (verifier-first design).
 * - CANARY_LIVE_EXECUTION_ENABLED remains strictly untouched/false.
 * - GUARDED_SOURCE_ATTESTATION_READY remains strictly false.
 * - GUARDED_HUMAN_AUTH_ATTESTATION_READY remains strictly false.
 */

import crypto from 'node:crypto';
import {
  TRANSPORT_CONTRACT_VERSION,
  SEALED_PROVIDER,
  SEALED_MODEL,
  SEALED_OFF_PEAK_PROGRAM_ID,
  SEALED_PEAK_PROGRAM_ID,
  SEALED_OFF_PEAK_CANDIDATE_ID,
  SEALED_PEAK_CANDIDATE_ID,
  SEALED_OFF_PEAK_COST_BOUND_MICRO_USD,
  SEALED_PEAK_COST_BOUND_MICRO_USD,
  SEALED_CANONICAL_TASK_COUNT,
  computeCanonicalTaskSetHash,
  computeFixtureSetHash,
} from './deepSeekLiveCertificationTransportContract';
import { GUARDED_TRANSPORT_MODULE_VERSION } from './deepSeekGuardedLiveTransport';
import {
  SUCCESSOR_SPECIFICATION_VERSION,
} from './deepSeekSingleProviderCertificationSpecification';

// ============================================================================
// 1. MODULE CONSTANTS & POLICY BOUNDS
// ============================================================================

export const ATTESTATION_FOUNDATION_VERSION = '1.0.0-foundation' as const;
export const CANONICAL_AUTHORIZATION_VERSION = 'a12b2c5-v1.3' as const;
export const CANONICAL_ALGORITHM = 'Ed25519' as const;

export const GUARDED_TRANSPORT_MODULE_IDENTITY =
  'worker/ai/canary/deepSeekGuardedLiveTransport.ts' as const;
export const SEALED_REPOSITORY_IDENTITY = 'velnar-autonomous-ops' as const;

/**
 * Maximum authorized lifetime for a human certification authorization.
 * Strict 15-minute validity window.
 */
export const MAX_AUTHORIZATION_LIFETIME_MS = 15 * 60 * 1000; // 900,000 ms (15 minutes)

/**
 * Budget policy bounds:
 * Minimums correspond to the sealed 7-call canonical worst-case bound.
 * Maximum ceilings prevent unbounded or arbitrary high financial approvals.
 */
export const OFF_PEAK_MIN_BUDGET_MICRO_USD = SEALED_OFF_PEAK_COST_BOUND_MICRO_USD; // 12,783 microUSD ($0.012783)
export const PEAK_MIN_BUDGET_MICRO_USD = SEALED_PEAK_COST_BOUND_MICRO_USD;         // 25,566 microUSD ($0.025566)

export const OFF_PEAK_MAX_BUDGET_CEILING_MICRO_USD = 25566; // 2x canonical off-peak ceiling
export const PEAK_MAX_BUDGET_CEILING_MICRO_USD = 51132;     // 2x canonical peak ceiling
export const MAX_AUTHORIZED_BUDGET_CEILING_MICRO_USD = 100000; // Hard ceiling across all programs ($0.10)

/**
 * Known forbidden placeholder strings for runNonce.
 * Production verification rejects these immediately.
 */
export const FORBIDDEN_PLACEHOLDER_NONCES: readonly string[] = Object.freeze([
  'synthetic_nonce_5k',
  'test',
  'nonce',
  'dummy',
  'placeholder',
  'null',
  'undefined',
  'mock',
  'sample',
  'fake',
  'none',
  'default',
]);

// ============================================================================
// 2. INTERFACES & SCHEMAS
// ============================================================================

/**
 * Pinned authority identity for asymmetric cryptographic verification.
 * Verification operates on public key material only.
 */
export interface HumanAuthorizationAuthorityDescriptor {
  readonly authorityId: string;
  readonly algorithm: 'Ed25519';
  readonly publicKeyFingerprintSha256: string;
  readonly publicKeyPem: string;
  readonly keyVersion: string;
}

/**
 * Canonical human authorization payload containing all required security-critical bindings.
 * Single-use is mandatory. No optional omission of security-critical bindings.
 */
export interface CanonicalHumanAuthorizationPayload {
  readonly authorizationVersion: string;
  readonly authorityId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly targetProgram: string;
  readonly pricingWindow: 'OFF_PEAK' | 'PEAK';
  readonly candidateId: string;
  readonly sourceCommitSha: string;
  readonly sourceTreeSha: string;
  readonly specificationVersion: string;
  readonly maxBudgetMicroUsd: number;
  readonly runNonce: string;
  readonly singleUse: boolean;
  readonly provider: 'deepseek';
  readonly model: 'deepseek-v4-flash';
  readonly canonicalTaskCount: number;
  readonly transportContractVersion: string;
  readonly guardedTransportModuleVersion: string;
  readonly sourceAttestationDigest: string;
}

/**
 * Cryptographic signature package covering the canonical payload.
 */
export interface SignedHumanAuthorizationPackage {
  readonly payload: CanonicalHumanAuthorizationPayload;
  readonly signatureBase64: string;
  readonly authorityId: string;
  readonly keyVersion: string;
  readonly algorithm: 'Ed25519';
}

/**
 * Trusted source attestation describing the exact source intended for certification.
 */
export interface TrustedSourceAttestation {
  readonly attestationVersion: string;
  readonly sourceCommitSha: string;
  readonly sourceTreeSha: string;
  readonly repositoryIdentity: string;
  readonly transportModuleIdentity: string;
  readonly transportModuleVersion: string;
  readonly transportContractVersion: string;
  readonly successorSpecificationVersion: string;
  readonly canonicalTaskSetDigest: string;
  readonly fixtureSetDigest: string;
  readonly createdAt: string;
  readonly attestationDigest: string;
}

// ============================================================================
// 3. DETERMINISTIC CANONICALIZATION & SERIALIZATION
// ============================================================================

export const EXACT_PAYLOAD_KEYS = Object.freeze([
  'authorizationVersion',
  'authorityId',
  'issuedAt',
  'expiresAt',
  'targetProgram',
  'pricingWindow',
  'candidateId',
  'sourceCommitSha',
  'sourceTreeSha',
  'specificationVersion',
  'maxBudgetMicroUsd',
  'runNonce',
  'singleUse',
  'provider',
  'model',
  'canonicalTaskCount',
  'transportContractVersion',
  'guardedTransportModuleVersion',
  'sourceAttestationDigest',
] as const);

const ALLOWED_PAYLOAD_KEYS_SET = new Set<string>(EXACT_PAYLOAD_KEYS);

/**
 * Validates whether a timestamp string strictly matches UTC ISO-8601 representation.
 */
export function isValidIsoUtcTimestamp(timestamp: string): boolean {
  if (typeof timestamp !== 'string') return false;
  const isoUtcRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
  if (!isoUtcRegex.test(timestamp)) return false;
  const parsed = Date.parse(timestamp);
  return !Number.isNaN(parsed);
}

/**
 * Computes the SHA256 fingerprint of public key PEM material.
 */
export function computePublicKeyFingerprintSha256(publicKeyPem: string): string {
  const normalized = publicKeyPem.trim().replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

/**
 * Serializes CanonicalHumanAuthorizationPayload into a deterministic UTF-8 byte stream.
 * Property order is fixed and strictly validated.
 * Rejects unknown properties, missing properties, and lossy type coercion.
 * Serializes actual validated runtime values (no hard-coded constants).
 */
export function canonicalizeHumanAuthorizationPayload(
  payload: CanonicalHumanAuthorizationPayload
): string {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('CANONICALIZATION_FAILURE: payload must be a non-null object');
  }

  // 1. Reject unknown extra properties
  const payloadKeys = Object.keys(payload);
  for (const key of payloadKeys) {
    if (!ALLOWED_PAYLOAD_KEYS_SET.has(key)) {
      throw new Error(`CANONICALIZATION_FAILURE: unknown or unauthorized field '${key}' in payload`);
    }
  }

  // 2. Reject missing or null required fields
  for (const key of EXACT_PAYLOAD_KEYS) {
    if ((payload as any)[key] === undefined || (payload as any)[key] === null) {
      throw new Error(`CANONICALIZATION_FAILURE: required field '${key}' is missing or null`);
    }
  }

  // 3. Exact type validation (no lossy type coercion)
  const requiredStringFields: (keyof CanonicalHumanAuthorizationPayload)[] = [
    'authorizationVersion',
    'authorityId',
    'issuedAt',
    'expiresAt',
    'targetProgram',
    'pricingWindow',
    'candidateId',
    'sourceCommitSha',
    'sourceTreeSha',
    'specificationVersion',
    'runNonce',
    'provider',
    'model',
    'transportContractVersion',
    'guardedTransportModuleVersion',
    'sourceAttestationDigest',
  ];

  for (const field of requiredStringFields) {
    if (typeof (payload as any)[field] !== 'string') {
      throw new Error(
        `CANONICALIZATION_FAILURE: field '${field}' must be a string (coercion prohibited)`
      );
    }
  }

  if (
    typeof payload.maxBudgetMicroUsd !== 'number' ||
    !Number.isFinite(payload.maxBudgetMicroUsd)
  ) {
    throw new Error(
      "CANONICALIZATION_FAILURE: field 'maxBudgetMicroUsd' must be a finite number"
    );
  }

  if (typeof payload.singleUse !== 'boolean') {
    throw new Error("CANONICALIZATION_FAILURE: field 'singleUse' must be a boolean");
  }

  if (
    typeof payload.canonicalTaskCount !== 'number' ||
    !Number.isFinite(payload.canonicalTaskCount)
  ) {
    throw new Error(
      "CANONICALIZATION_FAILURE: field 'canonicalTaskCount' must be a finite number"
    );
  }

  // 4. Strict property-by-property deterministic key ordering using actual runtime values
  const ordered = {
    authorizationVersion: payload.authorizationVersion,
    authorityId: payload.authorityId,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
    targetProgram: payload.targetProgram,
    pricingWindow: payload.pricingWindow,
    candidateId: payload.candidateId,
    sourceCommitSha: payload.sourceCommitSha,
    sourceTreeSha: payload.sourceTreeSha,
    specificationVersion: payload.specificationVersion,
    maxBudgetMicroUsd: payload.maxBudgetMicroUsd,
    runNonce: payload.runNonce,
    singleUse: payload.singleUse,
    provider: payload.provider,
    model: payload.model,
    canonicalTaskCount: payload.canonicalTaskCount,
    transportContractVersion: payload.transportContractVersion,
    guardedTransportModuleVersion: payload.guardedTransportModuleVersion,
    sourceAttestationDigest: payload.sourceAttestationDigest,
  };

  return JSON.stringify(ordered);
}

// ============================================================================
// 4. SOURCE ATTESTATION BUILDER & VALIDATOR
// ============================================================================

/**
 * Computes deterministic digest of source attestation canonical content.
 */
export function computeSourceAttestationDigest(
  attestation: Omit<TrustedSourceAttestation, 'attestationDigest'>
): string {
  const ordered = {
    attestationVersion: attestation.attestationVersion,
    sourceCommitSha: attestation.sourceCommitSha,
    sourceTreeSha: attestation.sourceTreeSha,
    repositoryIdentity: attestation.repositoryIdentity,
    transportModuleIdentity: attestation.transportModuleIdentity,
    transportModuleVersion: attestation.transportModuleVersion,
    transportContractVersion: attestation.transportContractVersion,
    successorSpecificationVersion: attestation.successorSpecificationVersion,
    canonicalTaskSetDigest: attestation.canonicalTaskSetDigest,
    fixtureSetDigest: attestation.fixtureSetDigest,
    createdAt: attestation.createdAt,
  };
  return crypto.createHash('sha256').update(JSON.stringify(ordered), 'utf8').digest('hex');
}

/**
 * Builds a TrustedSourceAttestation object for given commit and tree SHAs.
 */
export function buildTrustedSourceAttestation(params: {
  sourceCommitSha: string;
  sourceTreeSha: string;
  repositoryIdentity?: string;
  createdAt?: string;
}): TrustedSourceAttestation {
  const partial = {
    attestationVersion: ATTESTATION_FOUNDATION_VERSION,
    sourceCommitSha: params.sourceCommitSha,
    sourceTreeSha: params.sourceTreeSha,
    repositoryIdentity: params.repositoryIdentity ?? SEALED_REPOSITORY_IDENTITY,
    transportModuleIdentity: GUARDED_TRANSPORT_MODULE_IDENTITY,
    transportModuleVersion: GUARDED_TRANSPORT_MODULE_VERSION,
    transportContractVersion: TRANSPORT_CONTRACT_VERSION,
    successorSpecificationVersion: SUCCESSOR_SPECIFICATION_VERSION,
    canonicalTaskSetDigest: computeCanonicalTaskSetHash(),
    fixtureSetDigest: computeFixtureSetHash(),
    createdAt: params.createdAt ?? new Date().toISOString(),
  };

  const attestationDigest = computeSourceAttestationDigest(partial);

  return {
    ...partial,
    attestationDigest,
  };
}

/**
 * Validates self-consistency and format invariants of a TrustedSourceAttestation.
 */
export function validateTrustedSourceAttestation(
  attestation: TrustedSourceAttestation
): { valid: boolean; errors: readonly string[]; failureReason?: string } {
  const errors: string[] = [];

  if (!attestation || typeof attestation !== 'object') {
    return { valid: false, errors: ['ATTESTATION_NULL: attestation must be a non-null object'], failureReason: 'ATTESTATION_NULL' };
  }

  // 0. Attestation version exact binding check
  if (!attestation.attestationVersion || attestation.attestationVersion !== ATTESTATION_FOUNDATION_VERSION) {
    errors.push(`ATTESTATION_VERSION_MISMATCH: expected '${ATTESTATION_FOUNDATION_VERSION}', got '${attestation.attestationVersion}'`);
  }

  // 1. 40-char lowercase Git SHA-1 commit check
  if (!/^[0-9a-f]{40}$/.test(attestation.sourceCommitSha)) {
    errors.push(`INVALID_COMMIT_SHA_FORMAT: '${attestation.sourceCommitSha}' is not a 40-char lowercase hex SHA`);
  }

  // 2. 40-char lowercase Git SHA-1 tree check
  if (!/^[0-9a-f]{40}$/.test(attestation.sourceTreeSha)) {
    errors.push(`INVALID_TREE_SHA_FORMAT: '${attestation.sourceTreeSha}' is not a 40-char lowercase hex SHA`);
  }

  // 3. Repository identity check
  if (attestation.repositoryIdentity !== SEALED_REPOSITORY_IDENTITY) {
    errors.push(`REPOSITORY_IDENTITY_MISMATCH: expected '${SEALED_REPOSITORY_IDENTITY}', got '${attestation.repositoryIdentity}'`);
  }

  // 4. Transport module identity check
  if (attestation.transportModuleIdentity !== GUARDED_TRANSPORT_MODULE_IDENTITY) {
    errors.push(`TRANSPORT_MODULE_MISMATCH: expected '${GUARDED_TRANSPORT_MODULE_IDENTITY}', got '${attestation.transportModuleIdentity}'`);
  }

  // 5. Transport module version check
  if (attestation.transportModuleVersion !== GUARDED_TRANSPORT_MODULE_VERSION) {
    errors.push(`MODULE_VERSION_MISMATCH: expected '${GUARDED_TRANSPORT_MODULE_VERSION}', got '${attestation.transportModuleVersion}'`);
  }

  // 6. Transport contract version check
  if (attestation.transportContractVersion !== TRANSPORT_CONTRACT_VERSION) {
    errors.push(`CONTRACT_VERSION_MISMATCH: expected '${TRANSPORT_CONTRACT_VERSION}', got '${attestation.transportContractVersion}'`);
  }

  // 7. Successor specification version check
  if (attestation.successorSpecificationVersion !== SUCCESSOR_SPECIFICATION_VERSION) {
    errors.push(`SPEC_VERSION_MISMATCH: expected '${SUCCESSOR_SPECIFICATION_VERSION}', got '${attestation.successorSpecificationVersion}'`);
  }

  // 8. Canonical task set hash check
  const expectedTaskHash = computeCanonicalTaskSetHash();
  if (attestation.canonicalTaskSetDigest !== expectedTaskHash) {
    errors.push(`CANONICAL_TASK_DIGEST_MISMATCH: expected '${expectedTaskHash}', got '${attestation.canonicalTaskSetDigest}'`);
  }

  // 9. Fixture set hash check
  const expectedFixtureHash = computeFixtureSetHash();
  if (attestation.fixtureSetDigest !== expectedFixtureHash) {
    errors.push(`FIXTURE_DIGEST_MISMATCH: expected '${expectedFixtureHash}', got '${attestation.fixtureSetDigest}'`);
  }

  // 10. Attestation digest self-consistency
  const recomputedDigest = computeSourceAttestationDigest(attestation);
  if (attestation.attestationDigest !== recomputedDigest) {
    errors.push(`ATTESTATION_DIGEST_MISMATCH: expected '${recomputedDigest}', got '${attestation.attestationDigest}'`);
  }

  // 11. CreatedAt ISO timestamp (strict UTC ISO timestamp string)
  if (!isValidIsoUtcTimestamp(attestation.createdAt)) {
    errors.push(`INVALID_CREATED_AT: '${attestation.createdAt}' is not a valid UTC ISO timestamp string`);
  }

  return {
    valid: errors.length === 0,
    errors,
    failureReason: errors[0],
  };
}

// ============================================================================
// 5. NONCE VALIDATION & IDENTITY KEYS
// ============================================================================

/**
 * Validates the runNonce parameter against length, character set, and placeholder rules.
 */
export function validateRunNonce(runNonce: string): { valid: boolean; error?: string } {
  if (!runNonce || typeof runNonce !== 'string') {
    return { valid: false, error: 'NONCE_EMPTY: runNonce must be a non-empty string' };
  }

  const trimmed = runNonce.trim();
  if (trimmed.length < 16 || trimmed.length > 128) {
    return {
      valid: false,
      error: `NONCE_LENGTH_INVALID: length must be between 16 and 128 chars (got ${trimmed.length})`,
    };
  }

  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    return {
      valid: false,
      error: 'NONCE_CHARSET_INVALID: runNonce contains invalid characters (allowed: [A-Za-z0-9_-])',
    };
  }

  const lower = trimmed.toLowerCase();
  for (const placeholder of FORBIDDEN_PLACEHOLDER_NONCES) {
    if (lower === placeholder || lower.startsWith(`${placeholder}_`)) {
      return {
        valid: false,
        error: `NONCE_FORBIDDEN_PLACEHOLDER: '${runNonce}' is a prohibited placeholder nonce`,
      };
    }
  }

  return { valid: true };
}

/**
 * Deterministically computes the authorizationPackageDigest from the signed package.
 * SHA256(canonicalPayload UTF-8 bytes + ':' + signature bytes).
 */
export function computeAuthorizationPackageDigest(
  pkg: SignedHumanAuthorizationPackage
): string {
  const canonicalPayload = canonicalizeHumanAuthorizationPayload(pkg.payload);
  const signatureBytes = Buffer.from(pkg.signatureBase64, 'base64');

  return crypto
    .createHash('sha256')
    .update(canonicalPayload, 'utf8')
    .update(':')
    .update(signatureBytes)
    .digest('hex');
}

/**
 * Deterministically derives the single-use authorization consumption key.
 * Used by downstream state machines to detect replays.
 */
export function computeAuthorizationConsumptionKey(params: {
  authorityId: string;
  targetProgram: string;
  pricingWindow: 'OFF_PEAK' | 'PEAK';
  sourceCommitSha: string;
  runNonce: string;
}): string {
  return `${params.authorityId}:${params.targetProgram}:${params.pricingWindow}:${params.sourceCommitSha}:${params.runNonce}`;
}

// ============================================================================
// 6. CRYPTOGRAPHIC PACKAGE VERIFIER
// ============================================================================

export interface VerifyAuthorizationOptions {
  /** Mandatory source attestation to verify cryptographic binding */
  readonly sourceAttestation: TrustedSourceAttestation;
  /** Deterministic timestamp override for unit testing only */
  readonly nowUtc?: Date;
}

export interface VerifyAuthorizationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly failureReason?: string;
  readonly authorizationPackageDigest?: string;
  readonly authorizationConsumptionKey?: string;
}

/**
 * Deterministic, verifier-first verification of a SignedHumanAuthorizationPackage.
 * Operates strictly on public keys.
 */
export function verifyHumanAuthorizationPackage(
  pkg: SignedHumanAuthorizationPackage,
  authority: HumanAuthorizationAuthorityDescriptor,
  options: VerifyAuthorizationOptions
): VerifyAuthorizationResult {
  const errors: string[] = [];

  if (!pkg || typeof pkg !== 'object') {
    return { valid: false, errors: ['PACKAGE_NULL: package must be a non-null object'], failureReason: 'PACKAGE_NULL' };
  }
  if (!authority || typeof authority !== 'object') {
    return { valid: false, errors: ['AUTHORITY_NULL: authority descriptor must be a non-null object'], failureReason: 'AUTHORITY_NULL' };
  }

  // Mandatory source attestation presence check
  if (!options || typeof options !== 'object') {
    errors.push('SOURCE_ATTESTATION_MISSING: verification options with sourceAttestation is required');
  } else if (!options.sourceAttestation) {
    errors.push('SOURCE_ATTESTATION_MISSING: sourceAttestation is mandatory for human authorization verification');
  } else if (typeof options.sourceAttestation !== 'object') {
    errors.push('SOURCE_ATTESTATION_INVALID: sourceAttestation must be a non-null object');
  }

  // 1. Authority ID matching
  if (!pkg.authorityId || pkg.authorityId !== authority.authorityId) {
    errors.push(`AUTHORITY_ID_MISMATCH: package authorityId '${pkg.authorityId}' does not match authority descriptor '${authority.authorityId}'`);
  }
  if (pkg.payload && pkg.payload.authorityId !== authority.authorityId) {
    errors.push(`PAYLOAD_AUTHORITY_ID_MISMATCH: payload authorityId '${pkg.payload.authorityId}' does not match authority descriptor '${authority.authorityId}'`);
  }

  // 2. Key version matching
  if (!pkg.keyVersion || pkg.keyVersion !== authority.keyVersion) {
    errors.push(`KEY_VERSION_MISMATCH: package keyVersion '${pkg.keyVersion}' does not match authority descriptor '${authority.keyVersion}'`);
  }

  // 3. Algorithm check
  if (pkg.algorithm !== CANONICAL_ALGORITHM || authority.algorithm !== CANONICAL_ALGORITHM) {
    errors.push(`ALGORITHM_MISMATCH: expected '${CANONICAL_ALGORITHM}', got package '${pkg.algorithm}' and authority '${authority.algorithm}'`);
  }

  // 4. Public key fingerprint validation
  const recomputedFingerprint = computePublicKeyFingerprintSha256(authority.publicKeyPem);
  if (authority.publicKeyFingerprintSha256 !== recomputedFingerprint) {
    errors.push(`PUBLIC_KEY_FINGERPRINT_MISMATCH: expected '${recomputedFingerprint}', got '${authority.publicKeyFingerprintSha256}'`);
  }

  // 5. Signature presence and Ed25519 verification
  if (!pkg.signatureBase64 || typeof pkg.signatureBase64 !== 'string') {
    errors.push('SIGNATURE_MISSING: valid signatureBase64 required');
  } else {
    try {
      const canonicalPayloadString = canonicalizeHumanAuthorizationPayload(pkg.payload);
      const signatureBuffer = Buffer.from(pkg.signatureBase64, 'base64');
      const payloadBuffer = Buffer.from(canonicalPayloadString, 'utf8');

      const isSignatureValid = crypto.verify(
        null,
        payloadBuffer,
        authority.publicKeyPem,
        signatureBuffer
      );

      if (!isSignatureValid) {
        errors.push('SIGNATURE_VERIFICATION_FAILED: Ed25519 signature is invalid for payload and public key');
      }
    } catch (err) {
      errors.push(`SIGNATURE_VERIFICATION_ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 6. Canonical payload integrity
  const p = pkg.payload;
  if (!p || typeof p !== 'object') {
    errors.push('PAYLOAD_MISSING: valid canonical payload required');
    return { valid: false, errors, failureReason: errors[0] };
  }

  // Authorization version check
  if (!p.authorizationVersion || p.authorizationVersion !== CANONICAL_AUTHORIZATION_VERSION) {
    errors.push(`AUTHORIZATION_VERSION_MISMATCH: expected '${CANONICAL_AUTHORIZATION_VERSION}', got '${p.authorizationVersion}'`);
  }

  // Single-use invariant
  if (p.singleUse !== true) {
    errors.push('SINGLE_USE_REQUIRED: singleUse must be strictly true');
  }

  // Provider and model bindings
  if (p.provider !== SEALED_PROVIDER) {
    errors.push(`PROVIDER_MISMATCH: expected '${SEALED_PROVIDER}', got '${p.provider}'`);
  }
  if (p.model !== SEALED_MODEL) {
    errors.push(`MODEL_MISMATCH: expected '${SEALED_MODEL}', got '${p.model}'`);
  }
  if (p.canonicalTaskCount !== SEALED_CANONICAL_TASK_COUNT) {
    errors.push(`TASK_COUNT_MISMATCH: expected ${SEALED_CANONICAL_TASK_COUNT}, got ${p.canonicalTaskCount}`);
  }

  // Spec, contract, module versions
  if (p.specificationVersion !== SUCCESSOR_SPECIFICATION_VERSION) {
    errors.push(`SPEC_VERSION_MISMATCH: expected '${SUCCESSOR_SPECIFICATION_VERSION}', got '${p.specificationVersion}'`);
  }
  if (p.transportContractVersion !== TRANSPORT_CONTRACT_VERSION) {
    errors.push(`CONTRACT_VERSION_MISMATCH: expected '${TRANSPORT_CONTRACT_VERSION}', got '${p.transportContractVersion}'`);
  }
  if (p.guardedTransportModuleVersion !== GUARDED_TRANSPORT_MODULE_VERSION) {
    errors.push(`MODULE_VERSION_MISMATCH: expected '${GUARDED_TRANSPORT_MODULE_VERSION}', got '${p.guardedTransportModuleVersion}'`);
  }

  // Pricing window and program / candidate correlation
  if (p.pricingWindow === 'OFF_PEAK') {
    if (p.targetProgram !== SEALED_OFF_PEAK_PROGRAM_ID) {
      errors.push(`PROGRAM_MISMATCH: expected '${SEALED_OFF_PEAK_PROGRAM_ID}' for OFF_PEAK, got '${p.targetProgram}'`);
    }
    if (p.candidateId !== SEALED_OFF_PEAK_CANDIDATE_ID) {
      errors.push(`CANDIDATE_MISMATCH: expected '${SEALED_OFF_PEAK_CANDIDATE_ID}' for OFF_PEAK, got '${p.candidateId}'`);
    }
    if (!Number.isInteger(p.maxBudgetMicroUsd)) {
      errors.push(`BUDGET_NOT_INTEGER: maxBudgetMicroUsd (${p.maxBudgetMicroUsd}) must be an integer`);
    } else if (p.maxBudgetMicroUsd < OFF_PEAK_MIN_BUDGET_MICRO_USD) {
      errors.push(`BUDGET_INSUFFICIENT: OFF_PEAK requires at least ${OFF_PEAK_MIN_BUDGET_MICRO_USD} microUSD (got ${p.maxBudgetMicroUsd})`);
    } else if (p.maxBudgetMicroUsd > OFF_PEAK_MAX_BUDGET_CEILING_MICRO_USD) {
      errors.push(`BUDGET_CEILING_EXCEEDED: OFF_PEAK budget (${p.maxBudgetMicroUsd}) exceeds maximum ceiling (${OFF_PEAK_MAX_BUDGET_CEILING_MICRO_USD})`);
    }
  } else if (p.pricingWindow === 'PEAK') {
    if (p.targetProgram !== SEALED_PEAK_PROGRAM_ID) {
      errors.push(`PROGRAM_MISMATCH: expected '${SEALED_PEAK_PROGRAM_ID}' for PEAK, got '${p.targetProgram}'`);
    }
    if (p.candidateId !== SEALED_PEAK_CANDIDATE_ID) {
      errors.push(`CANDIDATE_MISMATCH: expected '${SEALED_PEAK_CANDIDATE_ID}' for PEAK, got '${p.candidateId}'`);
    }
    if (!Number.isInteger(p.maxBudgetMicroUsd)) {
      errors.push(`BUDGET_NOT_INTEGER: maxBudgetMicroUsd (${p.maxBudgetMicroUsd}) must be an integer`);
    } else if (p.maxBudgetMicroUsd < PEAK_MIN_BUDGET_MICRO_USD) {
      errors.push(`BUDGET_INSUFFICIENT: PEAK requires at least ${PEAK_MIN_BUDGET_MICRO_USD} microUSD (got ${p.maxBudgetMicroUsd})`);
    } else if (p.maxBudgetMicroUsd > PEAK_MAX_BUDGET_CEILING_MICRO_USD) {
      errors.push(`BUDGET_CEILING_EXCEEDED: PEAK budget (${p.maxBudgetMicroUsd}) exceeds maximum ceiling (${PEAK_MAX_BUDGET_CEILING_MICRO_USD})`);
    }
  } else {
    errors.push(`INVALID_PRICING_WINDOW: expected 'OFF_PEAK' | 'PEAK', got '${String(p.pricingWindow)}'`);
  }

  // Hard ceiling guard
  if (p.maxBudgetMicroUsd > MAX_AUTHORIZED_BUDGET_CEILING_MICRO_USD) {
    errors.push(`BUDGET_HARD_CEILING_EXCEEDED: maxBudgetMicroUsd (${p.maxBudgetMicroUsd}) exceeds hard ceiling (${MAX_AUTHORIZED_BUDGET_CEILING_MICRO_USD})`);
  }

  // 7. Timestamps and lifetime bounds
  const now = options?.nowUtc ? options.nowUtc.getTime() : Date.now();

  if (!isValidIsoUtcTimestamp(p.issuedAt)) {
    errors.push(`INVALID_ISSUED_AT: '${p.issuedAt}' is not a valid UTC ISO timestamp string`);
  }
  if (!isValidIsoUtcTimestamp(p.expiresAt)) {
    errors.push(`INVALID_EXPIRES_AT: '${p.expiresAt}' is not a valid UTC ISO timestamp string`);
  }

  if (isValidIsoUtcTimestamp(p.issuedAt) && isValidIsoUtcTimestamp(p.expiresAt)) {
    const issuedTime = Date.parse(p.issuedAt);
    const expiresTime = Date.parse(p.expiresAt);

    if (expiresTime <= issuedTime) {
      errors.push(`INVALID_EXPIRY_SEQUENCE: expiresAt (${p.expiresAt}) must be strictly after issuedAt (${p.issuedAt})`);
    }
    const lifetimeMs = expiresTime - issuedTime;
    if (lifetimeMs > MAX_AUTHORIZATION_LIFETIME_MS) {
      errors.push(`LIFETIME_EXCEEDS_MAX: authorization lifetime (${lifetimeMs}ms) exceeds max allowed (${MAX_AUTHORIZATION_LIFETIME_MS}ms)`);
    }
    if (issuedTime > now) {
      errors.push(`NOT_YET_VALID: issuedAt (${p.issuedAt}) is in the future relative to current verification time`);
    }
    if (expiresTime <= now) {
      errors.push(`AUTHORIZATION_EXPIRED: expiresAt (${p.expiresAt}) has passed`);
    }
  }

  // 8. Nonce validation
  const nonceCheck = validateRunNonce(p.runNonce);
  if (!nonceCheck.valid) {
    errors.push(nonceCheck.error ?? 'INVALID_NONCE');
  }

  // 9. Source attestation digest format
  if (!/^[0-9a-f]{64}$/.test(p.sourceAttestationDigest)) {
    errors.push(`INVALID_SOURCE_ATTESTATION_DIGEST: '${p.sourceAttestationDigest}' is not a 64-char hex SHA256`);
  }

  // 10. Mandatory source attestation cryptographic binding check
  if (options && typeof options === 'object' && options.sourceAttestation && typeof options.sourceAttestation === 'object') {
    const attCheck = validateTrustedSourceAttestation(options.sourceAttestation);
    if (!attCheck.valid) {
      errors.push(`SOURCE_ATTESTATION_INVALID: ${attCheck.errors.join(', ')}`);
    }
    if (p.sourceCommitSha !== options.sourceAttestation.sourceCommitSha) {
      errors.push(`SOURCE_COMMIT_MISMATCH: SOURCE_COMMIT_BINDING_MISMATCH: payload commit '${p.sourceCommitSha}' !== attestation commit '${options.sourceAttestation.sourceCommitSha}'`);
    }
    if (p.sourceTreeSha !== options.sourceAttestation.sourceTreeSha) {
      errors.push(`SOURCE_TREE_MISMATCH: SOURCE_TREE_BINDING_MISMATCH: payload tree '${p.sourceTreeSha}' !== attestation tree '${options.sourceAttestation.sourceTreeSha}'`);
    }
    if (p.sourceAttestationDigest !== options.sourceAttestation.attestationDigest) {
      errors.push(`ATTESTATION_DIGEST_BINDING_MISMATCH: payload digest '${p.sourceAttestationDigest}' !== attestation digest '${options.sourceAttestation.attestationDigest}'`);
    }
  }

  // Compute identity keys if valid
  let authorizationPackageDigest: string | undefined;
  let authorizationConsumptionKey: string | undefined;

  if (errors.length === 0) {
    authorizationPackageDigest = computeAuthorizationPackageDigest(pkg);
    authorizationConsumptionKey = computeAuthorizationConsumptionKey({
      authorityId: authority.authorityId,
      targetProgram: p.targetProgram,
      pricingWindow: p.pricingWindow,
      sourceCommitSha: p.sourceCommitSha,
      runNonce: p.runNonce,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    failureReason: errors[0],
    authorizationPackageDigest,
    authorizationConsumptionKey,
  };
}
