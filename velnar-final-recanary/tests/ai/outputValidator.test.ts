import { describe, it, expect } from 'vitest';
import { OutputValidator } from '../../worker/ai/outputValidator';
import { AIRequestEnvelope } from '../../worker/ai/types';

describe('Sprint 4.0 Final OutputValidator - Deterministic Structural Validation', () => {
  const baseEnvelope: AIRequestEnvelope = {
    organizationId: 'org_test',
    businessId: 'biz_test',
    taskType: 'LEAD_INTENT_CLASSIFICATION',
    dataClassification: 'PUBLIC_BUSINESS',
    evidenceIds: ['EV-101', 'EV-102', 'leak_response_lag'],
    observedFacts: ['Fact 1: Response time is 45m', 'Fact 2: Conversion dropped by 12%'],
    calculatedMetrics: {
      estimatedMonthlyLossMinor: 150000,
      verifiedFactCount: 2,
    },
  };

  describe('1. LEAD_INTENT_CLASSIFICATION', () => {
    it('accepts valid lead intent classification', () => {
      const json = JSON.stringify({
        intentScore: 85,
        intentStage: 'high_intent',
        keyIndicators: ['Explicit request for booking', 'Price confirmation inquiry'],
      });

      const result = OutputValidator.validateOutput('LEAD_INTENT_CLASSIFICATION', json, baseEnvelope);
      expect(result.intentScore).toBe(85);
      expect(result.intentStage).toBe('high_intent');
      expect(result.keyIndicators).toHaveLength(2);
    });

    it('rejects intentScore out of 0..100 range', () => {
      const jsonBelow = JSON.stringify({
        intentScore: -5,
        intentStage: 'cold',
        keyIndicators: ['No intent'],
      });
      expect(() =>
        OutputValidator.validateOutput('LEAD_INTENT_CLASSIFICATION', jsonBelow, baseEnvelope)
      ).toThrow('MALFORMED_AI_OUTPUT: intentScore must be a number between 0 and 100.');

      const jsonAbove = JSON.stringify({
        intentScore: 105,
        intentStage: 'high_intent',
        keyIndicators: ['Super high'],
      });
      expect(() =>
        OutputValidator.validateOutput('LEAD_INTENT_CLASSIFICATION', jsonAbove, baseEnvelope)
      ).toThrow('MALFORMED_AI_OUTPUT: intentScore must be a number between 0 and 100.');
    });

    it('rejects invalid intentStage enum value', () => {
      const json = JSON.stringify({
        intentScore: 70,
        intentStage: 'urgent_buyer', // invalid enum
        keyIndicators: ['Needs service'],
      });
      expect(() =>
        OutputValidator.validateOutput('LEAD_INTENT_CLASSIFICATION', json, baseEnvelope)
      ).toThrow('MALFORMED_AI_OUTPUT: intentStage must be one of');
    });

    it('rejects missing or invalid keyIndicators', () => {
      const json = JSON.stringify({
        intentScore: 70,
        intentStage: 'moderate',
        keyIndicators: 'not an array',
      });
      expect(() =>
        OutputValidator.validateOutput('LEAD_INTENT_CLASSIFICATION', json, baseEnvelope)
      ).toThrow('MALFORMED_AI_OUTPUT: keyIndicators must be an array.');
    });
  });

  describe('2. FUNNEL_DIAGNOSTIC_EXPLANATION', () => {
    it('accepts valid funnel diagnostic explanation', () => {
      const json = JSON.stringify({
        dropOffStage: 'Payment Initiation',
        decayVelocity: 'HIGH',
        mitigationRecommendation: 'Implement single-click express payment checkout',
      });

      const result = OutputValidator.validateOutput('FUNNEL_DIAGNOSTIC_EXPLANATION', json, baseEnvelope);
      expect(result.dropOffStage).toBe('Payment Initiation');
      expect(result.decayVelocity).toBe('HIGH');
      expect(result.mitigationRecommendation).toContain('single-click');
    });

    it('rejects invalid decayVelocity enum', () => {
      const json = JSON.stringify({
        dropOffStage: 'Payment',
        decayVelocity: 'CRITICAL_VELOCITY', // invalid enum
        mitigationRecommendation: 'Fix checkout',
      });
      expect(() =>
        OutputValidator.validateOutput('FUNNEL_DIAGNOSTIC_EXPLANATION', json, baseEnvelope)
      ).toThrow('MALFORMED_AI_OUTPUT: decayVelocity must be one of: HIGH, MEDIUM, LOW.');
    });

    it('rejects empty dropOffStage or mitigationRecommendation', () => {
      const jsonEmptyStage = JSON.stringify({
        dropOffStage: '',
        decayVelocity: 'LOW',
        mitigationRecommendation: 'Fix it',
      });
      expect(() =>
        OutputValidator.validateOutput('FUNNEL_DIAGNOSTIC_EXPLANATION', jsonEmptyStage, baseEnvelope)
      ).toThrow('MALFORMED_AI_OUTPUT: dropOffStage must be a non-empty string.');

      const jsonEmptyMitigation = JSON.stringify({
        dropOffStage: 'Checkout',
        decayVelocity: 'LOW',
        mitigationRecommendation: '   ',
      });
      expect(() =>
        OutputValidator.validateOutput('FUNNEL_DIAGNOSTIC_EXPLANATION', jsonEmptyMitigation, baseEnvelope)
      ).toThrow('MALFORMED_AI_OUTPUT: mitigationRecommendation must be a non-empty string.');
    });
  });

  describe('3. ANOMALY_TRIAGE', () => {
    it('accepts valid anomaly triage structure', () => {
      const json = JSON.stringify({
        anomalySeverity: 'CRITICAL',
        probableCause: 'Third-party tracking script failure on booking form',
        triageSteps: ['Check tag manager logs', 'Verify webhook endpoint connectivity'],
      });

      const result = OutputValidator.validateOutput('ANOMALY_TRIAGE', json, baseEnvelope);
      expect(result.anomalySeverity).toBe('CRITICAL');
      expect(result.triageSteps).toHaveLength(2);
    });

    it('rejects invalid anomalySeverity enum', () => {
      const json = JSON.stringify({
        anomalySeverity: 'SEVERE', // invalid enum
        probableCause: 'Server error',
        triageSteps: ['Restart server'],
      });
      expect(() =>
        OutputValidator.validateOutput('ANOMALY_TRIAGE', json, baseEnvelope)
      ).toThrow('MALFORMED_AI_OUTPUT: anomalySeverity must be one of: CRITICAL, ELEVATED, NOMINAL.');
    });

    it('rejects empty triageSteps', () => {
      const json = JSON.stringify({
        anomalySeverity: 'ELEVATED',
        probableCause: 'Spike in error rates',
        triageSteps: [],
      });
      expect(() =>
        OutputValidator.validateOutput('ANOMALY_TRIAGE', json, baseEnvelope)
      ).toThrow('MALFORMED_AI_OUTPUT: triageSteps must be a non-empty array of strings.');
    });
  });

  describe('4. LEAK_EXPLANATION', () => {
    it('accepts valid leak explanation citing existing evidence', () => {
      const json = JSON.stringify({
        explanation: 'Inbound lead response lag increased by 35 minutes causing lead abandonment.',
        primaryBottleneck: 'Unstaffed evening inbound queue',
        evidenceCited: ['EV-101', 'leak_response_lag'],
        confidenceRationale: 'Directly supported by timestamp delta telemetry in EV-101.',
      });

      const result = OutputValidator.validateOutput('LEAK_EXPLANATION', json, baseEnvelope);
      expect(result.primaryBottleneck).toBe('Unstaffed evening inbound queue');
      expect(result.evidenceCited).toContain('EV-101');
    });

    it('rejects hallucinated evidence ID (e.g. EV-999)', () => {
      const json = JSON.stringify({
        explanation: 'Customer churned due to high pricing.',
        primaryBottleneck: 'Pricing barrier',
        evidenceCited: ['EV-999'], // does NOT exist in baseEnvelope.evidenceIds
        confidenceRationale: 'Derived from pricing table.',
      });

      expect(() =>
        OutputValidator.validateOutput('LEAK_EXPLANATION', json, baseEnvelope)
      ).toThrow('INVALID_EVIDENCE_REFERENCE: Cited evidence "EV-999" does not exist in input context.');
    });

    it('rejects model inventing deterministic numerical confidence metrics', () => {
      const json = JSON.stringify({
        explanation: 'Response time degradation causes revenue leakage.',
        primaryBottleneck: 'Queue delay',
        evidenceCited: ['EV-101'],
        confidenceRationale: 'Telemetry data correlation',
        confidenceScore: 98.5, // Not permitted!
      });

      expect(() =>
        OutputValidator.validateOutput('LEAK_EXPLANATION', json, baseEnvelope)
      ).toThrow('MALFORMED_AI_OUTPUT: Model cannot invent deterministic numerical confidence metrics.');
    });
  });

  describe('5. BUSINESS_TWIN_SUMMARY', () => {
    it('accepts valid business twin summary within verified fact count bounds', () => {
      const json = JSON.stringify({
        executiveSummary: 'Apex Holding operates 3 restaurant locations with average 28% operating margin.',
        verifiedFactCount: 2,
        criticalConstraints: ['Kitchen capacity caps dinner covers at 120 per evening'],
        unitEconomicsSummary: 'Average ticket size $45 USD with 32% food cost.',
      });

      const result = OutputValidator.validateOutput('BUSINESS_TWIN_SUMMARY', json, baseEnvelope);
      expect(result.verifiedFactCount).toBe(2);
      expect(result.criticalConstraints).toHaveLength(1);
    });

    it('rejects verifiedFactCount exceeding supplied verified facts count', () => {
      const json = JSON.stringify({
        executiveSummary: 'Summary with invented verified facts.',
        verifiedFactCount: 15, // Only 2 verified facts supplied in baseEnvelope!
        criticalConstraints: ['Constraint 1'],
        unitEconomicsSummary: 'Unit economics',
      });

      expect(() =>
        OutputValidator.validateOutput('BUSINESS_TWIN_SUMMARY', json, baseEnvelope)
      ).toThrow('exceeds supplied verified facts');
    });

    it('rejects non-integer or negative verifiedFactCount', () => {
      const json = JSON.stringify({
        executiveSummary: 'Summary',
        verifiedFactCount: -1,
        criticalConstraints: [],
        unitEconomicsSummary: 'Unit economics',
      });

      expect(() =>
        OutputValidator.validateOutput('BUSINESS_TWIN_SUMMARY', json, baseEnvelope)
      ).toThrow('MALFORMED_AI_OUTPUT: verifiedFactCount must be an integer >= 0.');
    });
  });

  describe('6. SEO_CONTENT_SUGGESTION', () => {
    it('accepts valid SEO content suggestion', () => {
      const json = JSON.stringify({
        suggestedKeywords: ['bosphorus fine dining', 'istanbul private event venue'],
        contentGaps: ['Missing private dining room floor plan and pricing'],
        recommendedAction: 'Create dedicated landing page for private events with instant quote calculator.',
      });

      const result = OutputValidator.validateOutput('SEO_CONTENT_SUGGESTION', json, baseEnvelope);
      expect(result.suggestedKeywords).toHaveLength(2);
      expect(result.contentGaps).toHaveLength(1);
    });

    it('rejects empty suggestedKeywords', () => {
      const json = JSON.stringify({
        suggestedKeywords: [],
        contentGaps: ['Gap 1'],
        recommendedAction: 'Action 1',
      });

      expect(() =>
        OutputValidator.validateOutput('SEO_CONTENT_SUGGESTION', json, baseEnvelope)
      ).toThrow('MALFORMED_AI_OUTPUT: suggestedKeywords must be a non-empty array of strings.');
    });
  });

  describe('7. GROWTH_ACTION_DRAFT', () => {
    it('accepts valid growth action draft with exact evidence citation and enforces requiresHumanApproval === true', () => {
      const json = JSON.stringify({
        title: 'Dispatch VIP Lead SLA Alert',
        summary: 'Alert floor manager when VIP inquiries wait longer than 10 minutes.',
        hypothesis: 'Immediate routing recovers 15% of abandoned table bookings.',
        evidenceReferences: ['EV-101'],
        recommendedSteps: ['Configure webhook notification to floor manager on-call device'],
        expectedMechanism: 'Rapid response increases booking commitment probability.',
        riskLevel: 'LOW',
        requiresHumanApproval: false, // Model attempts to bypass human approval!
        actionType: 'high_intent_sla_dispatch',
        suggestedPayload: { targetSlaMinutes: 10 },
      });

      const result = OutputValidator.validateOutput('GROWTH_ACTION_DRAFT', json, baseEnvelope);
      expect(result.requiresHumanApproval).toBe(true); // STRICTLY enforced as true
      expect(result.estimatedImpactMinor).toBe(150000); // Deterministic impact from envelope metrics
      expect(result.evidenceReferences).toEqual(['EV-101']);
    });

    it('rejects hallucinated evidence ID in growth action draft', () => {
      const json = JSON.stringify({
        title: 'Automate Table Pricing',
        summary: 'Adjust table pricing dynamically.',
        hypothesis: 'Dynamic pricing improves yield.',
        evidenceReferences: ['EV-999'], // Hallucinated!
        requiresHumanApproval: true,
      });

      expect(() =>
        OutputValidator.validateOutput('GROWTH_ACTION_DRAFT', json, baseEnvelope)
      ).toThrow('INVALID_EVIDENCE_REFERENCE: Cited evidence reference "EV-999" does not exist in input evidence context.');
    });

    it('rejects growth action draft with empty evidence references', () => {
      const json = JSON.stringify({
        title: 'No Evidence Action',
        summary: 'Action without evidence.',
        hypothesis: 'Hypothesis without evidence.',
        evidenceReferences: [],
        requiresHumanApproval: true,
      });

      expect(() =>
        OutputValidator.validateOutput('GROWTH_ACTION_DRAFT', json, baseEnvelope)
      ).toThrow('NO_EVIDENCE_CLAIM: Growth action failed to cite provided evidence references.');
    });
  });
});
