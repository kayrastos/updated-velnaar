/**
 * @file tests/security/phaseA12B2C5U33CProductionOperationalAuthRuntimeIntegration.test.ts
 * @description Phase A.12B.2C-5U.3.3C-R Production Operational Auth Runtime Integration Foundation Security Tests
 *
 * MANDATES TESTED:
 * - Group A: Router Carve-Out & Path Routing (exact match, before generic OPTIONS preflight, before tenant auth, missing DB resilience, sibling paths, path traversal).
 * - Group B: Dormant Route Passivity & Zero-Work Guarantee (404 by default for all HTTP methods including OPTIONS, zero fetch/JWKS, zero body reads, zero config reads, token shape passivity).
 * - Group C: Tenant Auth Isolation & Zero Operational Standing (tenant OWNER/ADMIN/superadmin have zero operational standing, tenant token cannot substitute for Access assertion).
 * - Group D: Handler Signature & Parameter Integrity (arguments.length === 2, rejects 0, 1, 3, 4 args, no AuthenticatedUser import).
 * - Group E: Test-Only Future Auth Path Evaluation (401 for missing/invalid/expired token, 403 for unauthorized/empty registry, 503 for config/JWKS failure, capability boundary calls = 0 on auth failure).
 * - Group F: Canonical Trust Boundary Protection (no caller keyResolver injection, no request-controlled trust roots).
 * - Group G: Canonical 12-Condition Safety/Readiness Ledger (all 12 canonical conditions strictly false / sealed).
 * - Supplemental: Auth Foundation State (registry length = 0, frozen = true, categorized as AUTH_FOUNDATION_STATE).
 * - Group H: Network / D1 / Provider Isolation & Zero-Action Verification (runtime instrumented + source inspected).
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
import { DEEPSEEK_FIRST_PROVIDER_STRATEGY } from '../../worker/ai/canary/deepSeekFirstProviderStrategy';

describe('Phase A.12B.2C-5U.3.3C-R: Production Operational Auth Runtime Integration Foundation', () => {
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

    it('A.8 operational carve-out executes BEFORE generic OPTIONS preflight and returns 404 (NOT 204)', async () => {
      vi.resetModules();

      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);

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

      const hostEnv: any = {
        ENVIRONMENT: 'production',
        DB: { name: 'host_bound_db' },
        CLOUDFLARE_ACCESS_TEAM_DOMAIN: TEST_TEAM_DOMAIN,
        CLOUDFLARE_ACCESS_AUD: TEST_AUD,
      };

      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://velnar.studio',
          'Access-Control-Request-Method': 'POST',
        },
      });

      const response = await worker.fetch(request, hostEnv);

      // Critical proof: does NOT return 204 from generic CORS preflight! Returns 404 from dormant handler!
      expect(response.status).toBe(404);
      expect(response.status).not.toBe(204);
      const json = (await response.json()) as any;
      expect(json).toEqual({ error: 'NOT_FOUND' });

      // Zero tenant auth resolution
      expect(resolveSessionUserCalled).toBe(false);
      // Zero JWKS/network fetch calls
      expect(fetchSpy).toHaveBeenCalledTimes(0);

      vi.doUnmock('../../worker/auth/authContext');
      vi.resetModules();
    });

    it('A.9 ordinary non-operational route OPTIONS retains normal CORS preflight behavior', async () => {
      vi.resetModules();

      const workerMod = await import('../../worker/index');
      const worker = workerMod.default;

      const hostEnv: any = {
        ENVIRONMENT: 'production',
        DB: { name: 'host_bound_db' },
      };

      // Valid origin on ordinary route
      const requestValidOrigin = new Request('https://velnar.studio/api/projects', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://velnar.studio',
          'Access-Control-Request-Method': 'GET',
        },
      });

      const responseValid = await worker.fetch(requestValidOrigin, hostEnv);
      expect(responseValid.status).toBe(204);
      expect(responseValid.headers.get('Access-Control-Allow-Origin')).toBe('https://velnar.studio');
      expect(responseValid.headers.get('Access-Control-Allow-Methods')).toContain('POST');

      // Unknown origin receives 403 on generic preflight
      const requestUnknownOrigin = new Request('https://velnar.studio/api/projects', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://attacker.com',
          'Access-Control-Request-Method': 'GET',
        },
      });

      const responseUnknown = await worker.fetch(requestUnknownOrigin, hostEnv);
      expect(responseUnknown.status).toBe(403);

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
        get CLOUDFLARE_ACCESS_AUD() {
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

    it('B.5 dormant HTTP method invariant: ALL methods return 404 NOT_FOUND while gates are false', async () => {
      const methods = ['OPTIONS', 'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'];
      const env: any = { ENVIRONMENT: 'production' };

      for (const method of methods) {
        const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
          method,
          headers: { 'Content-Type': 'application/json' },
        });

        const response = await handleProductionCanaryOperationalRoute(request, env);
        expect(response.status).toBe(404);
        const json = (await response.json()) as any;
        expect(json).toEqual({ error: 'NOT_FOUND' });
      }
    });

    it('B.6 dormant token shapes at Worker host level all return 404 with ZERO fetch/JWKS calls', async () => {
      vi.resetModules();

      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);

      const workerMod = await import('../../worker/index');
      const worker = workerMod.default;

      const hostEnv: any = {
        ENVIRONMENT: 'production',
        DB: { name: 'host_bound_db' },
        CLOUDFLARE_ACCESS_TEAM_DOMAIN: TEST_TEAM_DOMAIN,
        CLOUDFLARE_ACCESS_AUD: TEST_AUD,
      };

      const validSyntheticToken = await createSyntheticAccessJwt();

      const testCases = [
        { name: 'no Access assertion', headers: { 'Content-Type': 'application/json' } },
        { name: 'malformed Access assertion', headers: { 'Content-Type': 'application/json', [CF_ACCESS_JWT_ASSERTION_HEADER_CANONICAL]: 'bad.token.shape' } },
        { name: 'valid synthetic Access assertion', headers: { 'Content-Type': 'application/json', [CF_ACCESS_JWT_ASSERTION_HEADER_CANONICAL]: validSyntheticToken } },
      ];

      for (const tc of testCases) {
        const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
          method: 'POST',
          headers: tc.headers,
          body: JSON.stringify(createValidDummyPayload()),
        });

        const response = await worker.fetch(request, hostEnv);
        expect(response.status, `Failed on ${tc.name}`).toBe(404);
        const json = (await response.json()) as any;
        expect(json).toEqual({ error: 'NOT_FOUND' });
      }

      // Proves strictly zero fetch / JWKS calls across all dormant token shapes
      expect(fetchSpy).toHaveBeenCalledTimes(0);

      vi.resetModules();
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

    it('C.5 tenant OWNER has zero operational authority: AuthContextService is never called', async () => {
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
              userId: 'usr_tenant_owner',
              email: 'owner@tenant.io',
              fullName: 'Tenant Owner',
              memberships: [{ organizationId: 'org_1', role: 'OWNER', status: 'active' }],
              isSuperAdmin: false,
            };
          }),
        },
      }));

      const workerMod = await import('../../worker/index');
      const worker = workerMod.default;

      const hostEnv: any = { ENVIRONMENT: 'production', DB: {} as any };
      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer owner_tenant_token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(createValidDummyPayload()),
      });

      const response = await worker.fetch(request, hostEnv);
      expect(response.status).toBe(404);
      expect(resolveSessionUserCalled).toBe(false);

      vi.doUnmock('../../worker/auth/authContext');
      vi.resetModules();
    });

    it('C.6 tenant ADMIN has zero operational authority: AuthContextService is never called', async () => {
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
              userId: 'usr_tenant_admin',
              email: 'admin@tenant.io',
              fullName: 'Tenant Admin',
              memberships: [{ organizationId: 'org_1', role: 'ADMIN', status: 'active' }],
              isSuperAdmin: false,
            };
          }),
        },
      }));

      const workerMod = await import('../../worker/index');
      const worker = workerMod.default;

      const hostEnv: any = { ENVIRONMENT: 'production', DB: {} as any };
      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer admin_tenant_token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(createValidDummyPayload()),
      });

      const response = await worker.fetch(request, hostEnv);
      expect(response.status).toBe(404);
      expect(resolveSessionUserCalled).toBe(false);

      vi.doUnmock('../../worker/auth/authContext');
      vi.resetModules();
    });

    it('C.7 tenant isSuperAdmin === true has zero operational authority: AuthContextService is never called', async () => {
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
              userId: 'usr_tenant_superadmin',
              email: 'superadmin@tenant.io',
              fullName: 'Tenant Superadmin',
              memberships: [],
              isSuperAdmin: true,
            };
          }),
        },
      }));

      const workerMod = await import('../../worker/index');
      const worker = workerMod.default;

      const hostEnv: any = { ENVIRONMENT: 'production', DB: {} as any };
      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer tenant_superadmin_token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(createValidDummyPayload()),
      });

      const response = await worker.fetch(request, hostEnv);
      expect(response.status).toBe(404);
      expect(resolveSessionUserCalled).toBe(false);

      vi.doUnmock('../../worker/auth/authContext');
      vi.resetModules();
    });

    it('C.8 future-path test: tenant Authorization header cannot substitute for operational Access token (returns 401)', async () => {
      vi.resetModules();

      vi.doMock('../../worker/ai/canary/deepSeekProductionOperationalRoutePolicy', () => ({
        PRODUCTION_CANARY_OPERATIONAL_ROUTE_PATH: '/api/ops/canary/deepseek-certification',
        PRODUCTION_CANARY_OPERATIONAL_ROUTE_ENABLED: true,
        PRODUCTION_CANARY_OPERATIONAL_INGRESS_AUTH_READY: true,
      }));

      const routeMod = await import('../../worker/ai/canary/deepSeekProductionWorkerOperationalRoute');

      const env: any = {
        ENVIRONMENT: 'production',
        CLOUDFLARE_ACCESS_TEAM_DOMAIN: TEST_TEAM_DOMAIN,
        CLOUDFLARE_ACCESS_AUD: TEST_AUD,
      };

      // Request has tenant Authorization header, but NO Cf-Access-Jwt-Assertion header!
      const request = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer tenant_superadmin_credentials_xyz',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(createValidDummyPayload()),
      });

      const response = await routeMod.handleProductionCanaryOperationalRoute(request, env);
      expect(response.status).toBe(401);
      const json = (await response.json()) as any;
      expect(json).toEqual({ error: 'UNAUTHORIZED' });

      vi.doUnmock('../../worker/ai/canary/deepSeekProductionOperationalRoutePolicy');
      vi.resetModules();
    });

    it('C.9 ordinary tenant auth non-regression: canonical authContext resolves valid test sessions', () => {
      // 1. Dev fixture token in development environment
      const devUser = AuthContextService.resolveSessionUser('Bearer dev_owner_token', 'development');
      expect(devUser).not.toBeNull();
      expect(devUser?.userId).toBe('usr_dev_owner');
      expect(devUser?.memberships[0]?.role).toBe('OWNER');

      // 2. Synthetic test token in test environment
      const testUser = AuthContextService.resolveSessionUser('Bearer test_user:usr_test_admin:org_apex:ADMIN', 'test');
      expect(testUser).not.toBeNull();
      expect(testUser?.userId).toBe('usr_test_admin');
      expect(testUser?.memberships[0]?.role).toBe('ADMIN');

      // 3. Dev fixture token in production environment fails closed (null)
      const prodDevUser = AuthContextService.resolveSessionUser('Bearer dev_owner_token', 'production');
      expect(prodDevUser).toBeNull();

      // 4. Missing token fails closed (null)
      const unauthUser = AuthContextService.resolveSessionUser(null, 'production');
      expect(unauthUser).toBeNull();
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

    it('E.9 capability boundary must NOT execute on any auth failure (call count strictly 0)', async () => {
      vi.resetModules();

      let capabilityExecutionCalls = 0;
      vi.doMock('../../worker/ai/canary/deepSeekProductionWorkerCapabilityBoundary', () => ({
        executeProductionWorkerCanaryCertification: vi.fn(async () => {
          capabilityExecutionCalls++;
          return { success: true };
        }),
      }));

      vi.doMock('../../worker/ai/canary/deepSeekProductionOperationalRoutePolicy', () => ({
        PRODUCTION_CANARY_OPERATIONAL_ROUTE_PATH: '/api/ops/canary/deepseek-certification',
        PRODUCTION_CANARY_OPERATIONAL_ROUTE_ENABLED: true,
        PRODUCTION_CANARY_OPERATIONAL_INGRESS_AUTH_READY: true,
      }));

      const routeMod = await import('../../worker/ai/canary/deepSeekProductionWorkerOperationalRoute');

      // Test 1: Missing assertion token -> 401
      const env: any = {
        ENVIRONMENT: 'production',
        CLOUDFLARE_ACCESS_TEAM_DOMAIN: TEST_TEAM_DOMAIN,
        CLOUDFLARE_ACCESS_AUD: TEST_AUD,
      };
      const reqMissingToken = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createValidDummyPayload()),
      });
      const resp1 = await routeMod.handleProductionCanaryOperationalRoute(reqMissingToken, env);
      expect(resp1.status).toBe(401);
      expect(capabilityExecutionCalls).toBe(0);

      // Test 2: Malformed token -> 401
      const reqMalformed = new Request('https://velnar.studio/api/ops/canary/deepseek-certification', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [CF_ACCESS_JWT_ASSERTION_HEADER_CANONICAL]: 'bad.token',
        },
        body: JSON.stringify(createValidDummyPayload()),
      });
      const resp2 = await routeMod.handleProductionCanaryOperationalRoute(reqMalformed, env);
      expect(resp2.status).toBe(401);
      expect(capabilityExecutionCalls).toBe(0);

      // Test 3: Missing config -> 503
      const envNoDomain: any = { ENVIRONMENT: 'production', CLOUDFLARE_ACCESS_AUD: TEST_AUD };
      const resp3 = await routeMod.handleProductionCanaryOperationalRoute(reqMissingToken, envNoDomain);
      expect(resp3.status).toBe(503);
      expect(capabilityExecutionCalls).toBe(0);

      vi.doUnmock('../../worker/ai/canary/deepSeekProductionWorkerCapabilityBoundary');
      vi.doUnmock('../../worker/ai/canary/deepSeekProductionOperationalRoutePolicy');
      vi.resetModules();
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

    it('F.4 request headers/params cannot override canonical issuer, audience, or registry', async () => {
      const filePath = path.resolve('worker/ai/canary/deepSeekProductionWorkerOperationalRoute.ts');
      const source = fs.readFileSync(filePath, 'utf8');

      // Route handler has no custom issuer, aud, or registry extraction logic
      expect(source).not.toContain('x-custom-issuer');
      expect(source).not.toContain('x-custom-audience');
      expect(source).not.toContain('x-custom-registry');
      expect(source).not.toContain('keyResolver');
    });
  });

  // ==========================================================================
  // GROUP G: Canonical 12-Condition Safety/Readiness Ledger
  // ==========================================================================
  describe('Group G: Canonical 12-Condition Safety/Readiness Ledger', () => {
    it('G.1 PRODUCTION_CANARY_OPERATIONAL_ROUTE_ENABLED is strictly false', () => {
      expect(PRODUCTION_CANARY_OPERATIONAL_ROUTE_ENABLED).toBe(false);
    });

    it('G.2 PRODUCTION_CANARY_OPERATIONAL_INGRESS_AUTH_READY is strictly false', () => {
      expect(PRODUCTION_CANARY_OPERATIONAL_INGRESS_AUTH_READY).toBe(false);
    });

    it('G.3 CANARY_LIVE_EXECUTION_ENABLED is strictly false', () => {
      expect(CANARY_LIVE_EXECUTION_ENABLED).toBe(false);
    });

    it('G.4 CANARY_LIVE_EXECUTION_STATE is strictly BLOCKED_PENDING_CERTIFICATION', () => {
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

    it('G.9 D1_REPLAY_BACKEND_PRODUCTION_BOUND reflects verified deployed D1 Worker binding', () => {
      expect(D1_REPLAY_BACKEND_PRODUCTION_BOUND).toBe(true);
    });

    it('G.10 D1_REPLAY_BACKEND_REAL_DATABASE_PROVISIONED is true after explicit adoption', () => {
      expect(D1_REPLAY_BACKEND_REAL_DATABASE_PROVISIONED).toBe(true);
    });

    it('G.11 D1_REPLAY_BACKEND_REAL_CONCURRENCY_CERTIFIED is true after real concurrency certification', () => {
      expect(D1_REPLAY_BACKEND_REAL_CONCURRENCY_CERTIFIED).toBe(true);
    });

    it('G.12 productionRoutingEnforcementAllowed is strictly false (Canonical Gate #12)', () => {
      expect(DEEPSEEK_FIRST_PROVIDER_STRATEGY.securityInvariants.productionRoutingEnforcementAllowed).toBe(false);
    });

    it('Supplemental: AUTH_FOUNDATION_STATE: canonical superadmin registry is empty (0) and frozen', () => {
      expect(PRODUCTION_OPERATIONAL_SUPERADMIN_REGISTRY).toHaveLength(0);
      expect(Object.isFrozen(PRODUCTION_OPERATIONAL_SUPERADMIN_REGISTRY)).toBe(true);
    });
  });

  // ==========================================================================
  // GROUP H: Network / D1 / Provider Isolation & Zero-Action Verification
  // ==========================================================================
  describe('Group H: Network / D1 / Provider Isolation & Zero-Action Verification', () => {
    it('H.1 runtime-instrumented: dormant route causes exactly ZERO network fetch calls', async () => {
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

    it('H.2 runtime-instrumented: dormant route causes exactly ZERO D1 database operations', async () => {
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

    it('H.3 runtime-instrumented: dormant route causes exactly ZERO DeepSeek provider calls', async () => {
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

    it('H.4 source/diff-inspected: zero provisioning, deployments, secret mutations, or key operations', () => {
      const routeSource = fs.readFileSync(
        path.resolve('worker/ai/canary/deepSeekProductionWorkerOperationalRoute.ts'),
        'utf8'
      );
      // Zero Cloudflare provisioning API clients
      expect(routeSource).not.toContain('api.cloudflare.com');
      // Zero secret mutation calls
      expect(routeSource).not.toContain('putSecret');
      expect(routeSource).not.toContain('deleteSecret');
      // Zero KMS key generation
      expect(routeSource).not.toContain('generateKey');
      // Zero deployment triggers
      expect(routeSource).not.toContain('deployWorker');
      // Zero gate flips
      expect(PRODUCTION_CANARY_OPERATIONAL_ROUTE_ENABLED).toBe(false);
      expect(PRODUCTION_CANARY_OPERATIONAL_INGRESS_AUTH_READY).toBe(false);
    });
  });
});
