import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  CANARY_SPECIFICATION_VERSION,
  CanaryExecutionLane,
  CANARY_INTERACTIVE_LANE_SPEC,
  CANARY_BACKGROUND_ECONOMY_LANE_SPEC,
  CANARY_LANE_SPECIFICATIONS,
  CANARY_FLEX_OFFICIAL_LATENCY_METADATA,
  isCandidateAllowedForLane,
  CANARY_BENCHMARK_CANDIDATES,
  CANARY_BENCHMARK_CANDIDATE_MAP,
  PRIORITY_DOWNGRADE_CERTIFICATION_CONTRACT,
  LEGACY_V11_CANARY_MATRIX,
  legacyV11MatrixHistoricalOnly,
  generateCanaryApprovalToken,
  validateHumanApprovalToken,
  CanaryHumanApprovalEnvelope,
} from '../../worker/ai/canary/canarySpecification';
import { BoundedCanaryRunner } from '../../worker/ai/canary/boundedCanaryRunner';
import { HistoricalCanaryMockTransportHarness } from './helpers/historicalCanaryMockTransportHarness';
import { resolveRoutingPolicyDecision } from '../../worker/ai/routingPolicy';
import { TaskType } from '../../worker/ai/types';

describe('Phase A.12B.2C-5D Dual-Lane v1.2 Specification Foundation', () => {
  const validSecret = 'a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0';
  const validCommit = 'e5c3c1b5b61cd2f5ab3efb8b11bb85e283b41ddb';
  const validNonce = 'nonce_v12_dual_lane_test_001';
  const validDate = '20260903';
  const validTimestamp = '2026-09-03T18:00:00.000Z';

  const validV12ApprovalEnvelope: CanaryHumanApprovalEnvelope = {
    approvedBy: 'lead@velnar.internal',
    approvalTimestamp: validTimestamp,
    targetPhase: 'A.12B.2C-5D',
    approvalToken: generateCanaryApprovalToken({
      approvedBy: 'lead@velnar.internal',
      targetPhase: 'A.12B.2C-5D',
      environmentTarget: 'CONTROLLED_CANARY',
      dateYyyyMmDd: validDate,
      maxBudgetMicroUsd: 50000,
      approvalTimestamp: validTimestamp,
      specificationVersion: CANARY_SPECIFICATION_VERSION,
      sourceCommitSha: validCommit,
      runNonce: validNonce,
      capabilitySecret: validSecret,
      executionLane: 'INTERACTIVE',
    }),
    maxBudgetMicroUsd: 50000,
    environmentTarget: 'CONTROLLED_CANARY',
    specificationVersion: CANARY_SPECIFICATION_VERSION,
    sourceCommitSha: validCommit,
    runNonce: validNonce,
    capabilitySecret: validSecret,
    executionLane: 'INTERACTIVE',
  };

  // 1. CANARY_SPECIFICATION_VERSION is strictly a12b2c5-v1.2
  it('1. CANARY_SPECIFICATION_VERSION is strictly a12b2c5-v1.2', () => {
    expect(CANARY_SPECIFICATION_VERSION).toBe('a12b2c5-v1.2');
  });

  // 2. CanaryExecutionLane type supports INTERACTIVE and BACKGROUND_ECONOMY
  it('2. CanaryExecutionLane type supports INTERACTIVE and BACKGROUND_ECONOMY', () => {
    const laneInteractive: CanaryExecutionLane = 'INTERACTIVE';
    const laneBackground: CanaryExecutionLane = 'BACKGROUND_ECONOMY';
    expect(laneInteractive).toBe('INTERACTIVE');
    expect(laneBackground).toBe('BACKGROUND_ECONOMY');
    expect(Object.keys(CANARY_LANE_SPECIFICATIONS)).toEqual(['INTERACTIVE', 'BACKGROUND_ECONOMY']);
  });

  // 3. Interactive lane specification matches all constraints
  it('3. Interactive lane specification matches all constraints (15s timeout, DeepSeek primary, no Flex, fallback pending, status INCOMPLETE)', () => {
    expect(CANARY_INTERACTIVE_LANE_SPEC.lane).toBe('INTERACTIVE');
    expect(CANARY_INTERACTIVE_LANE_SPEC.workloadType).toBe('SYNCHRONOUS_USER_FACING');
    expect(CANARY_INTERACTIVE_LANE_SPEC.hardLifecycleTimeoutMs).toBe(15000);
    expect(CANARY_INTERACTIVE_LANE_SPEC.flexAllowed).toBe(false);
    expect(CANARY_INTERACTIVE_LANE_SPEC.primaryCandidateId).toBe('deepseek-v4-flash-offpeak-low');
    expect(CANARY_INTERACTIVE_LANE_SPEC.certifiedFallbackCandidateId).toBeNull();
    expect(CANARY_INTERACTIVE_LANE_SPEC.fallbackCertificationStatus).toBe('PENDING');
    expect(CANARY_INTERACTIVE_LANE_SPEC.liveCertificationStatus).toBe('INCOMPLETE');
  });

  // 4. Background Economy lane specification matches all constraints
  it('4. Background Economy lane specification matches all constraints (Gemini Flex candidate, sync provider interface, async queue wrapper model, status INCOMPLETE)', () => {
    expect(CANARY_BACKGROUND_ECONOMY_LANE_SPEC.lane).toBe('BACKGROUND_ECONOMY');
    expect(CANARY_BACKGROUND_ECONOMY_LANE_SPEC.workloadType).toBe('LATENCY_TOLERANT_NON_URGENT');
    expect(CANARY_BACKGROUND_ECONOMY_LANE_SPEC.providerInterface).toBe('SYNCHRONOUS');
    expect(CANARY_BACKGROUND_ECONOMY_LANE_SPEC.productExecutionModel).toBe('ASYNC_WORKER_QUEUE_WRAPPER');
    expect(CANARY_BACKGROUND_ECONOMY_LANE_SPEC.candidateId).toBe('gemini-3.5-flash-lite-flex-low');
    expect(CANARY_BACKGROUND_ECONOMY_LANE_SPEC.providerTier).toBe('flex');
    expect(CANARY_BACKGROUND_ECONOMY_LANE_SPEC.liveCertificationStatus).toBe('INCOMPLETE');
    expect(CANARY_BACKGROUND_ECONOMY_LANE_SPEC.operationalJobDeadlineMs).toBeNull();
    expect(CANARY_BACKGROUND_ECONOMY_LANE_SPEC.backgroundExecutionDeadlineStatus).toBe('PENDING_LANE_CERTIFICATION');
  });

  // 5. Flex official latency metadata is encoded accurately
  it('5. Flex official latency metadata is encoded accurately (60s-900s official target, 600s floor, sheddable, 50% discount)', () => {
    expect(CANARY_FLEX_OFFICIAL_LATENCY_METADATA.providerId).toBe('gemini');
    expect(CANARY_FLEX_OFFICIAL_LATENCY_METADATA.serviceTier).toBe('flex');
    expect(CANARY_FLEX_OFFICIAL_LATENCY_METADATA.providerInterface).toBe('SYNCHRONOUS');
    expect(CANARY_FLEX_OFFICIAL_LATENCY_METADATA.reliabilityClass).toBe('BEST_EFFORT_SHEDDABLE');
    expect(CANARY_FLEX_OFFICIAL_LATENCY_METADATA.officialTargetLatencyMinMs).toBe(60000);
    expect(CANARY_FLEX_OFFICIAL_LATENCY_METADATA.officialTargetLatencyMaxMs).toBe(900000);
    expect(CANARY_FLEX_OFFICIAL_LATENCY_METADATA.recommendedClientTimeoutFloorMs).toBe(600000);
    expect(CANARY_FLEX_OFFICIAL_LATENCY_METADATA.pricingDiscountPercent).toBe(50);
  });

  // 6. isCandidateAllowedForLane correctly permits DeepSeek in INTERACTIVE and rejects Gemini Flex
  it('6. isCandidateAllowedForLane correctly permits DeepSeek in INTERACTIVE and rejects Gemini Flex', () => {
    expect(isCandidateAllowedForLane('deepseek-v4-flash-offpeak-low', 'INTERACTIVE')).toBe(true);
    expect(isCandidateAllowedForLane('gemini-3.5-flash-lite-flex-low', 'INTERACTIVE')).toBe(false);
    expect(isCandidateAllowedForLane('unknown-candidate', 'INTERACTIVE')).toBe(false);
  });

  // 7. isCandidateAllowedForLane correctly permits Gemini Flex in BACKGROUND_ECONOMY and rejects DeepSeek
  it('7. isCandidateAllowedForLane correctly permits Gemini Flex in BACKGROUND_ECONOMY and rejects DeepSeek', () => {
    expect(isCandidateAllowedForLane('gemini-3.5-flash-lite-flex-low', 'BACKGROUND_ECONOMY')).toBe(true);
    expect(isCandidateAllowedForLane('deepseek-v4-flash-offpeak-low', 'BACKGROUND_ECONOMY')).toBe(false);
    expect(isCandidateAllowedForLane('unknown-candidate', 'BACKGROUND_ECONOMY')).toBe(false);
  });

  // 8. Both benchmark candidates (Standard, Priority) exist with status BENCHMARK_CANDIDATE_UNCERTIFIED
  it('8. Both benchmark candidates (Standard, Priority) exist with status BENCHMARK_CANDIDATE_UNCERTIFIED', () => {
    expect(CANARY_BENCHMARK_CANDIDATES).toHaveLength(2);
    const standard = CANARY_BENCHMARK_CANDIDATE_MAP.get('gemini-3.5-flash-lite-standard-low');
    const priority = CANARY_BENCHMARK_CANDIDATE_MAP.get('gemini-3.5-flash-lite-priority-low');

    expect(standard).toBeDefined();
    expect(standard!.serviceTier).toBe('standard');
    expect(standard!.status).toBe('BENCHMARK_CANDIDATE_UNCERTIFIED');

    expect(priority).toBeDefined();
    expect(priority!.serviceTier).toBe('priority');
    expect(priority!.status).toBe('BENCHMARK_CANDIDATE_UNCERTIFIED');
  });

  // 9. Benchmark candidates prohibit network calls, fallbacks, and active candidate matrix inclusion
  it('9. Benchmark candidates prohibit network calls, fallbacks, and active candidate matrix inclusion', () => {
    for (const candidate of CANARY_BENCHMARK_CANDIDATES) {
      expect(candidate.networkCallsAllowed).toBe(false);
      expect(candidate.fallbackAllowed).toBe(false);
      expect(candidate.activeCandidateMatrixAllowed).toBe(false);
    }
  });

  // 10. Benchmark candidates reflect official positioning correctly
  it('10. Benchmark candidates reflect official positioning correctly (Standard: sec-to-min, Priority: seconds with graceful downgrade)', () => {
    const standard = CANARY_BENCHMARK_CANDIDATE_MAP.get('gemini-3.5-flash-lite-standard-low')!;
    const priority = CANARY_BENCHMARK_CANDIDATE_MAP.get('gemini-3.5-flash-lite-priority-low')!;

    expect(standard.officialPositioning.latencyDescription).toContain('seconds to minutes');
    expect(standard.officialPositioning.interface).toBe('SYNCHRONOUS');
    expect(standard.officialPositioning.pricingTier).toContain('full-price');

    expect(priority.officialPositioning.latencyDescription).toContain('seconds');
    expect(priority.officialPositioning.interface).toBe('SYNCHRONOUS');
    expect(priority.officialPositioning.downgradeSemantics).toContain('gracefully downgrade');
    expect(priority.officialPositioning.pricingTier).toContain('premium');
  });

  // 11. Priority downgrade certification contract requires requestedTier vs observed actualTier and requires downgrade observation
  it('11. Priority downgrade certification contract requires requestedTier vs observed actualTier and requires downgrade observation', () => {
    expect(PRIORITY_DOWNGRADE_CERTIFICATION_CONTRACT.requestedServiceTier).toBe('priority');
    expect(PRIORITY_DOWNGRADE_CERTIFICATION_CONTRACT.possibleActualTiers).toEqual(['priority', 'standard']);
    expect(PRIORITY_DOWNGRADE_CERTIFICATION_CONTRACT.downgradeObservationRequired).toBe(true);
    expect(PRIORITY_DOWNGRADE_CERTIFICATION_CONTRACT.requiredFutureMetrics).toContain('requested_service_tier');
    expect(PRIORITY_DOWNGRADE_CERTIFICATION_CONTRACT.requiredFutureMetrics).toContain('provider_reported_actual_tier');
    expect(PRIORITY_DOWNGRADE_CERTIFICATION_CONTRACT.requiredFutureMetrics).toContain('downgrade_detected');
  });

  // 12. Priority downgrade contract requires exact provenance matching
  it('12. Priority downgrade contract requires exact provenance matching (downgrade to standard does NOT count as Priority)', () => {
    expect(PRIORITY_DOWNGRADE_CERTIFICATION_CONTRACT.exactProvenanceRequiresExactMatch).toBe(true);
    expect(PRIORITY_DOWNGRADE_CERTIFICATION_CONTRACT.requiredFutureMetrics).toContain('billing_tier');
    expect(PRIORITY_DOWNGRADE_CERTIFICATION_CONTRACT.requiredFutureMetrics).toContain('interactive_slo_result');
  });

  // 13. Bounded canary runner fails-closed immediately if live execution is attempted under v1.2
  it('13. Bounded canary runner fails-closed immediately if live execution is attempted under v1.2', async () => {
    const result = await BoundedCanaryRunner.executeLiveCanary({
      phase: 'A.12B.2C-5D',
      humanApproval: validV12ApprovalEnvelope,
      capabilitySecret: validSecret,
    });
    expect(result.overallStatus).toBe('CANARY_KILL_SWITCH_TERMINATED');
    expect(result.killSwitchEvents[0].reason).toBe('UNAUTHORIZED_ENVIRONMENT');
    expect(result.killSwitchEvents[0].message).toContain('Dual-lane v1.2 live execution is blocked pending lane-specific certification');
    expect(result.summaryCounts.executedInvocations).toBe(0);
    expect(result.summaryCounts.totalObservedCostMicroUsd).toBe(0);
  });

  // 14. Bounded canary runner fails-closed if interactive lane live execution is attempted
  it('14. Bounded canary runner fails-closed if interactive lane live execution is attempted', async () => {
    const result = await BoundedCanaryRunner.executeLiveCanary({
      phase: 'A.12B.2C-5D',
      executionLane: 'INTERACTIVE',
      humanApproval: { ...validV12ApprovalEnvelope, executionLane: 'INTERACTIVE' },
      capabilitySecret: validSecret,
    });
    expect(result.overallStatus).toBe('CANARY_KILL_SWITCH_TERMINATED');
    expect(result.killSwitchEvents[0].reason).toBe('UNAUTHORIZED_ENVIRONMENT');
    expect(result.killSwitchEvents[0].message).toContain('Dual-lane v1.2 live execution is blocked pending lane-specific certification');
    expect(result.summaryCounts.executedInvocations).toBe(0);
  });

  // 15. Bounded canary runner fails-closed if background economy lane live execution is attempted
  it('15. Bounded canary runner fails-closed if background economy lane live execution is attempted', async () => {
    const result = await BoundedCanaryRunner.executeLiveCanary({
      phase: 'A.12B.2C-5D',
      executionLane: 'BACKGROUND_ECONOMY',
      humanApproval: { ...validV12ApprovalEnvelope, executionLane: 'BACKGROUND_ECONOMY' },
      capabilitySecret: validSecret,
    });
    expect(result.overallStatus).toBe('CANARY_KILL_SWITCH_TERMINATED');
    expect(result.killSwitchEvents[0].reason).toBe('UNAUTHORIZED_ENVIRONMENT');
    expect(result.killSwitchEvents[0].message).toContain('Dual-lane v1.2 live execution is blocked pending lane-specific certification');
    expect(result.summaryCounts.executedInvocations).toBe(0);
  });

  // 16. Bounded canary runner fail-closed execution results in 0 provider calls, 0 network attempts, 0 microUSD incurred
  it('16. Bounded canary runner fail-closed execution results in 0 provider calls, 0 network attempts, 0 microUSD incurred', async () => {
    const result = await BoundedCanaryRunner.executeLiveCanary({
      phase: 'A.12B.2C-5D',
      executionLane: 'INTERACTIVE',
      humanApproval: validV12ApprovalEnvelope,
      capabilitySecret: validSecret,
    });
    expect(result.summaryCounts.executedInvocations).toBe(0);
    expect(result.summaryCounts.totalObservedCostMicroUsd).toBe(0);
    expect(result.attemptRecords?.length ?? 0).toBe(0);
    expect(result.invocations.length).toBe(0);
  });

  // 17. Bounded canary runner kill switch event records explicit explanatory message regarding pending certification
  it('17. Bounded canary runner kill switch event records explicit explanatory message regarding pending certification', async () => {
    const result = await BoundedCanaryRunner.executeLiveCanary({
      phase: 'A.12B.2C-5D',
      humanApproval: validV12ApprovalEnvelope,
      capabilitySecret: validSecret,
    });
    expect(result.killSwitchEvents.length).toBeGreaterThan(0);
    expect(result.killSwitchEvents[0].message).toBe(
      'Dual-lane v1.2 live execution is blocked pending lane-specific certification.'
    );
  });

  // 18. Historical evidence files remain untampered and retain original SHA256 hashes
  it('18. Historical evidence files remain untampered and retain original SHA256 hashes', () => {
    const historicalFiles: Record<string, string> = {
      'execution/a12b2c5c_latency_service_tier_fit_audit.json': 'bc94216b56ec2f25c343882c5a6e6d56432c1fde98410911b1a186f7fd0f6785',
      'execution/a12b2c5c_latency_service_tier_fit_audit_amendment.json': '582d62d72b9c93b8fdd46bbbc77b792d3c65d5fa2f328e16f6635dd285b756ca',
      'execution/a12b2c5b_final_recanary_03186e5_results.json': 'cd3318502d5849633b7f075f2849347fb223f6579b02d5f16cfa226e3b0a4795',
      'execution/a12b2c5d_dual_lane_v12_specification.json': '0d1ac9a8eaabe131ec8c9685aacdff5a00caa5953c2a6558d8c96efabd8d7e6a',
    };

    for (const [relPath, expectedHash] of Object.entries(historicalFiles)) {
      const fullPath = path.resolve(process.cwd(), relPath);
      expect(fs.existsSync(fullPath)).toBe(true);
      const fileBytes = fs.readFileSync(fullPath);
      const computedHash = crypto.createHash('sha256').update(fileBytes).digest('hex');
      expect(computedHash).toBe(expectedHash);
    }
  });

  // 19. Human approval envelope supports v1.2 and execution lane tagging
  it('19. Human approval envelope supports v1.2 and execution lane tagging', () => {
    expect(validV12ApprovalEnvelope.specificationVersion).toBe('a12b2c5-v1.2');
    expect(validV12ApprovalEnvelope.executionLane).toBe('INTERACTIVE');
    expect(validV12ApprovalEnvelope.targetPhase).toBe('A.12B.2C-5D');
  });

  // 20. Human approval token generation and validation work with v1.2 specification
  it('20. Human approval token generation and validation work with v1.2 specification', () => {
    const token = generateCanaryApprovalToken({
      approvedBy: 'lead@velnar.internal',
      targetPhase: 'A.12B.2C-5D',
      environmentTarget: 'CONTROLLED_CANARY',
      dateYyyyMmDd: validDate,
      maxBudgetMicroUsd: 50000,
      approvalTimestamp: validTimestamp,
      specificationVersion: CANARY_SPECIFICATION_VERSION,
      sourceCommitSha: validCommit,
      runNonce: validNonce,
      capabilitySecret: validSecret,
      executionLane: 'BACKGROUND_ECONOMY',
    });

    expect(token).toMatch(/^VELNAR_CANARY_APPROVED_PHASE_A12B2C5D_\d{8}_[0-9a-f]{64}$/);

    const validationResult = validateHumanApprovalToken(
      {
        approvedBy: 'lead@velnar.internal',
        approvalTimestamp: validTimestamp,
        targetPhase: 'A.12B.2C-5D',
        approvalToken: token,
        maxBudgetMicroUsd: 50000,
        environmentTarget: 'CONTROLLED_CANARY',
        specificationVersion: CANARY_SPECIFICATION_VERSION,
        sourceCommitSha: validCommit,
        runNonce: validNonce,
        capabilitySecret: validSecret,
        executionLane: 'BACKGROUND_ECONOMY',
      },
      // Keep the real expiry check enabled at this fixture's deterministic time.
      { capabilitySecret: validSecret, now: () => new Date(validTimestamp) }
    );

    expect(validationResult.valid).toBe(true);
  });

  // 21. Legacy v1.1 14-call matrix is explicitly marked historical only and invalid for interactive production routing
  it('21. Legacy v1.1 14-call matrix is explicitly marked historical only and invalid for interactive production routing', () => {
    expect(legacyV11MatrixHistoricalOnly).toBe(true);
    expect(LEGACY_V11_CANARY_MATRIX.legacyV11MatrixHistoricalOnly).toBe(true);
    expect(LEGACY_V11_CANARY_MATRIX.specificationVersion).toBe('a12b2c5-v1.1');
    expect(LEGACY_V11_CANARY_MATRIX.validInteractiveFallbackPair).toBe(false);
    expect(LEGACY_V11_CANARY_MATRIX.status).toBe('HISTORICAL_ONLY');
  });

  // 22. Production routing enforcement remains disabled (enforcementAllowed === false)
  it('22. Production routing enforcement remains disabled (enforcementAllowed === false)', () => {
    const certifiedTasks: TaskType[] = [
      'LEAD_INTENT_CLASSIFICATION',
      'LEAK_EXPLANATION',
      'GROWTH_ACTION_DRAFT',
      'BUSINESS_TWIN_SUMMARY',
      'FUNNEL_DIAGNOSTIC_EXPLANATION',
      'SEO_CONTENT_SUGGESTION',
      'ANOMALY_TRIAGE',
    ];

    for (const task of certifiedTasks) {
      const shadow = resolveRoutingPolicyDecision(task, { VELNAR_AI_ROUTING_POLICY_MODE: 'SHADOW' } as any);
      const active = resolveRoutingPolicyDecision(task, { VELNAR_AI_ROUTING_POLICY_MODE: 'ACTIVE' } as any);
      const dormant = resolveRoutingPolicyDecision(task, { VELNAR_AI_ROUTING_POLICY_MODE: 'OFF' } as any);

      expect(shadow.enforcementAllowed).toBe(false);
      expect(active.enforcementAllowed).toBe(false);
      expect(dormant.enforcementAllowed).toBe(false);
    }
  });

  // =========================================================================
  // v1.2 Global Live-Block Coverage Regressions (A.12B.2C-5D.1)
  // =========================================================================

  // 23. REQUIRED REGRESSION (Section 5): Exact uncovered path (phase 5B under v1.2 specification) fails closed pre-network
  it('23. REQUIRED REGRESSION: phase 5B without executionLane under v1.2 fails closed pre-network with 0 network calls', async () => {
    let customFetchCalls = 0;
    const sentinelCustomFetch = vi.fn(async () => {
      customFetchCalls++;
      throw new Error('SECURITY VIOLATION: Custom fetch sentinel invoked in fail-closed state!');
    });
    const globalFetchSpy = vi.spyOn(globalThis, 'fetch');

    // Cryptographically valid v1.2 / 5B approval envelope
    const token5B = generateCanaryApprovalToken({
      approvedBy: 'security-lead@velnar.internal',
      targetPhase: 'A.12B.2C-5B',
      environmentTarget: 'CONTROLLED_CANARY',
      dateYyyyMmDd: validDate,
      maxBudgetMicroUsd: 50000,
      approvalTimestamp: validTimestamp,
      specificationVersion: CANARY_SPECIFICATION_VERSION,
      sourceCommitSha: validCommit,
      runNonce: validNonce,
      capabilitySecret: validSecret,
    });

    const result = await BoundedCanaryRunner.executeLiveCanary({
      phase: 'A.12B.2C-5B',
      executionLane: undefined,
      lane: undefined,
      humanApproval: {
        approvedBy: 'security-lead@velnar.internal',
        approvalTimestamp: validTimestamp,
        targetPhase: 'A.12B.2C-5B',
        approvalToken: token5B,
        maxBudgetMicroUsd: 50000,
        environmentTarget: 'CONTROLLED_CANARY',
        specificationVersion: CANARY_SPECIFICATION_VERSION,
        sourceCommitSha: validCommit,
        runNonce: validNonce,
      },
      capabilitySecret: validSecret,
      customFetch: sentinelCustomFetch as any,
      env: {
        DEEPSEEK_API_KEY: 'placeholder-deepseek-key-12345',
        GEMINI_API_KEY: 'placeholder-gemini-key-12345',
      },
      sourceRevisionResolver: () => ({ commitSha: validCommit, isClean: true }),
      now: () => new Date(validTimestamp),
    });

    expect(result.overallStatus).toBe('CANARY_KILL_SWITCH_TERMINATED');
    expect(result.killSwitchEvents.length).toBeGreaterThan(0);
    expect(result.killSwitchEvents[0].reason).toBe('UNAUTHORIZED_ENVIRONMENT');
    expect(result.killSwitchEvents[0].message).toContain(
      'Dual-lane v1.2 live execution is blocked pending lane-specific certification.'
    );
    expect(customFetchCalls).toBe(0);
    expect(sentinelCustomFetch).not.toHaveBeenCalled();
    expect(globalFetchSpy).not.toHaveBeenCalled();
    expect(result.summaryCounts.executedInvocations).toBe(0);
    expect(result.transportAttemptCount).toBe(0);
    expect(result.summaryCounts.totalObservedCostMicroUsd).toBe(0);
    expect(result.attemptRecords?.length ?? 0).toBe(0);
    expect(result.invocations.length).toBe(0);
    expect(result.productionRoutingEnforcementAllowed).toBe(false);

    globalFetchSpy.mockRestore();
  });

  // 24. (A) Phase 5D + INTERACTIVE => blocked pre-network
  it('24. (A) phase 5D + INTERACTIVE fails closed pre-network', async () => {
    const sentinelFetch = vi.fn();
    const globalFetchSpy = vi.spyOn(globalThis, 'fetch');

    const result = await BoundedCanaryRunner.executeLiveCanary({
      phase: 'A.12B.2C-5D',
      executionLane: 'INTERACTIVE',
      humanApproval: validV12ApprovalEnvelope,
      capabilitySecret: validSecret,
      customFetch: sentinelFetch as any,
    });

    expect(result.overallStatus).toBe('CANARY_KILL_SWITCH_TERMINATED');
    expect(result.killSwitchEvents[0].reason).toBe('UNAUTHORIZED_ENVIRONMENT');
    expect(result.killSwitchEvents[0].message).toContain('Dual-lane v1.2 live execution is blocked pending lane-specific certification');
    expect(sentinelFetch).not.toHaveBeenCalled();
    expect(globalFetchSpy).not.toHaveBeenCalled();
    expect(result.summaryCounts.executedInvocations).toBe(0);
    expect(result.transportAttemptCount).toBe(0);

    globalFetchSpy.mockRestore();
  });

  // 25. (B) Phase 5D + BACKGROUND_ECONOMY => blocked pre-network
  it('25. (B) phase 5D + BACKGROUND_ECONOMY fails closed pre-network', async () => {
    const sentinelFetch = vi.fn();
    const globalFetchSpy = vi.spyOn(globalThis, 'fetch');

    const result = await BoundedCanaryRunner.executeLiveCanary({
      phase: 'A.12B.2C-5D',
      executionLane: 'BACKGROUND_ECONOMY',
      humanApproval: { ...validV12ApprovalEnvelope, executionLane: 'BACKGROUND_ECONOMY' },
      capabilitySecret: validSecret,
      customFetch: sentinelFetch as any,
    });

    expect(result.overallStatus).toBe('CANARY_KILL_SWITCH_TERMINATED');
    expect(result.killSwitchEvents[0].reason).toBe('UNAUTHORIZED_ENVIRONMENT');
    expect(result.killSwitchEvents[0].message).toContain('Dual-lane v1.2 live execution is blocked pending lane-specific certification');
    expect(sentinelFetch).not.toHaveBeenCalled();
    expect(globalFetchSpy).not.toHaveBeenCalled();
    expect(result.summaryCounts.executedInvocations).toBe(0);
    expect(result.transportAttemptCount).toBe(0);

    globalFetchSpy.mockRestore();
  });

  // 26. (C) Phase 5B + no lane => blocked pre-network
  it('26. (C) phase 5B + no lane fails closed pre-network', async () => {
    const sentinelFetch = vi.fn();
    const globalFetchSpy = vi.spyOn(globalThis, 'fetch');

    const result = await BoundedCanaryRunner.executeLiveCanary({
      phase: 'A.12B.2C-5B',
      humanApproval: validV12ApprovalEnvelope,
      capabilitySecret: validSecret,
      customFetch: sentinelFetch as any,
    });

    expect(result.overallStatus).toBe('CANARY_KILL_SWITCH_TERMINATED');
    expect(result.killSwitchEvents[0].reason).toBe('UNAUTHORIZED_ENVIRONMENT');
    expect(result.killSwitchEvents[0].message).toContain('Dual-lane v1.2 live execution is blocked pending lane-specific certification');
    expect(sentinelFetch).not.toHaveBeenCalled();
    expect(globalFetchSpy).not.toHaveBeenCalled();
    expect(result.summaryCounts.executedInvocations).toBe(0);
    expect(result.transportAttemptCount).toBe(0);

    globalFetchSpy.mockRestore();
  });

  // 27. (D) Phase 5B + INTERACTIVE => blocked pre-network
  it('27. (D) phase 5B + INTERACTIVE fails closed pre-network', async () => {
    const sentinelFetch = vi.fn();
    const globalFetchSpy = vi.spyOn(globalThis, 'fetch');

    const result = await BoundedCanaryRunner.executeLiveCanary({
      phase: 'A.12B.2C-5B',
      executionLane: 'INTERACTIVE',
      humanApproval: { ...validV12ApprovalEnvelope, executionLane: 'INTERACTIVE' },
      capabilitySecret: validSecret,
      customFetch: sentinelFetch as any,
    });

    expect(result.overallStatus).toBe('CANARY_KILL_SWITCH_TERMINATED');
    expect(result.killSwitchEvents[0].reason).toBe('UNAUTHORIZED_ENVIRONMENT');
    expect(result.killSwitchEvents[0].message).toContain('Dual-lane v1.2 live execution is blocked pending lane-specific certification');
    expect(sentinelFetch).not.toHaveBeenCalled();
    expect(globalFetchSpy).not.toHaveBeenCalled();
    expect(result.summaryCounts.executedInvocations).toBe(0);
    expect(result.transportAttemptCount).toBe(0);

    globalFetchSpy.mockRestore();
  });

  // 28. (E) Phase 5B + BACKGROUND_ECONOMY => blocked pre-network
  it('28. (E) phase 5B + BACKGROUND_ECONOMY fails closed pre-network', async () => {
    const sentinelFetch = vi.fn();
    const globalFetchSpy = vi.spyOn(globalThis, 'fetch');

    const result = await BoundedCanaryRunner.executeLiveCanary({
      phase: 'A.12B.2C-5B',
      executionLane: 'BACKGROUND_ECONOMY',
      humanApproval: { ...validV12ApprovalEnvelope, executionLane: 'BACKGROUND_ECONOMY' },
      capabilitySecret: validSecret,
      customFetch: sentinelFetch as any,
    });

    expect(result.overallStatus).toBe('CANARY_KILL_SWITCH_TERMINATED');
    expect(result.killSwitchEvents[0].reason).toBe('UNAUTHORIZED_ENVIRONMENT');
    expect(result.killSwitchEvents[0].message).toContain('Dual-lane v1.2 live execution is blocked pending lane-specific certification');
    expect(sentinelFetch).not.toHaveBeenCalled();
    expect(globalFetchSpy).not.toHaveBeenCalled();
    expect(result.summaryCounts.executedInvocations).toBe(0);
    expect(result.transportAttemptCount).toBe(0);

    globalFetchSpy.mockRestore();
  });

  // 29. (F) Valid v1.2 approval cannot bypass block
  it('29. (F) valid v1.2 approval token and envelope cannot bypass block', async () => {
    const token = generateCanaryApprovalToken({
      approvedBy: 'lead@velnar.internal',
      targetPhase: 'A.12B.2C-5D',
      environmentTarget: 'CONTROLLED_CANARY',
      dateYyyyMmDd: validDate,
      maxBudgetMicroUsd: 50000,
      approvalTimestamp: validTimestamp,
      specificationVersion: CANARY_SPECIFICATION_VERSION,
      sourceCommitSha: validCommit,
      runNonce: validNonce,
      capabilitySecret: validSecret,
      executionLane: 'INTERACTIVE',
    });

    const result = await BoundedCanaryRunner.executeLiveCanary({
      phase: 'A.12B.2C-5D',
      executionLane: 'INTERACTIVE',
      humanApproval: {
        approvedBy: 'lead@velnar.internal',
        approvalTimestamp: validTimestamp,
        targetPhase: 'A.12B.2C-5D',
        approvalToken: token,
        maxBudgetMicroUsd: 50000,
        environmentTarget: 'CONTROLLED_CANARY',
        specificationVersion: CANARY_SPECIFICATION_VERSION,
        sourceCommitSha: validCommit,
        runNonce: validNonce,
        executionLane: 'INTERACTIVE',
      },
      capabilitySecret: validSecret,
    });

    expect(result.overallStatus).toBe('CANARY_KILL_SWITCH_TERMINATED');
    expect(result.killSwitchEvents[0].reason).toBe('UNAUTHORIZED_ENVIRONMENT');
    expect(result.summaryCounts.executedInvocations).toBe(0);
  });

  // 30. (G) Invalid approval cannot bypass or alter block ordering
  it('30. (G) invalid or malformed approval envelope hits Gate 0 block first without altering fail-closed ordering', async () => {
    const malformedApprovals = [
      undefined,
      null,
      {} as any,
      { approvedBy: 'forger', approvalToken: 'forged_token' } as any,
    ];

    for (const badApproval of malformedApprovals) {
      const result = await BoundedCanaryRunner.executeLiveCanary({
        phase: 'A.12B.2C-5D',
        humanApproval: badApproval,
        capabilitySecret: validSecret,
      });

      // Gate 0 must terminate BEFORE Gate 1 human approval validation
      expect(result.overallStatus).toBe('CANARY_KILL_SWITCH_TERMINATED');
      expect(result.killSwitchEvents[0].reason).toBe('UNAUTHORIZED_ENVIRONMENT');
      expect(result.killSwitchEvents[0].message).toContain('Dual-lane v1.2 live execution is blocked pending lane-specific certification');
      expect(result.summaryCounts.executedInvocations).toBe(0);
    }
  });

  // 31. (H) Real-looking provider environment values are never inspected/required to reach block
  it('31. (H) real-looking provider environment values are never inspected or required to reach block', async () => {
    const envConfigurations = [
      {}, // Empty env
      { DEEPSEEK_API_KEY: 'test-deepseek-val', GEMINI_API_KEY: 'test-gemini-val' },
      { RANDOM_VAR: 'test' },
    ];

    for (const env of envConfigurations) {
      const result = await BoundedCanaryRunner.executeLiveCanary({
        phase: 'A.12B.2C-5D',
        executionLane: 'INTERACTIVE',
        humanApproval: validV12ApprovalEnvelope,
        capabilitySecret: validSecret,
        env,
      });

      expect(result.overallStatus).toBe('CANARY_KILL_SWITCH_TERMINATED');
      expect(result.killSwitchEvents[0].reason).toBe('UNAUTHORIZED_ENVIRONMENT');
      expect(result.killSwitchEvents[0].message).toContain('Dual-lane v1.2 live execution is blocked pending lane-specific certification');
      expect(result.summaryCounts.executedInvocations).toBe(0);
    }
  });

  // 32. (I, J, K, L) Sentinel invariants: customFetch=0, globalFetch=0, transportAttemptCount=0, productionRoutingEnforcementAllowed=false
  it('32. (I, J, K, L) preserves zero customFetch, zero globalFetch, zero transportAttemptCount, and productionRoutingEnforcementAllowed===false', async () => {
    const customFetchSentinel = vi.fn();
    const globalFetchSpy = vi.spyOn(globalThis, 'fetch');

    const result = await BoundedCanaryRunner.executeLiveCanary({
      phase: 'A.12B.2C-5B',
      humanApproval: validV12ApprovalEnvelope,
      capabilitySecret: validSecret,
      customFetch: customFetchSentinel as any,
    });

    // I: customFetch sentinel remains 0
    expect(customFetchSentinel).toHaveBeenCalledTimes(0);
    // J: global fetch sentinel remains 0
    expect(globalFetchSpy).toHaveBeenCalledTimes(0);
    // K: transportAttemptCount remains 0
    expect(result.transportAttemptCount).toBe(0);
    // L: productionRoutingEnforcementAllowed remains false
    expect(result.productionRoutingEnforcementAllowed).toBe(false);

    globalFetchSpy.mockRestore();
  });

  describe('Phase A.12B.2C-5D.2 Public Mock-Transport Bypass Surface Repair', () => {
    it('33. BoundedCanaryRunner does not expose executeIsolatedMockTransport in its public API', () => {
      expect('executeIsolatedMockTransport' in BoundedCanaryRunner).toBe(false);
      expect((BoundedCanaryRunner as any).executeIsolatedMockTransport).toBeUndefined();
    });

    it('34. BoundedCanaryRunner does not expose internal executeTransportPipeline in its public API', () => {
      expect('executeTransportPipeline' in BoundedCanaryRunner).toBe(false);
      expect((BoundedCanaryRunner as any).executeTransportPipeline).toBeUndefined();
    });

    it('35. BoundedCanaryRunner public API only exposes authorized methods (verifyReadiness, executeDryRunPlan, executeLiveCanary)', () => {
      const publicProperties = Object.getOwnPropertyNames(BoundedCanaryRunner).filter(
        (name) => !['length', 'name', 'prototype'].includes(name)
      );
      expect(publicProperties.sort()).toEqual(['executeDryRunPlan', 'executeLiveCanary', 'verifyReadiness'].sort());
      expect(typeof BoundedCanaryRunner.verifyReadiness).toBe('function');
      expect(typeof BoundedCanaryRunner.executeDryRunPlan).toBe('function');
      expect(typeof BoundedCanaryRunner.executeLiveCanary).toBe('function');
    });

    it('36. HistoricalCanaryMockTransportHarness rejects execution if customFetch is missing', async () => {
      await expect(
        HistoricalCanaryMockTransportHarness.executeHistoricalMockTransport({
          phase: 'A.12B.2C-5B',
        } as any)
      ).rejects.toThrow('requires explicit mock transport customFetch');
    });

    it('37. HistoricalCanaryMockTransportHarness never calls global fetch', async () => {
      const globalFetchSpy = vi.spyOn(globalThis, 'fetch');
      const mockCustomFetch = vi.fn().mockImplementation(async () => {
        return new Response(JSON.stringify({
          choices: [{ message: { content: '{"status":"ok"}' } }],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 10,
            prompt_cache_hit_tokens: 5,
            prompt_cache_miss_tokens: 5,
            completion_tokens_details: { reasoning_tokens: 0 },
          },
          model: 'deepseek-v4-flash',
          modelVersion: 'DeepSeek-V4-Flash-0731',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      });

      // Attempt call without approval -> fails at approval gate without calling customFetch or globalFetch
      const result = await HistoricalCanaryMockTransportHarness.executeHistoricalMockTransport({
        phase: 'A.12B.2C-5B',
        customFetch: mockCustomFetch as any,
      } as any);

      expect(globalFetchSpy).toHaveBeenCalledTimes(0);
      expect(result.productionRoutingEnforcementAllowed).toBe(false);
      globalFetchSpy.mockRestore();
    });

    it('38. BoundedCanaryRunner.executeLiveCanary with injected customFetch still fails closed at Gate 0 under v1.2', async () => {
      const customFetchMock = vi.fn();
      const globalFetchSpy = vi.spyOn(globalThis, 'fetch');

      const result = await BoundedCanaryRunner.executeLiveCanary({
        phase: 'A.12B.2C-5D',
        executionLane: 'INTERACTIVE',
        humanApproval: validV12ApprovalEnvelope,
        capabilitySecret: validSecret,
        customFetch: customFetchMock as any,
      });

      expect(result.overallStatus).toBe('CANARY_KILL_SWITCH_TERMINATED');
      expect(result.killSwitchEvents[0].reason).toBe('UNAUTHORIZED_ENVIRONMENT');
      expect(result.killSwitchEvents[0].message).toContain('Dual-lane v1.2 live execution is blocked pending lane-specific certification');
      expect(customFetchMock).toHaveBeenCalledTimes(0);
      expect(globalFetchSpy).toHaveBeenCalledTimes(0);
      expect(result.transportAttemptCount).toBe(0);
      expect(result.productionRoutingEnforcementAllowed).toBe(false);

      globalFetchSpy.mockRestore();
    });
  });
});
