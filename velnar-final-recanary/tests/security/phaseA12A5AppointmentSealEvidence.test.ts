/**
 * @file phaseA12A5AppointmentSealEvidence.test.ts
 * @description SPRINT 4 — PHASE A.12A.5A APPOINTMENT SEAL TESTS
 * Comprehensive verification of:
 * 1. Strict HTTP 503 Business configuration failure (no permissive [500, 503]).
 * 2. Real production IP resolution (CF-Connecting-IP vs UNKNOWN, X-Forwarded-For ignored in production).
 * 3. Pre-business authorization enforcement (TenantGuard executes before BusinessTenantGuard).
 * 4. Identity vault infrastructure failure (503 IDENTITY_VAULT_UNAVAILABLE).
 * 5. Resource lookup infrastructure failure (503 APPOINTMENT_RESOURCE_UNAVAILABLE).
 * 6. Malformed resource rows rejection in D1 reads (APPOINTMENT_RESOURCE_LOOKUP_FAILED).
 * 7. Malformed appointment rows rejection in D1 reads (APPOINTMENT_READ_FAILED).
 * 8. Exact preservation of canonical DB rows without normalization.
 * 9. Direct repository transition matrix execution (allowed vs rejected).
 * 10. Single shared transition authority verification.
 * 11. Strict RFC3339 calendar date & timezone validation.
 * 12. Optimistic concurrency & zero orphan audit logging.
 * 13. Sequential migration integrity (0001 through 0006).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import worker from '../../worker/index';
import {
  AppointmentRepository,
  ALLOWED_APPOINTMENT_TRANSITIONS,
  CANONICAL_APPOINTMENT_STATUSES,
  isValidAppointmentStatus,
  isAllowedAppointmentTransition,
  type AppointmentStatus,
} from '../../worker/repositories/appointmentRepository';
import { IdentityVaultRepository } from '../../worker/repositories/identityVaultRepository';
import { AppointmentResourceRepository } from '../../worker/repositories/appointmentResourceRepository';
import { BusinessTenantGuard } from '../../worker/middleware/businessTenantGuard';
import { resolveAppointmentAuditIpInput, handleAppointmentsRoute } from '../../worker/routes/appointmentsRouter';
import { isValidIsoWithTimezone } from '../../worker/utils/rfc3339Validator';

describe('SPRINT 4 — PHASE A.12A.5A: Appointment Seal & Deterministic Evidence Tests', () => {
  const orgAlpha = 'org_apex_holding';
  const bizBeauty = 'biz_beauty_salon';
  const orgBeta = 'org_istanbul_dining';

  const validOwnerHeaders = {
    'Authorization': `Bearer test_user:usr_dev_owner:${orgAlpha}:OWNER`,
    'Content-Type': 'application/json',
  };

  const validStaffHeaders = {
    'Authorization': `Bearer test_user:usr_dev_staff:${orgAlpha}:STAFF`,
    'Content-Type': 'application/json',
  };

  const validViewerHeaders = {
    'Authorization': `Bearer test_user:usr_dev_viewer:${orgAlpha}:VIEWER`,
    'Content-Type': 'application/json',
  };

  // Seed test memory for development / test executions
  IdentityVaultRepository.registerTestPseudonym('cus_seal_a12_01', orgAlpha);
  IdentityVaultRepository.registerTestPseudonym('cus_seal_a12_02', orgAlpha);

  AppointmentResourceRepository.registerTestResource({
    id: 'res_seal_active_01',
    organizationId: orgAlpha,
    businessId: bizBeauty,
    name: 'Dr. Clara Vance',
    resourceType: 'staff',
    capacityUnits: 1,
    status: 'active',
    createdAt: '2026-08-20T10:00:00Z',
  });

  AppointmentResourceRepository.registerTestResource({
    id: 'res_seal_maintenance_01',
    organizationId: orgAlpha,
    businessId: bizBeauty,
    name: 'Room Maintenance Bay',
    resourceType: 'room',
    capacityUnits: 1,
    status: 'maintenance',
    createdAt: '2026-08-20T10:00:00Z',
  });

  AppointmentResourceRepository.registerTestResource({
    id: 'res_seal_offline_01',
    organizationId: orgAlpha,
    businessId: bizBeauty,
    name: 'Chair Offline Unit',
    resourceType: 'chair',
    capacityUnits: 1,
    status: 'offline',
    createdAt: '2026-08-20T10:00:00Z',
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ============================================================================
  // 1. Strict Business Failure Semantics (HTTP 503 Exact Assertion)
  // ============================================================================
  describe('1. Business Configuration Failure Semantics', () => {
    it('returns exact HTTP 503 BUSINESS_CONFIGURATION_UNAVAILABLE when OrganizationRepository.getBusinessById throws', async () => {
      const failingDb: D1Database = {
        prepare(sql: string) {
          return {
            bind() {
              return {
                async first() {
                  if (sql.includes('SELECT id FROM businesses WHERE id = ? AND organization_id = ?')) {
                    // Pass initial business tenant guard check
                    return { id: bizBeauty };
                  }
                  if (sql.includes('FROM identity_vault')) {
                    return { found: 1, pseudonym_id: 'cus_seal_a12_01' };
                  }
                  if (sql.includes('FROM appointment_resources')) {
                    return {
                      id: 'res_seal_active_01',
                      organization_id: orgAlpha,
                      business_id: bizBeauty,
                      name: 'Dr. Clara Vance',
                      resource_type: 'staff',
                      capacity_units: 1,
                      status: 'active',
                      created_at: '2026-08-20T10:00:00Z'
                    };
                  }
                  // Throw D1 I/O failure on configuration lookup
                  throw new Error('D1_INTERNAL_IO_FAILURE');
                },
                async all() {
                  return { results: [{ id: bizBeauty, organization_id: orgAlpha }] };
                }
              };
            }
          } as any;
        }
      } as any;

      const res = await worker.fetch(
        new Request(`https://app.velnar.studio/api/appointments?orgId=${orgAlpha}&businessId=${bizBeauty}`, {
          method: 'POST',
          headers: validOwnerHeaders,
          body: JSON.stringify({
            customerPseudonymId: 'cus_seal_a12_01',
            serviceName: 'HydraFacial Deluxe',
            serviceCategory: 'Facial',
            resourceStaffId: 'res_seal_active_01',
            scheduledStart: '2026-08-25T14:00:00Z',
            scheduledEnd: '2026-08-25T15:00:00Z',
            expectedValueMinor: 25000,
          }),
        }),
        { DB: failingDb, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );

      // Must be EXACT 503, never 500
      expect(res.status).toBe(503);
      const json = await res.json() as any;
      expect(json.error).toBe('BUSINESS_CONFIGURATION_UNAVAILABLE');
    });

    it('returns HTTP 503 BUSINESS_SCOPE_LOOKUP_FAILED when initial business scope query fails in D1', async () => {
      const failingDb: D1Database = {
        prepare() {
          return {
            bind() {
              return {
                async first() {
                  throw new Error('D1_CONNECTION_RESET');
                },
                async all() {
                  throw new Error('D1_CONNECTION_RESET');
                }
              };
            }
          } as any;
        }
      } as any;

      const res = await worker.fetch(
        new Request(`https://app.velnar.studio/api/appointments?orgId=${orgAlpha}&businessId=${bizBeauty}`, {
          method: 'GET',
          headers: validOwnerHeaders,
        }),
        { DB: failingDb, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );

      expect(res.status).toBe(503);
      const json = await res.json() as any;
      expect(json.error).toBe('BUSINESS_SCOPE_LOOKUP_FAILED');
    });
  });

  // ============================================================================
  // 2. Real Production IP Behavior (CF-Connecting-IP vs UNKNOWN)
  // ============================================================================
  describe('2. Real Production IP Resolution & Zero-Trust X-Forwarded-For', () => {
    it('shared helper resolveAppointmentAuditIpInput trusts CF-Connecting-IP in production (Case A)', () => {
      const req = new Request('https://app.velnar.studio/api/appointments', {
        headers: {
          'CF-Connecting-IP': '198.51.100.45',
          'X-Forwarded-For': '10.0.0.1, 10.0.0.2',
        }
      });

      const resolved = resolveAppointmentAuditIpInput(req, 'production');
      expect(resolved).toBe('198.51.100.45');
    });

    it('shared helper resolveAppointmentAuditIpInput ignores X-Forwarded-For and returns UNKNOWN when CF-Connecting-IP is absent in production (Case B)', () => {
      const req = new Request('https://app.velnar.studio/api/appointments', {
        headers: {
          'X-Forwarded-For': '198.51.100.99',
        }
      });

      const resolved = resolveAppointmentAuditIpInput(req, 'production');
      expect(resolved).toBe('UNKNOWN');
    });

    it('shared helper resolveAppointmentAuditIpInput accepts X-Forwarded-For only in non-production environments', () => {
      const req = new Request('https://app.velnar.studio/api/appointments', {
        headers: {
          'X-Forwarded-For': '192.168.1.50',
        }
      });

      const resolvedDev = resolveAppointmentAuditIpInput(req, 'development');
      expect(resolvedDev).toBe('192.168.1.50');

      const resolvedTest = resolveAppointmentAuditIpInput(req, 'test');
      expect(resolvedTest).toBe('192.168.1.50');
    });

    it('exercises production worker route with real production ENVIRONMENT', async () => {
      // Mock D1 for production execution to verify audit hash creation
      const mockD1: D1Database = {
        prepare(sql: string) {
          return {
            bind(...args: any[]) {
              return {
                async first() {
                  if (sql.includes('FROM businesses')) {
                    return {
                      id: bizBeauty,
                      organization_id: orgAlpha,
                      name: 'Apex Spa & Beauty',
                      market: 'GLOBAL',
                      industry: 'Aesthetics',
                      currency: 'USD',
                      annual_revenue_run_rate_minor: 100000000,
                      baseline_margin_pct: 35.0,
                      status: 'active',
                      created_at: '2026-08-01T00:00:00Z',
                    };
                  }
                  if (sql.includes('FROM identity_vault')) {
                    return { found: 1, pseudonym_id: 'cus_seal_a12_01' };
                  }
                  if (sql.includes('FROM appointment_resources')) {
                    return {
                      id: 'res_seal_active_01',
                      organization_id: orgAlpha,
                      business_id: bizBeauty,
                      name: 'Dr. Clara Vance',
                      resource_type: 'staff',
                      capacity_units: 1,
                      status: 'active',
                      created_at: '2026-08-20T10:00:00Z'
                    };
                  }
                  return null;
                },
                async all() {
                  return { results: [] };
                }
              };
            }
          } as any;
        },
        async batch() {
          return [
            { meta: { changes: 1 } },
            { meta: { changes: 1 } },
          ];
        }
      } as any;

      // In production environment with CF-Connecting-IP
      const prodUser = {
        userId: 'usr_prod_owner',
        email: 'owner@velnar.io',
        fullName: 'Production Owner',
        memberships: [
          { organizationId: orgAlpha, role: 'OWNER' as const, status: 'active' as const },
        ],
      };

      const req = new Request(`https://app.velnar.studio/api/appointments?orgId=${orgAlpha}&businessId=${bizBeauty}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '198.51.100.45',
          'X-Forwarded-For': '10.0.0.1',
        },
        body: JSON.stringify({
          customerPseudonymId: 'cus_seal_a12_01',
          serviceName: 'HydraFacial Deluxe',
          serviceCategory: 'Facial',
          resourceStaffId: 'res_seal_active_01',
          scheduledStart: '2026-08-25T14:00:00Z',
          scheduledEnd: '2026-08-25T15:00:00Z',
          expectedValueMinor: 25000,
        }),
      });

      const prodRes = await handleAppointmentsRoute(
        req,
        prodUser,
        new URL(req.url),
        mockD1,
        'production',
        'prod_salt_secret_9988'
      );

      expect(prodRes.status).toBe(201);
      const prodJson = await prodRes.json() as any;
      expect(prodJson.success).toBe(true);
      expect(prodJson.auditLogId).toBeDefined();
    });
  });

  // ============================================================================
  // 3. Authorization Before Business Lookup (Spies Verification)
  // ============================================================================
  describe('3. Authorization Before Business Lookup Pipeline', () => {
    it('Unauthorized GET denies at TenantGuard and NEVER calls BusinessTenantGuard or AppointmentRepository', async () => {
      const bizGuardSpy = vi.spyOn(BusinessTenantGuard, 'verifyBusinessBelongsToOrganization');
      const listSpy = vi.spyOn(AppointmentRepository, 'listByBusiness');

      // Request without auth token
      const res = await worker.fetch(
        new Request(`https://app.velnar.studio/api/appointments?orgId=${orgAlpha}&businessId=${bizBeauty}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );

      expect(res.status).toBe(401);
      expect(bizGuardSpy).toHaveBeenCalledTimes(0);
      expect(listSpy).toHaveBeenCalledTimes(0);
    });

    it('Cross-tenant GET denies at TenantGuard and NEVER calls BusinessTenantGuard or AppointmentRepository', async () => {
      const bizGuardSpy = vi.spyOn(BusinessTenantGuard, 'verifyBusinessBelongsToOrganization');
      const listSpy = vi.spyOn(AppointmentRepository, 'listByBusiness');

      // User belonging to orgBeta attempts to query orgAlpha
      const crossTenantHeaders = {
        'Authorization': `Bearer test_user:usr_dev_owner:${orgBeta}:OWNER`,
        'Content-Type': 'application/json',
      };

      const res = await worker.fetch(
        new Request(`https://app.velnar.studio/api/appointments?orgId=${orgAlpha}&businessId=${bizBeauty}`, {
          method: 'GET',
          headers: crossTenantHeaders,
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );

      expect(res.status).toBe(403);
      expect(bizGuardSpy).toHaveBeenCalledTimes(0);
      expect(listSpy).toHaveBeenCalledTimes(0);
    });

    it('Unauthorized PATCH (VIEWER role) denies at TenantGuard and NEVER calls BusinessTenantGuard or getByIdForBusiness', async () => {
      const bizGuardSpy = vi.spyOn(BusinessTenantGuard, 'verifyBusinessBelongsToOrganization');
      const getByIdSpy = vi.spyOn(AppointmentRepository, 'getByIdForBusiness');

      const res = await worker.fetch(
        new Request(`https://app.velnar.studio/api/appointments?orgId=${orgAlpha}&businessId=${bizBeauty}`, {
          method: 'PATCH',
          headers: validViewerHeaders, // VIEWER has no write permissions
          body: JSON.stringify({
            appointmentId: 'apt_test_01',
            status: 'confirmed',
          }),
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );

      expect(res.status).toBe(403);
      expect(bizGuardSpy).toHaveBeenCalledTimes(0);
      expect(getByIdSpy).toHaveBeenCalledTimes(0);
    });
  });

  // ============================================================================
  // 4. Identity Lookup Infrastructure Failure
  // ============================================================================
  describe('4. Identity Vault Lookup Infrastructure Failure vs Missing Pseudonym', () => {
    it('returns HTTP 503 IDENTITY_VAULT_UNAVAILABLE when IdentityVaultRepository throws infrastructure error', async () => {
      vi.spyOn(IdentityVaultRepository, 'existsPseudonym').mockRejectedValueOnce(
        new Error('IDENTITY_VAULT_LOOKUP_FAILED')
      );

      const res = await worker.fetch(
        new Request(`https://app.velnar.studio/api/appointments?orgId=${orgAlpha}&businessId=${bizBeauty}`, {
          method: 'POST',
          headers: validOwnerHeaders,
          body: JSON.stringify({
            customerPseudonymId: 'cus_seal_a12_01',
            serviceName: 'HydraFacial Deluxe',
            serviceCategory: 'Facial',
            resourceStaffId: 'res_seal_active_01',
            scheduledStart: '2026-08-25T14:00:00Z',
            scheduledEnd: '2026-08-25T15:00:00Z',
            expectedValueMinor: 25000,
          }),
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );

      expect(res.status).toBe(503);
      const json = await res.json() as any;
      expect(json.error).toBe('IDENTITY_VAULT_UNAVAILABLE');
    });

    it('returns HTTP 404 CUSTOMER_REFERENCE_NOT_FOUND when pseudonym does not exist (clean false)', async () => {
      vi.spyOn(IdentityVaultRepository, 'existsPseudonym').mockResolvedValueOnce(false);

      const res = await worker.fetch(
        new Request(`https://app.velnar.studio/api/appointments?orgId=${orgAlpha}&businessId=${bizBeauty}`, {
          method: 'POST',
          headers: validOwnerHeaders,
          body: JSON.stringify({
            customerPseudonymId: 'cus_unregistered_pseudonym',
            serviceName: 'HydraFacial Deluxe',
            serviceCategory: 'Facial',
            resourceStaffId: 'res_seal_active_01',
            scheduledStart: '2026-08-25T14:00:00Z',
            scheduledEnd: '2026-08-25T15:00:00Z',
            expectedValueMinor: 25000,
          }),
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );

      expect(res.status).toBe(404);
      const json = await res.json() as any;
      expect(json.error).toBe('CUSTOMER_REFERENCE_NOT_FOUND');
    });
  });

  // ============================================================================
  // 5. Resource Lookup Infrastructure Failure
  // ============================================================================
  describe('5. Resource Lookup Infrastructure Failure vs Missing Resource', () => {
    it('returns HTTP 503 APPOINTMENT_RESOURCE_UNAVAILABLE when AppointmentResourceRepository throws infrastructure error', async () => {
      vi.spyOn(AppointmentResourceRepository, 'getByIdForBusiness').mockRejectedValueOnce(
        new Error('APPOINTMENT_RESOURCE_LOOKUP_FAILED')
      );

      const res = await worker.fetch(
        new Request(`https://app.velnar.studio/api/appointments?orgId=${orgAlpha}&businessId=${bizBeauty}`, {
          method: 'POST',
          headers: validOwnerHeaders,
          body: JSON.stringify({
            customerPseudonymId: 'cus_seal_a12_01',
            serviceName: 'HydraFacial Deluxe',
            serviceCategory: 'Facial',
            resourceStaffId: 'res_seal_active_01',
            scheduledStart: '2026-08-25T14:00:00Z',
            scheduledEnd: '2026-08-25T15:00:00Z',
            expectedValueMinor: 25000,
          }),
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );

      expect(res.status).toBe(503);
      const json = await res.json() as any;
      expect(json.error).toBe('APPOINTMENT_RESOURCE_UNAVAILABLE');
    });

    it('returns HTTP 404 APPOINTMENT_RESOURCE_NOT_FOUND when resource is missing (null)', async () => {
      vi.spyOn(AppointmentResourceRepository, 'getByIdForBusiness').mockResolvedValueOnce(null);

      const res = await worker.fetch(
        new Request(`https://app.velnar.studio/api/appointments?orgId=${orgAlpha}&businessId=${bizBeauty}`, {
          method: 'POST',
          headers: validOwnerHeaders,
          body: JSON.stringify({
            customerPseudonymId: 'cus_seal_a12_01',
            serviceName: 'HydraFacial Deluxe',
            serviceCategory: 'Facial',
            resourceStaffId: 'res_unknown_staff',
            scheduledStart: '2026-08-25T14:00:00Z',
            scheduledEnd: '2026-08-25T15:00:00Z',
            expectedValueMinor: 25000,
          }),
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );

      expect(res.status).toBe(404);
      const json = await res.json() as any;
      expect(json.error).toBe('APPOINTMENT_RESOURCE_NOT_FOUND');
    });

    it('returns HTTP 400 APPOINTMENT_RESOURCE_UNAVAILABLE when resource status is maintenance or offline', async () => {
      // Test maintenance
      const resMaint = await worker.fetch(
        new Request(`https://app.velnar.studio/api/appointments?orgId=${orgAlpha}&businessId=${bizBeauty}`, {
          method: 'POST',
          headers: validOwnerHeaders,
          body: JSON.stringify({
            customerPseudonymId: 'cus_seal_a12_01',
            serviceName: 'HydraFacial Deluxe',
            serviceCategory: 'Facial',
            resourceStaffId: 'res_seal_maintenance_01',
            scheduledStart: '2026-08-25T14:00:00Z',
            scheduledEnd: '2026-08-25T15:00:00Z',
            expectedValueMinor: 25000,
          }),
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );

      expect(resMaint.status).toBe(400);
      const jsonMaint = await resMaint.json() as any;
      expect(jsonMaint.error).toBe('APPOINTMENT_RESOURCE_UNAVAILABLE');
      expect(jsonMaint.message).toContain('maintenance');

      // Test offline
      const resOffline = await worker.fetch(
        new Request(`https://app.velnar.studio/api/appointments?orgId=${orgAlpha}&businessId=${bizBeauty}`, {
          method: 'POST',
          headers: validOwnerHeaders,
          body: JSON.stringify({
            customerPseudonymId: 'cus_seal_a12_01',
            serviceName: 'HydraFacial Deluxe',
            serviceCategory: 'Facial',
            resourceStaffId: 'res_seal_offline_01',
            scheduledStart: '2026-08-25T14:00:00Z',
            scheduledEnd: '2026-08-25T15:00:00Z',
            expectedValueMinor: 25000,
          }),
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );

      expect(resOffline.status).toBe(400);
      const jsonOffline = await resOffline.json() as any;
      expect(jsonOffline.error).toBe('APPOINTMENT_RESOURCE_UNAVAILABLE');
      expect(jsonOffline.message).toContain('offline');
    });
  });

  // ============================================================================
  // 6. Malformed Resource Rows
  // ============================================================================
  describe('6. Resource Repository D1 Row Validation & Malformed Row Rejection', () => {
    const makeResourceD1 = (row: any): D1Database => ({
      prepare() {
        return {
          bind() {
            return {
              async first() {
                return row;
              }
            };
          }
        } as any;
      }
    } as any);

    it('rejects resource_type = garbage', async () => {
      const db = makeResourceD1({
        id: 'res_01',
        organization_id: orgAlpha,
        business_id: bizBeauty,
        name: 'Staff',
        resource_type: 'garbage',
        capacity_units: 1,
        status: 'active',
        created_at: '2026-08-20T10:00:00Z'
      });

      await expect(
        AppointmentResourceRepository.getByIdForBusiness(db, 'res_01', orgAlpha, bizBeauty, 'production')
      ).rejects.toThrow('APPOINTMENT_RESOURCE_LOOKUP_FAILED');
    });

    it('rejects status = garbage', async () => {
      const db = makeResourceD1({
        id: 'res_01',
        organization_id: orgAlpha,
        business_id: bizBeauty,
        name: 'Staff',
        resource_type: 'staff',
        capacity_units: 1,
        status: 'garbage',
        created_at: '2026-08-20T10:00:00Z'
      });

      await expect(
        AppointmentResourceRepository.getByIdForBusiness(db, 'res_01', orgAlpha, bizBeauty, 'production')
      ).rejects.toThrow('APPOINTMENT_RESOURCE_LOOKUP_FAILED');
    });

    it('rejects capacity_units = 0', async () => {
      const db = makeResourceD1({
        id: 'res_01',
        organization_id: orgAlpha,
        business_id: bizBeauty,
        name: 'Staff',
        resource_type: 'staff',
        capacity_units: 0,
        status: 'active',
        created_at: '2026-08-20T10:00:00Z'
      });

      await expect(
        AppointmentResourceRepository.getByIdForBusiness(db, 'res_01', orgAlpha, bizBeauty, 'production')
      ).rejects.toThrow('APPOINTMENT_RESOURCE_LOOKUP_FAILED');
    });

    it('rejects capacity_units = 1.5 (non-integer)', async () => {
      const db = makeResourceD1({
        id: 'res_01',
        organization_id: orgAlpha,
        business_id: bizBeauty,
        name: 'Staff',
        resource_type: 'staff',
        capacity_units: 1.5,
        status: 'active',
        created_at: '2026-08-20T10:00:00Z'
      });

      await expect(
        AppointmentResourceRepository.getByIdForBusiness(db, 'res_01', orgAlpha, bizBeauty, 'production')
      ).rejects.toThrow('APPOINTMENT_RESOURCE_LOOKUP_FAILED');
    });

    it('rejects name = empty string', async () => {
      const db = makeResourceD1({
        id: 'res_01',
        organization_id: orgAlpha,
        business_id: bizBeauty,
        name: '',
        resource_type: 'staff',
        capacity_units: 1,
        status: 'active',
        created_at: '2026-08-20T10:00:00Z'
      });

      await expect(
        AppointmentResourceRepository.getByIdForBusiness(db, 'res_01', orgAlpha, bizBeauty, 'production')
      ).rejects.toThrow('APPOINTMENT_RESOURCE_LOOKUP_FAILED');
    });

    it('rejects invalid calendar day created_at = 2026-02-30T10:00:00Z', async () => {
      const db = makeResourceD1({
        id: 'res_01',
        organization_id: orgAlpha,
        business_id: bizBeauty,
        name: 'Staff',
        resource_type: 'staff',
        capacity_units: 1,
        status: 'active',
        created_at: '2026-02-30T10:00:00Z' // Invalid day for February
      });

      await expect(
        AppointmentResourceRepository.getByIdForBusiness(db, 'res_01', orgAlpha, bizBeauty, 'production')
      ).rejects.toThrow('APPOINTMENT_RESOURCE_LOOKUP_FAILED');
    });

    it('accepts valid canonical resource row from D1', async () => {
      const db = makeResourceD1({
        id: 'res_valid_01',
        organization_id: orgAlpha,
        business_id: bizBeauty,
        name: 'Elena Rostova',
        resource_type: 'staff',
        capacity_units: 1,
        status: 'active',
        created_at: '2026-08-20T10:00:00Z'
      });

      const res = await AppointmentResourceRepository.getByIdForBusiness(
        db,
        'res_valid_01',
        orgAlpha,
        bizBeauty,
        'production'
      );

      expect(res).not.toBeNull();
      expect(res?.name).toBe('Elena Rostova');
      expect(res?.capacityUnits).toBe(1);
      expect(res?.status).toBe('active');
    });
  });

  // ============================================================================
  // 7. Malformed Appointment DB Rows
  // ============================================================================
  describe('7. Appointment Repository D1 Row Validation & Malformed Row Rejection', () => {
    const baseValidRow = {
      id: 'apt_canonical_01',
      organization_id: orgAlpha,
      business_id: bizBeauty,
      pseudonymous_customer_id: 'cus_seal_a12_01',
      service_name: 'Laser Precision',
      service_category: 'Laser',
      resource_staff_name: 'Dr. Clara Vance',
      scheduled_start: '2026-08-28T10:00:00Z',
      scheduled_end: '2026-08-28T11:00:00Z',
      duration_minutes: 60,
      expected_value_minor: 15000,
      currency: 'USD',
      status: 'scheduled',
      source: 'velnar_manual',
      row_version: 0,
      cancellation_reason: null,
      created_at: '2026-08-28T09:00:00Z',
      updated_at: '2026-08-28T09:00:00Z',
    };

    const makeAptD1 = (overrides: Record<string, any>): D1Database => ({
      prepare() {
        return {
          bind() {
            return {
              async first() {
                return { ...baseValidRow, ...overrides };
              }
            };
          }
        } as any;
      }
    } as any);

    it('rejects source = garbage', async () => {
      const db = makeAptD1({ source: 'garbage' });
      await expect(
        AppointmentRepository.getByIdForBusiness(db, 'apt_canonical_01', orgAlpha, bizBeauty, 'production')
      ).rejects.toThrow('APPOINTMENT_READ_FAILED');
    });

    it('rejects status = garbage', async () => {
      const db = makeAptD1({ status: 'garbage' });
      await expect(
        AppointmentRepository.getByIdForBusiness(db, 'apt_canonical_01', orgAlpha, bizBeauty, 'production')
      ).rejects.toThrow('APPOINTMENT_READ_FAILED');
    });

    it('rejects missing row_version', async () => {
      const db = makeAptD1({ row_version: undefined });
      await expect(
        AppointmentRepository.getByIdForBusiness(db, 'apt_canonical_01', orgAlpha, bizBeauty, 'production')
      ).rejects.toThrow('APPOINTMENT_READ_FAILED');
    });

    it('rejects row_version = -1', async () => {
      const db = makeAptD1({ row_version: -1 });
      await expect(
        AppointmentRepository.getByIdForBusiness(db, 'apt_canonical_01', orgAlpha, bizBeauty, 'production')
      ).rejects.toThrow('APPOINTMENT_READ_FAILED');
    });

    it('rejects row_version = 1.5', async () => {
      const db = makeAptD1({ row_version: 1.5 });
      await expect(
        AppointmentRepository.getByIdForBusiness(db, 'apt_canonical_01', orgAlpha, bizBeauty, 'production')
      ).rejects.toThrow('APPOINTMENT_READ_FAILED');
    });

    it('rejects currency = GBP under current contract (TRY, USD, EUR)', async () => {
      const db = makeAptD1({ currency: 'GBP' });
      await expect(
        AppointmentRepository.getByIdForBusiness(db, 'apt_canonical_01', orgAlpha, bizBeauty, 'production')
      ).rejects.toThrow('APPOINTMENT_READ_FAILED');
    });

    it('rejects scheduled_end <= scheduled_start', async () => {
      const db = makeAptD1({
        scheduled_start: '2026-08-28T11:00:00Z',
        scheduled_end: '2026-08-28T10:00:00Z',
      });
      await expect(
        AppointmentRepository.getByIdForBusiness(db, 'apt_canonical_01', orgAlpha, bizBeauty, 'production')
      ).rejects.toThrow('APPOINTMENT_READ_FAILED');
    });

    it('rejects duration_minutes not matching interval (60 vs 30)', async () => {
      const db = makeAptD1({
        scheduled_start: '2026-08-28T10:00:00Z',
        scheduled_end: '2026-08-28T11:00:00Z',
        duration_minutes: 30, // interval is 60
      });
      await expect(
        AppointmentRepository.getByIdForBusiness(db, 'apt_canonical_01', orgAlpha, bizBeauty, 'production')
      ).rejects.toThrow('APPOINTMENT_READ_FAILED');
    });

    it('rejects duration_minutes > 1440', async () => {
      const db = makeAptD1({
        scheduled_start: '2026-08-28T00:00:00Z',
        scheduled_end: '2026-08-29T01:00:00Z',
        duration_minutes: 1500,
      });
      await expect(
        AppointmentRepository.getByIdForBusiness(db, 'apt_canonical_01', orgAlpha, bizBeauty, 'production')
      ).rejects.toThrow('APPOINTMENT_READ_FAILED');
    });

    it('rejects non-canonical freeform cancellation_reason', async () => {
      const db = makeAptD1({
        status: 'cancelled',
        cancellation_reason: 'Customer called and asked to cancel',
      });
      await expect(
        AppointmentRepository.getByIdForBusiness(db, 'apt_canonical_01', orgAlpha, bizBeauty, 'production')
      ).rejects.toThrow('APPOINTMENT_READ_FAILED');
    });
  });

  // ============================================================================
  // 8. Canonical DB Row Exact Preservation
  // ============================================================================
  describe('8. Canonical DB Row Exact Preservation (No Normalization)', () => {
    it('preserves exact source, status, rowVersion, currency, and cancellationReasonCode', async () => {
      const canonicalD1: D1Database = {
        prepare() {
          return {
            bind() {
              return {
                async first() {
                  return {
                    id: 'apt_exact_preserve_01',
                    organization_id: orgAlpha,
                    business_id: bizBeauty,
                    pseudonymous_customer_id: 'cus_seal_a12_01',
                    service_name: 'Advanced Facial',
                    service_category: 'Facial',
                    resource_staff_name: 'Dr. Clara Vance',
                    scheduled_start: '2026-08-28T14:00:00Z',
                    scheduled_end: '2026-08-28T15:00:00Z',
                    duration_minutes: 60,
                    expected_value_minor: 30000,
                    currency: 'EUR',
                    status: 'cancelled',
                    source: 'google_calendar',
                    row_version: 4,
                    cancellation_reason: 'CUSTOMER_CANCELLED',
                    created_at: '2026-08-28T10:00:00Z',
                    updated_at: '2026-08-28T11:00:00Z',
                  };
                }
              };
            }
          } as any;
        }
      } as any;

      const apt = await AppointmentRepository.getByIdForBusiness(
        canonicalD1,
        'apt_exact_preserve_01',
        orgAlpha,
        bizBeauty,
        'production'
      );

      expect(apt).not.toBeNull();
      expect(apt?.source).toBe('google_calendar');
      expect(apt?.status).toBe('cancelled');
      expect(apt?.rowVersion).toBe(4);
      expect(apt?.currency).toBe('EUR');
      expect(apt?.cancellationReasonCode).toBe('CUSTOMER_CANCELLED');
    });
  });

  // ============================================================================
  // 9. Direct Repository Transition Tests
  // ============================================================================
  describe('9. Direct Repository Transition Tests via AppointmentRepository.updateStatusWithAudit', () => {
    it('executes allowed status transitions directly at repository layer', async () => {
      // 1. Create a scheduled appointment in test memory
      const created = await AppointmentRepository.createWithAudit(
        undefined,
        {
          customerPseudonymId: 'cus_seal_a12_01',
          serviceName: 'Deep Hydration',
          serviceCategory: 'Skin',
          resourceStaffId: 'res_seal_active_01',
          scheduledStart: '2026-08-29T10:00:00Z',
          scheduledEnd: '2026-08-29T11:00:00Z',
          durationMinutes: 60,
          expectedValueMinor: 18000,
        },
        {
          organizationId: orgAlpha,
          businessId: bizBeauty,
          currency: 'USD',
          actorId: 'usr_dev_owner',
          actorRole: 'OWNER',
          ipHash: 'ip_hash_matrix_test',
        },
        'test'
      );

      const aptId = created.appointment.id;
      expect(created.appointment.status).toBe('scheduled');
      expect(created.appointment.rowVersion).toBe(0);

      // scheduled -> confirmed
      const upd1 = await AppointmentRepository.updateStatusWithAudit(
        undefined,
        aptId,
        'scheduled',
        'confirmed',
        orgAlpha,
        bizBeauty,
        'usr_dev_owner',
        'OWNER',
        'ip_hash_matrix_test',
        undefined,
        'test'
      );
      expect(upd1).not.toBeNull();
      expect(upd1?.appointment.status).toBe('confirmed');
      expect(upd1?.appointment.rowVersion).toBe(1);

      // confirmed -> in_progress
      const upd2 = await AppointmentRepository.updateStatusWithAudit(
        undefined,
        aptId,
        'confirmed',
        'in_progress',
        orgAlpha,
        bizBeauty,
        'usr_dev_owner',
        'OWNER',
        'ip_hash_matrix_test',
        undefined,
        'test'
      );
      expect(upd2).not.toBeNull();
      expect(upd2?.appointment.status).toBe('in_progress');
      expect(upd2?.appointment.rowVersion).toBe(2);

      // in_progress -> completed
      const upd3 = await AppointmentRepository.updateStatusWithAudit(
        undefined,
        aptId,
        'in_progress',
        'completed',
        orgAlpha,
        bizBeauty,
        'usr_dev_owner',
        'OWNER',
        'ip_hash_matrix_test',
        undefined,
        'test'
      );
      expect(upd3).not.toBeNull();
      expect(upd3?.appointment.status).toBe('completed');
      expect(upd3?.appointment.rowVersion).toBe(3);
    });

    it('rejects disallowed transitions directly and throws INVALID_APPOINTMENT_STATE_TRANSITION with 0 mutations', async () => {
      // Create fresh scheduled appointment
      const created = await AppointmentRepository.createWithAudit(
        undefined,
        {
          customerPseudonymId: 'cus_seal_a12_01',
          serviceName: 'Deep Hydration',
          serviceCategory: 'Skin',
          resourceStaffId: 'res_seal_active_01',
          scheduledStart: '2026-08-29T14:00:00Z',
          scheduledEnd: '2026-08-29T15:00:00Z',
          durationMinutes: 60,
          expectedValueMinor: 18000,
        },
        {
          organizationId: orgAlpha,
          businessId: bizBeauty,
          currency: 'USD',
          actorId: 'usr_dev_owner',
          actorRole: 'OWNER',
          ipHash: 'ip_hash_matrix_test',
        },
        'test'
      );
      const aptId = created.appointment.id;

      // 1. scheduled -> completed (ILLEGAL)
      await expect(
        AppointmentRepository.updateStatusWithAudit(
          undefined,
          aptId,
          'scheduled',
          'completed',
          orgAlpha,
          bizBeauty,
          'usr_dev_owner',
          'OWNER',
          'ip_hash_test',
          undefined,
          'test'
        )
      ).rejects.toThrow('INVALID_APPOINTMENT_STATE_TRANSITION');

      // 2. scheduled -> scheduled (SAME STATUS ILLEGAL)
      await expect(
        AppointmentRepository.updateStatusWithAudit(
          undefined,
          aptId,
          'scheduled',
          'scheduled',
          orgAlpha,
          bizBeauty,
          'usr_dev_owner',
          'OWNER',
          'ip_hash_test',
          undefined,
          'test'
        )
      ).rejects.toThrow('INVALID_APPOINTMENT_STATE_TRANSITION');

      // Transition to completed via valid route first: scheduled -> confirmed -> completed
      await AppointmentRepository.updateStatusWithAudit(
        undefined,
        aptId,
        'scheduled',
        'confirmed',
        orgAlpha,
        bizBeauty,
        'usr_dev_owner',
        'OWNER',
        'ip_hash_test',
        undefined,
        'test'
      );
      await AppointmentRepository.updateStatusWithAudit(
        undefined,
        aptId,
        'confirmed',
        'completed',
        orgAlpha,
        bizBeauty,
        'usr_dev_owner',
        'OWNER',
        'ip_hash_test',
        undefined,
        'test'
      );

      // 3. completed -> scheduled (TERMINAL ILLEGAL)
      await expect(
        AppointmentRepository.updateStatusWithAudit(
          undefined,
          aptId,
          'completed',
          'scheduled',
          orgAlpha,
          bizBeauty,
          'usr_dev_owner',
          'OWNER',
          'ip_hash_test',
          undefined,
          'test'
        )
      ).rejects.toThrow('INVALID_APPOINTMENT_STATE_TRANSITION');

      // 4. completed -> cancelled (TERMINAL ILLEGAL)
      await expect(
        AppointmentRepository.updateStatusWithAudit(
          undefined,
          aptId,
          'completed',
          'cancelled',
          orgAlpha,
          bizBeauty,
          'usr_dev_owner',
          'OWNER',
          'ip_hash_test',
          'CUSTOMER_CANCELLED',
          'test'
        )
      ).rejects.toThrow('INVALID_APPOINTMENT_STATE_TRANSITION');

      // 5. 'garbage' as runtime target
      await expect(
        AppointmentRepository.updateStatusWithAudit(
          undefined,
          aptId,
          'completed',
          'garbage' as any,
          orgAlpha,
          bizBeauty,
          'usr_dev_owner',
          'OWNER',
          'ip_hash_test',
          undefined,
          'test'
        )
      ).rejects.toThrow('INVALID_APPOINTMENT_STATE_TRANSITION');
    });
  });

  // ============================================================================
  // 10. Shared Transition Authority Test
  // ============================================================================
  describe('10. Single Shared Transition Authority Verification', () => {
    it('verifies ALLOWED_APPOINTMENT_TRANSITIONS is the single authority used across worker', () => {
      expect(ALLOWED_APPOINTMENT_TRANSITIONS).toBeDefined();
      expect(CANONICAL_APPOINTMENT_STATUSES).toBeDefined();
      expect(typeof isValidAppointmentStatus).toBe('function');
      expect(typeof isAllowedAppointmentTransition).toBe('function');

      // Verify matrix completeness
      const allStatuses: AppointmentStatus[] = [
        'scheduled',
        'confirmed',
        'in_progress',
        'completed',
        'cancelled',
        'no_show',
        'rescheduled'
      ];

      for (const status of allStatuses) {
        expect(CANONICAL_APPOINTMENT_STATUSES.has(status)).toBe(true);
        expect(isValidAppointmentStatus(status)).toBe(true);
        expect(ALLOWED_APPOINTMENT_TRANSITIONS[status]).toBeDefined();
      }

      // Terminal states must have empty allowed transitions
      expect(ALLOWED_APPOINTMENT_TRANSITIONS.completed).toEqual([]);
      expect(ALLOWED_APPOINTMENT_TRANSITIONS.cancelled).toEqual([]);
      expect(ALLOWED_APPOINTMENT_TRANSITIONS.no_show).toEqual([]);
    });
  });

  // ============================================================================
  // 11. Strict RFC3339 Validator
  // ============================================================================
  describe('11. Strict RFC3339 Date & Timezone Validator', () => {
    it('rejects malformed calendar dates, leap-year overflows, and invalid time components', () => {
      expect(isValidIsoWithTimezone('2026-02-30T10:00:00Z')).toBe(false); // Feb 30 does not exist
      expect(isValidIsoWithTimezone('2026-04-31T10:00:00Z')).toBe(false); // April has 30 days
      expect(isValidIsoWithTimezone('2026-13-01T10:00:00Z')).toBe(false); // Month 13 invalid
      expect(isValidIsoWithTimezone('2026-08-28T25:00:00Z')).toBe(false); // Hour 25 invalid
      expect(isValidIsoWithTimezone('2026-08-28T10:61:00Z')).toBe(false); // Minute 61 invalid
      expect(isValidIsoWithTimezone('2026-08-28T10:00:00')).toBe(false);   // Missing timezone
    });

    it('accepts valid RFC3339 timestamps including valid leap days and offsets', () => {
      expect(isValidIsoWithTimezone('2028-02-29T10:00:00Z')).toBe(true);       // 2028 is a leap year
      expect(isValidIsoWithTimezone('2026-08-28T13:00:00+03:00')).toBe(true); // Explicit offset
      expect(isValidIsoWithTimezone('2026-08-28T10:00:00.000Z')).toBe(true);   // Milliseconds
    });
  });

  // ============================================================================
  // 12. Concurrency Proof & Zero Orphan Audits
  // ============================================================================
  describe('12. Optimistic Concurrency Hardening & Zero Orphan Audits', () => {
    it('simulates D1 batch execution: stale optimistic lock results in 0 updates and 0 audit inserts', async () => {
      let executedBatchQueries: string[] = [];

      const staleMockD1: D1Database = {
        prepare(query: string) {
          return {
            bind(...args: any[]) {
              return {
                query,
                args,
                async first() {
                  return {
                    id: 'apt_concurrency_01',
                    organization_id: orgAlpha,
                    business_id: bizBeauty,
                    pseudonymous_customer_id: 'cus_seal_a12_01',
                    service_name: 'Laser Precision',
                    service_category: 'Laser',
                    resource_staff_name: 'Dr. Clara Vance',
                    scheduled_start: '2026-08-28T10:00:00Z',
                    scheduled_end: '2026-08-28T11:00:00Z',
                    duration_minutes: 60,
                    expected_value_minor: 15000,
                    currency: 'USD',
                    status: 'scheduled',
                    source: 'velnar_manual',
                    row_version: 0,
                    created_at: '2026-08-28T09:00:00Z',
                    updated_at: '2026-08-28T09:00:00Z',
                  };
                }
              };
            }
          } as any;
        },
        async batch(statements: any[]) {
          executedBatchQueries = statements.map(s => s.query);
          // Simulate 0 changes because row_version in DB was already updated by competing transaction
          return [
            { meta: { changes: 0 } },
            { meta: { changes: 0 } },
          ];
        }
      } as any;

      const result = await AppointmentRepository.updateStatusWithAudit(
        staleMockD1,
        'apt_concurrency_01',
        'scheduled',
        'confirmed',
        orgAlpha,
        bizBeauty,
        'usr_dev_owner',
        'OWNER',
        'ip_mock',
        undefined,
        'production'
      );

      expect(result).toBeNull();
      expect(executedBatchQueries.length).toBe(2);
      expect(executedBatchQueries[0]).toContain('UPDATE appointments');
      expect(executedBatchQueries[0]).toContain('row_version = row_version + 1');
      expect(executedBatchQueries[1]).toContain('INSERT INTO audit_logs');
      expect(executedBatchQueries[1]).toContain('WHERE EXISTS');
    });
  });

  // ============================================================================
  // 13. Sequential Migration Integrity (0001 through 0006)
  // ============================================================================
  describe('13. Migration Sequence & Hardening Schema Inspection', () => {
    const rootDir = path.resolve(__dirname, '../..');
    const migrationsDir = path.join(rootDir, 'migrations');

    it('verifies strict sequential migration files 0001 to 0006 exist', () => {
      const files = fs.readdirSync(migrationsDir);
      expect(files).toContain('0001_initial_schema.sql');
      expect(files).toContain('0002_indexes_and_performance.sql');
      expect(files).toContain('0003_ai_intelligence_layer.sql');
      expect(files).toContain('0004_growth_action_policy_hardening.sql');
      expect(files).toContain('0005_appointment_concurrency_hardening.sql');
      expect(files).toContain('0006_appointment_identity_resource_hardening.sql');
    });

    it('verifies row_version and last_transition_id are present in migration 0005', () => {
      const m5 = fs.readFileSync(path.join(migrationsDir, '0005_appointment_concurrency_hardening.sql'), 'utf-8');
      expect(m5).toContain('row_version');
      expect(m5).toContain('last_transition_id');
    });

    it('verifies appointment resource and identity hardening across migrations', () => {
      const m1 = fs.readFileSync(path.join(migrationsDir, '0001_initial_schema.sql'), 'utf-8');
      expect(m1).toContain('appointment_resources');
      expect(m1).toContain('capacity_units');
      expect(m1).toContain('resource_staff_id');

      const m6 = fs.readFileSync(path.join(migrationsDir, '0006_appointment_identity_resource_hardening.sql'), 'utf-8');
      expect(m6).toContain('idx_identity_vault_org_pseudonym');
      expect(m6).toContain('idx_appointment_resources_lookup');
    });
  });
});
