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

export type MetricProvenanceSource = 
  | 'HISTORICAL_BUSINESS_DATA' 
  | 'BUSINESS_CONFIGURED' 
  | 'SECTOR_BASELINE' 
  | 'INSUFFICIENT_DATA';

export type LeakConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';

export interface MetricProvenance {
  source: MetricProvenanceSource;
  sampleSize?: number;
  timeRange?: string;
  confidence: LeakConfidenceLevel;
  notes?: string;
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
  label: string;
  valueString: string;
  numericValue: number;
  unit: string;
  classification: MetricValueClassification; // OBSERVED vs CALCULATED vs AI_ESTIMATED
  sourceDataSource: string;
  provenance?: MetricProvenance;
}

export interface InventoryItemTelemetry {
  id: string;
  sku: string;
  name: string;
  holdingDays: number;
  unitCostMinor: number;
  quantityOnHand: number;
  dailyCarryingBps: number; // e.g. 5 bps = 0.05% daily carrying cost
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
  
  estimatedImpactMinor: number; // in currency minor units (e.g. 1400000 = ₺14,000)
  currency: string;
  confidenceLevel: LeakConfidenceLevel;
  confidenceReason?: string;
  dataSources: string[];
  timeRange: string;
  
  recommendedAction: {
    actionType: string;
    headline: string;
    expectedRecoveryMonthlyMinor: number;
    suggestedPayload: Record<string, unknown>;
  };
  
  status: 'active' | 'mitigated' | 'investigating' | 'dismissed';
}
