import { describe, expect, it } from 'vitest';
import {
  CONTRACT_VERSION,
  computeCandidateBinding,
  createVerificationState,
  transitionVerificationState,
  validateFindingCandidate,
  validateVerificationRequest,
  type FindingCandidate,
  type VerificationRequest,
} from '../../../../worker/intelligence/contracts';
import { captureSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';

const ORG = 'org_cmdi_case_rst';
const COMMIT = 'a'.repeat(40);
const CREATED_AT = '2026-09-04T00:00:00.000Z';

function makeCandidate(overrides: Partial<FindingCandidate> = {}): FindingCandidate {
  const source = { filePath: 'src/routes.ts', symbol: 'req.query.cmd', line: 12, column: 14 };
  const sink = { filePath: 'src/exec.ts', symbol: 'child_process.exec', line: 25, column: 3 };
  const entrypoint = { filePath: 'src/routes.ts', symbol: 'execRoute', line: 10, column: 1 };
  const raw: FindingCandidate = {
    contractVersion: CONTRACT_VERSION,
    organizationId: ORG,
    candidateId: 'candidate-cmdi-case-rst-001',
    snapshot: {
      contractVersion: CONTRACT_VERSION,
      organizationId: ORG,
      snapshotId: 'snap-cmdi-001',
      repositoryId: 'repo-cmdi',
      sourceProvider: 'LOCAL_FIXTURE',
      commitSha: COMMIT,
      ref: 'refs/heads/main',
      createdAt: CREATED_AT,
    },
    vulnerabilityClass: 'COMMAND_INJECTION',
    source,
    sink,
    context: {
      entrypoint,
      routeId: 'route-exec-case-rst',
    },
    sensorEvidence: [{
      contractVersion: CONTRACT_VERSION,
      organizationId: ORG,
      sensorType: 'VELNAR_STRUCTURAL',
      sensorFindingId: 'sensor-finding-cmdi-001',
      ruleId: 'child-process-exec-injection-v1',
      summary: 'Request-derived shell-string flow to child_process.exec.',
      sourceLocation: source,
      sinkLocation: sink,
      rawEvidenceFingerprint: 'sha256:' + 'f'.repeat(64),
    }],
    reachabilityState: 'REACHABLE',
    verificationState: 'CANDIDATE',
    createdAt: CREATED_AT,
    ...overrides,
  };
  return validateFindingCandidate(raw, ORG);
}

function makeRequest(c: FindingCandidate): VerificationRequest {
  const binding = computeCandidateBinding(c, ORG);
  const raw: VerificationRequest = {
    contractVersion: CONTRACT_VERSION,
    requestId: 'req-cmdi-case-rst-001',
    organizationId: ORG,
    candidateId: c.candidateId,
    candidateBinding: binding,
    snapshotId: c.snapshot.snapshotId,
    commitSha: c.snapshot.commitSha,
    vulnerabilityClass: 'COMMAND_INJECTION',
    verificationProfile: { profileId: 'profile-cmdi-isolated', version: 1 },
    environmentRequirements: { environmentType: 'ISOLATED_TEST', runtime: 'NODE', runtimeVersion: '20.0.0' },
    networkPolicy: { mode: 'DEFAULT_DENY', allowedDestinations: [] },
    resourceBudget: { maxCpuMillis: 1000, maxMemoryMb: 512, maxWallTimeMs: 5000, maxNetworkRequests: 0 },
    timeBudgetMs: 5000,
    expectedAssertionType: 'COMMAND_EXECUTION_OBSERVED',
    createdAt: '2026-09-04T00:00:01.000Z',
  };
  return validateVerificationRequest(raw, c, ORG);
}

describe('V1 roadmap: command-injection-detector case-sensitivity restart-resume', () => {
  it('deterministic candidate binding is preserved across restart and state serialization', () => {
    const candidate = makeCandidate();
    const binding = computeCandidateBinding(candidate, ORG);
    const restored = JSON.parse(JSON.stringify(candidate));
    expect(computeCandidateBinding(restored, ORG)).toBe(binding);
    expect(binding.startsWith(CONTRACT_VERSION + ':FindingCandidate\n')).toBe(true);
    expect(binding.startsWith('sha256:')).toBe(false);
  });

  it('candidate verificationState remains strictly CANDIDATE and cannot be created as VERIFIED', () => {
    const candidate = makeCandidate();
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(() => makeCandidate({ verificationState: 'VERIFIED' as any })).toThrow('invalid verificationState');
  });

  it('enforces exact lowercase commitSha and rejects uppercase or all-zero commit identity on resumption', () => {
    const candidate = makeCandidate();
    expect(() => makeCandidate({ snapshot: { ...candidate.snapshot, commitSha: COMMIT.toUpperCase() } })).toThrow('invalid commitSha');
    expect(() => makeCandidate({ snapshot: { ...candidate.snapshot, commitSha: '0'.repeat(40) } })).toThrow('invalid commitSha');
    expect(() => makeCandidate({ snapshot: { ...candidate.snapshot, commitSha: 'not-hex' } })).toThrow('invalid commitSha');
  });

  it('enforces uppercase vulnerabilityClass COMMAND_INJECTION and rejects case-folded variants', () => {
    expect(() => makeCandidate({ vulnerabilityClass: 'command_injection' as any })).toThrow('invalid vulnerabilityClass');
    expect(() => makeCandidate({ vulnerabilityClass: 'Command_Injection' as any })).toThrow('invalid vulnerabilityClass');
  });

  it('preserves strict tenant isolation on restart and rejects mismatched expected organization', () => {
    const candidate = makeCandidate();
    expect(() => computeCandidateBinding(candidate, 'foreign_org')).toThrow('organizationId mismatch');
  });

  it('rejects direct completion on restart and requires explicit pending verification state progression', async () => {
    const candidate = makeCandidate();
    const state = createVerificationState(candidate, ORG);
    expect(state.state).toBe('CANDIDATE');
    await expect(transitionVerificationState(state, { type: 'COMPLETE', result: {} as any, evidence: {} as any }))
      .rejects.toThrow('COMPLETE requires pending verification');

    const request = makeRequest(candidate);
    const pending = await transitionVerificationState(state, { type: 'BEGIN', request });
    expect(pending.state).toBe('PENDING_VERIFICATION');
  });

  it('rejects resumed verification requests when candidate binding or commit does not match', async () => {
    const candidate = makeCandidate();
    const state = createVerificationState(candidate, ORG);
    const request = makeRequest(candidate);
    const tampered = { ...request, candidateBinding: request.candidateBinding + '\n' };
    await expect(transitionVerificationState(state, { type: 'BEGIN', request: tampered }))
      .rejects.toThrow('candidateBinding mismatch');
  });

  it('commit replay across different commit identities produces distinct candidate bindings', () => {
    const candidateA = makeCandidate();
    const commitB = 'b'.repeat(40);
    const candidateB = makeCandidate({ snapshot: { ...candidateA.snapshot, commitSha: commitB } });
    expect(computeCandidateBinding(candidateA, ORG)).not.toBe(computeCandidateBinding(candidateB, ORG));
  });

  it('snapshot ingestion fails closed on duplicate source file paths differing only by case', async () => {
    await expect(captureSnapshot({
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-cmdi',
      organizationId: ORG,
      files: [
        { path: 'src/routes.ts', content: 'export const a = 1;\n' },
        { path: 'src/Routes.ts', content: 'export const b = 2;\n' },
      ],
    }, ORG)).rejects.toThrow('duplicate canonical path');
  });

  it('child_process sink identity is distinct from unrelated local execution symbols', () => {
    const candidateExec = makeCandidate();
    const candidateLocal = makeCandidate({ sink: { ...candidateExec.sink, symbol: 'localHelper' } });
    expect(computeCandidateBinding(candidateExec, ORG)).not.toBe(computeCandidateBinding(candidateLocal, ORG));
  });
});
