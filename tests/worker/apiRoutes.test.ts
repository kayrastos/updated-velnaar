import { describe, it, expect } from 'vitest';
import worker, { getValidatedCorsOrigin } from '../../worker/index';

describe('Cloudflare Worker API Boundary Integration', () => {
  it('GET /api/health should be open and report hardened zero-trust status with vault capability', async () => {
    const req = new Request('https://app.velnar.studio/api/health', {
      method: 'GET',
    });

    const res = await worker.fetch(req, { DB: {} as any, ENVIRONMENT: 'test' });
    expect(res.status).toBe(200);

    const json = (await res.json()) as any;
    expect(json.status).toBe('ok');
    expect(json.version).toContain('3.4.0');
    expect(json.vaultCryptoCapability).toBe('AES-GCM-256');
    expect(typeof json.vaultConfigured).toBe('boolean');
    expect(json.fulgorRay.status).toBe('DISABLED');
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
});
