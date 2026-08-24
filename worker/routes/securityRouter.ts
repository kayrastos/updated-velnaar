/**
 * @file securityRouter.ts
 * @description Server-Side Security Events, Cross-Tenant Test Runner & Audit API Handler
 */

import { AuthenticatedUser } from '../auth/authContext';
import { TenantGuard } from '../middleware/tenantGuard';
import { SecurityPipeline } from '../security/securityPipeline';
import { TenantSecurityEngine } from '../../src/services/tenantSecurity';

export async function handleSecurityRoute(
  req: Request,
  user: AuthenticatedUser,
  url: URL
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

  // GET /api/security/tests - Automated Executable Test Runner
  if (req.method === 'GET' && url.pathname.includes('/tests')) {
    const testResults = TenantSecurityEngine.runCrossTenantTests();
    return Response.json({ data: testResults });
  }

  return Response.json({ error: 'Endpoint not found' }, { status: 404 });
}
