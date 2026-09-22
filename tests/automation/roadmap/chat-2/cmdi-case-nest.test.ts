import { describe, expect, it } from 'vitest';
import {
  CONTRACT_VERSION,
  VULNERABILITY_CLASSES,
  ASSERTION_BY_CLASS,
  computeCandidateBinding,
  createVerificationState,
  transitionVerificationState,
  validateFindingCandidate,
  type FindingCandidate,
  type CodeSnapshotRef,
} from '../../../../worker/intelligence/contracts';

const ORG = 'org-cmd-case-nest';
const COMMIT_SHA = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';

function createCandidateFixture(overrides: Partial<FindingCandidate> = {}): FindingCandidate {
  const snapshot: CodeSnapshotRef = {
    contractVersion: CONTRACT_VERSION,
    organizationId: ORG,
    snapshotId: 'snap-cmdi-case-001',
    repositoryId: 'repo-discovery-cmd',
    sourceProvider: 'LOCAL_FIXTURE',
    commitSha: COMMIT_SHA,
    ref: 'refs/heads/main',
    createdAt: '2026-09-20T00:00:00.000Z',
  };

  const candidate: FindingCandidate = {
    contractVersion: CONTRACT_VERSION,
    candidateId: 'cand-cmdi-case-nest-001',
    organizationId: ORG,
    snapshot,
    vulnerabilityClass: 'COMMAND_INJECTION',
    source: {
      filePath: 'src/routes.ts',
      symbol: 'query.cmd',
      line: 12,
      column: 16,
    },
    sink: {
      filePath: 'src/routes.ts',
      symbol: 'child_process.exec',
      line: 24,
      column: 7,
    },
    context: {
      entrypoint: {
        filePath: 'src/routes.ts',
        symbol: 'searchRoute',
        line: 10,
        column: 1,
      },
      routeId: 'GET.api.search',
    },
    sensorEvidence: [
      {
        contractVersion: CONTRACT_VERSION,
        organizationId: ORG,
        sensorType: 'VELNAR_STRUCTURAL',
        sensorFindingId: 'sensor-finding-cmdi-001',
        ruleId: 'express-request-to-child-process-exec-v1',
        summary: 'Untrusted query parameter flows into nested child_process.exec invocation.',
        sourceLocation: {
          filePath: 'src/routes.ts',
          symbol: 'query.cmd',
          line: 12,
          column: 16,
        },
        sinkLocation: {
          filePath: 'src/routes.ts',
          symbol: 'child_process.exec',
          line: 24,
          column: 7,
        },
        rawEvidenceFingerprint: 'sha256:' + 'e'.repeat(64),
      },
    ],
    reachabilityState: 'REACHABLE',
    verificationState: 'CANDIDATE',
    createdAt: '2026-09-20T00:00:01.000Z',
    ...overrides,
  };

  return validateFindingCandidate(candidate, ORG);
}

describe('Roadmap Chat-2: COMMAND_INJECTION detector case-sensitivity and nested scope validation', () => {
  it('adheres to locked V1 COMMAND_INJECTION class and observation assertion mapping', () => {
    expect(VULNERABILITY_CLASSES).toContain('COMMAND_INJECTION');
    expect(ASSERTION_BY_CLASS.COMMAND_INJECTION).toBe('COMMAND_EXECUTION_OBSERVED');
    const candidate = createCandidateFixture();
    expect(candidate.vulnerabilityClass).toBe('COMMAND_INJECTION');
    expect(candidate.verificationState).toBe('CANDIDATE');
  });

  it('computes canonical complete FindingCandidate binding without sha256 prefix', () => {
    const candidate = createCandidateFixture();
    const binding = computeCandidateBinding(candidate, ORG);
    expect(binding.startsWith(`${CONTRACT_VERSION}:FindingCandidate\n`)).toBe(true);
    expect(binding.startsWith('sha256:')).toBe(false);
  });

  it('differentiates case sensitivity in nested source parameters for candidate semantic binding', () => {
    const candidateLower = createCandidateFixture();
    const candidateUpper = createCandidateFixture({
      source: { filePath: 'src/routes.ts', symbol: 'query.CMD', line: 12, column: 16 },
      sensorEvidence: [{
        ...candidateLower.sensorEvidence[0],
        sourceLocation: { filePath: 'src/routes.ts', symbol: 'query.CMD', line: 12, column: 16 },
      }],
    });
    expect(candidateLower.candidateId).toBe(candidateUpper.candidateId);
    expect(computeCandidateBinding(candidateLower, ORG)).not.toBe(computeCandidateBinding(candidateUpper, ORG));
  });

  it('enforces case sensitivity for proven child_process sink provenance in nested execution contexts', () => {
    const provenSinkCandidate = createCandidateFixture();
    const unprovenCaseCandidate = createCandidateFixture({
      sink: { filePath: 'src/routes.ts', symbol: 'child_process.EXEC', line: 24, column: 7 },
      sensorEvidence: [{
        ...provenSinkCandidate.sensorEvidence[0],
        sinkLocation: { filePath: 'src/routes.ts', symbol: 'child_process.EXEC', line: 24, column: 7 },
      }],
    });
    expect(computeCandidateBinding(provenSinkCandidate, ORG)).not.toBe(computeCandidateBinding(unprovenCaseCandidate, ORG));
  });

  it('binds nested entrypoint and route context without loss of structural identity', () => {
    const directCandidate = createCandidateFixture();
    const nestedHelperCandidate = createCandidateFixture({
      context: {
        entrypoint: { filePath: 'src/routes.ts', symbol: 'nestedCommandHandler', line: 15, column: 3 },
        routeId: 'GET.api.search',
      },
    });
    expect(computeCandidateBinding(directCandidate, ORG)).not.toBe(computeCandidateBinding(nestedHelperCandidate, ORG));
  });

  it('fails closed on unproven all-zero commit SHA in code snapshot ref', () => {
    expect(() => createCandidateFixture({
      snapshot: {
        contractVersion: CONTRACT_VERSION,
        organizationId: ORG,
        snapshotId: 'snap-cmdi-case-001',
        repositoryId: 'repo-discovery-cmd',
        sourceProvider: 'LOCAL_FIXTURE',
        commitSha: '0'.repeat(40),
        ref: 'refs/heads/main',
        createdAt: '2026-09-20T00:00:00.000Z',
      },
    })).toThrow('invalid commitSha');
  });

  it('retains CANDIDATE verification state and rejects direct completion without verification transition', async () => {
    const candidate = createCandidateFixture();
    const state = createVerificationState(candidate, ORG);
    expect(state.state).toBe('CANDIDATE');
    await expect(transitionVerificationState(state, {
      type: 'COMPLETE',
      result: { result: 'VERIFIED' } as any,
      evidence: {} as any,
    })).rejects.toThrow('COMPLETE requires pending verification');
  });

  it('enforces tenant isolation preventing foreign organization binding computation', () => {
    const candidate = createCandidateFixture();
    expect(() => computeCandidateBinding(candidate, 'org-foreign-tenant')).toThrow('organizationId mismatch');
  });
});
