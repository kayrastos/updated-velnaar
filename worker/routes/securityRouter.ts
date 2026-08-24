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
  env?: { ENVIRONMENT?: string }
): Promise<Response> {
  const orgId = url.searchParams.get('orgId') || 'org_apex_holding';

  // GET /api/security/events
  if (req.method === 'GET' && url.pathname.includes('/events')) {
    const auth = TenantGuard.authorize(user, orgId, 'security.read');
    if (!auth.authorized) {
      return Response.json({ error: auth.errorMessage }, { status: auth.statusCode });
    }

    const events = SecurityPipeline.listEventsByOrg(orgId);
    return Response.json({ data: events, orgId });
  }

  // GET /api/security/tests - Automated Executable Test Runner (Owner/Admin or development runner)
  if (req.method === 'GET' && url.pathname.includes('/tests')) {
    const auth = TenantGuard.authorize(user, orgId, 'security.read');
    if (!auth.authorized) {
      return Response.json({ error: auth.errorMessage }, { status: auth.statusCode });
    }

    const testResults = await SecurityTestSuite.runSuite(db, masterSecret, env);
    return Response.json({ data: testResults, orgId });
  }

  return Response.json({ error: 'Endpoint not found' }, { status: 404 });
}
