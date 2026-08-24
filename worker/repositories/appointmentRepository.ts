/**
 * @file appointmentRepository.ts
 * @description Tenant-Scoped Appointment Repository & Lifecycle Manager
 */

import { Appointment, AppointmentStatus, AppointmentSource } from '../../src/types/appointment';

export class AppointmentRepository {
  private static appointments: Appointment[] = [
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

  public static async listByOrg(orgId: string, businessId?: string): Promise<Appointment[]> {
    return AppointmentRepository.appointments.filter(a => {
      const orgMatch = a.organizationId === orgId;
      return businessId ? orgMatch && a.businessId === businessId : orgMatch;
    });
  }

  public static async getById(appointmentId: string, orgId: string): Promise<Appointment | null> {
    const apt = AppointmentRepository.appointments.find(a => a.id === appointmentId && a.organizationId === orgId);
    return apt || null;
  }

  public static async create(
    data: Omit<Appointment, 'id' | 'createdAt' | 'updatedAt' | 'organizationId'>,
    orgId: string
  ): Promise<Appointment> {
    const now = new Date().toISOString();
    const newAppointment: Appointment = {
      id: `apt_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 5)}`,
      organizationId: orgId, // Force server-side tenant ID
      createdAt: now,
      updatedAt: now,
      ...data,
    };

    AppointmentRepository.appointments.unshift(newAppointment);
    return newAppointment;
  }

  public static async updateStatus(
    appointmentId: string,
    status: AppointmentStatus,
    orgId: string,
    reason?: string
  ): Promise<Appointment | null> {
    const index = AppointmentRepository.appointments.findIndex(a => a.id === appointmentId && a.organizationId === orgId);
    if (index === -1) return null;

    AppointmentRepository.appointments[index] = {
      ...AppointmentRepository.appointments[index],
      status,
      cancellationReason: reason || AppointmentRepository.appointments[index].cancellationReason,
      updatedAt: new Date().toISOString(),
    };
    return AppointmentRepository.appointments[index];
  }
}
