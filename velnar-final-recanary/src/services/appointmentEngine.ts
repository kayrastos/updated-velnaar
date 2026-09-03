/**
 * @file appointmentEngine.ts
 * @description Normalized Appointment Lifecycle & Multi-Provider Connector Interfaces
 */

import { 
  Appointment, 
  AppointmentEvent, 
  AppointmentStatus, 
  AppointmentSource, 
  AppointmentConnectorConfig 
} from '../types/appointment';

export const mockConnectorsList: AppointmentConnectorConfig[] = [
  {
    id: 'conn_gcal_01',
    businessId: 'biz_active',
    provider: 'google_calendar',
    name: 'Google Calendar Two-Way Sync',
    status: 'connected',
    lastSyncAt: '2026-08-24T05:30:00Z',
    eventsIngestedCount: 142,
    syncIntervalMinutes: 5,
  },
  {
    id: 'conn_clinic_emr',
    businessId: 'biz_active',
    provider: 'clinic_emr',
    name: 'Clinical EMR / Salon Sched Bridge',
    status: 'connected',
    lastSyncAt: '2026-08-24T05:15:00Z',
    eventsIngestedCount: 88,
    syncIntervalMinutes: 15,
  },
  {
    id: 'conn_opentable',
    businessId: 'biz_active',
    provider: 'opentable',
    name: 'OpenTable / Resy Dining Connector',
    status: 'idle',
    lastSyncAt: '2026-08-24T04:00:00Z',
    eventsIngestedCount: 64,
    syncIntervalMinutes: 10,
  }
];

export class AppointmentEngine {
  /**
   * Normalizes an incoming raw connector signal into a canonical VELNAR AppointmentEvent
   */
  public static normalizeIncomingEvent(
    appointmentId: string,
    orgId: string,
    bizId: string,
    newStatus: AppointmentStatus,
    source: AppointmentSource,
    expectedValueMinor: number,
    currency: string,
    previousStatus?: AppointmentStatus
  ): AppointmentEvent {
    let eventType: AppointmentEvent['eventType'] = 'appointment.created';
    if (newStatus === 'confirmed') eventType = 'appointment.confirmed';
    else if (newStatus === 'rescheduled') eventType = 'appointment.rescheduled';
    else if (newStatus === 'cancelled') eventType = 'appointment.cancelled';
    else if (newStatus === 'no_show') eventType = 'appointment.no_show';
    else if (newStatus === 'completed') eventType = 'appointment.completed';

    return {
      id: `ev_${crypto.randomUUID()}`,
      organizationId: orgId,
      businessId: bizId,
      appointmentId,
      eventType,
      source,
      payload: {
        previousStatus,
        newStatus,
        expectedValueMinor,
        currency,
      },
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Fast Manual Entry Factory
   */
  public static createManualAppointment(params: {
    organizationId: string;
    businessId: string;
    customerPseudonymId?: string;
    serviceName: string;
    serviceCategory: string;
    resourceStaffId?: string;
    resourceStaffName: string;
    scheduledStart: string;
    durationMinutes: number;
    expectedValueMinor: number;
    currency: string;
  }): { appointment: Appointment; event: AppointmentEvent } {
    const aptId = `apt_man_${crypto.randomUUID()}`;
    const pseudonym = params.customerPseudonymId || `c_ps_${crypto.randomUUID()}`;
    const startTime = new Date(params.scheduledStart);
    const endTime = new Date(startTime.getTime() + params.durationMinutes * 60000);

    const appointment: Appointment = {
      id: aptId,
      organizationId: params.organizationId,
      businessId: params.businessId,
      customerPseudonymId: pseudonym,
      serviceName: params.serviceName,
      serviceCategory: params.serviceCategory,
      resourceStaffId: params.resourceStaffId || `res_${crypto.randomUUID()}`,
      resourceStaffName: params.resourceStaffName,
      scheduledStart: startTime.toISOString(),
      scheduledEnd: endTime.toISOString(),
      durationMinutes: params.durationMinutes,
      expectedValueMinor: params.expectedValueMinor,
      currency: params.currency,
      status: 'confirmed',
      source: 'velnar_manual',
      rowVersion: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const event = AppointmentEngine.normalizeIncomingEvent(
      aptId,
      params.organizationId,
      params.businessId,
      'confirmed',
      'velnar_manual',
      params.expectedValueMinor,
      params.currency
    );

    return { appointment, event };
  }
}
