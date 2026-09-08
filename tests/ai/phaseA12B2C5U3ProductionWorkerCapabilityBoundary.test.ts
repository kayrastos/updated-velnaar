/**
 * @file tests/ai/phaseA12B2C5U3ProductionWorkerCapabilityBoundary.test.ts
 * @description VELNAR — A.12B.2C-5U.3.1 Internal Worker Runtime Capability Binding Foundation Tests.
 *
 * STRICT VERIFICATION REQUIREMENTS:
 * - Pure offline tests only.
 * - ZERO DeepSeek calls, ZERO Gemini calls, ZERO external provider calls.
 * - ZERO real Cloudflare D1 calls or cloud resources.
 * - ZERO private keys or trust anchors provisioned.
 * - Comprehensive coverage of 5U.3.1 requirements:
 *   1. Argument count passivity: exactly 3 arguments; invalid counts fail closed prior to any capability access.
 *   2. Closed live-gate passivity: 0 getter invocations on env, pkg, receipt; budget remains 0.
 *   3. Environment validation: requires production; non-production environments fail closed.
 *   4. D1 capability capture: env.DB read exactly once; identity preserved without cloning.
 *   5. Deferred credential resolution: 0 reads of DEEPSEEK_API_KEY during closure construction.
 *   6. Credential resolver evaluation: exactly 1 read per resolver invocation post-reservation.
 *   7. Secret non-normalization: whitespace rejected, exact string bytes preserved.
 *   8. Secret rejection: missing/blank/throwing secret fails closed without secret leakage.
 *   9. Anti-injection: caller-supplied db/resolver/apiKey are ignored and never become capabilities.
 *  10. Delegation & Passthrough: raw transport called exactly once with exact 4 arguments.
 *  11. Post-reservation failure semantics: single-attempt policy; no retries, no compensating queries.
 *  12. Structural encapsulation: unrouted, no logging, no SafeLogger.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { WorkerEnv } from '../../worker/env';
import { executeProductionWorkerCanaryCertification } from '../../worker/ai/canary/deepSeekProductionWorkerCapabilityBoundary';
import {
  CANARY_LIVE_EXECUTION_ENABLED,
  CANARY_LIVE_EXECUTION_STATE,
} from '../../worker/ai/canary/canarySpecification';
import type { GuardedTransportExecutionResult } from '../../worker/ai/canary/deepSeekGuardedLiveTransport';

/**
 * Creates sample dummy data payload fixtures.
 */
function createDummyPayloads() {
  const pkg = {
    payload: {
      candidateId: 'test-candidate',
      pricingWindow: 'OFF_PEAK',
      maxBudgetMicroUsd: 50000,
      runNonce: 'NONCE-TEST-001',
    },
    signatureBase64: 'sig_base64_dummy',
    authorityId: 'auth_prod_root_01',
  };
  const receipt = {
    provenanceVersion: 'a12b2c5q-v1',
    sourceCommitSha: '276f127e88f34aab5dee80b153f2d784b5d4ef58',
    sourceTreeSha: '8a7b291df30cdbf8b022c809408ef58639c54819',
  };
  return { pkg, receipt };
}

/**
 * Test-only isolated harness for simulating future-path open live gate
 * and mocking executeProductionReplayProtectedDeepSeekCertificationTransport.
 */
interface FuturePathHarnessOptions {
  mockTransportResult?: GuardedTransportExecutionResult;
  onTransportCalled?: (db: any, pkg: any, receipt: any, getRuntimeCredential: any) => void;
}

async function importFuturePathBoundaryForTest(options?: FuturePathHarnessOptions) {
  vi.resetModules();

  const actualCanarySpec = await vi.importActual<any>('../../worker/ai/canary/canarySpecification');
  vi.doMock('../../worker/ai/canary/canarySpecification', () => ({
    ...actualCanarySpec,
    CANARY_LIVE_EXECUTION_ENABLED: true,
    CANARY_LIVE_EXECUTION_STATE: 'LIVE_EXECUTION_ALLOWED',
  }));

  const transportCalls: any[] = [];
  const defaultResult: GuardedTransportExecutionResult = {
    success: true,
    status: 'TRANSPORT_COMPLETED_PENDING_FINALIZATION',
    errors: [],
    providerNetworkCalls: 7,
    credentialReads: 1,
    transportAttempts: 1,
    completedTasks: 7,
    candidate: {
      candidateId: 'deepseek-v4-flash-off-peak-candidate',
      pricingWindow: 'OFF_PEAK',
      sourceCommitSha: '276f127e88f34aab5dee80b153f2d784b5d4ef58',
      sourceTreeSha: '8a7b291df30cdbf8b022c809408ef58639c54819',
      runNonce: 'NONCE-TEST-001',
      authorizedBudgetMicroUsd: 50000,
      observedTotalCostMicroUsd: 12000,
      targetProgram: 'PROGRAM_A12B2C_CERTIFICATION_OFF_PEAK',
      candidateStatus: 'PENDING_REAL_TRANSPORT_EXECUTION',
      isIntermediateCandidateOnly: true,
      invocationResponses: [],
      invocationRecords: [],
    },
    invocationResponses: [],
    invocationRecords: [],
    observedTotalCostMicroUsd: 12000,
    authorizedBudgetMicroUsd: 50000,
    aggregateSemanticScore: 98,
    allTasksPassed: true,
    allSchemasValid: true,
    finalCertificationEligible: false,
  };

  const actualTransport = await vi.importActual<any>('../../worker/ai/canary/deepSeekGuardedLiveTransport');
  vi.doMock('../../worker/ai/canary/deepSeekGuardedLiveTransport', () => ({
    ...actualTransport,
    executeProductionReplayProtectedDeepSeekCertificationTransport: vi.fn(
      async (db: any, pkg: any, receipt: any, getRuntimeCredential: any) => {
        transportCalls.push({ db, pkg, receipt, getRuntimeCredential });
        options?.onTransportCalled?.(db, pkg, receipt, getRuntimeCredential);
        return options?.mockTransportResult ?? defaultResult;
      }
    ),
  }));

  const boundaryMod = await import('../../worker/ai/canary/deepSeekProductionWorkerCapabilityBoundary');

  return {
    executeBoundary: boundaryMod.executeProductionWorkerCanaryCertification,
    getTransportCalls: () => transportCalls,
    cleanup: () => {
      vi.doUnmock('../../worker/ai/canary/canarySpecification');
      vi.doUnmock('../../worker/ai/canary/deepSeekGuardedLiveTransport');
      vi.resetModules();
    },
  };
}

describe('VELNAR — A.12B.2C-5U.3.1 Internal Worker Runtime Capability Boundary Foundation', () => {
  let originalFetch: typeof globalThis.fetch;
  let globalFetchCalls = 0;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalFetchCalls = 0;
    globalThis.fetch = (() => {
      globalFetchCalls++;
      throw new Error('SENTINEL_DISPATCH_BLOCKED: Real network dispatch strictly forbidden in unit tests');
    }) as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // SUITE 1: Argument Count Validation & Preflight Passivity
  // ==========================================================================
  describe('1. Argument Count Validation & Preflight Passivity', () => {
    it('1.1 rejects 0 arguments with WORKER_CAPABILITY_BOUNDARY_ARGUMENT_COUNT_INVALID', async () => {
      const result = await (executeProductionWorkerCanaryCertification as any)();
      expect(result.success).toBe(false);
      expect(result.status).toBe('PREFLIGHT_VALIDATION_FAILED');
      expect(result.failureCategory).toBe('AUTHORIZATION_BINDING_FAILURE');
      expect(result.errors).toEqual(['WORKER_CAPABILITY_BOUNDARY_ARGUMENT_COUNT_INVALID']);
      expect(result.providerNetworkCalls).toBe(0);
      expect(result.credentialReads).toBe(0);
      expect(result.authorizedBudgetMicroUsd).toBe(0);
    });

    it('1.2 rejects 1 argument with WORKER_CAPABILITY_BOUNDARY_ARGUMENT_COUNT_INVALID', async () => {
      const env = { ENVIRONMENT: 'production', DB: {} as any };
      const result = await (executeProductionWorkerCanaryCertification as any)(env);
      expect(result.success).toBe(false);
      expect(result.status).toBe('PREFLIGHT_VALIDATION_FAILED');
      expect(result.failureCategory).toBe('AUTHORIZATION_BINDING_FAILURE');
      expect(result.errors).toEqual(['WORKER_CAPABILITY_BOUNDARY_ARGUMENT_COUNT_INVALID']);
      expect(result.authorizedBudgetMicroUsd).toBe(0);
    });

    it('1.3 rejects 2 arguments with WORKER_CAPABILITY_BOUNDARY_ARGUMENT_COUNT_INVALID', async () => {
      const env = { ENVIRONMENT: 'production', DB: {} as any };
      const { pkg } = createDummyPayloads();
      const result = await (executeProductionWorkerCanaryCertification as any)(env, pkg);
      expect(result.success).toBe(false);
      expect(result.status).toBe('PREFLIGHT_VALIDATION_FAILED');
      expect(result.failureCategory).toBe('AUTHORIZATION_BINDING_FAILURE');
      expect(result.errors).toEqual(['WORKER_CAPABILITY_BOUNDARY_ARGUMENT_COUNT_INVALID']);
      expect(result.authorizedBudgetMicroUsd).toBe(0);
    });

    it('1.4 rejects 4 arguments (caller-injected fourth arg) with WORKER_CAPABILITY_BOUNDARY_ARGUMENT_COUNT_INVALID', async () => {
      const env = { ENVIRONMENT: 'production', DB: {} as any };
      const { pkg, receipt } = createDummyPayloads();
      const injectedFourthArg = { callerOverride: true, getRuntimeCredential: () => ({ apiKey: 'bad' }) };
      const result = await (executeProductionWorkerCanaryCertification as any)(env, pkg, receipt, injectedFourthArg);
      expect(result.success).toBe(false);
      expect(result.status).toBe('PREFLIGHT_VALIDATION_FAILED');
      expect(result.failureCategory).toBe('AUTHORIZATION_BINDING_FAILURE');
      expect(result.errors).toEqual(['WORKER_CAPABILITY_BOUNDARY_ARGUMENT_COUNT_INVALID']);
      expect(result.authorizedBudgetMicroUsd).toBe(0);
    });

    it('1.5 argument count check occurs before any property access on env or payloads', async () => {
      let envReads = 0;
      let pkgReads = 0;
      let receiptReads = 0;

      const maliciousEnv = {
        get ENVIRONMENT() { envReads++; return 'production'; },
        get DB() { envReads++; return {} as any; },
        get DEEPSEEK_API_KEY() { envReads++; return 'secret'; },
      };

      const maliciousPkg = {
        get payload() { pkgReads++; return {}; },
      };

      const maliciousReceipt = {
        get sourceCommitSha() { receiptReads++; return 'abc'; },
      };

      // Call with 4 arguments (violates argument count)
      const result = await (executeProductionWorkerCanaryCertification as any)(
        maliciousEnv,
        maliciousPkg,
        maliciousReceipt,
        'unauthorized_fourth_param'
      );

      expect(result.status).toBe('PREFLIGHT_VALIDATION_FAILED');
      expect(result.errors).toEqual(['WORKER_CAPABILITY_BOUNDARY_ARGUMENT_COUNT_INVALID']);
      expect(envReads).toBe(0);
      expect(pkgReads).toBe(0);
      expect(receiptReads).toBe(0);
    });

    it('1.6 throwing getters on env or payloads do not throw when argument count is invalid', async () => {
      const throwingEnv = {
        get ENVIRONMENT() { throw new Error('ENV_GETTER_EXPLODED'); },
        get DB() { throw new Error('DB_GETTER_EXPLODED'); },
      };

      let didThrow = false;
      try {
        await (executeProductionWorkerCanaryCertification as any)(throwingEnv);
      } catch {
        didThrow = true;
      }
      expect(didThrow).toBe(false);
    });
  });

  // ==========================================================================
  // SUITE 2: Authoritative Global Live Gate Passivity (Canonical Sealed Constants)
  // ==========================================================================
  describe('2. Authoritative Global Live Gate Passivity (Current Closed Gate)', () => {
    it('2.1 canonical live gate is disabled by default', () => {
      expect(CANARY_LIVE_EXECUTION_ENABLED).toBe(false);
      expect(CANARY_LIVE_EXECUTION_STATE).toBe('BLOCKED_PENDING_CERTIFICATION');
    });

    it('2.2 returns LIVE_EXECUTION_BLOCKED under canonical closed live gate', async () => {
      const env = { ENVIRONMENT: 'production', DB: {} as any, DEEPSEEK_API_KEY: 'test_key' };
      const { pkg, receipt } = createDummyPayloads();

      const result = await executeProductionWorkerCanaryCertification(env as any, pkg, receipt);

      expect(result.success).toBe(false);
      expect(result.status).toBe('LIVE_EXECUTION_BLOCKED');
      expect(result.failureCategory).toBe('AUTHORIZATION_BINDING_FAILURE');
      expect(result.errors).toEqual(['WORKER_CAPABILITY_BOUNDARY_LIVE_EXECUTION_BLOCKED']);
      expect(result.providerNetworkCalls).toBe(0);
      expect(result.credentialReads).toBe(0);
      expect(result.transportAttempts).toBe(0);
      expect(result.completedTasks).toBe(0);
      expect(result.candidate).toBeNull();
      expect(result.authorizedBudgetMicroUsd).toBe(0);
      expect(result.observedTotalCostMicroUsd).toBe(0);
      expect(globalFetchCalls).toBe(0);
    });

    it('2.3 closed live gate causes exactly ZERO reads on env getters', async () => {
      let envReads = 0;
      let dbReads = 0;
      let secretReads = 0;

      const countingEnv = {
        get ENVIRONMENT() { envReads++; return 'production'; },
        get DB() { dbReads++; return {} as any; },
        get DEEPSEEK_API_KEY() { secretReads++; return 'test_key'; },
      };
      const { pkg, receipt } = createDummyPayloads();

      const result = await executeProductionWorkerCanaryCertification(countingEnv as any, pkg, receipt);

      expect(result.status).toBe('LIVE_EXECUTION_BLOCKED');
      expect(envReads).toBe(0);
      expect(dbReads).toBe(0);
      expect(secretReads).toBe(0);
    });

    it('2.4 closed live gate causes exactly ZERO reads on payload and receipt getters', async () => {
      let pkgReads = 0;
      let receiptReads = 0;

      const countingPkg = {
        get payload() { pkgReads++; return {}; },
        get signatureBase64() { pkgReads++; return 'sig'; },
      };
      const countingReceipt = {
        get sourceCommitSha() { receiptReads++; return 'sha'; },
      };
      const env = { ENVIRONMENT: 'production', DB: {} as any };

      const result = await executeProductionWorkerCanaryCertification(env as any, countingPkg, countingReceipt);

      expect(result.status).toBe('LIVE_EXECUTION_BLOCKED');
      expect(pkgReads).toBe(0);
      expect(receiptReads).toBe(0);
    });

    it('2.5 throwing getters on env, DB, secret, pkg, or receipt do not throw when live gate is closed', async () => {
      const maliciousEnv = {
        get ENVIRONMENT() { throw new Error('MALICIOUS_ENV_GETTER'); },
        get DB() { throw new Error('MALICIOUS_DB_GETTER'); },
        get DEEPSEEK_API_KEY() { throw new Error('MALICIOUS_SECRET_GETTER'); },
      };
      const maliciousPkg = {
        get payload() { throw new Error('MALICIOUS_PKG_GETTER'); },
      };
      const maliciousReceipt = {
        get sourceCommitSha() { throw new Error('MALICIOUS_RECEIPT_GETTER'); },
      };

      let didThrow = false;
      let result: any;
      try {
        result = await executeProductionWorkerCanaryCertification(maliciousEnv as any, maliciousPkg, maliciousReceipt);
      } catch {
        didThrow = true;
      }

      expect(didThrow).toBe(false);
      expect(result.status).toBe('LIVE_EXECUTION_BLOCKED');
      expect(result.authorizedBudgetMicroUsd).toBe(0);
    });
  });

  // ==========================================================================
  // SUITE 3: Environment Validation (Future-Path Mock Harness)
  // ==========================================================================
  describe('3. Environment Validation (Simulated Open Gate)', () => {
    it('3.1 rejects null env with WORKER_ENV_MISSING', async () => {
      const { executeBoundary, getTransportCalls, cleanup } = await importFuturePathBoundaryForTest();
      const { pkg, receipt } = createDummyPayloads();

      const result = await executeBoundary(null as any, pkg, receipt);

      expect(result.success).toBe(false);
      expect(result.status).toBe('PREFLIGHT_VALIDATION_FAILED');
      expect(result.failureCategory).toBe('AUTHORIZATION_BINDING_FAILURE');
      expect(result.errors).toEqual(['WORKER_ENV_MISSING']);
      expect(getTransportCalls().length).toBe(0);
      cleanup();
    });

    it('3.2 rejects undefined env with WORKER_ENV_MISSING', async () => {
      const { executeBoundary, getTransportCalls, cleanup } = await importFuturePathBoundaryForTest();
      const { pkg, receipt } = createDummyPayloads();

      const result = await executeBoundary(undefined as any, pkg, receipt);

      expect(result.success).toBe(false);
      expect(result.status).toBe('PREFLIGHT_VALIDATION_FAILED');
      expect(result.errors).toEqual(['WORKER_ENV_MISSING']);
      expect(getTransportCalls().length).toBe(0);
      cleanup();
    });

    it('3.3 rejects primitive env types with WORKER_ENV_MISSING', async () => {
      const { executeBoundary, getTransportCalls, cleanup } = await importFuturePathBoundaryForTest();
      const { pkg, receipt } = createDummyPayloads();

      const resultStr = await executeBoundary('string_env' as any, pkg, receipt);
      expect(resultStr.errors).toEqual(['WORKER_ENV_MISSING']);

      const resultNum = await executeBoundary(12345 as any, pkg, receipt);
      expect(resultNum.errors).toEqual(['WORKER_ENV_MISSING']);

      expect(getTransportCalls().length).toBe(0);
      cleanup();
    });

    it('3.4 rejects throwing ENVIRONMENT getter with WORKER_ENVIRONMENT_UNAVAILABLE without leaking exception', async () => {
      const { executeBoundary, getTransportCalls, cleanup } = await importFuturePathBoundaryForTest();
      const { pkg, receipt } = createDummyPayloads();

      const env = {
        get ENVIRONMENT() { throw new Error('INTERNAL_SECRET_LEAK_IN_ENV_ACCESSOR'); },
        DB: {} as any,
      };

      const result = await executeBoundary(env as any, pkg, receipt);

      expect(result.success).toBe(false);
      expect(result.status).toBe('PREFLIGHT_VALIDATION_FAILED');
      expect(result.errors).toEqual(['WORKER_ENVIRONMENT_UNAVAILABLE']);
      expect(result.errors[0]).not.toContain('INTERNAL_SECRET_LEAK');
      expect(getTransportCalls().length).toBe(0);
      cleanup();
    });

    it('3.5 rejects development, test, preview, and arbitrary environments with WORKER_ENVIRONMENT_INVALID', async () => {
      const { executeBoundary, getTransportCalls, cleanup } = await importFuturePathBoundaryForTest();
      const { pkg, receipt } = createDummyPayloads();

      const nonProdEnvs = ['development', 'test', 'preview', 'staging', 'qa', 'production_tampered', ''];

      for (const envName of nonProdEnvs) {
        let secretReads = 0;
        const env = {
          ENVIRONMENT: envName,
          DB: {} as any,
          get DEEPSEEK_API_KEY() { secretReads++; return 'secret'; },
        };

        const result = await executeBoundary(env as any, pkg, receipt);

        expect(result.success).toBe(false);
        expect(result.status).toBe('PREFLIGHT_VALIDATION_FAILED');
        expect(result.errors).toEqual(['WORKER_ENVIRONMENT_INVALID']);
        if (envName.length > 0) {
          expect(result.errors[0]).not.toContain(envName); // Does not leak actual env value
        }
        expect(secretReads).toBe(0); // Secret getter never called
      }

      expect(getTransportCalls().length).toBe(0);
      cleanup();
    });
  });

  // ==========================================================================
  // SUITE 4: D1 Capability Capture & Identity Binding
  // ==========================================================================
  describe('4. D1 Capability Capture & Identity Binding', () => {
    it('4.1 rejects missing or undefined env.DB with WORKER_D1_DATABASE_UNAVAILABLE', async () => {
      const { executeBoundary, getTransportCalls, cleanup } = await importFuturePathBoundaryForTest();
      const { pkg, receipt } = createDummyPayloads();

      const env = { ENVIRONMENT: 'production' };
      const result = await executeBoundary(env as any, pkg, receipt);

      expect(result.success).toBe(false);
      expect(result.status).toBe('PREFLIGHT_VALIDATION_FAILED');
      expect(result.errors).toEqual(['WORKER_D1_DATABASE_UNAVAILABLE']);
      expect(getTransportCalls().length).toBe(0);
      cleanup();
    });

    it('4.2 rejects null env.DB with WORKER_D1_DATABASE_UNAVAILABLE', async () => {
      const { executeBoundary, getTransportCalls, cleanup } = await importFuturePathBoundaryForTest();
      const { pkg, receipt } = createDummyPayloads();

      const env = { ENVIRONMENT: 'production', DB: null };
      const result = await executeBoundary(env as any, pkg, receipt);

      expect(result.success).toBe(false);
      expect(result.status).toBe('PREFLIGHT_VALIDATION_FAILED');
      expect(result.errors).toEqual(['WORKER_D1_DATABASE_UNAVAILABLE']);
      expect(getTransportCalls().length).toBe(0);
      cleanup();
    });

    it('4.3 rejects primitive env.DB with WORKER_D1_DATABASE_UNAVAILABLE', async () => {
      const { executeBoundary, getTransportCalls, cleanup } = await importFuturePathBoundaryForTest();
      const { pkg, receipt } = createDummyPayloads();

      const envStr = { ENVIRONMENT: 'production', DB: 'sqlite://mock' };
      const resultStr = await executeBoundary(envStr as any, pkg, receipt);
      expect(resultStr.errors).toEqual(['WORKER_D1_DATABASE_UNAVAILABLE']);

      const envNum = { ENVIRONMENT: 'production', DB: 12345 };
      const resultNum = await executeBoundary(envNum as any, pkg, receipt);
      expect(resultNum.errors).toEqual(['WORKER_D1_DATABASE_UNAVAILABLE']);

      expect(getTransportCalls().length).toBe(0);
      cleanup();
    });

    it('4.4 rejects throwing DB getter with WORKER_D1_DATABASE_UNAVAILABLE without leaking exception', async () => {
      const { executeBoundary, getTransportCalls, cleanup } = await importFuturePathBoundaryForTest();
      const { pkg, receipt } = createDummyPayloads();

      const env = {
        ENVIRONMENT: 'production',
        get DB() { throw new Error('DB_ACCESSOR_FAULT_PASSWORD_LEAK'); },
      };

      const result = await executeBoundary(env as any, pkg, receipt);

      expect(result.success).toBe(false);
      expect(result.status).toBe('PREFLIGHT_VALIDATION_FAILED');
      expect(result.errors).toEqual(['WORKER_D1_DATABASE_UNAVAILABLE']);
      expect(result.errors[0]).not.toContain('PASSWORD_LEAK');
      expect(getTransportCalls().length).toBe(0);
      cleanup();
    });

    it('4.5 reads env.DB exactly once and passes exact same object reference to raw transport', async () => {
      const { executeBoundary, getTransportCalls, cleanup } = await importFuturePathBoundaryForTest();
      const { pkg, receipt } = createDummyPayloads();

      let dbReadCount = 0;
      const fakeD1Instance = {
        _sentinelId: 'UNIQUE_D1_OBJECT_REFERENCE_ABC_123',
        prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }) }) }),
      };

      const env = {
        ENVIRONMENT: 'production',
        get DB() { dbReadCount++; return fakeD1Instance as any; },
        DEEPSEEK_API_KEY: 'valid_test_secret_123',
      };

      const result = await executeBoundary(env as any, pkg, receipt);

      expect(result.success).toBe(true);
      expect(dbReadCount).toBe(1); // Read exactly once

      const calls = getTransportCalls();
      expect(calls.length).toBe(1);
      expect(calls[0].db).toBe(fakeD1Instance); // Exact reference identity
      expect(calls[0].db._sentinelId).toBe('UNIQUE_D1_OBJECT_REFERENCE_ABC_123');
      cleanup();
    });
  });

  // ==========================================================================
  // SUITE 5: Deferred Credential Resolution (Zero Reads at Construction)
  // ==========================================================================
  describe('5. Deferred Credential Resolution (Zero Reads at Construction)', () => {
    it('5.1 constructing internal credential resolver closure causes EXACTLY ZERO reads of DEEPSEEK_API_KEY', async () => {
      let capturedResolver: any = null;
      const { executeBoundary, getTransportCalls, cleanup } = await importFuturePathBoundaryForTest({
        onTransportCalled: (_db, _pkg, _receipt, resolver) => {
          capturedResolver = resolver;
          // Notice: We intentionally do NOT call resolver inside transport mock here!
        },
      });
      const { pkg, receipt } = createDummyPayloads();

      let secretReadCount = 0;
      const env = {
        ENVIRONMENT: 'production',
        DB: { _id: 'mock_d1' } as any,
        get DEEPSEEK_API_KEY() { secretReadCount++; return 'sk-test-secret-value'; },
      };

      const result = await executeBoundary(env as any, pkg, receipt);

      expect(result.success).toBe(true);
      expect(getTransportCalls().length).toBe(1);
      expect(typeof capturedResolver).toBe('function');
      // CRITICAL ASSERTION: The secret was NEVER read during boundary execution or closure construction!
      expect(secretReadCount).toBe(0);
      cleanup();
    });
  });

  // ==========================================================================
  // SUITE 6: Credential Resolver Evaluation & Exact-Byte Preservation
  // ==========================================================================
  describe('6. Credential Resolver Evaluation & Exact-Byte Preservation', () => {
    it('6.1 resolver reads secret on-demand and evaluates it exactly once per invocation', async () => {
      let capturedResolver: any = null;
      const { executeBoundary, cleanup } = await importFuturePathBoundaryForTest({
        onTransportCalled: (_db, _pkg, _receipt, resolver) => {
          capturedResolver = resolver;
        },
      });
      const { pkg, receipt } = createDummyPayloads();

      let secretReadCount = 0;
      const env = {
        ENVIRONMENT: 'production',
        DB: {} as any,
        get DEEPSEEK_API_KEY() { secretReadCount++; return 'sk-canonical-secret-abc'; },
      };

      await executeBoundary(env as any, pkg, receipt);
      expect(secretReadCount).toBe(0); // Zero prior to invocation

      // Evaluate resolver for the first time
      const cred1 = capturedResolver();
      expect(secretReadCount).toBe(1);
      expect(cred1.apiKey).toBe('sk-canonical-secret-abc');

      // Evaluate resolver a second time
      const cred2 = capturedResolver();
      expect(secretReadCount).toBe(2);
      expect(cred2.apiKey).toBe('sk-canonical-secret-abc');

      cleanup();
    });

    it('6.2 returned credential is a frozen plain object with exact property apiKey', async () => {
      let capturedResolver: any = null;
      const { executeBoundary, cleanup } = await importFuturePathBoundaryForTest({
        onTransportCalled: (_db, _pkg, _receipt, resolver) => {
          capturedResolver = resolver;
        },
      });
      const { pkg, receipt } = createDummyPayloads();

      const env = {
        ENVIRONMENT: 'production',
        DB: {} as any,
        DEEPSEEK_API_KEY: 'sk-prod-test-key-xyz-789',
      };

      await executeBoundary(env as any, pkg, receipt);
      const cred = capturedResolver();

      expect(Object.isFrozen(cred)).toBe(true);
      expect(Object.keys(cred)).toEqual(['apiKey']);
      expect(cred.apiKey).toBe('sk-prod-test-key-xyz-789');

      // Modifying frozen object should fail in strict mode or have no effect
      expect(() => { (cred as any).apiKey = 'tampered'; }).toThrow();
      cleanup();
    });

    it('6.3 preserves exact original string bytes with mixed case and symbols without normalization', async () => {
      let capturedResolver: any = null;
      const { executeBoundary, cleanup } = await importFuturePathBoundaryForTest({
        onTransportCalled: (_db, _pkg, _receipt, resolver) => {
          capturedResolver = resolver;
        },
      });
      const { pkg, receipt } = createDummyPayloads();

      const exactRawSecret = 'sk-Live_Secret#999$Test@XYZ_-_=123';
      const env = {
        ENVIRONMENT: 'production',
        DB: {} as any,
        DEEPSEEK_API_KEY: exactRawSecret,
      };

      await executeBoundary(env as any, pkg, receipt);
      const cred = capturedResolver();

      expect(cred.apiKey).toBe(exactRawSecret);
      expect(cred.apiKey.length).toBe(exactRawSecret.length);
      cleanup();
    });
  });

  // ==========================================================================
  // SUITE 7: Credential Secret Rejection & Error Sanitization
  // ==========================================================================
  describe('7. Credential Secret Rejection & Error Sanitization', () => {
    it('7.1 rejects empty string with WORKER_DEEPSEEK_API_KEY_UNAVAILABLE', async () => {
      let capturedResolver: any = null;
      const { executeBoundary, cleanup } = await importFuturePathBoundaryForTest({
        onTransportCalled: (_db, _pkg, _receipt, resolver) => {
          capturedResolver = resolver;
        },
      });
      const { pkg, receipt } = createDummyPayloads();

      const env = {
        ENVIRONMENT: 'production',
        DB: {} as any,
        DEEPSEEK_API_KEY: '',
      };

      await executeBoundary(env as any, pkg, receipt);
      expect(() => capturedResolver()).toThrow('WORKER_DEEPSEEK_API_KEY_UNAVAILABLE');
      cleanup();
    });

    it('7.2 rejects whitespace-only secrets with WORKER_DEEPSEEK_API_KEY_NON_CANONICAL', async () => {
      let capturedResolver: any = null;
      const { executeBoundary, cleanup } = await importFuturePathBoundaryForTest({
        onTransportCalled: (_db, _pkg, _receipt, resolver) => {
          capturedResolver = resolver;
        },
      });
      const { pkg, receipt } = createDummyPayloads();

      const whitespaceKeys = [' ', '   ', '\t', '\n', '  \t  \n  '];
      for (const key of whitespaceKeys) {
        const env = {
          ENVIRONMENT: 'production',
          DB: {} as any,
          DEEPSEEK_API_KEY: key,
        };

        await executeBoundary(env as any, pkg, receipt);
        expect(() => capturedResolver()).toThrow('WORKER_DEEPSEEK_API_KEY_NON_CANONICAL');
      }
      cleanup();
    });

    it('7.3 rejects leading or trailing whitespace without silent normalization', async () => {
      let capturedResolver: any = null;
      const { executeBoundary, cleanup } = await importFuturePathBoundaryForTest({
        onTransportCalled: (_db, _pkg, _receipt, resolver) => {
          capturedResolver = resolver;
        },
      });
      const { pkg, receipt } = createDummyPayloads();

      const uncanonicalKeys = [
        ' leading_space_key',
        'trailing_space_key ',
        ' leading_and_trailing ',
        '\ttabbed_key',
        'tabbed_key\t',
        '\nnewline_key',
        'newline_key\n',
      ];

      for (const key of uncanonicalKeys) {
        const env = {
          ENVIRONMENT: 'production',
          DB: {} as any,
          DEEPSEEK_API_KEY: key,
        };

        await executeBoundary(env as any, pkg, receipt);
        let thrownMsg = '';
        try {
          capturedResolver();
        } catch (e: any) {
          thrownMsg = e.message;
        }

        expect(thrownMsg).toBe('WORKER_DEEPSEEK_API_KEY_NON_CANONICAL');
        expect(thrownMsg).not.toContain(key.trim()); // Does not leak secret
      }
      cleanup();
    });

    it('7.4 rejects non-string or undefined/null secrets with WORKER_DEEPSEEK_API_KEY_UNAVAILABLE', async () => {
      let capturedResolver: any = null;
      const { executeBoundary, cleanup } = await importFuturePathBoundaryForTest({
        onTransportCalled: (_db, _pkg, _receipt, resolver) => {
          capturedResolver = resolver;
        },
      });
      const { pkg, receipt } = createDummyPayloads();

      const invalidValues: any[] = [undefined, null, 12345, true, {}, []];

      for (const invalidVal of invalidValues) {
        const env = {
          ENVIRONMENT: 'production',
          DB: {} as any,
          DEEPSEEK_API_KEY: invalidVal,
        };

        await executeBoundary(env as any, pkg, receipt);
        expect(() => capturedResolver()).toThrow('WORKER_DEEPSEEK_API_KEY_UNAVAILABLE');
      }
      cleanup();
    });

    it('7.5 throwing DEEPSEEK_API_KEY getter produces generic WORKER_DEEPSEEK_API_KEY_UNAVAILABLE error without leaking secret', async () => {
      let capturedResolver: any = null;
      const { executeBoundary, cleanup } = await importFuturePathBoundaryForTest({
        onTransportCalled: (_db, _pkg, _receipt, resolver) => {
          capturedResolver = resolver;
        },
      });
      const { pkg, receipt } = createDummyPayloads();

      const env = {
        ENVIRONMENT: 'production',
        DB: {} as any,
        get DEEPSEEK_API_KEY() {
          throw new Error('SENSITIVE_SECRET_BEARING_DIAGNOSTIC_MESSAGE_KEY_LEAK');
        },
      };

      await executeBoundary(env as any, pkg, receipt);

      let caughtMsg = '';
      try {
        capturedResolver();
      } catch (err: any) {
        caughtMsg = err?.message;
      }

      expect(caughtMsg).toBe('WORKER_DEEPSEEK_API_KEY_UNAVAILABLE');
      expect(caughtMsg).not.toContain('SENSITIVE_SECRET_BEARING_DIAGNOSTIC_MESSAGE');
      cleanup();
    });
  });

  // ==========================================================================
  // SUITE 8: Anti-Injection & Capability Separation
  // ==========================================================================
  describe('8. Anti-Injection & Capability Separation', () => {
    it('8.1 executeProductionWorkerCanaryCertification function signature takes exactly 3 arguments', () => {
      expect(executeProductionWorkerCanaryCertification.length).toBe(3);
    });

    it('8.2 caller capability fields in untrustedPkg or receipt do NOT override ambient capabilities', async () => {
      let capturedDb: any = null;
      let capturedResolver: any = null;

      const { executeBoundary, cleanup } = await importFuturePathBoundaryForTest({
        onTransportCalled: (db, _pkg, _receipt, resolver) => {
          capturedDb = db;
          capturedResolver = resolver;
        },
      });

      const legitimateHostDb = { _hostDb: true };
      const maliciousCallerDb = { _maliciousDb: true };
      const maliciousCallerResolver = () => ({ apiKey: 'attacker_key' });

      const hostilePkg = {
        payload: {
          candidateId: 'test',
        },
        // Hostile injected capability overrides:
        db: maliciousCallerDb,
        backend: { reserveIfAbsent: () => ({ status: 'RESERVED' }) },
        apiKey: 'attacker_stolen_key',
        getRuntimeCredential: maliciousCallerResolver,
        credential: { apiKey: 'attacker_stolen_key' },
        reservationResult: { readyForCredentialResolution: true },
        verified: true,
      };

      const hostileReceipt = {
        sourceCommitSha: 'sha',
        db: maliciousCallerDb,
        apiKey: 'attacker_key',
      };

      const env = {
        ENVIRONMENT: 'production',
        DB: legitimateHostDb as any,
        DEEPSEEK_API_KEY: 'legitimate_ambient_host_key',
      };

      const result = await executeBoundary(env as any, hostilePkg, hostileReceipt);

      expect(result.success).toBe(true);

      // Captured DB is strictly the legitimate host DB, NEVER the caller's db
      expect(capturedDb).toBe(legitimateHostDb);
      expect(capturedDb).not.toBe(maliciousCallerDb);
      expect(capturedDb._hostDb).toBe(true);
      expect(capturedDb._maliciousDb).toBeUndefined();

      // Captured resolver is the internally generated closure, NEVER the caller's resolver
      expect(capturedResolver).not.toBe(maliciousCallerResolver);
      const cred = capturedResolver();
      expect(cred.apiKey).toBe('legitimate_ambient_host_key');
      expect(cred.apiKey).not.toBe('attacker_key');

      cleanup();
    });
  });

  // ==========================================================================
  // SUITE 9: Raw Transport Delegation & Result Passthrough
  // ==========================================================================
  describe('9. Raw Transport Delegation & Result Passthrough', () => {
    it('9.1 calls executeProductionReplayProtectedDeepSeekCertificationTransport exactly once with exact 4 arguments', async () => {
      const { executeBoundary, getTransportCalls, cleanup } = await importFuturePathBoundaryForTest();
      const { pkg, receipt } = createDummyPayloads();

      const hostDb = { _id: 'real_host_d1' };
      const env = {
        ENVIRONMENT: 'production',
        DB: hostDb as any,
        DEEPSEEK_API_KEY: 'sk-test-key-001',
      };

      await executeBoundary(env as any, pkg, receipt);

      const calls = getTransportCalls();
      expect(calls.length).toBe(1);

      // Exact 4 parameters passed to raw transport
      expect(calls[0].db).toBe(hostDb);
      expect(calls[0].pkg).toBe(pkg);
      expect(calls[0].receipt).toBe(receipt);
      expect(typeof calls[0].getRuntimeCredential).toBe('function');

      cleanup();
    });

    it('9.2 returns exact distinctive result object from raw transport without mutation', async () => {
      const sentinelResult: GuardedTransportExecutionResult = {
        success: true,
        status: 'TRANSPORT_COMPLETED_PENDING_FINALIZATION',
        errors: [],
        providerNetworkCalls: 7,
        credentialReads: 1,
        transportAttempts: 1,
        completedTasks: 7,
        candidate: {
          candidateId: 'sentinel_candidate_id_xyz',
          pricingWindow: 'OFF_PEAK',
          sourceCommitSha: 'commit_sha',
          sourceTreeSha: 'tree_sha',
          runNonce: 'nonce_123',
          authorizedBudgetMicroUsd: 50000,
          observedTotalCostMicroUsd: 11000,
          targetProgram: 'program',
          candidateStatus: 'PENDING_REAL_TRANSPORT_EXECUTION',
          isIntermediateCandidateOnly: true,
          invocationResponses: [],
          invocationRecords: [],
        },
        invocationResponses: [],
        invocationRecords: [],
        observedTotalCostMicroUsd: 11000,
        authorizedBudgetMicroUsd: 50000,
        aggregateSemanticScore: 99,
        allTasksPassed: true,
        allSchemasValid: true,
        finalCertificationEligible: false,
      };

      const { executeBoundary, cleanup } = await importFuturePathBoundaryForTest({
        mockTransportResult: sentinelResult,
      });
      const { pkg, receipt } = createDummyPayloads();

      const env = {
        ENVIRONMENT: 'production',
        DB: {} as any,
        DEEPSEEK_API_KEY: 'sk-key',
      };

      const result = await executeBoundary(env as any, pkg, receipt);

      // Strict object reference identity passthrough
      expect(result).toBe(sentinelResult);
      expect(result.candidate?.candidateId).toBe('sentinel_candidate_id_xyz');
      expect(result.observedTotalCostMicroUsd).toBe(11000);

      cleanup();
    });
  });

  // ==========================================================================
  // SUITE 10: Post-Reservation Credential Failure Semantics
  // ==========================================================================
  describe('10. Post-Reservation Credential Failure Semantics', () => {
    it('10.1 single-attempt policy: resolver failure does not trigger boundary retries or secondary queries', async () => {
      let transportInvocationCount = 0;
      let dbAccessCount = 0;

      const { executeBoundary, cleanup } = await importFuturePathBoundaryForTest({
        onTransportCalled: (_db, _pkg, _receipt, resolver) => {
          transportInvocationCount++;
          // Simulate raw transport evaluating resolver post-reservation and catching error:
          try {
            resolver();
          } catch (err: any) {
            // Raw transport catches and fails closed:
            return {
              success: false,
              status: 'PREFLIGHT_VALIDATION_FAILED',
              failureCategory: 'AUTHORIZATION_BINDING_FAILURE',
              errors: ['CREDENTIAL_RESOLUTION_FAILED: ' + err.message],
            };
          }
        },
      });
      const { pkg, receipt } = createDummyPayloads();

      const env = {
        ENVIRONMENT: 'production',
        get DB() { dbAccessCount++; return {} as any; },
        DEEPSEEK_API_KEY: '   ', // Invalid whitespace secret
      };

      const result = await executeBoundary(env as any, pkg, receipt);

      expect(result).toBeDefined();
      expect(transportInvocationCount).toBe(1); // Never retried
      expect(dbAccessCount).toBe(1); // DB accessed exactly once

      cleanup();
    });
  });

  // ==========================================================================
  // SUITE 11: Secret Hygiene & Absence of Logging
  // ==========================================================================
  describe('11. Secret Hygiene & Absence of Logging', () => {
    it('11.1 module source code performs ZERO logging and imports no SafeLogger', () => {
      const boundaryPath = path.resolve(__dirname, '../../worker/ai/canary/deepSeekProductionWorkerCapabilityBoundary.ts');
      const source = fs.readFileSync(boundaryPath, 'utf8');

      expect(source).not.toContain('SafeLogger');
      expect(source).not.toContain('console.log');
      expect(source).not.toContain('console.error');
      expect(source).not.toContain('console.warn');
    });

    it('11.2 boundary is completely unrouted and not imported in worker/index.ts or aiRouter.ts', () => {
      const indexPath = path.resolve(__dirname, '../../worker/index.ts');
      const indexSource = fs.readFileSync(indexPath, 'utf8');
      expect(indexSource).not.toContain('deepSeekProductionWorkerCapabilityBoundary');
      expect(indexSource).not.toContain('executeProductionWorkerCanaryCertification');

      const aiRouterPath = path.resolve(__dirname, '../../worker/routes/aiRouter.ts');
      const aiRouterSource = fs.readFileSync(aiRouterPath, 'utf8');
      expect(aiRouterSource).not.toContain('deepSeekProductionWorkerCapabilityBoundary');
      expect(aiRouterSource).not.toContain('executeProductionWorkerCanaryCertification');
    });

    it('11.3 error arrays across all boundary failure paths never contain synthetic secret string', async () => {
      const { executeBoundary, cleanup } = await importFuturePathBoundaryForTest();
      const { pkg, receipt } = createDummyPayloads();

      const syntheticSecret = 'SUPER_SENSITIVE_SECRET_TOKEN_XYZ_12345';

      // Failure 1: Environment invalid
      const resEnv = await executeBoundary({
        ENVIRONMENT: 'test',
        DB: {} as any,
        DEEPSEEK_API_KEY: syntheticSecret,
      } as any, pkg, receipt);
      expect(JSON.stringify(resEnv)).not.toContain(syntheticSecret);

      // Failure 2: DB missing
      const resDb = await executeBoundary({
        ENVIRONMENT: 'production',
        DEEPSEEK_API_KEY: syntheticSecret,
      } as any, pkg, receipt);
      expect(JSON.stringify(resDb)).not.toContain(syntheticSecret);

      cleanup();
    });
  });

  // ==========================================================================
  // SUITE 12: Invariant Seal Integrity (All Dormant Gates Remain False)
  // ==========================================================================
  describe('12. Invariant Seal Integrity (All Dormant Gates Remain False)', () => {
    it('12.1 all authoritative dormant gates remain strictly false', async () => {
      const spec = await import('../../worker/ai/canary/canarySpecification');
      expect(spec.CANARY_LIVE_EXECUTION_ENABLED).toBe(false);

      const guardedTransport = await import('../../worker/ai/canary/deepSeekGuardedLiveTransport');
      expect(guardedTransport.GUARDED_SOURCE_ATTESTATION_READY).toBe(false);
      expect(guardedTransport.GUARDED_HUMAN_AUTH_ATTESTATION_READY).toBe(false);

      const humanTrust = await import('../../worker/ai/canary/deepSeekProductionAuthorizationTrust');
      expect(humanTrust.PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED).toBe(false);

      const sourceTrust = await import('../../worker/ai/canary/deepSeekTrustedRuntimeSourceProvenance');
      expect(sourceTrust.RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_PROVISIONED).toBe(false);

      const d1Backend = await import('../../worker/ai/canary/d1AuthorizationReplayBackend');
      expect(d1Backend.D1_REPLAY_BACKEND_PRODUCTION_BOUND).toBe(false);
      expect(d1Backend.D1_REPLAY_BACKEND_REAL_DATABASE_PROVISIONED).toBe(true);
      expect(d1Backend.D1_REPLAY_BACKEND_REAL_CONCURRENCY_CERTIFIED).toBe(false);
    });
  });
});
