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
  type EvidenceArtifact,
  type FindingCandidate,
  type VerificationRequest,
  type VerificationResult,
} from '../../../../worker/intelligence/contracts';

const ORG = 'org_cmdi_multi';
const COMMIT_A = '46db4c208f886afda939c04ae93580fbabd57344';
const COMMIT_B = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function createCmdiCandidate(overrides: Partial<FindingCandidate> = {}): FindingCandidate {
  const createdAt = '2026-09-04T00:00:00.000Z';
  const base: FindingCandidate = {
    contractVersion: CONTRACT_VERSION,
    candidateId: 'candidate-cmdi-multi-001',
    organizationId: ORG,
    snapshot: {
      contractVersion: CONTRACT_VERSION,
      snapshotId: 'snapshot-cmdi-001',
      organizationId: ORG,
      repositoryId: 'repo-cmdi-001',
      sourceProvider: 'LOCAL_FIXTURE',
      commitSha: COMMIT_A,
      ref: 'refs/heads/main',
      createdAt,
    },
    vulnerabilityClass: 'COMMAND_INJECTION',
    source: {
      filePath: 'src/routes/command.ts',
      symbol: 'req.query.cmd',
      line: 12,
      column: 18,
    },
    sink: {
      filePath: 'src/routes/command.ts',
      symbol: 'child_process.exec',
      line: 18,
      column: 5,
    },
    context: {
      entrypoint: {
        filePath: 'src/routes/command.ts',
        symbol: 'commandHandler',
        line: 10,
        column: 1,
      },
      routeId: 'GET.api.command',
    },
    sensorEvidence: [
      {
        contractVersion: CONTRACT_VERSION,
        organizationId: ORG,
        sensorType: 'VELNAR_STRUCTURAL',
        sensorFindingId: 'finding-cmdi-001',
        ruleId: 'child-process-exec-injection',
        summary: 'Request parameter flows directly into child_process.exec command string',
        sourceLocation: {
          filePath: 'src/routes/command.ts',
          symbol: 'req.query.cmd',
          line: 12,
          column: 18,
        },
        sinkLocation: {
          filePath: 'src/routes/command.ts',
          symbol: 'child_process.exec',
          line: 18,
          column: 5,
        },
        rawEvidenceFingerprint: `sha256:${'a'.repeat(64)}`,
      },
    ],
    reachabilityState: 'REACHABLE',
    verificationState: 'CANDIDATE',
    createdAt,
  };
  return validateFindingCandidate({ ...base, ...overrides }, ORG);
}

function createCmdiRequest(candidate: FindingCandidate, overrides: Partial<VerificationRequest> = {}): VerificationRequest {
  const binding = computeCandidateBinding(candidate, ORG);
  const base: VerificationRequest = {
    contractVersion: CONTRACT_VERSION,
    requestId: 'req-cmdi-001',
    organizationId: ORG,
    candidateId: candidate.candidateId,
    candidateBinding: binding,
    snapshotId: candidate.snapshot.snapshotId,
    commitSha: candidate.snapshot.commitSha,
    vulnerabilityClass: 'COMMAND_INJECTION',
    verificationProfile: { profileId: 'profile-cmdi-v1', version: 1 },
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
      maxMemoryMb: 1024,
      maxWallTimeMs: 30_000,
      maxNetworkRequests: 0,
    },
    timeBudgetMs: 10_000,
    expectedAssertionType: ASSERTION_BY_CLASS[candidate.vulnerabilityClass],
    createdAt: '2026-09-04T00:00:01.000Z',
  };
  return validateVerificationRequest({ ...base, ...overrides }, candidate, ORG);
}

async function createCmdiEvidence(
  candidate: FindingCandidate,
  request: VerificationRequest,
  overrides: Partial<EvidenceArtifact> = {},
): Promise<EvidenceArtifact> {
  const body = {
    contractVersion: CONTRACT_VERSION,
    evidenceId: 'evidence-cmdi-001',
    organizationId: ORG,
    candidateId: candidate.candidateId,
    candidateBinding: request.candidateBinding,
    requestId: request.requestId,
    repositoryId: candidate.snapshot.repositoryId,
    snapshotId: candidate.snapshot.snapshotId,
    commitSha: candidate.snapshot.commitSha,
    vulnerabilityClass: candidate.vulnerabilityClass,
    verificationProfile: request.verificationProfile,
    environmentIdentity: {
      environmentType: 'ISOLATED_TEST' as const,
      runtime: 'NODE' as const,
      runtimeVersion: '20.11.0',
      environmentId: 'env-cmdi-001',
      imageDigest: `sha256:${'b'.repeat(64)}`,
    },
    executionIdentity: {
      executionId: 'exec-cmdi-001',
      runnerId: 'runner-cmdi-001',
    },
    assertionType: request.expectedAssertionType,
    assertionResult: 'PASSED' as const,
    observedBehavior: {
      observationCode: 'VIOLATION_OBSERVED' as const,
      detailsFingerprint: `sha256:${'c'.repeat(64)}`,
    },
    startedAt: '2026-09-04T00:00:01.100Z',
    completedAt: '2026-09-04T00:00:01.500Z',
    reproduction: {
      profileId: request.verificationProfile.profileId,
      profileVersion: request.verificationProfile.version,
      fixtureId: 'fixture-cmdi-001',
      testId: 'test-cmdi-multi-step',
      requiredEnvironmentType: 'ISOLATED_TEST' as const,
      expectedAssertion: request.expectedAssertionType,
    },
  };
  const merged = { ...body, ...overrides };
  const evidenceHash = await computeEvidenceHash(merged, request, candidate, ORG);
  return validateEvidenceArtifact({ ...merged, evidenceHash }, request, candidate, ORG);
}

async function createCmdiFixture() {
  const candidate = createCmdiCandidate();
  const request = createCmdiRequest(candidate);
  const evidence = await createCmdiEvidence(candidate, request);
  const resultBody: VerificationResult = {
    contractVersion: CONTRACT_VERSION,
    requestId: request.requestId,
    candidateId: candidate.candidateId,
    candidateBinding: request.candidateBinding,
    organizationId: ORG,
    snapshotId: candidate.snapshot.snapshotId,
    commitSha: candidate.snapshot.commitSha,
    vulnerabilityClass: candidate.vulnerabilityClass,
    result: 'VERIFIED',
    evidenceId: evidence.evidenceId,
    observedBehavior: evidence.observedBehavior,
    assertionResult: evidence.assertionResult,
    environmentIdentity: evidence.environmentIdentity,
    executionIdentity: evidence.executionIdentity,
    startedAt: evidence.startedAt,
    completedAt: evidence.completedAt,
    resourceUsage: {
      cpuMillis: 250,
      peakMemoryMb: 256,
      wallTimeMs: 400,
      networkRequests: 0,
    },
  };
  const result = await validateVerificationResult(resultBody, request, candidate, evidence, ORG);
  return { candidate, request, evidence, result };
}

describe('COMMAND_INJECTION multi-stage provenance integrity', () => {
  it('executes full three-stage candidate lifecycle to VERIFIED without inventing sha256 prefix', async () => {
    const { candidate, request, evidence, result } = await createCmdiFixture();
    const start = createVerificationState(candidate, ORG);
    expect(start.state).toBe('CANDIDATE');
    expect(candidate.verificationState).toBe('CANDIDATE');

    const binding = computeCandidateBinding(candidate, ORG);
    expect(binding.startsWith(`${CONTRACT_VERSION}:FindingCandidate\n`)).toBe(true);
    expect(binding.startsWith('sha256:')).toBe(false);
    expect(request.candidateBinding).toBe(binding);

    const pending = await transitionVerificationState(start, { type: 'BEGIN', request });
    expect(pending.state).toBe('PENDING_VERIFICATION');

    const completed = await transitionVerificationState(pending, { type: 'COMPLETE', result, evidence });
    expect(completed.state).toBe('VERIFIED');
    expect(completed.result.candidateBinding).toBe(binding);
    expect(completed.result.assertionResult).toBe('PASSED');
    expect(completed.result.vulnerabilityClass).toBe('COMMAND_INJECTION');
  });

  it('prohibits direct transition from CANDIDATE to COMPLETE stage', async () => {
    const { candidate, evidence, result } = await createCmdiFixture();
    const start = createVerificationState(candidate, ORG);
    await expect(
      transitionVerificationState(start, { type: 'COMPLETE', result, evidence }),
    ).rejects.toThrow('COMPLETE requires pending verification');
  });

  it('rejects tampered sink authority between candidate definition and verification request', async () => {
    const { candidate, request } = await createCmdiFixture();
    const tampered = structuredClone(candidate);
    (tampered as any).sink = { filePath: 'src/routes/command.ts', symbol: 'untrustedCustomExec', line: 18, column: 5 };
    const tamperedBinding = computeCandidateBinding(tampered, ORG);
    expect(tamperedBinding).not.toBe(request.candidateBinding);

    const start = createVerificationState(tampered, ORG);
    await expect(
      transitionVerificationState(start, { type: 'BEGIN', request }),
    ).rejects.toThrow('candidateBinding mismatch');
  });

  it('rejects tampered source symbol across multi-stage evidence boundary', async () => {
    const { candidate, request, evidence, result } = await createCmdiFixture();
    const tampered = structuredClone(candidate);
    (tampered as any).source = { filePath: 'src/routes/command.ts', symbol: 'constantString', line: 12, column: 18 };
    const tamperedBinding = computeCandidateBinding(tampered, ORG);

    const tamperedReq = { ...request, candidateBinding: tamperedBinding };
    const start = createVerificationState(tampered, ORG);
    const pending = await transitionVerificationState(start, { type: 'BEGIN', request: tamperedReq });

    await expect(
      validateEvidenceArtifact(evidence, tamperedReq, tampered, ORG),
    ).rejects.toThrow('candidateBinding mismatch');

    await expect(
      transitionVerificationState(pending, { type: 'COMPLETE', result: { ...result, candidateBinding: tamperedBinding }, evidence }),
    ).rejects.toThrow('candidateBinding mismatch');
  });

  it('preserves commit replay protection when candidate is rebounded to Commit B', async () => {
    const { candidate, request, evidence, result } = await createCmdiFixture();
    const candidateB = structuredClone(candidate);
    (candidateB as any).snapshot.commitSha = COMMIT_B;
    const bindingB = computeCandidateBinding(candidateB, ORG);

    const requestB = { ...request, candidateBinding: bindingB, commitSha: COMMIT_B };
    const startB = createVerificationState(candidateB, ORG);
    const pendingB = await transitionVerificationState(startB, { type: 'BEGIN', request: requestB });

    await expect(
      transitionVerificationState(pendingB, {
        type: 'COMPLETE',
        result: { ...result, candidateBinding: bindingB, commitSha: COMMIT_B },
        evidence,
      }),
    ).rejects.toThrow('commitSha mismatch');
  });

  it('fails closed when given all-zero or malformed commit SHA', () => {
    const allZeroSha = '0'.repeat(40);
    expect(() =>
      validateCodeSnapshotRef({
        contractVersion: CONTRACT_VERSION,
        snapshotId: 'snap-bad',
        organizationId: ORG,
        repositoryId: 'repo-001',
        sourceProvider: 'LOCAL_FIXTURE',
        commitSha: allZeroSha,
        ref: 'refs/heads/main',
        createdAt: '2026-09-04T00:00:00.000Z',
      }),
    ).toThrow('invalid commitSha');
  });

  it('enforces tenant isolation across multi-stage request and result validation', async () => {
    const { candidate, request, evidence, result } = await createCmdiFixture();
    expect(() => createVerificationState(candidate, 'foreign_org')).toThrow('organizationId mismatch');
    await expect(
      validateVerificationResult(result, request, candidate, evidence, 'foreign_org'),
    ).rejects.toThrow('organizationId mismatch');
  });

  it('fails closed when unreachable candidate attempts to transition to VERIFIED', async () => {
    const candidate = createCmdiCandidate({ reachabilityState: 'UNREACHABLE' });
    const request = createCmdiRequest(candidate);
    const evidence = await createCmdiEvidence(candidate, request);
    const resultBody: VerificationResult = {
      contractVersion: CONTRACT_VERSION,
      requestId: request.requestId,
      candidateId: candidate.candidateId,
      candidateBinding: request.candidateBinding,
      organizationId: ORG,
      snapshotId: candidate.snapshot.snapshotId,
      commitSha: candidate.snapshot.commitSha,
      vulnerabilityClass: candidate.vulnerabilityClass,
      result: 'VERIFIED',
      evidenceId: evidence.evidenceId,
      observedBehavior: evidence.observedBehavior,
      assertionResult: evidence.assertionResult,
      environmentIdentity: evidence.environmentIdentity,
      executionIdentity: evidence.executionIdentity,
      startedAt: evidence.startedAt,
      completedAt: evidence.completedAt,
      resourceUsage: {
        cpuMillis: 250,
        peakMemoryMb: 256,
        wallTimeMs: 400,
        networkRequests: 0,
      },
    };
    await expect(
      validateVerificationResult(resultBody, request, candidate, evidence, ORG),
    ).rejects.toThrow('unreachable candidate cannot be verified');
  });
});
