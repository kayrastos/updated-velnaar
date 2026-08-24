/**
 * @file worker/index.ts
 * @description Cloudflare Worker API Boundary & Zero-Trust Dispatch Router (Sprint 3.4 Hardened)
 * 
 * ============================================================================
 * ARCHITECTURAL MANDATES:
 * 1. Fail-closed authentication: Reject missing/invalid tokens with 401.
 * 2. Strict CORS: Only allow https://velnar.studio and https://app.velnar.studio in production.
 *    Unknown Origin receives NO Access-Control-Allow-Origin header. Never reflect arbitrary Origin.
 * 3. Safe error handling: In production, return generic { "error": "INTERNAL_ERROR" } without leaking
 *    stack traces, SQL details, or crypto details. Detailed redacted errors go to SafeLogger only.
 * 4. Pass env.DB to all production routers.
 * ============================================================================
 */

import { AuthContextService } from './auth/authContext';
import { handleLeadsRoute } from './routes/leadsRouter';
import { handleAppointmentsRoute } from './routes/appointmentsRouter';
import { handleRevenueLeaksRoute } from './routes/revenueLeaksRouter';
import { handleGrowthActionsRoute } from './routes/growthActionsRouter';
import { handleAttributionRoute } from './routes/attributionRouter';
import { handleVaultRoute } from './routes/vaultRouter';
import { handleSecurityRoute } from './routes/securityRouter';
import { handleAuditRoute } from './routes/auditRouter';
import { SafeLogger } from './security/safeLogger';

export interface WorkerEnv {
  DB: D1Database;
  VELNAR_MASTER_KMS_SECRET?: string;
  ENVIRONMENT: string;
  ALLOWED_ORIGINS?: string;
}

const PROD_ALLOWED_ORIGINS = [
  'https://velnar.studio',
  'https://app.velnar.studio'
];

const DEV_ALLOWED_ORIGINS = [
  'https://velnar.studio',
  'https://app.velnar.studio',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173'
];

/**
 * Strict CORS origin verification.
 * Returns the validated origin string if allowed, or null if disallowed/unknown.
 * Never reflects arbitrary origins.
 */
export function getValidatedCorsOrigin(origin: string | null, environment: string): string | null {
  if (!origin) return null;

  const isDevOrTest = environment === 'development' || environment === 'test';
  
  if (isDevOrTest) {
    if (DEV_ALLOWED_ORIGINS.includes(origin) || origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
      return origin;
    }
    return null;
  }

  // Production environment: strictly check allowlist
  if (PROD_ALLOWED_ORIGINS.includes(origin)) {
    return origin;
  }

  return null;
}

export default {
  async fetch(request: Request, env: WorkerEnv, ctx?: any): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const environment = env?.ENVIRONMENT || 'production';
    const validatedOrigin = getValidatedCorsOrigin(origin, environment);

    // 1. Handle CORS Preflight
    if (request.method === 'OPTIONS') {
      if (origin && !validatedOrigin) {
        // Unknown Origin in preflight receives 403 and no CORS headers
        return new Response('CORS Origin Forbidden', { status: 403 });
      }

      const headers: Record<string, string> = {
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, X-Tenant-Id',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin',
      };

      if (validatedOrigin) {
        headers['Access-Control-Allow-Origin'] = validatedOrigin;
      }

      return new Response(null, { status: 204, headers });
    }

    try {
      // 2. Health & Public Discovery Endpoint (Unauthenticated)
      if (url.pathname === '/api/health') {
        const healthResponse = Response.json({
          status: 'ok',
          version: '3.4.0-hardened',
          timestamp: new Date().toISOString(),
          environment,
          d1Status: env.DB ? 'ATTACHED' : 'NOT_BOUND',
          guard: 'Cloudflare Worker Zero-Trust Active',
          crypto: 'AES-GCM-256 Web Crypto Enabled',
          roles: ['OWNER', 'ADMIN', 'MANAGER', 'STAFF', 'VIEWER'],
          fulgorRay: { status: 'DISABLED', mode: 'MOCK_OFFLINE_RECEIVER' }
        });
        return addCorsAndSecurityHeaders(healthResponse, validatedOrigin);
      }

      // 3. Resolve Authenticated Identity (Fail-Closed)
      const authHeader = request.headers.get('Authorization');
      const user = AuthContextService.resolveSessionUser(authHeader, environment);

      // Log request safely with redacted token
      SafeLogger.info(`[WORKER_ROUTER] ${request.method} ${url.pathname} for user [${user ? user.userId : 'ANONYMOUS'}]`);

      // If route requires authentication and user is null, fail-closed with 401
      if (!user) {
        SafeLogger.warn(`[AUTH_DENIAL] Unauthorized access attempt to ${url.pathname} (Missing or invalid token)`);
        const unauthorizedResp = Response.json({
          error: 'UNAUTHORIZED',
          message: 'Authentication required. Missing or invalid authorization token.',
        }, { status: 401 });
        return addCorsAndSecurityHeaders(unauthorizedResp, validatedOrigin);
      }

      // If in production and DB binding is missing, fail-closed with 503 DATABASE_NOT_CONFIGURED
      if (environment === 'production' && !env.DB) {
        SafeLogger.error('[WORKER_CONFIG_ERROR] Cloudflare D1 Database binding (env.DB) is missing in production');
        const dbNotConfiguredResp = Response.json({
          error: 'DATABASE_NOT_CONFIGURED',
          message: 'Database service is not configured or unavailable in production.',
        }, { status: 503 });
        return addCorsAndSecurityHeaders(dbNotConfiguredResp, validatedOrigin);
      }

      // 4. Dispatch to Sub-Routers
      let response: Response;

      if (url.pathname.startsWith('/api/leads')) {
        response = await handleLeadsRoute(request, user, url, env.DB, environment);
      } else if (url.pathname.startsWith('/api/appointments')) {
        response = await handleAppointmentsRoute(request, user, url, env.DB, environment);
      } else if (url.pathname.startsWith('/api/leaks')) {
        response = await handleRevenueLeaksRoute(request, user, url, env.DB, environment);
      } else if (url.pathname.startsWith('/api/actions') || url.pathname.startsWith('/api/proof')) {
        response = await handleGrowthActionsRoute(request, user, url, env.DB, environment);
      } else if (url.pathname.startsWith('/api/attribution')) {
        response = await handleAttributionRoute(request, user, url, env.DB, environment);
      } else if (url.pathname.startsWith('/api/vault')) {
        response = await handleVaultRoute(request, user, url, env.DB, env.VELNAR_MASTER_KMS_SECRET, environment);
      } else if (url.pathname.startsWith('/api/security')) {
        response = await handleSecurityRoute(request, user, url, env.DB, env.VELNAR_MASTER_KMS_SECRET, environment);
      } else if (url.pathname.startsWith('/api/audit')) {
        response = await handleAuditRoute(request, user, url, env.DB, environment);
      } else if (url.pathname === '/api/auth/me') {
        response = Response.json({ data: user });
      } else {
        response = Response.json({ error: 'NOT_FOUND', message: `Route not found: ${url.pathname}` }, { status: 404 });
      }

      return addCorsAndSecurityHeaders(response, validatedOrigin);
    } catch (err: any) {
      // Detailed redacted errors go strictly to SafeLogger
      SafeLogger.error(`[WORKER_FATAL_ERROR] ${err?.message || 'Unknown error'}`, { stack: err?.stack });
      
      const isDev = environment === 'development' || environment === 'test';
      
      // In production: MUST NOT contain err.message, err.stack, SQL details, crypto details
      const errorResp = isDev
        ? Response.json({ error: 'INTERNAL_ERROR', message: err?.message }, { status: 500 })
        : Response.json({ error: 'INTERNAL_ERROR' }, { status: 500 });

      return addCorsAndSecurityHeaders(errorResp, validatedOrigin);
    }
  },
};

function addCorsAndSecurityHeaders(response: Response, validatedOrigin: string | null): Response {
  const headers = new Headers(response.headers);
  if (validatedOrigin) {
    headers.set('Access-Control-Allow-Origin', validatedOrigin);
    headers.set('Vary', 'Origin');
  } else {
    headers.delete('Access-Control-Allow-Origin');
  }
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('X-XSS-Protection', '1; mode=block');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
