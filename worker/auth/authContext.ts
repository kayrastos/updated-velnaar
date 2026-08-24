/**
 * @file authContext.ts
 * @description Server-Side Authenticated Identity & Canonical Role Permission Matrix (Fail-Closed)
 * 
 * ============================================================================
 * ARCHITECTURAL MANDATES:
 * 1. Fail-closed: If no valid authenticated session/token exists, return null (HTTP 401).
 * 2. Production must NEVER fall back to a demo/default identity.
 * 3. Mock users exist ONLY behind explicit development/test environment checks.
 * 4. Browser-supplied user IDs or roles are NEVER trusted.
 * ============================================================================
 */

import { UserRole } from '../../src/types/database';

export type ResourceAction = 
  | 'leads.read'
  | 'leads.create'
  | 'leads.dispatch'
  | 'appointment.read'
  | 'appointment.create'
  | 'appointment.update'
  | 'appointment.cancel'
  | 'actions.read'
  | 'actions.approve'
  | 'actions.reject'
  | 'proof.read'
  | 'proof.verify'
  | 'events.read'
  | 'leaks.read'
  | 'attribution.read'
  | 'identity_vault.read'
  | 'identity_vault.write'
  | 'settings.read'
  | 'settings.edit'
  | 'security.read'
  | 'security.configure'
  | 'audit.export';

export interface UserMembership {
  organizationId: string;
  role: UserRole;
  status: 'active' | 'invited' | 'suspended';
}

export interface AuthenticatedUser {
  userId: string;
  email: string;
  fullName: string;
  memberships: UserMembership[];
  isSuperAdmin?: boolean;
}

export const CANONICAL_ROLE_PERMISSIONS: Record<UserRole, ResourceAction[]> = {
  OWNER: [
    'leads.read', 'leads.create', 'leads.dispatch',
    'appointment.read', 'appointment.create', 'appointment.update', 'appointment.cancel',
    'actions.read', 'actions.approve', 'actions.reject',
    'proof.read', 'proof.verify',
    'events.read',
    'leaks.read',
    'attribution.read',
    'identity_vault.read', 'identity_vault.write',
    'settings.read', 'settings.edit',
    'security.read', 'security.configure',
    'audit.export'
  ],
  ADMIN: [
    'leads.read', 'leads.create', 'leads.dispatch',
    'appointment.read', 'appointment.create', 'appointment.update', 'appointment.cancel',
    'actions.read', 'actions.approve', 'actions.reject',
    'proof.read', 'proof.verify',
    'events.read',
    'leaks.read',
    'attribution.read',
    'settings.read', 'settings.edit',
    'security.read',
    'audit.export'
  ],
  MANAGER: [
    'leads.read', 'leads.create', 'leads.dispatch',
    'appointment.read', 'appointment.create', 'appointment.update', 'appointment.cancel',
    'actions.read',
    'proof.read',
    'events.read',
    'leaks.read',
    'attribution.read',
    'settings.read'
  ],
  STAFF: [
    'leads.read', 'leads.dispatch',
    'appointment.read', 'appointment.create', 'appointment.update', 'appointment.cancel',
    'actions.read',
    'events.read',
    'leaks.read'
  ],
  VIEWER: [
    'leads.read',
    'appointment.read',
    'actions.read',
    'proof.read',
    'events.read',
    'leaks.read',
    'attribution.read',
    'settings.read'
  ]
};

export class AuthContextService {
  /**
   * Check if current runtime environment is development or test mode.
   * If env.ENVIRONMENT is explicitly set to 'production', it is strictly production.
   */
  public static isDevelopmentOrTest(env?: { ENVIRONMENT?: string }): boolean {
    if (env?.ENVIRONMENT === 'production') {
      return false;
    }
    if (env?.ENVIRONMENT === 'development' || env?.ENVIRONMENT === 'test') {
      return true;
    }
    if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') {
      return false;
    }
    return false;
  }

  /**
   * Deterministic Role Permission Validator
   */
  public static hasPermission(role: UserRole, action: ResourceAction): boolean {
    const allowed = CANONICAL_ROLE_PERMISSIONS[role] || [];
    return allowed.includes(action);
  }

  /**
   * Fail-Closed Session Authenticator
   * In production: Requires a valid session token. Returns null if missing/invalid (causing HTTP 401).
   * In dev/test: Supports structured test tokens e.g. "Bearer test_user:<userId>:<orgId>:<role>" or dev tokens.
   */
  public static resolveSessionUser(
    authHeader?: string | null,
    env?: { ENVIRONMENT?: string }
  ): AuthenticatedUser | null {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // Production & strict API requests without auth header ALWAYS return null (Fail-Closed 401)
      return null;
    }

    const token = authHeader.replace('Bearer ', '').trim();
    if (!token) return null;

    // 1. Structured test token format: "test_user:<userId>:<orgId>:<role>" (Dev/Test only)
    if (token.startsWith('test_user:')) {
      if (!AuthContextService.isDevelopmentOrTest(env)) {
        // Production rejects test tokens
        return null;
      }
      const parts = token.split(':');
      const userId = parts[1] || 'usr_test';
      const orgId = parts[2] || 'org_apex_holding';
      const role = (parts[3] || 'OWNER').toUpperCase() as UserRole;
      
      const validRoles: UserRole[] = ['OWNER', 'ADMIN', 'MANAGER', 'STAFF', 'VIEWER'];
      const effectiveRole = validRoles.includes(role) ? role : 'VIEWER';

      return {
        userId,
        email: `${userId}@velnar.io`,
        fullName: `Test ${effectiveRole}`,
        memberships: [{ organizationId: orgId, role: effectiveRole, status: 'active' }],
      };
    }

    // 2. Standard development token
    if (token === 'dev_owner_token' || token === 'velnar_dev_secret_token') {
      if (AuthContextService.isDevelopmentOrTest(env)) {
        return {
          userId: 'usr_dev_owner',
          email: 'founder@apexholding.com',
          fullName: 'Aydin Velnar',
          memberships: [
            { organizationId: 'org_apex_holding', role: 'OWNER', status: 'active' },
            { organizationId: 'org_istanbul_dining', role: 'MANAGER', status: 'active' }
          ],
          isSuperAdmin: false,
        };
      }
      return null;
    }

    // 3. Signed JWT / Session parsing placeholder for production auth providers
    // In production, unverified arbitrary bearer tokens return null (fail-closed)
    return null;
  }
}
