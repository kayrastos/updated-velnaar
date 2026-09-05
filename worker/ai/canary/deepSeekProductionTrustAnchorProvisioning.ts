/**
 * @file worker/ai/canary/deepSeekProductionTrustAnchorProvisioning.ts
 * @description VELNAR — Phase A.12B.2C-5N Production Human Authorization Trust-Anchor Provisioning Ceremony Contract.
 *
 * STRICT ARCHITECTURAL INVARIANTS:
 * - PURE OFFLINE CEREMONY CONTRACT & VALIDATION ENGINE ONLY.
 * - ZERO DeepSeek calls.
 * - ZERO Gemini calls.
 * - ZERO external provider or network calls.
 * - ZERO provider credentials (no API keys, no bearer tokens).
 * - ZERO production private keys generated, stored, or embedded.
 * - NO live execution or readiness enablement.
 * - PRODUCTION_TRUST_ANCHOR_PROVISIONED remains strictly false.
 * - PRODUCTION_CEREMONY_EXECUTED remains strictly false.
 */

import crypto from 'node:crypto';
import {
  CANONICAL_ALGORITHM,
  computePublicKeyFingerprintSha256,
} from './deepSeekCertificationAttestation';
import {
  EXACT_PRODUCTION_AUTHORITY_KEYS,
  validateProductionAuthorityEntry,
} from './deepSeekProductionAuthorizationTrust';
import type { ProductionHumanAuthorizationAuthority } from './deepSeekProductionAuthorizationTrust';

// ============================================================================
// 1. CEREMONY CONTRACT CONSTANTS
// ============================================================================

export const PROVISIONING_CEREMONY_CONTRACT_VERSION = 'a12b2c5n-v1' as const;

/**
 * Indicates whether a production trust anchor has been provisioned via ceremony.
 * In Phase 5N, this remains strictly false.
 */
export const PRODUCTION_TRUST_ANCHOR_PROVISIONED = false as const;

/**
 * Indicates whether the ceremony has been executed.
 * In Phase 5N, this remains strictly false.
 */
export const PRODUCTION_CEREMONY_EXECUTED = false as const;

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
 * Minimum number of independent witnesses required for ceremony validity.
 */
export const MINIMUM_CEREMONY_WITNESS_COUNT = 3 as const;

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

const ALLOWED_EXECUTED_CEREMONY_RECORD_KEYS_SET = new Set<string>(EXACT_EXECUTED_CEREMONY_RECORD_KEYS);

// ============================================================================
// 2. CEREMONY CONTRACT TYPES & SCHEMAS
// ============================================================================

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

export interface ProvisionedAnchorResolutionResult {
  readonly provisioned: boolean;
  readonly anchor?: ProductionHumanAuthorizationAuthority;
  readonly failureReason: string;
  readonly errors: readonly string[];
}

// ============================================================================
// 3. CANONICAL CEREMONY CONTRACT SPECIFICATION
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
// 4. SCHEMA VALIDATION ENGINE
// ============================================================================

const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/;
const ISO_UTC_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

function isValidUtcTimestamp(ts: string): boolean {
  if (typeof ts !== 'string' || !ISO_UTC_REGEX.test(ts)) {
    return false;
  }
  const date = new Date(ts);
  if (isNaN(date.getTime())) {
    return false;
  }
  return date.toISOString() === ts || date.toISOString().replace('.000Z', 'Z') === ts;
}

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

  // 1. Exact allowlist check
  for (const key of Object.keys(contract)) {
    if (!ALLOWED_CEREMONY_CONTRACT_KEYS_SET.has(key)) {
      errors.push(`UNKNOWN_CONTRACT_PROPERTY: '${key}' is not permitted in ceremony contract`);
    }
  }

  // 2. Own-property requirement
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
    errors.push(`INVALID_CEREMONY_VERSION: expected '${PROVISIONING_CEREMONY_CONTRACT_VERSION}', got '${c.ceremonyVersion}'`);
  }

  if (typeof c.ceremonyId !== 'string' || c.ceremonyId.trim().length === 0) {
    errors.push('INVALID_CEREMONY_ID: ceremonyId must be a non-empty string');
  }

  if (typeof c.scheduledEpochUtc !== 'string' || !isValidUtcTimestamp(c.scheduledEpochUtc)) {
    errors.push('INVALID_SCHEDULED_EPOCH: scheduledEpochUtc must be a valid ISO 8601 UTC timestamp');
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
    errors.push(`INVALID_MINIMUM_WITNESS_COUNT: minimumWitnessCount must be integer >= ${MINIMUM_CEREMONY_WITNESS_COUNT}`);
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
 * Validates an executed ceremony record against contract invariants:
 * - Exact schema allowlist
 * - Own properties only
 * - Anchor validation via Phase 5M validateProductionAuthorityEntry
 * - Witness count >= minimum and all witnesses valid
 * - All witnesses confirmed the exact same public key fingerprint as the anchor
 * - Air gap verified flag must be true
 */
export function validateExecutedCeremonyRecord(
  record: unknown,
  expectedContract: ProvisioningCeremonyContract = CANONICAL_PROVISIONING_CEREMONY_CONTRACT
): CeremonyValidationResult {
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

  if (typeof r.completedAt !== 'string' || !isValidUtcTimestamp(r.completedAt)) {
    errors.push('INVALID_COMPLETED_AT: completedAt must be a valid ISO 8601 UTC timestamp');
  }

  if (r.airGapVerified !== true) {
    errors.push('AIR_GAP_NOT_VERIFIED: airGapVerified must be strictly true');
  }

  if (typeof r.ceremonyTranscriptSha256 !== 'string' || !SHA256_HEX_REGEX.test(r.ceremonyTranscriptSha256)) {
    errors.push('INVALID_TRANSCRIPT_HASH: ceremonyTranscriptSha256 must be 64 lowercase hex characters');
  }

  // Validate the provisioned anchor candidate using 5M entry validator
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
// 5. FAIL-CLOSED TRUST-ANCHOR RESOLUTION API
// ============================================================================

/**
 * Resolves a provisioned production trust anchor.
 * 
 * In Phase 5N, this unconditionally fails closed because the ceremony has not been executed
 * and no production trust anchor is provisioned.
 */
export function resolveProvisionedProductionTrustAnchor(): ProvisionedAnchorResolutionResult {
  return {
    provisioned: false,
    failureReason: 'TRUST_ANCHOR_PROVISIONING_CEREMONY_NOT_EXECUTED',
    errors: [
      'TRUST_ANCHOR_PROVISIONING_CEREMONY_NOT_EXECUTED: Phase 5N ceremony contract is unexecuted; production trust anchor is not provisioned',
    ],
  };
}
