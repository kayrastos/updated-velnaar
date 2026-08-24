/**
 * @file appointmentsRouter.ts
 * @description Server-Side Tenant-Guarded Appointments API Handler
 */

import { AuthenticatedUser } from '../auth/authContext';
import { TenantGuard } from '../middleware/tenantGuard';
import { AppointmentRepository } from '../repositories/appointmentRepository';
import { AppointmentStatus } from '../../src/types/appointment';

export async function handleAppointmentsRoute(
  req: Request,
  user: AuthenticatedUser | null,
  url: URL,
  db?: D1Database,
  environment: string = 'production'
): Promise<Response> {
  const orgId = url.searchParams.get('orgId') || 'org_apex_holding';
  const businessId = url.searchParams.get('businessId') || undefined;

  // GET /api/appointments
  if (req.method === 'GET') {
    const auth = TenantGuard.authorize(user, orgId, 'appointment.read');
    if (!auth.authorized) {
      return Response.json({ error: auth.errorMessage }, { status: auth.statusCode });
    }

    const appointments = await AppointmentRepository.listByOrg(db, orgId, businessId, environment);
    return Response.json({ data: appointments, orgId });
  }

  // POST /api/appointments - Create Appointment
  if (req.method === 'POST') {
    const auth = TenantGuard.authorize(user, orgId, 'appointment.create');
    if (!auth.authorized) {
      return Response.json({ error: auth.errorMessage }, { status: auth.statusCode });
    }

    const body = await req.json() as any;
    const newAppointment = await AppointmentRepository.create(db, body, orgId, environment);
    return Response.json({ data: newAppointment, orgId }, { status: 201 });
  }

  // PATCH /api/appointments - Update Status
  if (req.method === 'PATCH') {
    const body = await req.json() as { appointmentId: string; status: AppointmentStatus; reason?: string };
    const requiredAction = (body.status === 'cancelled' || body.status === 'no_show') 
      ? 'appointment.cancel' 
      : 'appointment.update';

    const auth = TenantGuard.authorize(user, orgId, requiredAction);
    if (!auth.authorized) {
      return Response.json({ error: auth.errorMessage }, { status: auth.statusCode });
    }

    const updated = await AppointmentRepository.updateStatus(db, body.appointmentId, body.status, orgId, body.reason, environment);
    if (!updated) {
      return Response.json({ error: 'Appointment not found or does not belong to your organization.' }, { status: 404 });
    }
    return Response.json({ data: updated, orgId });
  }

  return Response.json({ error: 'Method not allowed' }, { status: 405 });
}
