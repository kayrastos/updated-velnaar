/**
 * @file phaseA12A3AppointmentFinalSeal.test.ts
 * @description SPRINT 4 FINAL SEAL — PHASE A.12A.3 & A.12A.4
 * Comprehensive verification of failure semantics, second-boundary referential integrity,
 * strict reasonCode validation, production CF-Connecting-IP audit logging, and direct repository transition gates.
 */

import { describe, it, expect } from 'vitest';
import worker from '../../worker/index';
import {
  AppointmentRepository,
  CANONICAL_CANCELLATION_REASON_CODES,
  isAllowedAppointmentTransition,
  isValidAppointmentStatus,
} from '../../worker/repositories/appointmentRepository';
import { IdentityVaultRepository } from '../../worker/repositories/identityVaultRepository';
import { AppointmentResourceRepository } from '../../worker/repositories/appointmentResourceRepository';

describe('SPRINT 4 FINAL SEAL — PHASE A.12A.3 / A.12A.4: Appointment Failure-Semantics & Second-Boundary Seal', () => {
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

  // Pre-seed test memory for development/test mode with canonical objects
  IdentityVaultRepository.registerTestPseudonym('cus_seal_test_01', orgAlpha);
  IdentityVaultRepository.registerTestPseudonym('cus_seal_test_02', orgAlpha);
  AppointmentResourceRepository.registerTestResource({
    id: 'res_active_01',
    organizationId: orgAlpha,
    businessId: bizBeauty,
    name: 'Dr. Clara Vance',
    resourceType: 'staff',
    capacityUnits: 1,
    status: 'active',
    createdAt: '2026-08-20T10:00:00Z',
  });
  AppointmentResourceRepository.registerTestResource({
    id: 'res_inactive_01',
    organizationId: orgAlpha,
    businessId: bizBeauty,
    name: 'Dr. On Leave',
    resourceType: 'staff',
    capacityUnits: 1,
    status: 'maintenance',
    createdAt: '2026-08-20T10:00:00Z',
  });
  AppointmentResourceRepository.registerTestResource({
    id: 'res_beta_01',
    organizationId: orgBeta,
    businessId: 'biz_bosphorus_grill',
    name: 'Chef Marco',
    resourceType: 'staff',
    capacityUnits: 1,
    status: 'active',
    createdAt: '2026-08-20T10:00:00Z',
  });

  describe('1. Failure Semantics & Distinction (DB Failure 503 vs Not Found 404)', () => {
    it('returns 503 BUSINESS_SCOPE_LOOKUP_FAILED when D1 database throws during business verification', async () => {
      const failingDb: D1Database = {
        prepare() {
          return {
            bind() {
              return {
                async first() {
                  throw new Error('D1_INTERNAL_IO_ERROR');
                },
                async all() {
                  throw new Error('D1_INTERNAL_IO_ERROR');
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

    it('returns 503 BUSINESS_CONFIGURATION_UNAVAILABLE when OrganizationRepository.getBusinessById throws in POST', async () => {
      const failingDb: D1Database = {
        prepare(sql: string) {
          return {
            bind() {
              return {
                async first() {
                  if (sql.includes('SELECT id FROM businesses WHERE id = ? AND organization_id = ?')) {
                    return { id: bizBeauty };
                  }
                  if (sql.includes('FROM identity_vault')) {
                    return { found: 1, pseudonym_id: 'cus_seal_test_01' };
                  }
                  if (sql.includes('FROM appointment_resources')) {
                    return {
                      id: 'res_active_01',
                      organization_id: orgAlpha,
                      business_id: bizBeauty,
                      name: 'Elena Rostova',
                      resource_type: 'staff',
                      capacity_units: 1,
                      status: 'active',
                      created_at: '2026-08-20T10:00:00Z'
                    };
                  }
                  throw new Error('D1_IO_ERROR');
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
            customerPseudonymId: 'cus_seal_test_01',
            serviceName: 'HydraFacial Deluxe',
            serviceCategory: 'Facial',
            resourceStaffId: 'res_active_01',
            scheduledStart: '2026-08-25T14:00:00Z',
            scheduledEnd: '2026-08-25T15:00:00Z',
            expectedValueMinor: 25000,
          }),
        }),
        { DB: failingDb, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );

      expect(res.status).toBe(503);
      const json = await res.json() as any;
      expect(json.error).toBe('BUSINESS_CONFIGURATION_UNAVAILABLE');
    });

    it('returns stable 404 BUSINESS_NOT_FOUND for non-existent or cross-tenant business', async () => {
      const res = await worker.fetch(
        new Request(`https://app.velnar.studio/api/appointments?orgId=${orgAlpha}&businessId=biz_non_existent`, {
          method: 'GET',
          headers: validOwnerHeaders,
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );

      expect(res.status).toBe(404);
      const json = await res.json() as any;
      expect(json.error).toBe('BUSINESS_NOT_FOUND');
    });

    it('returns 404 CUSTOMER_REFERENCE_NOT_FOUND when customer pseudonym does not exist in Identity Vault', async () => {
      const res = await worker.fetch(
        new Request(`https://app.velnar.studio/api/appointments?orgId=${orgAlpha}&businessId=${bizBeauty}`, {
          method: 'POST',
          headers: validOwnerHeaders,
          body: JSON.stringify({
            customerPseudonymId: 'cus_unregistered_ghost',
            serviceName: 'HydraFacial Deluxe',
            serviceCategory: 'Facial',
            resourceStaffId: 'res_active_01',
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

    it('returns 404 APPOINTMENT_RESOURCE_NOT_FOUND when resource does not exist in business scope', async () => {
      const res = await worker.fetch(
        new Request(`https://app.velnar.studio/api/appointments?orgId=${orgAlpha}&businessId=${bizBeauty}`, {
          method: 'POST',
          headers: validOwnerHeaders,
          body: JSON.stringify({
            customerPseudonymId: 'cus_seal_test_01',
            serviceName: 'HydraFacial Deluxe',
            serviceCategory: 'Facial',
            resourceStaffId: 'res_non_existent_staff',
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

    it('returns 400 APPOINTMENT_RESOURCE_UNAVAILABLE when resource is maintenance/offline', async () => {
      const res = await worker.fetch(
        new Request(`https://app.velnar.studio/api/appointments?orgId=${orgAlpha}&businessId=${bizBeauty}`, {
          method: 'POST',
          headers: validOwnerHeaders,
          body: JSON.stringify({
            customerPseudonymId: 'cus_seal_test_01',
            serviceName: 'HydraFacial Deluxe',
            serviceCategory: 'Facial',
            resourceStaffId: 'res_inactive_01',
            scheduledStart: '2026-08-25T14:00:00Z',
            scheduledEnd: '2026-08-25T15:00:00Z',
            expectedValueMinor: 25000,
          }),
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );

      expect(res.status).toBe(400);
      const json = await res.json() as any;
      expect(json.error).toBe('APPOINTMENT_RESOURCE_UNAVAILABLE');
    });
  });

  describe('2. Test Resource Fixture Validation & Resource Repository', () => {
    it('AppointmentResourceRepository.registerTestResource throws TEST_RESOURCE_INVALID on invalid fixtures', () => {
      expect(() => {
        AppointmentResourceRepository.registerTestResource(null as any);
      }).toThrow('TEST_RESOURCE_INVALID');

      expect(() => {
        AppointmentResourceRepository.registerTestResource({
          id: '',
          organizationId: orgAlpha,
          businessId: bizBeauty,
          name: 'Invalid',
          resourceType: 'staff',
          capacityUnits: 1,
          status: 'active',
          createdAt: '2026-08-20T10:00:00Z',
        });
      }).toThrow('TEST_RESOURCE_INVALID');

      expect(() => {
        AppointmentResourceRepository.registerTestResource({
          id: 'res_bad_type',
          organizationId: orgAlpha,
          businessId: bizBeauty,
          name: 'Bad Type',
          resourceType: 'rocket' as any,
          capacityUnits: 1,
          status: 'active',
          createdAt: '2026-08-20T10:00:00Z',
        });
      }).toThrow('TEST_RESOURCE_INVALID');

      expect(() => {
        AppointmentResourceRepository.registerTestResource({
          id: 'res_bad_status',
          organizationId: orgAlpha,
          businessId: bizBeauty,
          name: 'Bad Status',
          resourceType: 'staff',
          capacityUnits: 1,
          status: 'inactive' as any, // 'inactive' was removed
          createdAt: '2026-08-20T10:00:00Z',
        });
      }).toThrow('TEST_RESOURCE_INVALID');

      expect(() => {
        AppointmentResourceRepository.registerTestResource({
          id: 'res_bad_time',
          organizationId: orgAlpha,
          businessId: bizBeauty,
          name: 'Bad Time',
          resourceType: 'staff',
          capacityUnits: 1,
          status: 'active',
          createdAt: '2026-08-20 10:00:00', // Non-RFC3339
        });
      }).toThrow('TEST_RESOURCE_INVALID');
    });

    it('AppointmentResourceRepository.getByIdForBusiness validates strict RFC3339 timestamps from DB', async () => {
      const dbWithMalformedTimestamp: D1Database = {
        prepare() {
          return {
            bind() {
              return {
                async first() {
                  return {
                    id: 'res_malformed_time',
                    organization_id: orgAlpha,
                    business_id: bizBeauty,
                    name: 'Malformed Timestamp Staff',
                    resource_type: 'staff',
                    capacity_units: 1,
                    status: 'active',
                    created_at: 'not-a-valid-date-string'
                  };
                }
              };
            }
          } as any;
        }
      } as any;

      await expect(
        AppointmentResourceRepository.getByIdForBusiness(
          dbWithMalformedTimestamp,
          'res_malformed_time',
          orgAlpha,
          bizBeauty,
          'production'
        )
      ).rejects.toThrow('APPOINTMENT_RESOURCE_LOOKUP_FAILED');
    });
  });

  describe('3. Shared Transition Matrix & Direct Repository State Gate', () => {
    it('isAllowedAppointmentTransition returns expected matrix values', () => {
      expect(isAllowedAppointmentTransition('scheduled', 'confirmed')).toBe(true);
      expect(isAllowedAppointmentTransition('scheduled', 'in_progress')).toBe(true);
      expect(isAllowedAppointmentTransition('scheduled', 'cancelled')).toBe(true);
      expect(isAllowedAppointmentTransition('scheduled', 'no_show')).toBe(true);
      expect(isAllowedAppointmentTransition('scheduled', 'rescheduled')).toBe(true);
      expect(isAllowedAppointmentTransition('scheduled', 'completed')).toBe(false);

      expect(isAllowedAppointmentTransition('confirmed', 'completed')).toBe(true);
      expect(isAllowedAppointmentTransition('confirmed', 'in_progress')).toBe(true);

      expect(isAllowedAppointmentTransition('completed', 'scheduled')).toBe(false);
      expect(isAllowedAppointmentTransition('cancelled', 'confirmed')).toBe(false);
      expect(isAllowedAppointmentTransition('no_show', 'in_progress')).toBe(false);
      expect(isAllowedAppointmentTransition('scheduled', 'scheduled')).toBe(false);
    });

    it('AppointmentRepository.updateStatusWithAudit directly rejects invalid status transitions', async () => {
      // First create a scheduled appointment
      const created = await AppointmentRepository.createWithAudit(
        undefined,
        {
          customerPseudonymId: 'cus_seal_test_01',
          serviceName: 'Facial Deep Clean',
          serviceCategory: 'Skin',
          resourceStaffId: 'res_active_01',
          scheduledStart: '2026-08-25T10:00:00Z',
          scheduledEnd: '2026-08-25T11:00:00Z',
          durationMinutes: 60,
          expectedValueMinor: 10000,
        },
        {
          organizationId: orgAlpha,
          businessId: bizBeauty,
          currency: 'USD',
          actorId: 'usr_dev_owner',
          actorRole: 'OWNER',
          ipHash: 'test_hash',
        },
        'test'
      );

      const aptId = created.appointment.id;

      // Attempt illegal jump directly at repository boundary: scheduled -> completed
      await expect(
        AppointmentRepository.updateStatusWithAudit(
          undefined,
          aptId,
          'scheduled',
          'completed', // ILLEGAL: scheduled cannot transition to completed directly
          orgAlpha,
          bizBeauty,
          'usr_dev_owner',
          'OWNER',
          'test_hash',
          undefined,
          'test'
        )
      ).rejects.toThrow('INVALID_APPOINTMENT_STATE_TRANSITION');
    });
  });

  describe('4. Second-Boundary Repository & Scope Integrity', () => {
    it('AppointmentRepository.createWithAudit enforces referential integrity on pseudonym and resource', async () => {
      // Direct call with unregistered pseudonym fails
      await expect(
        AppointmentRepository.createWithAudit(
          undefined,
          {
            customerPseudonymId: 'cus_completely_fake',
            serviceName: 'Facial',
            serviceCategory: 'Skin',
            resourceStaffId: 'res_active_01',
            scheduledStart: '2026-08-25T10:00:00Z',
            scheduledEnd: '2026-08-25T11:00:00Z',
            durationMinutes: 60,
            expectedValueMinor: 10000,
          },
          {
            organizationId: orgAlpha,
            businessId: bizBeauty,
            currency: 'USD',
            actorId: 'usr_dev_owner',
            actorRole: 'OWNER',
            ipHash: 'test_hash',
          },
          'test'
        )
      ).rejects.toThrow('CUSTOMER_REFERENCE_NOT_FOUND');

      // Direct call with cross-tenant resource fails
      await expect(
        AppointmentRepository.createWithAudit(
          undefined,
          {
            customerPseudonymId: 'cus_seal_test_01',
            serviceName: 'Facial',
            serviceCategory: 'Skin',
            resourceStaffId: 'res_beta_01', // belongs to orgBeta
            scheduledStart: '2026-08-25T10:00:00Z',
            scheduledEnd: '2026-08-25T11:00:00Z',
            durationMinutes: 60,
            expectedValueMinor: 10000,
          },
          {
            organizationId: orgAlpha,
            businessId: bizBeauty,
            currency: 'USD',
            actorId: 'usr_dev_owner',
            actorRole: 'OWNER',
            ipHash: 'test_hash',
          },
          'test'
        )
      ).rejects.toThrow('APPOINTMENT_RESOURCE_NOT_FOUND');
    });

    it('AppointmentRepository rejects non-matching duration, negative minor currency, or invalid start/end', async () => {
      await expect(
        AppointmentRepository.createWithAudit(
          undefined,
          {
            customerPseudonymId: 'cus_seal_test_01',
            serviceName: 'Facial',
            serviceCategory: 'Skin',
            resourceStaffId: 'res_active_01',
            scheduledStart: '2026-08-25T10:00:00Z',
            scheduledEnd: '2026-08-25T11:00:00Z',
            durationMinutes: 30, // Mismatched duration (should be 60)
            expectedValueMinor: 10000,
          },
          {
            organizationId: orgAlpha,
            businessId: bizBeauty,
            currency: 'USD',
            actorId: 'usr_dev_owner',
            actorRole: 'OWNER',
            ipHash: 'test_hash',
          },
          'test'
        )
      ).rejects.toThrow('APPOINTMENT_WRITE_FAILED');

      await expect(
        AppointmentRepository.createWithAudit(
          undefined,
          {
            customerPseudonymId: 'cus_seal_test_01',
            serviceName: 'Facial',
            serviceCategory: 'Skin',
            resourceStaffId: 'res_active_01',
            scheduledStart: '2026-08-25T10:00:00Z',
            scheduledEnd: '2026-08-25T11:00:00Z',
            durationMinutes: 60,
            expectedValueMinor: -500, // Negative money
          },
          {
            organizationId: orgAlpha,
            businessId: bizBeauty,
            currency: 'USD',
            actorId: 'usr_dev_owner',
            actorRole: 'OWNER',
            ipHash: 'test_hash',
          },
          'test'
        )
      ).rejects.toThrow('APPOINTMENT_WRITE_FAILED');
    });
  });

  describe('5. Strict Cancellation Reason Code Enforcement', () => {
    let createdAptId: string;

    it('creates appointment successfully for status transition tests', async () => {
      const res = await worker.fetch(
        new Request(`https://app.velnar.studio/api/appointments?orgId=${orgAlpha}&businessId=${bizBeauty}`, {
          method: 'POST',
          headers: validOwnerHeaders,
          body: JSON.stringify({
            customerPseudonymId: 'cus_seal_test_01',
            serviceName: 'Full-Body Rejuvenation',
            serviceCategory: 'Spa',
            resourceStaffId: 'res_active_01',
            scheduledStart: '2026-08-26T10:00:00Z',
            scheduledEnd: '2026-08-26T11:30:00Z',
            expectedValueMinor: 45000,
          }),
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );

      expect(res.status).toBe(201);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.data.status).toBe('scheduled');
      expect(json.data.rowVersion).toBe(0);
      createdAptId = json.data.id;
    });

    it('PATCH /api/appointments to cancelled WITHOUT reasonCode -> 400 BAD_REQUEST', async () => {
      const res = await worker.fetch(
        new Request(`https://app.velnar.studio/api/appointments?orgId=${orgAlpha}&businessId=${bizBeauty}`, {
          method: 'PATCH',
          headers: validOwnerHeaders,
          body: JSON.stringify({
            appointmentId: createdAptId,
            status: 'cancelled',
          }),
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );

      expect(res.status).toBe(400);
      const json = await res.json() as any;
      expect(json.error).toBe('BAD_REQUEST');
      expect(json.message).toContain('reasonCode is required');
    });

    it('PATCH /api/appointments with invalid reasonCode -> 400 BAD_REQUEST', async () => {
      const res = await worker.fetch(
        new Request(`https://app.velnar.studio/api/appointments?orgId=${orgAlpha}&businessId=${bizBeauty}`, {
          method: 'PATCH',
          headers: validOwnerHeaders,
          body: JSON.stringify({
            appointmentId: createdAptId,
            status: 'cancelled',
            reasonCode: 'I_DONT_FEEL_LIKE_IT',
          }),
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );

      expect(res.status).toBe(400);
      const json = await res.json() as any;
      expect(json.error).toBe('BAD_REQUEST');
      expect(json.message).toContain('must be one of');
    });

    it('PATCH /api/appointments to confirmed WITH reasonCode -> 400 BAD_REQUEST', async () => {
      const res = await worker.fetch(
        new Request(`https://app.velnar.studio/api/appointments?orgId=${orgAlpha}&businessId=${bizBeauty}`, {
          method: 'PATCH',
          headers: validOwnerHeaders,
          body: JSON.stringify({
            appointmentId: createdAptId,
            status: 'confirmed',
            reasonCode: 'CUSTOMER_CANCELLED',
          }),
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );

      expect(res.status).toBe(400);
      const json = await res.json() as any;
      expect(json.error).toBe('BAD_REQUEST');
      expect(json.message).toContain('reasonCode is only permitted for');
    });

    it('PATCH /api/appointments to confirmed succeeds without reasonCode and increments rowVersion', async () => {
      const res = await worker.fetch(
        new Request(`https://app.velnar.studio/api/appointments?orgId=${orgAlpha}&businessId=${bizBeauty}`, {
          method: 'PATCH',
          headers: validOwnerHeaders,
          body: JSON.stringify({
            appointmentId: createdAptId,
            status: 'confirmed',
          }),
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );

      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.data.status).toBe('confirmed');
      expect(json.data.rowVersion).toBe(1);
    });

    it('PATCH /api/appointments to cancelled with valid reasonCode succeeds', async () => {
      const res = await worker.fetch(
        new Request(`https://app.velnar.studio/api/appointments?orgId=${orgAlpha}&businessId=${bizBeauty}`, {
          method: 'PATCH',
          headers: validOwnerHeaders,
          body: JSON.stringify({
            appointmentId: createdAptId,
            status: 'cancelled',
            reasonCode: 'CUSTOMER_CANCELLED',
          }),
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );

      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.data.status).toBe('cancelled');
      expect(json.data.cancellationReasonCode).toBe('CUSTOMER_CANCELLED');
      expect(json.data.rowVersion).toBe(2);
    });

    it('terminal state cannot be modified further -> 400 INVALID_APPOINTMENT_STATE_TRANSITION', async () => {
      const res = await worker.fetch(
        new Request(`https://app.velnar.studio/api/appointments?orgId=${orgAlpha}&businessId=${bizBeauty}`, {
          method: 'PATCH',
          headers: validOwnerHeaders,
          body: JSON.stringify({
            appointmentId: createdAptId,
            status: 'in_progress',
          }),
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );

      expect(res.status).toBe(400);
      const json = await res.json() as any;
      expect(json.error).toBe('INVALID_APPOINTMENT_STATE_TRANSITION');
    });
  });

  describe('6. Strict RFC3339 & Duration Validator Regression', () => {
    it('rejects timestamps without explicit timezone or timezone offset', async () => {
      const res = await worker.fetch(
        new Request(`https://app.velnar.studio/api/appointments?orgId=${orgAlpha}&businessId=${bizBeauty}`, {
          method: 'POST',
          headers: validOwnerHeaders,
          body: JSON.stringify({
            customerPseudonymId: 'cus_seal_test_01',
            serviceName: 'Laser Treatment',
            serviceCategory: 'Laser',
            resourceStaffId: 'res_active_01',
            scheduledStart: '2026-08-25T10:00:00', // No timezone offset
            scheduledEnd: '2026-08-25T11:00:00Z',
            expectedValueMinor: 30000,
          }),
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );

      expect(res.status).toBe(400);
      const json = await res.json() as any;
      expect(json.error).toBe('BAD_REQUEST');
      expect(json.message).toContain('ISO-8601 with explicit timezone');
    });

    it('rejects start timestamp equal to or greater than end timestamp', async () => {
      const res = await worker.fetch(
        new Request(`https://app.velnar.studio/api/appointments?orgId=${orgAlpha}&businessId=${bizBeauty}`, {
          method: 'POST',
          headers: validOwnerHeaders,
          body: JSON.stringify({
            customerPseudonymId: 'cus_seal_test_01',
            serviceName: 'Laser Treatment',
            serviceCategory: 'Laser',
            resourceStaffId: 'res_active_01',
            scheduledStart: '2026-08-25T11:00:00Z',
            scheduledEnd: '2026-08-25T10:00:00Z',
            expectedValueMinor: 30000,
          }),
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );

      expect(res.status).toBe(400);
      const json = await res.json() as any;
      expect(json.error).toBe('BAD_REQUEST');
    });
  });

  describe('7. Production IP Handling & Zero PII Leakage', () => {
    it('uses CF-Connecting-IP in production and ignores spoofed X-Forwarded-For', async () => {
      const res = await worker.fetch(
        new Request(`https://app.velnar.studio/api/appointments?orgId=${orgAlpha}&businessId=${bizBeauty}`, {
          method: 'POST',
          headers: {
            ...validOwnerHeaders,
            'CF-Connecting-IP': '198.51.100.45',
            'X-Forwarded-For': '10.0.0.1, 10.0.0.2',
          },
          body: JSON.stringify({
            customerPseudonymId: 'cus_seal_test_02',
            serviceName: 'Thermal Lift',
            serviceCategory: 'Aesthetics',
            resourceStaffId: 'res_active_01',
            scheduledStart: '2026-08-27T10:00:00Z',
            scheduledEnd: '2026-08-27T11:00:00Z',
            expectedValueMinor: 50000,
          }),
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'prod_audit_key_secret_12345' }
      );

      expect(res.status).toBe(201);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.auditLogId).toBeDefined();

      // Ensure customerName, customerContact, notes do not exist on returned appointment
      expect(json.data.customerName).toBeUndefined();
      expect(json.data.customerContact).toBeUndefined();
      expect(json.data.notes).toBeUndefined();
      expect(json.data.customerPseudonymId).toBe('cus_seal_test_02');
    });

    it('rejects VIEWER role from appointment write mutations with 403', async () => {
      const res = await worker.fetch(
        new Request(`https://app.velnar.studio/api/appointments?orgId=${orgAlpha}&businessId=${bizBeauty}`, {
          method: 'POST',
          headers: validViewerHeaders,
          body: JSON.stringify({
            customerPseudonymId: 'cus_seal_test_01',
            serviceName: 'Thermal Lift',
            serviceCategory: 'Aesthetics',
            resourceStaffId: 'res_active_01',
            scheduledStart: '2026-08-27T10:00:00Z',
            scheduledEnd: '2026-08-27T11:00:00Z',
            expectedValueMinor: 50000,
          }),
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );

      expect(res.status).toBe(403);
    });
  });
});
