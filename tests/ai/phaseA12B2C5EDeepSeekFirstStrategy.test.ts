/**
 * @file tests/ai/phaseA12B2C5EDeepSeekFirstStrategy.test.ts
 * @description Unit tests for Phase A.12B.2C-5E DeepSeek-First Single-Provider Strategy.
 * 
 * STRICT INVARIANTS:
 * - Pure offline tests.
 * - ZERO provider network calls (DeepSeek, Gemini, etc.).
 * - ZERO live credentials used.
 * - productionRoutingEnforcementAllowed remains strictly false.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  STRATEGY_ID,
  ACTIVE_PREFERRED_PROVIDER,
  ACTIVE_PREFERRED_MODEL,
  DOCUMENTED_VERSION,
  INTERACTIVE_TIMEOUT_MS,
  CROSS_PROVIDER_FALLBACK_ENABLED,
  GEMINI_CURRENT_STATUS,
  OFF_PEAK_CANDIDATE,
  PEAK_CANDIDATE,
  DEEPSEEK_OFF_PEAK_PRICING,
  DEEPSEEK_PEAK_PRICING,
  PEAK_WINDOW_INTERVALS_UTC,
  PEAK_DAYS_UTC,
  BACKGROUND_PREFERRED_PROVIDER,
  BACKGROUND_PREFERRED_WINDOW,
  BACKGROUND_PEAK_BEHAVIOR,
  FUTURE_CERTIFICATION_PLAN,
  DEEPSEEK_FIRST_PROVIDER_STRATEGY,
  getPricingWindow,
  isPeakWindow,
} from '../../worker/ai/canary/deepSeekFirstProviderStrategy';
import { BoundedCanaryRunner } from '../../worker/ai/canary/boundedCanaryRunner';
import { CANARY_SPECIFICATION_VERSION } from '../../worker/ai/canary/canarySpecification';
import { resolveRoutingPolicyDecision } from '../../worker/ai/routingPolicy';
import { TaskType } from '../../worker/ai/types';

describe('Phase A.12B.2C-5E DeepSeek-First Single-Provider Strategy Seal', () => {
  let globalFetchSpy: any;

  beforeEach(() => {
    globalFetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    globalFetchSpy.mockRestore();
  });

  // 1. strategy is DEEPSEEK_FIRST_SINGLE_PROVIDER_V1
  it('1. strategy is DEEPSEEK_FIRST_SINGLE_PROVIDER_V1', () => {
    expect(STRATEGY_ID).toBe('DEEPSEEK_FIRST_SINGLE_PROVIDER_V1');
    expect(DEEPSEEK_FIRST_PROVIDER_STRATEGY.strategyId).toBe('DEEPSEEK_FIRST_SINGLE_PROVIDER_V1');
  });

  // 2. preferred provider is deepseek
  it('2. preferred provider is deepseek', () => {
    expect(ACTIVE_PREFERRED_PROVIDER).toBe('deepseek');
    expect(DEEPSEEK_FIRST_PROVIDER_STRATEGY.activePreferredProvider).toBe('deepseek');
  });

  // 3. preferred model is deepseek-v4-flash
  it('3. preferred model is deepseek-v4-flash (version DeepSeek-V4-Flash-0731)', () => {
    expect(ACTIVE_PREFERRED_MODEL).toBe('deepseek-v4-flash');
    expect(DOCUMENTED_VERSION).toBe('DeepSeek-V4-Flash-0731');
    expect(DEEPSEEK_FIRST_PROVIDER_STRATEGY.activePreferredModel).toBe('deepseek-v4-flash');
    expect(DEEPSEEK_FIRST_PROVIDER_STRATEGY.documentedVersion).toBe('DeepSeek-V4-Flash-0731');
  });

  // 4. interactive timeout remains 15000
  it('4. interactive timeout remains 15000 ms', () => {
    expect(INTERACTIVE_TIMEOUT_MS).toBe(15000);
    expect(DEEPSEEK_FIRST_PROVIDER_STRATEGY.interactiveTimeoutMs).toBe(15000);
  });

  // 5. cross-provider fallback is false
  it('5. cross-provider fallback is false', () => {
    expect(CROSS_PROVIDER_FALLBACK_ENABLED).toBe(false);
    expect(DEEPSEEK_FIRST_PROVIDER_STRATEGY.crossProviderFallbackEnabled).toBe(false);
  });

  // 6. Gemini status is DORMANT_UNSELECTED_PROVIDER
  it('6. Gemini status is DORMANT_UNSELECTED_PROVIDER', () => {
    expect(GEMINI_CURRENT_STATUS).toBe('DORMANT_UNSELECTED_PROVIDER');
    expect(DEEPSEEK_FIRST_PROVIDER_STRATEGY.geminiCurrentStatus).toBe('DORMANT_UNSELECTED_PROVIDER');
  });

  // 7. OFF_PEAK candidate is correct
  it('7. OFF_PEAK candidate is deepseek-v4-flash-offpeak-low', () => {
    expect(OFF_PEAK_CANDIDATE).toBe('deepseek-v4-flash-offpeak-low');
    expect(DEEPSEEK_FIRST_PROVIDER_STRATEGY.offPeakCandidate).toBe('deepseek-v4-flash-offpeak-low');
  });

  // 8. PEAK candidate is correct
  it('8. PEAK candidate is deepseek-v4-flash-peak-low', () => {
    expect(PEAK_CANDIDATE).toBe('deepseek-v4-flash-peak-low');
    expect(DEEPSEEK_FIRST_PROVIDER_STRATEGY.peakCandidate).toBe('deepseek-v4-flash-peak-low');
  });

  // 9. OFF_PEAK prices: 0.007 / 0.22 / 0.66
  it('9. OFF_PEAK prices are 0.007 / 0.22 / 0.66 per 1M tokens', () => {
    expect(DEEPSEEK_OFF_PEAK_PRICING.cacheHitInputUsd).toBe(0.007);
    expect(DEEPSEEK_OFF_PEAK_PRICING.cacheMissInputUsd).toBe(0.22);
    expect(DEEPSEEK_OFF_PEAK_PRICING.outputUsd).toBe(0.66);
    expect(DEEPSEEK_FIRST_PROVIDER_STRATEGY.pricing.offPeak).toEqual({
      cacheHitInputUsd: 0.007,
      cacheMissInputUsd: 0.22,
      outputUsd: 0.66,
    });
  });

  // 10. PEAK prices: 0.014 / 0.44 / 1.32
  it('10. PEAK prices are 0.014 / 0.44 / 1.32 per 1M tokens', () => {
    expect(DEEPSEEK_PEAK_PRICING.cacheHitInputUsd).toBe(0.014);
    expect(DEEPSEEK_PEAK_PRICING.cacheMissInputUsd).toBe(0.44);
    expect(DEEPSEEK_PEAK_PRICING.outputUsd).toBe(1.32);
    expect(DEEPSEEK_FIRST_PROVIDER_STRATEGY.pricing.peak).toEqual({
      cacheHitInputUsd: 0.014,
      cacheMissInputUsd: 0.44,
      outputUsd: 1.32,
    });
  });

  // 11. PEAK is exactly 2x OFF_PEAK
  it('11. PEAK pricing is exactly 2.0x OFF_PEAK pricing across all dimensions', () => {
    expect(DEEPSEEK_PEAK_PRICING.cacheHitInputUsd).toBe(2 * DEEPSEEK_OFF_PEAK_PRICING.cacheHitInputUsd);
    expect(DEEPSEEK_PEAK_PRICING.cacheMissInputUsd).toBe(2 * DEEPSEEK_OFF_PEAK_PRICING.cacheMissInputUsd);
    expect(DEEPSEEK_PEAK_PRICING.outputUsd).toBe(2 * DEEPSEEK_OFF_PEAK_PRICING.outputUsd);
    expect(DEEPSEEK_FIRST_PROVIDER_STRATEGY.pricing.peakMultiplierVsOffPeak).toBe(2.0);
  });

  // 12. peak windows encoded correctly
  it('12. peak windows are correctly encoded (Monday-Friday 01:00-04:00 UTC and 06:00-10:00 UTC)', () => {
    expect(PEAK_DAYS_UTC).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']);
    expect(PEAK_WINDOW_INTERVALS_UTC).toEqual([
      { startHour: 1, endHour: 4 },
      { startHour: 6, endHour: 10 },
    ]);

    // Monday (2026-09-07) at 02:30 UTC -> PEAK
    const monPeak1 = new Date(Date.UTC(2026, 8, 7, 2, 30, 0));
    expect(getPricingWindow(monPeak1)).toBe('PEAK');
    expect(isPeakWindow(monPeak1)).toBe(true);

    // Monday (2026-09-07) at 07:15 UTC -> PEAK
    const monPeak2 = new Date(Date.UTC(2026, 8, 7, 7, 15, 0));
    expect(getPricingWindow(monPeak2)).toBe('PEAK');
    expect(isPeakWindow(monPeak2)).toBe(true);

    // Monday (2026-09-07) at 05:00 UTC -> OFF_PEAK
    const monOffPeak = new Date(Date.UTC(2026, 8, 7, 5, 0, 0));
    expect(getPricingWindow(monOffPeak)).toBe('OFF_PEAK');
    expect(isPeakWindow(monOffPeak)).toBe(false);

    // Monday (2026-09-07) at 11:00 UTC -> OFF_PEAK
    const monOffPeakAfternoon = new Date(Date.UTC(2026, 8, 7, 11, 0, 0));
    expect(getPricingWindow(monOffPeakAfternoon)).toBe('OFF_PEAK');

    // Saturday (2026-09-05) at 02:00 UTC -> OFF_PEAK (weekend)
    const satWeekend = new Date(Date.UTC(2026, 8, 5, 2, 0, 0));
    expect(getPricingWindow(satWeekend)).toBe('OFF_PEAK');
    expect(isPeakWindow(satWeekend)).toBe(false);

    // Sunday (2026-09-06) at 07:00 UTC -> OFF_PEAK (weekend)
    const sunWeekend = new Date(Date.UTC(2026, 8, 6, 7, 0, 0));
    expect(getPricingWindow(sunWeekend)).toBe('OFF_PEAK');
    expect(isPeakWindow(sunWeekend)).toBe(false);
  });

  // 13. background provider is DeepSeek
  it('13. background provider is DeepSeek', () => {
    expect(BACKGROUND_PREFERRED_PROVIDER).toBe('deepseek');
    expect(DEEPSEEK_FIRST_PROVIDER_STRATEGY.backgroundPreferredProvider).toBe('deepseek');
  });

  // 14. background preferred window is OFF_PEAK
  it('14. background preferred window is OFF_PEAK', () => {
    expect(BACKGROUND_PREFERRED_WINDOW).toBe('OFF_PEAK');
    expect(DEEPSEEK_FIRST_PROVIDER_STRATEGY.backgroundPreferredWindow).toBe('OFF_PEAK');
  });

  // 15. background PEAK behavior is DEFER_WHEN_SAFE
  it('15. background PEAK behavior is DEFER_WHEN_SAFE', () => {
    expect(BACKGROUND_PEAK_BEHAVIOR).toBe('DEFER_WHEN_SAFE');
    expect(DEEPSEEK_FIRST_PROVIDER_STRATEGY.backgroundPeakBehavior).toBe('DEFER_WHEN_SAFE');
  });

  // 16. no Gemini candidate participates in current active strategy
  it('16. no Gemini candidate participates in current active strategy', () => {
    expect(DEEPSEEK_FIRST_PROVIDER_STRATEGY.activePreferredProvider).not.toBe('gemini');
    expect(DEEPSEEK_FIRST_PROVIDER_STRATEGY.backgroundPreferredProvider).not.toBe('gemini');
    expect(DEEPSEEK_FIRST_PROVIDER_STRATEGY.geminiCurrentStatus).toBe('DORMANT_UNSELECTED_PROVIDER');
    expect(DEEPSEEK_FIRST_PROVIDER_STRATEGY.crossProviderFallbackEnabled).toBe(false);
    expect(DEEPSEEK_FIRST_PROVIDER_STRATEGY.futureCertification.mixedProviderMatrixRequired).toBe(false);
  });

  // 17. future OFF_PEAK certification planned calls = 7
  it('17. future OFF_PEAK certification planned calls = 7', () => {
    expect(FUTURE_CERTIFICATION_PLAN.stepA.plannedDirectCalls).toBe(7);
    expect(FUTURE_CERTIFICATION_PLAN.stepA.canonicalTaskCount).toBe(7);
  });

  // 18. future PEAK certification planned calls = 7
  it('18. future PEAK certification planned calls = 7', () => {
    expect(FUTURE_CERTIFICATION_PLAN.stepB.plannedDirectCalls).toBe(7);
    expect(FUTURE_CERTIFICATION_PLAN.stepB.canonicalTaskCount).toBe(7);
  });

  // 19. both future certification programs have cross-provider fallback = 0
  it('19. both future certification programs have cross-provider fallback = 0', () => {
    expect(FUTURE_CERTIFICATION_PLAN.stepA.crossProviderFallbackCalls).toBe(0);
    expect(FUTURE_CERTIFICATION_PLAN.stepB.crossProviderFallbackCalls).toBe(0);
  });

  // 20. future human authorization status = NOT_GRANTED
  it('20. future human authorization status is NOT_GRANTED and liveAuthorizationGranted is false', () => {
    expect(FUTURE_CERTIFICATION_PLAN.humanAuthorizationStatus).toBe('NOT_GRANTED');
    expect(FUTURE_CERTIFICATION_PLAN.liveAuthorizationGranted).toBe(false);
    expect(FUTURE_CERTIFICATION_PLAN.stepA.authorizationGranted).toBe(false);
    expect(FUTURE_CERTIFICATION_PLAN.stepB.authorizationGranted).toBe(false);
    expect(DEEPSEEK_FIRST_PROVIDER_STRATEGY.securityInvariants.liveAuthorizationGranted).toBe(false);
  });

  // 21. executeLiveCanary remains globally blocked under current v1.2
  it('21. executeLiveCanary remains globally blocked under current v1.2', async () => {
    expect(CANARY_SPECIFICATION_VERSION).toBe('a12b2c5-v1.2');

    const result = await BoundedCanaryRunner.executeLiveCanary({
      phase: 'A.12B.2C-5D',
      executionLane: 'INTERACTIVE',
      humanApproval: {
        approvedBy: 'lead@velnar.internal',
        approvalTimestamp: '2026-09-03T18:00:00.000Z',
        targetPhase: 'A.12B.2C-5D',
        approvalToken: 'dummy-token-for-test',
        maxBudgetMicroUsd: 50000,
        environmentTarget: 'CONTROLLED_CANARY',
        specificationVersion: CANARY_SPECIFICATION_VERSION,
        sourceCommitSha: 'adfcdd678463d119fd627d9a51f0fb0bbb8c51e2',
        runNonce: 'nonce_001',
      },
      capabilitySecret: 'secret_123',
    });

    expect(result.overallStatus).toBe('CANARY_KILL_SWITCH_TERMINATED');
    expect(result.killSwitchEvents[0].reason).toBe('UNAUTHORIZED_ENVIRONMENT');
    expect(result.killSwitchEvents[0].message).toContain('Dual-lane v1.2 live execution is blocked pending lane-specific certification');
    expect(result.transportAttemptCount).toBe(0);
    expect(result.productionRoutingEnforcementAllowed).toBe(false);
  });

  // 22. provider network calls during this phase = 0
  it('22. provider network calls during this phase = 0', () => {
    expect(globalFetchSpy).toHaveBeenCalledTimes(0);
    expect(DEEPSEEK_FIRST_PROVIDER_STRATEGY.securityInvariants.zeroProviderCalls).toBe(true);
    expect(DEEPSEEK_FIRST_PROVIDER_STRATEGY.securityInvariants.providerNetworkCalls).toBe(0);
  });

  // 23. productionRoutingEnforcementAllowed remains false
  it('23. productionRoutingEnforcementAllowed remains false', () => {
    expect(DEEPSEEK_FIRST_PROVIDER_STRATEGY.securityInvariants.productionRoutingEnforcementAllowed).toBe(false);

    const decision = resolveRoutingPolicyDecision({
      taskType: 'GROWTH_ACTION_DRAFT',
    });

    expect(decision.enforcementAllowed).toBe(false);
  });
});
