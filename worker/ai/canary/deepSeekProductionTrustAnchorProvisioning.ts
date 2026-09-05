/**
 * @file worker/ai/canary/deepSeekProductionTrustAnchorProvisioning.ts
 * @description VELNAR — Phase A.12B.2C-5N.1 Canonical Provisioning Record + Caller-Independent Ceremony Policy Repair.
 *
 * STRICT ARCHITECTURAL INVARIANTS:
 * - PURE OFFLINE CEREMONY CONTRACT & CANONICAL PROVISIONING RECORD VALIDATION ENGINE.
 * - ZERO DeepSeek calls.
 * - ZERO Gemini calls.
 * - ZERO external provider or network calls.
 * - ZERO provider credentials (no API keys, no bearer tokens).
 * - ZERO production private keys generated, stored, or embedded.
 * - NO live execution or readiness enablement.
 * - PRODUCTION_TRUST_ANCHOR_PROVISIONED remains strictly false.
 * - PRODUCTION_CEREMONY_EXECUTED remains strictly false.
 * - PRODUCTION_TRUST_ANCHOR_PROVISIONING_READY remains strictly false.
 * - NO caller-controlled ceremony policy in authoritative production validators.
 */

import crypto from 'node:crypto';
import {
  CANONICAL_ALGORITHM,
  computePublicKeyFingerprintSha256,
  isValidIsoUtcTimestamp,
} from './deepSeekCertificationAttestation';
import {
  PRODUCTION_AUTHORITY_REGISTRY_VERSION,
  PRODUCTION_HUMAN_AUTHORITY_REGISTRY,
  EXACT_PRODUCTION_AUTHORITY_KEYS,
  validateProductionAuthorityEntry,
} from './deepSeekProductionAuthorizationTrust';
import type { ProductionHumanAuthorizationAuthority } from './deepSeekProductionAuthorizationTrust';

// ============================================================================
// 1. CEREMONY CONTRACT & PROVISIONING CONSTANTS
// ============================================================================

export const PROVISIONING_CEREMONY_CONTRACT_VERSION = 'a12b2c5n-v1' as const;

/**
 * Indicates whether a production trust anchor has been provisioned via ceremony.
 * In Phase 5N / 5N.1, this remains strictly false.
 */
export const PRODUCTION_TRUST_ANCHOR_PROVISIONED = false as const;

/**
 * Indicates whether the ceremony has been executed.
 * In Phase 5N / 5N.1, this remains strictly false.
 */
export const PRODUCTION_CEREMONY_EXECUTED = false as const;

/**
 * Provisioning readiness flag.
 * In Phase 5N / 5N.1, this remains strictly false.
 */
export const PRODUCTION_TRUST_ANCHOR_PROVISIONING_READY = false as const;

/**
 * Indicates whether any production private signing material is embedded.
 * Strictly false: private keys must NEVER reside in source or application runtime.
 */
export const PRODUCTION_PRIVATE_KEY_EMBEDDED = false as const;

/**
 * Indicates whether a production signing issuer is implemented.
 * Strictly false: verifier-only architecture.
 */
export const PRODUCTION_SIGNING_ISSUER_IMPLEMENTED = false as const;

/**
 * Required cryptographic algorithm for candidate trust anchor.
 */
export const CANONICAL_PROVISIONING_ALGORITHM = 'Ed25519' as const;

/**
 * Required private key custody mode.
 */
export const CANONICAL_PRIVATE_KEY_CUSTODY_MODE = 'OFFLINE_OPERATOR_CUSTODY' as const;

/**
 * Required operator procedural acknowledgement string.
 */
export const CANONICAL_OPERATOR_ACKNOWLEDGEMENT =
  'I_CONFIRM_PRIVATE_KEY_IS_OUTSIDE_REPOSITORY_AND_APPLICATION_RUNTIME' as const;

/**
 * Minimum number of independent witnesses required for ceremony validity.
 */
export const MINIMUM_CEREMONY_WITNESS_COUNT = 3 as const;

/**
 * Forbidden placeholder ceremony IDs.
 */
export const FORBIDDEN_CEREMONY_ID_PLACEHOLDERS = Object.freeze([
  'test',
  'dummy',
  'placeholder',
  'ceremony',
  'production',
  'default',
  'sample',
] as const);

const FORBIDDEN_CEREMONY_IDS_SET = new Set<string>(FORBIDDEN_CEREMONY_ID_PLACEHOLDERS);

// ============================================================================
// 2. EXACT PROPERTY ALLOWLISTS
// ============================================================================

/**
 * Exact 15 required own properties for ProductionTrustAnchorProvisioningRecord.
 */
export const EXACT_PRODUCTION_TRUST_ANCHOR_PROVISIONING_RECORD_KEYS = Object.freeze([
  'ceremonyVersion',
  'ceremonyId',
  'registryVersion',
  'authorityId',
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

const ALLOWED_PROVISIONING_RECORD_KEYS_SET = new Set<string>(
  EXACT_PRODUCTION_TRUST_ANCHOR_PROVISIONING_RECORD_KEYS
);

/**
 * Exact 14 fields covered by the deterministic record digest.
 */
export const EXACT_PROVISIONING_RECORD_DIGEST_FIELDS = Object.freeze([
  'ceremonyVersion',
  'ceremonyId',
  'registryVersion',
  'authorityId',
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

const DIGEST_COVERED_KEYS_SET = new Set<string>(EXACT_PROVISIONING_RECORD_DIGEST_FIELDS);

/**
 * Exact property allowlist for a ProvisioningCeremonyContract.
 */
export const EXACT_CEREMONY_CONTRACT_KEYS = Object.freeze([
  'ceremonyVersion',
  'ceremonyId',
  'scheduledEpochUtc',
  'isolationLevel',
  'targetAuthorityId',
  'targetKeyVersion',
  'targetAlgorithm',
  'minimumWitnessCount',
  'requireAirGapConfirmation',
  'requireHardwareEntropy',
  'prohibitKeyPersistenceOnDisk',
] as const);

const ALLOWED_CEREMONY_CONTRACT_KEYS_SET = new Set<string>(EXACT_CEREMONY_CONTRACT_KEYS);

/**
 * Exact property allowlist for a CeremonyWitness.
 */
export const EXACT_CEREMONY_WITNESS_KEYS = Object.freeze([
  'witnessId',
  'role',
  'organization',
  'confirmedFingerprintSha256',
  'signedAttestationSha256',
] as const);

const ALLOWED_CEREMONY_WITNESS_KEYS_SET = new Set<string>(EXACT_CEREMONY_WITNESS_KEYS);

/**
 * Exact property allowlist for an ExecutedCeremonyRecord.
 */
export const EXACT_EXECUTED_CEREMONY_RECORD_KEYS = Object.freeze([
  'ceremonyId',
  'ceremonyVersion',
  'completedAt',
  'anchor',
  'witnesses',
  'ceremonyTranscriptSha256',
  'airGapVerified',
] as const);

const ALLOWED_EXECUTED_CEREMONY_RECORD_KEYS_SET = new Set<string>(
  EXACT_EXECUTED_CEREMONY_RECORD_KEYS
);

// ============================================================================
// 3. TYPES & INTERFACES
// ============================================================================

/**
 * Canonical Production Trust Anchor Provisioning Record.
 * Represents an offline candidate record for provisioning a trust anchor.
 */
export interface ProductionTrustAnchorProvisioningRecord {
  readonly ceremonyVersion: typeof PROVISIONING_CEREMONY_CONTRACT_VERSION;
  readonly ceremonyId: string;
  readonly registryVersion: typeof PRODUCTION_AUTHORITY_REGISTRY_VERSION;
  readonly authorityId: string;
  readonly keyVersion: string;
  readonly algorithm: 'Ed25519';
  readonly publicKeyPem: string;
  readonly publicKeyFingerprintSha256: string;
  readonly generatedOutsideRepository: true;
  readonly privateKeyCommittedToRepository: false;
  readonly privateKeyAccessibleToApplication: false;
  readonly privateKeyCustodyMode: typeof CANONICAL_PRIVATE_KEY_CUSTODY_MODE;
  readonly createdAt: string;
  readonly operatorAcknowledgement: typeof CANONICAL_OPERATOR_ACKNOWLEDGEMENT;
  readonly provisioningRecordDigest: string;
}

export type ProvisioningCeremonyRole =
  | 'SECURITY_OFFICER'
  | 'ATTESTING_WITNESS'
  | 'COMPLIANCE_AUDITOR';

export const VALID_CEREMONY_ROLES: readonly ProvisioningCeremonyRole[] = Object.freeze([
  'SECURITY_OFFICER',
  'ATTESTING_WITNESS',
  'COMPLIANCE_AUDITOR',
]);

export interface ProvisioningCeremonyWitness {
  readonly witnessId: string;
  readonly role: ProvisioningCeremonyRole;
  readonly organization: string;
  readonly confirmedFingerprintSha256: string;
  readonly signedAttestationSha256: string;
}

export interface ProvisioningCeremonyContract {
  readonly ceremonyVersion: typeof PROVISIONING_CEREMONY_CONTRACT_VERSION;
  readonly ceremonyId: string;
  readonly scheduledEpochUtc: string;
  readonly isolationLevel: 'AIR_GAPPED_OFFLINE';
  readonly targetAuthorityId: string;
  readonly targetKeyVersion: string;
  readonly targetAlgorithm: 'Ed25519';
  readonly minimumWitnessCount: number;
  readonly requireAirGapConfirmation: boolean;
  readonly requireHardwareEntropy: boolean;
  readonly prohibitKeyPersistenceOnDisk: boolean;
}

export interface ExecutedCeremonyRecord {
  readonly ceremonyId: string;
  readonly ceremonyVersion: typeof PROVISIONING_CEREMONY_CONTRACT_VERSION;
  readonly completedAt: string;
  readonly anchor: ProductionHumanAuthorizationAuthority;
  readonly witnesses: readonly ProvisioningCeremonyWitness[];
  readonly ceremonyTranscriptSha256: string;
  readonly airGapVerified: boolean;
}

export interface CeremonyValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly failureReason?: string;
}

export interface ProvisioningRecordValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly failureReason?: string;
  readonly record?: ProductionTrustAnchorProvisioningRecord;
}

export interface ProvisionedAnchorResolutionResult {
  readonly provisioned: boolean;
  readonly anchor?: ProductionHumanAuthorizationAuthority;
  readonly failureReason: string;
  readonly errors: readonly string[];
}

// ============================================================================
// 4. CANONICAL CEREMONY CONTRACT SPECIFICATION
// ============================================================================

/**
 * Immutable canonical contract for the future Phase 5O trust-anchor provisioning ceremony.
 */
export const CANONICAL_PROVISIONING_CEREMONY_CONTRACT: ProvisioningCeremonyContract = Object.freeze({
  ceremonyVersion: PROVISIONING_CEREMONY_CONTRACT_VERSION,
  ceremonyId: 'ceremony-a12b2c5n-anchor-genesis',
  scheduledEpochUtc: '2026-09-06T00:00:00.000Z',
  isolationLevel: 'AIR_GAPPED_OFFLINE',
  targetAuthorityId: 'velnar-lead-ops-prod',
  targetKeyVersion: '2026-v1',
  targetAlgorithm: 'Ed25519',
  minimumWitnessCount: MINIMUM_CEREMONY_WITNESS_COUNT,
  requireAirGapConfirmation: true,
  requireHardwareEntropy: true,
  prohibitKeyPersistenceOnDisk: true,
});

// ============================================================================
// 5. CEREMONY ID & STRING VALIDATION HELPERS
// ============================================================================

const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/;
const CEREMONY_ID_CHARS_REGEX = /^[A-Za-z0-9_-]+$/;

/**
 * Validates that ceremonyId meets strict identity, length, character set,
 * and anti-placeholder requirements.
 */
export function validateCeremonyId(ceremonyId: unknown): { valid: boolean; error?: string } {
  if (typeof ceremonyId !== 'string') {
    return { valid: false, error: 'CEREMONY_ID_NOT_STRING: ceremonyId must be a string' };
  }

  const trimmed = ceremonyId.trim();
  if (trimmed !== ceremonyId) {
    return { valid: false, error: 'CEREMONY_ID_WHITESPACE: ceremonyId cannot contain leading or trailing whitespace' };
  }

  if (FORBIDDEN_CEREMONY_IDS_SET.has(ceremonyId.toLowerCase())) {
    return {
      valid: false,
      error: `CEREMONY_ID_PLACEHOLDER: '${ceremonyId}' is a forbidden placeholder ceremony ID`,
    };
  }

  if (ceremonyId.length < 32 || ceremonyId.length > 128) {
    return {
      valid: false,
      error: `CEREMONY_ID_LENGTH: ceremonyId length must be between 32 and 128 characters, got ${ceremonyId.length}`,
    };
  }

  if (!CEREMONY_ID_CHARS_REGEX.test(ceremonyId)) {
    return {
      valid: false,
      error: 'CEREMONY_ID_CHARACTERS: ceremonyId contains invalid characters; must match ^[A-Za-z0-9_-]+$',
    };
  }

  return { valid: true };
}

// ============================================================================
// 6. DETERMINISTIC RECORD DIGEST COMPUTATION
// ============================================================================

/**
 * Computes the deterministic SHA-256 digest of a ProductionTrustAnchorProvisioningRecord.
 * 
 * Invariants:
 * - Covers exactly the 14 security-critical fields (everything except provisioningRecordDigest).
 * - Fixed-order deterministic serialization.
 * - Rejects any unknown or extra properties on the input object.
 * - Rejects non-own properties or missing properties.
 * - Enforces strict runtime types without any lossy coercion.
 */
export function computeProductionTrustAnchorProvisioningRecordDigest(record: unknown): string {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('DIGEST_INPUT_INVALID: record must be a non-null object');
  }

  const rec = record as Record<string, unknown>;

  // Check for unknown properties (allowing only the 14 covered fields, or provisioningRecordDigest if present)
  for (const key of Object.keys(rec)) {
    if (!DIGEST_COVERED_KEYS_SET.has(key) && key !== 'provisioningRecordDigest') {
      throw new Error(`DIGEST_INPUT_INVALID: unknown property '${key}' is not permitted in digest input`);
    }
  }

  // Ensure all 14 covered keys exist as own properties
  for (const key of EXACT_PROVISIONING_RECORD_DIGEST_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(rec, key)) {
      throw new Error(`DIGEST_INPUT_INVALID: missing required own property '${key}'`);
    }
  }

  // Enforce strict runtime types without coercion
  if (typeof rec.ceremonyVersion !== 'string') {
    throw new Error('DIGEST_INPUT_INVALID: ceremonyVersion must be a string');
  }
  if (typeof rec.ceremonyId !== 'string') {
    throw new Error('DIGEST_INPUT_INVALID: ceremonyId must be a string');
  }
  if (typeof rec.registryVersion !== 'string') {
    throw new Error('DIGEST_INPUT_INVALID: registryVersion must be a string');
  }
  if (typeof rec.authorityId !== 'string') {
    throw new Error('DIGEST_INPUT_INVALID: authorityId must be a string');
  }
  if (typeof rec.keyVersion !== 'string') {
    throw new Error('DIGEST_INPUT_INVALID: keyVersion must be a string');
  }
  if (typeof rec.algorithm !== 'string') {
    throw new Error('DIGEST_INPUT_INVALID: algorithm must be a string');
  }
  if (typeof rec.publicKeyPem !== 'string') {
    throw new Error('DIGEST_INPUT_INVALID: publicKeyPem must be a string');
  }
  if (typeof rec.publicKeyFingerprintSha256 !== 'string') {
    throw new Error('DIGEST_INPUT_INVALID: publicKeyFingerprintSha256 must be a string');
  }
  if (typeof rec.generatedOutsideRepository !== 'boolean') {
    throw new Error('DIGEST_INPUT_INVALID: generatedOutsideRepository must be a boolean');
  }
  if (typeof rec.privateKeyCommittedToRepository !== 'boolean') {
    throw new Error('DIGEST_INPUT_INVALID: privateKeyCommittedToRepository must be a boolean');
  }
  if (typeof rec.privateKeyAccessibleToApplication !== 'boolean') {
    throw new Error('DIGEST_INPUT_INVALID: privateKeyAccessibleToApplication must be a boolean');
  }
  if (typeof rec.privateKeyCustodyMode !== 'string') {
    throw new Error('DIGEST_INPUT_INVALID: privateKeyCustodyMode must be a string');
  }
  if (typeof rec.createdAt !== 'string') {
    throw new Error('DIGEST_INPUT_INVALID: createdAt must be a string');
  }
  if (typeof rec.operatorAcknowledgement !== 'string') {
    throw new Error('DIGEST_INPUT_INVALID: operatorAcknowledgement must be a string');
  }

  const parts: string[] = [
    `ceremonyVersion=${rec.ceremonyVersion}`,
    `ceremonyId=${rec.ceremonyId}`,
    `registryVersion=${rec.registryVersion}`,
    `authorityId=${rec.authorityId}`,
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

// ============================================================================
// 7. CANONICAL RECORD VALIDATOR
// ============================================================================

/**
 * Validates a candidate ProductionTrustAnchorProvisioningRecord against strict schema,
 * cryptographic, custody, operational acknowledgement, and digest invariants.
 *
 * NOTE: Successful validation is strictly an offline check and does NOT provision
 * the trust anchor or modify any global state.
 */
export function validateProductionTrustAnchorProvisioningRecord(
  record: unknown
): ProvisioningRecordValidationResult {
  const errors: string[] = [];

  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return {
      valid: false,
      failureReason: 'RECORD_NULL_OR_NOT_OBJECT',
      errors: ['RECORD_NULL_OR_NOT_OBJECT: record must be a non-null object'],
    };
  }

  const rec = record as Record<string, unknown>;

  // 1. Exact allowlist check: reject unknown fields (including any private key properties)
  for (const key of Object.keys(rec)) {
    if (!ALLOWED_PROVISIONING_RECORD_KEYS_SET.has(key)) {
      errors.push(`UNKNOWN_PROPERTY: '${key}' is not permitted in provisioning record`);
    }
  }

  // 2. Own-property requirement: all 15 fields must be own properties
  for (const key of EXACT_PRODUCTION_TRUST_ANCHOR_PROVISIONING_RECORD_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(rec, key)) {
      errors.push(`MISSING_OWN_PROPERTY: '${key}' must be an own property of provisioning record`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, failureReason: 'SCHEMA_ALLOWLIST_VIOLATION', errors };
  }

  // 3. Exact runtime types
  if (typeof rec.ceremonyVersion !== 'string') errors.push('INVALID_TYPE: ceremonyVersion must be string');
  if (typeof rec.ceremonyId !== 'string') errors.push('INVALID_TYPE: ceremonyId must be string');
  if (typeof rec.registryVersion !== 'string') errors.push('INVALID_TYPE: registryVersion must be string');
  if (typeof rec.authorityId !== 'string') errors.push('INVALID_TYPE: authorityId must be string');
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

  // 4. Ceremony and registry version bindings
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

  // 5. Algorithm binding
  if (rec.algorithm !== CANONICAL_PROVISIONING_ALGORITHM) {
    errors.push(
      `INVALID_ALGORITHM: expected '${CANONICAL_PROVISIONING_ALGORITHM}', got '${rec.algorithm}'`
    );
  }

  // 6. Ceremony ID validation
  const idVal = validateCeremonyId(rec.ceremonyId);
  if (!idVal.valid) {
    errors.push(idVal.error!);
  }

  // 7. Strict UTC createdAt validation (reusing sealed 5L validator)
  if (!isValidIsoUtcTimestamp(rec.createdAt as string)) {
    errors.push('INVALID_CREATED_AT: createdAt must be a valid strict ISO 8601 UTC timestamp');
  }

  // 8. Authority entry validation via Phase 5M validator
  const candidateAuthority: ProductionHumanAuthorizationAuthority = {
    authorityId: rec.authorityId as string,
    keyVersion: rec.keyVersion as string,
    algorithm: rec.algorithm as 'Ed25519',
    publicKeyFingerprintSha256: rec.publicKeyFingerprintSha256 as string,
    publicKeyPem: rec.publicKeyPem as string,
  };

  const authVal = validateProductionAuthorityEntry(candidateAuthority);
  if (!authVal.valid) {
    errors.push(...authVal.errors.map(e => `AUTHORITY_VALIDATION_FAILED: ${e}`));
  }

  // 9. Private key custody invariants
  if (rec.generatedOutsideRepository !== true) {
    errors.push('GENERATED_OUTSIDE_REPOSITORY_REQUIRED: generatedOutsideRepository must be strictly true');
  }

  if (rec.privateKeyCommittedToRepository !== false) {
    errors.push(
      'PRIVATE_KEY_COMMITTED_FORBIDDEN: privateKeyCommittedToRepository must be strictly false'
    );
  }

  if (rec.privateKeyAccessibleToApplication !== false) {
    errors.push(
      'PRIVATE_KEY_ACCESSIBLE_FORBIDDEN: privateKeyAccessibleToApplication must be strictly false'
    );
  }

  if (rec.privateKeyCustodyMode !== CANONICAL_PRIVATE_KEY_CUSTODY_MODE) {
    errors.push(
      `INVALID_CUSTODY_MODE: expected '${CANONICAL_PRIVATE_KEY_CUSTODY_MODE}', got '${rec.privateKeyCustodyMode}'`
    );
  }

  // 10. Operator procedural acknowledgement
  if (rec.operatorAcknowledgement !== CANONICAL_OPERATOR_ACKNOWLEDGEMENT) {
    errors.push(
      `INVALID_OPERATOR_ACKNOWLEDGEMENT: expected '${CANONICAL_OPERATOR_ACKNOWLEDGEMENT}', got '${rec.operatorAcknowledgement}'`
    );
  }

  // 11. Deterministic digest recomputation
  if (!SHA256_HEX_REGEX.test(rec.provisioningRecordDigest as string)) {
    errors.push(
      'INVALID_DIGEST_FORMAT: provisioningRecordDigest must be exactly 64 lowercase hex characters'
    );
  } else {
    try {
      const expectedDigest = computeProductionTrustAnchorProvisioningRecordDigest(rec);
      if (expectedDigest !== rec.provisioningRecordDigest) {
        errors.push(
          `DIGEST_MISMATCH: expected '${expectedDigest}', got '${rec.provisioningRecordDigest}'`
        );
      }
    } catch (err) {
      errors.push(`DIGEST_COMPUTATION_ERROR: ${(err as Error).message}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    failureReason: errors.length > 0 ? 'PROVISIONING_RECORD_VALIDATION_FAILED' : undefined,
    record: errors.length === 0 ? (rec as unknown as ProductionTrustAnchorProvisioningRecord) : undefined,
  };
}

// ============================================================================
// 8. CEREMONY CONTRACT & WITNESS DEFENSE-IN-DEPTH VALIDATORS
// ============================================================================

/**
 * Validates a candidate ceremony contract against strict schema and operational rules.
 */
export function validateProvisioningCeremonyContract(contract: unknown): CeremonyValidationResult {
  const errors: string[] = [];

  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
    return {
      valid: false,
      failureReason: 'CONTRACT_NULL',
      errors: ['CONTRACT_NULL: contract must be a non-null object'],
    };
  }

  for (const key of Object.keys(contract)) {
    if (!ALLOWED_CEREMONY_CONTRACT_KEYS_SET.has(key)) {
      errors.push(`UNKNOWN_CONTRACT_PROPERTY: '${key}' is not permitted in ceremony contract`);
    }
  }

  for (const key of EXACT_CEREMONY_CONTRACT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(contract, key)) {
      errors.push(`MISSING_OWN_PROPERTY: '${key}' must be an own property of contract`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, failureReason: 'SCHEMA_ALLOWLIST_VIOLATION', errors };
  }

  const c = contract as Record<string, unknown>;

  if (c.ceremonyVersion !== PROVISIONING_CEREMONY_CONTRACT_VERSION) {
    errors.push(
      `INVALID_CEREMONY_VERSION: expected '${PROVISIONING_CEREMONY_CONTRACT_VERSION}', got '${c.ceremonyVersion}'`
    );
  }

  const idVal = validateCeremonyId(c.ceremonyId);
  if (!idVal.valid) {
    errors.push(idVal.error!);
  }

  if (typeof c.scheduledEpochUtc !== 'string' || !isValidIsoUtcTimestamp(c.scheduledEpochUtc)) {
    errors.push('INVALID_SCHEDULED_EPOCH: scheduledEpochUtc must be a valid strict ISO 8601 UTC timestamp');
  }

  if (c.isolationLevel !== 'AIR_GAPPED_OFFLINE') {
    errors.push("INVALID_ISOLATION_LEVEL: isolationLevel must be strictly 'AIR_GAPPED_OFFLINE'");
  }

  if (c.targetAlgorithm !== CANONICAL_PROVISIONING_ALGORITHM) {
    errors.push(`INVALID_TARGET_ALGORITHM: targetAlgorithm must be '${CANONICAL_PROVISIONING_ALGORITHM}'`);
  }

  if (
    typeof c.minimumWitnessCount !== 'number' ||
    !Number.isInteger(c.minimumWitnessCount) ||
    c.minimumWitnessCount < MINIMUM_CEREMONY_WITNESS_COUNT
  ) {
    errors.push(
      `INVALID_MINIMUM_WITNESS_COUNT: minimumWitnessCount must be integer >= ${MINIMUM_CEREMONY_WITNESS_COUNT}`
    );
  }

  if (c.requireAirGapConfirmation !== true) {
    errors.push('AIR_GAP_CONFIRMATION_REQUIRED: requireAirGapConfirmation must be true');
  }

  if (c.requireHardwareEntropy !== true) {
    errors.push('HARDWARE_ENTROPY_REQUIRED: requireHardwareEntropy must be true');
  }

  if (c.prohibitKeyPersistenceOnDisk !== true) {
    errors.push('KEY_PERSISTENCE_PROHIBITION_REQUIRED: prohibitKeyPersistenceOnDisk must be true');
  }

  return {
    valid: errors.length === 0,
    errors,
    failureReason: errors.length > 0 ? 'CONTRACT_RULES_VIOLATED' : undefined,
  };
}

/**
 * Validates an individual witness record.
 */
export function validateCeremonyWitness(witness: unknown): CeremonyValidationResult {
  const errors: string[] = [];

  if (!witness || typeof witness !== 'object' || Array.isArray(witness)) {
    return {
      valid: false,
      failureReason: 'WITNESS_NULL',
      errors: ['WITNESS_NULL: witness must be a non-null object'],
    };
  }

  for (const key of Object.keys(witness)) {
    if (!ALLOWED_CEREMONY_WITNESS_KEYS_SET.has(key)) {
      errors.push(`UNKNOWN_WITNESS_PROPERTY: '${key}' is not permitted in witness record`);
    }
  }

  for (const key of EXACT_CEREMONY_WITNESS_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(witness, key)) {
      errors.push(`MISSING_OWN_PROPERTY: '${key}' must be an own property of witness`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, failureReason: 'SCHEMA_ALLOWLIST_VIOLATION', errors };
  }

  const w = witness as Record<string, unknown>;

  if (typeof w.witnessId !== 'string' || w.witnessId.trim().length === 0) {
    errors.push('INVALID_WITNESS_ID: witnessId must be a non-empty string');
  }

  if (!VALID_CEREMONY_ROLES.includes(w.role as ProvisioningCeremonyRole)) {
    errors.push(`INVALID_WITNESS_ROLE: role must be one of ${VALID_CEREMONY_ROLES.join(', ')}`);
  }

  if (typeof w.organization !== 'string' || w.organization.trim().length === 0) {
    errors.push('INVALID_WITNESS_ORGANIZATION: organization must be a non-empty string');
  }

  if (typeof w.confirmedFingerprintSha256 !== 'string' || !SHA256_HEX_REGEX.test(w.confirmedFingerprintSha256)) {
    errors.push('INVALID_CONFIRMED_FINGERPRINT: confirmedFingerprintSha256 must be 64 lowercase hex characters');
  }

  if (typeof w.signedAttestationSha256 !== 'string' || !SHA256_HEX_REGEX.test(w.signedAttestationSha256)) {
    errors.push('INVALID_SIGNED_ATTESTATION: signedAttestationSha256 must be 64 lowercase hex characters');
  }

  return {
    valid: errors.length === 0,
    errors,
    failureReason: errors.length > 0 ? 'WITNESS_RULES_VIOLATED' : undefined,
  };
}

/**
 * Authoritative production validator for executed ceremony records.
 *
 * CALLER-INDEPENDENT CEREMONY POLICY:
 * Accepts strictly (record). Does NOT accept any caller-controlled expectedContract.
 * Internally bound exclusively to CANONICAL_PROVISIONING_CEREMONY_CONTRACT.
 */
export function validateExecutedCeremonyRecord(record: unknown): CeremonyValidationResult {
  const expectedContract = CANONICAL_PROVISIONING_CEREMONY_CONTRACT;
  const errors: string[] = [];

  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return {
      valid: false,
      failureReason: 'RECORD_NULL',
      errors: ['RECORD_NULL: ceremony record must be a non-null object'],
    };
  }

  for (const key of Object.keys(record)) {
    if (!ALLOWED_EXECUTED_CEREMONY_RECORD_KEYS_SET.has(key)) {
      errors.push(`UNKNOWN_RECORD_PROPERTY: '${key}' is not permitted in ceremony record`);
    }
  }

  for (const key of EXACT_EXECUTED_CEREMONY_RECORD_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      errors.push(`MISSING_OWN_PROPERTY: '${key}' must be an own property of ceremony record`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, failureReason: 'SCHEMA_ALLOWLIST_VIOLATION', errors };
  }

  const r = record as Record<string, unknown>;

  if (r.ceremonyVersion !== expectedContract.ceremonyVersion) {
    errors.push(`CEREMONY_VERSION_MISMATCH: expected '${expectedContract.ceremonyVersion}', got '${r.ceremonyVersion}'`);
  }

  if (r.ceremonyId !== expectedContract.ceremonyId) {
    errors.push(`CEREMONY_ID_MISMATCH: expected '${expectedContract.ceremonyId}', got '${r.ceremonyId}'`);
  }

  if (typeof r.completedAt !== 'string' || !isValidIsoUtcTimestamp(r.completedAt)) {
    errors.push('INVALID_COMPLETED_AT: completedAt must be a valid strict ISO 8601 UTC timestamp');
  }

  if (r.airGapVerified !== true) {
    errors.push('AIR_GAP_NOT_VERIFIED: airGapVerified must be strictly true');
  }

  if (typeof r.ceremonyTranscriptSha256 !== 'string' || !SHA256_HEX_REGEX.test(r.ceremonyTranscriptSha256)) {
    errors.push('INVALID_TRANSCRIPT_HASH: ceremonyTranscriptSha256 must be 64 lowercase hex characters');
  }

  // Validate anchor candidate using Phase 5M validator
  const anchorValidation = validateProductionAuthorityEntry(r.anchor);
  if (!anchorValidation.valid) {
    errors.push(...anchorValidation.errors.map(e => `ANCHOR_INVALID: ${e}`));
  } else {
    const anchor = anchorValidation.authority!;
    if (anchor.authorityId !== expectedContract.targetAuthorityId) {
      errors.push(
        `ANCHOR_AUTHORITY_ID_MISMATCH: expected '${expectedContract.targetAuthorityId}', got '${anchor.authorityId}'`
      );
    }
    if (anchor.keyVersion !== expectedContract.targetKeyVersion) {
      errors.push(
        `ANCHOR_KEY_VERSION_MISMATCH: expected '${expectedContract.targetKeyVersion}', got '${anchor.keyVersion}'`
      );
    }
    if (anchor.algorithm !== expectedContract.targetAlgorithm) {
      errors.push(
        `ANCHOR_ALGORITHM_MISMATCH: expected '${expectedContract.targetAlgorithm}', got '${anchor.algorithm}'`
      );
    }

    // Validate witnesses
    if (!Array.isArray(r.witnesses)) {
      errors.push('INVALID_WITNESSES_TYPE: witnesses must be an array');
    } else {
      if (r.witnesses.length < expectedContract.minimumWitnessCount) {
        errors.push(
          `INSUFFICIENT_WITNESSES: required >= ${expectedContract.minimumWitnessCount}, got ${r.witnesses.length}`
        );
      }

      const seenWitnessIds = new Set<string>();
      for (let i = 0; i < r.witnesses.length; i++) {
        const w = r.witnesses[i];
        const wVal = validateCeremonyWitness(w);
        if (!wVal.valid) {
          errors.push(...wVal.errors.map(e => `WITNESS_${i}_INVALID: ${e}`));
        } else {
          const witness = w as ProvisioningCeremonyWitness;
          if (seenWitnessIds.has(witness.witnessId)) {
            errors.push(`DUPLICATE_WITNESS_ID: duplicate witnessId '${witness.witnessId}' at index ${i}`);
          } else {
            seenWitnessIds.add(witness.witnessId);
          }

          if (witness.confirmedFingerprintSha256 !== anchor.publicKeyFingerprintSha256) {
            errors.push(
              `WITNESS_FINGERPRINT_MISMATCH: witness '${witness.witnessId}' confirmed '${witness.confirmedFingerprintSha256}', anchor has '${anchor.publicKeyFingerprintSha256}'`
            );
          }
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    failureReason: errors.length > 0 ? 'CEREMONY_RECORD_VERIFICATION_FAILED' : undefined,
  };
}

// ============================================================================
// 9. FAIL-CLOSED TRUST-ANCHOR RESOLUTION API
// ============================================================================

/**
 * Resolves a provisioned production trust anchor.
 * 
 * In Phase 5N / 5N.1, this unconditionally fails closed because the ceremony has not been executed
 * and no production trust anchor is provisioned.
 */
export function resolveProvisionedProductionTrustAnchor(): ProvisionedAnchorResolutionResult {
  return {
    provisioned: false,
    failureReason: 'TRUST_ANCHOR_PROVISIONING_CEREMONY_NOT_EXECUTED',
    errors: [
      'TRUST_ANCHOR_PROVISIONING_CEREMONY_NOT_EXECUTED: Phase 5N.1 ceremony contract is unexecuted; production trust anchor is not provisioned',
    ],
  };
}
