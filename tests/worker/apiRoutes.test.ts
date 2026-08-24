import { describe, it, expect } from 'vitest';
import worker from '../../worker/index';

describe('Cloudflare Worker API Boundary Integration', () => {
  it('GET /api/health should be open and report hardened zero-trust status', async () => {
    const req = new Request('https://app.velnar.studio/api/health', {
      method: 'GET',
    });

    const res = await worker.fetch(req, { DB: {} as any, ENVIRONMENT: 'test' });
    expect(res.status).toBe(200);

    const json = (await res.json()) as any;
    expect(json.status).toBe('ok');
    expect(json.version).toContain('3.4.0');
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

  it('Production CORS should forbid disallowed origins in OPTIONS preflight', async () => {
    const req = new Request('https://app.velnar.studio/api/leads', {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://malicious-site.com',
      },
    });

    const res = await worker.fetch(req, {
      DB: {} as any,
      ENVIRONMENT: 'production',
      ALLOWED_ORIGINS: 'https://app.velnar.studio,https://velnar.studio',
    });

    expect(res.status).toBe(403);
  });

  it('Production CORS should allow legitimate origins in OPTIONS preflight', async () => {
    const req = new Request('https://app.velnar.studio/api/leads', {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://app.velnar.studio',
      },
    });

    const res = await worker.fetch(req, {
      DB: {} as any,
      ENVIRONMENT: 'production',
      ALLOWED_ORIGINS: 'https://app.velnar.studio,https://velnar.studio',
    });

    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.velnar.studio');
  });
});
