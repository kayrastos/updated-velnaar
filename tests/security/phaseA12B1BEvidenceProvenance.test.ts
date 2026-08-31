/**
 * @file phaseA12B1BEvidenceProvenance.test.ts
 * @description Sprint 4 Phase A.12B.1B Evidence & Provenance Final Seal Comprehensive Test Suite
 * 
 * Verifies zero fake confidence, zero synthetic source IDs, canonical money representations,
 * strict confidence scoring, weakest-link aggregation, strict impact status authority,
 * strict multi-tenant business isolation, and fail-closed evaluation behaviors across all rules.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { RevenueLeakEngine } from '../../src/services/revenueLeakEngine';
import { LeadRow } from '../../src/types/database';
import { Appointment } from '../../src/types/appointment';
import { CallMetadataEvent } from '../../src/types/telephony';
import { InventoryItemTelemetry } from '../../src/types/leakEngine';
import { CapacityUtilization } from '../../src/types/capacity';

describe('Phase A.12B.1B: Evidence & Provenance Final Seal', () => {
  describe('1. Static Code Zero-Tolerance Audit', () => {
    it('verifies RevenueLeakRadarView contains zero fake confidence or fallback source arrays', () => {
      const viewPath = path.resolve(__dirname, '../../src/views/RevenueLeakRadarView.tsx');
      const content = fs.readFileSync(viewPath, 'utf8');

      expect(content).not.toContain("leak.confidenceLevel || 'HIGH'");
      expect(content).not.toContain("activeForensicLeak.confidenceLevel || 'HIGH'");
      expect(content).not.toContain("|| ['Pipeline Ledger']");
      expect(content).not.toContain(": ['Evidence source unavailable']");
    });

    it('verifies revenueLeakEngine contains zero legacy Math.round(value * 100), fake fallbacks, synthetic source IDs, or implicit wall clocks', () => {
      const enginePath = path.resolve(__dirname, '../../src/services/revenueLeakEngine.ts');
      const content = fs.readFileSync(enginePath, 'utf8');

      expect(content).not.toContain('Math.round(value * 100)');
      expect(content).not.toContain("|| 'HIGH'");
      expect(content).not.toContain("|| ['Pipeline Ledger']");
      expect(content).not.toContain('leads:${businessId}');
      expect(content).not.toContain('call_coverage:${businessId}');
      expect(content).not.toContain('appointment_coverage:${businessId}');
      expect(content).not.toContain('capacity:${businessId}');
      expect(content).not.toContain('inventory_telemetry:${businessId}');
      expect(content).not.toContain('Date.now()');
      expect(content).not.toContain('new Date()');
    });
  });

  describe('2. Strict Confidence Calculation Verification', () => {
    it('returns INSUFFICIENT when provenance is UNAVAILABLE or INSUFFICIENT_DATA', () => {
      const res1 = RevenueLeakEngine.calculateConfidence({
        source: 'UNAVAILABLE',
        confidence: 'INSUFFICIENT'
      });
      expect(res1.level).toBe('INSUFFICIENT');

      const res2 = RevenueLeakEngine.calculateConfidence({
        source: 'INSUFFICIENT_DATA',
        confidence: 'INSUFFICIENT'
      });
      expect(res2.level).toBe('INSUFFICIENT');
    });

    it('returns INSUFFICIENT when sampleSize < 5', () => {
      const res = RevenueLeakEngine.calculateConfidence({
        source: 'HISTORICAL_BUSINESS_DATA',
        sourceId: 'src_1',
        confidence: 'HIGH',
        sampleSize: 4
      });
      expect(res.level).toBe('INSUFFICIENT');
    });

    it('returns LOW when source is SECTOR_BASELINE even if sample size is high', () => {
      const res = RevenueLeakEngine.calculateConfidence({
        source: 'SECTOR_BASELINE',
        sourceId: 'sector_benchmark',
        confidence: 'LOW',
        sampleSize: 500
      });
      expect(res.level).toBe('LOW');
    });

    it('returns MEDIUM when source is BUSINESS_CONFIGURED with sampleSize >= 10', () => {
      const res = RevenueLeakEngine.calculateConfidence({
        source: 'BUSINESS_CONFIGURED',
        sourceId: 'config_1',
        confidence: 'MEDIUM',
        sampleSize: 15
      });
      expect(res.level).toBe('MEDIUM');
    });

    it('returns LOW when source is BUSINESS_CONFIGURED with sampleSize < 10', () => {
      const res = RevenueLeakEngine.calculateConfidence({
        source: 'BUSINESS_CONFIGURED',
        sourceId: 'config_1',
        confidence: 'LOW',
        sampleSize: 7
      });
      expect(res.level).toBe('LOW');
    });

    it('denies HIGH confidence if timeRange is missing for historical business data', () => {
      const res = RevenueLeakEngine.calculateConfidence(
        {
          source: 'HISTORICAL_BUSINESS_DATA',
          sourceId: 'src_test',
          confidence: 'HIGH',
          sampleSize: 50
        },
        50,
        null,
        '2026-03-01T12:00:00Z'
      );
      expect(res.level).toBe('MEDIUM');
      expect(res.level).not.toBe('HIGH');
    });

    it('denies HIGH confidence if evaluationTimestamp is missing', () => {
      const res = RevenueLeakEngine.calculateConfidence(
        {
          source: 'HISTORICAL_BUSINESS_DATA',
          sourceId: 'src_test',
          confidence: 'HIGH',
          sampleSize: 50,
          timeRange: { start: '2026-02-01T00:00:00Z', end: '2026-02-28T23:59:59Z' }
        },
        50,
        { start: '2026-02-01T00:00:00Z', end: '2026-02-28T23:59:59Z' },
        null
      );
      expect(res.level).toBe('MEDIUM');
      expect(res.level).not.toBe('HIGH');
    });

    it('denies HIGH confidence if sampleSize < 20', () => {
      const res = RevenueLeakEngine.calculateConfidence(
        {
          source: 'HISTORICAL_BUSINESS_DATA',
          sourceId: 'src_test',
          confidence: 'HIGH',
          sampleSize: 19,
          timeRange: { start: '2026-02-25T00:00:00Z', end: '2026-02-28T00:00:00Z' }
        },
        19,
        { start: '2026-02-25T00:00:00Z', end: '2026-02-28T00:00:00Z' },
        '2026-03-01T00:00:00Z'
      );
      expect(res.level).toBe('MEDIUM');
      expect(res.level).not.toBe('HIGH');
    });

    it('returns INSUFFICIENT if evidence time range is in the future relative to evaluationTimestamp', () => {
      const res = RevenueLeakEngine.calculateConfidence(
        {
          source: 'HISTORICAL_BUSINESS_DATA',
          sourceId: 'src_test',
          confidence: 'HIGH',
          sampleSize: 30,
          timeRange: { start: '2026-03-01T00:00:00Z', end: '2026-03-05T00:00:00Z' }
        },
        30,
        { start: '2026-03-01T00:00:00Z', end: '2026-03-05T00:00:00Z' },
        '2026-03-02T00:00:00Z'
      );
      expect(res.level).toBe('INSUFFICIENT');
    });

    it('denies HIGH confidence if evidence is older than 7 days relative to evaluationTimestamp', () => {
      const res = RevenueLeakEngine.calculateConfidence(
        {
          source: 'HISTORICAL_BUSINESS_DATA',
          sourceId: 'src_test',
          confidence: 'HIGH',
          sampleSize: 50,
          timeRange: { start: '2026-01-01T00:00:00Z', end: '2026-01-10T00:00:00Z' }
        },
        50,
        { start: '2026-01-01T00:00:00Z', end: '2026-01-10T00:00:00Z' },
        '2026-02-01T00:00:00Z'
      );
      expect(res.level).toBe('MEDIUM');
      expect(res.level).not.toBe('HIGH');
    });

    it('denies HIGH confidence if sourceId is missing or empty', () => {
      const res = RevenueLeakEngine.calculateConfidence(
        {
          source: 'HISTORICAL_BUSINESS_DATA',
          sourceId: '',
          confidence: 'HIGH',
          sampleSize: 50,
          timeRange: { start: '2026-02-25T00:00:00Z', end: '2026-02-28T00:00:00Z' }
        },
        50,
        { start: '2026-02-25T00:00:00Z', end: '2026-02-28T00:00:00Z' },
        '2026-03-01T00:00:00Z'
      );
      expect(res.level).toBe('INSUFFICIENT');
    });

    it('grants HIGH confidence only when all strict conditions are fulfilled', () => {
      const res = RevenueLeakEngine.calculateConfidence(
        {
          source: 'HISTORICAL_BUSINESS_DATA',
          sourceId: 'verified_crm_ledger_1',
          confidence: 'HIGH',
          sampleSize: 50,
          timeRange: { start: '2026-02-25T00:00:00Z', end: '2026-02-28T00:00:00Z' }
        },
        50,
        { start: '2026-02-25T00:00:00Z', end: '2026-02-28T00:00:00Z' },
        '2026-03-01T00:00:00Z'
      );
      expect(res.level).toBe('HIGH');
    });
  });

  describe('3. Multi-Input Weakest-Link Confidence Aggregation', () => {
    it('aggregates confidences by selecting the weakest link', () => {
      expect(RevenueLeakEngine.aggregateConfidence([])).toBe('INSUFFICIENT');
      expect(RevenueLeakEngine.aggregateConfidence(['HIGH', 'INSUFFICIENT'])).toBe('INSUFFICIENT');
      expect(RevenueLeakEngine.aggregateConfidence(['HIGH', 'LOW'])).toBe('LOW');
      expect(RevenueLeakEngine.aggregateConfidence(['HIGH', 'MEDIUM'])).toBe('MEDIUM');
      expect(RevenueLeakEngine.aggregateConfidence(['HIGH', 'HIGH', 'HIGH'])).toBe('HIGH');
      expect(RevenueLeakEngine.aggregateConfidence(['MEDIUM', 'MEDIUM'])).toBe('MEDIUM');
    });
  });

  describe('4. Deterministic Impact Status Authority (determineImpactStatus)', () => {
    it('returns INSUFFICIENT_DATA when isDataInsufficient is true', () => {
      const status = RevenueLeakEngine.determineImpactStatus(true, [
        { source: 'HISTORICAL_BUSINESS_DATA', sourceId: 'src_1', confidence: 'HIGH', sampleSize: 30, timeRange: { start: '2026-02-01T00:00:00Z', end: '2026-02-10T00:00:00Z' } }
      ]);
      expect(status).toBe('INSUFFICIENT_DATA');
    });

    it('returns INSUFFICIENT_DATA when provenances list is empty or any provenance is UNAVAILABLE or missing sourceId', () => {
      expect(RevenueLeakEngine.determineImpactStatus(false, [])).toBe('INSUFFICIENT_DATA');

      expect(RevenueLeakEngine.determineImpactStatus(false, [
        { source: 'UNAVAILABLE', confidence: 'INSUFFICIENT' }
      ])).toBe('INSUFFICIENT_DATA');

      expect(RevenueLeakEngine.determineImpactStatus(false, [
        { source: 'HISTORICAL_BUSINESS_DATA', sourceId: '', confidence: 'HIGH', sampleSize: 20 }
      ])).toBe('INSUFFICIENT_DATA');
    });

    it('returns VERIFIED only when all provenances satisfy direct historical verification with sampleSize >= 5 and valid timeRange', () => {
      const status = RevenueLeakEngine.determineImpactStatus(false, [
        {
          source: 'HISTORICAL_BUSINESS_DATA',
          sourceId: 'crm_ledger_1',
          confidence: 'HIGH',
          sampleSize: 25,
          timeRange: { start: '2026-02-01T00:00:00Z', end: '2026-02-28T00:00:00Z' }
        },
        {
          source: 'PERSISTED_BUSINESS_METRIC',
          sourceId: 'twin_metric_1',
          confidence: 'HIGH',
          sampleSize: 30,
          timeRange: { start: '2026-02-01T00:00:00Z', end: '2026-02-28T00:00:00Z' }
        }
      ]);
      expect(status).toBe('VERIFIED');
    });

    it('returns ESTIMATED when all provenances are valid but at least one is BUSINESS_CONFIGURED or SECTOR_BASELINE', () => {
      const status = RevenueLeakEngine.determineImpactStatus(false, [
        {
          source: 'HISTORICAL_BUSINESS_DATA',
          sourceId: 'crm_ledger_1',
          confidence: 'HIGH',
          sampleSize: 25,
          timeRange: { start: '2026-02-01T00:00:00Z', end: '2026-02-28T00:00:00Z' }
        },
        {
          source: 'BUSINESS_CONFIGURED',
          sourceId: 'config_conversion_rate',
          confidence: 'MEDIUM',
          sampleSize: 15
        }
      ]);
      expect(status).toBe('ESTIMATED');
    });
  });

  describe('5. Canonical Money & Strict Value Minor Handling', () => {
    it('validates canonical money assumption requiring safe non-negative integer valueMinor and matching currency', () => {
      const valid = RevenueLeakEngine.isMoneyAssumptionValid(
        {
          valueMinor: 500000,
          currency: 'TRY',
          provenance: { source: 'HISTORICAL_BUSINESS_DATA', sourceId: 'crm_1', confidence: 'MEDIUM', sampleSize: 15 }
        },
        'TRY'
      );
      expect(valid).toBe(true);

      const mismatchCurrency = RevenueLeakEngine.isMoneyAssumptionValid(
        {
          valueMinor: 500000,
          currency: 'USD',
          provenance: { source: 'HISTORICAL_BUSINESS_DATA', sourceId: 'crm_1', confidence: 'MEDIUM', sampleSize: 15 }
        },
        'TRY'
      );
      expect(mismatchCurrency).toBe(false);

      const invalidMinor = RevenueLeakEngine.isMoneyAssumptionValid(
        {
          valueMinor: -100,
          currency: 'TRY',
          provenance: { source: 'HISTORICAL_BUSINESS_DATA', sourceId: 'crm_1', confidence: 'MEDIUM', sampleSize: 15 }
        },
        'TRY'
      );
      expect(invalidMinor).toBe(false);
    });

    it('getMoneyMinor returns valueMinor directly without multiplying by 100', () => {
      const minor = RevenueLeakEngine.getMoneyMinor({
        valueMinor: 450000,
        currency: 'EUR',
        provenance: { source: 'HISTORICAL_BUSINESS_DATA', sourceId: 'src_1', confidence: 'MEDIUM' }
      });
      expect(minor).toBe(450000);
    });
  });

  describe('6. Zero Synthetic Source ID Enforcement across Rules A-H', () => {
    it('Rule A: preserves exact sourceId from input metrics and creates no synthetic leads:<businessId>', () => {
      const leads: LeadRow[] = [
        {
          id: 'lead_001',
          business_id: 'biz_alpha',
          organization_id: 'org_1',
          market: 'GLOBAL',
          pseudonymous_customer_id: 'cust_001',
          company_name: 'Alpha Corp',
          funnel_stage: 'captured',
          status: 'open',
          intent_score: 92,
          response_latency_minutes: 45,
          estimated_deal_value_minor: 200000,
          leak_risk_factor: 'high_decay',
          created_at: '2026-02-26T10:00:00Z',
        }
      ];

      const findings = RevenueLeakEngine.evaluateAll({
        businessId: 'biz_alpha',
        leads,
        appointments: [],
        calls: [],
        currency: 'USD',
        evaluationTimestamp: '2026-03-01T00:00:00Z',
        conversionRateAssumption: {
          value: 0.30,
          provenance: {
            source: 'HISTORICAL_BUSINESS_DATA',
            sourceId: 'canonical_crm_conversion_metric',
            confidence: 'HIGH',
            sampleSize: 45,
            timeRange: { start: '2026-02-01T00:00:00Z', end: '2026-02-28T00:00:00Z' }
          }
        },
        avgDealValueAssumption: {
          valueMinor: 200000,
          currency: 'USD',
          provenance: {
            source: 'HISTORICAL_BUSINESS_DATA',
            sourceId: 'canonical_crm_deal_value_metric',
            confidence: 'HIGH',
            sampleSize: 45,
            timeRange: { start: '2026-02-01T00:00:00Z', end: '2026-02-28T00:00:00Z' }
          }
        }
      });

      const findingA = findings.find(f => f.ruleId === 'RULE_MISSED_HIGH_INTENT_LEAD');
      expect(findingA).toBeDefined();
      expect(findingA?.dataSources).not.toContain('leads:biz_alpha');
      expect(findingA?.dataSources).toContain('LEAD_ROWS');
      expect(findingA?.dataSources).toContain('BUSINESS_METRIC:canonical_crm_conversion_metric');
      expect(findingA?.dataSources).toContain('BUSINESS_METRIC:canonical_crm_deal_value_metric');
      expect(findingA?.impactStatus).toBe('VERIFIED');
      expect(findingA?.confidenceLevel).toBe('HIGH');
    });

    it('Rule D: preserves exact callHistoryCoverage sourceId and metric sourceId', () => {
      const calls: CallMetadataEvent[] = [
        {
          id: 'call_001',
          organizationId: 'org_1',
          businessId: 'biz_alpha',
          pseudonymousCallerId: 'caller_001',
          direction: 'inbound',
          status: 'missed',
          waitDurationSeconds: 45,
          callDurationSeconds: 0,
          startedAt: '2026-02-25T14:00:00Z',
          endedAt: '2026-02-25T14:01:00Z',
          source: 'telephony_gateway'
        }
      ];

      const findings = RevenueLeakEngine.evaluateAll({
        businessId: 'biz_alpha',
        leads: [],
        appointments: [],
        calls,
        callHistoryCoverage: {
          businessId: 'biz_alpha',
          coveredFrom: '2026-02-20T00:00:00Z',
          coveredTo: '2026-02-28T00:00:00Z',
          isComplete: true,
          sourceId: 'asterisk_pbx_cdr_ledger'
        },
        currency: 'USD',
        evaluationTimestamp: '2026-03-01T00:00:00Z',
        callConversionAssumption: {
          value: 0.20,
          provenance: {
            source: 'BUSINESS_CONFIGURED',
            sourceId: 'configured_call_conversion',
            confidence: 'MEDIUM',
            sampleSize: 15
          }
        },
        avgDealValueAssumption: {
          valueMinor: 150000,
          currency: 'USD',
          provenance: {
            source: 'BUSINESS_CONFIGURED',
            sourceId: 'configured_deal_value',
            confidence: 'MEDIUM',
            sampleSize: 15
          }
        }
      });

      const findingD = findings.find(f => f.ruleId === 'RULE_MISSED_INBOUND_CALL');
      expect(findingD).toBeDefined();
      expect(findingD?.dataSources).not.toContain('call_coverage:biz_alpha');
      expect(findingD?.dataSources).toContain('CALL_HISTORY_COVERAGE:asterisk_pbx_cdr_ledger');
      expect(findingD?.dataSources).toContain('BUSINESS_CONFIGURATION:configured_call_conversion');
      expect(findingD?.impactStatus).toBe('ESTIMATED');
      expect(findingD?.confidenceLevel).toBe('MEDIUM');
    });
  });

  describe('7. Capacity Business Isolation (Fail-Closed)', () => {
    it('fails closed and ignores capacity payload when capacity.businessId does not match evaluation businessId', () => {
      const lowest: any = {
        windowLabel: 'Tuesday Afternoon',
        daypart: 'afternoon_dip',
        totalCapacityMinutes: 480,
        bookedCapacityMinutes: 120,
        utilizationPct: 25,
        unfilledCapacityMinutes: 240,
        potentialRevenueLossMinor: 300000,
        currency: 'USD'
      };
      const peak: any = {
        windowLabel: 'Saturday Morning',
        daypart: 'morning',
        totalCapacityMinutes: 480,
        bookedCapacityMinutes: 456,
        utilizationPct: 95,
        unfilledCapacityMinutes: 20,
        potentialRevenueLossMinor: 0,
        currency: 'USD'
      };
      const capacity: CapacityUtilization = {
        businessId: 'biz_other', // Mismatched businessId
        industry: 'salon_clinic',
        calculatedAt: '2026-02-28T12:00:00Z',
        overallUtilizationPct: 35,
        lowestWindow: lowest,
        peakWindow: peak,
        snapshotsByWindow: [lowest, peak],
        recommendedOffPeakIncentive: 'Offer 20% off Tuesday appointments',
        source: 'capacity_analyzer_v1',
        provenance: {
          source: 'HISTORICAL_BUSINESS_DATA',
          sourceId: 'biz_other_capacity_log',
          confidence: 'HIGH',
          sampleSize: 50,
          timeRange: { start: '2026-02-01T00:00:00Z', end: '2026-02-28T00:00:00Z' }
        }
      };

      const findings = RevenueLeakEngine.evaluateAll({
        businessId: 'biz_target',
        leads: [],
        appointments: [],
        calls: [],
        capacity,
        currency: 'USD',
        evaluationTimestamp: '2026-03-01T00:00:00Z'
      });

      const capacityFinding = findings.find(f => f.ruleId === 'RULE_OFF_PEAK_UNUSED_CAPACITY');
      expect(capacityFinding).toBeUndefined();
    });

    it('correctly evaluates capacity when capacity.businessId matches evaluation businessId', () => {
      const lowest: any = {
        windowLabel: 'Tuesday Afternoon',
        daypart: 'afternoon_dip',
        totalCapacityMinutes: 480,
        bookedCapacityMinutes: 120,
        utilizationPct: 25,
        unfilledCapacityMinutes: 240,
        potentialRevenueLossMinor: 300000,
        currency: 'USD'
      };
      const peak: any = {
        windowLabel: 'Saturday Morning',
        daypart: 'morning',
        totalCapacityMinutes: 480,
        bookedCapacityMinutes: 456,
        utilizationPct: 95,
        unfilledCapacityMinutes: 20,
        potentialRevenueLossMinor: 0,
        currency: 'USD'
      };
      const capacity: CapacityUtilization = {
        businessId: 'biz_target',
        industry: 'salon_clinic',
        calculatedAt: '2026-02-28T12:00:00Z',
        overallUtilizationPct: 35,
        lowestWindow: lowest,
        peakWindow: peak,
        snapshotsByWindow: [lowest, peak],
        recommendedOffPeakIncentive: 'Offer 20% off Tuesday appointments',
        source: 'capacity_analyzer_v1',
        provenance: {
          source: 'HISTORICAL_BUSINESS_DATA',
          sourceId: 'biz_target_capacity_log',
          confidence: 'HIGH',
          sampleSize: 50,
          timeRange: { start: '2026-02-25T00:00:00Z', end: '2026-02-28T00:00:00Z' }
        }
      };

      const findings = RevenueLeakEngine.evaluateAll({
        businessId: 'biz_target',
        leads: [],
        appointments: [],
        calls: [],
        capacity,
        currency: 'USD',
        evaluationTimestamp: '2026-03-01T00:00:00Z'
      });

      const capacityFinding = findings.find(f => f.ruleId === 'RULE_OFF_PEAK_UNUSED_CAPACITY');
      expect(capacityFinding).toBeDefined();
      expect(capacityFinding?.estimatedImpactMinor).toBe(300000);
      expect(capacityFinding?.impactStatus).toBe('VERIFIED');
      expect(capacityFinding?.confidenceLevel).toBe('HIGH');
      expect(capacityFinding?.dataSources).toContain('CAPACITY_UTILIZATION:capacity_analyzer_v1');
    });
  });

  describe('8. Fail-Closed Handling for Currency Mismatches and Missing Provenance', () => {
    it('fails closed to INSUFFICIENT_DATA and null impact for appointment cancellations with currency mismatch', () => {
      const appointments: Appointment[] = [
        {
          id: 'apt_eur',
          organizationId: 'org_1',
          businessId: 'biz_try',
          customerPseudonymId: 'cust_1',
          serviceName: 'Hair Styling',
          serviceCategory: 'Salon',
          resourceStaffId: 'staff_1',
          resourceStaffName: 'Stylist A',
          scheduledStart: '2026-02-20T10:00:00Z',
          scheduledEnd: '2026-02-20T11:00:00Z',
          durationMinutes: 60,
          expectedValueMinor: 5000,
          currency: 'EUR', // Mismatch vs evaluation currency 'TRY'
          status: 'no_show',
          source: 'web_booking_widget',
          rowVersion: 0,
          createdAt: '2026-02-20T09:00:00Z',
          updatedAt: '2026-02-20T09:00:00Z',
        }
      ];

      const findings = RevenueLeakEngine.evaluateAll({
        businessId: 'biz_try',
        leads: [],
        appointments,
        appointmentHistoryCoverage: {
          businessId: 'biz_try',
          coveredFrom: '2026-02-19T00:00:00Z',
          coveredTo: '2026-02-22T00:00:00Z',
          isComplete: true,
          sourceId: 'salon_booking_db'
        },
        calls: [],
        currency: 'TRY',
        evaluationTimestamp: '2026-02-23T00:00:00Z',
        noShowRecoveryAssumption: {
          value: 0.35,
          provenance: { source: 'HISTORICAL_BUSINESS_DATA', sourceId: 'hist_noshow', confidence: 'MEDIUM', sampleSize: 15 }
        }
      });

      const noShowFinding = findings.find(f => f.ruleId === 'RULE_APPOINTMENT_NO_SHOW_GAP');
      expect(noShowFinding).toBeDefined();
      expect(noShowFinding?.isDataInsufficient).toBe(true);
      expect(noShowFinding?.estimatedImpactMinor).toBeNull();
      expect(noShowFinding?.impactStatus).toBe('INSUFFICIENT_DATA');
      expect(noShowFinding?.observedFacts.some(f => f.includes('Total slot value forfeited'))).toBe(false);
    });

    it('fails closed to INSUFFICIENT_DATA and null impact for aging inventory with missing item provenance', () => {
      const inventoryItems: InventoryItemTelemetry[] = [
        {
          id: 'inv_1',
          businessId: 'biz_1',
          currency: 'USD',
          sku: 'SKU-001',
          name: 'Aging Widget',
          holdingDays: 60,
          unitCostMinor: 2500,
          quantityOnHand: 10,
          dailyCarryingBps: 15,
          provenance: {
            source: 'UNAVAILABLE',
            confidence: 'INSUFFICIENT'
          }
        }
      ];

      const findings = RevenueLeakEngine.evaluateAll({
        businessId: 'biz_1',
        leads: [],
        appointments: [],
        calls: [],
        inventoryItems,
        currency: 'USD',
        evaluationTimestamp: '2026-03-01T00:00:00Z'
      });

      const inventoryFinding = findings.find(f => f.ruleId === 'RULE_AGING_INVENTORY_HOLDING');
      expect(inventoryFinding).toBeDefined();
      expect(inventoryFinding?.isDataInsufficient).toBe(true);
      expect(inventoryFinding?.estimatedImpactMinor).toBeNull();
      expect(inventoryFinding?.impactStatus).toBe('INSUFFICIENT_DATA');
      expect(inventoryFinding?.observedFacts.some(f => f.includes('Total locked capital'))).toBe(false);
    });
  });

  describe('9. Pure Deterministic Evaluation & Explicit Clock Authority', () => {
    const deterministicInput = {
      businessId: 'biz_det_01',
      leads: [
        {
          id: 'lead_det_1',
          organization_id: 'org_1',
          business_id: 'biz_det_01',
          market: 'TR' as const,
          pseudonymous_customer_id: 'cust_det_1',
          company_name: 'Det Corp',
          funnel_stage: 'captured' as const,
          status: 'open' as const,
          intent_score: 95,
          response_latency_minutes: 60,
          estimated_deal_value_minor: 500000,
          leak_risk_factor: 'high_decay' as const,
          created_at: '2026-03-01T10:00:00Z',
        }
      ],
      appointments: [],
      calls: [],
      currency: 'USD',
      evaluationTimestamp: '2026-03-01T12:00:00Z',
      conversionRateAssumption: {
        value: 0.25,
        provenance: {
          source: 'HISTORICAL_BUSINESS_DATA' as const,
          sourceId: 'crm_conv_det',
          confidence: 'HIGH' as const,
          sampleSize: 30,
          timeRange: { start: '2026-02-25T00:00:00Z', end: '2026-02-28T23:59:59Z' }
        }
      },
      avgDealValueAssumption: {
        valueMinor: 500000,
        currency: 'USD' as const,
        provenance: {
          source: 'HISTORICAL_BUSINESS_DATA' as const,
          sourceId: 'crm_deal_det',
          confidence: 'HIGH' as const,
          sampleSize: 30,
          timeRange: { start: '2026-02-25T00:00:00Z', end: '2026-02-28T23:59:59Z' }
        }
      }
    };

    it('evaluateAll is purely deterministic: identical input and timestamp yields deep-equal output', () => {
      const run1 = RevenueLeakEngine.evaluateAll(deterministicInput);
      const run2 = RevenueLeakEngine.evaluateAll(deterministicInput);

      expect(run1).toEqual(run2);
      expect(run1.length).toBeGreaterThan(0);
      expect(run1[0].estimatedImpactMinor).toBe(run2[0].estimatedImpactMinor);
    });

    it('evaluateAll time-shift: different explicit timestamps shift freshness calculation deterministically', () => {
      const runFresh = RevenueLeakEngine.evaluateAll({
        ...deterministicInput,
        evaluationTimestamp: '2026-03-01T12:00:00Z' // 1 day after rangeEnd (fresh <= 7d) -> HIGH
      });

      const runStale = RevenueLeakEngine.evaluateAll({
        ...deterministicInput,
        evaluationTimestamp: '2026-03-20T12:00:00Z' // 20 days after rangeEnd (> 7d) -> MEDIUM
      });

      const freshFinding = runFresh.find(f => f.ruleId === 'RULE_MISSED_HIGH_INTENT_LEAD');
      const staleFinding = runStale.find(f => f.ruleId === 'RULE_MISSED_HIGH_INTENT_LEAD');

      expect(freshFinding?.confidenceLevel).toBe('HIGH');
      expect(staleFinding?.confidenceLevel).toBe('MEDIUM');
    });

    it('fails closed when evaluationTimestamp is missing: no elapsed-window findings produced', () => {
      const pastDate = '2026-02-20T10:00:00Z';
      const findings = RevenueLeakEngine.evaluateAll({
        businessId: 'biz_det_01',
        leads: [
          {
            id: 'lead_prop_1',
            organization_id: 'org_1',
            business_id: 'biz_det_01',
            market: 'TR' as const,
            pseudonymous_customer_id: 'cust_1',
            company_name: 'Prop Corp',
            funnel_stage: 'proposal_sent',
            status: 'open',
            intent_score: 80,
            response_latency_minutes: 10,
            estimated_deal_value_minor: 100000,
            leak_risk_factor: 'high_decay',
            created_at: pastDate,
          }
        ],
        leadActivityEvidence: [
          {
            businessId: 'biz_det_01',
            leadId: 'lead_prop_1',
            proposalSentAt: pastDate,
            lastFollowUpAt: null,
            lastActivityAt: null,
            isComplete: true,
            coverageStart: '2026-02-15T00:00:00Z',
            coverageEnd: '2026-03-01T00:00:00Z',
            source: 'crm_sync'
          }
        ],
        appointments: [],
        calls: [],
        currency: 'USD',
        // evaluationTimestamp omitted intentionally
        evaluationTimestamp: undefined as any
      });

      const ruleC = findings.find(f => f.ruleId === 'RULE_FOLLOW_UP_GAP');
      expect(ruleC).toBeUndefined();
    });
  });

  describe('10. Rule Regression & Baseline Fallback Authority', () => {
    it('Rule B: RULE_SLOW_RESPONSE_LATENCY correctly combines conversionRate, responseDecayFactor, and avgDealValue', () => {
      const leads: LeadRow[] = [
        {
          id: 'lead_slow_1',
          business_id: 'biz_b',
          organization_id: 'org_1',
          market: 'TR' as const,
          pseudonymous_customer_id: 'cust_b_1',
          company_name: 'Slow Corp',
          funnel_stage: 'captured',
          status: 'open',
          intent_score: 60, // Standard intent (<70, eligible for Rule B)
          response_latency_minutes: 120, // > maxSlaMinutes (15)
          estimated_deal_value_minor: 100000,
          leak_risk_factor: 'high_decay',
          created_at: '2026-03-01T08:00:00Z',
        }
      ];

      const findings = RevenueLeakEngine.evaluateAll({
        businessId: 'biz_b',
        leads,
        appointments: [],
        calls: [],
        currency: 'USD',
        evaluationTimestamp: '2026-03-01T12:00:00Z',
        conversionRateAssumption: {
          value: 0.30,
          provenance: {
            source: 'HISTORICAL_BUSINESS_DATA',
            sourceId: 'crm_conversion_metric_b',
            confidence: 'HIGH',
            sampleSize: 40,
            timeRange: { start: '2026-02-25T00:00:00Z', end: '2026-02-28T23:59:59Z' }
          }
        },
        responseDecayFactor: {
          value: 0.15,
          provenance: {
            source: 'HISTORICAL_BUSINESS_DATA',
            sourceId: 'crm_decay_factor_b',
            confidence: 'HIGH',
            sampleSize: 40,
            timeRange: { start: '2026-02-25T00:00:00Z', end: '2026-02-28T23:59:59Z' }
          }
        },
        avgDealValueAssumption: {
          valueMinor: 200000,
          currency: 'USD',
          provenance: {
            source: 'HISTORICAL_BUSINESS_DATA',
            sourceId: 'crm_deal_val_b',
            confidence: 'HIGH',
            sampleSize: 40,
            timeRange: { start: '2026-02-25T00:00:00Z', end: '2026-02-28T23:59:59Z' }
          }
        }
      });

      const findingB = findings.find(f => f.ruleId === 'RULE_SLOW_RESPONSE_LATENCY');
      expect(findingB).toBeDefined();
      // Loss = 1 lead * 200,000 minor * 30% baseline * 15% decay = 9,000 minor ($90.00)
      expect(findingB?.estimatedImpactMinor).toBe(9000);
      expect(findingB?.impactStatus).toBe('VERIFIED');
      expect(findingB?.confidenceLevel).toBe('HIGH');
      expect(findingB?.dataSources).toContain('BUSINESS_METRIC:crm_conversion_metric_b');
      expect(findingB?.dataSources).toContain('BUSINESS_METRIC:crm_decay_factor_b');
      expect(findingB?.dataSources).toContain('BUSINESS_METRIC:crm_deal_val_b');
    });

    it('Rule C: fallback authority correctly inherits conversionRateAssumption when proposalWinRateBaseline is omitted', () => {
      const leads: LeadRow[] = [
        {
          id: 'lead_c_1',
          business_id: 'biz_c',
          organization_id: 'org_1',
          market: 'TR' as const,
          pseudonymous_customer_id: 'cust_c_1',
          company_name: 'Proposal Corp',
          funnel_stage: 'proposal_sent',
          status: 'open',
          intent_score: 85,
          response_latency_minutes: 5,
          estimated_deal_value_minor: 400000,
          leak_risk_factor: 'high_decay',
          created_at: '2026-02-20T10:00:00Z',
        }
      ];

      const findings = RevenueLeakEngine.evaluateAll({
        businessId: 'biz_c',
        leads,
        leadActivityEvidence: [
          {
            businessId: 'biz_c',
            leadId: 'lead_c_1',
            proposalSentAt: '2026-02-20T12:00:00Z',
            lastFollowUpAt: null,
            lastActivityAt: null,
            isComplete: true,
            coverageStart: '2026-02-15T00:00:00Z',
            coverageEnd: '2026-02-28T00:00:00Z',
            source: 'crm_proposal_log'
          }
        ],
        appointments: [],
        calls: [],
        currency: 'USD',
        evaluationTimestamp: '2026-03-01T00:00:00Z',
        // proposalWinRateBaseline omitted -> fallback to conversionRateAssumption
        conversionRateAssumption: {
          value: 0.35,
          provenance: {
            source: 'HISTORICAL_BUSINESS_DATA',
            sourceId: 'crm_fallback_conv_metric',
            confidence: 'HIGH',
            sampleSize: 35,
            timeRange: { start: '2026-02-20T00:00:00Z', end: '2026-02-28T00:00:00Z' }
          }
        }
      });

      const findingC = findings.find(f => f.ruleId === 'RULE_FOLLOW_UP_GAP');
      expect(findingC).toBeDefined();
      expect(findingC?.estimatedImpactMinor).toBe(140000); // 400,000 * 0.35 = 140,000 minor ($1,400.00)
      expect(findingC?.impactStatus).toBe('VERIFIED');
      expect(findingC?.dataSources).toContain('BUSINESS_METRIC:crm_fallback_conv_metric');
    });

    it('Rule D: fallback authority correctly inherits avgDealValueAssumption when callAverageDealValueAssumption is omitted', () => {
      const calls: CallMetadataEvent[] = [
        {
          id: 'call_d_1',
          organizationId: 'org_1',
          businessId: 'biz_d',
          pseudonymousCallerId: 'caller_d_1',
          direction: 'inbound',
          status: 'missed',
          waitDurationSeconds: 30,
          callDurationSeconds: 0,
          startedAt: '2026-02-25T10:00:00Z',
          endedAt: '2026-02-25T10:01:00Z',
          source: 'pbx_gateway'
        }
      ];

      const findings = RevenueLeakEngine.evaluateAll({
        businessId: 'biz_d',
        leads: [],
        appointments: [],
        calls,
        callHistoryCoverage: {
          businessId: 'biz_d',
          coveredFrom: '2026-02-20T00:00:00Z',
          coveredTo: '2026-02-28T00:00:00Z',
          isComplete: true,
          sourceId: 'pbx_coverage_log'
        },
        currency: 'USD',
        evaluationTimestamp: '2026-03-01T00:00:00Z',
        callConversionAssumption: {
          value: 0.20,
          provenance: {
            source: 'HISTORICAL_BUSINESS_DATA',
            sourceId: 'pbx_call_conv_metric',
            confidence: 'HIGH',
            sampleSize: 25,
            timeRange: { start: '2026-02-20T00:00:00Z', end: '2026-02-28T00:00:00Z' }
          }
        },
        // callAverageDealValueAssumption omitted -> fallback to avgDealValueAssumption
        avgDealValueAssumption: {
          valueMinor: 300000,
          currency: 'USD',
          provenance: {
            source: 'HISTORICAL_BUSINESS_DATA',
            sourceId: 'crm_fallback_deal_metric',
            confidence: 'HIGH',
            sampleSize: 30,
            timeRange: { start: '2026-02-20T00:00:00Z', end: '2026-02-28T00:00:00Z' }
          }
        }
      });

      const findingD = findings.find(f => f.ruleId === 'RULE_MISSED_INBOUND_CALL');
      expect(findingD).toBeDefined();
      // 1 call * 0.20 conv * 300,000 minor = 60,000 minor ($600.00)
      expect(findingD?.estimatedImpactMinor).toBe(60000);
      expect(findingD?.impactStatus).toBe('VERIFIED');
      expect(findingD?.dataSources).toContain('BUSINESS_METRIC:crm_fallback_deal_metric');
    });

    it('Rule G: RULE_FUNNEL_STAGE_DROP correctly computes drop loss against qualificationRateBaseline', () => {
      // 20 leads, 4 qualified (funnel_stage != 'captured') -> actual qual rate = 20%
      // baseline qual rate = 60%, drop = 40% (exceeds 20% drop threshold, sample >= 15)
      const leads: LeadRow[] = Array.from({ length: 20 }, (_, i) => ({
        id: `lead_g_${i}`,
        business_id: 'biz_g',
        organization_id: 'org_1',
        market: 'TR' as const,
        pseudonymous_customer_id: `cust_g_${i}`,
        company_name: `Funnel Corp ${i}`,
        funnel_stage: i < 4 ? ('qualifying' as const) : ('captured' as const),
        status: 'open' as const,
        intent_score: 75,
        response_latency_minutes: 10,
        estimated_deal_value_minor: 100000,
        leak_risk_factor: 'high_decay' as const,
        created_at: '2026-02-25T10:00:00Z',
      }));

      const findings = RevenueLeakEngine.evaluateAll({
        businessId: 'biz_g',
        leads,
        appointments: [],
        calls: [],
        currency: 'USD',
        evaluationTimestamp: '2026-03-01T00:00:00Z',
        qualificationRateBaseline: {
          value: 0.60,
          provenance: {
            source: 'HISTORICAL_BUSINESS_DATA',
            sourceId: 'crm_qual_baseline',
            confidence: 'HIGH',
            sampleSize: 50,
            timeRange: { start: '2026-02-01T00:00:00Z', end: '2026-02-28T00:00:00Z' }
          }
        },
        conversionRateAssumption: {
          value: 0.25,
          provenance: {
            source: 'HISTORICAL_BUSINESS_DATA',
            sourceId: 'crm_conv_baseline',
            confidence: 'HIGH',
            sampleSize: 50,
            timeRange: { start: '2026-02-01T00:00:00Z', end: '2026-02-28T00:00:00Z' }
          }
        },
        avgDealValueAssumption: {
          valueMinor: 200000,
          currency: 'USD',
          provenance: {
            source: 'HISTORICAL_BUSINESS_DATA',
            sourceId: 'crm_deal_baseline',
            confidence: 'HIGH',
            sampleSize: 50,
            timeRange: { start: '2026-02-01T00:00:00Z', end: '2026-02-28T00:00:00Z' }
          }
        }
      });

      const findingG = findings.find(f => f.ruleId === 'RULE_FUNNEL_STAGE_DROP');
      expect(findingG).toBeDefined();
      // Drop = (0.60 - 0.20) = 0.40; Loss = 0.40 * 20 leads * 200,000 minor * 0.25 conv = 400,000 minor ($4,000.00)
      expect(findingG?.estimatedImpactMinor).toBe(400000);
      expect(findingG?.impactStatus).toBe('VERIFIED');
      expect(findingG?.confidenceLevel).toBe('HIGH');
      expect(findingG?.dataSources).toContain('BUSINESS_METRIC:crm_qual_baseline');
    });
  });

  describe('11. Full Rule A-H Matrix Validation', () => {
    it('executes all eight rule builders simultaneously without interference or metric collisions', () => {
      const leads: LeadRow[] = [
        // For Rule A & G
        {
          id: 'lead_m_1',
          business_id: 'biz_matrix',
          organization_id: 'org_1',
          market: 'TR' as const,
          pseudonymous_customer_id: 'cust_m_1',
          company_name: 'Matrix Alpha',
          funnel_stage: 'captured',
          status: 'open',
          intent_score: 90, // High intent (>70) -> Rule A
          response_latency_minutes: 45, // > maxSlaMinutes
          estimated_deal_value_minor: 500000,
          leak_risk_factor: 'high_decay',
          created_at: '2026-02-26T10:00:00Z',
        },
        // For Rule B
        {
          id: 'lead_m_2',
          business_id: 'biz_matrix',
          organization_id: 'org_1',
          market: 'TR' as const,
          pseudonymous_customer_id: 'cust_m_2',
          company_name: 'Matrix Beta',
          funnel_stage: 'captured',
          status: 'open',
          intent_score: 55, // Standard intent (<70) -> Rule B
          response_latency_minutes: 90, // > maxSlaMinutes
          estimated_deal_value_minor: 300000,
          leak_risk_factor: 'high_decay',
          created_at: '2026-02-26T11:00:00Z',
        },
        // For Rule C
        {
          id: 'lead_m_3',
          business_id: 'biz_matrix',
          organization_id: 'org_1',
          market: 'TR' as const,
          pseudonymous_customer_id: 'cust_m_3',
          company_name: 'Matrix Gamma',
          funnel_stage: 'proposal_sent',
          status: 'open',
          intent_score: 80,
          response_latency_minutes: 5,
          estimated_deal_value_minor: 600000,
          leak_risk_factor: 'high_decay',
          created_at: '2026-02-20T10:00:00Z',
        },
        // Additional captured leads for Rule G drop calculation (total = 20 leads, 1 qualified -> 5% vs 70% baseline)
        ...Array.from({ length: 17 }, (_, i) => ({
          id: `lead_m_extra_${i}`,
          business_id: 'biz_matrix',
          organization_id: 'org_1',
          market: 'TR' as const,
          pseudonymous_customer_id: `cust_m_extra_${i}`,
          company_name: `Extra Corp ${i}`,
          funnel_stage: 'captured' as const,
          status: 'open' as const,
          intent_score: 50,
          response_latency_minutes: 5,
          estimated_deal_value_minor: 100000,
          leak_risk_factor: 'high_decay' as const,
          created_at: '2026-02-25T10:00:00Z',
        }))
      ];

      const calls: CallMetadataEvent[] = [
        {
          id: 'call_m_1',
          organizationId: 'org_1',
          businessId: 'biz_matrix',
          pseudonymousCallerId: 'caller_m_1',
          direction: 'inbound',
          status: 'missed',
          waitDurationSeconds: 40,
          callDurationSeconds: 0,
          startedAt: '2026-02-25T12:00:00Z',
          endedAt: '2026-02-25T12:01:00Z',
          source: 'matrix_pbx'
        }
      ];

      const appointments: Appointment[] = [
        {
          id: 'apt_m_1',
          organizationId: 'org_1',
          businessId: 'biz_matrix',
          customerPseudonymId: 'cust_m_apt_1',
          serviceName: 'Executive Suite Consultation',
          serviceCategory: 'Consulting',
          resourceStaffId: 'staff_m_1',
          resourceStaffName: 'Partner M',
          scheduledStart: '2026-02-25T14:00:00Z',
          scheduledEnd: '2026-02-25T15:00:00Z',
          durationMinutes: 60,
          expectedValueMinor: 750000,
          currency: 'USD',
          status: 'no_show',
          source: 'web_booking_widget',
          rowVersion: 0,
          createdAt: '2026-02-24T10:00:00Z',
          updatedAt: '2026-02-24T10:00:00Z',
        }
      ];

      const capacity: CapacityUtilization = {
        businessId: 'biz_matrix',
        industry: 'professional_services',
        calculatedAt: '2026-02-28T12:00:00Z',
        overallUtilizationPct: 40,
        lowestWindow: {
          windowLabel: 'Monday Morning',
          daypart: 'morning',
          totalCapacityMinutes: 480,
          bookedCapacityMinutes: 96,
          utilizationPct: 20,
          unfilledCapacityMinutes: 384,
          potentialRevenueLossMinor: 500000,
          currency: 'USD'
        },
        peakWindow: {
          windowLabel: 'Thursday Afternoon',
          daypart: 'afternoon_dip',
          totalCapacityMinutes: 480,
          bookedCapacityMinutes: 480,
          utilizationPct: 100,
          unfilledCapacityMinutes: 0,
          potentialRevenueLossMinor: 0,
          currency: 'USD'
        },
        snapshotsByWindow: [],
        recommendedOffPeakIncentive: 'Offer preferential retainer rates for Monday morning sessions',
        source: 'matrix_capacity_engine',
        provenance: {
          source: 'HISTORICAL_BUSINESS_DATA',
          sourceId: 'matrix_capacity_ledger',
          confidence: 'HIGH',
          sampleSize: 45,
          timeRange: { start: '2026-02-20T00:00:00Z', end: '2026-02-28T00:00:00Z' }
        }
      };

      const inventoryItems: InventoryItemTelemetry[] = [
        {
          id: 'inv_m_1',
          businessId: 'biz_matrix',
          currency: 'USD',
          sku: 'MAT-SKU-99',
          name: 'High Performance Server Blade',
          holdingDays: 90,
          unitCostMinor: 400000,
          quantityOnHand: 5,
          dailyCarryingBps: 20,
          provenance: {
            source: 'HISTORICAL_BUSINESS_DATA',
            sourceId: 'matrix_inv_ledger',
            confidence: 'HIGH',
            sampleSize: 25,
            timeRange: { start: '2026-02-01T00:00:00Z', end: '2026-02-28T00:00:00Z' }
          }
        }
      ];

      const findings = RevenueLeakEngine.evaluateAll({
        businessId: 'biz_matrix',
        leads,
        leadActivityEvidence: [
          {
            businessId: 'biz_matrix',
            leadId: 'lead_m_3',
            proposalSentAt: '2026-02-20T12:00:00Z',
            lastFollowUpAt: null,
            lastActivityAt: null,
            isComplete: true,
            coverageStart: '2026-02-15T00:00:00Z',
            coverageEnd: '2026-02-28T00:00:00Z',
            source: 'matrix_crm_sync'
          }
        ],
        calls,
        callHistoryCoverage: {
          businessId: 'biz_matrix',
          coveredFrom: '2026-02-20T00:00:00Z',
          coveredTo: '2026-02-28T00:00:00Z',
          isComplete: true,
          sourceId: 'matrix_pbx_coverage'
        },
        appointments,
        appointmentHistoryCoverage: {
          businessId: 'biz_matrix',
          coveredFrom: '2026-02-20T00:00:00Z',
          coveredTo: '2026-02-28T00:00:00Z',
          isComplete: true,
          sourceId: 'matrix_appointment_coverage'
        },
        capacity,
        inventoryItems,
        currency: 'USD',
        evaluationTimestamp: '2026-03-01T00:00:00Z',
        conversionRateAssumption: {
          value: 0.30,
          provenance: {
            source: 'HISTORICAL_BUSINESS_DATA',
            sourceId: 'matrix_conv_metric',
            confidence: 'HIGH',
            sampleSize: 50,
            timeRange: { start: '2026-02-20T00:00:00Z', end: '2026-02-28T00:00:00Z' }
          }
        },
        avgDealValueAssumption: {
          valueMinor: 500000,
          currency: 'USD',
          provenance: {
            source: 'HISTORICAL_BUSINESS_DATA',
            sourceId: 'matrix_deal_metric',
            confidence: 'HIGH',
            sampleSize: 50,
            timeRange: { start: '2026-02-20T00:00:00Z', end: '2026-02-28T00:00:00Z' }
          }
        },
        responseDecayFactor: {
          value: 0.20,
          provenance: {
            source: 'HISTORICAL_BUSINESS_DATA',
            sourceId: 'matrix_decay_metric',
            confidence: 'HIGH',
            sampleSize: 50,
            timeRange: { start: '2026-02-20T00:00:00Z', end: '2026-02-28T00:00:00Z' }
          }
        },
        proposalWinRateBaseline: {
          value: 0.40,
          provenance: {
            source: 'HISTORICAL_BUSINESS_DATA',
            sourceId: 'matrix_proposal_win_metric',
            confidence: 'HIGH',
            sampleSize: 50,
            timeRange: { start: '2026-02-20T00:00:00Z', end: '2026-02-28T00:00:00Z' }
          }
        },
        callConversionAssumption: {
          value: 0.25,
          provenance: {
            source: 'HISTORICAL_BUSINESS_DATA',
            sourceId: 'matrix_call_conv_metric',
            confidence: 'HIGH',
            sampleSize: 50,
            timeRange: { start: '2026-02-20T00:00:00Z', end: '2026-02-28T00:00:00Z' }
          }
        },
        noShowRecoveryAssumption: {
          value: 0.35,
          provenance: {
            source: 'HISTORICAL_BUSINESS_DATA',
            sourceId: 'matrix_noshow_rec_metric',
            confidence: 'HIGH',
            sampleSize: 50,
            timeRange: { start: '2026-02-20T00:00:00Z', end: '2026-02-28T00:00:00Z' }
          }
        },
        qualificationRateBaseline: {
          value: 0.70,
          provenance: {
            source: 'HISTORICAL_BUSINESS_DATA',
            sourceId: 'matrix_qual_rate_metric',
            confidence: 'HIGH',
            sampleSize: 50,
            timeRange: { start: '2026-02-20T00:00:00Z', end: '2026-02-28T00:00:00Z' }
          }
        }
      });

      const ruleIds = findings.map(f => f.ruleId);
      expect(ruleIds).toContain('RULE_MISSED_HIGH_INTENT_LEAD');
      expect(ruleIds).toContain('RULE_SLOW_RESPONSE_LATENCY');
      expect(ruleIds).toContain('RULE_FOLLOW_UP_GAP');
      expect(ruleIds).toContain('RULE_MISSED_INBOUND_CALL');
      expect(ruleIds).toContain('RULE_APPOINTMENT_NO_SHOW_GAP');
      expect(ruleIds).toContain('RULE_OFF_PEAK_UNUSED_CAPACITY');
      expect(ruleIds).toContain('RULE_FUNNEL_STAGE_DROP');
      expect(ruleIds).toContain('RULE_AGING_INVENTORY_HOLDING');

      expect(findings.length).toBe(8);
      findings.forEach(f => {
        expect(f.impactStatus).toBe('VERIFIED');
        expect(f.confidenceLevel).toBe('HIGH');
        expect(f.estimatedImpactMinor).toBeGreaterThan(0);
      });
    });
  });

  describe('12. Cross-Business Contamination Defense Matrix', () => {
    it('fails closed when CapacityUtilization has missing or undefined businessId', () => {
      const capacityWithoutBiz: any = {
        // businessId omitted
        industry: 'salon_clinic',
        calculatedAt: '2026-02-28T12:00:00Z',
        overallUtilizationPct: 30,
        lowestWindow: {
          windowLabel: 'Tuesday Afternoon',
          daypart: 'afternoon_dip',
          totalCapacityMinutes: 480,
          bookedCapacityMinutes: 120,
          utilizationPct: 25,
          unfilledCapacityMinutes: 240,
          potentialRevenueLossMinor: 300000,
          currency: 'USD'
        },
        peakWindow: {
          windowLabel: 'Saturday Morning',
          daypart: 'morning',
          totalCapacityMinutes: 480,
          bookedCapacityMinutes: 456,
          utilizationPct: 95,
          unfilledCapacityMinutes: 20,
          potentialRevenueLossMinor: 0,
          currency: 'USD'
        },
        snapshotsByWindow: [],
        source: 'capacity_analyzer_v1',
        provenance: {
          source: 'HISTORICAL_BUSINESS_DATA',
          sourceId: 'biz_unscoped_capacity',
          confidence: 'HIGH',
          sampleSize: 50,
          timeRange: { start: '2026-02-25T00:00:00Z', end: '2026-02-28T00:00:00Z' }
        }
      };

      const findings = RevenueLeakEngine.evaluateAll({
        businessId: 'biz_alpha',
        leads: [],
        appointments: [],
        calls: [],
        capacity: capacityWithoutBiz,
        currency: 'USD',
        evaluationTimestamp: '2026-03-01T00:00:00Z'
      });

      const capacityFinding = findings.find(f => f.ruleId === 'RULE_OFF_PEAK_UNUSED_CAPACITY');
      expect(capacityFinding).toBeUndefined();
    });

    it('guarantees complete isolation across all entity types between Tenant Alpha and Tenant Beta', () => {
      const leads: LeadRow[] = [
        {
          id: 'lead_alpha',
          business_id: 'biz_alpha',
          organization_id: 'org_1',
          market: 'TR' as const,
          pseudonymous_customer_id: 'cust_alpha',
          company_name: 'Alpha Customer',
          funnel_stage: 'captured',
          status: 'open',
          intent_score: 95,
          response_latency_minutes: 60,
          estimated_deal_value_minor: 500000,
          leak_risk_factor: 'high_decay',
          created_at: '2026-02-26T10:00:00Z',
        },
        {
          id: 'lead_beta',
          business_id: 'biz_beta',
          organization_id: 'org_1',
          market: 'TR' as const,
          pseudonymous_customer_id: 'cust_beta',
          company_name: 'Beta Customer',
          funnel_stage: 'captured',
          status: 'open',
          intent_score: 95,
          response_latency_minutes: 60,
          estimated_deal_value_minor: 9999999,
          leak_risk_factor: 'high_decay',
          created_at: '2026-02-26T10:00:00Z',
        }
      ];

      const calls: CallMetadataEvent[] = [
        {
          id: 'call_alpha',
          organizationId: 'org_1',
          businessId: 'biz_alpha',
          pseudonymousCallerId: 'caller_alpha',
          direction: 'inbound',
          status: 'missed',
          waitDurationSeconds: 30,
          callDurationSeconds: 0,
          startedAt: '2026-02-25T10:00:00Z',
          endedAt: '2026-02-25T10:01:00Z',
          source: 'alpha_pbx'
        },
        {
          id: 'call_beta',
          organizationId: 'org_1',
          businessId: 'biz_beta',
          pseudonymousCallerId: 'caller_beta',
          direction: 'inbound',
          status: 'missed',
          waitDurationSeconds: 30,
          callDurationSeconds: 0,
          startedAt: '2026-02-25T10:00:00Z',
          endedAt: '2026-02-25T10:01:00Z',
          source: 'beta_pbx'
        }
      ];

      const inventoryItems: InventoryItemTelemetry[] = [
        {
          id: 'inv_alpha',
          businessId: 'biz_alpha',
          currency: 'USD',
          sku: 'SKU-ALPHA',
          name: 'Alpha Widget',
          holdingDays: 60,
          unitCostMinor: 10000,
          quantityOnHand: 2,
          dailyCarryingBps: 20,
          provenance: {
            source: 'HISTORICAL_BUSINESS_DATA',
            sourceId: 'alpha_inv_ledger',
            confidence: 'HIGH',
            sampleSize: 10,
            timeRange: { start: '2026-02-01T00:00:00Z', end: '2026-02-28T00:00:00Z' }
          }
        },
        {
          id: 'inv_beta',
          businessId: 'biz_beta',
          currency: 'USD',
          sku: 'SKU-BETA',
          name: 'Beta Widget',
          holdingDays: 60,
          unitCostMinor: 9999999,
          quantityOnHand: 100,
          dailyCarryingBps: 20,
          provenance: {
            source: 'HISTORICAL_BUSINESS_DATA',
            sourceId: 'beta_inv_ledger',
            confidence: 'HIGH',
            sampleSize: 10,
            timeRange: { start: '2026-02-01T00:00:00Z', end: '2026-02-28T00:00:00Z' }
          }
        }
      ];

      const findings = RevenueLeakEngine.evaluateAll({
        businessId: 'biz_alpha',
        leads,
        appointments: [],
        calls,
        callHistoryCoverage: {
          businessId: 'biz_alpha',
          coveredFrom: '2026-02-20T00:00:00Z',
          coveredTo: '2026-02-28T00:00:00Z',
          isComplete: true,
          sourceId: 'alpha_pbx_coverage'
        },
        inventoryItems,
        currency: 'USD',
        evaluationTimestamp: '2026-03-01T00:00:00Z',
        conversionRateAssumption: {
          value: 0.20,
          provenance: {
            source: 'HISTORICAL_BUSINESS_DATA',
            sourceId: 'alpha_conv_metric',
            confidence: 'HIGH',
            sampleSize: 25,
            timeRange: { start: '2026-02-20T00:00:00Z', end: '2026-02-28T00:00:00Z' }
          }
        },
        avgDealValueAssumption: {
          valueMinor: 500000,
          currency: 'USD',
          provenance: {
            source: 'HISTORICAL_BUSINESS_DATA',
            sourceId: 'alpha_deal_metric',
            confidence: 'HIGH',
            sampleSize: 25,
            timeRange: { start: '2026-02-20T00:00:00Z', end: '2026-02-28T00:00:00Z' }
          }
        },
        callConversionAssumption: {
          value: 0.20,
          provenance: {
            source: 'HISTORICAL_BUSINESS_DATA',
            sourceId: 'alpha_call_conv_metric',
            confidence: 'HIGH',
            sampleSize: 25,
            timeRange: { start: '2026-02-20T00:00:00Z', end: '2026-02-28T00:00:00Z' }
          }
        }
      });

      const findingA = findings.find(f => f.ruleId === 'RULE_MISSED_HIGH_INTENT_LEAD');
      expect(findingA).toBeDefined();
      expect(findingA?.evidenceSources?.[0]?.recordIds).toEqual(['lead_alpha']);
      expect(findingA?.evidenceSources?.[0]?.recordIds).not.toContain('lead_beta');

      const findingD = findings.find(f => f.ruleId === 'RULE_MISSED_INBOUND_CALL');
      expect(findingD).toBeDefined();
      expect(findingD?.observedFacts.some(fact => fact.includes('Beta'))).toBe(false);

      const findingH = findings.find(f => f.ruleId === 'RULE_AGING_INVENTORY_HOLDING');
      expect(findingH).toBeDefined();
      expect(findingH?.observedFacts.some(fact => fact.includes('SKU-BETA'))).toBe(false);
      expect(findingH?.dataSources).not.toContain('INVENTORY_TELEMETRY:beta_inv_ledger');
    });
  });

  describe('9. Canonical Provenance-Kind Deterministic Mapping Suite', () => {
    it('verifies metricProvenanceToEvidenceKind maps every canonical source to its exact EvidenceSourceKind', () => {
      expect(RevenueLeakEngine.metricProvenanceToEvidenceKind('HISTORICAL_BUSINESS_DATA')).toBe('BUSINESS_METRIC');
      expect(RevenueLeakEngine.metricProvenanceToEvidenceKind('PERSISTED_BUSINESS_METRIC')).toBe('BUSINESS_METRIC');
      expect(RevenueLeakEngine.metricProvenanceToEvidenceKind('CALCULATED_FROM_VERIFIED_ROWS')).toBe('BUSINESS_METRIC');
      expect(RevenueLeakEngine.metricProvenanceToEvidenceKind('BUSINESS_CONFIGURED')).toBe('BUSINESS_CONFIGURATION');
      expect(RevenueLeakEngine.metricProvenanceToEvidenceKind('SECTOR_BASELINE')).toBe('SECTOR_BASELINE');
      expect(RevenueLeakEngine.metricProvenanceToEvidenceKind('UNAVAILABLE')).toBeNull();
      expect(RevenueLeakEngine.metricProvenanceToEvidenceKind('INSUFFICIENT_DATA')).toBeNull();
      expect(RevenueLeakEngine.metricProvenanceToEvidenceKind(undefined)).toBeNull();
      expect(RevenueLeakEngine.metricProvenanceToEvidenceKind(null)).toBeNull();
    });

    it('ensures BUSINESS_CONFIGURED is NEVER mapped to BUSINESS_METRIC', () => {
      const kind = RevenueLeakEngine.metricProvenanceToEvidenceKind('BUSINESS_CONFIGURED');
      expect(kind).not.toBe('BUSINESS_METRIC');
      expect(kind).toBe('BUSINESS_CONFIGURATION');
    });

    it('ensures SECTOR_BASELINE is NEVER mapped to BUSINESS_METRIC', () => {
      const kind = RevenueLeakEngine.metricProvenanceToEvidenceKind('SECTOR_BASELINE');
      expect(kind).not.toBe('BUSINESS_METRIC');
      expect(kind).toBe('SECTOR_BASELINE');
    });

    it('verifies buildMetricEvidenceSource builds valid references and formats cleanly', () => {
      const metricRef = RevenueLeakEngine.buildMetricEvidenceSource({
        value: 0.25,
        provenance: {
          source: 'BUSINESS_CONFIGURED',
          sourceId: 'custom_cfg_42',
          confidence: 'MEDIUM',
          sampleSize: 12,
          timeRange: { start: '2026-02-01T00:00:00Z', end: '2026-02-28T00:00:00Z' }
        }
      });
      expect(metricRef).toEqual({
        kind: 'BUSINESS_CONFIGURATION',
        sourceId: 'custom_cfg_42',
        sampleSize: 12,
        timeRange: { start: '2026-02-01T00:00:00Z', end: '2026-02-28T00:00:00Z' }
      });
      expect(RevenueLeakEngine.formatEvidenceSourceString(metricRef)).toBe('BUSINESS_CONFIGURATION:custom_cfg_42');
    });

    it('verifies formatEvidenceSourceString returns UNAVAILABLE on null reference', () => {
      expect(RevenueLeakEngine.formatEvidenceSourceString(null)).toBe('UNAVAILABLE');
      expect(RevenueLeakEngine.formatEvidenceSourceString(undefined)).toBe('UNAVAILABLE');
    });
  });

  describe('10. Rule-Level Provenance-Kind Surface Enforcement', () => {
    it('verifies Rule A surfaces BUSINESS_CONFIGURATION when configured metric is supplied', () => {
      const leads: any[] = [
        {
          id: 'lead_rule_a',
          business_id: 'biz_kind_test',
          created_at: '2026-02-20T10:00:00Z',
          status: 'open',
          intent_score: 90,
          response_latency_minutes: 120
        }
      ];

      const findings = RevenueLeakEngine.evaluateAll({
        businessId: 'biz_kind_test',
        leads,
        appointments: [],
        calls: [],
        currency: 'USD',
        evaluationTimestamp: '2026-02-25T12:00:00Z',
        conversionRateAssumption: {
          value: 0.15,
          provenance: {
            source: 'BUSINESS_CONFIGURED',
            sourceId: 'crm_setting_conv_rate',
            confidence: 'MEDIUM',
            sampleSize: 10,
            timeRange: { start: '2026-02-01T00:00:00Z', end: '2026-02-24T00:00:00Z' }
          }
        },
        avgDealValueAssumption: {
          valueMinor: 250000,
          currency: 'USD',
          provenance: {
            source: 'SECTOR_BASELINE',
            sourceId: 'dental_clinic_benchmark',
            confidence: 'LOW',
            sampleSize: 100,
            timeRange: { start: '2026-01-01T00:00:00Z', end: '2026-02-24T00:00:00Z' }
          }
        }
      });

      const findingA = findings.find(f => f.ruleId === 'RULE_MISSED_HIGH_INTENT_LEAD');
      expect(findingA).toBeDefined();

      const convMetric = findingA?.calculatedMetrics.find(m => m.metricKey === 'historical_conversion_rate');
      expect(convMetric?.sourceDataSource).toBe('BUSINESS_CONFIGURATION:crm_setting_conv_rate');
      expect(convMetric?.evidenceReference?.kind).toBe('BUSINESS_CONFIGURATION');
      expect(convMetric?.sourceDataSource).not.toContain('BUSINESS_METRIC');

      const dealMetric = findingA?.calculatedMetrics.find(m => m.metricKey === 'average_deal_value_minor');
      expect(dealMetric?.sourceDataSource).toBe('SECTOR_BASELINE:dental_clinic_benchmark');
      expect(dealMetric?.evidenceReference?.kind).toBe('SECTOR_BASELINE');
      expect(dealMetric?.sourceDataSource).not.toContain('BUSINESS_METRIC');

      expect(findingA?.dataSources).toContain('BUSINESS_CONFIGURATION:crm_setting_conv_rate');
      expect(findingA?.dataSources).toContain('SECTOR_BASELINE:dental_clinic_benchmark');
      expect(findingA?.dataSources.some(ds => ds.startsWith('BUSINESS_METRIC'))).toBe(false);
    });

    it('verifies Rule B surfaces exact mapped kind for decay and baseline metrics', () => {
      const leads: any[] = [
        {
          id: 'lead_rule_b',
          business_id: 'biz_kind_test',
          created_at: '2026-02-20T10:00:00Z',
          status: 'open',
          intent_score: 50,
          response_latency_minutes: 90
        }
      ];

      const findings = RevenueLeakEngine.evaluateAll({
        businessId: 'biz_kind_test',
        leads,
        appointments: [],
        calls: [],
        currency: 'USD',
        evaluationTimestamp: '2026-02-25T12:00:00Z',
        conversionRateAssumption: {
          value: 0.15,
          provenance: {
            source: 'HISTORICAL_BUSINESS_DATA',
            sourceId: 'verified_crm_fact_1',
            confidence: 'HIGH',
            sampleSize: 30,
            timeRange: { start: '2026-02-01T00:00:00Z', end: '2026-02-24T00:00:00Z' }
          }
        },
        responseDecayFactor: {
          value: 0.35,
          provenance: {
            source: 'BUSINESS_CONFIGURED',
            sourceId: 'owner_overridden_decay',
            confidence: 'MEDIUM',
            sampleSize: 15,
            timeRange: { start: '2026-02-01T00:00:00Z', end: '2026-02-24T00:00:00Z' }
          }
        },
        avgDealValueAssumption: {
          valueMinor: 100000,
          currency: 'USD',
          provenance: {
            source: 'PERSISTED_BUSINESS_METRIC',
            sourceId: 'verified_deal_fact_2',
            confidence: 'HIGH',
            sampleSize: 30,
            timeRange: { start: '2026-02-01T00:00:00Z', end: '2026-02-24T00:00:00Z' }
          }
        }
      });

      const findingB = findings.find(f => f.ruleId === 'RULE_SLOW_RESPONSE_LATENCY');
      expect(findingB).toBeDefined();

      const decayMetric = findingB?.calculatedMetrics.find(m => m.metricKey === 'conversion_decay_factor');
      expect(decayMetric?.sourceDataSource).toBe('BUSINESS_CONFIGURATION:owner_overridden_decay');
      expect(decayMetric?.evidenceReference?.kind).toBe('BUSINESS_CONFIGURATION');

      expect(findingB?.dataSources).toContain('BUSINESS_METRIC:verified_crm_fact_1');
      expect(findingB?.dataSources).toContain('BUSINESS_CONFIGURATION:owner_overridden_decay');
      expect(findingB?.dataSources).toContain('BUSINESS_METRIC:verified_deal_fact_2');
    });

    it('verifies Rule C surfaces exact mapped kind for proposal win rate baseline', () => {
      const leads: any[] = [
        {
          id: 'lead_rule_c',
          business_id: 'biz_kind_test',
          created_at: '2026-02-10T10:00:00Z',
          funnel_stage: 'proposal_sent',
          status: 'open',
          estimated_deal_value_minor: 5000000
        }
      ];

      const findings = RevenueLeakEngine.evaluateAll({
        businessId: 'biz_kind_test',
        leads,
        appointments: [],
        calls: [],
        leadActivityEvidence: [
          {
            leadId: 'lead_rule_c',
            businessId: 'biz_kind_test',
            proposalSentAt: '2026-02-10T10:00:00Z',
            coverageStart: '2026-02-01T00:00:00Z',
            coverageEnd: '2026-02-25T00:00:00Z',
            isComplete: true,
            source: 'sales_hubspot_sync'
          } as any
        ],
        currency: 'USD',
        evaluationTimestamp: '2026-02-25T12:00:00Z',
        proposalWinRateBaseline: {
          value: 0.40,
          provenance: {
            source: 'SECTOR_BASELINE',
            sourceId: 'b2b_saas_proposal_win_benchmark',
            confidence: 'LOW',
            sampleSize: 200,
            timeRange: { start: '2026-01-01T00:00:00Z', end: '2026-02-24T00:00:00Z' }
          }
        }
      });

      const findingC = findings.find(f => f.ruleId === 'RULE_FOLLOW_UP_GAP');
      expect(findingC).toBeDefined();

      const winMetric = findingC?.calculatedMetrics.find(m => m.metricKey === 'proposal_win_rate');
      expect(winMetric?.sourceDataSource).toBe('SECTOR_BASELINE:b2b_saas_proposal_win_benchmark');
      expect(winMetric?.evidenceReference?.kind).toBe('SECTOR_BASELINE');
      expect(findingC?.dataSources).toContain('SECTOR_BASELINE:b2b_saas_proposal_win_benchmark');
    });

    it('verifies Rule D surfaces exact mapped kind for call conversion and deal metrics', () => {
      const calls: any[] = [
        {
          id: 'call_rule_d',
          businessId: 'biz_kind_test',
          pseudonymousCallerId: 'caller_rule_d',
          direction: 'inbound',
          status: 'missed',
          waitDurationSeconds: 45,
          startedAt: '2026-02-20T14:00:00Z',
          endedAt: '2026-02-20T14:01:00Z'
        }
      ];

      const findings = RevenueLeakEngine.evaluateAll({
        businessId: 'biz_kind_test',
        leads: [],
        appointments: [],
        calls,
        callHistoryCoverage: {
          businessId: 'biz_kind_test',
          coveredFrom: '2026-02-20T00:00:00Z',
          coveredTo: '2026-02-25T00:00:00Z',
          isComplete: true,
          sourceId: 'twilio_pbx_stream'
        },
        currency: 'USD',
        evaluationTimestamp: '2026-02-25T12:00:00Z',
        callConversionAssumption: {
          value: 0.30,
          provenance: {
            source: 'BUSINESS_CONFIGURED',
            sourceId: 'call_center_target_rate',
            confidence: 'MEDIUM',
            sampleSize: 20,
            timeRange: { start: '2026-02-01T00:00:00Z', end: '2026-02-24T00:00:00Z' }
          }
        },
        callAverageDealValueAssumption: {
          valueMinor: 300000,
          currency: 'USD',
          provenance: {
            source: 'SECTOR_BASELINE',
            sourceId: 'plumbing_sector_call_ticket_benchmark',
            confidence: 'LOW',
            sampleSize: 150,
            timeRange: { start: '2026-01-01T00:00:00Z', end: '2026-02-24T00:00:00Z' }
          }
        }
      });

      const findingD = findings.find(f => f.ruleId === 'RULE_MISSED_INBOUND_CALL');
      expect(findingD).toBeDefined();

      const convMetric = findingD?.calculatedMetrics.find(m => m.metricKey === 'call_conversion_rate');
      expect(convMetric?.sourceDataSource).toBe('BUSINESS_CONFIGURATION:call_center_target_rate');
      expect(convMetric?.evidenceReference?.kind).toBe('BUSINESS_CONFIGURATION');

      const dealMetric = findingD?.calculatedMetrics.find(m => m.metricKey === 'call_average_deal_value_minor');
      expect(dealMetric?.sourceDataSource).toBe('SECTOR_BASELINE:plumbing_sector_call_ticket_benchmark');
      expect(dealMetric?.evidenceReference?.kind).toBe('SECTOR_BASELINE');

      expect(findingD?.dataSources).toContain('CALL_METADATA_EVENTS');
      expect(findingD?.dataSources).toContain('CALL_HISTORY_COVERAGE:twilio_pbx_stream');
      expect(findingD?.dataSources).toContain('BUSINESS_CONFIGURATION:call_center_target_rate');
      expect(findingD?.dataSources).toContain('SECTOR_BASELINE:plumbing_sector_call_ticket_benchmark');
    });

    it('verifies Rule E surfaces exact mapped kind for appointment recovery assumption', () => {
      const appointments: any[] = [
        {
          id: 'appt_rule_e',
          businessId: 'biz_kind_test',
          customerPseudonymId: 'cust_rule_e',
          scheduledStart: '2026-02-20T15:00:00Z',
          status: 'no_show',
          expectedValueMinor: 20000,
          currency: 'USD'
        }
      ];

      const findings = RevenueLeakEngine.evaluateAll({
        businessId: 'biz_kind_test',
        leads: [],
        appointments,
        calls: [],
        appointmentHistoryCoverage: {
          businessId: 'biz_kind_test',
          coveredFrom: '2026-02-20T00:00:00Z',
          coveredTo: '2026-02-25T00:00:00Z',
          isComplete: true,
          sourceId: 'calcom_booking_feed'
        },
        currency: 'USD',
        evaluationTimestamp: '2026-02-25T12:00:00Z',
        noShowRecoveryAssumption: {
          value: 0.50,
          provenance: {
            source: 'SECTOR_BASELINE',
            sourceId: 'medical_no_show_recovery_index',
            confidence: 'LOW',
            sampleSize: 100,
            timeRange: { start: '2026-01-01T00:00:00Z', end: '2026-02-24T00:00:00Z' }
          }
        }
      });

      const findingE = findings.find(f => f.ruleId === 'RULE_APPOINTMENT_NO_SHOW_GAP');
      expect(findingE).toBeDefined();

      const recMetric = findingE?.calculatedMetrics.find(m => m.metricKey === 'target_rebook_recovery_rate');
      expect(recMetric?.sourceDataSource).toBe('SECTOR_BASELINE:medical_no_show_recovery_index');
      expect(recMetric?.evidenceReference?.kind).toBe('SECTOR_BASELINE');
      expect(findingE?.dataSources).toContain('SECTOR_BASELINE:medical_no_show_recovery_index');
    });

    it('verifies Rule G surfaces exact mapped kind for qualification rate baseline', () => {
      const leads: any[] = Array.from({ length: 15 }, (_, i) => ({
        id: `lead_rule_g_${i + 1}`,
        business_id: 'biz_kind_test',
        created_at: `2026-02-20T${String(10 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 === 0 ? '00' : '30'}:00Z`,
        funnel_stage: 'captured',
        status: 'captured'
      }));

      const findings = RevenueLeakEngine.evaluateAll({
        businessId: 'biz_kind_test',
        leads,
        appointments: [],
        calls: [],
        currency: 'USD',
        evaluationTimestamp: '2026-02-25T12:00:00Z',
        qualificationRateBaseline: {
          value: 0.75,
          provenance: {
            source: 'BUSINESS_CONFIGURED',
            sourceId: 'executive_funnel_target',
            confidence: 'MEDIUM',
            sampleSize: 15,
            timeRange: { start: '2026-02-01T00:00:00Z', end: '2026-02-24T00:00:00Z' }
          }
        },
        conversionRateAssumption: {
          value: 0.20,
          provenance: {
            source: 'HISTORICAL_BUSINESS_DATA',
            sourceId: 'conv_hist_metric',
            confidence: 'HIGH',
            sampleSize: 25,
            timeRange: { start: '2026-02-01T00:00:00Z', end: '2026-02-24T00:00:00Z' }
          }
        },
        avgDealValueAssumption: {
          valueMinor: 50000,
          currency: 'USD',
          provenance: {
            source: 'HISTORICAL_BUSINESS_DATA',
            sourceId: 'deal_hist_metric',
            confidence: 'HIGH',
            sampleSize: 25,
            timeRange: { start: '2026-02-01T00:00:00Z', end: '2026-02-24T00:00:00Z' }
          }
        }
      });

      const findingG = findings.find(f => f.ruleId === 'RULE_FUNNEL_STAGE_DROP');
      expect(findingG).toBeDefined();

      const qualMetric = findingG?.calculatedMetrics.find(m => m.metricKey === 'qualification_rate_baseline');
      expect(qualMetric?.sourceDataSource).toBe('BUSINESS_CONFIGURATION:executive_funnel_target');
      expect(qualMetric?.evidenceReference?.kind).toBe('BUSINESS_CONFIGURATION');
      expect(findingG?.dataSources).toContain('BUSINESS_CONFIGURATION:executive_funnel_target');
    });
  });

  describe('11. Zero Fallback on Malformed BusinessTwinFactRow IDs', () => {
    it('fails closed when fact id is empty or blank, preventing VERIFIED impact generation', () => {
      const isMoneyValid = RevenueLeakEngine.isMoneyAssumptionValid({
        valueMinor: 500000,
        currency: 'USD',
        provenance: {
          source: 'PERSISTED_BUSINESS_METRIC',
          sourceId: '',
          confidence: 'HIGH',
          sampleSize: 50,
          timeRange: { start: '2026-02-01T00:00:00Z', end: '2026-02-28T00:00:00Z' }
        }
      }, 'USD');
      expect(isMoneyValid).toBe(false);

      const isRateValid = RevenueLeakEngine.isRateAssumptionValid({
        value: 0.25,
        provenance: {
          source: 'PERSISTED_BUSINESS_METRIC',
          sourceId: '   ',
          confidence: 'HIGH',
          sampleSize: 50,
          timeRange: { start: '2026-02-01T00:00:00Z', end: '2026-02-28T00:00:00Z' }
        }
      });
      expect(isRateValid).toBe(false);

      const evidenceRef = RevenueLeakEngine.buildMetricEvidenceSource({
        value: 0.25,
        provenance: {
          source: 'PERSISTED_BUSINESS_METRIC',
          sourceId: '',
          confidence: 'HIGH',
          sampleSize: 50
        }
      });
      expect(evidenceRef).toBeNull();
    });
  });
});

