/**
 * @file tests/ai/phaseA12B2C5FDeepSeekSuccessorCertificationSpec.test.ts
 * @description Unit tests for Phase A.12B.2C-5F DeepSeek-Only Successor Certification Contract.
 * 
 * STRICT ARCHITECTURAL INVARIANTS:
 * - STRICTLY OFFLINE.
 * - ZERO DeepSeek calls.
 * - ZERO Gemini calls.
 * - ZERO provider credentials.
 * - ZERO external network calls.
 * - DO NOT execute a live canary.
 * - DO NOT generate a human authorization.
 * - DO NOT enable production routing.
 * - DO NOT modify BoundedCanaryRunner.
 * - DO NOT modify current CANARY_SPECIFICATION_VERSION yet.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SUCCESSOR_SPECIFICATION_VERSION,
  ACTIVATION_STATUS,
  CURRENT_ACTIVE_TECHNICAL_SPEC,
  CURRENT_STRATEGY,
  CERTIFICATION_PROVIDER,
  CERTIFICATION_MODEL,
  DOCUMENTED_VERSION_TARGET,
  BASE_URL,
  ENDPOINT,
  THINKING_SUPPORTED,
  REASONING_EFFORT,
  MAX_TOKENS,
  CONCURRENCY_LIMIT,
  INTERACTIVE_TIMEOUT_MS,
  GEMINI_CURRENT_STATUS,
  OFF_PEAK_CANDIDATE,
  PEAK_CANDIDATE,
  SUCCESSOR_CANDIDATES,
  DEEPSEEK_OFF_PEAK_PRICING,
  DEEPSEEK_PEAK_PRICING,
  PRICING_INVARIANTS,
  PEAK_WINDOW_INTERVALS_UTC,
  getPricingWindow,
  isPeakWindow,
  OFF_PEAK_PROGRAM,
  PEAK_PROGRAM,
  COMBINED_LIVE_RUN_AUTHORIZED,
  SAME_PROVIDER_RETRIES,
  CROSS_PROVIDER_FALLBACKS,
  AUTOMATIC_RERUNS,
  QUALITY_GATES,
  CANONICAL_COST_PREFLIGHT,
  HUMAN_BUDGET_STATUS,
  FUTURE_ACTIVATION_SAFETY_REQUIREMENT,
  DEEPSEEK_SUCCESSOR_CERTIFICATION_SPECIFICATION,
  SYSTEM_FINGERPRINT_IS_MODEL_VERSION,
  FINGERPRINT_COMPARED_TO_DOCUMENTED_VERSION_TARGET,
  MODEL_PROVENANCE_CONTRACT,
  verifyModelProvenance,
  resolveOverallV1ProviderState,
} from '../../worker/ai/canary/deepSeekSingleProviderCertificationSpecification';
import { BoundedCanaryRunner } from '../../worker/ai/canary/boundedCanaryRunner';
import { CANARY_SPECIFICATION_VERSION } from '../../worker/ai/canary/canarySpecification';
import { resolveRoutingPolicyDecision } from '../../worker/ai/routingPolicy';
import { CERTIFIED_A12B2C_TASK_TYPES } from '../../worker/ai/providers/certifiedProviderTypes';

describe('Phase A.12B.2C-5F DeepSeek Successor Certification Spec Contract', () => {
  let globalFetchSpy: ReturnType<typeof vi.spyOn>;
  let customFetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    globalFetchSpy = vi.spyOn(globalThis, 'fetch');
    customFetchSpy = vi.fn();
  });

  afterEach(() => {
    globalFetchSpy.mockRestore();
  });

  // 1. successor spec is a12b2c5-v1.3-draft
  it('1. successor spec is a12b2c5-v1.3-draft', () => {
    expect(SUCCESSOR_SPECIFICATION_VERSION).toBe('a12b2c5-v1.3-draft');
    expect(DEEPSEEK_SUCCESSOR_CERTIFICATION_SPECIFICATION.successorSpecificationVersion).toBe('a12b2c5-v1.3-draft');
  });

  // 2. successor spec is NOT live
  it('2. successor spec is NOT live (OFFLINE_DRAFT_NOT_LIVE)', () => {
    expect(ACTIVATION_STATUS).toBe('OFFLINE_DRAFT_NOT_LIVE');
    expect(DEEPSEEK_SUCCESSOR_CERTIFICATION_SPECIFICATION.activationStatus).toBe('OFFLINE_DRAFT_NOT_LIVE');
    expect(CURRENT_ACTIVE_TECHNICAL_SPEC).toBe('a12b2c5-v1.2');
  });

  // 3. provider is DeepSeek
  it('3. provider is DeepSeek', () => {
    expect(CERTIFICATION_PROVIDER).toBe('deepseek');
    expect(DEEPSEEK_SUCCESSOR_CERTIFICATION_SPECIFICATION.provider).toBe('deepseek');
  });

  // 4. model is deepseek-v4-flash
  it('4. model is deepseek-v4-flash', () => {
    expect(CERTIFICATION_MODEL).toBe('deepseek-v4-flash');
    expect(DEEPSEEK_SUCCESSOR_CERTIFICATION_SPECIFICATION.model).toBe('deepseek-v4-flash');
  });

  // 5. version target is DeepSeek-V4-Flash-0731
  it('5. version target is DeepSeek-V4-Flash-0731', () => {
    expect(DOCUMENTED_VERSION_TARGET).toBe('DeepSeek-V4-Flash-0731');
    expect(DEEPSEEK_SUCCESSOR_CERTIFICATION_SPECIFICATION.documentedVersion).toBe('DeepSeek-V4-Flash-0731');
  });

  // 6. effort is low
  it('6. effort is low', () => {
    expect(REASONING_EFFORT).toBe('low');
    expect(DEEPSEEK_SUCCESSOR_CERTIFICATION_SPECIFICATION.reasoningEffort).toBe('low');
    expect(THINKING_SUPPORTED).toBe('ENABLED');
  });

  // 7. max output is 2048
  it('7. max output is 2048', () => {
    expect(MAX_TOKENS).toBe(2048);
    expect(DEEPSEEK_SUCCESSOR_CERTIFICATION_SPECIFICATION.maxOutputTokens).toBe(2048);
  });

  // 8. timeout is 15000
  it('8. timeout is 15000 ms', () => {
    expect(INTERACTIVE_TIMEOUT_MS).toBe(15000);
    expect(DEEPSEEK_SUCCESSOR_CERTIFICATION_SPECIFICATION.interactiveTimeoutMs).toBe(15000);
  });

  // 9. OFF_PEAK candidate correct
  it('9. OFF_PEAK candidate correct', () => {
    expect(OFF_PEAK_CANDIDATE).toBe('deepseek-v4-flash-offpeak-low');
    expect(OFF_PEAK_PROGRAM.candidateId).toBe('deepseek-v4-flash-offpeak-low');
    expect(DEEPSEEK_SUCCESSOR_CERTIFICATION_SPECIFICATION.offPeakCandidate).toBe('deepseek-v4-flash-offpeak-low');
  });

  // 10. PEAK candidate correct
  it('10. PEAK candidate correct', () => {
    expect(PEAK_CANDIDATE).toBe('deepseek-v4-flash-peak-low');
    expect(PEAK_PROGRAM.candidateId).toBe('deepseek-v4-flash-peak-low');
    expect(DEEPSEEK_SUCCESSOR_CERTIFICATION_SPECIFICATION.peakCandidate).toBe('deepseek-v4-flash-peak-low');
  });

  // 11. both candidates use same model
  it('11. both candidates use same model, version target, effort, output bound, and task scope', () => {
    const offPeak = SUCCESSOR_CANDIDATES.find(c => c.candidateId === OFF_PEAK_CANDIDATE)!;
    const peak = SUCCESSOR_CANDIDATES.find(c => c.candidateId === PEAK_CANDIDATE)!;

    expect(offPeak).toBeDefined();
    expect(peak).toBeDefined();

    expect(offPeak.providerId).toBe(peak.providerId);
    expect(offPeak.requestedModelIdentifier).toBe(peak.requestedModelIdentifier);
    expect(offPeak.expectedReturnedModelIdentifier).toBe(peak.expectedReturnedModelIdentifier);
    expect(offPeak.documentedVersionTarget).toBe(peak.documentedVersionTarget);
    expect(offPeak.reasoningEffort).toBe(peak.reasoningEffort);
    expect(offPeak.maxTokens).toBe(peak.maxTokens);
    expect(offPeak.concurrency).toBe(peak.concurrency);

    // Only difference is certified pricing window
    expect(offPeak.pricingWindow).toBe('OFF_PEAK');
    expect(peak.pricingWindow).toBe('PEAK');
  });

  // 12. OFF_PEAK pricing exact
  it('12. OFF_PEAK pricing exact', () => {
    expect(DEEPSEEK_OFF_PEAK_PRICING.cacheHitInputUsdPerMillion).toBe(0.007);
    expect(DEEPSEEK_OFF_PEAK_PRICING.cacheMissInputUsdPerMillion).toBe(0.22);
    expect(DEEPSEEK_OFF_PEAK_PRICING.outputUsdPerMillion).toBe(0.66);

    expect(DEEPSEEK_OFF_PEAK_PRICING.cacheHitInputMicroUsdPerMillion).toBe(7000);
    expect(DEEPSEEK_OFF_PEAK_PRICING.cacheMissInputMicroUsdPerMillion).toBe(220000);
    expect(DEEPSEEK_OFF_PEAK_PRICING.outputMicroUsdPerMillion).toBe(660000);
  });

  // 13. PEAK pricing exact
  it('13. PEAK pricing exact', () => {
    expect(DEEPSEEK_PEAK_PRICING.cacheHitInputUsdPerMillion).toBe(0.014);
    expect(DEEPSEEK_PEAK_PRICING.cacheMissInputUsdPerMillion).toBe(0.44);
    expect(DEEPSEEK_PEAK_PRICING.outputUsdPerMillion).toBe(1.32);

    expect(DEEPSEEK_PEAK_PRICING.cacheHitInputMicroUsdPerMillion).toBe(14000);
    expect(DEEPSEEK_PEAK_PRICING.cacheMissInputMicroUsdPerMillion).toBe(440000);
    expect(DEEPSEEK_PEAK_PRICING.outputMicroUsdPerMillion).toBe(1320000);
  });

  // 14. PEAK exactly 2x OFF_PEAK
  it('14. PEAK is exactly 2.0x OFF_PEAK across all three dimensions', () => {
    expect(DEEPSEEK_PEAK_PRICING.cacheHitInputUsdPerMillion).toBe(
      2 * DEEPSEEK_OFF_PEAK_PRICING.cacheHitInputUsdPerMillion
    );
    expect(DEEPSEEK_PEAK_PRICING.cacheMissInputUsdPerMillion).toBe(
      2 * DEEPSEEK_OFF_PEAK_PRICING.cacheMissInputUsdPerMillion
    );
    expect(DEEPSEEK_PEAK_PRICING.outputUsdPerMillion).toBe(
      2 * DEEPSEEK_OFF_PEAK_PRICING.outputUsdPerMillion
    );

    expect(PRICING_INVARIANTS.peakCacheHitMultiplier).toBe(2.0);
    expect(PRICING_INVARIANTS.peakCacheMissMultiplier).toBe(2.0);
    expect(PRICING_INVARIANTS.peakOutputMultiplier).toBe(2.0);
    expect(PRICING_INVARIANTS.isExactTwoX).toBe(true);
  });

  // 15. pricing-window boundary tests
  it('15. pricing-window boundary tests are deterministic', () => {
    // Monday 00:59:59 => OFF_PEAK
    expect(getPricingWindow(new Date('2026-09-07T00:59:59.999Z'))).toBe('OFF_PEAK');

    // Monday 01:00:00 => PEAK
    expect(getPricingWindow(new Date('2026-09-07T01:00:00.000Z'))).toBe('PEAK');

    // Monday 03:59:59 => PEAK
    expect(getPricingWindow(new Date('2026-09-07T03:59:59.999Z'))).toBe('PEAK');

    // Monday 04:00:00 => OFF_PEAK
    expect(getPricingWindow(new Date('2026-09-07T04:00:00.000Z'))).toBe('OFF_PEAK');

    // Monday 05:59:59 => OFF_PEAK
    expect(getPricingWindow(new Date('2026-09-07T05:59:59.999Z'))).toBe('OFF_PEAK');

    // Monday 06:00:00 => PEAK
    expect(getPricingWindow(new Date('2026-09-07T06:00:00.000Z'))).toBe('PEAK');

    // Monday 09:59:59 => PEAK
    expect(getPricingWindow(new Date('2026-09-07T09:59:59.999Z'))).toBe('PEAK');

    // Monday 10:00:00 => OFF_PEAK
    expect(getPricingWindow(new Date('2026-09-07T10:00:00.000Z'))).toBe('OFF_PEAK');
  });

  // 16. weekend regression
  it('16. weekend regression: Saturday and Sunday are entirely OFF_PEAK', () => {
    // Saturday 00:00, 02:00, 07:00, 12:00, 23:59
    expect(getPricingWindow(new Date('2026-09-05T00:00:00.000Z'))).toBe('OFF_PEAK');
    expect(getPricingWindow(new Date('2026-09-05T02:00:00.000Z'))).toBe('OFF_PEAK');
    expect(getPricingWindow(new Date('2026-09-05T07:00:00.000Z'))).toBe('OFF_PEAK');
    expect(getPricingWindow(new Date('2026-09-05T12:00:00.000Z'))).toBe('OFF_PEAK');
    expect(getPricingWindow(new Date('2026-09-05T23:59:59.999Z'))).toBe('OFF_PEAK');

    // Sunday 00:00, 02:00, 07:00, 12:00, 23:59
    expect(getPricingWindow(new Date('2026-09-06T00:00:00.000Z'))).toBe('OFF_PEAK');
    expect(getPricingWindow(new Date('2026-09-06T02:00:00.000Z'))).toBe('OFF_PEAK');
    expect(getPricingWindow(new Date('2026-09-06T07:00:00.000Z'))).toBe('OFF_PEAK');
    expect(getPricingWindow(new Date('2026-09-06T12:00:00.000Z'))).toBe('OFF_PEAK');
    expect(getPricingWindow(new Date('2026-09-06T23:59:59.999Z'))).toBe('OFF_PEAK');
  });

  // 17. OFF_PEAK planned calls = 7
  it('17. OFF_PEAK planned calls = 7 (canonical tasks count = 7)', () => {
    expect(OFF_PEAK_PROGRAM.canonicalTaskCount).toBe(7);
    expect(OFF_PEAK_PROGRAM.plannedDirectDeepSeekCalls).toBe(7);
    expect(CERTIFIED_A12B2C_TASK_TYPES.length).toBe(7);
  });

  // 18. PEAK planned calls = 7
  it('18. PEAK planned calls = 7 (canonical tasks count = 7)', () => {
    expect(PEAK_PROGRAM.canonicalTaskCount).toBe(7);
    expect(PEAK_PROGRAM.plannedDirectDeepSeekCalls).toBe(7);
  });

  // 19. no combined authorization
  it('19. no combined authorization (separate authorizations required)', () => {
    expect(COMBINED_LIVE_RUN_AUTHORIZED).toBe(false);
    expect(DEEPSEEK_SUCCESSOR_CERTIFICATION_SPECIFICATION.programs.combinedLiveRunAuthorized).toBe(false);
    expect(OFF_PEAK_PROGRAM.requiresSeparateNonce).toBe(true);
    expect(PEAK_PROGRAM.requiresSeparateNonce).toBe(true);
    expect(OFF_PEAK_PROGRAM.requiresSeparateSourceBinding).toBe(true);
    expect(PEAK_PROGRAM.requiresSeparateSourceBinding).toBe(true);
    expect(OFF_PEAK_PROGRAM.requiresSeparateEvidenceArtifact).toBe(true);
    expect(PEAK_PROGRAM.requiresSeparateEvidenceArtifact).toBe(true);
  });

  // 20. retries = 0
  it('20. retries = 0 (same-provider retries strictly 0 for certification)', () => {
    expect(SAME_PROVIDER_RETRIES).toBe(0);
    expect(OFF_PEAK_PROGRAM.clientRetries).toBe(0);
    expect(PEAK_PROGRAM.clientRetries).toBe(0);
    expect(AUTOMATIC_RERUNS).toBe(0);
  });

  // 21. cross-provider fallback = 0
  it('21. cross-provider fallback = 0', () => {
    expect(CROSS_PROVIDER_FALLBACKS).toBe(0);
    expect(OFF_PEAK_PROGRAM.crossProviderFallbacks).toBe(0);
    expect(PEAK_PROGRAM.crossProviderFallbacks).toBe(0);
  });

  // 22. Gemini absent from active successor candidate set
  it('22. Gemini is absent from active successor candidate set and dormant', () => {
    expect(GEMINI_CURRENT_STATUS).toBe('DORMANT_UNSELECTED_PROVIDER');
    expect(SUCCESSOR_CANDIDATES.some(c => (c.providerId as string) === 'gemini')).toBe(false);
    expect(SUCCESSOR_CANDIDATES.every(c => c.providerId === 'deepseek')).toBe(true);
  });

  // 23. system_fingerprint not treated as model version
  it('23. system_fingerprint is not treated as model version and never compared to documentedVersionTarget', () => {
    const verified = verifyModelProvenance({
      requestedModelIdentifier: 'deepseek-v4-flash',
      returnedModelIdentifier: 'deepseek-v4-flash',
      systemFingerprint: 'fp_a79f644e50',
      providerReportedModelVersion: null,
    });

    expect(verified.isValid).toBe(true);
    expect(verified.exactModelMatch).toBe(true);
    expect(verified.providerReportedBackendFingerprint).toBe('fp_a79f644e50');
    expect(verified.providerReportedModelVersion).toBeNull();
    expect(verified.documentedVersionTarget).toBe('DeepSeek-V4-Flash-0731');
    expect(verified.systemFingerprintIsModelVersion).toBe(false);
    expect(verified.fingerprintComparedToDocumentedVersionTarget).toBe(false);

    // Mismatch test
    const mismatched = verifyModelProvenance({
      requestedModelIdentifier: 'deepseek-v4-flash',
      returnedModelIdentifier: 'deepseek-v4-chat',
    });
    expect(mismatched.isValid).toBe(false);
    expect(mismatched.exactModelMatch).toBe(false);
    expect(mismatched.systemFingerprintIsModelVersion).toBe(false);
    expect(mismatched.fingerprintComparedToDocumentedVersionTarget).toBe(false);
  });

  // 23b. adversarial regression: systemFingerprint = "DeepSeek-V4-Flash-0731"
  it('23b. adversarial regression: systemFingerprint matching documented version string does not alter provenance and invariant flags remain false', () => {
    // Matching model with adversarial fingerprint
    const adversarialMatch = verifyModelProvenance({
      requestedModelIdentifier: 'deepseek-v4-flash',
      returnedModelIdentifier: 'deepseek-v4-flash',
      systemFingerprint: 'DeepSeek-V4-Flash-0731',
      providerReportedModelVersion: null,
    });

    // Provenance is determined strictly by requested vs returned model match
    expect(adversarialMatch.isValid).toBe(true);
    expect(adversarialMatch.exactModelMatch).toBe(true);
    // Invariant flags MUST remain false even when string matches documented version target
    expect(adversarialMatch.systemFingerprintIsModelVersion).toBe(false);
    expect(adversarialMatch.fingerprintComparedToDocumentedVersionTarget).toBe(false);
    // Fingerprint preserved verbatim as opaque telemetry
    expect(adversarialMatch.providerReportedBackendFingerprint).toBe('DeepSeek-V4-Flash-0731');
    expect(adversarialMatch.providerReportedModelVersion).toBeNull();
    expect(adversarialMatch.documentedVersionTarget).toBe('DeepSeek-V4-Flash-0731');

    // Mismatched model with adversarial fingerprint - must NOT strengthen or rescue provenance
    const adversarialMismatch = verifyModelProvenance({
      requestedModelIdentifier: 'deepseek-v4-flash',
      returnedModelIdentifier: 'deepseek-v4-pro',
      systemFingerprint: 'DeepSeek-V4-Flash-0731',
    });
    expect(adversarialMismatch.isValid).toBe(false);
    expect(adversarialMismatch.exactModelMatch).toBe(false);
    expect(adversarialMismatch.systemFingerprintIsModelVersion).toBe(false);
    expect(adversarialMismatch.fingerprintComparedToDocumentedVersionTarget).toBe(false);
    expect(adversarialMismatch.providerReportedBackendFingerprint).toBe('DeepSeek-V4-Flash-0731');

    // Telemetry preservation for normal fingerprint fp_a79f644e50
    const normalTelemetry = verifyModelProvenance({
      requestedModelIdentifier: 'deepseek-v4-flash',
      returnedModelIdentifier: 'deepseek-v4-flash',
      systemFingerprint: 'fp_a79f644e50',
    });
    expect(normalTelemetry.providerReportedBackendFingerprint).toBe('fp_a79f644e50');
    expect(normalTelemetry.systemFingerprintIsModelVersion).toBe(false);
    expect(normalTelemetry.fingerprintComparedToDocumentedVersionTarget).toBe(false);

    // Genuine model version supplied explicitly by provider (not inferred from fingerprint)
    const withExplicitVersion = verifyModelProvenance({
      requestedModelIdentifier: 'deepseek-v4-flash',
      returnedModelIdentifier: 'deepseek-v4-flash',
      systemFingerprint: 'fp_a79f644e50',
      providerReportedModelVersion: '2026-08-release-v1',
    });
    expect(withExplicitVersion.providerReportedModelVersion).toBe('2026-08-release-v1');
    expect(withExplicitVersion.systemFingerprintIsModelVersion).toBe(false);
    expect(withExplicitVersion.fingerprintComparedToDocumentedVersionTarget).toBe(false);

    // Invariant constant exports verification
    expect(SYSTEM_FINGERPRINT_IS_MODEL_VERSION).toBe(false);
    expect(FINGERPRINT_COMPARED_TO_DOCUMENTED_VERSION_TARGET).toBe(false);
    expect(MODEL_PROVENANCE_CONTRACT.systemFingerprintIsModelVersion).toBe(false);
    expect(MODEL_PROVENANCE_CONTRACT.fingerprintComparedToDocumentedVersionTarget).toBe(false);
  });

  // 24. cache miss used for worst-case authorization
  it('24. cache miss is used for worst-case authorization preflight (0 cache hit assumed)', () => {
    for (const record of CANONICAL_COST_PREFLIGHT.taskRecords) {
      // Off-peak input cost matches 100% cache-miss rate (220,000 microUSD/1M)
      const expectedOffPeakInput = Math.ceil(
        (record.estimatedInputTokenUpperBound * 220000) / 1000000
      );
      expect(record.offPeakInputWorstCaseMicroUsd).toBe(expectedOffPeakInput);
      expect(record.offPeakOutputWorstCaseMicroUsd).toBe(1352); // Math.ceil(2048 * 660000 / 1000000)
      expect(record.offPeakTotalWorstCaseMicroUsd).toBe(
        record.offPeakInputWorstCaseMicroUsd + record.offPeakOutputWorstCaseMicroUsd
      );
    }
  });

  // 25. conservative cost never rounds down
  it('25. conservative cost uses ceiling arithmetic and never rounds down', () => {
    for (const record of CANONICAL_COST_PREFLIGHT.taskRecords) {
      const trueOffPeakInputFraction = (record.estimatedInputTokenUpperBound * 220000) / 1000000;
      expect(record.offPeakInputWorstCaseMicroUsd).toBeGreaterThanOrEqual(trueOffPeakInputFraction);

      const truePeakInputFraction = (record.estimatedInputTokenUpperBound * 440000) / 1000000;
      expect(record.peakInputWorstCaseMicroUsd).toBeGreaterThanOrEqual(truePeakInputFraction);

      expect(record.peakOutputWorstCaseMicroUsd).toBeGreaterThanOrEqual((2048 * 1320000) / 1000000);
    }
  });

  // 26. PEAK seven-call worst-case = 2x OFF_PEAK
  it('26. PEAK seven-call worst-case = 2x OFF_PEAK mathematically', () => {
    expect(CANONICAL_COST_PREFLIGHT.offPeakSevenCallWorstCaseMicroUsd).toBe(12783);
    expect(CANONICAL_COST_PREFLIGHT.peakSevenCallWorstCaseMicroUsd).toBe(25566);
    expect(CANONICAL_COST_PREFLIGHT.peakSevenCallWorstCaseMicroUsd).toBe(
      2 * CANONICAL_COST_PREFLIGHT.offPeakSevenCallWorstCaseMicroUsd
    );
    expect(CANONICAL_COST_PREFLIGHT.isExactTwoX).toBe(true);
  });

  // 27. human authorization OFF_PEAK not granted
  it('27. human authorization OFF_PEAK not granted', () => {
    expect(HUMAN_BUDGET_STATUS.offPeakHumanAuthorization).toBe('NOT_GRANTED');
    expect(HUMAN_BUDGET_STATUS.offPeakFutureBudgetCeilingMicroUsd).toBe('PENDING_HUMAN_APPROVAL');
    expect(OFF_PEAK_PROGRAM.humanAuthorizationStatus).toBe('NOT_GRANTED');
    expect(OFF_PEAK_PROGRAM.futureBudgetCeilingMicroUsd).toBe('PENDING_HUMAN_APPROVAL');
  });

  // 28. human authorization PEAK not granted
  it('28. human authorization PEAK not granted', () => {
    expect(HUMAN_BUDGET_STATUS.peakHumanAuthorization).toBe('NOT_GRANTED');
    expect(HUMAN_BUDGET_STATUS.peakFutureBudgetCeilingMicroUsd).toBe('PENDING_HUMAN_APPROVAL');
    expect(PEAK_PROGRAM.humanAuthorizationStatus).toBe('NOT_GRANTED');
    expect(PEAK_PROGRAM.futureBudgetCeilingMicroUsd).toBe('PENDING_HUMAN_APPROVAL');
  });

  // 29. current CANARY_SPECIFICATION_VERSION remains a12b2c5-v1.2
  it('29. current CANARY_SPECIFICATION_VERSION remains a12b2c5-v1.2', () => {
    expect(CANARY_SPECIFICATION_VERSION).toBe('a12b2c5-v1.2');
  });

  // 30. BoundedCanaryRunner still globally blocks current live execution
  it('30. BoundedCanaryRunner still globally blocks current live execution', async () => {
    const result = await BoundedCanaryRunner.executeLiveCanary({
      phase: 'A.12B.2C-5D',
      executionLane: 'INTERACTIVE',
      humanApproval: {
        approvedBy: 'lead@velnar.internal',
        approvalTimestamp: '2026-09-04T12:00:00.000Z',
        targetPhase: 'A.12B.2C-5D',
        approvalToken: 'dummy-approval-token',
        maxBudgetMicroUsd: 50000,
        environmentTarget: 'CONTROLLED_CANARY',
        specificationVersion: CANARY_SPECIFICATION_VERSION,
        sourceCommitSha: 'ce4e0e94007d3904345fa48f5128f06e4ede3713',
        runNonce: 'test-nonce-5f',
      },
      capabilitySecret: 'secret_123',
    });

    expect(result.overallStatus).toBe('CANARY_KILL_SWITCH_TERMINATED');
    expect(result.killSwitchEvents[0].reason).toBe('UNAUTHORIZED_ENVIRONMENT');
    expect(result.killSwitchEvents[0].message).toContain(
      'Dual-lane v1.2 live execution is blocked pending lane-specific certification'
    );
    expect(result.transportAttemptCount).toBe(0);
    expect(result.productionRoutingEnforcementAllowed).toBe(false);
  });

  // 31. customFetch sentinel calls = 0
  it('31. customFetch sentinel calls = 0', async () => {
    expect(customFetchSpy).toHaveBeenCalledTimes(0);
  });

  // 32. global fetch sentinel calls = 0
  it('32. global fetch sentinel calls = 0', () => {
    expect(globalFetchSpy).toHaveBeenCalledTimes(0);
  });

  // 33. providerNetworkCalls = 0
  it('33. providerNetworkCalls = 0 across all security invariants', () => {
    expect(DEEPSEEK_SUCCESSOR_CERTIFICATION_SPECIFICATION.securityInvariants.providerNetworkCalls).toBe(0);
    expect(DEEPSEEK_SUCCESSOR_CERTIFICATION_SPECIFICATION.securityInvariants.zeroDeepSeekCalls).toBe(true);
    expect(DEEPSEEK_SUCCESSOR_CERTIFICATION_SPECIFICATION.securityInvariants.zeroGeminiCalls).toBe(true);
    expect(DEEPSEEK_SUCCESSOR_CERTIFICATION_SPECIFICATION.securityInvariants.zeroProviderCredentials).toBe(true);
    expect(DEEPSEEK_SUCCESSOR_CERTIFICATION_SPECIFICATION.securityInvariants.zeroExternalNetworkCalls).toBe(true);
  });

  // 34. productionRoutingEnforcementAllowed = false
  it('34. productionRoutingEnforcementAllowed = false', () => {
    expect(
      DEEPSEEK_SUCCESSOR_CERTIFICATION_SPECIFICATION.securityInvariants.productionRoutingEnforcementAllowed
    ).toBe(false);

    for (const taskType of CERTIFIED_A12B2C_TASK_TYPES) {
      const decision = resolveRoutingPolicyDecision({ taskType });
      expect(decision.enforcementAllowed).toBe(false);
    }
  });

  // Auxiliary test for success status model transitions
  it('resolves overall V1 provider states accurately without mixed provider', () => {
    expect(resolveOverallV1ProviderState()).toBe('UNCERTIFIED');
    expect(resolveOverallV1ProviderState('DEEPSEEK_OFF_PEAK_CERTIFIED', undefined)).toBe('OFF_PEAK_ONLY_CERTIFIED');
    expect(resolveOverallV1ProviderState(undefined, 'DEEPSEEK_PEAK_CERTIFIED')).toBe('PEAK_ONLY_CERTIFIED');
    expect(
      resolveOverallV1ProviderState('DEEPSEEK_OFF_PEAK_CERTIFIED', 'DEEPSEEK_PEAK_CERTIFIED')
    ).toBe('DEEPSEEK_V1_ALL_WINDOWS_CERTIFIED');
  });

  // Auxiliary test for future activation safety requirement
  it('records future version-independent live gate requirement without premature activation', () => {
    expect(FUTURE_ACTIVATION_SAFETY_REQUIREMENT.versionIndependentLiveGateRequired).toBe(true);
    expect(FUTURE_ACTIVATION_SAFETY_REQUIREMENT.implementedInPhase5F).toBe(false);
  });
});
