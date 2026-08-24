/**
 * @file tenantGuard.ts
 * @description Server-Side Tenant Boundary & Canonical RBAC Authorization Guard
 * 
 * ============================================================================
 * CRITICAL RULE:
 * The React frontend must NEVER decide whether a user may access another tenant's resource.
 * All queries and mutations are authorized and scoped server-side.
 * Never trust organizationId or businessId supplied by browser input.
 * ============================================================================
 */

import { AuthenticatedUser, ResourceAction, AuthContextService } from '../auth/authContext';
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
    user: AuthenticatedUser,
    targetOrgId: string,
    action: ResourceAction,
    sourceIpHash: string = '127.0.0.1_local'
  ): AuthorizationResult {
    // 1. Validate Organization Membership
    const membership = user.memberships.find(m => m.organizationId === targetOrgId);

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
          userOrgs: user.memberships.map(m => m.organizationId),
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

    const effectiveRole: UserRole = user.isSuperAdmin ? 'OWNER' : (membership?.role || 'VIEWER');

    // 2. Validate RBAC Action Permission
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
