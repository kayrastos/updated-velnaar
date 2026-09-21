import { describe, it, expect } from 'vitest';
import { captureSnapshot, validateSnapshot, hash } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress, validateExpressIngestion } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { validateRepositoryIngestion } from '../../../../worker/intelligence/ingestion/repository';

describe('Pipeline Determinism: Stale State Rejection in Nested Topologies', () => {
  const org = 'org_pdet_nest';

  const sourceCodeA = `import express from 'express';

export function createApp(db: any) {
  const app = express();
  const router = express.Router();

  function getItem(req: any, res: any) {
    const id = req.query.id;
    const stmt = db.prepare('SELECT * FROM items WHERE id = ' + id);
    const rows = stmt.all();
    return res.json(rows);
  }

  router.get('/item', getItem);
  app.use('/api', router);

  return app;
}
`;

  const sourceCodeB = `import express from 'express';

export function createApp(db: any) {
  const app = express();
  const router = express.Router();

  function getItem(req: any, res: any) {
    const id = req.query.id;
    const stmt = db.prepare('SELECT * FROM items WHERE id = ?');
    const rows = stmt.all(id);
    return res.json(rows);
  }

  router.get('/item', getItem);
  app.use('/api', router);

  return app;
}
`;

  it('rejects stale nested snapshot inside express ingestion during detection', async () => {
    const snapshotA = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-pdet-stale-nest',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: sourceCodeA }],
      },
      org,
    );

    const snapshotB = await captureSnapshot(
      {
        fixtureId: 'm2-case-002',
        repositoryId: 'repo-pdet-stale-nest',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: sourceCodeB }],
      },
      org,
    );

    const ingestionA = await ingestExpress(snapshotA, org);
    const ingestionB = await ingestExpress(snapshotB, org);

    expect(ingestionA.routes.length).toBe(1);
    expect(ingestionA.routes[0].path).toBe('/api/item');
    expect(ingestionB.routes.length).toBe(1);
    expect(ingestionB.routes[0].path).toBe('/api/item');

    const analysisA = await detectSqlInjection(snapshotA, ingestionA, org);
    expect(analysisA.status).toBe('DETECTED');
    expect(analysisA.findings.length).toBe(1);

    const analysisB = await detectSqlInjection(snapshotB, ingestionB, org);
    expect(analysisB.status).toBe('NOT_DETECTED');
    expect(analysisB.findings.length).toBe(0);

    await expect(detectSqlInjection(snapshotB, ingestionA, org)).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
    await expect(detectSqlInjection(snapshotA, ingestionB, org)).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
  });

  it('rejects stale analysis when validated against updated nested snapshots', async () => {
    const snapshotA = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-pdet-stale-nest',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: sourceCodeA }],
      },
      org,
    );

    const snapshotB = await captureSnapshot(
      {
        fixtureId: 'm2-case-002',
        repositoryId: 'repo-pdet-stale-nest',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: sourceCodeB }],
      },
      org,
    );

    const ingestionA = await ingestExpress(snapshotA, org);
    const ingestionB = await ingestExpress(snapshotB, org);

    const analysisA = await detectSqlInjection(snapshotA, ingestionA, org);
    const analysisB = await detectSqlInjection(snapshotB, ingestionB, org);

    await expect(validateSqlAnalysis(analysisA, snapshotB, ingestionB, org)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
    await expect(validateSqlAnalysis(analysisB, snapshotA, ingestionA, org)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
  });

  it('fails closed on stale candidate hypotheses before commit verification and bounds authority', async () => {
    const snapshotA = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-pdet-stale-nest',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: sourceCodeA }],
      },
      org,
    );

    const snapshotB = await captureSnapshot(
      {
        fixtureId: 'm2-case-002',
        repositoryId: 'repo-pdet-stale-nest',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: sourceCodeB }],
      },
      org,
    );

    const ingestionA = await ingestExpress(snapshotA, org);
    const ingestionB = await ingestExpress(snapshotB, org);
    const analysisA = await detectSqlInjection(snapshotA, ingestionA, org);

    let commitCheckCalled = false;
    const bridge = createSqlCandidateBridge(async () => {
      commitCheckCalled = true;
      return '1111111111111111111111111111111111111111';
    });

    await expect(bridge(analysisA, snapshotB, ingestionB, org)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
    expect(commitCheckCalled).toBe(false);

    const validHypotheses = await bridge(analysisA, snapshotA, ingestionA, org);
    expect(commitCheckCalled).toBe(true);
    expect(validHypotheses.length).toBe(1);
    expect(validHypotheses[0].candidate.verificationState).toBe('CANDIDATE');
    expect(validHypotheses[0].candidate.reachabilityState).toBe('REACHABLE');
    expect(validHypotheses[0].candidate.snapshot.snapshotId).toBe(snapshotA.snapshotId);
  });

  it('rejects stale nested snapshot in repository ingestion records', async () => {
    const snapshotA = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-pdet-stale-nest',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: sourceCodeA }],
      },
      org,
    );

    const snapshotB = await captureSnapshot(
      {
        fixtureId: 'm2-case-002',
        repositoryId: 'repo-pdet-stale-nest',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: sourceCodeB }],
      },
      org,
    );

    const validBody = {
      version: 'velnar-repository-ingestion-v1' as const,
      organizationId: org,
      repositoryId: 'repo-pdet-stale-nest',
      commitSha: '2222222222222222222222222222222222222222',
      snapshot: snapshotA,
    };

    const expectedIdentity = await hash('velnar-repository-ingestion-v1', validBody);
    const record = { ...validBody, ingestionIdentity: expectedIdentity };

    const validated = await validateRepositoryIngestion(record, org);
    expect(validated.snapshot.snapshotId).toBe(snapshotA.snapshotId);

    const staleRecord = { ...record, snapshot: snapshotB };
    await expect(validateRepositoryIngestion(staleRecord, org)).rejects.toThrow('ingestion identity mismatch');
  });

  it('rejects tampered or stale nested route metadata during ingestion validation', async () => {
    const snapshotA = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-pdet-stale-nest',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: sourceCodeA }],
      },
      org,
    );

    const ingestionA = await ingestExpress(snapshotA, org);
    const tampered = {
      ...ingestionA,
      routes: ingestionA.routes.map(r => ({ ...r, path: '/api/stale-mount' })),
    };

    await expect(validateExpressIngestion(tampered as any, org)).rejects.toThrow('ingestion metadata mismatch');
  });
});
