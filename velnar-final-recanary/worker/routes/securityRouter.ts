/**
 * @file securityRouter.ts
 * @description Server-Side Security Events, Cross-Tenant Test Runner & Audit API Handler
 * 
 * ============================================================================
 * ARCHITECTURAL MANDATES:
 * 1. ZERO frontend imports.
 * 2. Runs verified cryptographic, RBAC, and tenant boundary tests.
 * ============================================================================
 */

import { AuthenticatedUser } from '../auth/authContext';
import { TenantGuard } from '../middleware/tenantGuard';
import { SecurityPipeline } from '../security/securityPipeline';
import { SecurityTestSuite } from '../security/securityTestSuite';

export async function handleSecurityRoute(
  req: Request,
  user: AuthenticatedUser | null,
  url: URL,
  db?: D1Database,
  masterSecret?: string,
  environment: string = 'production'
): Promise<Response> {
  const orgId = url.searchParams.get('orgId')?.trim() || req.headers.get('X-Tenant-Id')?.trim();
  if (!orgId) {
    return Response.json({
      error: 'TENANT_ID_REQUIRED',
      message: 'Organization ID is required and must be explicitly specified.',
    }, { status: 400 });
  }

  // GET /api/security/events
  if (req.method === 'GET' && url.pathname.includes('/events')) {
    const auth = TenantGuard.authorize(user, orgId, 'security.read');
    if (!auth.authorized) {
      return Response.json({ error: auth.errorMessage }, { status: auth.statusCode });
    }

    const events = SecurityPipeline.listEventsByOrg(orgId);
    return Response.json({
      data: events,
      orgId,
      streamType: 'EPHEMERAL_RUNTIME_TELEMETRY',
      isPersistent: false,
    });
  }

  // GET /api/security/tests - Automated Executable Test Runner (Dev / Test Only)
  if (req.method === 'GET' && url.pathname.includes('/tests')) {
    if (environment === 'production') {
      return Response.json({
        error: 'DEV_ENDPOINT_DISABLED',
        message: 'Security test suite is disabled in production.',
      }, { status: 404 });
    }

    const auth = TenantGuard.authorize(user, orgId, 'security.read');
    if (!auth.authorized) {
      return Response.json({ error: auth.errorMessage }, { status: auth.statusCode });
    }

    const testResults = await SecurityTestSuite.runSuite(db, masterSecret, environment);
    return Response.json({ data: testResults, orgId });
  }

  return Response.json({ error: 'Endpoint not found' }, { status: 404 });
}
