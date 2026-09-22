import { describe, expect, it } from 'vitest';
import {
  ASSERTION_BY_CLASS,
  CONTRACT_VERSION,
  computeCandidateBinding,
  computeEvidenceHash,
  createVerificationState,
  transitionVerificationState,
  validateEvidenceArtifact,
  validateFindingCandidate,
  validateVerificationRequest,
  validateVerificationResult,
  type EvidenceArtifact,
  type FindingCandidate,
  type VerificationRequest,
  type VerificationResult,
} from '../../../../worker/intelligence/contracts';

const ORG = 'org_cmdi_test';
const COMMIT_A = 'a'.repeat(40);
const COMMIT_B = 'b'.repeat(40);

function createCmdiCandidate(overrides: Partial<FindingCandidate> = {}): FindingCandidate {
  const snapshotCreatedAt = '2026-09-20T00:00:00.000Z';
  const createdAt = '2026-09-20T01:00:00.000Z';
  const base: FindingCandidate = {
    contractVersion: CONTRACT_VERSION,
    organizationId: ORG,
    candidateId: 'candidate-cmdi-001',
    snapshot: {
      contractVersion: CONTRACT_VERSION,
      organizationId: ORG,
      snapshotId: 'snap-cmdi-001',
      repositoryId: 'repo-cmdi-001',
      sourceProvider: 'LOCAL_FIXTURE',
      commitSha: COMMIT_A,
      ref: 'refs/heads/main',
      createdAt: snapshotCreatedAt,
    },
    vulnerabilityClass: 'COMMAND_INJECTION',
    source: {
      filePath: 'src/routes.ts',
      symbol: 'req.query.cmd',
      line: 12,
      column: 18,
    },
    sink: {
      filePath: 'src/executor.ts',
      symbol: 'child_process.exec',
      line: 34,
      column: 4,
    },
    context: {
      entrypoint: {
        filePath: 'src/routes.ts',
        symbol: 'commandRoute',
        line: 10,
        column: 1,
      },
      routeId: 'POST.command',
    },
    sensorEvidence: [
      {
        contractVersion: CONTRACT_VERSION,
        organizationId: ORG,
        sensorType: 'VELNAR_STRUCTURAL',
        sensorFindingId: 'sensor-cmdi-001',
        ruleId: 'child-process-exec-injection',
        summary: 'Request parameter req.query.cmd flows to child_process.exec sink',
        sourceLocation: {
          filePath: 'src/routes.ts',
          symbol: 'req.query.cmd',
          line: 12,
          column: 18,
        },
        sinkLocation: {
          filePath: 'src/executor.ts',
          symbol: 'child_process.exec',
          line: 34,
          column: 4,
        },
        rawEvidenceFingerprint: 'sha256:' + 'e'.repeat(64),
      },
    ],
    reachabilityState: 'REACHABLE',
    verificationState: 'CANDIDATE',
    createdAt,
  };
  return { ...base, ...overrides };
}

async function createCmdiFixture(c: FindingCandidate = createCmdiCandidate()) {
  const candidate = validateFindingCandidate(c, ORG);
  const candidateBinding = computeCandidateBinding(candidate, ORG);
  const requestCreatedAt = '2026-09-20T02:00:00.000Z';
  const startedAt = '2026-09-20T02:00:01.000Z';
  const completedAt = '2026-09-20T02:00:04.000Z';

  const rawRequest: VerificationRequest = {
    contractVersion: CONTRACT_VERSION,
    requestId: 'req-cmdi-001',
    organizationId: ORG,
    candidateId: candidate.candidateId,
    candidateBinding,
    snapshotId: candidate.snapshot.snapshotId,
    commitSha: candidate.snapshot.commitSha,
    vulnerabilityClass: 'COMMAND_INJECTION',
    verificationProfile: { profileId: 'profile-cmdi', version: 1 },
    environmentRequirements: {
      environmentType: 'ISOLATED_TEST',
      runtime: 'NODE',
      runtimeVersion: '20.10.0',
    },
    networkPolicy: { mode: 'DEFAULT_DENY', allowedDestinations: [] },
    resourceBudget: {
      maxCpuMillis: 10000,
      maxMemoryMb: 1024,
      maxWallTimeMs: 30000,
      maxNetworkRequests: 0,
    },
    timeBudgetMs: 5000,
    expectedAssertionType: ASSERTION_BY_CLASS.COMMAND_INJECTION,
    createdAt: requestCreatedAt,
  };
  const request = validateVerificationRequest(rawRequest, candidate, ORG);

  const evidenceBody = {
    contractVersion: CONTRACT_VERSION,
    evidenceId: 'ev-cmdi-001',
    organizationId: ORG,
    candidateId: candidate.candidateId,
    candidateBinding,
    requestId: request.requestId,
    repositoryId: candidate.snapshot.repositoryId,
    snapshotId: candidate.snapshot.snapshotId,
    commitSha: candidate.snapshot.commitSha,
    vulnerabilityClass: 'COMMAND_INJECTION' as const,
    verificationProfile: { profileId: 'profile-cmdi', version: 1 },
    environmentIdentity: {
      environmentType: 'ISOLATED_TEST' as const,
      runtime: 'NODE' as const,
      runtimeVersion: '20.10.0',
      environmentId: 'env-cmdi-01',
      imageDigest: 'sha256:' + '1'.repeat(64),
    },
    executionIdentity: { executionId: 'exec-cmdi-01', runnerId: 'runner-cmdi-01' },
    assertionType: ASSERTION_BY_CLASS.COMMAND_INJECTION,
    assertionResult: 'PASSED' as const,
    observedBehavior: {
      observationCode: 'VIOLATION_OBSERVED' as const,
      detailsFingerprint: 'sha256:' + '2'.repeat(64),
    },
    startedAt,
    completedAt,
    reproduction: {
      profileId: 'profile-cmdi',
      profileVersion: 1,
      fixtureId: 'fixture-cmdi-001',
      testId: 'test-child-process-exec',
      requiredEnvironmentType: 'ISOLATED_TEST' as const,
      expectedAssertion: ASSERTION_BY_CLASS.COMMAND_INJECTION,
    },
  };
  const evidenceHash = await computeEvidenceHash(evidenceBody, request, candidate, ORG);
  const evidence: EvidenceArtifact = await validateEvidenceArtifact(
    { ...evidenceBody, evidenceHash },
    request,
    candidate,
    ORG,
  );

  const rawResult: VerificationResult = {
    contractVersion: CONTRACT_VERSION,
    requestId: request.requestId,
    candidateId: candidate.candidateId,
    candidateBinding,
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
    startedAt,
    completedAt,
    resourceUsage: {
      cpuMillis: 250,
      peakMemoryMb: 256,
      wallTimeMs: 3000,
      networkRequests: 0,
    },
  };
  const result = await validateVerificationResult(rawResult, request, candidate, evidence, ORG);
  return { c: candidate, q: request, e: evidence, r: result };
}

describe('command injection detector: stale-state rejection and restart-resume', () => {
  it('proves valid COMMAND_INJECTION three-state progression from CANDIDATE to PENDING to VERIFIED', async () => {
    const { c, q, e, r } = await createCmdiFixture();
    const start = createVerificationState(c, ORG);
    expect(start.state).toBe('CANDIDATE');

    const pending = await transitionVerificationState(start, { type: 'BEGIN', request: q });
    expect(pending.state).toBe('PENDING_VERIFICATION');

    const done = await transitionVerificationState(pending, { type: 'COMPLETE', result: r, evidence: e });
    expect(done.state).toBe('VERIFIED');
    expect(done.result.candidateBinding).toBe(computeCandidateBinding(done.candidate, ORG));
  });

  it('rejects stale-state restart when attempting to BEGIN on an already pending or verified state', async () => {
    const { c, q, e, r } = await createCmdiFixture();
    const start = createVerificationState(c, ORG);
    const pending = await transitionVerificationState(start, { type: 'BEGIN', request: q });
    await expect(transitionVerificationState(pending, { type: 'BEGIN', request: q })).rejects.toThrow();

    const done = await transitionVerificationState(pending, { type: 'COMPLETE', result: r, evidence: e });
    await expect(transitionVerificationState(done, { type: 'BEGIN', request: q })).rejects.toThrow();
  });

  it('rejects stale-state completion when attempting to COMPLETE from initial CANDIDATE or already VERIFIED state', async () => {
    const { c, q, e, r } = await createCmdiFixture();
    const start = createVerificationState(c, ORG);
    await expect(transitionVerificationState(start, { type: 'COMPLETE', result: r, evidence: e })).rejects.toThrow('COMPLETE requires pending');

    const pending = await transitionVerificationState(start, { type: 'BEGIN', request: q });
    const done = await transitionVerificationState(pending, { type: 'COMPLETE', result: r, evidence: e });
    await expect(transitionVerificationState(done, { type: 'COMPLETE', result: r, evidence: e })).rejects.toThrow();
  });

  it('rejects restart-resume with stale candidateBinding after candidate source or sink change', async () => {
    const { c, q } = await createCmdiFixture();
    const mutated = createCmdiCandidate({ sink: { ...c.sink, symbol: 'child_process.execSync' } });
    const mutatedState = createVerificationState(mutated, ORG);

    await expect(transitionVerificationState(mutatedState, { type: 'BEGIN', request: q })).rejects.toThrow('candidateBinding mismatch');
  });

  it('rejects restart-resume with stale commitSha after repository head moves to new commit', async () => {
    const { c, q, e, r } = await createCmdiFixture();
    const cNew = createCmdiCandidate({ snapshot: { ...c.snapshot, commitSha: COMMIT_B } });
    const bindingB = computeCandidateBinding(cNew, ORG);
    const qNew = { ...q, commitSha: COMMIT_B, candidateBinding: bindingB };
    const rNew = { ...r, commitSha: COMMIT_B, candidateBinding: bindingB };

    const startNew = createVerificationState(cNew, ORG);
    const pendingNew = await transitionVerificationState(startNew, { type: 'BEGIN', request: qNew });
    await expect(transitionVerificationState(pendingNew, { type: 'COMPLETE', result: rNew, evidence: e })).rejects.toThrow('commitSha mismatch');
  });

  it('rejects forged verificationState or unproven sink provenance at candidate validation boundary', () => {
    const c = createCmdiCandidate();
    expect(() => validateFindingCandidate({ ...c, verificationState: 'VERIFIED' as any }, ORG)).toThrow('INTELLIGENCE_PROTOCOL_ERROR');
    expect(() => validateFindingCandidate({ ...c, sink: { ...c.sink, filePath: '/bin/sh' } }, ORG)).toThrow('filePath must be repository-relative');
    expect(() => validateFindingCandidate({ ...c, sink: { ...c.sink, filePath: '../untrusted/exec.ts' } }, ORG)).toThrow('filePath must be repository-relative');
    expect(() => validateFindingCandidate({ ...c, snapshot: { ...c.snapshot, commitSha: '0'.repeat(40) } }, ORG)).toThrow('invalid commitSha');
  });

  it('enforces COMMAND_EXECUTION_OBSERVED assertion binding for COMMAND_INJECTION class', async () => {
    const { c, q } = await createCmdiFixture();
    const badRequest = { ...q, expectedAssertionType: 'SQL_RESULT_SET_VIOLATION' as any };
    expect(() => validateVerificationRequest(badRequest, c, ORG)).toThrow('expectedAssertionType mismatch');
  });
});
