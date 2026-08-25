/**
 * @file appointmentRepository.ts
 * @description Tenant-Scoped Cloudflare D1 Appointment Repository
 * 
 * ============================================================================
 * ARCHITECTURAL MANDATES:
 * 1. Strict tenant isolation: Every query includes WHERE organization_id = ?
 * 2. Strict Integer Minor Units for money (expected_value_minor).
 * 3. Pseudonymous customer ID segregation (Zero raw PII in appointments table).
 * ============================================================================
 */

import { Appointment, AppointmentStatus } from '../../src/types/appointment';

export class AppointmentRepository {
  private static assertDbOrDev(db: D1Database | undefined, environment: string = 'production'): void {
    if (!db) {
      const isDevOrTest = environment === 'development' || environment === 'test';
      if (!isDevOrTest) {
        throw new Error('DATABASE_NOT_CONFIGURED: In-memory fallback in AppointmentRepository is prohibited in production.');
      }
    }
  }

  private static memAppointments: Appointment[] = [
    {
      id: 'apt_01',
      organizationId: 'org_apex_holding',
      businessId: 'biz_beauty_salon',
      customerName: 'Clara Vance',
      customerPseudonymId: 'cus_89a12e',
      serviceName: 'Full-Spectrum Hydro-Facial',
      serviceCategory: 'Aesthetic Treatment',
      resourceStaffId: 'stf_01',
      resourceStaffName: 'Elena Rostova (Master Esthetician)',
      scheduledStart: '2026-08-24T10:00:00Z',
      scheduledEnd: '2026-08-24T11:00:00Z',
      durationMinutes: 60,
      expectedValueMinor: 35000,
      currency: 'USD',
      status: 'confirmed',
      source: 'google_calendar',
      createdAt: '2026-08-23T12:00:00Z',
      updatedAt: '2026-08-24T08:00:00Z',
    },
    {
      id: 'apt_02',
      organizationId: 'org_apex_holding',
      businessId: 'biz_beauty_salon',
      customerName: 'Marcus Sterling',
      customerPseudonymId: 'cus_99b44a',
      serviceName: 'Laser Skin Rejuvenation Protocol',
      serviceCategory: 'Laser Therapy',
      resourceStaffId: 'stf_02',
      resourceStaffName: 'Dr. Aris Thorne',
      scheduledStart: '2026-08-24T14:30:00Z',
      scheduledEnd: '2026-08-24T15:30:00Z',
      durationMinutes: 60,
      expectedValueMinor: 85000,
      currency: 'USD',
      status: 'no_show',
      source: 'velnar_manual',
      cancellationReason: 'Uncontacted no-show after 20min wait window',
      createdAt: '2026-08-22T09:00:00Z',
      updatedAt: '2026-08-24T15:00:00Z',
    }
  ];

  public static async listByOrg(
    db: D1Database | undefined,
    orgId: string,
    businessId?: string,
    environment: string = 'production'
  ): Promise<Appointment[]> {
    AppointmentRepository.assertDbOrDev(db, environment);
    if (db) {
      let query = `
        SELECT id, organization_id, business_id, pseudonymous_customer_id,
               service_name, service_category, resource_staff_id, resource_staff_name,
               scheduled_start, scheduled_end, duration_minutes, expected_value_minor,
               currency, status, source, external_reference_id, cancellation_reason, notes,
               created_at, updated_at
        FROM appointments
        WHERE organization_id = ?
      `;
      const params: string[] = [orgId];
      if (businessId) {
        query += ` AND business_id = ?`;
        params.push(businessId);
      }
      query += ` ORDER BY scheduled_start DESC`;

      const { results } = await db.prepare(query).bind(...params).all<{
        id: string;
        organization_id: string;
        business_id: string;
        pseudonymous_customer_id: string;
        service_name: string;
        service_category: string;
        resource_staff_id: string;
        resource_staff_name: string;
        scheduled_start: string;
        scheduled_end: string;
        duration_minutes: number;
        expected_value_minor: number;
        currency: 'TRY' | 'USD' | 'EUR';
        status: AppointmentStatus;
        source: Appointment['source'];
        external_reference_id?: string;
        cancellation_reason?: string;
        notes?: string;
        created_at: string;
        updated_at: string;
      }>();

      return (results || []).map(r => ({
        id: r.id,
        organizationId: r.organization_id,
        businessId: r.business_id,
        customerName: r.pseudonymous_customer_id,
        customerPseudonymId: r.pseudonymous_customer_id,
        serviceName: r.service_name,
        serviceCategory: r.service_category,
        resourceStaffId: r.resource_staff_id,
        resourceStaffName: r.resource_staff_name,
        scheduledStart: r.scheduled_start,
        scheduledEnd: r.scheduled_end,
        durationMinutes: r.duration_minutes,
        expectedValueMinor: r.expected_value_minor,
        currency: r.currency,
        status: r.status,
        source: r.source,
        cancellationReason: r.cancellation_reason,
        notes: r.notes,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));
    }

    return AppointmentRepository.memAppointments.filter(a => {
      const orgMatch = a.organizationId === orgId;
      return businessId ? orgMatch && a.businessId === businessId : orgMatch;
    });
  }

  public static async getById(
    db: D1Database | undefined,
    appointmentId: string,
    orgId: string,
    environment: string = 'production'
  ): Promise<Appointment | null> {
    AppointmentRepository.assertDbOrDev(db, environment);
    if (db) {
      const r = await db.prepare(`
        SELECT id, organization_id, business_id, pseudonymous_customer_id,
               service_name, service_category, resource_staff_id, resource_staff_name,
               scheduled_start, scheduled_end, duration_minutes, expected_value_minor,
               currency, status, source, external_reference_id, cancellation_reason, notes,
               created_at, updated_at
        FROM appointments
        WHERE id = ? AND organization_id = ?
      `).bind(appointmentId, orgId).first<{
        id: string;
        organization_id: string;
        business_id: string;
        pseudonymous_customer_id: string;
        service_name: string;
        service_category: string;
        resource_staff_id: string;
        resource_staff_name: string;
        scheduled_start: string;
        scheduled_end: string;
        duration_minutes: number;
        expected_value_minor: number;
        currency: 'TRY' | 'USD' | 'EUR';
        status: AppointmentStatus;
        source: Appointment['source'];
        external_reference_id?: string;
        cancellation_reason?: string;
        notes?: string;
        created_at: string;
        updated_at: string;
      }>();

      if (!r) return null;
      return {
        id: r.id,
        organizationId: r.organization_id,
        businessId: r.business_id,
        customerName: r.pseudonymous_customer_id,
        customerPseudonymId: r.pseudonymous_customer_id,
        serviceName: r.service_name,
        serviceCategory: r.service_category,
        resourceStaffId: r.resource_staff_id,
        resourceStaffName: r.resource_staff_name,
        scheduledStart: r.scheduled_start,
        scheduledEnd: r.scheduled_end,
        durationMinutes: r.duration_minutes,
        expectedValueMinor: r.expected_value_minor,
        currency: r.currency,
        status: r.status,
        source: r.source,
        cancellationReason: r.cancellation_reason,
        notes: r.notes,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    }

    const apt = AppointmentRepository.memAppointments.find(a => a.id === appointmentId && a.organizationId === orgId);
    return apt || null;
  }

  public static async create(
    db: D1Database | undefined,
    data: Omit<Appointment, 'id' | 'createdAt' | 'updatedAt' | 'organizationId'>,
    orgId: string,
    environment: string = 'production'
  ): Promise<Appointment> {
    AppointmentRepository.assertDbOrDev(db, environment);
    const id = `apt_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const newAppointment: Appointment = {
      id,
      organizationId: orgId, // Always force server-side tenant ID
      createdAt: now,
      updatedAt: now,
      ...data,
    };

    if (db) {
      await db.prepare(`
        INSERT INTO appointments (
          id, organization_id, business_id, pseudonymous_customer_id,
          service_name, service_category, resource_staff_id, resource_staff_name,
          scheduled_start, scheduled_end, duration_minutes, expected_value_minor,
          currency, status, source, cancellation_reason, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id,
        orgId,
        data.businessId,
        data.customerPseudonymId || 'cus_anonymous',
        data.serviceName,
        data.serviceCategory || 'General',
        data.resourceStaffId || 'stf_01',
        data.resourceStaffName || 'Staff Member',
        data.scheduledStart,
        data.scheduledEnd,
        data.durationMinutes || 30,
        data.expectedValueMinor || 0,
        data.currency || 'USD',
        data.status || 'scheduled',
        data.source || 'velnar_manual',
        data.cancellationReason || null,
        data.notes || null,
        now,
        now
      ).run();
    } else {
      AppointmentRepository.memAppointments.unshift(newAppointment);
    }

    return newAppointment;
  }

  public static async updateStatus(
    db: D1Database | undefined,
    appointmentId: string,
    status: AppointmentStatus,
    orgId: string,
    reason?: string,
    environment: string = 'production'
  ): Promise<Appointment | null> {
    AppointmentRepository.assertDbOrDev(db, environment);
    const now = new Date().toISOString();

    if (db) {
      await db.prepare(`
        UPDATE appointments
        SET status = ?, cancellation_reason = COALESCE(?, cancellation_reason), updated_at = ?
        WHERE id = ? AND organization_id = ?
      `).bind(status, reason || null, now, appointmentId, orgId).run();

      return AppointmentRepository.getById(db, appointmentId, orgId, environment);
    }

    const index = AppointmentRepository.memAppointments.findIndex(a => a.id === appointmentId && a.organizationId === orgId);
    if (index === -1) return null;

    AppointmentRepository.memAppointments[index] = {
      ...AppointmentRepository.memAppointments[index],
      status,
      cancellationReason: reason || AppointmentRepository.memAppointments[index].cancellationReason,
      updatedAt: now,
    };
    return AppointmentRepository.memAppointments[index];
  }
}
