import { describe, expect, it } from 'vitest';
import {
  CONTRACT_VERSION,
  computeCandidateBinding,
  createVerificationState,
  transitionVerificationState,
  validateFindingCandidate,
  validateVerificationRequest,
  type FindingCandidate,
} from '../../../../worker/intelligence/contracts';
import { captureSnapshot, canonical } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress } from '../../../../worker/intelligence/ingestion/express';

const ORG = 'org_cmdi_mal_cross';

function makeValidCrossFileFiles() {
  return [
    {
      path: 'src/routes.ts',
      content: `import express from 'express';
import { runCommand } from './service';

function execHandler(req: any, res: any) {
  const result = runCommand(req.query.cmd);
  return res.json(result);
}

export function createApp() {
  const app = express();
  app.get('/exec', execHandler);
  return app;
}
`,
    },
    {
      path: 'src/service.ts',
      content: `export function runCommand(cmd: string) {
  return cmd;
}
`,
    },
  ];
}

function makeCandidate(overrides: Partial<FindingCandidate> = {}): FindingCandidate {
  const createdAt = '2026-09-04T00:00:00.000Z';
  return {
    contractVersion: CONTRACT_VERSION,
    organizationId: ORG,
    candidateId: 'cmdi-candidate-001',
    snapshot: {
      contractVersion: CONTRACT_VERSION,
      organizationId: ORG,
      snapshotId: 'snapshot-cmdi-001',
      repositoryId: 'repo-cmdi-mal',
      sourceProvider: 'LOCAL_FIXTURE',
      commitSha: '1111111111111111111111111111111111111111',
      ref: 'refs/heads/main',
      createdAt,
    },
    vulnerabilityClass: 'COMMAND_INJECTION',
    source: {
      filePath: 'src/routes.ts',
      symbol: 'req.query.cmd',
      line: 5,
      column: 10,
    },
    sink: {
      filePath: 'src/service.ts',
      symbol: 'child_process.exec',
      line: 2,
      column: 3,
    },
    context: {
      entrypoint: {
        filePath: 'src/routes.ts',
        symbol: 'execHandler',
        line: 4,
        column: 1,
      },
      routeId: 'route-exec-001',
    },
    sensorEvidence: [
      {
        contractVersion: CONTRACT_VERSION,
        organizationId: ORG,
        sensorType: 'VELNAR_STRUCTURAL',
        sensorFindingId: 'sensor-cmdi-001',
        ruleId: 'express-child-process-exec-v1',
        summary: 'Cross-file request input to child_process exec provenance hypothesis.',
        sourceLocation: {
          filePath: 'src/routes.ts',
          symbol: 'req.query.cmd',
          line: 5,
          column: 10,
        },
        sinkLocation: {
          filePath: 'src/service.ts',
          symbol: 'child_process.exec',
          line: 2,
          column: 3,
        },
        rawEvidenceFingerprint: 'sha256:' + 'a'.repeat(64),
      },
    ],
    reachabilityState: 'REACHABLE',
    verificationState: 'CANDIDATE',
    createdAt,
    ...overrides,
  };
}

describe('V1 discovery-intelligence command injection detector malformed cross-file suite', () => {
  it('captures and ingests valid cross-file Express routes', async () => {
    const raw = {
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-cmdi-mal',
      organizationId: ORG,
      files: makeValidCrossFileFiles(),
    };
    const snapshot = await captureSnapshot(raw, ORG);
    expect(snapshot.files).toHaveLength(2);
    const ingestion = await ingestExpress(snapshot, ORG);
    expect(ingestion.routes).toHaveLength(1);
    expect(ingestion.routes[0].path).toBe('/exec');
    expect(ingestion.routes[0].method).toBe('GET');
  });

  it('rejects cross-file malformed source unit syntax during ingestion', async () => {
    const files = [
      makeValidCrossFileFiles()[0],
      {
        path: 'src/service.ts',
        content: 'export function runCommand( { return ;',
      },
    ];
    const snapshot = await captureSnapshot({
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-cmdi-mal',
      organizationId: ORG,
      files,
    }, ORG);
    await expect(ingestExpress(snapshot, ORG)).rejects.toThrow('M2_INGESTION_ERROR: malformed source unit');
  });

  it('rejects cross-file relative directory traversal import specifiers', async () => {
    const files = [
      {
        path: 'src/routes.ts',
        content: `import express from 'express';
import { runCommand } from '../service';

function execHandler(req: any, res: any) {
  return res.json(runCommand(req.query.cmd));
}

export function createApp() {
  const app = express();
  app.get('/exec', execHandler);
  return app;
}
`,
      },
      makeValidCrossFileFiles()[1],
    ];
    const snapshot = await captureSnapshot({
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-cmdi-mal',
      organizationId: ORG,
      files,
    }, ORG);
    await expect(ingestExpress(snapshot, ORG)).rejects.toThrow('M2_INGESTION_ERROR: unsupported source import');
  });

  it('rejects cross-file unresolvable missing imports', async () => {
    const files = [
      {
        path: 'src/routes.ts',
        content: `import express from 'express';
import { runCommand } from './missingService';

function execHandler(req: any, res: any) {
  return res.json(runCommand(req.query.cmd));
}

export function createApp() {
  const app = express();
  app.get('/exec', execHandler);
  return app;
}
`,
      },
      makeValidCrossFileFiles()[1],
    ];
    const snapshot = await captureSnapshot({
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-cmdi-mal',
      organizationId: ORG,
      files,
    }, ORG);
    await expect(ingestExpress(snapshot, ORG)).rejects.toThrow('M2_INGESTION_ERROR: missing or ambiguous source import');
  });

  it('rejects cross-file unsupported module structure such as wildcard re-exports', async () => {
    const files = [
      makeValidCrossFileFiles()[0],
      {
        path: 'src/service.ts',
        content: "export * from './other';",
      },
    ];
    const snapshot = await captureSnapshot({
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-cmdi-mal',
      organizationId: ORG,
      files,
    }, ORG);
    await expect(ingestExpress(snapshot, ORG)).rejects.toThrow('M2_INGESTION_ERROR: unsupported module structure');
  });

  it('rejects malformed snapshot repository-relative paths', async () => {
    await expect(captureSnapshot({
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-cmdi-mal',
      organizationId: ORG,
      files: [{ path: 'src/../outside.ts', content: 'export const x = 1;' }],
    }, ORG)).rejects.toThrow('M2_INGESTION_ERROR: path component');

    await expect(captureSnapshot({
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-cmdi-mal',
      organizationId: ORG,
      files: [{ path: 'src\\service.ts', content: 'export const x = 1;' }],
    }, ORG)).rejects.toThrow('M2_INGESTION_ERROR: repository-relative path');

    await expect(captureSnapshot({
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-cmdi-mal',
      organizationId: ORG,
      files: [{ path: 'src/service.sh', content: 'echo 1' }],
    }, ORG)).rejects.toThrow('M2_INGESTION_ERROR: unsupported extension');
  });

  it('validates canonical cross-file COMMAND_INJECTION candidate and binding identity', () => {
    const c = makeCandidate();
    const validated = validateFindingCandidate(c, ORG);
    expect(validated.vulnerabilityClass).toBe('COMMAND_INJECTION');
    expect(validated.verificationState).toBe('CANDIDATE');
    expect(validated.source.filePath).toBe('src/routes.ts');
    expect(validated.sink.filePath).toBe('src/service.ts');

    const binding = computeCandidateBinding(c, ORG);
    expect(binding).toBe(`${CONTRACT_VERSION}:FindingCandidate\n${canonical(c)}`);
    expect(binding).not.toMatch(/^sha256:/);

    const changedSink = makeCandidate({
      sink: { filePath: 'src/other.ts', symbol: 'child_process.execSync', line: 10, column: 5 },
    });
    expect(computeCandidateBinding(changedSink, ORG)).not.toBe(binding);
  });

  it('rejects malformed cross-file candidate attributes and state elevation', () => {
    expect(() => validateFindingCandidate(makeCandidate({
      sink: { filePath: '/src/service.ts', symbol: 'child_process.exec' },
    }), ORG)).toThrow('INTELLIGENCE_PROTOCOL_ERROR: filePath must be repository-relative');

    expect(() => validateFindingCandidate(makeCandidate({
      sink: { filePath: 'src/../service.ts', symbol: 'child_process.exec' },
    }), ORG)).toThrow('INTELLIGENCE_PROTOCOL_ERROR: filePath must be repository-relative');

    expect(() => validateFindingCandidate(makeCandidate({
      sink: { filePath: 'src/service.ts', symbol: 'child_process.exec', column: 5 },
    }), ORG)).toThrow('INTELLIGENCE_PROTOCOL_ERROR: column requires line');

    expect(() => validateFindingCandidate(makeCandidate({
      vulnerabilityClass: 'INVALID_CLASS' as any,
    }), ORG)).toThrow('INTELLIGENCE_PROTOCOL_ERROR: invalid vulnerabilityClass');

    expect(() => validateFindingCandidate(makeCandidate({
      verificationState: 'VERIFIED' as any,
    }), ORG)).toThrow('INTELLIGENCE_PROTOCOL_ERROR: invalid verificationState');

    const badCommit = makeCandidate();
    (badCommit as any).snapshot = { ...badCommit.snapshot, commitSha: '0'.repeat(40) };
    expect(() => validateFindingCandidate(badCommit, ORG)).toThrow('INTELLIGENCE_PROTOCOL_ERROR: invalid commitSha');

    const predating = makeCandidate({ createdAt: '2026-09-01T00:00:00.000Z' });
    expect(() => validateFindingCandidate(predating, ORG)).toThrow('INTELLIGENCE_PROTOCOL_ERROR: candidate predates snapshot');
  });

  it('rejects tampered candidate binding on verification request and preserves state machine boundary', async () => {
    const c = makeCandidate();
    const binding = computeCandidateBinding(c, ORG);
    const validRequest = {
      contractVersion: CONTRACT_VERSION,
      requestId: 'req-cmdi-001',
      organizationId: ORG,
      candidateId: c.candidateId,
      candidateBinding: binding,
      snapshotId: c.snapshot.snapshotId,
      commitSha: c.snapshot.commitSha,
      vulnerabilityClass: 'COMMAND_INJECTION' as const,
      verificationProfile: { profileId: 'profile-node-v1', version: 1 },
      environmentRequirements: { environmentType: 'ISOLATED_TEST' as const, runtime: 'NODE' as const, runtimeVersion: '20.11.0' },
      networkPolicy: { mode: 'DEFAULT_DENY' as const, allowedDestinations: [] },
      resourceBudget: { maxCpuMillis: 10000, maxMemoryMb: 512, maxWallTimeMs: 10000, maxNetworkRequests: 0 },
      timeBudgetMs: 5000,
      expectedAssertionType: 'COMMAND_EXECUTION_OBSERVED' as const,
      createdAt: c.createdAt,
    };
    expect(validateVerificationRequest(validRequest, c, ORG)).toBeDefined();

    const tamperedRequest = { ...validRequest, candidateBinding: binding + 'tampered' };
    expect(() => validateVerificationRequest(tamperedRequest, c, ORG)).toThrow('INTELLIGENCE_PROTOCOL_ERROR: candidateBinding mismatch');

    const startState = createVerificationState(c, ORG);
    expect(startState.state).toBe('CANDIDATE');
    await expect(transitionVerificationState(startState, {
      type: 'COMPLETE',
      result: { result: 'VERIFIED' } as any,
      evidence: {} as any,
    })).rejects.toThrow('COMPLETE requires pending verification');
  });
});
