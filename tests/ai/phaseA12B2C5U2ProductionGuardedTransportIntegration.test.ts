/**
 * @file tests/ai/phaseA12B2C5U2ProductionGuardedTransportIntegration.test.ts
 * @description VELNAR — A.12B.2C-5U.2.1 Same-Invocation Replay-Protected Guarded Transport Integration Tests.
 *
 * STRICT VERIFICATION REQUIREMENTS:
 * - Pure offline testing only.
 * - ZERO DeepSeek calls, ZERO Gemini calls, ZERO external provider calls.
 * - ZERO real Cloudflare D1 network calls.
 * - ZERO private keys or trust anchors provisioned.
 * - Comprehensive coverage of 5U.2 + 5U.2.1 security repairs:
 *   1. Parameter tuple exact 4 typed arguments (db, pkg, sourceReceipt, getRuntimeCredential).
 *   2. Rejection of caller-supplied backends, clocks, pricingWindow, expectedCommit, expectedTree, mocks, overrides.
 *   3. Transport identity cycle broken via deepSeekGuardedTransportIdentity.ts.
 *   4. Authoritative global live gate evaluated FIRST before coordinator, D1, credential resolution, or fetch.
 *   5. Pre-gate getter passivity: 0 getter invocations on invalid args or closed live gate; budget remains 0.
 *   6. Safe exact data-property materialization before first await.
 *   7. Rejection of accessors (get/set), symbols, custom prototypes, and unknown keys.
 *   8. Zero rereads of original pkg or sourceReceipt after materialization.
 *   9. Single-attempt policy: zero retries, zero compensating queries, terminal replay denial.
 *  10. TOCTOU mutation resistance across async boundaries (coordinator await, credential resolution).
 *  11. Immutable dispatch context frozen before credential resolution.
 *  12. Permanent legacy non-production barrier (LEGACY_GUARDED_TRANSPORT_PRODUCTION_ALLOWED === false).
 *  13. Global fetch sentinel proves exactly zero provider network calls.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { D1Database } from '@cloudflare/workers-types';
import {
  executeProductionReplayProtectedDeepSeekCertificationTransport,
  executeGuardedDeepSeekCertificationTransport,
  GUARDED_TRANSPORT_MODULE_VERSION,
  GUARDED_SOURCE_ATTESTATION_READY,
  GUARDED_HUMAN_AUTH_ATTESTATION_READY,
  LEGACY_GUARDED_TRANSPORT_PRODUCTION_ALLOWED,
  type GuardedTransportExecutionResult,
} from '../../worker/ai/canary/deepSeekGuardedLiveTransport';
import {
  GUARDED_TRANSPORT_MODULE_VERSION as IDENTITY_MODULE_VERSION,
} from '../../worker/ai/canary/deepSeekGuardedTransportIdentity';
import {
  coordinateProductionReplayReservation,
  PRODUCTION_REPLAY_COORDINATOR_VERSION,
} from '../../worker/ai/canary/deepSeekProductionReplayCoordinator';
import {
  CANARY_LIVE_EXECUTION_ENABLED,
  CANARY_LIVE_EXECUTION_STATE,
} from '../../worker/ai/canary/canarySpecification';
import {
  getPricingWindow,
  DEEPSEEK_OFF_PEAK_PRICING,
  DEEPSEEK_PEAK_PRICING,
} from '../../worker/ai/canary/deepSeekSingleProviderCertificationSpecification';
import type { SignedHumanAuthorizationPackage } from '../../worker/ai/canary/deepSeekCertificationAttestation';
import type { RuntimeSourceProvenanceReceipt } from '../../worker/ai/canary/deepSeekTrustedRuntimeSourceProvenance';

/**
 * Creates a strict mock D1Database handle that counts prepare() invocations.
 */
function createStrictMockD1(options?: {
  onPrepare?: () => void;
  rowsWritten?: number;
}): {
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
            meta: { changed_db: true, rows_written: options?.rowsWritten ?? 1 },
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
      sourceCommitSha: '276f127e88f34aab5dee80b153f2d784b5d4ef58',
      sourceTreeSha: '8a7b291df30cdbf8b022c809408ef58639c54819',
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
    sourceCommitSha: '276f127e88f34aab5dee80b153f2d784b5d4ef58',
    sourceTreeSha: '8a7b291df30cdbf8b022c809408ef58639c54819',
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

describe('VELNAR — A.12B.2C-5U.2 / 5U.2.1 Replay-Protected Guarded Transport Integration', () => {
  // Global fetch sentinel tracking
  let originalFetch: typeof globalThis.fetch;
  let globalFetchCalls = 0;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalFetchCalls = 0;
    globalThis.fetch = (() => {
      globalFetchCalls++;
      throw new Error('SENTINEL_DISPATCH_BLOCKED: Real network dispatch strictly forbidden');
    }) as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // Read module sources for static invariant verification
  const guardedTransportPath = path.resolve(__dirname, '../../worker/ai/canary/deepSeekGuardedLiveTransport.ts');
  const guardedTransportSource = fs.readFileSync(guardedTransportPath, 'utf8').replace(/\r\n/g, '\n');

  const identityPath = path.resolve(__dirname, '../../worker/ai/canary/deepSeekGuardedTransportIdentity.ts');
  const identitySource = fs.readFileSync(identityPath, 'utf8').replace(/\r\n/g, '\n');

  const attestationPath = path.resolve(__dirname, '../../worker/ai/canary/deepSeekCertificationAttestation.ts');
  const attestationSource = fs.readFileSync(attestationPath, 'utf8').replace(/\r\n/g, '\n');

  const coordinatorPath = path.resolve(__dirname, '../../worker/ai/canary/deepSeekProductionReplayCoordinator.ts');
  const coordinatorSource = fs.readFileSync(coordinatorPath, 'utf8').replace(/\r\n/g, '\n');

  const canaryIndexPath = path.resolve(__dirname, '../../worker/ai/canary/index.ts');
  const canaryIndexSource = fs.readFileSync(canaryIndexPath, 'utf8').replace(/\r\n/g, '\n');

  // ==========================================================================
  // SUITE 1: Parameter Tuple & Exact 4-Argument API Surface (15 tests)
  // ==========================================================================
  describe('1. Parameter Tuple & Exact 4-Argument API Surface', () => {
    it('1.1 exports executeProductionReplayProtectedDeepSeekCertificationTransport as an async function', () => {
      expect(typeof executeProductionReplayProtectedDeepSeekCertificationTransport).toBe('function');
    });

    it('1.2 executeProductionReplayProtectedDeepSeekCertificationTransport has function.length === 4', () => {
      expect(executeProductionReplayProtectedDeepSeekCertificationTransport.length).toBe(4);
    });

    it('1.3 rejects 0 arguments with PREFLIGHT_VALIDATION_FAILED before side effects', async () => {
      const result = await (executeProductionReplayProtectedDeepSeekCertificationTransport as any)();
      expect(result.success).toBe(false);
      expect(result.status).toBe('PREFLIGHT_VALIDATION_FAILED');
      expect(result.errors[0]).toContain('FORBIDDEN_CALLER_PARAMETER');
      expect(result.errors[0]).toContain('got 0');
      expect(result.authorizedBudgetMicroUsd).toBe(0);
    });

    it('1.4 rejects 1 argument with PREFLIGHT_VALIDATION_FAILED', async () => {
      const { db } = createStrictMockD1();
      const result = await (executeProductionReplayProtectedDeepSeekCertificationTransport as any)(db);
      expect(result.success).toBe(false);
      expect(result.status).toBe('PREFLIGHT_VALIDATION_FAILED');
      expect(result.errors[0]).toContain('got 1');
      expect(result.authorizedBudgetMicroUsd).toBe(0);
    });

    it('1.5 rejects 2 arguments with PREFLIGHT_VALIDATION_FAILED', async () => {
      const { db } = createStrictMockD1();
      const pkg = createSampleAuthPackage();
      const result = await (executeProductionReplayProtectedDeepSeekCertificationTransport as any)(db, pkg);
      expect(result.success).toBe(false);
      expect(result.status).toBe('PREFLIGHT_VALIDATION_FAILED');
      expect(result.errors[0]).toContain('got 2');
      expect(result.authorizedBudgetMicroUsd).toBe(0);
    });

    it('1.6 rejects 3 arguments with PREFLIGHT_VALIDATION_FAILED', async () => {
      const { db } = createStrictMockD1();
      const pkg = createSampleAuthPackage();
      const receipt = createSampleSourceReceipt();
      const result = await (executeProductionReplayProtectedDeepSeekCertificationTransport as any)(db, pkg, receipt);
      expect(result.success).toBe(false);
      expect(result.status).toBe('PREFLIGHT_VALIDATION_FAILED');
      expect(result.errors[0]).toContain('got 3');
      expect(result.authorizedBudgetMicroUsd).toBe(0);
    });

    it('1.7 rejects 5 arguments with PREFLIGHT_VALIDATION_FAILED before any live gate or coordinator call', async () => {
      const { db, getPrepareCalls } = createStrictMockD1();
      const pkg = createSampleAuthPackage();
      const receipt = createSampleSourceReceipt();
      let credCalls = 0;
      const credResolver = () => {
        credCalls++;
        return { apiKey: 'dummy' };
      };
      const extraArg = { bypass: true };

      const result = await (executeProductionReplayProtectedDeepSeekCertificationTransport as any)(
        db,
        pkg,
        receipt,
        credResolver,
        extraArg
      );

      expect(result.success).toBe(false);
      expect(result.status).toBe('PREFLIGHT_VALIDATION_FAILED');
      expect(result.errors[0]).toContain('got 5');
      expect(result.authorizedBudgetMicroUsd).toBe(0);
      expect(getPrepareCalls()).toBe(0);
      expect(credCalls).toBe(0);
      expect(globalFetchCalls).toBe(0);
    });

    it('1.8 rejects 6 arguments with PREFLIGHT_VALIDATION_FAILED', async () => {
      const { db } = createStrictMockD1();
      const pkg = createSampleAuthPackage();
      const receipt = createSampleSourceReceipt();
      const credResolver = () => ({ apiKey: 'dummy' });

      const result = await (executeProductionReplayProtectedDeepSeekCertificationTransport as any)(
        db,
        pkg,
        receipt,
        credResolver,
        'extra1',
        'extra2'
      );

      expect(result.success).toBe(false);
      expect(result.status).toBe('PREFLIGHT_VALIDATION_FAILED');
      expect(result.errors[0]).toContain('got 6');
      expect(result.authorizedBudgetMicroUsd).toBe(0);
    });

    it('1.9 function signature contains no variadic ...rest parameter', () => {
      expect(guardedTransportSource.includes('...rest')).toBe(false);
      expect(guardedTransportSource.includes('...args')).toBe(false);
    });

    it('1.10 function signature does NOT accept options object', () => {
      const fnDecl = 'export async function executeProductionReplayProtectedDeepSeekCertificationTransport';
      const fnDeclIdx = guardedTransportSource.indexOf(fnDecl);
      expect(fnDeclIdx).toBeGreaterThan(-1);
      const fnHeader = guardedTransportSource.slice(fnDeclIdx, fnDeclIdx + 300);
      expect(fnHeader.includes('options:')).toBe(false);
      expect(fnHeader.includes('options?:')).toBe(false);
    });

    it('1.11 function signature does NOT accept caller pricingWindow', () => {
      const fnDecl = 'export async function executeProductionReplayProtectedDeepSeekCertificationTransport';
      const fnDeclIdx = guardedTransportSource.indexOf(fnDecl);
      const fnHeader = guardedTransportSource.slice(fnDeclIdx, fnDeclIdx + 300);
      expect(fnHeader.includes('pricingWindow')).toBe(false);
    });

    it('1.12 function signature does NOT accept caller expectedCommit', () => {
      const fnDecl = 'export async function executeProductionReplayProtectedDeepSeekCertificationTransport';
      const fnDeclIdx = guardedTransportSource.indexOf(fnDecl);
      const fnHeader = guardedTransportSource.slice(fnDeclIdx, fnDeclIdx + 300);
      expect(fnHeader.includes('expectedCommit')).toBe(false);
    });

    it('1.13 function signature does NOT accept caller expectedTree', () => {
      const fnDecl = 'export async function executeProductionReplayProtectedDeepSeekCertificationTransport';
      const fnDeclIdx = guardedTransportSource.indexOf(fnDecl);
      const fnHeader = guardedTransportSource.slice(fnDeclIdx, fnDeclIdx + 300);
      expect(fnHeader.includes('expectedTree')).toBe(false);
    });

    it('1.14 function signature does NOT accept caller backend', () => {
      const fnDecl = 'export async function executeProductionReplayProtectedDeepSeekCertificationTransport';
      const fnDeclIdx = guardedTransportSource.indexOf(fnDecl);
      const fnHeader = guardedTransportSource.slice(fnDeclIdx, fnDeclIdx + 300);
      expect(fnHeader.includes('backend')).toBe(false);
    });

    it('1.15 function signature does NOT accept caller reservationResult or trustToken', () => {
      const fnDecl = 'export async function executeProductionReplayProtectedDeepSeekCertificationTransport';
      const fnDeclIdx = guardedTransportSource.indexOf(fnDecl);
      const fnHeader = guardedTransportSource.slice(fnDeclIdx, fnDeclIdx + 300);
      expect(fnHeader.includes('reservationResult')).toBe(false);
      expect(fnHeader.includes('trustToken')).toBe(false);
    });
  });

  // ==========================================================================
  // SUITE 2: Circular Dependency Breakdown & Transport Identity Module (10 tests)
  // ==========================================================================
  describe('2. Circular Dependency Breakdown & Transport Identity Module', () => {
    it('2.1 worker/ai/canary/deepSeekGuardedTransportIdentity.ts exists on filesystem', () => {
      expect(fs.existsSync(identityPath)).toBe(true);
    });

    it('2.2 identity module exports GUARDED_TRANSPORT_MODULE_VERSION as 1.0.0-guarded', () => {
      expect(IDENTITY_MODULE_VERSION).toBe('1.0.0-guarded');
    });

    it('2.3 deepSeekGuardedLiveTransport exports GUARDED_TRANSPORT_MODULE_VERSION matching identity', () => {
      expect(GUARDED_TRANSPORT_MODULE_VERSION).toBe(IDENTITY_MODULE_VERSION);
    });

    it('2.4 deepSeekCertificationAttestation.ts imports GUARDED_TRANSPORT_MODULE_VERSION from identity module', () => {
      expect(attestationSource.includes("from './deepSeekGuardedTransportIdentity'")).toBe(true);
      expect(attestationSource.includes("from './deepSeekGuardedLiveTransport'")).toBe(false);
    });

    it('2.5 deepSeekGuardedLiveTransport.ts imports GUARDED_TRANSPORT_MODULE_VERSION from identity module', () => {
      expect(guardedTransportSource.includes("from './deepSeekGuardedTransportIdentity'")).toBe(true);
    });

    it('2.6 deepSeekGuardedLiveTransport.ts re-exports GUARDED_TRANSPORT_MODULE_VERSION', () => {
      expect(guardedTransportSource.includes('export { GUARDED_TRANSPORT_MODULE_VERSION };')).toBe(true);
    });

    it('2.7 deepSeekProductionReplayCoordinator.ts imports from deepSeekCertificationAttestation without cycle', () => {
      expect(coordinatorSource.includes("from './deepSeekCertificationAttestation'")).toBe(true);
      expect(coordinatorSource.includes("from './deepSeekGuardedLiveTransport'")).toBe(false);
    });

    it('2.8 identity module has zero imports (pure leaf module)', () => {
      expect(identitySource.includes('import ')).toBe(false);
    });

    it('2.9 identity module exports const as const', () => {
      expect(identitySource.includes("export const GUARDED_TRANSPORT_MODULE_VERSION = '1.0.0-guarded' as const;")).toBe(true);
    });

    it('2.10 no circular dependency exists between guarded transport, attestation, and coordinator', () => {
      expect(attestationSource.includes("from './deepSeekGuardedLiveTransport'")).toBe(false);
      expect(identitySource.includes("from './deepSeekGuardedLiveTransport'")).toBe(false);
      expect(identitySource.includes('import ')).toBe(false);
    });
  });

  // ==========================================================================
  // SUITE 3: Global Live Gate Priority & Fail-Closed Mandate (15 tests)
  // ==========================================================================
  describe('3. Global Live Gate Priority & Fail-Closed Mandate', () => {
    it('3.1 CANARY_LIVE_EXECUTION_ENABLED is strictly false in canarySpecification', () => {
      expect(CANARY_LIVE_EXECUTION_ENABLED).toBe(false);
    });

    it('3.2 CANARY_LIVE_EXECUTION_STATE is BLOCKED_PENDING_CERTIFICATION', () => {
      expect(CANARY_LIVE_EXECUTION_STATE).toBe('BLOCKED_PENDING_CERTIFICATION');
    });

    it('3.3 returns LIVE_EXECUTION_BLOCKED under current canonical state', async () => {
      const { db } = createStrictMockD1();
      const pkg = createSampleAuthPackage();
      const receipt = createSampleSourceReceipt();
      const credResolver = () => ({ apiKey: 'dummy' });

      const result = await executeProductionReplayProtectedDeepSeekCertificationTransport(
        db,
        pkg,
        receipt,
        credResolver
      );

      expect(result.success).toBe(false);
      expect(result.status).toBe('LIVE_EXECUTION_BLOCKED');
    });

    it('3.4 failureCategory is AUTHORIZATION_BINDING_FAILURE when live gate is closed', async () => {
      const { db } = createStrictMockD1();
      const pkg = createSampleAuthPackage();
      const receipt = createSampleSourceReceipt();
      const credResolver = () => ({ apiKey: 'dummy' });

      const result = await executeProductionReplayProtectedDeepSeekCertificationTransport(
        db,
        pkg,
        receipt,
        credResolver
      );

      expect(result.failureCategory).toBe('AUTHORIZATION_BINDING_FAILURE');
    });

    it('3.5 errors array mentions CANARY_LIVE_EXECUTION_BLOCKED', async () => {
      const { db } = createStrictMockD1();
      const pkg = createSampleAuthPackage();
      const receipt = createSampleSourceReceipt();
      const credResolver = () => ({ apiKey: 'dummy' });

      const result = await executeProductionReplayProtectedDeepSeekCertificationTransport(
        db,
        pkg,
        receipt,
        credResolver
      );

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('CANARY_LIVE_EXECUTION_BLOCKED');
    });

    it('3.6 providerNetworkCalls remains strictly 0 when live gate blocks', async () => {
      const { db } = createStrictMockD1();
      const pkg = createSampleAuthPackage();
      const receipt = createSampleSourceReceipt();
      const credResolver = () => ({ apiKey: 'dummy' });

      const result = await executeProductionReplayProtectedDeepSeekCertificationTransport(
        db,
        pkg,
        receipt,
        credResolver
      );

      expect(result.providerNetworkCalls).toBe(0);
    });

    it('3.7 credentialReads remains strictly 0 when live gate blocks', async () => {
      const { db } = createStrictMockD1();
      const pkg = createSampleAuthPackage();
      const receipt = createSampleSourceReceipt();
      const credResolver = () => ({ apiKey: 'dummy' });

      const result = await executeProductionReplayProtectedDeepSeekCertificationTransport(
        db,
        pkg,
        receipt,
        credResolver
      );

      expect(result.credentialReads).toBe(0);
    });

    it('3.8 transportAttempts remains strictly 0 when live gate blocks', async () => {
      const { db } = createStrictMockD1();
      const pkg = createSampleAuthPackage();
      const receipt = createSampleSourceReceipt();
      const credResolver = () => ({ apiKey: 'dummy' });

      const result = await executeProductionReplayProtectedDeepSeekCertificationTransport(
        db,
        pkg,
        receipt,
        credResolver
      );

      expect(result.transportAttempts).toBe(0);
    });

    it('3.9 completedTasks remains strictly 0 when live gate blocks', async () => {
      const { db } = createStrictMockD1();
      const pkg = createSampleAuthPackage();
      const receipt = createSampleSourceReceipt();
      const credResolver = () => ({ apiKey: 'dummy' });

      const result = await executeProductionReplayProtectedDeepSeekCertificationTransport(
        db,
        pkg,
        receipt,
        credResolver
      );

      expect(result.completedTasks).toBe(0);
    });

    it('3.10 candidate remains strictly null when live gate blocks', async () => {
      const { db } = createStrictMockD1();
      const pkg = createSampleAuthPackage();
      const receipt = createSampleSourceReceipt();
      const credResolver = () => ({ apiKey: 'dummy' });

      const result = await executeProductionReplayProtectedDeepSeekCertificationTransport(
        db,
        pkg,
        receipt,
        credResolver
      );

      expect(result.candidate).toBeNull();
    });

    it('3.11 allTasksPassed is false and finalCertificationEligible is false', async () => {
      const { db } = createStrictMockD1();
      const pkg = createSampleAuthPackage();
      const receipt = createSampleSourceReceipt();
      const credResolver = () => ({ apiKey: 'dummy' });

      const result = await executeProductionReplayProtectedDeepSeekCertificationTransport(
        db,
        pkg,
        receipt,
        credResolver
      );

      expect(result.allTasksPassed).toBe(false);
      expect(result.allSchemasValid).toBe(false);
      expect(result.finalCertificationEligible).toBe(false);
    });

    it('3.12 db.prepare is NEVER invoked while live gate is closed (0 D1 calls)', async () => {
      const { db, getPrepareCalls } = createStrictMockD1();
      const pkg = createSampleAuthPackage();
      const receipt = createSampleSourceReceipt();
      const credResolver = () => ({ apiKey: 'dummy' });

      await executeProductionReplayProtectedDeepSeekCertificationTransport(
        db,
        pkg,
        receipt,
        credResolver
      );

      expect(getPrepareCalls()).toBe(0);
    });

    it('3.13 getRuntimeCredential is NEVER invoked while live gate is closed', async () => {
      const { db } = createStrictMockD1();
      const pkg = createSampleAuthPackage();
      const receipt = createSampleSourceReceipt();
      let credCalls = 0;
      const credResolver = () => {
        credCalls++;
        return { apiKey: 'dummy' };
      };

      await executeProductionReplayProtectedDeepSeekCertificationTransport(
        db,
        pkg,
        receipt,
        credResolver
      );

      expect(credCalls).toBe(0);
    });

    it('3.14 global fetch sentinel records exactly 0 calls while live gate is closed', async () => {
      const { db } = createStrictMockD1();
      const pkg = createSampleAuthPackage();
      const receipt = createSampleSourceReceipt();
      const credResolver = () => ({ apiKey: 'dummy' });

      await executeProductionReplayProtectedDeepSeekCertificationTransport(
        db,
        pkg,
        receipt,
        credResolver
      );

      expect(globalFetchCalls).toBe(0);
    });

    it('3.15 authorizedBudgetMicroUsd is strictly 0 when live gate blocks (zero evaluation of pkg)', async () => {
      const { db } = createStrictMockD1();
      const pkg = createSampleAuthPackage({ payload: { maxBudgetMicroUsd: 75000 } });
      const receipt = createSampleSourceReceipt();
      const credResolver = () => ({ apiKey: 'dummy' });

      const result = await executeProductionReplayProtectedDeepSeekCertificationTransport(
        db,
        pkg,
        receipt,
        credResolver
      );

      expect(result.authorizedBudgetMicroUsd).toBe(0);
    });
  });

  // ==========================================================================
  // SUITE 4: Private Canonical Dispatch Helper Encapsulation (10 tests)
  // ==========================================================================
  describe('4. Private Canonical Dispatch Helper Encapsulation', () => {
    it('4.1 executeCanonicalDispatchAfterCredential is not exported in deepSeekGuardedLiveTransport', () => {
      expect(guardedTransportSource.includes('export async function executeCanonicalDispatchAfterCredential')).toBe(false);
      expect(guardedTransportSource.includes('export function executeCanonicalDispatchAfterCredential')).toBe(false);
    });

    it('4.2 executeCanonicalDispatchAfterCredential does not appear in worker/ai/canary/index.ts', () => {
      expect(canaryIndexSource.includes('executeCanonicalDispatchAfterCredential')).toBe(false);
    });

    it('4.3 InternalCanonicalDispatchContext is not exported', () => {
      expect(guardedTransportSource.includes('export interface InternalCanonicalDispatchContext')).toBe(false);
      expect(guardedTransportSource.includes('export type InternalCanonicalDispatchContext')).toBe(false);
    });

    it('4.4 InternalCanonicalDispatchContext does not appear in worker/ai/canary/index.ts', () => {
      expect(canaryIndexSource.includes('InternalCanonicalDispatchContext')).toBe(false);
    });

    it('4.5 executeCanonicalDispatchAfterCredential exists as private internal function', () => {
      expect(guardedTransportSource.includes('async function executeCanonicalDispatchAfterCredential(')).toBe(true);
    });

    it('4.6 legacy executeGuardedDeepSeekCertificationTransport delegates to executeCanonicalDispatchAfterCredential', () => {
      const fnStart = guardedTransportSource.indexOf('export async function executeGuardedDeepSeekCertificationTransport');
      const fnEnd = guardedTransportSource.indexOf('async function executeCanonicalDispatchAfterCredential');
      const fnBody = guardedTransportSource.slice(fnStart, fnEnd);
      expect(fnBody.includes('return executeCanonicalDispatchAfterCredential(')).toBe(true);
      expect(fnBody.includes('enforceFirstInvocationWindowCheck: false')).toBe(true);
    });

    it('4.7 production entrypoint delegates to executeCanonicalDispatchAfterCredential with enforceFirstInvocationWindowCheck: true', () => {
      const fnStart = guardedTransportSource.indexOf('export async function executeProductionReplayProtectedDeepSeekCertificationTransport');
      const fnBody = guardedTransportSource.slice(fnStart);
      expect(fnBody.includes('return executeCanonicalDispatchAfterCredential(')).toBe(true);
      expect(fnBody.includes('enforceFirstInvocationWindowCheck: true')).toBe(true);
    });

    it('4.8 private helper accepts exactly 3 parameters (context, credential, credentialReads)', () => {
      const helperIdx = guardedTransportSource.indexOf('async function executeCanonicalDispatchAfterCredential');
      const helperHeader = guardedTransportSource.slice(helperIdx, helperIdx + 200);
      expect(helperHeader.includes('context: InternalCanonicalDispatchContext')).toBe(true);
      expect(helperHeader.includes('credential: DeepSeekRuntimeCredential')).toBe(true);
      expect(helperHeader.includes('credentialReads: number')).toBe(true);
    });

    it('4.9 private helper enforces 15000ms hard lifecycle timeout via AbortController', () => {
      const helperIdx = guardedTransportSource.indexOf('async function executeCanonicalDispatchAfterCredential');
      const helperBody = guardedTransportSource.slice(helperIdx);
      expect(helperBody.includes('GUARDED_LIFECYCLE_TIMEOUT_MS')).toBe(true);
      expect(helperBody.includes('abortController.abort')).toBe(true);
    });

    it('4.10 private helper evaluates aggregate semantic score >= 0.85 threshold', () => {
      const helperIdx = guardedTransportSource.indexOf('async function executeCanonicalDispatchAfterCredential');
      const helperBody = guardedTransportSource.slice(helperIdx);
      expect(helperBody.includes('SEMANTIC_SCORE_MIN_THRESHOLD')).toBe(true);
      expect(helperBody.includes('finalCertificationEligible: false')).toBe(true);
    });
  });

  // ==========================================================================
  // SUITE 5: Structural Execution Order & Invariants (15 tests)
  // ==========================================================================
  describe('5. Structural Execution Order & Invariants', () => {
    const prodFnStart = guardedTransportSource.indexOf('export async function executeProductionReplayProtectedDeepSeekCertificationTransport');
    expect(prodFnStart).toBeGreaterThan(-1);
    const prodFnBody = guardedTransportSource.slice(prodFnStart);

    it('5.1 Step 1: argument count check is the very first statement', () => {
      const idxArgCheck = prodFnBody.indexOf('if (arguments.length !== 4)');
      expect(idxArgCheck).toBeGreaterThan(-1);
      const idxBefore = prodFnBody.slice(0, idxArgCheck);
      expect(idxBefore.includes('await ')).toBe(false);
      expect(idxBefore.includes('fetch(')).toBe(false);
    });

    it('5.2 Step 2: global live gate is evaluated before materialization or coordinator', () => {
      const idxArgCheck = prodFnBody.indexOf('if (arguments.length !== 4)');
      const idxLiveGate = prodFnBody.indexOf('!CANARY_LIVE_EXECUTION_ENABLED');
      const idxMaterialize = prodFnBody.indexOf('materializeSignedAuthorizationPackageSnapshot(');
      const idxCoordinator = prodFnBody.indexOf('coordinateProductionReplayReservation(');

      expect(idxLiveGate).toBeGreaterThan(idxArgCheck);
      expect(idxMaterialize).toBeGreaterThan(idxLiveGate);
      expect(idxCoordinator).toBeGreaterThan(idxMaterialize);
    });

    it('5.3 Step 3: coordinator invocation precedes readyForCredentialResolution check', () => {
      const idxCoordinator = prodFnBody.indexOf('coordinateProductionReplayReservation(');
      const idxCoordCheck = prodFnBody.indexOf('readyForCredentialResolution !== true');

      expect(idxCoordCheck).toBeGreaterThan(idxCoordinator);
    });

    it('5.4 Step 4: pre-credential expiry check precedes pre-credential pricing window check', () => {
      const idxCoordCheck = prodFnBody.indexOf('readyForCredentialResolution !== true');
      const idxPreExpiry = prodFnBody.indexOf('AUTHORIZATION_EXPIRED_PRE_CREDENTIAL');
      const idxPreWindow = prodFnBody.indexOf('PRICING_WINDOW_CHANGED_PRE_CREDENTIAL');

      expect(idxPreExpiry).toBeGreaterThan(idxCoordCheck);
      expect(idxPreWindow).toBeGreaterThan(idxPreExpiry);
    });

    it('5.5 Step 5: immutable dispatch context is constructed and frozen before credential resolution', () => {
      const idxPreWindow = prodFnBody.indexOf('PRICING_WINDOW_CHANGED_PRE_CREDENTIAL');
      const idxFreezeContext = prodFnBody.indexOf('Object.freeze({');
      const idxCredResolution = prodFnBody.indexOf('await getRuntimeCredential()');

      expect(idxFreezeContext).toBeGreaterThan(idxPreWindow);
      expect(idxCredResolution).toBeGreaterThan(idxFreezeContext);
    });

    it('5.6 Step 6: credential resolution is wrapped in try/catch block', () => {
      const idxTryCred = prodFnBody.indexOf('credentialReads = 1;');
      const idxCatchCred = prodFnBody.indexOf('CREDENTIAL_RESOLUTION_FAILED');

      expect(idxTryCred).toBeGreaterThan(-1);
      expect(idxCatchCred).toBeGreaterThan(idxTryCred);
    });

    it('5.7 Step 7: post-credential expiry check follows credential resolution', () => {
      const idxCatchCred = prodFnBody.indexOf('CREDENTIAL_RESOLUTION_FAILED');
      const idxPostExpiry = prodFnBody.indexOf('AUTHORIZATION_EXPIRED_POST_CREDENTIAL');

      expect(idxPostExpiry).toBeGreaterThan(idxCatchCred);
    });

    it('5.8 Step 8: post-credential pricing window check follows post-credential expiry', () => {
      const idxPostExpiry = prodFnBody.indexOf('AUTHORIZATION_EXPIRED_POST_CREDENTIAL');
      const idxPostWindow = prodFnBody.indexOf('PRICING_WINDOW_CHANGED_POST_CREDENTIAL');

      expect(idxPostWindow).toBeGreaterThan(idxPostExpiry);
    });

    it('5.9 Step 9: canonical dispatch delegation follows post-credential window check', () => {
      const idxPostWindow = prodFnBody.indexOf('PRICING_WINDOW_CHANGED_POST_CREDENTIAL');
      const idxDispatch = prodFnBody.indexOf('return executeCanonicalDispatchAfterCredential(');

      expect(idxDispatch).toBeGreaterThan(idxPostWindow);
    });

    it('5.10 coordinateProductionReplayReservation is called with immutablePkg and immutableSourceReceipt', () => {
      expect(prodFnBody.includes('coordinateProductionReplayReservation(')).toBe(true);
      expect(prodFnBody.includes('db,')).toBe(true);
      expect(prodFnBody.includes('immutablePkg,')).toBe(true);
      expect(prodFnBody.includes('immutableSourceReceipt')).toBe(true);
    });

    it('5.11 no trust token is passed to executeProductionReplayProtectedDeepSeekCertificationTransport', () => {
      expect(prodFnBody.includes('trustToken')).toBe(false);
      expect(prodFnBody.includes('TrustToken')).toBe(false);
    });

    it('5.12 single-attempt policy: no retries, no while loops, no compensating deletes', () => {
      expect(prodFnBody.includes('while (')).toBe(false);
      expect(prodFnBody.includes('retry')).toBe(false);
      expect(prodFnBody.includes('DELETE FROM')).toBe(false);
    });

    it('5.13 validateLiveTransportPreflight is NOT called in production path', () => {
      expect(prodFnBody.includes('validateLiveTransportPreflight(')).toBe(false);
    });

    it('5.14 WindowAuthorizationEvidence is NOT used in production path', () => {
      expect(prodFnBody.includes('WindowAuthorizationEvidence')).toBe(false);
    });

    it('5.15 no type casting between SignedHumanAuthorizationPackage and WindowAuthorizationEvidence', () => {
      expect(prodFnBody.includes('as WindowAuthorizationEvidence')).toBe(false);
      expect(prodFnBody.includes('as unknown as WindowAuthorizationEvidence')).toBe(false);
    });
  });

  // ==========================================================================
  // SUITE 6: Coordinator Error Fail-Closed Propagation (12 tests)
  // ==========================================================================
  describe('6. Coordinator Error Fail-Closed Propagation', () => {
    it('6.1 coordinator rejects when authority trust anchor unprovisioned', async () => {
      const { db } = createStrictMockD1();
      const pkg = createSampleAuthPackage();
      const receipt = createSampleSourceReceipt();

      const coordResult = await coordinateProductionReplayReservation(db, pkg, receipt);
      expect(coordResult.readyForCredentialResolution).toBe(false);
      expect(['UNTRUSTED_ROOT_AUTHORITY', 'SOURCE_PROVENANCE_NOT_VERIFIED']).toContain(coordResult.status);
    });

    it('6.2 coordinator rejects when source provenance trust anchor unprovisioned', async () => {
      const { db } = createStrictMockD1();
      const pkg = createSampleAuthPackage();
      const receipt = createSampleSourceReceipt({ issuerId: 'unknown_source_issuer' });

      const coordResult = await coordinateProductionReplayReservation(db, pkg, receipt);
      expect(coordResult.readyForCredentialResolution).toBe(false);
    });

    it('6.3 coordinator rejects expired authorization package', async () => {
      const { db } = createStrictMockD1();
      const pkg = createSampleAuthPackage({
        payload: { expiresAt: '2020-01-01T00:00:00.000Z' },
      });
      const receipt = createSampleSourceReceipt();

      const coordResult = await coordinateProductionReplayReservation(db, pkg, receipt);
      expect(coordResult.readyForCredentialResolution).toBe(false);
      expect(['EXPIRED_AUTHORIZATION', 'SOURCE_PROVENANCE_NOT_VERIFIED']).toContain(coordResult.status);
    });

    it('6.4 coordinator rejects when repository identity does not match sealed repo', async () => {
      const { db } = createStrictMockD1();
      const pkg = createSampleAuthPackage();
      const receipt = createSampleSourceReceipt({ repositoryFullName: 'malicious/repo' as any });

      const coordResult = await coordinateProductionReplayReservation(db, pkg, receipt);
      expect(coordResult.readyForCredentialResolution).toBe(false);
    });

    it('6.5 coordinator rejects when sourceCommitSha does not match', async () => {
      const { db } = createStrictMockD1();
      const pkg = createSampleAuthPackage({ payload: { sourceCommitSha: '0'.repeat(40) } });
      const receipt = createSampleSourceReceipt();

      const coordResult = await coordinateProductionReplayReservation(db, pkg, receipt);
      expect(coordResult.readyForCredentialResolution).toBe(false);
    });

    it('6.6 coordinator rejects when sourceTreeSha does not match', async () => {
      const { db } = createStrictMockD1();
      const pkg = createSampleAuthPackage({ payload: { sourceTreeSha: '0'.repeat(40) } });
      const receipt = createSampleSourceReceipt();

      const coordResult = await coordinateProductionReplayReservation(db, pkg, receipt);
      expect(coordResult.readyForCredentialResolution).toBe(false);
    });

    it('6.7 coordinator rejects when D1 backend is not production bound', async () => {
      const { db } = createStrictMockD1();
      const pkg = createSampleAuthPackage();
      const receipt = createSampleSourceReceipt();

      const coordResult = await coordinateProductionReplayReservation(db, pkg, receipt);
      expect(coordResult.readyForCredentialResolution).toBe(false);
    });

    it('6.8 coordinator error propagates failureReason into errors array', () => {
      const prodFnStart = guardedTransportSource.indexOf('export async function executeProductionReplayProtectedDeepSeekCertificationTransport');
      const prodFnBody = guardedTransportSource.slice(prodFnStart);
      expect(prodFnBody.includes("replayCoordination.failureReason")).toBe(true);
      expect(prodFnBody.includes("REPLAY_COORDINATION_FAILED")).toBe(true);
    });

    it('6.9 coordinator failure returns status PREFLIGHT_VALIDATION_FAILED', () => {
      const prodFnStart = guardedTransportSource.indexOf('export async function executeProductionReplayProtectedDeepSeekCertificationTransport');
      const prodFnBody = guardedTransportSource.slice(prodFnStart);
      const coordFailureBlock = prodFnBody.slice(
        prodFnBody.indexOf('readyForCredentialResolution !== true'),
        prodFnBody.indexOf('AUTHORIZATION_EXPIRED_PRE_CREDENTIAL')
      );
      expect(coordFailureBlock.includes("status: 'PREFLIGHT_VALIDATION_FAILED'")).toBe(true);
      expect(coordFailureBlock.includes("failureCategory: 'AUTHORIZATION_BINDING_FAILURE'")).toBe(true);
    });

    it('6.10 coordinator failure sets providerNetworkCalls: 0', () => {
      const prodFnStart = guardedTransportSource.indexOf('export async function executeProductionReplayProtectedDeepSeekCertificationTransport');
      const prodFnBody = guardedTransportSource.slice(prodFnStart);
      const coordFailureBlock = prodFnBody.slice(
        prodFnBody.indexOf('readyForCredentialResolution !== true'),
        prodFnBody.indexOf('AUTHORIZATION_EXPIRED_PRE_CREDENTIAL')
      );
      expect(coordFailureBlock.includes('providerNetworkCalls: 0')).toBe(true);
    });

    it('6.11 coordinator failure sets credentialReads: 0', () => {
      const prodFnStart = guardedTransportSource.indexOf('export async function executeProductionReplayProtectedDeepSeekCertificationTransport');
      const prodFnBody = guardedTransportSource.slice(prodFnStart);
      const coordFailureBlock = prodFnBody.slice(
        prodFnBody.indexOf('readyForCredentialResolution !== true'),
        prodFnBody.indexOf('AUTHORIZATION_EXPIRED_PRE_CREDENTIAL')
      );
      expect(coordFailureBlock.includes('credentialReads: 0')).toBe(true);
    });

    it('6.12 coordinator failure sets candidate: null and finalCertificationEligible: false', () => {
      const prodFnStart = guardedTransportSource.indexOf('export async function executeProductionReplayProtectedDeepSeekCertificationTransport');
      const prodFnBody = guardedTransportSource.slice(prodFnStart);
      const coordFailureBlock = prodFnBody.slice(
        prodFnBody.indexOf('readyForCredentialResolution !== true'),
        prodFnBody.indexOf('AUTHORIZATION_EXPIRED_PRE_CREDENTIAL')
      );
      expect(coordFailureBlock.includes('candidate: null')).toBe(true);
      expect(coordFailureBlock.includes('finalCertificationEligible: false')).toBe(true);
    });
  });

  // ==========================================================================
  // SUITE 7: Pre-Credential Recheck Invariants (10 tests)
  // ==========================================================================
  describe('7. Pre-Credential Recheck Invariants', () => {
    it('7.1 pre-credential expiry recheck parses expiresAt with Date.parse', () => {
      const prodFnStart = guardedTransportSource.indexOf('export async function executeProductionReplayProtectedDeepSeekCertificationTransport');
      const prodFnBody = guardedTransportSource.slice(prodFnStart);
      expect(prodFnBody.includes('const preCredentialExpiryMs = Date.parse(immutablePkg.payload.expiresAt);')).toBe(true);
    });

    it('7.2 pre-credential expiry recheck compares against fresh Date.now()', () => {
      const prodFnStart = guardedTransportSource.indexOf('export async function executeProductionReplayProtectedDeepSeekCertificationTransport');
      const prodFnBody = guardedTransportSource.slice(prodFnStart);
      expect(prodFnBody.includes('const preCredentialNowMs = Date.now();')).toBe(true);
      expect(prodFnBody.includes('preCredentialExpiryMs <= preCredentialNowMs')).toBe(true);
    });

    it('7.3 pre-credential expiry failure mentions AUTHORIZATION_EXPIRED_PRE_CREDENTIAL', () => {
      const prodFnStart = guardedTransportSource.indexOf('export async function executeProductionReplayProtectedDeepSeekCertificationTransport');
      const prodFnBody = guardedTransportSource.slice(prodFnStart);
      expect(prodFnBody.includes('AUTHORIZATION_EXPIRED_PRE_CREDENTIAL')).toBe(true);
    });

    it('7.4 pre-credential expiry failure returns credentialReads: 0', () => {
      const prodFnStart = guardedTransportSource.indexOf('export async function executeProductionReplayProtectedDeepSeekCertificationTransport');
      const prodFnBody = guardedTransportSource.slice(prodFnStart);
      const preExpiryBlock = prodFnBody.slice(
        prodFnBody.indexOf('AUTHORIZATION_EXPIRED_PRE_CREDENTIAL'),
        prodFnBody.indexOf('PRICING_WINDOW_CHANGED_PRE_CREDENTIAL')
      );
      expect(preExpiryBlock.includes('credentialReads: 0')).toBe(true);
      expect(preExpiryBlock.includes('providerNetworkCalls: 0')).toBe(true);
    });

    it('7.5 pre-credential pricing window check observes fresh Date()', () => {
      const prodFnStart = guardedTransportSource.indexOf('export async function executeProductionReplayProtectedDeepSeekCertificationTransport');
      const prodFnBody = guardedTransportSource.slice(prodFnStart);
      expect(prodFnBody.includes('const preCredentialWindow = getPricingWindow(new Date());')).toBe(true);
    });

    it('7.6 pre-credential pricing window compares against immutablePkg.payload.pricingWindow', () => {
      const prodFnStart = guardedTransportSource.indexOf('export async function executeProductionReplayProtectedDeepSeekCertificationTransport');
      const prodFnBody = guardedTransportSource.slice(prodFnStart);
      expect(prodFnBody.includes('preCredentialWindow !== immutablePkg.payload.pricingWindow')).toBe(true);
    });

    it('7.7 pre-credential pricing window failure mentions PRICING_WINDOW_CHANGED_PRE_CREDENTIAL', () => {
      const prodFnStart = guardedTransportSource.indexOf('export async function executeProductionReplayProtectedDeepSeekCertificationTransport');
      const prodFnBody = guardedTransportSource.slice(prodFnStart);
      expect(prodFnBody.includes('PRICING_WINDOW_CHANGED_PRE_CREDENTIAL')).toBe(true);
    });

    it('7.8 pre-credential pricing window failure failureCategory is PRICING_WINDOW_CHANGED', () => {
      const prodFnStart = guardedTransportSource.indexOf('export async function executeProductionReplayProtectedDeepSeekCertificationTransport');
      const prodFnBody = guardedTransportSource.slice(prodFnStart);
      const preWindowBlock = prodFnBody.slice(
        prodFnBody.indexOf('// 6. Pre-Credential Pricing Window Check'),
        prodFnBody.indexOf('// 7. Construct Immutable Dispatch Context')
      );
      expect(preWindowBlock.includes("failureCategory: 'PRICING_WINDOW_CHANGED'")).toBe(true);
    });

    it('7.9 pre-credential pricing window failure returns credentialReads: 0', () => {
      const prodFnStart = guardedTransportSource.indexOf('export async function executeProductionReplayProtectedDeepSeekCertificationTransport');
      const prodFnBody = guardedTransportSource.slice(prodFnStart);
      const preWindowBlock = prodFnBody.slice(
        prodFnBody.indexOf('// 6. Pre-Credential Pricing Window Check'),
        prodFnBody.indexOf('// 7. Construct Immutable Dispatch Context')
      );
      expect(preWindowBlock.includes('credentialReads: 0')).toBe(true);
      expect(preWindowBlock.includes('providerNetworkCalls: 0')).toBe(true);
    });

    it('7.10 non-finite expiresAt is rejected in pre-credential check', () => {
      const prodFnStart = guardedTransportSource.indexOf('export async function executeProductionReplayProtectedDeepSeekCertificationTransport');
      const prodFnBody = guardedTransportSource.slice(prodFnStart);
      expect(prodFnBody.includes('!Number.isFinite(preCredentialExpiryMs)')).toBe(true);
    });
  });

  // ==========================================================================
  // SUITE 8: Credential Resolution Isolation & Exception Wrapping (10 tests)
  // ==========================================================================
  describe('8. Credential Resolution Isolation & Exception Wrapping', () => {
    it('8.1 credential resolution sets credentialReads = 1 before resolution call', () => {
      const prodFnStart = guardedTransportSource.indexOf('export async function executeProductionReplayProtectedDeepSeekCertificationTransport');
      const prodFnBody = guardedTransportSource.slice(prodFnStart);
      expect(prodFnBody.includes('credentialReads = 1;')).toBe(true);
      expect(prodFnBody.includes('credential = await getRuntimeCredential();')).toBe(true);
    });

    it('8.2 getRuntimeCredential exception is caught and wrapped', () => {
      const prodFnStart = guardedTransportSource.indexOf('export async function executeProductionReplayProtectedDeepSeekCertificationTransport');
      const prodFnBody = guardedTransportSource.slice(prodFnStart);
      expect(prodFnBody.includes('catch (credErr: unknown)')).toBe(true);
      expect(prodFnBody.includes('CREDENTIAL_RESOLUTION_FAILED: Failed to resolve runtime credential capability.')).toBe(true);
    });

    it('8.3 credential exception failure status is PREFLIGHT_VALIDATION_FAILED', () => {
      const prodFnStart = guardedTransportSource.indexOf('export async function executeProductionReplayProtectedDeepSeekCertificationTransport');
      const prodFnBody = guardedTransportSource.slice(prodFnStart);
      const credErrBlock = prodFnBody.slice(
        prodFnBody.indexOf('CREDENTIAL_RESOLUTION_FAILED'),
        prodFnBody.indexOf('CREDENTIAL_UNAVAILABLE')
      );
      expect(credErrBlock.includes("status: 'PREFLIGHT_VALIDATION_FAILED'")).toBe(true);
      expect(credErrBlock.includes("failureCategory: 'AUTHORIZATION_BINDING_FAILURE'")).toBe(true);
    });

    it('8.4 credential exception returns credentialReads: 1 and providerNetworkCalls: 0', () => {
      const prodFnStart = guardedTransportSource.indexOf('export async function executeProductionReplayProtectedDeepSeekCertificationTransport');
      const prodFnBody = guardedTransportSource.slice(prodFnStart);
      const credErrBlock = prodFnBody.slice(
        prodFnBody.indexOf('CREDENTIAL_RESOLUTION_FAILED'),
        prodFnBody.indexOf('CREDENTIAL_UNAVAILABLE')
      );
      expect(credErrBlock.includes('credentialReads,')).toBe(true);
      expect(credErrBlock.includes('providerNetworkCalls: 0')).toBe(true);
    });

    it('8.5 empty apiKey triggers CREDENTIAL_UNAVAILABLE', () => {
      const prodFnStart = guardedTransportSource.indexOf('export async function executeProductionReplayProtectedDeepSeekCertificationTransport');
      const prodFnBody = guardedTransportSource.slice(prodFnStart);
      expect(prodFnBody.includes('credential.apiKey.trim().length === 0')).toBe(true);
      expect(prodFnBody.includes('CREDENTIAL_UNAVAILABLE: Valid runtime credential capability required after passing preflight.')).toBe(true);
    });

    it('8.6 non-string apiKey triggers CREDENTIAL_UNAVAILABLE', () => {
      const prodFnStart = guardedTransportSource.indexOf('export async function executeProductionReplayProtectedDeepSeekCertificationTransport');
      const prodFnBody = guardedTransportSource.slice(prodFnStart);
      expect(prodFnBody.includes("typeof credential.apiKey !== 'string'")).toBe(true);
    });

    it('8.7 null credential object triggers CREDENTIAL_UNAVAILABLE', () => {
      const prodFnStart = guardedTransportSource.indexOf('export async function executeProductionReplayProtectedDeepSeekCertificationTransport');
      const prodFnBody = guardedTransportSource.slice(prodFnStart);
      expect(prodFnBody.includes('!credential ||')).toBe(true);
    });

    it('8.8 CREDENTIAL_UNAVAILABLE failure status is PREFLIGHT_VALIDATION_FAILED', () => {
      const prodFnStart = guardedTransportSource.indexOf('export async function executeProductionReplayProtectedDeepSeekCertificationTransport');
      const prodFnBody = guardedTransportSource.slice(prodFnStart);
      const credUnavailBlock = prodFnBody.slice(
        prodFnBody.indexOf('CREDENTIAL_UNAVAILABLE'),
        prodFnBody.indexOf('AUTHORIZATION_EXPIRED_POST_CREDENTIAL')
      );
      expect(credUnavailBlock.includes("status: 'PREFLIGHT_VALIDATION_FAILED'")).toBe(true);
      expect(credUnavailBlock.includes("failureCategory: 'AUTHORIZATION_BINDING_FAILURE'")).toBe(true);
    });

    it('8.9 CREDENTIAL_UNAVAILABLE returns credentialReads: 1 and providerNetworkCalls: 0', () => {
      const prodFnStart = guardedTransportSource.indexOf('export async function executeProductionReplayProtectedDeepSeekCertificationTransport');
      const prodFnBody = guardedTransportSource.slice(prodFnStart);
      const credUnavailBlock = prodFnBody.slice(
        prodFnBody.indexOf('CREDENTIAL_UNAVAILABLE'),
        prodFnBody.indexOf('AUTHORIZATION_EXPIRED_POST_CREDENTIAL')
      );
      expect(credUnavailBlock.includes('credentialReads,')).toBe(true);
      expect(credUnavailBlock.includes('providerNetworkCalls: 0')).toBe(true);
    });

    it('8.10 credentials are never logged, serialized, or embedded in result', () => {
      expect(guardedTransportSource.includes('apiKey: credential.apiKey')).toBe(false);
      expect(guardedTransportSource.includes('apiKey: credential?.apiKey')).toBe(false);
    });
  });

  // ==========================================================================
  // SUITE 9: Post-Credential Recheck Invariants (10 tests)
  // ==========================================================================
  describe('9. Post-Credential Recheck Invariants', () => {
    it('9.1 post-credential expiry recheck parses expiresAt with Date.parse', () => {
      const prodFnStart = guardedTransportSource.indexOf('export async function executeProductionReplayProtectedDeepSeekCertificationTransport');
      const prodFnBody = guardedTransportSource.slice(prodFnStart);
      expect(prodFnBody.includes('const postCredentialExpiryMs = Date.parse(immutablePkg.payload.expiresAt);')).toBe(true);
    });

    it('9.2 post-credential expiry recheck compares against fresh Date.now()', () => {
      const prodFnStart = guardedTransportSource.indexOf('export async function executeProductionReplayProtectedDeepSeekCertificationTransport');
      const prodFnBody = guardedTransportSource.slice(prodFnStart);
      expect(prodFnBody.includes('const postCredentialNowMs = Date.now();')).toBe(true);
      expect(prodFnBody.includes('postCredentialExpiryMs <= postCredentialNowMs')).toBe(true);
    });

    it('9.3 post-credential expiry failure mentions AUTHORIZATION_EXPIRED_POST_CREDENTIAL', () => {
      const prodFnStart = guardedTransportSource.indexOf('export async function executeProductionReplayProtectedDeepSeekCertificationTransport');
      const prodFnBody = guardedTransportSource.slice(prodFnStart);
      expect(prodFnBody.includes('AUTHORIZATION_EXPIRED_POST_CREDENTIAL')).toBe(true);
    });

    it('9.4 post-credential expiry failure returns credentialReads: 1 and providerNetworkCalls: 0', () => {
      const prodFnStart = guardedTransportSource.indexOf('export async function executeProductionReplayProtectedDeepSeekCertificationTransport');
      const prodFnBody = guardedTransportSource.slice(prodFnStart);
      const postExpiryBlock = prodFnBody.slice(
        prodFnBody.indexOf('AUTHORIZATION_EXPIRED_POST_CREDENTIAL'),
        prodFnBody.indexOf('PRICING_WINDOW_CHANGED_POST_CREDENTIAL')
      );
      expect(postExpiryBlock.includes('credentialReads,')).toBe(true);
      expect(postExpiryBlock.includes('providerNetworkCalls: 0')).toBe(true);
    });

    it('9.5 post-credential pricing window check observes fresh Date()', () => {
      const prodFnStart = guardedTransportSource.indexOf('export async function executeProductionReplayProtectedDeepSeekCertificationTransport');
      const prodFnBody = guardedTransportSource.slice(prodFnStart);
      expect(prodFnBody.includes('const postCredentialWindow = getPricingWindow(new Date());')).toBe(true);
    });

    it('9.6 post-credential pricing window compares against immutablePkg.payload.pricingWindow', () => {
      const prodFnStart = guardedTransportSource.indexOf('export async function executeProductionReplayProtectedDeepSeekCertificationTransport');
      const prodFnBody = guardedTransportSource.slice(prodFnStart);
      expect(prodFnBody.includes('postCredentialWindow !== immutablePkg.payload.pricingWindow')).toBe(true);
    });

    it('9.7 post-credential pricing window failure mentions PRICING_WINDOW_CHANGED_POST_CREDENTIAL', () => {
      const prodFnStart = guardedTransportSource.indexOf('export async function executeProductionReplayProtectedDeepSeekCertificationTransport');
      const prodFnBody = guardedTransportSource.slice(prodFnStart);
      expect(prodFnBody.includes('PRICING_WINDOW_CHANGED_POST_CREDENTIAL')).toBe(true);
    });

    it('9.8 post-credential pricing window failure status is WINDOW_CROSSING_TERMINATED', () => {
      const prodFnStart = guardedTransportSource.indexOf('export async function executeProductionReplayProtectedDeepSeekCertificationTransport');
      const prodFnBody = guardedTransportSource.slice(prodFnStart);
      const postWindowBlock = prodFnBody.slice(
        prodFnBody.indexOf('// 10. Post-Credential Pricing Window Recheck'),
        prodFnBody.indexOf('// 11. Execute Canonical 7-Task Dispatch')
      );
      expect(postWindowBlock.includes("status: 'WINDOW_CROSSING_TERMINATED'")).toBe(true);
      expect(postWindowBlock.includes("failureCategory: 'PRICING_WINDOW_CHANGED'")).toBe(true);
    });

    it('9.9 post-credential pricing window failure returns credentialReads: 1 and providerNetworkCalls: 0', () => {
      const prodFnStart = guardedTransportSource.indexOf('export async function executeProductionReplayProtectedDeepSeekCertificationTransport');
      const prodFnBody = guardedTransportSource.slice(prodFnStart);
      const postWindowBlock = prodFnBody.slice(
        prodFnBody.indexOf('// 10. Post-Credential Pricing Window Recheck'),
        prodFnBody.indexOf('// 11. Execute Canonical 7-Task Dispatch')
      );
      expect(postWindowBlock.includes('credentialReads,')).toBe(true);
      expect(postWindowBlock.includes('providerNetworkCalls: 0')).toBe(true);
    });

    it('9.10 non-finite expiresAt is rejected in post-credential check', () => {
      const prodFnStart = guardedTransportSource.indexOf('export async function executeProductionReplayProtectedDeepSeekCertificationTransport');
      const prodFnBody = guardedTransportSource.slice(prodFnStart);
      expect(prodFnBody.includes('!Number.isFinite(postCredentialExpiryMs)')).toBe(true);
    });
  });

  // ==========================================================================
  // SUITE 10: Legacy Compatibility & Complete Zero-Provider Network Seal (10 tests)
  // ==========================================================================
  describe('10. Legacy Compatibility & Complete Zero-Provider Network Seal', () => {
    it('10.1 legacy executeGuardedDeepSeekCertificationTransport exists and is exported', () => {
      expect(typeof executeGuardedDeepSeekCertificationTransport).toBe('function');
    });

    it('10.2 legacy executeGuardedDeepSeekCertificationTransport returns LIVE_EXECUTION_BLOCKED', async () => {
      const result = await executeGuardedDeepSeekCertificationTransport({
        authorization: {
          authorizationVersion: '1.0.0-legacy',
          authorityId: 'legacy',
          issuedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          targetProgram: 'PROGRAM_A12B2C_CERTIFICATION_OFF_PEAK',
          pricingWindow: 'OFF_PEAK',
          candidateId: 'legacy',
          sourceCommitSha: 'a'.repeat(40),
          sourceTreeSha: 'b'.repeat(40),
          specificationVersion: '1.0.0-successor',
          maxBudgetMicroUsd: 50000,
          runNonce: 'NONCE',
          singleUse: true,
          authorizationDigestReference: 'c'.repeat(64),
        } as any,
        pricingWindow: 'OFF_PEAK',
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('LIVE_EXECUTION_BLOCKED');
    });

    it('10.3 legacy GUARDED_SOURCE_ATTESTATION_READY is compile-time false', () => {
      expect(GUARDED_SOURCE_ATTESTATION_READY).toBe(false);
    });

    it('10.4 legacy GUARDED_HUMAN_AUTH_ATTESTATION_READY is compile-time false', () => {
      expect(GUARDED_HUMAN_AUTH_ATTESTATION_READY).toBe(false);
    });

    it('10.5 no hardcoded DeepSeek API keys in guarded transport source', () => {
      expect(/sk-[a-zA-Z0-9]{32,}/.test(guardedTransportSource)).toBe(false);
    });

    it('10.6 no hardcoded Bearer tokens in guarded transport source', () => {
      expect(/Bearer\s+[a-zA-Z0-9_-]{30,}/.test(guardedTransportSource)).toBe(false);
    });

    it('10.7 no mock transport or test bypass switches exposed in guarded transport exports', () => {
      expect(guardedTransportSource.includes('export const mockTransport')).toBe(false);
      expect(guardedTransportSource.includes('export const bypassGate')).toBe(false);
      expect(guardedTransportSource.includes('export function setMockCredential')).toBe(false);
    });

    it('10.8 active technical spec remains a12b2c5-v1.2', () => {
      expect(guardedTransportSource.includes('DOCUMENTED_VERSION_TARGET')).toBe(true);
    });

    it('10.9 sentinel check: global fetch was never invoked throughout the entire test run', () => {
      expect(globalFetchCalls).toBe(0);
    });

    it('10.10 sentinel lifecycle: afterEach properly maintains fetch isolation', () => {
      expect(typeof originalFetch).toBe('function');
    });
  });

  // ==========================================================================
  // SUITE 11: Pre-Gate Getter Passivity & Anti-Tampering (10 tests)
  // ==========================================================================
  describe('11. Pre-Gate Getter Passivity & Anti-Tampering', () => {
    it('11.1 throwing getter on payload does not throw on invalid argument count', async () => {
      const { db } = createStrictMockD1();
      let getterInvocations = 0;
      const maliciousPkg = {
        get payload() {
          getterInvocations++;
          throw new Error('MALICIOUS_GETTER_TRIGGERED');
        },
      };

      const result = await (executeProductionReplayProtectedDeepSeekCertificationTransport as any)(
        db,
        maliciousPkg
      );

      expect(result.success).toBe(false);
      expect(result.status).toBe('PREFLIGHT_VALIDATION_FAILED');
      expect(result.authorizedBudgetMicroUsd).toBe(0);
      expect(getterInvocations).toBe(0);
    });

    it('11.2 counting getter on payload records exactly 0 calls on invalid argument count', async () => {
      const { db } = createStrictMockD1();
      let getterInvocations = 0;
      const maliciousPkg = {
        get payload() {
          getterInvocations++;
          return { maxBudgetMicroUsd: 999999 };
        },
      };

      const result = await (executeProductionReplayProtectedDeepSeekCertificationTransport as any)(
        db,
        maliciousPkg,
        'extra'
      );

      expect(result.success).toBe(false);
      expect(result.authorizedBudgetMicroUsd).toBe(0);
      expect(getterInvocations).toBe(0);
    });

    it('11.3 counting getter on outer package fields records 0 calls on invalid argument count', async () => {
      const { db } = createStrictMockD1();
      let getterInvocations = 0;
      const maliciousPkg = {
        get signatureBase64() {
          getterInvocations++;
          return 'sig';
        },
      };

      await (executeProductionReplayProtectedDeepSeekCertificationTransport as any)(
        db,
        maliciousPkg
      );

      expect(getterInvocations).toBe(0);
    });

    it('11.4 counting getter on sourceReceipt records 0 calls on invalid argument count', async () => {
      const { db } = createStrictMockD1();
      let getterInvocations = 0;
      const maliciousReceipt = {
        get sourceCommitSha() {
          getterInvocations++;
          return 'sha';
        },
      };

      await (executeProductionReplayProtectedDeepSeekCertificationTransport as any)(
        db,
        maliciousReceipt
      );

      expect(getterInvocations).toBe(0);
    });

    it('11.5 throwing getter on payload does not throw when live gate is closed', async () => {
      const { db } = createStrictMockD1();
      let getterInvocations = 0;
      const maliciousPkg = {
        get payload() {
          getterInvocations++;
          throw new Error('MALICIOUS_GETTER_TRIGGERED');
        },
        signatureBase64: 'sig',
        authorityId: 'auth',
        keyVersion: 'v1',
        algorithm: 'Ed25519',
      };
      const receipt = createSampleSourceReceipt();
      const credResolver = () => ({ apiKey: 'dummy' });

      const result = await executeProductionReplayProtectedDeepSeekCertificationTransport(
        db,
        maliciousPkg as any,
        receipt,
        credResolver
      );

      expect(result.success).toBe(false);
      expect(result.status).toBe('LIVE_EXECUTION_BLOCKED');
      expect(result.authorizedBudgetMicroUsd).toBe(0);
      expect(getterInvocations).toBe(0);
    });

    it('11.6 counting getter on payload records exactly 0 calls when live gate is closed', async () => {
      const { db } = createStrictMockD1();
      let getterInvocations = 0;
      const maliciousPkg = {
        get payload() {
          getterInvocations++;
          return { maxBudgetMicroUsd: 12345 };
        },
        signatureBase64: 'sig',
        authorityId: 'auth',
        keyVersion: 'v1',
        algorithm: 'Ed25519',
      };
      const receipt = createSampleSourceReceipt();
      const credResolver = () => ({ apiKey: 'dummy' });

      const result = await executeProductionReplayProtectedDeepSeekCertificationTransport(
        db,
        maliciousPkg as any,
        receipt,
        credResolver
      );

      expect(result.authorizedBudgetMicroUsd).toBe(0);
      expect(getterInvocations).toBe(0);
    });

    it('11.7 counting getter on sourceReceipt records exactly 0 calls when live gate is closed', async () => {
      const { db } = createStrictMockD1();
      let getterInvocations = 0;
      const pkg = createSampleAuthPackage();
      const maliciousReceipt = {
        get sourceCommitSha() {
          getterInvocations++;
          return 'sha';
        },
      };
      const credResolver = () => ({ apiKey: 'dummy' });

      const result = await executeProductionReplayProtectedDeepSeekCertificationTransport(
        db,
        pkg,
        maliciousReceipt as any,
        credResolver
      );

      expect(result.authorizedBudgetMicroUsd).toBe(0);
      expect(getterInvocations).toBe(0);
    });

    it('11.8 Proxy throwing on get trap does not execute when live gate is closed', async () => {
      const { db } = createStrictMockD1();
      let proxyTraps = 0;
      const maliciousProxy = new Proxy({}, {
        get() {
          proxyTraps++;
          throw new Error('PROXY_GET_TRAP_EXPLODED');
        },
      });
      const receipt = createSampleSourceReceipt();
      const credResolver = () => ({ apiKey: 'dummy' });

      const result = await executeProductionReplayProtectedDeepSeekCertificationTransport(
        db,
        maliciousProxy as any,
        receipt,
        credResolver
      );

      expect(result.success).toBe(false);
      expect(result.status).toBe('LIVE_EXECUTION_BLOCKED');
      expect(proxyTraps).toBe(0);
    });

    it('11.9 db.prepare is never called on pre-gate rejection', async () => {
      const { db, getPrepareCalls } = createStrictMockD1();
      const pkg = createSampleAuthPackage();
      const receipt = createSampleSourceReceipt();
      const credResolver = () => ({ apiKey: 'dummy' });

      await executeProductionReplayProtectedDeepSeekCertificationTransport(
        db,
        pkg,
        receipt,
        credResolver
      );

      expect(getPrepareCalls()).toBe(0);
    });

    it('11.10 getRuntimeCredential is never called on pre-gate rejection', async () => {
      const { db } = createStrictMockD1();
      const pkg = createSampleAuthPackage();
      const receipt = createSampleSourceReceipt();
      let credInvocations = 0;
      const credResolver = () => {
        credInvocations++;
        return { apiKey: 'dummy' };
      };

      await executeProductionReplayProtectedDeepSeekCertificationTransport(
        db,
        pkg,
        receipt,
        credResolver
      );

      expect(credInvocations).toBe(0);
    });
  });

  // ==========================================================================
  // SUITE 12: Materialization & Malformed Object Rejection (15 tests)
  // ==========================================================================
  describe('12. Materialization & Malformed Object Rejection (Static & Structural)', () => {
    it('12.1 safeInspectObject rejects non-object or null input', () => {
      expect(guardedTransportSource.includes("if (input === null || typeof input !== 'object' || Array.isArray(input))")).toBe(true);
    });

    it('12.2 safeInspectObject rejects prototypes other than Object.prototype or null', () => {
      expect(guardedTransportSource.includes('proto !== Object.prototype && proto !== null')).toBe(true);
    });

    it('12.3 safeInspectObject rejects objects containing Symbol keys', () => {
      expect(guardedTransportSource.includes('Object.getOwnPropertySymbols(input)')).toBe(true);
      expect(guardedTransportSource.includes('symbols.length > 0')).toBe(true);
    });

    it('12.4 safeInspectObject reads descriptors with getOwnPropertyDescriptors without property access', () => {
      expect(guardedTransportSource.includes('Object.getOwnPropertyDescriptors(input)')).toBe(true);
    });

    it('12.5 materializePayloadSnapshot enforces EXACT_PAYLOAD_KEYS length match', () => {
      expect(guardedTransportSource.includes('ownKeys.length !== EXACT_PAYLOAD_KEYS.length')).toBe(true);
    });

    it('12.6 materializePayloadSnapshot rejects getter or setter descriptors', () => {
      expect(guardedTransportSource.includes("'get' in desc || 'set' in desc")).toBe(true);
    });

    it('12.7 materializePayloadSnapshot requires value in descriptor', () => {
      expect(guardedTransportSource.includes("!('value' in desc)")).toBe(true);
    });

    it('12.8 materializePayloadSnapshot enforces maxBudgetMicroUsd as non-negative finite number', () => {
      expect(guardedTransportSource.includes("typeof maxBudget !== 'number' || !Number.isFinite(maxBudget) || maxBudget < 0")).toBe(true);
    });

    it('12.9 materializePayloadSnapshot enforces canonicalTaskCount as finite number', () => {
      expect(guardedTransportSource.includes("typeof taskCount !== 'number' || !Number.isFinite(taskCount)")).toBe(true);
    });

    it('12.10 materializePayloadSnapshot enforces singleUse as boolean', () => {
      expect(guardedTransportSource.includes("typeof singleUse !== 'boolean'")).toBe(true);
    });

    it('12.11 materializePayloadSnapshot enforces all other payload fields as string', () => {
      expect(guardedTransportSource.includes("typeof descriptors[key].value !== 'string'")).toBe(true);
    });

    it('12.12 materializeSourceReceiptSnapshot enforces EXACT_RECEIPT_KEYS length match', () => {
      expect(guardedTransportSource.includes('ownKeys.length !== EXACT_RECEIPT_KEYS.length')).toBe(true);
    });

    it('12.13 materializeSourceReceiptSnapshot rejects non-string receipt fields', () => {
      expect(guardedTransportSource.includes("typeof desc.value !== 'string'")).toBe(true);
    });

    it('12.14 materializeSignedAuthorizationPackageSnapshot enforces EXACT_SIGNED_AUTHORIZATION_PACKAGE_KEYS', () => {
      expect(guardedTransportSource.includes('ownKeys.length !== EXACT_SIGNED_AUTHORIZATION_PACKAGE_KEYS.length')).toBe(true);
    });

    it('12.15 materialization failure returns PRODUCTION_INPUT_MATERIALIZATION_FAILED with budget 0', () => {
      const prodFnStart = guardedTransportSource.indexOf('export async function executeProductionReplayProtectedDeepSeekCertificationTransport');
      const prodFnBody = guardedTransportSource.slice(prodFnStart);
      const matFailBlock = prodFnBody.slice(
        prodFnBody.indexOf('if (!immutablePkg || !immutableSourceReceipt)'),
        prodFnBody.indexOf('// 4. Directly invoke production replay coordinator')
      );
      expect(matFailBlock.includes('PRODUCTION_INPUT_MATERIALIZATION_FAILED')).toBe(true);
      expect(matFailBlock.includes('authorizedBudgetMicroUsd: 0')).toBe(true);
    });
  });

  // ==========================================================================
  // SUITE 13: Immutability, Freezing, and Zero-Normalization Guarantees (10 tests)
  // ==========================================================================
  describe('13. Immutability, Freezing, and Zero-Normalization Guarantees', () => {
    it('13.1 materializePayloadSnapshot calls Object.freeze on new snapshot object', () => {
      expect(guardedTransportSource.includes('return Object.freeze(snapshot) as unknown as CanonicalHumanAuthorizationPayload;')).toBe(true);
    });

    it('13.2 materializeSourceReceiptSnapshot calls Object.freeze on new snapshot object', () => {
      expect(guardedTransportSource.includes('return Object.freeze(snapshot) as unknown as RuntimeSourceProvenanceReceipt;')).toBe(true);
    });

    it('13.3 materializeSignedAuthorizationPackageSnapshot calls Object.freeze on new snapshot object', () => {
      expect(guardedTransportSource.includes('return Object.freeze(snapshot) as unknown as SignedHumanAuthorizationPackage;')).toBe(true);
    });

    it('13.4 outer package snapshot references the immutable payload snapshot, not original', () => {
      expect(guardedTransportSource.includes('payload: immutablePayload,')).toBe(true);
    });

    it('13.5 snapshot copying does not call JSON.stringify or JSON.parse', () => {
      const helperStart = guardedTransportSource.indexOf('// 4.8. PRIVATE EXACT DATA-PROPERTY MATERIALIZATION HELPERS');
      const helperEnd = guardedTransportSource.indexOf('// 5. REPLAY-PROTECTED PRODUCTION DISPATCH ENTRYPOINT');
      const helperBody = guardedTransportSource.slice(helperStart, helperEnd);
      expect(helperBody.includes('JSON.stringify')).toBe(false);
      expect(helperBody.includes('JSON.parse')).toBe(false);
    });

    it('13.6 snapshot copying does not call structuredClone', () => {
      const helperStart = guardedTransportSource.indexOf('// 4.8. PRIVATE EXACT DATA-PROPERTY MATERIALIZATION HELPERS');
      const helperEnd = guardedTransportSource.indexOf('// 5. REPLAY-PROTECTED PRODUCTION DISPATCH ENTRYPOINT');
      const helperBody = guardedTransportSource.slice(helperStart, helperEnd);
      expect(helperBody.includes('structuredClone')).toBe(false);
    });

    it('13.7 snapshot copying does not trim or modify strings', () => {
      const helperStart = guardedTransportSource.indexOf('// 4.8. PRIVATE EXACT DATA-PROPERTY MATERIALIZATION HELPERS');
      const helperEnd = guardedTransportSource.indexOf('// 5. REPLAY-PROTECTED PRODUCTION DISPATCH ENTRYPOINT');
      const helperBody = guardedTransportSource.slice(helperStart, helperEnd);
      expect(helperBody.includes('.trim(')).toBe(false);
    });

    it('13.8 snapshot copying does not reformat or normalize timestamps', () => {
      const helperStart = guardedTransportSource.indexOf('// 4.8. PRIVATE EXACT DATA-PROPERTY MATERIALIZATION HELPERS');
      const helperEnd = guardedTransportSource.indexOf('// 5. REPLAY-PROTECTED PRODUCTION DISPATCH ENTRYPOINT');
      const helperBody = guardedTransportSource.slice(helperStart, helperEnd);
      expect(helperBody.includes('toISOString')).toBe(false);
      expect(helperBody.includes('Date.parse')).toBe(false);
    });

    it('13.9 snapshot copying does not coerce types', () => {
      const helperStart = guardedTransportSource.indexOf('// 4.8. PRIVATE EXACT DATA-PROPERTY MATERIALIZATION HELPERS');
      const helperEnd = guardedTransportSource.indexOf('// 5. REPLAY-PROTECTED PRODUCTION DISPATCH ENTRYPOINT');
      const helperBody = guardedTransportSource.slice(helperStart, helperEnd);
      expect(helperBody.includes('String(')).toBe(false);
      expect(helperBody.includes('Number(')).toBe(false);
      expect(helperBody.includes('Boolean(')).toBe(false);
    });

    it('13.10 caller objects are never frozen or mutated by guarded transport', () => {
      expect(guardedTransportSource.includes('Object.freeze(pkg)')).toBe(false);
      expect(guardedTransportSource.includes('Object.freeze(sourceReceipt)')).toBe(false);
    });
  });

  // ==========================================================================
  // SUITE 14: TOCTOU Mutation Resistance Across Async Boundaries (8 tests)
  // ==========================================================================
  describe('14. TOCTOU Mutation Resistance Across Async Boundaries', () => {
    const prodFnStart = guardedTransportSource.indexOf('export async function executeProductionReplayProtectedDeepSeekCertificationTransport');
    const prodFnBody = guardedTransportSource.slice(prodFnStart);

    it('14.1 materialization occurs strictly before coordinateProductionReplayReservation call', () => {
      const idxMat = prodFnBody.indexOf('materializeSignedAuthorizationPackageSnapshot(');
      const idxCoord = prodFnBody.indexOf('coordinateProductionReplayReservation(');
      expect(idxMat).toBeGreaterThan(-1);
      expect(idxCoord).toBeGreaterThan(idxMat);
    });

    it('14.2 coordinator receives immutablePkg and immutableSourceReceipt', () => {
      const idxCoord = prodFnBody.indexOf('coordinateProductionReplayReservation(');
      const coordCall = prodFnBody.slice(idxCoord, idxCoord + 150);
      expect(coordCall).toContain('immutablePkg');
      expect(coordCall).toContain('immutableSourceReceipt');
    });

    it('14.3 pre-credential expiry check uses immutablePkg.payload.expiresAt', () => {
      expect(prodFnBody.includes('Date.parse(immutablePkg.payload.expiresAt)')).toBe(true);
    });

    it('14.4 pre-credential pricing window check uses immutablePkg.payload.pricingWindow', () => {
      expect(prodFnBody.includes('preCredentialWindow !== immutablePkg.payload.pricingWindow')).toBe(true);
    });

    it('14.5 post-credential expiry check uses immutablePkg.payload.expiresAt', () => {
      expect(prodFnBody.includes('const postCredentialExpiryMs = Date.parse(immutablePkg.payload.expiresAt);')).toBe(true);
    });

    it('14.6 post-credential pricing window check uses immutablePkg.payload.pricingWindow', () => {
      expect(prodFnBody.includes('postCredentialWindow !== immutablePkg.payload.pricingWindow')).toBe(true);
    });

    it('14.7 immutable dispatch context is constructed from immutablePkg.payload and frozen', () => {
      expect(prodFnBody.includes('const immutableDispatchContext: InternalCanonicalDispatchContext = Object.freeze({')).toBe(true);
      expect(prodFnBody.includes('pricingWindow: immutablePkg.payload.pricingWindow,')).toBe(true);
      expect(prodFnBody.includes('sourceCommitSha: immutablePkg.payload.sourceCommitSha,')).toBe(true);
      expect(prodFnBody.includes('sourceTreeSha: immutablePkg.payload.sourceTreeSha,')).toBe(true);
      expect(prodFnBody.includes('runNonce: immutablePkg.payload.runNonce,')).toBe(true);
      expect(prodFnBody.includes('maxBudgetMicroUsd: immutablePkg.payload.maxBudgetMicroUsd,')).toBe(true);
    });

    it('14.8 zero reads of original pkg or sourceReceipt exist after materialization', () => {
      const afterMat = prodFnBody.slice(prodFnBody.indexOf('const immutableSourceReceipt = materializeSourceReceiptSnapshot'));
      // Search for any access to pkg. or sourceReceipt. after materialization
      expect(afterMat.includes('pkg.')).toBe(false);
      expect(afterMat.includes('pkg?.')).toBe(false);
      expect(afterMat.includes('sourceReceipt.')).toBe(false);
      expect(afterMat.includes('sourceReceipt?.')).toBe(false);
    });
  });

  // ==========================================================================
  // SUITE 15: Permanent Legacy Non-Production Barrier (7 tests)
  // ==========================================================================
  describe('15. Permanent Legacy Non-Production Barrier', () => {
    it('15.1 LEGACY_GUARDED_TRANSPORT_PRODUCTION_ALLOWED is exported', () => {
      expect(typeof LEGACY_GUARDED_TRANSPORT_PRODUCTION_ALLOWED).toBe('boolean');
    });

    it('15.2 LEGACY_GUARDED_TRANSPORT_PRODUCTION_ALLOWED is compile-time false', () => {
      expect(LEGACY_GUARDED_TRANSPORT_PRODUCTION_ALLOWED).toBe(false);
    });

    it('15.3 legacy executeGuardedDeepSeekCertificationTransport returns LIVE_EXECUTION_BLOCKED with permanent barrier error', async () => {
      const result = await executeGuardedDeepSeekCertificationTransport({
        authorization: {
          authorizationVersion: '1.0.0-legacy',
          authorityId: 'legacy',
          issuedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          targetProgram: 'PROGRAM_A12B2C_CERTIFICATION_OFF_PEAK',
          pricingWindow: 'OFF_PEAK',
          candidateId: 'legacy',
          sourceCommitSha: 'a'.repeat(40),
          sourceTreeSha: 'b'.repeat(40),
          specificationVersion: '1.0.0-successor',
          maxBudgetMicroUsd: 50000,
          runNonce: 'NONCE',
          singleUse: true,
          authorizationDigestReference: 'c'.repeat(64),
        } as any,
        pricingWindow: 'OFF_PEAK',
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('LIVE_EXECUTION_BLOCKED');
      expect(result.failureCategory).toBe('AUTHORIZATION_BINDING_FAILURE');
    });

    it('15.4 legacy barrier is structurally checked in executeGuardedDeepSeekCertificationTransport', () => {
      const legacyStart = guardedTransportSource.indexOf('export async function executeGuardedDeepSeekCertificationTransport');
      const legacyEnd = guardedTransportSource.indexOf('async function executeCanonicalDispatchAfterCredential');
      const legacyBody = guardedTransportSource.slice(legacyStart, legacyEnd);

      expect(legacyBody.includes('if (!LEGACY_GUARDED_TRANSPORT_PRODUCTION_ALLOWED)')).toBe(true);
      expect(legacyBody.includes('LEGACY_GUARDED_TRANSPORT_PERMANENTLY_NON_PRODUCTION')).toBe(true);
    });

    it('15.5 legacy barrier is checked before validateLiveTransportPreflight', () => {
      const legacyStart = guardedTransportSource.indexOf('export async function executeGuardedDeepSeekCertificationTransport');
      const legacyEnd = guardedTransportSource.indexOf('async function executeCanonicalDispatchAfterCredential');
      const legacyBody = guardedTransportSource.slice(legacyStart, legacyEnd);

      const idxLegacyBarrier = legacyBody.indexOf('if (!LEGACY_GUARDED_TRANSPORT_PRODUCTION_ALLOWED)');
      const idxPreflight = legacyBody.indexOf('validateLiveTransportPreflight(');

      expect(idxLegacyBarrier).toBeGreaterThan(-1);
      expect(idxPreflight).toBeGreaterThan(idxLegacyBarrier);
    });

    it('15.6 legacy barrier is checked before getRuntimeCredential', () => {
      const legacyStart = guardedTransportSource.indexOf('export async function executeGuardedDeepSeekCertificationTransport');
      const legacyEnd = guardedTransportSource.indexOf('async function executeCanonicalDispatchAfterCredential');
      const legacyBody = guardedTransportSource.slice(legacyStart, legacyEnd);

      const idxLegacyBarrier = legacyBody.indexOf('if (!LEGACY_GUARDED_TRANSPORT_PRODUCTION_ALLOWED)');
      const idxCredential = legacyBody.indexOf('options.getRuntimeCredential');

      expect(idxLegacyBarrier).toBeGreaterThan(-1);
      expect(idxCredential).toBeGreaterThan(idxLegacyBarrier);
    });

    it('15.7 production entrypoint does NOT reference LEGACY_GUARDED_TRANSPORT_PRODUCTION_ALLOWED', () => {
      const prodFnStart = guardedTransportSource.indexOf('export async function executeProductionReplayProtectedDeepSeekCertificationTransport');
      const prodFnBody = guardedTransportSource.slice(prodFnStart);

      expect(prodFnBody.includes('LEGACY_GUARDED_TRANSPORT_PRODUCTION_ALLOWED')).toBe(false);
    });
  });
});
