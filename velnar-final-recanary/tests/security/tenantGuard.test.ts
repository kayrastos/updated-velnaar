import { describe, it, expect } from 'vitest';
import { TenantGuard } from '../../worker/middleware/tenantGuard';
import { AuthenticatedUser } from '../../worker/auth/authContext';

describe('TenantGuard & RBAC Authorization Engine', () => {
  const orgAlpha = 'org_apex_holding';
  const orgBeta = 'org_istanbul_dining';

  const userAlphaOwner: AuthenticatedUser = {
    userId: 'usr_owner_01',
    email: 'owner@alpha.com',
    fullName: 'Alpha Owner',
    memberships: [{ organizationId: orgAlpha, role: 'OWNER', status: 'active' }],
  };

  const userAlphaAdmin: AuthenticatedUser = {
    userId: 'usr_admin_01',
    email: 'admin@alpha.com',
    fullName: 'Alpha Admin',
    memberships: [{ organizationId: orgAlpha, role: 'ADMIN', status: 'active' }],
  };

  const userAlphaManager: AuthenticatedUser = {
    userId: 'usr_mgr_01',
    email: 'mgr@alpha.com',
    fullName: 'Alpha Manager',
    memberships: [{ organizationId: orgAlpha, role: 'MANAGER', status: 'active' }],
  };

  const userAlphaStaff: AuthenticatedUser = {
    userId: 'usr_staff_01',
    email: 'staff@alpha.com',
    fullName: 'Alpha Staff',
    memberships: [{ organizationId: orgAlpha, role: 'STAFF', status: 'active' }],
  };

  const userAlphaViewer: AuthenticatedUser = {
    userId: 'usr_viewer_01',
    email: 'viewer@alpha.com',
    fullName: 'Alpha Viewer',
    memberships: [{ organizationId: orgAlpha, role: 'VIEWER', status: 'active' }],
  };

  const userBetaStaff: AuthenticatedUser = {
    userId: 'usr_beta_01',
    email: 'staff@beta.com',
    fullName: 'Beta Staff',
    memberships: [{ organizationId: orgBeta, role: 'STAFF', status: 'active' }],
  };

  describe('1. Fail-Closed Authentication Checks', () => {
    it('should reject null / unauthenticated user with 401', () => {
      const auth = TenantGuard.authorize(null, orgAlpha, 'leads.read');
      expect(auth.authorized).toBe(false);
      expect(auth.statusCode).toBe(401);
      expect(auth.errorMessage).toContain('UNAUTHENTICATED');
    });
  });

  describe('2. Cross-Tenant Boundary Enforcement', () => {
    it('should block cross-tenant read attempts with 403', () => {
      const auth = TenantGuard.authorize(userBetaStaff, orgAlpha, 'leads.read');
      expect(auth.authorized).toBe(false);
      expect(auth.statusCode).toBe(403);
      expect(auth.errorMessage).toContain('CROSS_TENANT_ACCESS_DENIED');
    });

    it('should block cross-tenant write attempts with 403', () => {
      const auth = TenantGuard.authorize(userBetaStaff, orgAlpha, 'appointment.create');
      expect(auth.authorized).toBe(false);
      expect(auth.statusCode).toBe(403);
    });
  });

  describe('3. Canonical 5-Role RBAC Matrix Enforcement', () => {
    it('OWNER should have full administrative and identity vault permissions', () => {
      expect(TenantGuard.authorize(userAlphaOwner, orgAlpha, 'identity_vault.read').authorized).toBe(true);
      expect(TenantGuard.authorize(userAlphaOwner, orgAlpha, 'identity_vault.write').authorized).toBe(true);
      expect(TenantGuard.authorize(userAlphaOwner, orgAlpha, 'actions.approve').authorized).toBe(true);
      expect(TenantGuard.authorize(userAlphaOwner, orgAlpha, 'settings.edit').authorized).toBe(true);
    });

    it('ADMIN should approve actions but CANNOT read identity vault raw PII', () => {
      expect(TenantGuard.authorize(userAlphaAdmin, orgAlpha, 'actions.approve').authorized).toBe(true);
      expect(TenantGuard.authorize(userAlphaAdmin, orgAlpha, 'settings.edit').authorized).toBe(true);
      expect(TenantGuard.authorize(userAlphaAdmin, orgAlpha, 'identity_vault.read').authorized).toBe(false);
      expect(TenantGuard.authorize(userAlphaAdmin, orgAlpha, 'identity_vault.read').statusCode).toBe(403);
    });

    it('MANAGER can dispatch leads but CANNOT approve growth actions or read vault', () => {
      expect(TenantGuard.authorize(userAlphaManager, orgAlpha, 'leads.dispatch').authorized).toBe(true);
      expect(TenantGuard.authorize(userAlphaManager, orgAlpha, 'actions.approve').authorized).toBe(false);
      expect(TenantGuard.authorize(userAlphaManager, orgAlpha, 'identity_vault.read').authorized).toBe(false);
    });

    it('STAFF can view leads and manage appointments but CANNOT approve actions or mutate settings', () => {
      expect(TenantGuard.authorize(userAlphaStaff, orgAlpha, 'leads.read').authorized).toBe(true);
      expect(TenantGuard.authorize(userAlphaStaff, orgAlpha, 'appointment.create').authorized).toBe(true);
      expect(TenantGuard.authorize(userAlphaStaff, orgAlpha, 'actions.approve').authorized).toBe(false);
      expect(TenantGuard.authorize(userAlphaStaff, orgAlpha, 'settings.edit').authorized).toBe(false);
    });

    it('VIEWER is strictly read-only and cannot mutate appointments or approve actions', () => {
      expect(TenantGuard.authorize(userAlphaViewer, orgAlpha, 'leads.read').authorized).toBe(true);
      expect(TenantGuard.authorize(userAlphaViewer, orgAlpha, 'appointment.create').authorized).toBe(false);
      expect(TenantGuard.authorize(userAlphaViewer, orgAlpha, 'actions.approve').authorized).toBe(false);
    });
  });
});
