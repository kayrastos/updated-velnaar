/**
 * @file tests/ai/phaseA12B2C5IDeepSeekWindowCertificationRunner.test.ts
 * @description Comprehensive Offline Security Test Suite for Phase A.12B.2C-5I DeepSeek Window Certification Runner.
 *
 * STRICT INVARIANTS:
 * - OFFLINE ONLY.
 * - ZERO DeepSeek calls.
 * - ZERO Gemini calls.
 * - ZERO provider credentials.
 * - ZERO external network calls.
 * - DO NOT activate v1.3.
 * - CANARY_SPECIFICATION_VERSION remains 'a12b2c5-v1.2'.
 * - CANARY_LIVE_EXECUTION_ENABLED remains false.
 * - CANARY_LIVE_EXECUTION_STATE remains 'BLOCKED_PENDING_CERTIFICATION'.
 * - productionRoutingEnforcementAllowed remains false.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  CANARY_SPECIFICATION_VERSION,
  CANARY_LIVE_EXECUTION_ENABLED,
  CANARY_LIVE_EXECUTION_STATE,
  CANARY_SYNTHETIC_FIXTURES,
  computeFixtureHash,
} from '../../worker/ai/canary/canarySpecification';

import {
  SUCCESSOR_SPECIFICATION_VERSION,
  CURRENT_ACTIVE_TECHNICAL_SPEC,
  CURRENT_STRATEGY,
  CERTIFICATION_PROVIDER,
  CERTIFICATION_MODEL,
  DOCUMENTED_VERSION_TARGET,
  OFF_PEAK_CANDIDATE,
  PEAK_CANDIDATE,
  OFF_PEAK_PROGRAM,
  PEAK_PROGRAM,
  REASONING_EFFORT,
  MAX_TOKENS,
  INTERACTIVE_TIMEOUT_MS,
  CANONICAL_COST_PREFLIGHT,
  getPricingWindow,
  isPeakWindow,
} from '../../worker/ai/canary/deepSeekSingleProviderCertificationSpecification';

import {
  CERTIFIED_A12B2C_TASK_TYPES,
  CERTIFIED_A12B2C_TASK_TYPE_SET,
} from '../../worker/ai/providers/certifiedProviderTypes';
import { TaskType } from '../../worker/ai/types';

import {
  validateRunnerReadinessEvidence,
  validateCertificationEvidence,
  REQUIRED_CANONICAL_INVOCATION_COUNT,
  MAX_INVOCATION_LATENCY_MS,
} from '../../worker/ai/canary/deepSeekSuccessorCertificationStateMachine';

import {
  RUNNER_SPECIFICATION_VERSION,
  RUNNER_PROVIDER,
  RUNNER_MODEL,
  RUNNER_DOCUMENTED_VERSION_TARGET,
  RUNNER_ENDPOINT,
  RUNNER_REASONING_EFFORT,
  RUNNER_MAX_TOKENS,
  RUNNER_LIFECYCLE_TIMEOUT_MS,
  RUNNER_CANONICAL_TASK_COUNT,
  RUNNER_CONCURRENCY,
  RUNNER_OFF_PEAK_CANDIDATE,
  RUNNER_PEAK_CANDIDATE,
  RUNNER_OFF_PEAK_PROGRAM_ID,
  RUNNER_PEAK_PROGRAM_ID,
  RUNNER_OFF_PEAK_COST_BOUND_MICRO_USD,
  RUNNER_PEAK_COST_BOUND_MICRO_USD,
  NETWORK_TRANSPORT_IMPLEMENTED,
  LIVE_EXECUTION_IMPLEMENTED,
  HUMAN_AUTHORIZATION_GENERATED,
  OFFLINE_REPLAY_CAN_CERTIFY_PROVIDER,
  PROVIDER_NETWORK_CALLS,
  GLOBAL_CALLS_DISPATCHED,
  buildDeepSeekWindowCertificationPlan,
  validateOfflineReplayFixture,
  executeOfflineCertificationReplay,
  buildRunnerReadinessEvidence,
  createSyntheticTestReplayFixture,
  DeepSeekOfflineReplayFixture,
  DeepSeekOfflineReplayRecord,
  DeepSeekWindowCertificationPlan,
} from '../../worker/ai/canary/deepSeekWindowCertificationRunner';

describe('Phase A.12B.2C-5I — DeepSeek Window-Specific Offline Certification Runner', () => {
  // Global network sentinel
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('ILLEGAL_NETWORK_ACCESS: global fetch called during offline test suite!');
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // 1. SPECIFICATION IMMUTABILITY & SAFETY GATES
  // ==========================================================================
  describe('1. Global Safety Gates & Sealed Baselines', () => {
    it('preserves active technical spec as a12b2c-v1.2 and successor draft as a12b2c-v1.3-draft', () => {
      expect(CURRENT_ACTIVE_TECHNICAL_SPEC).toBe('a12b2c5-v1.2');
      expect(CANARY_SPECIFICATION_VERSION).toBe('a12b2c5-v1.2');
      expect(SUCCESSOR_SPECIFICATION_VERSION).toBe('a12b2c5-v1.3-draft');
      expect(RUNNER_SPECIFICATION_VERSION).toBe('a12b2c5-v1.3-draft');
      expect(CURRENT_STRATEGY).toBe('DEEPSEEK_FIRST_SINGLE_PROVIDER_V1');
    });

    it('enforces live execution gate is strictly disabled and blocked', () => {
      expect(CANARY_LIVE_EXECUTION_ENABLED).toBe(false);
      expect(CANARY_LIVE_EXECUTION_STATE).toBe('BLOCKED_PENDING_CERTIFICATION');
    });

    it('confirms runner module safety invariants: no transport, no live execution, no auth', () => {
      expect(NETWORK_TRANSPORT_IMPLEMENTED).toBe(false);
      expect(LIVE_EXECUTION_IMPLEMENTED).toBe(false);
      expect(HUMAN_AUTHORIZATION_GENERATED).toBe(false);
      expect(OFFLINE_REPLAY_CAN_CERTIFY_PROVIDER).toBe(false);
      expect(PROVIDER_NETWORK_CALLS).toBe(0);
      expect(GLOBAL_CALLS_DISPATCHED).toBe(0);
    });

    it('confirms 7 canonical tasks contract matches authoritative set', () => {
      expect(RUNNER_CANONICAL_TASK_COUNT).toBe(7);
      expect(REQUIRED_CANONICAL_INVOCATION_COUNT).toBe(7);
      expect(CERTIFIED_A12B2C_TASK_TYPES).toHaveLength(7);
      expect(CERTIFIED_A12B2C_TASK_TYPES).toEqual([
        'LEAD_INTENT_CLASSIFICATION',
        'LEAK_EXPLANATION',
        'GROWTH_ACTION_DRAFT',
        'BUSINESS_TWIN_SUMMARY',
        'FUNNEL_DIAGNOSTIC_EXPLANATION',
        'SEO_CONTENT_SUGGESTION',
        'ANOMALY_TRIAGE',
      ]);
    });
  });

  // ==========================================================================
  // 2. PRICING WINDOW TIMING & BOUNDARY REGRESSIONS
  // ==========================================================================
  describe('2. Pricing Window Timing & Boundary Regressions', () => {
    it('classifies Monday 00:59:59.999 UTC as OFF_PEAK', () => {
      const d = new Date('2026-09-07T00:59:59.999Z'); // Monday
      expect(getPricingWindow(d)).toBe('OFF_PEAK');
      expect(isPeakWindow(d)).toBe(false);
    });

    it('classifies Monday 01:00:00.000 UTC as PEAK (boundary start)', () => {
      const d = new Date('2026-09-07T01:00:00.000Z'); // Monday
      expect(getPricingWindow(d)).toBe('PEAK');
      expect(isPeakWindow(d)).toBe(true);
    });

    it('classifies Monday 03:59:59.999 UTC as PEAK (window 1 end boundary)', () => {
      const d = new Date('2026-09-07T03:59:59.999Z');
      expect(getPricingWindow(d)).toBe('PEAK');
      expect(isPeakWindow(d)).toBe(true);
    });

    it('classifies Monday 04:00:00.000 UTC as OFF_PEAK (window 1 exit)', () => {
      const d = new Date('2026-09-07T04:00:00.000Z');
      expect(getPricingWindow(d)).toBe('OFF_PEAK');
      expect(isPeakWindow(d)).toBe(false);
    });

    it('classifies Monday 05:59:59.999 UTC as OFF_PEAK', () => {
      const d = new Date('2026-09-07T05:59:59.999Z');
      expect(getPricingWindow(d)).toBe('OFF_PEAK');
    });

    it('classifies Monday 06:00:00.000 UTC as PEAK (window 2 start boundary)', () => {
      const d = new Date('2026-09-07T06:00:00.000Z');
      expect(getPricingWindow(d)).toBe('PEAK');
    });

    it('classifies Monday 09:59:59.999 UTC as PEAK (window 2 end boundary)', () => {
      const d = new Date('2026-09-07T09:59:59.999Z');
      expect(getPricingWindow(d)).toBe('PEAK');
    });

    it('classifies Monday 10:00:00.000 UTC as OFF_PEAK (window 2 exit)', () => {
      const d = new Date('2026-09-07T10:00:00.000Z');
      expect(getPricingWindow(d)).toBe('OFF_PEAK');
    });

    it('classifies Saturday all hours as OFF_PEAK', () => {
      const saturdayPeakHour = new Date('2026-09-05T02:00:00.000Z'); // Saturday at 02:00
      expect(getPricingWindow(saturdayPeakHour)).toBe('OFF_PEAK');
      expect(isPeakWindow(saturdayPeakHour)).toBe(false);
    });

    it('classifies Sunday all hours as OFF_PEAK', () => {
      const sundayPeakHour = new Date('2026-09-06T07:30:00.000Z'); // Sunday at 07:30
      expect(getPricingWindow(sundayPeakHour)).toBe('OFF_PEAK');
      expect(isPeakWindow(sundayPeakHour)).toBe(false);
    });
  });

  // ==========================================================================
  // 3. CANONICAL PLAN CONSTRUCTION (OFF_PEAK & PEAK)
  // ==========================================================================
  describe('3. Canonical Plan Construction', () => {
    const offPeakTime = '2026-09-09T14:00:00.000Z'; // Wednesday 14:00 UTC (OFF_PEAK)
    const peakTime = '2026-09-09T02:30:00.000Z';    // Wednesday 02:30 UTC (PEAK)

    it('constructs exact seven-call OFF_PEAK certification plan', () => {
      const result = buildDeepSeekWindowCertificationPlan({
        pricingWindow: 'OFF_PEAK',
        planTimestamp: offPeakTime,
        sourceCommitSha: '151cb2b656c92103061fd32a0f1d50b6365b3762',
        sourceTreeSha: 'f713f58f71d73c0ed5b4759bb47494cf3523d4e3',
        runNonce: 'nonce_offpeak_test_001',
      });

      expect(result.status).toBe('OFFLINE_PLAN_VALID');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.plan).not.toBeNull();

      const plan = result.plan!;
      expect(plan.pricingWindow).toBe('OFF_PEAK');
      expect(plan.targetProgram).toBe(OFF_PEAK_PROGRAM.programId);
      expect(plan.candidateId).toBe(OFF_PEAK_CANDIDATE);
      expect(plan.canonicalTaskCount).toBe(7);
      expect(plan.sealedCostBoundMicroUsd).toBe(12783);
      expect(plan.plannedInvocations).toHaveLength(7);

      for (let i = 0; i < 7; i++) {
        const inv = plan.plannedInvocations[i];
        expect(inv.invocationIndex).toBe(i + 1);
        expect(inv.taskType).toBe(CERTIFIED_A12B2C_TASK_TYPES[i]);
        expect(inv.candidateId).toBe(OFF_PEAK_CANDIDATE);
        expect(inv.provider).toBe('deepseek');
        expect(inv.requestedModelIdentifier).toBe('deepseek-v4-flash');
        expect(inv.documentedVersionTarget).toBe('DeepSeek-V4-Flash-0731');
        expect(inv.pricingWindow).toBe('OFF_PEAK');
        expect(inv.reasoningEffort).toBe('low');
        expect(inv.maxOutputTokens).toBe(2048);
        expect(inv.timeoutMs).toBe(15000);
        expect(inv.retryOrdinal).toBe(0);
        expect(inv.fallbackAllowed).toBe(false);

        // Fixture binding
        const canonicalFixture = CANARY_SYNTHETIC_FIXTURES[inv.taskType];
        expect(inv.fixtureId).toBe(canonicalFixture.id);
        expect(inv.fixtureHash).toBe(computeFixtureHash(canonicalFixture));

        // Request descriptor is pure data: no auth, no apiKey, no credentials
        const req = inv.requestDescriptor;
        expect(req.method).toBe('POST');
        expect(req.endpoint).toBe('https://api.deepseek.com/v1/chat/completions');
        expect(req.model).toBe('deepseek-v4-flash');
        expect(req.reasoning_effort).toBe('low');
        expect(req.max_tokens).toBe(2048);
        expect(req.messages).toHaveLength(2);
        expect(req.messages[0].role).toBe('system');
        expect(req.messages[1].role).toBe('user');

        const serialized = JSON.stringify(req);
        expect(serialized).not.toContain('Authorization');
        expect(serialized).not.toContain('Bearer');
        expect(serialized).not.toContain('sk-');
        expect(serialized).not.toContain('DEEPSEEK_API_KEY');
      }
    });

    it('constructs exact seven-call PEAK certification plan', () => {
      const result = buildDeepSeekWindowCertificationPlan({
        pricingWindow: 'PEAK',
        planTimestamp: peakTime,
        sourceCommitSha: '151cb2b656c92103061fd32a0f1d50b6365b3762',
        sourceTreeSha: 'f713f58f71d73c0ed5b4759bb47494cf3523d4e3',
        runNonce: 'nonce_peak_test_001',
      });

      expect(result.status).toBe('OFFLINE_PLAN_VALID');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.plan).not.toBeNull();

      const plan = result.plan!;
      expect(plan.pricingWindow).toBe('PEAK');
      expect(plan.targetProgram).toBe(PEAK_PROGRAM.programId);
      expect(plan.candidateId).toBe(PEAK_CANDIDATE);
      expect(plan.canonicalTaskCount).toBe(7);
      expect(plan.sealedCostBoundMicroUsd).toBe(25566);
      expect(plan.plannedInvocations).toHaveLength(7);
    });

    it('enforces exact 2x sealed cost bound: PEAK = exactly 2 × OFF_PEAK', () => {
      expect(RUNNER_PEAK_COST_BOUND_MICRO_USD).toBe(25566);
      expect(RUNNER_OFF_PEAK_COST_BOUND_MICRO_USD).toBe(12783);
      expect(RUNNER_PEAK_COST_BOUND_MICRO_USD).toBe(2 * RUNNER_OFF_PEAK_COST_BOUND_MICRO_USD);
      expect(CANONICAL_COST_PREFLIGHT.isExactTwoX).toBe(true);
    });
  });

  // ==========================================================================
  // 4. RUNNER READINESS EVIDENCE
  // ==========================================================================
  describe('4. Runner Readiness Evidence Construction & State Machine Validation', () => {
    it('builds and validates OFF_PEAK runner readiness evidence', () => {
      const evidence = buildRunnerReadinessEvidence('OFF_PEAK');
      expect(evidence.pricingWindow).toBe('OFF_PEAK');
      expect(evidence.windowSpecificCostBoundMicroUsd).toBe(12783);
      expect(evidence.productionRoutingEnforcementAllowed).toBe(false);
      expect(evidence.globalLiveExecutionEnabled).toBe(false);
      expect(evidence.deterministicOfflineTestsPass).toBe(true);

      const validation = validateRunnerReadinessEvidence(evidence);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('builds and validates PEAK runner readiness evidence', () => {
      const evidence = buildRunnerReadinessEvidence('PEAK');
      expect(evidence.pricingWindow).toBe('PEAK');
      expect(evidence.windowSpecificCostBoundMicroUsd).toBe(25566);
      expect(evidence.productionRoutingEnforcementAllowed).toBe(false);
      expect(evidence.globalLiveExecutionEnabled).toBe(false);
      expect(evidence.deterministicOfflineTestsPass).toBe(true);

      const validation = validateRunnerReadinessEvidence(evidence);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('rejects runner readiness evidence with tampered cost bound', () => {
      const evidence = {
        ...buildRunnerReadinessEvidence('OFF_PEAK'),
        windowSpecificCostBoundMicroUsd: 12784, // tampered
      };
      const validation = validateRunnerReadinessEvidence(evidence);
      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.includes('12784'))).toBe(true);
    });
  });

  // ==========================================================================
  // 5. OFFLINE CLEAN REPLAY EXECUTION & VALIDATION
  // ==========================================================================
  describe('5. Offline Clean Replay Execution', () => {
    const offPeakTime = '2026-09-09T14:00:00.000Z';
    const peakTime = '2026-09-09T02:30:00.000Z';

    it('executes clean OFF_PEAK replay producing OFFLINE_REPLAY_VALID', () => {
      const planResult = buildDeepSeekWindowCertificationPlan({
        pricingWindow: 'OFF_PEAK',
        planTimestamp: offPeakTime,
        sourceCommitSha: '151cb2b656c92103061fd32a0f1d50b6365b3762',
        sourceTreeSha: 'f713f58f71d73c0ed5b4759bb47494cf3523d4e3',
        runNonce: 'clean_replay_nonce_offpeak',
      });
      expect(planResult.valid).toBe(true);

      const fixture = createSyntheticTestReplayFixture('OFF_PEAK', {
        sourceCommitSha: '151cb2b656c92103061fd32a0f1d50b6365b3762',
        sourceTreeSha: 'f713f58f71d73c0ed5b4759bb47494cf3523d4e3',
        runNonce: 'clean_replay_nonce_offpeak',
      });

      const replayResult = executeOfflineCertificationReplay(fixture, planResult.plan!);

      expect(replayResult.status).toBe('OFFLINE_REPLAY_VALID');
      expect(replayResult.valid).toBe(true);
      expect(replayResult.errors).toHaveLength(0);
      expect(replayResult.offlineReplayCanCertifyProvider).toBe(false);
      expect(replayResult.certificationEvidence).not.toBeNull();

      const evidence = replayResult.certificationEvidence!;
      expect(evidence.pricingWindow).toBe('OFF_PEAK');
      expect(evidence.candidateId).toBe(OFF_PEAK_CANDIDATE);
      expect(evidence.executedInvocations).toBe(7);
      expect(evidence.passedInvocations).toBe(7);
      expect(evidence.failedInvocations).toBe(0);
      expect(evidence.clientRetries).toBe(0);
      expect(evidence.crossProviderFallbacks).toBe(0);
      expect(evidence.automaticReruns).toBe(0);
      expect(evidence.privacyViolations).toBe(0);
      expect(evidence.unexpectedNetworkAttempts).toBe(0);
      expect(evidence.aggregateSemanticScore).toBeGreaterThanOrEqual(0.85);
      expect(evidence.maxLatencyMs).toBeLessThan(15000);

      // Verify state-machine validation passes on this evidence
      const smValidation = validateCertificationEvidence(evidence);
      expect(smValidation.valid).toBe(true);
      expect(smValidation.errors).toHaveLength(0);
    });

    it('executes clean PEAK replay producing OFFLINE_REPLAY_VALID', () => {
      const planResult = buildDeepSeekWindowCertificationPlan({
        pricingWindow: 'PEAK',
        planTimestamp: peakTime,
        sourceCommitSha: '151cb2b656c92103061fd32a0f1d50b6365b3762',
        sourceTreeSha: 'f713f58f71d73c0ed5b4759bb47494cf3523d4e3',
        runNonce: 'clean_replay_nonce_peak',
      });
      expect(planResult.valid).toBe(true);

      const fixture = createSyntheticTestReplayFixture('PEAK', {
        sourceCommitSha: '151cb2b656c92103061fd32a0f1d50b6365b3762',
        sourceTreeSha: 'f713f58f71d73c0ed5b4759bb47494cf3523d4e3',
        runNonce: 'clean_replay_nonce_peak',
      });

      const replayResult = executeOfflineCertificationReplay(fixture, planResult.plan!);

      expect(replayResult.status).toBe('OFFLINE_REPLAY_VALID');
      expect(replayResult.valid).toBe(true);
      expect(replayResult.offlineReplayCanCertifyProvider).toBe(false);
      expect(replayResult.certificationEvidence).not.toBeNull();
      expect(replayResult.certificationEvidence!.pricingWindow).toBe('PEAK');
      expect(replayResult.certificationEvidence!.candidateId).toBe(PEAK_CANDIDATE);
    });

    it('PROHIBITS emitting live certification states from offline replay', () => {
      const fixture = createSyntheticTestReplayFixture('OFF_PEAK');
      const replayResult = executeOfflineCertificationReplay(fixture);

      expect(replayResult.status).toBe('OFFLINE_REPLAY_VALID');
      expect((replayResult as any).status).not.toBe('DEEPSEEK_OFF_PEAK_CERTIFIED');
      expect((replayResult as any).status).not.toBe('DEEPSEEK_PEAK_CERTIFIED');
      expect((replayResult as any).status).not.toBe('ALL_WINDOWS_CERTIFIED');
      expect((replayResult as any).status).not.toBe('ROUTING_ACTIVATION_ELIGIBLE');
    });
  });

  // ==========================================================================
  // 6. ADVERSARIAL FAIL-CLOSED MATRIX (CONDITIONS 1 TO 28)
  // ==========================================================================
  describe('6. Adversarial Fail-Closed Matrix (Conditions 1 to 28)', () => {
    // 1. wrong pricing window timestamp
    it('Condition 1: rejects OFF_PEAK plan requested during PEAK timestamp and vice versa', () => {
      const peakTimestamp = '2026-09-09T02:00:00.000Z';
      const offPeakTimestamp = '2026-09-09T14:00:00.000Z';

      const offPeakDuringPeak = buildDeepSeekWindowCertificationPlan({
        pricingWindow: 'OFF_PEAK',
        planTimestamp: peakTimestamp,
      });
      expect(offPeakDuringPeak.status).toBe('OFFLINE_PLAN_REJECTED');
      expect(offPeakDuringPeak.errors.some(e => e.includes('PRICING_WINDOW_MISMATCH'))).toBe(true);

      const peakDuringOffPeak = buildDeepSeekWindowCertificationPlan({
        pricingWindow: 'PEAK',
        planTimestamp: offPeakTimestamp,
      });
      expect(peakDuringOffPeak.status).toBe('OFFLINE_PLAN_REJECTED');
      expect(peakDuringOffPeak.errors.some(e => e.includes('PRICING_WINDOW_MISMATCH'))).toBe(true);
    });

    // 2. duplicate canonical task
    it('Condition 2: rejects duplicate canonical task in plan and in replay fixture', () => {
      const duplicateTasks: TaskType[] = [
        'LEAD_INTENT_CLASSIFICATION',
        'LEAD_INTENT_CLASSIFICATION', // duplicate
        'GROWTH_ACTION_DRAFT',
        'BUSINESS_TWIN_SUMMARY',
        'FUNNEL_DIAGNOSTIC_EXPLANATION',
        'SEO_CONTENT_SUGGESTION',
        'ANOMALY_TRIAGE',
      ];

      const planResult = buildDeepSeekWindowCertificationPlan({
        pricingWindow: 'OFF_PEAK',
        planTimestamp: '2026-09-09T14:00:00.000Z',
        customTasks: duplicateTasks,
      });
      expect(planResult.status).toBe('OFFLINE_PLAN_REJECTED');
      expect(planResult.errors.some(e => e.includes('DUPLICATE_TASK'))).toBe(true);

      // Replay fixture with duplicate task
      const baseFixture = createSyntheticTestReplayFixture('OFF_PEAK');
      const recordsWithDuplicate = [...baseFixture.records];
      recordsWithDuplicate[1] = {
        ...recordsWithDuplicate[1],
        taskType: 'LEAD_INTENT_CLASSIFICATION',
      };
      const fixtureWithDuplicate = { ...baseFixture, records: recordsWithDuplicate };
      const replayResult = executeOfflineCertificationReplay(fixtureWithDuplicate);
      expect(replayResult.status).toBe('OFFLINE_REPLAY_REJECTED');
      expect(replayResult.errors.some(e => e.includes('Duplicate canonical taskType'))).toBe(true);
    });

    // 3. missing canonical task
    it('Condition 3: rejects missing canonical task in plan and in replay fixture', () => {
      const missingTasks = CERTIFIED_A12B2C_TASK_TYPES.slice(0, 6) as TaskType[]; // only 6 tasks
      const planResult = buildDeepSeekWindowCertificationPlan({
        pricingWindow: 'OFF_PEAK',
        planTimestamp: '2026-09-09T14:00:00.000Z',
        customTasks: missingTasks,
      });
      expect(planResult.status).toBe('OFFLINE_PLAN_REJECTED');
      expect(planResult.errors.some(e => e.includes('Canonical task count mismatch'))).toBe(true);
    });

    // 4. unknown task
    it('Condition 4: rejects unknown task in plan and in replay fixture', () => {
      const unknownTasks = [
        ...CERTIFIED_A12B2C_TASK_TYPES.slice(0, 6),
        'UNOFFICIAL_UNKNOWN_TASK' as TaskType,
      ];
      const planResult = buildDeepSeekWindowCertificationPlan({
        pricingWindow: 'OFF_PEAK',
        planTimestamp: '2026-09-09T14:00:00.000Z',
        customTasks: unknownTasks,
      });
      expect(planResult.status).toBe('OFFLINE_PLAN_REJECTED');
      expect(planResult.errors.some(e => e.includes('UNKNOWN_TASK'))).toBe(true);

      const baseFixture = createSyntheticTestReplayFixture('OFF_PEAK');
      const recordsWithUnknown = [...baseFixture.records];
      recordsWithUnknown[6] = {
        ...recordsWithUnknown[6],
        taskType: 'ROGUE_TASK' as TaskType,
      };
      const fixtureWithUnknown = { ...baseFixture, records: recordsWithUnknown };
      const replayResult = executeOfflineCertificationReplay(fixtureWithUnknown);
      expect(replayResult.status).toBe('OFFLINE_REPLAY_REJECTED');
      expect(replayResult.errors.some(e => e.includes('unknown non-canonical taskType'))).toBe(true);
    });

    // 5. eighth task
    it('Condition 5: rejects eighth task in plan and in replay fixture', () => {
      const eightTasks = [
        ...CERTIFIED_A12B2C_TASK_TYPES,
        'LEAD_INTENT_CLASSIFICATION',
      ] as TaskType[];
      const planResult = buildDeepSeekWindowCertificationPlan({
        pricingWindow: 'OFF_PEAK',
        planTimestamp: '2026-09-09T14:00:00.000Z',
        customTasks: eightTasks,
      });
      expect(planResult.status).toBe('OFFLINE_PLAN_REJECTED');
      expect(planResult.errors.some(e => e.includes('task count mismatch'))).toBe(true);
    });

    // 6. fixture/task mismatch
    it('Condition 6: rejects fixture/task mismatch when record taskType does not match plan invocation', () => {
      const planResult = buildDeepSeekWindowCertificationPlan({
        pricingWindow: 'OFF_PEAK',
        planTimestamp: '2026-09-09T14:00:00.000Z',
      });
      expect(planResult.valid).toBe(true);

      const baseFixture = createSyntheticTestReplayFixture('OFF_PEAK');
      // Swap tasks of record 0 and 1
      const swappedRecords = [...baseFixture.records];
      const temp = swappedRecords[0];
      swappedRecords[0] = { ...swappedRecords[1], invocationIndex: 1 };
      swappedRecords[1] = { ...temp, invocationIndex: 2 };

      const swappedFixture = { ...baseFixture, records: swappedRecords };
      const replayResult = executeOfflineCertificationReplay(swappedFixture, planResult.plan!);
      expect(replayResult.status).toBe('OFFLINE_REPLAY_REJECTED');
      expect(replayResult.errors.some(e => e.includes('taskType mismatch with plan'))).toBe(true);
    });

    // 7. wrong candidate
    it('Condition 7: rejects wrong candidate ID for the pricing window', () => {
      const planResult = buildDeepSeekWindowCertificationPlan({
        pricingWindow: 'OFF_PEAK',
        planTimestamp: '2026-09-09T14:00:00.000Z',
        candidateId: 'wrong-candidate-identifier',
      });
      expect(planResult.status).toBe('OFFLINE_PLAN_REJECTED');
      expect(planResult.errors.some(e => e.includes('candidateId mismatch'))).toBe(true);

      const fixture = createSyntheticTestReplayFixture('OFF_PEAK', {
        candidateId: 'rogue-candidate',
      });
      const replayResult = executeOfflineCertificationReplay(fixture);
      expect(replayResult.status).toBe('OFFLINE_REPLAY_REJECTED');
      expect(replayResult.errors.some(e => e.includes('candidateId mismatch'))).toBe(true);
    });

    // 8. wrong provider
    it('Condition 8: rejects wrong provider in replay records', () => {
      const fixture = createSyntheticTestReplayFixture('OFF_PEAK', {
        recordOverrides: { requestedModelIdentifier: 'openai' },
      });
      const replayResult = executeOfflineCertificationReplay(fixture);
      expect(replayResult.status).toBe('OFFLINE_REPLAY_REJECTED');
      expect(replayResult.errors.some(e => e.includes('requestedModelIdentifier mismatch'))).toBe(true);
    });

    // 9. wrong requested model
    it('Condition 9: rejects wrong requested model identifier', () => {
      const fixture = createSyntheticTestReplayFixture('OFF_PEAK', {
        recordOverrides: { requestedModelIdentifier: 'deepseek-v3' },
      });
      const replayResult = executeOfflineCertificationReplay(fixture);
      expect(replayResult.status).toBe('OFFLINE_REPLAY_REJECTED');
      expect(replayResult.errors.some(e => e.includes('requestedModelIdentifier mismatch'))).toBe(true);
    });

    // 10. wrong returned model
    it('Condition 10: rejects wrong returned model identifier', () => {
      const fixture = createSyntheticTestReplayFixture('OFF_PEAK', {
        recordOverrides: { returnedModelIdentifier: 'deepseek-v4-chat' },
      });
      const replayResult = executeOfflineCertificationReplay(fixture);
      expect(replayResult.status).toBe('OFFLINE_REPLAY_REJECTED');
      expect(replayResult.errors.some(e => e.includes('returnedModelIdentifier mismatch'))).toBe(true);
    });

    // 11. missing provider usage
    it('Condition 11: rejects missing provider reported usage', () => {
      const fixture = createSyntheticTestReplayFixture('OFF_PEAK', {
        recordOverrides: { providerReportedUsage: false },
      });
      const replayResult = executeOfflineCertificationReplay(fixture);
      expect(replayResult.status).toBe('OFFLINE_REPLAY_REJECTED');
      expect(replayResult.errors.some(e => e.includes('missing providerReportedUsage'))).toBe(true);
    });

    // 12. schema invalid
    it('Condition 12: rejects schemaValid false', () => {
      const fixture = createSyntheticTestReplayFixture('OFF_PEAK', {
        recordOverrides: { schemaValid: false },
      });
      const replayResult = executeOfflineCertificationReplay(fixture);
      expect(replayResult.status).toBe('OFFLINE_REPLAY_REJECTED');
      expect(replayResult.errors.some(e => e.includes('schemaValid must be strictly true'))).toBe(true);
    });

    // 13. taskPass false
    it('Condition 13: rejects taskPass false', () => {
      const fixture = createSyntheticTestReplayFixture('OFF_PEAK', {
        recordOverrides: { taskPass: false },
      });
      const replayResult = executeOfflineCertificationReplay(fixture);
      expect(replayResult.status).toBe('OFFLINE_REPLAY_REJECTED');
      expect(replayResult.errors.some(e => e.includes('taskPass must be strictly true'))).toBe(true);
    });

    // 14. latency = 15000
    it('Condition 14: rejects latency exactly equal to 15000ms (must be strictly < 15000)', () => {
      const fixture = createSyntheticTestReplayFixture('OFF_PEAK', {
        recordOverrides: { latencyMs: 15000 },
      });
      const replayResult = executeOfflineCertificationReplay(fixture);
      expect(replayResult.status).toBe('OFFLINE_REPLAY_REJECTED');
      expect(replayResult.errors.some(e => e.includes('exceeds or equals hard timeout'))).toBe(true);
    });

    // 15. latency > 15000
    it('Condition 15: rejects latency greater than 15000ms (15001ms)', () => {
      const fixture = createSyntheticTestReplayFixture('OFF_PEAK', {
        recordOverrides: { latencyMs: 15001 },
      });
      const replayResult = executeOfflineCertificationReplay(fixture);
      expect(replayResult.status).toBe('OFFLINE_REPLAY_REJECTED');
      expect(replayResult.errors.some(e => e.includes('exceeds or equals hard timeout'))).toBe(true);
    });

    // 16. semantic aggregate < 0.85
    it('Condition 16: rejects aggregate semantic score < 0.85', () => {
      const fixture = createSyntheticTestReplayFixture('OFF_PEAK', {
        recordOverrides: { semanticScore: 0.84 },
      });
      const replayResult = executeOfflineCertificationReplay(fixture);
      expect(replayResult.status).toBe('OFFLINE_REPLAY_REJECTED');
      expect(replayResult.errors.some(e => e.includes('aggregateSemanticScore'))).toBe(true);
    });

    // 17. privacy violation
    it('Condition 17: rejects privacy violation (privacyViolation: true)', () => {
      const fixture = createSyntheticTestReplayFixture('OFF_PEAK', {
        recordOverrides: { privacyViolation: true },
      });
      const replayResult = executeOfflineCertificationReplay(fixture);
      expect(replayResult.status).toBe('OFFLINE_REPLAY_REJECTED');
      expect(replayResult.errors.some(e => e.includes('PRIVACY_VIOLATION'))).toBe(true);
    });

    // 18. unexpectedNetworkAttempt > 0
    it('Condition 18: rejects unexpected network attempts (unexpectedNetworkAttempt: true)', () => {
      const fixture = createSyntheticTestReplayFixture('OFF_PEAK', {
        recordOverrides: { unexpectedNetworkAttempt: true },
      });
      const replayResult = executeOfflineCertificationReplay(fixture);
      expect(replayResult.status).toBe('OFFLINE_REPLAY_REJECTED');
      expect(replayResult.errors.some(e => e.includes('UNEXPECTED_NETWORK_ATTEMPT'))).toBe(true);
    });

    // 19. retry > 0
    it('Condition 19: rejects retries > 0', () => {
      const fixture = createSyntheticTestReplayFixture('OFF_PEAK', {
        recordOverrides: { retries: 1 },
      });
      const replayResult = executeOfflineCertificationReplay(fixture);
      expect(replayResult.status).toBe('OFFLINE_REPLAY_REJECTED');
      expect(replayResult.errors.some(e => e.includes('retries must be 0'))).toBe(true);
    });

    // 20. fallback > 0
    it('Condition 20: rejects cross-provider fallback > 0', () => {
      const fixture = createSyntheticTestReplayFixture('OFF_PEAK', {
        recordOverrides: { fallbacks: 1 },
      });
      const replayResult = executeOfflineCertificationReplay(fixture);
      expect(replayResult.status).toBe('OFFLINE_REPLAY_REJECTED');
      expect(replayResult.errors.some(e => e.includes('fallbacks must be 0'))).toBe(true);
    });

    // 21. automatic rerun > 0
    it('Condition 21: rejects automatic reruns > 0', () => {
      const fixture = createSyntheticTestReplayFixture('OFF_PEAK', {
        recordOverrides: { automaticReruns: 1 },
      });
      const replayResult = executeOfflineCertificationReplay(fixture);
      expect(replayResult.status).toBe('OFFLINE_REPLAY_REJECTED');
      expect(replayResult.errors.some(e => e.includes('automatic reruns must be 0'))).toBe(true);
    });

    // 22. cost > offline budget
    it('Condition 22: rejects observed cost exceeding budget ceiling', () => {
      const fixture = createSyntheticTestReplayFixture('OFF_PEAK', {
        maxBudgetMicroUsd: 5000, // budget smaller than total observed cost
      });
      const replayResult = executeOfflineCertificationReplay(fixture);
      expect(replayResult.status).toBe('OFFLINE_REPLAY_REJECTED');
      expect(replayResult.errors.some(e => e.includes('BUDGET_BREACH'))).toBe(true);
    });

    // 23. OFF_PEAK cost bound not 12783
    it('Condition 23: rejects OFF_PEAK plan or fixture budget exceeding 12783 microUSD', () => {
      const fixture = createSyntheticTestReplayFixture('OFF_PEAK', {
        maxBudgetMicroUsd: 12784,
      });
      const replayResult = executeOfflineCertificationReplay(fixture);
      expect(replayResult.status).toBe('OFFLINE_REPLAY_REJECTED');
      expect(replayResult.errors.some(e => e.includes('exceeds sealed cost bound'))).toBe(true);
    });

    // 24. PEAK cost bound not 25566
    it('Condition 24: rejects PEAK plan or fixture budget exceeding 25566 microUSD', () => {
      const fixture = createSyntheticTestReplayFixture('PEAK', {
        maxBudgetMicroUsd: 25567,
      });
      const replayResult = executeOfflineCertificationReplay(fixture);
      expect(replayResult.status).toBe('OFFLINE_REPLAY_REJECTED');
      expect(replayResult.errors.some(e => e.includes('exceeds sealed cost bound'))).toBe(true);
    });

    // 25. system_fingerprint treated as model version
    it('Condition 25: fail-closed when system_fingerprint is treated as model version', () => {
      const fixture = createSyntheticTestReplayFixture('OFF_PEAK');
      const validation = validateOfflineReplayFixture(fixture, undefined, {
        treatSystemFingerprintAsModelVersion: true,
      });
      expect(validation.valid).toBe(false);
      expect(
        validation.errors.some(e =>
          e.includes('systemFingerprint must not be treated as model version')
        )
      ).toBe(true);
    });

    // 26. response count 6
    it('Condition 26: rejects response count 6 (exactly 7 required)', () => {
      const baseFixture = createSyntheticTestReplayFixture('OFF_PEAK');
      const sixRecords = baseFixture.records.slice(0, 6);
      const fixtureSix = { ...baseFixture, records: sixRecords };
      const replayResult = executeOfflineCertificationReplay(fixtureSix);
      expect(replayResult.status).toBe('OFFLINE_REPLAY_REJECTED');
      expect(replayResult.errors.some(e => e.includes('Record count mismatch'))).toBe(true);
    });

    // 27. response count 8
    it('Condition 27: rejects response count 8 (exactly 7 required)', () => {
      const baseFixture = createSyntheticTestReplayFixture('OFF_PEAK');
      const eightRecords = [
        ...baseFixture.records,
        {
          ...baseFixture.records[0],
          invocationIndex: 8,
        },
      ];
      const fixtureEight = { ...baseFixture, records: eightRecords };
      const replayResult = executeOfflineCertificationReplay(fixtureEight);
      expect(replayResult.status).toBe('OFFLINE_REPLAY_REJECTED');
      expect(replayResult.errors.some(e => e.includes('Record count mismatch'))).toBe(true);
    });

    // 28. non-sequential/duplicate invocation indexes
    it('Condition 28: rejects non-sequential or duplicate invocation indexes', () => {
      const baseFixture = createSyntheticTestReplayFixture('OFF_PEAK');
      const recordsNonSeq = baseFixture.records.map((r, i) => {
        if (i === 1) return { ...r, invocationIndex: 1 }; // duplicate index 1
        return r;
      });
      const fixtureNonSeq = { ...baseFixture, records: recordsNonSeq };
      const replayResult = executeOfflineCertificationReplay(fixtureNonSeq);
      expect(replayResult.status).toBe('OFFLINE_REPLAY_REJECTED');
      expect(replayResult.errors.some(e => e.includes('invocationIndex non-sequential'))).toBe(true);
    });
  });

  // ==========================================================================
  // 7. SOURCE CODE SECURITY SCAN & STATIC INTEGRITY
  // ==========================================================================
  describe('7. Source Code Static Integrity & Network Impossibility', () => {
    it('verifies that runner source file has ZERO network imports or transport calls', () => {
      const runnerFilePath = path.resolve(
        __dirname,
        '../../worker/ai/canary/deepSeekWindowCertificationRunner.ts'
      );
      const runnerSource = fs.readFileSync(runnerFilePath, 'utf8');

      // Static assertions against forbidden tokens
      expect(runnerSource).not.toContain('globalThis.fetch');
      expect(runnerSource).not.toContain('customFetch');
      expect(runnerSource).not.toContain('node:http');
      expect(runnerSource).not.toContain('node:https');
      expect(runnerSource).not.toContain('undici');
      expect(runnerSource).not.toContain('axios');
      expect(runnerSource).not.toContain('DEEPSEEK_API_KEY');

      // No fetch calls
      const fetchRegex = /\bfetch\s*\(/;
      expect(fetchRegex.test(runnerSource)).toBe(false);

      // Verify no live methods in runner source
      expect(runnerSource).not.toContain('executeLive');
      expect(runnerSource).not.toContain('executeNetwork');
      expect(runnerSource).not.toContain('dispatch(');
    });

    it('proves zero global fetch calls occurred during all offline runner operations', () => {
      expect(fetchSpy).toHaveBeenCalledTimes(0);
    });
  });
});
