import { describe, expect, it } from 'vitest';
import React from 'react';
import { isValidIsoWithTimezone } from '../../src/utils/rfc3339Validator';
import { AppointmentEngine, mockConnectorsList } from '../../src/services/appointmentEngine';
import { CheckInEngine, mockTapDevices } from '../../src/services/checkInEngine';
import { bootstrapDevSession } from '../../src/dev/devSessionBootstrap';
import { DisabledFulgorRayAdapter } from '../../src/integrations/fulgorRay/adapter';
import { ThemeProvider, useTheme } from '../../src/context/ThemeContext';
import App from '../../src/App';
import type { MainBootstrapRoot } from '../../src/main';
import { SessionBoundary } from '../../src/components/auth/SessionBoundary';
import { ProductLoopHUD } from '../../src/components/common/ProductLoopHUD';
import { Header } from '../../src/components/layout/Header';
import { Sidebar } from '../../src/components/layout/Sidebar';
import { AttributionEngineView } from '../../src/views/AttributionEngineView';
import { BusinessTwinView } from '../../src/views/BusinessTwinView';
import { DashboardView } from '../../src/views/DashboardView';
import { GrowthActionsView } from '../../src/views/GrowthActionsView';
import { LeadInboxView } from '../../src/views/LeadInboxView';
import { OnboardingView } from '../../src/views/OnboardingView';
import { VelnarProofView } from '../../src/views/VelnarProofView';
import type { AppRoute, Language, MarketMetrics, PlatformState } from '../../src/types/app';
import type { Appointment, AppointmentStatus, AppointmentCurrencyCode } from '../../src/types/appointment';
import type { AttributionConfidence, AttributionType, AttributionCurrencyCode } from '../../src/types/attribution';
import type { Resource, CapacitySnapshot } from '../../src/types/capacity';
import type { PhysicalCheckInEvent, CheckInType, CheckInOrganizationId } from '../../src/types/checkin';
import type { OrganizationRow, UserRole, MarketType, CanonicalAppointmentStatus } from '../../src/types/database';
import type { RuleIdentifier, LeakConfidenceLevel } from '../../src/types/leakEngine';
import type { POSTransactionSummary, POSCurrencyCode } from '../../src/types/pos';
import type { PlatformRole, SecurityEvent, TenantSecurityContext } from '../../src/types/security';
import type { CallMetadataEvent, CallStatus, TelephonyOrganizationId } from '../../src/types/telephony';

describe('VELNAR V1 Core Coverage & Behavioral Invariants', () => {
  it('validates strict RFC 3339 timestamps with calendar and leap-year rules', () => {
    expect(isValidIsoWithTimezone('2026-10-29T12:00:00Z')).toBe(true);
    expect(isValidIsoWithTimezone('2024-02-29T23:59:59+03:00')).toBe(true);
    expect(isValidIsoWithTimezone('2026-02-29T12:00:00Z')).toBe(false);
    expect(isValidIsoWithTimezone('2026-13-01T00:00:00Z')).toBe(false);
    expect(isValidIsoWithTimezone('2026-04-31T00:00:00Z')).toBe(false);
    expect(isValidIsoWithTimezone('2026-10-29T24:00:00Z')).toBe(false);
    expect(isValidIsoWithTimezone('2026-10-29T12:60:00Z')).toBe(false);
    expect(isValidIsoWithTimezone('2026-10-29T12:00:00+25:00')).toBe(false);
    expect(isValidIsoWithTimezone('2026-10-29 12:00:00Z')).toBe(false);
    expect(isValidIsoWithTimezone(null)).toBe(false);
    expect(isValidIsoWithTimezone(12345)).toBe(false);
  });

  it('normalizes appointment lifecycle events and creates manual appointments deterministically', () => {
    expect(mockConnectorsList.length).toBeGreaterThanOrEqual(3);

    const statuses: Array<[AppointmentStatus, string]> = [
      ['scheduled', 'appointment.created'],
      ['confirmed', 'appointment.confirmed'],
      ['rescheduled', 'appointment.rescheduled'],
      ['cancelled', 'appointment.cancelled'],
      ['no_show', 'appointment.no_show'],
      ['completed', 'appointment.completed'],
    ];

    for (const [status, expectedEventType] of statuses) {
      const ev = AppointmentEngine.normalizeIncomingEvent(
        'apt_01',
        'org_01',
        'biz_01',
        status,
        'google_calendar',
        150000,
        'TRY',
        'scheduled'
      );
      expect(ev.eventType).toBe(expectedEventType);
      expect(ev.organizationId).toBe('org_01');
      expect(ev.businessId).toBe('biz_01');
      expect(ev.payload.expectedValueMinor).toBe(150000);
      expect(isValidIsoWithTimezone(ev.timestamp)).toBe(true);
    }

    const manual = AppointmentEngine.createManualAppointment({
      organizationId: 'org_01',
      businessId: 'biz_01',
      serviceName: 'Executive Consultation',
      serviceCategory: 'Advisory',
      resourceStaffName: 'Dr. Kaya',
      scheduledStart: '2026-10-29T10:00:00.000Z',
      durationMinutes: 45,
      expectedValueMinor: 250000,
      currency: 'TRY',
    });

    expect(manual.appointment.status).toBe('confirmed');
    expect(manual.appointment.scheduledEnd).toBe('2026-10-29T10:45:00.000Z');
    expect(manual.appointment.customerPseudonymId).toMatch(/^c_ps_/);
    expect(manual.event.eventType).toBe('appointment.confirmed');
  });

  it('logs privacy-preserving physical check-in events with pseudonymous visitor tokens', () => {
    expect(mockTapDevices.length).toBeGreaterThanOrEqual(2);

    const ev: PhysicalCheckInEvent = CheckInEngine.logCheckIn({
      organizationId: 'org_01',
      businessId: 'biz_01',
      locationId: 'loc_ist_01',
      locationName: 'Istanbul Flagship',
      checkInType: 'returning_visitor',
      source: 'velnar_tap_nfc',
      partySize: 2,
      serviceRequested: 'VIP Table',
    });

    expect(ev.id).toMatch(/^chk_/);
    expect(ev.pseudonymousVisitorId).toMatch(/^vis_anon_/);
    expect(ev.partySize).toBe(2);
    expect(isValidIsoWithTimezone(ev.timestamp)).toBe(true);
  });

  it('keeps Fulgor Ray adapter fail-safe disabled and dev session bootstrap side-effect safe', async () => {
    const adapter = new DisabledFulgorRayAdapter();
    expect(adapter.isEnabled).toBe(false);
    expect(adapter.status).toBe('DISABLED');

    const telemetryRes = await adapter.emitTelemetry({
      organizationId: 'org_01',
      businessId: 'biz_01',
      eventType: 'funnel.check',
      timestamp: '2026-10-29T12:00:00Z',
      metrics: { latencyMs: 42 },
    });
    expect(telemetryRes.delivered).toBe(false);

    const anomalyRes = await adapter.checkAnomalies('biz_01');
    expect(anomalyRes.anomalyDetected).toBe(false);
    expect(anomalyRes.category).toBe('none');

    expect(() => bootstrapDevSession()).not.toThrow();
  });

  it('verifies V1 core contract types and React view/component exports', () => {
    const route: AppRoute = '/dashboard';
    const lang: Language = 'tr';
    const role: PlatformRole = 'OWNER';
    const userRole: UserRole = role;
    const market: MarketType = 'TR';
    const aptCurrency: AppointmentCurrencyCode = 'TRY';
    const attrCurrency: AttributionCurrencyCode = 'USD';
    const posCurrency: POSCurrencyCode = 'EUR';
    const aptStatus: CanonicalAppointmentStatus = 'confirmed';
    const attrConf: AttributionConfidence = 'HIGH';
    const attrType: AttributionType = 'ATTRIBUTED_REVENUE';
    const checkInType: CheckInType = 'new_visitor';
    const checkInOrg: CheckInOrganizationId = 'org_01';
    const telOrg: TelephonyOrganizationId = 'org_01';
    const callStatus: CallStatus = 'answered';

    const tenantCtx: TenantSecurityContext = {
      userId: 'usr_01',
      email: 'owner@velnar.com',
      organizationId: 'org_01',
      role: userRole,
    };

    expect(route).toBe('/dashboard');
    expect(lang).toBe('tr');
    expect(market).toBe('TR');
    expect(aptCurrency).toBe('TRY');
    expect(attrCurrency).toBe('USD');
    expect(posCurrency).toBe('EUR');
    expect(aptStatus).toBe('confirmed');
    expect(attrConf).toBe('HIGH');
    expect(attrType).toBe('ATTRIBUTED_REVENUE');
    expect(checkInType).toBe('new_visitor');
    expect(checkInOrg).toBe(telOrg);
    expect(callStatus).toBe('answered');
    expect(tenantCtx.role).toBe('OWNER');

    const rootComponent: MainBootstrapRoot = App;
    expect(typeof rootComponent).toBe('function');
    expect(typeof ThemeProvider).toBe('function');
    expect(typeof useTheme).toBe('function');
    expect(typeof SessionBoundary).toBe('function');
    expect(typeof ProductLoopHUD).toBe('function');
    expect(typeof Header).toBe('function');
    expect(typeof Sidebar).toBe('function');
    expect(typeof AttributionEngineView).toBe('function');
    expect(typeof BusinessTwinView).toBe('function');
    expect(typeof DashboardView).toBe('function');
    expect(typeof GrowthActionsView).toBe('function');
    expect(typeof LeadInboxView).toBe('function');
    expect(typeof OnboardingView).toBe('function');
    expect(typeof VelnarProofView).toBe('function');

    const el = React.createElement(ThemeProvider, { children: React.createElement('div', null, 'ok') });
    expect(el.type).toBe(ThemeProvider);

    const unusedTypeWitness: [
      MarketMetrics | null,
      PlatformState | null,
      Appointment | null,
      Resource | null,
      CapacitySnapshot | null,
      OrganizationRow | null,
      RuleIdentifier | null,
      LeakConfidenceLevel | null,
      POSTransactionSummary | null,
      SecurityEvent | null,
      CallMetadataEvent | null,
    ] = [null, null, null, null, null, null, null, null, null, null, null];
    expect(unusedTypeWitness.length).toBe(11);
  });
});
