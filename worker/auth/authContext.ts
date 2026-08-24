/**
 * @file authContext.ts
 * @description Server-Side Authenticated Identity & Canonical Role Permission Matrix
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

export interface AuthenticatedUser {
  userId: string;
  email: string;
  fullName: string;
  memberships: Array<{
    organizationId: string;
    role: UserRole;
    status: 'active' | 'invited' | 'suspended';
  }>;
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
    'actions.read', 'actions.approve',
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
   * Deterministic Role Permission Validator
   */
  public static hasPermission(role: UserRole, action: ResourceAction): boolean {
    const allowed = CANONICAL_ROLE_PERMISSIONS[role] || [];
    return allowed.includes(action);
  }

  /**
   * Mock / Default Session Extractor for Development & Synthetic Testing
   */
  public static resolveSessionUser(authHeader?: string | null): AuthenticatedUser {
    // If bearer token or custom header is passed, decode or return session user
    if (authHeader && authHeader.startsWith('Bearer test_user_')) {
      const parts = authHeader.replace('Bearer ', '').split(':');
      const userId = parts[0] || 'usr_test';
      const orgId = parts[1] || 'org_apex_holding';
      const role = (parts[2] || 'OWNER') as UserRole;
      return {
        userId,
        email: `${userId}@velnar.io`,
        fullName: 'Test User',
        memberships: [{ organizationId: orgId, role, status: 'active' }],
      };
    }

    // Default primary test tenant context
    return {
      userId: 'usr_owner_01',
      email: 'founder@apexholding.com',
      fullName: 'Aydin Velnar',
      memberships: [
        { organizationId: 'org_apex_holding', role: 'OWNER', status: 'active' },
        { organizationId: 'org_istanbul_dining', role: 'MANAGER', status: 'active' },
      ],
      isSuperAdmin: false,
    };
  }
}
