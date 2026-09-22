import { describe, expect, it } from 'vitest';
import {
  CONTRACT_VERSION,
  ASSERTION_BY_CLASS,
  computeCandidateBinding,
  computeEvidenceHash,
  createVerificationState,
  transitionVerificationState,
  validateFindingCandidate,
  validateVerificationRequest,
  type EvidenceArtifact,
  type FindingCandidate,
  type VerificationRequest,
  type VerificationResult,
} from '../../../../worker/intelligence/contracts';

const ORG = 'org_cmdi_adv_nest';

function createNestedCandidate(overrides?: Partial<FindingCandidate>): FindingCandidate {
  return {
    contractVersion: CONTRACT_VERSION,
    organizationId: ORG,
    candidateId: 'cand_cmdi_adv_nest_01',
    snapshot: {
      contractVersion: CONTRACT_VERSION,
      organizationId: ORG,
      snapshotId: 'snap_cmdi_adv_nest_01',
      repositoryId: 'repo_cmdi_adv_nest',
      sourceProvider: 'LOCAL_FIXTURE',
      commitSha: '1111111111111111111111111111111111111111',
      ref: 'refs/heads/main',
      createdAt: '2026-09-20T00:00:00.000Z',
    },
    vulnerabilityClass: 'COMMAND_INJECTION',
    source: {
      filePath: 'src/routes/nested.ts',
      symbol: 'req.query.cmd',
      line: 15,
      column: 22,
    },
    sink: {
      filePath: 'src/services/executor.ts',
      symbol: 'child_process.exec',
      line: 42,
      column: 5,
    },
    context: {
      entrypoint: {
        filePath: 'src/routes/nested.ts',
        symbol: 'nestedRouteHandler',
        line: 10,
        column: 1,
      },
      routeId: 'POST.nested.exec',
    },
    sensorEvidence: [
      {
        contractVersion: CONTRACT_VERSION,
        organizationId: ORG,
        sensorType: 'VELNAR_STRUCTURAL',
        sensorFindingId: 'sensor_cmdi_01',
        ruleId: 'child-process-exec-nested-flow-v1',
        summary: 'Request-derived flow reaches nested child_process.exec invocation.',
        sourceLocation: {
          filePath: 'src/routes/nested.ts',
          symbol: 'req.query.cmd',
          line: 15,
          column: 22,
        },
        sinkLocation: {
          filePath: 'src/services/executor.ts',
          symbol: 'child_process.exec',
          line: 42,
          column: 5,
        },
        rawEvidenceFingerprint: 'sha256:' + 'a'.repeat(64),
      },
    ],
    reachabilityState: 'REACHABLE',
    verificationState: 'CANDIDATE',
    createdAt: '2026-09-20T00:01:00.000Z',
    ...overrides,
  };
}

function createNestedRequest(candidate: FindingCandidate, overrides?: Partial<VerificationRequest>): VerificationRequest {
  const binding = computeCandidateBinding(candidate, ORG);
  return {
    contractVersion: CONTRACT_VERSION,
    requestId: 'req_cmdi_adv_nest_01',
    organizationId: ORG,
    candidateId: candidate.candidateId,
    candidateBinding: binding,
    snapshotId: candidate.snapshot.snapshotId,
    commitSha: candidate.snapshot.commitSha,
    vulnerabilityClass: 'COMMAND_INJECTION',
    verificationProfile: {
      profileId: 'cmdi-nested-eval',
      version: 1,
    },
    environmentRequirements: {
      environmentType: 'ISOLATED_TEST',
      runtime: 'NODE',
      runtimeVersion: '20.0.0',
    },
    networkPolicy: {
      mode: 'DEFAULT_DENY',
      allowedDestinations: [],
    },
    resourceBudget: {
      maxCpuMillis: 60000,
      maxMemoryMb: 1024,
      maxWallTimeMs: 60000,
      maxNetworkRequests: 0,
    },
    timeBudgetMs: 30000,
    expectedAssertionType: ASSERTION_BY_CLASS[candidate.vulnerabilityClass],
    createdAt: '2026-09-20T00:02:00.000Z',
    ...overrides,
  };
}

async function createNestedEvidenceAndResult(candidate: FindingCandidate, request: VerificationRequest) {
  const binding = computeCandidateBinding(candidate, ORG);
  const evidenceBody = {
    contractVersion: CONTRACT_VERSION,
    evidenceId: 'ev_cmdi_adv_nest_01',
    organizationId: ORG,
    candidateId: candidate.candidateId,
    candidateBinding: binding,
    requestId: request.requestId,
    repositoryId: candidate.snapshot.repositoryId,
    snapshotId: candidate.snapshot.snapshotId,
    commitSha: candidate.snapshot.commitSha,
    vulnerabilityClass: 'COMMAND_INJECTION' as const,
    verificationProfile: {
      profileId: request.verificationProfile.profileId,
      version: request.verificationProfile.version,
    },
    environmentIdentity: {
      environmentType: 'ISOLATED_TEST' as const,
      runtime: 'NODE' as const,
      runtimeVersion: '20.0.0',
      environmentId: 'env_cmdi_nest',
      imageDigest: 'sha256:' + 'b'.repeat(64),
    },
    executionIdentity: {
      executionId: 'exec_cmdi_nest_01',
      runnerId: 'runner_cmdi_nest_01',
    },
    assertionType: 'COMMAND_EXECUTION_OBSERVED' as const,
    assertionResult: 'PASSED' as const,
    observedBehavior: {
      observationCode: 'VIOLATION_OBSERVED' as const,
      detailsFingerprint: 'sha256:' + 'c'.repeat(64),
    },
    startedAt: '2026-09-20T00:02:05.000Z',
    completedAt: '2026-09-20T00:02:10.000Z',
    reproduction: {
      profileId: request.verificationProfile.profileId,
      profileVersion: request.verificationProfile.version,
      fixtureId: 'cmdi-nested-case',
      testId: 'test-exec-nested-provenance',
      requiredEnvironmentType: 'ISOLATED_TEST' as const,
      expectedAssertion: 'COMMAND_EXECUTION_OBSERVED' as const,
    },
  };
  const evidenceHash = await computeEvidenceHash(evidenceBody, request, candidate, ORG);
  const evidence: EvidenceArtifact = {
    ...evidenceBody,
    evidenceHash,
  };
  const result: VerificationResult = {
    contractVersion: CONTRACT_VERSION,
    requestId: request.requestId,
    candidateId: candidate.candidateId,
    candidateBinding: binding,
    organizationId: ORG,
    snapshotId: candidate.snapshot.snapshotId,
    commitSha: candidate.snapshot.commitSha,
    vulnerabilityClass: 'COMMAND_INJECTION',
    result: 'VERIFIED',
    evidenceId: evidence.evidenceId,
    observedBehavior: evidence.observedBehavior,
    assertionResult: 'PASSED',
    environmentIdentity: evidence.environmentIdentity,
    executionIdentity: evidence.executionIdentity,
    startedAt: evidence.startedAt,
    completedAt: evidence.completedAt,
    resourceUsage: {
      cpuMillis: 2500,
      peakMemoryMb: 256,
      wallTimeMs: 5000,
      networkRequests: 0,
    },
  };
  return { evidence, result };
}

describe('COMMAND_INJECTION roadmap: adversarial nested edge cases', () => {
  it('requires expected assertion type COMMAND_EXECUTION_OBSERVED for COMMAND_INJECTION verification request', () => {
    const candidate = createNestedCandidate();
    expect(ASSERTION_BY_CLASS[candidate.vulnerabilityClass]).toBe('COMMAND_EXECUTION_OBSERVED');
    const validRequest = createNestedRequest(candidate);
    expect(validateVerificationRequest(validRequest, candidate, ORG)).toEqual(validRequest);

    const invalidRequest = createNestedRequest(candidate, {
      expectedAssertionType: 'SQL_RESULT_SET_VIOLATION' as any,
    });
    expect(() => validateVerificationRequest(invalidRequest, candidate, ORG)).toThrow('INTELLIGENCE_PROTOCOL_ERROR: expectedAssertionType mismatch');
  });

  it('binds complete candidate semantics without sha256 prefix and rejects tampered nested candidate binding', async () => {
    const candidate = createNestedCandidate();
    const binding = computeCandidateBinding(candidate, ORG);
    expect(binding.startsWith(`${CONTRACT_VERSION}:FindingCandidate\n`)).toBe(true);
    expect(binding.startsWith('sha256:')).toBe(false);

    const tampered = createNestedCandidate({
      sink: {
        filePath: 'src/services/executor.ts',
        symbol: 'unrelatedLocalExec',
        line: 42,
        column: 5,
      },
    });
    const tamperedBinding = computeCandidateBinding(tampered, ORG);
    expect(tamperedBinding).not.toBe(binding);

    const request = createNestedRequest(candidate);
    const initial = createVerificationState(tampered, ORG);
    await expect(transitionVerificationState(initial, { type: 'BEGIN', request })).rejects.toThrow('candidateBinding mismatch');
  });

  it('preserves candidate state and prohibits direct completion or verified state injection', async () => {
    const candidate = createNestedCandidate();
    expect(() => validateFindingCandidate({ ...candidate, verificationState: 'VERIFIED' as any }, ORG)).toThrow('INTELLIGENCE_PROTOCOL_ERROR: invalid verificationState');

    const state = createVerificationState(candidate, ORG);
    expect(state.state).toBe('CANDIDATE');

    const request = createNestedRequest(candidate);
    const { evidence, result } = await createNestedEvidenceAndResult(candidate, request);
    await expect(transitionVerificationState(state, { type: 'COMPLETE', result, evidence })).rejects.toThrow('COMPLETE requires pending verification');
  });

  it('enforces repository-relative boundaries and valid commit SHA on nested candidates', () => {
    const candidate = createNestedCandidate();
    expect(() => validateFindingCandidate({
      ...candidate,
      source: { ...candidate.source, filePath: '../outside/routes.ts' },
    }, ORG)).toThrow('INTELLIGENCE_PROTOCOL_ERROR: filePath must be repository-relative');

    expect(() => validateFindingCandidate({
      ...candidate,
      sink: { ...candidate.sink, filePath: '/abs/executor.ts' },
    }, ORG)).toThrow('INTELLIGENCE_PROTOCOL_ERROR: filePath must be repository-relative');

    expect(() => validateFindingCandidate({
      ...candidate,
      snapshot: { ...candidate.snapshot, commitSha: '0000000000000000000000000000000000000000' },
    }, ORG)).toThrow('INTELLIGENCE_PROTOCOL_ERROR: invalid commitSha');
  });

  it('prevents commit replay for nested command injection evidence', async () => {
    const candidateA = createNestedCandidate();
    const requestA = createNestedRequest(candidateA);
    const { evidence, result } = await createNestedEvidenceAndResult(candidateA, requestA);

    const candidateB = createNestedCandidate({
      snapshot: {
        ...candidateA.snapshot,
        commitSha: '2222222222222222222222222222222222222222',
      },
    });
    const requestB = createNestedRequest(candidateB);
    const pendingB = await transitionVerificationState(createVerificationState(candidateB, ORG), {
      type: 'BEGIN',
      request: requestB,
    });

    await expect(transitionVerificationState(pendingB, {
      type: 'COMPLETE',
      result: { ...result, commitSha: candidateB.snapshot.commitSha, candidateBinding: requestB.candidateBinding },
      evidence,
    })).rejects.toThrow('commitSha mismatch');
  });

  it('executes full verification state machine for valid nested command injection hypothesis', async () => {
    const candidate = createNestedCandidate();
    const request = createNestedRequest(candidate);
    const { evidence, result } = await createNestedEvidenceAndResult(candidate, request);

    const state0 = createVerificationState(candidate, ORG);
    expect(state0.state).toBe('CANDIDATE');

    const state1 = await transitionVerificationState(state0, { type: 'BEGIN', request });
    expect(state1.state).toBe('PENDING_VERIFICATION');

    const state2 = await transitionVerificationState(state1, { type: 'COMPLETE', result, evidence });
    expect(state2.state).toBe('VERIFIED');
    expect(state2.result.vulnerabilityClass).toBe('COMMAND_INJECTION');
    expect(state2.result.observedBehavior.observationCode).toBe('VIOLATION_OBSERVED');
    expect(state2.result.candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
  });
});
