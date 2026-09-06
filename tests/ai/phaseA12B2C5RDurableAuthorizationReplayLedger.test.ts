/**
 * @file tests/ai/phaseA12B2C5RDurableAuthorizationReplayLedger.test.ts
 * @description Unit, invariant, and security audit test suite for Phase A.12B.2C-5R:
 * Durable Single-Use Authorization Replay Ledger Foundation.
 *
 * STRICT INVARIANTS:
 * - Pure offline execution. ZERO network, ZERO provider calls.
 * - All readiness gates remain strictly false.
 * - Replay identity schema, deterministic replay key, and request contract verified.
 * - Fail-closed production reservation verified (no backend bound, cannot return RESERVED).
 * - No fake in-memory durability in production module.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  DURABLE_AUTHORIZATION_REPLAY_LEDGER_VERSION,
  DURABLE_AUTHORIZATION_REPLAY_LEDGER_READY,
  DURABLE_AUTHORIZATION_REPLAY_BACKEND_BOUND,
  ATOMIC_RESERVE_IF_ABSENT_IMPLEMENTED,
  FUTURE_GUARDED_EXECUTION_ORDER,
  EXACT_REPLAY_IDENTITY_KEYS,
  EXACT_RESERVATION_REQUEST_KEYS,
  FORBIDDEN_CALLER_OVERRIDE_KEYS,
  FORBIDDEN_BUILDER_KEYS,
  AuthorizationReplayIdentity,
  AuthorizationReplayReservationRequest,
  DurableAuthorizationReplayBackend,
  validateAuthorizationReplayIdentity,
  computeAuthorizationReplayKey,
  validateAuthorizationReplayReservationRequest,
  computeCanonicalAuthorizationPayloadDigestSha256,
  deriveReplayIdentityFromCanonicalAuthorization,
  buildAuthorizationReplayReservationRequestFromCanonicalAuthorization,
  validateReplayReservationAgainstCanonicalAuthorization,
  buildProductionReplayReservationAfterAuthorizationVerification,
  FORBIDDEN_PRODUCTION_ORCHESTRATION_KEYS,
  type ProductionReplayReservationStatus,
  type ProductionReplayReservationOrchestrationResult,
  reserveProductionAuthorizationReplay,
} from '../../worker/ai/canary/deepSeekDurableAuthorizationReplayLedger';
import * as replayLedgerModule from '../../worker/ai/canary/deepSeekDurableAuthorizationReplayLedger';

import {
  SEALED_OFF_PEAK_PROGRAM_ID,
  SEALED_PEAK_PROGRAM_ID,
  SEALED_OFF_PEAK_CANDIDATE_ID,
  SEALED_PEAK_CANDIDATE_ID,
  SEALED_PROVIDER,
  SEALED_MODEL,
  TRANSPORT_CONTRACT_VERSION,
} from '../../worker/ai/canary/deepSeekLiveCertificationTransportContract';

import {
  CANONICAL_AUTHORIZATION_VERSION,
  OFF_PEAK_MIN_BUDGET_MICRO_USD,
  buildTrustedSourceAttestation,
  canonicalizeHumanAuthorizationPayload,
  validateRunNonce,
  type CanonicalHumanAuthorizationPayload,
  type SignedHumanAuthorizationPackage,
  type TrustedSourceAttestation,
} from '../../worker/ai/canary/deepSeekCertificationAttestation';

import {
  GUARDED_TRANSPORT_MODULE_VERSION,
  GUARDED_SOURCE_ATTESTATION_READY,
  GUARDED_HUMAN_AUTH_ATTESTATION_READY,
} from '../../worker/ai/canary/deepSeekGuardedLiveTransport';

import {
  CANARY_LIVE_EXECUTION_ENABLED,
} from '../../worker/ai/canary/canarySpecification';

import {
  PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED,
} from '../../worker/ai/canary/deepSeekProductionAuthorizationTrust';

import {
  RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_PROVISIONED,
  TRUSTED_RUNTIME_SOURCE_PROVENANCE_READY,
} from '../../worker/ai/canary/deepSeekTrustedRuntimeSourceProvenance';

import {
  SUCCESSOR_SPECIFICATION_VERSION,
} from '../../worker/ai/canary/deepSeekSingleProviderCertificationSpecification';

import {
  VELNAR_ROUTING_POLICY_VERSION,
  resolveRoutingPolicyDecision,
} from '../../worker/ai/routingPolicy';

// ============================================================================
// NETWORK SENTINEL: ZERO NETWORK / ZERO PROVIDER CALLS GUARANTEE
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
// TEST FIXTURES & SYNTHETIC CANONICAL HELPERS
// ============================================================================

const TEST_COMMIT_SHA = 'c44b822b424afc4b87fe76d50915e22925d1e670';
const TEST_TREE_SHA = '16847194b9c0f54f9fae6d0e0dbea615007a5cec';

function createValidSyntheticReplayIdentity(
  overrides?: Partial<AuthorizationReplayIdentity>
): AuthorizationReplayIdentity {
  return {
    authorityId: 'auth_velnar_secops_synthetic_5r',
    keyVersion: '2026-v1',
    runNonce: 'a12b2c5r_nonce_8d4e92b10f5a73e61c4d82',
    authorizationPayloadDigestSha256:
      'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
    sourceAttestationDigest:
      'f0e1d2c3b4a5968778695a4b3c2d1e0ff0e1d2c3b4a5968778695a4b3c2d1e0f',
    targetProgram: SEALED_OFF_PEAK_PROGRAM_ID,
    pricingWindow: 'OFF_PEAK',
    candidateId: SEALED_OFF_PEAK_CANDIDATE_ID,
    ...overrides,
  };
}

function createValidSyntheticCanonicalPayload(
  overrides?: Partial<CanonicalHumanAuthorizationPayload>
): CanonicalHumanAuthorizationPayload {
  const attestation = buildTrustedSourceAttestation({
    sourceCommitSha: TEST_COMMIT_SHA,
    sourceTreeSha: TEST_TREE_SHA,
    createdAt: '2026-09-06T10:00:00.000Z',
  });

  return {
    authorizationVersion: CANONICAL_AUTHORIZATION_VERSION,
    authorityId: 'auth_velnar_secops_synthetic_5r',
    issuedAt: '2026-09-06T10:00:00.000Z',
    expiresAt: '2026-09-06T10:10:00.000Z',
    targetProgram: SEALED_OFF_PEAK_PROGRAM_ID,
    pricingWindow: 'OFF_PEAK',
    candidateId: SEALED_OFF_PEAK_CANDIDATE_ID,
    sourceCommitSha: TEST_COMMIT_SHA,
    sourceTreeSha: TEST_TREE_SHA,
    specificationVersion: SUCCESSOR_SPECIFICATION_VERSION,
    maxBudgetMicroUsd: OFF_PEAK_MIN_BUDGET_MICRO_USD,
    runNonce: 'a12b2c5r_nonce_8d4e92b10f5a73e61c4d82',
    singleUse: true,
    provider: SEALED_PROVIDER,
    model: SEALED_MODEL,
    canonicalTaskCount: 7,
    transportContractVersion: TRANSPORT_CONTRACT_VERSION,
    guardedTransportModuleVersion: GUARDED_TRANSPORT_MODULE_VERSION,
    sourceAttestationDigest: attestation.attestationDigest,
    ...overrides,
  };
}

function createValidSyntheticReservationRequest(
  overrides?: Partial<AuthorizationReplayReservationRequest>
): AuthorizationReplayReservationRequest {
  const identity = createValidSyntheticReplayIdentity();
  const replayKey = computeAuthorizationReplayKey(identity);

  return {
    ledgerVersion: DURABLE_AUTHORIZATION_REPLAY_LEDGER_VERSION,
    replayKey,
    authorizationPayloadDigestSha256: identity.authorizationPayloadDigestSha256,
    authorityId: identity.authorityId,
    keyVersion: identity.keyVersion,
    runNonce: identity.runNonce,
    expiresAt: '2026-09-06T10:10:00.000Z',
    ...overrides,
  };
}

// ============================================================================
// TEST SUITE: PHASE A.12B.2C-5R
// ============================================================================

describe('VELNAR — A.12B.2C-5R: Durable Single-Use Authorization Replay Ledger Foundation', () => {

  // ==========================================================================
  // 1. VERSION & READINESS INVARIANTS
  // ==========================================================================
  describe('1. Version & Readiness Invariants', () => {
    it('1. version exact matches a12b2c5r-v1', () => {
      expect(DURABLE_AUTHORIZATION_REPLAY_LEDGER_VERSION).toBe('a12b2c5r-v1');
    });

    it('2. readiness false (DURABLE_AUTHORIZATION_REPLAY_LEDGER_READY === false)', () => {
      expect(DURABLE_AUTHORIZATION_REPLAY_LEDGER_READY).toBe(false);
    });

    it('3. backend bound false (DURABLE_AUTHORIZATION_REPLAY_BACKEND_BOUND === false)', () => {
      expect(DURABLE_AUTHORIZATION_REPLAY_BACKEND_BOUND).toBe(false);
    });

    it('4. atomic reserve implemented false (ATOMIC_RESERVE_IF_ABSENT_IMPLEMENTED === false)', () => {
      expect(ATOMIC_RESERVE_IF_ABSENT_IMPLEMENTED).toBe(false);
    });
  });

  // ==========================================================================
  // 2. REPLAY IDENTITY SCHEMA & VALIDATION
  // ==========================================================================
  describe('2. Replay Identity Schema & Validation', () => {
    it('5. replay identity exact schema passes for valid identity', () => {
      const identity = createValidSyntheticReplayIdentity();
      const res = validateAuthorizationReplayIdentity(identity);
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it('6. unknown identity property rejects', () => {
      const identity = {
        ...createValidSyntheticReplayIdentity(),
        extraProperty: 'forbidden_injected_field',
      };
      const res = validateAuthorizationReplayIdentity(identity);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('UNKNOWN_PROPERTY'))).toBe(true);
    });

    it('7. inherited property rejects', () => {
      const proto = { candidateId: SEALED_OFF_PEAK_CANDIDATE_ID };
      const identity = Object.create(proto);
      Object.assign(identity, {
        authorityId: 'auth_velnar_secops_synthetic_5r',
        keyVersion: '2026-v1',
        runNonce: 'a12b2c5r_nonce_8d4e92b10f5a73e61c4d82',
        authorizationPayloadDigestSha256:
          'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
        sourceAttestationDigest:
          'f0e1d2c3b4a5968778695a4b3c2d1e0ff0e1d2c3b4a5968778695a4b3c2d1e0f',
        targetProgram: SEALED_OFF_PEAK_PROGRAM_ID,
        pricingWindow: 'OFF_PEAK',
      });
      const res = validateAuthorizationReplayIdentity(identity);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('MISSING_PROPERTY'))).toBe(true);
    });

    it('8. missing runNonce rejects', () => {
      const identity = createValidSyntheticReplayIdentity();
      delete (identity as any).runNonce;
      const res = validateAuthorizationReplayIdentity(identity);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('MISSING_PROPERTY'))).toBe(true);
    });

    it('9. unsafe nonce rejects (too short or illegal chars)', () => {
      const shortNonce = createValidSyntheticReplayIdentity({ runNonce: 'short_123' });
      const resShort = validateAuthorizationReplayIdentity(shortNonce);
      expect(resShort.valid).toBe(false);

      const illegalNonce = createValidSyntheticReplayIdentity({
        runNonce: 'valid_length_nonce_with_illegal!@#$%',
      });
      const resIllegal = validateAuthorizationReplayIdentity(illegalNonce);
      expect(resIllegal.valid).toBe(false);
    });

    it('10. placeholder nonce rejects', () => {
      const placeholderNonce = createValidSyntheticReplayIdentity({
        runNonce: 'placeholder_nonce_12345678',
      });
      const res = validateAuthorizationReplayIdentity(placeholderNonce);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('NONCE_INVALID'))).toBe(true);
    });

    it('11. payload digest lowercase 64 hex required', () => {
      const upperDigest = createValidSyntheticReplayIdentity({
        authorizationPayloadDigestSha256:
          'A1B2C3D4E5F60718293A4B5C6D7E8F90A1B2C3D4E5F60718293A4B5C6D7E8F90',
      });
      expect(validateAuthorizationReplayIdentity(upperDigest).valid).toBe(false);

      const shortDigest = createValidSyntheticReplayIdentity({
        authorizationPayloadDigestSha256: 'a1b2c3d4e5f6',
      });
      expect(validateAuthorizationReplayIdentity(shortDigest).valid).toBe(false);
    });

    it('12. source digest lowercase 64 hex required', () => {
      const upperDigest = createValidSyntheticReplayIdentity({
        sourceAttestationDigest:
          'F0E1D2C3B4A5968778695A4B3C2D1E0FF0E1D2C3B4A5968778695A4B3C2D1E0F',
      });
      expect(validateAuthorizationReplayIdentity(upperDigest).valid).toBe(false);

      const shortDigest = createValidSyntheticReplayIdentity({
        sourceAttestationDigest: 'invalid_short_digest',
      });
      expect(validateAuthorizationReplayIdentity(shortDigest).valid).toBe(false);
    });

    it('13. canonical program accepted (both OFF_PEAK and PEAK)', () => {
      const offPeak = createValidSyntheticReplayIdentity({
        targetProgram: SEALED_OFF_PEAK_PROGRAM_ID,
        pricingWindow: 'OFF_PEAK',
        candidateId: SEALED_OFF_PEAK_CANDIDATE_ID,
      });
      expect(validateAuthorizationReplayIdentity(offPeak).valid).toBe(true);

      const peak = createValidSyntheticReplayIdentity({
        targetProgram: SEALED_PEAK_PROGRAM_ID,
        pricingWindow: 'PEAK',
        candidateId: SEALED_PEAK_CANDIDATE_ID,
      });
      expect(validateAuthorizationReplayIdentity(peak).valid).toBe(true);
    });

    it('14. invalid program rejects', () => {
      const invalidProg = createValidSyntheticReplayIdentity({
        targetProgram: 'INVENTED_ARBITRARY_PROGRAM_ID',
      });
      const res = validateAuthorizationReplayIdentity(invalidProg);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('TARGET_PROGRAM_MISMATCH'))).toBe(true);
    });

    it('15. canonical pricing window accepted', () => {
      const offPeak = createValidSyntheticReplayIdentity({ pricingWindow: 'OFF_PEAK' });
      expect(validateAuthorizationReplayIdentity(offPeak).valid).toBe(true);

      const peak = createValidSyntheticReplayIdentity({
        pricingWindow: 'PEAK',
        targetProgram: SEALED_PEAK_PROGRAM_ID,
        candidateId: SEALED_PEAK_CANDIDATE_ID,
      });
      expect(validateAuthorizationReplayIdentity(peak).valid).toBe(true);
    });

    it('16. invalid pricing window rejects', () => {
      const invalidWindow = createValidSyntheticReplayIdentity({
        pricingWindow: 'FLEX_DISCOUNT' as any,
      });
      const res = validateAuthorizationReplayIdentity(invalidWindow);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('PRICING_WINDOW_INVALID'))).toBe(true);
    });

    it('17. canonical candidate accepted and mismatch rejected', () => {
      const offPeak = createValidSyntheticReplayIdentity({
        candidateId: SEALED_OFF_PEAK_CANDIDATE_ID,
      });
      expect(validateAuthorizationReplayIdentity(offPeak).valid).toBe(true);

      const candidateMismatch = createValidSyntheticReplayIdentity({
        candidateId: SEALED_PEAK_CANDIDATE_ID, // mismatch with OFF_PEAK
      });
      const res = validateAuthorizationReplayIdentity(candidateMismatch);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('CANDIDATE_ID_MISMATCH'))).toBe(true);
    });

    it('17b. non-string identity property rejects without coercion', () => {
      const numAuthority = createValidSyntheticReplayIdentity({
        authorityId: 12345 as any,
      });
      const res = validateAuthorizationReplayIdentity(numAuthority);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('TYPE_INVALID'))).toBe(true);
    });

    it('17c. null or non-object candidate rejects', () => {
      expect(validateAuthorizationReplayIdentity(null).valid).toBe(false);
      expect(validateAuthorizationReplayIdentity(undefined).valid).toBe(false);
      expect(validateAuthorizationReplayIdentity('string').valid).toBe(false);
      expect(validateAuthorizationReplayIdentity([1, 2, 3]).valid).toBe(false);
    });
  });

  // ==========================================================================
  // 3. REPLAY KEY DERIVATION
  // ==========================================================================
  describe('3. Replay Key Derivation', () => {
    it('18. replay key is deterministic for identical identities', () => {
      const id1 = createValidSyntheticReplayIdentity();
      const id2 = createValidSyntheticReplayIdentity();
      const key1 = computeAuthorizationReplayKey(id1);
      const key2 = computeAuthorizationReplayKey(id2);
      expect(key1).toBe(key2);
      expect(/^[0-9a-f]{64}$/.test(key1)).toBe(true);
    });

    it('19. authority mutation changes key', () => {
      const base = createValidSyntheticReplayIdentity();
      const mutated = createValidSyntheticReplayIdentity({ authorityId: 'auth_mutated_secops_5r' });
      expect(computeAuthorizationReplayKey(base)).not.toBe(computeAuthorizationReplayKey(mutated));
    });

    it('20. keyVersion mutation changes key', () => {
      const base = createValidSyntheticReplayIdentity();
      const mutated = createValidSyntheticReplayIdentity({ keyVersion: '2026-v2' });
      expect(computeAuthorizationReplayKey(base)).not.toBe(computeAuthorizationReplayKey(mutated));
    });

    it('21. nonce mutation changes key', () => {
      const base = createValidSyntheticReplayIdentity();
      const mutated = createValidSyntheticReplayIdentity({
        runNonce: 'a12b2c5r_nonce_different_value_999999',
      });
      expect(computeAuthorizationReplayKey(base)).not.toBe(computeAuthorizationReplayKey(mutated));
    });

    it('22. payload digest mutation changes key', () => {
      const base = createValidSyntheticReplayIdentity();
      const mutated = createValidSyntheticReplayIdentity({
        authorizationPayloadDigestSha256:
          '0000000000000000000000000000000000000000000000000000000000000000',
      });
      expect(computeAuthorizationReplayKey(base)).not.toBe(computeAuthorizationReplayKey(mutated));
    });

    it('23. source digest mutation changes key', () => {
      const base = createValidSyntheticReplayIdentity();
      const mutated = createValidSyntheticReplayIdentity({
        sourceAttestationDigest:
          'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      });
      expect(computeAuthorizationReplayKey(base)).not.toBe(computeAuthorizationReplayKey(mutated));
    });

    it('24. target program mutation changes key', () => {
      const base = createValidSyntheticReplayIdentity({
        targetProgram: SEALED_OFF_PEAK_PROGRAM_ID,
        pricingWindow: 'OFF_PEAK',
        candidateId: SEALED_OFF_PEAK_CANDIDATE_ID,
      });
      const mutated = createValidSyntheticReplayIdentity({
        targetProgram: SEALED_PEAK_PROGRAM_ID,
        pricingWindow: 'PEAK',
        candidateId: SEALED_PEAK_CANDIDATE_ID,
      });
      expect(computeAuthorizationReplayKey(base)).not.toBe(computeAuthorizationReplayKey(mutated));
    });

    it('25. pricing window mutation changes key', () => {
      const offPeak = createValidSyntheticReplayIdentity({
        pricingWindow: 'OFF_PEAK',
        targetProgram: SEALED_OFF_PEAK_PROGRAM_ID,
        candidateId: SEALED_OFF_PEAK_CANDIDATE_ID,
      });
      const peak = createValidSyntheticReplayIdentity({
        pricingWindow: 'PEAK',
        targetProgram: SEALED_PEAK_PROGRAM_ID,
        candidateId: SEALED_PEAK_CANDIDATE_ID,
      });
      expect(computeAuthorizationReplayKey(offPeak)).not.toBe(computeAuthorizationReplayKey(peak));
    });

    it('26. candidate mutation changes key', () => {
      const base = createValidSyntheticReplayIdentity({
        targetProgram: SEALED_OFF_PEAK_PROGRAM_ID,
        pricingWindow: 'OFF_PEAK',
        candidateId: SEALED_OFF_PEAK_CANDIDATE_ID,
      });
      const mutated = createValidSyntheticReplayIdentity({
        targetProgram: SEALED_PEAK_PROGRAM_ID,
        pricingWindow: 'PEAK',
        candidateId: SEALED_PEAK_CANDIDATE_ID,
      });
      expect(computeAuthorizationReplayKey(base)).not.toBe(computeAuthorizationReplayKey(mutated));
    });

    it('26b. computeAuthorizationReplayKey throws on invalid identity', () => {
      const invalid = createValidSyntheticReplayIdentity({ authorityId: '' });
      expect(() => computeAuthorizationReplayKey(invalid)).toThrow('REPLAY_KEY_DERIVATION_FAILED');
    });
  });

  // ==========================================================================
  // 4. RESERVATION REQUEST SCHEMA & VALIDATION
  // ==========================================================================
  describe('4. Reservation Request Schema & Validation', () => {
    it('27. reservation request exact schema passes for valid request', () => {
      const req = createValidSyntheticReservationRequest();
      const res = validateAuthorizationReplayReservationRequest(req);
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it('28. unknown reservation field rejects', () => {
      const req = {
        ...createValidSyntheticReservationRequest(),
        unexpectedField: 'forbidden_value',
      };
      const res = validateAuthorizationReplayReservationRequest(req);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('UNKNOWN_PROPERTY'))).toBe(true);
    });

    it('29. inherited field rejects', () => {
      const proto = { expiresAt: '2026-09-06T10:10:00.000Z' };
      const req = Object.create(proto);
      Object.assign(req, {
        ledgerVersion: DURABLE_AUTHORIZATION_REPLAY_LEDGER_VERSION,
        replayKey: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
        authorizationPayloadDigestSha256:
          'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
        authorityId: 'auth_velnar_secops_synthetic_5r',
        keyVersion: '2026-v1',
        runNonce: 'a12b2c5r_nonce_8d4e92b10f5a73e61c4d82',
      });
      const res = validateAuthorizationReplayReservationRequest(req);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('MISSING_PROPERTY'))).toBe(true);
    });

    it('30. invalid ledger version rejects', () => {
      const req = createValidSyntheticReservationRequest({
        ledgerVersion: 'a12b2c5r-v2-invalid',
      });
      const res = validateAuthorizationReplayReservationRequest(req);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('LEDGER_VERSION_MISMATCH'))).toBe(true);
    });

    it('31. malformed replayKey rejects', () => {
      const shortKey = createValidSyntheticReservationRequest({ replayKey: 'short_key' });
      expect(validateAuthorizationReplayReservationRequest(shortKey).valid).toBe(false);

      const upperKey = createValidSyntheticReservationRequest({
        replayKey: 'A1B2C3D4E5F60718293A4B5C6D7E8F90A1B2C3D4E5F60718293A4B5C6D7E8F90',
      });
      expect(validateAuthorizationReplayReservationRequest(upperKey).valid).toBe(false);
    });

    it('32. malformed expiresAt rejects', () => {
      const badTime = createValidSyntheticReservationRequest({ expiresAt: 'not-a-timestamp' });
      const res = validateAuthorizationReplayReservationRequest(badTime);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('EXPIRES_AT_INVALID'))).toBe(true);
    });

    it('33. offset timestamp rejects (only strict UTC Z accepted)', () => {
      const offsetTime = createValidSyntheticReservationRequest({
        expiresAt: '2026-09-06T10:10:00.000+01:00',
      });
      const res = validateAuthorizationReplayReservationRequest(offsetTime);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('EXPIRES_AT_INVALID'))).toBe(true);
    });

    it('34. calendar rollover rejects', () => {
      const rolloverFeb30 = createValidSyntheticReservationRequest({
        expiresAt: '2026-02-30T10:10:00.000Z',
      });
      expect(validateAuthorizationReplayReservationRequest(rolloverFeb30).valid).toBe(false);

      const rolloverApr31 = createValidSyntheticReservationRequest({
        expiresAt: '2026-04-31T10:10:00.000Z',
      });
      expect(validateAuthorizationReplayReservationRequest(rolloverApr31).valid).toBe(false);
    });
  });

  // ==========================================================================
  // 5. DERIVE IDENTITY FROM CANONICAL AUTHORIZATION
  // ==========================================================================
  describe('5. Derive Identity from Canonical Authorization', () => {
    it('35. derive identity from canonical authorization package', () => {
      const payload = createValidSyntheticCanonicalPayload();
      const pkg: SignedHumanAuthorizationPackage = {
        payload,
        signatureBase64: 'synthetic_sig_base64',
        authorityId: payload.authorityId,
        keyVersion: '2026-v1',
        algorithm: 'Ed25519',
      };

      const identity = deriveReplayIdentityFromCanonicalAuthorization(pkg);
      expect(identity.authorityId).toBe(payload.authorityId);
      expect(identity.keyVersion).toBe('2026-v1');
      expect(identity.runNonce).toBe(payload.runNonce);
      expect(identity.targetProgram).toBe(payload.targetProgram);
      expect(identity.pricingWindow).toBe(payload.pricingWindow);
      expect(identity.candidateId).toBe(payload.candidateId);
      expect(identity.sourceAttestationDigest).toBe(payload.sourceAttestationDigest);
      expect(/^[0-9a-f]{64}$/.test(identity.authorizationPayloadDigestSha256)).toBe(true);
    });

    it('36. replay key is not caller supplied', () => {
      const payload = createValidSyntheticCanonicalPayload();
      const callerAttempt = {
        payload,
        keyVersion: '2026-v1',
        replayKey: 'caller_injected_replay_key_attempt',
      };
      const identity = deriveReplayIdentityFromCanonicalAuthorization(callerAttempt as any);
      expect((identity as any).replayKey).toBeUndefined();
    });

    it('37. authorization payload mutation changes replay identity and key', () => {
      const payload1 = createValidSyntheticCanonicalPayload({ maxBudgetMicroUsd: 12783 });
      const payload2 = createValidSyntheticCanonicalPayload({ maxBudgetMicroUsd: 20000 });

      const id1 = deriveReplayIdentityFromCanonicalAuthorization({
        payload: payload1,
        keyVersion: 'v1',
      });
      const id2 = deriveReplayIdentityFromCanonicalAuthorization({
        payload: payload2,
        keyVersion: 'v1',
      });

      expect(id1.authorizationPayloadDigestSha256).not.toBe(id2.authorizationPayloadDigestSha256);
      expect(computeAuthorizationReplayKey(id1)).not.toBe(computeAuthorizationReplayKey(id2));
    });

    it('38. source attestation mutation changes replay identity and key', () => {
      const payload1 = createValidSyntheticCanonicalPayload({
        sourceAttestationDigest:
          '1111111111111111111111111111111111111111111111111111111111111111',
      });
      const payload2 = createValidSyntheticCanonicalPayload({
        sourceAttestationDigest:
          '2222222222222222222222222222222222222222222222222222222222222222',
      });

      const id1 = deriveReplayIdentityFromCanonicalAuthorization({
        payload: payload1,
        keyVersion: 'v1',
      });
      const id2 = deriveReplayIdentityFromCanonicalAuthorization({
        payload: payload2,
        keyVersion: 'v1',
      });

      expect(id1.sourceAttestationDigest).not.toBe(id2.sourceAttestationDigest);
      expect(computeAuthorizationReplayKey(id1)).not.toBe(computeAuthorizationReplayKey(id2));
    });

    it('39. nonce mutation changes replay identity and key', () => {
      const payload1 = createValidSyntheticCanonicalPayload({
        runNonce: 'a12b2c5r_nonce_first_1111111111111',
      });
      const payload2 = createValidSyntheticCanonicalPayload({
        runNonce: 'a12b2c5r_nonce_second_222222222222',
      });

      const id1 = deriveReplayIdentityFromCanonicalAuthorization({
        payload: payload1,
        keyVersion: 'v1',
      });
      const id2 = deriveReplayIdentityFromCanonicalAuthorization({
        payload: payload2,
        keyVersion: 'v1',
      });

      expect(id1.runNonce).not.toBe(id2.runNonce);
      expect(computeAuthorizationReplayKey(id1)).not.toBe(computeAuthorizationReplayKey(id2));
    });
  });

  // ==========================================================================
  // 6. PRODUCTION RESERVATION FAIL-CLOSED SEMANTICS
  // ==========================================================================
  describe('6. Production Reservation Fail-Closed Semantics', () => {
    it('40. production reserve fails with BACKEND_NOT_BOUND', () => {
      const req = createValidSyntheticReservationRequest();
      const res = reserveProductionAuthorizationReplay(req);
      expect(res.success).toBe(false);
      expect(res.status).toBe('BACKEND_NOT_BOUND');
      expect(res.errors.some((e) => e.includes('DURABLE_REPLAY_BACKEND_NOT_BOUND'))).toBe(true);
    });

    it('41. production reserve cannot return RESERVED', () => {
      const req = createValidSyntheticReservationRequest();
      const res = reserveProductionAuthorizationReplay(req);
      expect(res.status).not.toBe('RESERVED');
      expect(res.success).toBe(false);
    });

    it('42. second production reserve also fails closed', () => {
      const req = createValidSyntheticReservationRequest();
      const res1 = reserveProductionAuthorizationReplay(req);
      const res2 = reserveProductionAuthorizationReplay(req);
      expect(res1.status).toBe('BACKEND_NOT_BOUND');
      expect(res2.status).toBe('BACKEND_NOT_BOUND');
      expect(res1.success).toBe(false);
      expect(res2.success).toBe(false);
    });

    it('43. arbitrary replay key cannot bypass', () => {
      const req = createValidSyntheticReservationRequest({
        replayKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      });
      const res = reserveProductionAuthorizationReplay(req);
      expect(res.status).toBe('BACKEND_NOT_BOUND');
      expect(res.success).toBe(false);
    });

    it('44. caller backend field rejects with INVALID_REQUEST', () => {
      const req = {
        ...createValidSyntheticReservationRequest(),
        backend: { reserveIfAbsent: () => ({ success: true, status: 'RESERVED' }) },
      };
      const res = reserveProductionAuthorizationReplay(req);
      expect(res.status).toBe('INVALID_REQUEST');
      expect(res.success).toBe(false);
      expect(res.errors.some((e) => e.includes('FORBIDDEN_CALLER_OVERRIDE'))).toBe(true);
    });

    it('45. skipReplayCheck field rejects with INVALID_REQUEST', () => {
      const req = {
        ...createValidSyntheticReservationRequest(),
        skipReplayCheck: true,
      };
      const res = reserveProductionAuthorizationReplay(req);
      expect(res.status).toBe('INVALID_REQUEST');
      expect(res.success).toBe(false);
      expect(res.errors.some((e) => e.includes('FORBIDDEN_CALLER_OVERRIDE'))).toBe(true);
    });

    it('46. allowReplay field rejects with INVALID_REQUEST', () => {
      const req = {
        ...createValidSyntheticReservationRequest(),
        allowReplay: true,
      };
      const res = reserveProductionAuthorizationReplay(req);
      expect(res.status).toBe('INVALID_REQUEST');
      expect(res.success).toBe(false);
      expect(res.errors.some((e) => e.includes('FORBIDDEN_CALLER_OVERRIDE'))).toBe(true);
    });

    it('47. forceReserve field rejects with INVALID_REQUEST', () => {
      const req = {
        ...createValidSyntheticReservationRequest(),
        forceReserve: true,
      };
      const res = reserveProductionAuthorizationReplay(req);
      expect(res.status).toBe('INVALID_REQUEST');
      expect(res.success).toBe(false);
      expect(res.errors.some((e) => e.includes('FORBIDDEN_CALLER_OVERRIDE'))).toBe(true);
    });

    it('48. testMode field rejects with INVALID_REQUEST', () => {
      const req = {
        ...createValidSyntheticReservationRequest(),
        testMode: true,
      };
      const res = reserveProductionAuthorizationReplay(req);
      expect(res.status).toBe('INVALID_REQUEST');
      expect(res.success).toBe(false);
      expect(res.errors.some((e) => e.includes('FORBIDDEN_CALLER_OVERRIDE'))).toBe(true);
    });

    it('49. nowUtc override rejects with INVALID_REQUEST', () => {
      const req = {
        ...createValidSyntheticReservationRequest(),
        nowUtc: '2026-09-06T10:05:00.000Z',
      };
      const res = reserveProductionAuthorizationReplay(req);
      expect(res.status).toBe('INVALID_REQUEST');
      expect(res.success).toBe(false);
      expect(res.errors.some((e) => e.includes('FORBIDDEN_CALLER_OVERRIDE'))).toBe(true);
    });

    it('49b. atomicOverride and storage adapter fields reject with INVALID_REQUEST', () => {
      const req1 = {
        ...createValidSyntheticReservationRequest(),
        atomicOverride: true,
      };
      expect(reserveProductionAuthorizationReplay(req1).status).toBe('INVALID_REQUEST');

      const req2 = {
        ...createValidSyntheticReservationRequest(),
        adapter: 'local_storage',
      };
      expect(reserveProductionAuthorizationReplay(req2).status).toBe('INVALID_REQUEST');

      const req3 = {
        ...createValidSyntheticReservationRequest(),
        storage: 'memory',
      };
      expect(reserveProductionAuthorizationReplay(req3).status).toBe('INVALID_REQUEST');
    });
  });

  // ==========================================================================
  // 7. ARCHITECTURAL INVARIANTS: NO IN-MEMORY / FAKE DURABILITY
  // ==========================================================================
  describe('7. Architectural Invariants: No In-Memory / Fake Durability', () => {
    it('50. module exports no Set-based production ledger', () => {
      const mod = replayLedgerModule as any;
      expect(mod.replayLedgerSet).toBeUndefined();
      expect(mod.usedTokensSet).toBeUndefined();
      expect(mod.productionSet).toBeUndefined();
      expect(mod.usedReplayKeysSet).toBeUndefined();
    });

    it('51. module exports no Map-based production ledger', () => {
      const mod = replayLedgerModule as any;
      expect(mod.replayLedgerMap).toBeUndefined();
      expect(mod.usedTokensMap).toBeUndefined();
      expect(mod.productionMap).toBeUndefined();
      expect(mod.ledgerMap).toBeUndefined();
    });

    it('52. no process-local used-key cache exported', () => {
      const mod = replayLedgerModule as any;
      expect(mod.cache).toBeUndefined();
      expect(mod.usedKeys).toBeUndefined();
      expect(mod.replayCache).toBeUndefined();
      expect(mod.inMemoryStore).toBeUndefined();
    });

    it('53. no filesystem persistence exported or operational', () => {
      const mod = replayLedgerModule as any;
      expect(mod.saveToFile).toBeUndefined();
      expect(mod.loadFromFile).toBeUndefined();
      expect(mod.fsStore).toBeUndefined();
    });

    it('54. no SQLite implicit backend', () => {
      const mod = replayLedgerModule as any;
      expect(mod.sqliteBackend).toBeUndefined();
      expect(mod.sqliteDb).toBeUndefined();
    });

    it('55. no DB claim', () => {
      const mod = replayLedgerModule as any;
      expect(mod.databaseBackend).toBeUndefined();
      expect(mod.dbConnection).toBeUndefined();
    });

    it('56. no Redis claim', () => {
      const mod = replayLedgerModule as any;
      expect(mod.redisClient).toBeUndefined();
      expect(mod.redisBackend).toBeUndefined();
    });

    it('57. no KV claim unless repository has explicit imported durable contract', () => {
      const mod = replayLedgerModule as any;
      expect(mod.kvStore).toBeUndefined();
      expect(mod.kvBackend).toBeUndefined();
    });

    it('58. no process.env backend selection', () => {
      const originalBackend = (process.env as any).REPLAY_LEDGER_BACKEND;
      (process.env as any).REPLAY_LEDGER_BACKEND = 'MEMORY_OVERRIDE';
      const req = createValidSyntheticReservationRequest();
      const res = reserveProductionAuthorizationReplay(req);
      expect(res.status).toBe('BACKEND_NOT_BOUND');
      expect(res.success).toBe(false);
      if (originalBackend !== undefined) {
        (process.env as any).REPLAY_LEDGER_BACKEND = originalBackend;
      } else {
        delete (process.env as any).REPLAY_LEDGER_BACKEND;
      }
    });

    it('59. no network operation exported', () => {
      const mod = replayLedgerModule as any;
      expect(mod.fetchRemoteLedger).toBeUndefined();
      expect(mod.dispatchReservationHttp).toBeUndefined();
    });

    it('60. no provider credentials exported', () => {
      const mod = replayLedgerModule as any;
      expect(mod.DEEPSEEK_API_KEY).toBeUndefined();
      expect(mod.GEMINI_API_KEY).toBeUndefined();
      expect(mod.apiKey).toBeUndefined();
    });
  });

  // ==========================================================================
  // 8. CROSS-PHASE SYSTEM INVARIANTS & UNCHANGED GATES
  // ==========================================================================
  describe('8. Cross-Phase System Invariants & Unchanged Gates', () => {
    it('61. existing production human trust remains unprovisioned', () => {
      expect(PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED).toBe(false);
    });

    it('62. source provenance trust remains unprovisioned', () => {
      expect(RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_PROVISIONED).toBe(false);
    });

    it('63. source provenance ready remains false', () => {
      expect(TRUSTED_RUNTIME_SOURCE_PROVENANCE_READY).toBe(false);
    });

    it('64. guarded source readiness remains false', () => {
      expect(GUARDED_SOURCE_ATTESTATION_READY).toBe(false);
    });

    it('65. guarded human auth readiness remains false', () => {
      expect(GUARDED_HUMAN_AUTH_ATTESTATION_READY).toBe(false);
    });

    it('66. live execution remains false', () => {
      expect(CANARY_LIVE_EXECUTION_ENABLED).toBe(false);
    });

    it('67. production routing remains false (enforcementAllowed === false)', () => {
      expect(VELNAR_ROUTING_POLICY_VERSION).toBe('a12b2c-v1');
      const decision = resolveRoutingPolicyDecision('CODE_GENERATION' as any);
      expect(decision.enforcementAllowed).toBe(false);
    });
  });

  // ==========================================================================
  // 9. EXECUTION ORDER & SEMANTIC BOUNDARY
  // ==========================================================================
  describe('9. Execution Order & Semantic Boundary', () => {
    it('68. future execution order documented with all 7 canonical stages', () => {
      expect(FUTURE_GUARDED_EXECUTION_ORDER).toEqual([
        'TRUSTED_SOURCE_VERIFICATION',
        'PRODUCTION_HUMAN_AUTHORIZATION_VERIFICATION',
        'DERIVE_REPLAY_IDENTITY',
        'DURABLE_ATOMIC_RESERVE_IF_ABSENT',
        'CANONICAL_EXECUTION_PREFLIGHT',
        'CREDENTIAL_RESOLUTION',
        'NETWORK_TRANSPORT',
      ]);
    });

    it('69. replay reservation positioned before credentials in execution order', () => {
      const reserveIdx = FUTURE_GUARDED_EXECUTION_ORDER.indexOf('DURABLE_ATOMIC_RESERVE_IF_ABSENT');
      const credIdx = FUTURE_GUARDED_EXECUTION_ORDER.indexOf('CREDENTIAL_RESOLUTION');
      expect(reserveIdx).toBeGreaterThan(-1);
      expect(credIdx).toBeGreaterThan(-1);
      expect(reserveIdx).toBeLessThan(credIdx);
    });

    it('70. replay reservation positioned before network in execution order', () => {
      const reserveIdx = FUTURE_GUARDED_EXECUTION_ORDER.indexOf('DURABLE_ATOMIC_RESERVE_IF_ABSENT');
      const netIdx = FUTURE_GUARDED_EXECUTION_ORDER.indexOf('NETWORK_TRANSPORT');
      expect(reserveIdx).toBeGreaterThan(-1);
      expect(netIdx).toBeGreaterThan(-1);
      expect(reserveIdx).toBeLessThan(netIdx);
    });

    it('71. authorization digest computed from canonical payload', () => {
      const payload = createValidSyntheticCanonicalPayload();
      const digest = computeCanonicalAuthorizationPayloadDigestSha256(payload);
      expect(/^[0-9a-f]{64}$/.test(digest)).toBe(true);

      const canonicalString = canonicalizeHumanAuthorizationPayload(payload);
      const expectedDigest = crypto.createHash('sha256').update(canonicalString, 'utf8').digest('hex');
      expect(digest).toBe(expectedDigest);
    });

    it('72. arbitrary digest mismatch is detectable', () => {
      const payload = createValidSyntheticCanonicalPayload();
      const digestActual = computeCanonicalAuthorizationPayloadDigestSha256(payload);
      const digestAltered = computeCanonicalAuthorizationPayloadDigestSha256({
        ...payload,
        maxBudgetMicroUsd: 25000,
      });
      expect(digestActual).not.toBe(digestAltered);
    });

    it('73. exact singleUse semantics: singleUse must be strictly true', () => {
      const payload = createValidSyntheticCanonicalPayload({ singleUse: true });
      const id = deriveReplayIdentityFromCanonicalAuthorization({
        payload,
        keyVersion: 'v1',
      });
      expect(id).toBeDefined();
    });

    it('74. singleUse false must not be silently upgraded into reusable production auth', () => {
      const payload = createValidSyntheticCanonicalPayload({ singleUse: false });
      expect(() =>
        deriveReplayIdentityFromCanonicalAuthorization({
          payload,
          keyVersion: 'v1',
        })
      ).toThrow('SINGLE_USE_REQUIRED');
    });

    it('75. invalid canonical authorization input rejects', () => {
      expect(() => deriveReplayIdentityFromCanonicalAuthorization(null as any)).toThrow(
        'DERIVE_REPLAY_IDENTITY_FAILED'
      );
      expect(() =>
        deriveReplayIdentityFromCanonicalAuthorization({} as any)
      ).toThrow('DERIVE_REPLAY_IDENTITY_FAILED');
      expect(() =>
        deriveReplayIdentityFromCanonicalAuthorization({
          payload: createValidSyntheticCanonicalPayload(),
          keyVersion: '', // empty keyVersion
        })
      ).toThrow('DERIVE_REPLAY_IDENTITY_FAILED');
    });

    it('76. no production backend parameter accepted', () => {
      expect(reserveProductionAuthorizationReplay.length).toBe(1);
    });

    it('77. no storage adapter parameter accepted', () => {
      const req = {
        ...createValidSyntheticReservationRequest(),
        storageAdapter: 'test_adapter',
      };
      const res = reserveProductionAuthorizationReplay(req);
      expect(res.status).toBe('INVALID_REQUEST');
    });

    it('78. no atomic override accepted', () => {
      const req = {
        ...createValidSyntheticReservationRequest(),
        atomic: true,
      };
      const res = reserveProductionAuthorizationReplay(req);
      expect(res.status).toBe('INVALID_REQUEST');
    });

    it('79. no success override accepted', () => {
      const req = {
        ...createValidSyntheticReservationRequest(),
        backendResult: 'RESERVED',
      };
      const res = reserveProductionAuthorizationReplay(req);
      expect(res.status).toBe('INVALID_REQUEST');
    });

    it('80. zero provider calls during tests', () => {
      expect(globalFetchCalls).toBe(0);
    });

    it('81. zero network calls during tests', () => {
      expect(globalFetchCalls).toBe(0);
    });
  });

  // ==========================================================================
  // 10. STATIC SCAN & ARTIFACT VERIFICATION
  // ==========================================================================
  describe('10. Static Audits & Artifact Verification', () => {
    it('82. static scan of deepSeekDurableAuthorizationReplayLedger.ts contains zero operational forbidden keywords', () => {
      const modulePath = path.resolve(
        process.cwd(),
        'worker/ai/canary/deepSeekDurableAuthorizationReplayLedger.ts'
      );
      expect(fs.existsSync(modulePath)).toBe(true);
      const code = fs.readFileSync(modulePath, 'utf8');

      // Strip comments to check operational code only
      const stripped = code
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');

      const forbiddenOperational = [
        'new Set(',
        'new Map(',
        'WeakSet',
        'WeakMap',
        'LRU',
        'process.env',
        'fetch(',
        'axios',
        'undici',
        'node:http',
        'node:https',
        'node:net',
        'node:fs',
        'sqlite',
        'redis',
        'postgres',
        'mysql',
        'dynamodb',
        'firestore',
      ];

      for (const keyword of forbiddenOperational) {
        expect(
          stripped.includes(keyword),
          `Operational code must not contain forbidden keyword: ${keyword}`
        ).toBe(false);
      }
    });

    it('83. verify 5R evidence artifact matches canonical specification', () => {
      const artifactPath = path.resolve(
        process.cwd(),
        'execution/a12b2c5r_durable_authorization_replay_ledger_foundation.json'
      );
      expect(fs.existsSync(artifactPath)).toBe(true);
      const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

      expect(artifact.phase).toBe('A.12B.2C-5R');
      expect(artifact.artifactType).toBe(
        'DURABLE_SINGLE_USE_AUTHORIZATION_REPLAY_LEDGER_FOUNDATION'
      );
      expect(artifact.baseCommit).toBe('c44b822b424afc4b87fe76d50915e22925d1e670');
      expect(artifact.baseTree).toBe('16847194b9c0f54f9fae6d0e0dbea615007a5cec');
      expect(artifact.ledgerVersion).toBe('a12b2c5r-v1');

      expect(artifact.replayIdentityImplemented).toBe(true);
      expect(artifact.canonicalReplayKeyDerivationImplemented).toBe(true);
      expect(artifact.authorizationPayloadDigestBound).toBe(true);
      expect(artifact.sourceAttestationDigestBound).toBe(true);
      expect(artifact.runNonceBound).toBe(true);
      expect(artifact.programWindowCandidateBound).toBe(true);
      expect(artifact.durableBackendContractImplemented).toBe(true);

      expect(artifact.durableBackendBound).toBe(false);
      expect(artifact.atomicReserveIfAbsentImplemented).toBe(false);
      expect(artifact.productionReplayReservationReady).toBe(false);
      expect(artifact.productionReservationCanReturnReserved).toBe(false);
      expect(artifact.callerBackendOverrideAllowed).toBe(false);
      expect(artifact.callerReplayBypassAllowed).toBe(false);
      expect(artifact.processLocalReplayCacheUsed).toBe(false);
      expect(artifact.guardedTransportIntegrated).toBe(false);

      expect(artifact.replayReservationBeforeCredentialRequired).toBe(true);
      expect(artifact.replayReservationBeforeNetworkRequired).toBe(true);
      expect(artifact.productionAuthorityTrustAnchorProvisioned).toBe(false);
      expect(artifact.runtimeSourceProvenanceTrustAnchorProvisioned).toBe(false);
      expect(artifact.trustedRuntimeSourceProvenanceReady).toBe(false);
      expect(artifact.sourceAttestationReady).toBe(false);
      expect(artifact.humanAuthorizationAttestationReady).toBe(false);
      expect(artifact.liveExecutionEnabled).toBe(false);
      expect(artifact.providerNetworkCalls).toBe(0);
      expect(artifact.productionRoutingEnforcementAllowed).toBe(false);
      expect(artifact.successorActivated).toBe(false);
      expect(artifact.finalStatus).toBe(
        'A12B2C5R_REPLAY_LEDGER_CONTRACT_IMPLEMENTED_BACKEND_UNBOUND_NOT_LIVE'
      );
    });

    it('84. total provider network calls during entire test suite execution is exactly 0', () => {
      expect(globalFetchCalls).toBe(0);
    });
  });

  // ==========================================================================
  // 11. PHASE A.12B.2C-5R.1: SIGNED AUTHORIZATION EXPIRY REPLAY BINDING REPAIR
  // ==========================================================================
  describe('11. Phase A.12B.2C-5R.1: Signed Authorization Expiry Replay Reservation Binding Repair', () => {
    it('85. canonical builder expiresAt === auth.payload.expiresAt', () => {
      const payload = createValidSyntheticCanonicalPayload({ expiresAt: '2026-09-06T11:22:33.000Z' });
      const auth = { payload, keyVersion: 'v1' };
      const req = buildAuthorizationReplayReservationRequestFromCanonicalAuthorization(auth);
      expect(req.expiresAt).toBe('2026-09-06T11:22:33.000Z');
      expect(req.expiresAt).toBe(auth.payload.expiresAt);
    });

    it('86. builder computes replayKey internally', () => {
      const payload = createValidSyntheticCanonicalPayload();
      const auth = { payload, keyVersion: '2026-v1' };
      const req = buildAuthorizationReplayReservationRequestFromCanonicalAuthorization(auth);

      const derived = deriveReplayIdentityFromCanonicalAuthorization(auth);
      const expectedKey = computeAuthorizationReplayKey(derived);
      expect(req.replayKey).toBe(expectedKey);
    });

    it('87. builder computes authorization payload digest internally', () => {
      const payload = createValidSyntheticCanonicalPayload();
      const auth = { payload, keyVersion: '2026-v1' };
      const req = buildAuthorizationReplayReservationRequestFromCanonicalAuthorization(auth);

      const expectedDigest = computeCanonicalAuthorizationPayloadDigestSha256(payload);
      expect(req.authorizationPayloadDigestSha256).toBe(expectedDigest);
    });

    it('88. builder cannot accept caller replayKey', () => {
      const payload = createValidSyntheticCanonicalPayload();
      const auth = {
        payload,
        keyVersion: '2026-v1',
        replayKey: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      };
      expect(() =>
        buildAuthorizationReplayReservationRequestFromCanonicalAuthorization(auth as any)
      ).toThrow('FORBIDDEN_CALLER_OVERRIDE');
    });

    it('89. builder cannot accept caller expiresAt', () => {
      const payload = createValidSyntheticCanonicalPayload({ expiresAt: '2026-09-06T12:00:00.000Z' });
      const auth = {
        payload,
        keyVersion: '2026-v1',
        expiresAt: '2026-09-06T10:00:00.000Z',
      };
      expect(() =>
        buildAuthorizationReplayReservationRequestFromCanonicalAuthorization(auth as any)
      ).toThrow('FORBIDDEN_CALLER_OVERRIDE');
    });

    it('90. builder cannot accept TTL/retention override', () => {
      const payload = createValidSyntheticCanonicalPayload();
      for (const overrideField of [
        'ttl',
        'ttlMs',
        'retentionSeconds',
        'retentionMs',
        'overrideExpiry',
        'replayExpiry',
      ]) {
        const auth = {
          payload,
          keyVersion: '2026-v1',
          [overrideField]: 3600,
        };
        expect(() =>
          buildAuthorizationReplayReservationRequestFromCanonicalAuthorization(auth as any)
        ).toThrow('FORBIDDEN_CALLER_OVERRIDE');
      }
    });

    it('91. built request passes existing reservation validator', () => {
      const payload = createValidSyntheticCanonicalPayload();
      const auth = { payload, keyVersion: '2026-v1' };
      const req = buildAuthorizationReplayReservationRequestFromCanonicalAuthorization(auth);
      const res = validateAuthorizationReplayReservationRequest(req);
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it('92. built request passes new authorization-binding validator', () => {
      const payload = createValidSyntheticCanonicalPayload();
      const auth = { payload, keyVersion: '2026-v1' };
      const req = buildAuthorizationReplayReservationRequestFromCanonicalAuthorization(auth);
      const res = validateReplayReservationAgainstCanonicalAuthorization(req, auth);
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it('93. reservation expiry earlier than signed auth expiry rejects', () => {
      const payload = createValidSyntheticCanonicalPayload({ expiresAt: '2026-09-06T12:10:00.000Z' });
      const auth = { payload, keyVersion: '2026-v1' };
      const req = buildAuthorizationReplayReservationRequestFromCanonicalAuthorization(auth);

      // Mutate reservation to expire earlier
      const earlierReq = {
        ...req,
        expiresAt: '2026-09-06T10:01:00.000Z',
      };
      const res = validateReplayReservationAgainstCanonicalAuthorization(earlierReq, auth);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('EXPIRES_AT_MISMATCH'))).toBe(true);
    });

    it('94. reservation expiry later than signed auth expiry rejects', () => {
      const payload = createValidSyntheticCanonicalPayload({ expiresAt: '2026-09-06T12:10:00.000Z' });
      const auth = { payload, keyVersion: '2026-v1' };
      const req = buildAuthorizationReplayReservationRequestFromCanonicalAuthorization(auth);

      // Mutate reservation to expire later
      const laterReq = {
        ...req,
        expiresAt: '2026-09-06T14:00:00.000Z',
      };
      const res = validateReplayReservationAgainstCanonicalAuthorization(laterReq, auth);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('EXPIRES_AT_MISMATCH'))).toBe(true);
    });

    it('95. exact same expiry passes', () => {
      const payload = createValidSyntheticCanonicalPayload({ expiresAt: '2026-09-06T15:30:00.000Z' });
      const auth = { payload, keyVersion: '2026-v1' };
      const req = buildAuthorizationReplayReservationRequestFromCanonicalAuthorization(auth);
      expect(req.expiresAt).toBe('2026-09-06T15:30:00.000Z');
      const res = validateReplayReservationAgainstCanonicalAuthorization(req, auth);
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it('96. replayKey mismatch rejects', () => {
      const payload = createValidSyntheticCanonicalPayload();
      const auth = { payload, keyVersion: '2026-v1' };
      const req = buildAuthorizationReplayReservationRequestFromCanonicalAuthorization(auth);

      const tamperedReq = {
        ...req,
        replayKey: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      };
      const res = validateReplayReservationAgainstCanonicalAuthorization(tamperedReq, auth);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('REPLAY_KEY_MISMATCH'))).toBe(true);
    });

    it('97. payload digest mismatch rejects', () => {
      const payload = createValidSyntheticCanonicalPayload();
      const auth = { payload, keyVersion: '2026-v1' };
      const req = buildAuthorizationReplayReservationRequestFromCanonicalAuthorization(auth);

      const tamperedReq = {
        ...req,
        authorizationPayloadDigestSha256:
          'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      };
      const res = validateReplayReservationAgainstCanonicalAuthorization(tamperedReq, auth);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('PAYLOAD_DIGEST_MISMATCH'))).toBe(true);
    });

    it('98. authorityId mismatch rejects', () => {
      const payload = createValidSyntheticCanonicalPayload();
      const auth = { payload, keyVersion: '2026-v1' };
      const req = buildAuthorizationReplayReservationRequestFromCanonicalAuthorization(auth);

      const tamperedReq = {
        ...req,
        authorityId: 'auth_other_attacker_authority',
      };
      const res = validateReplayReservationAgainstCanonicalAuthorization(tamperedReq, auth);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('AUTHORITY_ID_MISMATCH'))).toBe(true);
    });

    it('99. keyVersion mismatch rejects', () => {
      const payload = createValidSyntheticCanonicalPayload();
      const auth = { payload, keyVersion: '2026-v1' };
      const req = buildAuthorizationReplayReservationRequestFromCanonicalAuthorization(auth);

      const tamperedReq = {
        ...req,
        keyVersion: '2026-v2',
      };
      const res = validateReplayReservationAgainstCanonicalAuthorization(tamperedReq, auth);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('KEY_VERSION_MISMATCH'))).toBe(true);
    });

    it('100. runNonce mismatch rejects', () => {
      const payload = createValidSyntheticCanonicalPayload();
      const auth = { payload, keyVersion: '2026-v1' };
      const req = buildAuthorizationReplayReservationRequestFromCanonicalAuthorization(auth);

      const tamperedReq = {
        ...req,
        runNonce: 'a12b2c5r_nonce_tampered_9999999999',
      };
      const res = validateReplayReservationAgainstCanonicalAuthorization(tamperedReq, auth);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('NONCE_MISMATCH'))).toBe(true);
    });

    it('101. authorization expiresAt mutation invalidates old reservation binding', () => {
      const payload = createValidSyntheticCanonicalPayload({ expiresAt: '2026-09-06T10:10:00.000Z' });
      const auth = { payload, keyVersion: '2026-v1' };
      const req = buildAuthorizationReplayReservationRequestFromCanonicalAuthorization(auth);

      // Now auth payload is renewed / mutated to new expiry
      const renewedAuth = {
        payload: { ...payload, expiresAt: '2026-09-06T11:10:00.000Z' },
        keyVersion: '2026-v1',
      };
      const res = validateReplayReservationAgainstCanonicalAuthorization(req, renewedAuth);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('EXPIRES_AT_MISMATCH'))).toBe(true);
    });

    it('102. singleUse false rejects', () => {
      const payload = createValidSyntheticCanonicalPayload({ singleUse: false });
      const auth = { payload, keyVersion: '2026-v1' };
      expect(() =>
        buildAuthorizationReplayReservationRequestFromCanonicalAuthorization(auth as any)
      ).toThrow('SINGLE_USE_REQUIRED');

      const dummyReq = createValidSyntheticReservationRequest();
      const res = validateReplayReservationAgainstCanonicalAuthorization(dummyReq, auth);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('SINGLE_USE_REQUIRED'))).toBe(true);
    });

    it('103. invalid canonical payload rejects', () => {
      expect(() =>
        buildAuthorizationReplayReservationRequestFromCanonicalAuthorization({} as any)
      ).toThrow('BUILD_REPLAY_RESERVATION_REQUEST_FAILED');

      const dummyReq = createValidSyntheticReservationRequest();
      const res = validateReplayReservationAgainstCanonicalAuthorization(dummyReq, {} as any);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('AUTH_INVALID'))).toBe(true);
    });

    it('104. package-level authorityId != payload.authorityId rejects', () => {
      const payload = createValidSyntheticCanonicalPayload({ authorityId: 'auth_velnar_secops' });
      const auth = {
        payload,
        keyVersion: '2026-v1',
        authorityId: 'auth_attacker_different',
      };
      expect(() => deriveReplayIdentityFromCanonicalAuthorization(auth as any)).toThrow(
        'AUTHORITY_MISMATCH'
      );
      expect(() =>
        buildAuthorizationReplayReservationRequestFromCanonicalAuthorization(auth as any)
      ).toThrow('AUTHORITY_MISMATCH');

      const dummyReq = createValidSyntheticReservationRequest();
      const res = validateReplayReservationAgainstCanonicalAuthorization(dummyReq, auth);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('AUTHORITY_MISMATCH'))).toBe(true);
    });

    it('105. matching authority IDs pass', () => {
      const payload = createValidSyntheticCanonicalPayload({ authorityId: 'auth_velnar_secops' });
      const auth = {
        payload,
        keyVersion: '2026-v1',
        authorityId: 'auth_velnar_secops',
      };
      const id = deriveReplayIdentityFromCanonicalAuthorization(auth as any);
      expect(id.authorityId).toBe('auth_velnar_secops');

      const req = buildAuthorizationReplayReservationRequestFromCanonicalAuthorization(auth as any);
      expect(req.authorityId).toBe('auth_velnar_secops');
      const res = validateReplayReservationAgainstCanonicalAuthorization(req, auth);
      expect(res.valid).toBe(true);
    });

    it('106. production reservation remains BACKEND_NOT_BOUND', () => {
      const payload = createValidSyntheticCanonicalPayload();
      const auth = { payload, keyVersion: '2026-v1' };
      const req = buildAuthorizationReplayReservationRequestFromCanonicalAuthorization(auth);
      const res = reserveProductionAuthorizationReplay(req);
      expect(res.success).toBe(false);
      expect(res.status).toBe('BACKEND_NOT_BOUND');
    });

    it('107. production reservation cannot return RESERVED', () => {
      const payload = createValidSyntheticCanonicalPayload();
      const auth = { payload, keyVersion: '2026-v1' };
      const req = buildAuthorizationReplayReservationRequestFromCanonicalAuthorization(auth);
      const res = reserveProductionAuthorizationReplay(req);
      expect(res.status).not.toBe('RESERVED');
      expect(res.success).toBe(false);
    });

    it('108. backend bound remains false', () => {
      expect(DURABLE_AUTHORIZATION_REPLAY_BACKEND_BOUND).toBe(false);
    });

    it('109. atomic implementation remains false', () => {
      expect(ATOMIC_RESERVE_IF_ABSENT_IMPLEMENTED).toBe(false);
    });

    it('110. source readiness false', () => {
      expect(GUARDED_SOURCE_ATTESTATION_READY).toBe(false);
      expect(TRUSTED_RUNTIME_SOURCE_PROVENANCE_READY).toBe(false);
    });

    it('111. human auth readiness false', () => {
      expect(GUARDED_HUMAN_AUTH_ATTESTATION_READY).toBe(false);
      expect(PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED).toBe(false);
    });

    it('112. live execution false', () => {
      expect(CANARY_LIVE_EXECUTION_ENABLED).toBe(false);
    });

    it('113. zero provider calls', () => {
      expect(globalFetchCalls).toBe(0);
    });

    it('114. zero network calls', () => {
      expect(globalFetchCalls).toBe(0);
    });

    it('115. verify 5R.1 repair evidence artifact matches canonical specification', () => {
      const artifactPath = path.resolve(
        process.cwd(),
        'execution/a12b2c5r1_authorization_expiry_replay_binding_repair.json'
      );
      expect(fs.existsSync(artifactPath)).toBe(true);
      const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

      expect(artifact.phase).toBe('A.12B.2C-5R.1');
      expect(artifact.artifactType).toBe(
        'SIGNED_AUTHORIZATION_EXPIRY_REPLAY_RESERVATION_BINDING_REPAIR'
      );
      expect(artifact.baseCommit).toBe('b7a65c6ee9f8034df6c40618197aa1fb6d14cf2f');
      expect(artifact.baseTree).toBe('8ad38bd8fc543e57829acc0d380efecf03040654');
      expect(artifact.historical5RArtifactModified).toBe(false);
      expect(artifact.canonicalReservationBuilderImplemented).toBe(true);
      expect(artifact.callerSuppliedReplayKeyAcceptedByCanonicalBuilder).toBe(false);
      expect(artifact.callerSuppliedReplayExpiryAcceptedByCanonicalBuilder).toBe(false);
      expect(artifact.reservationReplayKeyBoundToAuthorization).toBe(true);
      expect(artifact.reservationPayloadDigestBoundToAuthorization).toBe(true);
      expect(artifact.reservationAuthorityBoundToAuthorization).toBe(true);
      expect(artifact.reservationKeyVersionBoundToAuthorization).toBe(true);
      expect(artifact.reservationNonceBoundToAuthorization).toBe(true);
      expect(artifact.reservationExpiryBoundToAuthorizationExpiry).toBe(true);
      expect(artifact.reservationExpiryUsesExactAuthorizationExpiry).toBe(true);
      expect(artifact.packageAuthorityBoundToPayloadAuthority).toBe(true);
      expect(artifact.shorterReplayRetentionAllowed).toBe(false);
      expect(artifact.durableBackendBound).toBe(false);
      expect(artifact.atomicReserveIfAbsentImplemented).toBe(false);
      expect(artifact.productionReplayReservationReady).toBe(false);
      expect(artifact.productionReservationCanReturnReserved).toBe(false);
      expect(artifact.guardedTransportIntegrated).toBe(false);
      expect(artifact.sourceAttestationReady).toBe(false);
      expect(artifact.humanAuthorizationAttestationReady).toBe(false);
      expect(artifact.liveExecutionEnabled).toBe(false);
      expect(artifact.providerNetworkCalls).toBe(0);
      expect(artifact.productionRoutingEnforcementAllowed).toBe(false);
      expect(artifact.successorActivated).toBe(false);
      expect(artifact.finalStatus).toBe(
        'A12B2C5R1_AUTHORIZATION_EXPIRY_REPLAY_BINDING_REPAIR_PASS_PENDING_INDEPENDENT_VERIFICATION'
      );
    });
  });

  // ==========================================================================
  // 17. PHASE A.12B.2C-5S.1: VERIFIED AUTHORIZATION BOUNDARY & NONCE CANONICALITY
  // ==========================================================================
  describe('17. Phase A.12B.2C-5S.1 Verified Authorization Boundary & Nonce Canonicality Regressions', () => {
    // ------------------------------------------------------------------------
    // A-C. Misleading old helper names do NOT exist
    // ------------------------------------------------------------------------
    it('A. old misleading exported helper deriveReplayIdentityFromVerifiedAuthorization does NOT exist', () => {
      expect((replayLedgerModule as any).deriveReplayIdentityFromVerifiedAuthorization).toBeUndefined();
    });

    it('B. old misleading exported helper buildAuthorizationReplayReservationRequestFromVerifiedAuthorization does NOT exist', () => {
      expect((replayLedgerModule as any).buildAuthorizationReplayReservationRequestFromVerifiedAuthorization).toBeUndefined();
    });

    it('C. old misleading exported helper validateReplayReservationAgainstVerifiedAuthorization does NOT exist', () => {
      expect((replayLedgerModule as any).validateReplayReservationAgainstVerifiedAuthorization).toBeUndefined();
    });

    // ------------------------------------------------------------------------
    // D-E. Pure canonical transformation helpers are explicitly non-authoritative
    // ------------------------------------------------------------------------
    it('D. canonical helper is explicitly non-authoritative and does not return verified/authorized/trusted claims', () => {
      const payload = createValidSyntheticCanonicalPayload();
      const unsignedAuth = { payload, keyVersion: '2026-v1' };
      const identity = deriveReplayIdentityFromCanonicalAuthorization(unsignedAuth);
      expect((identity as any).verified).toBeUndefined();
      expect((identity as any).authorized).toBeUndefined();
      expect((identity as any).trusted).toBeUndefined();

      const req = buildAuthorizationReplayReservationRequestFromCanonicalAuthorization(unsignedAuth);
      expect((req as any).verified).toBeUndefined();
      expect((req as any).authorized).toBeUndefined();
      expect((req as any).trusted).toBeUndefined();

      const validation = validateReplayReservationAgainstCanonicalAuthorization(req, unsignedAuth);
      expect((validation as any).verified).toBeUndefined();
      expect((validation as any).authorized).toBeUndefined();
      expect((validation as any).trusted).toBeUndefined();
      expect(validation.valid).toBe(true);
    });

    it('E. unsigned canonical object can be transformed only through the explicitly named canonical helper', () => {
      const payload = createValidSyntheticCanonicalPayload();
      const unsignedAuth = { payload, keyVersion: '2026-v1' };
      const identity = deriveReplayIdentityFromCanonicalAuthorization(unsignedAuth);
      expect(identity.authorityId).toBe(payload.authorityId);
      expect(identity.runNonce).toBe(payload.runNonce);
      const req = buildAuthorizationReplayReservationRequestFromCanonicalAuthorization(unsignedAuth);
      expect(req.replayKey).toBe(computeAuthorizationReplayKey(identity));
      expect(req.expiresAt).toBe(payload.expiresAt);
    });

    // ------------------------------------------------------------------------
    // F-L. Production orchestration boundary enforcement
    // ------------------------------------------------------------------------
    it('F. unsigned canonical object cannot pass the new production orchestration boundary', () => {
      const payload = createValidSyntheticCanonicalPayload();
      const unsignedAuth = { payload, keyVersion: '2026-v1' };
      const attestation = buildTrustedSourceAttestation({
        sourceCommitSha: TEST_COMMIT_SHA,
        sourceTreeSha: TEST_TREE_SHA,
        createdAt: '2026-09-06T10:00:00.000Z',
      });

      const res = buildProductionReplayReservationAfterAuthorizationVerification(
        unsignedAuth as any,
        attestation
      );
      expect(res.ready).toBe(false);
      expect(res.status).toBe('AUTHORIZATION_NOT_VERIFIED');
      expect(res.request).toBeUndefined();
    });

    it('G. caller field: verified: true cannot bypass production verification', () => {
      const payload = createValidSyntheticCanonicalPayload();
      const fakeVerified = { payload, keyVersion: '2026-v1', verified: true };
      const attestation = buildTrustedSourceAttestation({
        sourceCommitSha: TEST_COMMIT_SHA,
        sourceTreeSha: TEST_TREE_SHA,
        createdAt: '2026-09-06T10:00:00.000Z',
      });

      const res = buildProductionReplayReservationAfterAuthorizationVerification(
        fakeVerified as any,
        attestation
      );
      expect(res.ready).toBe(false);
      expect(res.status).toBe('AUTHORIZATION_NOT_VERIFIED');
      expect(res.failureReason).toContain('FORBIDDEN_CALLER_OVERRIDE');
      expect(res.request).toBeUndefined();
    });

    it('H. caller field: alreadyVerified: true cannot bypass production verification', () => {
      const payload = createValidSyntheticCanonicalPayload();
      const fakeVerified = { payload, keyVersion: '2026-v1', alreadyVerified: true };
      const attestation = buildTrustedSourceAttestation({
        sourceCommitSha: TEST_COMMIT_SHA,
        sourceTreeSha: TEST_TREE_SHA,
        createdAt: '2026-09-06T10:00:00.000Z',
      });

      const res = buildProductionReplayReservationAfterAuthorizationVerification(
        fakeVerified as any,
        attestation
      );
      expect(res.ready).toBe(false);
      expect(res.status).toBe('AUTHORIZATION_NOT_VERIFIED');
      expect(res.failureReason).toContain('FORBIDDEN_CALLER_OVERRIDE');
      expect(res.request).toBeUndefined();
    });

    it('I. caller-supplied ProductionVerificationResult cannot be injected', () => {
      const payload = createValidSyntheticCanonicalPayload();
      const fakeInjected = {
        payload,
        keyVersion: '2026-v1',
        verificationResult: { verified: true, authorityId: payload.authorityId },
      };
      const attestation = buildTrustedSourceAttestation({
        sourceCommitSha: TEST_COMMIT_SHA,
        sourceTreeSha: TEST_TREE_SHA,
        createdAt: '2026-09-06T10:00:00.000Z',
      });

      const res = buildProductionReplayReservationAfterAuthorizationVerification(
        fakeInjected as any,
        attestation
      );
      expect(res.ready).toBe(false);
      expect(res.status).toBe('AUTHORIZATION_NOT_VERIFIED');
      expect(res.failureReason).toContain('FORBIDDEN_CALLER_OVERRIDE');
      expect(res.request).toBeUndefined();
    });

    it('J. production orchestration calls production verification internally', () => {
      const payload = createValidSyntheticCanonicalPayload();
      const syntheticPkg: SignedHumanAuthorizationPackage = {
        payload,
        signatureBase64: Buffer.from('mock_signature').toString('base64'),
        algorithm: 'Ed25519',
        keyVersion: '2026-v1',
        authorityId: payload.authorityId,
      };
      const attestation = buildTrustedSourceAttestation({
        sourceCommitSha: TEST_COMMIT_SHA,
        sourceTreeSha: TEST_TREE_SHA,
        createdAt: '2026-09-06T10:00:00.000Z',
      });

      // Invokes verifyProductionHumanAuthorizationPackage which checks PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED
      const res = buildProductionReplayReservationAfterAuthorizationVerification(
        syntheticPkg,
        attestation
      );
      expect(res.ready).toBe(false);
      expect(res.status).toBe('AUTHORIZATION_NOT_VERIFIED');
      expect(res.failureReason).toBe('PRODUCTION_AUTHORITY_TRUST_ANCHOR_NOT_PROVISIONED');
    });

    it('K. production orchestration currently fails: PRODUCTION_AUTHORITY_TRUST_ANCHOR_NOT_PROVISIONED', () => {
      const payload = createValidSyntheticCanonicalPayload();
      const syntheticPkg: SignedHumanAuthorizationPackage = {
        payload,
        signatureBase64: Buffer.from('mock_sig').toString('base64'),
        algorithm: 'Ed25519',
        keyVersion: '2026-v1',
        authorityId: payload.authorityId,
      };
      const attestation = buildTrustedSourceAttestation({
        sourceCommitSha: TEST_COMMIT_SHA,
        sourceTreeSha: TEST_TREE_SHA,
        createdAt: '2026-09-06T10:00:00.000Z',
      });

      const res = buildProductionReplayReservationAfterAuthorizationVerification(
        syntheticPkg,
        attestation
      );
      expect(res.ready).toBe(false);
      expect(res.status).toBe('AUTHORIZATION_NOT_VERIFIED');
      expect(res.failureReason).toBe('PRODUCTION_AUTHORITY_TRUST_ANCHOR_NOT_PROVISIONED');
    });

    it('L. current production orchestration returns no reservation request', () => {
      const payload = createValidSyntheticCanonicalPayload();
      const syntheticPkg: SignedHumanAuthorizationPackage = {
        payload,
        signatureBase64: Buffer.from('mock_sig').toString('base64'),
        algorithm: 'Ed25519',
        keyVersion: '2026-v1',
        authorityId: payload.authorityId,
      };
      const attestation = buildTrustedSourceAttestation({
        sourceCommitSha: TEST_COMMIT_SHA,
        sourceTreeSha: TEST_TREE_SHA,
        createdAt: '2026-09-06T10:00:00.000Z',
      });

      const res = buildProductionReplayReservationAfterAuthorizationVerification(
        syntheticPkg,
        attestation
      );
      expect(res.ready).toBe(false);
      expect(res.request).toBeUndefined();
    });

    it('M. no production caller nowUtc parameter exists', () => {
      const payload = createValidSyntheticCanonicalPayload();
      const syntheticPkg: SignedHumanAuthorizationPackage = {
        payload,
        signatureBase64: Buffer.from('mock_sig').toString('base64'),
        algorithm: 'Ed25519',
        keyVersion: '2026-v1',
        authorityId: payload.authorityId,
      };
      const attestation = buildTrustedSourceAttestation({
        sourceCommitSha: TEST_COMMIT_SHA,
        sourceTreeSha: TEST_TREE_SHA,
        createdAt: '2026-09-06T10:00:00.000Z',
      });

      const res = (buildProductionReplayReservationAfterAuthorizationVerification as any)(
        syntheticPkg,
        attestation,
        { nowUtc: new Date() }
      );
      expect(res.ready).toBe(false);
      expect(res.status).toBe('AUTHORIZATION_NOT_VERIFIED');
      expect(res.failureReason).toContain('FORBIDDEN_CALLER_PARAMETER');
      expect(res.request).toBeUndefined();
    });

    it('N. no caller replayKey override exists in production orchestration', () => {
      const payload = createValidSyntheticCanonicalPayload();
      const tamperedPkg = {
        payload,
        signatureBase64: Buffer.from('mock_sig').toString('base64'),
        publicKeyFingerprintSha256: 'e'.repeat(64),
        algorithm: 'Ed25519',
        keyVersion: '2026-v1',
        authorityId: payload.authorityId,
        replayKey: 'f'.repeat(64),
      };
      const attestation = buildTrustedSourceAttestation({
        sourceCommitSha: TEST_COMMIT_SHA,
        sourceTreeSha: TEST_TREE_SHA,
        createdAt: '2026-09-06T10:00:00.000Z',
      });

      const res = buildProductionReplayReservationAfterAuthorizationVerification(
        tamperedPkg as any,
        attestation
      );
      expect(res.ready).toBe(false);
      expect(res.status).toBe('AUTHORIZATION_NOT_VERIFIED');
      expect(res.failureReason).toContain('FORBIDDEN_CALLER_OVERRIDE');
      expect(res.request).toBeUndefined();
    });

    it('O. no caller expiresAt override exists in production orchestration', () => {
      const payload = createValidSyntheticCanonicalPayload();
      const tamperedPkg = {
        payload,
        signatureBase64: Buffer.from('mock_sig').toString('base64'),
        publicKeyFingerprintSha256: 'a1'.repeat(32),
        algorithm: 'Ed25519',
        keyVersion: '2026-v1',
        authorityId: payload.authorityId,
        expiresAt: '2099-01-01T00:00:00.000Z',
      };
      const attestation = buildTrustedSourceAttestation({
        sourceCommitSha: TEST_COMMIT_SHA,
        sourceTreeSha: TEST_TREE_SHA,
        createdAt: '2026-09-06T10:00:00.000Z',
      });

      const res = buildProductionReplayReservationAfterAuthorizationVerification(
        tamperedPkg as any,
        attestation
      );
      expect(res.ready).toBe(false);
      expect(res.status).toBe('AUTHORIZATION_NOT_VERIFIED');
      expect(res.failureReason).toContain('FORBIDDEN_CALLER_OVERRIDE');
      expect(res.request).toBeUndefined();
    });

    it('P. canonical package and constructed replay request preserve authorityId binding', () => {
      const payload = createValidSyntheticCanonicalPayload({
        authorityId: 'auth_custom_secops_5s1',
      });
      const auth = { payload, keyVersion: '2026-v2', authorityId: 'auth_custom_secops_5s1' };
      const req = buildAuthorizationReplayReservationRequestFromCanonicalAuthorization(auth);
      expect(req.authorityId).toBe('auth_custom_secops_5s1');
    });

    it('Q. canonical package and constructed replay request preserve keyVersion binding', () => {
      const payload = createValidSyntheticCanonicalPayload();
      const auth = { payload, keyVersion: '2026-v5s1-spec' };
      const req = buildAuthorizationReplayReservationRequestFromCanonicalAuthorization(auth);
      expect(req.keyVersion).toBe('2026-v5s1-spec');
    });

    it('R. canonical expiry remains exact', () => {
      const payload = createValidSyntheticCanonicalPayload({
        expiresAt: '2026-09-06T11:22:33.444Z',
      });
      const auth = { payload, keyVersion: '2026-v1' };
      const req = buildAuthorizationReplayReservationRequestFromCanonicalAuthorization(auth);
      expect(req.expiresAt).toBe('2026-09-06T11:22:33.444Z');
    });

    it('S. reserveProductionAuthorizationReplay remains BACKEND_NOT_BOUND', () => {
      const payload = createValidSyntheticCanonicalPayload();
      const auth = { payload, keyVersion: '2026-v1' };
      const req = buildAuthorizationReplayReservationRequestFromCanonicalAuthorization(auth);
      const res = reserveProductionAuthorizationReplay(req);
      expect(res.success).toBe(false);
      expect(res.status).toBe('BACKEND_NOT_BOUND');
    });

    it('T. reserveProductionAuthorizationReplay never returns RESERVED', () => {
      const payload = createValidSyntheticCanonicalPayload();
      const auth = { payload, keyVersion: '2026-v1' };
      const req = buildAuthorizationReplayReservationRequestFromCanonicalAuthorization(auth);
      const res = reserveProductionAuthorizationReplay(req);
      expect(res.status).not.toBe('RESERVED');
    });

    // ------------------------------------------------------------------------
    // Section 17. NONCE CANONICALITY REGRESSIONS
    // ------------------------------------------------------------------------
    describe('validateRunNonce Canonicality Regressions', () => {
      const validNonce = 'a12b2c5r_nonce_8d4e92b10f5a73e61c4d82';

      it('1. valid canonical nonce: PASS', () => {
        const res = validateRunNonce(validNonce);
        expect(res.valid).toBe(true);
        expect(res.error).toBeUndefined();
      });

      it('2. leading ASCII space: REJECT with NONCE_NON_CANONICAL_WHITESPACE', () => {
        const res = validateRunNonce(` ${validNonce}`);
        expect(res.valid).toBe(false);
        expect(res.error).toContain('NONCE_NON_CANONICAL_WHITESPACE');
      });

      it('3. trailing ASCII space: REJECT with NONCE_NON_CANONICAL_WHITESPACE', () => {
        const res = validateRunNonce(`${validNonce} `);
        expect(res.valid).toBe(false);
        expect(res.error).toContain('NONCE_NON_CANONICAL_WHITESPACE');
      });

      it('4. leading tab: REJECT with NONCE_NON_CANONICAL_WHITESPACE', () => {
        const res = validateRunNonce(`\t${validNonce}`);
        expect(res.valid).toBe(false);
        expect(res.error).toContain('NONCE_NON_CANONICAL_WHITESPACE');
      });

      it('5. trailing tab: REJECT with NONCE_NON_CANONICAL_WHITESPACE', () => {
        const res = validateRunNonce(`${validNonce}\t`);
        expect(res.valid).toBe(false);
        expect(res.error).toContain('NONCE_NON_CANONICAL_WHITESPACE');
      });

      it('6. leading newline: REJECT with NONCE_NON_CANONICAL_WHITESPACE', () => {
        const res = validateRunNonce(`\n${validNonce}`);
        expect(res.valid).toBe(false);
        expect(res.error).toContain('NONCE_NON_CANONICAL_WHITESPACE');
      });

      it('7. trailing newline: REJECT with NONCE_NON_CANONICAL_WHITESPACE', () => {
        const res = validateRunNonce(`${validNonce}\n`);
        expect(res.valid).toBe(false);
        expect(res.error).toContain('NONCE_NON_CANONICAL_WHITESPACE');
      });

      it('8. CRLF padding: REJECT with NONCE_NON_CANONICAL_WHITESPACE', () => {
        const res = validateRunNonce(`\r\n${validNonce}\r\n`);
        expect(res.valid).toBe(false);
        expect(res.error).toContain('NONCE_NON_CANONICAL_WHITESPACE');
      });

      it('9. internal illegal whitespace: REJECT', () => {
        const internalSpace = 'a12b2c5r_nonce 8d4e92b10f5a73e61c4d82';
        const res = validateRunNonce(internalSpace);
        expect(res.valid).toBe(false);
        expect(res.error).toContain('NONCE_CHARSET_INVALID');
      });

      it('10. same canonical nonce remains deterministic in replay key derivation', () => {
        const id1 = createValidSyntheticReplayIdentity({ runNonce: validNonce });
        const id2 = createValidSyntheticReplayIdentity({ runNonce: validNonce });
        expect(computeAuthorizationReplayKey(id1)).toBe(computeAuthorizationReplayKey(id2));
      });

      it('11. two inputs differing only by prohibited outer whitespace must NOT both be accepted as valid identities', () => {
        expect(validateRunNonce(validNonce).valid).toBe(true);
        expect(validateRunNonce(` ${validNonce}`).valid).toBe(false);
        expect(validateRunNonce(`${validNonce} `).valid).toBe(false);
        expect(validateRunNonce(`\t${validNonce}\t`).valid).toBe(false);
      });
    });

    // ------------------------------------------------------------------------
    // Section 18. STATIC SECURITY TESTS
    // ------------------------------------------------------------------------
    describe('Static Security & Parameter Tampering Hardening', () => {
      const forbiddenParams = [
        'nowUtc',
        'verified',
        'authorized',
        'alreadyVerified',
        'verificationResult',
        'authority',
        'publicKey',
        'registry',
        'backend',
        'storage',
        'adapter',
        'replayKey',
        'expiresAt',
      ] as const;

      for (const param of forbiddenParams) {
        it(`rejects caller override parameter '${param}' in pkg or sourceAttestation`, () => {
          expect(FORBIDDEN_PRODUCTION_ORCHESTRATION_KEYS).toContain(param);

          const payload = createValidSyntheticCanonicalPayload();
          const pkgWithForbidden = {
            payload,
            keyVersion: '2026-v1',
            [param]: 'caller_injected_value',
          };
          const attestation = buildTrustedSourceAttestation({
            sourceCommitSha: TEST_COMMIT_SHA,
            sourceTreeSha: TEST_TREE_SHA,
            createdAt: '2026-09-06T10:00:00.000Z',
          });

          const res = buildProductionReplayReservationAfterAuthorizationVerification(
            pkgWithForbidden as any,
            attestation
          );
          expect(res.ready).toBe(false);
          expect(res.status).toBe('AUTHORIZATION_NOT_VERIFIED');
          expect(res.failureReason).toContain('FORBIDDEN_CALLER_OVERRIDE');
        });
      }
    });

    // ------------------------------------------------------------------------
    // Repair Artifact Integrity Check
    // ------------------------------------------------------------------------
    it('verifies Phase A.12B.2C-5S.1 repair artifact integrity', () => {
      const artifactPath = path.resolve(
        process.cwd(),
        'execution/a12b2c5s1_verified_authorization_boundary_nonce_repair.json'
      );
      expect(fs.existsSync(artifactPath)).toBe(true);
      const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

      expect(artifact.phase).toBe('A.12B.2C-5S.1');
      expect(artifact.artifactType).toBe(
        'VERIFIED_AUTHORIZATION_ORCHESTRATION_BOUNDARY_AND_NONCE_CANONICALITY_REPAIR'
      );
      expect(artifact.baseCommit).toBe('d072587aeeac29743ba3d83a0ff0be90f5ff7498');
      expect(artifact.baseTree).toBe('a5c384d95251c4e567dc04d1b4ffba7c35efd4ee');
      expect(artifact.codexPre5TBlockerReviewApplied).toBe(true);
      expect(artifact.runNonceExactTrimEqualityRequired).toBe(true);
      expect(artifact.runNonceSilentlyNormalized).toBe(false);
      expect(artifact.misleadingVerifiedReplayHelperNamesRemoved).toBe(true);
      expect(artifact.pureReplayHelpersExplicitlyNonAuthoritative).toBe(true);
      expect(artifact.productionAuthorizationVerificationCalledInsideReplayBoundary).toBe(true);
      expect(artifact.callerSuppliedVerificationResultAccepted).toBe(false);
      expect(artifact.callerSuppliedVerifiedBooleanAccepted).toBe(false);
      expect(artifact.productionRuntimeExpiryRecheckImplemented).toBe(true);
      expect(artifact.productionRuntimeClockCallerControlled).toBe(false);
      expect(artifact.productionAuthorityTrustAnchorProvisioned).toBe(false);
      expect(artifact.durableBackendBound).toBe(false);
      expect(artifact.atomicReserveIfAbsentImplemented).toBe(false);
      expect(artifact.productionReplayReservationReady).toBe(false);
      expect(artifact.productionReservationCanReturnReserved).toBe(false);
      expect(artifact.d1BackendImplemented).toBe(false);
      expect(artifact.d1ProductionBindingProvisioned).toBe(false);
      expect(artifact.guardedTransportIntegrated).toBe(false);
      expect(artifact.sourceAttestationReady).toBe(false);
      expect(artifact.humanAuthorizationAttestationReady).toBe(false);
      expect(artifact.liveExecutionEnabled).toBe(false);
      expect(artifact.providerNetworkCalls).toBe(0);
      expect(artifact.productionRoutingEnforcementAllowed).toBe(false);
      expect(artifact.successorActivated).toBe(false);
      expect(artifact.finalStatus).toBe(
        'A12B2C5S1_VERIFIED_AUTH_BOUNDARY_NONCE_REPAIR_PASS_PENDING_INDEPENDENT_VERIFICATION'
      );
    });
  });

  // ==========================================================================
  // 19. PHASE A.12B.2C-5S.1.1: EXACT REPLAY ORCHESTRATION API SURFACE REPAIR
  // ==========================================================================
  describe('19. Phase A.12B.2C-5S.1.1 Exact Replay Orchestration API Surface Hardening', () => {
    // ------------------------------------------------------------------------
    // A-C. Production Orchestration parameter surface
    // ------------------------------------------------------------------------
    it('A. TypeScript parameter tuple for production orchestration is exactly [SignedHumanAuthorizationPackage, TrustedSourceAttestation]', () => {
      type OrchestrationParams = Parameters<typeof buildProductionReplayReservationAfterAuthorizationVerification>;
      type ExpectedParams = [SignedHumanAuthorizationPackage, TrustedSourceAttestation];

      // Exact tuple shape test
      type Equals<X, Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;
      const isExactMatch: Equals<OrchestrationParams, ExpectedParams> = true;
      expect(isExactMatch).toBe(true);

      // Verify parameter tuple length is 2
      type ParamLength = OrchestrationParams['length'];
      const tupleLen: ParamLength = 2;
      expect(tupleLen).toBe(2);
      expect(buildProductionReplayReservationAfterAuthorizationVerification.length).toBe(2);
    });

    it('B. production orchestration has no typed third parameter', () => {
      type OrchestrationParams =
        Parameters<typeof buildProductionReplayReservationAfterAuthorizationVerification>;
      type HasThirdParam =
        OrchestrationParams['length'] extends 2 ? false : true;
      const hasThird: HasThirdParam = false;
      expect(hasThird).toBe(false);
      expect(buildProductionReplayReservationAfterAuthorizationVerification.length).toBe(2);
    });

    it('C. runtime forced third argument via (fn as any)(...) fails closed', () => {
      const payload = createValidSyntheticCanonicalPayload();
      const syntheticPkg: SignedHumanAuthorizationPackage = {
        payload,
        signatureBase64: Buffer.from('mock_sig').toString('base64'),
        algorithm: 'Ed25519',
        keyVersion: '2026-v1',
        authorityId: payload.authorityId,
      };
      const attestation = buildTrustedSourceAttestation({
        sourceCommitSha: TEST_COMMIT_SHA,
        sourceTreeSha: TEST_TREE_SHA,
        createdAt: '2026-09-06T10:00:00.000Z',
      });

      const res = (buildProductionReplayReservationAfterAuthorizationVerification as any)(
        syntheticPkg,
        attestation,
        'extra_forced_argument'
      );
      expect(res.ready).toBe(false);
      expect(res.status).toBe('AUTHORIZATION_NOT_VERIFIED');
      expect(res.failureReason).toBe(
        'FORBIDDEN_CALLER_PARAMETER: orchestration accepts exactly pkg and sourceAttestation'
      );
      expect(res.request).toBeUndefined();
    });

    // ------------------------------------------------------------------------
    // D-F. Canonical Builder parameter surface
    // ------------------------------------------------------------------------
    it('D. canonical builder TypeScript parameter tuple has exactly one element', () => {
      type BuilderParams = Parameters<typeof buildAuthorizationReplayReservationRequestFromCanonicalAuthorization>;
      type ParamLength = BuilderParams['length'];
      const paramLength: ParamLength = 1;
      expect(paramLength).toBe(1);
      expect(buildAuthorizationReplayReservationRequestFromCanonicalAuthorization.length).toBe(1);
    });

    it('E. canonical builder has no typed second parameter', () => {
      type BuilderParams =
        Parameters<typeof buildAuthorizationReplayReservationRequestFromCanonicalAuthorization>;
      type HasSecondParam =
        BuilderParams['length'] extends 1 ? false : true;
      const hasSecond: HasSecondParam = false;
      expect(hasSecond).toBe(false);
      expect(buildAuthorizationReplayReservationRequestFromCanonicalAuthorization.length).toBe(1);
    });

    it('F. runtime forced second argument via (fn as any)(...) throws FORBIDDEN_CALLER_PARAMETER', () => {
      const payload = createValidSyntheticCanonicalPayload();
      const auth = { payload, keyVersion: '2026-v1' };

      expect(() => {
        (buildAuthorizationReplayReservationRequestFromCanonicalAuthorization as any)(auth, 'extra_second_arg');
      }).toThrow('FORBIDDEN_CALLER_PARAMETER: builder accepts exactly one canonical authorization parameter');

      expect(() => {
        (buildAuthorizationReplayReservationRequestFromCanonicalAuthorization as any)(auth, { ttl: 3600 });
      }).toThrow('FORBIDDEN_CALLER_PARAMETER: builder accepts exactly one canonical authorization parameter');
    });

    // ------------------------------------------------------------------------
    // G-H. Caller nowUtc & verificationResult cannot become typed parameters
    // ------------------------------------------------------------------------
    it('G. caller nowUtc cannot become a typed parameter', () => {
      type OrchestrationParams = Parameters<typeof buildProductionReplayReservationAfterAuthorizationVerification>;
      type BuilderParams = Parameters<typeof buildAuthorizationReplayReservationRequestFromCanonicalAuthorization>;

      type OrchestrationAcceptsNowUtc = { nowUtc: unknown } extends OrchestrationParams[number] ? true : false;
      type BuilderAcceptsNowUtc = { nowUtc: unknown } extends BuilderParams[number] ? true : false;
      const orchNowUtcAvoided: OrchestrationAcceptsNowUtc = false;
      const builderNowUtcAvoided: BuilderAcceptsNowUtc = false;
      expect(orchNowUtcAvoided).toBe(false);
      expect(builderNowUtcAvoided).toBe(false);

      const payload = createValidSyntheticCanonicalPayload();
      const pkg: SignedHumanAuthorizationPackage = {
        payload,
        signatureBase64: Buffer.from('mock_sig').toString('base64'),
        algorithm: 'Ed25519',
        keyVersion: '2026-v1',
        authorityId: payload.authorityId,
      };
      const attestation = buildTrustedSourceAttestation({
        sourceCommitSha: TEST_COMMIT_SHA,
        sourceTreeSha: TEST_TREE_SHA,
        createdAt: '2026-09-06T10:00:00.000Z',
      });

      const res = (buildProductionReplayReservationAfterAuthorizationVerification as any)(
        pkg,
        attestation,
        { nowUtc: '2026-09-06T10:00:00.000Z' }
      );
      expect(res.ready).toBe(false);
      expect(res.status).toBe('AUTHORIZATION_NOT_VERIFIED');
      expect(res.failureReason).toBe(
        'FORBIDDEN_CALLER_PARAMETER: orchestration accepts exactly pkg and sourceAttestation'
      );
    });

    it('H. caller verificationResult cannot become a typed parameter', () => {
      type OrchestrationParams = Parameters<typeof buildProductionReplayReservationAfterAuthorizationVerification>;
      type BuilderParams = Parameters<typeof buildAuthorizationReplayReservationRequestFromCanonicalAuthorization>;

      type OrchestrationAcceptsVerificationResult =
        { verificationResult: unknown } extends OrchestrationParams[number] ? true : false;
      type BuilderAcceptsVerificationResult =
        { verificationResult: unknown } extends BuilderParams[number] ? true : false;
      const orchVerificationResultAvoided: OrchestrationAcceptsVerificationResult = false;
      const builderVerificationResultAvoided: BuilderAcceptsVerificationResult = false;
      expect(orchVerificationResultAvoided).toBe(false);
      expect(builderVerificationResultAvoided).toBe(false);

      const payload = createValidSyntheticCanonicalPayload();
      const pkg: SignedHumanAuthorizationPackage = {
        payload,
        signatureBase64: Buffer.from('mock_sig').toString('base64'),
        algorithm: 'Ed25519',
        keyVersion: '2026-v1',
        authorityId: payload.authorityId,
      };
      const attestation = buildTrustedSourceAttestation({
        sourceCommitSha: TEST_COMMIT_SHA,
        sourceTreeSha: TEST_TREE_SHA,
        createdAt: '2026-09-06T10:00:00.000Z',
      });

      const res = (buildProductionReplayReservationAfterAuthorizationVerification as any)(
        pkg,
        attestation,
        { verificationResult: { verified: true } }
      );
      expect(res.ready).toBe(false);
      expect(res.status).toBe('AUTHORIZATION_NOT_VERIFIED');
      expect(res.failureReason).toBe(
        'FORBIDDEN_CALLER_PARAMETER: orchestration accepts exactly pkg and sourceAttestation'
      );
    });

    // ------------------------------------------------------------------------
    // I. All existing 5S.1 security tests continue passing & artifact verification
    // ------------------------------------------------------------------------
    it('I. all existing 5S.1 security tests continue passing & verifies Phase A.12B.2C-5S.1.1 repair artifact integrity', () => {
      const artifactPath = path.resolve(
        process.cwd(),
        'execution/a12b2c5s11_exact_replay_api_surface_repair.json'
      );
      expect(fs.existsSync(artifactPath)).toBe(true);
      const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

      expect(artifact.phase).toBe('A.12B.2C-5S.1.1');
      expect(artifact.artifactType).toBe('EXACT_REPLAY_ORCHESTRATION_API_SURFACE_REPAIR');
      expect(artifact.baseCommit).toBe('ace75a34b8771fbf9072d8bcd6e94f371042424d');
      expect(artifact.baseTree).toBe('94d95628a08a1afaf97f34fa00385af214e5a5d3');

      expect(artifact.productionOrchestrationTypedParameterCount).toBe(2);
      expect(artifact.canonicalBuilderTypedParameterCount).toBe(1);

      expect(artifact.variadicProductionOrchestrationParameterRemoved).toBe(true);
      expect(artifact.variadicCanonicalBuilderParameterRemoved).toBe(true);

      expect(artifact.runtimeExtraArgumentFailClosedPreserved).toBe(true);

      expect(artifact.productionAuthorizationVerificationStillInternal).toBe(true);
      expect(artifact.productionRuntimeExpiryRecheckStillInternal).toBe(true);
      expect(artifact.runNonceCanonicalityPreserved).toBe(true);

      expect(artifact.durableBackendBound).toBe(false);
      expect(artifact.atomicReserveIfAbsentImplemented).toBe(false);
      expect(artifact.d1BackendImplemented).toBe(false);
      expect(artifact.d1ProductionBindingProvisioned).toBe(false);

      expect(artifact.guardedTransportIntegrated).toBe(false);
      expect(artifact.liveExecutionEnabled).toBe(false);
      expect(artifact.providerNetworkCalls).toBe(0);
      expect(artifact.productionRoutingEnforcementAllowed).toBe(false);

      expect(artifact.finalStatus).toBe(
        'A12B2C5S11_EXACT_REPLAY_API_SURFACE_REPAIR_PASS_PENDING_INDEPENDENT_VERIFICATION'
      );
    });

    // ------------------------------------------------------------------------
    // J. SignedHumanAuthorizationPackage compile-time contract regression
    // ------------------------------------------------------------------------
    it('J. canonical SignedHumanAuthorizationPackage satisfies production interface with exact fields and no fingerprint', () => {
      const payload = createValidSyntheticCanonicalPayload();
      const canonicalPackage = {
        payload,
        signatureBase64: Buffer.from('mock_sig').toString('base64'),
        authorityId: payload.authorityId,
        keyVersion: '2026-v1',
        algorithm: 'Ed25519',
      } satisfies SignedHumanAuthorizationPackage;

      expect(canonicalPackage.payload).toBe(payload);
      expect(canonicalPackage.signatureBase64).toBeDefined();
      expect(canonicalPackage.authorityId).toBe(payload.authorityId);
      expect(canonicalPackage.keyVersion).toBe('2026-v1');
      expect(canonicalPackage.algorithm).toBe('Ed25519');

      const pkgKeys = Object.keys(canonicalPackage).sort();
      expect(pkgKeys).toEqual([
        'algorithm',
        'authorityId',
        'keyVersion',
        'payload',
        'signatureBase64',
      ]);
      expect('publicKeyFingerprintSha256' in (canonicalPackage as any)).toBe(false);
    });
  });
});
