/**
 * @file worker/routes/aiRouter.ts
 * @description Server-Side Cloudflare Worker Routes for VELNAR AI Layer (/api/ai/*) (Sprint 4 Hardened)
 */

import { AuthenticatedUser } from '../auth/authContext';
import { TenantGuard } from '../middleware/tenantGuard';
import { BusinessTenantGuard } from '../middleware/businessTenantGuard';
import { AIRouter } from '../ai/aiRouter';
import { ActionDraftEngine, DraftActionInput } from '../ai/actions/actionDraftEngine';
import { ActionPolicyEngine } from '../ai/actions/actionPolicyEngine';
import { ActionPolicyRepository } from '../ai/actions/actionPolicyRepository';
import { AIRunRepository } from '../ai/aiRunRepository';
import { RevenueLeakRepository } from '../repositories/revenueLeakRepository';
import { RevenueLeakEvidence } from '../repositories/revenueLeakEvidence';
import { AIRequestEnvelope } from '../ai/types';
import { WorkerEnv } from '../env';
import { SafeLogger } from '../security/safeLogger';

function mapSafeAIErrorResponse(err: any): Response {
  const msg = err?.message || '';

  if (msg.includes('BUSINESS_CROSS_TENANT_FORBIDDEN')) {
    return Response.json({
      error: 'BUSINESS_CROSS_TENANT_FORBIDDEN',
      message: msg,
    }, { status: 403 });
  }
  if (msg.includes('ACTION_POLICY_UNAVAILABLE')) {
    return Response.json({
      error: 'ACTION_POLICY_UNAVAILABLE',
      message: 'Action policy is unavailable or could not be loaded from database.',
    }, { status: 503 });
  }
  if (msg.includes('AI_UNAVAILABLE') || msg.includes('PROVIDER_NOT_CONFIGURED') || msg.includes('MODEL_NOT_CONFIGURED')) {
    return Response.json({ error: 'AI_UNAVAILABLE', message: 'Requested AI service is currently unavailable or unconfigured.' }, { status: 503 });
  }
  if (msg.includes('AI_BUDGET_EXCEEDED')) {
    return Response.json({ error: 'AI_BUDGET_EXCEEDED', message: msg }, { status: 429 });
  }
  if (msg.includes('AI_POLICY_DISABLED')) {
    return Response.json({ error: 'AI_POLICY_DISABLED', message: 'External AI processing is disabled for this organization.' }, { status: 403 });
  }
  if (msg.includes('PRIVACY_VIOLATION')) {
    return Response.json({ error: 'PRIVACY_VIOLATION', message: 'Input payload contains data classification unsafe for external processing.' }, { status: 422 });
  }
  if (msg.includes('PROHIBITED_AI_OPERATION')) {
    return Response.json({ error: 'PROHIBITED_AI_OPERATION', message: 'Requested operation is strictly prohibited from AI execution.' }, { status: 400 });
  }
  if (msg.includes('INVALID_EVIDENCE_REFERENCE')) {
    return Response.json({ error: 'INVALID_EVIDENCE_REFERENCE', message: msg }, { status: 422 });
  }
  if (msg.includes('NO_EVIDENCE_CLAIM')) {
    return Response.json({ error: 'NO_EVIDENCE_CLAIM', message: 'Growth action drafting requires valid evidence citations.' }, { status: 422 });
  }
  if (msg.includes('AI_PRICING_NOT_CONFIGURED')) {
    return Response.json({ error: 'AI_PRICING_NOT_CONFIGURED', message: 'AI pricing tier is not configured for requested model.' }, { status: 500 });
  }
  if (msg.includes('MALFORMED_AI_OUTPUT')) {
    return Response.json({ error: 'MALFORMED_AI_OUTPUT', message: 'AI model returned malformed output that failed validation.' }, { status: 502 });
  }
  if (msg.includes('VIOLATION_AUTONOMOUS_EXECUTION_PROHIBITED')) {
    return Response.json({ error: 'VIOLATION_AUTONOMOUS_EXECUTION_PROHIBITED', message: 'Autonomous execution is prohibited. Actions must require human approval.' }, { status: 422 });
  }
  if (msg.includes('DATABASE_NOT_CONFIGURED')) {
    return Response.json({ error: 'DATABASE_NOT_CONFIGURED', message: 'D1 Database is required in production.' }, { status: 503 });
  }

  return Response.json({ error: 'AI_EXECUTION_FAILED', message: 'An internal error occurred during AI processing.' }, { status: 500 });
}

export async function handleAiRoute(
  req: Request,
  user: AuthenticatedUser | null,
  url: URL,
  env: WorkerEnv
): Promise<Response> {
  // Extract explicit organizationId from query params or POST body without any fallbacks
  let orgId = url.searchParams.get('orgId')?.trim() || '';

  if (!orgId && req.method === 'POST') {
    try {
      const cloned = req.clone();
      const body = (await cloned.json()) as any;
      if (body && typeof body.organizationId === 'string' && body.organizationId.trim()) {
        orgId = body.organizationId.trim();
      }
    } catch {
      // ignore json parse error on clone
    }
  }

  // 0. Strict Tenant Guard: AI routes must NEVER guess a tenant or use fallbacks
  if (!orgId) {
    return Response.json({
      error: 'TENANT_ID_REQUIRED',
      message: 'Organization ID is required and must be explicitly specified.',
    }, { status: 400 });
  }

  // 1. GET /api/ai/status - Tenant-scoped Capability Discovery
  if (req.method === 'GET' && url.pathname === '/api/ai/status') {
    const auth = TenantGuard.authorize(user, orgId, 'actions.read');
    if (!auth.authorized) {
      return Response.json({ error: auth.errorMessage }, { status: auth.statusCode });
    }

    try {
      const status = await AIRouter.getStatus(orgId, env);
      return Response.json({ data: status, orgId });
    } catch (err: any) {
      return mapSafeAIErrorResponse(err);
    }
  }

  // 2. GET /api/ai/runs - List AI runs strictly scoped by organization and business
  if (req.method === 'GET' && url.pathname === '/api/ai/runs') {
    const auth = TenantGuard.authorize(user, orgId, 'actions.read');
    if (!auth.authorized) {
      return Response.json({ error: auth.errorMessage }, { status: auth.statusCode });
    }

    const businessId = url.searchParams.get('businessId')?.trim();
    if (!businessId || businessId.length === 0) {
      return Response.json({
        error: 'BUSINESS_ID_REQUIRED',
        message: 'Business ID is required and must be explicitly specified.',
      }, { status: 400 });
    }

    const bizCheck = await BusinessTenantGuard.verifyBusinessBelongsToOrganization(
      env.DB,
      orgId,
      businessId,
      env.ENVIRONMENT
    );
    if (!bizCheck.valid) {
      return Response.json({
        error: 'BUSINESS_CROSS_TENANT_FORBIDDEN',
        message: bizCheck.errorMessage,
      }, { status: bizCheck.statusCode || 403 });
    }

    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const runs = await AIRunRepository.listRunsByBusiness(env.DB, orgId, businessId, limit, env.ENVIRONMENT);
    return Response.json({ data: runs, orgId, businessId });
  }

  // 3. POST /api/ai/run - Execute task envelope
  if (req.method === 'POST' && url.pathname === '/api/ai/run') {
    const auth = TenantGuard.authorize(user, orgId, 'actions.read');
    if (!auth.authorized) {
      return Response.json({ error: auth.errorMessage }, { status: auth.statusCode });
    }

    const body = (await req.json()) as AIRequestEnvelope;
    if (!body || !body.taskType) {
      return Response.json({ error: 'INVALID_REQUEST', message: 'Missing taskType in request envelope.' }, { status: 400 });
    }

    // Ensure envelope is strictly scoped to authorized org
    body.organizationId = orgId;

    if (body.businessId) {
      const bizCheck = await BusinessTenantGuard.verifyBusinessBelongsToOrganization(
        env.DB,
        orgId,
        body.businessId,
        env.ENVIRONMENT
      );
      if (!bizCheck.valid) {
        return Response.json({ error: 'BUSINESS_CROSS_TENANT_FORBIDDEN', message: bizCheck.errorMessage }, { status: bizCheck.statusCode || 403 });
      }
    }

    try {
      const execution = await AIRouter.execute(body, env);
      return Response.json({
        data: execution.result,
        runRecord: execution.runRecord,
        isMock: execution.isMock,
        orgId,
      });
    } catch (err: any) {
      return mapSafeAIErrorResponse(err);
    }
  }

  // 4. POST /api/ai/actions/draft - Draft a Growth Action from Revenue Leak Evidence
  if (req.method === 'POST' && url.pathname === '/api/ai/actions/draft') {
    const auth = TenantGuard.authorize(user, orgId, 'actions.read');
    if (!auth.authorized) {
      return Response.json({ error: auth.errorMessage }, { status: auth.statusCode });
    }

    const body = (await req.json().catch(() => null)) as Record<string, any> | null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return Response.json({
        error: 'BAD_REQUEST',
        message: 'Request body must be a valid JSON object.',
      }, { status: 400 });
    }

    const allowedKeys = new Set(['businessId', 'leakId']);
    const extraKeys = Object.keys(body).filter(k => !allowedKeys.has(k));
    if (extraKeys.length > 0) {
      return Response.json({
        error: 'BAD_REQUEST',
        message: `Disallowed properties in draft request: ${extraKeys.join(', ')}. Only businessId and leakId are permitted.`,
      }, { status: 400 });
    }

    const leakId = body.leakId;
    const businessId = body.businessId;

    if (!leakId || typeof leakId !== 'string' || leakId.trim().length === 0) {
      return Response.json({
        error: 'BAD_REQUEST',
        message: 'leakId is required and must be a non-empty string.',
      }, { status: 400 });
    }

    if (!businessId || typeof businessId !== 'string' || businessId.trim().length === 0) {
      return Response.json({
        error: 'BAD_REQUEST',
        message: 'businessId is required and must be a non-empty string.',
      }, { status: 400 });
    }

    const bizCheck = await BusinessTenantGuard.verifyBusinessBelongsToOrganization(
      env.DB,
      orgId,
      businessId,
      env.ENVIRONMENT
    );
    if (!bizCheck.valid) {
      return Response.json({ error: 'BUSINESS_CROSS_TENANT_FORBIDDEN', message: bizCheck.errorMessage }, { status: bizCheck.statusCode || 403 });
    }

    const leak = await RevenueLeakRepository.getById(env.DB, leakId, orgId, businessId, env.ENVIRONMENT);
    if (!leak) {
      return Response.json({
        error: 'NO_EVIDENCE_CLAIM',
        message: `Revenue leak [${leakId}] not found for organization [${orgId}] and business [${businessId}]. Cannot generate action without verified evidence.`,
      }, { status: 422 });
    }

    const canonicalEvidenceIds = RevenueLeakEvidence.getCanonicalEvidenceReferences(leak);
    const draftInput: DraftActionInput = {
      organizationId: orgId,
      businessId,
      leakId: leak.id,
      leakTitle: leak.title,
      leakCategory: leak.category,
      severity: leak.severity,
      estimatedMonthlyLossMinor: leak.estimated_monthly_loss_minor,
      rootCause: leak.root_cause,
      affectedFunnelStage: leak.affected_funnel_stage,
      evidenceIds: canonicalEvidenceIds,
      observedFacts: [
        `Revenue Leak Title: ${leak.title}`,
        `Leak Category: ${leak.category}`,
        `Severity Level: ${leak.severity}`,
        `Affected Funnel Stage: ${leak.affected_funnel_stage}`,
        `Deterministic Root Cause: ${leak.root_cause}`,
        `Estimated Monthly Loss: ${leak.estimated_monthly_loss_minor} minor units`,
      ],
    };

    try {
      const draftOutput = await ActionDraftEngine.draftActionFromLeak(draftInput, env);
      return Response.json({
        data: draftOutput.actionDraft,
        guardrailResult: draftOutput.guardrailResult,
        runId: draftOutput.runId,
        runRecord: draftOutput.runRecord,
        isMock: draftOutput.isMock,
        orgId,
      });
    } catch (err: any) {
      return mapSafeAIErrorResponse(err);
    }
  }

  // 5. POST /api/ai/actions/verify-policy - Deterministic Policy Guardrail Validation
  if (req.method === 'POST' && url.pathname === '/api/ai/actions/verify-policy') {
    const auth = TenantGuard.authorize(user, orgId, 'actions.read');
    if (!auth.authorized) {
      return Response.json({ error: auth.errorMessage }, { status: auth.statusCode });
    }

    const payload = (await req.json().catch(() => null)) as Record<string, any> | null;
    if (!payload || typeof payload !== 'object') {
      return Response.json({ error: 'INVALID_PAYLOAD', message: 'Payload must be a JSON object.' }, { status: 400 });
    }

    const rawBizId = url.searchParams.get('businessId')?.trim() || payload?.businessId || payload?.business_id;
    const businessId = rawBizId && typeof rawBizId === 'string' ? rawBizId.trim() : undefined;

    if (!businessId || businessId.length === 0) {
      return Response.json({
        error: 'BUSINESS_ID_REQUIRED',
        message: 'businessId is required for policy verification.',
      }, { status: 400 });
    }

    const bizCheck = await BusinessTenantGuard.verifyBusinessBelongsToOrganization(
      env.DB,
      orgId,
      businessId,
      env.ENVIRONMENT
    );
    if (!bizCheck.valid) {
      return Response.json({ error: 'BUSINESS_CROSS_TENANT_FORBIDDEN', message: bizCheck.errorMessage }, { status: bizCheck.statusCode || 403 });
    }

    try {
      const tenantPolicy = await ActionPolicyRepository.getPolicy(env.DB, orgId, businessId, env.ENVIRONMENT);
      const result = ActionPolicyEngine.validate(payload, tenantPolicy);
      return Response.json({ data: result, orgId, businessId });
    } catch (err: any) {
      SafeLogger.error('[VERIFY_POLICY_FAILED]', {
        organizationId: orgId,
        businessId,
        errorCode: 'ACTION_POLICY_UNAVAILABLE',
      });
      return Response.json({
        error: 'ACTION_POLICY_UNAVAILABLE',
        message: 'Action policy could not be retrieved from database for verification.',
      }, { status: 503 });
    }
  }

  // 6. POST /api/ai/policy - Update tenant AI policy
  if (req.method === 'POST' && url.pathname === '/api/ai/policy') {
    const auth = TenantGuard.authorize(user, orgId, 'settings.edit');
    if (!auth.authorized) {
      return Response.json({ error: auth.errorMessage }, { status: auth.statusCode });
    }

    const body = (await req.json()) as any;
    try {
      const updated = await AIRouter.updateOrganizationPolicy({
        ...body,
        organizationId: orgId,
      }, env.ENVIRONMENT, env.DB);
      return Response.json({ data: updated, orgId });
    } catch (err: any) {
      return mapSafeAIErrorResponse(err);
    }
  }

  return Response.json({ error: 'Method not allowed or route not found' }, { status: 404 });
}
