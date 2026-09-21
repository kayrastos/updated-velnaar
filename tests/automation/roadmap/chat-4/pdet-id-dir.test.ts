import { describe, it, expect } from 'vitest';
import {
  captureSnapshot,
  validateSnapshot,
} from '../../../../worker/intelligence/ingestion/snapshot';
import {
  ingestExpress,
  validateExpressIngestion,
} from '../../../../worker/intelligence/ingestion/express';
import {
  detectSqlInjection,
  validateSqlAnalysis,
} from '../../../../worker/intelligence/detection/sqlInjection';
import {
  createSqlCandidateBridge,
} from '../../../../worker/intelligence/detection/candidate';

const orgId = 'org_pdet';
const repoId = 'repo_pdet';
const fixtureId = 'm2-case-001';
const validCommitSha = '1234567890123456789012345678901234567890';

const directRouteSource = `import express from 'express';

export function createApp(db: any) {
  function getItems(req: any, res: any) {
    const id = req.query.id;
    const stmt = db.prepare('SELECT * FROM items WHERE id = ' + id);
    res.json(stmt.all());
  }

  const app = express();
  app.get('/items', getItems);
  return app;
}
`;

const multiDirectRouteSource = `import express from 'express';

export function createApp(db: any) {
  function getVulnerable(req: any, res: any) {
    const id = req.query.id;
    const stmt = db.prepare('SELECT * FROM items WHERE id = ' + id);
    res.json(stmt.all());
  }

  function postVulnerable(req: any, res: any) {
    const name = req.query.name;
    const stmt = db.prepare('INSERT INTO items VALUES (' + name + ')');
    res.json(stmt.all());
  }

  function getSafe(req: any, res: any) {
    const id = req.query.id;
    const stmt = db.prepare('SELECT * FROM items WHERE id = ?');
    res.json(stmt.all(id));
  }

  const app = express();
  app.get('/items', getVulnerable);
  app.post('/items', postVulnerable);
  app.get('/safe', getSafe);
  return app;
}
`;

const safeOnlyDirectRouteSource = `import express from 'express';

export function createApp(db: any) {
  function getSafe(req: any, res: any) {
    const id = req.query.id;
    const stmt = db.prepare('SELECT * FROM items WHERE id = ?');
    res.json(stmt.all(id));
  }

  const app = express();
  app.get('/safe', getSafe);
  return app;
}
`;

describe('Roadmap Chat-4: Pipeline Determinism - Identity Stability for Direct Routes (RM_PDET_ID_DIR)', () => {
  it('produces identical snapshot, route, analysis, and candidate identities across repeated passes of direct routes', async () => {
    const files = [{ path: 'src/app.ts', content: directRouteSource }];

    const snapshot1 = await captureSnapshot(
      { fixtureId, repositoryId: repoId, organizationId: orgId, files },
      orgId,
    );
    const ingestion1 = await ingestExpress(snapshot1, orgId);
    const analysis1 = await detectSqlInjection(snapshot1, ingestion1, orgId);

    const bridge = createSqlCandidateBridge(async () => validCommitSha);
    const candidates1 = await bridge(analysis1, snapshot1, ingestion1, orgId);

    const snapshot2 = await captureSnapshot(
      { fixtureId, repositoryId: repoId, organizationId: orgId, files },
      orgId,
    );
    const ingestion2 = await ingestExpress(snapshot2, orgId);
    const analysis2 = await detectSqlInjection(snapshot2, ingestion2, orgId);
    const candidates2 = await bridge(analysis2, snapshot2, ingestion2, orgId);

    expect(snapshot1.snapshotId).toBe(snapshot2.snapshotId);
    expect(snapshot1.files[0].fileIdentity).toBe(snapshot2.files[0].fileIdentity);
    expect(snapshot1.files[0].contentDigest).toBe(snapshot2.files[0].contentDigest);

    expect(ingestion1.ingestionIdentity).toBe(ingestion2.ingestionIdentity);
    expect(ingestion1.routes).toHaveLength(1);
    expect(ingestion2.routes).toHaveLength(1);

    const route1 = ingestion1.routes[0];
    const route2 = ingestion2.routes[0];
    expect(route1.routeIdentity).toBe(route2.routeIdentity);
    expect(route1.method).toBe('GET');
    expect(route1.path).toBe('/items');
    expect(route1.declaredPath).toBe('/items');
    expect(route1.ownerKind).toBe('APP');
    expect(route1.mount).toBeNull();

    expect(analysis1.resultFingerprint).toBe(analysis2.resultFingerprint);
    expect(analysis1.status).toBe('DETECTED');
    expect(analysis1.findings).toHaveLength(1);
    expect(analysis2.findings).toHaveLength(1);
    expect(analysis1.findings[0].findingId).toBe(analysis2.findings[0].findingId);
    expect(analysis1.findings[0].flow[0].id).toBe(analysis2.findings[0].flow[0].id);

    expect(candidates1).toHaveLength(1);
    expect(candidates2).toHaveLength(1);
    expect(candidates1[0].candidate.candidateId).toBe(candidates2[0].candidate.candidateId);
    expect(candidates1[0].candidateBinding).toBe(candidates2[0].candidateBinding);
  });

  it('validates round-trip structural identity and rejects tampered direct route metadata', async () => {
    const files = [{ path: 'src/app.ts', content: directRouteSource }];
    const snapshot = await captureSnapshot(
      { fixtureId, repositoryId: repoId, organizationId: orgId, files },
      orgId,
    );
    const ingestion = await ingestExpress(snapshot, orgId);
    const analysis = await detectSqlInjection(snapshot, ingestion, orgId);

    const validSnapshot = await validateSnapshot(snapshot, orgId);
    expect(validSnapshot.snapshotId).toBe(snapshot.snapshotId);

    const validIngestion = await validateExpressIngestion(ingestion, orgId);
    expect(validIngestion.ingestionIdentity).toBe(ingestion.ingestionIdentity);
    expect(validIngestion.routes[0].routeIdentity).toBe(ingestion.routes[0].routeIdentity);

    const validAnalysis = await validateSqlAnalysis(analysis, snapshot, ingestion, orgId);
    expect(validAnalysis.resultFingerprint).toBe(analysis.resultFingerprint);

    const tamperedRouteIdentity = {
      ...ingestion,
      routes: [
        {
          ...ingestion.routes[0],
          routeIdentity: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        },
      ],
    };
    await expect(validateExpressIngestion(tamperedRouteIdentity as any, orgId)).rejects.toThrow();

    const tamperedRoutePath = {
      ...ingestion,
      routes: [
        {
          ...ingestion.routes[0],
          path: '/tampered',
        },
      ],
    };
    await expect(validateExpressIngestion(tamperedRoutePath as any, orgId)).rejects.toThrow();

    const tamperedFingerprint = {
      ...analysis,
      resultFingerprint: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    };
    await expect(
      validateSqlAnalysis(tamperedFingerprint as any, snapshot, ingestion, orgId),
    ).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
  });

  it('maintains distinct stable identities across distinct direct routes and methods', async () => {
    const files = [{ path: 'src/app.ts', content: multiDirectRouteSource }];
    const snapshot = await captureSnapshot(
      { fixtureId, repositoryId: repoId, organizationId: orgId, files },
      orgId,
    );
    const ingestion = await ingestExpress(snapshot, orgId);
    expect(ingestion.routes).toHaveLength(3);

    const routeIdentities = new Set(ingestion.routes.map((r) => r.routeIdentity));
    expect(routeIdentities.size).toBe(3);

    for (const route of ingestion.routes) {
      expect(route.ownerKind).toBe('APP');
      expect(route.mount).toBeNull();
    }

    const getItemsRoute = ingestion.routes.find((r) => r.method === 'GET' && r.path === '/items');
    const postItemsRoute = ingestion.routes.find((r) => r.method === 'POST' && r.path === '/items');
    const getSafeRoute = ingestion.routes.find((r) => r.method === 'GET' && r.path === '/safe');

    expect(getItemsRoute).toBeDefined();
    expect(postItemsRoute).toBeDefined();
    expect(getSafeRoute).toBeDefined();
    expect(getItemsRoute!.routeIdentity).not.toBe(postItemsRoute!.routeIdentity);

    const analysis = await detectSqlInjection(snapshot, ingestion, orgId);
    expect(analysis.status).toBe('DETECTED');
    expect(analysis.findings).toHaveLength(2);

    const findingRouteIdentities = new Set(analysis.findings.map((f) => f.routeIdentity));
    expect(findingRouteIdentities.has(getItemsRoute!.routeIdentity)).toBe(true);
    expect(findingRouteIdentities.has(postItemsRoute!.routeIdentity)).toBe(true);
    expect(findingRouteIdentities.has(getSafeRoute!.routeIdentity)).toBe(false);

    const bridge = createSqlCandidateBridge(async () => validCommitSha);
    const hypotheses = await bridge(analysis, snapshot, ingestion, orgId);
    expect(hypotheses).toHaveLength(2);

    const candidateIds = new Set(hypotheses.map((h) => h.candidate.candidateId));
    expect(candidateIds.size).toBe(2);
  });

  it('enforces non-authoritative candidate boundary and strict commit verification for direct routes', async () => {
    const files = [{ path: 'src/app.ts', content: directRouteSource }];
    const snapshot = await captureSnapshot(
      { fixtureId, repositoryId: repoId, organizationId: orgId, files },
      orgId,
    );
    const ingestion = await ingestExpress(snapshot, orgId);
    const analysis = await detectSqlInjection(snapshot, ingestion, orgId);

    const validBridge = createSqlCandidateBridge(async () => validCommitSha);
    const hypotheses = await validBridge(analysis, snapshot, ingestion, orgId);

    expect(hypotheses).toHaveLength(1);
    const candidate = hypotheses[0].candidate;
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.snapshot.commitSha).toBe(validCommitSha);
    expect(candidate.sensorEvidence[0].sensorType).toBe('VELNAR_STRUCTURAL');
    expect(candidate.sensorEvidence[0].rawEvidenceFingerprint).toBe(analysis.resultFingerprint);

    const zeroShaBridge = createSqlCandidateBridge(async () => '0000000000000000000000000000000000000000');
    await expect(zeroShaBridge(analysis, snapshot, ingestion, orgId)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const invalidShaBridge = createSqlCandidateBridge(async () => 'invalid-sha-format');
    await expect(invalidShaBridge(analysis, snapshot, ingestion, orgId)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const safeFiles = [{ path: 'src/app.ts', content: safeOnlyDirectRouteSource }];
    const safeSnapshot = await captureSnapshot(
      { fixtureId, repositoryId: repoId, organizationId: orgId, files: safeFiles },
      orgId,
    );
    const safeIngestion = await ingestExpress(safeSnapshot, orgId);
    const safeAnalysis = await detectSqlInjection(safeSnapshot, safeIngestion, orgId);

    expect(safeAnalysis.status).toBe('NOT_DETECTED');
    expect(safeAnalysis.findings).toHaveLength(0);

    const safeHypotheses = await validBridge(safeAnalysis, safeSnapshot, safeIngestion, orgId);
    expect(safeHypotheses).toEqual([]);
  });
});
