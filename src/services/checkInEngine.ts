/**
 * @file checkInEngine.ts
 * @description Quick Check-In (Fallback) & VELNAR Tap (NFC / QR) Telemetry Engine
 * 
 * Strict Privacy:
 * No biometric data. No facial scanning. Pseudonymous tokens only.
 */

import { PhysicalCheckInEvent, CheckInType, CheckInSource, TapDeviceConfig } from '../types/checkin';

export const mockTapDevices: TapDeviceConfig[] = [
  {
    deviceId: 'tap_dev_front_01',
    label: 'Reception Desk VELNAR Tap #1',
    status: 'active',
    lastTapTimestamp: '2026-08-24T05:22:00Z',
    totalTapsToday: 18,
  },
  {
    deviceId: 'tap_dev_lounge_02',
    label: 'VIP Lounge Stand NFC #2',
    status: 'active',
    lastTapTimestamp: '2026-08-24T04:45:00Z',
    totalTapsToday: 9,
  }
];

export class CheckInEngine {
  public static logCheckIn(params: {
    organizationId: string;
    businessId: string;
    locationId: string;
    locationName: string;
    checkInType: CheckInType;
    source: CheckInSource;
    partySize: number;
    serviceRequested?: string;
  }): PhysicalCheckInEvent {
    const event: PhysicalCheckInEvent = {
      id: `chk_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
      organizationId: params.organizationId,
      businessId: params.businessId,
      locationId: params.locationId,
      locationName: params.locationName,
      checkInType: params.checkInType,
      source: params.source,
      pseudonymousVisitorId: `vis_anon_${Math.random().toString(36).substring(2, 8)}`,
      partySize: params.partySize || 1,
      serviceRequested: params.serviceRequested,
      timestamp: new Date().toISOString(),
    };

    return event;
  }
}
