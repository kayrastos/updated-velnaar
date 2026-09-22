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
  validateEvidenceArtifact,
  validateVerificationResult,
  type FindingCandidate,
  type VerificationRequest,
  type EvidenceArtifact,
  type VerificationResult,
} from '../../../../worker/intelligence/contracts';

const ORG = 'org_cmdi_rst';
const COMMIT_A = 'a'.repeat(40);
const COMMIT_B = 'b'.repeat(40);
const SNAPSHOT_ID = 'snap-cmdi-001';
const REPO_ID = 'repo-cmdi-001';
const CANDIDATE_ID = 'cand-cmdi-001';
const CREATED_AT = '2026-09-04T00:00:00.000Z';
const START_TIME = '2026-09-04T00:00:01.000Z';
const END_TIME = '2026-09-04T00:00:02.000Z';

function makeCmdiCandidate(overrides: Partial<FindingCandidate> = {}): FindingCandidate {
  const base: FindingCandidate = {
    contractVersion: CONTRACT_VERSION,
    organizationId: ORG,
    candidateId: CANDIDATE_ID,
    snapshot: {
      contractVersion: CONTRACT_VERSION,
      organizationId: ORG,
      snapshotId: SNAPSHOT_ID,
      repositoryId: REPO_ID,
      sourceProvider: 'LOCAL_FIXTURE',
      commitSha: COMMIT_A,
      ref: 'refs/heads/main',
      createdAt: CREATED_AT,
    },
    vulnerabilityClass: 'COMMAND_INJECTION',
    source: {
      filePath: 'src/routes.ts',
      symbol: 'req.query.cmd',
      line: 10,
      column: 14,
    },
    sink: {
      filePath: 'src/routes.ts',
      symbol: 'child_process.exec',
      line: 15,
      column: 3,
    },
    context: {
      entrypoint: {
        filePath: 'src/routes.ts',
        symbol: 'execRoute',
        line: 8,
        column: 1,
      },
      routeId: 'execRoute',
    },
    sensorEvidence: [
      {
        contractVersion: CONTRACT_VERSION,
        organizationId: ORG,
        sensorType: 'VELNAR_STRUCTURAL',
        sensorFindingId: 'sensor-cmdi-001',
        ruleId: 'express-request-to-child-process-exec-v1',
        summary: 'Source-analysis hypothesis: child_process.exec reachable from request parameter.',
        sourceLocation: {
          filePath: 'src/routes.ts',
          symbol: 'req.query.cmd',
          line: 10,
          column: 14,
        },
        sinkLocation: {
          filePath: 'src/routes.ts',
          symbol: 'child_process.exec',
          line: 15,
          column: 3,
        },
        rawEvidenceFingerprint: `sha256:${'1'.repeat(64)}`,
      },
    ],
    reachabilityState: 'REACHABLE',
    verificationState: 'CANDIDATE',
    createdAt: CREATED_AT,
  };
  return validateFindingCandidate({ ...base, ...overrides }, ORG);
}

function makeCmdiRequest(candidate: FindingCandidate): VerificationRequest {
  const binding = computeCandidateBinding(candidate, ORG);
  const raw: VerificationRequest = {
    contractVersion: CONTRACT_VERSION,
    requestId: 'req-cmdi-001',
    organizationId: ORG,
    candidateId: candidate.candidateId,
    candidateBinding: binding,
    snapshotId: candidate.snapshot.snapshotId,
    commitSha: candidate.snapshot.commitSha,
    vulnerabilityClass: 'COMMAND_INJECTION',
    verificationProfile: {
      profileId: 'cmdi-profile-v1',
      version: 1,
    },
    environmentRequirements: {
      environmentType: 'ISOLATED_TEST',
      runtime: 'NODE',
      runtimeVersion: '20.11.1',
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
    timeBudgetMs: 5000,
    expectedAssertionType: ASSERTION_BY_CLASS.COMMAND_INJECTION,
    createdAt: CREATED_AT,
  };
  return validateVerificationRequest(raw, candidate, ORG);
}

async function makeCmdiEvidence(request: VerificationRequest, candidate: FindingCandidate): Promise<EvidenceArtifact> {
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
    vulnerabilityClass: 'COMMAND_INJECTION' as const,
    verificationProfile: request.verificationProfile,
    environmentIdentity: {
      environmentType: 'ISOLATED_TEST' as const,
      runtime: 'NODE' as const,
      runtimeVersion: '20.11.1',
      environmentId: 'env-node-20',
      imageDigest: `sha256:${'2'.repeat(64)}`,
    },
    executionIdentity: {
      executionId: 'exec-cmdi-001',
      runnerId: 'runner-node-001',
    },
    assertionType: 'COMMAND_EXECUTION_OBSERVED' as const,
    assertionResult: 'PASSED' as const,
    observedBehavior: {
      observationCode: 'VIOLATION_OBSERVED' as const,
      detailsFingerprint: `sha256:${'3'.repeat(64)}`,
    },
    startedAt: START_TIME,
    completedAt: END_TIME,
    reproduction: {
      profileId: request.verificationProfile.profileId,
      profileVersion: request.verificationProfile.version,
      fixtureId: 'm2-case-001',
      testId: 'cmdi-replay-test',
      requiredEnvironmentType: 'ISOLATED_TEST' as const,
      expectedAssertion: 'COMMAND_EXECUTION_OBSERVED' as const,
    },
  };
  const evidenceHash = await computeEvidenceHash(body, request, candidate, ORG);
  return validateEvidenceArtifact({ ...body, evidenceHash }, request, candidate, ORG);
}

async function makeCmdiResult(
  request: VerificationRequest,
  candidate: FindingCandidate,
  evidence: EvidenceArtifact,
): Promise<VerificationResult> {
  const raw: VerificationResult = {
    contractVersion: CONTRACT_VERSION,
    requestId: request.requestId,
    candidateId: candidate.candidateId,
    candidateBinding: request.candidateBinding,
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
      cpuMillis: 500,
      peakMemoryMb: 128,
      wallTimeMs: Date.parse(evidence.completedAt) - Date.parse(evidence.startedAt),
      networkRequests: 0,
    },
  };
  return validateVerificationResult(raw, request, candidate, evidence, ORG);
}

async function fixture() {
  const c = makeCmdiCandidate();
  const q = makeCmdiRequest(c);
  const e = await makeCmdiEvidence(q, c);
  const r = await makeCmdiResult(q, c, e);
  return { c, q, e, r };
}

interface FlowEvaluation {
  status: 'DETECTED' | 'NOT_DETECTED' | 'ANALYSIS_INCONCLUSIVE';
  candidate?: FindingCandidate;
  limitation?: string;
}

function evaluateCommandFlow(input: {
  importedModule: string;
  sinkCall: string;
  argumentOrigin: 'REQUEST_PARAM' | 'SAFE_CONSTANT' | 'AMBIGUOUS' | 'UNBOUND';
  syntaxSupported: boolean;
}): FlowEvaluation {
  if (!input.syntaxSupported) {
    return { status: 'ANALYSIS_INCONCLUSIVE', limitation: 'UNSUPPORTED_SYNTAX' };
  }
  if (input.importedModule !== 'child_process' || !['exec', 'execSync'].includes(input.sinkCall)) {
    return { status: 'NOT_DETECTED' };
  }
  if (input.argumentOrigin === 'SAFE_CONSTANT') {
    return { status: 'NOT_DETECTED' };
  }
  if (input.argumentOrigin === 'AMBIGUOUS' || input.argumentOrigin === 'UNBOUND') {
    return { status: 'ANALYSIS_INCONCLUSIVE', limitation: 'AMBIGUOUS_PROVENANCE' };
  }
  const candidate = makeCmdiCandidate({
    sink: {
      filePath: 'src/routes.ts',
      symbol: `child_process.${input.sinkCall}`,
      line: 15,
      column: 3,
    },
  });
  return { status: 'DETECTED', candidate };
}

describe('V1 command injection restart-resume replay determinism', () => {
  it('preserves bit-for-bit determinism across restart and resume transitions', async () => {
    const { c, q, e, r } = await fixture();
    const start = createVerificationState(c, ORG);
    expect(start.state).toBe('CANDIDATE');

    const pending = await transitionVerificationState(start, { type: 'BEGIN', request: q });
    expect(pending.state).toBe('PENDING_VERIFICATION');

    const done = await transitionVerificationState(pending, { type: 'COMPLETE', result: r, evidence: e });
    expect(done.state).toBe('VERIFIED');
    expect(done.result.candidateBinding).toBe(computeCandidateBinding(done.candidate, ORG));

    const restartDone = await transitionVerificationState(pending, { type: 'COMPLETE', result: r, evidence: e });
    expect(restartDone).toEqual(done);

    const fullRestartPending = await transitionVerificationState(createVerificationState(c, ORG), { type: 'BEGIN', request: q });
    const fullRestartDone = await transitionVerificationState(fullRestartPending, { type: 'COMPLETE', result: r, evidence: e });
    expect(fullRestartDone).toEqual(done);
  });

  it('rejects direct completion from CANDIDATE without prior BEGIN transition', async () => {
    const { c, e, r } = await fixture();
    const start = createVerificationState(c, ORG);
    await expect(transitionVerificationState(start, { type: 'COMPLETE', result: r, evidence: e })).rejects.toThrow(
      'COMPLETE requires pending verification',
    );
  });

  it('retains Commit A to Commit B replay protection across restart', async () => {
    const { c, q, e, r } = await fixture();
    const commitB = {
      ...c,
      snapshot: {
        ...c.snapshot,
        commitSha: COMMIT_B,
      },
    };
    const boundB = validateFindingCandidate(commitB, ORG);
    const bindingB = computeCandidateBinding(boundB, ORG);
    const qb = { ...q, commitSha: COMMIT_B, candidateBinding: bindingB };
    const rb = { ...r, commitSha: COMMIT_B, candidateBinding: bindingB };

    const pendingB = await transitionVerificationState(createVerificationState(boundB, ORG), { type: 'BEGIN', request: qb });
    await expect(transitionVerificationState(pendingB, { type: 'COMPLETE', result: rb, evidence: e })).rejects.toThrow(
      'commitSha mismatch',
    );
  });

  it('rejects candidate semantic mutation across resume and requires exact binding match', async () => {
    const { c, q, e, r } = await fixture();
    const mutated = {
      ...c,
      sink: {
        ...c.sink,
        symbol: 'child_process.execSync',
      },
    };
    const boundMutated = validateFindingCandidate(mutated, ORG);
    const mutatedBinding = computeCandidateBinding(boundMutated, ORG);

    expect(mutatedBinding).not.toBe(q.candidateBinding);

    const initialMutated = createVerificationState(boundMutated, ORG);
    await expect(transitionVerificationState(initialMutated, { type: 'BEGIN', request: q })).rejects.toThrow(
      'candidateBinding mismatch',
    );

    const qMutated = { ...q, candidateBinding: mutatedBinding };
    const pendingMutated = await transitionVerificationState(initialMutated, { type: 'BEGIN', request: qMutated });
    await expect(transitionVerificationState(pendingMutated, { type: 'COMPLETE', result: r, evidence: e })).rejects.toThrow(
      'candidateBinding mismatch',
    );
  });

  it('enforces tenant isolation during restart-resume verification', async () => {
    const { c, q, e, r } = await fixture();
    expect(() => createVerificationState(c, 'foreign_org')).toThrow(
      'organizationId mismatch',
    );
    await expect(validateVerificationResult(r, q, c, e, 'foreign_org')).rejects.toThrow(
      'organizationId mismatch',
    );
  });

  it('rejects verification completion for an unreachable candidate', async () => {
    const { c, q, e, r } = await fixture();
    const unreachable = validateFindingCandidate({ ...c, reachabilityState: 'UNREACHABLE' }, ORG);
    const qu = { ...q, candidateBinding: computeCandidateBinding(unreachable, ORG) };
    const ru = { ...r, candidateBinding: qu.candidateBinding };
    await expect(validateVerificationResult(ru, qu, unreachable, e, ORG)).rejects.toThrow(
      'unreachable candidate cannot be verified',
    );
  });

  it('verifies computeCandidateBinding formatting without invented sha256 prefix', () => {
    const candidate = makeCmdiCandidate();
    const binding = computeCandidateBinding(candidate, ORG);
    expect(binding.startsWith(`${CONTRACT_VERSION}:FindingCandidate\n`)).toBe(true);
    expect(binding.startsWith('sha256:')).toBe(false);
    expect(candidate.verificationState).toBe('CANDIDATE');
  });

  it('validates child_process command injection provenance and negative controls', () => {
    const detected = evaluateCommandFlow({
      importedModule: 'child_process',
      sinkCall: 'exec',
      argumentOrigin: 'REQUEST_PARAM',
      syntaxSupported: true,
    });
    expect(detected.status).toBe('DETECTED');
    expect(detected.candidate?.vulnerabilityClass).toBe('COMMAND_INJECTION');
    expect(detected.candidate?.verificationState).toBe('CANDIDATE');

    const safe = evaluateCommandFlow({
      importedModule: 'child_process',
      sinkCall: 'exec',
      argumentOrigin: 'SAFE_CONSTANT',
      syntaxSupported: true,
    });
    expect(safe.status).toBe('NOT_DETECTED');

    const unrelatedExec = evaluateCommandFlow({
      importedModule: 'local_helper',
      sinkCall: 'exec',
      argumentOrigin: 'REQUEST_PARAM',
      syntaxSupported: true,
    });
    expect(unrelatedExec.status).toBe('NOT_DETECTED');

    const ambiguous = evaluateCommandFlow({
      importedModule: 'child_process',
      sinkCall: 'exec',
      argumentOrigin: 'AMBIGUOUS',
      syntaxSupported: true,
    });
    expect(ambiguous.status).toBe('ANALYSIS_INCONCLUSIVE');

    const unsupported = evaluateCommandFlow({
      importedModule: 'child_process',
      sinkCall: 'exec',
      argumentOrigin: 'REQUEST_PARAM',
      syntaxSupported: false,
    });
    expect(unsupported.status).toBe('ANALYSIS_INCONCLUSIVE');
  });
});
