import { describe, it, expect } from 'vitest';
import { captureSnapshot, validateSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress, validateExpressIngestion } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';

const org = 'org_pdet_nest_rst';
const repoId = 'repo-pdet-nest-rst';
const fixtureId = 'm2-case-001';
const checkedCommitSha = 'a'.repeat(40);

const nestedSourceCode = `import express from 'express';

function buildQuery(input: string): string {
  const query = "SELECT * FROM items WHERE category = '" + input + "'";
  return query;
}

function executeQuery(db: any, input: string): any {
  const sql = buildQuery(input);
  const stmt = db.prepare(sql);
  return stmt.all();
}

export function createApp(db: any) {
  const app = express();
  const router = express.Router();

  function searchHandler(req: any, res: any) {
    const category = req.query.category;
    const rows = executeQuery(db, category);
    return res.json(rows);
  }

  router.get('/search', searchHandler);
  app.use('/nested', router);
  return app;
}
`;

describe('Pipeline Determinism - Nested Flow Restart and Resume', () => {
  it('proves pipeline determinism for nested router and helper call flows across clean restart', async () => {
    const inputPass1 = {
      fixtureId,
      repositoryId: repoId,
      organizationId: org,
      files: [{ path: 'src/nestedApp.ts', content: nestedSourceCode }],
    };
    const snapshot1 = await captureSnapshot(inputPass1, org);
    const ingestion1 = await ingestExpress(snapshot1, org);
    const analysis1 = await detectSqlInjection(snapshot1, ingestion1, org);
    const bridge1 = createSqlCandidateBridge(async () => checkedCommitSha);
    const candidates1 = await bridge1(analysis1, snapshot1, ingestion1, org);

    const inputPass2 = {
      fixtureId,
      repositoryId: repoId,
      organizationId: org,
      files: [{ path: 'src/nestedApp.ts', content: nestedSourceCode }],
    };
    const snapshot2 = await captureSnapshot(inputPass2, org);
    const ingestion2 = await ingestExpress(snapshot2, org);
    const analysis2 = await detectSqlInjection(snapshot2, ingestion2, org);
    const bridge2 = createSqlCandidateBridge(async () => checkedCommitSha);
    const candidates2 = await bridge2(analysis2, snapshot2, ingestion2, org);

    expect(snapshot2.snapshotId).toBe(snapshot1.snapshotId);
    expect(snapshot2.totalBytes).toBe(snapshot1.totalBytes);
    expect(ingestion2.ingestionIdentity).toBe(ingestion1.ingestionIdentity);
    expect(analysis2.resultFingerprint).toBe(analysis1.resultFingerprint);
    expect(analysis2.status).toBe('DETECTED');
    expect(analysis2.findings).toHaveLength(1);
    expect(candidates2).toHaveLength(1);
    expect(candidates2[0].candidateBinding).toBe(candidates1[0].candidateBinding);
    expect(candidates2[0].candidate.candidateId).toBe(candidates1[0].candidate.candidateId);
    expect(candidates2).toEqual(candidates1);

    const route = ingestion1.routes[0];
    expect(route.path).toBe('/nested/search');
    expect(route.ownerKind).toBe('ROUTER');
    expect(route.mount?.prefix).toBe('/nested');
    expect(route.mount?.app).toBe('app');
  });

  it('proves pipeline determinism and boundary verification when resuming from serialized state', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId,
        repositoryId: repoId,
        organizationId: org,
        files: [{ path: 'src/nestedApp.ts', content: nestedSourceCode }],
      },
      org,
    );
    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);
    const bridge = createSqlCandidateBridge(async () => checkedCommitSha);
    const baselineCandidates = await bridge(analysis, snapshot, ingestion, org);

    const serializedSnapshot = JSON.stringify(snapshot);
    const serializedIngestion = JSON.stringify(ingestion);
    const serializedAnalysis = JSON.stringify(analysis);

    const resumedSnapshot = await validateSnapshot(JSON.parse(serializedSnapshot), org);
    const resumedIngestion = await validateExpressIngestion(JSON.parse(serializedIngestion), org);
    const resumedAnalysis = await validateSqlAnalysis(
      JSON.parse(serializedAnalysis),
      resumedSnapshot,
      resumedIngestion,
      org,
    );

    expect(resumedSnapshot.snapshotId).toBe(snapshot.snapshotId);
    expect(resumedIngestion.ingestionIdentity).toBe(ingestion.ingestionIdentity);
    expect(resumedAnalysis.resultFingerprint).toBe(analysis.resultFingerprint);

    const resumedCandidates = await bridge(resumedAnalysis, resumedSnapshot, resumedIngestion, org);
    expect(resumedCandidates).toEqual(baselineCandidates);
  });

  it('fails closed when restarting or resuming with corrupted or forged intermediate artifacts', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId,
        repositoryId: repoId,
        organizationId: org,
        files: [{ path: 'src/nestedApp.ts', content: nestedSourceCode }],
      },
      org,
    );
    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);

    const forgedSnapshotId = { ...snapshot, snapshotId: 'sha256:' + '0'.repeat(64) };
    await expect(validateSnapshot(forgedSnapshotId, org)).rejects.toThrow();

    const forgedIngestionRoutes = { ...ingestion, routes: [] };
    await expect(validateExpressIngestion(forgedIngestionRoutes as any, org)).rejects.toThrow();

    const forgedAnalysisFingerprint = {
      ...analysis,
      resultFingerprint: 'sha256:' + '0'.repeat(64),
    };
    await expect(
      validateSqlAnalysis(forgedAnalysisFingerprint, snapshot, ingestion, org),
    ).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');

    await expect(validateSnapshot(snapshot, 'foreign_org')).rejects.toThrow('tenant mismatch');
    await expect(validateExpressIngestion(ingestion, 'foreign_org')).rejects.toThrow('tenant mismatch');
  });

  it('preserves non-authoritative boundary: candidate findings never mint or imply VERIFIED authority', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId,
        repositoryId: repoId,
        organizationId: org,
        files: [{ path: 'src/nestedApp.ts', content: nestedSourceCode }],
      },
      org,
    );
    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);
    const bridge = createSqlCandidateBridge(async () => checkedCommitSha);
    const hypotheses = await bridge(analysis, snapshot, ingestion, org);

    expect(hypotheses.length).toBeGreaterThan(0);
    for (const item of hypotheses) {
      expect(item.candidate.verificationState).toBe('CANDIDATE');
      expect((item.candidate as any).verificationState).not.toBe('VERIFIED');
      expect(item.candidate.reachabilityState).toBe('REACHABLE');
      expect(item.candidate.vulnerabilityClass).toBe('SQL_INJECTION');
      expect(item.candidate.sensorEvidence[0].sensorType).toBe('VELNAR_STRUCTURAL');
    }

    const zeroCommitBridge = createSqlCandidateBridge(async () => '0'.repeat(40));
    await expect(zeroCommitBridge(analysis, snapshot, ingestion, org)).rejects.toThrow(
      'M3_CHECKED_COMMIT_REQUIRED',
    );
  });
});
