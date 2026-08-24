/**
 * @file worker/index.ts
 * @description Cloudflare Worker API Boundary & Dispatch Router
 * 
 * ============================================================================
 * ARCHITECTURE MANDATE:
 * All sensitive business data must be accessed through server-side API routes.
 * The React frontend must NEVER directly decide whether a user may access another tenant's resource.
 * Request flow:
 * Request -> Authenticated User -> Org Membership -> Role -> Permission -> Tenant-Scoped Repository Query -> Response.
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
  VELNAR_MASTER_KMS_SECRET?: string;
  ENVIRONMENT?: string;
}

export default {
  async fetch(request: Request, env: WorkerEnv = {}, ctx?: any): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '*';

    // CORS Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    try {
      // 1. Resolve Authenticated Identity from Authorization header / session
      const authHeader = request.headers.get('Authorization');
      const user = AuthContextService.resolveSessionUser(authHeader);

      // Safe debug log with redacted token
      SafeLogger.info(`[WORKER_ROUTER] ${request.method} ${url.pathname} for user [${user.userId}]`);

      // 2. Dispatch to Sub-Routers
      let response: Response;

      if (url.pathname.startsWith('/api/leads')) {
        response = await handleLeadsRoute(request, user, url);
      } else if (url.pathname.startsWith('/api/appointments')) {
        response = await handleAppointmentsRoute(request, user, url);
      } else if (url.pathname.startsWith('/api/leaks')) {
        response = await handleRevenueLeaksRoute(request, user, url);
      } else if (url.pathname.startsWith('/api/actions') || url.pathname.startsWith('/api/proof')) {
        response = await handleGrowthActionsRoute(request, user, url);
      } else if (url.pathname.startsWith('/api/attribution')) {
        response = await handleAttributionRoute(request, user, url);
      } else if (url.pathname.startsWith('/api/vault')) {
        response = await handleVaultRoute(request, user, url, env.VELNAR_MASTER_KMS_SECRET);
      } else if (url.pathname.startsWith('/api/security')) {
        response = await handleSecurityRoute(request, user, url);
      } else if (url.pathname.startsWith('/api/audit')) {
        response = await handleAuditRoute(request, user, url);
      } else if (url.pathname === '/api/health') {
        response = Response.json({
          status: 'ok',
          version: '3.1.0-hardened',
          timestamp: new Date().toISOString(),
          guard: 'Cloudflare Worker Zero-Trust Active',
          crypto: 'AES-GCM-256 Web Crypto Enabled',
          roles: ['OWNER', 'ADMIN', 'MANAGER', 'STAFF', 'VIEWER'],
          fulgorRay: { status: 'DISABLED', mode: 'MOCK_OFFLINE_RECEIVER' }
        });
      } else {
        response = Response.json({ error: `Route not found: ${url.pathname}` }, { status: 404 });
      }

      // Add CORS headers to response
      const headers = new Headers(response.headers);
      headers.set('Access-Control-Allow-Origin', origin);
      headers.set('X-Content-Type-Options', 'nosniff');
      headers.set('X-Frame-Options', 'DENY');

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (err: any) {
      SafeLogger.error(`[WORKER_FATAL_ERROR] ${err.message}`, { stack: err.stack });
      return Response.json({
        error: 'INTERNAL_SERVER_ERROR',
        message: err.message || 'An unexpected error occurred.',
      }, { status: 500 });
    }
  },
};
