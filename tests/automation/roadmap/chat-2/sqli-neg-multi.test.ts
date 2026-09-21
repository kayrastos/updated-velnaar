import { describe, expect, it, vi } from 'vitest';
import { captureSnapshot, type SnapshotInput } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';

const ORG = 'org_roadmap';

function createMultiStageNegativeInput(fixtureId = 'm2-case-001', variant: 'parameterized' | 'constant' = 'parameterized'): SnapshotInput {
  const parameterizedBody = `
import express from 'express';

export function createApp(db: any) {
  const app = express();

  function buildQuery() {
    return 'SELECT id, name FROM items WHERE category = ?';
  }

  function executeQuery(targetDb: any, query: string, param: string) {
    const stmt = targetDb.prepare(query);
    return stmt.all(param);
  }

  function lookup(targetDb: any, q: string) {
    const query = buildQuery();
    return executeQuery(targetDb, query, q);
  }

  function searchRoute(req: any, res: any) {
    const q = req.query.q;
    const rows = lookup(db, q);
    return res.json(rows);
  }

  app.get('/search', searchRoute);
  return app;
}
`;

  const constantBody = `
import express from 'express';

export function createApp(db: any) {
  const app = express();

  function buildQuery() {
    return 'SELECT id, name FROM items WHERE active = 1';
  }

  function executeQuery(targetDb: any, query: string) {
    const stmt = targetDb.prepare(query);
    return stmt.all();
  }

  function lookup(targetDb: any, _unused: string) {
    const query = buildQuery();
    return executeQuery(targetDb, query);
  }

  function searchRoute(req: any, res: any) {
    const q = req.query.q;
    const rows = lookup(db, q);
    return res.json(rows);
  }

  app.get('/search', searchRoute);
  return app;
}
`;

  return {
    fixtureId,
    repositoryId: 'repo-sqli-neg-multi',
    organizationId: ORG,
    files: [
      {
        path: 'src/routes.ts',
        content: variant === 'parameterized' ? parameterizedBody : constantBody,
      },
    ],
  };
}

describe('Roadmap Chat-2 SQL injection multi-stage negative control', () => {
  it('evaluates multi-stage helper pipeline with bound parameter as NOT_DETECTED', async () => {
    const input = createMultiStageNegativeInput('m2-case-001', 'parameterized');
    const snapshot = await captureSnapshot(input, ORG);
    const ingestion = await ingestExpress(snapshot, ORG);
    const analysis = await detectSqlInjection(snapshot, ingestion, ORG);

    expect(analysis.status).toBe('NOT_DETECTED');
    expect(analysis.findings).toHaveLength(0);
    expect(analysis.limitations).toHaveLength(0);

    const validated = await validateSqlAnalysis(analysis, snapshot, ingestion, ORG);
    expect(validated.status).toBe('NOT_DETECTED');
    expect(validated.resultFingerprint).toBe(analysis.resultFingerprint);
  });

  it('evaluates multi-stage helper pipeline with constant SQL text as NOT_DETECTED', async () => {
    const input = createMultiStageNegativeInput('m2-case-002', 'constant');
    const snapshot = await captureSnapshot(input, ORG);
    const ingestion = await ingestExpress(snapshot, ORG);
    const analysis = await detectSqlInjection(snapshot, ingestion, ORG);

    expect(analysis.status).toBe('NOT_DETECTED');
    expect(analysis.findings).toHaveLength(0);
    expect(analysis.limitations).toHaveLength(0);

    const validated = await validateSqlAnalysis(analysis, snapshot, ingestion, ORG);
    expect(validated.status).toBe('NOT_DETECTED');
  });

  it('produces no candidate hypotheses and bypasses commit verifier for multi-stage negative control', async () => {
    const input = createMultiStageNegativeInput('m2-case-003', 'parameterized');
    const snapshot = await captureSnapshot(input, ORG);
    const ingestion = await ingestExpress(snapshot, ORG);
    const analysis = await detectSqlInjection(snapshot, ingestion, ORG);

    const verifier = vi.fn();
    const bridge = createSqlCandidateBridge(verifier);
    const candidates = await bridge(analysis, snapshot, ingestion, ORG);

    expect(candidates).toEqual([]);
    expect(verifier).not.toHaveBeenCalled();
  });
});
