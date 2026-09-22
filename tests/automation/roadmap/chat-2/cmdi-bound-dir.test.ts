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
  type CodeSnapshotRef,
  type FindingCandidate,
  type VerificationRequest,
} from '../../../../worker/intelligence/contracts';

const ORG = 'org_cmdi_bound';

function createSnapshot(): CodeSnapshotRef {
  return {
    contractVersion: CONTRACT_VERSION,
    organizationId: ORG,
    snapshotId: 'snap-cmdi-001',
    repositoryId: 'repo-cmdi-001',
    sourceProvider: 'LOCAL_FIXTURE',
    commitSha: 'a'.repeat(40),
    ref: 'refs/heads/main',
    createdAt: '2026-09-01T00:00:00.000Z',
  };
}

function createCandidate(overrides: Partial<FindingCandidate> = {}): FindingCandidate {
  const snapshot = createSnapshot();
  return {
    contractVersion: CONTRACT_VERSION,
    organizationId: ORG,
    candidateId: 'candidate-cmdi-001',
    snapshot,
    vulnerabilityClass: 'COMMAND_INJECTION',
    source: { filePath: 'src/routes.ts', symbol: 'req.query.cmd', line: 10, column: 5 },
    sink: { filePath: 'src/exec.ts', symbol: 'child_process.exec', line: 20, column: 3 },
    context: {
      entrypoint: { filePath: 'src/routes.ts', symbol: 'cmdRoute', line: 5, column: 1 },
      routeId: 'GET.cmd',
    },
    sensorEvidence: [
      {
        contractVersion: CONTRACT_VERSION,
        organizationId: ORG,
        sensorType: 'VELNAR_STRUCTURAL',
        sensorFindingId: 'sensor-cmd-1',
        ruleId: 'express-command-injection-v1',
        summary: 'Untrusted input flow to command execution sink.',
        sourceLocation: { filePath: 'src/routes.ts', symbol: 'req.query.cmd', line: 10, column: 5 },
        sinkLocation: { filePath: 'src/exec.ts', symbol: 'child_process.exec', line: 20, column: 3 },
        rawEvidenceFingerprint: 'sha256:' + 'a'.repeat(64),
      },
    ],
    reachabilityState: 'REACHABLE',
    verificationState: 'CANDIDATE',
    createdAt: '2026-09-02T00:00:00.000Z',
    ...overrides,
  };
}

function makeRequest(c: FindingCandidate, overrides: Record<string, unknown> = {}): VerificationRequest {
  const binding = computeCandidateBinding(c, ORG);
  const req = {
    contractVersion: CONTRACT_VERSION,
    requestId: 'req-cmdi-001',
    organizationId: c.organizationId,
    candidateId: c.candidateId,
    candidateBinding: binding,
    snapshotId: c.snapshot.snapshotId,
    commitSha: c.snapshot.commitSha,
    vulnerabilityClass: c.vulnerabilityClass,
    verificationProfile: { profileId: 'profile-cmdi-1', version: 1 },
    environmentRequirements: {
      environmentType: 'ISOLATED_TEST' as const,
      runtime: 'NODE' as const,
      runtimeVersion: '20.0.0',
    },
    networkPolicy: { mode: 'DEFAULT_DENY' as const, allowedDestinations: [] },
    resourceBudget: { maxCpuMillis: 1000, maxMemoryMb: 512, maxWallTimeMs: 1000, maxNetworkRequests: 0 },
    timeBudgetMs: 1000,
    expectedAssertionType: ASSERTION_BY_CLASS[c.vulnerabilityClass],
    createdAt: c.createdAt,
    ...overrides,
  };
  return req as unknown as VerificationRequest;
}

describe('COMMAND_INJECTION direct contract boundary rejection', () => {
  it('enforces COMMAND_INJECTION expected assertion type of COMMAND_EXECUTION_OBSERVED', () => {
    const c = createCandidate();
    const validReq = makeRequest(c);
    const validated = validateVerificationRequest(validReq, c, ORG);
    expect(validated.expectedAssertionType).toBe('COMMAND_EXECUTION_OBSERVED');

    const mismatchedReq = makeRequest(c, { expectedAssertionType: 'SQL_RESULT_SET_VIOLATION' });
    expect(() => validateVerificationRequest(mismatchedReq, c, ORG)).toThrow('expectedAssertionType mismatch');
  });

  it('validates canonical candidate structure and bounds for COMMAND_INJECTION', () => {
    const c = createCandidate();
    const validated = validateFindingCandidate(c, ORG);
    expect(validated.vulnerabilityClass).toBe('COMMAND_INJECTION');
    expect(validated.verificationState).toBe('CANDIDATE');

    expect(() => validateFindingCandidate({ ...c, verificationState: 'VERIFIED' }, ORG)).toThrow('invalid verificationState');
    expect(() => validateFindingCandidate({ ...c, createdAt: '2026-08-01T00:00:00.000Z' }, ORG)).toThrow('candidate predates snapshot');
    expect(() => validateFindingCandidate(c, 'foreign_org')).toThrow('organizationId mismatch');
    expect(() => validateFindingCandidate({ ...c, snapshot: { ...c.snapshot, commitSha: '0'.repeat(40) } }, ORG)).toThrow('invalid commitSha');
    expect(() => validateFindingCandidate({ ...c, source: { ...c.source, filePath: '/abs/path.ts' } }, ORG)).toThrow('repository-relative');
  });

  it('computes exact canonical candidate binding without sha256 prefix', () => {
    const c = createCandidate();
    const bound = computeCandidateBinding(c, ORG);
    expect(bound.startsWith(`${CONTRACT_VERSION}:FindingCandidate\n`)).toBe(true);
    expect(bound.startsWith('sha256:')).toBe(false);

    const mutated = createCandidate({ sink: { ...c.sink, symbol: 'child_process.execSync' } });
    expect(computeCandidateBinding(mutated, ORG)).not.toBe(bound);
    expect(() => computeCandidateBinding(c, 'different_org')).toThrow('organizationId mismatch');
  });

  it('rejects tampered or mismatched verification requests at the contract boundary', () => {
    const c = createCandidate();
    const baseReq = makeRequest(c);

    expect(() => validateVerificationRequest({ ...baseReq, candidateBinding: baseReq.candidateBinding + ' ' }, c, ORG)).toThrow('candidateBinding mismatch');
    expect(() => validateVerificationRequest({ ...baseReq, commitSha: 'b'.repeat(40) }, c, ORG)).toThrow('commitSha mismatch');
    expect(() => validateVerificationRequest({ ...baseReq, snapshotId: 'other-snap' }, c, ORG)).toThrow('snapshotId mismatch');
    expect(() => validateVerificationRequest({ ...baseReq, vulnerabilityClass: 'SQL_INJECTION' }, c, ORG)).toThrow('vulnerabilityClass mismatch');
    expect(() => validateVerificationRequest({ ...baseReq, createdAt: '2026-09-01T00:00:00.000Z' }, c, ORG)).toThrow('request predates candidate');
    expect(() => validateVerificationRequest({ ...baseReq, networkPolicy: { mode: 'ALLOW_ALL', allowedDestinations: [] } }, c, ORG)).toThrow('network mode');
  });

  it('preserves CANDIDATE state and prohibits direct completion without pending verification', async () => {
    const c = createCandidate();
    const state = createVerificationState(c, ORG);
    expect(state.state).toBe('CANDIDATE');

    const fakeResult: any = {
      contractVersion: CONTRACT_VERSION,
      organizationId: ORG,
      result: 'VERIFIED',
    };
    await expect(transitionVerificationState(state, { type: 'COMPLETE', result: fakeResult, evidence: {} as any })).rejects.toThrow('COMPLETE requires pending verification');
  });

  it('validates evidence artifact and verification result for COMMAND_INJECTION observation', async () => {
    const c = createCandidate();
    const q = validateVerificationRequest(makeRequest(c), c, ORG);

    const evidenceBody = {
      contractVersion: CONTRACT_VERSION,
      evidenceId: 'ev-cmdi-001',
      organizationId: ORG,
      candidateId: c.candidateId,
      candidateBinding: q.candidateBinding,
      requestId: q.requestId,
      repositoryId: c.snapshot.repositoryId,
      snapshotId: c.snapshot.snapshotId,
      commitSha: c.snapshot.commitSha,
      vulnerabilityClass: 'COMMAND_INJECTION' as const,
      verificationProfile: q.verificationProfile,
      environmentIdentity: {
        environmentType: 'ISOLATED_TEST' as const,
        runtime: 'NODE' as const,
        runtimeVersion: '20.0.0',
        environmentId: 'env-node-20',
        imageDigest: 'sha256:' + 'b'.repeat(64),
      },
      executionIdentity: { executionId: 'exec-001', runnerId: 'runner-001' },
      assertionType: 'COMMAND_EXECUTION_OBSERVED' as const,
      assertionResult: 'PASSED' as const,
      observedBehavior: {
        observationCode: 'VIOLATION_OBSERVED' as const,
        detailsFingerprint: 'sha256:' + 'c'.repeat(64),
      },
      startedAt: '2026-09-02T00:00:01.000Z',
      completedAt: '2026-09-02T00:00:02.000Z',
      reproduction: {
        profileId: q.verificationProfile.profileId,
        profileVersion: q.verificationProfile.version,
        fixtureId: 'cmdi-fixture-001',
        testId: 'cmdi-direct-exec',
        requiredEnvironmentType: 'ISOLATED_TEST' as const,
        expectedAssertion: 'COMMAND_EXECUTION_OBSERVED' as const,
      },
    };

    const evidenceHash = await computeEvidenceHash(evidenceBody, q, c, ORG);
    const validEvidence = { ...evidenceBody, evidenceHash };
    const validatedArtifact = await validateEvidenceArtifact(validEvidence, q, c, ORG);
    expect(validatedArtifact.assertionType).toBe('COMMAND_EXECUTION_OBSERVED');
    expect(validatedArtifact.evidenceHash).toBe(evidenceHash);

    const resultBody = {
      contractVersion: CONTRACT_VERSION,
      requestId: q.requestId,
      candidateId: c.candidateId,
      candidateBinding: q.candidateBinding,
      organizationId: ORG,
      snapshotId: c.snapshot.snapshotId,
      commitSha: c.snapshot.commitSha,
      vulnerabilityClass: 'COMMAND_INJECTION' as const,
      result: 'VERIFIED' as const,
      evidenceId: validEvidence.evidenceId,
      observedBehavior: validEvidence.observedBehavior,
      assertionResult: 'PASSED' as const,
      environmentIdentity: validEvidence.environmentIdentity,
      executionIdentity: validEvidence.executionIdentity,
      startedAt: validEvidence.startedAt,
      completedAt: validEvidence.completedAt,
      resourceUsage: { cpuMillis: 500, peakMemoryMb: 256, wallTimeMs: 1000, networkRequests: 0 },
    };

    const validatedResult = await validateVerificationResult(resultBody, q, c, validEvidence, ORG);
    expect(validatedResult.result).toBe('VERIFIED');
    expect(validatedResult.assertionResult).toBe('PASSED');
  });
});
