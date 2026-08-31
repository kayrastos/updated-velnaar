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

import { AuthContextService, isValidUserRole } from './auth/authContext';
import { handleLeadsRoute } from './routes/leadsRouter';
import { handleAppointmentsRoute } from './routes/appointmentsRouter';
import { handleRevenueLeaksRoute } from './routes/revenueLeaksRouter';
import { handleGrowthActionsRoute } from './routes/growthActionsRouter';
import { handleAttributionRoute } from './routes/attributionRouter';
import { handleVaultRoute } from './routes/vaultRouter';
import { handleSecurityRoute } from './routes/securityRouter';
import { handleAuditRoute } from './routes/auditRouter';
import { handleAiRoute } from './routes/aiRouter';
import { handleActionPolicyRoute } from './routes/actionPolicyRouter';
import { handleBootstrapRoute } from './routes/bootstrapRouter';
import { SafeLogger } from './security/safeLogger';
import { isVaultConfigured } from './crypto/vaultCrypto';
import { WorkerEnv } from './env';

export type { WorkerEnv };

/**
 * Strict CORS origin verification.
 * Parses env.ALLOWED_ORIGINS as the single authoritative configured allowlist.
 * Returns the validated origin string if allowed, or null if disallowed/unknown.
 * Never reflects arbitrary origins.
 * Never uses substring matching for production origins.
 */
export function getValidatedCorsOrigin(
  origin: string | null,
  environment: string,
  configuredAllowedOrigins?: string
): string | null {
  if (!origin) return null;

  // Authoritative parsed list from configured environment variable
  const parsedOrigins = (configuredAllowedOrigins || '')
    .split(',')
    .map(o => o.trim())
    .filter(o => o.length > 0);

  // If ALLOWED_ORIGINS was configured, check exact match
  if (parsedOrigins.length > 0) {
    if (parsedOrigins.includes(origin)) {
      return origin;
    }
    return null;
  }

  // Environment fallback behaviors when ALLOWED_ORIGINS is unset
  if (environment === 'development' || environment === 'test') {
    const defaultDevOrigins = [
      'http://localhost:3000',
      'http://localhost:5173',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:5173',
      'https://app.velnar.studio',
      'https://velnar.studio'
    ];
    if (defaultDevOrigins.includes(origin)) {
      return origin;
    }
    return null;
  }

  // Production fallback: strictly limited to canonical production domains
  const defaultProdOrigins = [
    'https://velnar.studio',
    'https://app.velnar.studio'
  ];
  if (defaultProdOrigins.includes(origin)) {
    return origin;
  }

  return null;
}

export default {
  async fetch(request: Request, env: WorkerEnv, ctx?: any): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const environment = env?.ENVIRONMENT || 'production';
    const validatedOrigin = getValidatedCorsOrigin(origin, environment, env?.ALLOWED_ORIGINS);

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
        const vaultConfigured = isVaultConfigured(environment, env?.VELNAR_MASTER_KMS_SECRET);
        const databaseConfigured = Boolean(env?.DB);

        const healthResponse = Response.json({
          status: 'HEALTHY',
          version: '4.0.0-sprint4-intelligence',
          timestamp: new Date().toISOString(),
          environment,
          securityArchitecture: 'SERVER_SIDE_TENANT_GUARD',
          cryptoCapability: 'AES-GCM-256',
          vaultCryptoCapability: 'AES-GCM-256',
          vaultConfigured,
          databaseConfigured,
          d1Status: databaseConfigured ? 'ATTACHED' : 'NOT_BOUND',
          productionAuthProvider: 'NOT_CONFIGURED',
          productionExternalAi: 'DISABLED',
          roles: ['OWNER', 'ADMIN', 'MANAGER', 'STAFF', 'VIEWER'],
          fulgorRay: { status: 'DISABLED', mode: 'MOCK_OFFLINE_RECEIVER' }
        });
        return addCorsAndSecurityHeaders(healthResponse, validatedOrigin);
      }

      // Dev demo endpoints are strictly disabled in production
      if (url.pathname === '/api/vault/dev-demo' && environment === 'production') {
        const devDisabledResp = Response.json({
          error: 'DEV_ENDPOINT_DISABLED',
          message: 'Dev demo endpoint is disabled in production.',
        }, { status: 404 });
        return addCorsAndSecurityHeaders(devDisabledResp, validatedOrigin);
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
        response = await handleAppointmentsRoute(request, user, url, env.DB, environment, env.AUDIT_IP_HASH_SECRET);
      } else if (url.pathname.startsWith('/api/leaks')) {
        response = await handleRevenueLeaksRoute(request, user, url, env.DB, environment);
      } else if (url.pathname.startsWith('/api/actions') || url.pathname.startsWith('/api/proof')) {
        response = await handleGrowthActionsRoute(request, user, url, env.DB, environment, env.AUDIT_IP_HASH_SECRET);
      } else if (url.pathname.startsWith('/api/attribution')) {
        response = await handleAttributionRoute(request, user, url, env.DB, environment);
      } else if (url.pathname.startsWith('/api/vault')) {
        response = await handleVaultRoute(request, user, url, env.DB, env.VELNAR_MASTER_KMS_SECRET, environment);
      } else if (url.pathname.startsWith('/api/security')) {
        response = await handleSecurityRoute(request, user, url, env.DB, env.VELNAR_MASTER_KMS_SECRET, environment);
      } else if (url.pathname.startsWith('/api/audit')) {
        response = await handleAuditRoute(request, user, url, env.DB, environment);
      } else if (url.pathname.startsWith('/api/action-policy')) {
        response = await handleActionPolicyRoute(request, user, url, env.DB, environment, env.AUDIT_IP_HASH_SECRET);
      } else if (url.pathname.startsWith('/api/ai')) {
        response = await handleAiRoute(request, user, url, env);
      } else if (url.pathname.startsWith('/api/bootstrap')) {
        response = await handleBootstrapRoute(request, user, url, env.DB, environment);
      } else if (url.pathname === '/api/auth/me' || url.pathname === '/api/session') {
        const requestedOrgId = url.searchParams.get('orgId')?.trim() || request.headers.get('X-Tenant-Id')?.trim();
        let effectiveOrgId: string | null = null;
        let effectiveRole: string | null = null;

        if (requestedOrgId) {
          const matchingMembership = user.memberships?.find(m => m.organizationId === requestedOrgId);
          if (matchingMembership) {
            effectiveOrgId = requestedOrgId;
            if (user.isSuperAdmin) {
              effectiveRole = 'OWNER';
            } else if (matchingMembership.role && isValidUserRole(matchingMembership.role)) {
              effectiveRole = matchingMembership.role;
            } else {
              const forbiddenResp = Response.json({
                error: 'AUTHORIZATION_CONTEXT_INVALID',
                message: `User [${user.userId}] has invalid or missing role in organization [${requestedOrgId}].`,
              }, { status: 403 });
              return addCorsAndSecurityHeaders(forbiddenResp, validatedOrigin);
            }
          } else if (user.isSuperAdmin) {
            effectiveOrgId = requestedOrgId;
            effectiveRole = 'OWNER';
          } else {
            const forbiddenResp = Response.json({
              error: 'CROSS_TENANT_ACCESS_DENIED',
              message: `User [${user.userId}] does not hold membership in organization [${requestedOrgId}].`,
            }, { status: 403 });
            return addCorsAndSecurityHeaders(forbiddenResp, validatedOrigin);
          }
        } else {
          // Without explicit requested/established tenant: activeOrganizationId = null, role = null
          effectiveOrgId = null;
          effectiveRole = null;
        }

        response = Response.json({
          data: {
            user,
            userId: user.userId,
            email: user.email,
            fullName: user.fullName,
            memberships: user.memberships,
            activeOrganizationId: effectiveOrgId,
            role: effectiveRole,
            isSuperAdmin: Boolean(user.isSuperAdmin),
          }
        });
      } else {
        response = Response.json({ error: 'NOT_FOUND', message: `Route not found: ${url.pathname}` }, { status: 404 });
      }

      return addCorsAndSecurityHeaders(response, validatedOrigin);
    } catch (err: any) {
      const isDev = environment === 'development' || environment === 'test';

      if (isDev) {
        SafeLogger.error('[WORKER_FATAL_ERROR]', {
          route: url.pathname,
          method: request.method,
          errorType: err?.name || 'Error',
          message: err?.message,
          stack: err?.stack,
        });
      } else {
        // In production/preview: NEVER log raw err.message or stack trace which could contain sensitive user input / SQL
        SafeLogger.error('[WORKER_FATAL_ERROR]', {
          route: url.pathname,
          method: request.method,
          errorType: err?.name || 'InternalError',
          safeErrorCode: 'ERR_WORKER_INTERNAL',
        });
      }

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
