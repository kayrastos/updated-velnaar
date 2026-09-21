import { describe, it, expect } from 'vitest';
import { captureSnapshot, validateSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress, validateExpressIngestion } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';

const org = 'org_pdet_neg_multi';
const repo = 'repo_pdet_neg_multi';
const fixture = 'm2-case-001';

const safeSource = [
  "import express from 'express';",
  '',
  'export function createApp(db: any) {',
  '  const app = express();',
  '  function handleFirst(req: any, res: any) {',
  '    const id = req.query.id;',
  "    const stmt = db.prepare('SELECT id, name FROM items WHERE id = ?');",
  '    const rows = stmt.all(id);',
  '    res.json(rows);',
  '  }',
  '  function handleSecond(req: any, res: any) {',
  '    const category = req.query.category;',
  "    const stmt = db.prepare('SELECT id, name FROM items WHERE category = ?');",
  '    const rows = stmt.all(category);',
  '    res.json(rows);',
  '  }',
  "  app.get('/items', handleFirst);",
  "  app.get('/items/category', handleSecond);",
  '  return app;',
  '}',
  '',
].join('\n');

describe('Chat-4 Pipeline Determinism Negative Control Multi-Stage', () => {
  it('preserves multi-stage determinism and non-authoritative bounds for negative control pipeline', async () => {
    const files = [{ path: 'src/app.ts', content: safeSource }];

    // Stage 1: Snapshot Ingestion
    const snapshotA = await captureSnapshot(
      {
        fixtureId: fixture,
        repositoryId: repo,
        organizationId: org,
        files,
      },
      org,
    );

    const snapshotB = await captureSnapshot(
      {
        fixtureId: fixture,
        repositoryId: repo,
        organizationId: org,
        files,
      },
      org,
    );

    expect(snapshotA.snapshotId).toBe(snapshotB.snapshotId);
    expect(snapshotA.totalBytes).toBe(snapshotB.totalBytes);
    expect(snapshotA.files.length).toBe(1);

    const validatedSnapshotA = await validateSnapshot(snapshotA, org);
    const validatedSnapshotB = await validateSnapshot(snapshotB, org);
    expect(validatedSnapshotA.snapshotId).toBe(snapshotA.snapshotId);
    expect(validatedSnapshotB.snapshotId).toBe(snapshotB.snapshotId);

    // Stage 2: Express Route Ingestion
    const expressA = await ingestExpress(snapshotA, org);
    const expressB = await ingestExpress(snapshotB, org);

    expect(expressA.ingestionIdentity).toBe(expressB.ingestionIdentity);
    expect(expressA.routes.length).toBe(2);
    expect(expressB.routes.length).toBe(2);

    const validatedExpressA = await validateExpressIngestion(expressA, org);
    const validatedExpressB = await validateExpressIngestion(expressB, org);
    expect(validatedExpressA.ingestionIdentity).toBe(expressA.ingestionIdentity);
    expect(validatedExpressB.ingestionIdentity).toBe(expressB.ingestionIdentity);

    // Stage 3: Abstract SQL Detection
    const analysisA = await detectSqlInjection(snapshotA, expressA, org);
    const analysisB = await detectSqlInjection(snapshotB, expressB, org);

    expect(analysisA.status).toBe('NOT_DETECTED');
    expect(analysisB.status).toBe('NOT_DETECTED');
    expect(analysisA.findings.length).toBe(0);
    expect(analysisB.findings.length).toBe(0);
    expect(analysisA.limitations.length).toBe(0);
    expect(analysisB.limitations.length).toBe(0);
    expect(analysisA.resultFingerprint).toBe(analysisB.resultFingerprint);

    const validatedAnalysisA = await validateSqlAnalysis(analysisA, snapshotA, expressA, org);
    const validatedAnalysisB = await validateSqlAnalysis(analysisB, snapshotB, expressB, org);
    expect(validatedAnalysisA.resultFingerprint).toBe(analysisA.resultFingerprint);
    expect(validatedAnalysisB.resultFingerprint).toBe(analysisB.resultFingerprint);

    // Stage 4: Candidate Bridge
    const bridge = createSqlCandidateBridge(() => Promise.resolve('0123456789abcdef0123456789abcdef01234567'));

    const candidatesA = await bridge(analysisA, snapshotA, expressA, org);
    const candidatesB = await bridge(analysisB, snapshotB, expressB, org);

    expect(candidatesA.length).toBe(0);
    expect(candidatesB.length).toBe(0);
    expect(candidatesA).toEqual([]);
    expect(candidatesB).toEqual([]);
  });
});
