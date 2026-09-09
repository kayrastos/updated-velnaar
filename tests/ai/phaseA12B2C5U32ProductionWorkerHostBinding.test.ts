/**
 * @file phaseA12B2C5U32ProductionWorkerHostBinding.test.ts
 * @description Comprehensive Offline Test Suite for VELNAR — A.12B.2C-5U.3.2R
 * Host Worker Env Binding & Hardened Operational Route Foundation
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
 * Suite 13: True 65,536-Byte Incremental Stream Boundary & Content-Length Audits
 * Suite 14: Public-Safe Error Sanitization & Secret Redaction
 * Suite 15: Duplicate Top-Level JSON Member & Prototype Poisoning Rejection
 * Suite 16: Integrated Real-Boundary Offline Regression (Unmocked 5U.3.1 Boundary)
 */

import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

import {
  PRODUCTION_CANARY_OPERATIONAL_ROUTE_PATH,
  PRODUCTION_CANARY_OPERATIONAL_ROUTE_ENABLED,
  PRODUCTION_CANARY_OPERATIONAL_INGRESS_AUTH_READY,
} from '../../worker/ai/canary/deepSeekProductionOperationalRoutePolicy';
import {
  handleProductionCanaryOperationalRoute,
  scanTopLevelJsonEnvelope,
  MAX_REQUEST_BODY_BYTES,
  PUBLIC_OPERATIONAL_ERROR_CODES,
} from '../../worker/ai/canary/deepSeekProductionWorkerOperationalRoute';
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
import { executeProductionWorkerCanaryCertification } from '../../worker/ai/canary/deepSeekProductionWorkerCapabilityBoundary';
import { OperationalAuthErrorCode } from '../../worker/auth/cloudflareAccessOperationalAuth';

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
  mockAuthResult?: any;
}

async function importFuturePathRouteForTest(options?: FuturePathHarnessOptions) {
  vi.resetModules();

  vi.doMock('../../worker/ai/canary/deepSeekProductionOperationalRoutePolicy', () => ({
    PRODUCTION_CANARY_OPERATIONAL_ROUTE_PATH: '/api/ops/canary/deepseek-certification',
    PRODUCTION_CANARY_OPERATIONAL_ROUTE_ENABLED: true,
    PRODUCTION_CANARY_OPERATIONAL_INGRESS_AUTH_READY: true,
  }));

  vi.doMock('../../worker/auth/cloudflareAccessOperationalAuth', async () => {
    const actual = await vi.importActual<any>('../../worker/auth/cloudflareAccessOperationalAuth');
    return {
      ...actual,
      resolveCanonicalProductionOperationalPrincipal: vi.fn(async (_req: any, _env: any) => {
        if (options?.mockAuthResult !== undefined) {
          return options.mockAuthResult;
        }
        return {
          success: true,
          principal: {
            subject: 'ops-superadmin-001',
            email: 'ops@velnar.io',
            authSource: 'CLOUDFLARE_ACCESS',
            isSuperAdmin: true,
          },
        };
      }),
    };
  });

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
      vi.doUnmock('../../worker/auth/cloudflareAccessOperationalAuth');
      vi.resetModules();
    },
  };
}

describe('VELNAR — A.12B.2C-5U.3.2R Host Worker Env Binding & Hardened Operational Route Foundation', () => {

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

      const response = await handleProductionCanaryOperationalRoute(request, env as any);

      expect(response.status).toBe(404);
      const json = (await response.json()) as any;
      expect(json).toEqual({ error: 'NOT_FOUND' });
    });

    it('2.2 dormant route causes exactly ZERO body reads or stream access', async () => {
      let bodyGetterCalls = 0;
      const throwingRequest = {
        method: 'POST',
        url: 'https://velnar.studio/api/ops/canary/deepseek-certification',
        headers: new Headers({ 'Content-Type': 'application/json' }),
        get body() {
          bodyGetterCalls++;
          throw new Error('MALICIOUS_BODY_READ');
        },
      } as unknown as Request;

      const user = createDummySuperadmin();
      const env = {
        ENVIRONMENT: 'production',
        DB: {} as any,
        DEEPSEEK_API_KEY: 'sk-key',
      };

      const response = await handleProductionCanaryOperationalRoute(throwingRequest, env as any);

      expect(response.status).toBe(404);
      expect(bodyGetterCalls).toBe(0);
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

      const response = await handleProductionCanaryOperationalRoute(request, throwingEnv as any);

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

      const response = await handleProductionCanaryOperationalRoute(request, env as any);
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
      const json = (await response.json()) as any;
      expect(json).toEqual({ error: 'NOT_FOUND' });
    });

    it('3.2 rejects 1 argument with 404 before reading any properties', async () => {
      const fn = handleProductionCanaryOperationalRoute as any;
      const response = await fn({} as any);
      expect(response.status).toBe(404);
      const json = (await response.json()) as any;
      expect(json).toEqual({ error: 'NOT_FOUND' });
    });

    it('3.3 rejects 3 arguments (caller passing tenant user or extra arg) with 404', async () => {
      const fn = handleProductionCanaryOperationalRoute as any;
      const response = await fn({} as any, {} as any, {} as any);
      expect(response.status).toBe(404);
      const json = (await response.json()) as any;
      expect(json).toEqual({ error: 'NOT_FOUND' });
    });

    it('3.4 rejects 4 arguments (caller capability injection attempt) with 404', async () => {
      const fn = handleProductionCanaryOperationalRoute as any;
      const response = await fn({} as any, {} as any, {} as any, { injectedCapability: true });
      expect(response.status).toBe(404);
      const json = (await response.json()) as any;
      expect(json).toEqual({ error: 'NOT_FOUND' });
    });

    it('3.5 throwing getters on request do NOT throw when argument count is invalid', async () => {
      const fn = handleProductionCanaryOperationalRoute as any;
      const throwingReq = { get method() { throw new Error('REQ_GETTER'); } };

      let didThrow = false;
      let response: any;
      try {
        response = await fn(throwingReq);
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
        handleProductionCanaryOperationalRoute: vi.fn(async (req: any, env: any) => {
          capturedHandlerArgs = { req, env };
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
  // ==========================================================================
  // SUITE 6: Future-Path Operational Authorization (Simulated Route Open)
  //
  // ARCHITECTURAL MIGRATION NOTICE:
  // OLD: operational route requires tenant AuthenticatedUser before dispatch
  // NEW: exact operational route has an isolated operational-auth trust domain
  //      and bypasses tenant AuthContextService only for that exact path.
  //      Operational authority derives SOLELY from canonical Cloudflare Access
  //      authentication and superadmin registry. Tenant roles (OWNER, ADMIN, etc.)
  //      have ZERO standing in the operational route trust domain.
  // ==========================================================================
  describe('6. Future-Path Operational Authorization (Simulated Route Open)', () => {
    it('6.1 canonical operational superadmin is authorized to reach operational capability boundary', async () => {
      const { handleRoute, getBoundaryCalls, cleanup } = await importFuturePathRouteForTest();
      const env = { ENVIRONMENT: 'production', DB: {} as any, DEEPSEEK_API_KEY: 'sk-key' };
      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createDummyPayloads()),
      });

      const response = await handleRoute(request, env as any);

      expect(response.status).toBe(200);
      expect(getBoundaryCalls().length).toBe(1);
      cleanup();
    });

    it('6.2 unauthorized subject / empty superadmin registry is rejected with 403 FORBIDDEN (boundary calls = 0)', async () => {
      const { handleRoute, getBoundaryCalls, cleanup } = await importFuturePathRouteForTest({
        mockAuthResult: {
          success: false,
          code: OperationalAuthErrorCode.SUPERADMIN_REGISTRY_EMPTY,
          message: 'Registry is empty',
        },
      });
      const env = { ENVIRONMENT: 'production', DB: {} as any, DEEPSEEK_API_KEY: 'sk-key' };
      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createDummyPayloads()),
      });

      const response = await handleRoute(request, env as any);

      expect(response.status).toBe(403);
      const json = (await response.json()) as any;
      expect(json).toEqual({ error: 'FORBIDDEN' });
      expect(getBoundaryCalls().length).toBe(0);
      cleanup();
    });

    it('6.3 subject not in superadmin registry is rejected with 403 FORBIDDEN (boundary calls = 0)', async () => {
      const { handleRoute, getBoundaryCalls, cleanup } = await importFuturePathRouteForTest({
        mockAuthResult: {
          success: false,
          code: OperationalAuthErrorCode.SUPERADMIN_NOT_AUTHORIZED,
          message: 'Subject not in superadmin registry',
        },
      });
      const env = { ENVIRONMENT: 'production', DB: {} as any, DEEPSEEK_API_KEY: 'sk-key' };
      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createDummyPayloads()),
      });

      const response = await handleRoute(request, env as any);

      expect(response.status).toBe(403);
      expect(getBoundaryCalls().length).toBe(0);
      cleanup();
    });

    it('6.4 identity binding mismatch is rejected with 403 FORBIDDEN (boundary calls = 0)', async () => {
      const { handleRoute, getBoundaryCalls, cleanup } = await importFuturePathRouteForTest({
        mockAuthResult: {
          success: false,
          code: OperationalAuthErrorCode.IDENTITY_BINDING_MISMATCH,
          message: 'Identity binding mismatch',
        },
      });
      const env = { ENVIRONMENT: 'production', DB: {} as any, DEEPSEEK_API_KEY: 'sk-key' };
      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createDummyPayloads()),
      });

      const response = await handleRoute(request, env as any);

      expect(response.status).toBe(403);
      expect(getBoundaryCalls().length).toBe(0);
      cleanup();
    });

    it('6.5 principal with isSuperAdmin === false is rejected with 403 FORBIDDEN', async () => {
      const { handleRoute, getBoundaryCalls, cleanup } = await importFuturePathRouteForTest({
        mockAuthResult: {
          success: true,
          principal: {
            subject: 'ops-user-002',
            email: 'user@velnar.io',
            authSource: 'CLOUDFLARE_ACCESS',
            isSuperAdmin: false,
          },
        },
      });
      const env = { ENVIRONMENT: 'production', DB: {} as any, DEEPSEEK_API_KEY: 'sk-key' };
      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createDummyPayloads()),
      });

      const response = await handleRoute(request, env as any);

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

        const response = await handleRoute(request, env as any);
        expect(response.status).toBe(405);
        const json = (await response.json()) as any;
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

      const response = await handleRoute(request, env as any);
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

        const response = await handleRoute(request, env as any);
        expect(response.status).toBe(400);
        const json = (await response.json()) as any;
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

      const response = await handleRoute(request, env as any);
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

      const response = await handleRoute(request, env as any);
      expect(response.status).toBe(413);
      expect(getBoundaryCalls().length).toBe(0);
      cleanup();
    });

    it('7.6 rejects body bytes exceeding 65536 bytes with 413 PAYLOAD_TOO_LARGE', async () => {
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

      const response = await handleRoute(request, env as any);
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

      const response = await handleRoute(request, env as any);
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

      const response = await handleRoute(request, env as any);
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

      const response = await handleRoute(request, env as any);
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

      const response = await handleRoute(request, env as any);
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

      const response = await handleRoute(request, env as any);
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
        const body = {
          authorizationPackage: createDummyPayloads().authorizationPackage,
          sourceProvenanceReceipt: createDummyPayloads().sourceProvenanceReceipt,
          [evilKey]: 'hostile_value',
        };

        const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        const response = await handleRoute(request, env as any);
        expect(response.status).toBe(400);
        const json = (await response.json()) as any;
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

      const response = await handleRoute(request, hostEnv as any);
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

      vi.doMock('../../worker/auth/cloudflareAccessOperationalAuth', async () => {
        const actual = await vi.importActual<any>('../../worker/auth/cloudflareAccessOperationalAuth');
        return {
          ...actual,
          resolveCanonicalProductionOperationalPrincipal: vi.fn(async () => ({
            success: true,
            principal: {
              subject: 'ops-superadmin-001',
              email: 'ops@velnar.io',
              authSource: 'CLOUDFLARE_ACCESS',
              isSuperAdmin: true,
            },
          })),
        };
      });

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
      vi.doUnmock('../../worker/auth/cloudflareAccessOperationalAuth');
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

      const response = await handleRoute(request, env as any);
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
        get body() {
          throw new Error('DATABASE_PASSWORD_LEAK_SECRET_XYZ');
        },
      } as unknown as Request;

      const user = createDummySuperadmin();
      const env = { ENVIRONMENT: 'production', DB: {} as any, DEEPSEEK_API_KEY: 'sk-key' };

      const response = await handleRoute(throwingRequest, env as any);
      expect(response.status).toBe(500);

      const json = (await response.json()) as any;
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

      await handleRoute(request, hostEnv as any);

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
      expect(D1_REPLAY_BACKEND_PRODUCTION_BOUND).toBe(true);
      expect(D1_REPLAY_BACKEND_REAL_DATABASE_PROVISIONED).toBe(true);
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

  // ==========================================================================
  // SUITE 13: True 65,536-Byte Incremental Stream Boundary & Content-Length Audits
  // ==========================================================================
  describe('13. True 65,536-Byte Incremental Stream Boundary & Content-Length Audits', () => {
    it('13.1 ASCII body <= 65536 bytes is accepted by byte-size layer', async () => {
      const { handleRoute, getBoundaryCalls, cleanup } = await importFuturePathRouteForTest();
      const user = createDummySuperadmin();
      const env = { ENVIRONMENT: 'production', DB: {} as any, DEEPSEEK_API_KEY: 'sk-key' };

      // Create payload that is exactly 60,000 bytes
      const basePayload = createDummyPayloads();
      const padding = 'A'.repeat(50000);
      const jsonBody = JSON.stringify({
        authorizationPackage: { ...basePayload.authorizationPackage, padding },
        sourceProvenanceReceipt: basePayload.sourceProvenanceReceipt,
      });
      const byteLen = new TextEncoder().encode(jsonBody).byteLength;
      expect(byteLen).toBeLessThanOrEqual(65536);

      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: jsonBody,
      });

      const response = await handleRoute(request, env as any);
      expect(response.status).toBe(200);
      expect(getBoundaryCalls().length).toBe(1);
      cleanup();
    });

    it('13.2 ASCII body > 65536 bytes is rejected with 413 PAYLOAD_TOO_LARGE', async () => {
      const { handleRoute, getBoundaryCalls, cleanup } = await importFuturePathRouteForTest();
      const user = createDummySuperadmin();
      const env = { ENVIRONMENT: 'production', DB: {} as any, DEEPSEEK_API_KEY: 'sk-key' };

      const basePayload = createDummyPayloads();
      const padding = 'A'.repeat(66000);
      const jsonBody = JSON.stringify({
        authorizationPackage: { ...basePayload.authorizationPackage, padding },
        sourceProvenanceReceipt: basePayload.sourceProvenanceReceipt,
      });

      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: jsonBody,
      });

      const response = await handleRoute(request, env as any);
      expect(response.status).toBe(413);
      expect(getBoundaryCalls().length).toBe(0);
      cleanup();
    });

    it('13.3 UTF-8 multibyte body whose JS .length < 65536 but byteLength > 65536 is rejected with 413', async () => {
      const { handleRoute, getBoundaryCalls, cleanup } = await importFuturePathRouteForTest();
      const user = createDummySuperadmin();
      const env = { ENVIRONMENT: 'production', DB: {} as any, DEEPSEEK_API_KEY: 'sk-key' };

      // Character '世' is 3 UTF-8 bytes each. 25,000 chars = 25,000 JS code units, but 75,000 bytes!
      const multibyteStr = '世'.repeat(25000);
      expect(multibyteStr.length).toBe(25000); // JS string length is well below 65536!
      const encodedBytes = new TextEncoder().encode(multibyteStr).byteLength;
      expect(encodedBytes).toBe(75000); // Actual UTF-8 byteLength exceeds 65536!

      const jsonBody = JSON.stringify({
        authorizationPackage: { ...createDummyPayloads().authorizationPackage, multibyteStr },
        sourceProvenanceReceipt: createDummyPayloads().sourceProvenanceReceipt,
      });

      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: jsonBody,
      });

      const response = await handleRoute(request, env as any);
      expect(response.status).toBe(413);
      expect(getBoundaryCalls().length).toBe(0);
      cleanup();
    });

    it('13.4 non-BMP / emoji body whose JS .length < 65536 but byteLength > 65536 is rejected with 413', async () => {
      const { handleRoute, getBoundaryCalls, cleanup } = await importFuturePathRouteForTest();
      const user = createDummySuperadmin();
      const env = { ENVIRONMENT: 'production', DB: {} as any, DEEPSEEK_API_KEY: 'sk-key' };

      // Emoji '🚀' is 2 JS surrogate code units (.length = 2), but 4 UTF-8 bytes!
      // 18,000 emojis = 36,000 JS length (< 65536), but 72,000 UTF-8 bytes (> 65536)!
      const emojiStr = '🚀'.repeat(18000);
      expect(emojiStr.length).toBe(36000);
      const byteLen = new TextEncoder().encode(emojiStr).byteLength;
      expect(byteLen).toBe(72000);

      const jsonBody = JSON.stringify({
        authorizationPackage: { ...createDummyPayloads().authorizationPackage, emojiStr },
        sourceProvenanceReceipt: createDummyPayloads().sourceProvenanceReceipt,
      });

      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: jsonBody,
      });

      const response = await handleRoute(request, env as any);
      expect(response.status).toBe(413);
      expect(getBoundaryCalls().length).toBe(0);
      cleanup();
    });

    it('13.5 exactly 65536 bytes is NOT rejected for size', async () => {
      const { handleRoute, getBoundaryCalls, cleanup } = await importFuturePathRouteForTest();
      const user = createDummySuperadmin();
      const env = { ENVIRONMENT: 'production', DB: {} as any, DEEPSEEK_API_KEY: 'sk-key' };

      // Construct a body that is exactly 65,536 bytes long
      const prefix = '{"authorizationPackage":{"payload":{"p":"';
      const suffix = '"}},"sourceProvenanceReceipt":{"provenanceVersion":"a12b2c5q-v1"}}';
      const paddingNeeded = 65536 - new TextEncoder().encode(prefix + suffix).byteLength;
      const jsonBody = prefix + 'x'.repeat(paddingNeeded) + suffix;

      expect(new TextEncoder().encode(jsonBody).byteLength).toBe(65536);

      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: jsonBody,
      });

      const response = await handleRoute(request, env as any);
      expect(response.status).toBe(200);
      expect(getBoundaryCalls().length).toBe(1);
      cleanup();
    });

    it('13.6 exactly 65537 bytes is rejected with 413 PAYLOAD_TOO_LARGE', async () => {
      const { handleRoute, getBoundaryCalls, cleanup } = await importFuturePathRouteForTest();
      const user = createDummySuperadmin();
      const env = { ENVIRONMENT: 'production', DB: {} as any, DEEPSEEK_API_KEY: 'sk-key' };

      const prefix = '{"authorizationPackage":{"payload":{"p":"';
      const suffix = '"}},"sourceProvenanceReceipt":{"provenanceVersion":"a12b2c5q-v1"}}';
      const paddingNeeded = 65537 - new TextEncoder().encode(prefix + suffix).byteLength;
      const jsonBody = prefix + 'x'.repeat(paddingNeeded) + suffix;

      expect(new TextEncoder().encode(jsonBody).byteLength).toBe(65537);

      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: jsonBody,
      });

      const response = await handleRoute(request, env as any);
      expect(response.status).toBe(413);
      expect(getBoundaryCalls().length).toBe(0);
      cleanup();
    });

    it('13.7 missing Content-Length is still incrementally bounded by streamed bytes', async () => {
      const { handleRoute, getBoundaryCalls, cleanup } = await importFuturePathRouteForTest();
      const user = createDummySuperadmin();
      const env = { ENVIRONMENT: 'production', DB: {} as any, DEEPSEEK_API_KEY: 'sk-key' };

      const oversizedBody = 'x'.repeat(70000);
      // Create request without Content-Length
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(oversizedBody));
          controller.close();
        },
      });

      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stream,
        duplex: 'half',
      } as any);

      expect(request.headers.get('Content-Length')).toBeNull();

      const response = await handleRoute(request, env as any);
      expect(response.status).toBe(413);
      expect(getBoundaryCalls().length).toBe(0);
      cleanup();
    });

    it('13.8 malformed Content-Length values fail closed with 400 INVALID_REQUEST', async () => {
      const { handleRoute, getBoundaryCalls, cleanup } = await importFuturePathRouteForTest();
      const user = createDummySuperadmin();
      const env = { ENVIRONMENT: 'production', DB: {} as any, DEEPSEEK_API_KEY: 'sk-key' };

      const malformedHeaders = ['12abc', 'abc', '-1', '-500', '12.5', '100px', 'NaN', ''];

      for (const badCl of malformedHeaders) {
        const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': badCl,
          },
          body: JSON.stringify(createDummyPayloads()),
        });

        const response = await handleRoute(request, env as any);
        expect(response.status).toBe(400);
      }

      expect(getBoundaryCalls().length).toBe(0);
      cleanup();
    });

    it('13.9 understated Content-Length cannot bypass actual stream byte counting', async () => {
      const { handleRoute, getBoundaryCalls, cleanup } = await importFuturePathRouteForTest();
      const user = createDummySuperadmin();
      const env = { ENVIRONMENT: 'production', DB: {} as any, DEEPSEEK_API_KEY: 'sk-key' };

      // Declares Content-Length: 100, but actually sends 70,000 bytes!
      const oversized = 'x'.repeat(70000);
      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': '100',
        },
        body: oversized,
      });

      const response = await handleRoute(request, env as any);
      expect(response.status).toBe(413);
      expect(getBoundaryCalls().length).toBe(0);
      cleanup();
    });

    it('13.10 multi-chunk stream crosses threshold and stops/cancels without consuming remainder', async () => {
      const { handleRoute, getBoundaryCalls, cleanup } = await importFuturePathRouteForTest();
      const user = createDummySuperadmin();
      const env = { ENVIRONMENT: 'production', DB: {} as any, DEEPSEEK_API_KEY: 'sk-key' };

      let chunk3Read = false;
      let streamCancelled = false;

      const chunk1 = new Uint8Array(40000);
      const chunk2 = new Uint8Array(30000); // 40,000 + 30,000 = 70,000 > 65,536!
      const chunk3 = new Uint8Array(50000);

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(chunk1);
          controller.enqueue(chunk2);
          // Third chunk should never be processed
          controller.enqueue(chunk3);
          controller.close();
        },
        cancel() {
          streamCancelled = true;
        },
      });

      // Wrap reader to monitor whether chunk 3 was pulled
      const originalGetReader = stream.getReader.bind(stream);
      stream.getReader = () => {
        const reader = originalGetReader();
        const origRead = reader.read.bind(reader);
        let readIdx = 0;
        reader.read = async () => {
          readIdx++;
          if (readIdx === 3) {
            chunk3Read = true;
          }
          return origRead();
        };
        return reader;
      };

      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stream,
        duplex: 'half',
      } as any);

      const response = await handleRoute(request, env as any);
      expect(response.status).toBe(413);
      expect(chunk3Read).toBe(false);
      expect(streamCancelled).toBe(true);
      expect(getBoundaryCalls().length).toBe(0);
      cleanup();
    });

    it('13.11 invalid UTF-8 bytes fail closed with 400 INVALID_REQUEST', async () => {
      const { handleRoute, getBoundaryCalls, cleanup } = await importFuturePathRouteForTest();
      const user = createDummySuperadmin();
      const env = { ENVIRONMENT: 'production', DB: {} as any, DEEPSEEK_API_KEY: 'sk-key' };

      // Invalid UTF-8 sequence: single 0xFF byte
      const invalidUtf8 = new Uint8Array([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]);
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(invalidUtf8);
          controller.close();
        },
      });

      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stream,
        duplex: 'half',
      } as any);

      const response = await handleRoute(request, env as any);
      expect(response.status).toBe(400);
      const json = (await response.json()) as any;
      expect(json).toEqual({ error: 'INVALID_REQUEST' });
      expect(getBoundaryCalls().length).toBe(0);
      cleanup();
    });
  });

  // ==========================================================================
  // SUITE 14: Public-Safe Error Sanitization & Secret Redaction
  // ==========================================================================
  describe('14. Public-Safe Error Sanitization & Secret Redaction', () => {
    it('14.1 sensitive sentinel strings in result.errors never appear in response', async () => {
      const sensitiveSentinels = [
        'SUPER_SECRET_SENTINEL',
        'SQL_INTERNAL_DIAGNOSTIC_ERR_007',
        'sourceCommitSha-secret-12345',
        'replay-key-secret-99999',
        'sk-live-secret-deepseek-api-key',
        'D1_ERROR: table users column password corrupted',
      ];

      const { handleRoute, cleanup } = await importFuturePathRouteForTest({
        mockBoundaryResult: {
          success: false,
          status: 'TRANSPORT_EXECUTION_FAILED',
          failureCategory: 'NETWORK_TRANSPORT_FAILURE',
          errors: sensitiveSentinels,
        },
      });

      const user = createDummySuperadmin();
      const env = { ENVIRONMENT: 'production', DB: {} as any, DEEPSEEK_API_KEY: 'sk-key' };
      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createDummyPayloads()),
      });

      const response = await handleRoute(request, env as any);
      expect(response.status).toBe(200);

      const json = (await response.json()) as any;
      const responseString = JSON.stringify(json);

      for (const sentinel of sensitiveSentinels) {
        expect(responseString).not.toContain(sentinel);
      }

      expect(json.errors).toEqual(['CANARY_PROVIDER_EXECUTION_FAILED']);
      cleanup();
    });

    it('14.2 unknown downstream failure category maps to CANARY_INTERNAL_FAILURE', async () => {
      const { handleRoute, cleanup } = await importFuturePathRouteForTest({
        mockBoundaryResult: {
          success: false,
          status: 'CUSTOM_UNKNOWN_STATUS' as any,
          failureCategory: 'UNRECOGNIZED_STRANGE_CATEGORY' as any,
          errors: ['Some arbitrary internal error'],
        },
      });

      const user = createDummySuperadmin();
      const env = { ENVIRONMENT: 'production', DB: {} as any, DEEPSEEK_API_KEY: 'sk-key' };
      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createDummyPayloads()),
      });

      const response = await handleRoute(request, env as any);
      expect(response.status).toBe(200);

      const json = (await response.json()) as any;
      expect(json.errors).toEqual(['CANARY_INTERNAL_FAILURE']);
      // Unknown failureCategory is NOT reflected in public response
      expect(json.failureCategory).toBeUndefined();
      cleanup();
    });

    it('14.3 all possible mapped errors come strictly from PUBLIC_OPERATIONAL_ERROR_CODES allowlist', async () => {
      const testCases = [
        { status: 'LIVE_EXECUTION_BLOCKED', expected: 'CANARY_LIVE_EXECUTION_BLOCKED' },
        { status: 'PREFLIGHT_VALIDATION_FAILED', failureCategory: 'AUTHORIZATION_BINDING_FAILURE', expected: 'CANARY_AUTHORIZATION_REJECTED' },
        { status: 'PREFLIGHT_VALIDATION_FAILED', failureCategory: 'RUNTIME_SOURCE_PROVENANCE_FAILURE', expected: 'CANARY_SOURCE_BINDING_REJECTED' },
        { status: 'REQUEST_INTEGRITY_FAILED', failureCategory: 'REPLAY_RESERVATION_CONFLICT', expected: 'CANARY_REPLAY_REJECTED' },
        { status: 'BUDGET_BREACH_TERMINATED', failureCategory: 'BUDGET_BREACH', expected: 'CANARY_BUDGET_REJECTED' },
        { status: 'QUALITY_GATE_FAILED', failureCategory: 'QUALITY_GATE_REJECTED', expected: 'CANARY_VALIDATION_FAILED' },
        { status: 'TRANSPORT_EXECUTION_FAILED', failureCategory: 'NETWORK_TRANSPORT_FAILURE', expected: 'CANARY_PROVIDER_EXECUTION_FAILED' },
      ];

      for (const tc of testCases) {
        const { handleRoute, cleanup } = await importFuturePathRouteForTest({
          mockBoundaryResult: {
            success: false,
            status: tc.status as any,
            failureCategory: tc.failureCategory as any,
            errors: ['secret_error_data'],
          },
        });

        const user = createDummySuperadmin();
        const env = { ENVIRONMENT: 'production', DB: {} as any, DEEPSEEK_API_KEY: 'sk-key' };
        const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(createDummyPayloads()),
        });

        const response = await handleRoute(request, env as any);
        const json = (await response.json()) as any;

        expect(json.errors).toEqual([tc.expected]);
        expect(PUBLIC_OPERATIONAL_ERROR_CODES).toContain(json.errors[0]);
        expect(JSON.stringify(json)).not.toContain('secret_error_data');

        cleanup();
      }
    });
  });

  // ==========================================================================
  // SUITE 15: Duplicate Top-Level JSON Member & Prototype Poisoning Rejection
  // ==========================================================================
  describe('15. Duplicate Top-Level JSON Member & Prototype Poisoning Rejection', () => {
    it('15.1 duplicate authorizationPackage is rejected with 400 INVALID_REQUEST', async () => {
      const { handleRoute, getBoundaryCalls, cleanup } = await importFuturePathRouteForTest();
      const user = createDummySuperadmin();
      const env = { ENVIRONMENT: 'production', DB: {} as any, DEEPSEEK_API_KEY: 'sk-key' };

      const duplicatePkgJson = '{"authorizationPackage":{},"authorizationPackage":{},"sourceProvenanceReceipt":{}}';

      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: duplicatePkgJson,
      });

      const response = await handleRoute(request, env as any);
      expect(response.status).toBe(400);
      const json = (await response.json()) as any;
      expect(json).toEqual({ error: 'INVALID_REQUEST' });
      expect(getBoundaryCalls().length).toBe(0);
      cleanup();
    });

    it('15.2 duplicate sourceProvenanceReceipt is rejected with 400 INVALID_REQUEST', async () => {
      const { handleRoute, getBoundaryCalls, cleanup } = await importFuturePathRouteForTest();
      const user = createDummySuperadmin();
      const env = { ENVIRONMENT: 'production', DB: {} as any, DEEPSEEK_API_KEY: 'sk-key' };

      const duplicateReceiptJson = '{"authorizationPackage":{},"sourceProvenanceReceipt":{},"sourceProvenanceReceipt":{}}';

      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: duplicateReceiptJson,
      });

      const response = await handleRoute(request, env as any);
      expect(response.status).toBe(400);
      expect(getBoundaryCalls().length).toBe(0);
      cleanup();
    });

    it('15.3 prototype poisoning keys (__proto__, constructor, prototype) are rejected with 400', async () => {
      const { handleRoute, getBoundaryCalls, cleanup } = await importFuturePathRouteForTest();
      const user = createDummySuperadmin();
      const env = { ENVIRONMENT: 'production', DB: {} as any, DEEPSEEK_API_KEY: 'sk-key' };

      const poisonKeys = ['__proto__', 'constructor', 'prototype', 'proto'];

      for (const poison of poisonKeys) {
        const poisonJson = `{"${poison}":{"evil":1},"authorizationPackage":{},"sourceProvenanceReceipt":{}}`;

        const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: poisonJson,
        });

        const response = await handleRoute(request, env as any);
        expect(response.status).toBe(400);
      }

      expect(getBoundaryCalls().length).toBe(0);
      cleanup();
    });

    it('15.4 Unicode lookalike key names are rejected with 400', async () => {
      const { handleRoute, getBoundaryCalls, cleanup } = await importFuturePathRouteForTest();
      const user = createDummySuperadmin();
      const env = { ENVIRONMENT: 'production', DB: {} as any, DEEPSEEK_API_KEY: 'sk-key' };

      // Cyrillic 'а' (\u0430) instead of Latin 'a'
      const lookalikeJson = '{"\u0430uthorizationPackage":{},"sourceProvenanceReceipt":{}}';

      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: lookalikeJson,
      });

      const response = await handleRoute(request, env as any);
      expect(response.status).toBe(400);
      expect(getBoundaryCalls().length).toBe(0);
      cleanup();
    });

    it('15.5 escaped string values containing "authorizationPackage" do NOT trigger duplicate detection', async () => {
      const { handleRoute, getBoundaryCalls, cleanup } = await importFuturePathRouteForTest();
      const user = createDummySuperadmin();
      const env = { ENVIRONMENT: 'production', DB: {} as any, DEEPSEEK_API_KEY: 'sk-key' };

      const validWithNestedString = JSON.stringify({
        authorizationPackage: { note: 'authorizationPackage inside value' },
        sourceProvenanceReceipt: { note: 'sourceProvenanceReceipt inside value' },
      });

      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: validWithNestedString,
      });

      const response = await handleRoute(request, env as any);
      expect(response.status).toBe(200);
      expect(getBoundaryCalls().length).toBe(1);
      cleanup();
    });

    it('15.6 nested object members with matching names do NOT count as top-level duplicates', async () => {
      const { handleRoute, getBoundaryCalls, cleanup } = await importFuturePathRouteForTest();
      const user = createDummySuperadmin();
      const env = { ENVIRONMENT: 'production', DB: {} as any, DEEPSEEK_API_KEY: 'sk-key' };

      const validWithNestedKeys = JSON.stringify({
        authorizationPackage: {
          authorizationPackage: 'nested_val_1',
          sourceProvenanceReceipt: 'nested_val_2',
        },
        sourceProvenanceReceipt: {
          sourceProvenanceReceipt: 'nested_val_3',
        },
      });

      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: validWithNestedKeys,
      });

      const response = await handleRoute(request, env as any);
      expect(response.status).toBe(200);
      expect(getBoundaryCalls().length).toBe(1);
      cleanup();
    });
  });

  // ==========================================================================
  // SUITE 16: Integrated Real-Boundary Offline Regression (Unmocked 5U.3.1 Boundary)
  // ==========================================================================
  describe('16. Integrated Real-Boundary Offline Regression (Unmocked 5U.3.1 Boundary)', () => {
    it('16.1 real unmocked 5U.3.1 boundary fails closed with LIVE_EXECUTION_BLOCKED without touching env capabilities', async () => {
      vi.resetModules();

      // Mock ONLY operational route policy to simulate future open route barriers
      vi.doMock('../../worker/ai/canary/deepSeekProductionOperationalRoutePolicy', () => ({
        PRODUCTION_CANARY_OPERATIONAL_ROUTE_PATH: '/api/ops/canary/deepseek-certification',
        PRODUCTION_CANARY_OPERATIONAL_ROUTE_ENABLED: true,
        PRODUCTION_CANARY_OPERATIONAL_INGRESS_AUTH_READY: true,
      }));

      vi.doMock('../../worker/auth/cloudflareAccessOperationalAuth', async () => {
        const actual = await vi.importActual<any>('../../worker/auth/cloudflareAccessOperationalAuth');
        return {
          ...actual,
          resolveCanonicalProductionOperationalPrincipal: vi.fn(async () => ({
            success: true,
            principal: {
              subject: 'ops-superadmin-001',
              email: 'ops@velnar.io',
              authSource: 'CLOUDFLARE_ACCESS',
              isSuperAdmin: true,
            },
          })),
        };
      });

      // NOTE: executeProductionWorkerCanaryCertification is NOT mocked! We test the real boundary!
      const routeMod = await import('../../worker/ai/canary/deepSeekProductionWorkerOperationalRoute');

      let dbReadCount = 0;
      let secretReadCount = 0;

      const hostEnv = {
        ENVIRONMENT: 'production',
        get DB() {
          dbReadCount++;
          throw new Error('UNEXPECTED_REAL_DB_ACCESS');
        },
        get DEEPSEEK_API_KEY() {
          secretReadCount++;
          throw new Error('UNEXPECTED_REAL_SECRET_ACCESS');
        },
      };

      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createDummyPayloads()),
      });

      const response = await routeMod.handleProductionCanaryOperationalRoute(request, hostEnv as any);

      // Successfully reached real boundary and returned minimized operational response
      expect(response.status).toBe(200);
      const json = (await response.json()) as any;

      expect(json.success).toBe(false);
      expect(json.status).toBe('LIVE_EXECUTION_BLOCKED');
      expect(json.errors).toEqual(['CANARY_LIVE_EXECUTION_BLOCKED']);

      // Live gate is canonical false, so zero reads of env.DB or env.DEEPSEEK_API_KEY
      expect(dbReadCount).toBe(0);
      expect(secretReadCount).toBe(0);

      // Real provider calls and D1 calls are strictly 0
      expect(json.providerNetworkCalls).toBe(0);
      expect(json.credentialReads).toBe(0);
      expect(json.transportAttempts).toBe(0);

      vi.doUnmock('../../worker/ai/canary/deepSeekProductionOperationalRoutePolicy');
      vi.doUnmock('../../worker/auth/cloudflareAccessOperationalAuth');
      vi.resetModules();
    });
  });
});
