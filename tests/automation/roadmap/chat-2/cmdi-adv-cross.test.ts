import { describe, expect, it } from 'vitest';
import {
  ASSERTION_BY_CLASS,
  CONTRACT_VERSION,
  computeCandidateBinding,
  createVerificationState,
  transitionVerificationState,
  validateCodeSnapshotRef,
  validateFindingCandidate,
  validateVerificationRequest,
  type CodeSnapshotRef,
  type FindingCandidate,
  type VerificationRequest,
} from '../../../../worker/intelligence/contracts';
import {
  captureSnapshot,
  type SnapshotInput,
} from '../../../../worker/intelligence/ingestion/snapshot';
import {
  ingestExpress,
  resolveImport,
} from '../../../../worker/intelligence/ingestion/express';

const ORG = 'org_cmdi_adv_cross';
const VALID_COMMIT = 'e4d909c290d0fb1ca068ffaddf22cbd0adddefec';
const VALID_COMMIT_64 = 'a'.repeat(64);

function makeCandidate(overrides: Partial<FindingCandidate> = {}): FindingCandidate {
  const createdAt = '2026-09-20T12:00:00.000Z';
  const snapshot: CodeSnapshotRef = {
    contractVersion: CONTRACT_VERSION,
    snapshotId: 'snap_cmdi_001',
    organizationId: ORG,
    repositoryId: 'repo_cmdi',
    sourceProvider: 'LOCAL_FIXTURE',
    commitSha: VALID_COMMIT,
    ref: 'refs/heads/main',
    createdAt,
  };
  const source = {
    filePath: 'src/routes.ts',
    symbol: 'req.query.cmd',
    line: 12,
    column: 25,
  };
  const sink = {
    filePath: 'src/executor.ts',
    symbol: 'child_process.exec',
    line: 8,
    column: 3,
  };
  const entrypoint = {
    filePath: 'src/routes.ts',
    symbol: 'runRoute',
    line: 10,
    column: 1,
  };
  return {
    contractVersion: CONTRACT_VERSION,
    candidateId: 'cand_cmdi_cross_001',
    organizationId: ORG,
    snapshot,
    vulnerabilityClass: 'COMMAND_INJECTION',
    source,
    sink,
    context: {
      entrypoint,
      routeId: 'GET_run',
    },
    sensorEvidence: [
      {
        contractVersion: CONTRACT_VERSION,
        organizationId: ORG,
        sensorType: 'VELNAR_STRUCTURAL',
        sensorFindingId: 'sensor_cmdi_001',
        ruleId: 'express-request-to-child-process-v1',
        summary: 'Cross-file request flow reaching child_process.exec sink.',
        sourceLocation: source,
        sinkLocation: sink,
        rawEvidenceFingerprint: 'sha256:' + 'b'.repeat(64),
      },
    ],
    reachabilityState: 'REACHABLE',
    verificationState: 'CANDIDATE',
    createdAt,
    ...overrides,
  };
}

describe('command injection detector cross-file adversarial edge cases', () => {
  it('validates a well-formed cross-file COMMAND_INJECTION candidate hypothesis', () => {
    const cand = makeCandidate();
    const validated = validateFindingCandidate(cand, ORG);
    expect(validated.vulnerabilityClass).toBe('COMMAND_INJECTION');
    expect(validated.verificationState).toBe('CANDIDATE');
    expect(validated.source.filePath).toBe('src/routes.ts');
    expect(validated.sink.filePath).toBe('src/executor.ts');
    expect(validated.sink.symbol).toBe('child_process.exec');
    expect(Object.isFrozen(validated)).toBe(true);
  });

  it('enforces that computeCandidateBinding preserves canonical complete candidate text without invented sha256: prefix', () => {
    const cand = makeCandidate();
    const binding = computeCandidateBinding(cand, ORG);
    expect(binding.startsWith(`${CONTRACT_VERSION}:FindingCandidate\n`)).toBe(true);
    expect(binding.startsWith('sha256:')).toBe(false);
    expect(binding).toContain('"vulnerabilityClass":"COMMAND_INJECTION"');
  });

  it('rejects candidate with non-CANDIDATE verificationState at boundary', () => {
    const cand = makeCandidate({ verificationState: 'VERIFIED' as any });
    expect(() => validateFindingCandidate(cand, ORG)).toThrow('INTELLIGENCE_PROTOCOL_ERROR: invalid verificationState');
  });

  it('rejects invalid or all-zero commitSha in candidate snapshot verification', () => {
    const cand = makeCandidate();
    expect(() => validateCodeSnapshotRef({ ...cand.snapshot, commitSha: '0'.repeat(40) }, ORG))
      .toThrow('INTELLIGENCE_PROTOCOL_ERROR: invalid commitSha');
    expect(() => validateCodeSnapshotRef({ ...cand.snapshot, commitSha: '0'.repeat(64) }, ORG))
      .toThrow('INTELLIGENCE_PROTOCOL_ERROR: invalid commitSha');
    expect(() => validateCodeSnapshotRef({ ...cand.snapshot, commitSha: 'not-a-commit-sha' }, ORG))
      .toThrow('INTELLIGENCE_PROTOCOL_ERROR: invalid commitSha');

    const valid64Snapshot = validateCodeSnapshotRef({ ...cand.snapshot, commitSha: VALID_COMMIT_64 }, ORG);
    expect(valid64Snapshot.commitSha).toBe(VALID_COMMIT_64);
  });

  it('differentiates cross-file sink changes and prevents semantic replay with same candidate ID', () => {
    const candA = makeCandidate();
    const candB = makeCandidate({
      sink: { filePath: 'src/helper.ts', symbol: 'child_process.execSync', line: 4, column: 1 },
    });
    expect(candA.candidateId).toBe(candB.candidateId);
    expect(computeCandidateBinding(candA, ORG)).not.toBe(computeCandidateBinding(candB, ORG));
  });

  it('negative control: safe constant command or unrelated local exec helper across files does not establish child_process provenance', async () => {
    const rawInput: SnapshotInput = {
      fixtureId: 'm2-case-001',
      repositoryId: 'repo_cross_cmdi',
      organizationId: ORG,
      files: [
        {
          path: 'src/helper.ts',
          content: 'export function exec(cmd: string) { return cmd.trim(); }\n',
        },
        {
          path: 'src/routes.ts',
          content: [
            "import express from 'express';",
            "import { exec } from './helper';",
            '',
            'function runRoute(req: any, res: any) {',
            '  const result = exec(req.query.cmd);',
            '  return res.json(result);',
            '}',
            '',
            'function createApp() {',
            '  const app = express();',
            "  app.get('/run', runRoute);",
            '  return app;',
            '}',
            '',
          ].join('\n'),
        },
      ],
    };
    const snapshot = await captureSnapshot(rawInput, ORG);
    const ingestion = await ingestExpress(snapshot, ORG);
    expect(ingestion.routes).toHaveLength(1);
    expect(ingestion.routes[0].path).toBe('/run');

    const unprovenCandidate = makeCandidate({
      sink: { filePath: 'src/helper.ts', symbol: 'exec', line: 1, column: 1 },
    });
    expect(unprovenCandidate.sink.symbol).not.toBe('child_process.exec');
  });

  it('fail-closed: cross-file directory traversal and unresolvable relative imports fail closed', () => {
    expect(() => resolveImport('src/routes.ts', '../untrusted/module', ['src/routes.ts', 'src/helper.ts']))
      .toThrow('M2_INGESTION_ERROR: unsupported source import');
    expect(() => resolveImport('src/routes.ts', './missing', ['src/routes.ts', 'src/helper.ts']))
      .toThrow('M2_INGESTION_ERROR: missing or ambiguous source import');
  });

  it('enforces exact verification state machine transitions and requires COMMAND_EXECUTION_OBSERVED assertion', async () => {
    const cand = makeCandidate();
    const state = createVerificationState(cand, ORG);
    expect(state.state).toBe('CANDIDATE');

    await expect(transitionVerificationState(state, { type: 'COMPLETE', result: {} as any, evidence: {} as any }))
      .rejects.toThrow('COMPLETE requires pending verification');

    expect(ASSERTION_BY_CLASS.COMMAND_INJECTION).toBe('COMMAND_EXECUTION_OBSERVED');

    const req: VerificationRequest = {
      contractVersion: CONTRACT_VERSION,
      requestId: 'req_cmdi_001',
      organizationId: ORG,
      candidateId: cand.candidateId,
      candidateBinding: computeCandidateBinding(cand, ORG),
      snapshotId: cand.snapshot.snapshotId,
      commitSha: cand.snapshot.commitSha,
      vulnerabilityClass: 'COMMAND_INJECTION',
      verificationProfile: { profileId: 'profile-cmdi', version: 1 },
      environmentRequirements: { environmentType: 'ISOLATED_TEST', runtime: 'NODE', runtimeVersion: '20.0.0' },
      networkPolicy: { mode: 'DEFAULT_DENY', allowedDestinations: [] },
      resourceBudget: { maxCpuMillis: 5000, maxMemoryMb: 512, maxWallTimeMs: 10000, maxNetworkRequests: 0 },
      timeBudgetMs: 5000,
      expectedAssertionType: 'COMMAND_EXECUTION_OBSERVED',
      createdAt: cand.createdAt,
    };

    const pending = await transitionVerificationState(state, { type: 'BEGIN', request: req });
    expect(pending.state).toBe('PENDING_VERIFICATION');

    const mismatchedRequest = { ...req, expectedAssertionType: 'SQL_RESULT_SET_VIOLATION' as any };
    expect(() => validateVerificationRequest(mismatchedRequest, cand, ORG))
      .toThrow('INTELLIGENCE_PROTOCOL_ERROR: expectedAssertionType mismatch');
  });

  it('enforces tenant isolation and rejects cross-tenant candidate verification', () => {
    const cand = makeCandidate();
    expect(() => validateFindingCandidate(cand, 'foreign_org')).toThrow('INTELLIGENCE_PROTOCOL_ERROR: organizationId mismatch');
    expect(() => computeCandidateBinding(cand, 'foreign_org')).toThrow('INTELLIGENCE_PROTOCOL_ERROR: organizationId mismatch');
  });
});
