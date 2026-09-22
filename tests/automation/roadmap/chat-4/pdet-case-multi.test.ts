import { describe, it, expect } from 'vitest';
import { captureSnapshot, validateSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress, validateExpressIngestion } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';

const org = 'org_pdet_multi';
const repo = 'repo_pdet_multi';
const fixtureId = 'm2-case-001';
const commitSha = '2'.repeat(40);

const multiCaseExpressApp = `
import express from 'express';

export function createApp(db: any) {
  const app = express();

  function handleVulnerable(req: any, res: any) {
    const q = req.query.userId;
    const sql = "SELECT * FROM users WHERE id = '" + q + "'";
    const stmt = db.prepare(sql);
    const rows = stmt.all();
    res.json(rows);
  }

  function handleSafe(req: any, res: any) {
    const q = req.query.userId;
    const stmt = db.prepare("SELECT * FROM users WHERE id = ?");
    const rows = stmt.all(q);
    res.json(rows);
  }

  app.get('/api/users', handleVulnerable);
  app.get('/api/USERS', handleSafe);

  return app;
}
`;

const paramCaseExpressApp = `
import express from 'express';

export function createApp(db: any) {
  const app = express();

  function handleLower(req: any, res: any) {
    const q = req.query.token;
    const sql = "SELECT * FROM tokens WHERE t = '" + q + "'";
    const stmt = db.prepare(sql);
    const rows = stmt.all();
    res.json(rows);
  }

  function handleUpper(req: any, res: any) {
    const q = req.query.TOKEN;
    const sql = "SELECT * FROM tokens WHERE t = '" + q + "'";
    const stmt = db.prepare(sql);
    const rows = stmt.all();
    res.json(rows);
  }

  app.get('/api/lookup-lower', handleLower);
  app.get('/api/lookup-upper', handleUpper);

  return app;
}
`;

describe('Multi-Stage Pipeline Determinism and Case Sensitivity', () => {
  it('preserves route case discrimination across full 4-stage pipeline deterministically', async () => {
    const runPipeline = async () => {
      const snapshot = await captureSnapshot({
        fixtureId,
        repositoryId: repo,
        organizationId: org,
        files: [{ path: 'src/routes.ts', content: multiCaseExpressApp }],
      }, org);

      const validatedSnap = await validateSnapshot(snapshot, org);
      const expressIngestion = await ingestExpress(validatedSnap, org);
      const validatedExpress = await validateExpressIngestion(expressIngestion, org);
      const sqlAnalysis = await detectSqlInjection(validatedSnap, validatedExpress, org);
      const validatedAnalysis = await validateSqlAnalysis(sqlAnalysis, validatedSnap, validatedExpress, org);

      const bridge = createSqlCandidateBridge(async () => commitSha);
      const candidates = await bridge(validatedAnalysis, validatedSnap, validatedExpress, org);

      return { snapshot: validatedSnap, expressIngestion: validatedExpress, sqlAnalysis: validatedAnalysis, candidates };
    };

    const run1 = await runPipeline();
    const run2 = await runPipeline();

    expect(run1.snapshot.snapshotId).toBe(run2.snapshot.snapshotId);
    expect(run1.expressIngestion.ingestionIdentity).toBe(run2.expressIngestion.ingestionIdentity);
    expect(run1.sqlAnalysis.resultFingerprint).toBe(run2.sqlAnalysis.resultFingerprint);

    expect(run1.expressIngestion.routes).toHaveLength(2);
    const lowerRoute = run1.expressIngestion.routes.find(r => r.path === '/api/users')!;
    const upperRoute = run1.expressIngestion.routes.find(r => r.path === '/api/USERS')!;
    expect(lowerRoute).toBeDefined();
    expect(upperRoute).toBeDefined();
    expect(lowerRoute.routeIdentity).not.toBe(upperRoute.routeIdentity);

    expect(run1.sqlAnalysis.status).toBe('DETECTED');
    expect(run1.sqlAnalysis.findings).toHaveLength(1);
    expect(run1.sqlAnalysis.findings[0].routeIdentity).toBe(lowerRoute.routeIdentity);

    expect(run1.candidates).toHaveLength(1);
    expect(run2.candidates).toHaveLength(1);
    expect(run1.candidates[0].candidateBinding).toBe(run2.candidates[0].candidateBinding);
    expect(run1.candidates[0].candidate.candidateId).toBe(run2.candidates[0].candidate.candidateId);
    expect(run1.candidates[0].candidate.context.routeId).toBe(lowerRoute.routeIdentity);
    expect(run1.candidates[0].candidate.reachabilityState).toBe('REACHABLE');
    expect(run1.candidates[0].candidate.verificationState).toBe('CANDIDATE');
    expect(run1.candidates[0].candidate.snapshot.commitSha).toBe(commitSha);
  });

  it('preserves query parameter symbol casing deterministically across detection and candidate stages', async () => {
    const snapshot = await captureSnapshot({
      fixtureId,
      repositoryId: repo,
      organizationId: org,
      files: [{ path: 'src/routes.ts', content: paramCaseExpressApp }],
    }, org);

    const expressIngestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);

    expect(analysis.status).toBe('DETECTED');
    expect(analysis.findings).toHaveLength(2);

    const findingLower = analysis.findings.find(f => f.source.symbol === 'query.token')!;
    const findingUpper = analysis.findings.find(f => f.source.symbol === 'query.TOKEN')!;
    expect(findingLower).toBeDefined();
    expect(findingUpper).toBeDefined();
    expect(findingLower.findingId).not.toBe(findingUpper.findingId);

    const bridge = createSqlCandidateBridge(async () => commitSha);
    const candidates = await bridge(analysis, snapshot, expressIngestion, org);

    expect(candidates).toHaveLength(2);
    const candLower = candidates.find(c => c.candidate.source.symbol === 'query.token')!;
    const candUpper = candidates.find(c => c.candidate.source.symbol === 'query.TOKEN')!;
    expect(candLower).toBeDefined();
    expect(candUpper).toBeDefined();
    expect(candLower.candidate.candidateId).not.toBe(candUpper.candidate.candidateId);
    expect(candLower.candidateBinding).not.toBe(candUpper.candidateBinding);
  });

  it('rejects tampered route casing during cross-stage validation', async () => {
    const snapshot = await captureSnapshot({
      fixtureId,
      repositoryId: repo,
      organizationId: org,
      files: [{ path: 'src/routes.ts', content: multiCaseExpressApp }],
    }, org);

    const expressIngestion = await ingestExpress(snapshot, org);
    const tamperedIngestion: any = {
      ...expressIngestion,
      routes: expressIngestion.routes.map(r => ({
        ...r,
        path: r.path.toLowerCase(),
      })),
    };

    await expect(validateExpressIngestion(tamperedIngestion, org)).rejects.toThrow();
  });

  it('fails closed deterministically at stage 1 on case-colliding file paths', async () => {
    await expect(captureSnapshot({
      fixtureId,
      repositoryId: repo,
      organizationId: org,
      files: [
        { path: 'src/routes.ts', content: 'export const a = 1;\n' },
        { path: 'src/ROUTES.ts', content: 'export const b = 2;\n' },
      ],
    }, org)).rejects.toThrow('duplicate canonical path');
  });
});
