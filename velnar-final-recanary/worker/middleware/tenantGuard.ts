/**
 * @file tenantGuard.ts
 * @description Server-Side Tenant Boundary & Canonical RBAC Authorization Guard
 * 
 * ============================================================================
 * CRITICAL ARCHITECTURAL RULES:
 * 1. The React frontend must NEVER decide whether a user may access another tenant's resource.
 * 2. All queries and mutations are authorized and scoped server-side.
 * 3. Never trust organizationId or businessId supplied by browser input.
 * 4. Fail-closed: Unauthenticated requests return 401; cross-tenant or unauthorized return 403.
 * ============================================================================
 */

import { AuthenticatedUser, ResourceAction, AuthContextService, isValidUserRole } from '../auth/authContext';
import { SecurityPipeline } from '../security/securityPipeline';
import { UserRole } from '../../src/types/database';

export interface AuthorizationResult {
  authorized: boolean;
  statusCode: number;
  organizationId?: string;
  role?: UserRole;
  errorMessage?: string;
}

export class TenantGuard {
  /**
   * Authorize a request against the target organization and required resource action.
   */
  public static authorize(
    user: AuthenticatedUser | null | undefined,
    targetOrgId: string,
    action: ResourceAction,
    sourceIpHash: string = 'UNKNOWN'
  ): AuthorizationResult {
    // 1. Authentication Check
    if (!user) {
      return {
        authorized: false,
        statusCode: 401,
        errorMessage: 'UNAUTHENTICATED: Valid session or bearer authorization token is required.'
      };
    }

    // 2. Validate Organization Membership
    const membership = user.memberships?.find(m => m.organizationId === targetOrgId);

    if (!membership && !user.isSuperAdmin) {
      // Record Cross-Tenant Boundary Violation
      SecurityPipeline.recordEvent({
        organizationId: targetOrgId,
        eventType: 'cross_tenant_access.denied',
        severity: 'CRITICAL',
        sourceIpHash,
        actorUserId: user.userId,
        details: {
          attemptedOrgTarget: targetOrgId,
          userOrgs: user.memberships?.map(m => m.organizationId) || [],
          requestedAction: action,
        },
        enforcementAction: 'BLOCKED_IMMEDIATELY',
      });

      return {
        authorized: false,
        statusCode: 403,
        errorMessage: `CROSS_TENANT_ACCESS_DENIED: User [${user.userId}] has no active membership in organization [${targetOrgId}].`
      };
    }

    if (membership && membership.status !== 'active') {
      return {
        authorized: false,
        statusCode: 403,
        errorMessage: `MEMBERSHIP_SUSPENDED: Organization membership for user [${user.userId}] is currently [${membership.status}].`
      };
    }

    let effectiveRole: UserRole;
    if (user.isSuperAdmin) {
      effectiveRole = 'OWNER';
    } else {
      if (!membership || !membership.role || !isValidUserRole(membership.role)) {
        SecurityPipeline.recordEvent({
          organizationId: targetOrgId,
          eventType: 'authorization.denied',
          severity: 'HIGH',
          sourceIpHash,
          actorUserId: user.userId,
          details: {
            attemptedAction: action,
            rawRole: membership?.role,
            reason: 'INVALID_OR_MISSING_MEMBERSHIP_ROLE'
          },
          enforcementAction: 'BLOCKED_IMMEDIATELY',
        });

        return {
          authorized: false,
          statusCode: 403,
          errorMessage: `AUTHORIZATION_CONTEXT_INVALID: User [${user.userId}] has invalid or missing role in organization [${targetOrgId}].`
        };
      }
      effectiveRole = membership.role;
    }

    // 3. Validate RBAC Action Permission
    const hasPerm = AuthContextService.hasPermission(effectiveRole, action);
    if (!hasPerm) {
      SecurityPipeline.recordEvent({
        organizationId: targetOrgId,
        eventType: 'authorization.denied',
        severity: 'MEDIUM',
        sourceIpHash,
        actorUserId: user.userId,
        details: {
          role: effectiveRole,
          attemptedAction: action,
        },
        enforcementAction: 'BLOCKED_IMMEDIATELY',
      });

      return {
        authorized: false,
        statusCode: 403,
        errorMessage: `INSUFFICIENT_ROLE_PERMISSION: Role [${effectiveRole}] lacks required permission for action [${action}].`
      };
    }

    return {
      authorized: true,
      statusCode: 200,
      organizationId: targetOrgId,
      role: effectiveRole,
    };
  }
}

export { BusinessTenantGuard } from './businessTenantGuard';
export type { BusinessVerificationResult } from './businessTenantGuard';
