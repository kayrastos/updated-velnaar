/**
 * @file leakEngine.ts
 * @description Revenue Leak Engine v0.1 Rule Engine & Impact Mathematical Models
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
  };
}

export interface MetricComponent {
  label: string;
  valueString: string;
  numericValue: number;
  unit: string;
  classification: MetricValueClassification; // Explicitly distinguishes OBSERVED vs CALCULATED vs AI_ESTIMATED
  sourceDataSource: string;
}

export interface RevenueImpactCalculation {
  leakId: string;
  ruleId: RuleIdentifier;
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  
  // Mathematical breakdown
  observedFacts: string[];
  calculatedMetrics: MetricComponent[];
  calculationFormula: string; // e.g. "14 high-intent leads × 25% conversion × ₺4,000 avg deal = ₺14,000"
  estimatedImpactMinor: number; // in currency minor units (e.g. 1400000 = ₺14,000)
  currency: string;
  confidenceLevel: 'HIGH' | 'MEDIUM' | 'LOW';
  dataSources: string[];
  timeRange: string; // e.g. "Last 30 Days (2026-07-24 to 2026-08-24)"
  
  recommendedAction: {
    actionType: string;
    headline: string;
    expectedRecoveryMonthlyMinor: number;
    suggestedPayload: Record<string, unknown>;
  };
  
  status: 'active' | 'mitigated' | 'investigating' | 'dismissed';
}
