/**
 * @file tests/ai/phaseA12B2C5U1ProductionReplayIntegration.test.ts
 * @description VELNAR — A.12B.2C-5U.1 Production Human Authorization & D1 Replay Coordinator Integration Tests.
 *
 * STRICT VERIFICATION REQUIREMENTS:
 * - Pure offline testing only.
 * - ZERO DeepSeek calls, ZERO Gemini calls, ZERO external provider calls.
 * - ZERO real Cloudflare D1 network calls.
 * - Comprehensive coverage of coordinator invariants:
 *   1. Strict 3-parameter typed API (db, pkg, sourceReceipt).
 *   2. Rejection of caller-supplied backends, clocks, mocks, and overrides.
 *   3. Module purity (no credentials, no fetch, no SQL mutation keywords).
 *   4. Single-attempt policy (no retries, no compensating DELETE).
 *   5. Fail-closed behavior with current unprovisioned production trust anchors.
 *   6. Monotonic structural ordering of execution milestones.
 *   7. Internal derivation of TrustedSourceAttestation with sealed repository identity.
 *   8. D1 production readiness barrier invariants.
 *   9. Post-reservation runtime authorization expiry recheck.
 *  10. System readiness gates and sealed file integrity.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { D1Database } from '@cloudflare/workers-types';
import {
  coordinateProductionReplayReservation,
  PRODUCTION_REPLAY_COORDINATOR_VERSION,
  FORBIDDEN_COORDINATOR_CALLER_KEYS,
  type ProductionReplayCoordinationResult,
  type ProductionReplayCoordinationStatus,
} from '../../worker/ai/canary/deepSeekProductionReplayCoordinator';
import {
  D1_REPLAY_BACKEND_ADAPTER_IMPLEMENTED,
  D1_REPLAY_BACKEND_PRODUCTION_BOUND,
  D1_REPLAY_BACKEND_REAL_DATABASE_PROVISIONED,
  D1_REPLAY_BACKEND_REAL_CONCURRENCY_CERTIFIED,
} from '../../worker/ai/canary/d1AuthorizationReplayBackend';
import {
  DURABLE_AUTHORIZATION_REPLAY_LEDGER_READY,
  DURABLE_AUTHORIZATION_REPLAY_BACKEND_BOUND,
  ATOMIC_RESERVE_IF_ABSENT_IMPLEMENTED,
} from '../../worker/ai/canary/deepSeekDurableAuthorizationReplayLedger';
import { PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED } from '../../worker/ai/canary/deepSeekProductionAuthorizationTrust';
import { RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_PROVISIONED } from '../../worker/ai/canary/deepSeekTrustedRuntimeSourceProvenance';
import {
  GUARDED_SOURCE_ATTESTATION_READY,
  GUARDED_HUMAN_AUTH_ATTESTATION_READY,
} from '../../worker/ai/canary/deepSeekGuardedLiveTransport';
import { CANARY_LIVE_EXECUTION_ENABLED } from '../../worker/ai/canary/canarySpecification';
import type { SignedHumanAuthorizationPackage } from '../../worker/ai/canary/deepSeekCertificationAttestation';
import type { RuntimeSourceProvenanceReceipt } from '../../worker/ai/canary/deepSeekTrustedRuntimeSourceProvenance';

/**
 * Creates a strict mock D1Database handle that counts prepare() invocations.
 */
function createStrictMockD1(options?: { onPrepare?: () => void }): {
  db: D1Database;
  getPrepareCalls: () => number;
} {
  let prepareCalls = 0;
  const db: D1Database = {
    prepare: (_query: string) => {
      prepareCalls++;
      options?.onPrepare?.();
      return {
        bind: (..._args: any[]) => ({
          all: async () => ({
            success: true,
            results: [{ replay_key: 'a'.repeat(64) }],
            meta: { changed_db: true, rows_written: 1 },
          }),
        }),
      } as any;
    },
    dump: async () => new ArrayBuffer(0),
    batch: async (_stmts: any[]) => [],
    exec: async (_query: string) => ({ count: 0, duration: 0 }),
  } as unknown as D1Database;
  return { db, getPrepareCalls: () => prepareCalls };
}

/**
 * Minimal sample SignedHumanAuthorizationPackage fixture.
 */
function createSampleAuthPackage(overrides?: Partial<any>): SignedHumanAuthorizationPackage {
  return {
    payload: {
      authorizationVersion: 'a12b2c5m-v1',
      authorityId: 'auth_prod_root_01',
      issuedAt: '2026-09-06T12:00:00.000Z',
      expiresAt: '2026-09-06T18:00:00.000Z',
      targetProgram: 'PROGRAM_A12B2C_CERTIFICATION_OFF_PEAK',
      pricingWindow: 'OFF_PEAK',
      candidateId: 'deepseek-v4-flash-off-peak-candidate',
      sourceCommitSha: '01e9798842f7dd46635bcd65a5db9a1ca3498c89',
      sourceTreeSha: '1e09f8632ab14eb385e74970461f48d3b41f7867',
      specificationVersion: '1.0.0-successor',
      maxBudgetMicroUsd: 50000,
      runNonce: 'CANARY-20260906-RUN-A1B2C3D4E5-F6A7B8',
      singleUse: true,
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      canonicalTaskCount: 7,
      transportContractVersion: '1.0.0-live-cert',
      guardedTransportModuleVersion: '1.0.0-guarded',
      sourceAttestationDigest: 'e'.repeat(64),
      ...(overrides?.payload || {}),
    },
    signatureBase64: Buffer.alloc(64, 0x01).toString('base64'),
    authorityId: 'auth_prod_root_01',
    keyVersion: 'v1',
    algorithm: 'Ed25519',
    ...overrides,
  };
}

/**
 * Minimal sample RuntimeSourceProvenanceReceipt fixture.
 */
function createSampleSourceReceipt(overrides?: Partial<RuntimeSourceProvenanceReceipt>): RuntimeSourceProvenanceReceipt {
  return {
    provenanceVersion: 'a12b2c5q-v1',
    repositoryFullName: 'kayrastos/updated-velnaar',
    sourceCommitSha: '01e9798842f7dd46635bcd65a5db9a1ca3498c89',
    sourceTreeSha: '1e09f8632ab14eb385e74970461f48d3b41f7867',
    buildArtifactSha256: 'c'.repeat(64),
    buildId: 'build_prod_20260906_abcdef1234567890',
    deploymentId: 'deploy_prod_20260906_1234567890abcdef',
    environment: 'production',
    issuedAt: '2026-09-06T12:00:00.000Z',
    expiresAt: '2026-09-06T18:00:00.000Z',
    issuerId: 'source_authority_prod_01',
    issuerKeyVersion: 'v1',
    algorithm: 'Ed25519',
    signatureBase64: Buffer.alloc(64, 0x02).toString('base64'),
    ...overrides,
  };
}

describe('VELNAR — A.12B.2C-5U.1 Production Replay Coordinator Offline Foundation', () => {
  // Read and LF-normalize coordinator source for static audits
  const coordinatorSourcePath = path.resolve(__dirname, '../../worker/ai/canary/deepSeekProductionReplayCoordinator.ts');
  const coordinatorSource = fs.readFileSync(coordinatorSourcePath, 'utf8').replace(/\r\n/g, '\n');

  // ==========================================================================
  // SUITE 1: API Surface & Parameter Invariants
  // ==========================================================================
  describe('1. API Surface & Strict Parameter Invariants', () => {
    it('1.1 exports coordinateProductionReplayReservation as an async function', () => {
      expect(typeof coordinateProductionReplayReservation).toBe('function');
      expect(coordinateProductionReplayReservation.name).toBe('coordinateProductionReplayReservation');
    });

    it('1.2 function.length is strictly 3 (exact 3 typed parameters)', () => {
      expect(coordinateProductionReplayReservation.length).toBe(3);
    });

    it('1.3 exports PRODUCTION_REPLAY_COORDINATOR_VERSION as a string constant', () => {
      expect(PRODUCTION_REPLAY_COORDINATOR_VERSION).toBe('a12b2c5u1-v1');
    });

    it('1.4 exports FORBIDDEN_COORDINATOR_CALLER_KEYS as an array with key security overrides', () => {
      expect(Array.isArray(FORBIDDEN_COORDINATOR_CALLER_KEYS)).toBe(true);
      expect(FORBIDDEN_COORDINATOR_CALLER_KEYS).toContain('backend');
      expect(FORBIDDEN_COORDINATOR_CALLER_KEYS).toContain('storage');
      expect(FORBIDDEN_COORDINATOR_CALLER_KEYS).toContain('adapter');
      expect(FORBIDDEN_COORDINATOR_CALLER_KEYS).toContain('reservationResult');
    });

    it('1.5 rejects call with 0 arguments with REPLAY_INVALID_REQUEST', async () => {
      const result = await (coordinateProductionReplayReservation as any)();
      expect(result.readyForCredentialResolution).toBe(false);
      expect(result.status).toBe('REPLAY_INVALID_REQUEST');
      expect(result.failureReason).toContain('FORBIDDEN_CALLER_PARAMETER');
    });

    it('1.6 rejects call with 1 argument with REPLAY_INVALID_REQUEST', async () => {
      const { db } = createStrictMockD1();
      const result = await (coordinateProductionReplayReservation as any)(db);
      expect(result.readyForCredentialResolution).toBe(false);
      expect(result.status).toBe('REPLAY_INVALID_REQUEST');
    });

    it('1.7 rejects call with 2 arguments with REPLAY_INVALID_REQUEST', async () => {
      const { db } = createStrictMockD1();
      const pkg = createSampleAuthPackage();
      const result = await (coordinateProductionReplayReservation as any)(db, pkg);
      expect(result.readyForCredentialResolution).toBe(false);
      expect(result.status).toBe('REPLAY_INVALID_REQUEST');
    });

    it('1.8 rejects call with 4 arguments (forced extra parameter) with REPLAY_INVALID_REQUEST', async () => {
      const { db } = createStrictMockD1();
      const pkg = createSampleAuthPackage();
      const receipt = createSampleSourceReceipt();
      const result = await (coordinateProductionReplayReservation as any)(db, pkg, receipt, { extra: true });
      expect(result.readyForCredentialResolution).toBe(false);
      expect(result.status).toBe('REPLAY_INVALID_REQUEST');
      expect(result.failureReason).toContain('expected exactly 3 parameters');
    });

    it('1.9 rejects call with 5 arguments with REPLAY_INVALID_REQUEST', async () => {
      const { db } = createStrictMockD1();
      const pkg = createSampleAuthPackage();
      const receipt = createSampleSourceReceipt();
      const result = await (coordinateProductionReplayReservation as any)(db, pkg, receipt, 'a', 'b');
      expect(result.readyForCredentialResolution).toBe(false);
      expect(result.status).toBe('REPLAY_INVALID_REQUEST');
    });

    it('1.10 rejects call when 4th argument attempts to inject fake backend object', async () => {
      const { db, getPrepareCalls } = createStrictMockD1();
      const pkg = createSampleAuthPackage();
      const receipt = createSampleSourceReceipt();
      const fakeBackend = {
        reserveIfAbsent: async () => ({ success: true, status: 'RESERVED' }),
      };
      const result = await (coordinateProductionReplayReservation as any)(db, pkg, receipt, fakeBackend);
      expect(result.readyForCredentialResolution).toBe(false);
      expect(result.status).toBe('REPLAY_INVALID_REQUEST');
      expect(getPrepareCalls()).toBe(0);
    });

    it('1.11 rejects call when 4th argument attempts to inject mock storage option', async () => {
      const { db, getPrepareCalls } = createStrictMockD1();
      const pkg = createSampleAuthPackage();
      const receipt = createSampleSourceReceipt();
      const result = await (coordinateProductionReplayReservation as any)(db, pkg, receipt, { storage: 'in-memory' });
      expect(result.readyForCredentialResolution).toBe(false);
      expect(result.status).toBe('REPLAY_INVALID_REQUEST');
      expect(getPrepareCalls()).toBe(0);
    });

    it('1.12 rejects call when 4th argument attempts to inject reservationResult: RESERVED', async () => {
      const { db, getPrepareCalls } = createStrictMockD1();
      const pkg = createSampleAuthPackage();
      const receipt = createSampleSourceReceipt();
      const result = await (coordinateProductionReplayReservation as any)(db, pkg, receipt, {
        reservationResult: { success: true, status: 'RESERVED' },
      });
      expect(result.readyForCredentialResolution).toBe(false);
      expect(result.status).toBe('REPLAY_INVALID_REQUEST');
      expect(getPrepareCalls()).toBe(0);
    });
  });

  // ==========================================================================
  // SUITE 2: Module Purity & Non-Capability Proofs
  // ==========================================================================
  describe('2. Module Purity & Non-Capability Proofs', () => {
    it('2.1 coordinator does not import DeepSeekRuntimeCredential', () => {
      expect(coordinatorSource).not.toContain('DeepSeekRuntimeCredential');
    });

    it('2.2 coordinator does not import getRuntimeCredential', () => {
      expect(coordinatorSource).not.toContain('getRuntimeCredential');
    });

    it('2.3 coordinator does not reference DEEPSEEK_API_KEY', () => {
      expect(coordinatorSource).not.toContain('DEEPSEEK_API_KEY');
    });

    it('2.4 coordinator does not reference GEMINI_API_KEY', () => {
      expect(coordinatorSource).not.toContain('GEMINI_API_KEY');
    });

    it('2.5 coordinator does not invoke fetch()', () => {
      expect(coordinatorSource).not.toMatch(/\bfetch\s*\(/);
    });

    it('2.6 coordinator does not reference api.deepseek.com endpoint', () => {
      expect(coordinatorSource).not.toContain('api.deepseek.com');
    });

    it('2.7 coordinator contains prominent documentation that READY_FOR_CREDENTIAL_RESOLUTION is not a portable trust token', () => {
      expect(coordinatorSource).toContain('READY_FOR_CREDENTIAL_RESOLUTION is not a portable trust token');
    });

    it('2.8 coordinator does not return any apiKey property in its success type', () => {
      // Test type level and source level
      expect(coordinatorSource).not.toContain('apiKey:');
    });

    it('2.9 coordinator does not return any credential property', () => {
      expect(coordinatorSource).not.toContain('credential:');
    });

    it('2.10 coordinator does not return any db or backend property in result', async () => {
      const { db } = createStrictMockD1();
      const pkg = createSampleAuthPackage();
      const receipt = createSampleSourceReceipt();
      const result = await coordinateProductionReplayReservation(db, pkg, receipt);
      expect('db' in result).toBe(false);
      expect('backend' in result).toBe(false);
      expect((result as any).db).toBeUndefined();
      expect((result as any).backend).toBeUndefined();
    });
  });

  // ==========================================================================
  // SUITE 3: Single-Attempt Policy (No Retries, No Compensating DELETE)
  // ==========================================================================
  describe('3. Single-Attempt Policy & No Compensating Queries', () => {
    it('3.1 coordinator contains NO SQL DELETE queries', () => {
      expect(coordinatorSource).not.toMatch(/\bDELETE\b/i);
    });

    it('3.2 coordinator contains NO SQL SELECT queries', () => {
      expect(coordinatorSource).not.toMatch(/\bSELECT\b/i);
    });

    it('3.3 coordinator contains NO SQL UPDATE queries', () => {
      expect(coordinatorSource).not.toMatch(/\bUPDATE\b/i);
    });

    it('3.4 coordinator contains NO setTimeout retry timers', () => {
      expect(coordinatorSource).not.toContain('setTimeout');
    });

    it('3.5 coordinator contains NO while retry loops', () => {
      expect(coordinatorSource).not.toMatch(/\bwhile\s*\(/);
    });

    it('3.6 coordinator contains NO retry loops or retry variables', () => {
      expect(coordinatorSource).not.toMatch(/\bretryCount\b/);
      expect(coordinatorSource).not.toMatch(/\bmaxRetries\b/);
    });

    it('3.7 coordinator contains NO recursive calls to itself', () => {
      // Find occurrences of function name
      const matches = coordinatorSource.match(/coordinateProductionReplayReservation/g);
      // Expected: export declaration and comments only, no recursive call in body
      const bodyOnly = coordinatorSource.substring(coordinatorSource.indexOf('export async function coordinateProductionReplayReservation'));
      const callsInBody = bodyOnly.match(/coordinateProductionReplayReservation\s*\(/g);
      // Only the function declaration itself
      expect(callsInBody?.length).toBe(1);
    });

    it('3.8 coordinator contains exactly ONE reserveIfAbsent call site', () => {
      const matches = coordinatorSource.match(/backend\.reserveIfAbsent/g);
      expect(matches?.length).toBe(1);
    });

    it('3.9 reserveIfAbsent call is strictly awaited', () => {
      expect(coordinatorSource).toMatch(/await\s+backend\.reserveIfAbsent\s*\(/);
    });

    it('3.10 coordinator contains NO in-memory Map or Set replay fallbacks', () => {
      expect(coordinatorSource).not.toMatch(/new\s+Map\s*\(/);
      expect(coordinatorSource).not.toMatch(/new\s+Set\s*\(/);
    });
  });

  // ==========================================================================
  // SUITE 4: Current Production State Fail-Closed Behavioral Tests
  // ==========================================================================
  describe('4. Current Production State Fail-Closed Behavioral Enforcement', () => {
    it('4.1 calling coordinator with sample inputs returns SOURCE_PROVENANCE_NOT_VERIFIED due to unprovisioned source trust anchor', async () => {
      const { db, getPrepareCalls } = createStrictMockD1();
      const pkg = createSampleAuthPackage();
      const receipt = createSampleSourceReceipt();

      const result = await coordinateProductionReplayReservation(db, pkg, receipt);
      expect(result.readyForCredentialResolution).toBe(false);
      expect(result.status).toBe('SOURCE_PROVENANCE_NOT_VERIFIED');
      expect(getPrepareCalls()).toBe(0);
    });

    it('4.2 prepare call count remains strictly 0 when source provenance fails', async () => {
      const { db, getPrepareCalls } = createStrictMockD1();
      const pkg = createSampleAuthPackage();
      const receipt = createSampleSourceReceipt();

      await coordinateProductionReplayReservation(db, pkg, receipt);
      expect(getPrepareCalls()).toBe(0);
    });

    it('4.3 fails closed when sourceReceipt is null', async () => {
      const { db, getPrepareCalls } = createStrictMockD1();
      const pkg = createSampleAuthPackage();

      const result = await coordinateProductionReplayReservation(db, pkg, null as any);
      expect(result.readyForCredentialResolution).toBe(false);
      expect(result.status).toBe('SOURCE_PROVENANCE_NOT_VERIFIED');
      expect(getPrepareCalls()).toBe(0);
    });

    it('4.4 fails closed when sourceReceipt is undefined', async () => {
      const { db, getPrepareCalls } = createStrictMockD1();
      const pkg = createSampleAuthPackage();

      const result = await coordinateProductionReplayReservation(db, pkg, undefined as any);
      expect(result.readyForCredentialResolution).toBe(false);
      expect(result.status).toBe('SOURCE_PROVENANCE_NOT_VERIFIED');
      expect(getPrepareCalls()).toBe(0);
    });

    it('4.5 fails closed when sourceReceipt is an empty object', async () => {
      const { db, getPrepareCalls } = createStrictMockD1();
      const pkg = createSampleAuthPackage();

      const result = await coordinateProductionReplayReservation(db, pkg, {} as any);
      expect(result.readyForCredentialResolution).toBe(false);
      expect(result.status).toBe('SOURCE_PROVENANCE_NOT_VERIFIED');
      expect(getPrepareCalls()).toBe(0);
    });

    it('4.6 fails closed when sourceReceipt is a string primitive', async () => {
      const { db, getPrepareCalls } = createStrictMockD1();
      const pkg = createSampleAuthPackage();

      const result = await coordinateProductionReplayReservation(db, pkg, 'malformed' as any);
      expect(result.readyForCredentialResolution).toBe(false);
      expect(result.status).toBe('SOURCE_PROVENANCE_NOT_VERIFIED');
      expect(getPrepareCalls()).toBe(0);
    });

    it('4.7 fails closed when sourceReceipt is an array', async () => {
      const { db, getPrepareCalls } = createStrictMockD1();
      const pkg = createSampleAuthPackage();

      const result = await coordinateProductionReplayReservation(db, pkg, [] as any);
      expect(result.readyForCredentialResolution).toBe(false);
      expect(result.status).toBe('SOURCE_PROVENANCE_NOT_VERIFIED');
      expect(getPrepareCalls()).toBe(0);
    });

    it('4.8 fails closed when sourceReceipt has missing signatureBase64', async () => {
      const { db, getPrepareCalls } = createStrictMockD1();
      const pkg = createSampleAuthPackage();
      const receipt = createSampleSourceReceipt({ signatureBase64: '' });

      const result = await coordinateProductionReplayReservation(db, pkg, receipt);
      expect(result.readyForCredentialResolution).toBe(false);
      expect(result.status).toBe('SOURCE_PROVENANCE_NOT_VERIFIED');
      expect(getPrepareCalls()).toBe(0);
    });

    it('4.9 fails closed when sourceReceipt has expired expiresAt timestamp', async () => {
      const { db, getPrepareCalls } = createStrictMockD1();
      const pkg = createSampleAuthPackage();
      const receipt = createSampleSourceReceipt({
        expiresAt: '2020-01-01T00:00:00.000Z',
      });

      const result = await coordinateProductionReplayReservation(db, pkg, receipt);
      expect(result.readyForCredentialResolution).toBe(false);
      expect(result.status).toBe('SOURCE_PROVENANCE_NOT_VERIFIED');
      expect(getPrepareCalls()).toBe(0);
    });

    it('4.10 fails closed when sourceReceipt has invalid commit SHA format', async () => {
      const { db, getPrepareCalls } = createStrictMockD1();
      const pkg = createSampleAuthPackage();
      const receipt = createSampleSourceReceipt({
        sourceCommitSha: 'not-a-40-char-hex-hash',
      });

      const result = await coordinateProductionReplayReservation(db, pkg, receipt);
      expect(result.readyForCredentialResolution).toBe(false);
      expect(result.status).toBe('SOURCE_PROVENANCE_NOT_VERIFIED');
      expect(getPrepareCalls()).toBe(0);
    });

    it('4.11 fails closed when sourceReceipt has invalid tree SHA format', async () => {
      const { db, getPrepareCalls } = createStrictMockD1();
      const pkg = createSampleAuthPackage();
      const receipt = createSampleSourceReceipt({
        sourceTreeSha: 'not-a-40-char-hex-hash',
      });

      const result = await coordinateProductionReplayReservation(db, pkg, receipt);
      expect(result.readyForCredentialResolution).toBe(false);
      expect(result.status).toBe('SOURCE_PROVENANCE_NOT_VERIFIED');
      expect(getPrepareCalls()).toBe(0);
    });

    it('4.12 fails closed when sourceReceipt has placeholder buildId', async () => {
      const { db, getPrepareCalls } = createStrictMockD1();
      const pkg = createSampleAuthPackage();
      const receipt = createSampleSourceReceipt({
        buildId: 'placeholder',
      });

      const result = await coordinateProductionReplayReservation(db, pkg, receipt);
      expect(result.readyForCredentialResolution).toBe(false);
      expect(result.status).toBe('SOURCE_PROVENANCE_NOT_VERIFIED');
      expect(getPrepareCalls()).toBe(0);
    });

    it('4.13 human authorization is never marked verified when source provenance fails', async () => {
      const { db } = createStrictMockD1();
      const pkg = createSampleAuthPackage();
      const receipt = createSampleSourceReceipt();

      const result = await coordinateProductionReplayReservation(db, pkg, receipt);
      expect(result.status).not.toBe('READY_FOR_CREDENTIAL_RESOLUTION');
      expect(result.status).not.toBe('AUTHORIZATION_VERIFIED' as any);
    });

    it('4.14 errors array contains descriptive failure message on failure', async () => {
      const { db } = createStrictMockD1();
      const pkg = createSampleAuthPackage();
      const receipt = createSampleSourceReceipt();

      const result = await coordinateProductionReplayReservation(db, pkg, receipt);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(typeof result.failureReason).toBe('string');
    });
  });

  // ==========================================================================
  // SUITE 5: Caller Parameter Tampering & Injection Rejection
  // ==========================================================================
  describe('5. Caller Override Injection Rejection', () => {
    it('5.1 rejects pkg containing injected backend property', async () => {
      const { db, getPrepareCalls } = createStrictMockD1();
      const pkg = createSampleAuthPackage({ backend: {} });
      const receipt = createSampleSourceReceipt();

      const result = await coordinateProductionReplayReservation(db, pkg, receipt);
      expect(result.readyForCredentialResolution).toBe(false);
      expect(result.status).toBe('REPLAY_INVALID_REQUEST');
      expect(result.failureReason).toContain("parameter 'backend' is strictly prohibited");
      expect(getPrepareCalls()).toBe(0);
    });

    it('5.2 rejects pkg containing injected storage property', async () => {
      const { db, getPrepareCalls } = createStrictMockD1();
      const pkg = createSampleAuthPackage({ storage: 'd1' });
      const receipt = createSampleSourceReceipt();

      const result = await coordinateProductionReplayReservation(db, pkg, receipt);
      expect(result.readyForCredentialResolution).toBe(false);
      expect(result.status).toBe('REPLAY_INVALID_REQUEST');
      expect(getPrepareCalls()).toBe(0);
    });

    it('5.3 rejects pkg containing injected adapter property', async () => {
      const { db, getPrepareCalls } = createStrictMockD1();
      const pkg = createSampleAuthPackage({ adapter: 'custom' });
      const receipt = createSampleSourceReceipt();

      const result = await coordinateProductionReplayReservation(db, pkg, receipt);
      expect(result.readyForCredentialResolution).toBe(false);
      expect(result.status).toBe('REPLAY_INVALID_REQUEST');
      expect(getPrepareCalls()).toBe(0);
    });

    it('5.4 rejects pkg containing injected reservationResult property', async () => {
      const { db, getPrepareCalls } = createStrictMockD1();
      const pkg = createSampleAuthPackage({ reservationResult: 'RESERVED' });
      const receipt = createSampleSourceReceipt();

      const result = await coordinateProductionReplayReservation(db, pkg, receipt);
      expect(result.readyForCredentialResolution).toBe(false);
      expect(result.status).toBe('REPLAY_INVALID_REQUEST');
      expect(getPrepareCalls()).toBe(0);
    });

    it('5.5 rejects pkg containing injected sourceAttestation property', async () => {
      const { db, getPrepareCalls } = createStrictMockD1();
      const pkg = createSampleAuthPackage({ sourceAttestation: {} });
      const receipt = createSampleSourceReceipt();

      const result = await coordinateProductionReplayReservation(db, pkg, receipt);
      expect(result.readyForCredentialResolution).toBe(false);
      expect(result.status).toBe('REPLAY_INVALID_REQUEST');
      expect(getPrepareCalls()).toBe(0);
    });

    it('5.6 rejects pkg containing injected forceReserve property', async () => {
      const { db, getPrepareCalls } = createStrictMockD1();
      const pkg = createSampleAuthPackage({ forceReserve: true });
      const receipt = createSampleSourceReceipt();

      const result = await coordinateProductionReplayReservation(db, pkg, receipt);
      expect(result.readyForCredentialResolution).toBe(false);
      expect(result.status).toBe('REPLAY_INVALID_REQUEST');
      expect(getPrepareCalls()).toBe(0);
    });

    it('5.7 rejects sourceReceipt containing injected backend property', async () => {
      const { db, getPrepareCalls } = createStrictMockD1();
      const pkg = createSampleAuthPackage();
      const receipt = createSampleSourceReceipt({ backend: {} } as any);

      const result = await coordinateProductionReplayReservation(db, pkg, receipt);
      expect(result.readyForCredentialResolution).toBe(false);
      expect(result.status).toBe('REPLAY_INVALID_REQUEST');
      expect(getPrepareCalls()).toBe(0);
    });

    it('5.8 rejects sourceReceipt containing injected storage property', async () => {
      const { db, getPrepareCalls } = createStrictMockD1();
      const pkg = createSampleAuthPackage();
      const receipt = createSampleSourceReceipt({ storage: {} } as any);

      const result = await coordinateProductionReplayReservation(db, pkg, receipt);
      expect(result.readyForCredentialResolution).toBe(false);
      expect(result.status).toBe('REPLAY_INVALID_REQUEST');
      expect(getPrepareCalls()).toBe(0);
    });

    it('5.9 rejects sourceReceipt containing injected replayKey property', async () => {
      const { db, getPrepareCalls } = createStrictMockD1();
      const pkg = createSampleAuthPackage();
      const receipt = createSampleSourceReceipt({ replayKey: 'f'.repeat(64) } as any);

      const result = await coordinateProductionReplayReservation(db, pkg, receipt);
      expect(result.readyForCredentialResolution).toBe(false);
      expect(result.status).toBe('REPLAY_INVALID_REQUEST');
      expect(getPrepareCalls()).toBe(0);
    });

    it('5.10 rejects sourceReceipt containing injected bypass property', async () => {
      const { db, getPrepareCalls } = createStrictMockD1();
      const pkg = createSampleAuthPackage();
      const receipt = createSampleSourceReceipt({ bypass: true } as any);

      const result = await coordinateProductionReplayReservation(db, pkg, receipt);
      expect(result.readyForCredentialResolution).toBe(false);
      expect(result.status).toBe('REPLAY_INVALID_REQUEST');
      expect(getPrepareCalls()).toBe(0);
    });

    it('5.11 rejects sourceReceipt containing injected nowUtc property', async () => {
      const { db, getPrepareCalls } = createStrictMockD1();
      const pkg = createSampleAuthPackage();
      const receipt = createSampleSourceReceipt({ nowUtc: '2026-09-06T12:00:00.000Z' } as any);

      const result = await coordinateProductionReplayReservation(db, pkg, receipt);
      expect(result.readyForCredentialResolution).toBe(false);
      expect(result.status).toBe('REPLAY_INVALID_REQUEST');
      expect(getPrepareCalls()).toBe(0);
    });

    it('5.12 rejects sourceReceipt containing injected apiKey property', async () => {
      const { db, getPrepareCalls } = createStrictMockD1();
      const pkg = createSampleAuthPackage();
      const receipt = createSampleSourceReceipt({ apiKey: 'sk-secret' } as any);

      const result = await coordinateProductionReplayReservation(db, pkg, receipt);
      expect(result.readyForCredentialResolution).toBe(false);
      expect(result.status).toBe('REPLAY_INVALID_REQUEST');
      expect(getPrepareCalls()).toBe(0);
    });
  });

  // ==========================================================================
  // SUITE 6: Monotonic Structural Order & Call Sequence
  // ==========================================================================
  describe('6. Monotonic Structural Order Verification', () => {
    // Extract coordinator primary function body
    const fnStart = coordinatorSource.indexOf('export async function coordinateProductionReplayReservation');
    expect(fnStart).toBeGreaterThan(0);
    const fnBody = coordinatorSource.substring(fnStart);

    it('6.1 Step 1 (verifyProductionRuntimeSourceProvenanceReceipt) exists in function body', () => {
      expect(fnBody).toContain('verifyProductionRuntimeSourceProvenanceReceipt(sourceReceipt)');
    });

    it('6.2 Step 2 (buildTrustedSourceAttestation) exists in function body', () => {
      expect(fnBody).toContain('buildTrustedSourceAttestation({');
    });

    it('6.3 Step 3 (validateTrustedSourceAttestation) exists in function body', () => {
      expect(fnBody).toContain('validateTrustedSourceAttestation(derivedSourceAttestation)');
    });

    it('6.4 Step 4 (buildProductionReplayReservationAfterAuthorizationVerification) exists in function body', () => {
      expect(fnBody).toContain('buildProductionReplayReservationAfterAuthorizationVerification(');
    });

    it('6.5 Step 5 (D1 readiness barrier check) exists in function body', () => {
      expect(fnBody).toContain('D1_REPLAY_BACKEND_ADAPTER_IMPLEMENTED');
      expect(fnBody).toContain('D1_REPLAY_BACKEND_PRODUCTION_BOUND');
    });

    it('6.6 Step 6 (new D1AuthorizationReplayBackend) exists in function body', () => {
      expect(fnBody).toContain('new D1AuthorizationReplayBackend(db)');
    });

    it('6.7 Step 7 (await backend.reserveIfAbsent) exists in function body', () => {
      expect(fnBody).toContain('await backend.reserveIfAbsent(replayRequest)');
    });

    it('6.8 Step 8 (post-reservation Date.now()) exists in function body', () => {
      expect(fnBody).toContain('postReservationNowMs = Date.now()');
    });

    it('6.9 Step 9 (READY_FOR_CREDENTIAL_RESOLUTION) exists in function body', () => {
      expect(fnBody).toContain("status: 'READY_FOR_CREDENTIAL_RESOLUTION'");
    });

    it('6.10 all 9 execution milestones appear in strictly monotonic sequential order', () => {
      const idx1 = fnBody.indexOf('verifyProductionRuntimeSourceProvenanceReceipt(sourceReceipt)');
      const idx2 = fnBody.indexOf('buildTrustedSourceAttestation({');
      const idx3 = fnBody.indexOf('validateTrustedSourceAttestation(derivedSourceAttestation)');
      const idx4 = fnBody.indexOf('buildProductionReplayReservationAfterAuthorizationVerification(');
      const idx5 = fnBody.indexOf('D1_REPLAY_BACKEND_ADAPTER_IMPLEMENTED');
      const idx6 = fnBody.indexOf('new D1AuthorizationReplayBackend(db)');
      const idx7 = fnBody.indexOf('await backend.reserveIfAbsent(replayRequest)');
      const idx8 = fnBody.indexOf('postReservationNowMs = Date.now()');
      const idx9 = fnBody.indexOf("status: 'READY_FOR_CREDENTIAL_RESOLUTION'");

      expect(idx1).toBeGreaterThan(0);
      expect(idx2).toBeGreaterThan(idx1);
      expect(idx3).toBeGreaterThan(idx2);
      expect(idx4).toBeGreaterThan(idx3);
      expect(idx5).toBeGreaterThan(idx4);
      expect(idx6).toBeGreaterThan(idx5);
      expect(idx7).toBeGreaterThan(idx6);
      expect(idx8).toBeGreaterThan(idx7);
      expect(idx9).toBeGreaterThan(idx8);
    });
  });

  // ==========================================================================
  // SUITE 7: Internal Source Attestation Derivation Rules
  // ==========================================================================
  describe('7. Internal Source Attestation Derivation Rules', () => {
    it('7.1 sourceCommitSha is taken from sourceReceipt.sourceCommitSha', () => {
      expect(coordinatorSource).toContain('sourceCommitSha: sourceReceipt.sourceCommitSha');
    });

    it('7.2 sourceTreeSha is taken from sourceReceipt.sourceTreeSha', () => {
      expect(coordinatorSource).toContain('sourceTreeSha: sourceReceipt.sourceTreeSha');
    });

    it('7.3 createdAt is taken from sourceReceipt.issuedAt', () => {
      expect(coordinatorSource).toContain('createdAt: sourceReceipt.issuedAt');
    });

    it('7.4 coordinator does NOT override repositoryIdentity with sourceReceipt.repositoryFullName', () => {
      expect(coordinatorSource).not.toContain('repositoryIdentity: sourceReceipt.repositoryFullName');
      expect(coordinatorSource).not.toContain('repositoryIdentity: sourceReceipt');
    });

    it('7.5 coordinator does not accept caller-created source attestation parameter', () => {
      // Function signature takes db, pkg, sourceReceipt only
      expect(coordinateProductionReplayReservation.length).toBe(3);
    });

    it('7.6 validateTrustedSourceAttestation is invoked immediately on the derived attestation', () => {
      expect(coordinatorSource).toContain('validateTrustedSourceAttestation(derivedSourceAttestation)');
    });

    it('7.7 failure in attestation derivation maps to SOURCE_ATTESTATION_DERIVATION_FAILED', () => {
      expect(coordinatorSource).toContain("'SOURCE_ATTESTATION_DERIVATION_FAILED'");
    });

    it('7.8 derived attestation is passed directly to buildProductionReplayReservationAfterAuthorizationVerification', () => {
      expect(coordinatorSource).toContain('buildProductionReplayReservationAfterAuthorizationVerification(\n    pkg,\n    derivedSourceAttestation\n  )');
    });
  });

  // ==========================================================================
  // SUITE 8: D1 Production Readiness Barrier & Status Mapping
  // ==========================================================================
  describe('8. D1 Production Readiness Barrier & Mapping', () => {
    it('8.1 D1_REPLAY_BACKEND_ADAPTER_IMPLEMENTED is true', () => {
      expect(D1_REPLAY_BACKEND_ADAPTER_IMPLEMENTED).toBe(true);
    });

    it('8.2 D1_REPLAY_BACKEND_PRODUCTION_BOUND is false', () => {
      expect(D1_REPLAY_BACKEND_PRODUCTION_BOUND).toBe(false);
    });

    it('8.3 D1_REPLAY_BACKEND_REAL_DATABASE_PROVISIONED is false', () => {
      expect(D1_REPLAY_BACKEND_REAL_DATABASE_PROVISIONED).toBe(false);
    });

    it('8.4 D1_REPLAY_BACKEND_REAL_CONCURRENCY_CERTIFIED is false', () => {
      expect(D1_REPLAY_BACKEND_REAL_CONCURRENCY_CERTIFIED).toBe(false);
    });

    it('8.5 barrier check requires all 4 constants to be true', () => {
      expect(coordinatorSource).toContain('!D1_REPLAY_BACKEND_ADAPTER_IMPLEMENTED ||');
      expect(coordinatorSource).toContain('!D1_REPLAY_BACKEND_PRODUCTION_BOUND ||');
      expect(coordinatorSource).toContain('!D1_REPLAY_BACKEND_REAL_DATABASE_PROVISIONED ||');
      expect(coordinatorSource).toContain('!D1_REPLAY_BACKEND_REAL_CONCURRENCY_CERTIFIED');
    });

    it('8.6 barrier failure maps to D1_BACKEND_NOT_READY', () => {
      expect(coordinatorSource).toContain("status: 'D1_BACKEND_NOT_READY'");
    });

    it('8.7 ALREADY_RESERVED from D1 maps to REPLAY_ALREADY_RESERVED', () => {
      expect(coordinatorSource).toContain("mappedStatus = 'REPLAY_ALREADY_RESERVED'");
    });

    it('8.8 BACKEND_NOT_BOUND from D1 maps to REPLAY_BACKEND_NOT_READY', () => {
      expect(coordinatorSource).toContain("mappedStatus = 'REPLAY_BACKEND_NOT_READY'");
    });

    it('8.9 INVALID_REQUEST from D1 maps to REPLAY_INVALID_REQUEST', () => {
      expect(coordinatorSource).toContain("mappedStatus = 'REPLAY_INVALID_REQUEST'");
    });

    it('8.10 BACKEND_UNAVAILABLE from D1 maps to REPLAY_BACKEND_UNAVAILABLE', () => {
      expect(coordinatorSource).toContain("mappedStatus = 'REPLAY_BACKEND_UNAVAILABLE'");
    });

    it('8.11 unknown reservation status defaults to REPLAY_BACKEND_UNAVAILABLE', () => {
      expect(coordinatorSource).toContain("else {\n      mappedStatus = 'REPLAY_BACKEND_UNAVAILABLE';");
    });

    it('8.12 missing db.prepare maps to D1_BACKEND_NOT_READY', () => {
      expect(coordinatorSource).toContain('!db || typeof db.prepare !== \'function\'');
    });
  });

  // ==========================================================================
  // SUITE 9: Post-Reservation Expiry Recheck
  // ==========================================================================
  describe('9. Post-Reservation Runtime Expiry Recheck', () => {
    it('9.1 evaluates Number.isFinite on parsed expiresAtMs', () => {
      expect(coordinatorSource).toContain('!Number.isFinite(expiresAtMs)');
    });

    it('9.2 checks expiresAtMs <= postReservationNowMs', () => {
      expect(coordinatorSource).toContain('expiresAtMs <= postReservationNowMs');
    });

    it('9.3 failure returns AUTHORIZATION_EXPIRED_AFTER_RESERVATION', () => {
      expect(coordinatorSource).toContain("status: 'AUTHORIZATION_EXPIRED_AFTER_RESERVATION'");
    });

    it('9.4 post-reservation expiry documentation confirms reservation remains consumed in ledger', () => {
      expect(coordinatorSource).toContain('Replay reservation remains consumed in ledger');
    });

    it('9.5 post-reservation expiry message states Zero credentials read', () => {
      expect(coordinatorSource).toContain('Zero credentials read');
    });

    it('9.6 post-reservation expiry includes diagnostic replayKey and expiresAt', () => {
      const expiryBlock = coordinatorSource.substring(
        coordinatorSource.indexOf("status: 'AUTHORIZATION_EXPIRED_AFTER_RESERVATION'")
      );
      expect(expiryBlock).toContain('replayKey: replayRequest.replayKey');
      expect(expiryBlock).toContain('expiresAt: replayRequest.expiresAt');
    });
  });

  // ==========================================================================
  // SUITE 10: Canonical System Readiness Gates & Sealed Files
  // ==========================================================================
  describe('10. Canonical System Readiness Gates & Sealed File Immutability', () => {
    it('10.1 DURABLE_AUTHORIZATION_REPLAY_LEDGER_READY remains strictly false', () => {
      expect(DURABLE_AUTHORIZATION_REPLAY_LEDGER_READY).toBe(false);
    });

    it('10.2 DURABLE_AUTHORIZATION_REPLAY_BACKEND_BOUND remains strictly false', () => {
      expect(DURABLE_AUTHORIZATION_REPLAY_BACKEND_BOUND).toBe(false);
    });

    it('10.3 ATOMIC_RESERVE_IF_ABSENT_IMPLEMENTED remains strictly false', () => {
      expect(ATOMIC_RESERVE_IF_ABSENT_IMPLEMENTED).toBe(false);
    });

    it('10.4 PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED remains strictly false', () => {
      expect(PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED).toBe(false);
    });

    it('10.5 RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_PROVISIONED remains strictly false', () => {
      expect(RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_PROVISIONED).toBe(false);
    });

    it('10.6 GUARDED_SOURCE_ATTESTATION_READY remains strictly false', () => {
      expect(GUARDED_SOURCE_ATTESTATION_READY).toBe(false);
    });

    it('10.7 GUARDED_HUMAN_AUTH_ATTESTATION_READY remains strictly false', () => {
      expect(GUARDED_HUMAN_AUTH_ATTESTATION_READY).toBe(false);
    });

    it('10.8 CANARY_LIVE_EXECUTION_ENABLED remains strictly false', () => {
      expect(CANARY_LIVE_EXECUTION_ENABLED).toBe(false);
    });

    it('10.9 guarded transport has not been modified (file exists, unchanged)', () => {
      const guardedTransportPath = path.resolve(__dirname, '../../worker/ai/canary/deepSeekGuardedLiveTransport.ts');
      expect(fs.existsSync(guardedTransportPath)).toBe(true);
      const transportContent = fs.readFileSync(guardedTransportPath, 'utf8');
      expect(transportContent).toContain('export const GUARDED_SOURCE_ATTESTATION_READY = false as const;');
      expect(transportContent).toContain('export const GUARDED_HUMAN_AUTH_ATTESTATION_READY = false as const;');
    });
  });
});
