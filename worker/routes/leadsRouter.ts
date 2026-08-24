/**
 * @file leadsRouter.ts
 * @description Server-Side Tenant-Guarded Leads API Handler
 */

import { AuthenticatedUser } from '../auth/authContext';
import { TenantGuard } from '../middleware/tenantGuard';
import { LeadRepository } from '../repositories/leadRepository';

export async function handleLeadsRoute(
  req: Request,
  user: AuthenticatedUser | null,
  url: URL,
  db: D1Database
): Promise<Response> {
  const orgId = url.searchParams.get('orgId') || 'org_apex_holding';
  const businessId = url.searchParams.get('businessId') || undefined;

  const repo = new LeadRepository(db);

  // 1. GET /api/leads - List Leads
  if (req.method === 'GET') {
    const auth = TenantGuard.authorize(user, orgId, 'leads.read');
    if (!auth.authorized) {
      return Response.json({ error: auth.errorMessage }, { status: auth.statusCode });
    }

    const leads = await repo.listByOrg(orgId, businessId);
    return Response.json({ data: leads, orgId });
  }

  // 2. POST /api/leads - Create Lead
  if (req.method === 'POST') {
    const auth = TenantGuard.authorize(user, orgId, 'leads.create');
    if (!auth.authorized) {
      return Response.json({ error: auth.errorMessage }, { status: auth.statusCode });
    }

    const body = await req.json() as any;
    // organization_id comes from authenticated tenant context, never request body authority
    const newLead = await repo.create(body, orgId);
    return Response.json({ data: newLead, orgId }, { status: 201 });
  }

  // 3. PATCH /api/leads - Update status / dispatch
  if (req.method === 'PATCH') {
    const auth = TenantGuard.authorize(user, orgId, 'leads.dispatch');
    if (!auth.authorized) {
      return Response.json({ error: auth.errorMessage }, { status: auth.statusCode });
    }

    const body = await req.json() as { leadId: string; status: any };
    const updated = await repo.updateStatus(body.leadId, body.status, orgId);
    if (!updated) {
      return Response.json({ error: 'Lead not found or does not belong to your organization.' }, { status: 404 });
    }
    return Response.json({ data: updated, orgId });
  }

  return Response.json({ error: 'Method not allowed' }, { status: 405 });
}
