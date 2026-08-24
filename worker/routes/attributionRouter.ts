/**
 * @file attributionRouter.ts
 * @description Server-Side Tenant-Guarded Multi-Touch Attribution API Handler
 */

import { AuthenticatedUser } from '../auth/authContext';
import { TenantGuard } from '../middleware/tenantGuard';
import { AttributionRepository } from '../repositories/attributionRepository';

export async function handleAttributionRoute(
  req: Request,
  user: AuthenticatedUser,
  url: URL
): Promise<Response> {
  const orgId = url.searchParams.get('orgId') || 'org_apex_holding';
  const businessId = url.searchParams.get('businessId') || undefined;

  if (req.method === 'GET') {
    const auth = TenantGuard.authorize(user, orgId, 'attribution.read');
    if (!auth.authorized) {
      return Response.json({ error: auth.errorMessage }, { status: auth.statusCode });
    }

    const results = await AttributionRepository.listResultsByOrg(orgId, businessId);
    return Response.json({ data: results, orgId });
  }

  return Response.json({ error: 'Method not allowed' }, { status: 405 });
}
