/**
 * @file phaseA12B2C5U32ProductionWorkerHostBinding.test.ts
 * @description Comprehensive Offline Test Suite for VELNAR — A.12B.2C-5U.3.2
 * Host Worker Env Binding & Dormant Operational Route Foundation
 * 
 * STRICTLY OFFLINE — ZERO real provider calls, ZERO real D1 calls, ZERO network calls.
 * 
 * COVERS:
 * Suite 1: Canonical Operational Policy Constants
 * Suite 2: Dormant Route Passivity Under Canonical Policy
 * Suite 3: Exact Runtime Argument Count Validation (arguments.length === 3)
 * Suite 4: Host Worker Env Direct Reference Passing (worker/index.ts)
 * Suite 5: Generic Production DB Check Bypass Ordering
 * Suite 6: Future-Path Superadmin Operational Authorization
 * Suite 7: Strict Top-Level HTTP Envelope & Limit Enforcement
 * Suite 8: Caller Env & Capability Injection Immunity
 * Suite 9: Direct Host Env Reference Identity Across All Boundaries
 * Suite 10: Response Minimization & Data Hygiene
 * Suite 11: Single Boundary Invocation & Exact Signature Contract
 * Suite 12: Tenant AI Isolation & Authoritative Dormant Gates Audit
 */

import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

import {
  PRODUCTION_CANARY_OPERATIONAL_ROUTE_PATH,
  PRODUCTION_CANARY_OPERATIONAL_ROUTE_ENABLED,
  PRODUCTION_CANARY_OPERATIONAL_INGRESS_AUTH_READY,
} from '../../worker/ai/canary/deepSeekProductionOperationalRoutePolicy';
import { handleProductionCanaryOperationalRoute } from '../../worker/ai/canary/deepSeekProductionWorkerOperationalRoute';
import type { AuthenticatedUser } from '../../worker/auth/authContext';
import type { WorkerEnv } from '../../worker/env';
import {
  CANARY_LIVE_EXECUTION_ENABLED,
  CANARY_LIVE_EXECUTION_STATE,
} from '../../worker/ai/canary/canarySpecification';
import {
  GUARDED_SOURCE_ATTESTATION_READY,
  GUARDED_HUMAN_AUTH_ATTESTATION_READY,
  type GuardedTransportExecutionResult,
} from '../../worker/ai/canary/deepSeekGuardedLiveTransport';
import { PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED } from '../../worker/ai/canary/deepSeekProductionAuthorizationTrust';
import { RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_PROVISIONED } from '../../worker/ai/canary/deepSeekTrustedRuntimeSourceProvenance';
import {
  D1_REPLAY_BACKEND_PRODUCTION_BOUND,
  D1_REPLAY_BACKEND_REAL_DATABASE_PROVISIONED,
  D1_REPLAY_BACKEND_REAL_CONCURRENCY_CERTIFIED,
} from '../../worker/ai/canary/d1AuthorizationReplayBackend';

function createDummySuperadmin(): AuthenticatedUser {
  return {
    userId: 'usr_superadmin_01',
    email: 'superadmin@velnar.studio',
    fullName: 'System Superadmin',
    memberships: [],
    isSuperAdmin: true,
  };
}

function createDummyTenantUser(role: 'OWNER' | 'ADMIN' | 'MANAGER' | 'STAFF' | 'VIEWER'): AuthenticatedUser {
  return {
    userId: `usr_tenant_${role.toLowerCase()}`,
    email: `${role.toLowerCase()}@tenant.org`,
    fullName: `Tenant ${role}`,
    memberships: [
      {
        organizationId: 'org_test_123',
        role,
        status: 'active',
      },
    ],
    isSuperAdmin: false,
  };
}

function createDummyPayloads() {
  const authorizationPackage = {
    payload: {
      version: 'a12b2c5r-v1',
      runNonce: 'NONCE-001',
      authorityId: 'auth_prod_01',
    },
    signatureBase64: 'sig_dummy',
    authorityId: 'auth_prod_01',
  };
  const sourceProvenanceReceipt = {
    provenanceVersion: 'a12b2c5q-v1',
    sourceCommitSha: 'commit_sha_123',
    sourceTreeSha: 'tree_sha_123',
  };
  return { authorizationPackage, sourceProvenanceReceipt };
}

interface FuturePathHarnessOptions {
  mockBoundaryResult?: Partial<GuardedTransportExecutionResult>;
  onBoundaryCalled?: (env: any, pkg: any, receipt: any) => void;
}

async function importFuturePathRouteForTest(options?: FuturePathHarnessOptions) {
  vi.resetModules();

  vi.doMock('../../worker/ai/canary/deepSeekProductionOperationalRoutePolicy', () => ({
    PRODUCTION_CANARY_OPERATIONAL_ROUTE_PATH: '/api/ops/canary/deepseek-certification',
    PRODUCTION_CANARY_OPERATIONAL_ROUTE_ENABLED: true,
    PRODUCTION_CANARY_OPERATIONAL_INGRESS_AUTH_READY: true,
  }));

  const boundaryCalls: any[] = [];
  const defaultBoundaryResult: GuardedTransportExecutionResult = {
    success: true,
    status: 'TRANSPORT_COMPLETED_PENDING_FINALIZATION',
    errors: [],
    providerNetworkCalls: 7,
    credentialReads: 1,
    transportAttempts: 1,
    completedTasks: 7,
    candidate: {
      candidateId: 'test_candidate_001',
      pricingWindow: 'OFF_PEAK',
      sourceCommitSha: 'commit_sha',
      sourceTreeSha: 'tree_sha',
      runNonce: 'nonce_123',
      authorizedBudgetMicroUsd: 50000,
      observedTotalCostMicroUsd: 12000,
      targetProgram: 'PROGRAM_A12B2C',
      candidateStatus: 'PENDING_REAL_TRANSPORT_EXECUTION',
      isIntermediateCandidateOnly: true,
      invocationResponses: [],
      invocationRecords: [],
    },
    invocationResponses: [{
      index: 1,
      responseId: 'resp_1',
      textResponse: 'hello',
      modelUsed: 'deepseek-v4-flash',
      promptTokens: 10,
      completionTokens: 20,
      costMicroUsd: 1000,
    }] as any,
    invocationRecords: [{
      taskId: 'TASK-1',
      targetModel: 'deepseek-v4-flash',
      inputTokens: 10,
      outputTokens: 20,
      calculatedCostMicroUsd: 1000,
    }] as any,
    observedTotalCostMicroUsd: 12000,
    authorizedBudgetMicroUsd: 50000,
    aggregateSemanticScore: 98,
    allTasksPassed: true,
    allSchemasValid: true,
    finalCertificationEligible: false,
  };

  vi.doMock('../../worker/ai/canary/deepSeekProductionWorkerCapabilityBoundary', () => ({
    executeProductionWorkerCanaryCertification: vi.fn(async (env: any, pkg: any, receipt: any) => {
      boundaryCalls.push({ env, pkg, receipt, argCount: 3 });
      options?.onBoundaryCalled?.(env, pkg, receipt);
      return options?.mockBoundaryResult ? { ...defaultBoundaryResult, ...options.mockBoundaryResult } : defaultBoundaryResult;
    }),
  }));

  const routeMod = await import('../../worker/ai/canary/deepSeekProductionWorkerOperationalRoute');

  return {
    handleRoute: routeMod.handleProductionCanaryOperationalRoute,
    getBoundaryCalls: () => boundaryCalls,
    cleanup: () => {
      vi.doUnmock('../../worker/ai/canary/deepSeekProductionOperationalRoutePolicy');
      vi.doUnmock('../../worker/ai/canary/deepSeekProductionWorkerCapabilityBoundary');
      vi.resetModules();
    },
  };
}

describe('VELNAR — A.12B.2C-5U.3.2 Host Worker Env Binding & Dormant Operational Route Foundation', () => {

  // ==========================================================================
  // SUITE 1: Canonical Operational Policy Constants
  // ==========================================================================
  describe('1. Canonical Operational Policy Constants', () => {
    it('1.1 exact operational route path matches specification', () => {
      expect(PRODUCTION_CANARY_OPERATIONAL_ROUTE_PATH).toBe('/api/ops/canary/deepseek-certification');
    });

    it('1.2 route path is NOT under /api/ai or any tenant route prefix', () => {
      expect(PRODUCTION_CANARY_OPERATIONAL_ROUTE_PATH).not.toContain('/api/ai');
      expect(PRODUCTION_CANARY_OPERATIONAL_ROUTE_PATH.startsWith('/api/ops/')).toBe(true);
    });

    it('1.3 PRODUCTION_CANARY_OPERATIONAL_ROUTE_ENABLED is strictly false', () => {
      expect(PRODUCTION_CANARY_OPERATIONAL_ROUTE_ENABLED).toBe(false);
    });

    it('1.4 PRODUCTION_CANARY_OPERATIONAL_INGRESS_AUTH_READY is strictly false', () => {
      expect(PRODUCTION_CANARY_OPERATIONAL_INGRESS_AUTH_READY).toBe(false);
    });
  });

  // ==========================================================================
  // SUITE 2: Dormant Route Passivity Under Canonical Policy
  // ==========================================================================
  describe('2. Dormant Route Passivity Under Canonical Policy', () => {
    it('2.1 returns 404 NOT_FOUND under canonical dormant policy', async () => {
      const user = createDummySuperadmin();
      const env = {
        ENVIRONMENT: 'production',
        DB: {} as any,
        DEEPSEEK_API_KEY: 'sk-test-key',
      };
      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createDummyPayloads()),
      });

      const response = await handleProductionCanaryOperationalRoute(request, user, env as any);

      expect(response.status).toBe(404);
      const json = await response.json();
      expect(json).toEqual({ error: 'NOT_FOUND' });
    });

    it('2.2 dormant route causes exactly ZERO body reads', async () => {
      let textCalls = 0;
      const throwingRequest = {
        method: 'POST',
        url: 'https://velnar.studio/api/ops/canary/deepseek-certification',
        headers: new Headers({ 'Content-Type': 'application/json' }),
        text: async () => {
          textCalls++;
          throw new Error('MALICIOUS_BODY_READ');
        },
      } as unknown as Request;

      const user = createDummySuperadmin();
      const env = {
        ENVIRONMENT: 'production',
        DB: {} as any,
        DEEPSEEK_API_KEY: 'sk-key',
      };

      const response = await handleProductionCanaryOperationalRoute(throwingRequest, user, env as any);

      expect(response.status).toBe(404);
      expect(textCalls).toBe(0);
    });

    it('2.3 dormant route causes exactly ZERO env.DB and env.DEEPSEEK_API_KEY reads', async () => {
      let dbReads = 0;
      let secretReads = 0;

      const throwingEnv = {
        ENVIRONMENT: 'production',
        get DB() {
          dbReads++;
          throw new Error('MALICIOUS_DB_GETTER');
        },
        get DEEPSEEK_API_KEY() {
          secretReads++;
          throw new Error('MALICIOUS_SECRET_GETTER');
        },
      };

      const user = createDummySuperadmin();
      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createDummyPayloads()),
      });

      const response = await handleProductionCanaryOperationalRoute(request, user, throwingEnv as any);

      expect(response.status).toBe(404);
      expect(dbReads).toBe(0);
      expect(secretReads).toBe(0);
    });

    it('2.4 dormant response contains no canary, DeepSeek, or internal diagnostic strings', async () => {
      const user = createDummySuperadmin();
      const env = { ENVIRONMENT: 'production', DB: {} as any, DEEPSEEK_API_KEY: 'sk-key' };
      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createDummyPayloads()),
      });

      const response = await handleProductionCanaryOperationalRoute(request, user, env as any);
      const text = await response.text();

      expect(text).not.toContain('canary');
      expect(text).not.toContain('deepseek');
      expect(text).not.toContain('DeepSeek');
      expect(text).not.toContain('operational');
      expect(text).not.toContain('ingress');
      expect(text).not.toContain('disabled');
    });
  });

  // ==========================================================================
  // SUITE 3: Exact Runtime Argument Count Validation
  // ==========================================================================
  describe('3. Exact Runtime Argument Count Validation', () => {
    it('3.1 rejects 0 arguments with 404 before reading any properties', async () => {
      const fn = handleProductionCanaryOperationalRoute as any;
      const response = await fn();
      expect(response.status).toBe(404);
      const json = await response.json();
      expect(json).toEqual({ error: 'NOT_FOUND' });
    });

    it('3.2 rejects 1 argument with 404 before reading any properties', async () => {
      const fn = handleProductionCanaryOperationalRoute as any;
      const response = await fn({} as any);
      expect(response.status).toBe(404);
      const json = await response.json();
      expect(json).toEqual({ error: 'NOT_FOUND' });
    });

    it('3.3 rejects 2 arguments with 404 before reading any properties', async () => {
      const fn = handleProductionCanaryOperationalRoute as any;
      const response = await fn({} as any, {} as any);
      expect(response.status).toBe(404);
      const json = await response.json();
      expect(json).toEqual({ error: 'NOT_FOUND' });
    });

    it('3.4 rejects 4 arguments (caller capability injection attempt) with 404', async () => {
      const fn = handleProductionCanaryOperationalRoute as any;
      const response = await fn({} as any, {} as any, {} as any, { injectedCapability: true });
      expect(response.status).toBe(404);
      const json = await response.json();
      expect(json).toEqual({ error: 'NOT_FOUND' });
    });

    it('3.5 throwing getters on request, user, env do NOT throw when argument count is invalid', async () => {
      const fn = handleProductionCanaryOperationalRoute as any;
      const throwingReq = { get method() { throw new Error('REQ_GETTER'); } };
      const throwingUser = { get isSuperAdmin() { throw new Error('USER_GETTER'); } };

      let didThrow = false;
      let response: any;
      try {
        response = await fn(throwingReq, throwingUser);
      } catch {
        didThrow = true;
      }

      expect(didThrow).toBe(false);
      expect(response.status).toBe(404);
    });
  });

  // ==========================================================================
  // SUITE 4: Host Worker Env Direct Reference Passing (worker/index.ts)
  // ==========================================================================
  describe('4. Host Worker Env Direct Reference Passing (worker/index.ts)', () => {
    it('4.1 worker/index.ts passes exact host-supplied env reference to operational handler', async () => {
      vi.resetModules();

      let capturedHandlerArgs: any = null;
      vi.doMock('../../worker/ai/canary/deepSeekProductionWorkerOperationalRoute', () => ({
        handleProductionCanaryOperationalRoute: vi.fn(async (req: any, user: any, env: any) => {
          capturedHandlerArgs = { req, user, env };
          return new Response(JSON.stringify({ status: 'MOCK_CAPTURED' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }),
      }));

      const actualAuth = await vi.importActual<any>('../../worker/auth/authContext');
      vi.doMock('../../worker/auth/authContext', () => ({
        ...actualAuth,
        AuthContextService: {
          ...actualAuth.AuthContextService,
          resolveSessionUser: vi.fn(() => ({
            userId: 'usr_mock_superadmin',
            email: 'admin@velnar.studio',
            fullName: 'Super Admin',
            memberships: [],
            isSuperAdmin: true,
          })),
        },
      }));

      const workerMod = await import('../../worker/index');
      const worker = workerMod.default;

      const hostEnv: any = {
        ENVIRONMENT: 'production',
        DB: { name: 'host_bound_db_instance' },
        DEEPSEEK_API_KEY: 'sk-host-key-xyz',
      };

      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: {
          'Origin': 'https://velnar.studio',
          'Authorization': 'Bearer test_token',
        },
      });

      const response = await worker.fetch(request, hostEnv);
      expect(response.status).toBe(200);

      expect(capturedHandlerArgs).not.toBeNull();
      // CRITICAL: Strict reference equality proof
      expect(capturedHandlerArgs.env).toBe(hostEnv);

      vi.doUnmock('../../worker/ai/canary/deepSeekProductionWorkerOperationalRoute');
      vi.doUnmock('../../worker/auth/authContext');
      vi.resetModules();
    });
  });

  // ==========================================================================
  // SUITE 5: Generic Production DB Check Bypass Ordering
  // ==========================================================================
  describe('5. Generic Production DB Check Bypass Ordering', () => {
    it('5.1 operational route branch executes before generic worker/index.ts env.DB precheck', async () => {
      vi.resetModules();

      let handlerReached = false;
      vi.doMock('../../worker/ai/canary/deepSeekProductionWorkerOperationalRoute', () => ({
        handleProductionCanaryOperationalRoute: vi.fn(async () => {
          handlerReached = true;
          return new Response(JSON.stringify({ status: 'MOCK_CAPTURED' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }),
      }));

      const actualAuth = await vi.importActual<any>('../../worker/auth/authContext');
      vi.doMock('../../worker/auth/authContext', () => ({
        ...actualAuth,
        AuthContextService: {
          ...actualAuth.AuthContextService,
          resolveSessionUser: vi.fn(() => ({
            userId: 'usr_mock_superadmin',
            email: 'admin@velnar.studio',
            fullName: 'Super Admin',
            memberships: [],
            isSuperAdmin: true,
          })),
        },
      }));

      const workerMod = await import('../../worker/index');
      const worker = workerMod.default;

      // Notice env.DB is omitted! In generic routes, this would trigger 503 DATABASE_NOT_CONFIGURED.
      const hostEnvNoDb: any = {
        ENVIRONMENT: 'production',
        DEEPSEEK_API_KEY: 'sk-host-key-xyz',
      };

      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: {
          'Origin': 'https://velnar.studio',
          'Authorization': 'Bearer test_token',
        },
      });

      const response = await worker.fetch(request, hostEnvNoDb);
      // Handler was reached; did not return 503 DATABASE_NOT_CONFIGURED
      expect(response.status).toBe(200);
      expect(handlerReached).toBe(true);

      vi.doUnmock('../../worker/ai/canary/deepSeekProductionWorkerOperationalRoute');
      vi.doUnmock('../../worker/auth/authContext');
      vi.resetModules();
    });
  });

  // ==========================================================================
  // SUITE 6: Future-Path Superadmin Operational Authorization
  // ==========================================================================
  describe('6. Future-Path Superadmin Operational Authorization (Simulated Route Open)', () => {
    it('6.1 superadmin is authorized to reach operational capability boundary', async () => {
      const { handleRoute, getBoundaryCalls, cleanup } = await importFuturePathRouteForTest();
      const user = createDummySuperadmin();
      const env = { ENVIRONMENT: 'production', DB: {} as any, DEEPSEEK_API_KEY: 'sk-key' };
      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createDummyPayloads()),
      });

      const response = await handleRoute(request, user, env as any);

      expect(response.status).toBe(200);
      expect(getBoundaryCalls().length).toBe(1);
      cleanup();
    });

    it('6.2 tenant OWNER is rejected with 403 FORBIDDEN (boundary calls = 0)', async () => {
      const { handleRoute, getBoundaryCalls, cleanup } = await importFuturePathRouteForTest();
      const user = createDummyTenantUser('OWNER');
      const env = { ENVIRONMENT: 'production', DB: {} as any, DEEPSEEK_API_KEY: 'sk-key' };
      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createDummyPayloads()),
      });

      const response = await handleRoute(request, user, env as any);

      expect(response.status).toBe(403);
      const json = await response.json();
      expect(json).toEqual({ error: 'FORBIDDEN' });
      expect(getBoundaryCalls().length).toBe(0);
      cleanup();
    });

    it('6.3 tenant ADMIN is rejected with 403 FORBIDDEN (boundary calls = 0)', async () => {
      const { handleRoute, getBoundaryCalls, cleanup } = await importFuturePathRouteForTest();
      const user = createDummyTenantUser('ADMIN');
      const env = { ENVIRONMENT: 'production', DB: {} as any, DEEPSEEK_API_KEY: 'sk-key' };
      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createDummyPayloads()),
      });

      const response = await handleRoute(request, user, env as any);

      expect(response.status).toBe(403);
      expect(getBoundaryCalls().length).toBe(0);
      cleanup();
    });

    it('6.4 tenant MANAGER, STAFF, and VIEWER are all rejected with 403 FORBIDDEN', async () => {
      const { handleRoute, getBoundaryCalls, cleanup } = await importFuturePathRouteForTest();
      const roles: ('MANAGER' | 'STAFF' | 'VIEWER')[] = ['MANAGER', 'STAFF', 'VIEWER'];

      for (const role of roles) {
        const user = createDummyTenantUser(role);
        const env = { ENVIRONMENT: 'production', DB: {} as any, DEEPSEEK_API_KEY: 'sk-key' };
        const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(createDummyPayloads()),
        });

        const response = await handleRoute(request, user, env as any);
        expect(response.status).toBe(403);
      }

      expect(getBoundaryCalls().length).toBe(0);
      cleanup();
    });

    it('6.5 null user is rejected with 403 FORBIDDEN', async () => {
      const { handleRoute, getBoundaryCalls, cleanup } = await importFuturePathRouteForTest();
      const env = { ENVIRONMENT: 'production', DB: {} as any, DEEPSEEK_API_KEY: 'sk-key' };
      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createDummyPayloads()),
      });

      const response = await handleRoute(request, null as any, env as any);

      expect(response.status).toBe(403);
      expect(getBoundaryCalls().length).toBe(0);
      cleanup();
    });
  });

  // ==========================================================================
  // SUITE 7: Strict Top-Level HTTP Envelope & Limit Enforcement
  // ==========================================================================
  describe('7. Strict Top-Level HTTP Envelope & Limit Enforcement', () => {
    it('7.1 rejects non-POST HTTP methods with 405 METHOD_NOT_ALLOWED', async () => {
      const { handleRoute, getBoundaryCalls, cleanup } = await importFuturePathRouteForTest();
      const user = createDummySuperadmin();
      const env = { ENVIRONMENT: 'production', DB: {} as any, DEEPSEEK_API_KEY: 'sk-key' };
      const methods = ['GET', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'];

      for (const method of methods) {
        const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
          method,
          headers: { 'Content-Type': 'application/json' },
        });

        const response = await handleRoute(request, user, env as any);
        expect(response.status).toBe(405);
        const json = await response.json();
        expect(json).toEqual({ error: 'METHOD_NOT_ALLOWED' });
      }

      expect(getBoundaryCalls().length).toBe(0);
      cleanup();
    });

    it('7.2 rejects non-matching pathname with 404 NOT_FOUND', async () => {
      const { handleRoute, getBoundaryCalls, cleanup } = await importFuturePathRouteForTest();
      const user = createDummySuperadmin();
      const env = { ENVIRONMENT: 'production', DB: {} as any, DEEPSEEK_API_KEY: 'sk-key' };
      const request = new Request('https://velnar.studio/api/ops/canary/other-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createDummyPayloads()),
      });

      const response = await handleRoute(request, user, env as any);
      expect(response.status).toBe(404);
      expect(getBoundaryCalls().length).toBe(0);
      cleanup();
    });

    it('7.3 rejects non-JSON Content-Type with 400 INVALID_REQUEST', async () => {
      const { handleRoute, getBoundaryCalls, cleanup } = await importFuturePathRouteForTest();
      const user = createDummySuperadmin();
      const env = { ENVIRONMENT: 'production', DB: {} as any, DEEPSEEK_API_KEY: 'sk-key' };
      const invalidTypes = ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data', ''];

      for (const ct of invalidTypes) {
        const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
          method: 'POST',
          headers: { 'Content-Type': ct },
          body: JSON.stringify(createDummyPayloads()),
        });

        const response = await handleRoute(request, user, env as any);
        expect(response.status).toBe(400);
        const json = await response.json();
        expect(json).toEqual({ error: 'INVALID_REQUEST' });
      }

      expect(getBoundaryCalls().length).toBe(0);
      cleanup();
    });

    it('7.4 accepts application/json with charset parameter', async () => {
      const { handleRoute, getBoundaryCalls, cleanup } = await importFuturePathRouteForTest();
      const user = createDummySuperadmin();
      const env = { ENVIRONMENT: 'production', DB: {} as any, DEEPSEEK_API_KEY: 'sk-key' };
      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(createDummyPayloads()),
      });

      const response = await handleRoute(request, user, env as any);
      expect(response.status).toBe(200);
      expect(getBoundaryCalls().length).toBe(1);
      cleanup();
    });

    it('7.5 rejects Content-Length exceeding 65536 bytes with 413 PAYLOAD_TOO_LARGE', async () => {
      const { handleRoute, getBoundaryCalls, cleanup } = await importFuturePathRouteForTest();
      const user = createDummySuperadmin();
      const env = { ENVIRONMENT: 'production', DB: {} as any, DEEPSEEK_API_KEY: 'sk-key' };
      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': '70000',
        },
        body: JSON.stringify(createDummyPayloads()),
      });

      const response = await handleRoute(request, user, env as any);
      expect(response.status).toBe(413);
      expect(getBoundaryCalls().length).toBe(0);
      cleanup();
    });

    it('7.6 rejects body text exceeding 65536 bytes with 413 PAYLOAD_TOO_LARGE', async () => {
      const { handleRoute, getBoundaryCalls, cleanup } = await importFuturePathRouteForTest();
      const user = createDummySuperadmin();
      const env = { ENVIRONMENT: 'production', DB: {} as any, DEEPSEEK_API_KEY: 'sk-key' };

      const oversizedPadding = 'x'.repeat(66000);
      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authorizationPackage: createDummyPayloads().authorizationPackage,
          sourceProvenanceReceipt: createDummyPayloads().sourceProvenanceReceipt,
          padding: oversizedPadding,
        }),
      });

      const response = await handleRoute(request, user, env as any);
      expect(response.status).toBe(413);
      expect(getBoundaryCalls().length).toBe(0);
      cleanup();
    });

    it('7.7 rejects malformed JSON with 400 INVALID_REQUEST', async () => {
      const { handleRoute, getBoundaryCalls, cleanup } = await importFuturePathRouteForTest();
      const user = createDummySuperadmin();
      const env = { ENVIRONMENT: 'production', DB: {} as any, DEEPSEEK_API_KEY: 'sk-key' };
      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'NOT_VALID_JSON{',
      });

      const response = await handleRoute(request, user, env as any);
      expect(response.status).toBe(400);
      expect(getBoundaryCalls().length).toBe(0);
      cleanup();
    });

    it('7.8 rejects array JSON with 400 INVALID_REQUEST', async () => {
      const { handleRoute, getBoundaryCalls, cleanup } = await importFuturePathRouteForTest();
      const user = createDummySuperadmin();
      const env = { ENVIRONMENT: 'production', DB: {} as any, DEEPSEEK_API_KEY: 'sk-key' };
      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([createDummyPayloads()]),
      });

      const response = await handleRoute(request, user, env as any);
      expect(response.status).toBe(400);
      expect(getBoundaryCalls().length).toBe(0);
      cleanup();
    });

    it('7.9 rejects null JSON with 400 INVALID_REQUEST', async () => {
      const { handleRoute, getBoundaryCalls, cleanup } = await importFuturePathRouteForTest();
      const user = createDummySuperadmin();
      const env = { ENVIRONMENT: 'production', DB: {} as any, DEEPSEEK_API_KEY: 'sk-key' };
      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'null',
      });

      const response = await handleRoute(request, user, env as any);
      expect(response.status).toBe(400);
      expect(getBoundaryCalls().length).toBe(0);
      cleanup();
    });

    it('7.10 rejects missing authorizationPackage with 400 INVALID_REQUEST', async () => {
      const { handleRoute, getBoundaryCalls, cleanup } = await importFuturePathRouteForTest();
      const user = createDummySuperadmin();
      const env = { ENVIRONMENT: 'production', DB: {} as any, DEEPSEEK_API_KEY: 'sk-key' };
      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceProvenanceReceipt: createDummyPayloads().sourceProvenanceReceipt,
        }),
      });

      const response = await handleRoute(request, user, env as any);
      expect(response.status).toBe(400);
      expect(getBoundaryCalls().length).toBe(0);
      cleanup();
    });

    it('7.11 rejects missing sourceProvenanceReceipt with 400 INVALID_REQUEST', async () => {
      const { handleRoute, getBoundaryCalls, cleanup } = await importFuturePathRouteForTest();
      const user = createDummySuperadmin();
      const env = { ENVIRONMENT: 'production', DB: {} as any, DEEPSEEK_API_KEY: 'sk-key' };
      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authorizationPackage: createDummyPayloads().authorizationPackage,
        }),
      });

      const response = await handleRoute(request, user, env as any);
      expect(response.status).toBe(400);
      expect(getBoundaryCalls().length).toBe(0);
      cleanup();
    });
  });

  // ==========================================================================
  // SUITE 8: Caller Env & Capability Injection Immunity
  // ==========================================================================
  describe('8. Caller Env & Capability Injection Immunity', () => {
    it('8.1 rejects extra top-level env, db, or apiKey fields with 400 INVALID_REQUEST', async () => {
      const { handleRoute, getBoundaryCalls, cleanup } = await importFuturePathRouteForTest();
      const user = createDummySuperadmin();
      const env = { ENVIRONMENT: 'production', DB: {} as any, DEEPSEEK_API_KEY: 'sk-key' };

      const maliciousKeys = [
        'env',
        'db',
        'backend',
        'apiKey',
        'credential',
        'getRuntimeCredential',
        'resolver',
        'replayResult',
        'clock',
        'options',
      ];

      for (const evilKey of maliciousKeys) {
        const body: Record<string, unknown> = {
          authorizationPackage: createDummyPayloads().authorizationPackage,
          sourceProvenanceReceipt: createDummyPayloads().sourceProvenanceReceipt,
          [evilKey]: 'hostile_value',
        };

        const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        const response = await handleRoute(request, user, env as any);
        expect(response.status).toBe(400);
        const json = await response.json();
        expect(json).toEqual({ error: 'INVALID_REQUEST' });
      }

      expect(getBoundaryCalls().length).toBe(0);
      cleanup();
    });

    it('8.2 hostile capabilities inside authorizationPackage do NOT override boundary host env', async () => {
      let boundaryReceivedEnv: any = null;
      const { handleRoute, cleanup } = await importFuturePathRouteForTest({
        onBoundaryCalled: (bEnv) => {
          boundaryReceivedEnv = bEnv;
        },
      });

      const user = createDummySuperadmin();
      const hostEnv = {
        ENVIRONMENT: 'production',
        DB: { hostDbInstance: true } as any,
        DEEPSEEK_API_KEY: 'sk-real-host-key',
      };

      const hostilePackage = {
        payload: {
          version: 'a12b2c5r-v1',
          runNonce: 'NONCE-001',
          authorityId: 'auth_prod_01',
          hostileEnv: { DB: 'fake_db', DEEPSEEK_API_KEY: 'fake_key' },
        },
        signatureBase64: 'sig_dummy',
        authorityId: 'auth_prod_01',
      };

      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authorizationPackage: hostilePackage,
          sourceProvenanceReceipt: createDummyPayloads().sourceProvenanceReceipt,
        }),
      });

      const response = await handleRoute(request, user, hostEnv as any);
      expect(response.status).toBe(200);

      expect(boundaryReceivedEnv).toBe(hostEnv);
      expect(boundaryReceivedEnv.DB).toBe(hostEnv.DB);
      expect(boundaryReceivedEnv.DEEPSEEK_API_KEY).toBe('sk-real-host-key');
      cleanup();
    });
  });

  // ==========================================================================
  // SUITE 9: Direct Host Env Reference Identity Across All Boundaries
  // ==========================================================================
  describe('9. Direct Host Env Reference Identity Across All Boundaries', () => {
    it('9.1 behaviorally proves host env reference identity across worker -> handler -> boundary', async () => {
      vi.resetModules();

      let boundaryReceivedEnv: any = null;

      vi.doMock('../../worker/ai/canary/deepSeekProductionOperationalRoutePolicy', () => ({
        PRODUCTION_CANARY_OPERATIONAL_ROUTE_PATH: '/api/ops/canary/deepseek-certification',
        PRODUCTION_CANARY_OPERATIONAL_ROUTE_ENABLED: true,
        PRODUCTION_CANARY_OPERATIONAL_INGRESS_AUTH_READY: true,
      }));

      vi.doMock('../../worker/ai/canary/deepSeekProductionWorkerCapabilityBoundary', () => ({
        executeProductionWorkerCanaryCertification: vi.fn(async (bEnv: any) => {
          boundaryReceivedEnv = bEnv;
          return {
            success: true,
            status: 'TRANSPORT_COMPLETED_PENDING_FINALIZATION',
            errors: [],
            providerNetworkCalls: 0,
            credentialReads: 0,
            transportAttempts: 0,
            completedTasks: 0,
            candidate: null,
            invocationResponses: [],
            invocationRecords: [],
            observedTotalCostMicroUsd: 0,
            authorizedBudgetMicroUsd: 0,
            aggregateSemanticScore: 0,
            allTasksPassed: true,
            allSchemasValid: true,
            finalCertificationEligible: false,
          };
        }),
      }));

      const actualAuth = await vi.importActual<any>('../../worker/auth/authContext');
      vi.doMock('../../worker/auth/authContext', () => ({
        ...actualAuth,
        AuthContextService: {
          ...actualAuth.AuthContextService,
          resolveSessionUser: vi.fn(() => createDummySuperadmin()),
        },
      }));

      const workerMod = await import('../../worker/index');
      const worker = workerMod.default;

      const hostEnvInstance: any = {
        ENVIRONMENT: 'production',
        DB: { id: 'd1_bound_instance_unique_ref' },
        DEEPSEEK_API_KEY: 'sk-test-secret',
      };

      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: {
          'Origin': 'https://velnar.studio',
          'Authorization': 'Bearer superadmin_token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(createDummyPayloads()),
      });

      const response = await worker.fetch(request, hostEnvInstance);
      expect(response.status).toBe(200);

      // Identity proof: host env in worker/index.ts === boundary env in capability module
      expect(boundaryReceivedEnv).toBe(hostEnvInstance);

      vi.doUnmock('../../worker/ai/canary/deepSeekProductionOperationalRoutePolicy');
      vi.doUnmock('../../worker/ai/canary/deepSeekProductionWorkerCapabilityBoundary');
      vi.doUnmock('../../worker/auth/authContext');
      vi.resetModules();
    });
  });

  // ==========================================================================
  // SUITE 10: Response Minimization & Data Hygiene
  // ==========================================================================
  describe('10. Response Minimization & Data Hygiene', () => {
    it('10.1 strips candidate, invocationResponses, and invocationRecords from operational response', async () => {
      const sentinelCandidate = { candidateId: 'SECRET_CANDIDATE_ID_12345' };
      const sentinelResponses = [{ rawText: 'SECRET_PROVIDER_TEXT_ABCDE' }];
      const sentinelRecords = [{ recordId: 'SECRET_TASK_RECORD_99999' }];

      const { handleRoute, cleanup } = await importFuturePathRouteForTest({
        mockBoundaryResult: {
          candidate: sentinelCandidate as any,
          invocationResponses: sentinelResponses as any,
          invocationRecords: sentinelRecords as any,
          observedTotalCostMicroUsd: 15000,
          authorizedBudgetMicroUsd: 50000,
          aggregateSemanticScore: 99,
          allTasksPassed: true,
          allSchemasValid: true,
        },
      });

      const user = createDummySuperadmin();
      const env = { ENVIRONMENT: 'production', DB: {} as any, DEEPSEEK_API_KEY: 'sk-key' };
      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createDummyPayloads()),
      });

      const response = await handleRoute(request, user, env as any);
      expect(response.status).toBe(200);

      const json = (await response.json()) as any;

      // Ensure stripped fields are undefined
      expect(json.candidate).toBeUndefined();
      expect(json.invocationResponses).toBeUndefined();
      expect(json.invocationRecords).toBeUndefined();

      // Ensure secret sentinels are not in raw string
      const rawJsonString = JSON.stringify(json);
      expect(rawJsonString).not.toContain('SECRET_CANDIDATE_ID_12345');
      expect(rawJsonString).not.toContain('SECRET_PROVIDER_TEXT_ABCDE');
      expect(rawJsonString).not.toContain('SECRET_TASK_RECORD_99999');

      // Ensure allowlisted summary fields exist
      expect(json.success).toBe(true);
      expect(json.status).toBe('TRANSPORT_COMPLETED_PENDING_FINALIZATION');
      expect(json.observedTotalCostMicroUsd).toBe(15000);
      expect(json.authorizedBudgetMicroUsd).toBe(50000);
      expect(json.aggregateSemanticScore).toBe(99);
      expect(json.allTasksPassed).toBe(true);
      expect(json.allSchemasValid).toBe(true);
      expect(json.finalCertificationEligible).toBe(false);

      cleanup();
    });

    it('10.2 unexpected handler exceptions fail closed with 500 INTERNAL_ERROR without leaking details', async () => {
      const { handleRoute, cleanup } = await importFuturePathRouteForTest({
        mockBoundaryResult: undefined,
      });

      // Inject throwing request to trigger catch block
      const throwingRequest = {
        method: 'POST',
        url: 'https://velnar.studio/api/ops/canary/deepseek-certification',
        headers: new Headers({ 'Content-Type': 'application/json' }),
        text: async () => {
          throw new Error('DATABASE_PASSWORD_LEAK_SECRET_XYZ');
        },
      } as unknown as Request;

      const user = createDummySuperadmin();
      const env = { ENVIRONMENT: 'production', DB: {} as any, DEEPSEEK_API_KEY: 'sk-key' };

      const response = await handleRoute(throwingRequest, user, env as any);
      expect(response.status).toBe(500);

      const json = await response.json();
      expect(json).toEqual({ error: 'INTERNAL_ERROR' });
      expect(JSON.stringify(json)).not.toContain('DATABASE_PASSWORD_LEAK');

      cleanup();
    });
  });

  // ==========================================================================
  // SUITE 11: Single Boundary Invocation & Exact Signature Contract
  // ==========================================================================
  describe('11. Single Boundary Invocation & Exact Signature Contract', () => {
    it('11.1 calls capability boundary exactly once with exact 3 arguments', async () => {
      const { handleRoute, getBoundaryCalls, cleanup } = await importFuturePathRouteForTest();
      const user = createDummySuperadmin();
      const hostEnv = { ENVIRONMENT: 'production', DB: {} as any, DEEPSEEK_API_KEY: 'sk-key' };
      const payloads = createDummyPayloads();

      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloads),
      });

      await handleRoute(request, user, hostEnv as any);

      const calls = getBoundaryCalls();
      expect(calls.length).toBe(1);
      expect(calls[0].env).toBe(hostEnv);
      expect(calls[0].pkg).toEqual(payloads.authorizationPackage);
      expect(calls[0].receipt).toEqual(payloads.sourceProvenanceReceipt);

      cleanup();
    });
  });

  // ==========================================================================
  // SUITE 12: Tenant AI Isolation & Authoritative Dormant Gates Audit
  // ==========================================================================
  describe('12. Tenant AI Isolation & Authoritative Dormant Gates Audit', () => {
    it('12.1 worker/routes/aiRouter.ts does not import operational route or capability boundary', () => {
      const aiRouterPath = path.resolve(__dirname, '../../worker/routes/aiRouter.ts');
      const aiRouterContent = fs.readFileSync(aiRouterPath, 'utf8');

      expect(aiRouterContent).not.toContain('handleProductionCanaryOperationalRoute');
      expect(aiRouterContent).not.toContain('executeProductionWorkerCanaryCertification');
      expect(aiRouterContent).not.toContain('deepSeekProductionWorkerOperationalRoute');
      expect(aiRouterContent).not.toContain('deepSeekProductionWorkerCapabilityBoundary');
      expect(aiRouterContent).not.toContain('deepSeekProductionOperationalRoutePolicy');
    });

    it('12.2 all 11 authoritative canary readiness and operational gates remain strictly false', () => {
      // 9 core canary gates
      expect(CANARY_LIVE_EXECUTION_ENABLED).toBe(false);
      expect(CANARY_LIVE_EXECUTION_STATE).toBe('BLOCKED_PENDING_CERTIFICATION');
      expect(GUARDED_SOURCE_ATTESTATION_READY).toBe(false);
      expect(GUARDED_HUMAN_AUTH_ATTESTATION_READY).toBe(false);
      expect(PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED).toBe(false);
      expect(RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_PROVISIONED).toBe(false);
      expect(D1_REPLAY_BACKEND_PRODUCTION_BOUND).toBe(false);
      expect(D1_REPLAY_BACKEND_REAL_DATABASE_PROVISIONED).toBe(false);
      expect(D1_REPLAY_BACKEND_REAL_CONCURRENCY_CERTIFIED).toBe(false);

      // 2 operational route gates
      expect(PRODUCTION_CANARY_OPERATIONAL_ROUTE_ENABLED).toBe(false);
      expect(PRODUCTION_CANARY_OPERATIONAL_INGRESS_AUTH_READY).toBe(false);
    });

    it('12.3 operational route handler file performs ZERO logging and imports no SafeLogger', () => {
      const routePath = path.resolve(__dirname, '../../worker/ai/canary/deepSeekProductionWorkerOperationalRoute.ts');
      const routeContent = fs.readFileSync(routePath, 'utf8');

      expect(routeContent).not.toContain('SafeLogger');
      expect(routeContent).not.toContain('console.log');
      expect(routeContent).not.toContain('console.error');
      expect(routeContent).not.toContain('console.warn');
    });

    it('12.4 operational route policy module has ZERO imports', () => {
      const policyPath = path.resolve(__dirname, '../../worker/ai/canary/deepSeekProductionOperationalRoutePolicy.ts');
      const policyContent = fs.readFileSync(policyPath, 'utf8');

      expect(policyContent).not.toContain('import ');
      expect(policyContent).not.toContain('require(');
    });
  });
});
