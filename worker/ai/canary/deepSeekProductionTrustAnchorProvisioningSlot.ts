/**
 * @file worker/ai/canary/deepSeekProductionTrustAnchorProvisioningSlot.ts
 * @description VELNAR — Phase A.12B.2C-5O Production Public Trust-Anchor Provisioning Slot & Manual Ceremony Handoff.
 *
 * STRICT ARCHITECTURAL INVARIANTS:
 * - PURE OFFLINE PROVISIONING SLOT & MANUAL CEREMONY HANDOFF VALIDATION ENGINE.
 * - ZERO DeepSeek calls.
 * - ZERO Gemini calls.
 * - ZERO external provider or network calls.
 * - ZERO provider credentials (no API keys, no bearer tokens).
 * - ZERO production private keys generated, stored, or embedded.
 * - ZERO real production public keys embedded or provisioned in this phase.
 * - NO dynamic trust injection (no environment variable loading, no filesystem secret loading, no remote JWKS/KMS).
 * - PRODUCTION_TRUST_ANCHOR_SLOT_READY remains strictly false.
 * - PRODUCTION_TRUST_ANCHOR_SLOT_POPULATED remains strictly false.
 * - PRODUCTION_AUTHORITY_REGISTRY entry count remains strictly 0.
 * - PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED remains strictly false.
 *
 * FUTURE MANUAL CEREMONY SPECIFICATION:
 * The future production private key MUST be generated outside repository and
 * outside AI agent context.
 * Only:
 * - PUBLIC KEY
 * - PUBLIC KEY FINGERPRINT
 * - CANONICAL PROVISIONING RECORD
 * - MANUAL HANDOFF RECEIPT
 * may enter the repository.
 * NEVER private key material.
 */

import crypto from 'node:crypto';
import {
  PRODUCTION_AUTHORITY_REGISTRY_VERSION,
  validateProductionAuthorityEntry,
} from './deepSeekProductionAuthorizationTrust';
import type { ProductionHumanAuthorizationAuthority } from './deepSeekProductionAuthorizationTrust';
import {
  PROVISIONING_CEREMONY_CONTRACT_VERSION,
  CANONICAL_PROVISIONING_ALGORITHM,
  validateProductionTrustAnchorProvisioningRecord,
} from './deepSeekProductionTrustAnchorProvisioning';
import type { ProductionTrustAnchorProvisioningRecord } from './deepSeekProductionTrustAnchorProvisioning';

// ============================================================================
// 1. CONSTANTS & SLOT CONFIGURATION
// ============================================================================

export const PRODUCTION_TRUST_ANCHOR_SLOT_VERSION = 'a12b2c5o-v1' as const;

/**
 * Indicates whether the production trust anchor slot is ready to receive/activate anchors.
 * In Phase 5O, this remains strictly false.
 */
export const PRODUCTION_TRUST_ANCHOR_SLOT_READY = false as const;

/**
 * Indicates whether the production trust anchor slot is currently populated.
 * In Phase 5O, this remains strictly false.
 */
export const PRODUCTION_TRUST_ANCHOR_SLOT_POPULATED = false as const;

/**
 * Canonical compile-time target authority identity invariants.
 * Strictly caller-independent: no caller overrides or target parameters permitted.
 */
export const CANONICAL_TARGET_AUTHORITY_ID = 'velnar-lead-ops-prod' as const;
export const CANONICAL_TARGET_KEY_VERSION = '2026-v1' as const;
export const CANONICAL_TARGET_ALGORITHM = 'Ed25519' as const;

/**
 * Canonical manual handoff receipt contract version.
 */
export const CANONICAL_HANDOFF_VERSION = 'a12b2c5o-handoff-v1' as const;

// ============================================================================
// 2. EXACT PROPERTY ALLOWLISTS
// ============================================================================

/**
 * Exact 2 own properties required for ProductionTrustAnchorProvisioningCandidate.
 */
export const EXACT_PROVISIONING_CANDIDATE_KEYS = Object.freeze([
  'provisioningRecord',
  'publicAuthorityEntry',
] as const);

const ALLOWED_CANDIDATE_KEYS_SET = new Set<string>(EXACT_PROVISIONING_CANDIDATE_KEYS);

/**
 * Exact 14 own properties required for ProductionTrustAnchorManualHandoffReceipt.
 */
export const EXACT_MANUAL_HANDOFF_RECEIPT_KEYS = Object.freeze([
  'handoffVersion',
  'slotVersion',
  'ceremonyVersion',
  'registryVersion',
  'authorityId',
  'keyVersion',
  'algorithm',
  'publicKeyFingerprintSha256',
  'provisioningRecordDigest',
  'reviewedByOperator',
  'privateKeyNeverEnteredRepository',
  'privateKeyNeverEnteredApplicationRuntime',
  'privateKeyNeverEnteredAIAgentContext',
  'handoffDigest',
] as const);

const ALLOWED_HANDOFF_RECEIPT_KEYS_SET = new Set<string>(EXACT_MANUAL_HANDOFF_RECEIPT_KEYS);

/**
 * Exact 13 fields covered by deterministic manual handoff digest.
 */
export const EXACT_HANDOFF_DIGEST_FIELDS = Object.freeze([
  'handoffVersion',
  'slotVersion',
  'ceremonyVersion',
  'registryVersion',
  'authorityId',
  'keyVersion',
  'algorithm',
  'publicKeyFingerprintSha256',
  'provisioningRecordDigest',
  'reviewedByOperator',
  'privateKeyNeverEnteredRepository',
  'privateKeyNeverEnteredApplicationRuntime',
  'privateKeyNeverEnteredAIAgentContext',
] as const);

const HANDOFF_DIGEST_COVERED_KEYS_SET = new Set<string>(EXACT_HANDOFF_DIGEST_FIELDS);

const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/;

// ============================================================================
// 3. TYPES & INTERFACES
// ============================================================================

/**
 * Candidate pair containing the canonical offline provisioning record
 * and the matching public authority entry.
 */
export interface ProductionTrustAnchorProvisioningCandidate {
  readonly provisioningRecord: ProductionTrustAnchorProvisioningRecord;
  readonly publicAuthorityEntry: ProductionHumanAuthorizationAuthority;
}

/**
 * Manual handoff receipt certifying offline generation, operator review,
 * and strict boundary isolation (private key never entered repository, runtime, or AI agent context).
 */
export interface ProductionTrustAnchorManualHandoffReceipt {
  readonly handoffVersion: typeof CANONICAL_HANDOFF_VERSION;
  readonly slotVersion: typeof PRODUCTION_TRUST_ANCHOR_SLOT_VERSION;
  readonly ceremonyVersion: typeof PROVISIONING_CEREMONY_CONTRACT_VERSION;
  readonly registryVersion: typeof PRODUCTION_AUTHORITY_REGISTRY_VERSION;
  readonly authorityId: typeof CANONICAL_TARGET_AUTHORITY_ID;
  readonly keyVersion: typeof CANONICAL_TARGET_KEY_VERSION;
  readonly algorithm: typeof CANONICAL_TARGET_ALGORITHM;
  readonly publicKeyFingerprintSha256: string;
  readonly provisioningRecordDigest: string;
  readonly reviewedByOperator: true;
  readonly privateKeyNeverEnteredRepository: true;
  readonly privateKeyNeverEnteredApplicationRuntime: true;
  readonly privateKeyNeverEnteredAIAgentContext: true;
  readonly handoffDigest: string;
}

export interface CandidateValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly failureReason?: string;
  readonly candidate?: ProductionTrustAnchorProvisioningCandidate;
}

export interface HandoffValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly failureReason?: string;
  readonly receipt?: ProductionTrustAnchorManualHandoffReceipt;
}

export interface CombinedValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly failureReason?: string;
  readonly candidate?: ProductionTrustAnchorProvisioningCandidate;
  readonly receipt?: ProductionTrustAnchorManualHandoffReceipt;
}

// ============================================================================
// 4. CANDIDATE VALIDATION WITH CROSS-BINDING
// ============================================================================

/**
 * Validates a candidate provisioning pair against exact schema, individual sub-validators,
 * cross-binding equality, and canonical production target identity.
 */
export function validateProductionTrustAnchorProvisioningCandidate(
  candidate: unknown
): CandidateValidationResult {
  const errors: string[] = [];

  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return {
      valid: false,
      failureReason: 'CANDIDATE_NULL_OR_NOT_OBJECT',
      errors: ['CANDIDATE_NULL_OR_NOT_OBJECT: candidate must be a non-null object'],
    };
  }

  const cand = candidate as Record<string, unknown>;

  // 1. Exact allowlist check: reject unknown fields
  for (const key of Object.keys(cand)) {
    if (!ALLOWED_CANDIDATE_KEYS_SET.has(key)) {
      errors.push(`UNKNOWN_PROPERTY: '${key}' is not permitted in candidate`);
    }
  }

  // 2. Own-property requirement: both fields must be own properties
  for (const key of EXACT_PROVISIONING_CANDIDATE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(cand, key)) {
      errors.push(`MISSING_OWN_PROPERTY: '${key}' must be an own property of candidate`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, failureReason: 'CANDIDATE_SCHEMA_VIOLATION', errors };
  }

  // 3. Sub-validation: provisioningRecord
  const recordVal = validateProductionTrustAnchorProvisioningRecord(cand.provisioningRecord);
  if (!recordVal.valid) {
    errors.push(...recordVal.errors.map(e => `PROVISIONING_RECORD_INVALID: ${e}`));
  }

  // 4. Sub-validation: publicAuthorityEntry
  const authVal = validateProductionAuthorityEntry(cand.publicAuthorityEntry);
  if (!authVal.valid) {
    errors.push(...authVal.errors.map(e => `AUTHORITY_ENTRY_INVALID: ${e}`));
  }

  if (errors.length > 0) {
    return { valid: false, failureReason: 'SUB_VALIDATION_FAILED', errors };
  }

  const rec = recordVal.record!;
  const auth = authVal.authority!;

  // 5. Cross-binding equality checks
  if (rec.authorityId !== auth.authorityId) {
    errors.push(
      `AUTHORITY_ID_MISMATCH: provisioningRecord has '${rec.authorityId}', authorityEntry has '${auth.authorityId}'`
    );
  }

  if (rec.keyVersion !== auth.keyVersion) {
    errors.push(
      `KEY_VERSION_MISMATCH: provisioningRecord has '${rec.keyVersion}', authorityEntry has '${auth.keyVersion}'`
    );
  }

  if (rec.algorithm !== auth.algorithm) {
    errors.push(
      `ALGORITHM_MISMATCH: provisioningRecord has '${rec.algorithm}', authorityEntry has '${auth.algorithm}'`
    );
  }

  if (rec.publicKeyPem !== auth.publicKeyPem) {
    errors.push('PUBLIC_KEY_PEM_MISMATCH: provisioningRecord and authorityEntry publicKeyPem do not match');
  }

  if (rec.publicKeyFingerprintSha256 !== auth.publicKeyFingerprintSha256) {
    errors.push(
      `FINGERPRINT_MISMATCH: provisioningRecord has '${rec.publicKeyFingerprintSha256}', authorityEntry has '${auth.publicKeyFingerprintSha256}'`
    );
  }

  // 6. Sealed canonical production target bindings (no caller overrides)
  if (rec.authorityId !== CANONICAL_TARGET_AUTHORITY_ID) {
    errors.push(
      `CANONICAL_TARGET_AUTHORITY_MISMATCH: expected '${CANONICAL_TARGET_AUTHORITY_ID}', got '${rec.authorityId}'`
    );
  }

  if (rec.keyVersion !== CANONICAL_TARGET_KEY_VERSION) {
    errors.push(
      `CANONICAL_TARGET_KEY_VERSION_MISMATCH: expected '${CANONICAL_TARGET_KEY_VERSION}', got '${rec.keyVersion}'`
    );
  }

  if (rec.algorithm !== CANONICAL_TARGET_ALGORITHM) {
    errors.push(
      `CANONICAL_TARGET_ALGORITHM_MISMATCH: expected '${CANONICAL_TARGET_ALGORITHM}', got '${rec.algorithm}'`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    failureReason: errors.length > 0 ? 'CANDIDATE_VALIDATION_FAILED' : undefined,
    candidate: errors.length === 0 ? (cand as unknown as ProductionTrustAnchorProvisioningCandidate) : undefined,
  };
}

// ============================================================================
// 5. DETERMINISTIC MANUAL HANDOFF DIGEST COMPUTATION
// ============================================================================

/**
 * Computes the deterministic SHA-256 digest of a ProductionTrustAnchorManualHandoffReceipt.
 * 
 * Invariants:
 * - Covers exactly the 13 security-critical fields (everything except handoffDigest).
 * - Fixed-order deterministic serialization.
 * - Rejects unknown or extra properties on the input object.
 * - Rejects non-own properties or missing properties.
 * - Enforces strict runtime types without any lossy coercion.
 */
export function computeProductionTrustAnchorManualHandoffDigest(receipt: unknown): string {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw new Error('HANDOFF_DIGEST_INPUT_INVALID: receipt must be a non-null object');
  }

  const rec = receipt as Record<string, unknown>;

  // Check for unknown properties (allowing only the 13 covered fields, or handoffDigest if present)
  for (const key of Object.keys(rec)) {
    if (!HANDOFF_DIGEST_COVERED_KEYS_SET.has(key) && key !== 'handoffDigest') {
      throw new Error(`HANDOFF_DIGEST_INPUT_INVALID: unknown property '${key}' is not permitted in handoff digest input`);
    }
  }

  // Ensure all 13 covered keys exist as own properties
  for (const key of EXACT_HANDOFF_DIGEST_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(rec, key)) {
      throw new Error(`HANDOFF_DIGEST_INPUT_INVALID: missing required own property '${key}'`);
    }
  }

  // Enforce strict runtime types without coercion
  if (typeof rec.handoffVersion !== 'string') {
    throw new Error('HANDOFF_DIGEST_INPUT_INVALID: handoffVersion must be a string');
  }
  if (typeof rec.slotVersion !== 'string') {
    throw new Error('HANDOFF_DIGEST_INPUT_INVALID: slotVersion must be a string');
  }
  if (typeof rec.ceremonyVersion !== 'string') {
    throw new Error('HANDOFF_DIGEST_INPUT_INVALID: ceremonyVersion must be a string');
  }
  if (typeof rec.registryVersion !== 'string') {
    throw new Error('HANDOFF_DIGEST_INPUT_INVALID: registryVersion must be a string');
  }
  if (typeof rec.authorityId !== 'string') {
    throw new Error('HANDOFF_DIGEST_INPUT_INVALID: authorityId must be a string');
  }
  if (typeof rec.keyVersion !== 'string') {
    throw new Error('HANDOFF_DIGEST_INPUT_INVALID: keyVersion must be a string');
  }
  if (typeof rec.algorithm !== 'string') {
    throw new Error('HANDOFF_DIGEST_INPUT_INVALID: algorithm must be a string');
  }
  if (typeof rec.publicKeyFingerprintSha256 !== 'string') {
    throw new Error('HANDOFF_DIGEST_INPUT_INVALID: publicKeyFingerprintSha256 must be a string');
  }
  if (typeof rec.provisioningRecordDigest !== 'string') {
    throw new Error('HANDOFF_DIGEST_INPUT_INVALID: provisioningRecordDigest must be a string');
  }
  if (typeof rec.reviewedByOperator !== 'boolean') {
    throw new Error('HANDOFF_DIGEST_INPUT_INVALID: reviewedByOperator must be a boolean');
  }
  if (typeof rec.privateKeyNeverEnteredRepository !== 'boolean') {
    throw new Error('HANDOFF_DIGEST_INPUT_INVALID: privateKeyNeverEnteredRepository must be a boolean');
  }
  if (typeof rec.privateKeyNeverEnteredApplicationRuntime !== 'boolean') {
    throw new Error('HANDOFF_DIGEST_INPUT_INVALID: privateKeyNeverEnteredApplicationRuntime must be a boolean');
  }
  if (typeof rec.privateKeyNeverEnteredAIAgentContext !== 'boolean') {
    throw new Error('HANDOFF_DIGEST_INPUT_INVALID: privateKeyNeverEnteredAIAgentContext must be a boolean');
  }

  const parts: string[] = [
    `handoffVersion=${rec.handoffVersion}`,
    `slotVersion=${rec.slotVersion}`,
    `ceremonyVersion=${rec.ceremonyVersion}`,
    `registryVersion=${rec.registryVersion}`,
    `authorityId=${rec.authorityId}`,
    `keyVersion=${rec.keyVersion}`,
    `algorithm=${rec.algorithm}`,
    `publicKeyFingerprintSha256=${rec.publicKeyFingerprintSha256}`,
    `provisioningRecordDigest=${rec.provisioningRecordDigest}`,
    `reviewedByOperator=${rec.reviewedByOperator}`,
    `privateKeyNeverEnteredRepository=${rec.privateKeyNeverEnteredRepository}`,
    `privateKeyNeverEnteredApplicationRuntime=${rec.privateKeyNeverEnteredApplicationRuntime}`,
    `privateKeyNeverEnteredAIAgentContext=${rec.privateKeyNeverEnteredAIAgentContext}`,
  ];

  return crypto
    .createHash('sha256')
    .update(parts.join('\n'), 'utf8')
    .digest('hex')
    .toLowerCase();
}

// ============================================================================
// 6. MANUAL HANDOFF RECEIPT VALIDATOR
// ============================================================================

/**
 * Validates a candidate ProductionTrustAnchorManualHandoffReceipt against exact schema,
 * exact versions, operational assertions, and recomputed handoff digest.
 */
export function validateProductionTrustAnchorManualHandoffReceipt(
  receipt: unknown
): HandoffValidationResult {
  const errors: string[] = [];

  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    return {
      valid: false,
      failureReason: 'RECEIPT_NULL_OR_NOT_OBJECT',
      errors: ['RECEIPT_NULL_OR_NOT_OBJECT: receipt must be a non-null object'],
    };
  }

  const rec = receipt as Record<string, unknown>;

  // 1. Exact allowlist check: reject unknown fields
  for (const key of Object.keys(rec)) {
    if (!ALLOWED_HANDOFF_RECEIPT_KEYS_SET.has(key)) {
      errors.push(`UNKNOWN_PROPERTY: '${key}' is not permitted in handoff receipt`);
    }
  }

  // 2. Own-property requirement: all 14 fields must be own properties
  for (const key of EXACT_MANUAL_HANDOFF_RECEIPT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(rec, key)) {
      errors.push(`MISSING_OWN_PROPERTY: '${key}' must be an own property of handoff receipt`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, failureReason: 'RECEIPT_SCHEMA_VIOLATION', errors };
  }

  // 3. Exact runtime types
  if (typeof rec.handoffVersion !== 'string') errors.push('INVALID_TYPE: handoffVersion must be string');
  if (typeof rec.slotVersion !== 'string') errors.push('INVALID_TYPE: slotVersion must be string');
  if (typeof rec.ceremonyVersion !== 'string') errors.push('INVALID_TYPE: ceremonyVersion must be string');
  if (typeof rec.registryVersion !== 'string') errors.push('INVALID_TYPE: registryVersion must be string');
  if (typeof rec.authorityId !== 'string') errors.push('INVALID_TYPE: authorityId must be string');
  if (typeof rec.keyVersion !== 'string') errors.push('INVALID_TYPE: keyVersion must be string');
  if (typeof rec.algorithm !== 'string') errors.push('INVALID_TYPE: algorithm must be string');
  if (typeof rec.publicKeyFingerprintSha256 !== 'string') errors.push('INVALID_TYPE: publicKeyFingerprintSha256 must be string');
  if (typeof rec.provisioningRecordDigest !== 'string') errors.push('INVALID_TYPE: provisioningRecordDigest must be string');
  if (typeof rec.reviewedByOperator !== 'boolean') errors.push('INVALID_TYPE: reviewedByOperator must be boolean');
  if (typeof rec.privateKeyNeverEnteredRepository !== 'boolean') errors.push('INVALID_TYPE: privateKeyNeverEnteredRepository must be boolean');
  if (typeof rec.privateKeyNeverEnteredApplicationRuntime !== 'boolean') errors.push('INVALID_TYPE: privateKeyNeverEnteredApplicationRuntime must be boolean');
  if (typeof rec.privateKeyNeverEnteredAIAgentContext !== 'boolean') errors.push('INVALID_TYPE: privateKeyNeverEnteredAIAgentContext must be boolean');
  if (typeof rec.handoffDigest !== 'string') errors.push('INVALID_TYPE: handoffDigest must be string');

  if (errors.length > 0) {
    return { valid: false, failureReason: 'RUNTIME_TYPE_VIOLATION', errors };
  }

  // 4. Version and identity bindings
  if (rec.handoffVersion !== CANONICAL_HANDOFF_VERSION) {
    errors.push(`INVALID_HANDOFF_VERSION: expected '${CANONICAL_HANDOFF_VERSION}', got '${rec.handoffVersion}'`);
  }

  if (rec.slotVersion !== PRODUCTION_TRUST_ANCHOR_SLOT_VERSION) {
    errors.push(
      `INVALID_SLOT_VERSION: expected '${PRODUCTION_TRUST_ANCHOR_SLOT_VERSION}', got '${rec.slotVersion}'`
    );
  }

  if (rec.ceremonyVersion !== PROVISIONING_CEREMONY_CONTRACT_VERSION) {
    errors.push(
      `INVALID_CEREMONY_VERSION: expected '${PROVISIONING_CEREMONY_CONTRACT_VERSION}', got '${rec.ceremonyVersion}'`
    );
  }

  if (rec.registryVersion !== PRODUCTION_AUTHORITY_REGISTRY_VERSION) {
    errors.push(
      `INVALID_REGISTRY_VERSION: expected '${PRODUCTION_AUTHORITY_REGISTRY_VERSION}', got '${rec.registryVersion}'`
    );
  }

  if (rec.authorityId !== CANONICAL_TARGET_AUTHORITY_ID) {
    errors.push(
      `INVALID_AUTHORITY_ID: expected '${CANONICAL_TARGET_AUTHORITY_ID}', got '${rec.authorityId}'`
    );
  }

  if (rec.keyVersion !== CANONICAL_TARGET_KEY_VERSION) {
    errors.push(
      `INVALID_KEY_VERSION: expected '${CANONICAL_TARGET_KEY_VERSION}', got '${rec.keyVersion}'`
    );
  }

  if (rec.algorithm !== CANONICAL_TARGET_ALGORITHM) {
    errors.push(
      `INVALID_ALGORITHM: expected '${CANONICAL_TARGET_ALGORITHM}', got '${rec.algorithm}'`
    );
  }

  // 5. Hash formats
  if (!SHA256_HEX_REGEX.test(rec.publicKeyFingerprintSha256 as string)) {
    errors.push(
      'INVALID_FINGERPRINT_FORMAT: publicKeyFingerprintSha256 must be 64 lowercase hex characters'
    );
  }

  if (!SHA256_HEX_REGEX.test(rec.provisioningRecordDigest as string)) {
    errors.push(
      'INVALID_RECORD_DIGEST_FORMAT: provisioningRecordDigest must be 64 lowercase hex characters'
    );
  }

  // 6. Operational review & isolation assertions
  if (rec.reviewedByOperator !== true) {
    errors.push('OPERATOR_REVIEW_REQUIRED: reviewedByOperator must be strictly true');
  }

  if (rec.privateKeyNeverEnteredRepository !== true) {
    errors.push(
      'REPOSITORY_ISOLATION_REQUIRED: privateKeyNeverEnteredRepository must be strictly true'
    );
  }

  if (rec.privateKeyNeverEnteredApplicationRuntime !== true) {
    errors.push(
      'RUNTIME_ISOLATION_REQUIRED: privateKeyNeverEnteredApplicationRuntime must be strictly true'
    );
  }

  if (rec.privateKeyNeverEnteredAIAgentContext !== true) {
    errors.push(
      'AI_AGENT_ISOLATION_REQUIRED: privateKeyNeverEnteredAIAgentContext must be strictly true'
    );
  }

  // 7. Deterministic handoff digest recomputation
  if (!SHA256_HEX_REGEX.test(rec.handoffDigest as string)) {
    errors.push(
      'INVALID_HANDOFF_DIGEST_FORMAT: handoffDigest must be 64 lowercase hex characters'
    );
  } else {
    try {
      const expectedDigest = computeProductionTrustAnchorManualHandoffDigest(rec);
      if (expectedDigest !== rec.handoffDigest) {
        errors.push(
          `HANDOFF_DIGEST_MISMATCH: expected '${expectedDigest}', got '${rec.handoffDigest}'`
        );
      }
    } catch (err) {
      errors.push(`HANDOFF_DIGEST_COMPUTATION_ERROR: ${(err as Error).message}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    failureReason: errors.length > 0 ? 'HANDOFF_RECEIPT_VALIDATION_FAILED' : undefined,
    receipt: errors.length === 0 ? (rec as unknown as ProductionTrustAnchorManualHandoffReceipt) : undefined,
  };
}

// ============================================================================
// 7. CANDIDATE + RECEIPT CROSS-BINDING VALIDATOR
// ============================================================================

/**
 * Validates candidate provisioning pair combined with manual handoff receipt,
 * verifying that all security identities and digests cross-bind strictly.
 */
export function validateProvisioningCandidateWithManualHandoff(
  candidate: unknown,
  receipt: unknown
): CombinedValidationResult {
  const errors: string[] = [];

  const candVal = validateProductionTrustAnchorProvisioningCandidate(candidate);
  if (!candVal.valid) {
    errors.push(...candVal.errors.map(e => `CANDIDATE_INVALID: ${e}`));
  }

  const recVal = validateProductionTrustAnchorManualHandoffReceipt(receipt);
  if (!recVal.valid) {
    errors.push(...recVal.errors.map(e => `RECEIPT_INVALID: ${e}`));
  }

  if (errors.length > 0) {
    return { valid: false, failureReason: 'CROSS_BINDING_PREREQUISITES_FAILED', errors };
  }

  const cand = candVal.candidate!;
  const rec = recVal.receipt!;

  if (cand.provisioningRecord.authorityId !== rec.authorityId) {
    errors.push(
      `AUTHORITY_ID_CROSS_MISMATCH: candidate has '${cand.provisioningRecord.authorityId}', receipt has '${rec.authorityId}'`
    );
  }

  if (cand.provisioningRecord.keyVersion !== rec.keyVersion) {
    errors.push(
      `KEY_VERSION_CROSS_MISMATCH: candidate has '${cand.provisioningRecord.keyVersion}', receipt has '${rec.keyVersion}'`
    );
  }

  if (cand.provisioningRecord.algorithm !== rec.algorithm) {
    errors.push(
      `ALGORITHM_CROSS_MISMATCH: candidate has '${cand.provisioningRecord.algorithm}', receipt has '${rec.algorithm}'`
    );
  }

  if (cand.provisioningRecord.publicKeyFingerprintSha256 !== rec.publicKeyFingerprintSha256) {
    errors.push(
      `FINGERPRINT_CROSS_MISMATCH: candidate has '${cand.provisioningRecord.publicKeyFingerprintSha256}', receipt has '${rec.publicKeyFingerprintSha256}'`
    );
  }

  if (cand.provisioningRecord.provisioningRecordDigest !== rec.provisioningRecordDigest) {
    errors.push(
      `RECORD_DIGEST_CROSS_MISMATCH: candidate has '${cand.provisioningRecord.provisioningRecordDigest}', receipt has '${rec.provisioningRecordDigest}'`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    failureReason: errors.length > 0 ? 'CROSS_BINDING_VALIDATION_FAILED' : undefined,
    candidate: errors.length === 0 ? cand : undefined,
    receipt: errors.length === 0 ? rec : undefined,
  };
}
