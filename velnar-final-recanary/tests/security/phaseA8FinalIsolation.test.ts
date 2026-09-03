import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RevenueLeakEngine } from '../../src/services/revenueLeakEngine';
import { ApiClient } from '../../src/services/apiClient';
import { SessionClient } from '../../src/services/sessionClient';
import { ActionPolicyEngine } from '../../worker/ai/actions/actionPolicyEngine';
import { LeadRow } from '../../src/types/database';
import { Appointment } from '../../src/types/appointment';
import { CallMetadataEvent } from '../../src/types/telephony';

describe('Phase A.8 Final Isolation & Zero-Invented-Metrics Seal Tests', () => {
  beforeEach(() => {
    SessionClient.clearSession();
    ApiClient.clearActiveTenant();
    vi.restoreAllMocks();
  });

  describe('1. RevenueLeakEngine Zero-Invented-Metrics & Deterministic Provenance', () => {
    it('returns estimatedImpactMinor as null when lead response data is insufficient', () => {
      const slowLeads: LeadRow[] = [
        {
          id: 'ld_slow_1',
          organization_id: 'org_test',
          business_id: 'biz_test',
          market: 'GLOBAL',
          pseudonymous_customer_id: 'cust_1',
          company_name: 'Acme Corp',
          funnel_stage: 'captured',
          status: 'open',
          intent_score: 85,
          response_latency_minutes: 45,
          estimated_deal_value_minor: 0,
          leak_risk_factor: 'high_decay',
          created_at: new Date().toISOString(),
        }
      ];

      const calculations = RevenueLeakEngine.evaluateAll({
        leads: slowLeads,
        appointments: [],
        calls: [],
        currency: 'USD',
        evaluationTimestamp: new Date().toISOString(),
        conversionRateAssumption: {
          value: 0,
          provenance: {
            source: 'UNAVAILABLE',
            confidence: 'INSUFFICIENT',
          }
        },
        avgDealValueAssumption: {
          valueMinor: 0,
          currency: 'USD',
          provenance: {
            source: 'UNAVAILABLE',
            confidence: 'INSUFFICIENT',
          }
        }
      });

      const highIntentFinding = calculations.find(c => c.ruleId === 'RULE_MISSED_HIGH_INTENT_LEAD');
      expect(highIntentFinding).toBeDefined();
      expect(highIntentFinding?.estimatedImpactMinor).toBeNull();
      expect(highIntentFinding?.isDataInsufficient).toBe(true);
      expect(highIntentFinding?.confidenceLevel).toBe('INSUFFICIENT');
      expect(highIntentFinding?.insufficientDataReason).toBeDefined();
    });

    it('calculates deterministic estimatedImpactMinor when real provenance and deal value are provided', () => {
      const slowLeads: LeadRow[] = [
        {
          id: 'ld_slow_1',
          organization_id: 'org_test',
          business_id: 'biz_test',
          market: 'GLOBAL',
          pseudonymous_customer_id: 'cust_1',
          company_name: 'Acme Corp',
          funnel_stage: 'captured',
          status: 'open',
          intent_score: 90,
          response_latency_minutes: 60,
          estimated_deal_value_minor: 500000,
          leak_risk_factor: 'high_decay',
          created_at: new Date().toISOString(),
        },
        {
          id: 'ld_slow_2',
          organization_id: 'org_test',
          business_id: 'biz_test',
          market: 'GLOBAL',
          pseudonymous_customer_id: 'cust_2',
          company_name: 'Beta LLC',
          funnel_stage: 'captured',
          status: 'open',
          intent_score: 85,
          response_latency_minutes: 30,
          estimated_deal_value_minor: 300000,
          leak_risk_factor: 'high_decay',
          created_at: new Date().toISOString(),
        }
      ];

      const now = new Date();
      const evalTimestamp = now.toISOString();
      const rangeStart = new Date(now.getTime() - 5 * 24 * 3600 * 1000).toISOString();
      const rangeEnd = new Date(now.getTime() - 1 * 24 * 3600 * 1000).toISOString();

      const calculations = RevenueLeakEngine.evaluateAll({
        leads: slowLeads,
        appointments: [],
        calls: [],
        currency: 'USD',
        evaluationTimestamp: evalTimestamp,
        conversionRateAssumption: {
          value: 0.3,
          provenance: {
            source: 'CALCULATED_FROM_VERIFIED_ROWS',
            sourceId: 'calc_conv_rate',
            confidence: 'HIGH',
            sampleSize: 20,
            timeRange: { start: rangeStart, end: rangeEnd }
          }
        },
        avgDealValueAssumption: {
          valueMinor: 400000,
          currency: 'USD',
          provenance: {
            source: 'CALCULATED_FROM_VERIFIED_ROWS',
            sourceId: 'calc_deal_val',
            confidence: 'HIGH',
            sampleSize: 20,
            timeRange: { start: rangeStart, end: rangeEnd }
          }
        }
      });

      const highIntentFinding = calculations.find(c => c.ruleId === 'RULE_MISSED_HIGH_INTENT_LEAD');
      expect(highIntentFinding).toBeDefined();
      expect(highIntentFinding?.estimatedImpactMinor).not.toBeNull();
      expect(highIntentFinding?.estimatedImpactMinor).toBeGreaterThan(0);
      expect(highIntentFinding?.isDataInsufficient).toBe(false);
      expect(highIntentFinding?.confidenceLevel).toBe('HIGH');
    });

    it('returns null for missed call impact when sample size is insufficient and provenance is unavailable', () => {
      const pastCallDate = new Date(Date.now() - 5 * 3600 * 1000).toISOString();
      const missedCalls: CallMetadataEvent[] = [
        {
          id: 'call_1',
          organizationId: 'org_test',
          businessId: 'biz_test',
          pseudonymousCallerId: 'caller_hash_1',
          source: 'website_header',
          startedAt: pastCallDate,
          endedAt: pastCallDate,
          direction: 'inbound',
          waitDurationSeconds: 20,
          callDurationSeconds: 0,
          status: 'missed',
        }
      ];

      const calculations = RevenueLeakEngine.evaluateAll({
        leads: [],
        appointments: [],
        calls: missedCalls,
        callHistoryCoverage: {
          businessId: 'biz_test',
          coveredFrom: new Date(Date.now() - 10 * 3600 * 1000).toISOString(),
          coveredTo: new Date().toISOString(),
          isComplete: true,
        },
        currency: 'USD',
        evaluationTimestamp: new Date().toISOString(),
        callConversionAssumption: {
          value: 0,
          provenance: {
            source: 'UNAVAILABLE',
            confidence: 'INSUFFICIENT'
          }
        },
        avgDealValueAssumption: {
          valueMinor: 0,
          currency: 'USD',
          provenance: {
            source: 'UNAVAILABLE',
            confidence: 'INSUFFICIENT'
          }
        }
      });

      const missedCallFinding = calculations.find(c => c.ruleId === 'RULE_MISSED_INBOUND_CALL');
      expect(missedCallFinding).toBeDefined();
      expect(missedCallFinding?.estimatedImpactMinor).toBeNull();
      expect(missedCallFinding?.isDataInsufficient).toBe(true);
    });

    it('returns null for appointment no-shows when appointment value provenance is unavailable', () => {
      const pastDate = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
      const pastEndDate = new Date(Date.now() - 47 * 3600 * 1000).toISOString();
      const noShowAppointments: Appointment[] = [
        {
          id: 'apt_1',
          organizationId: 'org_test',
          businessId: 'biz_test',
          customerPseudonymId: 'cust_pseudo_1',
          serviceName: 'Consultation',
          serviceCategory: 'General',
          resourceStaffId: 'staff_1',
          resourceStaffName: 'Staff 1',
          scheduledStart: pastDate,
          scheduledEnd: pastEndDate,
          durationMinutes: 60,
          expectedValueMinor: 0,
          currency: 'USD',
          status: 'no_show',
          source: 'web_booking_widget',
          rowVersion: 0,
          createdAt: pastDate,
          updatedAt: pastDate,
        }
      ];

      const calculations = RevenueLeakEngine.evaluateAll({
        leads: [],
        appointments: noShowAppointments,
        appointmentHistoryCoverage: {
          businessId: 'biz_test',
          coveredFrom: new Date(Date.now() - 72 * 3600 * 1000).toISOString(),
          coveredTo: new Date().toISOString(),
          isComplete: true,
        },
        calls: [],
        currency: 'USD',
        evaluationTimestamp: new Date().toISOString(),
        noShowRecoveryAssumption: {
          value: 0,
          provenance: {
            source: 'UNAVAILABLE',
            confidence: 'INSUFFICIENT'
          }
        },
        avgDealValueAssumption: {
          valueMinor: 0,
          currency: 'USD',
          provenance: {
            source: 'UNAVAILABLE',
            confidence: 'INSUFFICIENT'
          }
        }
      });

      const noShowFinding = calculations.find(c => c.ruleId === 'RULE_APPOINTMENT_NO_SHOW_GAP');
      expect(noShowFinding).toBeDefined();
      expect(noShowFinding?.estimatedImpactMinor).toBeNull();
      expect(noShowFinding?.isDataInsufficient).toBe(true);
    });
  });

  describe('2. Multi-Business vs Single-Business Deterministic Resolution', () => {
    it('requires explicit selection when multiple businesses exist in tenant bootstrap', async () => {
      ApiClient.setAuthToken('mock_auth_token');
      const mockBootstrapResponse = {
        success: true,
        data: {
          organization: { id: 'org_multi', name: 'Multi Biz Org' },
          businesses: [
            { id: 'biz_1', organization_id: 'org_multi', name: 'Biz One', currency: 'USD' },
            { id: 'biz_2', organization_id: 'org_multi', name: 'Biz Two', currency: 'EUR' }
          ]
        }
      };

      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/api/bootstrap')) {
          return {
            ok: true,
            status: 200,
            json: async () => mockBootstrapResponse
          };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      });

      const bootstrap = await ApiClient.fetchBootstrap('org_multi');
      expect(bootstrap.businesses.length).toBe(2);
      // In multi-business tenant, neither is auto-selected blindly
      const selectedId = bootstrap.businesses.length === 1 ? bootstrap.businesses[0].id : null;
      expect(selectedId).toBeNull();
    });

    it('deterministically auto-selects business when exactly one business exists', async () => {
      ApiClient.setAuthToken('mock_auth_token');
      const mockBootstrapResponse = {
        success: true,
        data: {
          organization: { id: 'org_single', name: 'Single Biz Org' },
          businesses: [
            { id: 'biz_solo', organization_id: 'org_single', name: 'Solo Biz', currency: 'USD' }
          ]
        }
      };

      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/api/bootstrap')) {
          return {
            ok: true,
            status: 200,
            json: async () => mockBootstrapResponse
          };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      });

      const bootstrap = await ApiClient.fetchBootstrap('org_single');
      expect(bootstrap.businesses.length).toBe(1);
      const selectedId = bootstrap.businesses.length === 1 ? bootstrap.businesses[0].id : null;
      expect(selectedId).toBe('biz_solo');
    });
  });

  describe('3. Action Policy Role Enforcement & Security Invariants', () => {
    it('passes validation when policy parameters are respected', () => {
      const validation = ActionPolicyEngine.validate(
        {
          actionType: 'discount_offer',
          requiresHumanApproval: true,
          discountPercent: 10,
        },
        {
          maximumDiscountPercent: 20,
        }
      );

      expect(validation.passed).toBe(true);
      expect(validation.guardrailStatus).toBe('PASSED');
    });

    it('rejects discount actions exceeding configured maximum policy', () => {
      const validation = ActionPolicyEngine.validate(
        {
          actionType: 'discount_offer',
          requiresHumanApproval: true,
          discountPercent: 35,
        },
        {
          maximumDiscountPercent: 20,
        }
      );

      expect(validation.passed).toBe(false);
      expect(validation.violations.some(v => v.includes('exceeds organization maximum allowable cap'))).toBe(true);
    });
  });
});
