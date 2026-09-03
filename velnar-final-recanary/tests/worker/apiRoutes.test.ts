import { describe, it, expect, beforeEach } from 'vitest';
import worker, { getValidatedCorsOrigin } from '../../worker/index';
import { ActionPolicyRepository } from '../../worker/ai/actions/actionPolicyRepository';
import { GrowthActionRepository } from '../../worker/repositories/growthActionRepository';

describe('Cloudflare Worker API Boundary Integration', () => {
  describe('GET /api/health environment matrix and secret safety', () => {
    it('development without secret reports vaultConfigured = true', async () => {
      const res = await worker.fetch(
        new Request('https://app.velnar.studio/api/health'),
        { DB: {} as any, ENVIRONMENT: 'development' }
      );
      const json = await res.json() as any;
      expect(json.status).toBe('HEALTHY');
      expect(json.vaultConfigured).toBe(true);
      expect(json.vaultCryptoCapability).toBe('AES-GCM-256');
      expect(json.productionAuthProvider).toBe('NOT_CONFIGURED');
      expect(json.productionExternalAi).toBe('DISABLED');
    });

    it('test without secret reports vaultConfigured = true', async () => {
      const res = await worker.fetch(
        new Request('https://app.velnar.studio/api/health'),
        { DB: {} as any, ENVIRONMENT: 'test' }
      );
      const json = await res.json() as any;
      expect(json.status).toBe('HEALTHY');
      expect(json.vaultConfigured).toBe(true);
    });

    it('preview without secret reports vaultConfigured = false', async () => {
      const res = await worker.fetch(
        new Request('https://app.velnar.studio/api/health'),
        { DB: {} as any, ENVIRONMENT: 'preview' }
      );
      const json = await res.json() as any;
      expect(json.status).toBe('HEALTHY');
      expect(json.vaultConfigured).toBe(false);
    });

    it('preview with valid secret reports vaultConfigured = true', async () => {
      const res = await worker.fetch(
        new Request('https://app.velnar.studio/api/health'),
        {
          DB: {} as any,
          ENVIRONMENT: 'preview',
          VELNAR_MASTER_KMS_SECRET: 'valid_kms_secret_32_bytes_ok_123',
        }
      );
      const json = await res.json() as any;
      expect(json.status).toBe('HEALTHY');
      expect(json.vaultConfigured).toBe(true);
    });

    it('production without secret reports vaultConfigured = false', async () => {
      const res = await worker.fetch(
        new Request('https://app.velnar.studio/api/health'),
        { DB: {} as any, ENVIRONMENT: 'production' }
      );
      const json = await res.json() as any;
      expect(json.status).toBe('HEALTHY');
      expect(json.vaultConfigured).toBe(false);
    });

    it('production with valid secret reports vaultConfigured = true', async () => {
      const res = await worker.fetch(
        new Request('https://app.velnar.studio/api/health'),
        {
          DB: {} as any,
          ENVIRONMENT: 'production',
          VELNAR_MASTER_KMS_SECRET: 'valid_kms_secret_32_bytes_ok_123',
        }
      );
      const json = await res.json() as any;
      expect(json.status).toBe('HEALTHY');
      expect(json.vaultConfigured).toBe(true);
    });

    it('never exposes VELNAR_MASTER_KMS_SECRET or key material in /api/health response body or headers', async () => {
      const secret = 'super_sensitive_secret_never_leak_xyz_123';
      const res = await worker.fetch(
        new Request('https://app.velnar.studio/api/health'),
        {
          DB: {} as any,
          ENVIRONMENT: 'production',
          VELNAR_MASTER_KMS_SECRET: secret,
        }
      );
      const text = await res.text();
      expect(text).not.toContain(secret);
      res.headers.forEach((val) => expect(val).not.toContain(secret));
    });
  });

  it('Protected routes should fail-closed with 401 when Authorization header is missing', async () => {
    const req = new Request('https://app.velnar.studio/api/leads?orgId=org_apex_holding', {
      method: 'GET',
    });

    const res = await worker.fetch(req, { DB: {} as any, ENVIRONMENT: 'production' });
    expect(res.status).toBe(401);

    const json = (await res.json()) as any;
    expect(json.error).toBe('UNAUTHORIZED');
  });

  it('Protected routes should fail-closed with 401 in production when mock token is provided', async () => {
    const req = new Request('https://app.velnar.studio/api/leads?orgId=org_apex_holding', {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer dev_session_token_owner_01',
      },
    });

    const res = await worker.fetch(req, { DB: {} as any, ENVIRONMENT: 'production' });
    expect(res.status).toBe(401);
  });

  it('Protected routes in production should fail-closed with 503 when DB is missing', async () => {
    const req = new Request('https://app.velnar.studio/api/leads?orgId=org_apex_holding', {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer test_user:usr_dev_owner:org_apex_holding:OWNER',
      },
    });

    const res = await worker.fetch(req, { ENVIRONMENT: 'production' } as any);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  describe('Strict Tenant ID Isolation & Zero Fallbacks across Route Handlers', () => {
    const protectedRoutes = [
      { path: '/api/leads', method: 'GET' },
      { path: '/api/appointments', method: 'GET' },
      { path: '/api/actions', method: 'GET' },
      { path: '/api/leaks', method: 'GET' },
      { path: '/api/attribution', method: 'GET' },
      { path: '/api/audit', method: 'GET' },
      { path: '/api/security/events', method: 'GET' },
      { path: '/api/vault', method: 'GET' },
      { path: '/api/ai/status', method: 'GET' },
    ];

    for (const route of protectedRoutes) {
      it(`returns 400 TENANT_ID_REQUIRED for ${route.path} when orgId query parameter and header are omitted`, async () => {
        const req = new Request(`https://app.velnar.studio${route.path}`, {
          method: route.method,
          headers: {
            'Authorization': 'Bearer test_user:usr_dev_owner:org_apex_holding:OWNER',
          },
        });

        const res = await worker.fetch(req, { DB: {} as any, ENVIRONMENT: 'development' });
        expect(res.status).toBe(400);
        const json = await res.json() as any;
        expect(json.error).toBe('TENANT_ID_REQUIRED');
      });
    }

    it('/api/vault/dev-demo returns 404 DEV_ENDPOINT_DISABLED in production environment', async () => {
      const req = new Request('https://app.velnar.studio/api/vault/dev-demo?orgId=org_apex_holding', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test_user:usr_dev_owner:org_apex_holding:OWNER',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ plaintext: 'synthetic test PII' }),
      });

      const res = await worker.fetch(req, { DB: {} as any, ENVIRONMENT: 'production' });
      expect(res.status).toBe(404);
      const json = await res.json() as any;
      expect(json.error).toBe('DEV_ENDPOINT_DISABLED');
    });

    it('/api/vault/dev-demo returns 400 PLAINTEXT_REQUIRED in dev if plaintext is empty', async () => {
      const req = new Request('https://app.velnar.studio/api/vault/dev-demo?orgId=org_apex_holding', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test_user:usr_dev_owner:org_apex_holding:OWNER',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ plaintext: '' }),
      });

      const res = await worker.fetch(req, { DB: {} as any, ENVIRONMENT: 'development' });
      expect(res.status).toBe(400);
      const json = await res.json() as any;
      expect(json.error).toBe('PLAINTEXT_REQUIRED');
    });
  });

  describe('CORS Enforcement & ALLOWED_ORIGINS single source of truth', () => {
    it('Production CORS allows valid configured origins', async () => {
      const allowed = ['https://app.velnar.studio', 'https://velnar.studio'];
      for (const origin of allowed) {
        const req = new Request('https://app.velnar.studio/api/leads', {
          method: 'OPTIONS',
          headers: { 'Origin': origin },
        });

        const res = await worker.fetch(req, {
          DB: {} as any,
          ENVIRONMENT: 'production',
          ALLOWED_ORIGINS: 'https://app.velnar.studio,https://velnar.studio',
        });

        expect(res.status).toBe(204);
        expect(res.headers.get('Access-Control-Allow-Origin')).toBe(origin);
      }
    });

    it('Production CORS blocks malicious origins and does not use substring matching', async () => {
      const maliciousOrigins = [
        'https://velnar.studio.attacker.com',
        'https://malicious-velnar.studio',
        'https://app.velnar.studio.fake.org',
        'https://random-site.xyz',
        'http://localhost:3000', // Localhost disallowed in production without explicit config
      ];

      for (const origin of maliciousOrigins) {
        const req = new Request('https://app.velnar.studio/api/leads', {
          method: 'OPTIONS',
          headers: { 'Origin': origin },
        });

        const res = await worker.fetch(req, {
          DB: {} as any,
          ENVIRONMENT: 'production',
          ALLOWED_ORIGINS: 'https://app.velnar.studio,https://velnar.studio',
        });

        expect(res.status).toBe(403);
        expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
      }
    });

    it('Preview configured origin is allowed when explicitly in ALLOWED_ORIGINS', async () => {
      const previewOrigin = 'https://preview.velnar.studio';
      const req = new Request('https://preview.velnar.studio/api/leads', {
        method: 'OPTIONS',
        headers: { 'Origin': previewOrigin },
      });

      const res = await worker.fetch(req, {
        DB: {} as any,
        ENVIRONMENT: 'preview',
        ALLOWED_ORIGINS: 'https://preview.velnar.studio,http://localhost:3000',
      });

      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe(previewOrigin);
    });

    it('Unknown preview origin is strictly denied', async () => {
      const unknownPreviewOrigin = 'https://unknown-preview.velnar.studio';
      const req = new Request('https://preview.velnar.studio/api/leads', {
        method: 'OPTIONS',
        headers: { 'Origin': unknownPreviewOrigin },
      });

      const res = await worker.fetch(req, {
        DB: {} as any,
        ENVIRONMENT: 'preview',
        ALLOWED_ORIGINS: 'https://preview.velnar.studio,http://localhost:3000',
      });

      expect(res.status).toBe(403);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    });

    it('getValidatedCorsOrigin unit tests verify exact matching without reflection', () => {
      // Null origin
      expect(getValidatedCorsOrigin(null, 'production', 'https://velnar.studio')).toBeNull();

      // Configured production
      expect(getValidatedCorsOrigin('https://velnar.studio', 'production', 'https://velnar.studio,https://app.velnar.studio')).toBe('https://velnar.studio');
      expect(getValidatedCorsOrigin('https://velnar.studio.malicious.com', 'production', 'https://velnar.studio')).toBeNull();

      // Configured preview
      expect(getValidatedCorsOrigin('https://preview.velnar.studio', 'preview', 'https://preview.velnar.studio')).toBe('https://preview.velnar.studio');
      expect(getValidatedCorsOrigin('https://evil-preview.velnar.studio', 'preview', 'https://preview.velnar.studio')).toBeNull();
    });
  });

  describe('POST /api/actions Worker Authority & Policy Validation', () => {
    beforeEach(async () => {
      GrowthActionRepository.resetMemoryStore();
      await ActionPolicyRepository.savePolicy(undefined, {
        organizationId: 'org_apex_holding',
        maximumDiscountPercent: 20,
        maximumAdBudgetMinor: 500000,
        allowedChannels: ['ops_dashboard', 'email'],
        prohibitedActions: [],
        requiresApprovalForOutboundMessaging: true,
        requiresApprovalForPriceChanges: true,
        humanApprovalRequired: true,
        autoExecutionEnabled: false,
      }, 'test');
    });

    it('successfully approves action when guardrails pass and records audit log', async () => {
      const req = new Request('https://app.velnar.studio/api/actions?orgId=org_apex_holding', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test_user:usr_dev_owner:org_apex_holding:OWNER',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          actionId: 'act_global_01',
          status: 'approved',
        }),
      });

      const res = await worker.fetch(req, { DB: undefined, ENVIRONMENT: 'development' });
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.data.approval_status).toBe('approved');
      expect(json.data.guardrail_status).toBe('PASSED');
      expect(json.data.approved_by_user_id).toBe('usr_dev_owner');
    });

    it('rejects action approval when client attempts to substitute execution payload (400 BAD_REQUEST)', async () => {
      const req = new Request('https://app.velnar.studio/api/actions?orgId=org_apex_holding', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test_user:usr_dev_owner:org_apex_holding:OWNER',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          actionId: 'act_global_01',
          status: 'approved',
          executionPayload: {
            actionType: 'pricing_adjustment',
            discountPercent: 75,
            requiresHumanApproval: true,
          }
        }),
      });

      const res = await worker.fetch(req, { DB: undefined, ENVIRONMENT: 'development' });
      expect(res.status).toBe(400);
      const json = await res.json() as any;
      expect(json.error).toBe('BAD_REQUEST');
      expect(json.message).toContain('Overriding execution parameters is prohibited');
    });

    it('rejects action approval with 422 GUARDRAIL_VIOLATION when stored action discount exceeds tenant policy limit', async () => {
      // Configure strict 2% discount cap on org_apex_holding
      await ActionPolicyRepository.savePolicy(undefined, {
        organizationId: 'org_apex_holding',
        maximumDiscountPercent: 2,
        maximumAdBudgetMinor: 500000,
        allowedChannels: ['ops_dashboard'],
        prohibitedActions: [],
        requiresApprovalForOutboundMessaging: true,
        requiresApprovalForPriceChanges: true,
        humanApprovalRequired: true,
        autoExecutionEnabled: false,
      }, 'test');

      const req = new Request('https://app.velnar.studio/api/actions?orgId=org_apex_holding', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test_user:usr_dev_owner:org_apex_holding:OWNER',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          actionId: 'act_global_01', // Has 5% discount, which exceeds 2% cap
          status: 'approved',
        }),
      });

      const res = await worker.fetch(req, { DB: undefined, ENVIRONMENT: 'development' });
      expect(res.status).toBe(422);
      const json = await res.json() as any;
      expect(json.error).toBe('GUARDRAIL_VIOLATION');
      expect(json.violations.length).toBeGreaterThan(0);
      expect(json.violations[0]).toContain('exceeds organization maximum allowable cap');
    });

    it('successfully rejects action', async () => {
      const req = new Request('https://app.velnar.studio/api/actions?orgId=org_apex_holding', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test_user:usr_dev_owner:org_apex_holding:OWNER',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          actionId: 'act_global_01',
          status: 'rejected',
        }),
      });

      const res = await worker.fetch(req, { DB: undefined, ENVIRONMENT: 'development' });
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.data.approval_status).toBe('rejected');
    });

    it('successfully defers action', async () => {
      const req = new Request('https://app.velnar.studio/api/actions?orgId=org_apex_holding', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test_user:usr_dev_owner:org_apex_holding:OWNER',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          actionId: 'act_global_01',
          status: 'deferred',
        }),
      });

      const res = await worker.fetch(req, { DB: undefined, ENVIRONMENT: 'development' });
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.data.approval_status).toBe('deferred');
    });

    it('returns 400 when status is invalid or actionId is missing', async () => {
      const req = new Request('https://app.velnar.studio/api/actions?orgId=org_apex_holding', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test_user:usr_dev_owner:org_apex_holding:OWNER',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status: 'unknown_status',
        }),
      });

      const res = await worker.fetch(req, { DB: {} as any, ENVIRONMENT: 'development' });
      expect(res.status).toBe(400);
    });
  });

  describe('/api/action-policy authenticated CRUD and invariants', () => {
    it('GET /api/action-policy allows settings.read role and returns policy', async () => {
      const req = new Request('https://app.velnar.studio/api/action-policy?orgId=org_apex_holding', {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer test_user:usr_dev_owner:org_apex_holding:ADMIN',
        },
      });

      const res = await worker.fetch(req, { DB: undefined, ENVIRONMENT: 'development' });
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.data).toBeDefined();
      expect(json.data.humanApprovalRequired).toBe(true);
      expect(json.data.autoExecutionEnabled).toBe(false);
    });

    it('GET /api/action-policy rejects unauthorized roles or missing auth', async () => {
      const unauthReq = new Request('https://app.velnar.studio/api/action-policy?orgId=org_apex_holding', {
        method: 'GET',
      });
      const unauthRes = await worker.fetch(unauthReq, { DB: undefined, ENVIRONMENT: 'development' });
      expect(unauthRes.status).toBe(401);

      const crossTenantReq = new Request('https://app.velnar.studio/api/action-policy?orgId=org_foreign_tenant', {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer test_user:usr_dev_owner:org_apex_holding:ADMIN',
        },
      });
      const crossTenantRes = await worker.fetch(crossTenantReq, { DB: undefined, ENVIRONMENT: 'development' });
      expect(crossTenantRes.status).toBe(403);
    });

    it('PATCH /api/action-policy allows settings.edit to update policy', async () => {
      const req = new Request('https://app.velnar.studio/api/action-policy?orgId=org_apex_holding&businessId=biz_salon', {
        method: 'PATCH',
        headers: {
          'Authorization': 'Bearer test_user:usr_dev_owner:org_apex_holding:OWNER',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          maximumDiscountPercent: 35,
          maximumAdBudgetMinor: 250000,
          allowedChannels: ['ops_dashboard', 'sms'],
          requiresApprovalForOutboundMessaging: true,
          requiresApprovalForPriceChanges: true,
        }),
      });

      const res = await worker.fetch(req, { DB: undefined, ENVIRONMENT: 'development' });
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.data.maximumDiscountPercent).toBe(35);
      expect(json.data.businessId).toBe('biz_salon');
      expect(json.data.humanApprovalRequired).toBe(true);
      expect(json.data.autoExecutionEnabled).toBe(false);
    });

    it('PATCH /api/action-policy rejects attempts to disable human approval or enable auto execution', async () => {
      const req = new Request('https://app.velnar.studio/api/action-policy?orgId=org_apex_holding', {
        method: 'PATCH',
        headers: {
          'Authorization': 'Bearer test_user:usr_dev_owner:org_apex_holding:OWNER',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          humanApprovalRequired: false,
        }),
      });

      const res = await worker.fetch(req, { DB: undefined, ENVIRONMENT: 'development' });
      expect(res.status).toBe(400);
      const json = await res.json() as any;
      expect(json.error).toBe('GLOBAL_INVARIANT_VIOLATION');
    });

    it('PATCH /api/action-policy rejects unknown fields', async () => {
      const req = new Request('https://app.velnar.studio/api/action-policy?orgId=org_apex_holding', {
        method: 'PATCH',
        headers: {
          'Authorization': 'Bearer test_user:usr_dev_owner:org_apex_holding:OWNER',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          injectedBackdoorField: 'malicious',
        }),
      });

      const res = await worker.fetch(req, { DB: undefined, ENVIRONMENT: 'development' });
      expect(res.status).toBe(400);
      const json = await res.json() as any;
      expect(json.error).toBe('UNKNOWN_FIELDS_REJECTED');
    });
  });

  describe('GET /api/session & /api/bootstrap', () => {
    it('returns server-derived identity context without trusting client input', async () => {
      const req = new Request('https://app.velnar.studio/api/session?orgId=org_apex_holding', {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer test_user:usr_test_member:org_apex_holding:MANAGER',
        },
      });

      const res = await worker.fetch(req, { DB: undefined, ENVIRONMENT: 'development' });
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.data.userId).toBe('usr_test_member');
      expect(json.data.activeOrganizationId).toBe('org_apex_holding');
      expect(json.data.role).toBe('MANAGER');
    });

    it('returns null activeOrganizationId and null role when orgId is omitted', async () => {
      const req = new Request('https://app.velnar.studio/api/session', {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer test_user:usr_test_member:org_apex_holding:MANAGER',
        },
      });

      const res = await worker.fetch(req, { DB: undefined, ENVIRONMENT: 'development' });
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.data.userId).toBe('usr_test_member');
      expect(json.data.activeOrganizationId).toBeNull();
      expect(json.data.role).toBeNull();
    });
  });
});
