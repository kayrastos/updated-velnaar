/**
 * @file appointmentsRouter.ts
 * @description Server-Side Tenant-Guarded & Business-Scoped Appointments API Handler
 * 
 * ============================================================================
 * ARCHITECTURAL MANDATES:
 * 1. Business scope is route authority: GET/POST/PATCH require businessId in query scope.
 * 2. Authorize TenantGuard (org + actor) BEFORE any business lookup to prevent enumeration oracles.
 * 3. BusinessTenantGuard returns stable 404 BUSINESS_NOT_FOUND without cross-tenant existence disclosure.
 * 4. Customer pseudonym referential integrity: existsPseudonym() check in IdentityVaultRepository.
 * 5. Canonical resource resolution: resourceStaffId is required, name is server-derived from AppointmentResourceRepository.
 * 6. Body Allowlists for POST and PATCH with zero fallback repairs; customerName, notes, free-text reason forbidden.
 * 7. Canonical CancellationReasonCode enum only for cancellation transitions.
 * 8. Production audit IP source uses CF-Connecting-IP only (no X-Forwarded-For fallback).
 * 9. Atomic D1 batch execution for state transitions + conditional audit logging with optimistic concurrency guard.
 * ============================================================================
 */

import { AuthenticatedUser } from '../auth/authContext';
import { TenantGuard } from '../middleware/tenantGuard';
import { BusinessTenantGuard } from '../middleware/businessTenantGuard';
import { OrganizationRepository } from '../repositories/organizationRepository';
import { IdentityVaultRepository } from '../repositories/identityVaultRepository';
import { AppointmentResourceRepository } from '../repositories/appointmentResourceRepository';
import {
  AppointmentRepository,
  CANONICAL_CANCELLATION_REASON_CODES,
  CANONICAL_APPOINTMENT_STATUSES,
  isValidCancellationReasonCode,
  isValidAppointmentStatus,
  isAllowedAppointmentTransition,
} from '../repositories/appointmentRepository';
import { AppointmentStatus, CancellationReasonCode } from '../../src/types/appointment';
import { isValidIsoWithTimezone } from '../utils/rfc3339Validator';
import { AuditIpHasher } from '../security/auditIpHasher';
import { UserRole } from '../../src/types/database';

const ALLOWED_POST_FIELDS = new Set([
  'customerPseudonymId',
  'serviceName',
  'serviceCategory',
  'resourceStaffId',
  'scheduledStart',
  'scheduledEnd',
  'expectedValueMinor'
]);

const ALLOWED_PATCH_FIELDS = new Set([
  'appointmentId',
  'status',
  'reasonCode'
]);

export function resolveAppointmentAuditIpInput(req: Request, environment: string): string {
  if (environment === 'production') {
    return req.headers.get('CF-Connecting-IP') || 'UNKNOWN';
  }
  return req.headers.get('CF-Connecting-IP') || req.headers.get('X-Forwarded-For') || 'UNKNOWN';
}

export async function handleAppointmentsRoute(
  req: Request,
  user: AuthenticatedUser | null,
  url: URL,
  db?: D1Database,
  environment: string = 'production',
  auditIpSecret?: string
): Promise<Response> {
  const orgId = url.searchParams.get('orgId')?.trim() || req.headers.get('X-Tenant-Id')?.trim();
  if (!orgId) {
    return Response.json({
      error: 'TENANT_ID_REQUIRED',
      message: 'Organization ID is required and must be explicitly specified.',
    }, { status: 400 });
  }

  const rawBizId = url.searchParams.get('businessId')?.trim();
  if (!rawBizId) {
    return Response.json({
      error: 'BUSINESS_ID_REQUIRED',
      message: 'businessId is required in request parameters.',
    }, { status: 400 });
  }
  const businessId = rawBizId;

  // Resolve client IP securely
  const rawIp = resolveAppointmentAuditIpInput(req, environment);
  const ipHash = await AuditIpHasher.hashIp(rawIp, auditIpSecret, environment);

  // ============================================================================
  // GET /api/appointments
  // ============================================================================
  if (req.method === 'GET') {
    // 1. Authorize organization & action FIRST before touching business data
    const auth = TenantGuard.authorize(user, orgId, 'appointment.read');
    if (!auth.authorized) {
      return Response.json({ error: auth.errorMessage }, { status: auth.statusCode });
    }

    // 2. Verify business belongs to organization (distinguish 503 DB failure from 404 missing)
    const bizCheck = await BusinessTenantGuard.verifyBusinessBelongsToOrganization(
      db,
      orgId,
      businessId,
      environment
    );
    if (!bizCheck.valid) {
      if (bizCheck.statusCode === 503) {
        return Response.json({
          error: 'BUSINESS_SCOPE_LOOKUP_FAILED',
          message: 'Database error verifying business scope.',
        }, { status: 503 });
      }
      return Response.json({
        error: 'BUSINESS_NOT_FOUND',
        message: 'Business not found in organization scope.',
      }, { status: 404 });
    }

    try {
      const appointments = await AppointmentRepository.listByBusiness(db, orgId, businessId, environment);
      return Response.json({ data: appointments, orgId, businessId });
    } catch {
      return Response.json({
        error: 'APPOINTMENT_READ_FAILED',
        message: 'Failed to retrieve appointments.'
      }, { status: 500 });
    }
  }

  // ============================================================================
  // POST /api/appointments - Create Appointment
  // ============================================================================
  if (req.method === 'POST') {
    // 1. Authorize organization & action FIRST before business lookup
    const auth = TenantGuard.authorize(user, orgId, 'appointment.create');
    if (!auth.authorized) {
      return Response.json({ error: auth.errorMessage }, { status: auth.statusCode });
    }

    if (!user || !user.userId || typeof user.userId !== 'string' || user.userId.trim().length === 0 || !auth.role) {
      return Response.json({
        error: 'AUTHORIZATION_CONTEXT_INVALID',
        message: 'Authenticated user actor context is invalid.',
      }, { status: 403 });
    }
    const actorId = user.userId.trim();
    const actorRole = auth.role as UserRole;

    // 2. Verify business belongs to organization (distinguish 503 DB failure from 404 missing)
    const bizCheck = await BusinessTenantGuard.verifyBusinessBelongsToOrganization(
      db,
      orgId,
      businessId,
      environment
    );
    if (!bizCheck.valid) {
      if (bizCheck.statusCode === 503) {
        return Response.json({
          error: 'BUSINESS_SCOPE_LOOKUP_FAILED',
          message: 'Database error verifying business scope.',
        }, { status: 503 });
      }
      return Response.json({
        error: 'BUSINESS_NOT_FOUND',
        message: 'Business not found in organization scope.',
      }, { status: 404 });
    }

    let canonicalBusiness;
    try {
      canonicalBusiness = await OrganizationRepository.getBusinessById(
        db,
        orgId,
        businessId,
        environment
      );
    } catch (err: any) {
      return Response.json({
        error: 'BUSINESS_CONFIGURATION_UNAVAILABLE',
        message: 'Business configuration lookup service unavailable.',
      }, { status: 503 });
    }

    if (!canonicalBusiness) {
      return Response.json({
        error: 'BUSINESS_NOT_FOUND',
        message: 'Canonical business not found in organization scope.',
      }, { status: 404 });
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return Response.json({
        error: 'BAD_REQUEST',
        message: 'Request body must be a valid JSON object.'
      }, { status: 400 });
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return Response.json({
        error: 'BAD_REQUEST',
        message: 'Request body must be a valid non-array JSON object.'
      }, { status: 400 });
    }

    const bodyKeys = Object.keys(body);
    for (const key of bodyKeys) {
      if (!ALLOWED_POST_FIELDS.has(key)) {
        return Response.json({
          error: 'BAD_REQUEST',
          message: `Payload contains unrecognized or forbidden field: '${key}'.`
        }, { status: 400 });
      }
    }

    if (typeof body.customerPseudonymId !== 'string' || body.customerPseudonymId.trim().length === 0 || body.customerPseudonymId.trim().length > 128) {
      return Response.json({
        error: 'CUSTOMER_REFERENCE_REQUIRED',
        message: 'customerPseudonymId is required and must be a valid non-empty string.'
      }, { status: 400 });
    }
    const customerPseudonymId = body.customerPseudonymId.trim();

    // 3. Customer Pseudonym Referential Integrity Check (Identity Vault)
    try {
      const pseudonymExists = await IdentityVaultRepository.existsPseudonym(
        db,
        customerPseudonymId,
        orgId,
        environment
      );
      if (!pseudonymExists) {
        return Response.json({
          error: 'CUSTOMER_REFERENCE_NOT_FOUND',
          message: 'Customer pseudonym not found in organization identity vault.',
        }, { status: 404 });
      }
    } catch (err: any) {
      return Response.json({
        error: 'IDENTITY_VAULT_UNAVAILABLE',
        message: 'Identity vault lookup service unavailable.',
      }, { status: 503 });
    }

    if (typeof body.serviceName !== 'string' || body.serviceName.trim().length === 0 || body.serviceName.trim().length > 256) {
      return Response.json({
        error: 'BAD_REQUEST',
        message: 'serviceName is required and must be a non-empty string.'
      }, { status: 400 });
    }
    const serviceName = body.serviceName.trim();

    if (typeof body.serviceCategory !== 'string' || body.serviceCategory.trim().length === 0 || body.serviceCategory.trim().length > 128) {
      return Response.json({
        error: 'BAD_REQUEST',
        message: 'serviceCategory is required and must be a non-empty string.'
      }, { status: 400 });
    }
    const serviceCategory = body.serviceCategory.trim();

    if (typeof body.resourceStaffId !== 'string' || body.resourceStaffId.trim().length === 0) {
      return Response.json({
        error: 'BAD_REQUEST',
        message: 'resourceStaffId is required and must be a non-empty string.'
      }, { status: 400 });
    }
    const reqResourceId = body.resourceStaffId.trim();

    // 4. Canonical Resource Resolution & Availability Check
    let canonicalResource;
    try {
      canonicalResource = await AppointmentResourceRepository.getByIdForBusiness(
        db,
        reqResourceId,
        orgId,
        businessId,
        environment
      );
    } catch (err: any) {
      return Response.json({
        error: 'APPOINTMENT_RESOURCE_UNAVAILABLE',
        message: 'Appointment resource lookup service unavailable.',
      }, { status: 503 });
    }

    if (!canonicalResource) {
      return Response.json({
        error: 'APPOINTMENT_RESOURCE_NOT_FOUND',
        message: 'Appointment resource not found in business scope.',
      }, { status: 404 });
    }

    if (canonicalResource.status !== 'active') {
      return Response.json({
        error: 'APPOINTMENT_RESOURCE_UNAVAILABLE',
        message: `Appointment resource is currently '${canonicalResource.status}' and unavailable for bookings.`,
      }, { status: 400 });
    }

    const resourceStaffId = canonicalResource.id;

    if (!isValidIsoWithTimezone(body.scheduledStart) || !isValidIsoWithTimezone(body.scheduledEnd)) {
      return Response.json({
        error: 'BAD_REQUEST',
        message: 'Invalid start/end time or duration. Timestamps must be ISO-8601 with explicit timezone.'
      }, { status: 400 });
    }

    const startTime = Date.parse(body.scheduledStart);
    const endTime = Date.parse(body.scheduledEnd);
    if (endTime <= startTime) {
      return Response.json({
        error: 'BAD_REQUEST',
        message: 'Invalid start/end time or duration.'
      }, { status: 400 });
    }

    const diffMs = endTime - startTime;
    if (diffMs % 60000 !== 0) {
      return Response.json({
        error: 'BAD_REQUEST',
        message: 'Invalid start/end time or duration.'
      }, { status: 400 });
    }

    const durationMinutes = diffMs / 60000;
    if (durationMinutes <= 0 || durationMinutes > 1440) {
      return Response.json({
        error: 'BAD_REQUEST',
        message: 'Invalid start/end time or duration.'
      }, { status: 400 });
    }

    if (typeof body.expectedValueMinor !== 'number' || !Number.isSafeInteger(body.expectedValueMinor) || body.expectedValueMinor < 0) {
      return Response.json({
        error: 'BAD_REQUEST',
        message: 'expectedValueMinor is required and must be a non-negative safe integer.'
      }, { status: 400 });
    }
    const expectedValueMinor = body.expectedValueMinor;

    try {
      const result = await AppointmentRepository.createWithAudit(
        db,
        {
          customerPseudonymId,
          serviceName,
          serviceCategory,
          resourceStaffId,
          scheduledStart: body.scheduledStart,
          scheduledEnd: body.scheduledEnd,
          durationMinutes,
          expectedValueMinor,
        },
        {
          organizationId: orgId,
          businessId,
          currency: canonicalBusiness.currency as 'TRY' | 'USD' | 'EUR',
          actorId,
          actorRole,
          ipHash,
        },
        environment
      );

      return Response.json({
        success: true,
        data: result.appointment,
        auditLogId: result.auditLog.id,
        orgId
      }, { status: 201 });
    } catch (err: any) {
      const errMsg = err?.message;
      if (errMsg === 'AUTHORIZATION_CONTEXT_INVALID') {
        return Response.json({
          error: 'AUTHORIZATION_CONTEXT_INVALID',
          message: 'Authenticated actor context or role is invalid.',
        }, { status: 403 });
      }
      if (errMsg === 'CUSTOMER_REFERENCE_NOT_FOUND') {
        return Response.json({
          error: 'CUSTOMER_REFERENCE_NOT_FOUND',
          message: 'Customer pseudonym not found in organization identity vault.',
        }, { status: 404 });
      }
      if (errMsg === 'IDENTITY_VAULT_LOOKUP_FAILED') {
        return Response.json({
          error: 'IDENTITY_VAULT_UNAVAILABLE',
          message: 'Identity vault lookup service unavailable.',
        }, { status: 503 });
      }
      if (errMsg === 'APPOINTMENT_RESOURCE_NOT_FOUND') {
        return Response.json({
          error: 'APPOINTMENT_RESOURCE_NOT_FOUND',
          message: 'Appointment resource not found in business scope.',
        }, { status: 404 });
      }
      if (errMsg === 'APPOINTMENT_RESOURCE_UNAVAILABLE') {
        return Response.json({
          error: 'APPOINTMENT_RESOURCE_UNAVAILABLE',
          message: 'Appointment resource is currently unavailable for bookings.',
        }, { status: 400 });
      }
      if (errMsg === 'APPOINTMENT_RESOURCE_LOOKUP_FAILED') {
        return Response.json({
          error: 'APPOINTMENT_RESOURCE_UNAVAILABLE',
          message: 'Appointment resource lookup service unavailable.',
        }, { status: 503 });
      }
      return Response.json({
        error: 'APPOINTMENT_WRITE_FAILED',
        message: 'Failed to atomically persist appointment and audit record.'
      }, { status: 500 });
    }
  }

  // ============================================================================
  // PATCH /api/appointments - Update Status
  // ============================================================================
  if (req.method === 'PATCH') {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return Response.json({
        error: 'BAD_REQUEST',
        message: 'Request body must be a valid JSON object.'
      }, { status: 400 });
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return Response.json({
        error: 'BAD_REQUEST',
        message: 'Request body must be a valid non-array JSON object.'
      }, { status: 400 });
    }

    const bodyKeys = Object.keys(body);
    for (const key of bodyKeys) {
      if (!ALLOWED_PATCH_FIELDS.has(key)) {
        return Response.json({
          error: 'BAD_REQUEST',
          message: `Payload contains unrecognized or forbidden field: '${key}'.`
        }, { status: 400 });
      }
    }

    if (typeof body.appointmentId !== 'string' || body.appointmentId.trim().length === 0) {
      return Response.json({
        error: 'BAD_REQUEST',
        message: 'appointmentId is required and must be a non-empty string.'
      }, { status: 400 });
    }
    const appointmentId = body.appointmentId.trim();

    if (!body.status || typeof body.status !== 'string' || !isValidAppointmentStatus(body.status)) {
      return Response.json({
        error: 'BAD_REQUEST',
        message: `status must be one of: ${Array.from(CANONICAL_APPOINTMENT_STATUSES).join(', ')}`
      }, { status: 400 });
    }
    const newStatus = body.status as AppointmentStatus;

    if (newStatus === 'cancelled' || newStatus === 'no_show') {
      if (!body.reasonCode || typeof body.reasonCode !== 'string' || !isValidCancellationReasonCode(body.reasonCode)) {
        return Response.json({
          error: 'BAD_REQUEST',
          message: `reasonCode is required for '${newStatus}' and must be one of: ${Array.from(CANONICAL_CANCELLATION_REASON_CODES).join(', ')}`
        }, { status: 400 });
      }
    } else {
      if (body.reasonCode !== undefined && body.reasonCode !== null) {
        return Response.json({
          error: 'BAD_REQUEST',
          message: `reasonCode is only permitted for 'cancelled' or 'no_show' status transitions.`
        }, { status: 400 });
      }
    }
    const reasonCode = (newStatus === 'cancelled' || newStatus === 'no_show') ? (body.reasonCode as CancellationReasonCode) : undefined;

    // 1. Determine action and authorize TenantGuard FIRST before business lookup
    const requiredAction = (newStatus === 'cancelled' || newStatus === 'no_show') 
      ? 'appointment.cancel' 
      : 'appointment.update';

    const auth = TenantGuard.authorize(user, orgId, requiredAction);
    if (!auth.authorized) {
      return Response.json({ error: auth.errorMessage }, { status: auth.statusCode });
    }

    if (!user || !user.userId || typeof user.userId !== 'string' || user.userId.trim().length === 0 || !auth.role) {
      return Response.json({
        error: 'AUTHORIZATION_CONTEXT_INVALID',
        message: 'Authenticated user actor context is invalid.',
      }, { status: 403 });
    }
    const actorId = user.userId.trim();
    const actorRole = auth.role as UserRole;

    // 2. Verify business belongs to organization (distinguish 503 DB failure from 404 missing)
    const bizCheck = await BusinessTenantGuard.verifyBusinessBelongsToOrganization(
      db,
      orgId,
      businessId,
      environment
    );
    if (!bizCheck.valid) {
      if (bizCheck.statusCode === 503) {
        return Response.json({
          error: 'BUSINESS_SCOPE_LOOKUP_FAILED',
          message: 'Database error verifying business scope.',
        }, { status: 503 });
      }
      return Response.json({
        error: 'BUSINESS_NOT_FOUND',
        message: 'Business not found in organization scope.',
      }, { status: 404 });
    }

    let existing: any;
    try {
      existing = await AppointmentRepository.getByIdForBusiness(
        db,
        appointmentId,
        orgId,
        businessId,
        environment
      );
    } catch (err: any) {
      return Response.json({
        error: 'APPOINTMENT_READ_FAILED',
        message: 'Failed to read appointment state.',
      }, { status: 500 });
    }

    if (!existing) {
      return Response.json({
        error: 'APPOINTMENT_NOT_FOUND',
        message: 'Appointment not found in business scope.'
      }, { status: 404 });
    }

    if (existing.status === newStatus) {
      return Response.json({
        error: 'INVALID_APPOINTMENT_STATE_TRANSITION',
        message: 'Appointment is already in requested status.'
      }, { status: 400 });
    }

    if (!isAllowedAppointmentTransition(existing.status, newStatus)) {
      return Response.json({
        error: 'INVALID_APPOINTMENT_STATE_TRANSITION',
        message: `Cannot transition appointment from status '${existing.status}' to '${newStatus}'.`
      }, { status: 400 });
    }

    try {
      const result = await AppointmentRepository.updateStatusWithAudit(
        db,
        appointmentId,
        existing.status,
        newStatus,
        orgId,
        businessId,
        actorId,
        actorRole,
        ipHash,
        reasonCode,
        environment
      );

      if (!result) {
        return Response.json({
          error: 'APPOINTMENT_CONCURRENT_MODIFICATION',
          message: 'Concurrent modification detected or status transition precondition failed.'
        }, { status: 409 });
      }

      return Response.json({
        success: true,
        data: result.appointment,
        auditLogId: result.auditLog.id,
        orgId
      });
    } catch (err: any) {
      const errMsg = err?.message;
      if (errMsg === 'AUTHORIZATION_CONTEXT_INVALID') {
        return Response.json({
          error: 'AUTHORIZATION_CONTEXT_INVALID',
          message: 'Authenticated actor context or role is invalid.',
        }, { status: 403 });
      }
      if (errMsg === 'INVALID_APPOINTMENT_REASON_CODE') {
        return Response.json({
          error: 'BAD_REQUEST',
          message: 'Valid cancellation reasonCode is required for this transition.',
        }, { status: 400 });
      }
      if (errMsg === 'APPOINTMENT_READ_FAILED') {
        return Response.json({
          error: 'APPOINTMENT_READ_FAILED',
          message: 'Failed to read appointment state.',
        }, { status: 500 });
      }
      return Response.json({
        error: 'APPOINTMENT_WRITE_FAILED',
        message: 'Failed to atomically update appointment status and audit record.'
      }, { status: 500 });
    }
  }

  return Response.json({ error: 'Method not allowed' }, { status: 405 });
}
