import { describe, expect, it } from 'vitest';
import {
  ASSERTION_BY_CLASS,
  CONTRACT_VERSION,
  VULNERABILITY_CLASSES,
  computeCandidateBinding,
  computeEvidenceHash,
  createVerificationState,
  transitionVerificationState,
  validateEvidenceArtifact,
  validateFindingCandidate,
  validateVerificationRequest,
  validateVerificationResult,
  type FindingCandidate,
  type VerificationRequest,
  type VerificationResult,
} from '../../../../worker/intelligence/contracts';

const ORG = 'org_cmdi_neg_test';
const COMMIT_SHA = 'a'.repeat(40);
const CREATED_AT = '2026-09-04T00:00:00.000Z';

function makeCandidate(): FindingCandidate {
  return {
    contractVersion: CONTRACT_VERSION,
    organizationId: ORG,
    candidateId: 'cmdi-candidate-001',
    snapshot: {
      contractVersion: CONTRACT_VERSION,
      organizationId: ORG,
      snapshotId: 'snap-001',
      repositoryId: 'repo-001',
      sourceProvider: 'LOCAL_FIXTURE',
      commitSha: COMMIT_SHA,
      ref: 'refs/heads/main',
      createdAt: CREATED_AT,
    },
    vulnerabilityClass: 'COMMAND_INJECTION',
    source: {
      filePath: 'src/routes.ts',
      symbol: 'req.query.cmd',
      line: 12,
      column: 7,
    },
    sink: {
      filePath: 'src/command.ts',
      symbol: 'child_process.exec',
      line: 30,
      column: 3,
    },
    context: {
      entrypoint: {
        filePath: 'src/routes.ts',
        symbol: 'routeHandler',
        line: 10,
        column: 1,
      },
      routeId: 'POST.execute',
    },
    sensorEvidence: [
      {
        contractVersion: CONTRACT_VERSION,
        organizationId: ORG,
        sensorType: 'VELNAR_STRUCTURAL',
        sensorFindingId: 'sensor-cmdi-001',
        ruleId: 'express-child-process-exec-v1',
        summary: 'Untrusted command injection hypothesis',
        sourceLocation: {
          filePath: 'src/routes.ts',
          symbol: 'req.query.cmd',
          line: 12,
          column: 7,
        },
        sinkLocation: {
          filePath: 'src/command.ts',
          symbol: 'child_process.exec',
          line: 30,
          column: 3,
        },
        rawEvidenceFingerprint: 'sha256:' + 'a'.repeat(64),
      },
    ],
    reachabilityState: 'REACHABLE',
    verificationState: 'CANDIDATE',
    createdAt: CREATED_AT,
  };
}

function makeRequest(candidate: FindingCandidate): VerificationRequest {
  const candidateBinding = computeCandidateBinding(candidate, ORG);
  return {
    contractVersion: CONTRACT_VERSION,
    requestId: 'req-cmdi-001',
    organizationId: ORG,
    candidateId: candidate.candidateId,
    candidateBinding,
    snapshotId: candidate.snapshot.snapshotId,
    commitSha: candidate.snapshot.commitSha,
    vulnerabilityClass: 'COMMAND_INJECTION',
    verificationProfile: { profileId: 'profile-v1', version: 1 },
    environmentRequirements: {
      environmentType: 'ISOLATED_TEST',
      runtime: 'NODE',
      runtimeVersion: '20.11.0',
    },
    networkPolicy: {
      mode: 'DEFAULT_DENY',
      allowedDestinations: [],
    },
    resourceBudget: {
      maxCpuMillis: 10_000,
      maxMemoryMb: 512,
      maxWallTimeMs: 10_000,
      maxNetworkRequests: 0,
    },
    timeBudgetMs: 5_000,
    expectedAssertionType: ASSERTION_BY_CLASS.COMMAND_INJECTION,
    createdAt: CREATED_AT,
  };
}

async function makeNegativeOutcome(candidate: FindingCandidate, request: VerificationRequest) {
  const startedAt = '2026-09-04T00:00:01.000Z';
  const completedAt = '2026-09-04T00:00:02.000Z';
  const environmentIdentity = {
    environmentType: 'ISOLATED_TEST' as const,
    runtime: 'NODE' as const,
    runtimeVersion: '20.11.0',
    environmentId: 'env-001',
    imageDigest: 'sha256:' + 'b'.repeat(64),
  };
  const executionIdentity = {
    executionId: 'exec-001',
    runnerId: 'runner-001',
  };
  const evidenceBodyData = {
    contractVersion: CONTRACT_VERSION,
    evidenceId: 'ev-cmdi-001',
    organizationId: ORG,
    candidateId: candidate.candidateId,
    candidateBinding: request.candidateBinding,
    requestId: request.requestId,
    repositoryId: candidate.snapshot.repositoryId,
    snapshotId: candidate.snapshot.snapshotId,
    commitSha: candidate.snapshot.commitSha,
    vulnerabilityClass: 'COMMAND_INJECTION' as const,
    verificationProfile: { profileId: 'profile-v1', version: 1 },
    environmentIdentity,
    executionIdentity,
    assertionType: 'COMMAND_EXECUTION_OBSERVED' as const,
    assertionResult: 'FAILED' as const,
    observedBehavior: {
      observationCode: 'NO_VIOLATION_OBSERVED' as const,
      detailsFingerprint: 'sha256:' + 'c'.repeat(64),
    },
    startedAt,
    completedAt,
    reproduction: {
      profileId: 'profile-v1',
      profileVersion: 1,
      fixtureId: 'cmdi-fixture-neg-001',
      testId: 'test-cmdi-negative-control',
      requiredEnvironmentType: 'ISOLATED_TEST' as const,
      expectedAssertion: 'COMMAND_EXECUTION_OBSERVED' as const,
    },
  };
  const evidenceHash = await computeEvidenceHash(evidenceBodyData, request, candidate, ORG);
  const evidence = { ...evidenceBodyData, evidenceHash };
  const validatedEvidence = await validateEvidenceArtifact(evidence, request, candidate, ORG);

  const result: VerificationResult = {
    contractVersion: CONTRACT_VERSION,
    requestId: request.requestId,
    candidateId: candidate.candidateId,
    candidateBinding: request.candidateBinding,
    organizationId: ORG,
    snapshotId: candidate.snapshot.snapshotId,
    commitSha: candidate.snapshot.commitSha,
    vulnerabilityClass: 'COMMAND_INJECTION',
    result: 'NOT_VERIFIED',
    evidenceId: validatedEvidence.evidenceId,
    observedBehavior: {
      observationCode: 'NO_VIOLATION_OBSERVED',
      detailsFingerprint: 'sha256:' + 'c'.repeat(64),
    },
    assertionResult: 'FAILED',
    environmentIdentity,
    executionIdentity,
    startedAt,
    completedAt,
    resourceUsage: {
      cpuMillis: 1000,
      peakMemoryMb: 128,
      wallTimeMs: 1000,
      networkRequests: 0,
    },
  };
  const validatedResult = await validateVerificationResult(result, request, candidate, validatedEvidence, ORG);
  return { evidence: validatedEvidence, result: validatedResult };
}

function makeInconclusiveOutcome(candidate: FindingCandidate, request: VerificationRequest) {
  const startedAt = '2026-09-04T00:00:01.000Z';
  const completedAt = '2026-09-04T00:00:02.000Z';
  const environmentIdentity = {
    environmentType: 'ISOLATED_TEST' as const,
    runtime: 'NODE' as const,
    runtimeVersion: '20.11.0',
    environmentId: 'env-001',
    imageDigest: 'sha256:' + 'b'.repeat(64),
  };
  const executionIdentity = {
    executionId: 'exec-001',
    runnerId: 'runner-001',
  };
  const inconclusiveResult: VerificationResult = {
    contractVersion: CONTRACT_VERSION,
    requestId: request.requestId,
    candidateId: candidate.candidateId,
    candidateBinding: request.candidateBinding,
    organizationId: ORG,
    snapshotId: candidate.snapshot.snapshotId,
    commitSha: candidate.snapshot.commitSha,
    vulnerabilityClass: 'COMMAND_INJECTION',
    result: 'INCONCLUSIVE',
    evidenceId: null,
    observedBehavior: {
      observationCode: 'EXECUTION_INCOMPLETE',
      detailsFingerprint: 'sha256:' + 'd'.repeat(64),
    },
    assertionResult: 'NOT_EVALUATED',
    environmentIdentity,
    executionIdentity,
    startedAt,
    completedAt,
    resourceUsage: {
      cpuMillis: 500,
      peakMemoryMb: 64,
      wallTimeMs: 1000,
      networkRequests: 0,
    },
  };
  return { inconclusiveResult };
}

describe('V1 discovery-intelligence: COMMAND_INJECTION negative-control restart-resume', () => {
  it('enforces expectedAssertionType mapping for COMMAND_INJECTION', () => {
    expect(VULNERABILITY_CLASSES).toContain('COMMAND_INJECTION');
    expect(ASSERTION_BY_CLASS.COMMAND_INJECTION).toBe('COMMAND_EXECUTION_OBSERVED');
  });

  it('validates COMMAND_INJECTION FindingCandidate structure, CANDIDATE state, and canonical binding', () => {
    const candidate = makeCandidate();
    const validated = validateFindingCandidate(candidate, ORG);
    expect(validated.vulnerabilityClass).toBe('COMMAND_INJECTION');
    expect(validated.verificationState).toBe('CANDIDATE');
    expect(validated.reachabilityState).toBe('REACHABLE');

    const binding = computeCandidateBinding(candidate, ORG);
    expect(binding.startsWith(`${CONTRACT_VERSION}:FindingCandidate\n`)).toBe(true);
    expect(binding).not.toMatch(/^sha256:/);

    const mutated = { ...candidate, sink: { ...candidate.sink, symbol: 'child_process.execSync' } };
    expect(computeCandidateBinding(mutated, ORG)).not.toBe(binding);
  });

  it('binds COMMAND_INJECTION verification request to exact expectedAssertionType and candidate binding', () => {
    const candidate = makeCandidate();
    const request = makeRequest(candidate);
    const validatedRequest = validateVerificationRequest(request, candidate, ORG);
    expect(validatedRequest.expectedAssertionType).toBe('COMMAND_EXECUTION_OBSERVED');
    expect(validatedRequest.candidateBinding).toBe(computeCandidateBinding(candidate, ORG));

    expect(() =>
      validateVerificationRequest(
        { ...request, expectedAssertionType: 'SQL_RESULT_SET_VIOLATION' as any },
        candidate,
        ORG,
      ),
    ).toThrow('expectedAssertionType mismatch');

    expect(() =>
      validateVerificationRequest(
        { ...request, candidateBinding: 'tampered-binding' },
        candidate,
        ORG,
      ),
    ).toThrow('candidateBinding mismatch');
  });

  it('executes negative-control verification cycle completing to NOT_VERIFIED and never VERIFIED', async () => {
    const candidate = makeCandidate();
    const request = makeRequest(candidate);
    const { evidence, result } = await makeNegativeOutcome(candidate, request);

    const start = createVerificationState(candidate, ORG);
    expect(start.state).toBe('CANDIDATE');

    await expect(
      transitionVerificationState(start, { type: 'COMPLETE', result, evidence }),
    ).rejects.toThrow('COMPLETE requires pending verification');

    const pending = await transitionVerificationState(start, { type: 'BEGIN', request });
    expect(pending.state).toBe('PENDING_VERIFICATION');

    const completed = await transitionVerificationState(pending, { type: 'COMPLETE', result, evidence });
    expect(completed.state).toBe('NOT_VERIFIED');
    expect(completed.state).not.toBe('VERIFIED');

    await expect(
      transitionVerificationState(completed, { type: 'COMPLETE', result, evidence }),
    ).rejects.toThrow();
  });

  it('supports restart and resume workflow after inconclusive negative-control run', async () => {
    const candidate = makeCandidate();
    const request = makeRequest(candidate);

    const start = createVerificationState(candidate, ORG);
    const pending = await transitionVerificationState(start, { type: 'BEGIN', request });
    expect(pending.state).toBe('PENDING_VERIFICATION');

    const { inconclusiveResult } = makeInconclusiveOutcome(candidate, request);
    const validatedIncResult = await validateVerificationResult(
      inconclusiveResult,
      request,
      candidate,
      null,
      ORG,
    );
    const incCompleted = await transitionVerificationState(pending, {
      type: 'COMPLETE',
      result: validatedIncResult,
      evidence: null as any,
    });
    expect(incCompleted.state).toBe('INCONCLUSIVE');

    const restarted = createVerificationState(candidate, ORG);
    expect(restarted.state).toBe('CANDIDATE');

    const resumedRequest = { ...request, requestId: 'req-cmdi-resume-002' };
    const resumedPending = await transitionVerificationState(restarted, { type: 'BEGIN', request: resumedRequest });
    expect(resumedPending.state).toBe('PENDING_VERIFICATION');

    const { evidence: resEvidence, result: resResult } = await makeNegativeOutcome(candidate, resumedRequest);
    const finalCompleted = await transitionVerificationState(resumedPending, {
      type: 'COMPLETE',
      result: resResult,
      evidence: resEvidence,
    });
    expect(finalCompleted.state).toBe('NOT_VERIFIED');
  });

  it('rejects cross-candidate and cross-commit replay attempts during restart-resume', async () => {
    const candidateA = makeCandidate();
    const requestA = makeRequest(candidateA);
    const { evidence: evidenceA, result: resultA } = await makeNegativeOutcome(candidateA, requestA);

    const candidateB = {
      ...candidateA,
      candidateId: 'cmdi-candidate-002',
      snapshot: { ...candidateA.snapshot, commitSha: 'b'.repeat(40) },
    };
    const requestB = {
      ...requestA,
      candidateId: candidateB.candidateId,
      commitSha: candidateB.snapshot.commitSha,
      candidateBinding: computeCandidateBinding(candidateB, ORG),
    };

    const startB = createVerificationState(candidateB, ORG);
    const pendingB = await transitionVerificationState(startB, { type: 'BEGIN', request: requestB });

    await expect(
      transitionVerificationState(pendingB, { type: 'COMPLETE', result: resultA, evidence: evidenceA }),
    ).rejects.toThrow();
  });
});
