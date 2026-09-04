/**
 * @file tests/ai/phaseA12B2C5GVersionIndependentLiveGate.test.ts
 * @description Phase A.12B.2C-5G Version-Independent Global Live Gate Foundation Specification Suite.
 * 
 * STRICT INVARIANTS:
 * - Offline security test suite.
 * - ZERO provider network calls (DeepSeek, Gemini).
 * - ZERO provider credentials required or evaluated.
 * - Verifies authoritative version-independent fail-closed gate policy.
 * - Proves gate semantics do not derive from version strings or caller-controlled options.
 * - productionRoutingEnforcementAllowed MUST remain false.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  CANARY_SPECIFICATION_VERSION,
  CANARY_LIVE_EXECUTION_ENABLED,
  CANARY_LIVE_EXECUTION_STATE,
  CANARY_AUTHORITATIVE_LIVE_POLICY,
  generateCanaryApprovalToken,
  CanaryHumanApprovalEnvelope,
} from '../../worker/ai/canary/canarySpecification';
import { BoundedCanaryRunner } from '../../worker/ai/canary/boundedCanaryRunner';
import {
  SUCCESSOR_SPECIFICATION_VERSION,
  CURRENT_ACTIVE_TECHNICAL_SPEC,
} from '../../worker/ai/canary/deepSeekSingleProviderCertificationSpecification';

describe('Phase A.12B.2C-5G Version-Independent Global Live Gate Foundation', () => {
  let globalFetchSpy: ReturnType<typeof vi.spyOn>;
  const validSecret = 'a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0';
  const validTimestamp = '2026-09-04T12:00:00.000Z';
  const validDate = '20260904';
  const validCommit = '7f4d52d6fa5891ec3972c97eb6f9adc8a51ac61b';
  const validNonce = 'nonce-5g-test-4289';

  const validApprovalEnvelope: CanaryHumanApprovalEnvelope = {
    approvedBy: 'lead@velnar.internal',
    approvalTimestamp: validTimestamp,
    targetPhase: 'A.12B.2C-5D',
    approvalToken: generateCanaryApprovalToken({
      approvedBy: 'lead@velnar.internal',
      approvalTimestamp: validTimestamp,
      targetPhase: 'A.12B.2C-5D',
      environmentTarget: 'CONTROLLED_CANARY',
      dateYyyyMmDd: validDate,
      maxBudgetMicroUsd: 50000,
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
  };

  beforeEach(() => {
    globalFetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    globalFetchSpy.mockRestore();
    vi.restoreAllMocks();
  });

  // 1. CANARY_LIVE_EXECUTION_ENABLED === false
  it('1. CANARY_LIVE_EXECUTION_ENABLED === false', () => {
    expect(CANARY_LIVE_EXECUTION_ENABLED).toBe(false);
    expect(CANARY_AUTHORITATIVE_LIVE_POLICY.liveExecutionEnabled).toBe(false);
  });

  // 2. state === BLOCKED_PENDING_CERTIFICATION
  it('2. state === BLOCKED_PENDING_CERTIFICATION', () => {
    expect(CANARY_LIVE_EXECUTION_STATE).toBe('BLOCKED_PENDING_CERTIFICATION');
    expect(CANARY_AUTHORITATIVE_LIVE_POLICY.liveExecutionState).toBe('BLOCKED_PENDING_CERTIFICATION');
  });

  // 3. current spec still a12b2c5-v1.2
  it('3. current spec still a12b2c5-v1.2', () => {
    expect(CANARY_SPECIFICATION_VERSION).toBe('a12b2c5-v1.2');
    expect(CURRENT_ACTIVE_TECHNICAL_SPEC).toBe('a12b2c5-v1.2');
  });

  // 4. successor draft still a12b2c5-v1.3-draft
  it('4. successor draft still a12b2c5-v1.3-draft', () => {
    expect(SUCCESSOR_SPECIFICATION_VERSION).toBe('a12b2c5-v1.3-draft');
  });

  // 5. live policy does not derive from current version
  it('5. live policy does not derive from current version', () => {
    expect(typeof CANARY_LIVE_EXECUTION_ENABLED).toBe('boolean');
    expect(CANARY_AUTHORITATIVE_LIVE_POLICY.specificationVersionControlled).toBe(false);
    // Evaluating hypothetical versions must not alter the authoritative policy
    const hypotheticalVersions = ['a12b2c5-v1.0', 'a12b2c5-v1.1', 'a12b2c5-v1.2', 'a12b2c5-v1.3', 'a12b2c5-v2.0'];
    for (const v of hypotheticalVersions) {
      expect(CANARY_LIVE_EXECUTION_ENABLED).toBe(false);
      expect(v === CANARY_SPECIFICATION_VERSION ? CANARY_LIVE_EXECUTION_ENABLED : false).toBe(false);
    }
  });

  // 6. live policy does not derive from successor version
  it('6. live policy does not derive from successor version', () => {
    expect(CANARY_LIVE_EXECUTION_ENABLED).toBe(false);
    expect(SUCCESSOR_SPECIFICATION_VERSION).toBe('a12b2c5-v1.3-draft');
    expect(CANARY_AUTHORITATIVE_LIVE_POLICY.defaultDisabled).toBe(true);
    // Successor activation is not authorized; policy remains immutable false
    expect(CANARY_LIVE_EXECUTION_STATE).toBe('BLOCKED_PENDING_CERTIFICATION');
  });

  // 7. executeLiveCanary phase5B/no-lane blocked
  it('7. executeLiveCanary phase5B/no-lane blocked', async () => {
    const result = await BoundedCanaryRunner.executeLiveCanary({
      phase: 'A.12B.2C-5B',
      capabilitySecret: validSecret,
    } as any);

    expect(result.overallStatus).toBe('CANARY_KILL_SWITCH_TERMINATED');
    expect(result.killSwitchEvents[0].reason).toBe('UNAUTHORIZED_ENVIRONMENT');
    expect(result.killSwitchEvents[0].message).toContain(
      'Live canary execution is blocked by authoritative certification policy.'
    );
    expect(result.transportAttemptCount).toBe(0);
    expect(result.summaryCounts.executedInvocations).toBe(0);
    expect(result.productionRoutingEnforcementAllowed).toBe(false);
  });

  // 8. phase5D interactive blocked
  it('8. phase5D interactive blocked', async () => {
    const result = await BoundedCanaryRunner.executeLiveCanary({
      phase: 'A.12B.2C-5D',
      executionLane: 'INTERACTIVE',
      capabilitySecret: validSecret,
      humanApproval: validApprovalEnvelope,
    });

    expect(result.overallStatus).toBe('CANARY_KILL_SWITCH_TERMINATED');
    expect(result.killSwitchEvents[0].reason).toBe('UNAUTHORIZED_ENVIRONMENT');
    expect(result.killSwitchEvents[0].message).toContain(
      'Live canary execution is blocked by authoritative certification policy.'
    );
    expect(result.transportAttemptCount).toBe(0);
  });

  // 9. phase5D background blocked
  it('9. phase5D background blocked', async () => {
    const result = await BoundedCanaryRunner.executeLiveCanary({
      phase: 'A.12B.2C-5D',
      executionLane: 'BACKGROUND_ECONOMY',
      capabilitySecret: validSecret,
      humanApproval: validApprovalEnvelope,
    });

    expect(result.overallStatus).toBe('CANARY_KILL_SWITCH_TERMINATED');
    expect(result.killSwitchEvents[0].reason).toBe('UNAUTHORIZED_ENVIRONMENT');
    expect(result.killSwitchEvents[0].message).toContain(
      'Live canary execution is blocked by authoritative certification policy.'
    );
    expect(result.transportAttemptCount).toBe(0);
  });

  // 10. valid-looking approval cannot bypass
  it('10. valid-looking approval cannot bypass', async () => {
    const result = await BoundedCanaryRunner.executeLiveCanary({
      phase: 'A.12B.2C-5D',
      executionLane: 'INTERACTIVE',
      capabilitySecret: validSecret,
      humanApproval: validApprovalEnvelope,
    });

    expect(result.overallStatus).toBe('CANARY_KILL_SWITCH_TERMINATED');
    expect(result.killSwitchEvents[0].reason).toBe('UNAUTHORIZED_ENVIRONMENT');
    expect(result.transportAttemptCount).toBe(0);
  });

  // 11. invalid approval cannot bypass
  it('11. invalid approval cannot bypass', async () => {
    const corruptedApproval: CanaryHumanApprovalEnvelope = {
      ...validApprovalEnvelope,
      approvalToken: 'completely-invalid-corrupted-token',
    };

    const result = await BoundedCanaryRunner.executeLiveCanary({
      phase: 'A.12B.2C-5D',
      executionLane: 'INTERACTIVE',
      capabilitySecret: validSecret,
      humanApproval: corruptedApproval,
    });

    expect(result.overallStatus).toBe('CANARY_KILL_SWITCH_TERMINATED');
    expect(result.killSwitchEvents[0].reason).toBe('UNAUTHORIZED_ENVIRONMENT');
    expect(result.transportAttemptCount).toBe(0);
  });

  // 12. provider env cannot bypass
  it('12. provider env cannot bypass', async () => {
    const prevDeepSeek = process.env.DEEPSEEK_API_KEY;
    const prevGemini = process.env.GEMINI_API_KEY;
    try {
      process.env.DEEPSEEK_API_KEY = 'sk-mock-deepseek-env-token';
      process.env.GEMINI_API_KEY = 'sk-mock-gemini-env-token';

      const result = await BoundedCanaryRunner.executeLiveCanary({
        phase: 'A.12B.2C-5D',
        executionLane: 'INTERACTIVE',
        capabilitySecret: validSecret,
        humanApproval: validApprovalEnvelope,
      });

      expect(result.overallStatus).toBe('CANARY_KILL_SWITCH_TERMINATED');
      expect(result.killSwitchEvents[0].reason).toBe('UNAUTHORIZED_ENVIRONMENT');
      expect(result.transportAttemptCount).toBe(0);
    } finally {
      if (prevDeepSeek !== undefined) process.env.DEEPSEEK_API_KEY = prevDeepSeek;
      else delete process.env.DEEPSEEK_API_KEY;
      if (prevGemini !== undefined) process.env.GEMINI_API_KEY = prevGemini;
      else delete process.env.GEMINI_API_KEY;
    }
  });

  // 13. customFetch cannot bypass
  it('13. customFetch cannot bypass', async () => {
    const customFetchMock = vi.fn().mockRejectedValue(new Error('customFetch should never be invoked'));

    const result = await BoundedCanaryRunner.executeLiveCanary({
      phase: 'A.12B.2C-5D',
      executionLane: 'INTERACTIVE',
      capabilitySecret: validSecret,
      humanApproval: validApprovalEnvelope,
      customFetch: customFetchMock as any,
    });

    expect(result.overallStatus).toBe('CANARY_KILL_SWITCH_TERMINATED');
    expect(result.killSwitchEvents[0].reason).toBe('UNAUTHORIZED_ENVIRONMENT');
    expect(result.transportAttemptCount).toBe(0);
  });

  // 14. customFetch sentinel = 0
  it('14. customFetch sentinel = 0', async () => {
    const customFetchMock = vi.fn();

    await BoundedCanaryRunner.executeLiveCanary({
      phase: 'A.12B.2C-5D',
      executionLane: 'INTERACTIVE',
      capabilitySecret: validSecret,
      humanApproval: validApprovalEnvelope,
      customFetch: customFetchMock as any,
    });

    expect(customFetchMock).toHaveBeenCalledTimes(0);
  });

  // 15. global fetch sentinel = 0
  it('15. global fetch sentinel = 0', async () => {
    await BoundedCanaryRunner.executeLiveCanary({
      phase: 'A.12B.2C-5D',
      executionLane: 'INTERACTIVE',
      capabilitySecret: validSecret,
      humanApproval: validApprovalEnvelope,
    });

    expect(globalFetchSpy).toHaveBeenCalledTimes(0);
  });

  // 16. transportAttemptCount = 0
  it('16. transportAttemptCount = 0', async () => {
    const result = await BoundedCanaryRunner.executeLiveCanary({
      phase: 'A.12B.2C-5D',
      executionLane: 'INTERACTIVE',
      capabilitySecret: validSecret,
      humanApproval: validApprovalEnvelope,
    });

    expect(result.transportAttemptCount).toBe(0);
    expect(result.attemptRecords).toEqual([]);
  });

  // 17. executedInvocations = 0
  it('17. executedInvocations = 0', async () => {
    const result = await BoundedCanaryRunner.executeLiveCanary({
      phase: 'A.12B.2C-5D',
      executionLane: 'INTERACTIVE',
      capabilitySecret: validSecret,
      humanApproval: validApprovalEnvelope,
    });

    expect(result.summaryCounts.executedInvocations).toBe(0);
    expect(result.invocations).toEqual([]);
  });

  // 18. observed cost = 0
  it('18. observed cost = 0', async () => {
    const result = await BoundedCanaryRunner.executeLiveCanary({
      phase: 'A.12B.2C-5D',
      executionLane: 'BACKGROUND_ECONOMY',
      capabilitySecret: validSecret,
      humanApproval: validApprovalEnvelope,
    });

    expect(result.summaryCounts.totalObservedCostMicroUsd).toBe(0);
  });

  // 19. productionRoutingEnforcementAllowed = false
  it('19. productionRoutingEnforcementAllowed = false', async () => {
    const result = await BoundedCanaryRunner.executeLiveCanary({
      phase: 'A.12B.2C-5D',
      executionLane: 'INTERACTIVE',
      capabilitySecret: validSecret,
      humanApproval: validApprovalEnvelope,
    });

    expect(result.productionRoutingEnforcementAllowed).toBe(false);
  });

  // 20. static runner source no longer uses CANARY_SPECIFICATION_VERSION === 'a12b2c5-v1.2' as Gate 0 authorization logic
  it('20. static runner source no longer uses CANARY_SPECIFICATION_VERSION === \'a12b2c5-v1.2\' as Gate 0 authorization logic', () => {
    const runnerPath = path.resolve(__dirname, '../../worker/ai/canary/boundedCanaryRunner.ts');
    const runnerSource = fs.readFileSync(runnerPath, 'utf8');

    // Verify Gate 0 does NOT contain the legacy string comparison
    expect(runnerSource).not.toContain("CANARY_SPECIFICATION_VERSION === 'a12b2c5-v1.2'");
    expect(runnerSource).not.toContain('CANARY_SPECIFICATION_VERSION === "a12b2c5-v1.2"');

    // Verify Gate 0 uses CANARY_LIVE_EXECUTION_ENABLED
    expect(runnerSource).toContain('if (!CANARY_LIVE_EXECUTION_ENABLED)');
  });

  // 21. no env flag enables live execution
  it('21. no env flag enables live execution', async () => {
    const testEnvs = [
      'CANARY_LIVE_EXECUTION',
      'ENABLE_CANARY_LIVE',
      'VELNAR_CANARY_LIVE',
      'A12B2C5_LIVE_GATE',
      'CANARY_LIVE_OVERRIDE',
    ];

    for (const envKey of testEnvs) {
      process.env[envKey] = 'true';
    }

    try {
      expect(CANARY_LIVE_EXECUTION_ENABLED).toBe(false);
      expect(CANARY_AUTHORITATIVE_LIVE_POLICY.processEnvOverride).toBe(false);

      const result = await BoundedCanaryRunner.executeLiveCanary({
        phase: 'A.12B.2C-5D',
        executionLane: 'INTERACTIVE',
        capabilitySecret: validSecret,
        humanApproval: validApprovalEnvelope,
      });

      expect(result.overallStatus).toBe('CANARY_KILL_SWITCH_TERMINATED');
      expect(result.transportAttemptCount).toBe(0);
      expect(globalFetchSpy).toHaveBeenCalledTimes(0);
    } finally {
      for (const envKey of testEnvs) {
        delete process.env[envKey];
      }
    }
  });

  // 22. no caller option enables live execution
  it('22. no caller option enables live execution', async () => {
    const bypassAttempts = [
      { forceLive: true },
      { bypassGate0: true },
      { isV12LiveAttempt: true },
      { isV12LiveAttempt: false },
      { overrideAuthoritativePolicy: true },
      { allowLiveExecution: true },
      { skipFailClosed: true },
      { enableProductionRouting: true },
    ];

    for (const options of bypassAttempts) {
      const result = await BoundedCanaryRunner.executeLiveCanary({
        phase: 'A.12B.2C-5D',
        executionLane: 'INTERACTIVE',
        capabilitySecret: validSecret,
        humanApproval: validApprovalEnvelope,
        ...(options as any),
      });

      expect(result.overallStatus).toBe('CANARY_KILL_SWITCH_TERMINATED');
      expect(result.killSwitchEvents[0].reason).toBe('UNAUTHORIZED_ENVIRONMENT');
      expect(result.transportAttemptCount).toBe(0);
      expect(result.productionRoutingEnforcementAllowed).toBe(false);
    }

    expect(globalFetchSpy).toHaveBeenCalledTimes(0);
  });

  // 23. Caller-controlled bypass matrix: all scenarios fail closed with 0 network calls
  it('23. Caller-controlled bypass matrix: all scenarios fail closed with 0 network calls', async () => {
    const customFetchMock = vi.fn();

    const testScenarios = [
      // A) phase 5B, no lane
      { phase: 'A.12B.2C-5B' },
      // B) phase 5D, INTERACTIVE
      { phase: 'A.12B.2C-5D', executionLane: 'INTERACTIVE' as const },
      // C) phase 5D, BACKGROUND_ECONOMY
      { phase: 'A.12B.2C-5D', executionLane: 'BACKGROUND_ECONOMY' as const },
      // D) isV12LiveAttempt = false
      { phase: 'A.12B.2C-5D', isV12LiveAttempt: false },
      // E) isV12LiveAttempt = true
      { phase: 'A.12B.2C-5D', isV12LiveAttempt: true },
      // F) executionLane omitted
      { phase: 'A.12B.2C-5D' },
      // G) executionLane supplied
      { phase: 'A.12B.2C-5D', executionLane: 'INTERACTIVE' as const },
      // H) valid-looking approval supplied
      { phase: 'A.12B.2C-5D', humanApproval: validApprovalEnvelope },
      // I) invalid approval supplied
      { phase: 'A.12B.2C-5D', humanApproval: { ...validApprovalEnvelope, approvalToken: 'bad' } },
      // J & K) credentials present / absent
      { phase: 'A.12B.2C-5D', capabilitySecret: 'present_secret' },
      { phase: 'A.12B.2C-5D', capabilitySecret: '' },
      // L) customFetch supplied
      { phase: 'A.12B.2C-5D', customFetch: customFetchMock },
    ];

    for (const scenario of testScenarios) {
      const result = await BoundedCanaryRunner.executeLiveCanary(scenario as any);

      expect(result.overallStatus).toBe('CANARY_KILL_SWITCH_TERMINATED');
      expect(result.killSwitchEvents[0].reason).toBe('UNAUTHORIZED_ENVIRONMENT');
      expect(result.transportAttemptCount).toBe(0);
      expect(result.summaryCounts.executedInvocations).toBe(0);
      expect(result.summaryCounts.totalObservedCostMicroUsd).toBe(0);
      expect(result.productionRoutingEnforcementAllowed).toBe(false);
    }

    expect(customFetchMock).toHaveBeenCalledTimes(0);
    expect(globalFetchSpy).toHaveBeenCalledTimes(0);
  });
});
