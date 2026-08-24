/**
 * @file auditRouter.ts
 * @description Server-Side Immutable Audit Logs API Handler
 */

import { AuthenticatedUser } from '../auth/authContext';
import { TenantGuard } from '../middleware/tenantGuard';
import { AuditRepository } from '../repositories/auditRepository';

export async function handleAuditRoute(
  req: Request,
  user: AuthenticatedUser | null,
  url: URL,
  db?: D1Database,
  environment: string = 'production'
): Promise<Response> {
  const orgId = url.searchParams.get('orgId') || 'org_apex_holding';

  if (req.method === 'GET') {
    const auth = TenantGuard.authorize(user, orgId, 'audit.export');
    if (!auth.authorized) {
      return Response.json({ error: auth.errorMessage }, { status: auth.statusCode });
    }

    const logs = await AuditRepository.listByOrg(db, orgId, 100, environment);
    return Response.json({ data: logs, orgId });
  }

  return Response.json({ error: 'Method not allowed' }, { status: 405 });
}
