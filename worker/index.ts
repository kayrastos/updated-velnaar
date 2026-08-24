/**
 * @file worker/index.ts
 * @description Cloudflare Worker API Boundary & Zero-Trust Dispatch Router
 * 
 * ============================================================================
 * ARCHITECTURAL MANDATES:
 * 1. Fail-closed authentication: Reject missing/invalid tokens with 401.
 * 2. Origin validation: Do not reflect arbitrary Origin in production.
 * 3. Sanitized error handling: Never leak stack traces to client.
 * 4. Tenant isolation: Request -> Auth -> TenantGuard -> D1 Repository -> Response.
 * ============================================================================
 */

import { AuthContextService, AuthenticatedUser } from './auth/authContext';
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
  DB?: D1Database;
  VELNAR_MASTER_KMS_SECRET?: string;
  ENVIRONMENT?: string;
  ALLOWED_ORIGINS?: string;
}

const DEFAULT_DEV_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
  'https://app.velnar.studio',
  'https://velnar.studio'
];

function isOriginAllowed(origin: string | null, env: WorkerEnv): boolean {
  if (!origin) return false;
  
  const isProd = env.ENVIRONMENT === 'production';
  if (isProd) {
    const configured = (env.ALLOWED_ORIGINS || '')
      .split(',')
      .map(o => o.trim())
      .filter(Boolean);
    const prodAllowed = configured.length > 0 
      ? configured 
      : ['https://app.velnar.studio', 'https://velnar.studio'];
    return prodAllowed.includes(origin);
  }

  // Development / Test mode
  if (DEFAULT_DEV_ORIGINS.includes(origin)) return true;
  if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) return true;
  return false;
}

export default {
  async fetch(request: Request, env: WorkerEnv = {}, ctx?: any): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const isAllowed = isOriginAllowed(origin, env);
    const corsOrigin = isAllowed ? (origin || '*') : '';

    // Handle CORS Preflight
    if (request.method === 'OPTIONS') {
      if (origin && !isAllowed) {
        return new Response('CORS Origin Forbidden', { status: 403 });
      }

      return new Response(null, {
        status: 204,
        headers: {
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, X-Tenant-Id',
          'Access-Control-Max-Age': '86400',
          'Vary': 'Origin',
        },
      });
    }

    try {
      // 1. Health & Public Discovery Endpoint (Unauthenticated)
      if (url.pathname === '/api/health') {
        const healthResponse = Response.json({
          status: 'ok',
          version: '3.2.0-hardened',
          timestamp: new Date().toISOString(),
          environment: env.ENVIRONMENT || 'development',
          d1Status: env.DB ? 'ATTACHED' : 'IN_MEMORY_DEV_FALLBACK',
          guard: 'Cloudflare Worker Zero-Trust Active',
          crypto: 'AES-GCM-256 Web Crypto Enabled',
          roles: ['OWNER', 'ADMIN', 'MANAGER', 'STAFF', 'VIEWER'],
          fulgorRay: { status: 'DISABLED', mode: 'MOCK_OFFLINE_RECEIVER' }
        });
        return addCorsAndSecurityHeaders(healthResponse, corsOrigin);
      }

      // 2. Resolve Authenticated Identity (Fail-Closed)
      const authHeader = request.headers.get('Authorization');
      const user = AuthContextService.resolveSessionUser(authHeader, env);

      // Log request safely with redacted token
      SafeLogger.info(`[WORKER_ROUTER] ${request.method} ${url.pathname} for user [${user ? user.userId : 'ANONYMOUS'}]`);

      // If route requires authentication and user is null, fail-closed with 401
      if (!user) {
        SafeLogger.warn(`[AUTH_DENIAL] Unauthorized access attempt to ${url.pathname} (Missing or invalid token)`);
        const unauthorizedResp = Response.json({
          error: 'UNAUTHORIZED',
          message: 'Authentication required. Missing or invalid authorization token.',
        }, { status: 401 });
        return addCorsAndSecurityHeaders(unauthorizedResp, corsOrigin);
      }

      // 3. Dispatch to Sub-Routers
      let response: Response;

      if (url.pathname.startsWith('/api/leads')) {
        response = await handleLeadsRoute(request, user, url, env.DB);
      } else if (url.pathname.startsWith('/api/appointments')) {
        response = await handleAppointmentsRoute(request, user, url, env.DB);
      } else if (url.pathname.startsWith('/api/leaks')) {
        response = await handleRevenueLeaksRoute(request, user, url, env.DB);
      } else if (url.pathname.startsWith('/api/actions') || url.pathname.startsWith('/api/proof')) {
        response = await handleGrowthActionsRoute(request, user, url, env.DB);
      } else if (url.pathname.startsWith('/api/attribution')) {
        response = await handleAttributionRoute(request, user, url, env.DB);
      } else if (url.pathname.startsWith('/api/vault')) {
        response = await handleVaultRoute(request, user, url, env.DB, env.VELNAR_MASTER_KMS_SECRET, env);
      } else if (url.pathname.startsWith('/api/security')) {
        response = await handleSecurityRoute(request, user, url, env.DB, env.VELNAR_MASTER_KMS_SECRET, env);
      } else if (url.pathname.startsWith('/api/audit')) {
        response = await handleAuditRoute(request, user, url, env.DB);
      } else if (url.pathname === '/api/auth/me') {
        response = Response.json({ data: user });
      } else {
        response = Response.json({ error: 'NOT_FOUND', message: `Route not found: ${url.pathname}` }, { status: 404 });
      }

      return addCorsAndSecurityHeaders(response, corsOrigin);
    } catch (err: any) {
      SafeLogger.error(`[WORKER_FATAL_ERROR] ${err.message}`, { stack: err.stack });
      
      const isDev = env.ENVIRONMENT !== 'production';
      const errorResp = Response.json({
        error: 'INTERNAL_SERVER_ERROR',
        message: isDev ? err.message : 'An internal error occurred. Please contact security team with request ID.',
      }, { status: 500 });

      return addCorsAndSecurityHeaders(errorResp, corsOrigin);
    }
  },
};

function addCorsAndSecurityHeaders(response: Response, corsOrigin: string): Response {
  const headers = new Headers(response.headers);
  if (corsOrigin) {
    headers.set('Access-Control-Allow-Origin', corsOrigin);
    headers.set('Vary', 'Origin');
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
