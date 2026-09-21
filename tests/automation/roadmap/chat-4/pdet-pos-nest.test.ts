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

const sampleAppSource = `import express from 'express';

export function createApp(db: any) {
  const app = express();
  const router = express.Router();

  function searchHandler(req: any, res: any) {
    const q = req.query.q;
    const query = "SELECT * FROM accounts WHERE id = '" + q;
    const stmt = db.prepare(query);
    const rows = stmt.all();
    return res.json(rows);
  }

  router.get('/search', searchHandler);
  app.use('/nested', router);

  return app;
}
`;

describe('Pipeline Determinism Positive Control: Nested Routes', () => {
  it('deterministically ingests and detects SQL injection in nested router pipeline', async () => {
    const org = 'org_pdet_nest';
    const fixtureId = 'm2-case-001';
    const repositoryId = 'repo-nested-pos';
    const input = {
      fixtureId,
      repositoryId,
      organizationId: org,
      files: [{ path: 'src/app.ts', content: sampleAppSource }],
    };

    const snapshot1 = await captureSnapshot(input, org);
    const express1 = await ingestExpress(snapshot1, org);
    const analysis1 = await detectSqlInjection(snapshot1, express1, org);
    const fakeCommit = 'a'.repeat(40);
    const bridge1 = createSqlCandidateBridge(async () => fakeCommit);
    const candidates1 = await bridge1(analysis1, snapshot1, express1, org);

    const snapshot2 = await captureSnapshot(input, org);
    const express2 = await ingestExpress(snapshot2, org);
    const analysis2 = await detectSqlInjection(snapshot2, express2, org);
    const bridge2 = createSqlCandidateBridge(async () => fakeCommit);
    const candidates2 = await bridge2(analysis2, snapshot2, express2, org);

    expect(snapshot1.snapshotId).toBe(snapshot2.snapshotId);
    expect(snapshot1.totalBytes).toBe(snapshot2.totalBytes);
    expect(snapshot1.files[0].fileIdentity).toBe(snapshot2.files[0].fileIdentity);

    expect(express1.ingestionIdentity).toBe(express2.ingestionIdentity);
    expect(express1.routes).toHaveLength(1);
    expect(express1.routes[0].routeIdentity).toBe(express2.routes[0].routeIdentity);

    const route = express1.routes[0];
    expect(route.method).toBe('GET');
    expect(route.path).toBe('/nested/search');
    expect(route.declaredPath).toBe('/search');
    expect(route.owner).toBe('router');
    expect(route.ownerKind).toBe('ROUTER');
    expect(route.mount).not.toBeNull();
    expect(route.mount?.app).toBe('app');
    expect(route.mount?.prefix).toBe('/nested');

    expect(analysis1.status).toBe('DETECTED');
    expect(analysis2.status).toBe('DETECTED');
    expect(analysis1.resultFingerprint).toBe(analysis2.resultFingerprint);
    expect(analysis1.findings).toHaveLength(1);
    expect(analysis2.findings).toHaveLength(1);
    expect(analysis1.findings[0].findingId).toBe(analysis2.findings[0].findingId);
    expect(analysis1.findings[0].vulnerabilityClass).toBe('SQL_INJECTION');
    expect(analysis1.findings[0].routeIdentity).toBe(route.routeIdentity);
    expect(analysis1.limitations).toHaveLength(0);

    expect(candidates1).toHaveLength(1);
    expect(candidates2).toHaveLength(1);
    expect(candidates1[0].candidate.candidateId).toBe(candidates2[0].candidate.candidateId);
    expect(candidates1[0].candidateBinding).toBe(candidates2[0].candidateBinding);
    expect(candidates1[0].candidate.verificationState).toBe('CANDIDATE');
    expect(candidates1[0].candidate.reachabilityState).toBe('REACHABLE');
    expect(candidates1[0].candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect((candidates1[0].candidate as any).verificationState).not.toBe('VERIFIED');
    expect((candidates1[0] as any).capability).toBeUndefined();
  });

  it('validates snapshot, express, and analysis integrity with fail-closed rejection on tampering', async () => {
    const org = 'org_pdet_nest';
    const input = {
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-nested-pos',
      organizationId: org,
      files: [{ path: 'src/app.ts', content: sampleAppSource }],
    };

    const snapshot = await captureSnapshot(input, org);
    const expressIngestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);

    const validatedSnapshot = await validateSnapshot(snapshot, org);
    expect(validatedSnapshot.snapshotId).toBe(snapshot.snapshotId);

    const validatedExpress = await validateExpressIngestion(expressIngestion, org);
    expect(validatedExpress.ingestionIdentity).toBe(expressIngestion.ingestionIdentity);

    const validatedAnalysis = await validateSqlAnalysis(analysis, snapshot, expressIngestion, org);
    expect(validatedAnalysis.resultFingerprint).toBe(analysis.resultFingerprint);

    await expect(validateSnapshot(snapshot, 'foreign_org')).rejects.toThrow();
    await expect(validateExpressIngestion(expressIngestion, 'foreign_org')).rejects.toThrow();
    await expect(validateSqlAnalysis(analysis, snapshot, expressIngestion, 'foreign_org')).rejects.toThrow();
  });

  it('preserves determinism across nested directory source paths with nested router mounts', async () => {
    const org = 'org_pdet_nest_dir';
    const nestedInput = {
      fixtureId: 'm2-case-002',
      repositoryId: 'repo-nested-dir',
      organizationId: org,
      files: [{ path: 'src/nested/routes.ts', content: sampleAppSource }],
    };

    const snapA = await captureSnapshot(nestedInput, org);
    const snapB = await captureSnapshot(nestedInput, org);
    expect(snapA.snapshotId).toBe(snapB.snapshotId);

    const expA = await ingestExpress(snapA, org);
    const expB = await ingestExpress(snapB, org);
    expect(expA.ingestionIdentity).toBe(expB.ingestionIdentity);
    expect(expA.routes[0].path).toBe('/nested/search');

    const detA = await detectSqlInjection(snapA, expA, org);
    const detB = await detectSqlInjection(snapB, expB, org);
    expect(detA.status).toBe('DETECTED');
    expect(detA.resultFingerprint).toBe(detB.resultFingerprint);
  });
});
