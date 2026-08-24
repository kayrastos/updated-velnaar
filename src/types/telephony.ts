/**
 * @file telephony.ts
 * @description Telephony and Call Bridge Event Metadata Model
 * 
 * ============================================================================
 * STRICT PRIVACY DECISION — NO CALL RECORDING & ZERO AUDIO INGESTION
 * ============================================================================
 * VELNAR Call Bridge must NEVER record phone audio in this version.
 * 
 * DO NOT IMPLEMENT:
 * - Call audio recording
 * - Audio file storage / S3 buckets
 * - Speech-to-text (STT) transcription
 * - NLP keyword extraction from voice streams
 * - Microphone capture or wiretapping
 * 
 * The phone event model is STRICTLY LIMITED to operational metadata only.
 * Caller identifiers are pseudonymous outside the secure Identity Vault.
 * ============================================================================
 */

export type CallDirection = 'inbound' | 'outbound';
export type CallStatus = 'answered' | 'missed' | 'voicemail' | 'busy' | 'dropped';
export type CallStaffResult = 
  | 'appointment_booked' 
  | 'quote_requested' 
  | 'general_inquiry' 
  | 'callback_scheduled' 
  | 'no_action_needed' 
  | 'unresolved_inquiry';

export interface CallMetadataEvent {
  id: string;
  organizationId: string;
  businessId: string;
  /**
   * Pseudonymous caller identifier (e.g. hash / vault token).
   * Plain PII phone numbers are stored exclusively in the Identity Vault.
   */
  pseudonymousCallerId: string;
  direction: CallDirection;
  /**
   * Attribution source (e.g. 'google_ads_call_extension', 'website_header', 'instagram_bio')
   */
  source: string;
  startedAt: string; // ISO 8601
  answeredAt?: string; // ISO 8601
  endedAt: string; // ISO 8601
  waitDurationSeconds: number;
  callDurationSeconds: number;
  status: CallStatus;
  staffResultClassification?: CallStaffResult;
  linkedCustomerId?: string;
  linkedLeadId?: string;
  linkedAppointmentId?: string;
}

export interface CallBridgeSummary {
  totalCalls: number;
  missedCalls: number;
  averageWaitSeconds: number;
  averageDurationSeconds: number;
  missedFollowUpGaps: number;
  estimatedRevenueAtRiskMinor: number;
}
