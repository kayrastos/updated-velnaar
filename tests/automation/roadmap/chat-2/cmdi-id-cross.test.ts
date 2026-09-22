import { describe, expect, it } from 'vitest';
import {
  ASSERTION_BY_CLASS,
  CONTRACT_VERSION,
  computeCandidateBinding,
  createVerificationState,
  transitionVerificationState,
  validateFindingCandidate,
  type FindingCandidate,
} from '../../../../worker/intelligence/contracts';

const ORG = 'org_velnar_cmdi';
const COMMIT_SHA = '46db4c208f886afda939c04ae93580fbabd57344';
const ERROR_PREFIX = 'INTELLIGENCE_PROTOCOL_ERROR:';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object' && value !== null) {
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical((value as Record<string, unknown>)[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function reverseKeys(value: any): any {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reverseKeys(v)]));
  }
  return value;
}

function crossCandidate(): FindingCandidate {
  return {
    contractVersion: CONTRACT_VERSION,
    organizationId: ORG,
    candidateId: 'cand_cmdi_cross_001',
    snapshot: {
      contractVersion: CONTRACT_VERSION,
      organizationId: ORG,
      snapshotId: 'snap_cmdi_cross_001',
      repositoryId: 'repo_discovery_cmdi',
      sourceProvider: 'LOCAL_FIXTURE',
      commitSha: COMMIT_SHA,
      ref: 'refs/heads/auto/v1-discovery-intelligence-20260918',
      createdAt: '2026-09-20T00:00:00.000Z',
    },
    vulnerabilityClass: 'COMMAND_INJECTION',
    source: {
      filePath: 'src/routes/command.ts',
      symbol: 'req.query.cmd',
      semanticId: 'src.routes.command.query.cmd',
      line: 14,
      column: 19,
    },
    sink: {
      filePath: 'src/services/executor.ts',
      symbol: 'child_process.exec',
      semanticId: 'src.services.executor.child_process.exec',
      line: 42,
      column: 5,
    },
    context: {
      entrypoint: {
        filePath: 'src/routes/command.ts',
        symbol: 'commandHandler',
        line: 12,
        column: 1,
      },
      routeId: 'POST.api.exec',
    },
    sensorEvidence: [
      {
        contractVersion: CONTRACT_VERSION,
        organizationId: ORG,
        sensorType: 'VELNAR_STRUCTURAL',
        sensorFindingId: 'sensor_cmdi_cross_001',
        ruleId: 'express-request-to-child-process-exec-v1',
        summary: 'VELNAR_STRUCTURAL: Request-derived command flow to child_process.exec across modules.',
        sourceLocation: {
          filePath: 'src/routes/command.ts',
          symbol: 'req.query.cmd',
          line: 14,
          column: 19,
        },
        sinkLocation: {
          filePath: 'src/services/executor.ts',
          symbol: 'child_process.exec',
          line: 42,
          column: 5,
        },
        rawEvidenceFingerprint: 'sha256:' + 'a'.repeat(64),
      },
    ],
    reachabilityState: 'REACHABLE',
    verificationState: 'CANDIDATE',
    createdAt: '2026-09-20T01:00:00.000Z',
  };
}

describe('cross-file command injection candidate identity stability', () => {
  it('verifies cross-file source and sink boundaries exist', () => {
    const c = crossCandidate();
    expect(c.source.filePath).toBe('src/routes/command.ts');
    expect(c.sink.filePath).toBe('src/services/executor.ts');
    expect(c.source.filePath).not.toBe(c.sink.filePath);
    expect(c.vulnerabilityClass).toBe('COMMAND_INJECTION');
    expect(c.verificationState).toBe('CANDIDATE');
    expect(ASSERTION_BY_CLASS[c.vulnerabilityClass]).toBe('COMMAND_EXECUTION_OBSERVED');
  });

  it('computes deterministic canonical candidate binding without sha256 prefix', () => {
    const c = crossCandidate();
    const validated = validateFindingCandidate(c, ORG);
    expect(validated).toEqual(c);
    expect(Object.isFrozen(validated)).toBe(true);
    expect(Object.isFrozen(validated.source)).toBe(true);
    expect(Object.isFrozen(validated.sink)).toBe(true);
    expect(Object.isFrozen(validated.sensorEvidence[0])).toBe(true);

    const binding = computeCandidateBinding(c, ORG);
    const expected = `${CONTRACT_VERSION}:FindingCandidate\n${canonical(c)}`;
    expect(binding).toBe(expected);
    expect(binding.startsWith('sha256:')).toBe(false);
    expect(binding.startsWith(`${CONTRACT_VERSION}:FindingCandidate\n{`)).toBe(true);
    expect(computeCandidateBinding(reverseKeys(c), ORG)).toBe(expected);
    expect(computeCandidateBinding(c, ORG)).toBe(binding);
  });

  it('differentiates candidate identity when cross-file source location changes', () => {
    const base = crossCandidate();
    const baseBinding = computeCandidateBinding(base, ORG);

    const changedPath = { ...base, source: { ...base.source, filePath: 'src/routes/admin.ts' } };
    expect(computeCandidateBinding(changedPath, ORG)).not.toBe(baseBinding);

    const changedSymbol = { ...base, source: { ...base.source, symbol: 'req.body.command' } };
    expect(computeCandidateBinding(changedSymbol, ORG)).not.toBe(baseBinding);

    const changedLine = { ...base, source: { ...base.source, line: base.source.line! + 1 } };
    expect(computeCandidateBinding(changedLine, ORG)).not.toBe(baseBinding);

    const changedColumn = { ...base, source: { ...base.source, column: base.source.column! + 1 } };
    expect(computeCandidateBinding(changedColumn, ORG)).not.toBe(baseBinding);
  });

  it('differentiates candidate identity when cross-file sink location changes', () => {
    const base = crossCandidate();
    const baseBinding = computeCandidateBinding(base, ORG);

    const changedSinkPath = { ...base, sink: { ...base.sink, filePath: 'src/services/nativeRunner.ts' } };
    expect(computeCandidateBinding(changedSinkPath, ORG)).not.toBe(baseBinding);

    const changedSinkSymbol = { ...base, sink: { ...base.sink, symbol: 'child_process.execSync' } };
    expect(computeCandidateBinding(changedSinkSymbol, ORG)).not.toBe(baseBinding);

    const changedSinkLine = { ...base, sink: { ...base.sink, line: base.sink.line! + 2 } };
    expect(computeCandidateBinding(changedSinkLine, ORG)).not.toBe(baseBinding);

    const changedSinkColumn = { ...base, sink: { ...base.sink, column: base.sink.column! + 2 } };
    expect(computeCandidateBinding(changedSinkColumn, ORG)).not.toBe(baseBinding);
  });

  it('differentiates candidate identity on route context and sensor evidence mutations', () => {
    const base = crossCandidate();
    const baseBinding = computeCandidateBinding(base, ORG);

    const changedRoute = { ...base, context: { ...base.context, routeId: 'POST.api.other' } };
    expect(computeCandidateBinding(changedRoute, ORG)).not.toBe(baseBinding);

    const changedEntry = { ...base, context: { ...base.context, entrypoint: { ...base.context.entrypoint, symbol: 'altHandler' } } };
    expect(computeCandidateBinding(changedEntry, ORG)).not.toBe(baseBinding);

    const changedSensor = { ...base, sensorEvidence: [{ ...base.sensorEvidence[0], ruleId: 'other-cmdi-rule-v2' }] };
    expect(computeCandidateBinding(changedSensor, ORG)).not.toBe(baseBinding);

    const changedFingerprint = { ...base, sensorEvidence: [{ ...base.sensorEvidence[0], rawEvidenceFingerprint: 'sha256:' + 'b'.repeat(64) }] };
    expect(computeCandidateBinding(changedFingerprint, ORG)).not.toBe(baseBinding);
  });

  it('differentiates candidate identity on snapshot commit and provenance mutations', () => {
    const base = crossCandidate();
    const baseBinding = computeCandidateBinding(base, ORG);

    const changedCommit = { ...base, snapshot: { ...base.snapshot, commitSha: 'b'.repeat(40) } };
    expect(computeCandidateBinding(changedCommit, ORG)).not.toBe(baseBinding);

    const changedReachability = { ...base, reachabilityState: 'INCONCLUSIVE' as const };
    expect(computeCandidateBinding(changedReachability, ORG)).not.toBe(baseBinding);
  });

  it('strictly rejects non-CANDIDATE verification state and direct completion', async () => {
    const c = crossCandidate();
    expect(() => computeCandidateBinding({ ...c, verificationState: 'VERIFIED' as any }, ORG)).toThrow(ERROR_PREFIX);
    expect(() => validateFindingCandidate({ ...c, verificationState: 'VERIFIED' as any }, ORG)).toThrow(ERROR_PREFIX);

    const initial = createVerificationState(c, ORG);
    expect(initial.state).toBe('CANDIDATE');
    await expect(
      transitionVerificationState(initial, { type: 'COMPLETE', result: {} as any, evidence: {} as any })
    ).rejects.toThrow('COMPLETE requires pending verification');
  });

  it('enforces tenant isolation and rejects mismatched organization identity', () => {
    const c = crossCandidate();
    expect(() => computeCandidateBinding(c, 'org_foreign')).toThrow(ERROR_PREFIX);
    expect(() => validateFindingCandidate(c, 'org_foreign')).toThrow(ERROR_PREFIX);
  });
});
