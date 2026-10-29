import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { isValidIsoWithTimezone } from '../../src/utils/rfc3339Validator';
import { AppointmentEngine, mockConnectorsList } from '../../src/services/appointmentEngine';
import { CheckInEngine, mockTapDevices } from '../../src/services/checkInEngine';
import { bootstrapDevSession } from '../../src/dev/devSessionBootstrap';
import { DisabledFulgorRayAdapter } from '../../src/integrations/fulgorRay/adapter';
import { ThemeProvider, useTheme } from '../../src/context/ThemeContext';
import { PlatformContext, type PlatformContextValue } from '../../src/context/PlatformContext';
import {
  mockOrganization,
  mockBusinesses,
  initialRevenueLeaks,
  initialGrowthActions,
  initialActionResults,
  initialBusinessTwinFacts,
  initialLeads,
  initialAuditLogs,
  initialAIRuns,
} from '../../src/data/mockSeed';
import { translations } from '../../src/i18n/translations';
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
import { createVelnarProofCertificate } from '../../src/utils/stateHash';
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

  it('renders SessionBoundary fail-closed security screens and DashboardView / VelnarProofView with real markup', () => {
    const baseContext: PlatformContextValue = {
      currentRoute: '/dashboard',
      setCurrentRoute: () => {},
      currentMarket: 'TR',
      setMarket: () => {},
      language: 'en',
      setLanguage: () => {},
      currentRole: 'OWNER',
      setCurrentRole: () => {},
      currentOrg: mockOrganization,
      currentBusiness: mockBusinesses.TR,
      businesses: Object.values(mockBusinesses),
      activeBusinessId: mockBusinesses.TR.id,
      businessLoadStatus: 'READY',
      datasetStatuses: {
        bootstrap: 'READY',
        leads: 'READY',
        appointments: 'READY',
        leaks: 'READY',
        actions: 'READY',
        results: 'READY',
        audit: 'READY',
        aiRuns: 'READY',
        securityEvents: 'READY',
      },
      selectBusiness: async () => {},
      clearWorkspaceData: () => {},
      clearOrganizationWorkspace: () => {},
      clearBusinessWorkspace: () => {},
      dataLoadError: null,
      sessionStatus: 'AUTHENTICATED',
      sessionUser: {
        userId: 'usr_owner_01',
        email: 'owner@velnar.com',
        fullName: 'Executive Owner',
        isSuperAdmin: false,
        memberships: [{ organizationId: mockOrganization.id, role: 'OWNER', status: 'active' }],
      },
      memberships: [{ organizationId: mockOrganization.id, role: 'OWNER', status: 'active' }],
      activeOrganizationId: mockOrganization.id,
      selectOrganization: async () => {},
      activeTemplateId: '',
      setActiveTemplateId: () => {},
      activeTemplate: null,
      leaks: initialRevenueLeaks,
      actions: initialGrowthActions,
      actionResults: initialActionResults,
      leads: initialLeads,
      facts: initialBusinessTwinFacts,
      auditLogs: initialAuditLogs,
      aiRuns: initialAIRuns,
      appointments: [],
      posTransactions: [],
      daypartPerformance: [],
      callEvents: [],
      customerJourneys: [],
      attributionResults: [],
      securityEvents: [],
      retentionPolicies: [],
      checkInEvents: [],
      calculatedLeaks: [],
      metrics: {
        revenueAtRisk: 145000,
        growthOpportunities: 310000,
        actionsWaitingApproval: 2,
        revenueInfluenced: 88000,
        currencySymbol: '₺',
        currencyCode: 'TRY',
        leaksCount: { critical: 2, high: 1, medium: 1 },
        twinConfidenceScore: 94,
        productLoopStep: 'APPROVE',
      },
      t: translations.en,
      approveAction: async () => ({ success: true, message: 'Approved' }),
      rejectAction: async () => ({ success: true, message: 'Rejected' }),
      deferAction: async () => ({ success: true, message: 'Deferred' }),
      verifyFact: () => {},
      addFact: () => {},
      triggerFastLeadResponse: () => {},
      runLeakScan: async () => {},
      isScanning: false,
      createManualAppointment: () => null,
      updateAppointmentStatus: () => {},
      recordQuickCheckIn: () => null,
      formatCurrency: (amount: number) => `₺${amount.toLocaleString('en-US')}`,
    };

    const renderWithContext = (overrides: Partial<PlatformContextValue>, child: React.ReactNode): string =>
      renderToStaticMarkup(
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(
            PlatformContext.Provider,
            { value: { ...baseContext, ...overrides } },
            child
          )
        )
      );

    // 1. SessionBoundary: auth_not_configured (AUTH_PROVIDER_NOT_CONFIGURED) fail-closed screen
    const notConfiguredHtml = renderWithContext(
      { sessionStatus: 'AUTH_PROVIDER_NOT_CONFIGURED' },
      React.createElement(SessionBoundary, null, React.createElement('div', null, 'PROTECTED_INNER_SECRET'))
    );
    expect(notConfiguredHtml).toContain('Authentication Provider Not Configured');
    expect(notConfiguredHtml).toContain('NOT_CONFIGURED');
    expect(notConfiguredHtml).toContain('FAIL_CLOSED');
    expect(notConfiguredHtml).not.toContain('PROTECTED_INNER_SECRET');

    // 2. SessionBoundary: unauthenticated (UNAUTHENTICATED) fail-closed screen
    const unauthHtml = renderWithContext(
      { sessionStatus: 'UNAUTHENTICATED' },
      React.createElement(SessionBoundary, null, React.createElement('div', null, 'PROTECTED_INNER_SECRET'))
    );
    expect(unauthHtml).toContain('Authentication Required');
    expect(unauthHtml).toContain('Authorization: Bearer');
    expect(unauthHtml).not.toContain('PROTECTED_INNER_SECRET');

    // 3. SessionBoundary: unauthorized / session error (ERROR) and missing membership screens
    const unauthorizedErrorHtml = renderWithContext(
      { sessionStatus: 'ERROR' },
      React.createElement(SessionBoundary, null, React.createElement('div', null, 'PROTECTED_INNER_SECRET'))
    );
    expect(unauthorizedErrorHtml).toContain('Session Verification Failed');
    expect(unauthorizedErrorHtml).toContain('Access to the requested organization was denied');
    expect(unauthorizedErrorHtml).not.toContain('PROTECTED_INNER_SECRET');

    const noMembershipHtml = renderWithContext(
      { sessionStatus: 'AUTHENTICATED', activeOrganizationId: null, memberships: [] },
      React.createElement(SessionBoundary, null, React.createElement('div', null, 'PROTECTED_INNER_SECRET'))
    );
    expect(noMembershipHtml).toContain('Select Organization Workspace');
    expect(noMembershipHtml).toContain('No active organization memberships found for this account.');
    expect(noMembershipHtml).not.toContain('PROTECTED_INNER_SECRET');

    // 4. SessionBoundary: fully authorized workspace renders protected children
    const authorizedHtml = renderWithContext(
      {},
      React.createElement(SessionBoundary, null, React.createElement('div', { id: 'workspace-ok' }, 'AUTHORIZED_WORKSPACE_READY'))
    );
    expect(authorizedHtml).toContain('AUTHORIZED_WORKSPACE_READY');

    // 5. DashboardView: renders hero metrics, pending approval actions, and active critical leaks
    const dashboardHtml = renderWithContext({}, React.createElement(DashboardView));
    expect(dashboardHtml).toContain('id="dashboard-view"');
    expect(dashboardHtml).toContain('id="metric-revenue-at-risk"');
    expect(dashboardHtml).toContain('id="metric-growth-opportunities"');
    expect(dashboardHtml).toContain('id="metric-actions-waiting-approval"');
    expect(dashboardHtml).toContain('id="metric-revenue-influenced"');
    expect(dashboardHtml).toContain('₺145,000');
    expect(dashboardHtml).toContain('94%');
    expect(dashboardHtml).toContain('Apex Türkiye Sanayi &amp; Lojistik A.Ş.');
    expect(dashboardHtml).toContain('ARR Run-Rate: ₺48,500,000');

    // 6. VelnarProofView: renders proof banner, export button, deterministic JCS ledger integrity hash, and attribution ledger rows
    const expectedCert = createVelnarProofCertificate({
      currentMarket: 'TR',
      currentBusiness: mockBusinesses.TR,
      actionResults: initialActionResults,
    });
    const proofHtml = renderWithContext({}, React.createElement(VelnarProofView));
    expect(proofHtml).toContain('id="velnar-proof-view"');
    expect(proofHtml).toContain('id="export-proof-certificate"');
    expect(proofHtml).toContain(expectedCert.state_hash);
    expect(proofHtml).not.toContain('sha256:7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069');
    expect(proofHtml).toContain('Immutable Attribution Verified');
    if (initialActionResults.length > 0) {
      expect(proofHtml).toContain(initialActionResults[0].id);
      expect(proofHtml).toContain(initialActionResults[0].growth_action_id);
    }
  });
});
