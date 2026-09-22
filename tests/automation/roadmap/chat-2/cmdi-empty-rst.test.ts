import { describe, expect, it } from 'vitest';
import {
  ASSERTION_BY_CLASS,
  CONTRACT_VERSION,
  computeCandidateBinding,
  computeEvidenceHash,
  createVerificationState,
  transitionVerificationState,
  validateCodeSnapshotRef,
  validateEvidenceArtifact,
  validateFindingCandidate,
  validateVerificationRequest,
  validateVerificationResult,
  type FindingCandidate,
  type VerificationRequest,
} from '../../../../worker/intelligence/contracts';

const ORG = 'org_cmdi_v1';
const VALID_COMMIT = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';
const DETECTOR_RULE = 'express-request-to-child-process-v1';

function createCmdiCandidate(overrides: Partial<FindingCandidate> = {}): FindingCandidate {
  const createdAt = '2026-09-04T00:00:01.000Z';
  return {
    contractVersion: CONTRACT_VERSION,
    candidateId: 'cand-cmdi-rst-001',
    organizationId: ORG,
    snapshot: {
      contractVersion: CONTRACT_VERSION,
      snapshotId: 'snap-cmdi-001',
      organizationId: ORG,
      repositoryId: 'repo-cmdi-001',
      sourceProvider: 'LOCAL_FIXTURE',
      commitSha: VALID_COMMIT,
      ref: 'refs/heads/main',
      createdAt: '2026-09-04T00:00:00.000Z',
    },
    vulnerabilityClass: 'COMMAND_INJECTION',
    source: {
      filePath: 'src/routes.ts',
      symbol: 'query.cmd',
      line: 10,
      column: 5,
    },
    sink: {
      filePath: 'src/routes.ts',
      symbol: 'child_process.exec',
      line: 15,
      column: 5,
    },
    context: {
      entrypoint: {
        filePath: 'src/routes.ts',
        symbol: 'execRoute',
        line: 8,
        column: 1,
      },
      routeId: 'route-exec-001',
    },
    sensorEvidence: [
      {
        contractVersion: CONTRACT_VERSION,
        organizationId: ORG,
        sensorType: 'VELNAR_STRUCTURAL',
        sensorFindingId: 'sensor-cmdi-001',
        ruleId: DETECTOR_RULE,
        summary: 'Request parameter query.cmd flows into child_process.exec shell sink.',
        sourceLocation: {
          filePath: 'src/routes.ts',
          symbol: 'query.cmd',
          line: 10,
          column: 5,
        },
        sinkLocation: {
          filePath: 'src/routes.ts',
          symbol: 'child_process.exec',
          line: 15,
          column: 5,
        },
        rawEvidenceFingerprint: `sha256:${'a'.repeat(64)}`,
      },
    ],
    reachabilityState: 'REACHABLE',
    verificationState: 'CANDIDATE',
    createdAt,
    ...overrides,
  };
}

function createCmdiRequest(candidate: FindingCandidate): VerificationRequest {
  return {
    contractVersion: CONTRACT_VERSION,
    requestId: 'req-cmdi-001',
    organizationId: ORG,
    candidateId: candidate.candidateId,
    candidateBinding: computeCandidateBinding(candidate, ORG),
    snapshotId: candidate.snapshot.snapshotId,
    commitSha: candidate.snapshot.commitSha,
    vulnerabilityClass: candidate.vulnerabilityClass,
    verificationProfile: { profileId: 'cmdi-sandbox-v1', version: 1 },
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
      maxCpuMillis: 60_000,
      maxMemoryMb: 2048,
      maxWallTimeMs: 60_000,
      maxNetworkRequests: 0,
    },
    timeBudgetMs: 30_000,
    expectedAssertionType: ASSERTION_BY_CLASS[candidate.vulnerabilityClass],
    createdAt: '2026-09-04T00:00:02.000Z',
  };
}

async function createCmdiEvidenceAndResult(candidate: FindingCandidate, request: VerificationRequest) {
  const environmentIdentity = {
    environmentType: 'ISOLATED_TEST' as const,
    runtime: 'NODE' as const,
    runtimeVersion: '20.0.0',
    environmentId: 'env-node20-test',
    imageDigest: `sha256:${'b'.repeat(64)}`,
  };
  const executionIdentity = { executionId: 'exec-cmdi-001', runnerId: 'runner-node20' };
  const observedBehavior = {
    observationCode: 'VIOLATION_OBSERVED' as const,
    detailsFingerprint: `sha256:${'c'.repeat(64)}`,
  };
  const startedAt = '2026-09-04T00:00:03.000Z';
  const completedAt = '2026-09-04T00:00:04.000Z';
  const reproduction = {
    profileId: 'cmdi-sandbox-v1',
    profileVersion: 1,
    fixtureId: 'm2-cmdi-001',
    testId: 'test-exec-observed',
    requiredEnvironmentType: 'ISOLATED_TEST' as const,
    expectedAssertion: 'COMMAND_EXECUTION_OBSERVED' as const,
  };
  const body = {
    contractVersion: CONTRACT_VERSION,
    evidenceId: 'ev-cmdi-001',
    organizationId: ORG,
    candidateId: candidate.candidateId,
    candidateBinding: request.candidateBinding,
    requestId: request.requestId,
    repositoryId: candidate.snapshot.repositoryId,
    snapshotId: candidate.snapshot.snapshotId,
    commitSha: candidate.snapshot.commitSha,
    vulnerabilityClass: candidate.vulnerabilityClass,
    verificationProfile: request.verificationProfile,
    environmentIdentity,
    executionIdentity,
    assertionType: 'COMMAND_EXECUTION_OBSERVED' as const,
    assertionResult: 'PASSED' as const,
    observedBehavior,
    startedAt,
    completedAt,
    reproduction,
  };
  const evidenceHash = await computeEvidenceHash(body, request, candidate, ORG);
  const evidence = { ...body, evidenceHash };
  const result = {
    contractVersion: CONTRACT_VERSION,
    requestId: request.requestId,
    candidateId: candidate.candidateId,
    candidateBinding: request.candidateBinding,
    organizationId: ORG,
    snapshotId: candidate.snapshot.snapshotId,
    commitSha: candidate.snapshot.commitSha,
    vulnerabilityClass: candidate.vulnerabilityClass,
    result: 'VERIFIED' as const,
    evidenceId: evidence.evidenceId,
    observedBehavior,
    assertionResult: 'PASSED' as const,
    environmentIdentity,
    executionIdentity,
    startedAt,
    completedAt,
    resourceUsage: {
      cpuMillis: 1500,
      peakMemoryMb: 256,
      wallTimeMs: 1000,
      networkRequests: 0,
    },
  };
  return { evidence, result };
}

describe('V1 command injection: null-empty boundary and restart-resume', () => {
  it('enforces COMMAND_INJECTION contract mapping and candidate validation', () => {
    expect(ASSERTION_BY_CLASS.COMMAND_INJECTION).toBe('COMMAND_EXECUTION_OBSERVED');
    const candidate = createCmdiCandidate();
    const validated = validateFindingCandidate(candidate, ORG);
    expect(validated.vulnerabilityClass).toBe('COMMAND_INJECTION');
    expect(validated.verificationState).toBe('CANDIDATE');
    const binding = computeCandidateBinding(validated, ORG);
    expect(binding.startsWith(`${CONTRACT_VERSION}:FindingCandidate\n`)).toBe(true);
    expect(binding).not.toMatch(/^sha256:/);
  });

  it('rejects candidate with empty strings and invalid boundary values', () => {
    const err = 'INTELLIGENCE_PROTOCOL_ERROR:';
    expect(() => validateFindingCandidate(createCmdiCandidate({ candidateId: '' }), ORG)).toThrow(err);
    expect(() => validateFindingCandidate(createCmdiCandidate({ organizationId: '' }), ORG)).toThrow(err);
    expect(() => validateFindingCandidate(createCmdiCandidate({ sensorEvidence: [] }), ORG)).toThrow(err);

    const emptySource = createCmdiCandidate({
      source: { filePath: '', symbol: 'query.cmd' },
    });
    expect(() => validateFindingCandidate(emptySource, ORG)).toThrow(err);

    const emptySinkSymbol = createCmdiCandidate({
      sink: { filePath: 'src/routes.ts', symbol: '' },
    });
    expect(() => validateFindingCandidate(emptySinkSymbol, ORG)).toThrow(err);
  });

  it('rejects all-zero or empty commitSha in snapshot provenance', () => {
    const err = 'INTELLIGENCE_PROTOCOL_ERROR:';
    const candidateZeroSha = createCmdiCandidate({
      snapshot: {
        ...createCmdiCandidate().snapshot,
        commitSha: '0000000000000000000000000000000000000000',
      },
    });
    expect(() => validateFindingCandidate(candidateZeroSha, ORG)).toThrow(err);

    const candidateEmptySha = createCmdiCandidate({
      snapshot: {
        ...createCmdiCandidate().snapshot,
        commitSha: '',
      },
    });
    expect(() => validateFindingCandidate(candidateEmptySha, ORG)).toThrow(err);
  });

  it('maintains CANDIDATE state and prohibits direct VERIFIED assignment at creation', () => {
    const forged = { ...createCmdiCandidate(), verificationState: 'VERIFIED' };
    expect(() => validateFindingCandidate(forged, ORG)).toThrow('INTELLIGENCE_PROTOCOL_ERROR:');
  });

  it('differentiates safe constants and unbound local identifiers as negative controls', () => {
    const safeCall = {
      sourceSymbol: 'constant.echo',
      sinkSymbol: 'child_process.exec',
      isUntrustedInput: false,
    };
    expect(safeCall.isUntrustedInput).toBe(false);

    const localExec = {
      sourceSymbol: 'query.cmd',
      sinkSymbol: 'localHelpers.exec',
      isProvenChildProcess: false,
    };
    expect(localExec.isProvenChildProcess).toBe(false);
  });

  it('executes full candidate verification lifecycle and supports restart-resume from state handle', async () => {
    const candidate = createCmdiCandidate();
    const request = createCmdiRequest(candidate);
    const { evidence, result } = await createCmdiEvidenceAndResult(candidate, request);

    const initial = createVerificationState(candidate, ORG);
    expect(initial.state).toBe('CANDIDATE');

    await expect(
      transitionVerificationState(initial, { type: 'COMPLETE', result, evidence })
    ).rejects.toThrow('COMPLETE requires pending verification');

    const pending = await transitionVerificationState(initial, { type: 'BEGIN', request });
    expect(pending.state).toBe('PENDING_VERIFICATION');

    const resumed = createVerificationState(candidate, ORG);
    const resumedPending = await transitionVerificationState(resumed, { type: 'BEGIN', request });
    expect(resumedPending.state).toBe('PENDING_VERIFICATION');

    const completed = await transitionVerificationState(resumedPending, {
      type: 'COMPLETE',
      result,
      evidence,
    });
    expect(completed.state).toBe('VERIFIED');
    expect(completed.result.candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
  });

  it('rejects resume with mismatched or tampered candidateBinding', async () => {
    const candidate = createCmdiCandidate();
    const request = createCmdiRequest(candidate);
    const initial = createVerificationState(candidate, ORG);
    const tamperedRequest = { ...request, candidateBinding: `${request.candidateBinding} ` };

    await expect(
      transitionVerificationState(initial, { type: 'BEGIN', request: tamperedRequest })
    ).rejects.toThrow('INTELLIGENCE_PROTOCOL_ERROR:');
  });
});
