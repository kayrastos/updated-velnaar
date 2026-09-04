/**
 * @file tests/ai/phaseA12B2C5HDeepSeekCertificationStateMachine.test.ts
 * @description Test suite for Phase A.12B.2C-5H DeepSeek Successor Certification State Machine.
 * 
 * STRICT INVARIANTS:
 * - Offline security test suite.
 * - ZERO DeepSeek calls.
 * - ZERO Gemini calls.
 * - ZERO provider credentials.
 * - ZERO external network calls.
 * - DO NOT activate v1.3.
 * - CANARY_SPECIFICATION_VERSION remains 'a12b2c5-v1.2'.
 * - CANARY_LIVE_EXECUTION_ENABLED remains false.
 * - productionRoutingEnforcementAllowed remains false.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  CANARY_SPECIFICATION_VERSION,
  CANARY_LIVE_EXECUTION_ENABLED,
  CANARY_LIVE_EXECUTION_STATE,
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
} from '../../worker/ai/canary/deepSeekSingleProviderCertificationSpecification';
import {
  CERTIFIED_A12B2C_TASK_TYPES,
} from '../../worker/ai/providers/certifiedProviderTypes';
import { TaskType } from '../../worker/ai/types';
import {
  INITIAL_CERTIFICATION_STATE,
  createInitialCertificationState,
  validateRunnerReadinessEvidence,
  validateAuthorizationEvidence,
  validateCertificationEvidence,
  validateAllWindowsCertificationEvidence,
  validateRoutingActivationEligibilityEvidence,
  canTransition,
  applyCertificationTransition,
  resolveOverallCertificationState,
  RunnerReadinessEvidence,
  WindowAuthorizationEvidence,
  WindowCertificationEvidence,
  InvocationRecordSummary,
  AllWindowsCertificationEvidence,
  RoutingActivationEligibilityEvidence,
  CertificationStateMachineSnapshot,
} from '../../worker/ai/canary/deepSeekSuccessorCertificationStateMachine';

describe('Phase A.12B.2C-5H DeepSeek Successor Certification State Machine', () => {
  let globalFetchSpy: ReturnType<typeof vi.spyOn>;

  const validCommit = '9b5325ae92d65e781e66647f31fbf9dce7261ec1';
  const validTree = 'b21cfe6fa12f32907941d308bac4882f52c01479';
  const validOffPeakNonce = 'nonce-offpeak-test-9921';
  const validPeakNonce = 'nonce-peak-test-8812';

  const validOffPeakReadiness: RunnerReadinessEvidence = {
    pricingWindow: 'OFF_PEAK',
    successorSpecificationVersion: SUCCESSOR_SPECIFICATION_VERSION,
    provider: CERTIFICATION_PROVIDER,
    model: CERTIFICATION_MODEL,
    documentedVersionTarget: DOCUMENTED_VERSION_TARGET,
    reasoningEffort: REASONING_EFFORT,
    maxTokens: MAX_TOKENS,
    lifecycleTimeoutMs: INTERACTIVE_TIMEOUT_MS,
    canonicalTaskCount: 7,
    retries: 0,
    crossProviderFallback: 0,
    automaticRerun: 0,
    costPreflightAvailable: true,
    windowSpecificCostBoundMicroUsd: CANONICAL_COST_PREFLIGHT.offPeakSevenCallWorstCaseMicroUsd,
    productionRoutingEnforcementAllowed: false,
    globalLiveExecutionEnabled: false,
    deterministicOfflineTestsPass: true,
  };

  const validOffPeakAuth: WindowAuthorizationEvidence = {
    approvedBy: 'security-lead@velnar.internal',
    approvalTimestamp: '2026-09-04T12:00:00.000Z',
    targetProgram: OFF_PEAK_PROGRAM.programId,
    pricingWindow: 'OFF_PEAK',
    candidateId: OFF_PEAK_CANDIDATE,
    sourceCommitSha: validCommit,
    sourceTreeSha: validTree,
    specificationVersion: SUCCESSOR_SPECIFICATION_VERSION,
    maxBudgetMicroUsd: 20000,
    runNonce: validOffPeakNonce,
    authorizationTokenDigest: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    authorizationReusable: false,
  };

  const validPeakAuth: WindowAuthorizationEvidence = {
    approvedBy: 'security-lead@velnar.internal',
    approvalTimestamp: '2026-09-04T12:00:00.000Z',
    targetProgram: PEAK_PROGRAM.programId,
    pricingWindow: 'PEAK',
    candidateId: PEAK_CANDIDATE,
    sourceCommitSha: validCommit,
    sourceTreeSha: validTree,
    specificationVersion: SUCCESSOR_SPECIFICATION_VERSION,
    maxBudgetMicroUsd: 35000,
    runNonce: validPeakNonce,
    authorizationTokenDigest: 'sha256:ca978112ca1bbdcafac231b39a23dc4da7860814966ff858a74c155554699052',
    authorizationReusable: false,
  };

  const createCleanInvocations = (pricingWindow: 'OFF_PEAK' | 'PEAK'): InvocationRecordSummary[] => {
    return CERTIFIED_A12B2C_TASK_TYPES.map((taskType, idx) => ({
      taskId: `task-${pricingWindow.toLowerCase()}-${idx + 1}`,
      taskType,
      success: true,
      latencyMs: 1200 + idx * 100,
      modelRequested: CERTIFICATION_MODEL,
      modelReturned: CERTIFICATION_MODEL,
      schemaValid: true,
      providerReportedUsage: true,
      observedCostMicroUsd: pricingWindow === 'OFF_PEAK' ? 1200 : 2400,
      semanticScore: 0.92,
      privacyViolation: false,
    }));
  };

  const createCleanCertificationEvidence = (
    pricingWindow: 'OFF_PEAK' | 'PEAK',
    auth: WindowAuthorizationEvidence
  ): WindowCertificationEvidence => {
    const invocations = createCleanInvocations(pricingWindow);
    const totalCost = invocations.reduce((sum, inv) => sum + inv.observedCostMicroUsd, 0);

    return {
      evidenceOrigin: 'LIVE_PROVIDER_EXECUTION',
      certificationEligible: true,
      pricingWindow,
      candidateId: pricingWindow === 'OFF_PEAK' ? OFF_PEAK_CANDIDATE : PEAK_CANDIDATE,
      executedInvocations: 7,
      transportAttemptCount: 7,
      completedRequiredMatrixCases: 7,
      passedInvocations: 7,
      failedInvocations: 0,
      clientRetries: 0,
      crossProviderFallbacks: 0,
      automaticReruns: 0,
      killSwitchEvents: 0,
      provider: CERTIFICATION_PROVIDER,
      modelRequested: CERTIFICATION_MODEL,
      modelReturned: CERTIFICATION_MODEL,
      providerReportedUsageCount: 7,
      schemaValidCount: 7,
      taskPassCount: 7,
      maxLatencyMs: 1800,
      latenciesMs: invocations.map((i) => i.latencyMs),
      aggregateSemanticScore: 0.92,
      privacyViolations: 0,
      unexpectedNetworkAttempts: 0,
      observedTotalCostMicroUsd: totalCost,
      authorizedBudgetMicroUsd: auth.maxBudgetMicroUsd,
      sourceCommitSha: auth.sourceCommitSha,
      sourceTreeSha: auth.sourceTreeSha,
      runNonce: auth.runNonce,
      invocationRecords: invocations,
    };
  };

  beforeEach(() => {
    globalFetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    globalFetchSpy.mockRestore();
    vi.restoreAllMocks();
  });

  // 1 initial state DRAFT_SEALED
  it('1. initial state DRAFT_SEALED', () => {
    const machine = createInitialCertificationState();
    expect(machine.currentState).toBe('DRAFT_SEALED');
    expect(machine.overallState).toBe('DRAFT_SEALED');
    expect(INITIAL_CERTIFICATION_STATE).toBe('DRAFT_SEALED');
  });

  // 2 current live gate false
  it('2. current live gate false', () => {
    expect(CANARY_LIVE_EXECUTION_ENABLED).toBe(false);
    expect(CANARY_LIVE_EXECUTION_STATE).toBe('BLOCKED_PENDING_CERTIFICATION');
  });

  // 3 successor version draft
  it('3. successor version draft', () => {
    expect(SUCCESSOR_SPECIFICATION_VERSION).toBe('a12b2c5-v1.3-draft');
    expect(CURRENT_ACTIVE_TECHNICAL_SPEC).toBe('a12b2c5-v1.2');
    expect(CURRENT_STRATEGY).toBe('DEEPSEEK_FIRST_SINGLE_PROVIDER_V1');
  });

  // 4 valid OFF_PEAK runner readiness accepted
  it('4. valid OFF_PEAK runner readiness accepted', () => {
    const result = validateRunnerReadinessEvidence(validOffPeakReadiness);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  // 5 invalid model rejected
  it('5. invalid model rejected', () => {
    const invalid = { ...validOffPeakReadiness, model: 'deepseek-chat-legacy' };
    const result = validateRunnerReadinessEvidence(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Invalid model'))).toBe(true);
  });

  // 6 invalid timeout rejected
  it('6. invalid timeout rejected', () => {
    const invalid = { ...validOffPeakReadiness, lifecycleTimeoutMs: 30000 };
    const result = validateRunnerReadinessEvidence(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Invalid lifecycleTimeoutMs'))).toBe(true);
  });

  // 7 retries >0 rejected
  it('7. retries >0 rejected', () => {
    const invalid = { ...validOffPeakReadiness, retries: 1 };
    const result = validateRunnerReadinessEvidence(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('retries'))).toBe(true);
  });

  // 8 fallback >0 rejected
  it('8. fallback >0 rejected', () => {
    const invalid = { ...validOffPeakReadiness, crossProviderFallback: 1 };
    const result = validateRunnerReadinessEvidence(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('crossProviderFallback'))).toBe(true);
  });

  // 9 missing cost preflight rejected
  it('9. missing cost preflight rejected', () => {
    const invalid = { ...validOffPeakReadiness, costPreflightAvailable: false };
    const result = validateRunnerReadinessEvidence(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Cost preflight'))).toBe(true);
  });

  // 10 OFF_PEAK authorization requires OFF_PEAK program
  it('10. OFF_PEAK authorization requires OFF_PEAK program', () => {
    const validResult = validateAuthorizationEvidence(validOffPeakAuth);
    expect(validResult.valid).toBe(true);

    const invalid = { ...validOffPeakAuth, targetProgram: 'DEEPSEEK_PEAK_SINGLE_PROVIDER_CERTIFICATION' };
    const result = validateAuthorizationEvidence(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Mismatched targetProgram for OFF_PEAK'))).toBe(true);
  });

  // 11 PEAK authorization requires PEAK program
  it('11. PEAK authorization requires PEAK program', () => {
    const validResult = validateAuthorizationEvidence(validPeakAuth);
    expect(validResult.valid).toBe(true);

    const invalid = { ...validPeakAuth, targetProgram: 'DEEPSEEK_OFF_PEAK_SINGLE_PROVIDER_RESEAL' };
    const result = validateAuthorizationEvidence(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Mismatched targetProgram for PEAK'))).toBe(true);
  });

  // 12 cross-window auth rejected
  it('12. cross-window auth rejected', () => {
    const crossWindow = { ...validOffPeakAuth, candidateId: PEAK_CANDIDATE };
    const result = validateAuthorizationEvidence(crossWindow);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Mismatched candidateId for OFF_PEAK'))).toBe(true);
  });

  // 13 source SHA mismatch rejected
  it('13. source SHA mismatch rejected', () => {
    const result = validateAuthorizationEvidence(validOffPeakAuth, {
      expectedCommitSha: '0000000000000000000000000000000000000000',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('sourceCommitSha mismatch'))).toBe(true);
  });

  // 14 tree SHA mismatch rejected
  it('14. tree SHA mismatch rejected', () => {
    const result = validateAuthorizationEvidence(validOffPeakAuth, {
      expectedTreeSha: '0000000000000000000000000000000000000000',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('sourceTreeSha mismatch'))).toBe(true);
  });

  // 15 nonce mismatch rejected
  it('15. nonce mismatch rejected', () => {
    const result = validateAuthorizationEvidence(validOffPeakAuth, {
      expectedNonce: 'other-nonce-1234',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('runNonce mismatch'))).toBe(true);
  });

  // 16 budget mismatch rejected
  it('16. budget mismatch rejected', () => {
    const result = validateAuthorizationEvidence(validOffPeakAuth, {
      maxAllowedBudgetMicroUsd: 10000,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('exceeds maximum allowed ceiling'))).toBe(true);
  });

  // 17 authorization marked single-use
  it('17. authorization marked single-use', () => {
    const reusable = { ...validOffPeakAuth, authorizationReusable: true };
    const result = validateAuthorizationEvidence(reusable);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('AUTHORIZATION_REUSE_VIOLATION'))).toBe(true);
  });

  // 18 consumed auth reuse rejected
  it('18. consumed auth reuse rejected', () => {
    const authKey = `${validOffPeakAuth.targetProgram}:${validOffPeakAuth.pricingWindow}:${validOffPeakAuth.sourceCommitSha}:${validOffPeakAuth.runNonce}`;
    const result = validateAuthorizationEvidence(validOffPeakAuth, {
      consumedAuthorizations: [authKey],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('AUTHORIZATION_REUSE_VIOLATION'))).toBe(true);
  });

  // 19 7/7 clean OFF_PEAK evidence may certify
  it('19. 7/7 clean OFF_PEAK evidence may certify', () => {
    const evidence = createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth);
    const result = validateCertificationEvidence(evidence, { boundAuthorization: validOffPeakAuth });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  // 20 6/7 cannot certify
  it('20. 6/7 cannot certify', () => {
    const clean = createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth);
    const broken = {
      ...clean,
      executedInvocations: 6,
      passedInvocations: 6,
      invocationRecords: clean.invocationRecords.slice(0, 6),
    };
    const result = validateCertificationEvidence(broken, { boundAuthorization: validOffPeakAuth });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('executedInvocations must be exactly 7'))).toBe(true);
  });

  // 21 timeout cannot certify
  it('21. timeout cannot certify', () => {
    const clean = createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth);
    const broken = {
      ...clean,
      maxLatencyMs: 16000,
      latenciesMs: [1000, 1000, 1000, 1000, 1000, 1000, 16000],
    };
    const result = validateCertificationEvidence(broken, { boundAuthorization: validOffPeakAuth });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('exceeds hard timeout limit'))).toBe(true);
  });

  // 22 model mismatch cannot certify
  it('22. model mismatch cannot certify', () => {
    const clean = createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth);
    const broken = { ...clean, modelReturned: 'deepseek-v4-pro' };
    const result = validateCertificationEvidence(broken, { boundAuthorization: validOffPeakAuth });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('modelReturned'))).toBe(true);
  });

  // 23 wrong pricing window cannot certify
  it('23. wrong pricing window cannot certify', () => {
    const clean = createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth);
    const broken = { ...clean, pricingWindow: 'PEAK' as const };
    const result = validateCertificationEvidence(broken, { boundAuthorization: validOffPeakAuth });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('window mismatch'))).toBe(true);
  });

  // 24 telemetry missing cannot certify
  it('24. telemetry missing cannot certify', () => {
    const clean = createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth);
    const broken = { ...clean, providerReportedUsageCount: 6 };
    const result = validateCertificationEvidence(broken, { boundAuthorization: validOffPeakAuth });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('providerReportedUsageCount'))).toBe(true);
  });

  // 25 schema failure cannot certify
  it('25. schema failure cannot certify', () => {
    const clean = createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth);
    const broken = { ...clean, schemaValidCount: 6 };
    const result = validateCertificationEvidence(broken, { boundAuthorization: validOffPeakAuth });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('schemaValidCount'))).toBe(true);
  });

  // 26 semantic < .85 cannot certify
  it('26. semantic < .85 cannot certify', () => {
    const clean = createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth);
    const broken = { ...clean, aggregateSemanticScore: 0.84 };
    const result = validateCertificationEvidence(broken, { boundAuthorization: validOffPeakAuth });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('aggregateSemanticScore'))).toBe(true);
  });

  // 27 budget breach cannot certify
  it('27. budget breach cannot certify', () => {
    const clean = createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth);
    const broken = {
      ...clean,
      observedTotalCostMicroUsd: 25000,
      authorizedBudgetMicroUsd: 20000,
    };
    const result = validateCertificationEvidence(broken, { boundAuthorization: validOffPeakAuth });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('BUDGET_BREACH'))).toBe(true);
  });

  // 28 retry >0 cannot certify
  it('28. retry >0 cannot certify', () => {
    const clean = createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth);
    const broken = { ...clean, clientRetries: 1 };
    const result = validateCertificationEvidence(broken, { boundAuthorization: validOffPeakAuth });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('clientRetries must be strictly 0'))).toBe(true);
  });

  // 29 fallback >0 cannot certify
  it('29. fallback >0 cannot certify', () => {
    const clean = createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth);
    const broken = { ...clean, crossProviderFallbacks: 1 };
    const result = validateCertificationEvidence(broken, { boundAuthorization: validOffPeakAuth });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('crossProviderFallbacks must be strictly 0'))).toBe(true);
  });

  // 30 kill switch event cannot certify
  it('30. kill switch event cannot certify', () => {
    const clean = createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth);
    const broken = { ...clean, killSwitchEvents: 1 };
    const result = validateCertificationEvidence(broken, { boundAuthorization: validOffPeakAuth });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('killSwitchEvents must be strictly 0'))).toBe(true);
  });

  // 31 OFF_PEAK certification alone != ALL_WINDOWS_CERTIFIED
  it('31. OFF_PEAK certification alone != ALL_WINDOWS_CERTIFIED', () => {
    const state = resolveOverallCertificationState('CERTIFIED', 'NOT_READY');
    expect(state).toBe('OFF_PEAK_ONLY_CERTIFIED');
    expect(state).not.toBe('ALL_WINDOWS_CERTIFIED');
  });

  // 32 PEAK certification alone != ALL_WINDOWS_CERTIFIED
  it('32. PEAK certification alone != ALL_WINDOWS_CERTIFIED', () => {
    const state = resolveOverallCertificationState('NOT_READY', 'CERTIFIED');
    expect(state).toBe('PEAK_ONLY_CERTIFIED');
    expect(state).not.toBe('ALL_WINDOWS_CERTIFIED');
  });

  // 33 both certified => ALL_WINDOWS_CERTIFIED
  it('33. both certified => ALL_WINDOWS_CERTIFIED', () => {
    const state = resolveOverallCertificationState('CERTIFIED', 'CERTIFIED');
    expect(state).toBe('ALL_WINDOWS_CERTIFIED');
  });

  // 34 ALL_WINDOWS does not set live gate true
  it('34. ALL_WINDOWS does not set live gate true', () => {
    const offPeakEvidence = createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth);
    const peakEvidence = createCleanCertificationEvidence('PEAK', validPeakAuth);

    const allWindowsEvidence: AllWindowsCertificationEvidence = {
      offPeakEvidence,
      peakEvidence,
      offPeakArtifactHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      peakArtifactHash: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
      specificationVersion: SUCCESSOR_SPECIFICATION_VERSION,
      sourceCommitSha: validCommit,
      sourceTreeSha: validTree,
    };

    const validation = validateAllWindowsCertificationEvidence(allWindowsEvidence, {
      offPeakAuthorization: validOffPeakAuth,
      peakAuthorization: validPeakAuth,
    });
    expect(validation.valid).toBe(true);

    // Verify global live execution remains strictly false
    expect(CANARY_LIVE_EXECUTION_ENABLED).toBe(false);
    expect(CANARY_LIVE_EXECUTION_STATE).toBe('BLOCKED_PENDING_CERTIFICATION');
  });

  // 35 routing eligibility requires independent audit
  it('35. routing eligibility requires independent audit', () => {
    const offPeakEvidence = createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth);
    const peakEvidence = createCleanCertificationEvidence('PEAK', validPeakAuth);

    const allWindowsEvidence: AllWindowsCertificationEvidence = {
      offPeakEvidence,
      peakEvidence,
      offPeakArtifactHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      peakArtifactHash: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
      specificationVersion: SUCCESSOR_SPECIFICATION_VERSION,
      sourceCommitSha: validCommit,
      sourceTreeSha: validTree,
    };

    const withoutAudit: RoutingActivationEligibilityEvidence = {
      allWindowsEvidence,
      independentAuditCompleted: false,
      independentAuditReportId: '',
      sourceSpecCompatibilityValidated: true,
      productionRoutingEnforcementAllowed: false,
      liveGateStatus: false,
    };

    const result = validateRoutingActivationEligibilityEvidence(withoutAudit, {
      offPeakAuthorization: validOffPeakAuth,
      peakAuthorization: validPeakAuth,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Independent audit must be completed'))).toBe(true);
  });

  // 36 routing eligibility still production=false
  it('36. routing eligibility still production=false', () => {
    const offPeakEvidence = createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth);
    const peakEvidence = createCleanCertificationEvidence('PEAK', validPeakAuth);

    const allWindowsEvidence: AllWindowsCertificationEvidence = {
      offPeakEvidence,
      peakEvidence,
      offPeakArtifactHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      peakArtifactHash: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
      specificationVersion: SUCCESSOR_SPECIFICATION_VERSION,
      sourceCommitSha: validCommit,
      sourceTreeSha: validTree,
    };

    const validEligibility: RoutingActivationEligibilityEvidence = {
      allWindowsEvidence,
      independentAuditCompleted: true,
      independentAuditReportId: 'AUDIT-A12B2C5-DEEPSEEK-01',
      sourceSpecCompatibilityValidated: true,
      productionRoutingEnforcementAllowed: false,
      liveGateStatus: false,
    };

    const validResult = validateRoutingActivationEligibilityEvidence(validEligibility, {
      offPeakAuthorization: validOffPeakAuth,
      peakAuthorization: validPeakAuth,
    });
    expect(validResult.valid).toBe(true);

    // If caller attempts to set productionRoutingEnforcementAllowed = true, must fail closed
    const illegalEnabling: RoutingActivationEligibilityEvidence = {
      ...validEligibility,
      productionRoutingEnforcementAllowed: true,
    };

    const illegalResult = validateRoutingActivationEligibilityEvidence(illegalEnabling, {
      offPeakAuthorization: validOffPeakAuth,
      peakAuthorization: validPeakAuth,
    });
    expect(illegalResult.valid).toBe(false);
    expect(illegalResult.errors.some((e) => e.includes('productionRoutingEnforcementAllowed'))).toBe(true);
  });

  // 37 invalid state jump rejected
  it('37. invalid state jump rejected', () => {
    const snapshot = createInitialCertificationState(); // DRAFT_SEALED

    // Attempt direct jump to CERTIFIED
    expect(canTransition('DRAFT_SEALED', 'OFF_PEAK_CERTIFIED')).toBe(false);
    const transitionResult = applyCertificationTransition(snapshot, 'OFF_PEAK_CERTIFIED');
    expect(transitionResult.success).toBe(false);
    expect(transitionResult.errors.some((e) => e.includes('ILLEGAL_STATE_TRANSITION'))).toBe(true);
    expect(transitionResult.snapshot.currentState).toBe('DRAFT_SEALED');

    // Attempt direct jump to ROUTING_ACTIVATION_ELIGIBLE
    expect(canTransition('DRAFT_SEALED', 'ROUTING_ACTIVATION_ELIGIBLE')).toBe(false);
  });

  // 38 FAILED_CLOSED cannot jump to CERTIFIED
  it('38. FAILED_CLOSED cannot jump to CERTIFIED', () => {
    expect(canTransition('OFF_PEAK_FAILED_CLOSED', 'OFF_PEAK_CERTIFIED')).toBe(false);
    expect(canTransition('PEAK_FAILED_CLOSED', 'PEAK_CERTIFIED')).toBe(false);

    const failedSnapshot = {
      ...createInitialCertificationState(),
      currentState: 'OFF_PEAK_FAILED_CLOSED' as const,
      offPeakTrackState: 'FAILED_CLOSED' as const,
    };

    const result = applyCertificationTransition(failedSnapshot, 'OFF_PEAK_CERTIFIED');
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.includes('ILLEGAL_STATE_TRANSITION'))).toBe(true);
  });

  // 39 no raw secrets in evidence types/fixtures
  it('39. no raw secrets in evidence types/fixtures', () => {
    const allAuthSerialized = JSON.stringify(validOffPeakAuth) + JSON.stringify(validPeakAuth);
    expect(allAuthSerialized).not.toContain('sk-');
    expect(allAuthSerialized).not.toContain('capabilitySecret');
    expect(allAuthSerialized).not.toContain('apiKey');
    expect(allAuthSerialized).not.toContain('DEEPSEEK_API_KEY');

    // Passing mock secret in authorization evidence fails validation immediately
    const leakedAuth = {
      ...validOffPeakAuth,
      authorizationTokenDigest: 'sk-deepseek-leaked-test-key-should-be-rejected',
    };
    const check = validateAuthorizationEvidence(leakedAuth);
    expect(check.valid).toBe(false);
    expect(check.errors.some((e) => e.includes('CRITICAL_SECURITY_VIOLATION'))).toBe(true);
  });

  // 40 providerNetworkCalls = 0
  it('40. providerNetworkCalls = 0', () => {
    expect(globalFetchSpy).toHaveBeenCalledTimes(0);
  });

  // 41. (A) 7 arbitrary non-canonical task names => certification invalid
  it('41. adversarial A: 7 arbitrary non-canonical task names => certification invalid', () => {
    const clean = createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth);
    const arbitraryTasks = [
      'HEALTH_ASSESSMENT',
      'ROUTING_ANALYSIS',
      'COST_PROJECTION',
      'METRIC_COMPILATION',
      'ANOMALY_DETECTION',
      'EXECUTIVE_SUMMARY',
      'AUDIT_VERIFICATION',
    ];
    const brokenRecords = arbitraryTasks.map((t, idx) => ({
      ...clean.invocationRecords[idx],
      taskType: t as unknown as TaskType,
    }));
    const broken = {
      ...clean,
      invocationRecords: brokenRecords,
    };
    const result = validateCertificationEvidence(broken, { boundAuthorization: validOffPeakAuth });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Unknown non-canonical taskTypes detected'))).toBe(true);
    expect(result.errors.some((e) => e.includes('Missing canonical taskTypes'))).toBe(true);
  });

  // 42. (B) 6 canonical + 1 duplicate => invalid
  it('42. adversarial B: 6 canonical + 1 duplicate => invalid', () => {
    const clean = createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth);
    const brokenRecords = clean.invocationRecords.map((r, idx) =>
      idx === 6 ? { ...r, taskType: clean.invocationRecords[0].taskType } : r
    );
    const broken = {
      ...clean,
      invocationRecords: brokenRecords,
    };
    const result = validateCertificationEvidence(broken, { boundAuthorization: validOffPeakAuth });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Duplicate canonical taskTypes detected'))).toBe(true);
    expect(result.errors.some((e) => e.includes('Missing canonical taskTypes'))).toBe(true);
  });

  // 43. (C) 6 canonical + 1 unknown replacement => invalid
  it('43. adversarial C: 6 canonical + 1 unknown replacement => invalid', () => {
    const clean = createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth);
    const brokenRecords = clean.invocationRecords.map((r, idx) =>
      idx === 6 ? { ...r, taskType: 'CUSTOM_UNKNOWN_TASK' as unknown as TaskType } : r
    );
    const broken = {
      ...clean,
      invocationRecords: brokenRecords,
    };
    const result = validateCertificationEvidence(broken, { boundAuthorization: validOffPeakAuth });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Unknown non-canonical taskTypes detected'))).toBe(true);
    expect(result.errors.some((e) => e.includes('Missing canonical taskTypes'))).toBe(true);
  });

  // 44. (D) 8 records including all canonical + one extra => invalid
  it('44. adversarial D: 8 records including all canonical + one extra => invalid', () => {
    const clean = createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth);
    const extraRecord: InvocationRecordSummary = {
      taskId: 'task-extra-8',
      taskType: CERTIFIED_A12B2C_TASK_TYPES[0],
      success: true,
      latencyMs: 1200,
      modelRequested: CERTIFICATION_MODEL,
      modelReturned: CERTIFICATION_MODEL,
      schemaValid: true,
      providerReportedUsage: true,
      observedCostMicroUsd: 1200,
      semanticScore: 0.92,
      privacyViolation: false,
    };
    const broken = {
      ...clean,
      executedInvocations: 8,
      passedInvocations: 8,
      taskPassCount: 8,
      invocationRecords: [...clean.invocationRecords, extraRecord],
    };
    const result = validateCertificationEvidence(broken, { boundAuthorization: validOffPeakAuth });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('invocationRecords must contain exactly 7 items'))).toBe(true);
  });

  // 45. (E) exact canonical seven once each => valid
  it('45. canonical E: exact canonical seven once each => valid', () => {
    const clean = createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth);
    expect(clean.invocationRecords.length).toBe(7);
    const uniqueTasks = new Set(clean.invocationRecords.map((r) => r.taskType));
    expect(uniqueTasks.size).toBe(7);
    for (const canonicalTask of CERTIFIED_A12B2C_TASK_TYPES) {
      expect(uniqueTasks.has(canonicalTask)).toBe(true);
    }
    const result = validateCertificationEvidence(clean, { boundAuthorization: validOffPeakAuth });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  // 46. (F) OFF_PEAK readiness bound = 12783 => valid
  it('46. cost bound F: OFF_PEAK readiness bound = 12783 => valid', () => {
    const offPeak = {
      ...validOffPeakReadiness,
      pricingWindow: 'OFF_PEAK' as const,
      windowSpecificCostBoundMicroUsd: 12783,
    };
    expect(offPeak.windowSpecificCostBoundMicroUsd).toBe(
      CANONICAL_COST_PREFLIGHT.offPeakSevenCallWorstCaseMicroUsd
    );
    const result = validateRunnerReadinessEvidence(offPeak);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  // 47. (G) OFF_PEAK bound = 12782 => invalid
  it('47. cost bound G: OFF_PEAK bound = 12782 => invalid', () => {
    const invalid = {
      ...validOffPeakReadiness,
      pricingWindow: 'OFF_PEAK' as const,
      windowSpecificCostBoundMicroUsd: 12782,
    };
    const result = validateRunnerReadinessEvidence(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Invalid windowSpecificCostBoundMicroUsd'))).toBe(true);
  });

  // 48. (H) OFF_PEAK bound = 12784 => invalid
  it('48. cost bound H: OFF_PEAK bound = 12784 => invalid', () => {
    const invalid = {
      ...validOffPeakReadiness,
      pricingWindow: 'OFF_PEAK' as const,
      windowSpecificCostBoundMicroUsd: 12784,
    };
    const result = validateRunnerReadinessEvidence(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Invalid windowSpecificCostBoundMicroUsd'))).toBe(true);
  });

  // 49. (I) PEAK bound = 25566 => valid
  it('49. cost bound I: PEAK bound = 25566 => valid', () => {
    const peak = {
      ...validOffPeakReadiness,
      pricingWindow: 'PEAK' as const,
      windowSpecificCostBoundMicroUsd: 25566,
    };
    expect(peak.windowSpecificCostBoundMicroUsd).toBe(
      CANONICAL_COST_PREFLIGHT.peakSevenCallWorstCaseMicroUsd
    );
    const result = validateRunnerReadinessEvidence(peak);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  // 50. (J) PEAK bound = 25565 => invalid
  it('50. cost bound J: PEAK bound = 25565 => invalid', () => {
    const invalid = {
      ...validOffPeakReadiness,
      pricingWindow: 'PEAK' as const,
      windowSpecificCostBoundMicroUsd: 25565,
    };
    const result = validateRunnerReadinessEvidence(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Invalid windowSpecificCostBoundMicroUsd'))).toBe(true);
  });

  // 51. (K) PEAK bound = 25567 => invalid
  it('51. cost bound K: PEAK bound = 25567 => invalid', () => {
    const invalid = {
      ...validOffPeakReadiness,
      pricingWindow: 'PEAK' as const,
      windowSpecificCostBoundMicroUsd: 25567,
    };
    const result = validateRunnerReadinessEvidence(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Invalid windowSpecificCostBoundMicroUsd'))).toBe(true);
  });

  // 52. Bound = 1 fails for both OFF_PEAK and PEAK
  it('52. cost bound = 1 fails for both OFF_PEAK and PEAK', () => {
    const invalidOffPeak = {
      ...validOffPeakReadiness,
      pricingWindow: 'OFF_PEAK' as const,
      windowSpecificCostBoundMicroUsd: 1,
    };
    const resultOffPeak = validateRunnerReadinessEvidence(invalidOffPeak);
    expect(resultOffPeak.valid).toBe(false);
    expect(resultOffPeak.errors.some((e) => e.includes('Invalid windowSpecificCostBoundMicroUsd'))).toBe(true);

    const invalidPeak = {
      ...validOffPeakReadiness,
      pricingWindow: 'PEAK' as const,
      windowSpecificCostBoundMicroUsd: 1,
    };
    const resultPeak = validateRunnerReadinessEvidence(invalidPeak);
    expect(resultPeak.valid).toBe(false);
    expect(resultPeak.errors.some((e) => e.includes('Invalid windowSpecificCostBoundMicroUsd'))).toBe(true);
  });

  // 53. (A) commit 9b5325ae... + tree b21cfe6f... accepted when all authorization evidence valid
  it('53. provenance A: commit 9b5325ae... + tree b21cfe6f... accepted when all authorization evidence valid', () => {
    expect(validOffPeakAuth.sourceCommitSha).toBe('9b5325ae92d65e781e66647f31fbf9dce7261ec1');
    expect(validOffPeakAuth.sourceTreeSha).toBe('b21cfe6fa12f32907941d308bac4882f52c01479');

    const result = validateAuthorizationEvidence(validOffPeakAuth, {
      expectedCommitSha: '9b5325ae92d65e781e66647f31fbf9dce7261ec1',
      expectedTreeSha: 'b21cfe6fa12f32907941d308bac4882f52c01479',
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);

    const cleanEvidence = createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth);
    const certResult = validateCertificationEvidence(cleanEvidence, { boundAuthorization: validOffPeakAuth });
    expect(certResult.valid).toBe(true);
    expect(certResult.errors).toEqual([]);
  });

  // 54. (B) commit 9b5325ae... + stale tree 8d124702... rejected when expectedTreeSha is b21cfe6f...
  it('54. provenance B: commit 9b5325ae... + stale tree 8d124702... rejected when expectedTreeSha is b21cfe6f...', () => {
    const staleTreeAuth: WindowAuthorizationEvidence = {
      ...validOffPeakAuth,
      sourceCommitSha: '9b5325ae92d65e781e66647f31fbf9dce7261ec1',
      sourceTreeSha: '8d1247027fd5c05481f97d090d2bbc3eb2342eee',
    };
    const result = validateAuthorizationEvidence(staleTreeAuth, {
      expectedCommitSha: '9b5325ae92d65e781e66647f31fbf9dce7261ec1',
      expectedTreeSha: 'b21cfe6fa12f32907941d308bac4882f52c01479',
    });
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) =>
        e.includes(
          "sourceTreeSha mismatch: expected 'b21cfe6fa12f32907941d308bac4882f52c01479', got '8d1247027fd5c05481f97d090d2bbc3eb2342eee'"
        )
      )
    ).toBe(true);
  });

  // 55. (C) correct tree + wrong commit => rejected
  it('55. provenance C: correct tree (b21cfe6f...) + wrong commit => rejected', () => {
    const wrongCommitAuth: WindowAuthorizationEvidence = {
      ...validOffPeakAuth,
      sourceCommitSha: '0000000000000000000000000000000000000000',
      sourceTreeSha: 'b21cfe6fa12f32907941d308bac4882f52c01479',
    };
    const result = validateAuthorizationEvidence(wrongCommitAuth, {
      expectedCommitSha: '9b5325ae92d65e781e66647f31fbf9dce7261ec1',
      expectedTreeSha: 'b21cfe6fa12f32907941d308bac4882f52c01479',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('sourceCommitSha mismatch'))).toBe(true);
  });

  // 56. (D) correct commit + wrong tree => rejected
  it('56. provenance D: correct commit (9b5325ae...) + wrong tree => rejected', () => {
    const wrongTreeAuth: WindowAuthorizationEvidence = {
      ...validOffPeakAuth,
      sourceCommitSha: '9b5325ae92d65e781e66647f31fbf9dce7261ec1',
      sourceTreeSha: '0000000000000000000000000000000000000000',
    };
    const result = validateAuthorizationEvidence(wrongTreeAuth, {
      expectedCommitSha: '9b5325ae92d65e781e66647f31fbf9dce7261ec1',
      expectedTreeSha: 'b21cfe6fa12f32907941d308bac4882f52c01479',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('sourceTreeSha mismatch'))).toBe(true);
  });

  // 57. evidenceOrigin missing => rejected
  it('57. evidenceOrigin missing => rejected with OFFLINE_EVIDENCE_NOT_CERTIFIABLE', () => {
    const cleanEvidence = createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth);
    const noOrigin = { ...cleanEvidence } as any;
    delete noOrigin.evidenceOrigin;
    const result = validateCertificationEvidence(noOrigin);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('OFFLINE_EVIDENCE_NOT_CERTIFIABLE'))).toBe(true);
  });

  // 58. evidenceOrigin = OFFLINE_SYNTHETIC_REPLAY => rejected
  it('58. evidenceOrigin = OFFLINE_SYNTHETIC_REPLAY => rejected with OFFLINE_EVIDENCE_NOT_CERTIFIABLE', () => {
    const cleanEvidence = createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth);
    const offlineOrigin = { ...cleanEvidence, evidenceOrigin: 'OFFLINE_SYNTHETIC_REPLAY' } as any;
    const result = validateCertificationEvidence(offlineOrigin);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('OFFLINE_EVIDENCE_NOT_CERTIFIABLE'))).toBe(true);
  });

  // 59. certificationEligible = false => rejected
  it('59. certificationEligible = false => rejected with OFFLINE_EVIDENCE_NOT_CERTIFIABLE', () => {
    const cleanEvidence = createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth);
    const notEligible = { ...cleanEvidence, certificationEligible: false } as any;
    const result = validateCertificationEvidence(notEligible);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('OFFLINE_EVIDENCE_NOT_CERTIFIABLE'))).toBe(true);
  });

  // 60. offline evidence force-cast to WindowCertificationEvidence => rejected
  it('60. offline evidence force-cast to WindowCertificationEvidence => rejected', () => {
    const offlineEvidence = {
      evidenceOrigin: 'OFFLINE_SYNTHETIC_REPLAY' as const,
      certificationEligible: false as const,
      syntheticTestOnly: true as const,
      pricingWindow: 'OFF_PEAK' as const,
      candidateId: OFF_PEAK_CANDIDATE,
      executedInvocations: 7,
      transportAttemptCount: 7,
      completedRequiredMatrixCases: 7,
      passedInvocations: 7,
      failedInvocations: 0,
      clientRetries: 0,
      crossProviderFallbacks: 0,
      automaticReruns: 0,
      killSwitchEvents: 0,
      provider: CERTIFICATION_PROVIDER,
      modelRequested: CERTIFICATION_MODEL,
      modelReturned: CERTIFICATION_MODEL,
      providerReportedUsageCount: 7,
      schemaValidCount: 7,
      taskPassCount: 7,
      maxLatencyMs: 1200,
      latenciesMs: [1000, 1100, 1200, 1050, 1150, 1080, 1020],
      aggregateSemanticScore: 0.95,
      privacyViolations: 0,
      unexpectedNetworkAttempts: 0,
      observedTotalCostMicroUsd: 8400,
      authorizedBudgetMicroUsd: 12783,
      sourceCommitSha: '9b5325ae92d65e781e66647f31fbf9dce7261ec1',
      sourceTreeSha: 'b21cfe6fa12f32907941d308bac4882f52c01479',
      runNonce: 'nonce_force_cast_test',
      invocationRecords: createCleanInvocations('OFF_PEAK'),
    };
    const result = validateCertificationEvidence(offlineEvidence as unknown as WindowCertificationEvidence);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('OFFLINE_EVIDENCE_NOT_CERTIFIABLE'))).toBe(true);
  });

  // 61. otherwise perfect 7/7 synthetic evidence carrying offline origin => rejected
  it('61. otherwise perfect 7/7 synthetic evidence carrying offline origin => rejected', () => {
    const perfectSynthetic = {
      ...createCleanCertificationEvidence('PEAK', validPeakAuth),
      evidenceOrigin: 'OFFLINE_SYNTHETIC_REPLAY',
      certificationEligible: false,
    } as unknown as WindowCertificationEvidence;
    const result = validateCertificationEvidence(perfectSynthetic, { boundAuthorization: validPeakAuth });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('OFFLINE_EVIDENCE_NOT_CERTIFIABLE'))).toBe(true);
  });

  // ==========================================
  // Phase 5I.2 Regressions (A through N)
  // ==========================================

  // 62. (Regression A) validateCertificationEvidence with NO boundAuthorization => invalid
  it('62. (Regression A) validateCertificationEvidence with NO boundAuthorization is invalid', () => {
    const liveEvidence = createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth);
    const result = validateCertificationEvidence(liveEvidence);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('CERTIFICATION_AUTHORIZATION_BINDING_REQUIRED'))).toBe(true);
  });

  // 63. (Regression B) AUTHORIZED -> CERTIFIED with no boundAuthorization => rejected
  it('63. (Regression B) AUTHORIZED -> CERTIFIED with no boundAuthorization is rejected', () => {
    const liveEvidence = createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth);
    const authKey = `${validOffPeakAuth.targetProgram}:${validOffPeakAuth.pricingWindow}:${validOffPeakAuth.sourceCommitSha}:${validOffPeakAuth.runNonce}`;
    const digestKey = validOffPeakAuth.authorizationTokenDigest;

    const snapshot: CertificationStateMachineSnapshot = {
      currentState: 'OFF_PEAK_AUTHORIZED',
      offPeakTrackState: 'AUTHORIZED',
      peakTrackState: 'NOT_READY',
      overallState: 'CERTIFICATION_IN_PROGRESS',
      consumedAuthorizations: [authKey, digestKey],
    };

    const transitionResult = applyCertificationTransition(snapshot, 'OFF_PEAK_CERTIFIED', {
      certificationEvidence: liveEvidence,
      // boundAuthorization intentionally omitted
    });

    expect(transitionResult.success).toBe(false);
    expect(transitionResult.snapshot.currentState).toBe('OFF_PEAK_AUTHORIZED');
    expect(transitionResult.snapshot.offPeakTrackState).toBe('AUTHORIZED');
    expect(transitionResult.errors.some((e) => e.includes('CERTIFICATION_AUTHORIZATION_BINDING_REQUIRED'))).toBe(true);
  });

  // 64. (Regression C) valid boundAuthorization supplied but authKey absent from consumedAuthorizations => rejected
  it('64. (Regression C) valid boundAuthorization supplied but authKey absent from consumedAuthorizations => rejected', () => {
    const liveEvidence = createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth);
    const digestKey = validOffPeakAuth.authorizationTokenDigest;

    // authKey missing from consumedAuthorizations
    const snapshot: CertificationStateMachineSnapshot = {
      currentState: 'OFF_PEAK_AUTHORIZED',
      offPeakTrackState: 'AUTHORIZED',
      peakTrackState: 'NOT_READY',
      overallState: 'CERTIFICATION_IN_PROGRESS',
      consumedAuthorizations: [digestKey],
    };

    const transitionResult = applyCertificationTransition(snapshot, 'OFF_PEAK_CERTIFIED', {
      certificationEvidence: liveEvidence,
      boundAuthorization: validOffPeakAuth,
    });

    expect(transitionResult.success).toBe(false);
    expect(transitionResult.snapshot.currentState).toBe('OFF_PEAK_AUTHORIZED');
    expect(transitionResult.errors.some((e) => e.includes('AUTHORIZATION_NOT_PREVIOUSLY_CONSUMED'))).toBe(true);
  });

  // 65. (Regression D) digest absent from consumedAuthorizations => rejected
  it('65. (Regression D) digest absent from consumedAuthorizations => rejected', () => {
    const liveEvidence = createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth);
    const authKey = `${validOffPeakAuth.targetProgram}:${validOffPeakAuth.pricingWindow}:${validOffPeakAuth.sourceCommitSha}:${validOffPeakAuth.runNonce}`;

    // digestKey missing from consumedAuthorizations
    const snapshot: CertificationStateMachineSnapshot = {
      currentState: 'OFF_PEAK_AUTHORIZED',
      offPeakTrackState: 'AUTHORIZED',
      peakTrackState: 'NOT_READY',
      overallState: 'CERTIFICATION_IN_PROGRESS',
      consumedAuthorizations: [authKey],
    };

    const transitionResult = applyCertificationTransition(snapshot, 'OFF_PEAK_CERTIFIED', {
      certificationEvidence: liveEvidence,
      boundAuthorization: validOffPeakAuth,
    });

    expect(transitionResult.success).toBe(false);
    expect(transitionResult.snapshot.currentState).toBe('OFF_PEAK_AUTHORIZED');
    expect(transitionResult.errors.some((e) => e.includes('AUTHORIZATION_NOT_PREVIOUSLY_CONSUMED'))).toBe(true);
  });

  // 66. (Regression E) correct authKey + digest previously consumed, correct boundAuthorization, correct live evidence => transition succeeds
  it('66. (Regression E) correct authKey + digest previously consumed, correct boundAuthorization, correct live evidence => transition succeeds', () => {
    const liveEvidence = createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth);
    const authKey = `${validOffPeakAuth.targetProgram}:${validOffPeakAuth.pricingWindow}:${validOffPeakAuth.sourceCommitSha}:${validOffPeakAuth.runNonce}`;
    const digestKey = validOffPeakAuth.authorizationTokenDigest;

    const snapshot: CertificationStateMachineSnapshot = {
      currentState: 'OFF_PEAK_AUTHORIZED',
      offPeakTrackState: 'AUTHORIZED',
      peakTrackState: 'NOT_READY',
      overallState: 'CERTIFICATION_IN_PROGRESS',
      consumedAuthorizations: [authKey, digestKey],
    };

    const transitionResult = applyCertificationTransition(snapshot, 'OFF_PEAK_CERTIFIED', {
      certificationEvidence: liveEvidence,
      boundAuthorization: validOffPeakAuth,
    });

    expect(transitionResult.success).toBe(true);
    expect(transitionResult.snapshot.currentState).toBe('OFF_PEAK_CERTIFIED');
    expect(transitionResult.snapshot.offPeakTrackState).toBe('CERTIFIED');
    expect(transitionResult.snapshot.offPeakEvidence).toBe(liveEvidence);
    expect(transitionResult.errors).toHaveLength(0);
  });

  // 67. (Regression F) wrong window authorization => rejected
  it('67. (Regression F) wrong window authorization => rejected', () => {
    const liveEvidence = createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth);
    const peakAuthKey = `${validPeakAuth.targetProgram}:${validPeakAuth.pricingWindow}:${validPeakAuth.sourceCommitSha}:${validPeakAuth.runNonce}`;
    const peakDigestKey = validPeakAuth.authorizationTokenDigest;

    const snapshot: CertificationStateMachineSnapshot = {
      currentState: 'OFF_PEAK_AUTHORIZED',
      offPeakTrackState: 'AUTHORIZED',
      peakTrackState: 'NOT_READY',
      overallState: 'CERTIFICATION_IN_PROGRESS',
      consumedAuthorizations: [peakAuthKey, peakDigestKey],
    };

    const transitionResult = applyCertificationTransition(snapshot, 'OFF_PEAK_CERTIFIED', {
      certificationEvidence: liveEvidence,
      boundAuthorization: validPeakAuth,
    });

    expect(transitionResult.success).toBe(false);
    expect(transitionResult.snapshot.currentState).toBe('OFF_PEAK_AUTHORIZED');
    expect(
      transitionResult.errors.some(
        (e) => e.includes('Authorization window mismatch') || e.includes('targetProgram mismatch')
      )
    ).toBe(true);
  });

  // 68. (Regression G) wrong candidate => rejected
  it('68. (Regression G) wrong candidate => rejected', () => {
    const wrongCandidateAuth: WindowAuthorizationEvidence = {
      ...validOffPeakAuth,
      candidateId: 'deepseek-chat-rogue-candidate',
    };
    const authKey = `${wrongCandidateAuth.targetProgram}:${wrongCandidateAuth.pricingWindow}:${wrongCandidateAuth.sourceCommitSha}:${wrongCandidateAuth.runNonce}`;
    const digestKey = wrongCandidateAuth.authorizationTokenDigest;

    const snapshot: CertificationStateMachineSnapshot = {
      currentState: 'OFF_PEAK_AUTHORIZED',
      offPeakTrackState: 'AUTHORIZED',
      peakTrackState: 'NOT_READY',
      overallState: 'CERTIFICATION_IN_PROGRESS',
      consumedAuthorizations: [authKey, digestKey],
    };

    const liveEvidence = createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth);

    const transitionResult = applyCertificationTransition(snapshot, 'OFF_PEAK_CERTIFIED', {
      certificationEvidence: liveEvidence,
      boundAuthorization: wrongCandidateAuth,
    });

    expect(transitionResult.success).toBe(false);
    expect(transitionResult.snapshot.currentState).toBe('OFF_PEAK_AUTHORIZED');
    expect(
      transitionResult.errors.some(
        (e) => e.includes('candidateId mismatch') || e.includes('Mismatched candidateId')
      )
    ).toBe(true);
  });

  // 69. (Regression H) wrong source commit => rejected
  it('69. (Regression H) wrong source commit => rejected', () => {
    const wrongCommitAuth: WindowAuthorizationEvidence = {
      ...validOffPeakAuth,
      sourceCommitSha: '0000000000000000000000000000000000000000',
    };
    const authKey = `${wrongCommitAuth.targetProgram}:${wrongCommitAuth.pricingWindow}:${wrongCommitAuth.sourceCommitSha}:${wrongCommitAuth.runNonce}`;
    const digestKey = wrongCommitAuth.authorizationTokenDigest;

    const snapshot: CertificationStateMachineSnapshot = {
      currentState: 'OFF_PEAK_AUTHORIZED',
      offPeakTrackState: 'AUTHORIZED',
      peakTrackState: 'NOT_READY',
      overallState: 'CERTIFICATION_IN_PROGRESS',
      consumedAuthorizations: [authKey, digestKey],
    };

    const liveEvidence = createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth);

    const transitionResult = applyCertificationTransition(snapshot, 'OFF_PEAK_CERTIFIED', {
      certificationEvidence: liveEvidence,
      boundAuthorization: wrongCommitAuth,
    });

    expect(transitionResult.success).toBe(false);
    expect(transitionResult.snapshot.currentState).toBe('OFF_PEAK_AUTHORIZED');
    expect(transitionResult.errors.some((e) => e.includes('sourceCommitSha mismatch'))).toBe(true);
  });

  // 70. (Regression I) wrong source tree => rejected
  it('70. (Regression I) wrong source tree => rejected', () => {
    const wrongTreeAuth: WindowAuthorizationEvidence = {
      ...validOffPeakAuth,
      sourceTreeSha: '0000000000000000000000000000000000000000',
    };
    const authKey = `${wrongTreeAuth.targetProgram}:${wrongTreeAuth.pricingWindow}:${wrongTreeAuth.sourceCommitSha}:${wrongTreeAuth.runNonce}`;
    const digestKey = wrongTreeAuth.authorizationTokenDigest;

    const snapshot: CertificationStateMachineSnapshot = {
      currentState: 'OFF_PEAK_AUTHORIZED',
      offPeakTrackState: 'AUTHORIZED',
      peakTrackState: 'NOT_READY',
      overallState: 'CERTIFICATION_IN_PROGRESS',
      consumedAuthorizations: [authKey, digestKey],
    };

    const liveEvidence = createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth);

    const transitionResult = applyCertificationTransition(snapshot, 'OFF_PEAK_CERTIFIED', {
      certificationEvidence: liveEvidence,
      boundAuthorization: wrongTreeAuth,
    });

    expect(transitionResult.success).toBe(false);
    expect(transitionResult.snapshot.currentState).toBe('OFF_PEAK_AUTHORIZED');
    expect(transitionResult.errors.some((e) => e.includes('sourceTreeSha mismatch'))).toBe(true);
  });

  // 71. (Regression J) wrong nonce => rejected
  it('71. (Regression J) wrong nonce => rejected', () => {
    const wrongNonceAuth: WindowAuthorizationEvidence = {
      ...validOffPeakAuth,
      runNonce: 'different_unauthorized_nonce',
    };
    const authKey = `${wrongNonceAuth.targetProgram}:${wrongNonceAuth.pricingWindow}:${wrongNonceAuth.sourceCommitSha}:${wrongNonceAuth.runNonce}`;
    const digestKey = wrongNonceAuth.authorizationTokenDigest;

    const snapshot: CertificationStateMachineSnapshot = {
      currentState: 'OFF_PEAK_AUTHORIZED',
      offPeakTrackState: 'AUTHORIZED',
      peakTrackState: 'NOT_READY',
      overallState: 'CERTIFICATION_IN_PROGRESS',
      consumedAuthorizations: [authKey, digestKey],
    };

    const liveEvidence = createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth);

    const transitionResult = applyCertificationTransition(snapshot, 'OFF_PEAK_CERTIFIED', {
      certificationEvidence: liveEvidence,
      boundAuthorization: wrongNonceAuth,
    });

    expect(transitionResult.success).toBe(false);
    expect(transitionResult.snapshot.currentState).toBe('OFF_PEAK_AUTHORIZED');
    expect(transitionResult.errors.some((e) => e.includes('runNonce mismatch'))).toBe(true);
  });

  // 72. (Regression K) wrong budget => rejected
  it('72. (Regression K) wrong budget => rejected', () => {
    const wrongBudgetAuth: WindowAuthorizationEvidence = {
      ...validOffPeakAuth,
      maxBudgetMicroUsd: 50000,
    };
    const authKey = `${wrongBudgetAuth.targetProgram}:${wrongBudgetAuth.pricingWindow}:${wrongBudgetAuth.sourceCommitSha}:${wrongBudgetAuth.runNonce}`;
    const digestKey = wrongBudgetAuth.authorizationTokenDigest;

    const snapshot: CertificationStateMachineSnapshot = {
      currentState: 'OFF_PEAK_AUTHORIZED',
      offPeakTrackState: 'AUTHORIZED',
      peakTrackState: 'NOT_READY',
      overallState: 'CERTIFICATION_IN_PROGRESS',
      consumedAuthorizations: [authKey, digestKey],
    };

    const liveEvidence = createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth);

    const transitionResult = applyCertificationTransition(snapshot, 'OFF_PEAK_CERTIFIED', {
      certificationEvidence: liveEvidence,
      boundAuthorization: wrongBudgetAuth,
    });

    expect(transitionResult.success).toBe(false);
    expect(transitionResult.snapshot.currentState).toBe('OFF_PEAK_AUTHORIZED');
    expect(transitionResult.errors.some((e) => e.includes('authorizedBudgetMicroUsd'))).toBe(true);
  });

  // 73. (Regression L) offline evidence + valid consumed authorization => still rejected
  it('73. (Regression L) offline evidence + valid consumed authorization => still rejected with OFFLINE_EVIDENCE_NOT_CERTIFIABLE', () => {
    const authKey = `${validOffPeakAuth.targetProgram}:${validOffPeakAuth.pricingWindow}:${validOffPeakAuth.sourceCommitSha}:${validOffPeakAuth.runNonce}`;
    const digestKey = validOffPeakAuth.authorizationTokenDigest;

    const snapshot: CertificationStateMachineSnapshot = {
      currentState: 'OFF_PEAK_AUTHORIZED',
      offPeakTrackState: 'AUTHORIZED',
      peakTrackState: 'NOT_READY',
      overallState: 'CERTIFICATION_IN_PROGRESS',
      consumedAuthorizations: [authKey, digestKey],
    };

    const offlineEvidence = {
      ...createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth),
      evidenceOrigin: 'OFFLINE_SYNTHETIC_REPLAY' as const,
      certificationEligible: false as const,
    };

    const transitionResult = applyCertificationTransition(snapshot, 'OFF_PEAK_CERTIFIED', {
      certificationEvidence: offlineEvidence as unknown as WindowCertificationEvidence,
      boundAuthorization: validOffPeakAuth,
    });

    expect(transitionResult.success).toBe(false);
    expect(transitionResult.snapshot.currentState).toBe('OFF_PEAK_AUTHORIZED');
    expect(transitionResult.errors.some((e) => e.includes('OFFLINE_EVIDENCE_NOT_CERTIFIABLE'))).toBe(true);
  });

  // 74. (Regression M) OFF_PEAK currentState AUTHORIZED but offPeakTrackState != AUTHORIZED => rejected
  it('74. (Regression M) OFF_PEAK currentState AUTHORIZED but offPeakTrackState != AUTHORIZED => rejected with TRACK_STATE_INCONSISTENCY', () => {
    const liveEvidence = createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth);
    const authKey = `${validOffPeakAuth.targetProgram}:${validOffPeakAuth.pricingWindow}:${validOffPeakAuth.sourceCommitSha}:${validOffPeakAuth.runNonce}`;
    const digestKey = validOffPeakAuth.authorizationTokenDigest;

    // currentState is OFF_PEAK_AUTHORIZED but offPeakTrackState is READY
    const inconsistentSnapshot: CertificationStateMachineSnapshot = {
      currentState: 'OFF_PEAK_AUTHORIZED',
      offPeakTrackState: 'READY',
      peakTrackState: 'NOT_READY',
      overallState: 'CERTIFICATION_IN_PROGRESS',
      consumedAuthorizations: [authKey, digestKey],
    };

    const transitionResult = applyCertificationTransition(inconsistentSnapshot, 'OFF_PEAK_CERTIFIED', {
      certificationEvidence: liveEvidence,
      boundAuthorization: validOffPeakAuth,
    });

    expect(transitionResult.success).toBe(false);
    expect(transitionResult.snapshot.currentState).toBe('OFF_PEAK_AUTHORIZED');
    expect(transitionResult.errors.some((e) => e.includes('TRACK_STATE_INCONSISTENCY'))).toBe(true);
  });

  // 75. (Regression N) PEAK currentState AUTHORIZED but peakTrackState != AUTHORIZED => rejected
  it('75. (Regression N) PEAK currentState AUTHORIZED but peakTrackState != AUTHORIZED => rejected with TRACK_STATE_INCONSISTENCY', () => {
    const liveEvidence = createCleanCertificationEvidence('PEAK', validPeakAuth);
    const authKey = `${validPeakAuth.targetProgram}:${validPeakAuth.pricingWindow}:${validPeakAuth.sourceCommitSha}:${validPeakAuth.runNonce}`;
    const digestKey = validPeakAuth.authorizationTokenDigest;

    // currentState is PEAK_AUTHORIZED but peakTrackState is READY
    const inconsistentSnapshot: CertificationStateMachineSnapshot = {
      currentState: 'PEAK_AUTHORIZED',
      offPeakTrackState: 'NOT_READY',
      peakTrackState: 'READY',
      overallState: 'CERTIFICATION_IN_PROGRESS',
      consumedAuthorizations: [authKey, digestKey],
    };

    const transitionResult = applyCertificationTransition(inconsistentSnapshot, 'PEAK_CERTIFIED', {
      certificationEvidence: liveEvidence,
      boundAuthorization: validPeakAuth,
    });

    expect(transitionResult.success).toBe(false);
    expect(transitionResult.snapshot.currentState).toBe('PEAK_AUTHORIZED');
    expect(transitionResult.errors.some((e) => e.includes('TRACK_STATE_INCONSISTENCY'))).toBe(true);
  });

  // =========================================================================
  // Phase A.12B.2C-5I.3 All-Windows Authorization Escape-Hatch Regressions (A-O)
  // =========================================================================

  // 76. (5I.3 Regression A) validateCertificationEvidence without auth => rejected
  it('76. (5I.3 Regression A) validateCertificationEvidence without auth => rejected', () => {
    const liveEvidence = createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth);
    const result = validateCertificationEvidence(liveEvidence);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('CERTIFICATION_AUTHORIZATION_BINDING_REQUIRED'))).toBe(true);
  });

  // 77. (5I.3 Regression B) validateCertificationEvidence with { allowAllWindowsAggregation: true } via as any but no auth => rejected
  it('77. (5I.3 Regression B) validateCertificationEvidence with { allowAllWindowsAggregation: true } via as any but no auth => rejected', () => {
    const liveEvidence = createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth);
    const result = (validateCertificationEvidence as any)(liveEvidence, { allowAllWindowsAggregation: true });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('CERTIFICATION_AUTHORIZATION_BINDING_REQUIRED'))).toBe(true);
  });

  // 78. (5I.3 Regression C) static source: allowAllWindowsAggregation must not exist in production state-machine source
  it('78. (5I.3 Regression C) static source: allowAllWindowsAggregation must not exist in production state-machine source', () => {
    const sourcePath = path.resolve(process.cwd(), 'worker/ai/canary/deepSeekSuccessorCertificationStateMachine.ts');
    const sourceCode = fs.readFileSync(sourcePath, 'utf8');
    expect(sourceCode.includes('allowAllWindowsAggregation')).toBe(false);
  });

  // 79. (5I.3 Regression D) all-windows validation without OFF_PEAK auth => rejected
  it('79. (5I.3 Regression D) all-windows validation without OFF_PEAK auth => rejected', () => {
    const offPeakEvidence = createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth);
    const peakEvidence = createCleanCertificationEvidence('PEAK', validPeakAuth);
    const allWindowsEvidence: AllWindowsCertificationEvidence = {
      offPeakEvidence,
      peakEvidence,
      offPeakArtifactHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      peakArtifactHash: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
      specificationVersion: SUCCESSOR_SPECIFICATION_VERSION,
      sourceCommitSha: validCommit,
      sourceTreeSha: validTree,
    };
    const result = (validateAllWindowsCertificationEvidence as any)(allWindowsEvidence, {
      peakAuthorization: validPeakAuth,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('offPeakAuthorization') || e.includes('ALL_WINDOWS_AUTHORIZATION_REQUIRED'))).toBe(true);
  });

  // 80. (5I.3 Regression E) all-windows validation without PEAK auth => rejected
  it('80. (5I.3 Regression E) all-windows validation without PEAK auth => rejected', () => {
    const offPeakEvidence = createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth);
    const peakEvidence = createCleanCertificationEvidence('PEAK', validPeakAuth);
    const allWindowsEvidence: AllWindowsCertificationEvidence = {
      offPeakEvidence,
      peakEvidence,
      offPeakArtifactHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      peakArtifactHash: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
      specificationVersion: SUCCESSOR_SPECIFICATION_VERSION,
      sourceCommitSha: validCommit,
      sourceTreeSha: validTree,
    };
    const result = (validateAllWindowsCertificationEvidence as any)(allWindowsEvidence, {
      offPeakAuthorization: validOffPeakAuth,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('peakAuthorization') || e.includes('ALL_WINDOWS_AUTHORIZATION_REQUIRED'))).toBe(true);
  });

  // 81. (5I.3 Regression F) both correct authorizations => structurally valid when both evidence records are valid
  it('81. (5I.3 Regression F) both correct authorizations => structurally valid when both evidence records are valid', () => {
    const offPeakEvidence = createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth);
    const peakEvidence = createCleanCertificationEvidence('PEAK', validPeakAuth);
    const allWindowsEvidence: AllWindowsCertificationEvidence = {
      offPeakEvidence,
      peakEvidence,
      offPeakArtifactHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      peakArtifactHash: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
      specificationVersion: SUCCESSOR_SPECIFICATION_VERSION,
      sourceCommitSha: validCommit,
      sourceTreeSha: validTree,
    };
    const result = validateAllWindowsCertificationEvidence(allWindowsEvidence, {
      offPeakAuthorization: validOffPeakAuth,
      peakAuthorization: validPeakAuth,
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  // 82. (5I.3 Regression G) OFF_PEAK auth supplied for PEAK evidence => rejected
  it('82. (5I.3 Regression G) OFF_PEAK auth supplied for PEAK evidence => rejected', () => {
    const offPeakEvidence = createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth);
    const peakEvidence = createCleanCertificationEvidence('PEAK', validPeakAuth);
    const allWindowsEvidence: AllWindowsCertificationEvidence = {
      offPeakEvidence,
      peakEvidence,
      offPeakArtifactHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      peakArtifactHash: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
      specificationVersion: SUCCESSOR_SPECIFICATION_VERSION,
      sourceCommitSha: validCommit,
      sourceTreeSha: validTree,
    };
    const result = validateAllWindowsCertificationEvidence(allWindowsEvidence, {
      offPeakAuthorization: validOffPeakAuth,
      peakAuthorization: validOffPeakAuth as any,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Authorization window mismatch') || e.includes('targetProgram mismatch'))).toBe(true);
  });

  // 83. (5I.3 Regression H) PEAK auth supplied for OFF_PEAK evidence => rejected
  it('83. (5I.3 Regression H) PEAK auth supplied for OFF_PEAK evidence => rejected', () => {
    const offPeakEvidence = createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth);
    const peakEvidence = createCleanCertificationEvidence('PEAK', validPeakAuth);
    const allWindowsEvidence: AllWindowsCertificationEvidence = {
      offPeakEvidence,
      peakEvidence,
      offPeakArtifactHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      peakArtifactHash: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
      specificationVersion: SUCCESSOR_SPECIFICATION_VERSION,
      sourceCommitSha: validCommit,
      sourceTreeSha: validTree,
    };
    const result = validateAllWindowsCertificationEvidence(allWindowsEvidence, {
      offPeakAuthorization: validPeakAuth as any,
      peakAuthorization: validPeakAuth,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Authorization window mismatch') || e.includes('targetProgram mismatch'))).toBe(true);
  });

  // 84. (5I.3 Regression I) ALL_WINDOWS transition with both tracks CERTIFIED but no authorizations => rejected
  it('84. (5I.3 Regression I) ALL_WINDOWS transition with both tracks CERTIFIED but no authorizations => rejected', () => {
    const offPeakEvidence = createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth);
    const peakEvidence = createCleanCertificationEvidence('PEAK', validPeakAuth);
    const offPeakAuthKey = `${validOffPeakAuth.targetProgram}:${validOffPeakAuth.pricingWindow}:${validOffPeakAuth.sourceCommitSha}:${validOffPeakAuth.runNonce}`;
    const peakAuthKey = `${validPeakAuth.targetProgram}:${validPeakAuth.pricingWindow}:${validPeakAuth.sourceCommitSha}:${validPeakAuth.runNonce}`;
    const bothCertifiedSnapshot: CertificationStateMachineSnapshot = {
      currentState: 'PEAK_CERTIFIED',
      offPeakTrackState: 'CERTIFIED',
      peakTrackState: 'CERTIFIED',
      overallState: 'ALL_WINDOWS_CERTIFIED',
      offPeakEvidence,
      peakEvidence,
      consumedAuthorizations: [
        offPeakAuthKey,
        validOffPeakAuth.authorizationTokenDigest,
        peakAuthKey,
        validPeakAuth.authorizationTokenDigest,
      ],
    };

    const allWindowsEvidence: AllWindowsCertificationEvidence = {
      offPeakEvidence,
      peakEvidence,
      offPeakArtifactHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      peakArtifactHash: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
      specificationVersion: SUCCESSOR_SPECIFICATION_VERSION,
      sourceCommitSha: validCommit,
      sourceTreeSha: validTree,
    };

    const transitionResult = applyCertificationTransition(bothCertifiedSnapshot, 'ALL_WINDOWS_CERTIFIED', {
      allWindowsEvidence,
    });
    expect(transitionResult.success).toBe(false);
    expect(transitionResult.errors.some((e) => e.includes('ALL_WINDOWS_AUTHORIZATION_REQUIRED'))).toBe(true);
  });

  // 85. (5I.3 Regression J) OFF_PEAK consumed auth missing => rejected with AUTHORIZATION_NOT_PREVIOUSLY_CONSUMED
  it('85. (5I.3 Regression J) OFF_PEAK consumed auth missing => rejected with AUTHORIZATION_NOT_PREVIOUSLY_CONSUMED', () => {
    const offPeakEvidence = createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth);
    const peakEvidence = createCleanCertificationEvidence('PEAK', validPeakAuth);
    const peakAuthKey = `${validPeakAuth.targetProgram}:${validPeakAuth.pricingWindow}:${validPeakAuth.sourceCommitSha}:${validPeakAuth.runNonce}`;
    const snapshotWithoutOffPeakConsumed: CertificationStateMachineSnapshot = {
      currentState: 'PEAK_CERTIFIED',
      offPeakTrackState: 'CERTIFIED',
      peakTrackState: 'CERTIFIED',
      overallState: 'ALL_WINDOWS_CERTIFIED',
      offPeakEvidence,
      peakEvidence,
      consumedAuthorizations: [
        peakAuthKey,
        validPeakAuth.authorizationTokenDigest,
      ],
    };

    const allWindowsEvidence: AllWindowsCertificationEvidence = {
      offPeakEvidence,
      peakEvidence,
      offPeakArtifactHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      peakArtifactHash: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
      specificationVersion: SUCCESSOR_SPECIFICATION_VERSION,
      sourceCommitSha: validCommit,
      sourceTreeSha: validTree,
    };

    const transitionResult = applyCertificationTransition(snapshotWithoutOffPeakConsumed, 'ALL_WINDOWS_CERTIFIED', {
      allWindowsEvidence,
      offPeakAuthorization: validOffPeakAuth,
      peakAuthorization: validPeakAuth,
    });
    expect(transitionResult.success).toBe(false);
    expect(transitionResult.errors.some((e) => e.includes('AUTHORIZATION_NOT_PREVIOUSLY_CONSUMED'))).toBe(true);
  });

  // 86. (5I.3 Regression K) PEAK consumed auth missing => rejected with AUTHORIZATION_NOT_PREVIOUSLY_CONSUMED
  it('86. (5I.3 Regression K) PEAK consumed auth missing => rejected with AUTHORIZATION_NOT_PREVIOUSLY_CONSUMED', () => {
    const offPeakEvidence = createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth);
    const peakEvidence = createCleanCertificationEvidence('PEAK', validPeakAuth);
    const offPeakAuthKey = `${validOffPeakAuth.targetProgram}:${validOffPeakAuth.pricingWindow}:${validOffPeakAuth.sourceCommitSha}:${validOffPeakAuth.runNonce}`;
    const snapshotWithoutPeakConsumed: CertificationStateMachineSnapshot = {
      currentState: 'PEAK_CERTIFIED',
      offPeakTrackState: 'CERTIFIED',
      peakTrackState: 'CERTIFIED',
      overallState: 'ALL_WINDOWS_CERTIFIED',
      offPeakEvidence,
      peakEvidence,
      consumedAuthorizations: [
        offPeakAuthKey,
        validOffPeakAuth.authorizationTokenDigest,
      ],
    };

    const allWindowsEvidence: AllWindowsCertificationEvidence = {
      offPeakEvidence,
      peakEvidence,
      offPeakArtifactHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      peakArtifactHash: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
      specificationVersion: SUCCESSOR_SPECIFICATION_VERSION,
      sourceCommitSha: validCommit,
      sourceTreeSha: validTree,
    };

    const transitionResult = applyCertificationTransition(snapshotWithoutPeakConsumed, 'ALL_WINDOWS_CERTIFIED', {
      allWindowsEvidence,
      offPeakAuthorization: validOffPeakAuth,
      peakAuthorization: validPeakAuth,
    });
    expect(transitionResult.success).toBe(false);
    expect(transitionResult.errors.some((e) => e.includes('AUTHORIZATION_NOT_PREVIOUSLY_CONSUMED'))).toBe(true);
  });

  // 87. (5I.3 Regression L) both authKey + digest pairs consumed and correct evidence => ALL_WINDOWS transition succeeds in unit test
  it('87. (5I.3 Regression L) both authKey + digest pairs consumed and correct evidence => ALL_WINDOWS transition succeeds in unit test', () => {
    const offPeakEvidence = createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth);
    const peakEvidence = createCleanCertificationEvidence('PEAK', validPeakAuth);
    const offPeakAuthKey = `${validOffPeakAuth.targetProgram}:${validOffPeakAuth.pricingWindow}:${validOffPeakAuth.sourceCommitSha}:${validOffPeakAuth.runNonce}`;
    const peakAuthKey = `${validPeakAuth.targetProgram}:${validPeakAuth.pricingWindow}:${validPeakAuth.sourceCommitSha}:${validPeakAuth.runNonce}`;
    const validSnapshot: CertificationStateMachineSnapshot = {
      currentState: 'PEAK_CERTIFIED',
      offPeakTrackState: 'CERTIFIED',
      peakTrackState: 'CERTIFIED',
      overallState: 'ALL_WINDOWS_CERTIFIED',
      offPeakEvidence,
      peakEvidence,
      consumedAuthorizations: [
        offPeakAuthKey,
        validOffPeakAuth.authorizationTokenDigest,
        peakAuthKey,
        validPeakAuth.authorizationTokenDigest,
      ],
    };

    const allWindowsEvidence: AllWindowsCertificationEvidence = {
      offPeakEvidence,
      peakEvidence,
      offPeakArtifactHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      peakArtifactHash: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
      specificationVersion: SUCCESSOR_SPECIFICATION_VERSION,
      sourceCommitSha: validCommit,
      sourceTreeSha: validTree,
    };

    const transitionResult = applyCertificationTransition(validSnapshot, 'ALL_WINDOWS_CERTIFIED', {
      allWindowsEvidence,
      offPeakAuthorization: validOffPeakAuth,
      peakAuthorization: validPeakAuth,
    });
    expect(transitionResult.success).toBe(true);
    expect(transitionResult.snapshot.currentState).toBe('ALL_WINDOWS_CERTIFIED');
    expect(transitionResult.snapshot.overallState).toBe('ALL_WINDOWS_CERTIFIED');
    expect(transitionResult.snapshot.allWindowsEvidence).toEqual(allWindowsEvidence);
  });

  // 88. (5I.3 Regression M) allWindowsEvidence substitutes a different runNonce than currentSnapshot.offPeakEvidence => rejected
  it('88. (5I.3 Regression M) allWindowsEvidence substitutes a different runNonce than currentSnapshot.offPeakEvidence => rejected', () => {
    const offPeakEvidence = createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth);
    const peakEvidence = createCleanCertificationEvidence('PEAK', validPeakAuth);
    const offPeakAuthKey = `${validOffPeakAuth.targetProgram}:${validOffPeakAuth.pricingWindow}:${validOffPeakAuth.sourceCommitSha}:${validOffPeakAuth.runNonce}`;
    const peakAuthKey = `${validPeakAuth.targetProgram}:${validPeakAuth.pricingWindow}:${validPeakAuth.sourceCommitSha}:${validPeakAuth.runNonce}`;
    const validSnapshot: CertificationStateMachineSnapshot = {
      currentState: 'PEAK_CERTIFIED',
      offPeakTrackState: 'CERTIFIED',
      peakTrackState: 'CERTIFIED',
      overallState: 'ALL_WINDOWS_CERTIFIED',
      offPeakEvidence,
      peakEvidence,
      consumedAuthorizations: [
        offPeakAuthKey,
        validOffPeakAuth.authorizationTokenDigest,
        peakAuthKey,
        validPeakAuth.authorizationTokenDigest,
      ],
    };

    const substitutedOffPeak = {
      ...offPeakEvidence,
      runNonce: 'substituted-run-nonce-12345',
    };

    const substitutedAllWindowsEvidence: AllWindowsCertificationEvidence = {
      offPeakEvidence: substitutedOffPeak,
      peakEvidence,
      offPeakArtifactHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      peakArtifactHash: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
      specificationVersion: SUCCESSOR_SPECIFICATION_VERSION,
      sourceCommitSha: validCommit,
      sourceTreeSha: validTree,
    };

    const transitionResult = applyCertificationTransition(validSnapshot, 'ALL_WINDOWS_CERTIFIED', {
      allWindowsEvidence: substitutedAllWindowsEvidence,
      offPeakAuthorization: validOffPeakAuth,
      peakAuthorization: validPeakAuth,
    });
    expect(transitionResult.success).toBe(false);
    expect(transitionResult.errors.some((e) => e.includes('OFF_PEAK_EVIDENCE_SUBSTITUTION_REJECTED'))).toBe(true);
  });

  // 89. (5I.3 Regression N) substituted PEAK source tree => rejected
  it('89. (5I.3 Regression N) substituted PEAK source tree => rejected', () => {
    const offPeakEvidence = createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth);
    const peakEvidence = createCleanCertificationEvidence('PEAK', validPeakAuth);
    const offPeakAuthKey = `${validOffPeakAuth.targetProgram}:${validOffPeakAuth.pricingWindow}:${validOffPeakAuth.sourceCommitSha}:${validOffPeakAuth.runNonce}`;
    const peakAuthKey = `${validPeakAuth.targetProgram}:${validPeakAuth.pricingWindow}:${validPeakAuth.sourceCommitSha}:${validPeakAuth.runNonce}`;
    const validSnapshot: CertificationStateMachineSnapshot = {
      currentState: 'PEAK_CERTIFIED',
      offPeakTrackState: 'CERTIFIED',
      peakTrackState: 'CERTIFIED',
      overallState: 'ALL_WINDOWS_CERTIFIED',
      offPeakEvidence,
      peakEvidence,
      consumedAuthorizations: [
        offPeakAuthKey,
        validOffPeakAuth.authorizationTokenDigest,
        peakAuthKey,
        validPeakAuth.authorizationTokenDigest,
      ],
    };

    const substitutedPeak = {
      ...peakEvidence,
      sourceTreeSha: 'ffffffffffffffffffffffffffffffffffffffff',
    };

    const substitutedAllWindowsEvidence: AllWindowsCertificationEvidence = {
      offPeakEvidence,
      peakEvidence: substitutedPeak,
      offPeakArtifactHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      peakArtifactHash: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
      specificationVersion: SUCCESSOR_SPECIFICATION_VERSION,
      sourceCommitSha: validCommit,
      sourceTreeSha: validTree,
    };

    const transitionResult = applyCertificationTransition(validSnapshot, 'ALL_WINDOWS_CERTIFIED', {
      allWindowsEvidence: substitutedAllWindowsEvidence,
      offPeakAuthorization: validOffPeakAuth,
      peakAuthorization: validPeakAuth,
    });
    expect(transitionResult.success).toBe(false);
    expect(transitionResult.errors.some((e) => e.includes('PEAK_EVIDENCE_SUBSTITUTION_REJECTED'))).toBe(true);
  });

  // 90. (5I.3 Regression O) offline replay evidence remains rejected even with both valid authorizations
  it('90. (5I.3 Regression O) offline replay evidence remains rejected even with both valid authorizations', () => {
    const offlineReplayOffPeak: WindowCertificationEvidence = {
      ...createCleanCertificationEvidence('OFF_PEAK', validOffPeakAuth),
      evidenceOrigin: 'OFFLINE_SYNTHETIC_REPLAY' as any,
      certificationEligible: false as any,
    };
    const validPeakEvidence = createCleanCertificationEvidence('PEAK', validPeakAuth);

    const allWindowsEvidence: AllWindowsCertificationEvidence = {
      offPeakEvidence: offlineReplayOffPeak,
      peakEvidence: validPeakEvidence,
      offPeakArtifactHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      peakArtifactHash: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
      specificationVersion: SUCCESSOR_SPECIFICATION_VERSION,
      sourceCommitSha: validCommit,
      sourceTreeSha: validTree,
    };

    const result = validateAllWindowsCertificationEvidence(allWindowsEvidence, {
      offPeakAuthorization: validOffPeakAuth,
      peakAuthorization: validPeakAuth,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('OFFLINE_EVIDENCE_NOT_CERTIFIABLE'))).toBe(true);
  });
});
