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
  type CodeSnapshotRef,
  type EvidenceArtifact,
  type FindingCandidate,
  type VerificationRequest,
  type VerificationResult,
} from '../../../../worker/intelligence/contracts';

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical((value as Record<string, unknown>)[k])).join(',') + '}';
}

const ORG = 'org_ssrf_pos_dir';
const COMMIT = 'a'.repeat(40);
const SNAPSHOT_CREATED = '2026-09-20T00:00:00.000Z';
const CANDIDATE_CREATED = '2026-09-20T01:00:00.000Z';
const REQUEST_CREATED = '2026-09-20T02:00:00.000Z';
const STARTED_AT = '2026-09-20T02:00:01.000Z';
const COMPLETED_AT = '2026-09-20T02:00:02.000Z';

function createFixtures() {
  const snapshot: CodeSnapshotRef = {
    contractVersion: CONTRACT_VERSION,
    organizationId: ORG,
    snapshotId: 'snap_ssrf_dir_001',
    repositoryId: 'repo_ssrf_dir_001',
    sourceProvider: 'LOCAL_FIXTURE',
    commitSha: COMMIT,
    ref: 'refs/heads/main',
    createdAt: SNAPSHOT_CREATED,
  };

  const candidate: FindingCandidate = {
    contractVersion: CONTRACT_VERSION,
    candidateId: 'cand_ssrf_pos_dir_001',
    organizationId: ORG,
    snapshot,
    vulnerabilityClass: 'SSRF',
    source: {
      filePath: 'src/routes/proxy.ts',
      symbol: 'req.query.url',
      line: 14,
      column: 21,
    },
    sink: {
      filePath: 'src/routes/proxy.ts',
      symbol: 'fetch',
      line: 16,
      column: 11,
    },
    context: {
      entrypoint: {
        filePath: 'src/routes/proxy.ts',
        symbol: 'proxyRoute',
        line: 12,
        column: 1,
      },
      routeId: 'GET.api.proxy',
    },
    sensorEvidence: [
      {
        contractVersion: CONTRACT_VERSION,
        organizationId: ORG,
        sensorType: 'VELNAR_STRUCTURAL',
        sensorFindingId: 'sensor_ssrf_dir_001',
        ruleId: 'ssrf-request-direct-v1',
        summary: 'Direct user-controlled URL flows into HTTP fetch sink.',
        sourceLocation: {
          filePath: 'src/routes/proxy.ts',
          symbol: 'req.query.url',
          line: 14,
          column: 21,
        },
        sinkLocation: {
          filePath: 'src/routes/proxy.ts',
          symbol: 'fetch',
          line: 16,
          column: 11,
        },
        rawEvidenceFingerprint: `sha256:${'c'.repeat(64)}`,
      },
    ],
    reachabilityState: 'REACHABLE',
    verificationState: 'CANDIDATE',
    createdAt: CANDIDATE_CREATED,
  };

  const candidateBinding = computeCandidateBinding(candidate, ORG);

  const request: VerificationRequest = {
    contractVersion: CONTRACT_VERSION,
    requestId: 'req_ssrf_dir_001',
    candidateId: candidate.candidateId,
    candidateBinding,
    organizationId: ORG,
    snapshotId: snapshot.snapshotId,
    commitSha: snapshot.commitSha,
    vulnerabilityClass: 'SSRF',
    verificationProfile: {
      profileId: 'profile_ssrf_dir_v1',
      version: 1,
    },
    environmentRequirements: {
      environmentType: 'ISOLATED_TEST',
      runtime: 'NODE',
      runtimeVersion: '20.11.0',
    },
    networkPolicy: {
      mode: 'DEFAULT_DENY',
      allowedDestinations: [
        {
          hostname: 'safe.example.com',
          port: 443,
          protocol: 'HTTPS',
        },
      ],
    },
    resourceBudget: {
      maxCpuMillis: 50_000,
      maxMemoryMb: 1024,
      maxWallTimeMs: 30_000,
      maxNetworkRequests: 10,
    },
    timeBudgetMs: 10_000,
    expectedAssertionType: 'OUTBOUND_REQUEST_OBSERVED',
    createdAt: REQUEST_CREATED,
  };

  return { snapshot, candidate, candidateBinding, request };
}

describe('SSRF positive control direct roadmap test', () => {
  it('positive control: direct SSRF candidate satisfies canonical contract structure and validation', () => {
    const { snapshot, candidate } = createFixtures();
    expect(validateCodeSnapshotRef(snapshot, ORG)).toEqual(snapshot);
    const validated = validateFindingCandidate(candidate, ORG);
    expect(validated.vulnerabilityClass).toBe('SSRF');
    expect(validated.verificationState).toBe('CANDIDATE');
    expect(validated.reachabilityState).toBe('REACHABLE');
    expect(validated.source.symbol).toBe('req.query.url');
    expect(validated.sink.symbol).toBe('fetch');
  });

  it('positive control: direct SSRF candidate binding uses canonical complete representation without sha256 prefix', () => {
    const { candidate, candidateBinding } = createFixtures();
    const expected = `${CONTRACT_VERSION}:FindingCandidate\n${canonical(candidate)}`;
    expect(candidateBinding).toBe(expected);
    expect(candidateBinding.startsWith('sha256:')).toBe(false);
  });

  it('positive control: three-state lifecycle enforces CANDIDATE -> PENDING_VERIFICATION -> VERIFIED with OUTBOUND_REQUEST_OBSERVED', async () => {
    const { candidate, candidateBinding, request } = createFixtures();
    expect(ASSERTION_BY_CLASS.SSRF).toBe('OUTBOUND_REQUEST_OBSERVED');

    const safeRequest = validateVerificationRequest(request, candidate, ORG);
    expect(safeRequest.expectedAssertionType).toBe('OUTBOUND_REQUEST_OBSERVED');

    const evidenceBody = {
      contractVersion: CONTRACT_VERSION,
      evidenceId: 'ev_ssrf_dir_001',
      organizationId: ORG,
      candidateId: candidate.candidateId,
      candidateBinding,
      requestId: request.requestId,
      repositoryId: candidate.snapshot.repositoryId,
      snapshotId: candidate.snapshot.snapshotId,
      commitSha: candidate.snapshot.commitSha,
      vulnerabilityClass: 'SSRF' as const,
      verificationProfile: {
        profileId: 'profile_ssrf_dir_v1',
        version: 1,
      },
      environmentIdentity: {
        environmentType: 'ISOLATED_TEST' as const,
        runtime: 'NODE' as const,
        runtimeVersion: '20.11.0',
        environmentId: 'env_ssrf_dir_001',
        imageDigest: `sha256:${'d'.repeat(64)}`,
      },
      executionIdentity: {
        executionId: 'exec_ssrf_dir_001',
        runnerId: 'runner_ssrf_dir_001',
      },
      assertionType: 'OUTBOUND_REQUEST_OBSERVED' as const,
      assertionResult: 'PASSED' as const,
      observedBehavior: {
        observationCode: 'VIOLATION_OBSERVED' as const,
        detailsFingerprint: `sha256:${'e'.repeat(64)}`,
      },
      startedAt: STARTED_AT,
      completedAt: COMPLETED_AT,
      reproduction: {
        profileId: 'profile_ssrf_dir_v1',
        profileVersion: 1,
        fixtureId: 'fixture_ssrf_dir_001',
        testId: 'test_ssrf_direct_request',
        requiredEnvironmentType: 'ISOLATED_TEST' as const,
        expectedAssertion: 'OUTBOUND_REQUEST_OBSERVED' as const,
      },
    };
    const evidenceHash = await computeEvidenceHash(evidenceBody, request, candidate, ORG);
    const evidence: EvidenceArtifact = { ...evidenceBody, evidenceHash };
    const safeEvidence = await validateEvidenceArtifact(evidence, request, candidate, ORG);
    expect(safeEvidence.evidenceHash).toBe(evidenceHash);

    const result: VerificationResult = {
      contractVersion: CONTRACT_VERSION,
      requestId: request.requestId,
      candidateId: candidate.candidateId,
      candidateBinding,
      organizationId: ORG,
      snapshotId: candidate.snapshot.snapshotId,
      commitSha: candidate.snapshot.commitSha,
      vulnerabilityClass: 'SSRF',
      result: 'VERIFIED',
      evidenceId: evidence.evidenceId,
      observedBehavior: {
        observationCode: 'VIOLATION_OBSERVED',
        detailsFingerprint: `sha256:${'e'.repeat(64)}`,
      },
      assertionResult: 'PASSED',
      environmentIdentity: {
        environmentType: 'ISOLATED_TEST',
        runtime: 'NODE',
        runtimeVersion: '20.11.0',
        environmentId: 'env_ssrf_dir_001',
        imageDigest: `sha256:${'d'.repeat(64)}`,
      },
      executionIdentity: {
        executionId: 'exec_ssrf_dir_001',
        runnerId: 'runner_ssrf_dir_001',
      },
      startedAt: STARTED_AT,
      completedAt: COMPLETED_AT,
      resourceUsage: {
        cpuMillis: 1500,
        peakMemoryMb: 256,
        wallTimeMs: 1000,
        networkRequests: 1,
      },
    };
    const safeResult = await validateVerificationResult(result, request, candidate, evidence, ORG);
    expect(safeResult.result).toBe('VERIFIED');

    const start = createVerificationState(candidate, ORG);
    expect(start.state).toBe('CANDIDATE');
    await expect(transitionVerificationState(start, { type: 'COMPLETE', result, evidence })).rejects.toThrow('COMPLETE requires pending verification');

    const pending = await transitionVerificationState(start, { type: 'BEGIN', request });
    expect(pending.state).toBe('PENDING_VERIFICATION');

    const done = await transitionVerificationState(pending, { type: 'COMPLETE', result, evidence });
    expect(done.state).toBe('VERIFIED');
    expect(done.result.candidateBinding).toBe(candidateBinding);
  });

  it('negative control: safe controls, malformed commit, and unreachable candidates fail closed', async () => {
    const { snapshot, candidate, request } = createFixtures();

    expect(() => validateFindingCandidate({ ...candidate, verificationState: 'VERIFIED' as any }, ORG)).toThrow('INTELLIGENCE_PROTOCOL_ERROR:');
    expect(() => validateCodeSnapshotRef({ ...snapshot, commitSha: '0'.repeat(40) }, ORG)).toThrow('INTELLIGENCE_PROTOCOL_ERROR: invalid commitSha');
    expect(() => validateVerificationRequest({ ...request, candidateBinding: request.candidateBinding + ' ' }, candidate, ORG)).toThrow('INTELLIGENCE_PROTOCOL_ERROR:');
    expect(() => validateFindingCandidate(candidate, 'org_foreign')).toThrow('INTELLIGENCE_PROTOCOL_ERROR:');

    const unreachable: FindingCandidate = { ...candidate, reachabilityState: 'UNREACHABLE' };
    const unreachableBinding = computeCandidateBinding(unreachable, ORG);
    const unreachableReq: VerificationRequest = { ...request, candidateBinding: unreachableBinding };
    const unreachableRes: VerificationResult = {
      contractVersion: CONTRACT_VERSION,
      requestId: unreachableReq.requestId,
      candidateId: unreachable.candidateId,
      candidateBinding: unreachableBinding,
      organizationId: ORG,
      snapshotId: unreachable.snapshot.snapshotId,
      commitSha: unreachable.snapshot.commitSha,
      vulnerabilityClass: 'SSRF',
      result: 'VERIFIED',
      evidenceId: null,
      observedBehavior: {
        observationCode: 'VIOLATION_OBSERVED',
        detailsFingerprint: `sha256:${'e'.repeat(64)}`,
      },
      assertionResult: 'PASSED',
      environmentIdentity: {
        environmentType: 'ISOLATED_TEST',
        runtime: 'NODE',
        runtimeVersion: '20.11.0',
        environmentId: 'env_ssrf_dir_001',
        imageDigest: `sha256:${'d'.repeat(64)}`,
      },
      executionIdentity: {
        executionId: 'exec_ssrf_dir_001',
        runnerId: 'runner_ssrf_dir_001',
      },
      startedAt: STARTED_AT,
      completedAt: COMPLETED_AT,
      resourceUsage: {
        cpuMillis: 1000,
        peakMemoryMb: 128,
        wallTimeMs: 1000,
        networkRequests: 0,
      },
    };
    await expect(validateVerificationResult(unreachableRes, unreachableReq, unreachable, null, ORG)).rejects.toThrow('unreachable candidate cannot be verified');
  });
});
