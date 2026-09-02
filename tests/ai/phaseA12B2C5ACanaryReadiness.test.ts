/**
 * @file tests/ai/phaseA12B2C5ACanaryReadiness.test.ts
 * @description Comprehensive test suite verifying Phase A.12B.2C-5A Bounded Canary Readiness,
 * security envelopes, kill switches, approval gates, and fail-closed guarantees.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import {
  CANARY_SPECIFICATION_VERSION,
  CERTIFIED_CANARY_CANDIDATES,
  CERTIFIED_CANARY_CANDIDATE_MAP,
  CANARY_INVOCATION_LIMITS,
  CANARY_COST_LIMITS,
  CANARY_SUCCESS_CRITERIA,
  isCanaryDataClassificationAllowed,
  isCanaryNetworkEndpointAllowed,
  validateHumanApprovalToken,
  generateCanaryApprovalToken,
  CanaryHumanApprovalEnvelope,
} from '../../worker/ai/canary/canarySpecification';
import {
  BoundedCanaryRunner,
} from '../../worker/ai/canary/boundedCanaryRunner';
import {
  CERTIFIED_A12B2C_TASK_TYPES,
  isCertifiedA12B2CTaskType,
} from '../../worker/ai/providers/certifiedProviderTypes';
import {
  resolveRoutingPolicyDecision,
  getRuntimeCompatibilityReport,
} from '../../worker/ai/routingPolicy';
import { AIRouter } from '../../worker/ai/aiRouter';

describe('Phase A.12B.2C-5A — Bounded Canary Readiness & Safety Invariants', () => {
  let originalFetch: typeof globalThis.fetch;
  let sentinelCallCount = 0;

  beforeEach(() => {
    sentinelCallCount = 0;
    originalFetch = globalThis.fetch;
    // Active global fetch sentinel: any unauthorized network attempt immediately fails test
    globalThis.fetch = vi.fn(async () => {
      sentinelCallCount++;
      throw new Error('A12B2C5A_REAL_NETWORK_FORBIDDEN: Live network attempt detected during canary readiness');
    }) as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('verifies that Phase A.12B.2C-5A readiness check passes with 0 live network calls', () => {
    const readiness = BoundedCanaryRunner.verifyReadiness();
    expect(readiness.ready).toBe(true);
    expect(readiness.phase).toBe('A.12B.2C-5A');
    expect(readiness.specificationVersion).toBe(CANARY_SPECIFICATION_VERSION);
    expect(readiness.checks.canaryCandidatesConfigured).toBe(true);
    expect(readiness.checks.certifiedTaskScopeVerified).toBe(true);
    expect(readiness.checks.privacyGatesFailClosed).toBe(true);
    expect(readiness.checks.networkAllowlistVerified).toBe(true);
    expect(readiness.checks.costCeilingPreflightVerified).toBe(true);
    expect(readiness.checks.invocationLimitsConfigured).toBe(true);
    expect(readiness.checks.killSwitchesConfigured).toBe(true);
    expect(readiness.checks.approvalGateEnforced).toBe(true);
    expect(readiness.checks.productionRoutingIsolated).toBe(true);
    expect(readiness.checks.aiRouterUntouched).toBe(true);
    expect(sentinelCallCount).toBe(0);
  });

  it('verifies that certified candidate whitelist contains exactly DeepSeek and Gemini', () => {
    expect(CERTIFIED_CANARY_CANDIDATES.length).toBe(2);
    const candidateIds = CERTIFIED_CANARY_CANDIDATES.map(c => c.candidateId);
    expect(candidateIds).toContain('deepseek-v4-flash-offpeak-low');
    expect(candidateIds).toContain('gemini-3.5-flash-lite-flex-low');

    const deepseek = CERTIFIED_CANARY_CANDIDATE_MAP.get('deepseek-v4-flash-offpeak-low');
    expect(deepseek?.providerId).toBe('deepseek');
    expect(deepseek?.pricingTier).toBe('offpeak');
    expect(deepseek?.reasoningBudgetTokens).toBe(2048);

    const gemini = CERTIFIED_CANARY_CANDIDATE_MAP.get('gemini-3.5-flash-lite-flex-low');
    expect(gemini?.providerId).toBe('gemini');
    expect(gemini?.pricingTier).toBe('flex');
    expect(gemini?.thinkingLevel).toBe('low');
  });

  it('verifies strict certified task scope (7 canonical tasks only)', () => {
    expect(CERTIFIED_A12B2C_TASK_TYPES.length).toBe(7);
    for (const task of CERTIFIED_A12B2C_TASK_TYPES) {
      expect(isCertifiedA12B2CTaskType(task)).toBe(true);
    }
    expect(isCertifiedA12B2CTaskType('ARBITRARY_UNCERTIFIED_TASK' as any)).toBe(false);
    expect(isCertifiedA12B2CTaskType('CHAT_GENERAL' as any)).toBe(false);
  });

  it('verifies privacy gates fail closed on prohibited data classifications', () => {
    expect(isCanaryDataClassificationAllowed('PERSONAL')).toBe(false);
    expect(isCanaryDataClassificationAllowed('SENSITIVE')).toBe(false);
    expect(isCanaryDataClassificationAllowed('SECRET')).toBe(false);
    expect(isCanaryDataClassificationAllowed('PUBLIC_BUSINESS')).toBe(true);
    expect(isCanaryDataClassificationAllowed('PSEUDONYMOUS_OPERATIONAL')).toBe(true);
  });

  it('verifies network endpoint allowlist rejects uncertified external endpoints', () => {
    expect(isCanaryNetworkEndpointAllowed('https://api.deepseek.com/v1/chat/completions')).toBe(true);
    expect(isCanaryNetworkEndpointAllowed('https://generativelanguage.googleapis.com/v1beta/interactions')).toBe(true);

    // Rejected endpoints
    expect(isCanaryNetworkEndpointAllowed('https://api.openai.com/v1/chat/completions')).toBe(false);
    expect(isCanaryNetworkEndpointAllowed('https://api.anthropic.com/v1/messages')).toBe(false);
    expect(isCanaryNetworkEndpointAllowed('https://api.moonshot.cn/v1/chat/completions')).toBe(false);
    expect(isCanaryNetworkEndpointAllowed('https://untrusted-api.com/v1/inference')).toBe(false);
  });

  it('verifies strict invocation and concurrency limits', () => {
    expect(CANARY_INVOCATION_LIMITS.maxTotalInvocations).toBe(14);
    expect(CANARY_INVOCATION_LIMITS.maxInvocationsPerProvider).toBe(7);
    expect(CANARY_INVOCATION_LIMITS.maxSameProviderRetries).toBe(1);
    expect(CANARY_INVOCATION_LIMITS.maxCrossProviderFallbacks).toBe(1);
    expect(CANARY_INVOCATION_LIMITS.maxConcurrentInvocations).toBe(1);
    expect(CANARY_INVOCATION_LIMITS.timeoutMsPerInvocation).toBe(15000);
  });

  it('verifies cost limits and microUSD ceilings', () => {
    expect(CANARY_COST_LIMITS.hardCeilingMicroUsd).toBe(50000); // $0.05 USD
    expect(CANARY_COST_LIMITS.maxEstimatedCostMicroUsd).toBe(25000); // $0.025 USD
    expect(CANARY_COST_LIMITS.maxSingleInvocationMicroUsd).toBe(5000); // $0.005 USD
  });

  it('verifies human approval gate fails closed for null, missing, or malformed tokens', () => {
    expect(validateHumanApprovalToken(null).valid).toBe(false);
    expect(validateHumanApprovalToken(undefined).valid).toBe(false);

    // Wrong phase
    const wrongPhase: CanaryHumanApprovalEnvelope = {
      approvedBy: 'security-lead@velnar.internal',
      approvalTimestamp: '2026-09-02T12:00:00Z',
      targetPhase: 'A.12B.2C-5A' as any,
      approvalToken: 'VELNAR_CANARY_APPROVED_PHASE_A12B2C5B_20260902_abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      maxBudgetUsd: 0.05,
      environmentTarget: 'CONTROLLED_CANARY',
      specificationVersion: CANARY_SPECIFICATION_VERSION,
      sourceCommitSha: 'a1b2c3d4e5f67890123456789abcdef012345678',
      runNonce: 'nonce-readiness-test-12345678',
      capabilitySecret: 'secret-key-min-16-chars!',
    };
    expect(validateHumanApprovalToken(wrongPhase).valid).toBe(false);

    // Wrong environment
    const wrongEnv: CanaryHumanApprovalEnvelope = {
      approvedBy: 'security-lead@velnar.internal',
      approvalTimestamp: '2026-09-02T12:00:00Z',
      targetPhase: 'A.12B.2C-5B',
      approvalToken: 'VELNAR_CANARY_APPROVED_PHASE_A12B2C5B_20260902_abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      maxBudgetUsd: 0.05,
      environmentTarget: 'PRODUCTION' as any,
      specificationVersion: CANARY_SPECIFICATION_VERSION,
      sourceCommitSha: 'a1b2c3d4e5f67890123456789abcdef012345678',
      runNonce: 'nonce-readiness-test-12345678',
      capabilitySecret: 'secret-key-min-16-chars!',
    };
    expect(validateHumanApprovalToken(wrongEnv).valid).toBe(false);

    // Excessive budget
    const excessiveBudget: CanaryHumanApprovalEnvelope = {
      approvedBy: 'security-lead@velnar.internal',
      approvalTimestamp: '2026-09-02T12:00:00Z',
      targetPhase: 'A.12B.2C-5B',
      approvalToken: 'VELNAR_CANARY_APPROVED_PHASE_A12B2C5B_20260902_abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      maxBudgetUsd: 10.0,
      environmentTarget: 'CONTROLLED_CANARY',
      specificationVersion: CANARY_SPECIFICATION_VERSION,
      sourceCommitSha: 'a1b2c3d4e5f67890123456789abcdef012345678',
      runNonce: 'nonce-readiness-test-12345678',
      capabilitySecret: 'secret-key-min-16-chars!',
    };
    expect(validateHumanApprovalToken(excessiveBudget).valid).toBe(false);

    // Malformed token string
    const malformedToken: CanaryHumanApprovalEnvelope = {
      approvedBy: 'security-lead@velnar.internal',
      approvalTimestamp: '2026-09-02T12:00:00Z',
      targetPhase: 'A.12B.2C-5B',
      approvalToken: 'MALFORMED_UNAUTHORIZED_TOKEN',
      maxBudgetUsd: 0.05,
      environmentTarget: 'CONTROLLED_CANARY',
      specificationVersion: CANARY_SPECIFICATION_VERSION,
      sourceCommitSha: 'a1b2c3d4e5f67890123456789abcdef012345678',
      runNonce: 'nonce-readiness-test-12345678',
      capabilitySecret: 'secret-key-min-16-chars!',
    };
    expect(validateHumanApprovalToken(malformedToken).valid).toBe(false);

    // Valid token with cryptographic binding
    const token = generateCanaryApprovalToken({
      approvedBy: 'auditor-primary@velnar.internal',
      targetPhase: 'A.12B.2C-5B',
      environmentTarget: 'CONTROLLED_CANARY',
      dateYyyyMmDd: '20260902',
      maxBudgetUsd: 0.05,
      approvalTimestamp: '2026-09-02T12:00:00Z',
      specificationVersion: CANARY_SPECIFICATION_VERSION,
      sourceCommitSha: 'a1b2c3d4e5f67890123456789abcdef012345678',
      runNonce: 'nonce-readiness-test-12345678',
      capabilitySecret: 'secret-key-min-16-chars!',
    });
    const validEnvelope: CanaryHumanApprovalEnvelope = {
      approvedBy: 'auditor-primary@velnar.internal',
      approvalTimestamp: '2026-09-02T12:00:00Z',
      targetPhase: 'A.12B.2C-5B',
      approvalToken: token,
      maxBudgetUsd: 0.05,
      environmentTarget: 'CONTROLLED_CANARY',
      specificationVersion: CANARY_SPECIFICATION_VERSION,
      sourceCommitSha: 'a1b2c3d4e5f67890123456789abcdef012345678',
      runNonce: 'nonce-readiness-test-12345678',
      capabilitySecret: 'secret-key-min-16-chars!',
    };
    expect(validateHumanApprovalToken(validEnvelope, { now: () => new Date('2026-09-02T12:00:00Z'), allowSimulatedExpiryForTest: true }).valid).toBe(true);
  });

  it('verifies that Phase A.12B.2C-5A dry-run plan executes cleanly with 0 network calls and produces valid evidence', async () => {
    const evidence = await BoundedCanaryRunner.executeDryRunPlan({
      phase: 'A.12B.2C-5A',
      dryRun: true,
    });

    expect(evidence.phase).toBe('A.12B.2C-5A');
    expect(evidence.executionMode).toBe('DRY_RUN_READINESS_VERIFICATION');
    expect(evidence.overallStatus).toBe('CANARY_READY_AWAITING_HUMAN_APPROVAL');
    expect(evidence.summaryCounts.totalPlannedInvocations).toBe(14);
    expect(evidence.summaryCounts.executedInvocations).toBe(14);
    expect(evidence.summaryCounts.passedInvocations).toBe(14);
    expect(evidence.summaryCounts.failedInvocations).toBe(0);
    expect(evidence.summaryCounts.killSwitchEventsCount).toBe(0);
    expect(evidence.summaryCounts.totalObservedCostMicroUsd).toBeLessThanOrEqual(CANARY_COST_LIMITS.hardCeilingMicroUsd);
    expect(evidence.summaryCounts.aggregateSemanticScore).toBeGreaterThanOrEqual(CANARY_SUCCESS_CRITERIA.minAggregateSemanticScore);
    expect(evidence.productionRoutingEnforcementAllowed).toBe(false);

    // Exactly 7 DeepSeek + 7 Gemini records
    const dsRecords = evidence.invocations.filter(i => i.providerId === 'deepseek');
    const geminiRecords = evidence.invocations.filter(i => i.providerId === 'gemini');
    expect(dsRecords.length).toBe(7);
    expect(geminiRecords.length).toBe(7);

    // Sentinel call count remains strictly 0
    expect(sentinelCallCount).toBe(0);
  });

  it('verifies that attempting live execution in Phase A.12B.2C-5A trips kill switch immediately', async () => {
    const evidence = await BoundedCanaryRunner.executeDryRunPlan({
      phase: 'A.12B.2C-5A',
      dryRun: false, // Illegal live execution attempt
    });

    expect(evidence.overallStatus).toBe('CANARY_KILL_SWITCH_TERMINATED');
    expect(evidence.summaryCounts.killSwitchEventsCount).toBe(1);
    expect(evidence.killSwitchEvents[0].reason).toBe('UNAUTHORIZED_ENVIRONMENT');
    expect(evidence.summaryCounts.executedInvocations).toBe(0);
    expect(sentinelCallCount).toBe(0);
  });

  it('verifies that production routing enforcement remains strictly false across all task types', () => {
    for (const task of CERTIFIED_A12B2C_TASK_TYPES) {
      const decision = resolveRoutingPolicyDecision(task, {
        VELNAR_AI_ROUTING_POLICY_MODE: 'SHADOW',
      } as any);
      expect(decision.enforcementAllowed).toBe(false);
    }
  });

  it('verifies that aiRouter is completely untouched by certified adapters or canary harness', () => {
    const aiRouterCode = fs.readFileSync('worker/ai/aiRouter.ts', 'utf8');
    expect(aiRouterCode.includes('BoundedCanaryRunner')).toBe(false);
    expect(aiRouterCode.includes('DeepSeekCertifiedProvider')).toBe(false);
    expect(aiRouterCode.includes('GeminiCertifiedProvider')).toBe(false);
    expect(aiRouterCode.includes('CertifiedProviderReplayer')).toBe(false);
  });
});
