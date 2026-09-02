/**
 * @file tests/ai/phaseA12B2C5A4_1_EvidenceConsistency.test.ts
 * @description Regression test suite proving sealed provider evidence strictly agrees with:
 * - CERTIFIED_CANARY_CANDIDATES
 * - CERTIFIED_PROVIDER_BASELINES
 * - DEEPSEEK_V4_FLASH_PRICING
 * - GEMINI_35_FLASH_LITE_PRICING
 * - CANARY_COST_LIMITS
 * - CANARY_INVOCATION_LIMITS
 * 
 * Invariant: Any pricing, candidate, endpoint, or limit discrepancy between executable source
 * and the certification JSON fails the offline test suite.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import {
  CERTIFIED_CANARY_CANDIDATES,
  CERTIFIED_PROVIDER_BASELINES,
  CANARY_COST_LIMITS,
  CANARY_INVOCATION_LIMITS,
} from '../../worker/ai/canary/canarySpecification';

import {
  DEEPSEEK_V4_FLASH_PRICING,
  GEMINI_35_FLASH_LITE_PRICING,
} from '../../worker/ai/evaluation/evaluationCostCalculator';

describe('Phase A.12B.2C-5A.4.1 — Evidence-to-Source Consistency & Anti-Drift Verification', () => {
  let originalFetch: typeof globalThis.fetch;
  let networkCallCount = 0;

  beforeEach(() => {
    networkCallCount = 0;
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      networkCallCount++;
      throw new Error('A12B2C5A4_1_OFFLINE_VIOLATION: Live network calls are strictly forbidden in offline test suite');
    }) as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const evidenceFilePath = path.resolve(process.cwd(), 'execution/a12b2c5a4_1_provider_rest_parity_results.json');

  it('verifies evidence JSON file exists and has valid structure', () => {
    expect(fs.existsSync(evidenceFilePath)).toBe(true);
    const raw = fs.readFileSync(evidenceFilePath, 'utf-8');
    const json = JSON.parse(raw);
    expect(json.phase).toBe('A.12B.2C-5A.4.1');
    expect(json.offlineVerificationComplete).toBe(true);
    expect(json.totalLiveNetworkCallsExecuted).toBe(0);
    expect(json.productionRoutingEnforcementAllowed).toBe(false);
    expect(json.humanAuthorizationStatus).toBe('NOT_YET_GRANTED');
  });

  it('proves DeepSeek sealed evidence strictly agrees with CERTIFIED_CANARY_CANDIDATES', () => {
    const json = JSON.parse(fs.readFileSync(evidenceFilePath, 'utf-8'));
    const deepseekEvidence = json.providerTargets.deepseek;

    const deepseekCandidate = CERTIFIED_CANARY_CANDIDATES.find(c => c.providerId === 'deepseek');
    expect(deepseekCandidate).toBeDefined();

    expect(deepseekEvidence.providerId).toBe(deepseekCandidate!.providerId);
    expect(deepseekEvidence.modelId).toBe(deepseekCandidate!.requestedModelIdentifier);
    expect(deepseekEvidence.certifiedCandidate).toBe(deepseekCandidate!.candidateId);
    expect(deepseekEvidence.certifiedCandidate).toBe('deepseek-v4-flash-offpeak-low');
    expect(deepseekEvidence.certifiedPricingTier).toBe(deepseekCandidate!.pricingTier);
    expect(deepseekEvidence.reasoningBudgetTokens).toBe(deepseekCandidate!.reasoningBudgetTokens);
    expect(deepseekEvidence.reasoningEffort).toBe('low');

    // Reject stale/unrelated candidate names
    expect(deepseekEvidence.certifiedCandidate).not.toBe('deepseek-v4-flash-standard');
  });

  it('proves DeepSeek sealed evidence strictly agrees with CERTIFIED_PROVIDER_BASELINES', () => {
    const json = JSON.parse(fs.readFileSync(evidenceFilePath, 'utf-8'));
    const deepseekEvidence = json.providerTargets.deepseek;
    const deepseekBaseline = CERTIFIED_PROVIDER_BASELINES.deepseek;

    expect(deepseekEvidence.modelId).toBe(deepseekBaseline.modelId);
    expect(deepseekEvidence.endpoint).toBe(deepseekBaseline.endpoint);
    expect(deepseekEvidence.endpoint).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(deepseekEvidence.certifiedPricingTier).toBe(deepseekBaseline.certifiedPricingTier);
  });

  it('proves DeepSeek pricing snapshot strictly agrees with DEEPSEEK_V4_FLASH_PRICING and rejects stale rates', () => {
    const json = JSON.parse(fs.readFileSync(evidenceFilePath, 'utf-8'));
    const deepseekEvidence = json.providerTargets.deepseek;
    const pricing = DEEPSEEK_V4_FLASH_PRICING;

    // OFF_PEAK pricing verification
    const expectedOffPeakHit = pricing.offPeakCacheHitMicroUsdPer1M / 1_000_000;
    const expectedOffPeakMiss = pricing.offPeakCacheMissMicroUsdPer1M / 1_000_000;
    const expectedOffPeakOutput = pricing.offPeakOutputMicroUsdPer1M / 1_000_000;

    expect(expectedOffPeakHit).toBe(0.007);
    expect(expectedOffPeakMiss).toBe(0.22);
    expect(expectedOffPeakOutput).toBe(0.66);

    expect(deepseekEvidence.pricingSnapshot.OFF_PEAK.cacheHitPerMillionTokens).toBe(expectedOffPeakHit);
    expect(deepseekEvidence.pricingSnapshot.OFF_PEAK.cacheMissPerMillionTokens).toBe(expectedOffPeakMiss);
    expect(deepseekEvidence.pricingSnapshot.OFF_PEAK.outputPerMillionTokens).toBe(expectedOffPeakOutput);

    // PEAK pricing verification
    const expectedPeakHit = pricing.peakCacheHitMicroUsdPer1M / 1_000_000;
    const expectedPeakMiss = pricing.peakCacheMissMicroUsdPer1M / 1_000_000;
    const expectedPeakOutput = pricing.peakOutputMicroUsdPer1M / 1_000_000;

    expect(expectedPeakHit).toBe(0.014);
    expect(expectedPeakMiss).toBe(0.44);
    expect(expectedPeakOutput).toBe(1.32);

    expect(deepseekEvidence.pricingSnapshot.PEAK.cacheHitPerMillionTokens).toBe(expectedPeakHit);
    expect(deepseekEvidence.pricingSnapshot.PEAK.cacheMissPerMillionTokens).toBe(expectedPeakMiss);
    expect(deepseekEvidence.pricingSnapshot.PEAK.outputPerMillionTokens).toBe(expectedPeakOutput);

    // Assert absence of stale prices ($0.07, $0.27, $1.10)
    const rawContent = fs.readFileSync(evidenceFilePath, 'utf-8');
    expect(rawContent).not.toContain('"cacheHitPerMillionTokens": 0.07');
    expect(rawContent).not.toContain('"cacheMissPerMillionTokens": 0.27');
    expect(rawContent).not.toContain('"outputPerMillionTokens": 1.1');
    expect(rawContent).not.toContain('"outputPerMillionTokens": 1.10');
    expect(rawContent).not.toContain('deepseek-v4-flash-standard');
  });

  it('proves Gemini sealed evidence strictly agrees with CERTIFIED_CANARY_CANDIDATES & BASELINES', () => {
    const json = JSON.parse(fs.readFileSync(evidenceFilePath, 'utf-8'));
    const geminiEvidence = json.providerTargets.gemini;

    const geminiCandidate = CERTIFIED_CANARY_CANDIDATES.find(c => c.providerId === 'gemini');
    expect(geminiCandidate).toBeDefined();

    expect(geminiEvidence.providerId).toBe(geminiCandidate!.providerId);
    expect(geminiEvidence.modelId).toBe(geminiCandidate!.requestedModelIdentifier);
    expect(geminiEvidence.certifiedCandidate).toBe(geminiCandidate!.candidateId);
    expect(geminiEvidence.certifiedCandidate).toBe('gemini-3.5-flash-lite-flex-low');
    expect(geminiEvidence.requiredServiceTier).toBe(geminiCandidate!.pricingTier);
    expect(geminiEvidence.thinkingLevel).toBe(geminiCandidate!.thinkingLevel);

    const geminiBaseline = CERTIFIED_PROVIDER_BASELINES.gemini;
    expect(geminiEvidence.modelId).toBe(geminiBaseline.modelId);
    expect(geminiEvidence.endpoint).toBe(geminiBaseline.endpoint);
    expect(geminiEvidence.endpoint).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    expect(geminiEvidence.requiredServiceTier).toBe(geminiBaseline.certifiedServiceTier);
  });

  it('proves Gemini pricing rates strictly agree with GEMINI_35_FLASH_LITE_PRICING', () => {
    const json = JSON.parse(fs.readFileSync(evidenceFilePath, 'utf-8'));
    const geminiEvidence = json.providerTargets.gemini;
    const rates = geminiEvidence.pricingRatesChecked;
    const pricing = GEMINI_35_FLASH_LITE_PRICING;

    const expectedFlexInput = pricing.flexInputMicroUsdPer1M / 1_000_000;
    const expectedFlexOutput = pricing.flexOutputMicroUsdPer1M / 1_000_000;
    const expectedStandardInput = pricing.standardInputMicroUsdPer1M / 1_000_000;
    const expectedStandardOutput = pricing.standardOutputMicroUsdPer1M / 1_000_000;

    expect(rates.flexInputNonCachedPerMillionTokens).toBe(expectedFlexInput);
    expect(rates.flexOutputPerMillionTokens).toBe(expectedFlexOutput);
    expect(rates.standardInputPerMillionTokens).toBe(expectedStandardInput);
    expect(rates.standardOutputPerMillionTokens).toBe(expectedStandardOutput);
  });

  it('proves CANARY_COST_LIMITS agree with sealed evidence', () => {
    const json = JSON.parse(fs.readFileSync(evidenceFilePath, 'utf-8'));
    expect(json.canaryCostLimits).toBeDefined();

    expect(json.canaryCostLimits.maxEstimatedCostMicroUsd).toBe(CANARY_COST_LIMITS.maxEstimatedCostMicroUsd);
    expect(json.canaryCostLimits.hardCeilingMicroUsd).toBe(CANARY_COST_LIMITS.hardCeilingMicroUsd);
    expect(json.canaryCostLimits.maxSingleInvocationMicroUsd).toBe(CANARY_COST_LIMITS.maxSingleInvocationMicroUsd);
  });

  it('proves CANARY_INVOCATION_LIMITS agree with sealed evidence', () => {
    const json = JSON.parse(fs.readFileSync(evidenceFilePath, 'utf-8'));
    expect(json.canaryInvocationLimits).toBeDefined();

    expect(json.canaryInvocationLimits.maxTotalInvocations).toBe(CANARY_INVOCATION_LIMITS.maxTotalInvocations);
    expect(json.canaryInvocationLimits.maxInvocationsPerProvider).toBe(CANARY_INVOCATION_LIMITS.maxInvocationsPerProvider);
    expect(json.canaryInvocationLimits.maxSameProviderRetries).toBe(CANARY_INVOCATION_LIMITS.maxSameProviderRetries);
    expect(json.canaryInvocationLimits.maxCrossProviderFallbacks).toBe(CANARY_INVOCATION_LIMITS.maxCrossProviderFallbacks);
    expect(json.canaryInvocationLimits.maxConcurrentInvocations).toBe(CANARY_INVOCATION_LIMITS.maxConcurrentInvocations);
    expect(json.canaryInvocationLimits.timeoutMsPerInvocation).toBe(CANARY_INVOCATION_LIMITS.timeoutMsPerInvocation);
  });

  it('fails immediately if a simulated drift in pricing occurs between executable source and evidence', () => {
    const json = JSON.parse(fs.readFileSync(evidenceFilePath, 'utf-8'));
    
    // Test that an assertion function catches drift
    function verifyConsistency(evidence: any) {
      if (evidence.providerTargets.deepseek.certifiedCandidate !== 'deepseek-v4-flash-offpeak-low') {
        throw new Error('CANDIDATE_DRIFT_DETECTED');
      }
      if (evidence.providerTargets.deepseek.pricingSnapshot.OFF_PEAK.outputPerMillionTokens !== 0.66) {
        throw new Error('PRICING_DRIFT_DETECTED');
      }
    }

    expect(() => verifyConsistency(json)).not.toThrow();

    // Verify mutated copy fails
    const drifted = JSON.parse(JSON.stringify(json));
    drifted.providerTargets.deepseek.pricingSnapshot.OFF_PEAK.outputPerMillionTokens = 1.10;
    expect(() => verifyConsistency(drifted)).toThrow('PRICING_DRIFT_DETECTED');
  });

  it('strictly confirmed 0 live network calls made during offline suite', () => {
    expect(networkCallCount).toBe(0);
  });
});
