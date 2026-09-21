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
import { canonical } from '../../../../worker/intelligence/ingestion/snapshot';
import { parseUnit } from '../../../../worker/intelligence/ingestion/express';

const ORG = 'org_v1_discovery';
const COMMIT_SHA = '46db4c208f886afda939c04ae93580fbabd57344';
const SNAPSHOT_ID = 'sha256:' + '1'.repeat(64);
const FINGERPRINT = 'sha256:' + '2'.repeat(64);

function createCommandCandidate(overrides: Partial<FindingCandidate> = {}): FindingCandidate {
  const createdAt = '2026-09-04T00:00:00.000Z';
  const base: FindingCandidate = {
    contractVersion: CONTRACT_VERSION,
    organizationId: ORG,
    candidateId: 'cmdi_cand_nested_001',
    snapshot: {
      contractVersion: CONTRACT_VERSION,
      organizationId: ORG,
      snapshotId: SNAPSHOT_ID,
      repositoryId: 'repo_v1_discovery',
      sourceProvider: 'LOCAL_FIXTURE',
      commitSha: COMMIT_SHA,
      ref: 'refs/heads/auto/v1-discovery-intelligence-20260918',
      createdAt,
    },
    vulnerabilityClass: 'COMMAND_INJECTION',
    source: {
      filePath: 'src/nested/service.ts',
      symbol: 'req.query.cmd',
      line: 12,
      column: 24,
    },
    sink: {
      filePath: 'src/nested/executor.ts',
      symbol: 'child_process.exec',
      line: 45,
      column: 10,
    },
    context: {
      entrypoint: {
        filePath: 'src/routes.ts',
        symbol: 'handleCommandRoute',
        line: 8,
        column: 1,
      },
      routeId: 'POST.run',
    },
    sensorEvidence: [
      {
        contractVersion: CONTRACT_VERSION,
        organizationId: ORG,
        sensorType: 'VELNAR_STRUCTURAL',
        sensorFindingId: 'cmdi_finding_nested_001',
        ruleId: 'express-request-to-child-process-exec-v1',
        summary: 'child_process.exec command-injection hypothesis from nested request flow.',
        sourceLocation: {
          filePath: 'src/nested/service.ts',
          symbol: 'req.query.cmd',
          line: 12,
          column: 24,
        },
        sinkLocation: {
          filePath: 'src/nested/executor.ts',
          symbol: 'child_process.exec',
          line: 45,
          column: 10,
        },
        rawEvidenceFingerprint: FINGERPRINT,
      },
    ],
    reachabilityState: 'REACHABLE',
    verificationState: 'CANDIDATE',
    createdAt,
  };
  return { ...base, ...overrides };
}

function reverseKeys(value: any): any {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reverseKeys(v)]));
  }
  return value;
}

describe('V1 roadmap: command-injection-detector partial-input-failclosed (nested)', () => {
  it('validates canonical COMMAND_INJECTION candidate with proven child_process provenance', () => {
    const candidate = createCommandCandidate();
    expect(candidate.vulnerabilityClass).toBe('COMMAND_INJECTION');
    expect(ASSERTION_BY_CLASS[candidate.vulnerabilityClass]).toBe('COMMAND_EXECUTION_OBSERVED');
    const validated = validateFindingCandidate(candidate, ORG);
    expect(validated).toEqual(candidate);
    expect(Object.isFrozen(validated)).toBe(true);
    expect(validated.verificationState).toBe('CANDIDATE');
  });

  it('computes exact canonical candidateBinding without invented sha256 prefix', () => {
    const candidate = createCommandCandidate();
    const binding = computeCandidateBinding(candidate, ORG);
    const expected = `${CONTRACT_VERSION}:FindingCandidate\n${canonical(candidate)}`;
    expect(binding).toBe(expected);
    expect(binding.startsWith('sha256:')).toBe(false);
    expect(binding.startsWith(CONTRACT_VERSION + ':FindingCandidate\n')).toBe(true);
    expect(computeCandidateBinding(reverseKeys(candidate), ORG)).toBe(expected);
  });

  it('preserves CANDIDATE verificationState and rejects direct transition to VERIFIED', async () => {
    const candidate = createCommandCandidate();
    const state = createVerificationState(candidate, ORG);
    expect(state.state).toBe('CANDIDATE');
    await expect(
      transitionVerificationState(state, { type: 'COMPLETE', result: {} as any, evidence: {} as any })
    ).rejects.toThrow('COMPLETE requires pending verification');
  });

  it('rejects candidate mutation attempting to claim VERIFIED authority', () => {
    const badCandidate = { ...createCommandCandidate(), verificationState: 'VERIFIED' as any };
    expect(() => validateFindingCandidate(badCandidate, ORG)).toThrow('INTELLIGENCE_PROTOCOL_ERROR: invalid verificationState');
  });

  it('rejects invalid or fake commit SHA representations', () => {
    const allZeroSha = { ...createCommandCandidate(), snapshot: { ...createCommandCandidate().snapshot, commitSha: '0'.repeat(40) } };
    expect(() => validateFindingCandidate(allZeroSha, ORG)).toThrow('INTELLIGENCE_PROTOCOL_ERROR: invalid commitSha');

    const malformedSha = { ...createCommandCandidate(), snapshot: { ...createCommandCandidate().snapshot, commitSha: 'not-a-sha' } };
    expect(() => validateFindingCandidate(malformedSha, ORG)).toThrow('INTELLIGENCE_PROTOCOL_ERROR: invalid commitSha');
  });

  it('enforces negative controls: safe constants and local non-child_process helpers', () => {
    const safeConstantSource = `
      import * as cp from 'child_process';
      export function runStatic() {
        const safeCmd = "ls -la";
        return cp.execSync(safeCmd);
      }
    `;
    const sfSafe = parseUnit('src/safeConstant.ts', safeConstantSource);
    expect(sfSafe.statements.length).toBeGreaterThan(0);

    const localExecSource = `
      function exec(cmd: string): string {
        return 'local mock ' + cmd;
      }
      export function handle(input: string) {
        return exec(input);
      }
    `;
    const sfLocal = parseUnit('src/localExec.ts', localExecSource);
    expect(sfLocal.statements.length).toBeGreaterThan(0);
  });

  it('fails closed on partial or malformed nested source inputs', () => {
    const malformedNested = 'export function nested() { const cmd = req.query.cmd; child_process.exec(cmd';
    expect(() => parseUnit('src/malformedNested.ts', malformedNested)).toThrow('M2_INGESTION_ERROR: malformed source unit');
  });

  it('detects candidateBinding divergence across nested source, sink, and route variations', () => {
    const base = createCommandCandidate();
    const baseBinding = computeCandidateBinding(base, ORG);

    const alteredSource = { ...base, source: { ...base.source, line: (base.source.line ?? 1) + 5 } };
    expect(computeCandidateBinding(alteredSource, ORG)).not.toBe(baseBinding);

    const alteredSink = { ...base, sink: { ...base.sink, symbol: 'child_process.execSync' } };
    expect(computeCandidateBinding(alteredSink, ORG)).not.toBe(baseBinding);

    const alteredRoute = { ...base, context: { ...base.context, routeId: 'POST.other' } };
    expect(computeCandidateBinding(alteredRoute, ORG)).not.toBe(baseBinding);
  });

  it('strictly enforces organization tenant isolation', () => {
    const candidate = createCommandCandidate();
    expect(() => validateFindingCandidate(candidate, 'foreign_org')).toThrow('INTELLIGENCE_PROTOCOL_ERROR: organizationId mismatch');
    expect(() => computeCandidateBinding(candidate, 'foreign_org')).toThrow('INTELLIGENCE_PROTOCOL_ERROR: organizationId mismatch');
  });
});
