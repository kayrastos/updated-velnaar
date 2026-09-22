import { describe, it, expect } from 'vitest';
import { captureSnapshot, validateSnapshot, canonical } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress, validateExpressIngestion } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';

const org = 'org_velnar_pdet';
const repo = 'repo_alias_multi';
const fixture = 'm2-case-001';

const APP_SOURCE = `import express from 'express';

export function createApp(db: any) {
  const app = express();

  function handleMultiStage(req: any, res: any) {
    const stage0 = req.query.id;
    const stage1 = stage0;
    const stage2 = stage1;
    const stage3 = stage2;
    const query = 'SELECT * FROM users WHERE id = ' + stage3;
    const statement = db.prepare(query);
    const rows = statement.all();
    res.json(rows);
  }

  function handleSafe(req: any, res: any) {
    const safeInput = req.query.id;
    const alias1 = safeInput;
    const alias2 = alias1;
    const statement = db.prepare('SELECT * FROM users WHERE id = ?');
    const rows = statement.all(alias2);
    res.json(rows);
  }

  app.get('/multi', handleMultiStage);
  app.get('/safe', handleSafe);
  return app;
}
`;

describe('Pipeline Determinism - Multi-Stage Alias Propagation', () => {
  it('propagates taint deterministically across multi-stage variable aliases into SQLi findings', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId: fixture,
        repositoryId: repo,
        organizationId: org,
        files: [{ path: 'src/app.ts', content: APP_SOURCE }],
      },
      org,
    );

    const ingestion = await ingestExpress(snapshot, org);
    expect(ingestion.routes).toHaveLength(2);

    const analysis1 = await detectSqlInjection(snapshot, ingestion, org);
    const analysis2 = await detectSqlInjection(snapshot, ingestion, org);

    expect(analysis1.status).toBe('DETECTED');
    expect(analysis2.status).toBe('DETECTED');
    expect(analysis1.resultFingerprint).toBe(analysis2.resultFingerprint);
    expect(canonical(analysis1)).toBe(canonical(analysis2));

    expect(analysis1.findings).toHaveLength(1);
    const finding = analysis1.findings[0];
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.source.symbol).toBe('query.id');
    expect(finding.sink.symbol).toBe('db.prepare');

    const kinds = finding.flow.map((step) => step.kind);
    expect(kinds).toEqual([
      'SOURCE',
      'VARIABLE',
      'VARIABLE',
      'VARIABLE',
      'VARIABLE',
      'CONCAT',
      'VARIABLE',
      'SINK',
    ]);

    for (const step of finding.flow) {
      expect(step.id).toMatch(/^sha256:[a-f0-9]{64}$/);
    }
    const flow1Ids = analysis1.findings[0].flow.map((s) => s.id);
    const flow2Ids = analysis2.findings[0].flow.map((s) => s.id);
    expect(flow1Ids).toEqual(flow2Ids);
  });

  it('validates pipeline determinism across re-validation and independent runs', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId: fixture,
        repositoryId: repo,
        organizationId: org,
        files: [{ path: 'src/app.ts', content: APP_SOURCE }],
      },
      org,
    );

    const validatedSnapshot = await validateSnapshot(snapshot, org);
    expect(validatedSnapshot.snapshotId).toBe(snapshot.snapshotId);

    const ingestion = await ingestExpress(validatedSnapshot, org);
    const validatedIngestion = await validateExpressIngestion(ingestion, org);
    expect(validatedIngestion.ingestionIdentity).toBe(ingestion.ingestionIdentity);

    const analysis = await detectSqlInjection(validatedSnapshot, validatedIngestion, org);
    const validatedAnalysis = await validateSqlAnalysis(analysis, validatedSnapshot, validatedIngestion, org);

    expect(validatedAnalysis.resultFingerprint).toBe(analysis.resultFingerprint);
    expect(validatedAnalysis.status).toBe('DETECTED');
    expect(validatedAnalysis.findings).toHaveLength(1);
    expect(canonical(validatedAnalysis)).toBe(canonical(analysis));
  });

  it('preserves non-authoritative boundary and enforces tenant isolation', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId: fixture,
        repositoryId: repo,
        organizationId: org,
        files: [{ path: 'src/app.ts', content: APP_SOURCE }],
      },
      org,
    );

    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);

    expect((analysis as any).capability).toBeUndefined();
    expect(analysis.status).toBe('DETECTED');

    await expect(validateSnapshot(snapshot, 'foreign_tenant')).rejects.toThrow();
    await expect(validateExpressIngestion(ingestion, 'foreign_tenant')).rejects.toThrow();
    await expect(detectSqlInjection(snapshot, ingestion, 'foreign_tenant')).rejects.toThrow();
  });
});
