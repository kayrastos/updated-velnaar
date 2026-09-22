import { describe, expect, it } from 'vitest';
import {
  CONTRACT_VERSION,
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
  type EvidenceArtifact,
  type VerificationResult,
} from '../../../../worker/intelligence/contracts';

const ORG = 'org_cmdi_roadmap';
const COMMIT_SHA = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const SNAPSHOT_TIME = '2026-09-04T00:00:00.000Z';
const CANDIDATE_TIME = '2026-09-04T00:00:01.000Z';
const REQUEST_TIME = '2026-09-04T00:00:02.000Z';
const START_TIME = '2026-09-04T00:00:03.000Z';
const END_TIME = '2026-09-04T00:00:04.000Z';

function createCandidateFixture(): FindingCandidate {
  return {
    contractVersion: CONTRACT_VERSION,
    organizationId: ORG,
    candidateId: 'cand_cmdi_bound_rst_01',
    snapshot: {
      contractVersion: CONTRACT_VERSION,
      organizationId: ORG,
      snapshotId: 'snap_cmdi_01',
      repositoryId: 'repo_cmdi_01',
      sourceProvider: 'LOCAL_FIXTURE',
      commitSha: COMMIT_SHA,
      ref: 'refs/heads/main',
      createdAt: SNAPSHOT_TIME,
    },
    vulnerabilityClass: 'COMMAND_INJECTION',
    source: {
      filePath: 'src/routes/exec.ts',
      symbol: 'req.query.cmd',
      line: 14,
      column: 18,
    },
    sink: {
      filePath: 'src/routes/exec.ts',
      symbol: 'child_process.exec',
      line: 18,
      column: 3,
    },
    context: {
      entrypoint: {
        filePath: 'src/routes/exec.ts',
        symbol: 'commandRoute',
        line: 12,
        column: 1,
      },
      routeId: 'POST.exec',
    },
    sensorEvidence: [
      {
        contractVersion: CONTRACT_VERSION,
        organizationId: ORG,
        sensorType: 'VELNAR_STRUCTURAL',
        sensorFindingId: 'sensor_cmdi_01',
        ruleId: 'express-request-to-child-process-exec-v1',
        summary: 'Tainted request query parameter reached child_process.exec without shell sanitization.',
        sourceLocation: {
          filePath: 'src/routes/exec.ts',
          symbol: 'req.query.cmd',
          line: 14,
          column: 18,
        },
        sinkLocation: {
          filePath: 'src/routes/exec.ts',
          symbol: 'child_process.exec',
          line: 18,
          column: 3,
        },
        rawEvidenceFingerprint: `sha256:${'e'.repeat(64)}`,
      },
    ],
    reachabilityState: 'REACHABLE',
    verificationState: 'CANDIDATE',
    createdAt: CANDIDATE_TIME,
  };
}

function createRequestFixture(c: FindingCandidate): VerificationRequest {
  const candidateBinding = computeCandidateBinding(c, ORG);
  return {
    contractVersion: CONTRACT_VERSION,
    organizationId: ORG,
    requestId: 'req_cmdi_01',
    candidateId: c.candidateId,
    candidateBinding,
    snapshotId: c.snapshot.snapshotId,
    commitSha: c.snapshot.commitSha,
    vulnerabilityClass: 'COMMAND_INJECTION',
    verificationProfile: {
      profileId: 'cmdi-dynamic-v1',
      version: 1,
    },
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
    expectedAssertionType: 'COMMAND_EXECUTION_OBSERVED',
    createdAt: REQUEST_TIME,
  };
}

async function createEvidenceAndResultFixture(c: FindingCandidate, q: VerificationRequest) {
  const body = {
    contractVersion: CONTRACT_VERSION,
    evidenceId: 'ev_cmdi_01',
    organizationId: ORG,
    candidateId: c.candidateId,
    candidateBinding: q.candidateBinding,
    requestId: q.requestId,
    repositoryId: c.snapshot.repositoryId,
    snapshotId: c.snapshot.snapshotId,
    commitSha: c.snapshot.commitSha,
    vulnerabilityClass: 'COMMAND_INJECTION' as const,
    verificationProfile: {
      profileId: 'cmdi-dynamic-v1',
      version: 1,
    },
    environmentIdentity: {
      environmentType: 'ISOLATED_TEST' as const,
      runtime: 'NODE' as const,
      runtimeVersion: '20.11.0',
      environmentId: 'env_cmdi_01',
      imageDigest: `sha256:${'d'.repeat(64)}`,
    },
    executionIdentity: {
      executionId: 'exec_cmdi_01',
      runnerId: 'runner_cmdi_01',
    },
    assertionType: 'COMMAND_EXECUTION_OBSERVED' as const,
    assertionResult: 'PASSED' as const,
    observedBehavior: {
      observationCode: 'VIOLATION_OBSERVED' as const,
      detailsFingerprint: `sha256:${'f'.repeat(64)}`,
    },
    startedAt: START_TIME,
    completedAt: END_TIME,
    reproduction: {
      profileId: 'cmdi-dynamic-v1',
      profileVersion: 1,
      fixtureId: 'cmdi-fixture-01',
      testId: 'test-cmdi-provenance',
      requiredEnvironmentType: 'ISOLATED_TEST' as const,
      expectedAssertion: 'COMMAND_EXECUTION_OBSERVED' as const,
    },
  };

  const evidenceHash = await computeEvidenceHash(body, q, c, ORG);
  const evidence: EvidenceArtifact = {
    ...body,
    evidenceHash,
  };

  const result: VerificationResult = {
    contractVersion: CONTRACT_VERSION,
    requestId: q.requestId,
    candidateId: c.candidateId,
    candidateBinding: q.candidateBinding,
    organizationId: ORG,
    snapshotId: c.snapshot.snapshotId,
    commitSha: c.snapshot.commitSha,
    vulnerabilityClass: 'COMMAND_INJECTION',
    result: 'VERIFIED',
    evidenceId: evidence.evidenceId,
    observedBehavior: evidence.observedBehavior,
    assertionResult: 'PASSED',
    environmentIdentity: evidence.environmentIdentity,
    executionIdentity: evidence.executionIdentity,
    startedAt: START_TIME,
    completedAt: END_TIME,
    resourceUsage: {
      cpuMillis: 500,
      peakMemoryMb: 128,
      wallTimeMs: 1000,
      networkRequests: 0,
    },
  };

  return { evidence, result };
}

describe('Roadmap Chat-2: COMMAND_INJECTION boundary rejection and restart-resume', () => {
  it('binds COMMAND_INJECTION candidate canonically without sha256 prefix and preserves CANDIDATE state', () => {
    const c = createCandidateFixture();
    const validated = validateFindingCandidate(c, ORG);
    expect(validated.vulnerabilityClass).toBe('COMMAND_INJECTION');
    expect(validated.verificationState).toBe('CANDIDATE');
    const binding = computeCandidateBinding(validated, ORG);
    expect(binding.startsWith(`${CONTRACT_VERSION}:FindingCandidate\n`)).toBe(true);
    expect(binding).not.toMatch(/^sha256:/);
  });

  it('rejects candidate with non-CANDIDATE verificationState, invalid commit, or tenant mismatch', () => {
    const base = createCandidateFixture();
    expect(() => validateFindingCandidate({ ...base, verificationState: 'VERIFIED' as any }, ORG)).toThrow('INTELLIGENCE_PROTOCOL_ERROR');
    expect(() => validateFindingCandidate({ ...base, snapshot: { ...base.snapshot, commitSha: '0'.repeat(40) } }, ORG)).toThrow('INTELLIGENCE_PROTOCOL_ERROR');
    expect(() => validateFindingCandidate(base, 'foreign_org')).toThrow('INTELLIGENCE_PROTOCOL_ERROR');
  });

  it('rejects verification request with mismatched assertion type or tampered binding', () => {
    const c = createCandidateFixture();
    const q = createRequestFixture(c);
    expect(validateVerificationRequest(q, c, ORG)).toBeDefined();

    const mismatchedAssertion = { ...q, expectedAssertionType: 'SQL_RESULT_SET_VIOLATION' as any };
    expect(() => validateVerificationRequest(mismatchedAssertion, c, ORG)).toThrow('expectedAssertionType mismatch');

    const tamperedBinding = { ...q, candidateBinding: q.candidateBinding + 'tampered' };
    expect(() => validateVerificationRequest(tamperedBinding, c, ORG)).toThrow('candidateBinding mismatch');
  });

  it('enforces exact candidate three-state progression and prohibits direct completion from CANDIDATE', async () => {
    const c = createCandidateFixture();
    const q = createRequestFixture(c);
    const { evidence, result } = await createEvidenceAndResultFixture(c, q);
    const state = createVerificationState(c, ORG);
    expect(state.state).toBe('CANDIDATE');

    await expect(transitionVerificationState(state, { type: 'COMPLETE', result, evidence })).rejects.toThrow('COMPLETE requires pending verification');

    const pending = await transitionVerificationState(state, { type: 'BEGIN', request: q });
    expect(pending.state).toBe('PENDING_VERIFICATION');

    const completed = await transitionVerificationState(pending, { type: 'COMPLETE', result, evidence });
    expect(completed.state).toBe('VERIFIED');
    expect(completed.result.candidateBinding).toBe(q.candidateBinding);
  });

  it('rejects repeated BEGIN transition or tampered commit resume during verification', async () => {
    const c = createCandidateFixture();
    const q = createRequestFixture(c);
    const state = createVerificationState(c, ORG);
    const pending = await transitionVerificationState(state, { type: 'BEGIN', request: q });

    await expect(transitionVerificationState(pending, { type: 'BEGIN', request: q })).rejects.toThrow();

    const otherCommit = 'b'.repeat(40);
    const tamperedReq = { ...q, commitSha: otherCommit };
    await expect(transitionVerificationState(state, { type: 'BEGIN', request: tamperedReq })).rejects.toThrow('commitSha mismatch');
  });

  it('rejects transitions on terminal completed state preventing illegal restart-resume', async () => {
    const c = createCandidateFixture();
    const q = createRequestFixture(c);
    const { evidence, result } = await createEvidenceAndResultFixture(c, q);
    const state = createVerificationState(c, ORG);
    const pending = await transitionVerificationState(state, { type: 'BEGIN', request: q });
    const completed = await transitionVerificationState(pending, { type: 'COMPLETE', result, evidence });

    await expect(transitionVerificationState(completed, { type: 'BEGIN', request: q })).rejects.toThrow();
    await expect(transitionVerificationState(completed, { type: 'COMPLETE', result, evidence })).rejects.toThrow();
  });

  it('validates evidence artifact and verification result integrity for COMMAND_INJECTION', async () => {
    const c = createCandidateFixture();
    const q = createRequestFixture(c);
    const { evidence, result } = await createEvidenceAndResultFixture(c, q);

    const validatedEvidence = await validateEvidenceArtifact(evidence, q, c, ORG);
    expect(validatedEvidence.assertionType).toBe('COMMAND_EXECUTION_OBSERVED');
    expect(validatedEvidence.evidenceHash).toBe(evidence.evidenceHash);

    const validatedResult = await validateVerificationResult(result, q, c, evidence, ORG);
    expect(validatedResult.result).toBe('VERIFIED');
    expect(validatedResult.candidateBinding).toBe(q.candidateBinding);
  });
});
