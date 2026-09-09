/**
 * @file worker/ai/canary/deepSeekTrustedRuntimeSourceProvenance.ts
 * @description VELNAR — A.12B.2C-5Q Trusted Runtime Source Provenance Foundation.
 *
 * STRICT ARCHITECTURAL INVARIANTS:
 * - Pure offline verifier foundation only.
 * - ZERO DeepSeek calls.
 * - ZERO Gemini calls.
 * - ZERO external provider or network calls.
 * - ZERO provider credentials (no API keys, no bearer tokens).
 * - ZERO private signing keys embedded or stored in production source.
 * - Public key verification ONLY (Ed25519 asymmetric cryptography).
 * - NO authorization issuance or key generation API (verifier-first design).
 * - RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_PROVISIONED remains strictly false.
 * - TRUSTED_RUNTIME_SOURCE_PROVENANCE_READY remains strictly false.
 * - PRODUCTION_RUNTIME_SOURCE_PROVENANCE_AUTHORITIES remains strictly empty and immutable.
 */

import crypto from 'node:crypto';
import {
  isValidIsoUtcTimestamp,
  computePublicKeyFingerprintSha256,
} from './deepSeekCertificationAttestation';

// ============================================================================
// 1. VERSION & READINESS CONSTANTS
// ============================================================================

export const RUNTIME_SOURCE_PROVENANCE_VERSION = 'a12b2c5q-v1' as const;
export const RUNTIME_SOURCE_PROVENANCE_REGISTRY_VERSION = 'a12b2c5q-registry-v1' as const;

/**
 * Trust anchor provisioning gate: strictly false in Phase 5Q.
 * No production source-provenance authority is provisioned.
 */
export const RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_PROVISIONED = false as const;

/**
 * Operational readiness gate: strictly false in Phase 5Q.
 */
export const TRUSTED_RUNTIME_SOURCE_PROVENANCE_READY = false as const;

// ============================================================================
// 2. CANONICAL TARGET POLICY BOUNDS
// ============================================================================

export const CANONICAL_REPOSITORY_FULL_NAME = 'kayrastos/updated-velnaar' as const;
export const CANONICAL_ENVIRONMENT = 'production' as const;
export const CANONICAL_ALGORITHM = 'Ed25519' as const;

// ============================================================================
// 3. SCHEMA & KEY ALLOWLISTS
// ============================================================================

export const EXACT_AUTHORITY_KEYS = [
  'issuerId',
  'keyVersion',
  'algorithm',
  'publicKeyFingerprintSha256',
  'publicKeyPem',
] as const;

const ALLOWED_AUTHORITY_KEYS_SET = new Set<string>(EXACT_AUTHORITY_KEYS);

export const EXACT_RECEIPT_KEYS = [
  'provenanceVersion',
  'repositoryFullName',
  'sourceCommitSha',
  'sourceTreeSha',
  'buildArtifactSha256',
  'buildId',
  'deploymentId',
  'environment',
  'issuedAt',
  'expiresAt',
  'issuerId',
  'issuerKeyVersion',
  'algorithm',
  'signatureBase64',
] as const;

const ALLOWED_RECEIPT_KEYS_SET = new Set<string>(EXACT_RECEIPT_KEYS);

export const EXACT_PAYLOAD_KEYS = [
  'provenanceVersion',
  'repositoryFullName',
  'sourceCommitSha',
  'sourceTreeSha',
  'buildArtifactSha256',
  'buildId',
  'deploymentId',
  'environment',
  'issuedAt',
  'expiresAt',
  'issuerId',
  'issuerKeyVersion',
  'algorithm',
] as const;

const ALLOWED_PAYLOAD_KEYS_SET = new Set<string>([
  ...EXACT_PAYLOAD_KEYS,
  'signatureBase64',
]);

const SAFE_IDENTIFIER_REGEX = /^[a-zA-Z0-9_-]+$/;
const SAFE_KEY_VERSION_REGEX = /^[a-zA-Z0-9_.-]+$/;
const HEX_40_LOWER_REGEX = /^[0-9a-f]{40}$/;
const HEX_64_LOWER_REGEX = /^[0-9a-f]{64}$/;
const SAFE_BUILD_DEPLOY_ID_REGEX = /^[A-Za-z0-9_-]+$/;

function isObviousPlaceholderId(id: string): boolean {
  const lower = id.toLowerCase();
  if (
    lower === 'placeholder' ||
    lower === 'dummy' ||
    lower === 'unknown' ||
    lower === 'undefined' ||
    lower === 'null' ||
    lower === 'mock' ||
    lower === 'none' ||
    lower === 'todo'
  ) {
    return true;
  }
  if (/^(.)\1{31,}$/.test(id)) {
    return true;
  }
  return false;
}

// ============================================================================
// 4. INTERFACES
// ============================================================================

export interface RuntimeSourceProvenanceAuthority {
  readonly issuerId: string;
  readonly keyVersion: string;
  readonly algorithm: 'Ed25519';
  readonly publicKeyFingerprintSha256: string;
  readonly publicKeyPem: string;
}

export interface RuntimeSourceProvenanceReceipt {
  readonly provenanceVersion: string;
  readonly repositoryFullName: string;
  readonly sourceCommitSha: string;
  readonly sourceTreeSha: string;
  readonly buildArtifactSha256: string;
  readonly buildId: string;
  readonly deploymentId: string;
  readonly environment: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly issuerId: string;
  readonly issuerKeyVersion: string;
  readonly algorithm: 'Ed25519';
  readonly signatureBase64: string;
}

export interface RuntimeSourceProvenancePayload {
  readonly provenanceVersion: string;
  readonly repositoryFullName: string;
  readonly sourceCommitSha: string;
  readonly sourceTreeSha: string;
  readonly buildArtifactSha256: string;
  readonly buildId: string;
  readonly deploymentId: string;
  readonly environment: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly issuerId: string;
  readonly issuerKeyVersion: string;
  readonly algorithm: 'Ed25519';
}

export interface VerifyRuntimeSourceProvenanceOptions {
  /** Deterministic timestamp override for unit testing only */
  readonly nowUtc?: string | Date;
}

export interface VerifyRuntimeSourceProvenanceResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly failureReason?: string;
  readonly receiptDigest?: string;
}

// ============================================================================
// 5. IMMUTABLE EMPTY PRODUCTION ISSUER REGISTRY
// ============================================================================

/**
 * Production runtime source provenance authority registry.
 * Strictly empty and immutable in Phase 5Q.
 */
export const PRODUCTION_RUNTIME_SOURCE_PROVENANCE_AUTHORITIES: readonly RuntimeSourceProvenanceAuthority[] =
  Object.freeze([]);

// ============================================================================
// 6. AUTHORITY VALIDATOR
// ============================================================================

export function validateRuntimeSourceProvenanceAuthority(
  entry: unknown
): { valid: boolean; errors: readonly string[]; authority?: RuntimeSourceProvenanceAuthority } {
  const errors: string[] = [];

  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return {
      valid: false,
      errors: ['ENTRY_NULL: authority entry must be a non-null object'],
    };
  }

  // 1. Exact schema allowlist check (reject unknown properties)
  const entryKeys = Object.keys(entry);
  for (const key of entryKeys) {
    if (!ALLOWED_AUTHORITY_KEYS_SET.has(key)) {
      errors.push(`UNKNOWN_PROPERTY: unknown field '${key}' in authority entry`);
    }
  }

  // 2. Own-property requirement
  for (const key of EXACT_AUTHORITY_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(entry, key)) {
      errors.push(`MISSING_OWN_PROPERTY: required field '${key}' must be an own property of authority`);
    }
  }

  // 3. Exact types
  for (const key of EXACT_AUTHORITY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(entry, key)) {
      const val = (entry as Record<string, unknown>)[key];
      if (typeof val !== 'string') {
        errors.push(`INVALID_FIELD_TYPE: field '${key}' must be a string, got ${typeof val}`);
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const typedEntry = entry as Record<string, string>;

  // 4. Algorithm validation
  if (typedEntry.algorithm !== CANONICAL_ALGORITHM) {
    errors.push(`INVALID_ALGORITHM: expected '${CANONICAL_ALGORITHM}', got '${typedEntry.algorithm}'`);
  }

  // 5. issuerId format and bounds
  const issuerId = typedEntry.issuerId;
  if (!issuerId || issuerId.length < 3 || issuerId.length > 128) {
    errors.push(`INVALID_ISSUER_ID_LENGTH: issuerId length must be between 3 and 128 chars (got ${issuerId.length})`);
  } else if (!SAFE_IDENTIFIER_REGEX.test(issuerId)) {
    errors.push(`INVALID_ISSUER_ID_FORMAT: '${issuerId}' contains unsafe characters`);
  }

  // 6. keyVersion format and bounds
  const keyVersion = typedEntry.keyVersion;
  if (!keyVersion || keyVersion.length < 1 || keyVersion.length > 64) {
    errors.push(`INVALID_KEY_VERSION_LENGTH: keyVersion length must be between 1 and 64 chars (got ${keyVersion.length})`);
  } else if (!SAFE_KEY_VERSION_REGEX.test(keyVersion)) {
    errors.push(`INVALID_KEY_VERSION_FORMAT: '${keyVersion}' contains unsafe characters`);
  }

  // 7. publicKeyFingerprintSha256 format
  const fingerprint = typedEntry.publicKeyFingerprintSha256;
  if (!HEX_64_LOWER_REGEX.test(fingerprint)) {
    errors.push('INVALID_FINGERPRINT_FORMAT: fingerprint must be exactly 64 lowercase hex characters');
  }

  // 8. publicKeyPem validation (must be valid Ed25519 public key, not private, not RSA/ECDSA)
  const pem = typedEntry.publicKeyPem;
  if (typeof pem === 'string') {
    if (/PRIVATE\s+KEY/i.test(pem)) {
      errors.push('PRIVATE_KEY_MATERIAL_FORBIDDEN: private key material must never be in authority');
    } else if (!pem.includes('-----BEGIN PUBLIC KEY-----') || !pem.includes('-----END PUBLIC KEY-----')) {
      errors.push('INVALID_PEM_HEADERS: public key must contain standard SPKI PEM headers');
    } else {
      try {
        const keyObj = crypto.createPublicKey(pem);
        if (keyObj.type !== 'public') {
          errors.push(`PUBLIC_KEY_TYPE_INVALID: expected public key, got type '${keyObj.type}'`);
        }
        if (keyObj.asymmetricKeyType !== 'ed25519') {
          errors.push(`PUBLIC_KEY_ASYMMETRIC_TYPE_INVALID: expected 'ed25519', got '${keyObj.asymmetricKeyType}'`);
        }
      } catch (err) {
        errors.push(`PUBLIC_KEY_PARSE_FAILED: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Recompute fingerprint
      try {
        const recomputedFingerprint = computePublicKeyFingerprintSha256(pem);
        if (fingerprint !== recomputedFingerprint) {
          errors.push(
            `PUBLIC_KEY_FINGERPRINT_MISMATCH: declared '${fingerprint}' does not match recomputed '${recomputedFingerprint}'`
          );
        }
      } catch (err) {
        errors.push(`FINGERPRINT_RECOMPUTATION_ERROR: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    authority: Object.freeze({
      issuerId: typedEntry.issuerId,
      keyVersion: typedEntry.keyVersion,
      algorithm: CANONICAL_ALGORITHM,
      publicKeyFingerprintSha256: typedEntry.publicKeyFingerprintSha256,
      publicKeyPem: typedEntry.publicKeyPem,
    }),
  };
}

// ============================================================================
// 7. CANONICAL SIGNED PAYLOAD SERIALIZATION
// ============================================================================

/**
 * Serializes RuntimeSourceProvenancePayload into a deterministic UTF-8 string.
 * Fixed-order deterministic serialization covering all receipt fields EXCEPT signatureBase64.
 * Rejects unknown properties, missing properties, and lossy type coercion.
 */
export function canonicalizeRuntimeSourceProvenancePayload(input: unknown): string {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('CANONICALIZATION_FAILURE: payload must be a non-null object');
  }

  // 1. Reject unknown extra properties
  const keys = Object.keys(input);
  for (const key of keys) {
    if (!ALLOWED_PAYLOAD_KEYS_SET.has(key)) {
      throw new Error(`CANONICALIZATION_FAILURE: unknown or unauthorized field '${key}' in payload`);
    }
  }

  // 2. Reject missing or null required fields (must be own property)
  const rec = input as Record<string, unknown>;
  for (const key of EXACT_PAYLOAD_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(rec, key)) {
      throw new Error(`CANONICALIZATION_FAILURE: required field '${key}' must be an own property of payload`);
    }
    if (rec[key] === undefined || rec[key] === null) {
      throw new Error(`CANONICALIZATION_FAILURE: required field '${key}' is missing or null`);
    }
  }

  // 3. Exact type validation (all 13 fields must be strings, coercion prohibited)
  for (const field of EXACT_PAYLOAD_KEYS) {
    if (typeof rec[field] !== 'string') {
      throw new Error(`CANONICALIZATION_FAILURE: field '${field}' must be a string (coercion prohibited)`);
    }
  }

  // 4. Strict property-by-property deterministic key ordering
  const ordered = {
    provenanceVersion: rec.provenanceVersion as string,
    repositoryFullName: rec.repositoryFullName as string,
    sourceCommitSha: rec.sourceCommitSha as string,
    sourceTreeSha: rec.sourceTreeSha as string,
    buildArtifactSha256: rec.buildArtifactSha256 as string,
    buildId: rec.buildId as string,
    deploymentId: rec.deploymentId as string,
    environment: rec.environment as string,
    issuedAt: rec.issuedAt as string,
    expiresAt: rec.expiresAt as string,
    issuerId: rec.issuerId as string,
    issuerKeyVersion: rec.issuerKeyVersion as string,
    algorithm: rec.algorithm as string,
  };

  return JSON.stringify(ordered);
}

/**
 * Computes deterministic SHA-256 digest of canonical receipt payload.
 */
export function computeRuntimeSourceProvenanceReceiptDigest(receipt: RuntimeSourceProvenanceReceipt): string {
  const canonicalPayload = canonicalizeRuntimeSourceProvenancePayload(receipt);
  return crypto.createHash('sha256').update(canonicalPayload, 'utf8').digest('hex');
}

// ============================================================================
// 8. GENERIC OFFLINE VERIFIER
// ============================================================================

/**
 * Generic offline cryptographic verifier for testing and foundation use.
 * Validates receipt schema, authority schema, cryptographic bindings, Ed25519 signature,
 * and valid time window.
 */
export function verifyRuntimeSourceProvenanceReceipt(
  receipt: unknown,
  authority: unknown,
  options?: VerifyRuntimeSourceProvenanceOptions
): VerifyRuntimeSourceProvenanceResult {
  const errors: string[] = [];

  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    return {
      valid: false,
      errors: ['RECEIPT_NULL: receipt must be a non-null object'],
      failureReason: 'RECEIPT_NULL',
    };
  }

  if (!authority || typeof authority !== 'object' || Array.isArray(authority)) {
    return {
      valid: false,
      errors: ['AUTHORITY_NULL: authority must be a non-null object'],
      failureReason: 'AUTHORITY_NULL',
    };
  }

  // 1. Receipt schema validation
  const receiptKeys = Object.keys(receipt);
  for (const key of receiptKeys) {
    if (!ALLOWED_RECEIPT_KEYS_SET.has(key)) {
      errors.push(`UNKNOWN_RECEIPT_FIELD: unknown field '${key}' in receipt`);
    }
  }

  for (const key of EXACT_RECEIPT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(receipt, key)) {
      errors.push(`MISSING_OWN_PROPERTY: required field '${key}' must be an own property of receipt`);
    } else {
      const val = (receipt as Record<string, unknown>)[key];
      if (typeof val !== 'string') {
        errors.push(`INVALID_FIELD_TYPE: field '${key}' must be a string, got ${typeof val}`);
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, failureReason: errors[0] };
  }

  const r = receipt as Record<string, string>;

  // 2. Validate authority
  const authCheck = validateRuntimeSourceProvenanceAuthority(authority);
  if (!authCheck.valid || !authCheck.authority) {
    return {
      valid: false,
      errors: authCheck.errors,
      failureReason: authCheck.errors[0],
    };
  }
  const auth = authCheck.authority;

  // 3. Canonical policy bindings
  if (r.provenanceVersion !== RUNTIME_SOURCE_PROVENANCE_VERSION) {
    errors.push(
      `PROVENANCE_VERSION_MISMATCH: expected '${RUNTIME_SOURCE_PROVENANCE_VERSION}', got '${r.provenanceVersion}'`
    );
  }

  if (r.repositoryFullName !== CANONICAL_REPOSITORY_FULL_NAME) {
    errors.push(
      `REPOSITORY_MISMATCH: expected '${CANONICAL_REPOSITORY_FULL_NAME}', got '${r.repositoryFullName}'`
    );
  }

  if (r.environment !== CANONICAL_ENVIRONMENT) {
    errors.push(
      `ENVIRONMENT_MISMATCH: expected '${CANONICAL_ENVIRONMENT}', got '${r.environment}'`
    );
  }

  if (r.algorithm !== CANONICAL_ALGORITHM) {
    errors.push(
      `ALGORITHM_MISMATCH: expected '${CANONICAL_ALGORITHM}', got '${r.algorithm}'`
    );
  }

  // 4. Identity binding between receipt and authority
  if (r.issuerId !== auth.issuerId) {
    errors.push(`ISSUER_ID_MISMATCH: receipt issuerId '${r.issuerId}' !== authority '${auth.issuerId}'`);
  }

  if (r.issuerKeyVersion !== auth.keyVersion) {
    errors.push(`KEY_VERSION_MISMATCH: receipt keyVersion '${r.issuerKeyVersion}' !== authority '${auth.keyVersion}'`);
  }

  if (r.algorithm !== auth.algorithm) {
    errors.push(`AUTHORITY_ALGORITHM_MISMATCH: receipt algorithm '${r.algorithm}' !== authority '${auth.algorithm}'`);
  }

  // 5. Source identifiers format
  if (!HEX_40_LOWER_REGEX.test(r.sourceCommitSha)) {
    errors.push('INVALID_SOURCE_COMMIT_SHA: sourceCommitSha must be exactly 40 lowercase hex characters');
  }

  if (!HEX_40_LOWER_REGEX.test(r.sourceTreeSha)) {
    errors.push('INVALID_SOURCE_TREE_SHA: sourceTreeSha must be exactly 40 lowercase hex characters');
  }

  if (!HEX_64_LOWER_REGEX.test(r.buildArtifactSha256)) {
    errors.push('INVALID_BUILD_ARTIFACT_SHA256: buildArtifactSha256 must be exactly 64 lowercase hex characters');
  }

  // 6. Build and Deployment identifiers format
  if (!r.buildId || r.buildId.length < 32 || r.buildId.length > 128) {
    errors.push(`INVALID_BUILD_ID_LENGTH: buildId length must be between 32 and 128 chars (got ${r.buildId.length})`);
  } else if (!SAFE_BUILD_DEPLOY_ID_REGEX.test(r.buildId)) {
    errors.push(`INVALID_BUILD_ID_FORMAT: '${r.buildId}' contains unsafe characters`);
  } else if (isObviousPlaceholderId(r.buildId)) {
    errors.push(`INVALID_BUILD_ID_PLACEHOLDER: '${r.buildId}' is an obvious placeholder identifier`);
  }

  if (!r.deploymentId || r.deploymentId.length < 32 || r.deploymentId.length > 128) {
    errors.push(`INVALID_DEPLOYMENT_ID_LENGTH: deploymentId length must be between 32 and 128 chars (got ${r.deploymentId.length})`);
  } else if (!SAFE_BUILD_DEPLOY_ID_REGEX.test(r.deploymentId)) {
    errors.push(`INVALID_DEPLOYMENT_ID_FORMAT: '${r.deploymentId}' contains unsafe characters`);
  } else if (isObviousPlaceholderId(r.deploymentId)) {
    errors.push(`INVALID_DEPLOYMENT_ID_PLACEHOLDER: '${r.deploymentId}' is an obvious placeholder identifier`);
  }

  // 7. Time validation
  let now = Date.now();
  if (options && typeof options === 'object' && options.nowUtc !== undefined) {
    if (typeof options.nowUtc === 'string') {
      if (!isValidIsoUtcTimestamp(options.nowUtc)) {
        errors.push('INVALID_VERIFICATION_TIME: options.nowUtc string is not a valid UTC ISO timestamp');
      } else {
        now = Date.parse(options.nowUtc);
      }
    } else if (options.nowUtc instanceof Date) {
      if (!Number.isFinite(options.nowUtc.getTime())) {
        errors.push('INVALID_VERIFICATION_TIME: options.nowUtc Date has non-finite time');
      } else {
        now = options.nowUtc.getTime();
      }
    } else {
      errors.push('INVALID_VERIFICATION_TIME: options.nowUtc must be an ISO string or Date');
    }
  }

  if (!isValidIsoUtcTimestamp(r.issuedAt)) {
    errors.push(`INVALID_ISSUED_AT: '${r.issuedAt}' is not a valid UTC ISO timestamp string`);
  }
  if (!isValidIsoUtcTimestamp(r.expiresAt)) {
    errors.push(`INVALID_EXPIRES_AT: '${r.expiresAt}' is not a valid UTC ISO timestamp string`);
  }

  if (isValidIsoUtcTimestamp(r.issuedAt) && isValidIsoUtcTimestamp(r.expiresAt)) {
    const issuedTime = Date.parse(r.issuedAt);
    const expiresTime = Date.parse(r.expiresAt);

    if (expiresTime <= issuedTime) {
      errors.push(`INVALID_EXPIRY_SEQUENCE: expiresAt (${r.expiresAt}) must be strictly after issuedAt (${r.issuedAt})`);
    }

    if (issuedTime > now) {
      errors.push(`RECEIPT_NOT_YET_VALID: issuedAt (${r.issuedAt}) is in the future relative to verification time`);
    }

    if (expiresTime <= now) {
      errors.push(`RECEIPT_EXPIRED: expiresAt (${r.expiresAt}) has passed relative to verification time`);
    }
  }

  // 8. Signature verification
  if (!r.signatureBase64 || typeof r.signatureBase64 !== 'string') {
    errors.push('SIGNATURE_MISSING: valid signatureBase64 required');
  } else {
    try {
      const canonicalPayloadString = canonicalizeRuntimeSourceProvenancePayload(r);
      const signatureBuffer = Buffer.from(r.signatureBase64, 'base64');
      const payloadBuffer = Buffer.from(canonicalPayloadString, 'utf8');

      const isSignatureValid = crypto.verify(
        null,
        payloadBuffer,
        auth.publicKeyPem,
        signatureBuffer
      );

      if (!isSignatureValid) {
        errors.push('SIGNATURE_VERIFICATION_FAILED: Ed25519 signature is invalid for payload and public key');
      }
    } catch (err) {
      errors.push(`SIGNATURE_VERIFICATION_ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  let receiptDigest: string | undefined;
  if (errors.length === 0) {
    try {
      receiptDigest = computeRuntimeSourceProvenanceReceiptDigest(r as unknown as RuntimeSourceProvenanceReceipt);
    } catch {
      // Ignore digest computation failure if any
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    failureReason: errors[0],
    receiptDigest,
  };
}

// ============================================================================
// 9. RUNTIME / BUILD IDENTITY BINDING
// ============================================================================

/**
 * The fields a signed provenance receipt must bind to the runtime that will
 * consume it. Signature validity and authority trust are intentionally
 * independent from this exact identity comparison.
 */
export interface TrustedRuntimeIdentityBinding {
  readonly repositoryFullName: string;
  readonly sourceCommitSha: string;
  readonly sourceTreeSha: string;
  readonly buildArtifactSha256: string;
  readonly buildId: string;
  readonly deploymentId: string;
  readonly environment: string;
}

export type RuntimeSourceIdentityBindingFailure =
  | 'RUNTIME_SOURCE_BINDING_NOT_PROVISIONED'
  | 'RUNTIME_SOURCE_COMMIT_MISMATCH'
  | 'RUNTIME_SOURCE_TREE_MISMATCH'
  | 'RUNTIME_BUILD_ARTIFACT_MISMATCH'
  | 'RUNTIME_BUILD_ID_MISMATCH'
  | 'RUNTIME_DEPLOYMENT_ID_MISMATCH'
  | 'RUNTIME_ENVIRONMENT_MISMATCH';

export interface RuntimeSourceIdentityBindingResult {
  readonly valid: boolean;
  readonly errors: readonly RuntimeSourceIdentityBindingFailure[];
  readonly failureReason?: RuntimeSourceIdentityBindingFailure;
}

/**
 * A later provisioning phase must replace null with an immutable/generated
 * deployment manifest. No request, caller, environment value, filesystem, or
 * network lookup can supply production expected runtime identity.
 */
export const PRODUCTION_RUNTIME_IDENTITY_BINDING: TrustedRuntimeIdentityBinding | null = null;
export const SOURCE_ATTESTATION_IMPLEMENTATION_READY = true as const;
export const SOURCE_ATTESTATION_OPERATIONAL_READY = false as const;

const EXACT_RUNTIME_IDENTITY_BINDING_KEYS = Object.freeze([
  'repositoryFullName',
  'sourceCommitSha',
  'sourceTreeSha',
  'buildArtifactSha256',
  'buildId',
  'deploymentId',
  'environment',
] as const);

function isTrustedRuntimeIdentityBinding(value: unknown): value is TrustedRuntimeIdentityBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate);
  return keys.length === EXACT_RUNTIME_IDENTITY_BINDING_KEYS.length &&
    keys.every((key) => EXACT_RUNTIME_IDENTITY_BINDING_KEYS.includes(key as any)) &&
    EXACT_RUNTIME_IDENTITY_BINDING_KEYS.every((key) => typeof candidate[key] === 'string' && candidate[key].length > 0);
}

/** Pure binding check for offline tests and provisioning validation. */
export function verifyRuntimeSourceIdentityBinding(
  receipt: unknown,
  expectedRuntimeIdentity: unknown
): RuntimeSourceIdentityBindingResult {
  if (!isTrustedRuntimeIdentityBinding(expectedRuntimeIdentity)) {
    return { valid: false, errors: ['RUNTIME_SOURCE_BINDING_NOT_PROVISIONED'], failureReason: 'RUNTIME_SOURCE_BINDING_NOT_PROVISIONED' };
  }
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    return { valid: false, errors: ['RUNTIME_SOURCE_BINDING_NOT_PROVISIONED'], failureReason: 'RUNTIME_SOURCE_BINDING_NOT_PROVISIONED' };
  }
  const received = receipt as Record<string, unknown>;
  const expected = expectedRuntimeIdentity as TrustedRuntimeIdentityBinding;
  const checks: readonly [keyof TrustedRuntimeIdentityBinding, RuntimeSourceIdentityBindingFailure][] = [
    ['repositoryFullName', 'RUNTIME_SOURCE_BINDING_NOT_PROVISIONED'],
    ['sourceCommitSha', 'RUNTIME_SOURCE_COMMIT_MISMATCH'],
    ['sourceTreeSha', 'RUNTIME_SOURCE_TREE_MISMATCH'],
    ['buildArtifactSha256', 'RUNTIME_BUILD_ARTIFACT_MISMATCH'],
    ['buildId', 'RUNTIME_BUILD_ID_MISMATCH'],
    ['deploymentId', 'RUNTIME_DEPLOYMENT_ID_MISMATCH'],
    ['environment', 'RUNTIME_ENVIRONMENT_MISMATCH'],
  ];
  const errors = checks.filter(([field]) => received[field] !== expected[field]).map(([, failure]) => failure);
  return { valid: errors.length === 0, errors, failureReason: errors[0] };
}

/**
 * Offline helper requiring BOTH cryptographic receipt validity and exact
 * runtime identity binding. It never implies production operational readiness.
 */
export function verifyRuntimeSourceProvenanceReceiptWithBinding(
  receipt: unknown,
  authority: unknown,
  expectedRuntimeIdentity: unknown,
  options?: VerifyRuntimeSourceProvenanceOptions
): VerifyRuntimeSourceProvenanceResult & { readonly binding: RuntimeSourceIdentityBindingResult } {
  const cryptographic = verifyRuntimeSourceProvenanceReceipt(receipt, authority, options);
  const binding = verifyRuntimeSourceIdentityBinding(receipt, expectedRuntimeIdentity);
  if (!cryptographic.valid) return { ...cryptographic, binding };
  if (!binding.valid) return { valid: false, errors: binding.errors, failureReason: binding.failureReason, binding };
  return { ...cryptographic, binding };
}

/** Production wrapper accepts no caller-supplied expected identity or authority. */
export function verifyProductionRuntimeSourceProvenanceBinding(
  receipt: unknown
): VerifyRuntimeSourceProvenanceResult & { readonly binding: RuntimeSourceIdentityBindingResult } {
  const binding = verifyRuntimeSourceIdentityBinding(receipt, PRODUCTION_RUNTIME_IDENTITY_BINDING);
  if (!binding.valid) return { valid: false, errors: binding.errors, failureReason: binding.failureReason, binding };
  const cryptographic = verifyProductionRuntimeSourceProvenanceReceipt(receipt);
  return { ...cryptographic, binding };
}

// ============================================================================
// 10. PRODUCTION RESOLVER
// ============================================================================


export interface ResolveProductionAuthorityParams {
  readonly issuerId: string;
  readonly issuerKeyVersion: string;
  readonly algorithm: string;
}

export type ResolveProductionAuthorityResult =
  | {
      readonly found: false;
      readonly error: 'RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_NOT_PROVISIONED';
      readonly authority?: never;
    }
  | {
      readonly found: true;
      readonly authority: RuntimeSourceProvenanceAuthority;
      readonly error?: never;
    };

/**
 * Resolves a runtime source provenance authority strictly from the immutable
 * production registry PRODUCTION_RUNTIME_SOURCE_PROVENANCE_AUTHORITIES.
 *
 * Rejects caller public key, caller fingerprint, caller descriptors,
 * registry overrides, filesystem, or network lookup.
 *
 * During Phase 5Q, registry is empty, so this function ALWAYS fails closed with:
 * 'RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_NOT_PROVISIONED'
 */
export function resolveProductionRuntimeSourceProvenanceAuthority(
  params: ResolveProductionAuthorityParams
): ResolveProductionAuthorityResult {
  if (!params || typeof params !== 'object') {
    return {
      found: false,
      error: 'RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_NOT_PROVISIONED',
    };
  }

  if (
    typeof params.issuerId !== 'string' ||
    typeof params.issuerKeyVersion !== 'string' ||
    typeof params.algorithm !== 'string'
  ) {
    return {
      found: false,
      error: 'RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_NOT_PROVISIONED',
    };
  }

  for (const authority of PRODUCTION_RUNTIME_SOURCE_PROVENANCE_AUTHORITIES) {
    if (
      authority.issuerId === params.issuerId &&
      authority.keyVersion === params.issuerKeyVersion &&
      authority.algorithm === params.algorithm
    ) {
      return {
        found: true,
        authority,
      };
    }
  }

  return {
    found: false,
    error: 'RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_NOT_PROVISIONED',
  };
}

// ============================================================================
// 11. PRODUCTION VERIFIER
// ============================================================================

/**
 * Production verifier for runtime source provenance receipts.
 * Strictly enforces:
 * 1. RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_PROVISIONED === true (fails closed in 5Q)
 * 2. Resolution strictly from PRODUCTION_RUNTIME_SOURCE_PROVENANCE_AUTHORITIES
 * 3. Uses internal runtime new Date() (no caller time override)
 * 4. Delegates to generic offline verifier
 */
export function verifyProductionRuntimeSourceProvenanceReceipt(
  receipt: unknown
): VerifyRuntimeSourceProvenanceResult {
  // Step 1: Trust anchor provisioned gate
  if ((RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_PROVISIONED as boolean) !== true) {
    return {
      valid: false,
      errors: [
        'RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_NOT_PROVISIONED: production trust anchor is not provisioned',
      ],
      failureReason: 'RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_NOT_PROVISIONED',
    };
  }

  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    return {
      valid: false,
      errors: ['RECEIPT_NULL: receipt must be a non-null object'],
      failureReason: 'RECEIPT_NULL',
    };
  }

  const r = receipt as Record<string, unknown>;

  // Step 2: Resolve issuer from immutable production registry
  const resolveResult = resolveProductionRuntimeSourceProvenanceAuthority({
    issuerId: typeof r.issuerId === 'string' ? r.issuerId : '',
    issuerKeyVersion: typeof r.issuerKeyVersion === 'string' ? r.issuerKeyVersion : '',
    algorithm: typeof r.algorithm === 'string' ? r.algorithm : '',
  });

  if (!resolveResult.found || !resolveResult.authority) {
    return {
      valid: false,
      errors: [
        resolveResult.error ?? 'RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_NOT_PROVISIONED',
      ],
      failureReason: resolveResult.error ?? 'RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_NOT_PROVISIONED',
    };
  }

  // Step 3 & 4: Use runtime Date and delegate to generic verifier
  return verifyRuntimeSourceProvenanceReceipt(receipt, resolveResult.authority, {
    nowUtc: new Date(),
  });
}
