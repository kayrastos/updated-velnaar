/**
 * @file bootstrapRouter.ts
 * @description Server-Authoritative Multi-Tenant Bootstrap API Handler
 * 
 * ============================================================================
 * ARCHITECTURAL MANDATES:
 * 1. Strict tenant boundary: TenantGuard.authorize(user, orgId, 'actions.read')
 * 2. Return canonical OrganizationRow and BusinessRow[]
 * 3. Never invent synthetic metadata on the client
 * ============================================================================
 */

import { AuthenticatedUser } from '../auth/authContext';
import { TenantGuard } from '../middleware/tenantGuard';
import { OrganizationRepository } from '../repositories/organizationRepository';

export async function handleBootstrapRoute(
  req: Request,
  user: AuthenticatedUser | null,
  url: URL,
  db?: D1Database,
  environment: string = 'production'
): Promise<Response> {
  if (req.method !== 'GET') {
    return Response.json({ error: 'METHOD_NOT_ALLOWED', message: `Method ${req.method} not allowed.` }, { status: 405 });
  }

  const orgId = url.searchParams.get('orgId')?.trim() || req.headers.get('X-Tenant-Id')?.trim();
  if (!orgId) {
    return Response.json({
      error: 'TENANT_ID_REQUIRED',
      message: 'Organization ID is required and must be explicitly specified in query parameter orgId or header X-Tenant-Id.',
    }, { status: 400 });
  }

  const auth = TenantGuard.authorize(user, orgId, 'actions.read');
  if (!auth.authorized) {
    return Response.json({
      error: 'CROSS_TENANT_ACCESS_DENIED',
      message: auth.errorMessage,
    }, { status: auth.statusCode });
  }

  const bootstrapData = await OrganizationRepository.getBootstrapData(db, orgId, environment);
  if (!bootstrapData) {
    return Response.json({
      error: 'ORGANIZATION_NOT_FOUND',
      message: `Organization [${orgId}] does not exist.`,
    }, { status: 404 });
  }

  return Response.json({
    data: bootstrapData,
    orgId,
  });
}
