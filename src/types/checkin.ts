/**
 * @file checkin.ts
 * @description Quick Check-In (Fallback) & VELNAR Tap (QR / NFC) Physical Attendance Telemetry
 * 
 * ============================================================================
 * PRIVACY GUARANTEE:
 * - NO biometric identification
 * - NO facial recognition
 * - NO passive surveillance or beacon tracking
 * - Pseudonymous tokens only
 * - Positioned strictly as an operational fallback, not mandatory surveillance
 * ============================================================================
 */

export type CheckInType = 'new_visitor' | 'returning_visitor' | 'anonymous_walk_in';

export type CheckInSource = 'velnar_tap_nfc' | 'qr_counter_stand' | 'tablet_fallback_kiosk' | 'staff_manual_entry';

export interface PhysicalCheckInEvent {
  id: string;
  organizationId: string;
  businessId: string;
  locationId: string;
  locationName: string;
  checkInType: CheckInType;
  source: CheckInSource;
  pseudonymousVisitorId?: string;
  partySize: number;
  serviceRequested?: string;
  assignedStaffId?: string;
  timestamp: string;
}

export interface TapDeviceConfig {
  deviceId: string;
  label: string; // e.g. "Front Desk Tap #1"
  status: 'active' | 'pairing' | 'offline';
  lastTapTimestamp?: string;
  totalTapsToday: number;
}
