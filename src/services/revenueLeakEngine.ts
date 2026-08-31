/**
 * @file revenueLeakEngine.ts
 * @description Hardened Deterministic Revenue Leak Engine v0.6 (Sprint 4 Phase A.12B.1B Final Seal)
 * 
 * ============================================================================
 * PRINCIPLES:
 * 1. AI DETECTS. DETERMINISTIC CODE ENFORCES.
 * 2. NO EVIDENCE -> NO CLAIM.
 * 3. Never invent numbers or use unverified global constants.
 * 4. Provenance tracking on every assumption: Historical Business Data, Configured, Sector Baseline, or Insufficient Data.
 * 5. Deterministic Confidence Scoring: HIGH, MEDIUM, LOW, INSUFFICIENT with clear reasons and weakest-link aggregation.
 * 6. Zero synthetic source ID fabrication anywhere in production or tests.
 * 7. When data is insufficient, estimatedImpactMinor is null (not 0, not invented).
 * 8. Financial arithmetic remains in safe integer minor units throughout calculation.
 * 9. All evidence sources and time ranges are derived strictly from actual input objects.
 * ============================================================================
 */

import { 
  RevenueImpactCalculation, 
  RuleIdentifier, 
  LeakRuleConfig,
  InventoryItemTelemetry,
  MetricProvenance,
  MetricProvenanceSource,
  LeakConfidenceLevel,
  LeadActivityEvidence,
  CallHistoryCoverage,
  AppointmentHistoryCoverage,
  VerifiedMoneyMetricFact,
  VerifiedRateMetricFact,
  RateMetricWithProvenance,
  MoneyMetricWithProvenance,
  EvidenceTimeRange,
  EvidenceSourceReference,
  EvidenceSourceKind,
  MetricComponent,
  CurrencyCode,
  EvaluationInput
} from '../types/leakEngine';
import { LeadRow, EventRow } from '../types/database';
import { Appointment, AppointmentEvent } from '../types/appointment';
import { CapacityUtilization } from '../types/capacity';
import { CallMetadataEvent } from '../types/telephony';
import { isValidIsoWithTimezone } from '../utils/rfc3339Validator';

export { isValidIsoWithTimezone };
export type { EvaluationInput } from '../types/leakEngine';

/**
 * Strict Runtime Validator for VerifiedMoneyMetricFact (Sprint 4 Phase A.12B.1B)
 */
export function validateVerifiedMoneyMetric(
  rawJson: string,
  expectedCurrency: string
): VerifiedMoneyMetricFact | null {
  try {
    const parsed = JSON.parse(rawJson);
    if (!parsed || typeof parsed !== 'object') return null;

    // 1. valueMinor: must be non-negative safe integer
    if (typeof parsed.valueMinor !== 'number' || !Number.isSafeInteger(parsed.valueMinor) || parsed.valueMinor < 0) {
      return null;
    }
    // Reject parsed.value (no money major guessing or ambiguity)
    if ('value' in parsed && parsed.value !== undefined) {
      return null;
    }

    // 2. currency: must exist, match expected business currency, and be canonical TRY/USD/EUR (no GBP)
    const validCurrencies: CurrencyCode[] = ['TRY', 'USD', 'EUR'];
    if (typeof parsed.currency !== 'string' || parsed.currency !== expectedCurrency || !validCurrencies.includes(parsed.currency as CurrencyCode)) {
      return null;
    }

    // 3. sampleSize: if present and not null, must be safe integer >= 1
    if (parsed.sampleSize !== undefined && parsed.sampleSize !== null) {
      if (typeof parsed.sampleSize !== 'number' || !Number.isSafeInteger(parsed.sampleSize) || parsed.sampleSize < 1) {
        return null;
      }
    }
    const sampleSize = parsed.sampleSize === null || parsed.sampleSize === undefined ? null : parsed.sampleSize;

    // 4. timeRange: if present and not null, start/end must be strict RFC3339 and end >= start
    let timeRange: EvidenceTimeRange | null = null;
    if (parsed.timeRange !== undefined && parsed.timeRange !== null) {
      if (typeof parsed.timeRange !== 'object' || !parsed.timeRange.start || !parsed.timeRange.end) {
        return null;
      }
      if (!isValidIsoWithTimezone(parsed.timeRange.start) || !isValidIsoWithTimezone(parsed.timeRange.end)) {
        return null;
      }
      const startMs = Date.parse(parsed.timeRange.start);
      const endMs = Date.parse(parsed.timeRange.end);
      if (isNaN(startMs) || isNaN(endMs) || endMs < startMs) {
        return null;
      }
      timeRange = { start: parsed.timeRange.start, end: parsed.timeRange.end };
    }

    // 5. confidence: must be exact canonical enum, NO defaulting to 'LOW'
    const validConfidences: LeakConfidenceLevel[] = ['HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT'];
    if (!parsed.confidence || !validConfidences.includes(parsed.confidence)) {
      return null;
    }

    // 6. methodology: if present and not null, non-empty bounded string
    let methodology: string | null = null;
    if (parsed.methodology !== undefined && parsed.methodology !== null) {
      if (typeof parsed.methodology !== 'string' || parsed.methodology.trim().length === 0 || parsed.methodology.length > 500) {
        return null;
      }
      methodology = parsed.methodology.trim();
    }

    return {
      valueMinor: parsed.valueMinor,
      currency: parsed.currency as CurrencyCode,
      sampleSize,
      timeRange,
      confidence: parsed.confidence,
      methodology,
    };
  } catch {
    return null;
  }
}

/**
 * Strict Runtime Validator for VerifiedRateMetricFact (Sprint 4 Phase A.12B.1B)
 */
export function validateVerifiedRateMetric(
  rawJson: string
): VerifiedRateMetricFact | null {
  try {
    const parsed = JSON.parse(rawJson);
    if (!parsed || typeof parsed !== 'object') return null;

    // 1. value: finite number between 0 and 1 inclusive (reject 28, 150, -0.1, NaN, Infinity)
    if (typeof parsed.value !== 'number' || !Number.isFinite(parsed.value) || parsed.value < 0 || parsed.value > 1) {
      return null;
    }

    // 2. sampleSize: if present and not null, must be safe integer >= 1
    if (parsed.sampleSize !== undefined && parsed.sampleSize !== null) {
      if (typeof parsed.sampleSize !== 'number' || !Number.isSafeInteger(parsed.sampleSize) || parsed.sampleSize < 1) {
        return null;
      }
    }
    const sampleSize = parsed.sampleSize === null || parsed.sampleSize === undefined ? null : parsed.sampleSize;

    // 3. timeRange: if present and not null, start/end strict RFC3339 and end >= start
    let timeRange: EvidenceTimeRange | null = null;
    if (parsed.timeRange !== undefined && parsed.timeRange !== null) {
      if (typeof parsed.timeRange !== 'object' || !parsed.timeRange.start || !parsed.timeRange.end) {
        return null;
      }
      if (!isValidIsoWithTimezone(parsed.timeRange.start) || !isValidIsoWithTimezone(parsed.timeRange.end)) {
        return null;
      }
      const startMs = Date.parse(parsed.timeRange.start);
      const endMs = Date.parse(parsed.timeRange.end);
      if (isNaN(startMs) || isNaN(endMs) || endMs < startMs) {
        return null;
      }
      timeRange = { start: parsed.timeRange.start, end: parsed.timeRange.end };
    }

    // 4. confidence: must be exact canonical enum, NO defaulting to 'LOW'
    const validConfidences: LeakConfidenceLevel[] = ['HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT'];
    if (!parsed.confidence || !validConfidences.includes(parsed.confidence)) {
      return null;
    }

    // 5. methodology: if present and not null, non-empty bounded string
    let methodology: string | null = null;
    if (parsed.methodology !== undefined && parsed.methodology !== null) {
      if (typeof parsed.methodology !== 'string' || parsed.methodology.trim().length === 0 || parsed.methodology.length > 500) {
        return null;
      }
      methodology = parsed.methodology.trim();
    }

    return {
      value: parsed.value,
      sampleSize,
      timeRange,
      confidence: parsed.confidence,
      methodology,
    };
  } catch {
    return null;
  }
}

export const defaultRuleConfigs: LeakRuleConfig[] = [
  {
    id: 'RULE_MISSED_HIGH_INTENT_LEAD',
    name: 'Missed High-Intent Leads',
    category: 'lead_decay',
    description: 'High-intent lead received no response within the configured SLA threshold.',
    isEnabled: true,
    thresholds: { maxSlaMinutes: 15, minSampleSizeForCalculation: 10 }
  },
  {
    id: 'RULE_SLOW_RESPONSE_LATENCY',
    name: 'Slow Response Degradation',
    category: 'lead_decay',
    description: 'Lead response latency exceeds historical average, causing conversion decay.',
    isEnabled: true,
    thresholds: { maxSlaMinutes: 30, minSampleSizeForCalculation: 10 }
  },
  {
    id: 'RULE_FOLLOW_UP_GAP',
    name: 'Post-Proposal Follow-Up Gap',
    category: 'follow_up_bottleneck',
    description: 'Proposal sent but no second engagement logged within threshold hours.',
    isEnabled: true,
    thresholds: { followUpGapHours: 72, minSampleSizeForCalculation: 5 }
  },
  {
    id: 'RULE_MISSED_INBOUND_CALL',
    name: 'Unreturned Missed Inbound Calls',
    category: 'call_decay',
    description: 'Inbound high-intent call was missed and no callback event occurred.',
    isEnabled: true,
    thresholds: { followUpGapHours: 2, minSampleSizeForCalculation: 5 }
  },
  {
    id: 'RULE_APPOINTMENT_NO_SHOW_GAP',
    name: 'Appointment No-Show / Cancellation Recovery Gap',
    category: 'no_show_decay',
    description: 'Cancelled or no-show appointment was never re-engaged for rebooking.',
    isEnabled: true,
    thresholds: { followUpGapHours: 24, minSampleSizeForCalculation: 5 }
  },
  {
    id: 'RULE_OFF_PEAK_UNUSED_CAPACITY',
    name: 'Off-Peak Unused Resource Capacity',
    category: 'unused_capacity',
    description: 'Resource utilization falls below minimum operational threshold during active hours.',
    isEnabled: true,
    thresholds: { capacityMinUtilizationPct: 50, minSampleSizeForCalculation: 20 }
  },
  {
    id: 'RULE_FUNNEL_STAGE_DROP',
    name: 'Anomalous Funnel Drop-off',
    category: 'funnel_friction',
    description: 'Stage conversion falls materially below historical baseline.',
    isEnabled: true,
    thresholds: { funnelDropPct: 20, minSampleSizeForCalculation: 15 }
  },
  {
    id: 'RULE_AGING_INVENTORY_HOLDING',
    name: 'Aging Inventory Carrying Cost',
    category: 'aging_inventory',
    description: 'Inventory item holding duration exceeds baseline turns, accumulating interest and decay.',
    isEnabled: true,
    thresholds: { inventoryAgingDays: 45, minSampleSizeForCalculation: 5 }
  }
];

export class RevenueLeakEngine {
  private static getCurrencySymbol(curr: string): string {
    if (curr === 'TRY') return '₺';
    if (curr === 'EUR') return '€';
    if (curr === 'USD') return '$';
    return `${curr} `;
  }

  /**
   * Canonical Deterministic Provenance Source to Evidence Kind Mapper (Sprint 4 Phase A.12B.1B)
   */
  public static metricProvenanceToEvidenceKind(
    source: MetricProvenanceSource | undefined | null
  ): EvidenceSourceKind | null {
    if (!source) return null;
    switch (source) {
      case 'HISTORICAL_BUSINESS_DATA':
      case 'PERSISTED_BUSINESS_METRIC':
      case 'CALCULATED_FROM_VERIFIED_ROWS':
        return 'BUSINESS_METRIC';
      case 'BUSINESS_CONFIGURED':
        return 'BUSINESS_CONFIGURATION';
      case 'SECTOR_BASELINE':
        return 'SECTOR_BASELINE';
      case 'UNAVAILABLE':
      case 'INSUFFICIENT_DATA':
      default:
        return null;
    }
  }

  /**
   * Build Canonical EvidenceSourceReference for Financial / Baseline Metric Assumption
   */
  public static buildMetricEvidenceSource(
    assumption?: RateMetricWithProvenance | MoneyMetricWithProvenance | null
  ): EvidenceSourceReference | null {
    if (!assumption || !assumption.provenance) return null;
    const kind = RevenueLeakEngine.metricProvenanceToEvidenceKind(assumption.provenance.source);
    if (!kind) return null;
    const sourceId = typeof assumption.provenance.sourceId === 'string' ? assumption.provenance.sourceId.trim() : '';
    if (!sourceId) return null;
    const parsedRange = RevenueLeakEngine.parseTimeRange(assumption.timeRange || assumption.provenance.timeRange);
    return {
      kind,
      sourceId,
      sampleSize: typeof assumption.sampleSize === 'number'
        ? assumption.sampleSize
        : (typeof assumption.provenance.sampleSize === 'number' ? assumption.provenance.sampleSize : null),
      timeRange: parsedRange,
    };
  }

  /**
   * Format Evidence Source Reference string for display / sourceDataSource
   */
  public static formatEvidenceSourceString(ref: EvidenceSourceReference | null | undefined): string {
    if (!ref) return 'UNAVAILABLE';
    if (ref.sourceId && ref.sourceId.trim().length > 0) {
      return `${ref.kind}:${ref.sourceId.trim()}`;
    }
    return ref.kind;
  }

  public static isRateAssumptionValid(assumption?: RateMetricWithProvenance): boolean {
    if (!assumption) return false;
    if (!assumption.provenance || assumption.provenance.source === 'INSUFFICIENT_DATA' || assumption.provenance.source === 'UNAVAILABLE') {
      return false;
    }
    if (typeof assumption.provenance.sourceId !== 'string' || assumption.provenance.sourceId.trim().length === 0) {
      return false;
    }
    if (typeof assumption.value !== 'number' || !Number.isFinite(assumption.value)) {
      return false;
    }
    return assumption.value >= 0 && assumption.value <= 1;
  }

  public static isMoneyAssumptionValid(
    assumption?: MoneyMetricWithProvenance,
    expectedCurrency?: string
  ): boolean {
    if (!assumption) return false;
    if (!assumption.provenance || assumption.provenance.source === 'INSUFFICIENT_DATA' || assumption.provenance.source === 'UNAVAILABLE') {
      return false;
    }
    if (typeof assumption.provenance.sourceId !== 'string' || assumption.provenance.sourceId.trim().length === 0) {
      return false;
    }
    const validCurrencies: CurrencyCode[] = ['TRY', 'USD', 'EUR'];
    if (assumption.currency && !validCurrencies.includes(assumption.currency as CurrencyCode)) {
      return false;
    }
    if (assumption.currency && expectedCurrency && assumption.currency !== expectedCurrency) {
      return false;
    }
    if (typeof assumption.valueMinor !== 'number' || !Number.isSafeInteger(assumption.valueMinor) || assumption.valueMinor < 0) {
      return false;
    }
    return true;
  }

  public static getMoneyMinor(assumption?: MoneyMetricWithProvenance): number {
    if (!assumption) return 0;
    if (typeof assumption.valueMinor === 'number' && Number.isSafeInteger(assumption.valueMinor) && assumption.valueMinor >= 0) {
      return assumption.valueMinor;
    }
    return 0;
  }

  public static parseTimeRange(tr?: EvidenceTimeRange | null): EvidenceTimeRange | null {
    if (!tr) return null;
    if (typeof tr === 'object' && tr.start && tr.end) {
      if (isValidIsoWithTimezone(tr.start) && isValidIsoWithTimezone(tr.end)) {
        const startMs = Date.parse(tr.start);
        const endMs = Date.parse(tr.end);
        if (!isNaN(startMs) && !isNaN(endMs) && endMs >= startMs) {
          return { start: tr.start, end: tr.end };
        }
      }
    }
    return null;
  }

  public static formatTimeRangeDisplay(tr: EvidenceTimeRange | null): string | null {
    if (!tr) return null;
    return `${tr.start} to ${tr.end}`;
  }

  /**
   * Deterministic Objective Confidence Calculator (Sprint 4 Phase A.12B.1B)
   */
  public static calculateConfidence(
    provenance: MetricProvenance | undefined | null,
    sampleSize?: number | null,
    timeRange?: EvidenceTimeRange | null,
    evaluationTimestamp?: string | null
  ): { level: LeakConfidenceLevel; reason: string } {
    if (
      !provenance ||
      provenance.source === 'INSUFFICIENT_DATA' ||
      provenance.source === 'UNAVAILABLE'
    ) {
      return {
        level: 'INSUFFICIENT',
        reason: 'Unavailable baseline metric or unverified provenance source.'
      };
    }

    if (typeof provenance.sourceId !== 'string' || provenance.sourceId.trim().length === 0) {
      return {
        level: 'INSUFFICIENT',
        reason: 'Missing required explicit source authority.'
      };
    }

    const effSampleSize = typeof sampleSize === 'number' && Number.isFinite(sampleSize)
      ? sampleSize
      : (typeof provenance.sampleSize === 'number' && Number.isFinite(provenance.sampleSize) ? provenance.sampleSize : null);

    if (effSampleSize === null || effSampleSize < 5) {
      return {
        level: 'INSUFFICIENT',
        reason: `Insufficient sample size (${effSampleSize !== null ? effSampleSize : 'unknown'} observations). Minimum 5 verified observations required.`
      };
    }

    if (provenance.source === 'SECTOR_BASELINE') {
      return {
        level: 'LOW',
        reason: `Low confidence: Utilizing sector benchmark prior to sufficient business-specific sample size (${effSampleSize} reference samples).`
      };
    }

    if (provenance.source === 'BUSINESS_CONFIGURED') {
      if (effSampleSize >= 10) {
        return {
          level: 'MEDIUM',
          reason: `Medium confidence: Derived from business configuration and moderate sample size (${effSampleSize} observations).`
        };
      }
      return {
        level: 'LOW',
        reason: `Low confidence: Derived from business configuration with limited sample size (${effSampleSize} observations).`
      };
    }

    // Direct verified sources
    if (
      provenance.source === 'HISTORICAL_BUSINESS_DATA' ||
      provenance.source === 'PERSISTED_BUSINESS_METRIC' ||
      provenance.source === 'CALCULATED_FROM_VERIFIED_ROWS'
    ) {
      const parsedRange = timeRange || RevenueLeakEngine.parseTimeRange(provenance.timeRange);

      if (parsedRange) {
        if (!isValidIsoWithTimezone(parsedRange.start) || !isValidIsoWithTimezone(parsedRange.end)) {
          return {
            level: 'INSUFFICIENT',
            reason: 'Invalid evidence time range: start or end timestamp is not valid RFC3339.'
          };
        }
        const startMs = Date.parse(parsedRange.start);
        const endMs = Date.parse(parsedRange.end);
        if (isNaN(startMs) || isNaN(endMs) || endMs < startMs) {
          return {
            level: 'INSUFFICIENT',
            reason: 'Invalid evidence time range: end timestamp must be greater than or equal to start timestamp.'
          };
        }

        const evalIso = evaluationTimestamp && isValidIsoWithTimezone(evaluationTimestamp) ? evaluationTimestamp : null;
        if (evalIso) {
          const evalMs = Date.parse(evalIso);
          if (!isNaN(evalMs)) {
            if (endMs > evalMs) {
              return {
                level: 'INSUFFICIENT',
                reason: 'Invalid evidence time range: evidence timestamp is in the future relative to evaluation time.'
              };
            }
            const freshnessDays = (evalMs - endMs) / (1000 * 3600 * 24);
            if (freshnessDays >= 0 && freshnessDays <= 7 && effSampleSize >= 20) {
              return {
                level: 'HIGH',
                reason: `High confidence: Based on ${effSampleSize} direct ledger observations within last ${Math.max(0, Math.round(freshnessDays))} days with verified source ID (${provenance.sourceId}).`
              };
            }
          }
        }
      }

      // Without valid timeRange + evaluationTimestamp + freshness <= 7d + sampleSize >= 20 + sourceId, HIGH is impossible
      if (effSampleSize >= 10) {
        return {
          level: 'MEDIUM',
          reason: `Medium confidence: Derived from direct observations with moderate sample size (${effSampleSize} observations) or missing fresh time-window verification.`
        };
      }

      return {
        level: 'LOW',
        reason: `Low confidence: Limited data sample (${effSampleSize} observations).`
      };
    }

    return {
      level: 'LOW',
      reason: 'Low confidence: Limited data sample or historical variability.'
    };
  }

  /**
   * Deterministic Multi-Input Weakest-Link Confidence Aggregator (Sprint 4 Phase A.12B.1B)
   */
  public static aggregateConfidence(confidences: LeakConfidenceLevel[]): LeakConfidenceLevel {
    if (confidences.length === 0) return 'INSUFFICIENT';
    if (confidences.includes('INSUFFICIENT')) return 'INSUFFICIENT';
    if (confidences.includes('LOW')) return 'LOW';
    if (confidences.includes('MEDIUM')) return 'MEDIUM';
    if (confidences.every(c => c === 'HIGH')) return 'HIGH';
    return 'LOW';
  }

  /**
   * Direct Provenance Authority Validator (Sprint 4 Phase A.12B.1B)
   */
  public static isVerifiedFinancialProvenance(
    provenance: MetricProvenance | undefined | null,
    sampleSize?: number | null,
    timeRange?: EvidenceTimeRange | null
  ): boolean {
    if (!provenance) return false;
    const directSources: MetricProvenanceSource[] = [
      'HISTORICAL_BUSINESS_DATA',
      'PERSISTED_BUSINESS_METRIC',
      'CALCULATED_FROM_VERIFIED_ROWS'
    ];
    if (!directSources.includes(provenance.source)) return false;
    if (typeof provenance.sourceId !== 'string' || provenance.sourceId.trim().length === 0) return false;

    const effSampleSize = typeof sampleSize === 'number' && Number.isFinite(sampleSize)
      ? sampleSize
      : (typeof provenance.sampleSize === 'number' && Number.isFinite(provenance.sampleSize) ? provenance.sampleSize : null);
    if (effSampleSize === null || effSampleSize < 5) return false;

    const effRange = timeRange || RevenueLeakEngine.parseTimeRange(provenance.timeRange);
    if (!effRange) return false;
    if (!isValidIsoWithTimezone(effRange.start) || !isValidIsoWithTimezone(effRange.end)) return false;
    const startMs = Date.parse(effRange.start);
    const endMs = Date.parse(effRange.end);
    if (isNaN(startMs) || isNaN(endMs) || endMs < startMs) return false;

    return true;
  }

  public static isEstimatedFinancialProvenance(
    provenance: MetricProvenance | undefined | null
  ): boolean {
    if (!provenance) return false;
    if (provenance.source !== 'BUSINESS_CONFIGURED' && provenance.source !== 'SECTOR_BASELINE') return false;
    if (typeof provenance.sourceId !== 'string' || provenance.sourceId.trim().length === 0) return false;
    return true;
  }

  /**
   * Deterministic Impact Status Authority (Sprint 4 Phase A.12B.1B)
   */
  public static determineImpactStatus(
    isDataInsufficient: boolean,
    provenances: (MetricProvenance | undefined | null)[]
  ): 'VERIFIED' | 'ESTIMATED' | 'INSUFFICIENT_DATA' {
    if (isDataInsufficient) return 'INSUFFICIENT_DATA';
    if (provenances.length === 0) return 'INSUFFICIENT_DATA';

    for (const p of provenances) {
      if (!p || p.source === 'INSUFFICIENT_DATA' || p.source === 'UNAVAILABLE') {
        return 'INSUFFICIENT_DATA';
      }
      if (typeof p.sourceId !== 'string' || p.sourceId.trim().length === 0) {
        return 'INSUFFICIENT_DATA';
      }
    }

    const allVerified = provenances.every(p => RevenueLeakEngine.isVerifiedFinancialProvenance(p));
    if (allVerified) return 'VERIFIED';

    const allValid = provenances.every(p => 
      RevenueLeakEngine.isVerifiedFinancialProvenance(p) || RevenueLeakEngine.isEstimatedFinancialProvenance(p)
    );
    if (allValid) return 'ESTIMATED';

    return 'INSUFFICIENT_DATA';
  }

  private static formatDataSources(evidenceSources: EvidenceSourceReference[]): string[] {
    const result: string[] = [];
    for (const e of evidenceSources) {
      if (e.sourceId && e.sourceId.trim().length > 0) {
        result.push(`${e.kind}:${e.sourceId.trim()}`);
      } else {
        result.push(e.kind);
      }
    }
    return result;
  }

  /**
   * Deterministically evaluate all 8 rules against hard business data using explicit config thresholds.
   */
  public static evaluateAll(
    params: EvaluationInput, 
    ruleConfigs: LeakRuleConfig[] = defaultRuleConfigs
  ): RevenueImpactCalculation[] {
    const findings: RevenueImpactCalculation[] = [];
    const { 
      businessId,
      leads = [], 
      appointments = [], 
      appointmentEvents = [],
      leadActivityEvidence = [],
      callHistoryCoverage,
      appointmentHistoryCoverage,
      capacity, 
      calls = [], 
      inventoryItems = [], 
      currency,
      evaluationTimestamp,
      conversionRateAssumption,
      avgDealValueAssumption,
      callConversionAssumption,
      callAverageDealValueAssumption,
      noShowRecoveryAssumption,
      proposalWinRateBaseline,
      noShowRecoveryRateBaseline,
      qualificationRateBaseline,
      responseDecayFactor
    } = params;

    const evalTimestamp = evaluationTimestamp && isValidIsoWithTimezone(evaluationTimestamp)
      ? evaluationTimestamp
      : null;

    const isCanonicalCurrency = currency === 'TRY' || currency === 'USD' || currency === 'EUR';

    const getConfig = (ruleId: RuleIdentifier): LeakRuleConfig => {
      const found = ruleConfigs.find(c => c.id === ruleId);
      if (found) return found;
      return defaultRuleConfigs.find(c => c.id === ruleId) || {
        id: ruleId,
        name: ruleId,
        category: 'lead_decay',
        description: '',
        isEnabled: true,
        thresholds: {}
      };
    };

    const currSym = RevenueLeakEngine.getCurrencySymbol(currency);

    const isConvRateValid = RevenueLeakEngine.isRateAssumptionValid(conversionRateAssumption);
    const isAvgDealValid = isCanonicalCurrency && RevenueLeakEngine.isMoneyAssumptionValid(avgDealValueAssumption, currency);
    const isCallConvValid = RevenueLeakEngine.isRateAssumptionValid(callConversionAssumption);
    const isCallAvgDealValid = isCanonicalCurrency && (
      RevenueLeakEngine.isMoneyAssumptionValid(callAverageDealValueAssumption, currency) ||
      RevenueLeakEngine.isMoneyAssumptionValid(avgDealValueAssumption, currency)
    );
    const isNoShowRecValid = RevenueLeakEngine.isRateAssumptionValid(noShowRecoveryAssumption) || 
      RevenueLeakEngine.isRateAssumptionValid(noShowRecoveryRateBaseline);
    const isProposalWinValid = RevenueLeakEngine.isRateAssumptionValid(proposalWinRateBaseline) || isConvRateValid;
    const isQualValid = RevenueLeakEngine.isRateAssumptionValid(qualificationRateBaseline);
    const isDecayValid = RevenueLeakEngine.isRateAssumptionValid(responseDecayFactor);

    // Business-scoped telemetry filtering
    const scopedLeads = businessId ? leads.filter(l => l.business_id === businessId) : leads;
    const scopedCalls = businessId ? calls.filter(c => c.businessId === businessId) : calls;
    const scopedAppointments = businessId ? appointments.filter(a => a.businessId === businessId) : appointments;
    const scopedAppointmentEvents = businessId ? appointmentEvents.filter(e => e.businessId === businessId) : appointmentEvents;
    const scopedInventory = businessId ? inventoryItems.filter(i => i.businessId === businessId) : inventoryItems;
    const scopedActivityEvidence = businessId ? leadActivityEvidence.filter(e => e.businessId === businessId) : leadActivityEvidence;

    // ------------------------------------------------------------------------
    // RULE A: Missed High-Intent Leads (RULE_MISSED_HIGH_INTENT_LEAD)
    // ------------------------------------------------------------------------
    const configA = getConfig('RULE_MISSED_HIGH_INTENT_LEAD');
    if (configA.isEnabled) {
      const maxSlaMinutes = configA.thresholds.maxSlaMinutes ?? 15;
      const unrespondedHighIntentLeads = scopedLeads.filter(
        l => l.status === 'open' && l.intent_score >= 80 && l.response_latency_minutes > maxSlaMinutes
      );

      if (unrespondedHighIntentLeads.length > 0) {
        const count = unrespondedHighIntentLeads.length;
        let isDataInsufficient = !isConvRateValid || !isAvgDealValid || !isCanonicalCurrency;
        const convRate = isConvRateValid ? conversionRateAssumption!.value : 0;
        const dealValMinor = isAvgDealValid ? RevenueLeakEngine.getMoneyMinor(avgDealValueAssumption) : 0;
        let calculatedLossMinor = isDataInsufficient ? null : Math.round(count * convRate * dealValMinor);

        // Derive structured time range from observed lead creation timestamps
        const validLeadTimestamps = unrespondedHighIntentLeads
          .map(l => l.created_at)
          .filter(t => t && isValidIsoWithTimezone(t));
        let leadTimeRange: EvidenceTimeRange | null = null;
        if (validLeadTimestamps.length > 0) {
          const sorted = [...validLeadTimestamps].sort();
          leadTimeRange = { start: sorted[0], end: sorted[sorted.length - 1] };
        }

        const convTimeRange = RevenueLeakEngine.parseTimeRange(conversionRateAssumption?.provenance?.timeRange);
        const dealTimeRange = RevenueLeakEngine.parseTimeRange(avgDealValueAssumption?.provenance?.timeRange);

        const convConf = isConvRateValid
          ? RevenueLeakEngine.calculateConfidence(
              conversionRateAssumption!.provenance,
              conversionRateAssumption!.provenance.sampleSize,
              convTimeRange,
              evalTimestamp
            )
          : { level: 'INSUFFICIENT' as LeakConfidenceLevel, reason: 'Missing valid conversion rate baseline.' };

        const dealConf = isAvgDealValid
          ? RevenueLeakEngine.calculateConfidence(
              avgDealValueAssumption!.provenance,
              avgDealValueAssumption!.provenance.sampleSize,
              dealTimeRange,
              evalTimestamp
            )
          : { level: 'INSUFFICIENT' as LeakConfidenceLevel, reason: 'Missing valid average deal value assumption.' };

        const impactStatus = RevenueLeakEngine.determineImpactStatus(
          isDataInsufficient,
          [conversionRateAssumption?.provenance, avgDealValueAssumption?.provenance]
        );

        if (impactStatus === 'INSUFFICIENT_DATA') {
          isDataInsufficient = true;
          calculatedLossMinor = null;
        }

        const confidenceLevel = isDataInsufficient
          ? 'INSUFFICIENT'
          : RevenueLeakEngine.aggregateConfidence([convConf.level, dealConf.level]);

        const confidenceReason = isDataInsufficient
          ? 'Requires verified average deal value and baseline conversion rate with canonical currency and explicit source authority.'
          : `Aggregated confidence across conversion baseline (${convConf.level}) and average deal value (${dealConf.level}).`;

        const convEvidenceRef = isConvRateValid ? RevenueLeakEngine.buildMetricEvidenceSource(conversionRateAssumption) : null;
        const dealEvidenceRef = isAvgDealValid ? RevenueLeakEngine.buildMetricEvidenceSource(avgDealValueAssumption) : null;

        const leadEvidenceRef: EvidenceSourceReference = {
          kind: 'LEAD_ROWS',
          recordIds: unrespondedHighIntentLeads.map(l => l.id),
          sampleSize: count,
          timeRange: leadTimeRange,
        };

        const evidenceSources: EvidenceSourceReference[] = [leadEvidenceRef];
        if (convEvidenceRef) evidenceSources.push(convEvidenceRef);
        if (dealEvidenceRef) evidenceSources.push(dealEvidenceRef);

        const calculatedMetrics: MetricComponent[] = [
          {
            metricKey: 'unanswered_high_intent_leads_count',
            valueType: 'COUNT',
            label: 'Unanswered High-Intent Leads',
            valueString: `${count} leads`,
            numericValue: count,
            unit: 'leads',
            classification: 'OBSERVED',
            sourceDataSource: 'LEAD_ROWS',
            evidenceReference: leadEvidenceRef,
          },
          {
            metricKey: 'historical_conversion_rate',
            valueType: 'RATE',
            label: 'Historical Conversion Rate',
            valueString: isConvRateValid ? `${(convRate * 100).toFixed(1)}%` : 'UNAVAILABLE',
            numericValue: convRate,
            unit: '%',
            classification: 'CALCULATED',
            sourceDataSource: RevenueLeakEngine.formatEvidenceSourceString(convEvidenceRef),
            evidenceReference: convEvidenceRef || undefined,
            provenance: conversionRateAssumption?.provenance || { source: 'UNAVAILABLE', confidence: 'INSUFFICIENT' }
          },
          {
            metricKey: 'average_deal_value_minor',
            valueType: 'MONEY_MINOR',
            label: 'Average Deal Value',
            valueString: isAvgDealValid ? `${currSym}${(dealValMinor / 100).toLocaleString()}` : 'UNAVAILABLE',
            numericValue: dealValMinor,
            currency: isCanonicalCurrency ? (currency as CurrencyCode) : undefined,
            unit: currency,
            classification: 'CALCULATED',
            sourceDataSource: RevenueLeakEngine.formatEvidenceSourceString(dealEvidenceRef),
            evidenceReference: dealEvidenceRef || undefined,
            provenance: avgDealValueAssumption?.provenance || { source: 'UNAVAILABLE', confidence: 'INSUFFICIENT' }
          }
        ];

        findings.push({
          leakId: 'leak_det_high_intent',
          ruleId: 'RULE_MISSED_HIGH_INTENT_LEAD',
          title: `${count} Unanswered High-Intent Leads Exceeding ${maxSlaMinutes}m Response SLA`,
          severity: count > 5 ? 'critical' : 'high',
          category: 'lead_decay',
          observedFacts: [
            `${count} inbound leads with intent score ≥ 80 logged zero sales touchpoint within ${maxSlaMinutes} minutes.`,
            `Average response latency observed: ${Math.round(unrespondedHighIntentLeads.reduce((s, l) => s + l.response_latency_minutes, 0) / count)} minutes.`,
            `Observed lead pipeline IDs: ${unrespondedHighIntentLeads.map(l => l.pseudonymous_customer_id || l.id).join(', ')}`
          ],
          calculatedMetrics,
          calculationFormula: isDataInsufficient
            ? 'Calculation suspended: Insufficient verified deal value and baseline conversion data.'
            : `${count} leads × ${(convRate * 100).toFixed(1)}% conversion × ${currSym}${(dealValMinor / 100).toLocaleString()} avg deal = ${currSym}${((calculatedLossMinor || 0) / 100).toLocaleString()}`,
          isDataInsufficient,
          insufficientDataReason: isDataInsufficient ? 'Requires verified average deal value and baseline conversion rate with explicit source authority.' : undefined,
          impactStatus,
          estimatedImpactMinor: calculatedLossMinor,
          currency,
          confidenceLevel,
          confidenceReason,
          dataSources: RevenueLeakEngine.formatDataSources(evidenceSources),
          evidenceSources,
          timeRange: RevenueLeakEngine.formatTimeRangeDisplay(leadTimeRange),
          structuredTimeRange: leadTimeRange,
          recommendedAction: isDataInsufficient ? undefined : {
            actionType: 'high_intent_sla_dispatch',
            headline: 'Trigger Instant Direct-Dial Routing & Push Notification to Duty Rep',
            expectedRecoveryMonthlyMinor: null,
            suggestedPayload: { targetLeadIds: unrespondedHighIntentLeads.map(l => l.id), slaTargetMinutes: 3 }
          },
          status: 'active'
        });
      }
    }

    // ------------------------------------------------------------------------
    // RULE B: Slow Response Latency (RULE_SLOW_RESPONSE_LATENCY)
    // ------------------------------------------------------------------------
    const configB = getConfig('RULE_SLOW_RESPONSE_LATENCY');
    if (configB.isEnabled) {
      const maxSlaMinutes = configB.thresholds.maxSlaMinutes ?? 30;
      const slowResponseLeads = scopedLeads.filter(
        l => l.status === 'open' && l.intent_score < 80 && l.response_latency_minutes > maxSlaMinutes
      );

      if (slowResponseLeads.length > 0) {
        const count = slowResponseLeads.length;
        let isDataInsufficient = !isConvRateValid || !isAvgDealValid || !isDecayValid || !isCanonicalCurrency;
        const decayFactor = isDecayValid ? responseDecayFactor!.value : 0;
        const convRate = isConvRateValid ? conversionRateAssumption!.value : 0;
        const dealValMinor = isAvgDealValid ? RevenueLeakEngine.getMoneyMinor(avgDealValueAssumption) : 0;
        let calculatedLossMinor = isDataInsufficient ? null : Math.round(count * (convRate * decayFactor) * dealValMinor);

        const validLeadTimestamps = slowResponseLeads
          .map(l => l.created_at)
          .filter(t => t && isValidIsoWithTimezone(t));
        let leadTimeRange: EvidenceTimeRange | null = null;
        if (validLeadTimestamps.length > 0) {
          const sorted = [...validLeadTimestamps].sort();
          leadTimeRange = { start: sorted[0], end: sorted[sorted.length - 1] };
        }

        const convTimeRange = RevenueLeakEngine.parseTimeRange(conversionRateAssumption?.provenance?.timeRange);
        const decayTimeRange = RevenueLeakEngine.parseTimeRange(responseDecayFactor?.provenance?.timeRange);
        const dealTimeRange = RevenueLeakEngine.parseTimeRange(avgDealValueAssumption?.provenance?.timeRange);

        const convConf = isConvRateValid
          ? RevenueLeakEngine.calculateConfidence(
              conversionRateAssumption!.provenance,
              conversionRateAssumption!.provenance.sampleSize,
              convTimeRange,
              evalTimestamp
            )
          : { level: 'INSUFFICIENT' as LeakConfidenceLevel, reason: 'Missing valid conversion rate baseline.' };

        const decayConf = isDecayValid
          ? RevenueLeakEngine.calculateConfidence(
              responseDecayFactor!.provenance,
              responseDecayFactor!.provenance.sampleSize,
              decayTimeRange,
              evalTimestamp
            )
          : { level: 'INSUFFICIENT' as LeakConfidenceLevel, reason: 'Missing valid response decay factor.' };

        const dealConf = isAvgDealValid
          ? RevenueLeakEngine.calculateConfidence(
              avgDealValueAssumption!.provenance,
              avgDealValueAssumption!.provenance.sampleSize,
              dealTimeRange,
              evalTimestamp
            )
          : { level: 'INSUFFICIENT' as LeakConfidenceLevel, reason: 'Missing valid average deal value assumption.' };

        const impactStatus = RevenueLeakEngine.determineImpactStatus(
          isDataInsufficient,
          [conversionRateAssumption?.provenance, responseDecayFactor?.provenance, avgDealValueAssumption?.provenance]
        );

        if (impactStatus === 'INSUFFICIENT_DATA') {
          isDataInsufficient = true;
          calculatedLossMinor = null;
        }

        const confidenceLevel = isDataInsufficient
          ? 'INSUFFICIENT'
          : RevenueLeakEngine.aggregateConfidence([convConf.level, decayConf.level, dealConf.level]);

        const confidenceReason = isDataInsufficient
          ? 'Baseline deal value, conversion rate, or response decay factor unavailable.'
          : `Aggregated confidence across conversion baseline (${convConf.level}), decay factor (${decayConf.level}), and deal value (${dealConf.level}).`;

        const convEvidenceRef = isConvRateValid ? RevenueLeakEngine.buildMetricEvidenceSource(conversionRateAssumption) : null;
        const decayEvidenceRef = isDecayValid ? RevenueLeakEngine.buildMetricEvidenceSource(responseDecayFactor) : null;
        const dealEvidenceRef = isAvgDealValid ? RevenueLeakEngine.buildMetricEvidenceSource(avgDealValueAssumption) : null;

        const leadEvidenceRef: EvidenceSourceReference = {
          kind: 'LEAD_ROWS',
          recordIds: slowResponseLeads.map(l => l.id),
          sampleSize: count,
          timeRange: leadTimeRange,
        };

        const evidenceSources: EvidenceSourceReference[] = [leadEvidenceRef];
        if (convEvidenceRef) evidenceSources.push(convEvidenceRef);
        if (decayEvidenceRef) evidenceSources.push(decayEvidenceRef);
        if (dealEvidenceRef) evidenceSources.push(dealEvidenceRef);

        findings.push({
          leakId: 'leak_det_slow_latency',
          ruleId: 'RULE_SLOW_RESPONSE_LATENCY',
          title: `${count} Standard Inbound Leads Experiencing >${maxSlaMinutes}m Latency Degradation`,
          severity: 'medium',
          category: 'lead_decay',
          observedFacts: [
            `${count} captured leads have waited over ${maxSlaMinutes} minutes for first representative contact.`,
            `Average latency in this cohort: ${Math.round(slowResponseLeads.reduce((s, l) => s + l.response_latency_minutes, 0) / count)} minutes.`
          ],
          calculatedMetrics: [
            {
              metricKey: 'delayed_leads_count',
              valueType: 'COUNT',
              label: 'Delayed Leads',
              valueString: `${count} leads`,
              numericValue: count,
              unit: 'leads',
              classification: 'OBSERVED',
              sourceDataSource: 'LEAD_ROWS',
              evidenceReference: leadEvidenceRef,
            },
            {
              metricKey: 'conversion_decay_factor',
              valueType: 'RATE',
              label: 'Conversion Decay Factor',
              valueString: isDecayValid ? `${(decayFactor * 100).toFixed(1)}%` : 'UNAVAILABLE',
              numericValue: decayFactor,
              unit: '%',
              classification: 'CALCULATED',
              sourceDataSource: RevenueLeakEngine.formatEvidenceSourceString(decayEvidenceRef),
              evidenceReference: decayEvidenceRef || undefined,
              provenance: responseDecayFactor?.provenance || { source: 'UNAVAILABLE', confidence: 'INSUFFICIENT' }
            },
          ],
          calculationFormula: isDataInsufficient
            ? 'Calculation suspended: Baseline deal value, conversion rate, or decay factor unavailable.'
            : `${count} leads × (${(convRate * 100).toFixed(1)}% base × ${(decayFactor * 100).toFixed(1)}% decay) × ${currSym}${(dealValMinor / 100).toLocaleString()} = ${currSym}${((calculatedLossMinor || 0) / 100).toLocaleString()}`,
          isDataInsufficient,
          insufficientDataReason: isDataInsufficient ? 'Requires verified average deal value, baseline conversion rate, and response decay factor.' : undefined,
          impactStatus,
          estimatedImpactMinor: calculatedLossMinor,
          currency,
          confidenceLevel,
          confidenceReason,
          dataSources: RevenueLeakEngine.formatDataSources(evidenceSources),
          evidenceSources,
          timeRange: RevenueLeakEngine.formatTimeRangeDisplay(leadTimeRange),
          structuredTimeRange: leadTimeRange,
          recommendedAction: isDataInsufficient ? undefined : {
            actionType: 'workflow_automation',
            headline: 'Enable Automated Instant AI Lead Qualification SMS Responder',
            expectedRecoveryMonthlyMinor: null,
            suggestedPayload: { maxDelaySeconds: 60, autoAssign: true }
          },
          status: 'active'
        });
      }
    }

    // ------------------------------------------------------------------------
    // RULE C: Post-Proposal Follow-Up Gap (RULE_FOLLOW_UP_GAP)
    // ------------------------------------------------------------------------
    const configC = getConfig('RULE_FOLLOW_UP_GAP');
    if (configC.isEnabled && evalTimestamp) {
      const followUpGapHours = configC.thresholds.followUpGapHours ?? 72;
      const gapMs = followUpGapHours * 3600 * 1000;
      const nowMs = Date.parse(evalTimestamp);

      const matchedEvidence: LeadActivityEvidence[] = [];
      const stalledProposals = scopedLeads.filter(l => {
        if (l.funnel_stage !== 'proposal_sent' || l.status !== 'open') return false;
        
        const evidence = scopedActivityEvidence.find(e => e.leadId === l.id);
        if (!evidence) return false;
        if (evidence.isComplete !== true) return false;
        if (businessId && evidence.businessId !== businessId) return false;

        const proposalSentTime = evidence.proposalSentAt;
        if (!proposalSentTime || typeof proposalSentTime !== 'string' || !isValidIsoWithTimezone(proposalSentTime)) return false;
        
        const proposalSentMs = Date.parse(proposalSentTime);
        if (isNaN(proposalSentMs)) return false;

        if (!evidence.coverageStart || !isValidIsoWithTimezone(evidence.coverageStart)) return false;
        const covStartMs = Date.parse(evidence.coverageStart);
        if (isNaN(covStartMs) || covStartMs > proposalSentMs) return false;

        if (!evidence.coverageEnd || !isValidIsoWithTimezone(evidence.coverageEnd)) return false;
        const covEndMs = Date.parse(evidence.coverageEnd);
        if (isNaN(covEndMs) || covEndMs < (proposalSentMs + gapMs)) return false;
        
        const elapsedSinceProposal = nowMs - proposalSentMs;
        if (elapsedSinceProposal < gapMs) return false;

        if (evidence.lastFollowUpAt) {
          if (!isValidIsoWithTimezone(evidence.lastFollowUpAt)) return false;
          const lastFollowUpMs = Date.parse(evidence.lastFollowUpAt);
          if (!isNaN(lastFollowUpMs) && lastFollowUpMs >= proposalSentMs) {
            return false;
          }
        }

        if (evidence.lastActivityAt) {
          if (!isValidIsoWithTimezone(evidence.lastActivityAt)) return false;
          const lastActivityMs = Date.parse(evidence.lastActivityAt);
          if (!isNaN(lastActivityMs) && lastActivityMs >= proposalSentMs) {
            return false;
          }
        }

        matchedEvidence.push(evidence);
        return true;
      });

      if (stalledProposals.length > 0) {
        const count = stalledProposals.length;
        const totalProposalValueMinor = stalledProposals.reduce((s, l) => s + (l.estimated_deal_value_minor || 0), 0);
        
        const selectedWinAssumption = RevenueLeakEngine.isRateAssumptionValid(proposalWinRateBaseline)
          ? proposalWinRateBaseline
          : (isConvRateValid ? conversionRateAssumption : undefined);

        let isDataInsufficient = !selectedWinAssumption || !isCanonicalCurrency;
        const closeRate = selectedWinAssumption ? selectedWinAssumption.value : 0;
        let calculatedLossMinor = isDataInsufficient ? null : Math.round(totalProposalValueMinor * closeRate);

        const closeRateProvenance = selectedWinAssumption?.provenance || { source: 'UNAVAILABLE' as MetricProvenanceSource, confidence: 'INSUFFICIENT' as LeakConfidenceLevel };

        let covRange: EvidenceTimeRange | null = null;
        if (matchedEvidence.length > 0) {
          const starts = matchedEvidence.map(e => e.coverageStart).filter(isValidIsoWithTimezone).sort();
          const ends = matchedEvidence.map(e => e.coverageEnd).filter(isValidIsoWithTimezone).sort();
          if (starts.length > 0 && ends.length > 0) {
            covRange = { start: starts[0], end: ends[ends.length - 1] };
          }
        }

        const closeTimeRange = RevenueLeakEngine.parseTimeRange(closeRateProvenance.timeRange);

        const winConf = selectedWinAssumption
          ? RevenueLeakEngine.calculateConfidence(
              closeRateProvenance,
              closeRateProvenance.sampleSize,
              closeTimeRange,
              evalTimestamp
            )
          : { level: 'INSUFFICIENT' as LeakConfidenceLevel, reason: 'Missing valid proposal win rate baseline metric.' };

        const impactStatus = RevenueLeakEngine.determineImpactStatus(isDataInsufficient, [closeRateProvenance]);

        if (impactStatus === 'INSUFFICIENT_DATA') {
          isDataInsufficient = true;
          calculatedLossMinor = null;
        }

        const confidenceLevel = isDataInsufficient ? 'INSUFFICIENT' : winConf.level;
        const confidenceReason = isDataInsufficient
          ? 'Proposal win rate baseline metric unavailable or lacking explicit source authority.'
          : `Confidence based on verified proposal activity coverage and win rate baseline (${winConf.level}).`;

        const leadActivitySource = matchedEvidence[0]?.source && matchedEvidence[0].source.trim().length > 0
          ? matchedEvidence[0].source.trim()
          : null;

        const leadEvidenceRef: EvidenceSourceReference = {
          kind: 'LEAD_ROWS',
          recordIds: stalledProposals.map(l => l.id),
          sampleSize: count,
        };

        const actEvidenceRef: EvidenceSourceReference = {
          kind: 'LEAD_ACTIVITY_EVIDENCE',
          sourceId: leadActivitySource,
          recordIds: matchedEvidence.map(e => e.leadId),
          sampleSize: matchedEvidence.length,
          timeRange: covRange,
        };

        const winEvidenceRef = selectedWinAssumption ? RevenueLeakEngine.buildMetricEvidenceSource(selectedWinAssumption) : null;

        const evidenceSources: EvidenceSourceReference[] = [
          leadEvidenceRef,
          actEvidenceRef
        ];

        if (winEvidenceRef) {
          evidenceSources.push(winEvidenceRef);
        }

        findings.push({
          leakId: 'leak_det_followup_gap',
          ruleId: 'RULE_FOLLOW_UP_GAP',
          title: `${count} High-Value Proposals Sent with >${followUpGapHours}h Follow-Up Silence`,
          severity: 'high',
          category: 'follow_up_bottleneck',
          observedFacts: [
            `${count} commercial proposals totaling ${currSym}${(totalProposalValueMinor / 100).toLocaleString()} have exceeded ${followUpGapHours} hours with no recorded follow-up touchpoint.`,
            `Funnel stage: Proposal Sent with proven activity silence window across verified activity logs.`
          ],
          calculatedMetrics: [
            {
              metricKey: 'stalled_proposals_count',
              valueType: 'COUNT',
              label: 'Stalled Proposals',
              valueString: `${count} proposals`,
              numericValue: count,
              unit: 'proposals',
              classification: 'OBSERVED',
              sourceDataSource: 'LEAD_ACTIVITY_EVIDENCE',
              evidenceReference: actEvidenceRef,
            },
            {
              metricKey: proposalWinRateBaseline ? 'proposal_win_rate' : 'conversion_rate',
              valueType: 'RATE',
              label: proposalWinRateBaseline ? 'Proposal Win Baseline' : 'Conversion Rate Baseline',
              valueString: selectedWinAssumption ? `${(closeRate * 100).toFixed(1)}%` : 'UNAVAILABLE',
              numericValue: closeRate,
              unit: '%',
              classification: 'CALCULATED',
              sourceDataSource: RevenueLeakEngine.formatEvidenceSourceString(winEvidenceRef),
              evidenceReference: winEvidenceRef || undefined,
              provenance: closeRateProvenance
            }
          ],
          calculationFormula: isDataInsufficient
            ? 'Calculation suspended: Proposal win rate baseline metric unavailable.'
            : `${currSym}${(totalProposalValueMinor / 100).toLocaleString()} proposal pipeline × ${(closeRate * 100).toFixed(1)}% win baseline = ${currSym}${((calculatedLossMinor || 0) / 100).toLocaleString()}`,
          isDataInsufficient,
          insufficientDataReason: isDataInsufficient ? 'Requires verified proposal win rate baseline metric.' : undefined,
          impactStatus,
          estimatedImpactMinor: calculatedLossMinor,
          currency,
          confidenceLevel,
          confidenceReason,
          dataSources: RevenueLeakEngine.formatDataSources(evidenceSources),
          evidenceSources,
          timeRange: RevenueLeakEngine.formatTimeRangeDisplay(covRange),
          structuredTimeRange: covRange,
          recommendedAction: isDataInsufficient ? undefined : {
            actionType: 're_engagement_sequence',
            headline: 'Dispatch Multi-Channel Follow-Up Sequence (Email + WhatsApp Touch)',
            expectedRecoveryMonthlyMinor: null,
            suggestedPayload: { targetProposalIds: stalledProposals.map(p => p.id), stepIntervalDays: 2 }
          },
          status: 'active'
        });
      }
    }

    // ------------------------------------------------------------------------
    // RULE D: Missed Inbound Calls (RULE_MISSED_INBOUND_CALL)
    // ------------------------------------------------------------------------
    const configD = getConfig('RULE_MISSED_INBOUND_CALL');
    if (
      configD.isEnabled &&
      evalTimestamp &&
      callHistoryCoverage &&
      callHistoryCoverage.isComplete === true &&
      (!businessId || callHistoryCoverage.businessId === businessId) &&
      isValidIsoWithTimezone(callHistoryCoverage.coveredFrom) &&
      isValidIsoWithTimezone(callHistoryCoverage.coveredTo)
    ) {
      const followUpGapHours = configD.thresholds.followUpGapHours ?? 2;
      const callbackWindowMs = followUpGapHours * 3600 * 1000;
      const nowMs = Date.parse(evalTimestamp);
      const covFromMs = Date.parse(callHistoryCoverage.coveredFrom);
      const covToMs = Date.parse(callHistoryCoverage.coveredTo);

      const unreturnedMissedCalls = scopedCalls.filter(m => {
        if (m.direction !== 'inbound' || m.status !== 'missed') return false;
        const callerId = m.pseudonymousCallerId || m.linkedLeadId || m.linkedCustomerId;
        if (!callerId) return false;

        const timeStr = m.endedAt || m.startedAt;
        if (!timeStr || !isValidIsoWithTimezone(timeStr)) return false;

        const missedEndMs = Date.parse(timeStr);
        if (isNaN(missedEndMs)) return false;

        if (nowMs < (missedEndMs + callbackWindowMs)) return false;

        if (isNaN(covFromMs) || isNaN(covToMs) || covFromMs > missedEndMs || covToMs < (missedEndMs + callbackWindowMs)) {
          return false;
        }

        const hasQualifyingCallback = scopedCalls.some(cb => {
          if (cb.direction !== 'outbound') return false;
          const cbCallerId = cb.pseudonymousCallerId || cb.linkedLeadId || cb.linkedCustomerId;
          if (cbCallerId !== callerId) return false;

          if (!cb.startedAt || !isValidIsoWithTimezone(cb.startedAt)) return false;
          const cbStartMs = Date.parse(cb.startedAt);
          if (isNaN(cbStartMs)) return false;

          return cbStartMs > missedEndMs && cbStartMs <= (missedEndMs + callbackWindowMs);
        });

        return !hasQualifyingCallback;
      });

      if (unreturnedMissedCalls.length > 0) {
        const callCount = unreturnedMissedCalls.length;
        
        const selectedDealAssumption = (isCanonicalCurrency && RevenueLeakEngine.isMoneyAssumptionValid(callAverageDealValueAssumption, currency))
          ? callAverageDealValueAssumption
          : ((isCanonicalCurrency && RevenueLeakEngine.isMoneyAssumptionValid(avgDealValueAssumption, currency)) ? avgDealValueAssumption : undefined);

        let isDataInsufficient = !isCallConvValid || !selectedDealAssumption || !isCanonicalCurrency;
        const callConv = isCallConvValid ? callConversionAssumption!.value : 0;
        const callDealValMinor = selectedDealAssumption ? RevenueLeakEngine.getMoneyMinor(selectedDealAssumption) : 0;

        let callEstimatedLossMinor = isDataInsufficient ? null : Math.round(callCount * callConv * callDealValMinor);

        const dealValProv = selectedDealAssumption?.provenance || { source: 'UNAVAILABLE' as MetricProvenanceSource, confidence: 'INSUFFICIENT' as LeakConfidenceLevel };
        const convProv = callConversionAssumption?.provenance || { source: 'UNAVAILABLE' as MetricProvenanceSource, confidence: 'INSUFFICIENT' as LeakConfidenceLevel };

        const coverageRange: EvidenceTimeRange = {
          start: callHistoryCoverage.coveredFrom,
          end: callHistoryCoverage.coveredTo
        };

        const convConf = isCallConvValid
          ? RevenueLeakEngine.calculateConfidence(
              convProv,
              convProv.sampleSize,
              RevenueLeakEngine.parseTimeRange(convProv.timeRange),
              evalTimestamp
            )
          : { level: 'INSUFFICIENT' as LeakConfidenceLevel, reason: 'Missing valid call conversion baseline.' };

        const dealConf = selectedDealAssumption
          ? RevenueLeakEngine.calculateConfidence(
              dealValProv,
              dealValProv.sampleSize,
              RevenueLeakEngine.parseTimeRange(dealValProv.timeRange),
              evalTimestamp
            )
          : { level: 'INSUFFICIENT' as LeakConfidenceLevel, reason: 'Missing valid deal value assumption.' };

        const impactStatus = RevenueLeakEngine.determineImpactStatus(
          isDataInsufficient,
          [convProv, dealValProv]
        );

        if (impactStatus === 'INSUFFICIENT_DATA') {
          isDataInsufficient = true;
          callEstimatedLossMinor = null;
        }

        const confidenceLevel = isDataInsufficient
          ? 'INSUFFICIENT'
          : RevenueLeakEngine.aggregateConfidence([convConf.level, dealConf.level]);

        const confidenceReason = isDataInsufficient
          ? 'Requires verified call average deal value and call conversion baseline with explicit source authority.'
          : `Aggregated confidence across conversion baseline (${convConf.level}) and deal baseline (${dealConf.level}).`;

        const covSourceId = callHistoryCoverage.sourceId && callHistoryCoverage.sourceId.trim().length > 0
          ? callHistoryCoverage.sourceId.trim()
          : null;

        const callEvidenceRef: EvidenceSourceReference = {
          kind: 'CALL_METADATA_EVENTS',
          recordIds: unreturnedMissedCalls.map(c => c.id),
          sampleSize: callCount,
          timeRange: coverageRange,
        };

        const covEvidenceRef: EvidenceSourceReference = {
          kind: 'CALL_HISTORY_COVERAGE',
          sourceId: covSourceId,
          timeRange: coverageRange,
        };

        const convEvidenceRef = isCallConvValid ? RevenueLeakEngine.buildMetricEvidenceSource(callConversionAssumption) : null;
        const dealEvidenceRef = selectedDealAssumption ? RevenueLeakEngine.buildMetricEvidenceSource(selectedDealAssumption) : null;

        const evidenceSources: EvidenceSourceReference[] = [
          callEvidenceRef,
          covEvidenceRef
        ];

        if (convEvidenceRef) {
          evidenceSources.push(convEvidenceRef);
        }

        if (dealEvidenceRef) {
          evidenceSources.push(dealEvidenceRef);
        }

        findings.push({
          leakId: 'leak_det_missed_calls',
          ruleId: 'RULE_MISSED_INBOUND_CALL',
          title: `${callCount} Unreturned Inbound Business Phone Calls`,
          severity: 'high',
          category: 'call_decay',
          observedFacts: [
            `${callCount} inbound phone calls went unanswered with no qualifying callback logged within ${followUpGapHours} hours.`,
            `Average caller wait time before abandonment: ${Math.round(unreturnedMissedCalls.reduce((s, c) => s + c.waitDurationSeconds, 0) / callCount)}s.`,
            `Privacy guarantee: Metadata only evaluated (zero audio capture).`
          ],
          calculatedMetrics: [
            {
              metricKey: 'missed_calls_count',
              valueType: 'COUNT',
              label: 'Missed Calls Logged',
              valueString: `${callCount} calls`,
              numericValue: callCount,
              unit: 'calls',
              classification: 'OBSERVED',
              sourceDataSource: 'CALL_METADATA_EVENTS',
              evidenceReference: callEvidenceRef,
            },
            {
              metricKey: 'call_conversion_rate',
              valueType: 'RATE',
              label: 'Inbound Call Conversion',
              valueString: isCallConvValid ? `${(callConv * 100).toFixed(1)}%` : 'UNAVAILABLE',
              numericValue: callConv,
              unit: '%',
              classification: 'CALCULATED',
              sourceDataSource: RevenueLeakEngine.formatEvidenceSourceString(convEvidenceRef),
              evidenceReference: convEvidenceRef || undefined,
              provenance: convProv
            },
            {
              metricKey: callAverageDealValueAssumption ? 'call_average_deal_value_minor' : 'average_deal_value_minor',
              valueType: 'MONEY_MINOR',
              label: callAverageDealValueAssumption ? 'Call Average Deal Value' : 'Average Deal Value',
              valueString: selectedDealAssumption ? `${currSym}${(callDealValMinor / 100).toLocaleString()}` : 'UNAVAILABLE',
              numericValue: callDealValMinor,
              currency: isCanonicalCurrency ? (currency as CurrencyCode) : undefined,
              unit: currency,
              classification: 'CALCULATED',
              sourceDataSource: RevenueLeakEngine.formatEvidenceSourceString(dealEvidenceRef),
              evidenceReference: dealEvidenceRef || undefined,
              provenance: dealValProv
            },
          ],
          calculationFormula: isDataInsufficient
            ? 'Calculation suspended: Baseline deal and call conversion metrics unavailable.'
            : `${callCount} missed calls × ${(callConv * 100).toFixed(1)}% conversion × ${currSym}${(callDealValMinor / 100).toLocaleString()} deal baseline = ${currSym}${((callEstimatedLossMinor || 0) / 100).toLocaleString()}`,
          isDataInsufficient,
          insufficientDataReason: isDataInsufficient ? 'Requires verified call average deal value and call conversion baseline.' : undefined,
          impactStatus,
          estimatedImpactMinor: callEstimatedLossMinor,
          currency,
          confidenceLevel,
          confidenceReason,
          dataSources: RevenueLeakEngine.formatDataSources(evidenceSources),
          evidenceSources,
          timeRange: RevenueLeakEngine.formatTimeRangeDisplay(coverageRange),
          structuredTimeRange: coverageRange,
          recommendedAction: isDataInsufficient ? undefined : {
            actionType: 'workflow_automation',
            headline: 'Dispatch Automated Instant SMS Callback Link to Unanswered Callers',
            expectedRecoveryMonthlyMinor: null,
            suggestedPayload: { triggerChannel: 'sms_instant_callback', maxDelayMinutes: 5 }
          },
          status: 'active'
        });
      }
    }

    // ------------------------------------------------------------------------
    // RULE E: Appointment No-Show / Cancellation Gap (RULE_APPOINTMENT_NO_SHOW_GAP)
    // ------------------------------------------------------------------------
    const configE = getConfig('RULE_APPOINTMENT_NO_SHOW_GAP');
    if (
      configE.isEnabled &&
      evalTimestamp &&
      appointmentHistoryCoverage &&
      appointmentHistoryCoverage.isComplete === true &&
      (!businessId || appointmentHistoryCoverage.businessId === businessId) &&
      isValidIsoWithTimezone(appointmentHistoryCoverage.coveredFrom) &&
      isValidIsoWithTimezone(appointmentHistoryCoverage.coveredTo)
    ) {
      const followUpGapHours = configE.thresholds.followUpGapHours ?? 24;
      const recoveryWindowMs = followUpGapHours * 3600 * 1000;
      const nowMs = Date.parse(evalTimestamp);
      const covFromMs = Date.parse(appointmentHistoryCoverage.coveredFrom);
      const covToMs = Date.parse(appointmentHistoryCoverage.coveredTo);

      const unrecoveredNoShows = scopedAppointments.filter(a => {
        if (a.status !== 'no_show' && a.status !== 'cancelled') return false;
        if (!a.customerPseudonymId) return false;
        if (!a.scheduledStart || !isValidIsoWithTimezone(a.scheduledStart)) return false;

        const apptStartMs = Date.parse(a.scheduledStart);
        if (isNaN(apptStartMs)) return false;

        if (nowMs < (apptStartMs + recoveryWindowMs)) return false;

        if (isNaN(covFromMs) || isNaN(covToMs) || covFromMs > apptStartMs || covToMs < (apptStartMs + recoveryWindowMs)) {
          return false;
        }

        const hasRescheduledEvent = scopedAppointmentEvents.some(
          ev => ev.appointmentId === a.id && (ev.eventType === 'appointment.rescheduled' || ev.payload?.newStatus === 'rescheduled')
        );
        if (hasRescheduledEvent) return false;

        const hasReplacementAppointment = scopedAppointments.some(a2 => {
          if (a2.id === a.id || a2.customerPseudonymId !== a.customerPseudonymId) return false;
          if (!a2.scheduledStart || !isValidIsoWithTimezone(a2.scheduledStart)) return false;
          const a2StartMs = Date.parse(a2.scheduledStart);
          return a2StartMs >= apptStartMs && (a2.status === 'confirmed' || a2.status === 'scheduled' || a2.status === 'in_progress' || a2.status === 'completed');
        });

        return !hasReplacementAppointment;
      });

      if (unrecoveredNoShows.length > 0) {
        const noShowCount = unrecoveredNoShows.length;
        
        const hasCurrencyMismatch = unrecoveredNoShows.some(a => a.currency !== currency);
        const recoveryAssumption = RevenueLeakEngine.isRateAssumptionValid(noShowRecoveryAssumption)
          ? noShowRecoveryAssumption
          : (RevenueLeakEngine.isRateAssumptionValid(noShowRecoveryRateBaseline) ? noShowRecoveryRateBaseline : undefined);

        let isDataInsufficient = !recoveryAssumption || hasCurrencyMismatch || !isCanonicalCurrency;

        const matchingAppointments = unrecoveredNoShows.filter(a => a.currency === currency);
        const noShowTotalValueMinor = matchingAppointments.reduce((s, a) => s + a.expectedValueMinor, 0);

        const recoveryRate = recoveryAssumption ? recoveryAssumption.value : 0;
        let noShowLossMinor = isDataInsufficient ? null : Math.round(noShowTotalValueMinor * recoveryRate);

        const recoveryProv = recoveryAssumption?.provenance || { source: 'UNAVAILABLE' as MetricProvenanceSource, confidence: 'INSUFFICIENT' as LeakConfidenceLevel };

        const coverageRange: EvidenceTimeRange = {
          start: appointmentHistoryCoverage.coveredFrom,
          end: appointmentHistoryCoverage.coveredTo
        };

        const recConf = recoveryAssumption
          ? RevenueLeakEngine.calculateConfidence(
              recoveryProv,
              recoveryProv.sampleSize,
              RevenueLeakEngine.parseTimeRange(recoveryProv.timeRange),
              evalTimestamp
            )
          : { level: 'INSUFFICIENT' as LeakConfidenceLevel, reason: 'Missing valid recovery rate assumption.' };

        const impactStatus = RevenueLeakEngine.determineImpactStatus(isDataInsufficient, [recoveryProv]);

        if (impactStatus === 'INSUFFICIENT_DATA') {
          isDataInsufficient = true;
          noShowLossMinor = null;
        }

        const confidenceLevel = isDataInsufficient ? 'INSUFFICIENT' : recConf.level;
        const confidenceReason = isDataInsufficient
          ? (hasCurrencyMismatch ? `Currency mismatch across appointment records and business currency (${currency}).` : 'Requires verified appointment rebooking recovery rate baseline with explicit source authority.')
          : `Aggregated confidence based on appointment coverage and rebooking rate baseline (${recConf.level}).`;

        const covSourceId = appointmentHistoryCoverage.sourceId && appointmentHistoryCoverage.sourceId.trim().length > 0
          ? appointmentHistoryCoverage.sourceId.trim()
          : null;

        const apptEvidenceRef: EvidenceSourceReference = {
          kind: 'APPOINTMENT_ROWS',
          recordIds: unrecoveredNoShows.map(a => a.id),
          sampleSize: noShowCount,
          timeRange: coverageRange,
        };

        const covEvidenceRef: EvidenceSourceReference = {
          kind: 'APPOINTMENT_HISTORY_COVERAGE',
          sourceId: covSourceId,
          timeRange: coverageRange,
        };

        const recEvidenceRef = recoveryAssumption ? RevenueLeakEngine.buildMetricEvidenceSource(recoveryAssumption) : null;

        const evidenceSources: EvidenceSourceReference[] = [
          apptEvidenceRef,
          covEvidenceRef
        ];

        if (recEvidenceRef) {
          evidenceSources.push(recEvidenceRef);
        }

        const observedFacts = [
          `${noShowCount} scheduled appointments resulted in unrecovered no-show or cancellation with verified absence of rebooking.`
        ];
        if (!hasCurrencyMismatch && isCanonicalCurrency) {
          observedFacts.push(`Total slot value forfeited: ${currSym}${(noShowTotalValueMinor / 100).toLocaleString()}`);
        }

        findings.push({
          leakId: 'leak_det_noshow',
          ruleId: 'RULE_APPOINTMENT_NO_SHOW_GAP',
          title: `${noShowCount} Unrecovered Appointment Cancellations & No-Shows`,
          severity: 'high',
          category: 'no_show_decay',
          observedFacts,
          calculatedMetrics: [
            {
              metricKey: 'forfeited_appointments_count',
              valueType: 'COUNT',
              label: 'Forfeited Appointments',
              valueString: `${noShowCount} slots`,
              numericValue: noShowCount,
              unit: 'slots',
              classification: 'OBSERVED',
              sourceDataSource: 'APPOINTMENT_ROWS',
              evidenceReference: apptEvidenceRef,
            },
            {
              metricKey: 'target_rebook_recovery_rate',
              valueType: 'RATE',
              label: 'Target Rebook Recovery Rate',
              valueString: recoveryAssumption ? `${(recoveryRate * 100).toFixed(1)}%` : 'UNAVAILABLE',
              numericValue: recoveryRate,
              unit: '%',
              classification: 'CALCULATED',
              sourceDataSource: RevenueLeakEngine.formatEvidenceSourceString(recEvidenceRef),
              evidenceReference: recEvidenceRef || undefined,
              provenance: recoveryProv
            },
          ],
          calculationFormula: isDataInsufficient
            ? 'Calculation suspended: Baseline rebooking recovery metric unavailable.'
            : `${currSym}${(noShowTotalValueMinor / 100).toLocaleString()} forfeited value × ${(recoveryRate * 100).toFixed(1)}% recovery rate = ${currSym}${((noShowLossMinor || 0) / 100).toLocaleString()}`,
          isDataInsufficient,
          insufficientDataReason: isDataInsufficient ? 'Requires verified appointment rebooking recovery rate baseline.' : undefined,
          impactStatus,
          estimatedImpactMinor: noShowLossMinor,
          currency,
          confidenceLevel,
          confidenceReason,
          dataSources: RevenueLeakEngine.formatDataSources(evidenceSources),
          evidenceSources,
          timeRange: RevenueLeakEngine.formatTimeRangeDisplay(coverageRange),
          structuredTimeRange: coverageRange,
          recommendedAction: isDataInsufficient ? undefined : {
            actionType: 're_engagement_sequence',
            headline: 'Automated 1-Click Rescheduling Sequence via WhatsApp / SMS',
            expectedRecoveryMonthlyMinor: null,
            suggestedPayload: { followUpDelayHours: 2, channel: 'whatsapp_sms' }
          },
          status: 'active'
        });
      }
    }

    // ------------------------------------------------------------------------
    // RULE F: Unused Off-Peak Capacity (RULE_OFF_PEAK_UNUSED_CAPACITY)
    // ------------------------------------------------------------------------
    const configF = getConfig('RULE_OFF_PEAK_UNUSED_CAPACITY');
    if (configF.isEnabled && capacity && capacity.lowestWindow) {
      const isCapacityTenantMatch = businessId
        ? capacity.businessId === businessId
        : (typeof capacity.businessId === 'string' && capacity.businessId.trim().length > 0);

      if (isCapacityTenantMatch) {
        const minUtilization = configF.thresholds.capacityMinUtilizationPct ?? 50;
        if (capacity.lowestWindow.utilizationPct < minUtilization) {
          const window = capacity.lowestWindow;
          const hasMatchingCurrency = window.currency === currency && isCanonicalCurrency;
          const hasValidCapacityProvenance = Boolean(
            capacity.provenance &&
            typeof capacity.provenance.sourceId === 'string' &&
            capacity.provenance.sourceId.trim().length > 0 &&
            capacity.provenance.source !== 'INSUFFICIENT_DATA' &&
            capacity.provenance.source !== 'UNAVAILABLE'
          );

          let isDataInsufficient = !hasValidCapacityProvenance || !hasMatchingCurrency;
          let estimatedImpactMinor = isDataInsufficient ? null : window.potentialRevenueLossMinor;

          const capProv = capacity.provenance || { source: 'UNAVAILABLE' as MetricProvenanceSource, confidence: 'INSUFFICIENT' as LeakConfidenceLevel };
          const capTimeRange = RevenueLeakEngine.parseTimeRange(capacity.provenance?.timeRange);

          const impactStatus = RevenueLeakEngine.determineImpactStatus(isDataInsufficient, [capacity.provenance]);

          if (impactStatus === 'INSUFFICIENT_DATA') {
            isDataInsufficient = true;
            estimatedImpactMinor = null;
          }

          const conf = isDataInsufficient
            ? { level: 'INSUFFICIENT' as LeakConfidenceLevel, reason: !hasMatchingCurrency ? `Currency mismatch: Capacity snapshot currency (${window.currency}) does not match business currency (${currency}).` : 'Capacity revenue loss metric lacks verified provenance or explicit source authority.' }
            : RevenueLeakEngine.calculateConfidence(
                capacity.provenance,
                capacity.provenance?.sampleSize,
                capTimeRange,
                evalTimestamp
              );

          const capSourceId = (capacity.source && capacity.source.trim().length > 0)
            ? capacity.source.trim()
            : ((capacity.provenance?.sourceId && capacity.provenance.sourceId.trim().length > 0) ? capacity.provenance.sourceId.trim() : null);

          const evidenceSources: EvidenceSourceReference[] = [
            {
              kind: 'CAPACITY_UTILIZATION',
              sourceId: capSourceId,
              sampleSize: capacity.provenance?.sampleSize ?? null,
              timeRange: capTimeRange,
            }
          ];

          findings.push({
            leakId: 'leak_det_capacity',
            ruleId: 'RULE_OFF_PEAK_UNUSED_CAPACITY',
            title: `Low Off-Peak Capacity Utilization in ${window.windowLabel} (${window.utilizationPct}%)`,
            severity: 'medium',
            category: 'unused_capacity',
            observedFacts: [
              `${window.windowLabel} exhibits ${window.utilizationPct}% capacity utilization (below the ${minUtilization}% threshold).`,
              `Unfilled capacity measured: ${window.unfilledCapacityMinutes} minutes across available resources.`
            ],
            calculatedMetrics: [
              {
                metricKey: 'window_utilization_pct',
                valueType: 'RATE',
                label: 'Window Utilization',
                valueString: `${window.utilizationPct}%`,
                numericValue: window.utilizationPct,
                unit: '%',
                classification: 'CALCULATED',
                sourceDataSource: 'CAPACITY_UTILIZATION',
                evidenceReference: evidenceSources[0],
                provenance: capProv
              },
              {
                metricKey: 'unfilled_duration_minutes',
                valueType: 'DURATION_MINUTES',
                label: 'Unfilled Duration',
                valueString: `${Math.round(window.unfilledCapacityMinutes / 60)} hrs`,
                numericValue: window.unfilledCapacityMinutes,
                unit: 'min',
                classification: 'OBSERVED',
                sourceDataSource: 'CAPACITY_UTILIZATION',
                evidenceReference: evidenceSources[0],
              }
            ],
            calculationFormula: isDataInsufficient
              ? 'Calculation suspended: Capacity loss metric lacks verified provenance or currency alignment.'
              : `${currSym}${(window.potentialRevenueLossMinor / 100).toLocaleString()} potential revenue loss for ${Math.round(window.unfilledCapacityMinutes / 60)} unfilled hours in ${window.windowLabel}.`,
            isDataInsufficient,
            insufficientDataReason: isDataInsufficient ? 'Capacity revenue loss metric lacks verified provenance or currency alignment.' : undefined,
            impactStatus,
            estimatedImpactMinor,
            currency,
            confidenceLevel: conf.level,
            confidenceReason: conf.reason,
            dataSources: RevenueLeakEngine.formatDataSources(evidenceSources),
            evidenceSources,
            timeRange: RevenueLeakEngine.formatTimeRangeDisplay(capTimeRange),
            structuredTimeRange: capTimeRange,
            recommendedAction: {
              actionType: 'workflow_automation',
              headline: capacity.recommendedOffPeakIncentive,
              expectedRecoveryMonthlyMinor: null,
              suggestedPayload: { targetWindow: window.windowLabel, triggerCampaign: true }
            },
            status: 'active'
          });
        }
      }
    }

    // ------------------------------------------------------------------------
    // RULE G: Anomalous Funnel Stage Drop (RULE_FUNNEL_STAGE_DROP)
    // ------------------------------------------------------------------------
    const configG = getConfig('RULE_FUNNEL_STAGE_DROP');
    if (configG.isEnabled) {
      const dropThresholdPct = (configG.thresholds.funnelDropPct ?? 20) / 100;
      const minSample = configG.thresholds.minSampleSizeForCalculation ?? 5;
      const totalCaptured = scopedLeads.length;
      const qualifiedLeads = scopedLeads.filter(l => l.funnel_stage !== 'captured');
      const actualQualRate = totalCaptured > 0 ? qualifiedLeads.length / totalCaptured : 0;

      if (totalCaptured >= minSample) {
        let isDataInsufficient = !isQualValid || !isAvgDealValid || !isConvRateValid || !isCanonicalCurrency;
        const baselineQualRate = isQualValid ? qualificationRateBaseline!.value : 0;

        if (isDataInsufficient || actualQualRate < (baselineQualRate - dropThresholdPct)) {
          const dealValMinor = isAvgDealValid ? RevenueLeakEngine.getMoneyMinor(avgDealValueAssumption) : 0;
          const convRate = isConvRateValid ? conversionRateAssumption!.value : 0;
          let dropLossMinor = isDataInsufficient 
            ? null 
            : Math.round((baselineQualRate - actualQualRate) * totalCaptured * dealValMinor * convRate);

          const validLeadTimestamps = scopedLeads
            .map(l => l.created_at)
            .filter(t => t && isValidIsoWithTimezone(t));
          let leadTimeRange: EvidenceTimeRange | null = null;
          if (validLeadTimestamps.length > 0) {
            const sorted = [...validLeadTimestamps].sort();
            leadTimeRange = { start: sorted[0], end: sorted[sorted.length - 1] };
          }

          const qualTimeRange = RevenueLeakEngine.parseTimeRange(qualificationRateBaseline?.provenance?.timeRange);
          const convTimeRange = RevenueLeakEngine.parseTimeRange(conversionRateAssumption?.provenance?.timeRange);
          const dealTimeRange = RevenueLeakEngine.parseTimeRange(avgDealValueAssumption?.provenance?.timeRange);

          const qualConf = isQualValid
            ? RevenueLeakEngine.calculateConfidence(
                qualificationRateBaseline!.provenance,
                qualificationRateBaseline!.provenance.sampleSize,
                qualTimeRange,
                evalTimestamp
              )
            : { level: 'INSUFFICIENT' as LeakConfidenceLevel, reason: 'Missing qualification rate baseline.' };

          const convConf = isConvRateValid
            ? RevenueLeakEngine.calculateConfidence(
                conversionRateAssumption!.provenance,
                conversionRateAssumption!.provenance.sampleSize,
                convTimeRange,
                evalTimestamp
              )
            : { level: 'INSUFFICIENT' as LeakConfidenceLevel, reason: 'Missing conversion rate baseline.' };

          const dealConf = isAvgDealValid
            ? RevenueLeakEngine.calculateConfidence(
                avgDealValueAssumption!.provenance,
                avgDealValueAssumption!.provenance.sampleSize,
                dealTimeRange,
                evalTimestamp
              )
            : { level: 'INSUFFICIENT' as LeakConfidenceLevel, reason: 'Missing average deal value assumption.' };

          const impactStatus = RevenueLeakEngine.determineImpactStatus(
            isDataInsufficient,
            [qualificationRateBaseline?.provenance, conversionRateAssumption?.provenance, avgDealValueAssumption?.provenance]
          );

          if (impactStatus === 'INSUFFICIENT_DATA') {
            isDataInsufficient = true;
            dropLossMinor = null;
          }

          const confidenceLevel = isDataInsufficient
            ? 'INSUFFICIENT'
            : RevenueLeakEngine.aggregateConfidence([qualConf.level, convConf.level, dealConf.level]);

          const confidenceReason = isDataInsufficient
            ? 'Baseline metrics unavailable.'
            : `Aggregated confidence across qualification benchmark (${qualConf.level}), conversion baseline (${convConf.level}), and deal value (${dealConf.level}).`;

          const qualEvidenceRef = isQualValid ? RevenueLeakEngine.buildMetricEvidenceSource(qualificationRateBaseline) : null;
          const convEvidenceRef = isConvRateValid ? RevenueLeakEngine.buildMetricEvidenceSource(conversionRateAssumption) : null;
          const dealEvidenceRef = isAvgDealValid ? RevenueLeakEngine.buildMetricEvidenceSource(avgDealValueAssumption) : null;

          const leadEvidenceRef: EvidenceSourceReference = {
            kind: 'LEAD_ROWS',
            recordIds: scopedLeads.map(l => l.id),
            sampleSize: totalCaptured,
            timeRange: leadTimeRange,
          };

          const evidenceSources: EvidenceSourceReference[] = [leadEvidenceRef];

          if (qualEvidenceRef) {
            evidenceSources.push(qualEvidenceRef);
          }

          if (convEvidenceRef) {
            evidenceSources.push(convEvidenceRef);
          }

          if (dealEvidenceRef) {
            evidenceSources.push(dealEvidenceRef);
          }

          findings.push({
            leakId: 'leak_det_funnel_drop',
            ruleId: 'RULE_FUNNEL_STAGE_DROP',
            title: `Abnormal Qualification Funnel Drop (${Math.round(actualQualRate * 100)}% vs ${isQualValid ? Math.round(baselineQualRate * 100) : 'N/A'}% baseline)`,
            severity: 'high',
            category: 'funnel_friction',
            observedFacts: [
              `Only ${qualifiedLeads.length} of ${totalCaptured} captured leads advanced past intake stage (${Math.round(actualQualRate * 100)}%).`,
              isQualValid ? `Historical qualification benchmark is ${Math.round(baselineQualRate * 100)}%.` : 'Qualification baseline benchmark unavailable.'
            ],
            calculatedMetrics: [
              {
                metricKey: 'intake_conversion_rate',
                valueType: 'RATE',
                label: 'Intake Conversion Rate',
                valueString: `${(actualQualRate * 100).toFixed(1)}%`,
                numericValue: actualQualRate,
                unit: '%',
                classification: 'OBSERVED',
                sourceDataSource: 'LEAD_ROWS',
                evidenceReference: leadEvidenceRef,
              },
              {
                metricKey: 'qualification_rate_baseline',
                valueType: 'RATE',
                label: 'Baseline Target',
                valueString: isQualValid ? `${(baselineQualRate * 100).toFixed(1)}%` : 'UNAVAILABLE',
                numericValue: baselineQualRate,
                unit: '%',
                classification: 'CALCULATED',
                sourceDataSource: RevenueLeakEngine.formatEvidenceSourceString(qualEvidenceRef),
                evidenceReference: qualEvidenceRef || undefined,
                provenance: qualificationRateBaseline?.provenance || { source: 'UNAVAILABLE', confidence: 'INSUFFICIENT' }
              }
            ],
            calculationFormula: isDataInsufficient
              ? 'Calculation suspended: Baseline qualification rate, deal value, or conversion rate unavailable.'
              : `(${Math.round(baselineQualRate * 100)}% baseline - ${Math.round(actualQualRate * 100)}% actual) × ${totalCaptured} leads × ${currSym}${(dealValMinor / 100).toLocaleString()} = ${currSym}${((dropLossMinor || 0) / 100).toLocaleString()}`,
            isDataInsufficient,
            insufficientDataReason: isDataInsufficient ? 'Requires verified qualification rate baseline, average deal value, and conversion rate assumptions.' : undefined,
            impactStatus,
            estimatedImpactMinor: dropLossMinor,
            currency,
            confidenceLevel,
            confidenceReason,
            dataSources: RevenueLeakEngine.formatDataSources(evidenceSources),
            evidenceSources,
            timeRange: RevenueLeakEngine.formatTimeRangeDisplay(leadTimeRange),
            structuredTimeRange: leadTimeRange,
            recommendedAction: isDataInsufficient ? undefined : {
              actionType: 'pricing_adjustment',
              headline: 'Implement Interactive Intake Assessment Widget to Pre-Qualify Leads',
              expectedRecoveryMonthlyMinor: null,
              suggestedPayload: { targetFunnelStage: 'captured', qualificationThreshold: 60 }
            },
            status: 'active'
          });
        }
      }
    }

    // ------------------------------------------------------------------------
    // RULE H: Aging Inventory Carrying Cost (RULE_AGING_INVENTORY_HOLDING)
    // ------------------------------------------------------------------------
    const configH = getConfig('RULE_AGING_INVENTORY_HOLDING');
    if (configH.isEnabled && scopedInventory && scopedInventory.length > 0) {
      const agingThresholdDays = configH.thresholds.inventoryAgingDays ?? 45;
      const criticalAging = scopedInventory.filter(i => {
        if (businessId && i.businessId !== businessId) return false;
        return i.holdingDays > agingThresholdDays;
      });

      if (criticalAging.length > 0) {
        const allItemsValid = criticalAging.every(i => 
          i.businessId &&
          (!businessId || i.businessId === businessId) &&
          i.currency === currency &&
          typeof i.unitCostMinor === 'number' && Number.isSafeInteger(i.unitCostMinor) && i.unitCostMinor >= 0 &&
          typeof i.quantityOnHand === 'number' && Number.isSafeInteger(i.quantityOnHand) && i.quantityOnHand >= 0 &&
          typeof i.holdingDays === 'number' && Number.isSafeInteger(i.holdingDays) && i.holdingDays >= 0 &&
          typeof i.dailyCarryingBps === 'number' && Number.isSafeInteger(i.dailyCarryingBps) && i.dailyCarryingBps >= 0 &&
          i.provenance &&
          typeof i.provenance.sourceId === 'string' &&
          i.provenance.sourceId.trim().length > 0 &&
          i.provenance.source !== 'INSUFFICIENT_DATA' &&
          i.provenance.source !== 'UNAVAILABLE'
        );

        let isDataInsufficient = !allItemsValid || !isCanonicalCurrency;
        const totalUnits = criticalAging.reduce((s, i) => s + (typeof i.quantityOnHand === 'number' ? i.quantityOnHand : 0), 0);

        let totalCarryingLossMinor = 0;
        let totalInventoryValueMinor = 0;
        if (!isDataInsufficient) {
          totalCarryingLossMinor = criticalAging.reduce((sum, item) => {
            const excessDays = item.holdingDays - agingThresholdDays;
            const itemVal = item.unitCostMinor * item.quantityOnHand;
            return sum + Math.round(itemVal * (item.dailyCarryingBps / 10000) * excessDays);
          }, 0);
          totalInventoryValueMinor = criticalAging.reduce((s, i) => s + (i.unitCostMinor * i.quantityOnHand), 0);
        }

        const calculatedLossMajor = Math.round(totalCarryingLossMinor / 100);

        const minBps = Math.min(...criticalAging.map(i => i.dailyCarryingBps));
        const maxBps = Math.max(...criticalAging.map(i => i.dailyCarryingBps));
        const minPct = (minBps / 100).toFixed(2);
        const maxPct = (maxBps / 100).toFixed(2);
        const carryingCostText = minBps === maxBps 
          ? `${minPct}% daily carrying cost (${minBps} bps)` 
          : `${minPct}% - ${maxPct}% daily carrying cost (${minBps} - ${maxBps} bps)`;

        const itemConfidences = criticalAging.map(i => 
          RevenueLeakEngine.calculateConfidence(
            i.provenance,
            i.provenance?.sampleSize,
            RevenueLeakEngine.parseTimeRange(i.provenance?.timeRange),
            evalTimestamp
          ).level
        );

        const impactStatus = RevenueLeakEngine.determineImpactStatus(
          isDataInsufficient,
          criticalAging.map(i => i.provenance)
        );

        if (impactStatus === 'INSUFFICIENT_DATA') {
          isDataInsufficient = true;
          totalCarryingLossMinor = 0;
        }

        const confidenceLevel = isDataInsufficient
          ? 'INSUFFICIENT'
          : RevenueLeakEngine.aggregateConfidence(itemConfidences);

        const confidenceReason = isDataInsufficient
          ? 'Inventory telemetry items lack verified provenance for holding duration, unit cost, or daily carrying cost.'
          : `Aggregated confidence across ${criticalAging.length} telemetry item provenance records (${confidenceLevel}).`;

        const evidenceSources: EvidenceSourceReference[] = [
          {
            kind: 'INVENTORY_TELEMETRY',
            recordIds: criticalAging.map(i => i.id),
            sampleSize: criticalAging.length,
          }
        ];

        const observedFacts = [
          `${criticalAging.length} product lines holding ${totalUnits} units have remained unsold beyond the ${agingThresholdDays}-day operational benchmark.`
        ];
        if (!isDataInsufficient) {
          observedFacts.push(`Total locked capital in aging stock: ${currSym}${(totalInventoryValueMinor / 100).toLocaleString()}`);
          observedFacts.push(`Holding costs accruing daily at ${carryingCostText}.`);
        }

        const calculatedMetrics: MetricComponent[] = [
          {
            metricKey: 'aging_sku_count',
            valueType: 'COUNT',
            label: 'Aging SKU Count',
            valueString: `${criticalAging.length} SKUs`,
            numericValue: criticalAging.length,
            unit: 'SKUs',
            classification: 'OBSERVED',
            sourceDataSource: 'INVENTORY_TELEMETRY',
            evidenceReference: evidenceSources[0],
          }
        ];

        if (!isDataInsufficient) {
          calculatedMetrics.push({
            metricKey: 'total_locked_capital_minor',
            valueType: 'MONEY_MINOR',
            label: 'Total Locked Capital',
            valueString: `${currSym}${(totalInventoryValueMinor / 100).toLocaleString()}`,
            numericValue: totalInventoryValueMinor,
            currency: isCanonicalCurrency ? (currency as CurrencyCode) : undefined,
            unit: currency,
            classification: 'OBSERVED',
            sourceDataSource: 'INVENTORY_TELEMETRY',
            evidenceReference: evidenceSources[0],
          });
        }

        findings.push({
          leakId: 'leak_det_inventory_aging',
          ruleId: 'RULE_AGING_INVENTORY_HOLDING',
          title: `${criticalAging.length} Inventory Product Lines Exceeding ${agingThresholdDays}-Day Holding Threshold`,
          severity: 'medium',
          category: 'aging_inventory',
          observedFacts,
          calculatedMetrics,
          calculationFormula: isDataInsufficient
            ? 'Calculation suspended: Inventory item telemetry lacks verified unit cost or holding duration provenance.'
            : `${currSym}${(totalInventoryValueMinor / 100).toLocaleString()} locked inventory × excess holding days × daily carrying bps = ${currSym}${calculatedLossMajor.toLocaleString()}`,
          isDataInsufficient,
          insufficientDataReason: isDataInsufficient ? 'Inventory item telemetry lacks verified unit cost or holding duration provenance.' : undefined,
          impactStatus,
          estimatedImpactMinor: isDataInsufficient ? null : totalCarryingLossMinor,
          currency,
          confidenceLevel,
          confidenceReason,
          dataSources: RevenueLeakEngine.formatDataSources(evidenceSources),
          evidenceSources,
          timeRange: null,
          structuredTimeRange: null,
          recommendedAction: isDataInsufficient ? undefined : {
            actionType: 'pricing_adjustment',
            headline: 'Review Aging Inventory Pricing and Bundle Options against Action Policy',
            expectedRecoveryMonthlyMinor: null,
            suggestedPayload: { targetSkus: criticalAging.map(i => i.sku), policyValidationRequired: true }
          },
          status: 'active'
        });
      }
    }

    return findings;
  }
}
