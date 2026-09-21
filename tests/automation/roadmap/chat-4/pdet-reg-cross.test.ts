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

const org = 'org_pdet_cross';
const repoId = 'repo-pdet-cross';
const fixtureId = 'm2-case-001';

const helperCode = `export function buildQuery(term: string) {
  return "SELECT * FROM items WHERE name = '" + term + "'";
}
`;

const appCode = `import express from 'express';
import { buildQuery } from './helper';

export function createApp(db: any) {
  const app = express();
  function searchHandler(req: any, res: any) {
    const term = req.query.term;
    const query = buildQuery(term);
    const rows = db.prepare(query).all();
    return res.json(rows);
  }
  app.get('/api/search', searchHandler);
  return app;
}
`;

const safeHelperCode = `export function buildSafeQuery() {
  return 'SELECT * FROM items WHERE name = ?';
}
`;

const safeAppCode = `import express from 'express';
import { buildSafeQuery } from './safeHelper';

export function createApp(db: any) {
  const app = express();
  function safeHandler(req: any, res: any) {
    const term = req.query.term;
    const query = buildSafeQuery();
    const rows = db.prepare(query).all(term);
    return res.json(rows);
  }
  app.get('/api/safe', safeHandler);
  return app;
}
`;

describe('Platform Integration - Pipeline Determinism Regression Lock: Cross-File (pdet-reg-cross)', () => {
  it('guarantees snapshot and ingestion determinism invariant to input file ordering', async () => {
    const appFile = { path: 'src/app.ts', content: appCode };
    const helperFile = { path: 'src/helper.ts', content: helperCode };

    const snapshotOrderA = await captureSnapshot(
      { fixtureId, repositoryId: repoId, organizationId: org, files: [appFile, helperFile] },
      org,
    );
    const snapshotOrderB = await captureSnapshot(
      { fixtureId, repositoryId: repoId, organizationId: org, files: [helperFile, appFile] },
      org,
    );

    expect(snapshotOrderA.snapshotId).toBe(snapshotOrderB.snapshotId);
    expect(snapshotOrderA.totalBytes).toBe(snapshotOrderB.totalBytes);
    expect(snapshotOrderA.files.map((f) => f.path)).toEqual(['src/app.ts', 'src/helper.ts']);

    const validatedSnapshot = await validateSnapshot(snapshotOrderA, org);
    expect(validatedSnapshot.snapshotId).toBe(snapshotOrderA.snapshotId);

    const ingestionA = await ingestExpress(snapshotOrderA, org);
    const ingestionB = await ingestExpress(snapshotOrderB, org);

    expect(ingestionA.ingestionIdentity).toBe(ingestionB.ingestionIdentity);
    expect(ingestionA.sourceUnits.length).toBe(2);
    expect(ingestionA.routes.length).toBe(1);
    expect(ingestionA.routes[0].path).toBe('/api/search');

    const validatedIngestion = await validateExpressIngestion(ingestionA, org);
    expect(validatedIngestion.ingestionIdentity).toBe(ingestionA.ingestionIdentity);
  });

  it('locks deterministic cross-file taint flow analysis and finding generation', async () => {
    const files = [
      { path: 'src/app.ts', content: appCode },
      { path: 'src/helper.ts', content: helperCode },
    ];
    const snapshot = await captureSnapshot({ fixtureId, repositoryId: repoId, organizationId: org, files }, org);
    const ingestion = await ingestExpress(snapshot, org);

    const run1 = await detectSqlInjection(snapshot, ingestion, org);
    const run2 = await detectSqlInjection(snapshot, ingestion, org);

    expect(run1.status).toBe('DETECTED');
    expect(run2.status).toBe('DETECTED');
    expect(run1.resultFingerprint).toBe(run2.resultFingerprint);
    expect(run1.findings.length).toBe(1);
    expect(run1.findings[0].findingId).toBe(run2.findings[0].findingId);
    expect(run1.findings[0].vulnerabilityClass).toBe('SQL_INJECTION');

    const flowFiles = new Set(run1.findings[0].flow.map((step) => step.location.filePath));
    expect(flowFiles.has('src/app.ts')).toBe(true);
    expect(flowFiles.has('src/helper.ts')).toBe(true);

    const validated = await validateSqlAnalysis(run1, snapshot, ingestion, org);
    expect(validated.resultFingerprint).toBe(run1.resultFingerprint);
  });

  it('produces deterministic NOT_DETECTED status for cross-file safely parameterized query', async () => {
    const files = [
      { path: 'src/safeApp.ts', content: safeAppCode },
      { path: 'src/safeHelper.ts', content: safeHelperCode },
    ];
    const snapshot = await captureSnapshot({ fixtureId, repositoryId: repoId, organizationId: org, files }, org);
    const ingestion = await ingestExpress(snapshot, org);

    const analysis1 = await detectSqlInjection(snapshot, ingestion, org);
    const analysis2 = await detectSqlInjection(snapshot, ingestion, org);

    expect(analysis1.status).toBe('NOT_DETECTED');
    expect(analysis2.status).toBe('NOT_DETECTED');
    expect(analysis1.findings.length).toBe(0);
    expect(analysis1.resultFingerprint).toBe(analysis2.resultFingerprint);

    const validated = await validateSqlAnalysis(analysis1, snapshot, ingestion, org);
    expect(validated.resultFingerprint).toBe(analysis1.resultFingerprint);
  });

  it('enforces non-authoritative boundary on cross-file analysis outputs', async () => {
    const files = [
      { path: 'src/app.ts', content: appCode },
      { path: 'src/helper.ts', content: helperCode },
    ];
    const snapshot = await captureSnapshot({ fixtureId, repositoryId: repoId, organizationId: org, files }, org);
    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);

    expect(analysis.status).toBe('DETECTED');
    expect((analysis as any).capability).toBeUndefined();
    expect((analysis as any).verificationState).toBeUndefined();
    expect((analysis as any).action).toBeUndefined();
  });
});
