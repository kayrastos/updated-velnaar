import { describe, expect, it } from 'vitest';
import {
  CONTRACT_VERSION,
  computeCandidateBinding,
  createVerificationState,
  transitionVerificationState,
  validateFindingCandidate,
  type CodeLocation,
  type FindingCandidate,
} from '../../../../worker/intelligence/contracts';
import {
  captureSnapshot,
  hash,
  type SnapshotInput,
} from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress } from '../../../../worker/intelligence/ingestion/express';

const ORG = 'org_cmdi_nest';
const COMMIT_SHA = '1234567890abcdef1234567890abcdef12345678';

function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reverseKeys(v)]));
  }
  return value;
}

function makeNestedInput(mountPrefix = '/api/v1', routePath = '/exec'): SnapshotInput {
  return {
    fixtureId: 'm2-case-001',
    repositoryId: 'repo_cmdi',
    organizationId: ORG,
    files: [
      {
        path: 'src/routes.ts',
        content: `import express from 'express';

function execHandler(req: any, res: any) {
  return res.json({ status: 'exec' });
}

function safeHandler(req: any, res: any) {
  return res.json({ status: 'safe' });
}

export function createApp() {
  const app = express();
  const router = express.Router();
  router.get('${routePath}', execHandler);
  router.get('/safe', safeHandler);
  app.use('${mountPrefix}', router);
  return app;
}
`,
      },
    ],
  };
}

async function buildNestedCandidate(
  snapshot: Awaited<ReturnType<typeof captureSnapshot>>,
  route: Awaited<ReturnType<typeof ingestExpress>>['routes'][0],
  overrides: {
    sourceSymbol?: string;
    sinkSymbol?: string;
    commitSha?: string;
    vulnerabilityClass?: 'COMMAND_INJECTION';
  } = {}
): Promise<FindingCandidate> {
  const source: CodeLocation = {
    filePath: 'src/routes.ts',
    symbol: overrides.sourceSymbol ?? 'req.query.command',
    line: 3,
    column: 1,
  };
  const sink: CodeLocation = {
    filePath: 'src/routes.ts',
    symbol: overrides.sinkSymbol ?? 'child_process.exec',
    line: 4,
    column: 3,
  };
  const commitSha = overrides.commitSha ?? COMMIT_SHA;
  const createdAt = '2026-09-04T00:00:00.000Z';
  const candidateId = await hash('cmdi-candidate-nest-v1', {
    snapshotId: snapshot.snapshotId,
    routeIdentity: route.routeIdentity,
    source,
    sink,
    commitSha,
  });
  const rawCandidate: FindingCandidate = {
    contractVersion: CONTRACT_VERSION,
    organizationId: ORG,
    candidateId,
    snapshot: {
      contractVersion: CONTRACT_VERSION,
      organizationId: ORG,
      snapshotId: snapshot.snapshotId,
      repositoryId: snapshot.repositoryId,
      sourceProvider: 'LOCAL_FIXTURE',
      commitSha,
      ref: 'refs/heads/main',
      createdAt,
    },
    vulnerabilityClass: overrides.vulnerabilityClass ?? 'COMMAND_INJECTION',
    source,
    sink,
    context: {
      entrypoint: {
        filePath: route.handler.filePath,
        symbol: route.handler.symbol,
        line: route.handler.line,
        column: route.handler.column,
      },
      routeId: route.routeIdentity,
    },
    sensorEvidence: [
      {
        contractVersion: CONTRACT_VERSION,
        organizationId: ORG,
        sensorType: 'VELNAR_STRUCTURAL',
        sensorFindingId: 'cmdi-nest-sensor-001',
        ruleId: 'express-request-to-child-process-exec-v1',
        summary: 'Source-analysis command injection hypothesis within nested Express router.',
        sourceLocation: source,
        sinkLocation: sink,
        rawEvidenceFingerprint: await hash('cmdi-nest-fingerprint-v1', {
          routeIdentity: route.routeIdentity,
          source,
          sink,
        }),
      },
    ],
    reachabilityState: 'REACHABLE',
    verificationState: 'CANDIDATE',
    createdAt,
  };
  return validateFindingCandidate(rawCandidate, ORG);
}

describe('COMMAND_INJECTION candidate identity stability: nested router', () => {
  it('produces deterministic candidate identity and binding for mounted nested route', async () => {
    const snapshot = await captureSnapshot(makeNestedInput('/api/v1', '/exec'), ORG);
    const ingestion = await ingestExpress(snapshot, ORG);
    const execRoute = ingestion.routes.find(r => r.path === '/api/v1/exec');
    expect(execRoute).toBeDefined();
    expect(execRoute!.ownerKind).toBe('ROUTER');
    expect(execRoute!.mount?.prefix).toBe('/api/v1');

    const candidate = await buildNestedCandidate(snapshot, execRoute!);
    const binding = computeCandidateBinding(candidate, ORG);

    expect(binding.startsWith(`${CONTRACT_VERSION}:FindingCandidate\n`)).toBe(true);
    expect(binding).not.toMatch(/^sha256:/);
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.vulnerabilityClass).toBe('COMMAND_INJECTION');
    expect(computeCandidateBinding(reverseKeys(candidate), ORG)).toBe(binding);
  });

  it('mount prefix mutation changes routeIdentity and candidate semantic binding', async () => {
    const snap1 = await captureSnapshot(makeNestedInput('/api/v1', '/exec'), ORG);
    const ing1 = await ingestExpress(snap1, ORG);
    const route1 = ing1.routes.find(r => r.path === '/api/v1/exec')!;
    const cand1 = await buildNestedCandidate(snap1, route1);
    const binding1 = computeCandidateBinding(cand1, ORG);

    const snap2 = await captureSnapshot(makeNestedInput('/api/v2', '/exec'), ORG);
    const ing2 = await ingestExpress(snap2, ORG);
    const route2 = ing2.routes.find(r => r.path === '/api/v2/exec')!;
    const cand2 = await buildNestedCandidate(snap2, route2);
    const binding2 = computeCandidateBinding(cand2, ORG);

    expect(route1.routeIdentity).not.toBe(route2.routeIdentity);
    expect(binding1).not.toBe(binding2);
  });

  it('distinguishes nested vulnerable route from sibling safe handler on same router', async () => {
    const snapshot = await captureSnapshot(makeNestedInput('/api/v1', '/exec'), ORG);
    const ingestion = await ingestExpress(snapshot, ORG);
    const execRoute = ingestion.routes.find(r => r.path === '/api/v1/exec')!;
    const safeRoute = ingestion.routes.find(r => r.path === '/api/v1/safe')!;

    expect(execRoute.routeIdentity).not.toBe(safeRoute.routeIdentity);

    const execCand = await buildNestedCandidate(snapshot, execRoute);
    const safeCand = await buildNestedCandidate(snapshot, safeRoute, {
      sinkSymbol: 'safeHelper',
    });

    expect(computeCandidateBinding(execCand, ORG)).not.toBe(computeCandidateBinding(safeCand, ORG));
  });

  it('proven sink semantics change candidate binding', async () => {
    const snapshot = await captureSnapshot(makeNestedInput('/api/v1', '/exec'), ORG);
    const ingestion = await ingestExpress(snapshot, ORG);
    const execRoute = ingestion.routes.find(r => r.path === '/api/v1/exec')!;

    const execCand = await buildNestedCandidate(snapshot, execRoute, { sinkSymbol: 'child_process.exec' });
    const execSyncCand = await buildNestedCandidate(snapshot, execRoute, { sinkSymbol: 'child_process.execSync' });

    expect(computeCandidateBinding(execCand, ORG)).not.toBe(computeCandidateBinding(execSyncCand, ORG));
  });

  it('commit SHA change prevents candidate identity reuse', async () => {
    const snapshot = await captureSnapshot(makeNestedInput('/api/v1', '/exec'), ORG);
    const ingestion = await ingestExpress(snapshot, ORG);
    const execRoute = ingestion.routes.find(r => r.path === '/api/v1/exec')!;

    const candA = await buildNestedCandidate(snapshot, execRoute, { commitSha: '1111111111111111111111111111111111111111' });
    const candB = await buildNestedCandidate(snapshot, execRoute, { commitSha: '2222222222222222222222222222222222222222' });

    expect(computeCandidateBinding(candA, ORG)).not.toBe(computeCandidateBinding(candB, ORG));
  });

  it('preserves CANDIDATE verification boundary and prohibits unverified completion', async () => {
    const snapshot = await captureSnapshot(makeNestedInput('/api/v1', '/exec'), ORG);
    const ingestion = await ingestExpress(snapshot, ORG);
    const execRoute = ingestion.routes.find(r => r.path === '/api/v1/exec')!;
    const candidate = await buildNestedCandidate(snapshot, execRoute);

    const state = createVerificationState(candidate, ORG);
    expect(state.state).toBe('CANDIDATE');

    await expect(
      transitionVerificationState(state, { type: 'COMPLETE', result: {} as any, evidence: {} as any })
    ).rejects.toThrow('COMPLETE requires pending verification');
  });
});
