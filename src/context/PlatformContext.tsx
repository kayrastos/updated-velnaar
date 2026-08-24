import React, { createContext, useContext, useState, useMemo, useEffect } from 'react';
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
import { aiGateway } from '../services/aiGateway';

// Sprint 3 Imports
import { Appointment, AppointmentStatus, AppointmentSource } from '../types/appointment';
import { Resource, CapacityUtilization } from '../types/capacity';
import { POSTransactionSummary, DaypartPerformance } from '../types/pos';
import { CallMetadataEvent } from '../types/telephony';
import { CustomerJourney, AttributionResult } from '../types/attribution';
import { SecurityEvent, DataRetentionPolicy, PlatformRole } from '../types/security';
import { PhysicalCheckInEvent, CheckInType, CheckInSource } from '../types/checkin';
import { RevenueImpactCalculation } from '../types/leakEngine';
import { demoTemplatesMap, BusinessTemplateData } from '../data/demoTemplates';
import { RevenueLeakEngine } from '../services/revenueLeakEngine';
import { TenantSecurityEngine, defaultRetentionPolicies } from '../services/tenantSecurity';
import { AppointmentEngine } from '../services/appointmentEngine';
import { CheckInEngine } from '../services/checkInEngine';

interface PlatformContextValue {
  currentRoute: AppRoute;
  setCurrentRoute: (route: AppRoute) => void;
  currentMarket: MarketType;
  setMarket: (market: MarketType) => void;
  language: Language;
  setLanguage: (lang: Language) => void;
  currentRole: UserRole;
  setCurrentRole: (role: UserRole) => void;
  currentOrg: OrganizationRow;
  currentBusiness: BusinessRow;
  
  // Sprint 3: Active Business Archetype Template
  activeTemplateId: string;
  setActiveTemplateId: (id: string) => void;
  activeTemplate: BusinessTemplateData;

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
    customerName: string;
    serviceName: string;
    serviceCategory: string;
    resourceStaffName: string;
    scheduledStart: string;
    durationMinutes: number;
    expectedValueMinor: number;
    currency: string;
    notes?: string;
  }) => Appointment;
  updateAppointmentStatus: (appointmentId: string, status: AppointmentStatus, reason?: string) => void;
  recordQuickCheckIn: (type: CheckInType, source: CheckInSource, partySize: number, service?: string) => PhysicalCheckInEvent;
  runSecurityAuditTests: () => Array<{ testName: string; description: string; passed: boolean; statusText: string }>;

  // Formatting Utilities
  formatCurrency: (amount: number) => string;
}

const PlatformContext = createContext<PlatformContextValue | undefined>(undefined);

export const PlatformProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentRoute, setCurrentRoute] = useState<AppRoute>('/dashboard');
  const [currentMarket, setCurrentMarket] = useState<MarketType>('GLOBAL');
  const [language, setLanguage] = useState<Language>('en');
  const [currentRole, setCurrentRole] = useState<UserRole>('owner');
  const [isScanning, setIsScanning] = useState<boolean>(false);

  // Active Template State (Beauty Salon, Restaurant, Auto Dealership)
  const [activeTemplateId, setActiveTemplateId] = useState<string>('template_beauty_salon');
  const activeTemplate = demoTemplatesMap[activeTemplateId] || demoTemplatesMap.template_beauty_salon;

  // Global State Stores
  const [allLeaks, setAllLeaks] = useState<RevenueLeakRow[]>(initialRevenueLeaks);
  const [allActions, setAllActions] = useState<GrowthActionRow[]>(initialGrowthActions);
  const [allActionResults, setAllActionResults] = useState<ActionResultRow[]>(initialActionResults);
  const [allLeads, setAllLeads] = useState<LeadRow[]>(initialLeads);
  const [allFacts, setAllFacts] = useState<BusinessTwinFactRow[]>(initialBusinessTwinFacts);
  const [allAuditLogs, setAllAuditLogs] = useState<AuditLogRow[]>(initialAuditLogs);
  const [allAIRuns, setAllAIRuns] = useState<AIRunRow[]>(initialAIRuns);

  // Sprint 3 Stores (Initialized from active template)
  const [appointments, setAppointments] = useState<Appointment[]>(activeTemplate.appointments);
  const [posTransactions, setPosTransactions] = useState<POSTransactionSummary[]>(activeTemplate.posTransactions);
  const [daypartPerformance, setDaypartPerformance] = useState<DaypartPerformance[]>(activeTemplate.daypartPerformance);
  const [callEvents, setCallEvents] = useState<CallMetadataEvent[]>(activeTemplate.callEvents);
  const [customerJourneys, setCustomerJourneys] = useState<CustomerJourney[]>(activeTemplate.customerJourneys);
  const [attributionResults, setAttributionResults] = useState<AttributionResult[]>(activeTemplate.attributionResults);
  const [retentionPolicies, setRetentionPolicies] = useState<DataRetentionPolicy[]>(defaultRetentionPolicies);
  const [checkInEvents, setCheckInEvents] = useState<PhysicalCheckInEvent[]>([]);
  const [securityEvents, setSecurityEvents] = useState<SecurityEvent[]>([
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
  ]);

  // Synchronize stores when demo template changes
  useEffect(() => {
    const tmpl = demoTemplatesMap[activeTemplateId] || demoTemplatesMap.template_beauty_salon;
    setAppointments(tmpl.appointments);
    setPosTransactions(tmpl.posTransactions);
    setDaypartPerformance(tmpl.daypartPerformance);
    setCallEvents(tmpl.callEvents);
    setCustomerJourneys(tmpl.customerJourneys);
    setAttributionResults(tmpl.attributionResults);
  }, [activeTemplateId]);

  const currentOrg = mockOrganization;
  const currentBusiness = mockBusinesses[currentMarket];
  const t = translations[language];

  // Market-Filtered core data
  const leaks = useMemo(() => allLeaks.filter(l => l.market === currentMarket), [allLeaks, currentMarket]);
  const actions = useMemo(() => allActions.filter(a => a.market === currentMarket), [allActions, currentMarket]);
  const actionResults = useMemo(() => {
    return allActionResults.filter(r => {
      const biz = mockBusinesses[currentMarket];
      return r.business_id === biz.id;
    });
  }, [allActionResults, currentMarket]);
  const leads = useMemo(() => allLeads.filter(ld => ld.market === currentMarket), [allLeads, currentMarket]);
  const facts = useMemo(() => allFacts.filter(f => f.market === currentMarket), [allFacts, currentMarket]);
  const auditLogs = allAuditLogs;
  const aiRuns = allAIRuns;

  // Format Currency Utility
  const formatCurrency = (amount: number): string => {
    const currency = activeTemplate.currency;
    if (currency === 'TRY') {
      return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(amount);
    }
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
  };

  // Deterministic Revenue Leak Evaluation
  const calculatedLeaks = useMemo<RevenueImpactCalculation[]>(() => {
    const deterministicEvaluations = RevenueLeakEngine.evaluateAll({
      leads,
      appointments,
      capacity: activeTemplate.capacityUtilization,
      calls: callEvents,
      currency: activeTemplate.currency,
      avgDealValue: activeTemplate.currency === 'TRY' ? 4500 : 25000,
      historicalConversionRate: 0.28,
    });

    // Merge template-specific pre-calculated leaks with real-time rule outputs
    const combined = [...activeTemplate.calculatedLeaks];
    deterministicEvaluations.forEach(evalLeak => {
      if (!combined.some(c => c.ruleId === evalLeak.ruleId)) {
        combined.push(evalLeak);
      }
    });

    return combined;
  }, [leads, appointments, activeTemplate, callEvents]);

  // Compute Outcome Metrics
  const metrics = useMemo<MarketMetrics>(() => {
    const activeLeaks = calculatedLeaks.filter(l => l.status === 'active');
    const totalRevenueAtRisk = activeLeaks.reduce((sum, l) => sum + (l.estimatedImpactMinor / 100), 0);
    
    // Opportunities = Uncaptured high-intent leads value + potential action uplift
    const uncapturedLeadValue = leads
      .filter(ld => ld.status === 'open' && ld.intent_score > 75)
      .reduce((sum, ld) => sum + ld.estimated_deal_value, 0);

    const pendingActions = actions.filter(a => a.approval_status === 'pending_approval');
    const waitingApprovalCount = pendingActions.length;

    const totalRevenueInfluenced = actionResults
      .filter(r => r.status === 'success')
      .reduce((sum, r) => sum + r.revenue_recovered_amount, 0);

    const criticalCount = activeLeaks.filter(l => l.severity === 'critical').length;
    const highCount = activeLeaks.filter(l => l.severity === 'high').length;
    const mediumCount = activeLeaks.filter(l => l.severity === 'medium').length;

    const verifiedFactsCount = facts.filter(f => f.verified_by_human === 1).length;
    const totalFactsCount = facts.length || 1;
    const twinConfidenceScore = Math.round((verifiedFactsCount / totalFactsCount) * 100);

    return {
      revenueAtRisk: totalRevenueAtRisk,
      growthOpportunities: uncapturedLeadValue,
      actionsWaitingApproval: waitingApprovalCount,
      revenueInfluenced: totalRevenueInfluenced,
      currencySymbol: activeTemplate.currencySymbol,
      currencyCode: activeTemplate.currency,
      leaksCount: {
        critical: criticalCount,
        high: highCount,
        medium: mediumCount,
      },
      twinConfidenceScore,
      productLoopStep: waitingApprovalCount > 0 ? 'APPROVE' : 'DETECT',
    };
  }, [calculatedLeaks, actions, actionResults, leads, facts, activeTemplate]);

  // Append to Immutable Audit Log
  const logAuditEntry = (actionName: string, entityType: string, entityId: string, diff: Record<string, any>) => {
    const newLog: AuditLogRow = {
      id: `aud_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 5)}`,
      organization_id: currentOrg.id,
      business_id: currentBusiness.id,
      actor_id: mockUsers.find(u => u.role_global === 'founder')?.id || 'usr_owner_01',
      actor_role: currentRole,
      action: actionName,
      target_entity_type: entityType,
      target_entity_id: entityId,
      payload_diff_json: JSON.stringify(diff),
      ip_hash: Math.random().toString(36).substring(2, 12) + 'a9',
      created_at: new Date().toISOString(),
    };
    setAllAuditLogs(prev => [newLog, ...prev]);
  };

  // Action Approvals
  const approveAction = async (actionId: string): Promise<{ success: boolean; message: string }> => {
    // Check RBAC permission: only Owner and Admin can approve actions
    const authResult = TenantSecurityEngine.authorize(
      { userId: 'usr_active', email: 'session@velnar.io', organizationId: currentOrg.id, role: currentRole.toUpperCase() as PlatformRole },
      currentOrg.id,
      'actions.approve'
    );

    if (!authResult.allowed) {
      return {
        success: false,
        message: authResult.reason || 'RBAC Permission Denied: Action approval requires Owner or Admin privilege.'
      };
    }

    const action = allActions.find(a => a.id === actionId);
    if (!action) return { success: false, message: 'Action not found.' };

    // Run Guardrail Check via Neutral AI Gateway
    const guardrailResult = await aiGateway.verifyActionGuardrails(JSON.parse(action.execution_payload_json));
    if (!guardrailResult.passed) {
      return {
        success: false,
        message: `Guardrail Failed: ${guardrailResult.violations.join(', ')}`
      };
    }

    setAllActions(prev => prev.map(a => {
      if (a.id === actionId) {
        return {
          ...a,
          approval_status: 'approved',
          approved_by_user_id: 'usr_owner_01',
          approved_at: new Date().toISOString(),
        };
      }
      return a;
    }));

    if (action.leak_id) {
      setAllLeaks(prev => prev.map(l => {
        if (l.id === action.leak_id) {
          return { ...l, status: 'mitigated' };
        }
        return l;
      }));
    }

    logAuditEntry('GROWTH_ACTION_APPROVED', 'growth_actions', actionId, {
      status: { old: 'pending_approval', new: 'approved' },
      role: currentRole,
      guardrails: 'verified_pass'
    });

    return {
      success: true,
      message: language === 'tr' ? 'Aksiyon başarıyla onaylandı ve yürütmeye alındı.' : 'Action approved and dispatched to execution engine.'
    };
  };

  const rejectAction = async (actionId: string): Promise<{ success: boolean; message: string }> => {
    const authResult = TenantSecurityEngine.authorize(
      { userId: 'usr_active', email: 'session@velnar.io', organizationId: currentOrg.id, role: currentRole.toUpperCase() as PlatformRole },
      currentOrg.id,
      'actions.reject'
    );

    if (!authResult.allowed) {
      return { success: false, message: authResult.reason || 'Role insufficient for decision gate.' };
    }

    setAllActions(prev => prev.map(a => {
      if (a.id === actionId) {
        return { ...a, approval_status: 'rejected' };
      }
      return a;
    }));

    logAuditEntry('GROWTH_ACTION_REJECTED', 'growth_actions', actionId, {
      status: { old: 'pending_approval', new: 'rejected' },
      role: currentRole,
    });

    return {
      success: true,
      message: language === 'tr' ? 'Aksiyon reddedildi.' : 'Action rejected.'
    };
  };

  const deferAction = async (actionId: string): Promise<{ success: boolean; message: string }> => {
    setAllActions(prev => prev.map(a => {
      if (a.id === actionId) {
        return { ...a, approval_status: 'deferred' };
      }
      return a;
    }));

    logAuditEntry('GROWTH_ACTION_DEFERRED', 'growth_actions', actionId, {
      status: { old: 'pending_approval', new: 'deferred' }
    });

    return {
      success: true,
      message: language === 'tr' ? 'Aksiyon incelemesi ertelendi.' : 'Action deferred.'
    };
  };

  const verifyFact = (factId: string) => {
    setAllFacts(prev => prev.map(f => {
      if (f.id === factId) {
        return { ...f, verified_by_human: 1, confidence_score: 0.99, updated_at: new Date().toISOString() };
      }
      return f;
    }));

    logAuditEntry('BUSINESS_TWIN_FACT_VERIFIED', 'business_twin_facts', factId, {
      verified_by_human: { old: 0, new: 1 },
      actor_role: currentRole
    });
  };

  const addFact = (newFactData: Omit<BusinessTwinFactRow, 'id' | 'business_id' | 'market' | 'updated_at'>) => {
    const newFact: BusinessTwinFactRow = {
      id: `fact_${currentMarket.toLowerCase()}_${Date.now().toString(36)}`,
      business_id: currentBusiness.id,
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

    logAuditEntry('BUSINESS_TWIN_FACT_INGESTED', 'business_twin_facts', newFact.id, {
      key: newFact.fact_key,
      category: newFact.fact_category
    });
  };

  const triggerFastLeadResponse = (leadId: string) => {
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

    logAuditEntry('LEAD_ACCELERATED_SLA_DISPATCH', 'leads', leadId, {
      status: { old: 'open', new: 'contacted' },
      sla_response: 'fast_tracked'
    });
  };

  // Sprint 3: Appointment Operations
  const createManualAppointment = (params: {
    customerName: string;
    serviceName: string;
    serviceCategory: string;
    resourceStaffName: string;
    scheduledStart: string;
    durationMinutes: number;
    expectedValueMinor: number;
    currency: string;
    notes?: string;
  }): Appointment => {
    const { appointment, event } = AppointmentEngine.createManualAppointment({
      organizationId: currentOrg.id,
      businessId: currentBusiness.id,
      ...params
    });

    setAppointments(prev => [appointment, ...prev]);

    logAuditEntry('APPOINTMENT_MANUAL_CREATED', 'appointments', appointment.id, {
      customer: appointment.customerName,
      service: appointment.serviceName,
      expectedValueMinor: appointment.expectedValueMinor,
    });

    return appointment;
  };

  const updateAppointmentStatus = (appointmentId: string, status: AppointmentStatus, reason?: string) => {
    setAppointments(prev => prev.map(apt => {
      if (apt.id === appointmentId) {
        return {
          ...apt,
          status,
          cancellationReason: reason || apt.cancellationReason,
          updatedAt: new Date().toISOString()
        };
      }
      return apt;
    }));

    logAuditEntry('APPOINTMENT_STATUS_UPDATED', 'appointments', appointmentId, {
      status: { new: status, reason }
    });
  };

  // Sprint 3: Fallback Quick Check-In
  const recordQuickCheckIn = (
    type: CheckInType,
    source: CheckInSource,
    partySize: number,
    service?: string
  ): PhysicalCheckInEvent => {
    const ev = CheckInEngine.logCheckIn({
      organizationId: currentOrg.id,
      businessId: currentBusiness.id,
      locationId: 'loc_primary',
      locationName: activeTemplate.name,
      checkInType: type,
      source,
      partySize,
      serviceRequested: service
    });

    setCheckInEvents(prev => [ev, ...prev]);

    logAuditEntry('PHYSICAL_CHECK_IN_LOGGED', 'check_ins', ev.id, {
      type,
      source,
      partySize
    });

    return ev;
  };

  // Sprint 3: Security Test Runner
  const runSecurityAuditTests = () => {
    return TenantSecurityEngine.runCrossTenantTests();
  };

  const runLeakScan = async () => {
    setIsScanning(true);
    
    const aiResult = await aiGateway.executeAnalysis({
      businessId: currentBusiness.id,
      market: currentMarket,
      pipelineStage: 'Full Revenue Funnel Ingestion',
      rawSignals: { leadsCount: leads.length, factsCount: facts.length, appointmentsCount: appointments.length },
      focusArea: 'leak_detection',
    });

    const newAIRun: AIRunRow = {
      id: aiResult.runId,
      business_id: currentBusiness.id,
      gateway_provider_id: aiResult.providerId,
      model_identifier: aiResult.modelIdentifier,
      prompt_tokens: aiResult.tokensUsed.prompt,
      completion_tokens: aiResult.tokensUsed.completion,
      latency_ms: aiResult.latencyMs,
      status: 'completed',
      purpose: 'Revenue Leak Radar Automated Forensics',
      created_at: new Date().toISOString(),
    };

    setAllAIRuns(prev => [newAIRun, ...prev]);

    logAuditEntry('REVENUE_LEAK_RADAR_SCAN_COMPLETED', 'revenue_leaks', aiResult.runId, {
      findings: aiResult.findingsCount,
      latency_ms: aiResult.latencyMs,
    });

    setIsScanning(false);
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
        runSecurityAuditTests,
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
