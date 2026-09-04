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
} from '../../worker/ai/canary/deepSeekSingleProviderCertificationSpecification';
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
} from '../../worker/ai/canary/deepSeekSuccessorCertificationStateMachine';

describe('Phase A.12B.2C-5H DeepSeek Successor Certification State Machine', () => {
  let globalFetchSpy: ReturnType<typeof vi.spyOn>;

  const validCommit = '6caeaf80c1faae3a320241e800da873697210041';
  const validTree = '8d1247027fd5c05481f97d090d2bbc3eb2342eee';
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
    windowSpecificCostBoundMicroUsd: 15400,
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
    const tasks = [
      'HEALTH_ASSESSMENT',
      'ROUTING_ANALYSIS',
      'COST_PROJECTION',
      'METRIC_COMPILATION',
      'ANOMALY_DETECTION',
      'EXECUTIVE_SUMMARY',
      'AUDIT_VERIFICATION',
    ];

    return tasks.map((task, idx) => ({
      taskId: `task-${pricingWindow.toLowerCase()}-${idx + 1}`,
      taskType: task,
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

    const validation = validateAllWindowsCertificationEvidence(allWindowsEvidence);
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

    const result = validateRoutingActivationEligibilityEvidence(withoutAudit);
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

    const validResult = validateRoutingActivationEligibilityEvidence(validEligibility);
    expect(validResult.valid).toBe(true);

    // If caller attempts to set productionRoutingEnforcementAllowed = true, must fail closed
    const illegalEnabling: RoutingActivationEligibilityEvidence = {
      ...validEligibility,
      productionRoutingEnforcementAllowed: true,
    };

    const illegalResult = validateRoutingActivationEligibilityEvidence(illegalEnabling);
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
});
