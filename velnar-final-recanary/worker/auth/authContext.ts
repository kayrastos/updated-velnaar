/**
 * @file authContext.ts
 * @description Server-Side Authenticated Identity & Canonical Role Permission Matrix (Fail-Closed)
 * 
 * ============================================================================
 * ARCHITECTURAL MANDATES (Sprint 3.4):
 * 1. Fail-closed: Missing or invalid Authorization header returns null (HTTP 401).
 * 2. Production must NEVER fall back to a demo or default identity.
 * 3. Test identities exist ONLY when ENVIRONMENT === 'test' or 'development'.
 * 4. Browser-supplied organization or role is NEVER trusted.
 * 5. Memberships and roles are resolved strictly from server-controlled/session sources.
 * ============================================================================
 */

import { UserRole } from '../../src/types/database';

export const VALID_USER_ROLES: readonly UserRole[] = ['OWNER', 'ADMIN', 'MANAGER', 'STAFF', 'VIEWER'] as const;

export function isValidUserRole(role: any): role is UserRole {
  return typeof role === 'string' && VALID_USER_ROLES.includes(role as UserRole);
}

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
   * Strictly verify if environment is development or test.
   * In production or unknown environments, this MUST return false.
   */
  public static isDevelopmentOrTest(environment?: string): boolean {
    if (!environment) return false;
    const normalized = environment.toLowerCase().trim();
    return normalized === 'development' || normalized === 'test';
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
   * 
   * Production rules:
   * - missing Authorization header => null (401)
   * - invalid Authorization format/token => null (401)
   * - fake/test tokens in production => null (401)
   * - browser-supplied organization or role is NEVER trusted
   * - memberships/roles come strictly from server-controlled sources
   */
  public static resolveSessionUser(
    authHeader: string | null | undefined,
    environment: string
  ): AuthenticatedUser | null {
    // 1. Fail-closed on missing or malformed header
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }

    const token = authHeader.replace('Bearer ', '').trim();
    if (!token) {
      return null;
    }

    const isDevOrTest = AuthContextService.isDevelopmentOrTest(environment);

    // 2. Test identity token: test_user:<userId>:<orgId>:<role>
    // ONLY permitted if environment is explicitly 'test' or 'development'
    if (token.startsWith('test_user:')) {
      if (!isDevOrTest) {
        // In production, reject test token immediately (fail-closed)
        return null;
      }

      const parts = token.split(':');
      if (parts.length !== 4) {
        return null;
      }

      const userId = parts[1]?.trim();
      const orgId = parts[2]?.trim();
      const rawRole = parts[3]?.trim();

      if (!userId || !orgId || !rawRole) {
        return null;
      }

      const validRoles: UserRole[] = ['OWNER', 'ADMIN', 'MANAGER', 'STAFF', 'VIEWER'];
      if (!validRoles.includes(rawRole as UserRole)) {
        return null;
      }

      const effectiveRole = rawRole as UserRole;

      return {
        userId,
        email: `${userId}@velnar.io`,
        fullName: `Test ${effectiveRole}`,
        memberships: [{ organizationId: orgId, role: effectiveRole, status: 'active' }],
      };
    }

    // 3. Predefined development fixture tokens (Dev/Test only)
    if (token === 'dev_owner_token' || token === 'velnar_dev_secret_token') {
      if (isDevOrTest) {
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

    // 4. Production JWT / server session token resolution
    // In this runtime, unverified external tokens return null (fail-closed)
    return null;
  }
}
