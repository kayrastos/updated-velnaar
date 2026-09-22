import { describe, it, expect } from 'vitest';
import { captureSnapshot, validateSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress, validateExpressIngestion } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';

const org = 'org_pdet_reg_nest';
const repo = 'repo_pdet_reg_nest';
const fixtureId = 'm2-case-001';
const commitSha = '1234567890abcdef1234567890abcdef12345678';

const appSource = `import express from 'express';

export function createApp(db: any) {
  const app = express();
  const router = express.Router();

  function getNestedVulnerable(req: any, res: any) {
    const term = req.query.term;
    const stmt = db.prepare('SELECT * FROM items WHERE name = ' + term);
    const rows = stmt.all();
    return res.json(rows);
  }

  function getNestedSafe(req: any, res: any) {
    const id = req.query.id;
    const stmt = db.prepare('SELECT * FROM items WHERE id = ?');
    const rows = stmt.all(id);
    return res.json(rows);
  }

  router.get('/vulnerable', getNestedVulnerable);
  router.get('/safe', getNestedSafe);
  app.use('/api/nested', router);

  return app;
}
`;

describe('Pipeline Determinism Regression Lock - Nested Routes', () => {
  it('deterministically captures snapshot and ingests nested express router routes', async () => {
    const input = {
      fixtureId,
      repositoryId: repo,
      organizationId: org,
      files: [{ path: 'src/app.ts', content: appSource }],
    };

    const snap1 = await captureSnapshot(input, org);
    const snap2 = await captureSnapshot(input, org);
    expect(snap1.snapshotId).toBe(snap2.snapshotId);
    expect(snap1.totalBytes).toBe(snap2.totalBytes);

    const validSnap = await validateSnapshot(snap1, org);
    expect(validSnap.snapshotId).toBe(snap1.snapshotId);

    const ing1 = await ingestExpress(snap1, org);
    const ing2 = await ingestExpress(snap2, org);
    expect(ing1.ingestionIdentity).toBe(ing2.ingestionIdentity);
    expect(ing1.routes.length).toBe(2);

    const validIng = await validateExpressIngestion(ing1, org);
    expect(validIng.ingestionIdentity).toBe(ing1.ingestionIdentity);

    const vulnRoute = ing1.routes.find((r) => r.path === '/api/nested/vulnerable');
    const safeRoute = ing1.routes.find((r) => r.path === '/api/nested/safe');
    expect(vulnRoute).toBeDefined();
    expect(safeRoute).toBeDefined();
    expect(vulnRoute?.declaredPath).toBe('/vulnerable');
    expect(vulnRoute?.mount?.prefix).toBe('/api/nested');
    expect(vulnRoute?.ownerKind).toBe('ROUTER');
  });

  it('preserves SQL injection detection determinism across repeated nested route analyses', async () => {
    const snap = await captureSnapshot(
      {
        fixtureId,
        repositoryId: repo,
        organizationId: org,
        files: [{ path: 'src/app.ts', content: appSource }],
      },
      org,
    );
    const ing = await ingestExpress(snap, org);

    const analysis1 = await detectSqlInjection(snap, ing, org);
    const analysis2 = await detectSqlInjection(snap, ing, org);

    expect(analysis1.status).toBe('DETECTED');
    expect(analysis2.status).toBe('DETECTED');
    expect(analysis1.resultFingerprint).toBe(analysis2.resultFingerprint);
    expect(analysis1.findings.length).toBe(1);
    expect(analysis2.findings.length).toBe(1);

    const vulnRoute = ing.routes.find((r) => r.path === '/api/nested/vulnerable')!;
    expect(analysis1.findings[0].routeIdentity).toBe(vulnRoute.routeIdentity);
    expect(analysis1.findings[0].findingId).toBe(analysis2.findings[0].findingId);

    const validAnalysis = await validateSqlAnalysis(analysis1, snap, ing, org);
    expect(validAnalysis.resultFingerprint).toBe(analysis1.resultFingerprint);
  });

  it('locks candidate hypothesis generation and bindings without granting verified authority', async () => {
    const snap = await captureSnapshot(
      {
        fixtureId,
        repositoryId: repo,
        organizationId: org,
        files: [{ path: 'src/app.ts', content: appSource }],
      },
      org,
    );
    const ing = await ingestExpress(snap, org);
    const analysis = await detectSqlInjection(snap, ing, org);

    const bridge = createSqlCandidateBridge(async () => commitSha);
    const hypotheses1 = await bridge(analysis, snap, ing, org);
    const hypotheses2 = await bridge(analysis, snap, ing, org);

    expect(hypotheses1.length).toBe(1);
    expect(hypotheses2.length).toBe(1);
    expect(hypotheses1[0].candidate.candidateId).toBe(hypotheses2[0].candidate.candidateId);
    expect(hypotheses1[0].candidateBinding).toBe(hypotheses2[0].candidateBinding);

    expect(hypotheses1[0].candidate.verificationState).toBe('CANDIDATE');
    expect((hypotheses1[0].candidate as any).verificationState).not.toBe('VERIFIED');
    expect((hypotheses1[0] as any).capability).toBeUndefined();
  });
});
