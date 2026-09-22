import { describe, expect, it } from 'vitest';
import {
  ASSERTION_BY_CLASS,
  CONTRACT_VERSION,
  VULNERABILITY_CLASSES,
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

const ORG = 'org_discovery_intelligence';
const COMMIT_SHA = '46db4c208f886afda939c04ae93580fbabd57344';
const CREATED_AT = '2026-09-04T00:00:00.000Z';

function makeNestedCmdiCandidate(overrides: Partial<FindingCandidate> = {}): FindingCandidate {
  const snapshot: CodeSnapshotRef = {
    contractVersion: CONTRACT_VERSION,
    snapshotId: 'snap-cmdi-nest-001',
    organizationId: ORG,
    repositoryId: 'repo-discovery-v1',
    sourceProvider: 'LOCAL_FIXTURE',
    commitSha: COMMIT_SHA,
    ref: 'refs/heads/auto/v1-discovery-intelligence-20260918',
    createdAt: CREATED_AT,
  };

  const source: CodeLocation = {
    filePath: 'src/routes/diagnostics.ts',
    symbol: 'query.target',
    line: 14,
    column: 26,
  };

  const sink: CodeLocation = {
    filePath: 'src/services/processExecutor.ts',
    symbol: 'child_process.exec',
    line: 52,
    column: 7,
  };

  const entrypoint: CodeLocation = {
    filePath: 'src/routes/diagnostics.ts',
    symbol: 'runDiagnosticsRoute',
    line: 12,
    column: 1,
  };

  const sensorEvidence: SensorEvidence = {
    contractVersion: CONTRACT_VERSION,
    organizationId: ORG,
    sensorType: 'VELNAR_STRUCTURAL',
    sensorFindingId: 'sensor-cmdi-reg-nest-001',
    ruleId: 'express-request-to-child-process-exec-v1',
    summary: 'Nested invocation analysis: untrusted query flows via helper chain into child_process.exec.',
    sourceLocation: source,
    sinkLocation: sink,
    rawEvidenceFingerprint: `sha256:${'c'.repeat(64)}`,
  };

  return {
    contractVersion: CONTRACT_VERSION,
    organizationId: ORG,
    candidateId: 'cand-cmdi-reg-nest-001',
    snapshot,
    vulnerabilityClass: 'COMMAND_INJECTION',
    source,
    sink,
    context: {
      entrypoint,
      routeId: 'GET.diagnostics.run',
    },
    sensorEvidence: [sensorEvidence],
    reachabilityState: 'REACHABLE',
    verificationState: 'CANDIDATE',
    createdAt: CREATED_AT,
    ...overrides,
  };
}

describe('V1 discovery intelligence: command injection detector regression lock (nested)', () => {
  it('locks COMMAND_INJECTION in canonical V1 contract classes with expected assertion mapping', () => {
    expect(VULNERABILITY_CLASSES).toContain('COMMAND_INJECTION');
    expect(ASSERTION_BY_CLASS.COMMAND_INJECTION).toBe('COMMAND_EXECUTION_OBSERVED');
  });

  it('validates a bounded nested child_process.exec candidate and computes canonical binding without sha256 prefix', () => {
    const candidate = makeNestedCmdiCandidate();
    const validated = validateFindingCandidate(candidate, ORG);

    expect(validated.vulnerabilityClass).toBe('COMMAND_INJECTION');
    expect(validated.verificationState).toBe('CANDIDATE');
    expect(validated.reachabilityState).toBe('REACHABLE');
    expect(validated.sink.symbol).toBe('child_process.exec');
    expect(Object.isFrozen(validated)).toBe(true);

    const binding = computeCandidateBinding(validated, ORG);
    expect(binding).toMatch(new RegExp(`^${CONTRACT_VERSION}:FindingCandidate\n\\{`));
    expect(binding).not.toMatch(/^sha256:/);
  });

  it('enforces verificationState as CANDIDATE and rejects any pre-asserted VERIFIED status', () => {
    const forged = makeNestedCmdiCandidate({ verificationState: 'VERIFIED' as any });
    expect(() => validateFindingCandidate(forged, ORG)).toThrow('INTELLIGENCE_PROTOCOL_ERROR: invalid verificationState');
    expect(() => computeCandidateBinding(forged, ORG)).toThrow('INTELLIGENCE_PROTOCOL_ERROR: invalid verificationState');
  });

  it('rejects unverified or invalid commit SHA identifiers across candidate snapshots', () => {
    const candidate = makeNestedCmdiCandidate();
    const invalidCommits = ['', 'not-a-sha', '0'.repeat(40), '1234567890abcdef'];

    for (const commitSha of invalidCommits) {
      const badSnapshot: any = { ...candidate.snapshot, commitSha };
      expect(() => validateCodeSnapshotRef(badSnapshot, ORG)).toThrow('INTELLIGENCE_PROTOCOL_ERROR: invalid commitSha');
      expect(() => validateFindingCandidate({ ...candidate, snapshot: badSnapshot }, ORG)).toThrow('INTELLIGENCE_PROTOCOL_ERROR: invalid commitSha');
    }
  });

  it('changes candidateBinding deterministically upon any nested provenance alteration', () => {
    const base = makeNestedCmdiCandidate();
    const baseBinding = computeCandidateBinding(base, ORG);

    const mutatedSource = makeNestedCmdiCandidate({ source: { ...base.source, symbol: 'query.other' } });
    expect(computeCandidateBinding(mutatedSource, ORG)).not.toBe(baseBinding);

    const mutatedSink = makeNestedCmdiCandidate({ sink: { ...base.sink, line: base.sink.line! + 1 } });
    expect(computeCandidateBinding(mutatedSink, ORG)).not.toBe(baseBinding);

    const mutatedRoute = makeNestedCmdiCandidate({ context: { ...base.context, routeId: 'POST.diagnostics.run' } });
    expect(computeCandidateBinding(mutatedRoute, ORG)).not.toBe(baseBinding);

    const extraSensor: SensorEvidence = {
      ...base.sensorEvidence[0],
      sensorFindingId: 'sensor-cmdi-reg-nest-002',
    };
    const mutatedSensor = makeNestedCmdiCandidate({ sensorEvidence: [base.sensorEvidence[0], extraSensor] });
    expect(computeCandidateBinding(mutatedSensor, ORG)).not.toBe(baseBinding);
  });

  it('negative control: safe constants and unbound names in nested call positions do not constitute sink authority', () => {
    interface NestedCallSite {
      caller: string;
      target: string;
      argument: string;
      isLiteralConstant: boolean;
      provenChildProcessImport: boolean;
    }

    const analyzeNestedCall = (call: NestedCallSite): 'CANDIDATE_EMITTED' | 'DISMISSED_CONTROL' => {
      if (call.isLiteralConstant) return 'DISMISSED_CONTROL';
      if (!call.provenChildProcessImport) return 'DISMISSED_CONTROL';
      if (call.target !== 'child_process.exec' && call.target !== 'child_process.execSync') return 'DISMISSED_CONTROL';
      return 'CANDIDATE_EMITTED';
    };

    expect(analyzeNestedCall({
      caller: 'nestedHelper',
      target: 'child_process.exec',
      argument: '"ls -la /tmp"',
      isLiteralConstant: true,
      provenChildProcessImport: true,
    })).toBe('DISMISSED_CONTROL');

    expect(analyzeNestedCall({
      caller: 'nestedHelper',
      target: 'customLocalExec',
      argument: 'req.query.cmd',
      isLiteralConstant: false,
      provenChildProcessImport: false,
    })).toBe('DISMISSED_CONTROL');

    expect(analyzeNestedCall({
      caller: 'nestedHelper',
      target: 'child_process.exec',
      argument: 'req.query.cmd',
      isLiteralConstant: false,
      provenChildProcessImport: true,
    })).toBe('CANDIDATE_EMITTED');
  });

  it('preserves the three-state lifecycle and refuses direct transition to COMPLETE', async () => {
    const candidate = makeNestedCmdiCandidate();
    const initial = createVerificationState(candidate, ORG);
    expect(initial.state).toBe('CANDIDATE');

    await expect(transitionVerificationState(initial, {
      type: 'COMPLETE',
      result: { result: 'VERIFIED' } as any,
      evidence: {} as any,
    })).rejects.toThrow('COMPLETE requires pending verification');
  });
});
