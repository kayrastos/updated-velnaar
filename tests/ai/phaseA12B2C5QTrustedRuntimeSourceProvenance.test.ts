/**
 * @file tests/ai/phaseA12B2C5QTrustedRuntimeSourceProvenance.test.ts
 * @description Unit and security test suite for Phase A.12B.2C-5Q:
 * Trusted Runtime Source Provenance Foundation.
 *
 * STRICT VERIFICATION REQUIREMENTS:
 * - >= 70 offline tests covering:
 *   - Schema, identifier, and time validation
 *   - Canonical deterministic payload serialization
 *   - Offline Ed25519 signature verification
 *   - Fail-closed production registry and resolver
 *   - Fail-closed production verifier
 *   - Sealed cross-phase invariants
 *   - Strict network sentinel (0 network calls)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  RUNTIME_SOURCE_PROVENANCE_VERSION,
  RUNTIME_SOURCE_PROVENANCE_REGISTRY_VERSION,
  RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_PROVISIONED,
  TRUSTED_RUNTIME_SOURCE_PROVENANCE_READY,
  CANONICAL_REPOSITORY_FULL_NAME,
  CANONICAL_ENVIRONMENT,
  CANONICAL_ALGORITHM,
  PRODUCTION_RUNTIME_SOURCE_PROVENANCE_AUTHORITIES,
  EXACT_AUTHORITY_KEYS,
  EXACT_RECEIPT_KEYS,
  EXACT_PAYLOAD_KEYS,
  RuntimeSourceProvenanceAuthority,
  RuntimeSourceProvenanceReceipt,
  RuntimeSourceProvenancePayload,
  validateRuntimeSourceProvenanceAuthority,
  canonicalizeRuntimeSourceProvenancePayload,
  computeRuntimeSourceProvenanceReceiptDigest,
  verifyRuntimeSourceProvenanceReceipt,
  resolveProductionRuntimeSourceProvenanceAuthority,
  verifyProductionRuntimeSourceProvenanceReceipt,
} from '../../worker/ai/canary/deepSeekTrustedRuntimeSourceProvenance';
import * as sourceProvenanceModule from '../../worker/ai/canary/deepSeekTrustedRuntimeSourceProvenance';

import {
  computePublicKeyFingerprintSha256,
} from '../../worker/ai/canary/deepSeekCertificationAttestation';

import {
  GUARDED_SOURCE_ATTESTATION_READY,
  GUARDED_HUMAN_AUTH_ATTESTATION_READY,
} from '../../worker/ai/canary/deepSeekGuardedLiveTransport';

import {
  CANARY_LIVE_EXECUTION_ENABLED,
} from '../../worker/ai/canary/canarySpecification';

import {
  VELNAR_ROUTING_POLICY_VERSION,
  resolveRoutingPolicyDecision,
} from '../../worker/ai/routingPolicy';

// ============================================================================
// NETWORK SENTINEL
// ============================================================================

let originalFetch: typeof globalThis.fetch;
let globalFetchCalls = 0;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalFetchCalls = 0;
  globalThis.fetch = (async (..._args: any[]) => {
    globalFetchCalls++;
    throw new Error('NETWORK_CALL_FORBIDDEN: Network calls are strictly prohibited');
  }) as any;
});

afterEach(() => {
  expect(globalFetchCalls).toBe(0);
  globalThis.fetch = originalFetch;
  globalFetchCalls = 0;
});

// ============================================================================
// TEST FIXTURES & SYNTHETIC KEY HELPERS
// ============================================================================

function generateSyntheticAuthorityAndSigner(issuerId = 'synthetic-ci-builder-5q'): {
  authority: RuntimeSourceProvenanceAuthority;
  privateKeyPem: string;
} {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const fingerprint = computePublicKeyFingerprintSha256(publicKey);
  const authority: RuntimeSourceProvenanceAuthority = {
    issuerId,
    keyVersion: 'v1',
    algorithm: 'Ed25519',
    publicKeyFingerprintSha256: fingerprint,
    publicKeyPem: publicKey,
  };

  return { authority, privateKeyPem: privateKey };
}

function createValidSyntheticPayload(issuerId = 'synthetic-ci-builder-5q'): RuntimeSourceProvenancePayload {
  return {
    provenanceVersion: RUNTIME_SOURCE_PROVENANCE_VERSION,
    repositoryFullName: CANONICAL_REPOSITORY_FULL_NAME,
    sourceCommitSha: '95466e0429feaa03fd70ad93abaad02d5ac29301',
    sourceTreeSha: '913d804dc2c9412b4d32d7aa8f19ddddaf57e83b',
    buildArtifactSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    buildId: 'build_20260906_production_artifact_0001',
    deploymentId: 'deploy_20260906_production_target_0001',
    environment: CANONICAL_ENVIRONMENT,
    issuedAt: '2026-09-06T10:00:00.000Z',
    expiresAt: '2026-09-06T12:00:00.000Z',
    issuerId,
    issuerKeyVersion: 'v1',
    algorithm: CANONICAL_ALGORITHM,
  };
}

function createSignedReceipt(
  payload: RuntimeSourceProvenancePayload,
  privateKeyPem: string
): RuntimeSourceProvenanceReceipt {
  const canonicalPayload = canonicalizeRuntimeSourceProvenancePayload(payload);
  const signatureBuffer = crypto.sign(
    null,
    Buffer.from(canonicalPayload, 'utf8'),
    privateKeyPem
  );
  return {
    ...payload,
    signatureBase64: Buffer.from(signatureBuffer).toString('base64'),
  };
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('Phase A.12B.2C-5Q: Trusted Runtime Source Provenance Foundation', () => {

  // --------------------------------------------------------------------------
  // Section 1: Version and Readiness Constants
  // --------------------------------------------------------------------------
  describe('1. Version and Readiness Constants', () => {
    it('1. verifies RUNTIME_SOURCE_PROVENANCE_VERSION is exact a12b2c5q-v1', () => {
      expect(RUNTIME_SOURCE_PROVENANCE_VERSION).toBe('a12b2c5q-v1');
    });

    it('2. verifies RUNTIME_SOURCE_PROVENANCE_REGISTRY_VERSION is exact a12b2c5q-registry-v1', () => {
      expect(RUNTIME_SOURCE_PROVENANCE_REGISTRY_VERSION).toBe('a12b2c5q-registry-v1');
    });

    it('3. verifies RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_PROVISIONED is strictly false', () => {
      expect(RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_PROVISIONED).toBe(false);
    });

    it('4. verifies TRUSTED_RUNTIME_SOURCE_PROVENANCE_READY is strictly false', () => {
      expect(TRUSTED_RUNTIME_SOURCE_PROVENANCE_READY).toBe(false);
    });

    it('5. verifies CANONICAL_REPOSITORY_FULL_NAME is kayrastos/updated-velnaar', () => {
      expect(CANONICAL_REPOSITORY_FULL_NAME).toBe('kayrastos/updated-velnaar');
    });

    it('6. verifies CANONICAL_ENVIRONMENT is production', () => {
      expect(CANONICAL_ENVIRONMENT).toBe('production');
    });

    it('7. verifies CANONICAL_ALGORITHM is Ed25519', () => {
      expect(CANONICAL_ALGORITHM).toBe('Ed25519');
    });
  });

  // --------------------------------------------------------------------------
  // Section 2: Production Registry Properties
  // --------------------------------------------------------------------------
  describe('2. Production Issuer Registry Properties', () => {
    it('8. production issuer registry is empty', () => {
      expect(PRODUCTION_RUNTIME_SOURCE_PROVENANCE_AUTHORITIES).toHaveLength(0);
    });

    it('9. production issuer registry is frozen', () => {
      expect(Object.isFrozen(PRODUCTION_RUNTIME_SOURCE_PROVENANCE_AUTHORITIES)).toBe(true);
    });

    it('10. production issuer registry cannot be mutated', () => {
      expect(() => {
        (PRODUCTION_RUNTIME_SOURCE_PROVENANCE_AUTHORITIES as any).push({} as any);
      }).toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // Section 3: Authority Schema Validation
  // --------------------------------------------------------------------------
  describe('3. Authority Schema Validation', () => {
    it('11. valid synthetic authority passes validation', () => {
      const { authority } = generateSyntheticAuthorityAndSigner();
      const res = validateRuntimeSourceProvenanceAuthority(authority);
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
      expect(res.authority).toBeDefined();
    });

    it('12. authority null or undefined rejects', () => {
      expect(validateRuntimeSourceProvenanceAuthority(null).valid).toBe(false);
      expect(validateRuntimeSourceProvenanceAuthority(undefined).valid).toBe(false);
    });

    it('13. authority as array rejects', () => {
      expect(validateRuntimeSourceProvenanceAuthority([]).valid).toBe(false);
    });

    it('14. unknown authority field rejects', () => {
      const { authority } = generateSyntheticAuthorityAndSigner();
      const mutated = { ...authority, extraField: 'unauthorized' };
      const res = validateRuntimeSourceProvenanceAuthority(mutated);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('UNKNOWN_PROPERTY'))).toBe(true);
    });

    it('15. inherited authority field rejects (must be own property)', () => {
      const { authority } = generateSyntheticAuthorityAndSigner();
      const proto = { issuerId: authority.issuerId };
      const obj = Object.create(proto);
      obj.keyVersion = authority.keyVersion;
      obj.algorithm = authority.algorithm;
      obj.publicKeyFingerprintSha256 = authority.publicKeyFingerprintSha256;
      obj.publicKeyPem = authority.publicKeyPem;

      const res = validateRuntimeSourceProvenanceAuthority(obj);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('MISSING_OWN_PROPERTY'))).toBe(true);
    });

    it('16. missing issuerId rejects', () => {
      const { authority } = generateSyntheticAuthorityAndSigner();
      const { issuerId, ...rest } = authority;
      expect(validateRuntimeSourceProvenanceAuthority(rest).valid).toBe(false);
    });

    it('17. missing keyVersion rejects', () => {
      const { authority } = generateSyntheticAuthorityAndSigner();
      const { keyVersion, ...rest } = authority;
      expect(validateRuntimeSourceProvenanceAuthority(rest).valid).toBe(false);
    });

    it('18. missing algorithm rejects', () => {
      const { authority } = generateSyntheticAuthorityAndSigner();
      const { algorithm, ...rest } = authority;
      expect(validateRuntimeSourceProvenanceAuthority(rest).valid).toBe(false);
    });

    it('19. missing publicKeyFingerprintSha256 rejects', () => {
      const { authority } = generateSyntheticAuthorityAndSigner();
      const { publicKeyFingerprintSha256, ...rest } = authority;
      expect(validateRuntimeSourceProvenanceAuthority(rest).valid).toBe(false);
    });

    it('20. missing publicKeyPem rejects', () => {
      const { authority } = generateSyntheticAuthorityAndSigner();
      const { publicKeyPem, ...rest } = authority;
      expect(validateRuntimeSourceProvenanceAuthority(rest).valid).toBe(false);
    });

    it('21. non-string field in authority rejects without coercion', () => {
      const { authority } = generateSyntheticAuthorityAndSigner();
      const res = validateRuntimeSourceProvenanceAuthority({ ...authority, keyVersion: 1 });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('INVALID_FIELD_TYPE'))).toBe(true);
    });

    it('22. algorithm not Ed25519 rejects', () => {
      const { authority } = generateSyntheticAuthorityAndSigner();
      const res = validateRuntimeSourceProvenanceAuthority({ ...authority, algorithm: 'RSA' });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('INVALID_ALGORITHM'))).toBe(true);
    });

    it('23. short issuerId (< 3 chars) rejects', () => {
      const { authority } = generateSyntheticAuthorityAndSigner();
      const res = validateRuntimeSourceProvenanceAuthority({ ...authority, issuerId: 'ab' });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('INVALID_ISSUER_ID_LENGTH'))).toBe(true);
    });

    it('24. long issuerId (> 128 chars) rejects', () => {
      const { authority } = generateSyntheticAuthorityAndSigner();
      const res = validateRuntimeSourceProvenanceAuthority({
        ...authority,
        issuerId: 'a'.repeat(129),
      });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('INVALID_ISSUER_ID_LENGTH'))).toBe(true);
    });

    it('25. unsafe characters in issuerId rejects', () => {
      const { authority } = generateSyntheticAuthorityAndSigner();
      const res = validateRuntimeSourceProvenanceAuthority({
        ...authority,
        issuerId: 'issuer;rm -rf /',
      });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('INVALID_ISSUER_ID_FORMAT'))).toBe(true);
    });

    it('26. empty keyVersion rejects', () => {
      const { authority } = generateSyntheticAuthorityAndSigner();
      const res = validateRuntimeSourceProvenanceAuthority({ ...authority, keyVersion: '' });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('INVALID_KEY_VERSION_LENGTH'))).toBe(true);
    });

    it('27. long keyVersion (> 64 chars) rejects', () => {
      const { authority } = generateSyntheticAuthorityAndSigner();
      const res = validateRuntimeSourceProvenanceAuthority({
        ...authority,
        keyVersion: 'v'.repeat(65),
      });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('INVALID_KEY_VERSION_LENGTH'))).toBe(true);
    });

    it('28. unsafe characters in keyVersion rejects', () => {
      const { authority } = generateSyntheticAuthorityAndSigner();
      const res = validateRuntimeSourceProvenanceAuthority({
        ...authority,
        keyVersion: 'v1.0<script>',
      });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('INVALID_KEY_VERSION_FORMAT'))).toBe(true);
    });

    it('29. uppercase hex in fingerprint rejects', () => {
      const { authority } = generateSyntheticAuthorityAndSigner();
      const res = validateRuntimeSourceProvenanceAuthority({
        ...authority,
        publicKeyFingerprintSha256: authority.publicKeyFingerprintSha256.toUpperCase(),
      });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('INVALID_FINGERPRINT_FORMAT'))).toBe(true);
    });

    it('30. non-64 length fingerprint rejects', () => {
      const { authority } = generateSyntheticAuthorityAndSigner();
      const res = validateRuntimeSourceProvenanceAuthority({
        ...authority,
        publicKeyFingerprintSha256: authority.publicKeyFingerprintSha256.slice(0, 63),
      });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('INVALID_FINGERPRINT_FORMAT'))).toBe(true);
    });

    it('31. private PEM rejects (private key material forbidden)', () => {
      const { privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const res = validateRuntimeSourceProvenanceAuthority({
        issuerId: 'bad-issuer',
        keyVersion: 'v1',
        algorithm: 'Ed25519',
        publicKeyFingerprintSha256: '0'.repeat(64),
        publicKeyPem: privateKeyPem,
      });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('PRIVATE_KEY_MATERIAL_FORBIDDEN'))).toBe(true);
    });

    it('32. RSA public key rejects (only Ed25519 accepted)', () => {
      const { publicKey: rsaPub } = crypto.generateKeyPairSync('rsa' as any, {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
      });
      const fp = computePublicKeyFingerprintSha256(rsaPub as unknown as string);
      const res = validateRuntimeSourceProvenanceAuthority({
        issuerId: 'rsa-issuer',
        keyVersion: 'v1',
        algorithm: 'Ed25519',
        publicKeyFingerprintSha256: fp,
        publicKeyPem: rsaPub as unknown as string,
      });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('PUBLIC_KEY_ASYMMETRIC_TYPE_INVALID'))).toBe(true);
    });

    it('33. malformed PEM headers reject', () => {
      const { authority } = generateSyntheticAuthorityAndSigner();
      const res = validateRuntimeSourceProvenanceAuthority({
        ...authority,
        publicKeyPem: 'not-a-pem-header',
      });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('INVALID_PEM_HEADERS'))).toBe(true);
    });

    it('34. corrupted base64 in PEM rejects', () => {
      const badPem = '-----BEGIN PUBLIC KEY-----\ncorrupted!!!\n-----END PUBLIC KEY-----\n';
      const fp = computePublicKeyFingerprintSha256(badPem);
      const res = validateRuntimeSourceProvenanceAuthority({
        issuerId: 'corrupt-issuer',
        keyVersion: 'v1',
        algorithm: 'Ed25519',
        publicKeyFingerprintSha256: fp,
        publicKeyPem: badPem,
      });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('PUBLIC_KEY_PARSE_FAILED'))).toBe(true);
    });

    it('35. declared fingerprint mismatch rejects', () => {
      const { authority } = generateSyntheticAuthorityAndSigner();
      const res = validateRuntimeSourceProvenanceAuthority({
        ...authority,
        publicKeyFingerprintSha256: 'a'.repeat(64),
      });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('PUBLIC_KEY_FINGERPRINT_MISMATCH'))).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Section 4: Canonical Signed Payload Serialization
  // --------------------------------------------------------------------------
  describe('4. Canonical Signed Payload Serialization', () => {
    it('36. canonical serialization produces exact deterministic JSON string', () => {
      const payload = createValidSyntheticPayload();
      const serialized1 = canonicalizeRuntimeSourceProvenancePayload(payload);
      const serialized2 = canonicalizeRuntimeSourceProvenancePayload(payload);
      expect(serialized1).toBe(serialized2);

      const parsed = JSON.parse(serialized1);
      expect(Object.keys(parsed)).toEqual(EXACT_PAYLOAD_KEYS);
    });

    it('37. null or non-object input throws CANONICALIZATION_FAILURE', () => {
      expect(() => canonicalizeRuntimeSourceProvenancePayload(null)).toThrow('CANONICALIZATION_FAILURE');
      expect(() => canonicalizeRuntimeSourceProvenancePayload('string')).toThrow('CANONICALIZATION_FAILURE');
    });

    it('38. array input throws CANONICALIZATION_FAILURE', () => {
      expect(() => canonicalizeRuntimeSourceProvenancePayload([])).toThrow('CANONICALIZATION_FAILURE');
    });

    it('39. missing payload property throws CANONICALIZATION_FAILURE', () => {
      const payload = createValidSyntheticPayload();
      const { sourceCommitSha, ...rest } = payload;
      expect(() => canonicalizeRuntimeSourceProvenancePayload(rest)).toThrow('CANONICALIZATION_FAILURE');
    });

    it('40. inherited property throws CANONICALIZATION_FAILURE', () => {
      const payload = createValidSyntheticPayload();
      const proto = { sourceCommitSha: payload.sourceCommitSha };
      const obj = Object.create(proto);
      for (const k of EXACT_PAYLOAD_KEYS) {
        if (k !== 'sourceCommitSha') {
          obj[k] = (payload as any)[k];
        }
      }
      expect(() => canonicalizeRuntimeSourceProvenancePayload(obj)).toThrow('CANONICALIZATION_FAILURE');
    });

    it('41. unknown extra payload property throws CANONICALIZATION_FAILURE', () => {
      const payload = createValidSyntheticPayload();
      expect(() =>
        canonicalizeRuntimeSourceProvenancePayload({ ...payload, unexpectedKey: 'bad' })
      ).toThrow('CANONICALIZATION_FAILURE');
    });

    it('42. number value in payload throws CANONICALIZATION_FAILURE (no coercion)', () => {
      const payload = createValidSyntheticPayload();
      expect(() =>
        canonicalizeRuntimeSourceProvenancePayload({ ...payload, buildId: 12345 })
      ).toThrow('CANONICALIZATION_FAILURE');
    });

    it('43. boolean value in payload throws CANONICALIZATION_FAILURE', () => {
      const payload = createValidSyntheticPayload();
      expect(() =>
        canonicalizeRuntimeSourceProvenancePayload({ ...payload, environment: true })
      ).toThrow('CANONICALIZATION_FAILURE');
    });

    it('44. signatureBase64 is excluded from canonical serialized output', () => {
      const payload = createValidSyntheticPayload();
      const withSig = { ...payload, signatureBase64: 'dGVzdHNpZw==' };
      const serialized = canonicalizeRuntimeSourceProvenancePayload(withSig);
      const parsed = JSON.parse(serialized);
      expect(parsed).not.toHaveProperty('signatureBase64');
    });

    it('45. commit mutation changes signed bytes', () => {
      const payload = createValidSyntheticPayload();
      const s1 = canonicalizeRuntimeSourceProvenancePayload(payload);
      const s2 = canonicalizeRuntimeSourceProvenancePayload({
        ...payload,
        sourceCommitSha: '0000000000000000000000000000000000000000',
      });
      expect(s1).not.toBe(s2);
    });

    it('46. tree mutation changes signed bytes', () => {
      const payload = createValidSyntheticPayload();
      const s1 = canonicalizeRuntimeSourceProvenancePayload(payload);
      const s2 = canonicalizeRuntimeSourceProvenancePayload({
        ...payload,
        sourceTreeSha: '0000000000000000000000000000000000000000',
      });
      expect(s1).not.toBe(s2);
    });

    it('47. artifact hash mutation changes signed bytes', () => {
      const payload = createValidSyntheticPayload();
      const s1 = canonicalizeRuntimeSourceProvenancePayload(payload);
      const s2 = canonicalizeRuntimeSourceProvenancePayload({
        ...payload,
        buildArtifactSha256: '0'.repeat(64),
      });
      expect(s1).not.toBe(s2);
    });

    it('48. buildId mutation changes signed bytes', () => {
      const payload = createValidSyntheticPayload();
      const s1 = canonicalizeRuntimeSourceProvenancePayload(payload);
      const s2 = canonicalizeRuntimeSourceProvenancePayload({
        ...payload,
        buildId: 'build_20260906_production_artifact_0002',
      });
      expect(s1).not.toBe(s2);
    });

    it('49. deploymentId mutation changes signed bytes', () => {
      const payload = createValidSyntheticPayload();
      const s1 = canonicalizeRuntimeSourceProvenancePayload(payload);
      const s2 = canonicalizeRuntimeSourceProvenancePayload({
        ...payload,
        deploymentId: 'deploy_20260906_production_target_0002',
      });
      expect(s1).not.toBe(s2);
    });

    it('50. issuerId mutation changes signed bytes', () => {
      const payload = createValidSyntheticPayload();
      const s1 = canonicalizeRuntimeSourceProvenancePayload(payload);
      const s2 = canonicalizeRuntimeSourceProvenancePayload({
        ...payload,
        issuerId: 'other-issuer-id',
      });
      expect(s1).not.toBe(s2);
    });

    it('51. issuerKeyVersion mutation changes signed bytes', () => {
      const payload = createValidSyntheticPayload();
      const s1 = canonicalizeRuntimeSourceProvenancePayload(payload);
      const s2 = canonicalizeRuntimeSourceProvenancePayload({
        ...payload,
        issuerKeyVersion: 'v2',
      });
      expect(s1).not.toBe(s2);
    });

    it('52. issuedAt mutation changes signed bytes', () => {
      const payload = createValidSyntheticPayload();
      const s1 = canonicalizeRuntimeSourceProvenancePayload(payload);
      const s2 = canonicalizeRuntimeSourceProvenancePayload({
        ...payload,
        issuedAt: '2026-09-06T10:01:00.000Z',
      });
      expect(s1).not.toBe(s2);
    });

    it('53. expiresAt mutation changes signed bytes', () => {
      const payload = createValidSyntheticPayload();
      const s1 = canonicalizeRuntimeSourceProvenancePayload(payload);
      const s2 = canonicalizeRuntimeSourceProvenancePayload({
        ...payload,
        expiresAt: '2026-09-06T13:00:00.000Z',
      });
      expect(s1).not.toBe(s2);
    });

    it('54. algorithm mutation changes signed bytes', () => {
      const payload = createValidSyntheticPayload();
      const s1 = canonicalizeRuntimeSourceProvenancePayload(payload);
      const s2 = canonicalizeRuntimeSourceProvenancePayload({
        ...payload,
        algorithm: 'Ed25519',
      });
      expect(s1).toBe(s2);
    });

    it('55. environment mutation changes signed bytes', () => {
      const payload = createValidSyntheticPayload();
      const s1 = canonicalizeRuntimeSourceProvenancePayload(payload);
      const s2 = canonicalizeRuntimeSourceProvenancePayload({
        ...payload,
        environment: 'staging',
      });
      expect(s1).not.toBe(s2);
    });

    it('56. repositoryFullName mutation changes signed bytes', () => {
      const payload = createValidSyntheticPayload();
      const s1 = canonicalizeRuntimeSourceProvenancePayload(payload);
      const s2 = canonicalizeRuntimeSourceProvenancePayload({
        ...payload,
        repositoryFullName: 'other-owner/other-repo',
      });
      expect(s1).not.toBe(s2);
    });

    it('57. provenanceVersion mutation changes signed bytes', () => {
      const payload = createValidSyntheticPayload();
      const s1 = canonicalizeRuntimeSourceProvenancePayload(payload);
      const s2 = canonicalizeRuntimeSourceProvenancePayload({
        ...payload,
        provenanceVersion: 'a12b2c5q-v2',
      });
      expect(s1).not.toBe(s2);
    });
  });

  // --------------------------------------------------------------------------
  // Section 5: Receipt Schema and Format Validation
  // --------------------------------------------------------------------------
  describe('5. Receipt Schema and Format Validation', () => {
    it('58. receipt exact schema passes format checks', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload = createValidSyntheticPayload(authority.issuerId);
      const receipt = createSignedReceipt(payload, privateKeyPem);
      const res = verifyRuntimeSourceProvenanceReceipt(receipt, authority, {
        nowUtc: '2026-09-06T11:00:00.000Z',
      });
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
      expect(res.receiptDigest).toBeDefined();
    });

    it('59. receipt null or undefined rejects', () => {
      const { authority } = generateSyntheticAuthorityAndSigner();
      expect(verifyRuntimeSourceProvenanceReceipt(null, authority).valid).toBe(false);
      expect(verifyRuntimeSourceProvenanceReceipt(undefined, authority).valid).toBe(false);
    });

    it('60. receipt array rejects', () => {
      const { authority } = generateSyntheticAuthorityAndSigner();
      expect(verifyRuntimeSourceProvenanceReceipt([], authority).valid).toBe(false);
    });

    it('61. unknown receipt field rejects', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload = createValidSyntheticPayload(authority.issuerId);
      const receipt = createSignedReceipt(payload, privateKeyPem);
      const mutated = { ...receipt, injectedField: 'malicious' };
      const res = verifyRuntimeSourceProvenanceReceipt(mutated, authority);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('UNKNOWN_RECEIPT_FIELD'))).toBe(true);
    });

    it('62. inherited receipt field rejects (must be own property)', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload = createValidSyntheticPayload(authority.issuerId);
      const receipt = createSignedReceipt(payload, privateKeyPem);
      const proto = { sourceCommitSha: receipt.sourceCommitSha };
      const obj = Object.create(proto);
      for (const k of EXACT_RECEIPT_KEYS) {
        if (k !== 'sourceCommitSha') {
          obj[k] = (receipt as any)[k];
        }
      }
      const res = verifyRuntimeSourceProvenanceReceipt(obj, authority);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('MISSING_OWN_PROPERTY'))).toBe(true);
    });

    it('63. non-string receipt field rejects without coercion', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload = createValidSyntheticPayload(authority.issuerId);
      const receipt = createSignedReceipt(payload, privateKeyPem);
      const res = verifyRuntimeSourceProvenanceReceipt({ ...receipt, buildId: 9999999 }, authority);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('INVALID_FIELD_TYPE'))).toBe(true);
    });

    it('64. wrong provenanceVersion rejects', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload = {
        ...createValidSyntheticPayload(authority.issuerId),
        provenanceVersion: 'wrong-v1',
      };
      const receipt = createSignedReceipt(payload, privateKeyPem);
      const res = verifyRuntimeSourceProvenanceReceipt(receipt, authority);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('PROVENANCE_VERSION_MISMATCH'))).toBe(true);
    });

    it('65. wrong repositoryFullName rejects', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload = {
        ...createValidSyntheticPayload(authority.issuerId),
        repositoryFullName: 'evil-actor/evil-repo',
      };
      const receipt = createSignedReceipt(payload, privateKeyPem);
      const res = verifyRuntimeSourceProvenanceReceipt(receipt, authority);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('REPOSITORY_MISMATCH'))).toBe(true);
    });

    it('66. canonical repository passes', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload = createValidSyntheticPayload(authority.issuerId);
      const receipt = createSignedReceipt(payload, privateKeyPem);
      const res = verifyRuntimeSourceProvenanceReceipt(receipt, authority, {
        nowUtc: '2026-09-06T11:00:00.000Z',
      });
      expect(res.valid).toBe(true);
    });

    it('67. wrong environment rejects', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload = {
        ...createValidSyntheticPayload(authority.issuerId),
        environment: 'staging',
      };
      const receipt = createSignedReceipt(payload, privateKeyPem);
      const res = verifyRuntimeSourceProvenanceReceipt(receipt, authority);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('ENVIRONMENT_MISMATCH'))).toBe(true);
    });

    it('68. canonical environment production passes', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload = createValidSyntheticPayload(authority.issuerId);
      const receipt = createSignedReceipt(payload, privateKeyPem);
      const res = verifyRuntimeSourceProvenanceReceipt(receipt, authority, {
        nowUtc: '2026-09-06T11:00:00.000Z',
      });
      expect(res.valid).toBe(true);
    });

    it('69. wrong algorithm in receipt rejects', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload = {
        ...createValidSyntheticPayload(authority.issuerId),
        algorithm: 'Ed25519' as any,
      };
      const receipt = {
        ...createSignedReceipt(payload, privateKeyPem),
        algorithm: 'ECDSA',
      };
      const res = verifyRuntimeSourceProvenanceReceipt(receipt, authority);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('ALGORITHM_MISMATCH'))).toBe(true);
    });

    it('70. sourceCommitSha exactly 40 lowercase hex required', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload = createValidSyntheticPayload(authority.issuerId);
      const receipt = createSignedReceipt(payload, privateKeyPem);
      const res = verifyRuntimeSourceProvenanceReceipt(receipt, authority, {
        nowUtc: '2026-09-06T11:00:00.000Z',
      });
      expect(res.valid).toBe(true);
    });

    it('71. uppercase sourceCommitSha rejects', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload = {
        ...createValidSyntheticPayload(authority.issuerId),
        sourceCommitSha: '95466E0429FEAA03FD70AD93ABAAD02D5AC29301',
      };
      const receipt = createSignedReceipt(payload, privateKeyPem);
      const res = verifyRuntimeSourceProvenanceReceipt(receipt, authority);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('INVALID_SOURCE_COMMIT_SHA'))).toBe(true);
    });

    it('72. short or long sourceCommitSha rejects', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload1 = {
        ...createValidSyntheticPayload(authority.issuerId),
        sourceCommitSha: '95466e0429feaa03fd70ad93abaad02d5ac2930', // 39 chars
      };
      const res1 = verifyRuntimeSourceProvenanceReceipt(
        createSignedReceipt(payload1, privateKeyPem),
        authority
      );
      expect(res1.valid).toBe(false);

      const payload2 = {
        ...createValidSyntheticPayload(authority.issuerId),
        sourceCommitSha: '95466e0429feaa03fd70ad93abaad02d5ac29301a', // 41 chars
      };
      const res2 = verifyRuntimeSourceProvenanceReceipt(
        createSignedReceipt(payload2, privateKeyPem),
        authority
      );
      expect(res2.valid).toBe(false);
    });

    it('73. non-hex sourceCommitSha rejects', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload = {
        ...createValidSyntheticPayload(authority.issuerId),
        sourceCommitSha: 'g'.repeat(40),
      };
      const res = verifyRuntimeSourceProvenanceReceipt(
        createSignedReceipt(payload, privateKeyPem),
        authority
      );
      expect(res.valid).toBe(false);
    });

    it('74. sourceTreeSha exactly 40 lowercase hex required', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload = createValidSyntheticPayload(authority.issuerId);
      const receipt = createSignedReceipt(payload, privateKeyPem);
      const res = verifyRuntimeSourceProvenanceReceipt(receipt, authority, {
        nowUtc: '2026-09-06T11:00:00.000Z',
      });
      expect(res.valid).toBe(true);
    });

    it('75. uppercase sourceTreeSha rejects', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload = {
        ...createValidSyntheticPayload(authority.issuerId),
        sourceTreeSha: '913D804DC2C9412B4D32D7AA8F19DDDAF57E83B',
      };
      const res = verifyRuntimeSourceProvenanceReceipt(
        createSignedReceipt(payload, privateKeyPem),
        authority
      );
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('INVALID_SOURCE_TREE_SHA'))).toBe(true);
    });

    it('76. malformed sourceTreeSha rejects', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload = {
        ...createValidSyntheticPayload(authority.issuerId),
        sourceTreeSha: 'invalid-tree-sha-value-not-hex',
      };
      const res = verifyRuntimeSourceProvenanceReceipt(
        createSignedReceipt(payload, privateKeyPem),
        authority
      );
      expect(res.valid).toBe(false);
    });

    it('77. buildArtifactSha256 exactly 64 lowercase hex required', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload = createValidSyntheticPayload(authority.issuerId);
      const receipt = createSignedReceipt(payload, privateKeyPem);
      const res = verifyRuntimeSourceProvenanceReceipt(receipt, authority, {
        nowUtc: '2026-09-06T11:00:00.000Z',
      });
      expect(res.valid).toBe(true);
    });

    it('78. uppercase buildArtifactSha256 rejects', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload = {
        ...createValidSyntheticPayload(authority.issuerId),
        buildArtifactSha256: 'E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855',
      };
      const res = verifyRuntimeSourceProvenanceReceipt(
        createSignedReceipt(payload, privateKeyPem),
        authority
      );
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('INVALID_BUILD_ARTIFACT_SHA256'))).toBe(true);
    });

    it('79. malformed buildArtifactSha256 rejects', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload = {
        ...createValidSyntheticPayload(authority.issuerId),
        buildArtifactSha256: '0'.repeat(63),
      };
      const res = verifyRuntimeSourceProvenanceReceipt(
        createSignedReceipt(payload, privateKeyPem),
        authority
      );
      expect(res.valid).toBe(false);
    });

    it('80. valid buildId (32-128 safe chars) passes', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload = createValidSyntheticPayload(authority.issuerId);
      const receipt = createSignedReceipt(payload, privateKeyPem);
      const res = verifyRuntimeSourceProvenanceReceipt(receipt, authority, {
        nowUtc: '2026-09-06T11:00:00.000Z',
      });
      expect(res.valid).toBe(true);
    });

    it('81. short buildId (< 32 chars) rejects', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload = {
        ...createValidSyntheticPayload(authority.issuerId),
        buildId: 'short_build_id',
      };
      const res = verifyRuntimeSourceProvenanceReceipt(
        createSignedReceipt(payload, privateKeyPem),
        authority
      );
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('INVALID_BUILD_ID_LENGTH'))).toBe(true);
    });

    it('82. long buildId (> 128 chars) rejects', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload = {
        ...createValidSyntheticPayload(authority.issuerId),
        buildId: 'b'.repeat(129),
      };
      const res = verifyRuntimeSourceProvenanceReceipt(
        createSignedReceipt(payload, privateKeyPem),
        authority
      );
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('INVALID_BUILD_ID_LENGTH'))).toBe(true);
    });

    it('83. unsafe characters in buildId reject', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload = {
        ...createValidSyntheticPayload(authority.issuerId),
        buildId: 'build_id_with_illegal_char_!@#$%^&*()_32chars',
      };
      const res = verifyRuntimeSourceProvenanceReceipt(
        createSignedReceipt(payload, privateKeyPem),
        authority
      );
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('INVALID_BUILD_ID_FORMAT'))).toBe(true);
    });

    it('84. obvious placeholder buildId rejects', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload = {
        ...createValidSyntheticPayload(authority.issuerId),
        buildId: 'x'.repeat(35),
      };
      const res = verifyRuntimeSourceProvenanceReceipt(
        createSignedReceipt(payload, privateKeyPem),
        authority
      );
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('INVALID_BUILD_ID_PLACEHOLDER'))).toBe(true);
    });

    it('85. valid deploymentId (32-128 safe chars) passes', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload = createValidSyntheticPayload(authority.issuerId);
      const receipt = createSignedReceipt(payload, privateKeyPem);
      const res = verifyRuntimeSourceProvenanceReceipt(receipt, authority, {
        nowUtc: '2026-09-06T11:00:00.000Z',
      });
      expect(res.valid).toBe(true);
    });

    it('86. short deploymentId (< 32 chars) rejects', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload = {
        ...createValidSyntheticPayload(authority.issuerId),
        deploymentId: 'short_deploy_id',
      };
      const res = verifyRuntimeSourceProvenanceReceipt(
        createSignedReceipt(payload, privateKeyPem),
        authority
      );
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('INVALID_DEPLOYMENT_ID_LENGTH'))).toBe(true);
    });

    it('87. long deploymentId (> 128 chars) rejects', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload = {
        ...createValidSyntheticPayload(authority.issuerId),
        deploymentId: 'd'.repeat(129),
      };
      const res = verifyRuntimeSourceProvenanceReceipt(
        createSignedReceipt(payload, privateKeyPem),
        authority
      );
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('INVALID_DEPLOYMENT_ID_LENGTH'))).toBe(true);
    });

    it('88. unsafe characters in deploymentId reject', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload = {
        ...createValidSyntheticPayload(authority.issuerId),
        deploymentId: 'deploy_with_injection_";DROP TABLE students;--32',
      };
      const res = verifyRuntimeSourceProvenanceReceipt(
        createSignedReceipt(payload, privateKeyPem),
        authority
      );
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('INVALID_DEPLOYMENT_ID_FORMAT'))).toBe(true);
    });

    it('89. obvious placeholder deploymentId rejects', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload = {
        ...createValidSyntheticPayload(authority.issuerId),
        deploymentId: '0'.repeat(35),
      };
      const res = verifyRuntimeSourceProvenanceReceipt(
        createSignedReceipt(payload, privateKeyPem),
        authority
      );
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('INVALID_DEPLOYMENT_ID_PLACEHOLDER'))).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Section 6: Time Validation
  // --------------------------------------------------------------------------
  describe('6. Time Validation', () => {
    it('90. issuedAt strict UTC format required', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload = createValidSyntheticPayload(authority.issuerId);
      const receipt = createSignedReceipt(payload, privateKeyPem);
      const res = verifyRuntimeSourceProvenanceReceipt(receipt, authority, {
        nowUtc: '2026-09-06T11:00:00.000Z',
      });
      expect(res.valid).toBe(true);
    });

    it('91. timezone offset in issuedAt (+01:00) rejects', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload = {
        ...createValidSyntheticPayload(authority.issuerId),
        issuedAt: '2026-09-06T10:00:00+01:00',
      };
      const res = verifyRuntimeSourceProvenanceReceipt(
        createSignedReceipt(payload, privateKeyPem),
        authority
      );
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('INVALID_ISSUED_AT'))).toBe(true);
    });

    it('92. calendar rollover in issuedAt rejects', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload = {
        ...createValidSyntheticPayload(authority.issuerId),
        issuedAt: '2026-02-30T10:00:00.000Z',
      };
      const res = verifyRuntimeSourceProvenanceReceipt(
        createSignedReceipt(payload, privateKeyPem),
        authority
      );
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('INVALID_ISSUED_AT'))).toBe(true);
    });

    it('93. expiresAt strict UTC format required', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload = createValidSyntheticPayload(authority.issuerId);
      const receipt = createSignedReceipt(payload, privateKeyPem);
      const res = verifyRuntimeSourceProvenanceReceipt(receipt, authority, {
        nowUtc: '2026-09-06T11:00:00.000Z',
      });
      expect(res.valid).toBe(true);
    });

    it('94. timezone offset in expiresAt rejects', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload = {
        ...createValidSyntheticPayload(authority.issuerId),
        expiresAt: '2026-09-06T12:00:00+02:00',
      };
      const res = verifyRuntimeSourceProvenanceReceipt(
        createSignedReceipt(payload, privateKeyPem),
        authority
      );
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('INVALID_EXPIRES_AT'))).toBe(true);
    });

    it('95. calendar rollover in expiresAt rejects', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload = {
        ...createValidSyntheticPayload(authority.issuerId),
        expiresAt: '2026-04-31T12:00:00.000Z',
      };
      const res = verifyRuntimeSourceProvenanceReceipt(
        createSignedReceipt(payload, privateKeyPem),
        authority
      );
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('INVALID_EXPIRES_AT'))).toBe(true);
    });

    it('96. expiresAt equal to issuedAt rejects', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload = {
        ...createValidSyntheticPayload(authority.issuerId),
        expiresAt: '2026-09-06T10:00:00.000Z',
      };
      const res = verifyRuntimeSourceProvenanceReceipt(
        createSignedReceipt(payload, privateKeyPem),
        authority,
        { nowUtc: '2026-09-06T10:00:00.000Z' }
      );
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('INVALID_EXPIRY_SEQUENCE'))).toBe(true);
    });

    it('97. expiresAt before issuedAt rejects', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload = {
        ...createValidSyntheticPayload(authority.issuerId),
        issuedAt: '2026-09-06T12:00:00.000Z',
        expiresAt: '2026-09-06T10:00:00.000Z',
      };
      const res = verifyRuntimeSourceProvenanceReceipt(
        createSignedReceipt(payload, privateKeyPem),
        authority,
        { nowUtc: '2026-09-06T11:00:00.000Z' }
      );
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('INVALID_EXPIRY_SEQUENCE'))).toBe(true);
    });

    it('98. options.nowUtc invalid ISO string rejects', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload = createValidSyntheticPayload(authority.issuerId);
      const res = verifyRuntimeSourceProvenanceReceipt(
        createSignedReceipt(payload, privateKeyPem),
        authority,
        { nowUtc: 'invalid-time' }
      );
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('INVALID_VERIFICATION_TIME'))).toBe(true);
    });

    it('99. expired receipt fails against nowUtc', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload = createValidSyntheticPayload(authority.issuerId);
      const receipt = createSignedReceipt(payload, privateKeyPem);
      // expiresAt is 12:00:00; test at 12:00:01
      const res = verifyRuntimeSourceProvenanceReceipt(receipt, authority, {
        nowUtc: '2026-09-06T12:00:01.000Z',
      });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('RECEIPT_EXPIRED'))).toBe(true);
    });

    it('100. not-yet-valid receipt fails against nowUtc', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload = createValidSyntheticPayload(authority.issuerId);
      const receipt = createSignedReceipt(payload, privateKeyPem);
      // issuedAt is 10:00:00; test at 09:59:59
      const res = verifyRuntimeSourceProvenanceReceipt(receipt, authority, {
        nowUtc: '2026-09-06T09:59:59.000Z',
      });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('RECEIPT_NOT_YET_VALID'))).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Section 7: Cryptographic Signature Verification
  // --------------------------------------------------------------------------
  describe('7. Cryptographic Signature Verification', () => {
    it('101. synthetic generic Ed25519 receipt verifies successfully', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload = createValidSyntheticPayload(authority.issuerId);
      const receipt = createSignedReceipt(payload, privateKeyPem);
      const res = verifyRuntimeSourceProvenanceReceipt(receipt, authority, {
        nowUtc: '2026-09-06T11:00:00.000Z',
      });
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
      expect(res.receiptDigest).toBeDefined();
    });

    it('102. mutated payload fails verification', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload = createValidSyntheticPayload(authority.issuerId);
      const receipt = createSignedReceipt(payload, privateKeyPem);
      const mutated = {
        ...receipt,
        sourceCommitSha: '0000000000000000000000000000000000000000',
      };
      const res = verifyRuntimeSourceProvenanceReceipt(mutated, authority, {
        nowUtc: '2026-09-06T11:00:00.000Z',
      });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('SIGNATURE_VERIFICATION_FAILED'))).toBe(true);
    });

    it('103. mutated signatureBase64 fails verification', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload = createValidSyntheticPayload(authority.issuerId);
      const receipt = createSignedReceipt(payload, privateKeyPem);
      const sigBuf = Buffer.from(receipt.signatureBase64, 'base64');
      sigBuf[0] ^= 0xff; // Flip byte
      const mutated = { ...receipt, signatureBase64: sigBuf.toString('base64') };

      const res = verifyRuntimeSourceProvenanceReceipt(mutated, authority, {
        nowUtc: '2026-09-06T11:00:00.000Z',
      });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('SIGNATURE_VERIFICATION_FAILED'))).toBe(true);
    });

    it('104. wrong public key fails verification', () => {
      const { authority: auth1, privateKeyPem } = generateSyntheticAuthorityAndSigner('builder-1');
      const { authority: auth2 } = generateSyntheticAuthorityAndSigner('builder-1');
      const payload = createValidSyntheticPayload(auth1.issuerId);
      const receipt = createSignedReceipt(payload, privateKeyPem);

      // Verify with auth2 (different keypair, same issuerId)
      const res = verifyRuntimeSourceProvenanceReceipt(receipt, auth2, {
        nowUtc: '2026-09-06T11:00:00.000Z',
      });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('SIGNATURE_VERIFICATION_FAILED'))).toBe(true);
    });

    it('105. issuerId mismatch between receipt and authority fails', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner('builder-a');
      const payload = createValidSyntheticPayload('builder-b');
      const receipt = createSignedReceipt(payload, privateKeyPem);

      const res = verifyRuntimeSourceProvenanceReceipt(receipt, authority, {
        nowUtc: '2026-09-06T11:00:00.000Z',
      });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('ISSUER_ID_MISMATCH'))).toBe(true);
    });

    it('106. keyVersion mismatch between receipt and authority fails', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload = {
        ...createValidSyntheticPayload(authority.issuerId),
        issuerKeyVersion: 'v2',
      };
      const receipt = createSignedReceipt(payload, privateKeyPem);

      const res = verifyRuntimeSourceProvenanceReceipt(receipt, authority, {
        nowUtc: '2026-09-06T11:00:00.000Z',
      });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('KEY_VERSION_MISMATCH'))).toBe(true);
    });

    it('107. authority algorithm mismatch fails', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload = createValidSyntheticPayload(authority.issuerId);
      const receipt = createSignedReceipt(payload, privateKeyPem);

      const res = verifyRuntimeSourceProvenanceReceipt(
        receipt,
        { ...authority, algorithm: 'RSA' },
        { nowUtc: '2026-09-06T11:00:00.000Z' }
      );
      expect(res.valid).toBe(false);
    });

    it('108. invalid base64 in signatureBase64 fails gracefully', () => {
      const { authority } = generateSyntheticAuthorityAndSigner();
      const payload = createValidSyntheticPayload(authority.issuerId);
      const receipt = {
        ...payload,
        signatureBase64: '%%%not-valid-base64%%%',
      };
      const res = verifyRuntimeSourceProvenanceReceipt(receipt, authority, {
        nowUtc: '2026-09-06T11:00:00.000Z',
      });
      expect(res.valid).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Section 8: Production Resolver Invariants
  // --------------------------------------------------------------------------
  describe('8. Production Resolver Invariants', () => {
    it('109. resolveProductionRuntimeSourceProvenanceAuthority fails closed', () => {
      const res = resolveProductionRuntimeSourceProvenanceAuthority({
        issuerId: 'any-issuer',
        issuerKeyVersion: 'v1',
        algorithm: 'Ed25519',
      });
      expect(res.found).toBe(false);
      expect(res.error).toBe('RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_NOT_PROVISIONED');
    });

    it('110. caller public key cannot be supplied to production resolver', () => {
      const { authority } = generateSyntheticAuthorityAndSigner();
      const res = resolveProductionRuntimeSourceProvenanceAuthority({
        issuerId: authority.issuerId,
        issuerKeyVersion: authority.keyVersion,
        algorithm: authority.algorithm,
        publicKeyPem: authority.publicKeyPem,
      } as any);
      expect(res.found).toBe(false);
      expect(res.error).toBe('RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_NOT_PROVISIONED');
    });

    it('111. caller registry override unavailable', () => {
      const { authority } = generateSyntheticAuthorityAndSigner();
      const res = resolveProductionRuntimeSourceProvenanceAuthority({
        issuerId: authority.issuerId,
        issuerKeyVersion: authority.keyVersion,
        algorithm: authority.algorithm,
        registry: [authority],
      } as any);
      expect(res.found).toBe(false);
      expect(res.error).toBe('RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_NOT_PROVISIONED');
    });

    it('112. process.env has no effect on resolver', () => {
      const originalEnv = process.env.TRUST_ANCHOR;
      try {
        process.env.TRUST_ANCHOR = 'mocked-trust-anchor';
        const res = resolveProductionRuntimeSourceProvenanceAuthority({
          issuerId: 'mocked-trust-anchor',
          issuerKeyVersion: 'v1',
          algorithm: 'Ed25519',
        });
        expect(res.found).toBe(false);
        expect(res.error).toBe('RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_NOT_PROVISIONED');
      } finally {
        if (originalEnv === undefined) {
          delete process.env.TRUST_ANCHOR;
        } else {
          process.env.TRUST_ANCHOR = originalEnv;
        }
      }
    });

    it('113. filesystem-looking issuer has no effect', () => {
      const res = resolveProductionRuntimeSourceProvenanceAuthority({
        issuerId: '/etc/passwd',
        issuerKeyVersion: 'v1',
        algorithm: 'Ed25519',
      });
      expect(res.found).toBe(false);
      expect(res.error).toBe('RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_NOT_PROVISIONED');
    });

    it('114. URL-looking issuer has no effect', () => {
      const res = resolveProductionRuntimeSourceProvenanceAuthority({
        issuerId: 'https://example.com/keys/issuer',
        issuerKeyVersion: 'v1',
        algorithm: 'Ed25519',
      });
      expect(res.found).toBe(false);
      expect(res.error).toBe('RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_NOT_PROVISIONED');
    });
  });

  // --------------------------------------------------------------------------
  // Section 9: Production Verifier Invariants
  // --------------------------------------------------------------------------
  describe('9. Production Verifier Invariants', () => {
    it('115. verifyProductionRuntimeSourceProvenanceReceipt fails closed', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload = createValidSyntheticPayload(authority.issuerId);
      const receipt = createSignedReceipt(payload, privateKeyPem);

      const res = verifyProductionRuntimeSourceProvenanceReceipt(receipt);
      expect(res.valid).toBe(false);
      expect(res.failureReason).toBe('RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_NOT_PROVISIONED');
      expect(res.errors.some((e) => e.includes('RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_NOT_PROVISIONED'))).toBe(true);
    });

    it('116. production verifier accepts no caller authority', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload = createValidSyntheticPayload(authority.issuerId);
      const receipt = createSignedReceipt(payload, privateKeyPem);

      // Pass authority as extra parameter to verifyProductionRuntimeSourceProvenanceReceipt
      const res = (verifyProductionRuntimeSourceProvenanceReceipt as any)(receipt, authority);
      expect(res.valid).toBe(false);
      expect(res.failureReason).toBe('RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_NOT_PROVISIONED');
    });

    it('117. production verifier accepts no caller time override', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload = createValidSyntheticPayload(authority.issuerId);
      const receipt = createSignedReceipt(payload, privateKeyPem);

      const res = (verifyProductionRuntimeSourceProvenanceReceipt as any)(receipt, {
        nowUtc: '2026-09-06T11:00:00.000Z',
      });
      expect(res.valid).toBe(false);
      expect(res.failureReason).toBe('RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_NOT_PROVISIONED');
    });

    it('118. production verifier fails closed even with synthetically signed valid receipt', () => {
      const { authority, privateKeyPem } = generateSyntheticAuthorityAndSigner();
      const payload = createValidSyntheticPayload(authority.issuerId);
      const receipt = createSignedReceipt(payload, privateKeyPem);

      const res = verifyProductionRuntimeSourceProvenanceReceipt(receipt);
      expect(res.valid).toBe(false);
      expect(res.failureReason).toBe('RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_NOT_PROVISIONED');
    });
  });

  // --------------------------------------------------------------------------
  // Section 10: Cross-Phase System Invariants & Static Audits
  // --------------------------------------------------------------------------
  describe('10. Cross-Phase System Invariants & Static Audits', () => {
    it('119. GUARDED_SOURCE_ATTESTATION_READY remains strictly false', () => {
      expect(GUARDED_SOURCE_ATTESTATION_READY).toBe(false);
    });

    it('120. GUARDED_HUMAN_AUTH_ATTESTATION_READY remains strictly false', () => {
      expect(GUARDED_HUMAN_AUTH_ATTESTATION_READY).toBe(false);
    });

    it('121. CANARY_LIVE_EXECUTION_ENABLED remains strictly false', () => {
      expect(CANARY_LIVE_EXECUTION_ENABLED).toBe(false);
    });

    it('122. production routing remains strictly false (enforcementAllowed === false)', () => {
      expect(VELNAR_ROUTING_POLICY_VERSION).toBe('a12b2c-v1');
      const decision = resolveRoutingPolicyDecision('CODE_GENERATION' as any);
      expect(decision.enforcementAllowed).toBe(false);
    });

    it('123. no operational key generation API exported from production module', () => {
      expect((sourceProvenanceModule as any).generateKeyPair).toBeUndefined();
      expect((sourceProvenanceModule as any).generateKeyPairSync).toBeUndefined();
      expect((sourceProvenanceModule as any).createPrivateKey).toBeUndefined();
      expect((sourceProvenanceModule as any).createSigningKey).toBeUndefined();
    });

    it('124. no operational signing API exported from production module', () => {
      expect((sourceProvenanceModule as any).sign).toBeUndefined();
      expect((sourceProvenanceModule as any).issueReceipt).toBeUndefined();
      expect((sourceProvenanceModule as any).issueProvenance).toBeUndefined();
    });

    it('125. static scan of deepSeekTrustedRuntimeSourceProvenance.ts contains no forbidden keywords', () => {
      const filePath = path.resolve(
        __dirname,
        '../../worker/ai/canary/deepSeekTrustedRuntimeSourceProvenance.ts'
      );
      const content = fs.readFileSync(filePath, 'utf8');

      const forbidden = [
        'BEGIN PRIVATE KEY',
        'BEGIN OPENSSH PRIVATE KEY',
        'DEEPSEEK_API_KEY',
        'capabilitySecret',
        'generateKeyPair',
        'generateKeyPairSync',
        'createPrivateKey',
        'crypto.sign',
        'fetch(',
        'axios',
        'undici',
        'node:http',
        'node:https',
        'node:net',
        'process.env',
      ];

      for (const pattern of forbidden) {
        expect(content.includes(pattern)).toBe(false);
      }
    });

    it('126. verify 5Q evidence artifact matches canonical specification', () => {
      const artifactPath = path.resolve(
        __dirname,
        '../../execution/a12b2c5q_trusted_runtime_source_provenance_foundation.json'
      );
      expect(fs.existsSync(artifactPath)).toBe(true);

      const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
      expect(artifact.phase).toBe('A.12B.2C-5Q');
      expect(artifact.artifactType).toBe('TRUSTED_RUNTIME_SOURCE_PROVENANCE_FOUNDATION');
      expect(artifact.baseCommit).toBe('95466e0429feaa03fd70ad93abaad02d5ac29301');
      expect(artifact.baseTree).toBe('913d804dc2c9412b4d32d7aa8f19ddddaf57e83b');
      expect(artifact.provenanceVersion).toBe('a12b2c5q-v1');
      expect(artifact.registryVersion).toBe('a12b2c5q-registry-v1');
      expect(artifact.runtimeSourceProvenanceVerifierImplemented).toBe(true);
      expect(artifact.productionSourceProvenanceRegistryImplemented).toBe(true);
      expect(artifact.productionSourceProvenanceRegistryEntryCount).toBe(0);
      expect(artifact.productionSourceProvenanceTrustAnchorProvisioned).toBe(false);
      expect(artifact.canonicalRepositoryBound).toBe(true);
      expect(artifact.canonicalEnvironmentBound).toBe(true);
      expect(artifact.sourceCommitCryptographicallyCovered).toBe(true);
      expect(artifact.sourceTreeCryptographicallyCovered).toBe(true);
      expect(artifact.buildArtifactDigestCryptographicallyCovered).toBe(true);
      expect(artifact.buildAndDeploymentIdentityCryptographicallyCovered).toBe(true);
      expect(artifact.callerSuppliedSourceAuthorityAcceptedAsProductionTrust).toBe(false);
      expect(artifact.callerSuppliedPublicKeyAcceptedAsProductionTrust).toBe(false);
      expect(artifact.callerRegistryOverrideAccepted).toBe(false);
      expect(artifact.productionVerificationClockCallerControlled).toBe(false);
      expect(artifact.trustedRuntimeSourceProvenanceReady).toBe(false);
      expect(artifact.guardedTransportIntegrated).toBe(false);
      expect(artifact.sourceAttestationReady).toBe(false);
      expect(artifact.humanAuthorizationAttestationReady).toBe(false);
      expect(artifact.liveExecutionEnabled).toBe(false);
      expect(artifact.providerNetworkCalls).toBe(0);
      expect(artifact.productionRoutingEnforcementAllowed).toBe(false);
      expect(artifact.successorActivated).toBe(false);
      expect(artifact.realProductionSourcePrivateKeyGenerated).toBe(false);
      expect(artifact.realProductionSourcePublicKeyProvisioned).toBe(false);
      expect(artifact.finalStatus).toBe(
        'A12B2C5Q_SOURCE_PROVENANCE_FOUNDATION_IMPLEMENTED_UNPROVISIONED_NOT_LIVE'
      );
    });

    it('127. total provider network calls during entire test suite execution is exactly 0', () => {
      expect(globalFetchCalls).toBe(0);
    });
  });
});
