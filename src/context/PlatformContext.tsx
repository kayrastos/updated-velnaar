import React, { createContext, useContext, useState, useMemo, useEffect, useCallback } from 'react';
import { 
  AppRoute, 
  Language, 
  MarketMetrics, 
} from '../types/app';
import { 
  MarketType, 
  UserRole, 
  RevenueLeakRow, 
  GrowthActionRow, 
  ActionResultRow, 
  LeadRow, 
  BusinessTwinFactRow, 
  AuditLogRow, 
  AIRunRow,
  AIRunStatus,
  OrganizationRow,
  BusinessRow
} from '../types/database';
import { 
  mockOrganization, 
  mockBusinesses, 
  mockUsers,
  initialRevenueLeaks, 
  initialGrowthActions, 
  initialActionResults, 
  initialBusinessTwinFacts, 
  initialLeads, 
  initialAuditLogs,
  initialAIRuns
} from '../data/mockSeed';
import { translations } from '../i18n/translations';
import { AIClient, validateCanonicalAIRunRecord, validateLeakScanAIRunResponse } from '../services/aiClient';
import { ApiClient } from '../services/apiClient';
import { SessionClient, SessionUser, SessionState } from '../services/sessionClient';

// Sprint 3 Imports
import { Appointment, AppointmentStatus, CancellationReasonCode } from '../types/appointment';
import { POSTransactionSummary, DaypartPerformance } from '../types/pos';
import { CallMetadataEvent } from '../types/telephony';
import { CustomerJourney, AttributionResult } from '../types/attribution';
import { SecurityEvent, PlatformRole, DataRetentionPolicy } from '../types/security';
import { PhysicalCheckInEvent, CheckInType, CheckInSource } from '../types/checkin';
import { RevenueImpactCalculation, MoneyMetricWithProvenance, RateMetricWithProvenance, CurrencyCode } from '../types/leakEngine';
import { demoTemplatesMap, BusinessTemplateData } from '../data/demoTemplates';
import { RevenueLeakEngine, validateVerifiedMoneyMetric, validateVerifiedRateMetric } from '../services/revenueLeakEngine';
import { defaultRetentionPolicies } from '../services/tenantSecurity';
import { AppointmentEngine } from '../services/appointmentEngine';
import { CheckInEngine } from '../services/checkInEngine';

const IS_DEV = import.meta.env.DEV === true;

export type DatasetStatus = 'IDLE' | 'LOADING' | 'READY' | 'ERROR' | 'UNAVAILABLE';

export interface DatasetStatuses {
  bootstrap: DatasetStatus;
  leads: DatasetStatus;
  appointments: DatasetStatus;
  leaks: DatasetStatus;
  actions: DatasetStatus;
  results: DatasetStatus;
  audit: DatasetStatus;
  aiRuns: DatasetStatus;
  securityEvents: DatasetStatus;
}

interface PlatformContextValue {
  currentRoute: AppRoute;
  setCurrentRoute: (route: AppRoute) => void;
  currentMarket: MarketType;
  setMarket: (market: MarketType) => void;
  language: Language;
  setLanguage: (lang: Language) => void;
  currentRole: UserRole | null;
  setCurrentRole: (role: UserRole | null) => void;
  currentOrg: OrganizationRow | null;
  currentBusiness: BusinessRow | null;
  businesses: BusinessRow[];
  activeBusinessId: string | null;
  businessLoadStatus: DatasetStatus;
  datasetStatuses: DatasetStatuses;
  selectBusiness: (businessId: string) => Promise<void>;
  clearWorkspaceData: () => void;
  clearOrganizationWorkspace: () => void;
  clearBusinessWorkspace: () => void;
  dataLoadError: string | null;

  // Session & Authentication Context
  sessionStatus: 'LOADING' | 'AUTHENTICATED' | 'UNAUTHENTICATED' | 'AUTH_PROVIDER_NOT_CONFIGURED' | 'ERROR';
  sessionUser: SessionUser | null;
  memberships: Array<{ organizationId: string; role: PlatformRole; status: 'active' | 'suspended' | 'invited' }>;
  activeOrganizationId: string | null;
  selectOrganization: (orgId: string) => Promise<void>;
  
  // Sprint 3: Active Business Archetype Template (strictly null in production)
  activeTemplateId: string;
  setActiveTemplateId: (id: string) => void;
  activeTemplate: BusinessTemplateData | null;

  // Market-Scoped State
  leaks: RevenueLeakRow[];
  actions: GrowthActionRow[];
  actionResults: ActionResultRow[];
  leads: LeadRow[];
  facts: BusinessTwinFactRow[];
  auditLogs: AuditLogRow[];
  aiRuns: AIRunRow[];
  
  // Sprint 3 Engine Stores
  appointments: Appointment[];
  posTransactions: POSTransactionSummary[];
  daypartPerformance: DaypartPerformance[];
  callEvents: CallMetadataEvent[];
  customerJourneys: CustomerJourney[];
  attributionResults: AttributionResult[];
  securityEvents: SecurityEvent[];
  retentionPolicies: DataRetentionPolicy[];
  checkInEvents: PhysicalCheckInEvent[];
  calculatedLeaks: RevenueImpactCalculation[];

  // Computed Metrics
  metrics: MarketMetrics;
  t: typeof translations['en'];
  
  // State Mutations & Actions
  approveAction: (actionId: string) => Promise<{ success: boolean; message: string }>;
  rejectAction: (actionId: string) => Promise<{ success: boolean; message: string }>;
  deferAction: (actionId: string) => Promise<{ success: boolean; message: string }>;
  verifyFact: (factId: string) => void;
  addFact: (fact: Omit<BusinessTwinFactRow, 'id' | 'business_id' | 'market' | 'updated_at'>) => void;
  triggerFastLeadResponse: (leadId: string) => void;
  runLeakScan: () => Promise<void>;
  isScanning: boolean;
  
  // Sprint 3 Operations
  createManualAppointment: (params: {
    customerPseudonymId?: string;
    serviceName: string;
    serviceCategory: string;
    resourceStaffName: string;
    scheduledStart: string;
    durationMinutes: number;
    expectedValueMinor: number;
    currency: string;
  }) => Appointment | null;
  updateAppointmentStatus: (appointmentId: string, status: AppointmentStatus, reasonCode?: CancellationReasonCode) => void;
  recordQuickCheckIn: (type: CheckInType, source: CheckInSource, partySize: number, service?: string) => PhysicalCheckInEvent | null;

  // Formatting Utilities
  formatCurrency: (amount: number) => string;
}

const PlatformContext = createContext<PlatformContextValue | undefined>(undefined);

export const PlatformProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentRoute, setCurrentRoute] = useState<AppRoute>('/dashboard');
  const [currentMarket, setCurrentMarket] = useState<MarketType>('GLOBAL');
  const [language, setLanguage] = useState<Language>('en');
  const [currentRole, setCurrentRole] = useState<UserRole | null>(IS_DEV ? 'OWNER' : null);
  const [isScanning, setIsScanning] = useState<boolean>(false);

  // Session state
  const [sessionStatus, setSessionStatus] = useState<
    'LOADING' | 'AUTHENTICATED' | 'UNAUTHENTICATED' | 'AUTH_PROVIDER_NOT_CONFIGURED' | 'ERROR'
  >(IS_DEV ? 'AUTHENTICATED' : 'LOADING');
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(
    IS_DEV
      ? {
          userId: 'usr_owner_01',
          email: 'owner@apex.velnar.test',
          fullName: 'Demo Founder (DEV)',
          isSuperAdmin: false,
          memberships: [{ organizationId: 'org_apex_holding', role: 'OWNER', status: 'active' }],
        }
      : null
  );
  const [activeOrganizationId, setActiveOrganizationId] = useState<string | null>(
    IS_DEV ? 'org_apex_holding' : null
  );
  const [currentOrg, setCurrentOrg] = useState<OrganizationRow | null>(
    IS_DEV ? mockOrganization : null
  );
  const [currentBusiness, setCurrentBusiness] = useState<BusinessRow | null>(
    IS_DEV ? mockBusinesses['GLOBAL'] : null
  );
  const [businesses, setBusinesses] = useState<BusinessRow[]>(
    IS_DEV ? Object.values(mockBusinesses) : []
  );
  const [activeBusinessId, setActiveBusinessId] = useState<string | null>(
    IS_DEV ? 'biz_apex_holding' : null
  );
  const [businessLoadStatus, setBusinessLoadStatus] = useState<DatasetStatus>(
    IS_DEV ? 'READY' : 'IDLE'
  );
  const [datasetStatuses, setDatasetStatuses] = useState<DatasetStatuses>({
    bootstrap: IS_DEV ? 'READY' : 'IDLE',
    leads: IS_DEV ? 'READY' : 'IDLE',
    appointments: IS_DEV ? 'READY' : 'IDLE',
    leaks: IS_DEV ? 'READY' : 'IDLE',
    actions: IS_DEV ? 'READY' : 'IDLE',
    results: IS_DEV ? 'READY' : 'IDLE',
    audit: IS_DEV ? 'READY' : 'IDLE',
    aiRuns: IS_DEV ? 'READY' : 'IDLE',
    securityEvents: IS_DEV ? 'READY' : 'IDLE',
  });
  const [dataLoadError, setDataLoadError] = useState<string | null>(null);

  // Monotonic generation counter & AbortController to protect against hydration race conditions
  const workspaceGenerationRef = React.useRef<number>(0);
  const abortControllerRef = React.useRef<AbortController | null>(null);

  // Active Template State (strictly null in production)
  const [activeTemplateId, setActiveTemplateId] = useState<string>('template_beauty_salon');
  const activeTemplate: BusinessTemplateData | null = IS_DEV
    ? (demoTemplatesMap[activeTemplateId] || demoTemplatesMap.template_beauty_salon)
    : null;

  // Global State Stores - Initialized strictly empty in production
  const [allLeaks, setAllLeaks] = useState<RevenueLeakRow[]>(IS_DEV ? initialRevenueLeaks : []);
  const [allActions, setAllActions] = useState<GrowthActionRow[]>(IS_DEV ? initialGrowthActions : []);
  const [allActionResults, setAllActionResults] = useState<ActionResultRow[]>(IS_DEV ? initialActionResults : []);
  const [allLeads, setAllLeads] = useState<LeadRow[]>(IS_DEV ? initialLeads : []);
  const [allFacts, setAllFacts] = useState<BusinessTwinFactRow[]>(IS_DEV ? initialBusinessTwinFacts : []);
  const [allAuditLogs, setAllAuditLogs] = useState<AuditLogRow[]>(IS_DEV ? initialAuditLogs : []);
  const [allAIRuns, setAllAIRuns] = useState<AIRunRow[]>(IS_DEV ? initialAIRuns : []);

  // Sprint 3 Stores - Initialized strictly empty in production
  const [appointments, setAppointments] = useState<Appointment[]>(
    IS_DEV && activeTemplate ? activeTemplate.appointments : []
  );
  const [posTransactions, setPosTransactions] = useState<POSTransactionSummary[]>(
    IS_DEV && activeTemplate ? activeTemplate.posTransactions : []
  );
  const [daypartPerformance, setDaypartPerformance] = useState<DaypartPerformance[]>(
    IS_DEV && activeTemplate ? activeTemplate.daypartPerformance : []
  );
  const [callEvents, setCallEvents] = useState<CallMetadataEvent[]>(
    IS_DEV && activeTemplate ? activeTemplate.callEvents : []
  );
  const [customerJourneys, setCustomerJourneys] = useState<CustomerJourney[]>(
    IS_DEV && activeTemplate ? activeTemplate.customerJourneys : []
  );
  const [attributionResults, setAttributionResults] = useState<AttributionResult[]>(
    IS_DEV && activeTemplate ? activeTemplate.attributionResults : []
  );
  const [retentionPolicies] = useState<DataRetentionPolicy[]>(defaultRetentionPolicies);
  const [checkInEvents, setCheckInEvents] = useState<PhysicalCheckInEvent[]>([]);
  const [securityEvents, setSecurityEvents] = useState<SecurityEvent[]>(IS_DEV ? [
    {
      id: 'sec_ev_01',
      organizationId: 'org_apex_holding',
      eventType: 'cross_tenant_access.denied',
      severity: 'HIGH',
      sourceIpHash: '7f000001_d8e8fca2',
      details: { attemptedOrgTarget: 'org_external_tenant_99', requestedResource: 'leads.read' },
      enforcementAction: 'BLOCKED_IMMEDIATELY',
      timestamp: '2026-08-24T04:12:00Z',
    },
    {
      id: 'sec_ev_02',
      organizationId: 'org_apex_holding',
      eventType: 'rate_limit.triggered',
      severity: 'MEDIUM',
      sourceIpHash: 'a12b34cd_e44991aa',
      details: { endpoint: '/api/v1/telephony/events', requestsIn60s: 340, threshold: 120 },
      enforcementAction: 'RATE_LIMITED',
      timestamp: '2026-08-24T03:45:00Z',
    }
  ] : []);

  // Clears business-specific operational state while preserving organization & business list
  const clearBusinessWorkspace = useCallback(() => {
    setAllLeads([]);
    setAppointments([]);
    setAllLeaks([]);
    setAllActions([]);
    setAllActionResults([]);
    setAllFacts([]);
    setCheckInEvents([]);
    setCallEvents([]);
    setPosTransactions([]);
    setDaypartPerformance([]);
    setCustomerJourneys([]);
    setAttributionResults([]);
    setAllAIRuns([]);
    setDataLoadError(null);
  }, []);

  // Clears entire organization workspace including businesses and all child stores
  const clearOrganizationWorkspace = useCallback(() => {
    clearBusinessWorkspace();
    setCurrentOrg(null);
    setCurrentBusiness(null);
    setActiveBusinessId(null);
    setBusinesses([]);
    setAllAuditLogs([]);
    setSecurityEvents([]);
    setBusinessLoadStatus('IDLE');
    setDatasetStatuses({
      bootstrap: 'IDLE',
      leads: 'IDLE',
      appointments: 'IDLE',
      leaks: 'IDLE',
      actions: 'IDLE',
      results: 'IDLE',
      audit: 'IDLE',
      aiRuns: 'IDLE',
      securityEvents: 'IDLE',
    });
  }, [clearBusinessWorkspace]);

  // Backwards compatibility alias
  const clearWorkspaceData = clearOrganizationWorkspace;

  // Synchronize stores when demo template changes (DEV only)
  useEffect(() => {
    if (IS_DEV && activeTemplate) {
      setAppointments(activeTemplate.appointments);
      setPosTransactions(activeTemplate.posTransactions);
      setDaypartPerformance(activeTemplate.daypartPerformance);
      setCallEvents(activeTemplate.callEvents);
      setCustomerJourneys(activeTemplate.customerJourneys);
      setAttributionResults(activeTemplate.attributionResults);
    }
  }, [activeTemplateId, activeTemplate]);

  // Row Shape Validators to prevent data corruption from invalid API payloads
  const isValidLeadShape = (r: any): boolean => {
    return Boolean(
      r &&
      typeof r.id === 'string' &&
      typeof r.business_id === 'string' &&
      typeof r.organization_id === 'string' &&
      typeof r.market === 'string' &&
      typeof r.intent_score === 'number' &&
      typeof r.estimated_deal_value_minor === 'number' &&
      typeof r.funnel_stage === 'string' &&
      typeof r.status === 'string'
    );
  };

  const isValidAppointmentShape = (r: any): boolean => {
    return Boolean(
      r &&
      typeof r.id === 'string' &&
      typeof r.business_id === 'string' &&
      typeof r.organization_id === 'string' &&
      typeof r.status === 'string'
    );
  };

  const isValidLeakShape = (r: any): boolean => {
    return Boolean(
      r &&
      typeof r.id === 'string' &&
      typeof r.business_id === 'string' &&
      typeof r.organization_id === 'string' &&
      typeof r.market === 'string' &&
      typeof r.category === 'string' &&
      typeof r.severity === 'string' &&
      typeof r.estimated_monthly_loss_minor === 'number' &&
      typeof r.status === 'string'
    );
  };

  const isValidActionShape = (r: any): boolean => {
    return Boolean(
      r &&
      typeof r.id === 'string' &&
      typeof r.leak_id === 'string' &&
      typeof r.business_id === 'string' &&
      typeof r.organization_id === 'string' &&
      typeof r.action_type === 'string' &&
      typeof r.approval_status === 'string'
    );
  };

  const isValidResultShape = (r: any): boolean => {
    return Boolean(
      r &&
      typeof r.id === 'string' &&
      typeof r.growth_action_id === 'string' &&
      typeof r.business_id === 'string' &&
      typeof r.organization_id === 'string' &&
      typeof r.status === 'string' &&
      typeof r.revenue_recovered_amount_minor === 'number'
    );
  };

  const isValidAuditLogRow = (r: any): boolean => {
    return Boolean(
      r &&
      typeof r.id === 'string' &&
      typeof r.organization_id === 'string' &&
      typeof r.actor_id === 'string' &&
      typeof r.actor_role === 'string' &&
      typeof r.action === 'string' &&
      typeof r.target_entity_type === 'string' &&
      typeof r.target_entity_id === 'string' &&
      typeof r.created_at === 'string'
    );
  };

  const isValidAIRunRow = (r: any): boolean => {
    try {
      validateCanonicalAIRunRecord(r);
      return true;
    } catch {
      return false;
    }
  };

  const isValidSecurityEvent = (r: any): boolean => {
    return Boolean(
      r &&
      typeof r.id === 'string' &&
      typeof r.organizationId === 'string' &&
      typeof r.eventType === 'string' &&
      typeof r.severity === 'string' &&
      typeof r.sourceIpHash === 'string' &&
      typeof r.enforcementAction === 'string' &&
      typeof r.timestamp === 'string'
    );
  };

  // Load business operational ledgers with strict tenant and business scope
  const loadBusinessOperationalData = useCallback(async (
    orgId: string,
    businessId: string,
    generation: number,
    signal: AbortSignal
  ) => {
    setBusinessLoadStatus('LOADING');
    setDatasetStatuses(prev => ({
      ...prev,
      leads: 'LOADING',
      appointments: 'LOADING',
      leaks: 'LOADING',
      actions: 'LOADING',
      results: 'LOADING',
      audit: 'LOADING',
      aiRuns: 'LOADING',
      securityEvents: 'LOADING',
    }));

    try {
      const headers = ApiClient.getAuthenticatedHeaders({ customTenantId: orgId });
      const bizParam = `&businessId=${encodeURIComponent(businessId)}`;

      const [
        leadsRes,
        appointmentsRes,
        leaksRes,
        actionsRes,
        resultsRes,
        auditRes,
        runsRes,
        secEventsRes
      ] = await Promise.allSettled([
        fetch(`/api/leads?orgId=${encodeURIComponent(orgId)}${bizParam}`, { headers, signal }),
        fetch(`/api/appointments?orgId=${encodeURIComponent(orgId)}${bizParam}`, { headers, signal }),
        fetch(`/api/leaks?orgId=${encodeURIComponent(orgId)}${bizParam}`, { headers, signal }),
        fetch(`/api/actions?orgId=${encodeURIComponent(orgId)}${bizParam}`, { headers, signal }),
        fetch(`/api/proof?orgId=${encodeURIComponent(orgId)}${bizParam}`, { headers, signal }),
        fetch(`/api/audit?orgId=${encodeURIComponent(orgId)}${bizParam}`, { headers, signal }),
        fetch(`/api/ai/runs?orgId=${encodeURIComponent(orgId)}${bizParam}`, { headers, signal }),
        fetch(`/api/security/events?orgId=${encodeURIComponent(orgId)}`, { headers, signal }),
      ]);

      if (signal.aborted || generation !== workspaceGenerationRef.current) {
        return;
      }

      const parseJsonSafely = async (
        resSettled: PromiseSettledResult<Response>,
        validator?: (item: any) => boolean
      ): Promise<{ ok: boolean; data: any[] | null }> => {
        if (resSettled.status !== 'fulfilled' || !resSettled.value.ok) {
          return { ok: false, data: null };
        }
        try {
          const json = (await resSettled.value.json()) as any;
          if (json && Array.isArray(json.data)) {
            if (validator) {
              const allValid = json.data.every((item: any) => validator(item));
              if (!allValid) {
                return { ok: false, data: null };
              }
            }
            return { ok: true, data: json.data };
          }
          return { ok: false, data: null };
        } catch {
          return { ok: false, data: null };
        }
      };

      const [
        leadsData,
        appointmentsData,
        leaksData,
        actionsData,
        resultsData,
        auditData,
        runsData,
        secEventsData
      ] = await Promise.all([
        parseJsonSafely(leadsRes, isValidLeadShape),
        parseJsonSafely(appointmentsRes, isValidAppointmentShape),
        parseJsonSafely(leaksRes, isValidLeakShape),
        parseJsonSafely(actionsRes, isValidActionShape),
        parseJsonSafely(resultsRes, isValidResultShape),
        parseJsonSafely(auditRes, isValidAuditLogRow),
        parseJsonSafely(runsRes, isValidAIRunRow),
        parseJsonSafely(secEventsRes, isValidSecurityEvent),
      ]);

      if (signal.aborted || generation !== workspaceGenerationRef.current) {
        return;
      }

      if (leadsData.ok && leadsData.data) setAllLeads(leadsData.data);
      if (appointmentsData.ok && appointmentsData.data) setAppointments(appointmentsData.data);
      if (leaksData.ok && leaksData.data) setAllLeaks(leaksData.data);
      if (actionsData.ok && actionsData.data) setAllActions(actionsData.data);
      if (resultsData.ok && resultsData.data) setAllActionResults(resultsData.data);
      if (auditData.ok && auditData.data) setAllAuditLogs(auditData.data);
      if (runsData.ok && runsData.data) setAllAIRuns(runsData.data);
      if (secEventsData.ok && secEventsData.data) setSecurityEvents(secEventsData.data);

      const criticalFailed = !leadsData.ok || !leaksData.ok || !actionsData.ok || !resultsData.ok;
      if (criticalFailed) {
        setDataLoadError('Partial data load failure: Critical operational ledgers could not be loaded from database.');
        setBusinessLoadStatus('ERROR');
      } else {
        setBusinessLoadStatus('READY');
      }

      setDatasetStatuses(prev => ({
        ...prev,
        leads: leadsData.ok ? 'READY' : 'ERROR',
        appointments: appointmentsData.ok ? 'READY' : 'ERROR',
        leaks: leaksData.ok ? 'READY' : 'ERROR',
        actions: actionsData.ok ? 'READY' : 'ERROR',
        results: resultsData.ok ? 'READY' : 'ERROR',
        audit: auditData.ok ? 'READY' : 'ERROR',
        aiRuns: runsData.ok ? 'READY' : 'ERROR',
        securityEvents: secEventsData.ok ? 'READY' : 'ERROR',
      }));
    } catch (err: any) {
      if (signal.aborted || generation !== workspaceGenerationRef.current) return;
      if (IS_DEV) console.warn('[BUSINESS_DATA_FETCH_FAILED]', err);
      setDataLoadError('Failed to load business operational data.');
      setBusinessLoadStatus('ERROR');
    }
  }, []);

  // Load tenant-scoped production data from backend API
  const loadProductionTenantData = useCallback(async (orgId: string) => {
    const currentGen = ++workspaceGenerationRef.current;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortCtrl = new AbortController();
    abortControllerRef.current = abortCtrl;

    // Clear all stores immediately to guarantee cross-tenant data isolation
    clearOrganizationWorkspace();
    setBusinessLoadStatus('LOADING');
    setDatasetStatuses(prev => ({ ...prev, bootstrap: 'LOADING' }));

    try {
      // Step 1: Bootstrap canonical Organization and Businesses
      const bootstrap = await ApiClient.fetchBootstrap(orgId);
      if (abortCtrl.signal.aborted || currentGen !== workspaceGenerationRef.current) {
        return;
      }

      if (!bootstrap || !bootstrap.organization) {
        setDataLoadError('Failed to load canonical organization bootstrap metadata.');
        setBusinessLoadStatus('ERROR');
        setDatasetStatuses(prev => ({ ...prev, bootstrap: 'ERROR' }));
        return;
      }

      setCurrentOrg(bootstrap.organization);
      const loadedBusinesses = bootstrap.businesses || [];
      setBusinesses(loadedBusinesses);
      setDatasetStatuses(prev => ({ ...prev, bootstrap: 'READY' }));

      if (loadedBusinesses.length === 0) {
        setActiveBusinessId(null);
        setCurrentBusiness(null);
        setBusinessLoadStatus('UNAVAILABLE');
        return;
      }

      if (loadedBusinesses.length === 1) {
        // Deterministic auto-selection if and only if exactly 1 business exists
        const singleBiz = loadedBusinesses[0];
        setActiveBusinessId(singleBiz.id);
        setCurrentBusiness(singleBiz);
        await loadBusinessOperationalData(orgId, singleBiz.id, currentGen, abortCtrl.signal);
      } else {
        // Multi-business tenant: require explicit user selection!
        setActiveBusinessId(null);
        setCurrentBusiness(null);
        setBusinessLoadStatus('IDLE');
      }
    } catch (err: any) {
      if (abortCtrl.signal.aborted || currentGen !== workspaceGenerationRef.current) {
        return;
      }
      if (IS_DEV) console.warn('[PRODUCTION_BOOTSTRAP_FETCH_FAILED]', err);
      setDataLoadError('Failed to load organization bootstrap data.');
      setBusinessLoadStatus('ERROR');
      setDatasetStatuses(prev => ({ ...prev, bootstrap: 'ERROR' }));
    }
  }, [clearOrganizationWorkspace, loadBusinessOperationalData]);

  // Explicit Business Selection
  const selectBusiness = useCallback(async (businessId: string) => {
    if (IS_DEV) {
      setActiveBusinessId(businessId);
      const found = businesses.find(b => b.id === businessId) || null;
      setCurrentBusiness(found);
      return;
    }

    const found = businesses.find(b => b.id === businessId);
    if (!found) {
      throw new Error('BUSINESS_NOT_FOUND: Selected business does not belong to the active organization.');
    }

    const currentGen = ++workspaceGenerationRef.current;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortCtrl = new AbortController();
    abortControllerRef.current = abortCtrl;

    // Purge business-specific operational state before loading new business
    clearBusinessWorkspace();

    setActiveBusinessId(businessId);
    setCurrentBusiness(found);

    const orgId = activeOrganizationId || currentOrg?.id;
    if (orgId) {
      await loadBusinessOperationalData(orgId, businessId, currentGen, abortCtrl.signal);
    }
  }, [businesses, activeOrganizationId, currentOrg, clearBusinessWorkspace, loadBusinessOperationalData]);

  // Production Session Initialization
  useEffect(() => {
    if (IS_DEV) {
      ApiClient.setActiveTenantId('org_apex_holding');
      return;
    }

    const unsubscribe = SessionClient.subscribe((state: SessionState) => {
      setSessionStatus(state.status);
      if (state.status === 'AUTHENTICATED') {
        setSessionUser(state.user);
        setActiveOrganizationId(state.activeTenantId);
        setCurrentRole(state.role as UserRole | null);

        if (state.activeTenantId) {
          ApiClient.setActiveTenantId(state.activeTenantId);
          loadProductionTenantData(state.activeTenantId);
        } else {
          ApiClient.clearActiveTenant();
          clearOrganizationWorkspace();
        }
      } else {
        setSessionUser(null);
        setActiveOrganizationId(null);
        setCurrentRole(null);
        ApiClient.clearActiveTenant();
        clearOrganizationWorkspace();
      }
    });

    SessionClient.initializeSession(null);

    return () => {
      unsubscribe();
    };
  }, [loadProductionTenantData, clearOrganizationWorkspace]);

  // Select/switch organization
  const selectOrganization = async (orgId: string) => {
    if (IS_DEV) {
      setActiveOrganizationId(orgId);
      ApiClient.setActiveTenantId(orgId);
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    // Immediately clear all existing tenant stores
    clearOrganizationWorkspace();

    const state = await SessionClient.switchTenant(orgId);
    if (state.status === 'ERROR') {
      throw new Error(state.error);
    }
    // The SessionClient subscription listener handles updating activeOrganizationId, currentRole, and calling loadProductionTenantData exactly once!
  };

  const memberships = useMemo(() => {
    return sessionUser?.memberships || [];
  }, [sessionUser]);

  const t = translations[language];

  // Market-Filtered core data
  const leaks = useMemo(() => allLeaks.filter(l => l.market === currentMarket), [allLeaks, currentMarket]);
  const actions = useMemo(() => allActions.filter(a => a.market === currentMarket), [allActions, currentMarket]);
  const actionResults = useMemo(() => {
    return allActionResults.filter(r => {
      if (currentBusiness) {
        return r.business_id === currentBusiness.id;
      }
      return true;
    });
  }, [allActionResults, currentBusiness]);
  const leads = useMemo(() => allLeads.filter(ld => ld.market === currentMarket), [allLeads, currentMarket]);
  const facts = useMemo(() => allFacts.filter(f => f.market === currentMarket), [allFacts, currentMarket]);
  const auditLogs = allAuditLogs;
  const aiRuns = allAIRuns;

  // Format Currency Utility (strictly uses canonical business currency, never silent USD in production)
  const formatCurrency = (amount: number): string => {
    if (!IS_DEV && !currentBusiness) {
      return '—';
    }
    const currency = activeTemplate?.currency || currentBusiness?.currency || (IS_DEV ? 'USD' : null);
    if (!currency) {
      return '—';
    }
    try {
      if (currency === 'TRY') {
        return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(amount);
      }
      if (currency === 'EUR') {
        return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(amount);
      }
      if (currency === 'GBP') {
        return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(amount);
      }
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(amount);
    } catch {
      return `${currency} ${amount.toLocaleString()}`;
    }
  };

  // Deterministic Revenue Leak Evaluation
  const calculatedLeaks = useMemo<RevenueImpactCalculation[]>(() => {
    const evaluationTimestamp = new Date().toISOString();

    if (!IS_DEV) {
      // In production, evaluate only when canonical business and telemetry data exist
      if (!currentBusiness) {
        return [];
      }
      if (leads.length === 0 && appointments.length === 0 && callEvents.length === 0) {
        return [];
      }

      // ZERO INVENTED BASELINES: Look for verified facts or pass UNAVAILABLE provenance
      const verifiedDealFact = facts.find(f => (f.fact_key === 'average_deal_value' || f.fact_key === 'avg_deal_value') && f.verified_by_human === 1);
      let dealValAssumption: MoneyMetricWithProvenance = {
        valueMinor: 0,
        currency: currentBusiness.currency as CurrencyCode,
        provenance: { source: 'UNAVAILABLE', confidence: 'INSUFFICIENT' }
      };
      if (verifiedDealFact) {
        const validated = validateVerifiedMoneyMetric(verifiedDealFact.fact_value_json, currentBusiness.currency);
        const hasValidFactId = typeof verifiedDealFact.id === 'string' && verifiedDealFact.id.trim().length > 0;
        if (validated && validated.valueMinor > 0 && hasValidFactId) {
          dealValAssumption = {
            valueMinor: validated.valueMinor,
            currency: validated.currency,
            provenance: {
              source: 'PERSISTED_BUSINESS_METRIC',
              sourceId: verifiedDealFact.id.trim(),
              confidence: validated.confidence,
              sampleSize: validated.sampleSize ?? undefined,
              timeRange: validated.timeRange ?? undefined,
              notes: validated.methodology ?? verifiedDealFact.fact_key
            }
          };
        }
      }

      const verifiedConvFact = facts.find(f => (f.fact_key === 'baseline_conversion_rate' || f.fact_key === 'conversion_rate') && f.verified_by_human === 1);
      let convAssumption: RateMetricWithProvenance = {
        value: 0,
        provenance: { source: 'UNAVAILABLE', confidence: 'INSUFFICIENT' }
      };
      if (verifiedConvFact) {
        const validated = validateVerifiedRateMetric(verifiedConvFact.fact_value_json);
        const hasValidFactId = typeof verifiedConvFact.id === 'string' && verifiedConvFact.id.trim().length > 0;
        if (validated && validated.value >= 0 && validated.value <= 1 && hasValidFactId) {
          convAssumption = {
            value: validated.value,
            provenance: {
              source: 'PERSISTED_BUSINESS_METRIC',
              sourceId: verifiedConvFact.id.trim(),
              confidence: validated.confidence,
              sampleSize: validated.sampleSize ?? undefined,
              timeRange: validated.timeRange ?? undefined,
              notes: validated.methodology ?? verifiedConvFact.fact_key
            }
          };
        }
      }

      return RevenueLeakEngine.evaluateAll({
        businessId: currentBusiness.id,
        leads,
        appointments,
        leadActivityEvidence: [],
        callHistoryCoverage: { businessId: currentBusiness.id, coveredFrom: '', coveredTo: '', isComplete: false },
        appointmentHistoryCoverage: { businessId: currentBusiness.id, coveredFrom: '', coveredTo: '', isComplete: false },
        capacity: undefined,
        calls: callEvents,
        currency: currentBusiness.currency,
        evaluationTimestamp,
        avgDealValueAssumption: dealValAssumption,
        conversionRateAssumption: convAssumption,
      });
    }

    // DEV: Evaluate with demo template assumptions
    const deterministicEvaluations = RevenueLeakEngine.evaluateAll({
      leads,
      appointments,
      capacity: activeTemplate?.capacityUtilization,
      calls: callEvents,
      currency: activeTemplate?.currency || 'USD',
      evaluationTimestamp,
      avgDealValueAssumption: {
        valueMinor: activeTemplate?.currency === 'TRY' ? 450000 : 2500000,
        currency: (activeTemplate?.currency as CurrencyCode) || 'USD',
        provenance: {
          source: 'BUSINESS_CONFIGURED',
          sourceId: 'demo_configured_avg_deal_value',
          confidence: 'MEDIUM',
          sampleSize: 120,
          timeRange: null
        }
      },
      conversionRateAssumption: {
        value: 0.28,
        provenance: {
          source: 'BUSINESS_CONFIGURED',
          sourceId: 'demo_configured_conversion_rate',
          confidence: 'MEDIUM',
          sampleSize: 85,
          timeRange: null
        }
      },
    });

    const combined = activeTemplate ? [...activeTemplate.calculatedLeaks] : [];
    deterministicEvaluations.forEach(evalLeak => {
      const existingIdx = combined.findIndex(c => c.ruleId === evalLeak.ruleId);
      if (existingIdx >= 0) {
        combined[existingIdx] = evalLeak;
      } else {
        combined.push(evalLeak);
      }
    });

    return combined;
  }, [leads, appointments, activeTemplate, callEvents, currentBusiness, facts]);

  // Compute Outcome Metrics
  const metrics = useMemo<MarketMetrics>(() => {
    const activeLeaks = calculatedLeaks.filter(l => l.status === 'active' && !l.isDataInsufficient && l.confidenceLevel !== 'INSUFFICIENT' && l.estimatedImpactMinor !== null);
    const totalRevenueAtRisk = activeLeaks.reduce((sum, l) => sum + ((l.estimatedImpactMinor || 0) / 100), 0);
    
    const uncapturedLeadValue = leads
      .filter(ld => ld.status === 'open' && ld.intent_score > 75)
      .reduce((sum, ld) => sum + ((ld.estimated_deal_value_minor || 0) / 100), 0);

    const pendingActions = actions.filter(a => a.approval_status === 'pending_approval');
    const waitingApprovalCount = pendingActions.length;

    const totalRevenueInfluenced = actionResults
      .filter(r => r.status === 'success')
      .reduce((sum, r) => sum + ((r.revenue_recovered_amount_minor || 0) / 100), 0);

    const criticalCount = activeLeaks.filter(l => l.severity === 'critical').length;
    const highCount = activeLeaks.filter(l => l.severity === 'high').length;
    const mediumCount = activeLeaks.filter(l => l.severity === 'medium').length;

    const verifiedFactsCount = facts.filter(f => f.verified_by_human === 1).length;
    const totalFactsCount = facts.length || 1;
    const twinConfidenceScore = Math.round((verifiedFactsCount / totalFactsCount) * 100);

    const currencySymbol = activeTemplate?.currencySymbol || (currentBusiness?.currency === 'TRY' ? '₺' : currentBusiness?.currency === 'EUR' ? '€' : '$');
    const currencyCode = activeTemplate?.currency || currentBusiness?.currency || (IS_DEV ? 'USD' : 'UNKNOWN');

    return {
      revenueAtRisk: totalRevenueAtRisk,
      growthOpportunities: uncapturedLeadValue,
      actionsWaitingApproval: waitingApprovalCount,
      revenueInfluenced: totalRevenueInfluenced,
      currencySymbol,
      currencyCode,
      leaksCount: {
        critical: criticalCount,
        high: highCount,
        medium: mediumCount,
      },
      twinConfidenceScore,
      productLoopStep: waitingApprovalCount > 0 ? 'APPROVE' : 'DETECT',
    };
  }, [calculatedLeaks, actions, actionResults, leads, facts, activeTemplate, currentBusiness]);

  // Demo Audit Log Dispatcher (DEV ONLY)
  const logDemoAuditEntry = (actionName: string, entityType: string, entityId: string, diff: Record<string, any>) => {
    if (!IS_DEV) return;
    const activeOrgId = ApiClient.getActiveTenantId() || currentOrg?.id;
    if (!activeOrgId) return;
    const newLog: AuditLogRow = {
      id: `aud_${crypto.randomUUID()}`,
      organization_id: activeOrgId,
      business_id: currentBusiness?.id || 'biz_primary',
      actor_id: mockUsers.find(u => u.role_global === 'founder')?.id || 'usr_owner_01',
      actor_role: currentRole || 'OWNER',
      action: actionName,
      target_entity_type: entityType,
      target_entity_id: entityId,
      payload_diff_json: JSON.stringify(diff),
      ip_hash: crypto.randomUUID().replace(/-/g, '').substring(0, 10) + 'a9',
      created_at: new Date().toISOString(),
    };
    setAllAuditLogs(prev => [newLog, ...prev]);
  };

  // Action Approvals (Worker-Authoritative with atomic audit log)
  const approveAction = async (actionId: string): Promise<{ success: boolean; message: string }> => {
    try {
      const orgId = ApiClient.getActiveTenantId() || currentOrg?.id || '';
      if (!orgId) {
        return { success: false, message: 'TENANT_ID_REQUIRED: Active tenant required for action approval.' };
      }

      const headers = ApiClient.getAuthenticatedHeaders({ customTenantId: orgId });
      const res = await fetch(`/api/actions?orgId=${encodeURIComponent(orgId)}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ actionId, status: 'approved' }),
      });

      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as any;
        const errMsg = errData.message || errData.error || `Action approval rejected (${res.status})`;
        return {
          success: false,
          message: errMsg,
        };
      }

      const responseData = (await res.json()) as any;
      const updatedAction: GrowthActionRow = responseData.data;

      if (!updatedAction || !updatedAction.id) {
        return {
          success: false,
          message: 'Server returned empty or invalid action payload upon approval.',
        };
      }

      // Update local state strictly using canonical server row
      setAllActions(prev => prev.map(a => {
        if (a.id === actionId) {
          return updatedAction;
        }
        return a;
      }));

      // Prepend server audit log if returned
      if (responseData.auditLog) {
        setAllAuditLogs(prev => [responseData.auditLog, ...prev]);
      }

      return {
        success: true,
        message: language === 'tr' ? 'Aksiyon başarıyla onaylandı.' : 'Action approved successfully.'
      };
    } catch (err: any) {
      return {
        success: false,
        message: err.message || 'Network error approving action.'
      };
    }
  };

  const rejectAction = async (actionId: string): Promise<{ success: boolean; message: string }> => {
    try {
      const orgId = ApiClient.getActiveTenantId() || currentOrg?.id || '';
      if (!orgId) {
        return { success: false, message: 'TENANT_ID_REQUIRED: Active tenant required for action rejection.' };
      }

      const headers = ApiClient.getAuthenticatedHeaders({ customTenantId: orgId });
      const res = await fetch(`/api/actions?orgId=${encodeURIComponent(orgId)}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ actionId, status: 'rejected' }),
      });

      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as any;
        return {
          success: false,
          message: errData.message || errData.error || 'Failed to reject action.',
        };
      }

      const responseData = (await res.json()) as any;
      const updatedAction: GrowthActionRow = responseData.data;

      if (!updatedAction || !updatedAction.id) {
        return {
          success: false,
          message: 'Server returned empty or invalid action payload upon rejection.',
        };
      }

      setAllActions(prev => prev.map(a => {
        if (a.id === actionId) {
          return updatedAction;
        }
        return a;
      }));

      if (responseData.auditLog) {
        setAllAuditLogs(prev => [responseData.auditLog, ...prev]);
      }

      return {
        success: true,
        message: language === 'tr' ? 'Aksiyon reddedildi.' : 'Action rejected.'
      };
    } catch (err: any) {
      return {
        success: false,
        message: err.message || 'Network error rejecting action.'
      };
    }
  };

  const deferAction = async (actionId: string): Promise<{ success: boolean; message: string }> => {
    try {
      const orgId = ApiClient.getActiveTenantId() || currentOrg?.id || '';
      if (!orgId) {
        return { success: false, message: 'TENANT_ID_REQUIRED: Active tenant required for action deferral.' };
      }

      const headers = ApiClient.getAuthenticatedHeaders({ customTenantId: orgId });
      const res = await fetch(`/api/actions?orgId=${encodeURIComponent(orgId)}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ actionId, status: 'deferred' }),
      });

      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as any;
        return {
          success: false,
          message: errData.message || errData.error || 'Failed to defer action.',
        };
      }

      const responseData = (await res.json()) as any;
      const updatedAction: GrowthActionRow = responseData.data;

      if (!updatedAction || !updatedAction.id) {
        return {
          success: false,
          message: 'Server returned empty or invalid action payload upon deferral.',
        };
      }

      setAllActions(prev => prev.map(a => {
        if (a.id === actionId) {
          return updatedAction;
        }
        return a;
      }));

      if (responseData.auditLog) {
        setAllAuditLogs(prev => [responseData.auditLog, ...prev]);
      }

      return {
        success: true,
        message: language === 'tr' ? 'Aksiyon incelemesi ertelendi.' : 'Action deferred.'
      };
    } catch (err: any) {
      return {
        success: false,
        message: err.message || 'Network error deferring action.'
      };
    }
  };

  const verifyFact = (factId: string) => {
    if (!IS_DEV) {
      throw new Error('FEATURE_NOT_SERVER_PERSISTED: Business fact verification requires server persistence endpoint.');
    }

    setAllFacts(prev => prev.map(f => {
      if (f.id === factId) {
        return { ...f, verified_by_human: 1, confidence_score: 0.99, updated_at: new Date().toISOString() };
      }
      return f;
    }));

    logDemoAuditEntry('BUSINESS_TWIN_FACT_VERIFIED', 'business_twin_facts', factId, {
      verified_by_human: { old: 0, new: 1 },
      actor_role: currentRole
    });
  };

  const addFact = (newFactData: Omit<BusinessTwinFactRow, 'id' | 'business_id' | 'market' | 'updated_at'>) => {
    if (!IS_DEV) {
      throw new Error('FEATURE_NOT_SERVER_PERSISTED: Adding business facts requires server persistence endpoint.');
    }

    const businessId = currentBusiness?.id || 'biz_primary';
    const newFact: BusinessTwinFactRow = {
      id: `fact_${currentMarket.toLowerCase()}_${Date.now().toString(36)}`,
      business_id: businessId,
      market: currentMarket,
      fact_category: newFactData.fact_category,
      fact_key: newFactData.fact_key,
      fact_value_json: newFactData.fact_value_json,
      confidence_score: newFactData.confidence_score,
      verified_by_human: newFactData.verified_by_human,
      source: newFactData.source,
      updated_at: new Date().toISOString(),
    };

    setAllFacts(prev => [newFact, ...prev]);

    logDemoAuditEntry('BUSINESS_TWIN_FACT_INGESTED', 'business_twin_facts', newFact.id, {
      key: newFact.fact_key,
      category: newFact.fact_category
    });
  };

  const triggerFastLeadResponse = (leadId: string) => {
    if (!IS_DEV) {
      throw new Error('FEATURE_NOT_SERVER_PERSISTED: Fast lead response dispatch requires server persistence endpoint.');
    }

    setAllLeads(prev => prev.map(ld => {
      if (ld.id === leadId) {
        return {
          ...ld,
          status: 'contacted',
          leak_risk_factor: 'normal',
          response_latency_minutes: Math.min(ld.response_latency_minutes, 3),
        };
      }
      return ld;
    }));

    logDemoAuditEntry('LEAD_ACCELERATED_SLA_DISPATCH', 'leads', leadId, {
      status: { old: 'open', new: 'contacted' },
      sla_response: 'fast_tracked'
    });
  };

  // Sprint 3: Appointment Operations
  const createManualAppointment = (params: {
    customerPseudonymId?: string;
    serviceName: string;
    serviceCategory: string;
    resourceStaffName: string;
    scheduledStart: string;
    durationMinutes: number;
    expectedValueMinor: number;
    currency: string;
  }): Appointment | null => {
    if (!IS_DEV) {
      throw new Error('FEATURE_NOT_SERVER_PERSISTED: Manual appointment creation requires server persistence endpoint.');
    }

    const orgId = currentOrg?.id || ApiClient.getActiveTenantId();
    const bizId = currentBusiness?.id || 'biz_primary';
    if (!orgId) return null;

    const { appointment } = AppointmentEngine.createManualAppointment({
      organizationId: orgId,
      businessId: bizId,
      ...params
    });

    setAppointments(prev => [appointment, ...prev]);

    logDemoAuditEntry('APPOINTMENT_MANUAL_CREATED', 'appointments', appointment.id, {
      customerPseudonymId: appointment.customerPseudonymId,
      service: appointment.serviceName,
      expectedValueMinor: appointment.expectedValueMinor,
    });

    return appointment;
  };

  const updateAppointmentStatus = (appointmentId: string, status: AppointmentStatus, reasonCode?: CancellationReasonCode) => {
    if (!IS_DEV) {
      throw new Error('FEATURE_NOT_SERVER_PERSISTED: Appointment status update requires server persistence endpoint.');
    }

    setAppointments(prev => prev.map(apt => {
      if (apt.id === appointmentId) {
        return {
          ...apt,
          status,
          cancellationReasonCode: reasonCode || apt.cancellationReasonCode,
          rowVersion: apt.rowVersion + 1,
          updatedAt: new Date().toISOString()
        };
      }
      return apt;
    }));

    logDemoAuditEntry('APPOINTMENT_STATUS_UPDATED', 'appointments', appointmentId, {
      status: { new: status, reasonCode }
    });
  };

  // Sprint 3: Fallback Quick Check-In (DEV ONLY)
  const recordQuickCheckIn = (
    type: CheckInType,
    source: CheckInSource,
    partySize: number,
    service?: string
  ): PhysicalCheckInEvent | null => {
    if (!IS_DEV) {
      throw new Error('FEATURE_NOT_SERVER_PERSISTED: Quick check-in logging requires server persistence endpoint.');
    }

    const orgId = currentOrg?.id || ApiClient.getActiveTenantId();
    const bizId = currentBusiness?.id || 'biz_primary';
    if (!orgId) return null;

    const ev = CheckInEngine.logCheckIn({
      organizationId: orgId,
      businessId: bizId,
      locationId: 'loc_primary',
      locationName: activeTemplate?.name || 'Primary Location',
      checkInType: type,
      source,
      partySize,
      serviceRequested: service
    });

    setCheckInEvents(prev => [ev, ...prev]);

    logDemoAuditEntry('PHYSICAL_CHECK_IN_LOGGED', 'check_ins', ev.id, {
      type,
      source,
      partySize
    });

    return ev;
  };

  const runLeakScan = async () => {
    // Zero synthetic hallucinations: require real revenue leaks
    if (allLeaks.length === 0) {
      throw new Error('NO_EVIDENCE_CLAIM: Cannot generate Growth Action without canonical evidence records.');
    }

    const orgId = ApiClient.getActiveTenantId() || currentOrg?.id;
    const businessId = activeBusinessId || currentBusiness?.id || (allLeaks[0] ? allLeaks[0].business_id : undefined);
    if (!orgId || !businessId) {
      throw new Error('TENANT_AND_BUSINESS_ID_REQUIRED: Cannot run leak scan without active tenant and business.');
    }

    setIsScanning(true);
    
    try {
      const primaryLeak = allLeaks[0];
      const leakId = primaryLeak.id;

      const draftResult = await AIClient.draftActionFromLeak({
        businessId,
        leakId
      }, orgId);

      const validatedRun = validateLeakScanAIRunResponse(draftResult, orgId, businessId);
      setAllAIRuns(prev => [validatedRun, ...prev]);
    } catch (err: any) {
      if (IS_DEV) console.warn('AI Scan Execution Warning:', err);
      throw err;
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <PlatformContext.Provider
      value={{
        currentRoute,
        setCurrentRoute,
        currentMarket,
        setMarket: setCurrentMarket,
        language,
        setLanguage,
        currentRole,
        setCurrentRole,
        currentOrg,
        currentBusiness,
        businesses,
        activeBusinessId,
        businessLoadStatus,
        datasetStatuses,
        selectBusiness,
        clearWorkspaceData,
        clearOrganizationWorkspace,
        clearBusinessWorkspace,
        dataLoadError,
        sessionStatus,
        sessionUser,
        memberships,
        activeOrganizationId,
        selectOrganization,
        activeTemplateId,
        setActiveTemplateId,
        activeTemplate,
        leaks,
        actions,
        actionResults,
        leads,
        facts,
        auditLogs,
        aiRuns,
        appointments,
        posTransactions,
        daypartPerformance,
        callEvents,
        customerJourneys,
        attributionResults,
        securityEvents,
        retentionPolicies,
        checkInEvents,
        calculatedLeaks,
        metrics,
        t,
        approveAction,
        rejectAction,
        deferAction,
        verifyFact,
        addFact,
        triggerFastLeadResponse,
        createManualAppointment,
        updateAppointmentStatus,
        recordQuickCheckIn,
        runLeakScan,
        isScanning,
        formatCurrency,
      }}
    >
      {children}
    </PlatformContext.Provider>
  );
};

export const usePlatform = () => {
  const context = useContext(PlatformContext);
  if (!context) {
    throw new Error('usePlatform must be used within a PlatformProvider');
  }
  return context;
};
