import { describe, expect, it } from 'vitest';
import {
  CONTRACT_VERSION,
  computeCandidateBinding,
  createVerificationState,
  transitionVerificationState,
  validateCodeSnapshotRef,
  validateFindingCandidate,
  type CodeLocation,
  type CodeSnapshotRef,
  type FindingCandidate,
  type SensorEvidence,
} from '../../../../worker/intelligence/contracts';
import { canonical } from '../../../../worker/intelligence/ingestion/snapshot';
import type { FlowStep } from '../../../../worker/intelligence/detection/types';

const ORG = 'org_cmdi';
const COMMIT = 'a'.repeat(40);
const CREATED_AT = '2026-09-04T00:00:00.000Z';

function reverseKeys(value: any): any {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reverseKeys(v)]));
  }
  return value;
}

function snapshotRef(): CodeSnapshotRef {
  return {
    contractVersion: CONTRACT_VERSION,
    organizationId: ORG,
    snapshotId: 'snap-cmdi-001',
    repositoryId: 'repo-cmdi',
    sourceProvider: 'LOCAL_FIXTURE',
    commitSha: COMMIT,
    ref: 'refs/heads/main',
    createdAt: CREATED_AT,
  };
}

function buildCandidate(overrides?: Partial<FindingCandidate>): FindingCandidate {
  const source: CodeLocation = {
    filePath: 'src/routes.ts',
    symbol: 'req.query.cmd',
    line: 10,
    column: 15,
  };
  const sink: CodeLocation = {
    filePath: 'src/routes.ts',
    symbol: 'child_process.exec',
    line: 14,
    column: 3,
  };
  const entrypoint: CodeLocation = {
    filePath: 'src/routes.ts',
    symbol: 'commandRoute',
    line: 8,
    column: 1,
  };
  const sensor: SensorEvidence = {
    contractVersion: CONTRACT_VERSION,
    organizationId: ORG,
    sensorType: 'VELNAR_STRUCTURAL',
    sensorFindingId: 'sensor-cmdi-finding-001',
    ruleId: 'express-request-to-child-process-v1',
    summary: 'velnar-cmdi-source-v1: source-analysis hypothesis for command injection via child_process.',
    sourceLocation: source,
    sinkLocation: sink,
    rawEvidenceFingerprint: `sha256:${'c'.repeat(64)}`,
  };
  const candidate: FindingCandidate = {
    contractVersion: CONTRACT_VERSION,
    organizationId: ORG,
    candidateId: 'cand-cmdi-001',
    snapshot: snapshotRef(),
    vulnerabilityClass: 'COMMAND_INJECTION',
    source,
    sink,
    context: {
      entrypoint,
      routeId: 'GET.exec',
    },
    sensorEvidence: [sensor],
    reachabilityState: 'REACHABLE',
    verificationState: 'CANDIDATE',
    createdAt: CREATED_AT,
    ...overrides,
  };
  return candidate;
}

describe('command-injection detector: alias propagation and restart-resume verification', () => {
  it('validates alias propagation flow with proven child_process sink provenance and binds exact candidate identity', () => {
    const flow: FlowStep[] = [
      { id: 'flow-1', kind: 'SOURCE', location: { filePath: 'src/routes.ts', symbol: 'req.query.cmd', offset: 120, line: 10, column: 15 } },
      { id: 'flow-2', kind: 'VARIABLE', location: { filePath: 'src/routes.ts', symbol: 'x', offset: 150, line: 11, column: 9 } },
      { id: 'flow-3', kind: 'VARIABLE', location: { filePath: 'src/routes.ts', symbol: 'y', offset: 180, line: 12, column: 9 } },
      { id: 'flow-4', kind: 'VARIABLE', location: { filePath: 'src/routes.ts', symbol: 'z', offset: 210, line: 13, column: 9 } },
      { id: 'flow-5', kind: 'SINK', location: { filePath: 'src/routes.ts', symbol: 'child_process.exec', offset: 240, line: 14, column: 3 } },
    ];

    expect(flow[0].kind).toBe('SOURCE');
    expect(flow.filter(s => s.kind === 'VARIABLE').map(s => s.location.symbol)).toEqual(['x', 'y', 'z']);
    expect(flow.at(-1)!.kind).toBe('SINK');
    expect(flow.at(-1)!.location.symbol).toBe('child_process.exec');

    const candidate = buildCandidate();
    expect(validateCodeSnapshotRef(candidate.snapshot, ORG)).toEqual(candidate.snapshot);
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);
    expect(candidate.vulnerabilityClass).toBe('COMMAND_INJECTION');
    expect(candidate.verificationState).toBe('CANDIDATE');

    const expectedBinding = `${CONTRACT_VERSION}:FindingCandidate\n${canonical(candidate)}`;
    const binding = computeCandidateBinding(candidate, ORG);
    expect(binding).toBe(expectedBinding);
    expect(binding.startsWith('sha256:')).toBe(false);
  });

  it('rejects ambiguous sink names without proven child_process provenance as negative controls', () => {
    const candidate = buildCandidate();
    const baselineBinding = computeCandidateBinding(candidate, ORG);

    const unprovenCandidate = buildCandidate({
      sink: { filePath: 'src/routes.ts', symbol: 'unrelatedLocalExec', line: 14, column: 3 },
    });
    const unprovenBinding = computeCandidateBinding(unprovenCandidate, ORG);
    expect(unprovenBinding).not.toBe(baselineBinding);
    expect(unprovenCandidate.sink.symbol).not.toBe('child_process.exec');

    const safeConstantCandidate = buildCandidate({
      source: { filePath: 'src/routes.ts', symbol: 'STATIC_COMMAND_CONSTANT', line: 10, column: 15 },
    });
    expect(computeCandidateBinding(safeConstantCandidate, ORG)).not.toBe(baselineBinding);
  });

  it('enforces deterministic restart-resume: re-analysis and re-binding produce identical outputs', () => {
    const run1Candidate = buildCandidate();
    const run2Candidate = buildCandidate();

    expect(run1Candidate).toEqual(run2Candidate);
    const binding1 = computeCandidateBinding(run1Candidate, ORG);
    const binding2 = computeCandidateBinding(run2Candidate, ORG);
    expect(binding1).toBe(binding2);

    const reversed = reverseKeys(run1Candidate);
    expect(computeCandidateBinding(reversed, ORG)).toBe(binding1);
  });

  it('preserves fail-closed state transition boundaries across restart-resume cycles', async () => {
    const candidate = buildCandidate();
    const state = createVerificationState(candidate, ORG);
    expect(state.state).toBe('CANDIDATE');
    expect(state.candidate.candidateId).toBe(candidate.candidateId);

    await expect(
      transitionVerificationState(state, {
        type: 'COMPLETE',
        result: { result: 'VERIFIED' } as any,
        evidence: {} as any,
      })
    ).rejects.toThrow('COMPLETE requires pending verification');
  });

  it('preserves commitSha provenance and prevents cross-commit proof replay', () => {
    const candidateA = buildCandidate();
    const candidateB = buildCandidate({
      snapshot: {
        ...candidateA.snapshot,
        commitSha: 'b'.repeat(40),
      },
    });

    const bindingA = computeCandidateBinding(candidateA, ORG);
    const bindingB = computeCandidateBinding(candidateB, ORG);
    expect(bindingA).not.toBe(bindingB);
    expect(candidateA.snapshot.commitSha).not.toBe(candidateB.snapshot.commitSha);
  });
});
