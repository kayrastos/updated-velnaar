/**
 * @file growthActionsRouter.ts
 * @description Server-Side Tenant-Guarded Growth Actions & Proof Results API Handler
 */

import { AuthenticatedUser } from '../auth/authContext';
import { TenantGuard } from '../middleware/tenantGuard';
import { GrowthActionRepository } from '../repositories/growthActionRepository';

export async function handleGrowthActionsRoute(
  req: Request,
  user: AuthenticatedUser | null,
  url: URL,
  db?: D1Database
): Promise<Response> {
  const orgId = url.searchParams.get('orgId') || 'org_apex_holding';
  const businessId = url.searchParams.get('businessId') || undefined;

  // GET /api/actions or /api/proof
  if (req.method === 'GET') {
    const isProofRequest = url.pathname.includes('/proof') || url.searchParams.get('type') === 'results';
    const actionPerm = isProofRequest ? 'proof.read' : 'actions.read';

    const auth = TenantGuard.authorize(user, orgId, actionPerm);
    if (!auth.authorized) {
      return Response.json({ error: auth.errorMessage }, { status: auth.statusCode });
    }

    if (isProofRequest) {
      const results = await GrowthActionRepository.listResultsByOrg(db, orgId, businessId);
      return Response.json({ data: results, orgId });
    }

    const actions = await GrowthActionRepository.listActionsByOrg(db, orgId, businessId);
    return Response.json({ data: actions, orgId });
  }

  // POST /api/actions - Approve / Reject
  if (req.method === 'POST') {
    const body = await req.json() as { actionId: string; status: 'approved' | 'rejected' | 'deferred' };
    const requiredPerm = body.status === 'approved' ? 'actions.approve' : 'actions.reject';

    const auth = TenantGuard.authorize(user, orgId, requiredPerm);
    if (!auth.authorized || !user) {
      return Response.json({ error: auth.errorMessage }, { status: auth.statusCode });
    }

    const updated = await GrowthActionRepository.updateActionApproval(db, body.actionId, body.status, user.userId, orgId);
    if (!updated) {
      return Response.json({ error: 'Action not found or does not belong to your organization.' }, { status: 404 });
    }

    return Response.json({ data: updated, orgId });
  }

  return Response.json({ error: 'Method not allowed' }, { status: 405 });
}
