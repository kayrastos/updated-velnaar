/**
 * @file worker/ai/canary/deepSeekProductionAuthorizationTrust.ts
 * @description VELNAR — A.12B.2C-5M Production Human Authorization Trust-Anchor Registry Foundation.
 *
 * STRICT ARCHITECTURAL INVARIANTS:
 * - PURE OFFLINE TRUST-ANCHOR REGISTRY FOUNDATION ONLY.
 * - ZERO DeepSeek calls.
 * - ZERO Gemini calls.
 * - ZERO external provider or network calls.
 * - ZERO provider credentials (no API keys, no bearer tokens).
 * - ZERO private signing keys embedded or stored in production source.
 * - Public key verification ONLY (Ed25519 asymmetric cryptography).
 * - NO authorization issuance or signing API (verifier-first design).
 * - CANARY_LIVE_EXECUTION_ENABLED remains strictly untouched/false.
 * - GUARDED_SOURCE_ATTESTATION_READY remains strictly false.
 * - GUARDED_HUMAN_AUTH_ATTESTATION_READY remains strictly false.
 * - PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED remains strictly false.
 */

import crypto from 'node:crypto';
import {
  CANONICAL_ALGORITHM,
  computePublicKeyFingerprintSha256,
  verifyHumanAuthorizationPackage,
} from './deepSeekCertificationAttestation';
import type {
  SignedHumanAuthorizationPackage,
  TrustedSourceAttestation,
} from './deepSeekCertificationAttestation';

// ============================================================================
// 1. REGISTRY CONSTANTS & STATE
// ============================================================================

export const PRODUCTION_AUTHORITY_REGISTRY_VERSION = 'a12b2c5m-v1' as const;

/**
 * Indicates whether a real production human authorization trust anchor has been provisioned.
 * In Phase 5M, this is strictly false and verification remains fail-closed.
 */
export const PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED = false as const;

/**
 * Indicates whether automatic/remote key rotation mechanisms are implemented.
 * Strictly false: no JWKS, no KMS, no remote key fetching, no dynamic rotation.
 */
export const PRODUCTION_KEY_ROTATION_IMPLEMENTED = false as const;

/**
 * Exact property allowlist for ProductionHumanAuthorizationAuthority entries.
 */
export const EXACT_PRODUCTION_AUTHORITY_KEYS = Object.freeze([
  'authorityId',
  'keyVersion',
  'algorithm',
  'publicKeyFingerprintSha256',
  'publicKeyPem',
] as const);

const ALLOWED_PRODUCTION_AUTHORITY_KEYS_SET = new Set<string>(EXACT_PRODUCTION_AUTHORITY_KEYS);

// ============================================================================
// 2. PRODUCTION REGISTRY TYPES
// ============================================================================

/**
 * Production human authorization authority registered in the immutable trust registry.
 * Contains public cryptographic verification material only.
 */
export interface ProductionHumanAuthorizationAuthority {
  readonly authorityId: string;
  readonly keyVersion: string;
  readonly algorithm: 'Ed25519';
  readonly publicKeyFingerprintSha256: string;
  readonly publicKeyPem: string;
}

/**
 * Immutable production human authorization trust-anchor registry.
 * In Phase 5M, this registry is intentionally empty.
 */
export const PRODUCTION_HUMAN_AUTHORITY_REGISTRY: readonly ProductionHumanAuthorizationAuthority[] =
  Object.freeze([]);

/**
 * Selector for querying authority identity derived from a signed package.
 */
export interface ProductionAuthoritySelector {
  readonly authorityId: string;
  readonly keyVersion: string;
  readonly algorithm: string;
}

export interface ProductionAuthorityResolutionResult {
  readonly resolved: boolean;
  readonly authority?: ProductionHumanAuthorizationAuthority;
  readonly failureReason?: string;
  readonly errors: readonly string[];
}

export interface ProductionVerificationResult {
  readonly verified: boolean;
  readonly errors: readonly string[];
  readonly failureReason?: string;
  readonly authorizationPackageDigest?: string;
  readonly authorizationConsumptionKey?: string;
}

// ============================================================================
// 3. REGISTRY VALIDATION (SCHEMA & CRYPTOGRAPHY)
// ============================================================================

const SAFE_IDENTIFIER_REGEX = /^[a-zA-Z0-9_-]+$/;
const SAFE_KEY_VERSION_REGEX = /^[a-zA-Z0-9_.-]+$/;
const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/;

/**
 * Validates a candidate production authority entry against strict schema and crypto invariants:
 * - Exact 5-property allowlist (no extra fields)
 * - Own properties only (no prototype inheritance)
 * - Exact string types without coercion
 * - Algorithm must strictly equal 'Ed25519'
 * - Safe identifier formats for authorityId and keyVersion
 * - Exact 64 lowercase hex chars for publicKeyFingerprintSha256
 * - Valid Ed25519 public key in SPKI PEM format (no private key material permitted)
 * - Cryptographic match between publicKeyPem and recomputed SHA-256 fingerprint
 */
export function validateProductionAuthorityEntry(
  entry: unknown
): { valid: boolean; errors: readonly string[]; authority?: ProductionHumanAuthorizationAuthority } {
  const errors: string[] = [];

  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return {
      valid: false,
      errors: ['ENTRY_NULL: entry must be a non-null object'],
    };
  }

  // 1. Exact schema allowlist check (reject unknown properties)
  const entryKeys = Object.keys(entry);
  for (const key of entryKeys) {
    if (!ALLOWED_PRODUCTION_AUTHORITY_KEYS_SET.has(key)) {
      errors.push(`UNKNOWN_PROPERTY: unknown field '${key}' in production authority entry`);
    }
  }

  // 2. Own-property requirement
  for (const key of EXACT_PRODUCTION_AUTHORITY_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(entry, key)) {
      errors.push(`MISSING_OWN_PROPERTY: required field '${key}' must be an own property of entry`);
    }
  }

  // 3. Exact types
  for (const key of EXACT_PRODUCTION_AUTHORITY_KEYS) {
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

  // 5. authorityId format and bounds
  const authorityId = typedEntry.authorityId;
  if (!authorityId || authorityId.length < 3 || authorityId.length > 128) {
    errors.push(`INVALID_AUTHORITY_ID_LENGTH: authorityId length must be between 3 and 128 chars (got ${authorityId.length})`);
  } else if (!SAFE_IDENTIFIER_REGEX.test(authorityId)) {
    errors.push(`INVALID_AUTHORITY_ID_FORMAT: '${authorityId}' contains unsafe characters`);
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
  if (!SHA256_HEX_REGEX.test(fingerprint)) {
    errors.push(`INVALID_FINGERPRINT_FORMAT: fingerprint must be exactly 64 lowercase hex characters`);
  }

  // 8. publicKeyPem validation (must be valid Ed25519 public key, not private)
  const pem = typedEntry.publicKeyPem;
  if (typeof pem === 'string') {
    // Check for private key material markers
    if (/PRIVATE\s+KEY/i.test(pem)) {
      errors.push('PRIVATE_KEY_MATERIAL_FORBIDDEN: private key material must never be in public registry');
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
      authorityId,
      keyVersion,
      algorithm: 'Ed25519',
      publicKeyFingerprintSha256: fingerprint,
      publicKeyPem: pem,
    }),
  };
}

/**
 * Validates an entire registry collection for schema correctness,
 * cryptographic validity, and uniqueness invariants (no duplicate authorityId+keyVersion, no conflicting fingerprints).
 */
export function validateProductionAuthorityRegistry(
  registry: readonly unknown[]
): { valid: boolean; errors: readonly string[] } {
  const errors: string[] = [];

  if (!Array.isArray(registry)) {
    return { valid: false, errors: ['REGISTRY_NOT_ARRAY: registry must be an array'] };
  }

  const seenAuthorityKeyVersions = new Set<string>();
  const seenFingerprints = new Set<string>();

  for (let i = 0; i < registry.length; i++) {
    const entry = registry[i];
    const validation = validateProductionAuthorityEntry(entry);
    if (!validation.valid) {
      errors.push(`ENTRY_${i}_INVALID: ${validation.errors.join('; ')}`);
      continue;
    }

    const auth = validation.authority!;
    const identityKey = `${auth.authorityId}:${auth.keyVersion}`;
    if (seenAuthorityKeyVersions.has(identityKey)) {
      errors.push(`DUPLICATE_AUTHORITY_KEY_VERSION: duplicate entry for '${identityKey}' at index ${i}`);
    } else {
      seenAuthorityKeyVersions.add(identityKey);
    }

    if (seenFingerprints.has(auth.publicKeyFingerprintSha256)) {
      errors.push(
        `DUPLICATE_PUBLIC_KEY_FINGERPRINT: duplicate fingerprint '${auth.publicKeyFingerprintSha256}' at index ${i}`
      );
    } else {
      seenFingerprints.add(auth.publicKeyFingerprintSha256);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ============================================================================
// 4. PRODUCTION RESOLUTION API
// ============================================================================

/**
 * Resolves a trusted production human authorization authority exclusively from the immutable registry.
 * 
 * Invariants:
 * - Reads ONLY from PRODUCTION_HUMAN_AUTHORITY_REGISTRY
 * - Does NOT accept caller-supplied authority descriptors, public keys, or fingerprints
 * - Does NOT read from environment variables, CLI arguments, filesystems, HTTP headers, or network
 * - Fails closed immediately if PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED is false
 */
export function resolveProductionHumanAuthorizationAuthority(
  selector: ProductionAuthoritySelector
): ProductionAuthorityResolutionResult {
  // 1. Fail-closed check if trust anchor is unprovisioned
  if (!PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED) {
    return {
      resolved: false,
      failureReason: 'PRODUCTION_AUTHORITY_TRUST_ANCHOR_NOT_PROVISIONED',
      errors: [
        'PRODUCTION_AUTHORITY_TRUST_ANCHOR_NOT_PROVISIONED: no production trust anchor is provisioned in this release',
      ],
    };
  }

  if (!selector || typeof selector !== 'object') {
    return {
      resolved: false,
      failureReason: 'SELECTOR_NULL',
      errors: ['SELECTOR_NULL: selector must be a non-null object'],
    };
  }

  const { authorityId, keyVersion, algorithm } = selector;
  if (!authorityId || !keyVersion || !algorithm) {
    return {
      resolved: false,
      failureReason: 'SELECTOR_INCOMPLETE',
      errors: ['SELECTOR_INCOMPLETE: authorityId, keyVersion, and algorithm must be non-empty strings'],
    };
  }

  if (algorithm !== CANONICAL_ALGORITHM) {
    return {
      resolved: false,
      failureReason: 'SELECTOR_ALGORITHM_UNSUPPORTED',
      errors: [`SELECTOR_ALGORITHM_UNSUPPORTED: expected '${CANONICAL_ALGORITHM}', got '${algorithm}'`],
    };
  }

  // 2. Search immutable registry ONLY
  for (const registered of PRODUCTION_HUMAN_AUTHORITY_REGISTRY) {
    if (
      registered.authorityId === authorityId &&
      registered.keyVersion === keyVersion &&
      registered.algorithm === algorithm
    ) {
      return {
        resolved: true,
        authority: registered,
        errors: [],
      };
    }
  }

  return {
    resolved: false,
    failureReason: 'AUTHORITY_NOT_FOUND_IN_PRODUCTION_REGISTRY',
    errors: [
      `AUTHORITY_NOT_FOUND_IN_PRODUCTION_REGISTRY: authorityId '${authorityId}', keyVersion '${keyVersion}' is not in production registry`,
    ],
  };
}

// ============================================================================
// 5. PRODUCTION VERIFICATION WRAPPER
// ============================================================================

/**
 * Production human authorization verifier wrapper.
 *
 * Strict invariants:
 * 1. Fails closed if PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED is false.
 * 2. Resolves authority ONLY from the immutable PRODUCTION_HUMAN_AUTHORITY_REGISTRY.
 * 3. Never accepts an authority descriptor, key, or fingerprint from the caller.
 * 4. Requires mandatory source attestation.
 * 5. Uses current runtime verification time internally (new Date()); accepts no caller time override.
 * 6. Delegates cryptographic verification to verifyHumanAuthorizationPackage once authority is resolved.
 */
export function verifyProductionHumanAuthorizationPackage(
  pkg: SignedHumanAuthorizationPackage,
  sourceAttestation: TrustedSourceAttestation
): ProductionVerificationResult {
  const errors: string[] = [];

  // 1. Fail-closed gate: unprovisioned trust anchor
  if (!PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED) {
    return {
      verified: false,
      failureReason: 'PRODUCTION_AUTHORITY_TRUST_ANCHOR_NOT_PROVISIONED',
      errors: [
        'PRODUCTION_AUTHORITY_TRUST_ANCHOR_NOT_PROVISIONED: no production trust anchor is provisioned in this release',
      ],
    };
  }

  // 2. Mandatory package check
  if (!pkg || typeof pkg !== 'object') {
    return {
      verified: false,
      failureReason: 'PACKAGE_NULL',
      errors: ['PACKAGE_NULL: package must be a non-null object'],
    };
  }

  // 3. Mandatory source attestation check
  if (!sourceAttestation || typeof sourceAttestation !== 'object') {
    return {
      verified: false,
      failureReason: 'SOURCE_ATTESTATION_MISSING',
      errors: ['SOURCE_ATTESTATION_MISSING: sourceAttestation is mandatory for production verification'],
    };
  }

  // 4. Resolve authority strictly from production registry using package selectors
  const resolution = resolveProductionHumanAuthorizationAuthority({
    authorityId: pkg.authorityId,
    keyVersion: pkg.keyVersion,
    algorithm: pkg.algorithm,
  });

  if (!resolution.resolved || !resolution.authority) {
    return {
      verified: false,
      failureReason: resolution.failureReason ?? 'AUTHORITY_RESOLUTION_FAILED',
      errors: resolution.errors,
    };
  }

  // 5. Delegate cryptographic verification with current runtime time (no caller override)
  const nowUtc = new Date();
  const result = verifyHumanAuthorizationPackage(pkg, resolution.authority, {
    sourceAttestation,
    nowUtc,
  });

  return {
    verified: result.valid,
    errors: result.errors,
    failureReason: result.failureReason,
    authorizationPackageDigest: result.authorizationPackageDigest,
    authorizationConsumptionKey: result.authorizationConsumptionKey,
  };
}
