/**
 * @file worker/routes/actionPolicyRouter.ts
 * @description Authenticated Tenant Action Policy API Router (Sprint 4 Canonical Policy Contract)
 */

import { D1Database } from '@cloudflare/workers-types';
import { AuthenticatedUser } from '../auth/authContext';
import { TenantGuard } from '../middleware/tenantGuard';
import { BusinessTenantGuard } from '../middleware/businessTenantGuard';
import { ActionPolicyRepository } from '../ai/actions/actionPolicyRepository';
import { SafeLogger } from '../security/safeLogger';
import { AuditIpHasher } from '../security/auditIpHasher';

const ALLOWED_PATCH_FIELDS = new Set([
  'maximumDiscountPercent',
  'maximumAdBudgetMinor',
  'allowedChannels',
  'prohibitedActions',
  'requiresApprovalForOutboundMessaging',
  'requiresApprovalForPriceChanges',
]);

export async function handleActionPolicyRoute(
  request: Request,
  user: AuthenticatedUser | null,
  url: URL,
  db: D1Database | undefined,
  environment: string = 'production',
  auditIpSecret?: string
): Promise<Response> {
  const orgId = url.searchParams.get('orgId')?.trim();
  if (!orgId || orgId.length === 0) {
    return Response.json(
      { error: 'MISSING_TENANT_ID', message: 'Organization ID is required in query parameter orgId.' },
      { status: 400 }
    );
  }

  const rawBizId = url.searchParams.get('businessId')?.trim();
  const businessId = rawBizId && rawBizId.length > 0 ? rawBizId : undefined;

  // GET /api/action-policy
  if (request.method === 'GET') {
    const auth = TenantGuard.authorize(user, orgId, 'settings.read');
    if (!auth.authorized) {
      return Response.json(
        { error: 'FORBIDDEN', message: auth.errorMessage },
        { status: auth.statusCode }
      );
    }

    if (businessId) {
      const bizCheck = await BusinessTenantGuard.verifyBusinessBelongsToOrganization(
        db,
        orgId,
        businessId,
        environment
      );
      if (!bizCheck.valid) {
        return Response.json(
          { error: 'BUSINESS_CROSS_TENANT_FORBIDDEN', message: bizCheck.errorMessage },
          { status: bizCheck.statusCode || 403 }
        );
      }
    }

    try {
      const policy = await ActionPolicyRepository.getPolicy(db, orgId, businessId, environment);
      return Response.json({ data: policy, orgId });
    } catch (err: any) {
      SafeLogger.error('[ACTION_POLICY_ROUTE_GET_ERROR]', {
        organizationId: orgId,
        businessId,
        errorCode: 'ACTION_POLICY_GET_FAILED',
      });
      const isDev = environment === 'development' || environment === 'test';
      return Response.json(
        {
          error: 'ACTION_POLICY_UNAVAILABLE',
          message: isDev ? err?.message : 'Failed to retrieve action policy.',
        },
        { status: 500 }
      );
    }
  }

  // PATCH /api/action-policy
  if (request.method === 'PATCH') {
    const auth = TenantGuard.authorize(user, orgId, 'settings.edit');
    if (!auth.authorized) {
      return Response.json(
        { error: 'FORBIDDEN', message: auth.errorMessage },
        { status: auth.statusCode }
      );
    }

    if (businessId) {
      const bizCheck = await BusinessTenantGuard.verifyBusinessBelongsToOrganization(
        db,
        orgId,
        businessId,
        environment
      );
      if (!bizCheck.valid) {
        return Response.json(
          { error: 'BUSINESS_CROSS_TENANT_FORBIDDEN', message: bizCheck.errorMessage },
          { status: bizCheck.statusCode || 403 }
        );
      }
    }

    const rawBody = await request.json().catch(() => null);
    if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
      return Response.json(
        { error: 'INVALID_PAYLOAD', message: 'Request body must be a valid JSON object.' },
        { status: 400 }
      );
    }
    const body = rawBody as Record<string, any>;

    // Global invariant checks
    if (('humanApprovalRequired' in body && body.humanApprovalRequired === false) ||
        ('autoExecutionEnabled' in body && body.autoExecutionEnabled === true)) {
      return Response.json(
        { error: 'GLOBAL_INVARIANT_VIOLATION', message: 'Human approval cannot be disabled and auto execution cannot be enabled in this phase.' },
        { status: 400 }
      );
    }

    // Strict unknown field checking: Reject unknown fields with 400
    const payloadKeys = Object.keys(body);
    for (const key of payloadKeys) {
      if (!ALLOWED_PATCH_FIELDS.has(key)) {
        return Response.json(
          { error: 'UNKNOWN_FIELDS_REJECTED', message: `Unknown or disallowed field: "${key}". Only canonical action policy fields are permitted.` },
          { status: 400 }
        );
      }
    }

    // Strict validation of maximumDiscountPercent
    if ('maximumDiscountPercent' in body) {
      const val = body.maximumDiscountPercent;
      if (val !== null) {
        if (typeof val !== 'number' || !Number.isFinite(val) || Number.isNaN(val) || val < 0 || val > 100) {
          return Response.json(
            { error: 'INVALID_DISCOUNT_VALUE', message: 'Field "maximumDiscountPercent" must be a finite number between 0 and 100 or null.' },
            { status: 400 }
          );
        }
      }
    }

    // Strict validation of maximumAdBudgetMinor
    if ('maximumAdBudgetMinor' in body) {
      const val = body.maximumAdBudgetMinor;
      if (val !== null) {
        if (typeof val !== 'number' || !Number.isFinite(val) || Number.isNaN(val) || !Number.isSafeInteger(val) || val < 0) {
          return Response.json(
            { error: 'INVALID_BUDGET_VALUE', message: 'Field "maximumAdBudgetMinor" must be a non-negative safe integer or null.' },
            { status: 400 }
          );
        }
      }
    }

    // Strict validation of allowedChannels
    if ('allowedChannels' in body) {
      const val = body.allowedChannels;
      if (val !== null) {
        if (!Array.isArray(val) || !val.every(item => typeof item === 'string' && item.trim().length > 0 && item === item.trim())) {
          return Response.json(
            { error: 'INVALID_ARRAY_VALUE', message: 'Field "allowedChannels" must be null or an array of non-empty trimmed strings.' },
            { status: 400 }
          );
        }
        if (new Set(val).size !== val.length) {
          return Response.json(
            { error: 'DUPLICATE_CHANNELS_REJECTED', message: 'Field "allowedChannels" must contain unique items.' },
            { status: 400 }
          );
        }
      }
    }

    // Strict validation of prohibitedActions
    if ('prohibitedActions' in body) {
      const val = body.prohibitedActions;
      if (!Array.isArray(val) || !val.every(item => typeof item === 'string' && item.trim().length > 0 && item === item.trim())) {
        return Response.json(
          { error: 'INVALID_ARRAY_VALUE', message: 'Field "prohibitedActions" must be an array of non-empty trimmed strings.' },
          { status: 400 }
        );
      }
      if (new Set(val).size !== val.length) {
        return Response.json(
          { error: 'DUPLICATE_ACTIONS_REJECTED', message: 'Field "prohibitedActions" must contain unique items.' },
          { status: 400 }
        );
      }
    }

    // Strict validation of boolean flags
    if ('requiresApprovalForOutboundMessaging' in body) {
      if (typeof body.requiresApprovalForOutboundMessaging !== 'boolean') {
        return Response.json(
          { error: 'INVALID_BOOLEAN_VALUE', message: 'Field "requiresApprovalForOutboundMessaging" must be a boolean.' },
          { status: 400 }
        );
      }
    }

    if ('requiresApprovalForPriceChanges' in body) {
      if (typeof body.requiresApprovalForPriceChanges !== 'boolean') {
        return Response.json(
          { error: 'INVALID_BOOLEAN_VALUE', message: 'Field "requiresApprovalForPriceChanges" must be a boolean.' },
          { status: 400 }
        );
      }
    }

    if (!auth.role) {
      return Response.json(
        { error: 'ACTOR_ROLE_REQUIRED', message: 'Actor role must be verified to update action policy.' },
        { status: 403 }
      );
    }

    try {
      const rawIp = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'UNKNOWN';
      const ipHash = await AuditIpHasher.hashIp(rawIp, auditIpSecret, environment);

      const { policy: savedPolicy } = await ActionPolicyRepository.savePolicyWithAudit(
        db,
        {
          ...body,
          organizationId: orgId,
          businessId: businessId || null,
        },
        {
          actorUserId: user?.userId || 'usr_unknown',
          actorRole: auth.role,
          action: 'ACTION_POLICY_UPDATED',
          ipHash,
          diff: {
            updatedFields: Object.keys(body),
            effectiveScope: businessId ? 'business' : 'organization',
            businessId: businessId || null,
          },
        },
        environment
      );

      return Response.json({ data: savedPolicy, orgId });
    } catch (err: any) {
      SafeLogger.error('[ACTION_POLICY_ROUTE_PATCH_ERROR]', {
        organizationId: orgId,
        businessId,
        errorCode: 'ACTION_POLICY_PATCH_FAILED',
      });
      const isDev = environment === 'development' || environment === 'test';
      return Response.json(
        {
          error: 'ACTION_POLICY_PERSISTENCE_FAILED',
          message: isDev ? err?.message : 'Failed to save action policy.',
        },
        { status: 500 }
      );
    }
  }

  return Response.json(
    { error: 'METHOD_NOT_ALLOWED', message: `Method ${request.method} is not supported.` },
    { status: 405 }
  );
}
