/**
 * @file revenueLeaksRouter.ts
 * @description Server-Side Tenant-Guarded Revenue Leaks API Handler
 */

import { AuthenticatedUser } from '../auth/authContext';
import { TenantGuard } from '../middleware/tenantGuard';
import { BusinessTenantGuard } from '../middleware/businessTenantGuard';
import { RevenueLeakRepository } from '../repositories/revenueLeakRepository';

export async function handleRevenueLeaksRoute(
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
    const auth = TenantGuard.authorize(user, orgId, 'leaks.read');
    if (!auth.authorized) {
      return Response.json({ error: auth.errorMessage }, { status: auth.statusCode });
    }

    const pathSuffix = url.pathname.replace('/api/leaks', '').replace(/^\//, '').trim();
    if (pathSuffix && pathSuffix.length > 0) {
      const leakId = pathSuffix.split('/')[0];
      const leak = businessId
        ? await RevenueLeakRepository.getById(db, leakId, orgId, businessId, environment)
        : await RevenueLeakRepository.getByIdOrgWide(db, leakId, orgId, environment);
      if (!leak) {
        return Response.json({
          error: 'LEAK_NOT_FOUND',
          message: 'Revenue leak not found or does not belong to authorized tenant.',
        }, { status: 404 });
      }
      return Response.json({ data: leak, orgId });
    }

    const leaks = await RevenueLeakRepository.listByOrg(db, orgId, businessId, environment);
    return Response.json({ data: leaks, orgId });
  }

  return Response.json({ error: 'Method not allowed' }, { status: 405 });
}
