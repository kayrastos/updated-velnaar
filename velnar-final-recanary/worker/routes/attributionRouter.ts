/**
 * @file attributionRouter.ts
 * @description Server-Side Tenant-Guarded Multi-Touch Attribution API Handler
 */

import { AuthenticatedUser } from '../auth/authContext';
import { TenantGuard } from '../middleware/tenantGuard';
import { BusinessTenantGuard } from '../middleware/businessTenantGuard';
import { AttributionRepository } from '../repositories/attributionRepository';

export async function handleAttributionRoute(
  req: Request,
  user: AuthenticatedUser | null,
  url: URL,
  db?: D1Database,
  environment: string = 'production'
): Promise<Response> {
  const orgId = url.searchParams.get('orgId')?.trim() || req.headers.get('X-Tenant-Id')?.trim();
  if (!orgId) {
    return Response.json({
      error: 'TENANT_ID_REQUIRED',
      message: 'Organization ID is required and must be explicitly specified.',
    }, { status: 400 });
  }

  const rawBizId = url.searchParams.get('businessId')?.trim();
  const businessId = rawBizId && rawBizId.length > 0 ? rawBizId : undefined;

  if (businessId) {
    const bizCheck = await BusinessTenantGuard.verifyBusinessBelongsToOrganization(
      db,
      orgId,
      businessId,
      environment
    );
    if (!bizCheck.valid) {
      return Response.json({
        error: 'BUSINESS_CROSS_TENANT_FORBIDDEN',
        message: bizCheck.errorMessage,
      }, { status: bizCheck.statusCode || 403 });
    }
  }

  if (req.method === 'GET') {
    const auth = TenantGuard.authorize(user, orgId, 'attribution.read');
    if (!auth.authorized) {
      return Response.json({ error: auth.errorMessage }, { status: auth.statusCode });
    }

    const results = await AttributionRepository.listResultsByOrg(db, orgId, businessId, environment);
    return Response.json({ data: results, orgId });
  }

  return Response.json({ error: 'Method not allowed' }, { status: 405 });
}
