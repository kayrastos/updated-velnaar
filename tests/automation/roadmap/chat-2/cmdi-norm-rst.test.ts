import { describe, expect, it } from 'vitest';
import {
  ASSERTION_BY_CLASS,
  CONTRACT_VERSION,
  computeCandidateBinding,
  createVerificationState,
  transitionVerificationState,
  validateFindingCandidate,
  validateVerificationRequest,
  type FindingCandidate,
  type VerificationRequest,
} from '../../../../worker/intelligence/contracts';

const ORG = 'org_v1_cmdi';
const COMMIT_SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const SNAPSHOT_CREATED_AT = '2026-09-20T00:00:00.000Z';
const CANDIDATE_CREATED_AT = '2026-09-20T00:01:00.000Z';

function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reverseKeys(v)]));
  }
  return value;
}

function createCommandInjectionCandidate(overrides: Partial<FindingCandidate> = {}): FindingCandidate {
  return {
    contractVersion: CONTRACT_VERSION,
    organizationId: ORG,
    candidateId: 'cmdi-candidate-001',
    snapshot: {
      contractVersion: CONTRACT_VERSION,
      snapshotId: 'snap-cmdi-001',
      organizationId: ORG,
      repositoryId: 'repo-cmdi-001',
      sourceProvider: 'LOCAL_FIXTURE',
      commitSha: COMMIT_SHA,
      ref: 'refs/heads/main',
      createdAt: SNAPSHOT_CREATED_AT,
    },
    vulnerabilityClass: 'COMMAND_INJECTION',
    source: {
      filePath: 'src/routes/exec.ts',
      symbol: 'req.query.cmd',
      line: 12,
      column: 15,
    },
    sink: {
      filePath: 'src/routes/exec.ts',
      symbol: 'child_process.exec',
      line: 18,
      column: 5,
    },
    context: {
      entrypoint: {
        filePath: 'src/routes/exec.ts',
        symbol: 'handleExec',
        line: 10,
        column: 1,
      },
      routeId: 'GET.exec',
    },
    sensorEvidence: [
      {
        contractVersion: CONTRACT_VERSION,
        organizationId: ORG,
        sensorType: 'VELNAR_STRUCTURAL',
        sensorFindingId: 'sensor-cmdi-001',
        ruleId: 'express-request-to-child-process-exec-v1',
        summary: 'Untrusted request parameter flows into child_process.exec sink.',
        sourceLocation: {
          filePath: 'src/routes/exec.ts',
          symbol: 'req.query.cmd',
          line: 12,
          column: 15,
        },
        sinkLocation: {
          filePath: 'src/routes/exec.ts',
          symbol: 'child_process.exec',
          line: 18,
          column: 5,
        },
        rawEvidenceFingerprint: `sha256:${'e'.repeat(64)}`,
      },
    ],
    reachabilityState: 'REACHABLE',
    verificationState: 'CANDIDATE',
    createdAt: CANDIDATE_CREATED_AT,
    ...overrides,
  };
}

function createVerificationRequestFixture(c: FindingCandidate): VerificationRequest {
  const binding = computeCandidateBinding(c, ORG);
  return {
    contractVersion: CONTRACT_VERSION,
    requestId: 'req-cmdi-001',
    organizationId: ORG,
    candidateId: c.candidateId,
    candidateBinding: binding,
    snapshotId: c.snapshot.snapshotId,
    commitSha: c.snapshot.commitSha,
    vulnerabilityClass: 'COMMAND_INJECTION',
    verificationProfile: {
      profileId: 'profile-isolated-node',
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
      maxCpuMillis: 10000,
      maxMemoryMb: 512,
      maxWallTimeMs: 15000,
      maxNetworkRequests: 0,
    },
    timeBudgetMs: 15000,
    expectedAssertionType: ASSERTION_BY_CLASS.COMMAND_INJECTION,
    createdAt: c.createdAt,
  };
}

describe('V1 discovery intelligence: command injection normalization boundary and restart-resume', () => {
  it('validates canonical COMMAND_INJECTION candidate with child_process.exec provenance', () => {
    const candidate = createCommandInjectionCandidate();
    const validated = validateFindingCandidate(candidate, ORG);
    expect(validated.vulnerabilityClass).toBe('COMMAND_INJECTION');
    expect(validated.verificationState).toBe('CANDIDATE');
    expect(validated.sink.symbol).toBe('child_process.exec');
    expect(Object.isFrozen(validated)).toBe(true);
  });

  it('computes candidate binding deterministically without a sha256 prefix across key reordering', () => {
    const candidate = createCommandInjectionCandidate();
    const binding = computeCandidateBinding(candidate, ORG);
    expect(binding.startsWith(`${CONTRACT_VERSION}:FindingCandidate\n`)).toBe(true);
    expect(binding.startsWith('sha256:')).toBe(false);
    expect(computeCandidateBinding(reverseKeys(candidate) as FindingCandidate, ORG)).toBe(binding);
  });

  it('enforces normalization boundary: sensor ordering and optional field presence are not normalized', () => {
    const base = createCommandInjectionCandidate();
    const baseBinding = computeCandidateBinding(base, ORG);

    const withSecondSensor = createCommandInjectionCandidate({
      sensorEvidence: [
        base.sensorEvidence[0],
        {
          ...base.sensorEvidence[0],
          sensorFindingId: 'sensor-cmdi-002',
          rawEvidenceFingerprint: `sha256:${'f'.repeat(64)}`,
        },
      ],
    });
    const bindingTwo = computeCandidateBinding(withSecondSensor, ORG);
    expect(bindingTwo).not.toBe(baseBinding);

    const reversedSensor = createCommandInjectionCandidate({
      sensorEvidence: [withSecondSensor.sensorEvidence[1], withSecondSensor.sensorEvidence[0]],
    });
    expect(computeCandidateBinding(reversedSensor, ORG)).not.toBe(bindingTwo);

    const withoutRouteId = createCommandInjectionCandidate({
      context: { entrypoint: base.context.entrypoint },
    });
    expect(computeCandidateBinding(withoutRouteId, ORG)).not.toBe(baseBinding);
  });

  it('rejects unnormalized or non-canonical commit hashes instead of coercing them', () => {
    expect(() => createCommandInjectionCandidate({
      snapshot: { ...createCommandInjectionCandidate().snapshot, commitSha: 'not-a-sha' },
    })).not.toThrow();

    const badCommit = createCommandInjectionCandidate({
      snapshot: { ...createCommandInjectionCandidate().snapshot, commitSha: 'not-a-sha' },
    });
    expect(() => validateFindingCandidate(badCommit, ORG)).toThrow('invalid commitSha');

    const zeroCommit = createCommandInjectionCandidate({
      snapshot: { ...createCommandInjectionCandidate().snapshot, commitSha: '0'.repeat(40) },
    });
    expect(() => validateFindingCandidate(zeroCommit, ORG)).toThrow('invalid commitSha');
  });

  it('preserves CANDIDATE verificationState and rejects self-promoted VERIFIED claims', () => {
    const candidate = createCommandInjectionCandidate();
    const state = createVerificationState(candidate, ORG);
    expect(state.state).toBe('CANDIDATE');

    const forged = { ...candidate, verificationState: 'VERIFIED' };
    expect(() => validateFindingCandidate(forged, ORG)).toThrow('invalid verificationState');
  });

  it('prohibits direct restart into COMPLETE and enforces BEGIN state transition before completion', async () => {
    const candidate = createCommandInjectionCandidate();
    const state = createVerificationState(candidate, ORG);
    const request = createVerificationRequestFixture(candidate);
    validateVerificationRequest(request, candidate, ORG);

    await expect(
      transitionVerificationState(state, {
        type: 'COMPLETE',
        result: {} as any,
        evidence: {} as any,
      }),
    ).rejects.toThrow('COMPLETE requires pending verification');

    const pending = await transitionVerificationState(state, { type: 'BEGIN', request });
    expect(pending.state).toBe('PENDING_VERIFICATION');
  });

  it('rejects restart-resume with mutated candidateBinding or cross-commit replay', async () => {
    const candidateA = createCommandInjectionCandidate();
    const requestA = createVerificationRequestFixture(candidateA);

    const candidateB = createCommandInjectionCandidate({
      sink: {
        filePath: 'src/routes/exec.ts',
        symbol: 'child_process.execSync',
        line: 25,
        column: 5,
      },
    });
    const bindingB = computeCandidateBinding(candidateB, ORG);
    expect(bindingB).not.toBe(requestA.candidateBinding);

    const stateB = createVerificationState(candidateB, ORG);
    await expect(
      transitionVerificationState(stateB, { type: 'BEGIN', request: requestA }),
    ).rejects.toThrow('candidateBinding mismatch');

    const commitB = 'b'.repeat(40);
    const candidateCrossCommit = createCommandInjectionCandidate({
      snapshot: { ...candidateA.snapshot, commitSha: commitB },
    });
    const bindingCrossCommit = computeCandidateBinding(candidateCrossCommit, ORG);
    const requestRebound = {
      ...requestA,
      commitSha: commitB,
      candidateBinding: bindingCrossCommit,
    };
    const pending = await transitionVerificationState(
      createVerificationState(candidateCrossCommit, ORG),
      { type: 'BEGIN', request: requestRebound },
    );
    expect(pending.state).toBe('PENDING_VERIFICATION');
  });
});
