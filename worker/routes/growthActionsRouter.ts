/**
 * @file growthActionsRouter.ts
 * @description Server-Side Tenant-Guarded Growth Actions & Proof Results API Handler (Sprint 4 Atomic Hardened)
 */

import { AuthenticatedUser } from '../auth/authContext';
import { TenantGuard } from '../middleware/tenantGuard';
import { BusinessTenantGuard } from '../middleware/businessTenantGuard';
import { GrowthActionRepository } from '../repositories/growthActionRepository';
import { ActionPolicyEngine } from '../ai/actions/actionPolicyEngine';
import { ActionPolicyRepository } from '../ai/actions/actionPolicyRepository';
import { SafeLogger } from '../security/safeLogger';
import { AuditIpHasher } from '../security/auditIpHasher';

export async function handleGrowthActionsRoute(
  req: Request,
  user: AuthenticatedUser | null,
  url: URL,
  db?: D1Database,
  environment: string = 'production',
  auditIpSecret?: string
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

  // Verify business ownership if businessId query param provided
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

  // GET /api/actions or /api/proof
  if (req.method === 'GET') {
    const isProofRequest = url.pathname.includes('/proof') || url.searchParams.get('type') === 'results';
    const actionPerm = isProofRequest ? 'proof.read' : 'actions.read';

    const auth = TenantGuard.authorize(user, orgId, actionPerm);
    if (!auth.authorized) {
      return Response.json({ error: auth.errorMessage }, { status: auth.statusCode });
    }

    if (isProofRequest) {
      const results = await GrowthActionRepository.listResultsByOrg(db, orgId, businessId, environment);
      return Response.json({ data: results, orgId });
    }

    const actions = await GrowthActionRepository.listActionsByOrg(db, orgId, businessId, environment);
    return Response.json({ data: actions, orgId });
  }

  // POST /api/actions - Approve / Reject / Defer
  if (req.method === 'POST') {
    const body = await req.json().catch(() => null) as Record<string, any> | null;
    if (!body || typeof body !== 'object') {
      return Response.json({ error: 'BAD_REQUEST', message: 'Request body must be a JSON object.' }, { status: 400 });
    }

    const allowedKeys = new Set(['actionId', 'status']);
    const extraKeys = Object.keys(body).filter(k => !allowedKeys.has(k));
    if (extraKeys.length > 0) {
      return Response.json({
        error: 'BAD_REQUEST',
        message: `Unknown property in request body: ${extraKeys.join(', ')}. Overriding execution parameters is prohibited.`,
      }, { status: 400 });
    }

    if (!body.actionId || !body.status || !['approved', 'rejected', 'deferred'].includes(body.status)) {
      return Response.json({
        error: 'BAD_REQUEST',
        message: 'Valid actionId and status (approved, rejected, deferred) are required.',
      }, { status: 400 });
    }

    const requiredPerm = body.status === 'approved' ? 'actions.approve' : 'actions.reject';

    const auth = TenantGuard.authorize(user, orgId, requiredPerm);
    if (!auth.authorized || !user) {
      return Response.json({ error: auth.errorMessage }, { status: auth.statusCode });
    }

    if (!auth.role) {
      return Response.json({
        error: 'AUTHORIZATION_CONTEXT_INVALID',
        message: 'Authorization context missing valid role.',
      }, { status: 403 });
    }

    const effectiveRole = auth.role;

    // 1. Load existing action to verify ownership and read stored execution payload
    const existingAction = await GrowthActionRepository.getActionById(db, body.actionId, orgId, environment);
    if (!existingAction) {
      return Response.json({ error: 'NOT_FOUND', message: 'Action not found or does not belong to your organization.' }, { status: 404 });
    }

    // Enforce human-reviewable constraint for approval
    if (body.status === 'approved' && existingAction.requires_approval !== 1) {
      return Response.json({
        error: 'ACTION_NOT_HUMAN_REVIEWABLE',
        message: 'Action cannot be approved because human review is not enabled for this action.',
      }, { status: 400 });
    }

    let guardrailStatus: 'PASSED' | 'FAILED' | 'NOT_EVALUATED' = existingAction.guardrail_status || 'NOT_EVALUATED';

    // 2. If status is 'approved', perform strict server-side policy validation on STORED payload only
    if (body.status === 'approved') {
      let tenantPolicy;
      try {
        tenantPolicy = await ActionPolicyRepository.getPolicy(db, orgId, existingAction.business_id, environment);
      } catch (policyErr: any) {
        SafeLogger.error('[GROWTH_ACTION_APPROVAL_POLICY_FETCH_FAILED]', {
          actionId: body.actionId,
          orgId,
          errorCode: 'ACTION_POLICY_UNAVAILABLE',
        });
        return Response.json({
          error: 'ACTION_POLICY_UNAVAILABLE',
          message: 'Unable to evaluate guardrails because tenant action policy could not be loaded.',
        }, { status: 503 });
      }

      let parsedPayload: Record<string, any> = {};
      try {
        parsedPayload = JSON.parse(existingAction.execution_payload_json || '{}');
      } catch {
        parsedPayload = {};
      }

      const validation = ActionPolicyEngine.validate(parsedPayload, tenantPolicy);

      if (!validation.passed) {
        return Response.json({
          error: 'GUARDRAIL_VIOLATION',
          message: `Guardrail policy evaluation failed: ${validation.violations.join('; ')}`,
          violations: validation.violations,
          guardrailStatus: validation.guardrailStatus,
        }, { status: 422 });
      }

      guardrailStatus = 'PASSED';
    }

    // 3. Atomically commit action status change and immutable audit log
    const rawIp = req.headers.get('CF-Connecting-IP') || req.headers.get('X-Forwarded-For') || 'UNKNOWN';
    const ipHash = await AuditIpHasher.hashIp(rawIp, auditIpSecret, environment);

    try {
      const transitionResult = await GrowthActionRepository.transitionWithAudit(
        db,
        body.actionId,
        body.status,
        user.userId,
        effectiveRole,
        orgId,
        guardrailStatus,
        ipHash,
        environment
      );

      return Response.json({
        success: true,
        data: transitionResult.action,
        orgId,
      });
    } catch (transErr: any) {
      const statusCode = transErr?.statusCode || 500;
      const errorCode = transErr?.errorCode || 'ACTION_TRANSITION_FAILED';
      return Response.json({
        error: errorCode,
        message: transErr?.message || 'Failed to atomically update action and audit trail.',
      }, { status: statusCode });
    }
  }

  return Response.json({ error: 'Method not allowed' }, { status: 405 });
}
