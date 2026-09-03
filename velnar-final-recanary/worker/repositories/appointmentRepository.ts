/**
 * @file appointmentRepository.ts
 * @description Tenant-Scoped & Business-Scoped Cloudflare D1 Appointment Repository
 * 
 * ============================================================================
 * ARCHITECTURAL MANDATES:
 * 1. Strict tenant & business isolation: WHERE id = ? AND organization_id = ? AND business_id = ?
 * 2. Strict Integer Minor Units for money (expected_value_minor).
 * 3. Zero raw PII in appointments table (strictly pseudonymous customer ID, no customer name, no notes).
 * 4. Atomic D1 batch execution for state mutations + conditional audit log trails.
 * 5. Optimistic concurrency tokens (row_version + last_transition_id) to eliminate stale-mutation audit orphans.
 * 6. Direct command re-validation at repository second boundary.
 * 7. Canonical reason codes only ('CUSTOMER_CANCELLED', 'NO_SHOW_CONFIRMED', etc.), zero free-text.
 * 8. D1 Read operations throw APPOINTMENT_READ_FAILED, write operations throw APPOINTMENT_WRITE_FAILED.
 * ============================================================================
 */

import { Appointment, AppointmentSource, AppointmentStatus, CancellationReasonCode } from '../../src/types/appointment';
import { AuditLogRow, UserRole } from '../../src/types/database';
import { isValidIsoWithTimezone } from '../utils/rfc3339Validator';
import { IdentityVaultRepository } from './identityVaultRepository';
import { AppointmentResourceRepository } from './appointmentResourceRepository';

export { isValidIsoWithTimezone };
export type { AppointmentStatus, AppointmentSource, CancellationReasonCode };

const CANONICAL_USER_ROLES = new Set<string>(['OWNER', 'ADMIN', 'MANAGER', 'STAFF', 'VIEWER']);

export function isValidUserRole(role: unknown): role is UserRole {
  return typeof role === 'string' && CANONICAL_USER_ROLES.has(role);
}

const CANONICAL_APPOINTMENT_SOURCES = new Set<string>([
  'velnar_manual',
  'google_calendar',
  'external_provider',
  'opentable',
  'pos',
  'api',
  'web_booking_widget'
]);

export function isValidAppointmentSource(source: unknown): source is AppointmentSource {
  return typeof source === 'string' && CANONICAL_APPOINTMENT_SOURCES.has(source);
}

export const CANONICAL_CANCELLATION_REASON_CODES = new Set<string>([
  'CUSTOMER_CANCELLED',
  'NO_SHOW_CONFIRMED',
  'SCHEDULE_CONFLICT',
  'RESOURCE_UNAVAILABLE',
  'DUPLICATE_BOOKING',
  'OTHER_UNSPECIFIED'
]);

export function isValidCancellationReasonCode(code: unknown): code is CancellationReasonCode {
  return typeof code === 'string' && CANONICAL_CANCELLATION_REASON_CODES.has(code);
}

export const CANONICAL_APPOINTMENT_STATUSES = new Set<string>([
  'scheduled',
  'confirmed',
  'in_progress',
  'completed',
  'cancelled',
  'no_show',
  'rescheduled'
]);

export function isValidAppointmentStatus(status: unknown): status is AppointmentStatus {
  return typeof status === 'string' && CANONICAL_APPOINTMENT_STATUSES.has(status);
}

export const ALLOWED_APPOINTMENT_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  scheduled: ['confirmed', 'in_progress', 'cancelled', 'no_show', 'rescheduled'],
  confirmed: ['in_progress', 'completed', 'cancelled', 'no_show', 'rescheduled'],
  in_progress: ['completed', 'cancelled'],
  rescheduled: ['scheduled', 'confirmed', 'cancelled', 'no_show'],
  completed: [],
  cancelled: [],
  no_show: []
};

export function isAllowedAppointmentTransition(
  previousStatus: AppointmentStatus,
  targetStatus: AppointmentStatus
): boolean {
  if (!isValidAppointmentStatus(previousStatus) || !isValidAppointmentStatus(targetStatus)) {
    return false;
  }
  if (previousStatus === targetStatus) {
    return false;
  }
  const allowed = ALLOWED_APPOINTMENT_TRANSITIONS[previousStatus];
  return Array.isArray(allowed) && allowed.includes(targetStatus);
}

export interface CreateAppointmentCommand {
  customerPseudonymId: string;
  serviceName: string;
  serviceCategory: string;
  resourceStaffId: string;
  scheduledStart: string;
  scheduledEnd: string;
  durationMinutes: number;
  expectedValueMinor: number;
}

export interface AppointmentWriteScope {
  organizationId: string;
  businessId: string;
  currency: 'TRY' | 'USD' | 'EUR';
  actorId: string;
  actorRole: UserRole;
  ipHash: string;
}

export function validateAndMapAppointmentRow(r: any): Appointment {
  if (
    !r ||
    !r.id || typeof r.id !== 'string' || r.id.trim().length === 0 ||
    !r.organization_id || typeof r.organization_id !== 'string' || r.organization_id.trim().length === 0 ||
    !r.business_id || typeof r.business_id !== 'string' || r.business_id.trim().length === 0 ||
    !r.pseudonymous_customer_id || typeof r.pseudonymous_customer_id !== 'string' || r.pseudonymous_customer_id.trim().length === 0 ||
    !r.service_name || typeof r.service_name !== 'string' || r.service_name.trim().length === 0 ||
    !r.service_category || typeof r.service_category !== 'string' || r.service_category.trim().length === 0 ||
    !r.resource_staff_name || typeof r.resource_staff_name !== 'string' || r.resource_staff_name.trim().length === 0 ||
    !isValidIsoWithTimezone(r.scheduled_start) ||
    !isValidIsoWithTimezone(r.scheduled_end) ||
    typeof r.duration_minutes !== 'number' ||
    !Number.isSafeInteger(r.duration_minutes) ||
    r.duration_minutes <= 0 ||
    r.duration_minutes > 1440 ||
    typeof r.expected_value_minor !== 'number' ||
    !Number.isSafeInteger(r.expected_value_minor) ||
    r.expected_value_minor < 0 ||
    (r.currency !== 'TRY' && r.currency !== 'USD' && r.currency !== 'EUR') ||
    !isValidAppointmentStatus(r.status) ||
    !isValidAppointmentSource(r.source) ||
    typeof r.row_version !== 'number' ||
    !Number.isSafeInteger(r.row_version) ||
    r.row_version < 0
  ) {
    throw new Error('APPOINTMENT_READ_FAILED');
  }

  const startTime = Date.parse(r.scheduled_start);
  const endTime = Date.parse(r.scheduled_end);
  if (isNaN(startTime) || isNaN(endTime) || endTime <= startTime) {
    throw new Error('APPOINTMENT_READ_FAILED');
  }

  const diffMs = endTime - startTime;
  if (diffMs % 60000 !== 0) {
    throw new Error('APPOINTMENT_READ_FAILED');
  }

  const calculatedMinutes = diffMs / 60000;
  if (r.duration_minutes !== calculatedMinutes) {
    throw new Error('APPOINTMENT_READ_FAILED');
  }

  let cancellationReasonCode: CancellationReasonCode | undefined = undefined;
  if (r.cancellation_reason !== null && r.cancellation_reason !== undefined) {
    if (isValidCancellationReasonCode(r.cancellation_reason)) {
      cancellationReasonCode = r.cancellation_reason;
    } else {
      throw new Error('APPOINTMENT_READ_FAILED');
    }
  }

  return {
    id: r.id,
    organizationId: r.organization_id,
    businessId: r.business_id,
    customerPseudonymId: r.pseudonymous_customer_id,
    serviceName: r.service_name,
    serviceCategory: r.service_category,
    resourceStaffId: r.resource_staff_id || undefined,
    resourceStaffName: r.resource_staff_name,
    scheduledStart: r.scheduled_start,
    scheduledEnd: r.scheduled_end,
    durationMinutes: r.duration_minutes,
    expectedValueMinor: r.expected_value_minor,
    currency: r.currency,
    status: r.status as AppointmentStatus,
    source: r.source,
    rowVersion: r.row_version,
    externalReferenceId: r.external_reference_id || undefined,
    cancellationReasonCode,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export class AppointmentRepository {
  private static assertDbOrDev(db: D1Database | undefined, environment: string = 'production'): void {
    if (!db) {
      const isDevOrTest = environment === 'development' || environment === 'test';
      if (!isDevOrTest) {
        throw new Error('DATABASE_NOT_CONFIGURED');
      }
    }
  }

  private static memAppointments: Appointment[] = [
    {
      id: 'apt_01',
      organizationId: 'org_apex_holding',
      businessId: 'biz_beauty_salon',
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
      rowVersion: 0,
      createdAt: '2026-08-23T12:00:00Z',
      updatedAt: '2026-08-24T08:00:00Z',
    },
    {
      id: 'apt_02',
      organizationId: 'org_apex_holding',
      businessId: 'biz_beauty_salon',
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
      rowVersion: 0,
      cancellationReasonCode: 'NO_SHOW_CONFIRMED',
      createdAt: '2026-08-22T09:00:00Z',
      updatedAt: '2026-08-24T15:00:00Z',
    }
  ];

  public static async listByBusiness(
    db: D1Database | undefined,
    orgId: string,
    businessId: string,
    environment: string = 'production'
  ): Promise<Appointment[]> {
    AppointmentRepository.assertDbOrDev(db, environment);

    if (!orgId || !businessId) {
      throw new Error('APPOINTMENT_READ_FAILED');
    }

    if (db) {
      try {
        const query = `
          SELECT id, organization_id, business_id, pseudonymous_customer_id,
                 service_name, service_category, resource_staff_id, resource_staff_name,
                 scheduled_start, scheduled_end, duration_minutes, expected_value_minor,
                 currency, status, source, row_version,
                 external_reference_id, cancellation_reason,
                 created_at, updated_at
          FROM appointments
          WHERE organization_id = ? AND business_id = ?
          ORDER BY scheduled_start DESC
        `;

        const { results } = await db.prepare(query).bind(orgId, businessId).all<any>();

        const mapped: Appointment[] = [];
        for (const r of (results || [])) {
          mapped.push(validateAndMapAppointmentRow(r));
        }

        return mapped;
      } catch (err: any) {
        if (err?.message === 'APPOINTMENT_READ_FAILED') {
          throw err;
        }
        throw new Error('APPOINTMENT_READ_FAILED');
      }
    }

    return AppointmentRepository.memAppointments.filter(
      a => a.organizationId === orgId && a.businessId === businessId
    );
  }

  public static async getByIdForBusiness(
    db: D1Database | undefined,
    appointmentId: string,
    orgId: string,
    businessId: string,
    environment: string = 'production'
  ): Promise<Appointment | null> {
    AppointmentRepository.assertDbOrDev(db, environment);

    if (!appointmentId || !orgId || !businessId) {
      return null;
    }

    if (db) {
      try {
        const r = await db.prepare(`
          SELECT id, organization_id, business_id, pseudonymous_customer_id,
                 service_name, service_category, resource_staff_id, resource_staff_name,
                 scheduled_start, scheduled_end, duration_minutes, expected_value_minor,
                 currency, status, source, row_version,
                 external_reference_id, cancellation_reason,
                 created_at, updated_at
          FROM appointments
          WHERE id = ? AND organization_id = ? AND business_id = ?
        `).bind(appointmentId, orgId, businessId).first<any>();

        if (!r) return null;

        return validateAndMapAppointmentRow(r);
      } catch (err: any) {
        if (err?.message === 'APPOINTMENT_READ_FAILED') {
          throw err;
        }
        throw new Error('APPOINTMENT_READ_FAILED');
      }
    }

    const apt = AppointmentRepository.memAppointments.find(
      a => a.id === appointmentId && a.organizationId === orgId && a.businessId === businessId
    );
    return apt || null;
  }

  public static async createWithAudit(
    db: D1Database | undefined,
    command: CreateAppointmentCommand,
    scope: AppointmentWriteScope,
    environment: string = 'production'
  ): Promise<{ appointment: Appointment; auditLog: AuditLogRow }> {
    AppointmentRepository.assertDbOrDev(db, environment);

    // 1. Validate Scope
    if (!scope.organizationId || typeof scope.organizationId !== 'string' || scope.organizationId.trim().length === 0 ||
        !scope.businessId || typeof scope.businessId !== 'string' || scope.businessId.trim().length === 0 ||
        !scope.actorId || typeof scope.actorId !== 'string' || scope.actorId.trim().length === 0 ||
        !scope.ipHash || typeof scope.ipHash !== 'string' || scope.ipHash.trim().length === 0) {
      throw new Error('APPOINTMENT_WRITE_FAILED');
    }

    if (!isValidUserRole(scope.actorRole)) {
      throw new Error('AUTHORIZATION_CONTEXT_INVALID');
    }

    if (scope.currency !== 'TRY' && scope.currency !== 'USD' && scope.currency !== 'EUR') {
      throw new Error('APPOINTMENT_WRITE_FAILED');
    }

    // 2. Validate Command Fields (format and boundaries)
    if (!command.customerPseudonymId || typeof command.customerPseudonymId !== 'string' ||
        command.customerPseudonymId.trim().length === 0 || command.customerPseudonymId.trim().length > 128 ||
        !command.serviceName || typeof command.serviceName !== 'string' ||
        command.serviceName.trim().length === 0 || command.serviceName.trim().length > 256 ||
        !command.serviceCategory || typeof command.serviceCategory !== 'string' ||
        command.serviceCategory.trim().length === 0 || command.serviceCategory.trim().length > 128 ||
        !command.resourceStaffId || typeof command.resourceStaffId !== 'string' ||
        command.resourceStaffId.trim().length === 0 || command.resourceStaffId.trim().length > 128) {
      throw new Error('APPOINTMENT_WRITE_FAILED');
    }

    // 3. Validate Strict Timestamps and Integer Minutes
    if (!isValidIsoWithTimezone(command.scheduledStart) || !isValidIsoWithTimezone(command.scheduledEnd)) {
      throw new Error('APPOINTMENT_WRITE_FAILED');
    }

    const startTime = Date.parse(command.scheduledStart);
    const endTime = Date.parse(command.scheduledEnd);
    if (isNaN(startTime) || isNaN(endTime) || endTime <= startTime) {
      throw new Error('APPOINTMENT_WRITE_FAILED');
    }

    const diffMs = endTime - startTime;
    if (diffMs % 60000 !== 0) {
      throw new Error('APPOINTMENT_WRITE_FAILED');
    }

    const derivedMinutes = diffMs / 60000;
    if (typeof command.durationMinutes !== 'number' || !Number.isSafeInteger(command.durationMinutes) ||
        command.durationMinutes <= 0 || command.durationMinutes > 1440 ||
        command.durationMinutes !== derivedMinutes) {
      throw new Error('APPOINTMENT_WRITE_FAILED');
    }

    // 4. Validate Money
    if (typeof command.expectedValueMinor !== 'number' || !Number.isSafeInteger(command.expectedValueMinor) || command.expectedValueMinor < 0) {
      throw new Error('APPOINTMENT_WRITE_FAILED');
    }

    // 5. Referential Integrity & Defense-in-Depth at Repository Boundary:
    // A. Verify customerPseudonymId exists under scope.organizationId
    const pseudonymExists = await IdentityVaultRepository.existsPseudonym(
      db,
      command.customerPseudonymId.trim(),
      scope.organizationId.trim(),
      environment
    );
    if (!pseudonymExists) {
      throw new Error('CUSTOMER_REFERENCE_NOT_FOUND');
    }

    // B. Resolve resourceStaffId under exact scope.organizationId and scope.businessId
    const canonicalResource = await AppointmentResourceRepository.getByIdForBusiness(
      db,
      command.resourceStaffId.trim(),
      scope.organizationId.trim(),
      scope.businessId.trim(),
      environment
    );
    if (!canonicalResource) {
      throw new Error('APPOINTMENT_RESOURCE_NOT_FOUND');
    }

    if (canonicalResource.status !== 'active') {
      throw new Error('APPOINTMENT_RESOURCE_UNAVAILABLE');
    }

    const resourceStaffName = canonicalResource.name;

    const id = `apt_${crypto.randomUUID()}`;
    const auditId = `aud_${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    const newAppointment: Appointment = {
      id,
      organizationId: scope.organizationId.trim(),
      businessId: scope.businessId.trim(),
      customerPseudonymId: command.customerPseudonymId.trim(),
      serviceName: command.serviceName.trim(),
      serviceCategory: command.serviceCategory.trim(),
      resourceStaffId: command.resourceStaffId.trim(),
      resourceStaffName,
      scheduledStart: command.scheduledStart,
      scheduledEnd: command.scheduledEnd,
      durationMinutes: command.durationMinutes,
      expectedValueMinor: command.expectedValueMinor,
      currency: scope.currency,
      status: 'scheduled',
      source: 'velnar_manual',
      rowVersion: 0,
      createdAt: now,
      updatedAt: now,
    };

    // Safe operational diff - zero customer PII
    const auditPayload = JSON.stringify({
      serviceName: newAppointment.serviceName,
      serviceCategory: newAppointment.serviceCategory,
      resourceStaffId: newAppointment.resourceStaffId,
      resourceStaffName: newAppointment.resourceStaffName,
      scheduledStart: newAppointment.scheduledStart,
      scheduledEnd: newAppointment.scheduledEnd,
      durationMinutes: newAppointment.durationMinutes,
      expectedValueMinor: newAppointment.expectedValueMinor,
      currency: newAppointment.currency,
      status: 'scheduled',
    });

    const auditLog: AuditLogRow = {
      id: auditId,
      organization_id: scope.organizationId.trim(),
      business_id: scope.businessId.trim(),
      actor_id: scope.actorId.trim(),
      actor_role: scope.actorRole,
      action: 'appointment.created',
      target_entity_type: 'appointment',
      target_entity_id: id,
      payload_diff_json: auditPayload,
      ip_hash: scope.ipHash.trim(),
      created_at: now,
    };

    if (db) {
      try {
        const insertAptStmt = db.prepare(`
          INSERT INTO appointments (
            id, organization_id, business_id, pseudonymous_customer_id,
            service_name, service_category, resource_staff_id, resource_staff_name,
            scheduled_start, scheduled_end, duration_minutes, expected_value_minor,
            currency, status, source, row_version, last_transition_id,
            external_reference_id, cancellation_reason, notes,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL, NULL, ?, ?)
        `).bind(
          id,
          newAppointment.organizationId,
          newAppointment.businessId,
          newAppointment.customerPseudonymId,
          newAppointment.serviceName,
          newAppointment.serviceCategory,
          newAppointment.resourceStaffId,
          newAppointment.resourceStaffName,
          newAppointment.scheduledStart,
          newAppointment.scheduledEnd,
          newAppointment.durationMinutes,
          newAppointment.expectedValueMinor,
          newAppointment.currency,
          'scheduled',
          'velnar_manual',
          now,
          now
        );

        const insertAuditStmt = db.prepare(`
          INSERT INTO audit_logs (
            id, organization_id, business_id, actor_id, actor_role, action,
            target_entity_type, target_entity_id, payload_diff_json, ip_hash, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          auditId,
          auditLog.organization_id,
          auditLog.business_id,
          auditLog.actor_id,
          auditLog.actor_role,
          'appointment.created',
          'appointment',
          id,
          auditPayload,
          auditLog.ip_hash,
          now
        );

        const results = await db.batch([insertAptStmt, insertAuditStmt]);
        const aptChanges = results[0]?.meta?.changes ?? 0;
        const auditChanges = results[1]?.meta?.changes ?? 0;

        if (aptChanges !== 1 || auditChanges !== 1) {
          throw new Error('APPOINTMENT_WRITE_FAILED');
        }

        return { appointment: newAppointment, auditLog };
      } catch (err: any) {
        if (
          err?.message === 'AUTHORIZATION_CONTEXT_INVALID' ||
          err?.message === 'CUSTOMER_REFERENCE_NOT_FOUND' ||
          err?.message === 'IDENTITY_VAULT_LOOKUP_FAILED' ||
          err?.message === 'APPOINTMENT_RESOURCE_NOT_FOUND' ||
          err?.message === 'APPOINTMENT_RESOURCE_UNAVAILABLE' ||
          err?.message === 'APPOINTMENT_RESOURCE_LOOKUP_FAILED'
        ) {
          throw err;
        }
        throw new Error('APPOINTMENT_WRITE_FAILED');
      }
    }

    AppointmentRepository.memAppointments.unshift(newAppointment);
    return { appointment: newAppointment, auditLog };
  }

  public static async updateStatusWithAudit(
    db: D1Database | undefined,
    appointmentId: string,
    expectedPreviousStatus: AppointmentStatus,
    newStatus: AppointmentStatus,
    orgId: string,
    businessId: string,
    actorId: string,
    actorRole: UserRole,
    ipHash: string,
    reasonCode?: CancellationReasonCode,
    environment: string = 'production'
  ): Promise<{ appointment: Appointment; auditLog: AuditLogRow } | null> {
    AppointmentRepository.assertDbOrDev(db, environment);

    if (!orgId || !businessId || !actorId || !ipHash) {
      throw new Error('APPOINTMENT_WRITE_FAILED');
    }

    if (!isValidUserRole(actorRole)) {
      throw new Error('AUTHORIZATION_CONTEXT_INVALID');
    }

    if (!isValidAppointmentStatus(expectedPreviousStatus) || !isValidAppointmentStatus(newStatus)) {
      throw new Error('INVALID_APPOINTMENT_STATE_TRANSITION');
    }

    if (!isAllowedAppointmentTransition(expectedPreviousStatus, newStatus)) {
      throw new Error('INVALID_APPOINTMENT_STATE_TRANSITION');
    }

    if (newStatus === 'cancelled' || newStatus === 'no_show') {
      if (!reasonCode || !isValidCancellationReasonCode(reasonCode)) {
        throw new Error('INVALID_APPOINTMENT_REASON_CODE');
      }
    } else {
      if (reasonCode !== undefined && reasonCode !== null) {
        throw new Error('APPOINTMENT_WRITE_FAILED');
      }
    }

    if (expectedPreviousStatus === newStatus) {
      return null;
    }

    const existing = await AppointmentRepository.getByIdForBusiness(db, appointmentId, orgId, businessId, environment);
    if (!existing || existing.status !== expectedPreviousStatus) {
      return null;
    }

    if (!isAllowedAppointmentTransition(existing.status, newStatus)) {
      throw new Error('INVALID_APPOINTMENT_STATE_TRANSITION');
    }

    const expectedRowVersion = existing.rowVersion;
    if (typeof expectedRowVersion !== 'number' || !Number.isSafeInteger(expectedRowVersion) || expectedRowVersion < 0) {
      throw new Error('APPOINTMENT_READ_FAILED');
    }

    const auditId = `aud_${crypto.randomUUID()}`;
    const transitionId = auditId;
    const now = new Date().toISOString();
    const action = (newStatus === 'cancelled') 
      ? 'appointment.cancelled' 
      : (newStatus === 'no_show' ? 'appointment.no_show' : 'appointment.status_updated');

    const cleanReasonCode = (newStatus === 'cancelled' || newStatus === 'no_show') && reasonCode ? reasonCode : null;

    const auditPayload = JSON.stringify({
      previousStatus: existing.status,
      newStatus,
      reasonCode: cleanReasonCode,
    });

    const auditLog: AuditLogRow = {
      id: auditId,
      organization_id: orgId,
      business_id: businessId,
      actor_id: actorId,
      actor_role: actorRole,
      action,
      target_entity_type: 'appointment',
      target_entity_id: appointmentId,
      payload_diff_json: auditPayload,
      ip_hash: ipHash,
      created_at: now,
    };

    if (db) {
      try {
        const updateStmt = db.prepare(`
          UPDATE appointments
          SET status = ?,
              cancellation_reason = CASE WHEN ? IN ('cancelled', 'no_show') THEN COALESCE(?, cancellation_reason) ELSE cancellation_reason END,
              updated_at = ?,
              row_version = row_version + 1,
              last_transition_id = ?
          WHERE id = ?
            AND organization_id = ?
            AND business_id = ?
            AND status = ?
            AND row_version = ?
        `).bind(
          newStatus,
          newStatus,
          cleanReasonCode,
          now,
          transitionId,
          appointmentId,
          orgId,
          businessId,
          expectedPreviousStatus,
          expectedRowVersion
        );

        const auditStmt = db.prepare(`
          INSERT INTO audit_logs (
            id, organization_id, business_id, actor_id, actor_role, action,
            target_entity_type, target_entity_id, payload_diff_json, ip_hash, created_at
          )
          SELECT
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (
            SELECT 1 FROM appointments
            WHERE id = ?
              AND organization_id = ?
              AND business_id = ?
              AND last_transition_id = ?
              AND row_version = ?
              AND status = ?
          )
        `).bind(
          auditId,
          orgId,
          businessId,
          actorId,
          actorRole,
          action,
          'appointment',
          appointmentId,
          auditPayload,
          ipHash,
          now,
          appointmentId,
          orgId,
          businessId,
          transitionId,
          expectedRowVersion + 1,
          newStatus
        );

        const results = await db.batch([updateStmt, auditStmt]);
        const updateChanges = results[0]?.meta?.changes ?? 0;
        const auditChanges = results[1]?.meta?.changes ?? 0;

        // Strict atomicity gate: Both mutation and conditional audit must succeed, or neither
        if (updateChanges !== 1 || auditChanges !== 1) {
          return null;
        }

        const updated = await AppointmentRepository.getByIdForBusiness(db, appointmentId, orgId, businessId, environment);
        if (!updated || updated.status !== newStatus) {
          throw new Error('APPOINTMENT_WRITE_FAILED');
        }
        return { appointment: updated, auditLog };
      } catch (err: any) {
        if (
          err?.message === 'AUTHORIZATION_CONTEXT_INVALID' ||
          err?.message === 'APPOINTMENT_READ_FAILED' ||
          err?.message === 'INVALID_APPOINTMENT_REASON_CODE' ||
          err?.message === 'INVALID_APPOINTMENT_STATE_TRANSITION'
        ) {
          throw err;
        }
        throw new Error('APPOINTMENT_WRITE_FAILED');
      }
    }

    const index = AppointmentRepository.memAppointments.findIndex(
      a => a.id === appointmentId && a.organizationId === orgId && a.businessId === businessId
    );
    if (index === -1) return null;

    const memApt = AppointmentRepository.memAppointments[index];
    const memVersion = memApt.rowVersion;
    if (memApt.status !== expectedPreviousStatus || memVersion !== expectedRowVersion) {
      return null;
    }

    const updatedMem: Appointment = {
      ...memApt,
      status: newStatus,
      cancellationReasonCode: cleanReasonCode || memApt.cancellationReasonCode,
      rowVersion: memVersion + 1,
      updatedAt: now,
    };
    AppointmentRepository.memAppointments[index] = updatedMem;

    return { appointment: updatedMem, auditLog };
  }
}
