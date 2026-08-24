/**
 * @file revenueLeaksRouter.ts
 * @description Server-Side Tenant-Guarded Revenue Leaks API Handler
 */

import { AuthenticatedUser } from '../auth/authContext';
import { TenantGuard } from '../middleware/tenantGuard';
import { RevenueLeakRepository } from '../repositories/revenueLeakRepository';

export async function handleRevenueLeaksRoute(
  req: Request,
  user: AuthenticatedUser | null,
  url: URL,
  db?: D1Database
): Promise<Response> {
  const orgId = url.searchParams.get('orgId') || 'org_apex_holding';
  const businessId = url.searchParams.get('businessId') || undefined;

  if (req.method === 'GET') {
    const auth = TenantGuard.authorize(user, orgId, 'leaks.read');
    if (!auth.authorized) {
      return Response.json({ error: auth.errorMessage }, { status: auth.statusCode });
    }

    const leaks = await RevenueLeakRepository.listByOrg(db, orgId, businessId);
    return Response.json({ data: leaks, orgId });
  }

  return Response.json({ error: 'Method not allowed' }, { status: 405 });
}
