/**
 * @file tests/ai/phaseA12B2C5LDeepSeekCertificationAttestation.test.ts
 * @description Comprehensive offline adversarial test suite for A.12B.2C-5L:
 * Trusted Source Attestation & Cryptographic Human Authorization Foundation.
 * 
 * STRICT ARCHITECTURAL INVARIANTS:
 * - ZERO DeepSeek network calls.
 * - ZERO Gemini network calls.
 * - ZERO external network calls.
 * - ZERO provider credentials.
 * - Ephemeral synthetic Ed25519 keypairs generated strictly in test process memory.
 * - No private keys saved to disk or exported outside this test file.
 * - Fail-closed enforcement on all mutations, bounds, lifetimes, and invariants.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  ATTESTATION_FOUNDATION_VERSION,
  CANONICAL_AUTHORIZATION_VERSION,
  CANONICAL_ALGORITHM,
  GUARDED_TRANSPORT_MODULE_IDENTITY,
  SEALED_REPOSITORY_IDENTITY,
  MAX_AUTHORIZATION_LIFETIME_MS,
  OFF_PEAK_MIN_BUDGET_MICRO_USD,
  PEAK_MIN_BUDGET_MICRO_USD,
  OFF_PEAK_MAX_BUDGET_CEILING_MICRO_USD,
  PEAK_MAX_BUDGET_CEILING_MICRO_USD,
  MAX_AUTHORIZED_BUDGET_CEILING_MICRO_USD,
  FORBIDDEN_PLACEHOLDER_NONCES,
  HumanAuthorizationAuthorityDescriptor,
  CanonicalHumanAuthorizationPayload,
  SignedHumanAuthorizationPackage,
  TrustedSourceAttestation,
  computePublicKeyFingerprintSha256,
  canonicalizeHumanAuthorizationPayload,
  computeSourceAttestationDigest,
  buildTrustedSourceAttestation,
  validateTrustedSourceAttestation,
  validateRunNonce,
  computeAuthorizationPackageDigest,
  computeAuthorizationConsumptionKey,
  verifyHumanAuthorizationPackage,
  VerifyAuthorizationOptions,
  isValidIsoUtcTimestamp,
} from '../../worker/ai/canary/deepSeekCertificationAttestation';

import {
  TRANSPORT_CONTRACT_VERSION,
  SEALED_PROVIDER,
  SEALED_MODEL,
  SEALED_OFF_PEAK_PROGRAM_ID,
  SEALED_PEAK_PROGRAM_ID,
  SEALED_OFF_PEAK_CANDIDATE_ID,
  SEALED_PEAK_CANDIDATE_ID,
  SEALED_CANONICAL_TASK_COUNT,
  computeCanonicalTaskSetHash,
  computeFixtureSetHash,
} from '../../worker/ai/canary/deepSeekLiveCertificationTransportContract';

import {
  GUARDED_TRANSPORT_MODULE_VERSION,
  GUARDED_SOURCE_ATTESTATION_READY,
  GUARDED_HUMAN_AUTH_ATTESTATION_READY,
} from '../../worker/ai/canary/deepSeekGuardedLiveTransport';

import { CANARY_LIVE_EXECUTION_ENABLED } from '../../worker/ai/canary/canarySpecification';
import { SUCCESSOR_SPECIFICATION_VERSION } from '../../worker/ai/canary/deepSeekSingleProviderCertificationSpecification';
import { resolveRoutingPolicyDecision } from '../../worker/ai/routingPolicy';
import * as attestationModule from '../../worker/ai/canary/deepSeekCertificationAttestation';

// ============================================================================
// TEST CONSTANTS & SYNTHETIC HELPERS (STRICTLY IN-MEMORY TEST ONLY)
// ============================================================================

const BASE_COMMIT_SHA = '9f85f4c32cca4ae3df992b18584016efb6c578f1';
const BASE_TREE_SHA = '8179946ec3581d316a7a1a8b55aa207eef3efe10';

const DEFAULT_TEST_ATTESTATION = buildTrustedSourceAttestation({
  sourceCommitSha: BASE_COMMIT_SHA,
  sourceTreeSha: BASE_TREE_SHA,
  createdAt: '2026-09-05T12:00:00.000Z',
});

/**
 * SYNTHETIC_TEST_ONLY: Generates an ephemeral Ed25519 keypair strictly in process memory.
 */
function createSyntheticTestAuthority(): {
  authority: HumanAuthorizationAuthorityDescriptor;
  privateKeyPem: string;
} {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  const authorityId = 'auth_velnar_secops_synthetic_5l';
  const keyVersion = '2026-v1';
  const publicKeyFingerprintSha256 = computePublicKeyFingerprintSha256(publicKeyPem);

  return {
    authority: {
      authorityId,
      algorithm: 'Ed25519',
      publicKeyFingerprintSha256,
      publicKeyPem,
      keyVersion,
    },
    privateKeyPem,
  };
}

/**
 * SYNTHETIC_TEST_ONLY: Signs a canonical authorization payload with the in-memory test private key.
 */
function signSyntheticPayload(
  payload: CanonicalHumanAuthorizationPayload,
  authority: HumanAuthorizationAuthorityDescriptor,
  privateKeyPem: string
): SignedHumanAuthorizationPackage {
  const canonicalBytes = Buffer.from(canonicalizeHumanAuthorizationPayload(payload), 'utf8');
  const signatureBuffer = crypto.sign(null, canonicalBytes, privateKeyPem);

  return {
    payload,
    signatureBase64: Buffer.from(signatureBuffer).toString('base64'),
    authorityId: authority.authorityId,
    keyVersion: authority.keyVersion,
    algorithm: authority.algorithm,
  };
}

/**
 * Helper to build a canonical valid payload for testing.
 */
function createSyntheticValidPayload(
  authorityId: string,
  overrides?: Partial<CanonicalHumanAuthorizationPayload>
): CanonicalHumanAuthorizationPayload {
  const now = new Date('2026-09-05T12:00:00.000Z');
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString(); // 10 mins lifetime (under 15m)

  const defaultAttestation = buildTrustedSourceAttestation({
    sourceCommitSha: BASE_COMMIT_SHA,
    sourceTreeSha: BASE_TREE_SHA,
    createdAt: issuedAt,
  });

  return {
    authorizationVersion: CANONICAL_AUTHORIZATION_VERSION,
    authorityId,
    issuedAt,
    expiresAt,
    targetProgram: SEALED_OFF_PEAK_PROGRAM_ID,
    pricingWindow: 'OFF_PEAK',
    candidateId: SEALED_OFF_PEAK_CANDIDATE_ID,
    sourceCommitSha: BASE_COMMIT_SHA,
    sourceTreeSha: BASE_TREE_SHA,
    specificationVersion: SUCCESSOR_SPECIFICATION_VERSION,
    maxBudgetMicroUsd: OFF_PEAK_MIN_BUDGET_MICRO_USD,
    runNonce: 'a12b2c5l_nonce_7f9b23c148e26d910a5b82',
    singleUse: true,
    provider: SEALED_PROVIDER,
    model: SEALED_MODEL,
    canonicalTaskCount: 7,
    transportContractVersion: TRANSPORT_CONTRACT_VERSION,
    guardedTransportModuleVersion: GUARDED_TRANSPORT_MODULE_VERSION,
    sourceAttestationDigest: defaultAttestation.attestationDigest,
    ...overrides,
  };
}

describe('VELNAR — A.12B.2C-5L Trusted Source Attestation & Cryptographic Human Authorization Foundation', () => {
  let globalFetchCalls = 0;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    globalFetchCalls = 0;
    originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      globalFetchCalls++;
      throw new Error('SENTINEL_DISPATCH_BLOCKED: Zero external provider or network calls allowed during 5L');
    }) as any;
  });

  afterEach(() => {
    expect(globalFetchCalls).toBe(0);
    globalThis.fetch = originalFetch;
    globalFetchCalls = 0;
  });

  // ==========================================================================
  // SUITE 1: Ed25519 Cryptographic Verification & Fail-Closed Behavior
  // ==========================================================================

  it('1. Ed25519 verification clean package passes', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId);
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    const result = verifyHumanAuthorizationPackage(pkg, authority, {
      nowUtc: new Date('2026-09-05T12:05:00.000Z'),
      sourceAttestation: DEFAULT_TEST_ATTESTATION,
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.failureReason).toBeUndefined();
    expect(result.authorizationPackageDigest).toBeDefined();
    expect(result.authorizationConsumptionKey).toBeDefined();
  });

  it('2. wrong public key rejects', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const { authority: wrongAuthority } = createSyntheticTestAuthority();

    const payload = createSyntheticValidPayload(authority.authorityId);
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    // Verify using wrong authority descriptor (with wrong authorityId & public key)
    const result = verifyHumanAuthorizationPackage(pkg, wrongAuthority, {
      nowUtc: new Date('2026-09-05T12:05:00.000Z'),
      sourceAttestation: DEFAULT_TEST_ATTESTATION,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('MISMATCH') || e.includes('SIGNATURE_VERIFICATION_FAILED'))).toBe(true);
  });

  it('3. corrupted signature rejects', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId);
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    // Corrupt one character in signature
    const corruptSignature = pkg.signatureBase64.slice(0, -4) + 'AAAA';
    const corruptedPkg = { ...pkg, signatureBase64: corruptSignature };

    const result = verifyHumanAuthorizationPackage(corruptedPkg, authority, {
      nowUtc: new Date('2026-09-05T12:05:00.000Z'),
      sourceAttestation: DEFAULT_TEST_ATTESTATION,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('SIGNATURE_VERIFICATION_FAILED'))).toBe(true);
  });

  it('4. missing signature rejects', () => {
    const { authority } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId);
    const pkg: any = {
      payload,
      signatureBase64: '',
      authorityId: authority.authorityId,
      keyVersion: authority.keyVersion,
      algorithm: authority.algorithm,
    };

    const result = verifyHumanAuthorizationPackage(pkg, authority, {
      nowUtc: new Date('2026-09-05T12:05:00.000Z'),
      sourceAttestation: DEFAULT_TEST_ATTESTATION,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('SIGNATURE_MISSING'))).toBe(true);
  });

  it('5. wrong algorithm rejects', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId);
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    const badPkg: any = { ...pkg, algorithm: 'RSA-SHA256' };

    const result = verifyHumanAuthorizationPackage(badPkg, authority, {
      nowUtc: new Date('2026-09-05T12:05:00.000Z'),
      sourceAttestation: DEFAULT_TEST_ATTESTATION,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('ALGORITHM_MISMATCH'))).toBe(true);
  });

  it('6. wrong authorityId rejects', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId);
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    const mismatchedPkg = { ...pkg, authorityId: 'unauthorized_impostor_authority' };

    const result = verifyHumanAuthorizationPackage(mismatchedPkg, authority, {
      nowUtc: new Date('2026-09-05T12:05:00.000Z'),
      sourceAttestation: DEFAULT_TEST_ATTESTATION,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('AUTHORITY_ID_MISMATCH'))).toBe(true);
  });

  it('7. wrong keyVersion rejects', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId);
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    const mismatchedPkg = { ...pkg, keyVersion: '1999-legacy-v0' };

    const result = verifyHumanAuthorizationPackage(mismatchedPkg, authority, {
      nowUtc: new Date('2026-09-05T12:05:00.000Z'),
      sourceAttestation: DEFAULT_TEST_ATTESTATION,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('KEY_VERSION_MISMATCH'))).toBe(true);
  });

  it('8. wrong public-key fingerprint rejects', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId);
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    // Tamper with fingerprint in authority descriptor
    const tamperedAuthority: HumanAuthorizationAuthorityDescriptor = {
      ...authority,
      publicKeyFingerprintSha256: 'deadbeef'.repeat(8),
    };

    const result = verifyHumanAuthorizationPackage(pkg, tamperedAuthority, {
      nowUtc: new Date('2026-09-05T12:05:00.000Z'),
      sourceAttestation: DEFAULT_TEST_ATTESTATION,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('PUBLIC_KEY_FINGERPRINT_MISMATCH'))).toBe(true);
  });

  // ==========================================================================
  // SUITE 2: Tamper Resistance on Bound Fields
  // ==========================================================================

  it('9. payload mutation after signing rejects', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId);
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    // Mutate an arbitrary field in payload after signature generated
    const tamperedPkg = {
      ...pkg,
      payload: { ...pkg.payload, maxBudgetMicroUsd: pkg.payload.maxBudgetMicroUsd + 10 },
    };

    const result = verifyHumanAuthorizationPackage(tamperedPkg, authority, {
      nowUtc: new Date('2026-09-05T12:05:00.000Z'),
      sourceAttestation: DEFAULT_TEST_ATTESTATION,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('SIGNATURE_VERIFICATION_FAILED'))).toBe(true);
  });

  it('10. source commit mutation rejects', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId, {
      sourceCommitSha: '0000000000000000000000000000000000000000',
    });
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    const attestation = buildTrustedSourceAttestation({
      sourceCommitSha: BASE_COMMIT_SHA,
      sourceTreeSha: BASE_TREE_SHA,
    });

    const result = verifyHumanAuthorizationPackage(pkg, authority, {
      nowUtc: new Date('2026-09-05T12:05:00.000Z'),
      sourceAttestation: attestation,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('SOURCE_COMMIT_BINDING_MISMATCH'))).toBe(true);
  });

  it('11. source tree mutation rejects', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId, {
      sourceTreeSha: 'ffffffffffffffffffffffffffffffffffffffff',
    });
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    const attestation = buildTrustedSourceAttestation({
      sourceCommitSha: BASE_COMMIT_SHA,
      sourceTreeSha: BASE_TREE_SHA,
    });

    const result = verifyHumanAuthorizationPackage(pkg, authority, {
      nowUtc: new Date('2026-09-05T12:05:00.000Z'),
      sourceAttestation: attestation,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('SOURCE_TREE_BINDING_MISMATCH'))).toBe(true);
  });

  it('12. source attestation digest mutation rejects', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId, {
      sourceAttestationDigest: '0123456789abcdef'.repeat(4),
    });
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    const attestation = buildTrustedSourceAttestation({
      sourceCommitSha: BASE_COMMIT_SHA,
      sourceTreeSha: BASE_TREE_SHA,
    });

    const result = verifyHumanAuthorizationPackage(pkg, authority, {
      nowUtc: new Date('2026-09-05T12:05:00.000Z'),
      sourceAttestation: attestation,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('ATTESTATION_DIGEST_BINDING_MISMATCH'))).toBe(true);
  });

  it('13. pricing window mutation rejects', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId, {
      pricingWindow: 'INVALID_WINDOW' as any,
    });
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    const result = verifyHumanAuthorizationPackage(pkg, authority, {
      nowUtc: new Date('2026-09-05T12:05:00.000Z'),
      sourceAttestation: DEFAULT_TEST_ATTESTATION,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('INVALID_PRICING_WINDOW'))).toBe(true);
  });

  it('14. program mutation rejects', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId, {
      targetProgram: 'ARBITRARY_UNAPPROVED_PROGRAM',
    });
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    const result = verifyHumanAuthorizationPackage(pkg, authority, {
      nowUtc: new Date('2026-09-05T12:05:00.000Z'),
      sourceAttestation: DEFAULT_TEST_ATTESTATION,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('PROGRAM_MISMATCH'))).toBe(true);
  });

  it('15. candidate mutation rejects', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId, {
      candidateId: 'unapproved-candidate-low',
    });
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    const result = verifyHumanAuthorizationPackage(pkg, authority, {
      nowUtc: new Date('2026-09-05T12:05:00.000Z'),
      sourceAttestation: DEFAULT_TEST_ATTESTATION,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('CANDIDATE_MISMATCH'))).toBe(true);
  });

  it('16. provider mutation rejects', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId, {
      provider: 'openai' as any,
    });
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    const result = verifyHumanAuthorizationPackage(pkg, authority, {
      nowUtc: new Date('2026-09-05T12:05:00.000Z'),
      sourceAttestation: DEFAULT_TEST_ATTESTATION,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('PROVIDER_MISMATCH'))).toBe(true);
  });

  it('17. model mutation rejects', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId, {
      model: 'deepseek-v3' as any,
    });
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    const result = verifyHumanAuthorizationPackage(pkg, authority, {
      nowUtc: new Date('2026-09-05T12:05:00.000Z'),
      sourceAttestation: DEFAULT_TEST_ATTESTATION,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('MODEL_MISMATCH'))).toBe(true);
  });

  it('18. spec mutation rejects', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId, {
      specificationVersion: 'a12b2c5-v1.0-outdated',
    });
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    const result = verifyHumanAuthorizationPackage(pkg, authority, {
      nowUtc: new Date('2026-09-05T12:05:00.000Z'),
      sourceAttestation: DEFAULT_TEST_ATTESTATION,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('SPEC_VERSION_MISMATCH'))).toBe(true);
  });

  it('19. budget mutation rejects', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId, {
      maxBudgetMicroUsd: 100, // below minimum
    });
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    const result = verifyHumanAuthorizationPackage(pkg, authority, {
      nowUtc: new Date('2026-09-05T12:05:00.000Z'),
      sourceAttestation: DEFAULT_TEST_ATTESTATION,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('BUDGET_INSUFFICIENT'))).toBe(true);
  });

  it('20. nonce mutation rejects', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId, {
      runNonce: 'synthetic_nonce_5k', // known placeholder
    });
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    const result = verifyHumanAuthorizationPackage(pkg, authority, {
      nowUtc: new Date('2026-09-05T12:05:00.000Z'),
      sourceAttestation: DEFAULT_TEST_ATTESTATION,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('NONCE_FORBIDDEN_PLACEHOLDER'))).toBe(true);
  });

  it('21. task count mutation rejects', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId, {
      canonicalTaskCount: 14 as any, // 14-call combined forbidden
    });
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    const result = verifyHumanAuthorizationPackage(pkg, authority, {
      nowUtc: new Date('2026-09-05T12:05:00.000Z'),
      sourceAttestation: DEFAULT_TEST_ATTESTATION,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('TASK_COUNT_MISMATCH'))).toBe(true);
  });

  it('22. transport contract version mutation rejects', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId, {
      transportContractVersion: '0.9.0-draft',
    });
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    const result = verifyHumanAuthorizationPackage(pkg, authority, {
      nowUtc: new Date('2026-09-05T12:05:00.000Z'),
      sourceAttestation: DEFAULT_TEST_ATTESTATION,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('CONTRACT_VERSION_MISMATCH'))).toBe(true);
  });

  it('23. transport module version mutation rejects', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId, {
      guardedTransportModuleVersion: '0.5.0-alpha',
    });
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    const result = verifyHumanAuthorizationPackage(pkg, authority, {
      nowUtc: new Date('2026-09-05T12:05:00.000Z'),
      sourceAttestation: DEFAULT_TEST_ATTESTATION,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('MODULE_VERSION_MISMATCH'))).toBe(true);
  });

  // ==========================================================================
  // SUITE 3: Timestamps, Expiry & Bounded Lifetime
  // ==========================================================================

  it('24. issuedAt missing rejects', () => {
    const { authority } = createSyntheticTestAuthority();
    expect(() => {
      canonicalizeHumanAuthorizationPayload({
        ...createSyntheticValidPayload(authority.authorityId),
        issuedAt: undefined as any,
      });
    }).toThrow(/CANONICALIZATION_FAILURE/);
  });

  it('25. expiresAt missing rejects', () => {
    const { authority } = createSyntheticTestAuthority();
    expect(() => {
      canonicalizeHumanAuthorizationPayload({
        ...createSyntheticValidPayload(authority.authorityId),
        expiresAt: undefined as any,
      });
    }).toThrow(/CANONICALIZATION_FAILURE/);
  });

  it('26. invalid timestamp rejects', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId, {
      issuedAt: 'NOT_A_VALID_DATE',
    });
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    const result = verifyHumanAuthorizationPackage(pkg, authority, {
      nowUtc: new Date('2026-09-05T12:05:00.000Z'),
      sourceAttestation: DEFAULT_TEST_ATTESTATION,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('INVALID_ISSUED_AT'))).toBe(true);
  });

  it('27. expires <= issued rejects', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId, {
      issuedAt: '2026-09-05T12:10:00.000Z',
      expiresAt: '2026-09-05T12:05:00.000Z',
    });
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    const result = verifyHumanAuthorizationPackage(pkg, authority, {
      nowUtc: new Date('2026-09-05T12:06:00.000Z'),
      sourceAttestation: DEFAULT_TEST_ATTESTATION,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('INVALID_EXPIRY_SEQUENCE'))).toBe(true);
  });

  it('28. expired rejects', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId, {
      issuedAt: '2026-09-05T12:00:00.000Z',
      expiresAt: '2026-09-05T12:10:00.000Z',
    });
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    const result = verifyHumanAuthorizationPackage(pkg, authority, {
      nowUtc: new Date('2026-09-05T12:15:00.000Z'), // Current time is AFTER expiresAt
      sourceAttestation: DEFAULT_TEST_ATTESTATION,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('AUTHORIZATION_EXPIRED'))).toBe(true);
  });

  it('29. future issuedAt rejects', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId, {
      issuedAt: '2026-09-05T12:10:00.000Z',
      expiresAt: '2026-09-05T12:20:00.000Z',
    });
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    const result = verifyHumanAuthorizationPackage(pkg, authority, {
      nowUtc: new Date('2026-09-05T12:05:00.000Z'), // Current time is BEFORE issuedAt
      sourceAttestation: DEFAULT_TEST_ATTESTATION,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('NOT_YET_VALID'))).toBe(true);
  });

  it('30. lifetime above max rejects', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId, {
      issuedAt: '2026-09-05T12:00:00.000Z',
      expiresAt: '2026-09-05T12:30:00.000Z', // 30 minutes (exceeds 15-minute max)
    });
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    const result = verifyHumanAuthorizationPackage(pkg, authority, {
      nowUtc: new Date('2026-09-05T12:05:00.000Z'),
      sourceAttestation: DEFAULT_TEST_ATTESTATION,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('LIFETIME_EXCEEDS_MAX'))).toBe(true);
  });

  it('31. singleUse false serializes false and verifier requires singleUse: true', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const badPayload: any = createSyntheticValidPayload(authority.authorityId, {
      singleUse: false as any,
    });

    expect(badPayload.singleUse).toBe(false);
    // Canonicalizer serializes actual runtime value: singleUse: false
    const canonicalized = canonicalizeHumanAuthorizationPayload(badPayload);
    expect(canonicalized.includes('"singleUse":false')).toBe(true);

    const pkg = signSyntheticPayload(badPayload, authority, privateKeyPem);
    const result = verifyHumanAuthorizationPackage(pkg, authority, {
      nowUtc: new Date('2026-09-05T12:05:00.000Z'),
      sourceAttestation: DEFAULT_TEST_ATTESTATION,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('SINGLE_USE_REQUIRED'))).toBe(true);
  });

  // ==========================================================================
  // SUITE 4: Program, Candidate & Pricing Window Binding
  // ==========================================================================

  it('32. OFF_PEAK program/candidate exact passes', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId, {
      pricingWindow: 'OFF_PEAK',
      targetProgram: SEALED_OFF_PEAK_PROGRAM_ID,
      candidateId: SEALED_OFF_PEAK_CANDIDATE_ID,
      maxBudgetMicroUsd: OFF_PEAK_MIN_BUDGET_MICRO_USD,
    });
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    const result = verifyHumanAuthorizationPackage(pkg, authority, {
      nowUtc: new Date('2026-09-05T12:05:00.000Z'),
      sourceAttestation: DEFAULT_TEST_ATTESTATION,
    });

    expect(result.valid).toBe(true);
  });

  it('33. PEAK program/candidate exact passes', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId, {
      pricingWindow: 'PEAK',
      targetProgram: SEALED_PEAK_PROGRAM_ID,
      candidateId: SEALED_PEAK_CANDIDATE_ID,
      maxBudgetMicroUsd: PEAK_MIN_BUDGET_MICRO_USD,
    });
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    const result = verifyHumanAuthorizationPackage(pkg, authority, {
      nowUtc: new Date('2026-09-05T12:05:00.000Z'),
      sourceAttestation: DEFAULT_TEST_ATTESTATION,
    });

    expect(result.valid).toBe(true);
  });

  it('34. cross-window program rejects', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    // OFF_PEAK window but PEAK program
    const payload = createSyntheticValidPayload(authority.authorityId, {
      pricingWindow: 'OFF_PEAK',
      targetProgram: SEALED_PEAK_PROGRAM_ID,
      candidateId: SEALED_OFF_PEAK_CANDIDATE_ID,
    });
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    const result = verifyHumanAuthorizationPackage(pkg, authority, {
      nowUtc: new Date('2026-09-05T12:05:00.000Z'),
      sourceAttestation: DEFAULT_TEST_ATTESTATION,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('PROGRAM_MISMATCH'))).toBe(true);
  });

  it('35. cross-window candidate rejects', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    // PEAK window but OFF_PEAK candidate
    const payload = createSyntheticValidPayload(authority.authorityId, {
      pricingWindow: 'PEAK',
      targetProgram: SEALED_PEAK_PROGRAM_ID,
      candidateId: SEALED_OFF_PEAK_CANDIDATE_ID,
      maxBudgetMicroUsd: PEAK_MIN_BUDGET_MICRO_USD,
    });
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    const result = verifyHumanAuthorizationPackage(pkg, authority, {
      nowUtc: new Date('2026-09-05T12:05:00.000Z'),
      sourceAttestation: DEFAULT_TEST_ATTESTATION,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('CANDIDATE_MISMATCH'))).toBe(true);
  });

  it('36. offpeak insufficient budget rejects', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId, {
      pricingWindow: 'OFF_PEAK',
      maxBudgetMicroUsd: OFF_PEAK_MIN_BUDGET_MICRO_USD - 1,
    });
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    const result = verifyHumanAuthorizationPackage(pkg, authority, {
      nowUtc: new Date('2026-09-05T12:05:00.000Z'),
      sourceAttestation: DEFAULT_TEST_ATTESTATION,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('BUDGET_INSUFFICIENT'))).toBe(true);
  });

  it('37. peak insufficient budget rejects', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId, {
      pricingWindow: 'PEAK',
      targetProgram: SEALED_PEAK_PROGRAM_ID,
      candidateId: SEALED_PEAK_CANDIDATE_ID,
      maxBudgetMicroUsd: PEAK_MIN_BUDGET_MICRO_USD - 1,
    });
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    const result = verifyHumanAuthorizationPackage(pkg, authority, {
      nowUtc: new Date('2026-09-05T12:05:00.000Z'),
      sourceAttestation: DEFAULT_TEST_ATTESTATION,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('BUDGET_INSUFFICIENT'))).toBe(true);
  });

  it('38. absurd/unbounded budget rejects', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId, {
      pricingWindow: 'OFF_PEAK',
      maxBudgetMicroUsd: 1000000, // $1.00 (well above 25566 and 100000 ceilings)
    });
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    const result = verifyHumanAuthorizationPackage(pkg, authority, {
      nowUtc: new Date('2026-09-05T12:05:00.000Z'),
      sourceAttestation: DEFAULT_TEST_ATTESTATION,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('BUDGET_CEILING_EXCEEDED') || e.includes('BUDGET_HARD_CEILING_EXCEEDED'))).toBe(true);
  });

  // ==========================================================================
  // SUITE 5: Nonce Validation
  // ==========================================================================

  it('39. malformed nonce rejects', () => {
    expect(validateRunNonce('').valid).toBe(false);
    expect(validateRunNonce('short').valid).toBe(false); // < 16 chars
    expect(validateRunNonce('has spaces and bad chars!@#$%').valid).toBe(false);
    expect(validateRunNonce('a'.repeat(129)).valid).toBe(false); // > 128 chars
  });

  it('40. placeholder nonce rejects', () => {
    for (const placeholder of FORBIDDEN_PLACEHOLDER_NONCES) {
      expect(validateRunNonce(placeholder).valid).toBe(false);
      expect(validateRunNonce(`${placeholder}_1234567890123`).valid).toBe(false);
      expect(validateRunNonce(placeholder.toUpperCase()).valid).toBe(false);
    }
  });

  // ==========================================================================
  // SUITE 6: Canonicalization & Determinism
  // ==========================================================================

  it('41. canonicalization deterministic', () => {
    const { authority } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId);

    const json1 = canonicalizeHumanAuthorizationPayload(payload);
    const json2 = canonicalizeHumanAuthorizationPayload(payload);

    expect(json1).toBe(json2);
  });

  it('42. canonicalization key order cannot change signature meaning', () => {
    const { authority } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId);

    // Create object with reversed key insertion order
    const reversedPayload: any = {};
    const keys = Object.keys(payload).reverse();
    for (const k of keys) {
      reversedPayload[k] = (payload as any)[k];
    }

    const jsonOriginal = canonicalizeHumanAuthorizationPayload(payload);
    const jsonReversed = canonicalizeHumanAuthorizationPayload(reversedPayload);

    expect(jsonOriginal).toBe(jsonReversed);
  });

  it('43. unknown injected property is strictly rejected by canonicalizer and digest generator', () => {
    const { authority } = createSyntheticTestAuthority();
    const payload: any = createSyntheticValidPayload(authority.authorityId);
    payload.injectedHackerField = 'bypass_authorization';

    expect(() => canonicalizeHumanAuthorizationPayload(payload)).toThrow(
      /CANONICALIZATION_FAILURE.*unknown or unauthorized field 'injectedHackerField'/
    );

    const pkg: any = {
      payload,
      signatureBase64: 'fake',
      authorityId: authority.authorityId,
      keyVersion: authority.keyVersion,
      algorithm: authority.algorithm,
    };
    expect(() => computeAuthorizationPackageDigest(pkg)).toThrow(/CANONICALIZATION_FAILURE/);
  });

  // ==========================================================================
  // SUITE 7: Package Digest & Consumption Keys
  // ==========================================================================

  it('44. authorization package digest deterministic', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId);
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    const digest1 = computeAuthorizationPackageDigest(pkg);
    const digest2 = computeAuthorizationPackageDigest(pkg);

    expect(digest1).toBe(digest2);
    expect(/^[0-9a-f]{64}$/.test(digest1)).toBe(true);
  });

  it('45. signature change changes package digest', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId);
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    const alteredPkg = { ...pkg, signatureBase64: Buffer.from('different_signature').toString('base64') };

    const digest1 = computeAuthorizationPackageDigest(pkg);
    const digest2 = computeAuthorizationPackageDigest(alteredPkg);

    expect(digest1).not.toBe(digest2);
  });

  it('46. payload change changes package digest', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload1 = createSyntheticValidPayload(authority.authorityId, { runNonce: 'nonce_111111111111111111111' });
    const payload2 = createSyntheticValidPayload(authority.authorityId, { runNonce: 'nonce_222222222222222222222' });

    const pkg1 = signSyntheticPayload(payload1, authority, privateKeyPem);
    const pkg2 = signSyntheticPayload(payload2, authority, privateKeyPem);

    const digest1 = computeAuthorizationPackageDigest(pkg1);
    const digest2 = computeAuthorizationPackageDigest(pkg2);

    expect(digest1).not.toBe(digest2);
  });

  it('47. consumption key deterministic', () => {
    const params = {
      authorityId: 'auth_1',
      targetProgram: SEALED_OFF_PEAK_PROGRAM_ID,
      pricingWindow: 'OFF_PEAK' as const,
      sourceCommitSha: BASE_COMMIT_SHA,
      runNonce: 'a12b2c5l_nonce_7f9b23c148e26d910a5b82',
    };

    const key1 = computeAuthorizationConsumptionKey(params);
    const key2 = computeAuthorizationConsumptionKey(params);

    expect(key1).toBe(key2);
  });

  it('48. consumption key changes with nonce', () => {
    const key1 = computeAuthorizationConsumptionKey({
      authorityId: 'auth_1',
      targetProgram: SEALED_OFF_PEAK_PROGRAM_ID,
      pricingWindow: 'OFF_PEAK',
      sourceCommitSha: BASE_COMMIT_SHA,
      runNonce: 'nonce_aaaaaaaaaaaaaaaaaaaaaaaaa',
    });

    const key2 = computeAuthorizationConsumptionKey({
      authorityId: 'auth_1',
      targetProgram: SEALED_OFF_PEAK_PROGRAM_ID,
      pricingWindow: 'OFF_PEAK',
      sourceCommitSha: BASE_COMMIT_SHA,
      runNonce: 'nonce_bbbbbbbbbbbbbbbbbbbbbbbbb',
    });

    expect(key1).not.toBe(key2);
  });

  it('49. consumption key changes with window', () => {
    const key1 = computeAuthorizationConsumptionKey({
      authorityId: 'auth_1',
      targetProgram: SEALED_OFF_PEAK_PROGRAM_ID,
      pricingWindow: 'OFF_PEAK',
      sourceCommitSha: BASE_COMMIT_SHA,
      runNonce: 'nonce_aaaaaaaaaaaaaaaaaaaaaaaaa',
    });

    const key2 = computeAuthorizationConsumptionKey({
      authorityId: 'auth_1',
      targetProgram: SEALED_PEAK_PROGRAM_ID,
      pricingWindow: 'PEAK',
      sourceCommitSha: BASE_COMMIT_SHA,
      runNonce: 'nonce_aaaaaaaaaaaaaaaaaaaaaaaaa',
    });

    expect(key1).not.toBe(key2);
  });

  // ==========================================================================
  // SUITE 8: Source Attestation Self-Consistency & Invariants
  // ==========================================================================

  it('50. source attestation valid', () => {
    const attestation = buildTrustedSourceAttestation({
      sourceCommitSha: BASE_COMMIT_SHA,
      sourceTreeSha: BASE_TREE_SHA,
    });

    const result = validateTrustedSourceAttestation(attestation);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('51. bad source commit format rejects', () => {
    const attestation = buildTrustedSourceAttestation({
      sourceCommitSha: 'invalid-commit-sha',
      sourceTreeSha: BASE_TREE_SHA,
    });

    const result = validateTrustedSourceAttestation(attestation);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('INVALID_COMMIT_SHA_FORMAT'))).toBe(true);
  });

  it('52. bad source tree format rejects', () => {
    const attestation = buildTrustedSourceAttestation({
      sourceCommitSha: BASE_COMMIT_SHA,
      sourceTreeSha: 'invalid-tree-sha',
    });

    const result = validateTrustedSourceAttestation(attestation);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('INVALID_TREE_SHA_FORMAT'))).toBe(true);
  });

  it('53. wrong repository identity rejects', () => {
    const attestation = {
      ...buildTrustedSourceAttestation({ sourceCommitSha: BASE_COMMIT_SHA, sourceTreeSha: BASE_TREE_SHA }),
      repositoryIdentity: 'wrong-org/wrong-repo',
    };

    const result = validateTrustedSourceAttestation(attestation);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('REPOSITORY_IDENTITY_MISMATCH'))).toBe(true);
  });

  it('54. wrong transport module identity rejects', () => {
    const attestation = {
      ...buildTrustedSourceAttestation({ sourceCommitSha: BASE_COMMIT_SHA, sourceTreeSha: BASE_TREE_SHA }),
      transportModuleIdentity: 'worker/ai/canary/fakeTransport.ts',
    };

    const result = validateTrustedSourceAttestation(attestation);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('TRANSPORT_MODULE_MISMATCH'))).toBe(true);
  });

  it('55. wrong transport module version rejects', () => {
    const attestation = {
      ...buildTrustedSourceAttestation({ sourceCommitSha: BASE_COMMIT_SHA, sourceTreeSha: BASE_TREE_SHA }),
      transportModuleVersion: '9.9.9',
    };

    const result = validateTrustedSourceAttestation(attestation);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('MODULE_VERSION_MISMATCH'))).toBe(true);
  });

  it('56. wrong contract version rejects', () => {
    const attestation = {
      ...buildTrustedSourceAttestation({ sourceCommitSha: BASE_COMMIT_SHA, sourceTreeSha: BASE_TREE_SHA }),
      transportContractVersion: '9.9.9',
    };

    const result = validateTrustedSourceAttestation(attestation);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('CONTRACT_VERSION_MISMATCH'))).toBe(true);
  });

  it('57. wrong successor spec rejects', () => {
    const attestation = {
      ...buildTrustedSourceAttestation({ sourceCommitSha: BASE_COMMIT_SHA, sourceTreeSha: BASE_TREE_SHA }),
      successorSpecificationVersion: 'a12b2c5-v9.9',
    };

    const result = validateTrustedSourceAttestation(attestation);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('SPEC_VERSION_MISMATCH'))).toBe(true);
  });

  it('58. wrong task digest rejects', () => {
    const attestation = {
      ...buildTrustedSourceAttestation({ sourceCommitSha: BASE_COMMIT_SHA, sourceTreeSha: BASE_TREE_SHA }),
      canonicalTaskSetDigest: '0000000000000000000000000000000000000000000000000000000000000000',
    };

    const result = validateTrustedSourceAttestation(attestation);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('CANONICAL_TASK_DIGEST_MISMATCH'))).toBe(true);
  });

  it('59. wrong fixture digest rejects', () => {
    const attestation = {
      ...buildTrustedSourceAttestation({ sourceCommitSha: BASE_COMMIT_SHA, sourceTreeSha: BASE_TREE_SHA }),
      fixtureSetDigest: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    };

    const result = validateTrustedSourceAttestation(attestation);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('FIXTURE_DIGEST_MISMATCH'))).toBe(true);
  });

  it('60. wrong attestation digest rejects', () => {
    const attestation = {
      ...buildTrustedSourceAttestation({ sourceCommitSha: BASE_COMMIT_SHA, sourceTreeSha: BASE_TREE_SHA }),
      attestationDigest: 'badbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadb',
    };

    const result = validateTrustedSourceAttestation(attestation);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('ATTESTATION_DIGEST_MISMATCH'))).toBe(true);
  });

  it('61. attestation digest recomputation passes', () => {
    const attestation = buildTrustedSourceAttestation({
      sourceCommitSha: BASE_COMMIT_SHA,
      sourceTreeSha: BASE_TREE_SHA,
    });

    const recomputed = computeSourceAttestationDigest(attestation);
    expect(recomputed).toBe(attestation.attestationDigest);
  });

  it('62. source attestation cryptographically bound into authorization', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const attestation = buildTrustedSourceAttestation({
      sourceCommitSha: BASE_COMMIT_SHA,
      sourceTreeSha: BASE_TREE_SHA,
    });

    const payload = createSyntheticValidPayload(authority.authorityId, {
      sourceCommitSha: attestation.sourceCommitSha,
      sourceTreeSha: attestation.sourceTreeSha,
      sourceAttestationDigest: attestation.attestationDigest,
    });

    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    const result = verifyHumanAuthorizationPackage(pkg, authority, {
      nowUtc: new Date('2026-09-05T12:05:00.000Z'),
      sourceAttestation: attestation,
    });

    expect(result.valid).toBe(true);
  });

  // ==========================================================================
  // SUITE 9: Static Secrets & Security Scans
  // ==========================================================================

  it('63. synthetic private key never appears in production source', () => {
    const modulePath = path.resolve(__dirname, '../../worker/ai/canary/deepSeekCertificationAttestation.ts');
    const source = fs.readFileSync(modulePath, 'utf8');

    expect(source.includes('BEGIN PRIVATE KEY')).toBe(false);
    expect(source.includes('BEGIN OPENSSH PRIVATE KEY')).toBe(false);
    expect(source.includes('PRIVATE KEY-----')).toBe(false);
    expect(source.includes('sk-')).toBe(false);
    expect(source.includes('DEEPSEEK_API_KEY')).toBe(false);
    expect(source.includes('capabilitySecret')).toBe(false);
    expect(source.includes('embedded signing seed')).toBe(false);
  });

  it('64. production module exposes no signing issuer API', () => {
    const moduleExports = Object.keys(attestationModule);

    expect(moduleExports.includes('issueHumanAuthorization')).toBe(false);
    expect(moduleExports.includes('signHumanAuthorizationWithEmbeddedKey')).toBe(false);
    expect(moduleExports.includes('signHumanAuthorization')).toBe(false);
    expect(moduleExports.includes('generateProductionPrivateKey')).toBe(false);
  });

  it('65. no private PEM in artifact', () => {
    const artifactPath = path.resolve(__dirname, '../../execution/a12b2c5l_attestation_foundation.json');
    if (fs.existsSync(artifactPath)) {
      const artifactContent = fs.readFileSync(artifactPath, 'utf8');
      expect(artifactContent.includes('BEGIN PRIVATE KEY')).toBe(false);
      expect(artifactContent.includes('PRIVATE KEY-----')).toBe(false);
    }
  });

  it('66. no provider network capability in attestation module', () => {
    const modulePath = path.resolve(__dirname, '../../worker/ai/canary/deepSeekCertificationAttestation.ts');
    const source = fs.readFileSync(modulePath, 'utf8');

    expect(source.includes('fetch(')).toBe(false);
    expect(source.includes('globalThis.fetch')).toBe(false);
    expect(source.includes("require('http')")).toBe(false);
    expect(source.includes("require('https')")).toBe(false);
    expect(source.includes("import http")).toBe(false);
    expect(source.includes("import https")).toBe(false);
    expect(source.includes("import net")).toBe(false);
  });

  // ==========================================================================
  // SUITE 10: State Machine Barriers & Readiness Verification
  // ==========================================================================

  it('67. live gate remains false', () => {
    expect(CANARY_LIVE_EXECUTION_ENABLED).toBe(false);
  });

  it('68. source readiness remains false', () => {
    expect(GUARDED_SOURCE_ATTESTATION_READY).toBe(false);
  });

  it('69. human auth readiness remains false', () => {
    expect(GUARDED_HUMAN_AUTH_ATTESTATION_READY).toBe(false);
  });

  it('70. production routing remains false', () => {
    const decision = resolveRoutingPolicyDecision('GROWTH_ACTION_DRAFT');
    expect(decision.enforcementAllowed).toBe(false);
  });

  // ==========================================================================
  // SUITE 11: Additional Adversarial Boundary Checks
  // ==========================================================================

  it('71. non-integer budget is strictly rejected', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId, {
      maxBudgetMicroUsd: 12783.5,
    });
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    const result = verifyHumanAuthorizationPackage(pkg, authority, {
      nowUtc: new Date('2026-09-05T12:05:00.000Z'),
      sourceAttestation: DEFAULT_TEST_ATTESTATION,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('BUDGET_NOT_INTEGER'))).toBe(true);
  });

  it('72. zero or negative budget is strictly rejected', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId, {
      maxBudgetMicroUsd: 0,
    });
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    const result = verifyHumanAuthorizationPackage(pkg, authority, {
      nowUtc: new Date('2026-09-05T12:05:00.000Z'),
      sourceAttestation: DEFAULT_TEST_ATTESTATION,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('BUDGET_INSUFFICIENT'))).toBe(true);
  });

  it('73. null / non-object package returns fail-closed result', () => {
    const { authority } = createSyntheticTestAuthority();
    const result = verifyHumanAuthorizationPackage(null as any, authority, {
      sourceAttestation: DEFAULT_TEST_ATTESTATION,
    });
    expect(result.valid).toBe(false);
    expect(result.failureReason).toBe('PACKAGE_NULL');
  });

  it('74. null / non-object authority returns fail-closed result', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId);
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    const result = verifyHumanAuthorizationPackage(pkg, null as any, {
      sourceAttestation: DEFAULT_TEST_ATTESTATION,
    });
    expect(result.valid).toBe(false);
    expect(result.failureReason).toBe('AUTHORITY_NULL');
  });

  it('75. undefined or invalid options returns fail-closed result with SOURCE_ATTESTATION_MISSING', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId);
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    const result = verifyHumanAuthorizationPackage(pkg, authority, undefined as any);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('SOURCE_ATTESTATION_MISSING'))).toBe(true);
  });

  // ==========================================================================
  // SUITE 12: All 19 Canonical Payload Fields Alter Output Bytes
  // ==========================================================================

  it('76. each of the 19 fields independently changes canonical byte representation', () => {
    const { authority } = createSyntheticTestAuthority();
    const baseline = createSyntheticValidPayload(authority.authorityId);
    const baselineCanonical = canonicalizeHumanAuthorizationPayload(baseline);

    const fieldMutations: Array<{ field: keyof CanonicalHumanAuthorizationPayload; mutation: any }> = [
      { field: 'authorizationVersion', mutation: 'a12b2c5-auth-v1.1-future' },
      { field: 'authorityId', mutation: 'auth_alt_id_1234' },
      { field: 'issuedAt', mutation: '2026-09-05T12:01:00.000Z' },
      { field: 'expiresAt', mutation: '2026-09-05T12:14:00.000Z' },
      { field: 'targetProgram', mutation: 'PEAK_PROGRAM_ALT' },
      { field: 'pricingWindow', mutation: 'PEAK' },
      { field: 'candidateId', mutation: 'candidate-alt' },
      { field: 'sourceCommitSha', mutation: '1'.repeat(40) },
      { field: 'sourceTreeSha', mutation: '2'.repeat(40) },
      { field: 'specificationVersion', mutation: 'a12b2c5-v2.0' },
      { field: 'maxBudgetMicroUsd', mutation: 25566 },
      { field: 'runNonce', mutation: 'a'.repeat(32) },
      { field: 'singleUse', mutation: false },
      { field: 'provider', mutation: 'custom_provider' },
      { field: 'model', mutation: 'deepseek-chat-v4' },
      { field: 'canonicalTaskCount', mutation: 14 },
      { field: 'transportContractVersion', mutation: '1.4.0' },
      { field: 'guardedTransportModuleVersion', mutation: '1.1.0' },
      { field: 'sourceAttestationDigest', mutation: '3'.repeat(64) },
    ];

    expect(fieldMutations).toHaveLength(19);

    for (const { field, mutation } of fieldMutations) {
      const mutated = { ...baseline, [field]: mutation };
      const mutatedCanonical = canonicalizeHumanAuthorizationPayload(mutated as any);
      expect(mutatedCanonical).not.toBe(baselineCanonical);
      if (typeof mutation === 'number' || typeof mutation === 'boolean') {
        expect(mutatedCanonical).toContain(`"${field}":${mutation}`);
      } else {
        expect(mutatedCanonical).toContain(`"${field}":"${mutation}"`);
      }
    }
  });

  // ==========================================================================
  // SUITE 13: Package Digest Coverage for Repaired Bindings
  // ==========================================================================

  it('77. mutating singleUse changes authorizationPackageDigest', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payloadTrue = createSyntheticValidPayload(authority.authorityId, { singleUse: true });
    const payloadFalse = createSyntheticValidPayload(authority.authorityId, { singleUse: false as any });
    const pkgTrue = signSyntheticPayload(payloadTrue, authority, privateKeyPem);
    const pkgFalse = signSyntheticPayload(payloadFalse, authority, privateKeyPem);

    const digestTrue = computeAuthorizationPackageDigest(pkgTrue);
    const digestFalse = computeAuthorizationPackageDigest(pkgFalse);
    expect(digestTrue).not.toBe(digestFalse);
  });

  it('78. mutating canonicalTaskCount changes authorizationPackageDigest', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload7 = createSyntheticValidPayload(authority.authorityId, { canonicalTaskCount: 7 });
    const payload14 = createSyntheticValidPayload(authority.authorityId, { canonicalTaskCount: 14 as any });
    const pkg7 = signSyntheticPayload(payload7, authority, privateKeyPem);
    const pkg14 = signSyntheticPayload(payload14, authority, privateKeyPem);

    const digest7 = computeAuthorizationPackageDigest(pkg7);
    const digest14 = computeAuthorizationPackageDigest(pkg14);
    expect(digest7).not.toBe(digest14);
  });

  it('79. mutating authorizationVersion changes authorizationPackageDigest', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload1 = createSyntheticValidPayload(authority.authorityId, { authorizationVersion: 'a12b2c5-v1.3' });
    const payload2 = createSyntheticValidPayload(authority.authorityId, { authorizationVersion: 'a12b2c5-v1.4' });
    const pkg1 = signSyntheticPayload(payload1, authority, privateKeyPem);
    const pkg2 = signSyntheticPayload(payload2, authority, privateKeyPem);

    const digest1 = computeAuthorizationPackageDigest(pkg1);
    const digest2 = computeAuthorizationPackageDigest(pkg2);
    expect(digest1).not.toBe(digest2);
  });

  it('80. injecting unknown property into package payload throws CANONICALIZATION_FAILURE in computeAuthorizationPackageDigest', () => {
    const { authority } = createSyntheticTestAuthority();
    const payload: any = createSyntheticValidPayload(authority.authorityId);
    payload.rogueKey = 'rogueValue';
    const pkg: any = {
      payload,
      signatureBase64: 'fake-sig',
      authorityId: authority.authorityId,
      keyVersion: authority.keyVersion,
      algorithm: authority.algorithm,
    };
    expect(() => computeAuthorizationPackageDigest(pkg)).toThrow(
      /CANONICALIZATION_FAILURE.*unknown or unauthorized field 'rogueKey'/
    );
  });

  // ==========================================================================
  // SUITE 14: Signature Verification Regressions on Mutated Fields Without Resigning
  // ==========================================================================

  it('81. in-place mutation of singleUse without resigning fails signature check', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId, { singleUse: true });
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    const mutatedPkg = {
      ...pkg,
      payload: {
        ...pkg.payload,
        singleUse: false as any,
      },
    };

    const result = verifyHumanAuthorizationPackage(mutatedPkg, authority, {
      nowUtc: new Date('2026-09-05T12:05:00.000Z'),
      sourceAttestation: DEFAULT_TEST_ATTESTATION,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('SIGNATURE_VERIFICATION_FAILED'))).toBe(true);
  });

  it('82. in-place mutation of canonicalTaskCount without resigning fails signature check', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId, { canonicalTaskCount: 7 });
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    const mutatedPkg = {
      ...pkg,
      payload: {
        ...pkg.payload,
        canonicalTaskCount: 14 as any,
      },
    };

    const result = verifyHumanAuthorizationPackage(mutatedPkg, authority, {
      nowUtc: new Date('2026-09-05T12:05:00.000Z'),
      sourceAttestation: DEFAULT_TEST_ATTESTATION,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('SIGNATURE_VERIFICATION_FAILED'))).toBe(true);
  });

  it('83. in-place mutation of authorizationVersion without resigning fails signature check', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId, { authorizationVersion: 'a12b2c5-v1.3' });
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    const mutatedPkg = {
      ...pkg,
      payload: {
        ...pkg.payload,
        authorizationVersion: 'a12b2c5-v1.4',
      },
    };

    const result = verifyHumanAuthorizationPackage(mutatedPkg, authority, {
      nowUtc: new Date('2026-09-05T12:05:00.000Z'),
      sourceAttestation: DEFAULT_TEST_ATTESTATION,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('SIGNATURE_VERIFICATION_FAILED'))).toBe(true);
  });

  // ==========================================================================
  // SUITE 15: Mandatory Source Attestation Regressions (Cases A through H)
  // ==========================================================================

  it('84. Case A: omitted options parameter returns SOURCE_ATTESTATION_MISSING', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId);
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    const result = (verifyHumanAuthorizationPackage as any)(pkg, authority);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('SOURCE_ATTESTATION_MISSING'))).toBe(true);
  });

  it('85. Case B: options without sourceAttestation returns SOURCE_ATTESTATION_MISSING', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId);
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    const result = verifyHumanAuthorizationPackage(pkg, authority, {
      nowUtc: new Date('2026-09-05T12:05:00.000Z'),
    } as any);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('SOURCE_ATTESTATION_MISSING'))).toBe(true);
  });

  it('86. Case C: non-object sourceAttestation returns SOURCE_ATTESTATION_INVALID', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId);
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    const result = verifyHumanAuthorizationPackage(pkg, authority, {
      nowUtc: new Date('2026-09-05T12:05:00.000Z'),
      sourceAttestation: 'not_an_object' as any,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('SOURCE_ATTESTATION_INVALID'))).toBe(true);
  });

  it('87. Case D: tampered sourceAttestation digest returns ATTESTATION_DIGEST_INVALID', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId);
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    const tamperedAttestation: TrustedSourceAttestation = {
      ...DEFAULT_TEST_ATTESTATION,
      attestationDigest: '0'.repeat(64),
    };

    const result = verifyHumanAuthorizationPackage(pkg, authority, {
      nowUtc: new Date('2026-09-05T12:05:00.000Z'),
      sourceAttestation: tamperedAttestation,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('ATTESTATION_DIGEST_MISMATCH') || e.includes('SOURCE_ATTESTATION_INVALID'))).toBe(true);
  });

  it('88. Case E: mismatched sourceCommitSha returns SOURCE_COMMIT_MISMATCH', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId);
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    const altAttestation = buildTrustedSourceAttestation({
      sourceCommitSha: '0'.repeat(40),
      sourceTreeSha: BASE_TREE_SHA,
      createdAt: '2026-09-05T12:00:00.000Z',
    });

    const result = verifyHumanAuthorizationPackage(pkg, authority, {
      nowUtc: new Date('2026-09-05T12:05:00.000Z'),
      sourceAttestation: altAttestation,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('SOURCE_COMMIT_MISMATCH'))).toBe(true);
  });

  it('89. Case F: mismatched sourceTreeSha returns SOURCE_TREE_MISMATCH', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId);
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    const altAttestation = buildTrustedSourceAttestation({
      sourceCommitSha: BASE_COMMIT_SHA,
      sourceTreeSha: '0'.repeat(40),
      createdAt: '2026-09-05T12:00:00.000Z',
    });

    const result = verifyHumanAuthorizationPackage(pkg, authority, {
      nowUtc: new Date('2026-09-05T12:05:00.000Z'),
      sourceAttestation: altAttestation,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('SOURCE_TREE_MISMATCH'))).toBe(true);
  });

  it('90. Case G: mismatched attestationDigest returns ATTESTATION_DIGEST_BINDING_MISMATCH', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId, {
      sourceAttestationDigest: 'e'.repeat(64),
    });
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    const result = verifyHumanAuthorizationPackage(pkg, authority, {
      nowUtc: new Date('2026-09-05T12:05:00.000Z'),
      sourceAttestation: DEFAULT_TEST_ATTESTATION,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('ATTESTATION_DIGEST_BINDING_MISMATCH'))).toBe(true);
  });

  it('91. Case H: mismatched attestationVersion returns ATTESTATION_VERSION_MISMATCH', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId);
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    const badVersionAttestation: any = {
      ...DEFAULT_TEST_ATTESTATION,
      attestationVersion: '2.0.0-future',
    };
    // Recompute valid digest for the tampered structure so it passes digest check but fails version check
    badVersionAttestation.attestationDigest = computeSourceAttestationDigest(badVersionAttestation);

    const result = verifyHumanAuthorizationPackage(pkg, authority, {
      nowUtc: new Date('2026-09-05T12:05:00.000Z'),
      sourceAttestation: badVersionAttestation,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('ATTESTATION_VERSION_MISMATCH'))).toBe(true);
  });

  // ==========================================================================
  // SUITE 16: Version Binding Regressions
  // ==========================================================================

  it('92. authorizationVersion mismatch fails verification with AUTHORIZATION_VERSION_MISMATCH', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payload = createSyntheticValidPayload(authority.authorityId, {
      authorizationVersion: 'a12b2c5-v1.2-obsolete',
    });
    const pkg = signSyntheticPayload(payload, authority, privateKeyPem);

    const result = verifyHumanAuthorizationPackage(pkg, authority, {
      nowUtc: new Date('2026-09-05T12:05:00.000Z'),
      sourceAttestation: DEFAULT_TEST_ATTESTATION,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('AUTHORIZATION_VERSION_MISMATCH'))).toBe(true);
  });

  it('93. attestationVersion mismatch in source attestation fails validateTrustedSourceAttestation', () => {
    const badAttestation: any = {
      ...DEFAULT_TEST_ATTESTATION,
      attestationVersion: 'invalid-ver',
    };
    const validation = validateTrustedSourceAttestation(badAttestation);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some(e => e.includes('ATTESTATION_VERSION_MISMATCH'))).toBe(true);
  });

  // ==========================================================================
  // SUITE 17: Strict Type Validation Regressions (No Lossy Coercion)
  // ==========================================================================

  it('94. string number for maxBudgetMicroUsd throws CANONICALIZATION_FAILURE', () => {
    const { authority } = createSyntheticTestAuthority();
    const payload: any = createSyntheticValidPayload(authority.authorityId, {
      maxBudgetMicroUsd: '12783' as any,
    });
    expect(() => canonicalizeHumanAuthorizationPayload(payload)).toThrow(
      /CANONICALIZATION_FAILURE.*maxBudgetMicroUsd/
    );
  });

  it('95. string number for canonicalTaskCount throws CANONICALIZATION_FAILURE', () => {
    const { authority } = createSyntheticTestAuthority();
    const payload: any = createSyntheticValidPayload(authority.authorityId, {
      canonicalTaskCount: '7' as any,
    });
    expect(() => canonicalizeHumanAuthorizationPayload(payload)).toThrow(
      /CANONICALIZATION_FAILURE.*canonicalTaskCount/
    );
  });

  it('96. NaN or Infinity for numeric fields throws CANONICALIZATION_FAILURE', () => {
    const { authority } = createSyntheticTestAuthority();
    const payloadNaN: any = createSyntheticValidPayload(authority.authorityId, {
      maxBudgetMicroUsd: NaN,
    });
    expect(() => canonicalizeHumanAuthorizationPayload(payloadNaN)).toThrow(/CANONICALIZATION_FAILURE/);

    const payloadInf: any = createSyntheticValidPayload(authority.authorityId, {
      canonicalTaskCount: Infinity,
    });
    expect(() => canonicalizeHumanAuthorizationPayload(payloadInf)).toThrow(/CANONICALIZATION_FAILURE/);
  });

  it('97. number or string for singleUse throws CANONICALIZATION_FAILURE', () => {
    const { authority } = createSyntheticTestAuthority();
    const payloadNum: any = createSyntheticValidPayload(authority.authorityId, {
      singleUse: 1 as any,
    });
    expect(() => canonicalizeHumanAuthorizationPayload(payloadNum)).toThrow(
      /CANONICALIZATION_FAILURE.*singleUse/
    );

    const payloadStr: any = createSyntheticValidPayload(authority.authorityId, {
      singleUse: 'true' as any,
    });
    expect(() => canonicalizeHumanAuthorizationPayload(payloadStr)).toThrow(
      /CANONICALIZATION_FAILURE.*singleUse/
    );
  });

  it('98. numeric timestamp throws CANONICALIZATION_FAILURE and non-UTC timezone timestamp is rejected by verifier', () => {
    const { authority, privateKeyPem } = createSyntheticTestAuthority();
    const payloadNumDate: any = createSyntheticValidPayload(authority.authorityId, {
      issuedAt: 1725537600000 as any,
    });
    expect(() => canonicalizeHumanAuthorizationPayload(payloadNumDate)).toThrow(
      /CANONICALIZATION_FAILURE.*issuedAt/
    );

    const payloadNonUtc = createSyntheticValidPayload(authority.authorityId, {
      expiresAt: '2026-09-05T12:00:00+02:00',
    });
    const pkg = signSyntheticPayload(payloadNonUtc, authority, privateKeyPem);
    const result = verifyHumanAuthorizationPackage(pkg, authority, {
      nowUtc: new Date('2026-09-05T12:05:00.000Z'),
      sourceAttestation: DEFAULT_TEST_ATTESTATION,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('INVALID_EXPIRES_AT'))).toBe(true);
  });

  it('99. isValidIsoUtcTimestamp helper validates strictly conforming ISO-8601 UTC strings', () => {
    expect(isValidIsoUtcTimestamp('2026-09-05T12:00:00.000Z')).toBe(true);
    expect(isValidIsoUtcTimestamp('2026-09-05T12:00:00Z')).toBe(true);
    expect(isValidIsoUtcTimestamp('2026-09-05T12:00:00+00:00')).toBe(false);
    expect(isValidIsoUtcTimestamp('2026-09-05T12:00:00-07:00')).toBe(false);
    expect(isValidIsoUtcTimestamp('2026-09-05 12:00:00')).toBe(false);
    expect(isValidIsoUtcTimestamp('invalid')).toBe(false);
    expect(isValidIsoUtcTimestamp('' as any)).toBe(false);
    expect(isValidIsoUtcTimestamp(123456789 as any)).toBe(false);
    expect(isValidIsoUtcTimestamp(null as any)).toBe(false);
    expect(isValidIsoUtcTimestamp(undefined as any)).toBe(false);
  });

  it('100. total provider network calls during entire test suite execution is exactly 0', () => {
    expect(globalFetchCalls).toBe(0);
  });
});
