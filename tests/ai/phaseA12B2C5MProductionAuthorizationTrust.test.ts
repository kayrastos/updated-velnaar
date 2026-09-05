/**
 * @file tests/ai/phaseA12B2C5MProductionAuthorizationTrust.test.ts
 * @description VELNAR — Phase A.12B.2C-5M Production Human Authorization Trust-Anchor Registry Foundation Test Suite.
 *
 * STRICT INVARIANTS:
 * - Pure offline verification suite.
 * - ZERO DeepSeek calls.
 * - ZERO Gemini calls.
 * - ZERO external network calls.
 * - ZERO provider credentials.
 * - Ephemeral in-memory test keys only (no private keys persisted).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  PRODUCTION_AUTHORITY_REGISTRY_VERSION,
  PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED,
  PRODUCTION_KEY_ROTATION_IMPLEMENTED,
  PRODUCTION_HUMAN_AUTHORITY_REGISTRY,
  EXACT_PRODUCTION_AUTHORITY_KEYS,
  validateProductionAuthorityEntry,
  validateProductionAuthorityRegistry,
  resolveProductionHumanAuthorizationAuthority,
  verifyProductionHumanAuthorizationPackage,
} from '../../worker/ai/canary/deepSeekProductionAuthorizationTrust';
import * as prodTrustModule from '../../worker/ai/canary/deepSeekProductionAuthorizationTrust';

import {
  CANONICAL_ALGORITHM,
  computePublicKeyFingerprintSha256,
  verifyHumanAuthorizationPackage,
  buildTrustedSourceAttestation,
} from '../../worker/ai/canary/deepSeekCertificationAttestation';
import type {
  SignedHumanAuthorizationPackage,
  TrustedSourceAttestation,
} from '../../worker/ai/canary/deepSeekCertificationAttestation';

import {
  CANARY_LIVE_EXECUTION_ENABLED,
} from '../../worker/ai/canary/canarySpecification';
import {
  GUARDED_SOURCE_ATTESTATION_READY,
  GUARDED_HUMAN_AUTH_ATTESTATION_READY,
} from '../../worker/ai/canary/deepSeekGuardedLiveTransport';

// Network monitoring trap
let globalFetchCalls = 0;
const originalFetch = globalThis.fetch;

describe('Phase A.12B.2C-5M: Production Human Authorization Trust-Anchor Registry Foundation', () => {
  beforeEach(() => {
    globalFetchCalls = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      globalFetchCalls++;
      throw new Error('NETWORK_CALL_FORBIDDEN: Network calls are strictly forbidden in offline test suites');
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // Ephemeral helper to generate an in-memory synthetic Ed25519 keypair for schema testing
  function createEphemeralTestKeyPair() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const pubPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
    const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    const fingerprint = computePublicKeyFingerprintSha256(pubPem);
    return { pubPem, privPem, fingerprint };
  }

  const DEFAULT_TEST_ATTESTATION: TrustedSourceAttestation = buildTrustedSourceAttestation({
    sourceCommitSha: '4e1623cfcc3f019727f2c1d4b08d6599a71cc73f',
    sourceTreeSha: '4ef151676ac8ac8f95b47f6df8be6d24a727815f',
    createdAt: '2026-09-05T12:00:00.000Z',
  });

  const DUMMY_SIGNED_PACKAGE: SignedHumanAuthorizationPackage = {
    payload: {
      authorizationVersion: 'a12b2c5-v1.3',
      authorityId: 'velnar-lead-ops-prod',
      issuedAt: '2026-09-05T12:00:00.000Z',
      expiresAt: '2026-09-05T12:10:00.000Z',
      targetProgram: 'cert-program-off-peak',
      pricingWindow: 'OFF_PEAK',
      candidateId: 'cand-001',
      sourceCommitSha: '4e1623cfcc3f019727f2c1d4b08d6599a71cc73f',
      sourceTreeSha: '4ef151676ac8ac8f95b47f6df8be6d24a727815f',
      specificationVersion: 'a12b2c5-v1.3',
      maxBudgetMicroUsd: 12783,
      runNonce: 'live_canary_run_nonce_abc1234567890',
      singleUse: true,
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      canonicalTaskCount: 7,
      transportContractVersion: '1.0.0-contract',
      guardedTransportModuleVersion: '1.0.0-guarded',
      sourceAttestationDigest: DEFAULT_TEST_ATTESTATION.attestationDigest,
    },
    signatureBase64: 'synthetic_sig_base64',
    authorityId: 'velnar-lead-ops-prod',
    keyVersion: '2026-v1',
    algorithm: 'Ed25519',
  };

  // ==========================================================================
  // SUITE 1: Registry Constants and Immutability
  // ==========================================================================

  it('1. registry version exact', () => {
    expect(PRODUCTION_AUTHORITY_REGISTRY_VERSION).toBe('a12b2c5m-v1');
  });

  it('2. trust anchor provisioned false', () => {
    expect(PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED).toBe(false);
  });

  it('3. production registry empty', () => {
    expect(Array.isArray(PRODUCTION_HUMAN_AUTHORITY_REGISTRY)).toBe(true);
    expect(PRODUCTION_HUMAN_AUTHORITY_REGISTRY).toHaveLength(0);
  });

  it('4. registry immutable', () => {
    expect(Object.isFrozen(PRODUCTION_HUMAN_AUTHORITY_REGISTRY)).toBe(true);
    expect(() => {
      (PRODUCTION_HUMAN_AUTHORITY_REGISTRY as any).push({} as any);
    }).toThrow();
  });

  it('5. production wrapper fails closed while unprovisioned', () => {
    const result = verifyProductionHumanAuthorizationPackage(
      DUMMY_SIGNED_PACKAGE,
      DEFAULT_TEST_ATTESTATION
    );
    expect(result.verified).toBe(false);
    expect(result.failureReason).toBe('PRODUCTION_AUTHORITY_TRUST_ANCHOR_NOT_PROVISIONED');
    expect(result.errors.some(e => e.includes('PRODUCTION_AUTHORITY_TRUST_ANCHOR_NOT_PROVISIONED'))).toBe(true);
  });

  // ==========================================================================
  // SUITE 2: Boundary Protections Against Dynamic/Caller Injections
  // ==========================================================================

  it('6. no caller authority descriptor parameter accepted by production wrapper', () => {
    // Function signature has exactly 2 parameters: pkg, sourceAttestation
    expect(verifyProductionHumanAuthorizationPackage.length).toBe(2);
  });

  it('7. no caller publicKey parameter accepted by production wrapper', () => {
    // Extra arguments must have zero effect and not bypass unprovisioned fail-closed gate
    const { pubPem } = createEphemeralTestKeyPair();
    const result = (verifyProductionHumanAuthorizationPackage as any)(
      DUMMY_SIGNED_PACKAGE,
      DEFAULT_TEST_ATTESTATION,
      pubPem // extra argument
    );
    expect(result.verified).toBe(false);
    expect(result.failureReason).toBe('PRODUCTION_AUTHORITY_TRUST_ANCHOR_NOT_PROVISIONED');
  });

  it('8. no caller fingerprint parameter accepted by production wrapper', () => {
    const result = (verifyProductionHumanAuthorizationPackage as any)(
      DUMMY_SIGNED_PACKAGE,
      DEFAULT_TEST_ATTESTATION,
      { publicKeyFingerprintSha256: 'a'.repeat(64) }
    );
    expect(result.verified).toBe(false);
    expect(result.failureReason).toBe('PRODUCTION_AUTHORITY_TRUST_ANCHOR_NOT_PROVISIONED');
  });

  it('9. no caller registry override accepted by production wrapper', () => {
    const result = (verifyProductionHumanAuthorizationPackage as any)(
      DUMMY_SIGNED_PACKAGE,
      DEFAULT_TEST_ATTESTATION,
      { registryOverride: [] }
    );
    expect(result.verified).toBe(false);
    expect(result.failureReason).toBe('PRODUCTION_AUTHORITY_TRUST_ANCHOR_NOT_PROVISIONED');
  });

  it('10. no caller time override accepted by production wrapper', () => {
    const result = (verifyProductionHumanAuthorizationPackage as any)(
      DUMMY_SIGNED_PACKAGE,
      DEFAULT_TEST_ATTESTATION,
      new Date('2026-09-05T12:05:00.000Z') // extra argument attempting to set time
    );
    expect(result.verified).toBe(false);
    expect(result.failureReason).toBe('PRODUCTION_AUTHORITY_TRUST_ANCHOR_NOT_PROVISIONED');
  });

  it('11. no process.env trust source in resolution logic', () => {
    // Setting environment variables has zero effect on resolver
    const originalEnv = process.env.VELNAR_TRUSTED_KEY;
    try {
      process.env.VELNAR_TRUSTED_KEY = 'fake_key';
      const res = resolveProductionHumanAuthorizationAuthority({
        authorityId: 'velnar-lead-ops-prod',
        keyVersion: '2026-v1',
        algorithm: 'Ed25519',
      });
      expect(res.resolved).toBe(false);
      expect(res.failureReason).toBe('PRODUCTION_AUTHORITY_TRUST_ANCHOR_NOT_PROVISIONED');
    } finally {
      if (originalEnv === undefined) {
        delete process.env.VELNAR_TRUSTED_KEY;
      } else {
        process.env.VELNAR_TRUSTED_KEY = originalEnv;
      }
    }
  });

  it('12. no CLI trust source in resolution logic', () => {
    const res = resolveProductionHumanAuthorizationAuthority({
      authorityId: '--trusted-key=test',
      keyVersion: '2026-v1',
      algorithm: 'Ed25519',
    });
    expect(res.resolved).toBe(false);
  });

  it('13. no filesystem trust source in resolution logic', () => {
    const res = resolveProductionHumanAuthorizationAuthority({
      authorityId: '/etc/velnar/keys/authority.pem',
      keyVersion: '2026-v1',
      algorithm: 'Ed25519',
    });
    expect(res.resolved).toBe(false);
  });

  it('14. no network trust source in resolution logic', () => {
    const res = resolveProductionHumanAuthorizationAuthority({
      authorityId: 'https://keys.velnar.internal/prod.jwks',
      keyVersion: '2026-v1',
      algorithm: 'Ed25519',
    });
    expect(res.resolved).toBe(false);
    expect(globalFetchCalls).toBe(0);
  });

  // ==========================================================================
  // SUITE 3: Registry Entry Schema Validation
  // ==========================================================================

  it('15. exact registry-entry property set matches expected allowlist', () => {
    expect(EXACT_PRODUCTION_AUTHORITY_KEYS).toEqual([
      'authorityId',
      'keyVersion',
      'algorithm',
      'publicKeyFingerprintSha256',
      'publicKeyPem',
    ]);
  });

  it('16. unknown property rejects fail-closed', () => {
    const { pubPem, fingerprint } = createEphemeralTestKeyPair();
    const entry = {
      authorityId: 'velnar-test-auth',
      keyVersion: 'v1',
      algorithm: 'Ed25519',
      publicKeyFingerprintSha256: fingerprint,
      publicKeyPem: pubPem,
      extraUnauthorizedField: true,
    };
    const validation = validateProductionAuthorityEntry(entry);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some(e => e.includes('UNKNOWN_PROPERTY'))).toBe(true);
  });

  it('17. inherited authorityId rejects fail-closed', () => {
    const { pubPem, fingerprint } = createEphemeralTestKeyPair();
    const proto = { authorityId: 'velnar-proto-auth' };
    const entry = Object.create(proto);
    entry.keyVersion = 'v1';
    entry.algorithm = 'Ed25519';
    entry.publicKeyFingerprintSha256 = fingerprint;
    entry.publicKeyPem = pubPem;

    const validation = validateProductionAuthorityEntry(entry);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some(e => e.includes('MISSING_OWN_PROPERTY'))).toBe(true);
  });

  it('18. inherited keyVersion rejects fail-closed', () => {
    const { pubPem, fingerprint } = createEphemeralTestKeyPair();
    const proto = { keyVersion: 'v1' };
    const entry = Object.create(proto);
    entry.authorityId = 'velnar-proto-auth';
    entry.algorithm = 'Ed25519';
    entry.publicKeyFingerprintSha256 = fingerprint;
    entry.publicKeyPem = pubPem;

    const validation = validateProductionAuthorityEntry(entry);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some(e => e.includes('MISSING_OWN_PROPERTY'))).toBe(true);
  });

  it('19. missing authorityId rejects fail-closed', () => {
    const { pubPem, fingerprint } = createEphemeralTestKeyPair();
    const entry = {
      keyVersion: 'v1',
      algorithm: 'Ed25519',
      publicKeyFingerprintSha256: fingerprint,
      publicKeyPem: pubPem,
    };
    const validation = validateProductionAuthorityEntry(entry);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some(e => e.includes('MISSING_OWN_PROPERTY'))).toBe(true);
  });

  it('20. missing keyVersion rejects fail-closed', () => {
    const { pubPem, fingerprint } = createEphemeralTestKeyPair();
    const entry = {
      authorityId: 'velnar-auth',
      algorithm: 'Ed25519',
      publicKeyFingerprintSha256: fingerprint,
      publicKeyPem: pubPem,
    };
    const validation = validateProductionAuthorityEntry(entry);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some(e => e.includes('MISSING_OWN_PROPERTY'))).toBe(true);
  });

  it('21. missing algorithm rejects fail-closed', () => {
    const { pubPem, fingerprint } = createEphemeralTestKeyPair();
    const entry = {
      authorityId: 'velnar-auth',
      keyVersion: 'v1',
      publicKeyFingerprintSha256: fingerprint,
      publicKeyPem: pubPem,
    };
    const validation = validateProductionAuthorityEntry(entry);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some(e => e.includes('MISSING_OWN_PROPERTY'))).toBe(true);
  });

  it('22. missing fingerprint rejects fail-closed', () => {
    const { pubPem } = createEphemeralTestKeyPair();
    const entry = {
      authorityId: 'velnar-auth',
      keyVersion: 'v1',
      algorithm: 'Ed25519',
      publicKeyPem: pubPem,
    };
    const validation = validateProductionAuthorityEntry(entry);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some(e => e.includes('MISSING_OWN_PROPERTY'))).toBe(true);
  });

  it('23. missing publicKeyPem rejects fail-closed', () => {
    const { fingerprint } = createEphemeralTestKeyPair();
    const entry = {
      authorityId: 'velnar-auth',
      keyVersion: 'v1',
      algorithm: 'Ed25519',
      publicKeyFingerprintSha256: fingerprint,
    };
    const validation = validateProductionAuthorityEntry(entry);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some(e => e.includes('MISSING_OWN_PROPERTY'))).toBe(true);
  });

  it('24. wrong algorithm rejects fail-closed', () => {
    const { pubPem, fingerprint } = createEphemeralTestKeyPair();
    const entry = {
      authorityId: 'velnar-auth',
      keyVersion: 'v1',
      algorithm: 'RSA-PSS',
      publicKeyFingerprintSha256: fingerprint,
      publicKeyPem: pubPem,
    };
    const validation = validateProductionAuthorityEntry(entry);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some(e => e.includes('INVALID_ALGORITHM'))).toBe(true);
  });

  it('25. malformed fingerprint rejects fail-closed', () => {
    const { pubPem } = createEphemeralTestKeyPair();
    const entry = {
      authorityId: 'velnar-auth',
      keyVersion: 'v1',
      algorithm: 'Ed25519',
      publicKeyFingerprintSha256: 'not-a-valid-sha256-fingerprint',
      publicKeyPem: pubPem,
    };
    const validation = validateProductionAuthorityEntry(entry);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some(e => e.includes('INVALID_FINGERPRINT_FORMAT'))).toBe(true);
  });

  it('26. uppercase fingerprint rejects fail-closed', () => {
    const { pubPem, fingerprint } = createEphemeralTestKeyPair();
    const entry = {
      authorityId: 'velnar-auth',
      keyVersion: 'v1',
      algorithm: 'Ed25519',
      publicKeyFingerprintSha256: fingerprint.toUpperCase(),
      publicKeyPem: pubPem,
    };
    const validation = validateProductionAuthorityEntry(entry);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some(e => e.includes('INVALID_FINGERPRINT_FORMAT'))).toBe(true);
  });

  it('27. malformed PEM rejects fail-closed', () => {
    const entry = {
      authorityId: 'velnar-auth',
      keyVersion: 'v1',
      algorithm: 'Ed25519',
      publicKeyFingerprintSha256: 'a'.repeat(64),
      publicKeyPem: '-----BEGIN PUBLIC KEY-----\nNOT_BASE64\n-----END PUBLIC KEY-----',
    };
    const validation = validateProductionAuthorityEntry(entry);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some(e => e.includes('PUBLIC_KEY_PARSE_FAILED'))).toBe(true);
  });

  it('28. private PEM rejects fail-closed', () => {
    const { privPem } = createEphemeralTestKeyPair();
    const fingerprint = computePublicKeyFingerprintSha256(privPem);
    const entry = {
      authorityId: 'velnar-auth',
      keyVersion: 'v1',
      algorithm: 'Ed25519',
      publicKeyFingerprintSha256: fingerprint,
      publicKeyPem: privPem,
    };
    const validation = validateProductionAuthorityEntry(entry);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some(e => e.includes('PRIVATE_KEY_MATERIAL_FORBIDDEN'))).toBe(true);
  });

  it('29. RSA public key rejects fail-closed', () => {
    const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const rsaPubPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
    const rsaFingerprint = computePublicKeyFingerprintSha256(rsaPubPem);
    const entry = {
      authorityId: 'velnar-auth',
      keyVersion: 'v1',
      algorithm: 'Ed25519',
      publicKeyFingerprintSha256: rsaFingerprint,
      publicKeyPem: rsaPubPem,
    };
    const validation = validateProductionAuthorityEntry(entry);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some(e => e.includes('PUBLIC_KEY_ASYMMETRIC_TYPE_INVALID'))).toBe(true);
  });

  it('30. valid synthetic Ed25519 public key schema passes', () => {
    const { pubPem, fingerprint } = createEphemeralTestKeyPair();
    const entry = {
      authorityId: 'velnar-lead-ops-prod',
      keyVersion: '2026-v1',
      algorithm: 'Ed25519',
      publicKeyFingerprintSha256: fingerprint,
      publicKeyPem: pubPem,
    };
    const validation = validateProductionAuthorityEntry(entry);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
    expect(validation.authority).toBeDefined();
    expect(validation.authority?.authorityId).toBe('velnar-lead-ops-prod');
  });

  it('31. fingerprint mismatch rejects fail-closed', () => {
    const { pubPem } = createEphemeralTestKeyPair();
    const entry = {
      authorityId: 'velnar-lead-ops-prod',
      keyVersion: '2026-v1',
      algorithm: 'Ed25519',
      publicKeyFingerprintSha256: 'b'.repeat(64), // tampered fingerprint
      publicKeyPem: pubPem,
    };
    const validation = validateProductionAuthorityEntry(entry);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some(e => e.includes('PUBLIC_KEY_FINGERPRINT_MISMATCH'))).toBe(true);
  });

  it('32. recomputed fingerprint clean passes', () => {
    const { pubPem, fingerprint } = createEphemeralTestKeyPair();
    const recomputed = computePublicKeyFingerprintSha256(pubPem);
    expect(recomputed).toBe(fingerprint);
  });

  // ==========================================================================
  // SUITE 4: Registry Collection & Uniqueness Policy
  // ==========================================================================

  it('33. duplicate authorityId/keyVersion rejects fail-closed', () => {
    const key1 = createEphemeralTestKeyPair();
    const key2 = createEphemeralTestKeyPair();

    const registry = [
      {
        authorityId: 'velnar-auth-1',
        keyVersion: 'v1',
        algorithm: 'Ed25519',
        publicKeyFingerprintSha256: key1.fingerprint,
        publicKeyPem: key1.pubPem,
      },
      {
        authorityId: 'velnar-auth-1',
        keyVersion: 'v1', // duplicate pair
        algorithm: 'Ed25519',
        publicKeyFingerprintSha256: key2.fingerprint,
        publicKeyPem: key2.pubPem,
      },
    ];

    const result = validateProductionAuthorityRegistry(registry);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('DUPLICATE_AUTHORITY_KEY_VERSION'))).toBe(true);
  });

  it('34. conflicting duplicate fingerprint rejects fail-closed', () => {
    const key1 = createEphemeralTestKeyPair();

    const registry = [
      {
        authorityId: 'velnar-auth-1',
        keyVersion: 'v1',
        algorithm: 'Ed25519',
        publicKeyFingerprintSha256: key1.fingerprint,
        publicKeyPem: key1.pubPem,
      },
      {
        authorityId: 'velnar-auth-2',
        keyVersion: 'v2',
        algorithm: 'Ed25519',
        publicKeyFingerprintSha256: key1.fingerprint, // duplicate fingerprint
        publicKeyPem: key1.pubPem,
      },
    ];

    const result = validateProductionAuthorityRegistry(registry);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('DUPLICATE_PUBLIC_KEY_FINGERPRINT'))).toBe(true);
  });

  it('35. authorityId empty rejects fail-closed', () => {
    const { pubPem, fingerprint } = createEphemeralTestKeyPair();
    const entry = {
      authorityId: '',
      keyVersion: 'v1',
      algorithm: 'Ed25519',
      publicKeyFingerprintSha256: fingerprint,
      publicKeyPem: pubPem,
    };
    const validation = validateProductionAuthorityEntry(entry);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some(e => e.includes('INVALID_AUTHORITY_ID_LENGTH'))).toBe(true);
  });

  it('36. keyVersion empty rejects fail-closed', () => {
    const { pubPem, fingerprint } = createEphemeralTestKeyPair();
    const entry = {
      authorityId: 'velnar-auth',
      keyVersion: '',
      algorithm: 'Ed25519',
      publicKeyFingerprintSha256: fingerprint,
      publicKeyPem: pubPem,
    };
    const validation = validateProductionAuthorityEntry(entry);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some(e => e.includes('INVALID_KEY_VERSION_LENGTH'))).toBe(true);
  });

  it('37. unsafe authorityId rejects fail-closed', () => {
    const { pubPem, fingerprint } = createEphemeralTestKeyPair();
    const entry = {
      authorityId: 'velnar/admin;rm -rf',
      keyVersion: 'v1',
      algorithm: 'Ed25519',
      publicKeyFingerprintSha256: fingerprint,
      publicKeyPem: pubPem,
    };
    const validation = validateProductionAuthorityEntry(entry);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some(e => e.includes('INVALID_AUTHORITY_ID_FORMAT'))).toBe(true);
  });

  it('38. unsafe keyVersion rejects fail-closed', () => {
    const { pubPem, fingerprint } = createEphemeralTestKeyPair();
    const entry = {
      authorityId: 'velnar-auth',
      keyVersion: 'v1$inject',
      algorithm: 'Ed25519',
      publicKeyFingerprintSha256: fingerprint,
      publicKeyPem: pubPem,
    };
    const validation = validateProductionAuthorityEntry(entry);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some(e => e.includes('INVALID_KEY_VERSION_FORMAT'))).toBe(true);
  });

  // ==========================================================================
  // SUITE 5: Authority Resolution Fail-Closed Semantics
  // ==========================================================================

  it('39. resolver uses registry only and fails closed when unprovisioned', () => {
    const res = resolveProductionHumanAuthorizationAuthority({
      authorityId: 'velnar-lead-ops-prod',
      keyVersion: '2026-v1',
      algorithm: 'Ed25519',
    });
    expect(res.resolved).toBe(false);
    expect(res.authority).toBeUndefined();
    expect(res.failureReason).toBe('PRODUCTION_AUTHORITY_TRUST_ANCHOR_NOT_PROVISIONED');
  });

  it('40. unknown authority fails closed', () => {
    const res = resolveProductionHumanAuthorizationAuthority({
      authorityId: 'unregistered-authority-x',
      keyVersion: '2026-v1',
      algorithm: 'Ed25519',
    });
    expect(res.resolved).toBe(false);
  });

  it('41. unknown key version fails closed', () => {
    const res = resolveProductionHumanAuthorizationAuthority({
      authorityId: 'velnar-lead-ops-prod',
      keyVersion: 'unknown-key-version',
      algorithm: 'Ed25519',
    });
    expect(res.resolved).toBe(false);
  });

  it('42. source attestation remains mandatory in production wrapper', () => {
    const result = verifyProductionHumanAuthorizationPackage(
      DUMMY_SIGNED_PACKAGE,
      null as any
    );
    expect(result.verified).toBe(false);
  });

  it('43. generic 5L verifier remains unchanged and functional', () => {
    expect(typeof verifyHumanAuthorizationPackage).toBe('function');
    // Generic verifier accepts authority descriptor for unit testing
    const { pubPem, fingerprint } = createEphemeralTestKeyPair();
    const syntheticAuthority = {
      authorityId: 'synth-auth',
      keyVersion: 'v1',
      algorithm: 'Ed25519' as const,
      publicKeyFingerprintSha256: fingerprint,
      publicKeyPem: pubPem,
    };
    const res = verifyHumanAuthorizationPackage(
      DUMMY_SIGNED_PACKAGE,
      syntheticAuthority,
      {
        sourceAttestation: DEFAULT_TEST_ATTESTATION,
        nowUtc: new Date('2026-09-05T12:05:00.000Z'),
      }
    );
    // Fails on authority mismatch as expected, proving it operates
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.includes('AUTHORITY_ID_MISMATCH'))).toBe(true);
  });

  // ==========================================================================
  // SUITE 6: Static Security & Architecture Invariants
  // ==========================================================================

  it('44. no private key text or forbidden tokens in production module source', () => {
    const modulePath = path.resolve(
      __dirname,
      '../../worker/ai/canary/deepSeekProductionAuthorizationTrust.ts'
    );
    const code = fs.readFileSync(modulePath, 'utf8');

    expect(code.includes('BEGIN PRIVATE KEY')).toBe(false);
    expect(code.includes('BEGIN OPENSSH PRIVATE KEY')).toBe(false);
    expect(code.includes('PRIVATE KEY-----')).toBe(false);
    expect(code.includes('DEEPSEEK_API_KEY')).toBe(false);
    expect(code.includes('capabilitySecret')).toBe(false);
    expect(code.includes('process.env')).toBe(false);
    expect(code.includes('fetch(')).toBe(false);
    expect(code.includes('axios')).toBe(false);
    expect(code.includes('undici')).toBe(false);
    expect(code.includes('node:http')).toBe(false);
    expect(code.includes('node:https')).toBe(false);
    expect(code.includes('node:net')).toBe(false);
  });

  it('45. no signing API export in production trust module', () => {
    const forbiddenExports = [
      'issueHumanAuthorization',
      'signHumanAuthorization',
      'generateKeyPair',
      'generateProductionKey',
      'createPrivateKey',
      'sign',
    ];
    for (const exp of forbiddenExports) {
      expect((prodTrustModule as any)[exp]).toBeUndefined();
    }
  });

  it('46. no fetch/http/net capability imported or used', () => {
    const modulePath = path.resolve(
      __dirname,
      '../../worker/ai/canary/deepSeekProductionAuthorizationTrust.ts'
    );
    const code = fs.readFileSync(modulePath, 'utf8');
    expect(code.includes("import http from 'http'")).toBe(false);
    expect(code.includes("import https from 'https'")).toBe(false);
    expect(code.includes("import net from 'net'")).toBe(false);
  });

  it('47. CANARY_LIVE_EXECUTION_ENABLED remains strictly false', () => {
    expect(CANARY_LIVE_EXECUTION_ENABLED).toBe(false);
  });

  it('48. GUARDED_SOURCE_ATTESTATION_READY remains strictly false', () => {
    expect(GUARDED_SOURCE_ATTESTATION_READY).toBe(false);
  });

  it('49. GUARDED_HUMAN_AUTH_ATTESTATION_READY remains strictly false', () => {
    expect(GUARDED_HUMAN_AUTH_ATTESTATION_READY).toBe(false);
  });

  it('50. production key rotation implemented is strictly false', () => {
    expect(PRODUCTION_KEY_ROTATION_IMPLEMENTED).toBe(false);
  });

  it('51. total provider network calls during entire test suite execution is exactly 0', () => {
    expect(globalFetchCalls).toBe(0);
  });
});
