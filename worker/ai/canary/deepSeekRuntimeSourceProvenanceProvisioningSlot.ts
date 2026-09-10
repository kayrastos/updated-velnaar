/**
 * @file worker/ai/canary/deepSeekRuntimeSourceProvenanceProvisioningSlot.ts
 * @description VELNAR — Phase A.12B.2C-5U.3.5A Runtime Source Provenance Public Provisioning Slot & Manual Ceremony Handoff.
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
 * - RUNTIME_SOURCE_PROVENANCE_SLOT_READY remains strictly false.
 * - RUNTIME_SOURCE_PROVENANCE_SLOT_POPULATED remains strictly false.
 * - PRODUCTION_RUNTIME_SOURCE_PROVENANCE_AUTHORITIES entry count remains strictly 0.
 * - RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_PROVISIONED remains strictly false.
 * - SEPARATE TRUST DOMAIN: Issuer ID and keys are strictly distinct from human authorization authority.
 *
 * FUTURE MANUAL CEREMONY SPECIFICATION:
 * The future production provenance private key MUST be generated outside repository and
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
  isValidIsoUtcTimestamp,
  computePublicKeyFingerprintSha256,
} from './deepSeekCertificationAttestation';
import {
  CANONICAL_TARGET_AUTHORITY_ID,
} from './deepSeekProductionTrustAnchorProvisioningSlot';
import {
  RUNTIME_SOURCE_PROVENANCE_REGISTRY_VERSION,
  CANONICAL_ALGORITHM,
  validateRuntimeSourceProvenanceAuthority,
} from './deepSeekTrustedRuntimeSourceProvenance';
import type { RuntimeSourceProvenanceAuthority } from './deepSeekTrustedRuntimeSourceProvenance';

// ============================================================================
// 1. CONSTANTS & SLOT CONFIGURATION
// ============================================================================

export const RUNTIME_SOURCE_PROVENANCE_SLOT_VERSION = 'a12b2c5u35a-v1' as const;

/**
 * Indicates whether the runtime source provenance slot is ready to receive/activate anchors.
 * In Phase 5U.3.5A, this remains strictly false.
 */
export const RUNTIME_SOURCE_PROVENANCE_SLOT_READY = false as const;

/**
 * Indicates whether the runtime source provenance slot is currently populated.
 * In Phase 5U.3.5A, this remains strictly false.
 */
export const RUNTIME_SOURCE_PROVENANCE_SLOT_POPULATED = false as const;

/**
 * Canonical compile-time target provenance authority identity invariants.
 * Strictly caller-independent: no caller overrides or target parameters permitted.
 * DISTINCT from human authorization authority (velnar-lead-ops-prod).
 */
export const CANONICAL_TARGET_PROVENANCE_ISSUER_ID = 'velnar-runtime-provenance-prod' as const;
export const CANONICAL_TARGET_PROVENANCE_KEY_VERSION = '2026-v1' as const;
export const CANONICAL_TARGET_PROVENANCE_ALGORITHM = 'Ed25519' as const;

/**
 * Canonical ceremony contract and manual handoff receipt versions.
 */
export const CANONICAL_PROVENANCE_CEREMONY_CONTRACT_VERSION = 'a12b2c5u35a-ceremony-v1' as const;
export const CANONICAL_PROVENANCE_HANDOFF_VERSION = 'a12b2c5u35a-handoff-v1' as const;

/**
 * Required private key custody mode and operator procedural acknowledgement.
 */
export const CANONICAL_PROVENANCE_PRIVATE_KEY_CUSTODY_MODE = 'OFFLINE_BUILD_SECURITY_CUSTODY' as const;
export const CANONICAL_PROVENANCE_OPERATOR_ACKNOWLEDGEMENT =
  'I_CONFIRM_PROVENANCE_PRIVATE_KEY_IS_OUTSIDE_REPOSITORY_AND_APPLICATION_RUNTIME' as const;

/**
 * Minimum ceremony witness count.
 */
export const MINIMUM_PROVENANCE_CEREMONY_WITNESS_COUNT = 3 as const;

// ============================================================================
// 2. EXACT PROPERTY ALLOWLISTS
// ============================================================================

/**
 * Exact 2 own properties required for RuntimeSourceProvenanceProvisioningCandidate.
 */
export const EXACT_PROVENANCE_PROVISIONING_CANDIDATE_KEYS = Object.freeze([
  'provisioningRecord',
  'publicAuthorityEntry',
] as const);

const ALLOWED_PROVENANCE_CANDIDATE_KEYS_SET = new Set<string>(EXACT_PROVENANCE_PROVISIONING_CANDIDATE_KEYS);

/**
 * Exact 15 own properties required for RuntimeSourceProvenanceProvisioningRecord.
 */
export const EXACT_PROVENANCE_PROVISIONING_RECORD_KEYS = Object.freeze([
  'ceremonyVersion',
  'ceremonyId',
  'registryVersion',
  'issuerId',
  'keyVersion',
  'algorithm',
  'publicKeyPem',
  'publicKeyFingerprintSha256',
  'generatedOutsideRepository',
  'privateKeyCommittedToRepository',
  'privateKeyAccessibleToApplication',
  'privateKeyCustodyMode',
  'createdAt',
  'operatorAcknowledgement',
  'provisioningRecordDigest',
] as const);

const ALLOWED_PROVENANCE_PROVISIONING_RECORD_KEYS_SET = new Set<string>(
  EXACT_PROVENANCE_PROVISIONING_RECORD_KEYS
);

/**
 * Exact 14 fields covered by deterministic record digest.
 */
export const EXACT_PROVENANCE_RECORD_DIGEST_FIELDS = Object.freeze([
  'ceremonyVersion',
  'ceremonyId',
  'registryVersion',
  'issuerId',
  'keyVersion',
  'algorithm',
  'publicKeyPem',
  'publicKeyFingerprintSha256',
  'generatedOutsideRepository',
  'privateKeyCommittedToRepository',
  'privateKeyAccessibleToApplication',
  'privateKeyCustodyMode',
  'createdAt',
  'operatorAcknowledgement',
] as const);

const PROVENANCE_RECORD_DIGEST_FIELDS_SET = new Set<string>(EXACT_PROVENANCE_RECORD_DIGEST_FIELDS);

/**
 * Exact 14 own properties required for RuntimeSourceProvenanceManualHandoffReceipt.
 */
export const EXACT_PROVENANCE_MANUAL_HANDOFF_RECEIPT_KEYS = Object.freeze([
  'handoffVersion',
  'slotVersion',
  'ceremonyVersion',
  'registryVersion',
  'issuerId',
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

const ALLOWED_PROVENANCE_HANDOFF_RECEIPT_KEYS_SET = new Set<string>(
  EXACT_PROVENANCE_MANUAL_HANDOFF_RECEIPT_KEYS
);

/**
 * Exact 13 fields covered by deterministic manual handoff digest.
 */
export const EXACT_PROVENANCE_HANDOFF_DIGEST_FIELDS = Object.freeze([
  'handoffVersion',
  'slotVersion',
  'ceremonyVersion',
  'registryVersion',
  'issuerId',
  'keyVersion',
  'algorithm',
  'publicKeyFingerprintSha256',
  'provisioningRecordDigest',
  'reviewedByOperator',
  'privateKeyNeverEnteredRepository',
  'privateKeyNeverEnteredApplicationRuntime',
  'privateKeyNeverEnteredAIAgentContext',
] as const);

const PROVENANCE_HANDOFF_DIGEST_FIELDS_SET = new Set<string>(EXACT_PROVENANCE_HANDOFF_DIGEST_FIELDS);

const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/;
const CEREMONY_ID_CHARS_REGEX = /^[A-Za-z0-9_-]+$/;

const FORBIDDEN_CEREMONY_IDS = new Set<string>([
  'test',
  'dummy',
  'placeholder',
  'ceremony',
  'production',
  'default',
  'sample',
]);

// ============================================================================
// 3. TYPES & INTERFACES
// ============================================================================

export interface RuntimeSourceProvenanceProvisioningRecord {
  readonly ceremonyVersion: typeof CANONICAL_PROVENANCE_CEREMONY_CONTRACT_VERSION;
  readonly ceremonyId: string;
  readonly registryVersion: typeof RUNTIME_SOURCE_PROVENANCE_REGISTRY_VERSION;
  readonly issuerId: typeof CANONICAL_TARGET_PROVENANCE_ISSUER_ID;
  readonly keyVersion: typeof CANONICAL_TARGET_PROVENANCE_KEY_VERSION;
  readonly algorithm: typeof CANONICAL_TARGET_PROVENANCE_ALGORITHM;
  readonly publicKeyPem: string;
  readonly publicKeyFingerprintSha256: string;
  readonly generatedOutsideRepository: true;
  readonly privateKeyCommittedToRepository: false;
  readonly privateKeyAccessibleToApplication: false;
  readonly privateKeyCustodyMode: typeof CANONICAL_PROVENANCE_PRIVATE_KEY_CUSTODY_MODE;
  readonly createdAt: string;
  readonly operatorAcknowledgement: typeof CANONICAL_PROVENANCE_OPERATOR_ACKNOWLEDGEMENT;
  readonly provisioningRecordDigest: string;
}

export interface RuntimeSourceProvenanceProvisioningCandidate {
  readonly provisioningRecord: RuntimeSourceProvenanceProvisioningRecord;
  readonly publicAuthorityEntry: RuntimeSourceProvenanceAuthority;
}

export interface RuntimeSourceProvenanceManualHandoffReceipt {
  readonly handoffVersion: typeof CANONICAL_PROVENANCE_HANDOFF_VERSION;
  readonly slotVersion: typeof RUNTIME_SOURCE_PROVENANCE_SLOT_VERSION;
  readonly ceremonyVersion: typeof CANONICAL_PROVENANCE_CEREMONY_CONTRACT_VERSION;
  readonly registryVersion: typeof RUNTIME_SOURCE_PROVENANCE_REGISTRY_VERSION;
  readonly issuerId: typeof CANONICAL_TARGET_PROVENANCE_ISSUER_ID;
  readonly keyVersion: typeof CANONICAL_TARGET_PROVENANCE_KEY_VERSION;
  readonly algorithm: typeof CANONICAL_TARGET_PROVENANCE_ALGORITHM;
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
  readonly candidate?: RuntimeSourceProvenanceProvisioningCandidate;
}

export interface RecordValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly failureReason?: string;
  readonly record?: RuntimeSourceProvenanceProvisioningRecord;
}

export interface HandoffValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly failureReason?: string;
  readonly receipt?: RuntimeSourceProvenanceManualHandoffReceipt;
}

export interface CombinedValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly failureReason?: string;
  readonly candidate?: RuntimeSourceProvenanceProvisioningCandidate;
  readonly receipt?: RuntimeSourceProvenanceManualHandoffReceipt;
}

// ============================================================================
// 4. DIGEST COMPUTATIONS
// ============================================================================

/**
 * Computes deterministic SHA-256 digest of RuntimeSourceProvenanceProvisioningRecord.
 * Covers exactly the 14 security-critical fields (all except provisioningRecordDigest).
 */
export function computeRuntimeSourceProvenanceProvisioningRecordDigest(record: unknown): string {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('DIGEST_INPUT_INVALID: record must be a non-null object');
  }

  const rec = record as Record<string, unknown>;

  for (const key of Object.keys(rec)) {
    if (!PROVENANCE_RECORD_DIGEST_FIELDS_SET.has(key) && key !== 'provisioningRecordDigest') {
      throw new Error(`DIGEST_INPUT_INVALID: unknown property '${key}' is not permitted in digest input`);
    }
  }

  for (const key of EXACT_PROVENANCE_RECORD_DIGEST_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(rec, key)) {
      throw new Error(`DIGEST_INPUT_INVALID: missing required own property '${key}'`);
    }
  }

  if (typeof rec.ceremonyVersion !== 'string') throw new Error('DIGEST_INPUT_INVALID: ceremonyVersion must be string');
  if (typeof rec.ceremonyId !== 'string') throw new Error('DIGEST_INPUT_INVALID: ceremonyId must be string');
  if (typeof rec.registryVersion !== 'string') throw new Error('DIGEST_INPUT_INVALID: registryVersion must be string');
  if (typeof rec.issuerId !== 'string') throw new Error('DIGEST_INPUT_INVALID: issuerId must be string');
  if (typeof rec.keyVersion !== 'string') throw new Error('DIGEST_INPUT_INVALID: keyVersion must be string');
  if (typeof rec.algorithm !== 'string') throw new Error('DIGEST_INPUT_INVALID: algorithm must be string');
  if (typeof rec.publicKeyPem !== 'string') throw new Error('DIGEST_INPUT_INVALID: publicKeyPem must be string');
  if (typeof rec.publicKeyFingerprintSha256 !== 'string') throw new Error('DIGEST_INPUT_INVALID: publicKeyFingerprintSha256 must be string');
  if (typeof rec.generatedOutsideRepository !== 'boolean') throw new Error('DIGEST_INPUT_INVALID: generatedOutsideRepository must be boolean');
  if (typeof rec.privateKeyCommittedToRepository !== 'boolean') throw new Error('DIGEST_INPUT_INVALID: privateKeyCommittedToRepository must be boolean');
  if (typeof rec.privateKeyAccessibleToApplication !== 'boolean') throw new Error('DIGEST_INPUT_INVALID: privateKeyAccessibleToApplication must be boolean');
  if (typeof rec.privateKeyCustodyMode !== 'string') throw new Error('DIGEST_INPUT_INVALID: privateKeyCustodyMode must be string');
  if (typeof rec.createdAt !== 'string') throw new Error('DIGEST_INPUT_INVALID: createdAt must be string');
  if (typeof rec.operatorAcknowledgement !== 'string') throw new Error('DIGEST_INPUT_INVALID: operatorAcknowledgement must be string');

  const parts: string[] = [
    `ceremonyVersion=${rec.ceremonyVersion}`,
    `ceremonyId=${rec.ceremonyId}`,
    `registryVersion=${rec.registryVersion}`,
    `issuerId=${rec.issuerId}`,
    `keyVersion=${rec.keyVersion}`,
    `algorithm=${rec.algorithm}`,
    `publicKeyPem=${rec.publicKeyPem}`,
    `publicKeyFingerprintSha256=${rec.publicKeyFingerprintSha256}`,
    `generatedOutsideRepository=${rec.generatedOutsideRepository}`,
    `privateKeyCommittedToRepository=${rec.privateKeyCommittedToRepository}`,
    `privateKeyAccessibleToApplication=${rec.privateKeyAccessibleToApplication}`,
    `privateKeyCustodyMode=${rec.privateKeyCustodyMode}`,
    `createdAt=${rec.createdAt}`,
    `operatorAcknowledgement=${rec.operatorAcknowledgement}`,
  ];

  return crypto
    .createHash('sha256')
    .update(parts.join('\n'), 'utf8')
    .digest('hex')
    .toLowerCase();
}

/**
 * Computes deterministic SHA-256 digest of RuntimeSourceProvenanceManualHandoffReceipt.
 * Covers exactly the 13 security-critical fields (all except handoffDigest).
 */
export function computeRuntimeSourceProvenanceManualHandoffDigest(receipt: unknown): string {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw new Error('HANDOFF_DIGEST_INPUT_INVALID: receipt must be a non-null object');
  }

  const rec = receipt as Record<string, unknown>;

  for (const key of Object.keys(rec)) {
    if (!PROVENANCE_HANDOFF_DIGEST_FIELDS_SET.has(key) && key !== 'handoffDigest') {
      throw new Error(`HANDOFF_DIGEST_INPUT_INVALID: unknown property '${key}' is not permitted in handoff digest input`);
    }
  }

  for (const key of EXACT_PROVENANCE_HANDOFF_DIGEST_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(rec, key)) {
      throw new Error(`HANDOFF_DIGEST_INPUT_INVALID: missing required own property '${key}'`);
    }
  }

  if (typeof rec.handoffVersion !== 'string') throw new Error('HANDOFF_DIGEST_INPUT_INVALID: handoffVersion must be string');
  if (typeof rec.slotVersion !== 'string') throw new Error('HANDOFF_DIGEST_INPUT_INVALID: slotVersion must be string');
  if (typeof rec.ceremonyVersion !== 'string') throw new Error('HANDOFF_DIGEST_INPUT_INVALID: ceremonyVersion must be string');
  if (typeof rec.registryVersion !== 'string') throw new Error('HANDOFF_DIGEST_INPUT_INVALID: registryVersion must be string');
  if (typeof rec.issuerId !== 'string') throw new Error('HANDOFF_DIGEST_INPUT_INVALID: issuerId must be string');
  if (typeof rec.keyVersion !== 'string') throw new Error('HANDOFF_DIGEST_INPUT_INVALID: keyVersion must be string');
  if (typeof rec.algorithm !== 'string') throw new Error('HANDOFF_DIGEST_INPUT_INVALID: algorithm must be string');
  if (typeof rec.publicKeyFingerprintSha256 !== 'string') throw new Error('HANDOFF_DIGEST_INPUT_INVALID: publicKeyFingerprintSha256 must be string');
  if (typeof rec.provisioningRecordDigest !== 'string') throw new Error('HANDOFF_DIGEST_INPUT_INVALID: provisioningRecordDigest must be string');
  if (typeof rec.reviewedByOperator !== 'boolean') throw new Error('HANDOFF_DIGEST_INPUT_INVALID: reviewedByOperator must be boolean');
  if (typeof rec.privateKeyNeverEnteredRepository !== 'boolean') throw new Error('HANDOFF_DIGEST_INPUT_INVALID: privateKeyNeverEnteredRepository must be boolean');
  if (typeof rec.privateKeyNeverEnteredApplicationRuntime !== 'boolean') throw new Error('HANDOFF_DIGEST_INPUT_INVALID: privateKeyNeverEnteredApplicationRuntime must be boolean');
  if (typeof rec.privateKeyNeverEnteredAIAgentContext !== 'boolean') throw new Error('HANDOFF_DIGEST_INPUT_INVALID: privateKeyNeverEnteredAIAgentContext must be boolean');

  const parts: string[] = [
    `handoffVersion=${rec.handoffVersion}`,
    `slotVersion=${rec.slotVersion}`,
    `ceremonyVersion=${rec.ceremonyVersion}`,
    `registryVersion=${rec.registryVersion}`,
    `issuerId=${rec.issuerId}`,
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
// 5. PROVISIONING RECORD VALIDATOR
// ============================================================================

export function validateRuntimeSourceProvenanceProvisioningRecord(
  record: unknown
): RecordValidationResult {
  const errors: string[] = [];

  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return {
      valid: false,
      failureReason: 'RECORD_NULL_OR_NOT_OBJECT',
      errors: ['RECORD_NULL_OR_NOT_OBJECT: record must be a non-null object'],
    };
  }

  const rec = record as Record<string, unknown>;

  // Reject unknown properties
  for (const key of Object.keys(rec)) {
    if (!ALLOWED_PROVENANCE_PROVISIONING_RECORD_KEYS_SET.has(key)) {
      errors.push(`UNKNOWN_PROPERTY: '${key}' is not permitted in provisioning record`);
    }
  }

  // Ensure all required fields exist as own properties
  for (const key of EXACT_PROVENANCE_PROVISIONING_RECORD_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(rec, key)) {
      errors.push(`MISSING_OWN_PROPERTY: '${key}' must be an own property of provisioning record`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, failureReason: 'SCHEMA_ALLOWLIST_VIOLATION', errors };
  }

  // Type checks
  if (typeof rec.ceremonyVersion !== 'string') errors.push('INVALID_TYPE: ceremonyVersion must be string');
  if (typeof rec.ceremonyId !== 'string') errors.push('INVALID_TYPE: ceremonyId must be string');
  if (typeof rec.registryVersion !== 'string') errors.push('INVALID_TYPE: registryVersion must be string');
  if (typeof rec.issuerId !== 'string') errors.push('INVALID_TYPE: issuerId must be string');
  if (typeof rec.keyVersion !== 'string') errors.push('INVALID_TYPE: keyVersion must be string');
  if (typeof rec.algorithm !== 'string') errors.push('INVALID_TYPE: algorithm must be string');
  if (typeof rec.publicKeyPem !== 'string') errors.push('INVALID_TYPE: publicKeyPem must be string');
  if (typeof rec.publicKeyFingerprintSha256 !== 'string') errors.push('INVALID_TYPE: publicKeyFingerprintSha256 must be string');
  if (typeof rec.generatedOutsideRepository !== 'boolean') errors.push('INVALID_TYPE: generatedOutsideRepository must be boolean');
  if (typeof rec.privateKeyCommittedToRepository !== 'boolean') errors.push('INVALID_TYPE: privateKeyCommittedToRepository must be boolean');
  if (typeof rec.privateKeyAccessibleToApplication !== 'boolean') errors.push('INVALID_TYPE: privateKeyAccessibleToApplication must be boolean');
  if (typeof rec.privateKeyCustodyMode !== 'string') errors.push('INVALID_TYPE: privateKeyCustodyMode must be string');
  if (typeof rec.createdAt !== 'string') errors.push('INVALID_TYPE: createdAt must be string');
  if (typeof rec.operatorAcknowledgement !== 'string') errors.push('INVALID_TYPE: operatorAcknowledgement must be string');
  if (typeof rec.provisioningRecordDigest !== 'string') errors.push('INVALID_TYPE: provisioningRecordDigest must be string');

  if (errors.length > 0) {
    return { valid: false, failureReason: 'RUNTIME_TYPE_VIOLATION', errors };
  }

  // Version and identity checks
  if (rec.ceremonyVersion !== CANONICAL_PROVENANCE_CEREMONY_CONTRACT_VERSION) {
    errors.push(`INVALID_CEREMONY_VERSION: expected '${CANONICAL_PROVENANCE_CEREMONY_CONTRACT_VERSION}', got '${rec.ceremonyVersion}'`);
  }

  if (rec.registryVersion !== RUNTIME_SOURCE_PROVENANCE_REGISTRY_VERSION) {
    errors.push(`INVALID_REGISTRY_VERSION: expected '${RUNTIME_SOURCE_PROVENANCE_REGISTRY_VERSION}', got '${rec.registryVersion}'`);
  }

  if (rec.issuerId !== CANONICAL_TARGET_PROVENANCE_ISSUER_ID) {
    errors.push(`INVALID_ISSUER_ID: expected '${CANONICAL_TARGET_PROVENANCE_ISSUER_ID}', got '${rec.issuerId}'`);
  }

  // Enforce separation from human authorization trust domain
  if (rec.issuerId === CANONICAL_TARGET_AUTHORITY_ID) {
    errors.push('PROVENANCE_ISSUER_DOMAIN_COLLISION: provenance issuerId cannot equal human authorityId');
  }

  if (rec.keyVersion !== CANONICAL_TARGET_PROVENANCE_KEY_VERSION) {
    errors.push(`INVALID_KEY_VERSION: expected '${CANONICAL_TARGET_PROVENANCE_KEY_VERSION}', got '${rec.keyVersion}'`);
  }

  if (rec.algorithm !== CANONICAL_TARGET_PROVENANCE_ALGORITHM) {
    errors.push(`INVALID_ALGORITHM: expected '${CANONICAL_TARGET_PROVENANCE_ALGORITHM}', got '${rec.algorithm}'`);
  }

  // Ceremony ID validation
  const ceremonyId = rec.ceremonyId as string;
  if (ceremonyId.trim() !== ceremonyId) {
    errors.push('CEREMONY_ID_WHITESPACE: ceremonyId cannot contain whitespace');
  } else if (FORBIDDEN_CEREMONY_IDS.has(ceremonyId.toLowerCase())) {
    errors.push(`CEREMONY_ID_PLACEHOLDER: '${ceremonyId}' is a forbidden placeholder`);
  } else if (ceremonyId.length < 32 || ceremonyId.length > 128) {
    errors.push(`CEREMONY_ID_LENGTH: ceremonyId length must be between 32 and 128 chars, got ${ceremonyId.length}`);
  } else if (!CEREMONY_ID_CHARS_REGEX.test(ceremonyId)) {
    errors.push('CEREMONY_ID_CHARACTERS: ceremonyId contains invalid characters');
  }

  // Timestamp validation
  if (!isValidIsoUtcTimestamp(rec.createdAt as string)) {
    errors.push('INVALID_CREATED_AT: createdAt must be a valid strict ISO 8601 UTC timestamp');
  }

  // SPKI Public Key validation & Fingerprint check
  const pem = rec.publicKeyPem as string;
  if (/PRIVATE\s+KEY/i.test(pem)) {
    errors.push('PRIVATE_KEY_MATERIAL_FORBIDDEN: private key material must never be in provisioning record');
  } else if (!pem.includes('-----BEGIN PUBLIC KEY-----') || !pem.includes('-----END PUBLIC KEY-----')) {
    errors.push('INVALID_PEM_HEADERS: public key must contain standard SPKI PEM headers');
  } else {
    try {
      const keyObj = crypto.createPublicKey(pem);
      if (keyObj.type !== 'public') {
        errors.push(`PUBLIC_KEY_TYPE_INVALID: expected public key, got '${keyObj.type}'`);
      }
      if (keyObj.asymmetricKeyType !== 'ed25519') {
        errors.push(`PUBLIC_KEY_ASYMMETRIC_TYPE_INVALID: expected 'ed25519', got '${keyObj.asymmetricKeyType}'`);
      }
    } catch (err) {
      errors.push(`PUBLIC_KEY_PARSE_FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }

    try {
      const recomputedFingerprint = computePublicKeyFingerprintSha256(pem);
      if (rec.publicKeyFingerprintSha256 !== recomputedFingerprint) {
        errors.push(
          `PUBLIC_KEY_FINGERPRINT_MISMATCH: declared '${rec.publicKeyFingerprintSha256}' !== recomputed '${recomputedFingerprint}'`
        );
      }
    } catch (err) {
      errors.push(`FINGERPRINT_RECOMPUTATION_ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Custody and isolation assertions
  if (rec.generatedOutsideRepository !== true) {
    errors.push('GENERATED_OUTSIDE_REPOSITORY_REQUIRED: generatedOutsideRepository must be strictly true');
  }

  if (rec.privateKeyCommittedToRepository !== false) {
    errors.push('PRIVATE_KEY_COMMITTED_FORBIDDEN: privateKeyCommittedToRepository must be strictly false');
  }

  if (rec.privateKeyAccessibleToApplication !== false) {
    errors.push('PRIVATE_KEY_ACCESSIBLE_FORBIDDEN: privateKeyAccessibleToApplication must be strictly false');
  }

  if (rec.privateKeyCustodyMode !== CANONICAL_PROVENANCE_PRIVATE_KEY_CUSTODY_MODE) {
    errors.push(`INVALID_CUSTODY_MODE: expected '${CANONICAL_PROVENANCE_PRIVATE_KEY_CUSTODY_MODE}', got '${rec.privateKeyCustodyMode}'`);
  }

  if (rec.operatorAcknowledgement !== CANONICAL_PROVENANCE_OPERATOR_ACKNOWLEDGEMENT) {
    errors.push(`INVALID_OPERATOR_ACKNOWLEDGEMENT: expected '${CANONICAL_PROVENANCE_OPERATOR_ACKNOWLEDGEMENT}', got '${rec.operatorAcknowledgement}'`);
  }

  // Record digest verification
  if (!SHA256_HEX_REGEX.test(rec.provisioningRecordDigest as string)) {
    errors.push('INVALID_DIGEST_FORMAT: provisioningRecordDigest must be 64 lowercase hex characters');
  } else {
    try {
      const expectedDigest = computeRuntimeSourceProvenanceProvisioningRecordDigest(rec);
      if (expectedDigest !== rec.provisioningRecordDigest) {
        errors.push(`DIGEST_MISMATCH: expected '${expectedDigest}', got '${rec.provisioningRecordDigest}'`);
      }
    } catch (err) {
      errors.push(`DIGEST_COMPUTATION_ERROR: ${(err as Error).message}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    failureReason: errors.length > 0 ? 'PROVISIONING_RECORD_VALIDATION_FAILED' : undefined,
    record: errors.length === 0 ? (rec as unknown as RuntimeSourceProvenanceProvisioningRecord) : undefined,
  };
}

// ============================================================================
// 6. CANDIDATE VALIDATOR
// ============================================================================

export function validateRuntimeSourceProvenanceProvisioningCandidate(
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

  for (const key of Object.keys(cand)) {
    if (!ALLOWED_PROVENANCE_CANDIDATE_KEYS_SET.has(key)) {
      errors.push(`UNKNOWN_PROPERTY: '${key}' is not permitted in candidate`);
    }
  }

  for (const key of EXACT_PROVENANCE_PROVISIONING_CANDIDATE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(cand, key)) {
      errors.push(`MISSING_OWN_PROPERTY: '${key}' must be an own property of candidate`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, failureReason: 'CANDIDATE_SCHEMA_VIOLATION', errors };
  }

  const recordVal = validateRuntimeSourceProvenanceProvisioningRecord(cand.provisioningRecord);
  if (!recordVal.valid) {
    errors.push(...recordVal.errors.map(e => `PROVISIONING_RECORD_INVALID: ${e}`));
  }

  const authVal = validateRuntimeSourceProvenanceAuthority(cand.publicAuthorityEntry);
  if (!authVal.valid) {
    errors.push(...authVal.errors.map(e => `AUTHORITY_ENTRY_INVALID: ${e}`));
  }

  if (errors.length > 0) {
    return { valid: false, failureReason: 'SUB_VALIDATION_FAILED', errors };
  }

  const rec = recordVal.record!;
  const auth = authVal.authority!;

  // Cross-binding
  if (rec.issuerId !== auth.issuerId) {
    errors.push(`ISSUER_ID_MISMATCH: provisioningRecord has '${rec.issuerId}', authorityEntry has '${auth.issuerId}'`);
  }

  if (rec.keyVersion !== auth.keyVersion) {
    errors.push(`KEY_VERSION_MISMATCH: provisioningRecord has '${rec.keyVersion}', authorityEntry has '${auth.keyVersion}'`);
  }

  if (rec.algorithm !== auth.algorithm) {
    errors.push(`ALGORITHM_MISMATCH: provisioningRecord has '${rec.algorithm}', authorityEntry has '${auth.algorithm}'`);
  }

  if (rec.publicKeyPem !== auth.publicKeyPem) {
    errors.push('PUBLIC_KEY_PEM_MISMATCH: provisioningRecord and authorityEntry publicKeyPem do not match');
  }

  if (rec.publicKeyFingerprintSha256 !== auth.publicKeyFingerprintSha256) {
    errors.push(
      `FINGERPRINT_MISMATCH: provisioningRecord has '${rec.publicKeyFingerprintSha256}', authorityEntry has '${auth.publicKeyFingerprintSha256}'`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    failureReason: errors.length > 0 ? 'CANDIDATE_VALIDATION_FAILED' : undefined,
    candidate: errors.length === 0 ? (cand as unknown as RuntimeSourceProvenanceProvisioningCandidate) : undefined,
  };
}

// ============================================================================
// 7. MANUAL HANDOFF RECEIPT VALIDATOR
// ============================================================================

export function validateRuntimeSourceProvenanceManualHandoffReceipt(
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

  for (const key of Object.keys(rec)) {
    if (!ALLOWED_PROVENANCE_HANDOFF_RECEIPT_KEYS_SET.has(key)) {
      errors.push(`UNKNOWN_PROPERTY: '${key}' is not permitted in handoff receipt`);
    }
  }

  for (const key of EXACT_PROVENANCE_MANUAL_HANDOFF_RECEIPT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(rec, key)) {
      errors.push(`MISSING_OWN_PROPERTY: '${key}' must be an own property of handoff receipt`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, failureReason: 'RECEIPT_SCHEMA_VIOLATION', errors };
  }

  if (typeof rec.handoffVersion !== 'string') errors.push('INVALID_TYPE: handoffVersion must be string');
  if (typeof rec.slotVersion !== 'string') errors.push('INVALID_TYPE: slotVersion must be string');
  if (typeof rec.ceremonyVersion !== 'string') errors.push('INVALID_TYPE: ceremonyVersion must be string');
  if (typeof rec.registryVersion !== 'string') errors.push('INVALID_TYPE: registryVersion must be string');
  if (typeof rec.issuerId !== 'string') errors.push('INVALID_TYPE: issuerId must be string');
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

  if (rec.handoffVersion !== CANONICAL_PROVENANCE_HANDOFF_VERSION) {
    errors.push(`INVALID_HANDOFF_VERSION: expected '${CANONICAL_PROVENANCE_HANDOFF_VERSION}', got '${rec.handoffVersion}'`);
  }

  if (rec.slotVersion !== RUNTIME_SOURCE_PROVENANCE_SLOT_VERSION) {
    errors.push(`INVALID_SLOT_VERSION: expected '${RUNTIME_SOURCE_PROVENANCE_SLOT_VERSION}', got '${rec.slotVersion}'`);
  }

  if (rec.ceremonyVersion !== CANONICAL_PROVENANCE_CEREMONY_CONTRACT_VERSION) {
    errors.push(`INVALID_CEREMONY_VERSION: expected '${CANONICAL_PROVENANCE_CEREMONY_CONTRACT_VERSION}', got '${rec.ceremonyVersion}'`);
  }

  if (rec.registryVersion !== RUNTIME_SOURCE_PROVENANCE_REGISTRY_VERSION) {
    errors.push(`INVALID_REGISTRY_VERSION: expected '${RUNTIME_SOURCE_PROVENANCE_REGISTRY_VERSION}', got '${rec.registryVersion}'`);
  }

  if (rec.issuerId !== CANONICAL_TARGET_PROVENANCE_ISSUER_ID) {
    errors.push(`INVALID_ISSUER_ID: expected '${CANONICAL_TARGET_PROVENANCE_ISSUER_ID}', got '${rec.issuerId}'`);
  }

  // Domain separation check
  if (rec.issuerId === CANONICAL_TARGET_AUTHORITY_ID) {
    errors.push('PROVENANCE_HANDOFF_DOMAIN_COLLISION: handoff issuerId cannot equal human authorityId');
  }

  if (rec.keyVersion !== CANONICAL_TARGET_PROVENANCE_KEY_VERSION) {
    errors.push(`INVALID_KEY_VERSION: expected '${CANONICAL_TARGET_PROVENANCE_KEY_VERSION}', got '${rec.keyVersion}'`);
  }

  if (rec.algorithm !== CANONICAL_TARGET_PROVENANCE_ALGORITHM) {
    errors.push(`INVALID_ALGORITHM: expected '${CANONICAL_TARGET_PROVENANCE_ALGORITHM}', got '${rec.algorithm}'`);
  }

  if (!SHA256_HEX_REGEX.test(rec.publicKeyFingerprintSha256 as string)) {
    errors.push('INVALID_FINGERPRINT_FORMAT: publicKeyFingerprintSha256 must be 64 lowercase hex characters');
  }

  if (!SHA256_HEX_REGEX.test(rec.provisioningRecordDigest as string)) {
    errors.push('INVALID_RECORD_DIGEST_FORMAT: provisioningRecordDigest must be 64 lowercase hex characters');
  }

  if (rec.reviewedByOperator !== true) {
    errors.push('OPERATOR_REVIEW_REQUIRED: reviewedByOperator must be strictly true');
  }

  if (rec.privateKeyNeverEnteredRepository !== true) {
    errors.push('REPOSITORY_ISOLATION_REQUIRED: privateKeyNeverEnteredRepository must be strictly true');
  }

  if (rec.privateKeyNeverEnteredApplicationRuntime !== true) {
    errors.push('RUNTIME_ISOLATION_REQUIRED: privateKeyNeverEnteredApplicationRuntime must be strictly true');
  }

  if (rec.privateKeyNeverEnteredAIAgentContext !== true) {
    errors.push('AI_AGENT_ISOLATION_REQUIRED: privateKeyNeverEnteredAIAgentContext must be strictly true');
  }

  if (!SHA256_HEX_REGEX.test(rec.handoffDigest as string)) {
    errors.push('INVALID_HANDOFF_DIGEST_FORMAT: handoffDigest must be 64 lowercase hex characters');
  } else {
    try {
      const expectedDigest = computeRuntimeSourceProvenanceManualHandoffDigest(rec);
      if (expectedDigest !== rec.handoffDigest) {
        errors.push(`HANDOFF_DIGEST_MISMATCH: expected '${expectedDigest}', got '${rec.handoffDigest}'`);
      }
    } catch (err) {
      errors.push(`HANDOFF_DIGEST_COMPUTATION_ERROR: ${(err as Error).message}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    failureReason: errors.length > 0 ? 'HANDOFF_RECEIPT_VALIDATION_FAILED' : undefined,
    receipt: errors.length === 0 ? (rec as unknown as RuntimeSourceProvenanceManualHandoffReceipt) : undefined,
  };
}

// ============================================================================
// 8. CROSS-BINDING VALIDATOR
// ============================================================================

export function validateProvenanceCandidateWithManualHandoff(
  candidate: unknown,
  receipt: unknown
): CombinedValidationResult {
  const errors: string[] = [];

  const candVal = validateRuntimeSourceProvenanceProvisioningCandidate(candidate);
  if (!candVal.valid) {
    errors.push(...candVal.errors.map(e => `CANDIDATE_INVALID: ${e}`));
  }

  const recVal = validateRuntimeSourceProvenanceManualHandoffReceipt(receipt);
  if (!recVal.valid) {
    errors.push(...recVal.errors.map(e => `RECEIPT_INVALID: ${e}`));
  }

  if (errors.length > 0) {
    return { valid: false, failureReason: 'CROSS_BINDING_PREREQUISITES_FAILED', errors };
  }

  const cand = candVal.candidate!;
  const rec = recVal.receipt!;

  if (cand.provisioningRecord.issuerId !== rec.issuerId) {
    errors.push(
      `ISSUER_ID_CROSS_MISMATCH: candidate has '${cand.provisioningRecord.issuerId}', receipt has '${rec.issuerId}'`
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
