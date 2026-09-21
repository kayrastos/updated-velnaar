import { describe, it, expect } from 'vitest';
import { captureSnapshot, validateSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress, validateExpressIngestion } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';

const org = 'org_velnar_chat4';
const repo = 'repo_pdet_neg_nest';

const appSource = [
  "import express from 'express';",
  '',
  'export function createApp(db: any) {',
  '  const app = express();',
  '',
  '  function innerTransform(value: any) {',
  '    return value;',
  '  }',
  '',
  '  function outerTransform(value: any) {',
  '    return innerTransform(value);',
  '  }',
  '',
  '  function handleRoute(req: any, res: any) {',
  '    const category = outerTransform(req.query.category);',
  "    const statement = db.prepare('SELECT id, name FROM items WHERE category = ?');",
  '    const rows = statement.all(category);',
  '    return res.json(rows);',
  '  }',
  '',
  "  app.get('/items', handleRoute);",
  '  return app;',
  '}',
  '',
].join('\n');

function createTestInput() {
  return {
    fixtureId: 'm2-case-001',
    repositoryId: repo,
    organizationId: org,
    files: [
      {
        path: 'src/app.ts',
        content: appSource,
      },
    ],
  };
}

describe('Pipeline Determinism Negative Control - Nested Functions (RM_PDET_NEG_NEST)', () => {
  it('deterministically captures snapshot, ingests express app, and yields NOT_DETECTED status for nested negative control', async () => {
    const input = createTestInput();
    const snapshot = await captureSnapshot(input, org);

    expect(snapshot.organizationId).toBe(org);
    expect(snapshot.repositoryId).toBe(repo);
    expect(snapshot.files).toHaveLength(1);
    expect(snapshot.files[0].path).toBe('src/app.ts');

    const expressIngestion = await ingestExpress(snapshot, org);
    expect(expressIngestion.routes).toHaveLength(1);
    expect(expressIngestion.routes[0].method).toBe('GET');
    expect(expressIngestion.routes[0].path).toBe('/items');

    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
    expect(analysis.status).toBe('NOT_DETECTED');
    expect(analysis.findings).toHaveLength(0);
    expect(analysis.limitations).toHaveLength(0);
    expect(analysis.routeIdentities).toHaveLength(1);
    expect(analysis.routeIdentities[0]).toBe(expressIngestion.routes[0].routeIdentity);

    const bridge = createSqlCandidateBridge(async () => '0123456789abcdef0123456789abcdef01234567');
    const candidates = await bridge(analysis, snapshot, expressIngestion, org);
    expect(candidates).toHaveLength(0);
  });

  it('preserves determinism across independent pipeline runs and produces identical fingerprints', async () => {
    const inputA = createTestInput();
    const inputB = createTestInput();

    const snapshotA = await captureSnapshot(inputA, org);
    const snapshotB = await captureSnapshot(inputB, org);
    expect(snapshotA.snapshotId).toBe(snapshotB.snapshotId);

    const expressA = await ingestExpress(snapshotA, org);
    const expressB = await ingestExpress(snapshotB, org);
    expect(expressA.ingestionIdentity).toBe(expressB.ingestionIdentity);

    const analysisA = await detectSqlInjection(snapshotA, expressA, org);
    const analysisB = await detectSqlInjection(snapshotB, expressB, org);
    expect(analysisA.status).toBe('NOT_DETECTED');
    expect(analysisB.status).toBe('NOT_DETECTED');
    expect(analysisA.resultFingerprint).toBe(analysisB.resultFingerprint);

    const bridge = createSqlCandidateBridge(async () => '0123456789abcdef0123456789abcdef01234567');
    const candidatesA = await bridge(analysisA, snapshotA, expressA, org);
    const candidatesB = await bridge(analysisB, snapshotB, expressB, org);
    expect(candidatesA).toHaveLength(0);
    expect(candidatesB).toHaveLength(0);
    expect(candidatesA).toEqual(candidatesB);
  });

  it('validates structural integrity across snapshot, express ingestion, and sql analysis without emitting candidate hypotheses', async () => {
    const input = createTestInput();
    const snapshot = await captureSnapshot(input, org);
    const expressIngestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);

    const validatedSnapshot = await validateSnapshot(snapshot, org);
    expect(validatedSnapshot.snapshotId).toBe(snapshot.snapshotId);

    const validatedExpress = await validateExpressIngestion(expressIngestion, org);
    expect(validatedExpress.ingestionIdentity).toBe(expressIngestion.ingestionIdentity);

    const validatedAnalysis = await validateSqlAnalysis(analysis, snapshot, expressIngestion, org);
    expect(validatedAnalysis.resultFingerprint).toBe(analysis.resultFingerprint);
    expect(validatedAnalysis.status).toBe('NOT_DETECTED');
    expect(validatedAnalysis.findings).toHaveLength(0);
    expect(validatedAnalysis.limitations).toHaveLength(0);
  });
});
