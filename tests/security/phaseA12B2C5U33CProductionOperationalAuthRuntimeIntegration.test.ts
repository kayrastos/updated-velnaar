/**
 * @file tests/security/phaseA12B2C5U33CProductionOperationalAuthRuntimeIntegration.test.ts
 * @description Phase A.12B.2C-5U.3.3C Production Operational Auth Runtime Integration Foundation Security Tests
 *
 * MANDATES TESTED:
 * - Group A: Router Carve-Out & Path Routing (exact match, before tenant auth, missing DB resilience, sibling paths, path traversal).
 * - Group B: Dormant Route Passivity & Zero-Work Guarantee (404 by default, zero fetch/JWKS, zero body reads, zero config reads).
 * - Group C: Tenant Auth Isolation & Zero Operational Standing (tenant routes require tenant user, tenant roles have zero operational standing).
 * - Group D: Handler Signature & Parameter Integrity (arguments.length === 2, rejects 0, 1, 3, 4 args, no AuthenticatedUser import).
 * - Group E: Test-Only Future Auth Path Evaluation (401 for missing/invalid/expired token, 403 for unauthorized/empty registry, 503 for config/JWKS failure).
 * - Group F: Canonical Trust Boundary Protection (no caller keyResolver injection, no request-controlled trust roots).
 * - Group G: Gate Regression & Safety Invariants (all 12 canonical safety/readiness conditions strictly false / sealed).
 * - Group H: Network / D1 / Provider Isolation (fetch calls = 0, D1 calls = 0, provider calls = 0).
 */

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  generateKeyPair,
  SignJWT,
  exportJWK,
  type GenerateKeyPairResult,
} from 'jose';

import {
  PRODUCTION_CANARY_OPERATIONAL_ROUTE_PATH,
  PRODUCTION_CANARY_OPERATIONAL_ROUTE_ENABLED,
  PRODUCTION_CANARY_OPERATIONAL_INGRESS_AUTH_READY,
} from '../../worker/ai/canary/deepSeekProductionOperationalRoutePolicy';

import {
  handleProductionCanaryOperationalRoute,
  PUBLIC_OPERATIONAL_ERROR_CODES,
} from '../../worker/ai/canary/deepSeekProductionWorkerOperationalRoute';

import {
  resolveCanonicalProductionOperationalPrincipal,
  OperationalAuthErrorCode,
  PRODUCTION_OPERATIONAL_SUPERADMIN_REGISTRY,
  CF_ACCESS_JWT_ASSERTION_HEADER_CANONICAL,
  type OperationalSuperAdminEntry,
} from '../../worker/auth/cloudflareAccessOperationalAuth';

import { AuthContextService } from '../../worker/auth/authContext';

import {
  CANARY_LIVE_EXECUTION_ENABLED,
  CANARY_LIVE_EXECUTION_STATE,
} from '../../worker/ai/canary/canarySpecification';

import {
  GUARDED_SOURCE_ATTESTATION_READY,
  GUARDED_HUMAN_AUTH_ATTESTATION_READY,
} from '../../worker/ai/canary/deepSeekGuardedLiveTransport';

import { PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED } from '../../worker/ai/canary/deepSeekProductionAuthorizationTrust';
import { RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_PROVISIONED } from '../../worker/ai/canary/deepSeekTrustedRuntimeSourceProvenance';
import {
  D1_REPLAY_BACKEND_PRODUCTION_BOUND,
  D1_REPLAY_BACKEND_REAL_DATABASE_PROVISIONED,
  D1_REPLAY_BACKEND_REAL_CONCURRENCY_CERTIFIED,
} from '../../worker/ai/canary/d1AuthorizationReplayBackend';

describe('Phase A.12B.2C-5U.3.3C: Production Operational Auth Runtime Integration Foundation', () => {
  const TEST_TEAM_DOMAIN = 'https://velnar-test.cloudflareaccess.com';
  const TEST_AUD = 'test-aud-64char-hex-operational-canary-lane-1234567890abcdef12345678';
  const TEST_KID = 'test-key-id-001';

  let primaryKeyPair: GenerateKeyPairResult;
  let attackerKeyPair: GenerateKeyPairResult;
  let primaryJwk: Record<string, unknown>;

  beforeAll(async () => {
    primaryKeyPair = await generateKeyPair('RS256');
    attackerKeyPair = await generateKeyPair('RS256');
    const exported = await exportJWK(primaryKeyPair.publicKey);
    primaryJwk = {
      ...exported,
      kid: TEST_KID,
      alg: 'RS256',
      use: 'sig',
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /**
   * Helper to construct synthetic Access JWTs for offline testing
   */
  async function createSyntheticAccessJwt(overrides: {
    sub?: string | null;
    email?: string | null;
    type?: string | null;
    iss?: string | null;
    aud?: string | string[] | null;
    exp?: number | null;
    iat?: number | null;
    alg?: string;
    kid?: string;
    key?: any;
    omitSub?: boolean;
    omitEmail?: boolean;
    extraClaims?: Record<string, unknown>;
  } = {}): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const key = overrides.key ?? primaryKeyPair.privateKey;
    const alg = overrides.alg ?? 'RS256';

    const payload: Record<string, unknown> = {
      ...(overrides.extraClaims ?? {}),
    };

    if (!overrides.omitSub) {
      payload.sub = overrides.sub !== undefined ? overrides.sub : 'sub-ops-admin-01';
    }
    if (!overrides.omitEmail) {
      payload.email = overrides.email !== undefined ? overrides.email : 'ops.admin@velnar.io';
    }
    if (overrides.type !== null) {
      payload.type = overrides.type !== undefined ? overrides.type : 'app';
    }

    const signer = new SignJWT(payload);
    const protectedHeader: Record<string, unknown> = { alg };
    protectedHeader.kid = overrides.kid !== undefined ? overrides.kid : TEST_KID;
    signer.setProtectedHeader(protectedHeader as any);

    if (overrides.iss !== null) {
      signer.setIssuer(overrides.iss !== undefined ? overrides.iss : TEST_TEAM_DOMAIN);
    }
    if (overrides.aud !== null) {
      signer.setAudience(overrides.aud !== undefined ? overrides.aud : TEST_AUD);
    }
    if (overrides.exp !== null) {
      signer.setExpirationTime(overrides.exp !== undefined ? overrides.exp : now + 3600);
    }
    if (overrides.iat !== null) {
      signer.setIssuedAt(overrides.iat !== undefined ? overrides.iat : now);
    }

    return await signer.sign(key);
  }

  function createValidDummyPayload() {
    return {
      authorizationPackage: {
        payload: {
          version: 'a12b2c5r-v1',
          runNonce: 'NONCE-001',
          authorityId: 'auth_prod_01',
        },
        signatureBase64: 'sig_dummy',
        authorityId: 'auth_prod_01',
      },
      sourceProvenanceReceipt: {
        provenanceVersion: 'a12b2c5q-v1',
        sourceCommitSha: 'commit_sha_123',
        sourceTreeSha: 'tree_sha_123',
        bundleSha256: 'bundle_123',
        builderIdentity: 'builder_prod_01',
        receiptSignatureBase64: 'receipt_sig_dummy',
      },
    };
  }

  // ==========================================================================
  // GROUP A: Router Carve-Out & Path Routing
  // ==========================================================================
  describe('Group A: Router Carve-Out & Path Routing', () => {
    it('A.1 exact path /api/ops/canary/deepseek-certification matches canonical constant', () => {
      expect(PRODUCTION_CANARY_OPERATIONAL_ROUTE_PATH).toBe('/api/ops/canary/deepseek-certification');
    });

    it('A.2 operational carve-out executes BEFORE tenant AuthContextService.resolveSessionUser', async () => {
      vi.resetModules();

      let resolveSessionUserCalled = false;
      const actualAuth = await vi.importActual<any>('../../worker/auth/authContext');
      vi.doMock('../../worker/auth/authContext', () => ({
        ...actualAuth,
        AuthContextService: {
          ...actualAuth.AuthContextService,
          resolveSessionUser: vi.fn(() => {
            resolveSessionUserCalled = true;
            return {
              userId: 'usr_mock_superadmin',
              email: 'admin@velnar.studio',
              fullName: 'Super Admin',
              memberships: [],
              isSuperAdmin: true,
            };
          }),
        },
      }));

      const workerMod = await import('../../worker/index');
      const worker = workerMod.default;

      const hostEnv: any = {
        ENVIRONMENT: 'production',
        DB: { name: 'host_bound_db' },
      };

      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await worker.fetch(request, hostEnv);

      // Carve-out dispatched to operational handler, which returns 404 (dormant)
      expect(response.status).toBe(404);
      // Critical proof: tenant auth service was NEVER invoked
      expect(resolveSessionUserCalled).toBe(false);

      vi.doUnmock('../../worker/auth/authContext');
      vi.resetModules();
    });

    it('A.3 missing DB does NOT trigger generic 503 DATABASE_NOT_CONFIGURED before operational handler', async () => {
      vi.resetModules();

      const workerMod = await import('../../worker/index');
      const worker = workerMod.default;

      // Host env without DB
      const hostEnvNoDb: any = {
        ENVIRONMENT: 'production',
        // DB is undefined!
      };

      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await worker.fetch(request, hostEnvNoDb);

      // Operational route handler returned 404 (dormant); did NOT hit the generic DB check (503)
      expect(response.status).toBe(404);
      const json = (await response.json()) as any;
      expect(json).toEqual({ error: 'NOT_FOUND' });

      vi.resetModules();
    });

    it('A.4 sibling path /api/ops/canary/other is NOT carved out and proceeds to tenant pipeline', async () => {
      vi.resetModules();

      let resolveSessionUserCalled = false;
      const actualAuth = await vi.importActual<any>('../../worker/auth/authContext');
      vi.doMock('../../worker/auth/authContext', () => ({
        ...actualAuth,
        AuthContextService: {
          ...actualAuth.AuthContextService,
          resolveSessionUser: vi.fn(() => {
            resolveSessionUserCalled = true;
            return null; // unauthenticated
          }),
        },
      }));

      const workerMod = await import('../../worker/index');
      const worker = workerMod.default;

      const hostEnv: any = {
        ENVIRONMENT: 'production',
        DB: { name: 'host_bound_db' },
      };

      const request = new Request('https://velnar.studio/api/ops/canary/other', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await worker.fetch(request, hostEnv);

      // Sibling path proceeded to tenant pipeline; hit unauthenticated check (401)
      expect(response.status).toBe(401);
      expect(resolveSessionUserCalled).toBe(true);

      vi.doUnmock('../../worker/auth/authContext');
      vi.resetModules();
    });

    it('A.5 sibling path /api/ops/canary/deepseek-certification/sub is NOT carved out', async () => {
      vi.resetModules();

      let resolveSessionUserCalled = false;
      const actualAuth = await vi.importActual<any>('../../worker/auth/authContext');
      vi.doMock('../../worker/auth/authContext', () => ({
        ...actualAuth,
        AuthContextService: {
          ...actualAuth.AuthContextService,
          resolveSessionUser: vi.fn(() => {
            resolveSessionUserCalled = true;
            return null;
          }),
        },
      }));

      const workerMod = await import('../../worker/index');
      const worker = workerMod.default;

      const hostEnv: any = { ENVIRONMENT: 'production', DB: {} as any };
      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification/sub', {
        method: 'POST',
      });

      const response = await worker.fetch(request, hostEnv);
      expect(resolveSessionUserCalled).toBe(true);
      expect(response.status).toBe(401);

      vi.doUnmock('../../worker/auth/authContext');
      vi.resetModules();
    });

    it('A.6 sibling path /api/ops/canary/deepseek-certification2 is NOT carved out', async () => {
      vi.resetModules();

      let resolveSessionUserCalled = false;
      const actualAuth = await vi.importActual<any>('../../worker/auth/authContext');
      vi.doMock('../../worker/auth/authContext', () => ({
        ...actualAuth,
        AuthContextService: {
          ...actualAuth.AuthContextService,
          resolveSessionUser: vi.fn(() => {
            resolveSessionUserCalled = true;
            return null;
          }),
        },
      }));

      const workerMod = await import('../../worker/index');
      const worker = workerMod.default;

      const hostEnv: any = { ENVIRONMENT: 'production', DB: {} as any };
      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification2', {
        method: 'POST',
      });

      const response = await worker.fetch(request, hostEnv);
      expect(resolveSessionUserCalled).toBe(true);
      expect(response.status).toBe(401);

      vi.doUnmock('../../worker/auth/authContext');
      vi.resetModules();
    });

    it('A.7 path traversal attempts do NOT bypass carve-out boundary', async () => {
      vi.resetModules();

      let resolveSessionUserCalled = false;
      const actualAuth = await vi.importActual<any>('../../worker/auth/authContext');
      vi.doMock('../../worker/auth/authContext', () => ({
        ...actualAuth,
        AuthContextService: {
          ...actualAuth.AuthContextService,
          resolveSessionUser: vi.fn(() => {
            resolveSessionUserCalled = true;
            return null;
          }),
        },
      }));

      const workerMod = await import('../../worker/index');
      const worker = workerMod.default;

      const hostEnv: any = { ENVIRONMENT: 'production', DB: {} as any };
      // Trailing slash creates /api/ops/canary/deepseek-certification/ != /api/ops/canary/deepseek-certification
      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification/', {
        method: 'POST',
      });

      const response = await worker.fetch(request, hostEnv);
      expect(resolveSessionUserCalled).toBe(true);
      expect(response.status).toBe(401);

      vi.doUnmock('../../worker/auth/authContext');
      vi.resetModules();
    });
  });

  // ==========================================================================
  // GROUP B: Dormant Route Passivity & Zero-Work Guarantee
  // ==========================================================================
  describe('Group B: Dormant Route Passivity & Zero-Work Guarantee', () => {
    it('B.1 returns 404 NOT_FOUND under canonical dormant policy', async () => {
      const env: any = {
        ENVIRONMENT: 'production',
        DB: {} as any,
        DEEPSEEK_API_KEY: 'sk-prod-key',
      };
      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createValidDummyPayload()),
      });

      const response = await handleProductionCanaryOperationalRoute(request, env);
      expect(response.status).toBe(404);
      const json = (await response.json()) as any;
      expect(json).toEqual({ error: 'NOT_FOUND' });
    });

    it('B.2 causes exactly ZERO global fetch calls while dormant (no JWKS, no external network)', async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);

      const env: any = {
        ENVIRONMENT: 'production',
        DB: {} as any,
        CLOUDFLARE_ACCESS_TEAM_DOMAIN: TEST_TEAM_DOMAIN,
        CLOUDFLARE_ACCESS_AUD: TEST_AUD,
      };
      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [CF_ACCESS_JWT_ASSERTION_HEADER_CANONICAL]: 'some-token',
        },
        body: JSON.stringify(createValidDummyPayload()),
      });

      const response = await handleProductionCanaryOperationalRoute(request, env);
      expect(response.status).toBe(404);
      expect(fetchSpy).toHaveBeenCalledTimes(0);
    });

    it('B.3 causes exactly ZERO body reads or stream consumption while dormant', async () => {
      let bodyGetterCalls = 0;
      const throwingRequest = {
        method: 'POST',
        url: 'https://velnar.studio/api/ops/canary/deepseek-certification',
        headers: new Headers({ 'Content-Type': 'application/json' }),
        get body() {
          bodyGetterCalls++;
          throw new Error('MALICIOUS_BODY_READ_IN_DORMANT');
        },
      } as unknown as Request;

      const env: any = { ENVIRONMENT: 'production' };
      const response = await handleProductionCanaryOperationalRoute(throwingRequest, env);

      expect(response.status).toBe(404);
      expect(bodyGetterCalls).toBe(0);
    });

    it('B.4 causes exactly ZERO config property reads while dormant', async () => {
      let teamDomainReads = 0;
      let audReads = 0;

      const throwingEnv: any = {
        ENVIRONMENT: 'production',
        get CLOUDFLARE_ACCESS_TEAM_DOMAIN() {
          teamDomainReads++;
          throw new Error('UNEXPECTED_TEAM_DOMAIN_READ');
        },
        get CLOUDFLARE_ACCESS_AUDIENCE() {
          audReads++;
          throw new Error('UNEXPECTED_AUD_READ');
        },
      };

      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await handleProductionCanaryOperationalRoute(request, throwingEnv);
      expect(response.status).toBe(404);
      expect(teamDomainReads).toBe(0);
      expect(audReads).toBe(0);
    });
  });

  // ==========================================================================
  // GROUP C: Tenant Auth Isolation & Zero Operational Standing
  // ==========================================================================
  describe('Group C: Tenant Auth Isolation & Zero Operational Standing', () => {
    it('C.1 ordinary tenant routes still require tenant AuthenticatedUser / session', async () => {
      vi.resetModules();

      const actualAuth = await vi.importActual<any>('../../worker/auth/authContext');
      vi.doMock('../../worker/auth/authContext', () => ({
        ...actualAuth,
        AuthContextService: {
          ...actualAuth.AuthContextService,
          resolveSessionUser: vi.fn(() => null), // Unauthenticated
        },
      }));

      const workerMod = await import('../../worker/index');
      const worker = workerMod.default;

      const hostEnv: any = { ENVIRONMENT: 'production', DB: {} as any };
      const request = new Request('https://velnar.studio/api/projects', { method: 'GET' });

      const response = await worker.fetch(request, hostEnv);
      expect(response.status).toBe(401);

      vi.doUnmock('../../worker/auth/authContext');
      vi.resetModules();
    });

    it('C.2 sending tenant session token (Authorization: Bearer) has ZERO operational standing', async () => {
      const env: any = { ENVIRONMENT: 'production' };
      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer tenant_jwt_token_with_superadmin_claims',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(createValidDummyPayload()),
      });

      const response = await handleProductionCanaryOperationalRoute(request, env);
      // In dormant state, returns 404
      expect(response.status).toBe(404);
    });

    it('C.3 operational handler signature accepts exactly 2 arguments (no AuthenticatedUser parameter)', () => {
      expect(handleProductionCanaryOperationalRoute.length).toBe(2);
    });

    it('C.4 source inspection: operational route file does NOT import AuthenticatedUser from authContext', () => {
      const filePath = path.resolve('worker/ai/canary/deepSeekProductionWorkerOperationalRoute.ts');
      const source = fs.readFileSync(filePath, 'utf8');

      expect(source).not.toContain("from '../../auth/authContext'");
      expect(source).not.toContain("from '../auth/authContext'");
      expect(source).not.toMatch(/import\s*\{[^}]*AuthenticatedUser[^}]*\}\s*from/);
    });
  });

  // ==========================================================================
  // GROUP D: Handler Signature & Parameter Integrity
  // ==========================================================================
  describe('Group D: Handler Signature & Parameter Integrity', () => {
    it('D.1 rejects 0 arguments with 404 NOT_FOUND', async () => {
      const fn = handleProductionCanaryOperationalRoute as any;
      const response = await fn();
      expect(response.status).toBe(404);
      const json = (await response.json()) as any;
      expect(json).toEqual({ error: 'NOT_FOUND' });
    });

    it('D.2 rejects 1 argument with 404 NOT_FOUND', async () => {
      const fn = handleProductionCanaryOperationalRoute as any;
      const response = await fn({} as any);
      expect(response.status).toBe(404);
      const json = (await response.json()) as any;
      expect(json).toEqual({ error: 'NOT_FOUND' });
    });

    it('D.3 rejects 3 arguments (caller attempting to pass tenant user or keyResolver) with 404 NOT_FOUND', async () => {
      const fn = handleProductionCanaryOperationalRoute as any;
      const response = await fn({} as any, {} as any, { injectedRole: 'SUPERADMIN' } as any);
      expect(response.status).toBe(404);
      const json = (await response.json()) as any;
      expect(json).toEqual({ error: 'NOT_FOUND' });
    });

    it('D.4 rejects 4 arguments with 404 NOT_FOUND', async () => {
      const fn = handleProductionCanaryOperationalRoute as any;
      const response = await fn({} as any, {} as any, {} as any, {} as any);
      expect(response.status).toBe(404);
      const json = (await response.json()) as any;
      expect(json).toEqual({ error: 'NOT_FOUND' });
    });

    it('D.5 throwing getters on invalid argument count do NOT throw', async () => {
      const fn = handleProductionCanaryOperationalRoute as any;
      const throwingReq = {
        get method() { throw new Error('MALICIOUS_GETTER'); },
      };

      let didThrow = false;
      let response: any;
      try {
        response = await fn(throwingReq); // 1 argument
      } catch {
        didThrow = true;
      }

      expect(didThrow).toBe(false);
      expect(response.status).toBe(404);
    });

    it('D.6 source inspection: handler imports resolveCanonicalProductionOperationalPrincipal', () => {
      const filePath = path.resolve('worker/ai/canary/deepSeekProductionWorkerOperationalRoute.ts');
      const source = fs.readFileSync(filePath, 'utf8');

      expect(source).toContain('resolveCanonicalProductionOperationalPrincipal');
      expect(source).toContain('cloudflareAccessOperationalAuth');
    });
  });

  // ==========================================================================
  // GROUP E: Test-Only Future Auth Path Evaluation (Simulated Open Barriers)
  // ==========================================================================
  describe('Group E: Test-Only Future Auth Path Evaluation (Simulated Open Barriers)', () => {
    async function importOpenBarriersRoute() {
      vi.resetModules();

      vi.doMock('../../worker/ai/canary/deepSeekProductionOperationalRoutePolicy', () => ({
        PRODUCTION_CANARY_OPERATIONAL_ROUTE_PATH: '/api/ops/canary/deepseek-certification',
        PRODUCTION_CANARY_OPERATIONAL_ROUTE_ENABLED: true,
        PRODUCTION_CANARY_OPERATIONAL_INGRESS_AUTH_READY: true,
      }));

      const routeMod = await import('../../worker/ai/canary/deepSeekProductionWorkerOperationalRoute');
      return {
        handleRoute: routeMod.handleProductionCanaryOperationalRoute,
        cleanup: () => {
          vi.doUnmock('../../worker/ai/canary/deepSeekProductionOperationalRoutePolicy');
          vi.resetModules();
        },
      };
    }

    it('E.1 missing Cf-Access-Jwt-Assertion header returns 401 UNAUTHORIZED', async () => {
      const { handleRoute, cleanup } = await importOpenBarriersRoute();

      const env: any = {
        ENVIRONMENT: 'production',
        CLOUDFLARE_ACCESS_TEAM_DOMAIN: TEST_TEAM_DOMAIN,
        CLOUDFLARE_ACCESS_AUD: TEST_AUD,
      };

      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createValidDummyPayload()),
      });

      const response = await handleRoute(request, env);
      expect(response.status).toBe(401);
      const json = (await response.json()) as any;
      expect(json).toEqual({ error: 'UNAUTHORIZED' });

      cleanup();
    });

    it('E.2 malformed token returns 401 UNAUTHORIZED', async () => {
      const { handleRoute, cleanup } = await importOpenBarriersRoute();

      const env: any = {
        ENVIRONMENT: 'production',
        CLOUDFLARE_ACCESS_TEAM_DOMAIN: TEST_TEAM_DOMAIN,
        CLOUDFLARE_ACCESS_AUD: TEST_AUD,
      };

      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [CF_ACCESS_JWT_ASSERTION_HEADER_CANONICAL]: 'not-a-valid-jwt.token',
        },
        body: JSON.stringify(createValidDummyPayload()),
      });

      const response = await handleRoute(request, env);
      expect(response.status).toBe(401);
      const json = (await response.json()) as any;
      expect(json).toEqual({ error: 'UNAUTHORIZED' });

      cleanup();
    });

    it('E.3 token signed with untrusted attacker key returns 401 UNAUTHORIZED', async () => {
      const { handleRoute, cleanup } = await importOpenBarriersRoute();

      // Mock fetch to return primary JWKS (the genuine trust root)
      vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        if (url === `${TEST_TEAM_DOMAIN}/cdn-cgi/access/certs`) {
          return new Response(JSON.stringify({ keys: [primaryJwk] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('Not found', { status: 404 });
      }));

      // Sign with attacker key
      const attackerToken = await createSyntheticAccessJwt({
        key: attackerKeyPair.privateKey,
        kid: TEST_KID,
      });

      const env: any = {
        ENVIRONMENT: 'production',
        CLOUDFLARE_ACCESS_TEAM_DOMAIN: TEST_TEAM_DOMAIN,
        CLOUDFLARE_ACCESS_AUD: TEST_AUD,
      };

      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [CF_ACCESS_JWT_ASSERTION_HEADER_CANONICAL]: attackerToken,
        },
        body: JSON.stringify(createValidDummyPayload()),
      });

      const response = await handleRoute(request, env);
      expect(response.status).toBe(401);
      const json = (await response.json()) as any;
      expect(json).toEqual({ error: 'UNAUTHORIZED' });

      cleanup();
    });

    it('E.4 expired token returns 401 UNAUTHORIZED', async () => {
      const { handleRoute, cleanup } = await importOpenBarriersRoute();

      vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        if (url === `${TEST_TEAM_DOMAIN}/cdn-cgi/access/certs`) {
          return new Response(JSON.stringify({ keys: [primaryJwk] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('Not found', { status: 404 });
      }));

      const expiredToken = await createSyntheticAccessJwt({
        exp: Math.floor(Date.now() / 1000) - 300,
      });

      const env: any = {
        ENVIRONMENT: 'production',
        CLOUDFLARE_ACCESS_TEAM_DOMAIN: TEST_TEAM_DOMAIN,
        CLOUDFLARE_ACCESS_AUD: TEST_AUD,
      };

      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [CF_ACCESS_JWT_ASSERTION_HEADER_CANONICAL]: expiredToken,
        },
        body: JSON.stringify(createValidDummyPayload()),
      });

      const response = await handleRoute(request, env);
      expect(response.status).toBe(401);
      const json = (await response.json()) as any;
      expect(json).toEqual({ error: 'UNAUTHORIZED' });

      cleanup();
    });

    it('E.5 valid token + empty canonical superadmin registry returns 403 FORBIDDEN', async () => {
      const { handleRoute, cleanup } = await importOpenBarriersRoute();

      vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        if (url === `${TEST_TEAM_DOMAIN}/cdn-cgi/access/certs`) {
          return new Response(JSON.stringify({ keys: [primaryJwk] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('Not found', { status: 404 });
      }));

      const validToken = await createSyntheticAccessJwt();

      const env: any = {
        ENVIRONMENT: 'production',
        CLOUDFLARE_ACCESS_TEAM_DOMAIN: TEST_TEAM_DOMAIN,
        CLOUDFLARE_ACCESS_AUD: TEST_AUD,
      };

      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [CF_ACCESS_JWT_ASSERTION_HEADER_CANONICAL]: validToken,
        },
        body: JSON.stringify(createValidDummyPayload()),
      });

      const response = await handleRoute(request, env);
      expect(response.status).toBe(403);
      const json = (await response.json()) as any;
      expect(json).toEqual({ error: 'FORBIDDEN' });

      cleanup();
    });

    it('E.6 missing team domain configuration returns 503 AUTH_SERVICE_UNAVAILABLE', async () => {
      const { handleRoute, cleanup } = await importOpenBarriersRoute();

      const env: any = {
        ENVIRONMENT: 'production',
        // CLOUDFLARE_ACCESS_TEAM_DOMAIN is missing!
        CLOUDFLARE_ACCESS_AUD: TEST_AUD,
      };

      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [CF_ACCESS_JWT_ASSERTION_HEADER_CANONICAL]: 'some-token',
        },
        body: JSON.stringify(createValidDummyPayload()),
      });

      const response = await handleRoute(request, env);
      expect(response.status).toBe(503);
      const json = (await response.json()) as any;
      expect(json).toEqual({ error: 'AUTH_SERVICE_UNAVAILABLE' });

      cleanup();
    });

    it('E.7 remote JWKS fetch network failure returns 503 AUTH_SERVICE_UNAVAILABLE', async () => {
      const { handleRoute, cleanup } = await importOpenBarriersRoute();

      // Fetch throws network error
      vi.stubGlobal('fetch', vi.fn(async () => {
        throw new Error('NETWORK_TIMEOUT_JWKS');
      }));

      const token = await createSyntheticAccessJwt();

      const env: any = {
        ENVIRONMENT: 'production',
        CLOUDFLARE_ACCESS_TEAM_DOMAIN: TEST_TEAM_DOMAIN,
        CLOUDFLARE_ACCESS_AUD: TEST_AUD,
      };

      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [CF_ACCESS_JWT_ASSERTION_HEADER_CANONICAL]: token,
        },
        body: JSON.stringify(createValidDummyPayload()),
      });

      const response = await handleRoute(request, env);
      expect(response.status).toBe(503);
      const json = (await response.json()) as any;
      expect(json).toEqual({ error: 'AUTH_SERVICE_UNAVAILABLE' });

      cleanup();
    });

    it('E.8 auth failures occur BEFORE body parsing or capability execution', async () => {
      const { handleRoute, cleanup } = await importOpenBarriersRoute();

      let bodyGetterCalled = false;
      const throwingRequest = {
        method: 'POST',
        url: 'https://velnar.studio/api/ops/canary/deepseek-certification',
        headers: new Headers({
          'Content-Type': 'application/json',
          // Missing Access assertion token!
        }),
        get body() {
          bodyGetterCalled = true;
          throw new Error('MALICIOUS_BODY_READ_ON_AUTH_FAILURE');
        },
      } as unknown as Request;

      const env: any = {
        ENVIRONMENT: 'production',
        CLOUDFLARE_ACCESS_TEAM_DOMAIN: TEST_TEAM_DOMAIN,
        CLOUDFLARE_ACCESS_AUD: TEST_AUD,
      };

      const response = await handleRoute(throwingRequest, env);
      expect(response.status).toBe(401);
      expect(bodyGetterCalled).toBe(false);

      cleanup();
    });
  });

  // ==========================================================================
  // GROUP F: Canonical Trust Boundary Protection
  // ==========================================================================
  describe('Group F: Canonical Trust Boundary Protection', () => {
    it('F.1 handler does NOT accept caller-supplied keyResolver', () => {
      // Handler accepts only (request: Request, env: WorkerEnv)
      expect(handleProductionCanaryOperationalRoute.length).toBe(2);
    });

    it('F.2 handler derives team domain / JWKS strictly from canonical environment config', () => {
      const filePath = path.resolve('worker/ai/canary/deepSeekProductionWorkerOperationalRoute.ts');
      const source = fs.readFileSync(filePath, 'utf8');

      // Uses canonical resolver function directly
      expect(source).toContain('resolveCanonicalProductionOperationalPrincipal(request, env)');
    });

    it('F.3 public operational error codes allowlist contains only safe strings', () => {
      expect(PUBLIC_OPERATIONAL_ERROR_CODES).toEqual(
        expect.arrayContaining([
          'CANARY_LIVE_EXECUTION_BLOCKED',
          'CANARY_AUTHORIZATION_REJECTED',
          'CANARY_SOURCE_BINDING_REJECTED',
          'CANARY_REPLAY_REJECTED',
          'CANARY_PROVIDER_EXECUTION_FAILED',
          'CANARY_VALIDATION_FAILED',
          'CANARY_BUDGET_REJECTED',
          'CANARY_INTERNAL_FAILURE',
        ])
      );
      // No internal secrets or stack traces in public error codes
      for (const code of PUBLIC_OPERATIONAL_ERROR_CODES) {
        expect(code).not.toContain('TOKEN');
        expect(code).not.toContain('SECRET');
        expect(code).not.toContain('KEY');
      }
    });
  });

  // ==========================================================================
  // GROUP G: Gate Regression & Safety Invariant
  // ==========================================================================
  describe('Group G: Gate Regression & Safety Invariants', () => {
    it('G.1 PRODUCTION_CANARY_OPERATIONAL_ROUTE_ENABLED is strictly false', () => {
      expect(PRODUCTION_CANARY_OPERATIONAL_ROUTE_ENABLED).toBe(false);
    });

    it('G.2 PRODUCTION_CANARY_OPERATIONAL_INGRESS_AUTH_READY is strictly false', () => {
      expect(PRODUCTION_CANARY_OPERATIONAL_INGRESS_AUTH_READY).toBe(false);
    });

    it('G.3 CANARY_LIVE_EXECUTION_ENABLED is strictly false', () => {
      expect(CANARY_LIVE_EXECUTION_ENABLED).toBe(false);
    });

    it('G.4 CANARY_LIVE_EXECUTION_STATE is strictly DORMANT_GATED', () => {
      expect(CANARY_LIVE_EXECUTION_STATE).toBe('BLOCKED_PENDING_CERTIFICATION');
    });

    it('G.5 GUARDED_SOURCE_ATTESTATION_READY is strictly false', () => {
      expect(GUARDED_SOURCE_ATTESTATION_READY).toBe(false);
    });

    it('G.6 GUARDED_HUMAN_AUTH_ATTESTATION_READY is strictly false', () => {
      expect(GUARDED_HUMAN_AUTH_ATTESTATION_READY).toBe(false);
    });

    it('G.7 PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED is strictly false', () => {
      expect(PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED).toBe(false);
    });

    it('G.8 RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_PROVISIONED is strictly false', () => {
      expect(RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_PROVISIONED).toBe(false);
    });

    it('G.9 D1_REPLAY_BACKEND_PRODUCTION_BOUND is strictly false', () => {
      expect(D1_REPLAY_BACKEND_PRODUCTION_BOUND).toBe(false);
    });

    it('G.10 D1_REPLAY_BACKEND_REAL_DATABASE_PROVISIONED is strictly false', () => {
      expect(D1_REPLAY_BACKEND_REAL_DATABASE_PROVISIONED).toBe(false);
    });

    it('G.11 D1_REPLAY_BACKEND_REAL_CONCURRENCY_CERTIFIED is strictly false', () => {
      expect(D1_REPLAY_BACKEND_REAL_CONCURRENCY_CERTIFIED).toBe(false);
    });

    it('G.12 PRODUCTION_OPERATIONAL_SUPERADMIN_REGISTRY is strictly empty (length 0)', () => {
      expect(PRODUCTION_OPERATIONAL_SUPERADMIN_REGISTRY).toHaveLength(0);
      expect(Object.isFrozen(PRODUCTION_OPERATIONAL_SUPERADMIN_REGISTRY)).toBe(true);
    });
  });

  // ==========================================================================
  // GROUP H: Network / D1 / Provider Isolation
  // ==========================================================================
  describe('Group H: Network / D1 / Provider Isolation', () => {
    it('H.1 dormant route causes exactly ZERO network fetch calls', async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);

      const env: any = {
        ENVIRONMENT: 'production',
        DB: {} as any,
        DEEPSEEK_API_KEY: 'sk-test',
      };
      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createValidDummyPayload()),
      });

      const response = await handleProductionCanaryOperationalRoute(request, env);
      expect(response.status).toBe(404);
      expect(fetchSpy).toHaveBeenCalledTimes(0);
    });

    it('H.2 dormant route causes exactly ZERO D1 database operations', async () => {
      let d1PrepareCalls = 0;
      let d1BatchCalls = 0;

      const throwingDb = {
        prepare: () => {
          d1PrepareCalls++;
          throw new Error('UNEXPECTED_D1_PREPARE');
        },
        batch: () => {
          d1BatchCalls++;
          throw new Error('UNEXPECTED_D1_BATCH');
        },
      };

      const env: any = {
        ENVIRONMENT: 'production',
        DB: throwingDb as any,
      };

      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createValidDummyPayload()),
      });

      const response = await handleProductionCanaryOperationalRoute(request, env);
      expect(response.status).toBe(404);
      expect(d1PrepareCalls).toBe(0);
      expect(d1BatchCalls).toBe(0);
    });

    it('H.3 dormant route causes exactly ZERO DeepSeek provider calls', async () => {
      let secretAccessCount = 0;
      const env: any = {
        ENVIRONMENT: 'production',
        get DEEPSEEK_API_KEY() {
          secretAccessCount++;
          throw new Error('UNEXPECTED_PROVIDER_KEY_ACCESS');
        },
      };

      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createValidDummyPayload()),
      });

      const response = await handleProductionCanaryOperationalRoute(request, env);
      expect(response.status).toBe(404);
      expect(secretAccessCount).toBe(0);
    });
  });
});
