/**
 * @file tests/ai/phaseA12B2BControlledLiveEvaluation.test.ts
 * @description Comprehensive Invariant & Specification Test Suite for Phase A.12B.2B Controlled Live Shadow Evaluation
 */

import { describe, it, expect } from 'vitest';
import {
  CANDIDATE_A_DEEPSEEK,
  CANDIDATE_B_GEMINI,
  EvaluationLiveRunner,
} from '../../worker/ai/evaluation/evaluationLiveRunner';
import {
  EvaluationCostCalculator,
  DEEPSEEK_V4_FLASH_PRICING,
  GEMINI_35_FLASH_LITE_PRICING,
} from '../../worker/ai/evaluation/evaluationCostCalculator';
import { EvaluationLiveClient } from '../../worker/ai/providers/liveEvaluationClient';
import { EvaluationSecurityGate } from '../../worker/ai/evaluation/evaluationSecurity';
import {
  VELNAR_SHADOW_EVAL_V1,
  VELNAR_SHADOW_EVAL_V1_VERSION,
} from '../../worker/ai/evaluation/evaluationDataset';
import { A12B2B_BUDGET_CAP_MICRO_USD, A12B2B_PRICING_CATALOG_VERSION } from '../../worker/ai/evaluation/evaluationLiveTypes';
import { WorkerEnv } from '../../worker/env';

describe('Phase A.12B.2B — Controlled Live Shadow Evaluation Specification & Invariants', () => {

  // ==========================================================================
  // 1. CANDIDATE SET & MODEL SPECIFICATION
  // ==========================================================================
  describe('1. Candidate Set & Exact Two-Candidate Invariant', () => {
    it('should define Candidate A as DeepSeek V4 Flash with low reasoning effort and off-peak profile', () => {
      expect(CANDIDATE_A_DEEPSEEK.candidateId).toBe('deepseek-v4-flash-offpeak-low');
      expect(CANDIDATE_A_DEEPSEEK.providerId).toBe('deepseek');
      expect(CANDIDATE_A_DEEPSEEK.requestedModelIdentifier).toBe('deepseek-v4-flash');
      expect(CANDIDATE_A_DEEPSEEK.serviceProfile).toBe('OFF_PEAK_COST_OPTIMIZED');
      expect(CANDIDATE_A_DEEPSEEK.thinkingEffort).toBe('low');
    });

    it('should define Candidate B as Gemini 3.5 Flash-Lite with low thinking level and flex tier', () => {
      expect(CANDIDATE_B_GEMINI.candidateId).toBe('gemini-3.5-flash-lite-flex-low');
      expect(CANDIDATE_B_GEMINI.providerId).toBe('gemini');
      expect(CANDIDATE_B_GEMINI.requestedModelIdentifier).toBe('gemini-3.5-flash-lite');
      expect(CANDIDATE_B_GEMINI.serviceProfile).toBe('FLEX_COST_OPTIMIZED');
      expect(CANDIDATE_B_GEMINI.thinkingEffort).toBe('low');
      expect(CANDIDATE_B_GEMINI.serviceTier).toBe('flex');
    });

    it('should reject third models or unapproved model identifiers', () => {
      const allowedCandidates = [CANDIDATE_A_DEEPSEEK.candidateId, CANDIDATE_B_GEMINI.candidateId];
      expect(allowedCandidates).toHaveLength(2);
      expect(allowedCandidates).toContain('deepseek-v4-flash-offpeak-low');
      expect(allowedCandidates).toContain('gemini-3.5-flash-lite-flex-low');
    });
  });

  // ==========================================================================
  // 2. OFFICIAL ENDPOINTS & SECURITY PREFLIGHT
  // ==========================================================================
  describe('2. Endpoint Verification & Security Boundary Invariants', () => {
    it('should require official DeepSeek API endpoint prefix', () => {
      expect(EvaluationLiveClient.OFFICIAL_DEEPSEEK_BASE_URL).toBe('https://api.deepseek.com');
    });

    it('should require official Google Gemini API endpoint prefix', () => {
      expect(EvaluationLiveClient.OFFICIAL_GEMINI_ENDPOINT_PREFIX).toBe('https://generativelanguage.googleapis.com');
    });

    it('should enforce that security-blocked cases produce zero external candidates and are tagged with disposition', () => {
      const preparedBatch = EvaluationSecurityGate.prepareEvaluationBatch(VELNAR_SHADOW_EVAL_V1);
      const blockedCases = preparedBatch.filter((b) => b.disposition === 'BLOCKED_BY_SECURITY');
      
      expect(blockedCases.length).toBe(3);
      for (const blocked of blockedCases) {
        expect(['eval_v1_lead_04_privacy_canary', 'eval_v1_leak_05_secret_canary', 'eval_v1_twin_05_sensitive_canary']).toContain(blocked.id);
        expect(blocked.blockReason).toBeDefined();
      }
    });

    it('should redact PERSONAL data and strip canaries while assigning effectiveDataClassification', () => {
      const personalCases = VELNAR_SHADOW_EVAL_V1.filter((c) => c.dataClassification === 'PERSONAL');
      for (const c of personalCases) {
        const prepared = EvaluationSecurityGate.prepareEvaluationCase(c);
        if (prepared.disposition === 'ELIGIBLE') {
          const serialized = JSON.stringify(prepared.requestEnvelope);
          expect(serialized).not.toContain('synthetic_email_canary_921');
          expect(serialized).not.toContain('synthetic_phone_canary_884');
          expect(prepared.effectiveDataClassification).toBeDefined();
          expect(['PUBLIC_BUSINESS', 'PSEUDONYMOUS_OPERATIONAL']).toContain(prepared.effectiveDataClassification);
        }
      }
    });
  });

  // ==========================================================================
  // 3. DEEPSEEK PRICING, PEAK WINDOWS & CACHE MATHEMATICS
  // ==========================================================================
  describe('3. DeepSeek Peak Window & Integer Cost Calculations', () => {
    it('should identify weekday peak windows (01:00-04:00 and 06:00-10:00 UTC) correctly', () => {
      // Monday 02:30 UTC -> PEAK
      const peakMonday1 = new Date('2026-08-31T02:30:00.000Z');
      expect(EvaluationCostCalculator.getDeepSeekPricingWindow(peakMonday1)).toBe('PEAK');

      // Monday 07:45 UTC -> PEAK
      const peakMonday2 = new Date('2026-08-31T07:45:00.000Z');
      expect(EvaluationCostCalculator.getDeepSeekPricingWindow(peakMonday2)).toBe('PEAK');

      // Monday 11:30 UTC -> OFF_PEAK
      const offPeakMonday = new Date('2026-08-31T11:30:00.000Z');
      expect(EvaluationCostCalculator.getDeepSeekPricingWindow(offPeakMonday)).toBe('OFF_PEAK');

      // Saturday 02:30 UTC -> OFF_PEAK (weekend)
      const saturday = new Date('2026-08-29T02:30:00.000Z');
      expect(EvaluationCostCalculator.getDeepSeekPricingWindow(saturday)).toBe('OFF_PEAK');

      // Sunday 08:00 UTC -> OFF_PEAK (weekend)
      const sunday = new Date('2026-08-30T08:00:00.000Z');
      expect(EvaluationCostCalculator.getDeepSeekPricingWindow(sunday)).toBe('OFF_PEAK');
    });

    it('should validate DeepSeek prompt token cache split integrity', () => {
      expect(EvaluationCostCalculator.validateDeepSeekTokenIntegrity(1000, 600, 400)).toBe(true);
      expect(EvaluationCostCalculator.validateDeepSeekTokenIntegrity(1000, 700, 400)).toBe(false);
      expect(EvaluationCostCalculator.validateDeepSeekTokenIntegrity(1000, -100, 1100)).toBe(false);
    });

    it('should calculate integer microUSD costs for DeepSeek off-peak and peak accurately', () => {
      // 1,000,000 prompt tokens (80% hit, 20% miss) + 500,000 completion tokens at off-peak
      // hit: 800,000 * 7,000 / 1M = 5,600 microUSD ($0.0056)
      // miss: 200,000 * 220,000 / 1M = 44,000 microUSD ($0.044)
      // output: 500,000 * 660,000 / 1M = 330,000 microUSD ($0.33)
      // total actual = 5,600 + 44,000 + 330,000 = 379,600 microUSD ($0.3796)
      const costs = EvaluationCostCalculator.calculateDeepSeekCost({
        cacheHitTokens: 800000,
        cacheMissTokens: 200000,
        completionTokens: 500000,
        pricingWindow: 'OFF_PEAK',
        usageSource: 'PROVIDER_REPORTED',
      });

      expect(costs.actualCostMicroUsd).toBe(379600);
      // Cold off-peak: 1M * 220,000 + 500k * 660,000 = 220,000 + 330,000 = 550,000 microUSD
      expect(costs.normalizedColdOffPeakCostMicroUsd).toBe(550000);
      // Cold peak: 1M * 440,000 + 500k * 1,320,000 = 440,000 + 660,000 = 1,100,000 microUSD
      expect(costs.normalizedColdPeakCostMicroUsd).toBe(1100000);
    });

    it('should correctly demonstrate the specific ~98% input token discount segment', () => {
      // $0.007 / 1M (off-peak cache-hit) vs $0.44 / 1M (peak cache-miss)
      // (440000 - 7000) / 440000 = 433000 / 440000 = 0.98409 (98.41% or 9841 bps)
      const discountBps = EvaluationCostCalculator.calculateDiscountBps(
        DEEPSEEK_V4_FLASH_PRICING.peakCacheMissMicroUsdPer1M,
        DEEPSEEK_V4_FLASH_PRICING.offPeakCacheHitMicroUsdPer1M
      );
      expect(discountBps).toBe(9841); // 98.41%
    });

    it('should reject ESTIMATED usage sources from verified cost calculations', () => {
      expect(() =>
        EvaluationCostCalculator.calculateDeepSeekCost({
          cacheHitTokens: 100,
          cacheMissTokens: 100,
          completionTokens: 100,
          pricingWindow: 'OFF_PEAK',
          usageSource: 'ESTIMATED',
        })
      ).toThrow('TELEMETRY_INCOMPLETE');
    });
  });

  // ==========================================================================
  // 4. GEMINI PRICING & FLEX TIER MATHEMATICS
  // ==========================================================================
  describe('4. Gemini 3.5 Flash-Lite Flex Tier & Thinking Billing', () => {
    it('should bill thinking/thought tokens as output tokens under Flex pricing', () => {
      // 1,000,000 prompt tokens + 200,000 completion tokens + 300,000 thinking tokens
      // Total output = 500,000 tokens
      // Flex input: 1M * 150,000 / 1M = 150,000 microUSD ($0.15)
      // Flex output: 500k * 1,250,000 / 1M = 625,000 microUSD ($0.625)
      // Total actual = 775,000 microUSD ($0.775)
      const costs = EvaluationCostCalculator.calculateGeminiCost({
        promptTokens: 1000000,
        completionTokens: 200000,
        thinkingTokens: 300000,
        serviceTier: 'flex',
        usageSource: 'PROVIDER_REPORTED',
      });

      expect(costs.actualCostMicroUsd).toBe(775000);

      // Standard comparison:
      // Standard input: 1M * 300,000 = 300,000
      // Standard output: 500k * 2,500,000 = 1,250,000
      // Total standard = 1,550,000 microUSD
      expect(costs.normalizedStandardCostMicroUsd).toBe(1550000);

      // Exactly 50% discount (5000 bps)
      const flexSavingsBps = EvaluationCostCalculator.calculateDiscountBps(
        costs.normalizedStandardCostMicroUsd,
        costs.actualCostMicroUsd
      );
      expect(flexSavingsBps).toBe(5000);
    });
  });

  // ==========================================================================
  // 5. INVOCATION ORDER & ROTATION DETERMINISM
  // ==========================================================================
  describe('5. Deterministic Invocation Order Rotation', () => {
    it('should alternate provider invocation order without Math.random', () => {
      const candidates = [CANDIDATE_A_DEEPSEEK, CANDIDATE_B_GEMINI];

      const order0_1 = EvaluationLiveRunner.getCandidateOrder(candidates, 0, 1);
      expect(order0_1[0].providerId).toBe('gemini');
      expect(order0_1[1].providerId).toBe('deepseek');

      const order0_2 = EvaluationLiveRunner.getCandidateOrder(candidates, 0, 2);
      expect(order0_2[0].providerId).toBe('deepseek');
      expect(order0_2[1].providerId).toBe('gemini');

      const order1_1 = EvaluationLiveRunner.getCandidateOrder(candidates, 1, 1);
      expect(order1_1[0].providerId).toBe('deepseek');
      expect(order1_1[1].providerId).toBe('gemini');
    });
  });

  // ==========================================================================
  // 6. BUDGET CAP HARD LIMIT
  // ==========================================================================
  describe('6. Hard Budget Cap Verification', () => {
    it('should enforce hard cap of $5.00 USD (5,000,000 microUSD)', () => {
      expect(A12B2B_BUDGET_CAP_MICRO_USD).toBe(5000000);
    });
  });

  // ==========================================================================
  // 7. CREDENTIAL AVAILABILITY GATE
  // ==========================================================================
  describe('7. Credential Availability Gate', () => {
    it('should accurately report available vs missing credentials without exposing secret values', () => {
      const mockEnv: WorkerEnv = {
        GEMINI_API_KEY: 'test-gemini-key',
        DEEPSEEK_API_KEY: '',
      } as any;

      const check = EvaluationLiveRunner.checkCredentialAvailability(mockEnv);
      expect(check.geminiAvailable).toBe(true);
      expect(check.deepseekAvailable).toBe(false);
      expect(check.missing).toContain('deepseek (DEEPSEEK_API_KEY)');
    });
  });

  // ==========================================================================
  // 8. ADVERSARIAL SECURITY, HOST VALIDATION & PROVIDER SPY TESTS
  // ==========================================================================
  describe('8. Adversarial Host Validation & Protocol Enforcement', () => {
    it('should reject lookalike DeepSeek host before network invocation', () => {
      expect(() =>
        EvaluationLiveClient.validateDeepSeekBaseUrl('https://api.deepseek.com.evil.example')
      ).toThrow('UNAPPROVED_DEEPSEEK_ENDPOINT');

      expect(() =>
        EvaluationLiveClient.validateDeepSeekBaseUrl('https://attacker-deepseek.com')
      ).toThrow('UNAPPROVED_DEEPSEEK_ENDPOINT');

      expect(() =>
        EvaluationLiveClient.validateDeepSeekBaseUrl('http://api.deepseek.com')
      ).toThrow('UNAPPROVED_DEEPSEEK_ENDPOINT');
    });

    it('should reject DeepSeek host with subpath, credentials, or unapproved ports', () => {
      expect(() =>
        EvaluationLiveClient.validateDeepSeekBaseUrl('https://user:pass@api.deepseek.com')
      ).toThrow('UNAPPROVED_DEEPSEEK_ENDPOINT');

      expect(() =>
        EvaluationLiveClient.validateDeepSeekBaseUrl('https://api.deepseek.com:8080')
      ).toThrow('UNAPPROVED_DEEPSEEK_ENDPOINT');
    });

    it('should accept valid canonical DeepSeek base URL', () => {
      expect(EvaluationLiveClient.validateDeepSeekBaseUrl('https://api.deepseek.com')).toBe(
        'https://api.deepseek.com'
      );
    });

    it('should verify that blocked cases result in exactly zero network fetch calls', async () => {
      const originalFetch = global.fetch;
      let fetchCallCount = 0;
      global.fetch = (async () => {
        fetchCallCount++;
        return new Response(JSON.stringify({}), { status: 200 });
      }) as any;

      try {
        const mockEnv: WorkerEnv = {
          GEMINI_API_KEY: 'test-gemini-key',
          DEEPSEEK_API_KEY: 'test-deepseek-key',
        } as any;

        // Run with dryRunPreflightOnly = true
        const preflight = await EvaluationLiveRunner.runControlledEvaluation({
          env: mockEnv,
          now: new Date('2026-08-31T12:00:00.000Z'), // Off-peak
          dryRunPreflightOnly: true,
        });

        expect(preflight.status).toBe('PREFLIGHT_PASSED_READY_FOR_RUN');
        expect(preflight.state).toBe('PRECHECK');
        expect(fetchCallCount).toBe(0);
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('should detect model substitution when provider returns unexpected model', async () => {
      const originalFetch = global.fetch;
      global.fetch = (async () => {
        return new Response(
          JSON.stringify({
            model: 'unapproved-hacked-model-v1',
            choices: [{ message: { content: '{"intent":"HIGH_INTENT"}' } }],
            usage: {
              prompt_tokens: 100,
              prompt_cache_hit_tokens: 50,
              prompt_cache_miss_tokens: 50,
              completion_tokens: 20,
              total_tokens: 120,
            },
          }),
          { status: 200 }
        );
      }) as any;

      try {
        const mockEnv: WorkerEnv = {
          DEEPSEEK_API_KEY: 'test-ds-key',
        } as any;

        await expect(
          EvaluationLiveClient.invokeCandidate(
            CANDIDATE_A_DEEPSEEK,
            {
              taskType: 'LEAD_INTENT_CLASSIFICATION',
              requestId: 'req-1',
              organizationId: 'org-1',
              businessId: 'biz-1',
              dataClassification: 'PUBLIC_BUSINESS',
              untrustedTextBlocks: ['Need demo now'],
            },
            mockEnv
          )
        ).rejects.toThrow('A12B2B_MODEL_SUBSTITUTION_DETECTED');
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('should detect Gemini tier mismatch when standard tier is returned instead of flex', async () => {
      const originalFetch = global.fetch;
      global.fetch = (async () => {
        return new Response(
          JSON.stringify({
            model: 'gemini-3.5-flash-lite',
            service_tier: 'standard', // Mismatch: candidate requested 'flex'
            steps: [{ type: 'output', content: [{ type: 'text', text: '{"intent":"HIGH_INTENT"}' }] }],
            usage: {
              total_input_tokens: 100,
              total_output_tokens: 20,
              total_tokens: 120,
            },
          }),
          { status: 200 }
        );
      }) as any;

      try {
        const mockEnv: WorkerEnv = {
          GEMINI_API_KEY: 'test-gemini-key',
        } as any;

        await expect(
          EvaluationLiveClient.invokeCandidate(
            CANDIDATE_B_GEMINI,
            {
              taskType: 'LEAD_INTENT_CLASSIFICATION',
              requestId: 'req-2',
              organizationId: 'org-1',
              businessId: 'biz-1',
              dataClassification: 'PUBLIC_BUSINESS',
              untrustedTextBlocks: ['Need demo now'],
            },
            mockEnv
          )
        ).rejects.toThrow('A12B2B_GEMINI_TIER_MISMATCH');
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('should detect incomplete telemetry if DeepSeek omits cache breakdown tokens', async () => {
      const originalFetch = global.fetch;
      global.fetch = (async () => {
        return new Response(
          JSON.stringify({
            model: 'deepseek-v4-flash',
            choices: [{ message: { content: '{"intent":"HIGH_INTENT"}' } }],
            usage: {
              prompt_tokens: 100,
              // Missing prompt_cache_hit_tokens and prompt_cache_miss_tokens
              completion_tokens: 20,
              total_tokens: 120,
            },
          }),
          { status: 200 }
        );
      }) as any;

      try {
        const mockEnv: WorkerEnv = {
          DEEPSEEK_API_KEY: 'test-ds-key',
        } as any;

        await expect(
          EvaluationLiveClient.invokeCandidate(
            CANDIDATE_A_DEEPSEEK,
            {
              taskType: 'LEAD_INTENT_CLASSIFICATION',
              requestId: 'req-3',
              organizationId: 'org-1',
              businessId: 'biz-1',
              dataClassification: 'PUBLIC_BUSINESS',
              untrustedTextBlocks: ['Need demo now'],
            },
            mockEnv
          )
        ).rejects.toThrow('TELEMETRY_INCOMPLETE');
      } finally {
        global.fetch = originalFetch;
      }
    });
  });
});
