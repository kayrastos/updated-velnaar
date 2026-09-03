import type { LeadRow, EventRow, CurrencyCode } from './database';
import type { Appointment, AppointmentEvent } from './appointment';
import type { CapacityUtilization } from './capacity';
import type { CallMetadataEvent } from './telephony';

/**
 * @file leakEngine.ts
 * @description Revenue Leak Engine v0.1 - Deterministic Rule Engine, Provenance & Mathematical Models
 * 
 * ============================================================================
 * CORE GOVERNANCE PRINCIPLES:
 * 1. NO EVIDENCE -> NO CLAIM.
 * 2. Never invent numbers. Every assumption has a declared provenance source and sample size.
 * 3. Support "INSUFFICIENT DATA" state safely.
 * 4. Deterministic Confidence: HIGH, MEDIUM, LOW, INSUFFICIENT.
 * ============================================================================
 */

export type { CurrencyCode };

export type RuleIdentifier = 
  | 'RULE_MISSED_HIGH_INTENT_LEAD'
  | 'RULE_SLOW_RESPONSE_LATENCY'
  | 'RULE_FOLLOW_UP_GAP'
  | 'RULE_MISSED_INBOUND_CALL'
  | 'RULE_APPOINTMENT_NO_SHOW_GAP'
  | 'RULE_OFF_PEAK_UNUSED_CAPACITY'
  | 'RULE_FUNNEL_STAGE_DROP'
  | 'RULE_AGING_INVENTORY_HOLDING';

export type MetricValueClassification = 'OBSERVED' | 'CALCULATED' | 'AI_ESTIMATED';

export type MetricValueType = 
  | 'COUNT'
  | 'RATE'
  | 'MONEY_MINOR'
  | 'DURATION_MINUTES'
  | 'BASIS_POINTS'
  | 'OTHER_CANONICAL_NUMERIC';

export type MetricProvenanceSource = 
  | 'HISTORICAL_BUSINESS_DATA' 
  | 'BUSINESS_CONFIGURED' 
  | 'SECTOR_BASELINE' 
  | 'PERSISTED_BUSINESS_METRIC'
  | 'CALCULATED_FROM_VERIFIED_ROWS'
  | 'INSUFFICIENT_DATA'
  | 'UNAVAILABLE';

export type LeakConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';

export interface EvidenceTimeRange {
  start: string;
  end: string;
}

export type EvidenceSourceKind = 
  | 'LEAD_ROWS'
  | 'LEAD_ACTIVITY_EVIDENCE'
  | 'CALL_METADATA_EVENTS'
  | 'CALL_HISTORY_COVERAGE'
  | 'APPOINTMENT_ROWS'
  | 'APPOINTMENT_EVENTS'
  | 'APPOINTMENT_HISTORY_COVERAGE'
  | 'CAPACITY_UTILIZATION'
  | 'INVENTORY_TELEMETRY'
  | 'BUSINESS_METRIC'
  | 'BUSINESS_CONFIGURATION'
  | 'SECTOR_BASELINE';

export interface EvidenceSourceReference {
  kind: EvidenceSourceKind;
  sourceId?: string | null;
  recordIds?: string[];
  sampleSize?: number | null;
  timeRange?: EvidenceTimeRange | null;
}

export interface MetricProvenance {
  source: MetricProvenanceSource;
  sourceId?: string | null;
  sampleSize?: number | null;
  timeRange?: EvidenceTimeRange | null;
  confidence: LeakConfidenceLevel;
  notes?: string | null;
}

export interface LeadActivityEvidence {
  businessId: string;
  leadId: string;
  proposalSentAt: string;
  lastFollowUpAt: string | null;
  lastActivityAt: string | null;
  coverageStart: string;
  coverageEnd: string;
  isComplete: boolean;
  source: string;
}

export interface CallHistoryCoverage {
  businessId: string;
  coveredFrom: string;
  coveredTo: string;
  isComplete: boolean;
  sourceId?: string | null;
}

export interface AppointmentHistoryCoverage {
  businessId: string;
  coveredFrom: string;
  coveredTo: string;
  isComplete: boolean;
  sourceId?: string | null;
}

export interface VerifiedMoneyMetricFact {
  valueMinor: number;
  currency: CurrencyCode;
  sampleSize: number | null;
  timeRange: EvidenceTimeRange | null;
  confidence: LeakConfidenceLevel;
  methodology: string | null;
}

export interface VerifiedRateMetricFact {
  value: number;
  sampleSize: number | null;
  timeRange: EvidenceTimeRange | null;
  confidence: LeakConfidenceLevel;
  methodology: string | null;
}

export interface RateMetricWithProvenance {
  value: number;
  provenance: MetricProvenance;
  sampleSize?: number | null;
  timeRange?: EvidenceTimeRange | null;
  metricKey?: string;
  methodology?: string | null;
}

export interface MoneyMetricWithProvenance {
  valueMinor: number;
  currency: CurrencyCode;
  provenance: MetricProvenance;
  sampleSize?: number | null;
  timeRange?: EvidenceTimeRange | null;
  metricKey?: string;
  methodology?: string | null;
}

export interface LeakRuleConfig {
  id: RuleIdentifier;
  name: string;
  category: string;
  description: string;
  isEnabled: boolean;
  thresholds: {
    maxSlaMinutes?: number;
    followUpGapHours?: number;
    capacityMinUtilizationPct?: number;
    funnelDropPct?: number;
    inventoryAgingDays?: number;
    minSampleSizeForCalculation?: number;
  };
}

export interface MetricComponent {
  metricKey: string;
  valueType: MetricValueType;
  label: string;
  valueString: string;
  numericValue: number;
  unit: string;
  currency?: CurrencyCode;
  classification: MetricValueClassification;
  sourceDataSource: string;
  evidenceReference?: EvidenceSourceReference;
  provenance?: MetricProvenance;
}

export interface InventoryItemTelemetry {
  id: string;
  businessId: string;
  currency: CurrencyCode;
  sku: string;
  name: string;
  holdingDays: number;
  unitCostMinor: number;
  quantityOnHand: number;
  dailyCarryingBps: number;
  provenance?: MetricProvenance;
  source?: string;
}

export interface RevenueImpactCalculation {
  leakId: string;
  ruleId: RuleIdentifier;
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  
  // Tripartite Evidence Model
  observedFacts: string[];
  calculatedMetrics: MetricComponent[];
  calculationFormula: string;
  
  // Provenance & Insufficient Data Handling
  isDataInsufficient?: boolean;
  insufficientDataReason?: string;
  impactStatus: 'VERIFIED' | 'ESTIMATED' | 'INSUFFICIENT_DATA';
  
  estimatedImpactMinor: number | null;
  currency: CurrencyCode | string;
  confidenceLevel: LeakConfidenceLevel;
  confidenceReason?: string;
  dataSources: string[];
  evidenceSources?: EvidenceSourceReference[];
  timeRange: string | null;
  structuredTimeRange?: EvidenceTimeRange | null;
  
  recommendedAction?: {
    actionType: string;
    headline: string;
    expectedRecoveryMonthlyMinor?: number | null;
    suggestedPayload: Record<string, unknown>;
  };
  
  status: 'active' | 'mitigated' | 'investigating' | 'dismissed';
}

export interface EvaluationInput {
  businessId?: string;
  leads: LeadRow[];
  appointments: Appointment[];
  appointmentEvents?: AppointmentEvent[];
  leadActivityEvidence?: LeadActivityEvidence[];
  callHistoryCoverage?: CallHistoryCoverage;
  appointmentHistoryCoverage?: AppointmentHistoryCoverage;
  capacity?: CapacityUtilization;
  calls: CallMetadataEvent[];
  inventoryItems?: InventoryItemTelemetry[];
  leadEvents?: EventRow[];
  currency: CurrencyCode | string;
  evaluationTimestamp: string;
  
  // Provenance Inputs (strictly canonical types)
  conversionRateAssumption?: RateMetricWithProvenance;
  avgDealValueAssumption?: MoneyMetricWithProvenance;
  callConversionAssumption?: RateMetricWithProvenance;
  callAverageDealValueAssumption?: MoneyMetricWithProvenance;
  noShowRecoveryAssumption?: RateMetricWithProvenance;
  proposalWinRateBaseline?: RateMetricWithProvenance;
  noShowRecoveryRateBaseline?: RateMetricWithProvenance;
  qualificationRateBaseline?: RateMetricWithProvenance;
  responseDecayFactor?: RateMetricWithProvenance;
}

