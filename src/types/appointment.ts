/**
 * @file appointment.ts
 * @description Provider-Neutral Appointment Engine & Event Normalization
 */

export type AppointmentStatus = 
  | 'scheduled' 
  | 'confirmed' 
  | 'in_progress' 
  | 'completed' 
  | 'cancelled' 
  | 'no_show' 
  | 'rescheduled';

export type AppointmentSource = 
  | 'velnar_manual' 
  | 'google_calendar' 
  | 'external_provider' 
  | 'opentable'
  | 'pos' 
  | 'api'
  | 'web_booking_widget';

export type AppointmentEventType = 
  | 'appointment.created' 
  | 'appointment.confirmed' 
  | 'appointment.rescheduled' 
  | 'appointment.cancelled' 
  | 'appointment.no_show' 
  | 'appointment.completed';

export interface Appointment {
  id: string;
  organizationId: string;
  businessId: string;
  customerName: string;
  customerPseudonymId: string;
  customerContact?: string; // Vault token or phone reference
  serviceName: string;
  serviceCategory: string;
  resourceStaffId: string;
  resourceStaffName: string;
  scheduledStart: string; // ISO 8601
  scheduledEnd: string; // ISO 8601
  durationMinutes: number;
  expectedValueMinor: number; // in currency minor units / integers (e.g. 150000 = $1,500.00)
  currency: string;
  status: AppointmentStatus;
  source: AppointmentSource;
  externalReferenceId?: string;
  cancellationReason?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AppointmentEvent {
  id: string;
  organizationId: string;
  businessId: string;
  appointmentId: string;
  eventType: AppointmentEventType;
  source: AppointmentSource;
  payload: {
    previousStatus?: AppointmentStatus;
    newStatus: AppointmentStatus;
    rescheduledFrom?: string;
    rescheduledTo?: string;
    expectedValueMinor: number;
    currency: string;
    metadata?: Record<string, unknown>;
  };
  timestamp: string;
}

export interface AppointmentConnectorConfig {
  id: string;
  businessId: string;
  provider: 'google_calendar' | 'clinic_emr' | 'salon_sched' | 'opentable' | 'custom_api';
  name: string;
  status: 'connected' | 'syncing' | 'idle' | 'error' | 'disconnected';
  lastSyncAt?: string;
  eventsIngestedCount: number;
  syncIntervalMinutes: number;
}

export interface AppointmentRepository {
  getById(id: string, orgId: string): Promise<Appointment | null>;
  listByBusiness(businessId: string, orgId: string, filter?: { status?: AppointmentStatus; fromDate?: string; toDate?: string }): Promise<Appointment[]>;
  create(appointment: Omit<Appointment, 'id' | 'createdAt' | 'updatedAt'>, orgId: string): Promise<Appointment>;
  updateStatus(id: string, status: AppointmentStatus, orgId: string, reason?: string): Promise<Appointment>;
}
