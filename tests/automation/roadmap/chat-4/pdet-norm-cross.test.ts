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
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';

const org = 'org_pdet_norm_cross';

const helperCode = `export function buildQuery(term: string) {
  const query = 'SELECT id, username FROM users WHERE tenant = ' + term;
  return query;
}
`;

const appCode = `import express from 'express';
import { buildQuery } from './helper';

export function createApp(db: any) {
  const app = express();

  function listUsers(req: any, res: any) {
    const q = buildQuery(req.query.id);
    const stmt = db.prepare(q);
    return res.json(stmt.all());
  }

  app.get('/api/users', listUsers);
  return app;
}
`;

describe('V1 Pipeline Determinism: Normalization Boundary (Cross-File)', () => {
  it('normalizes cross-file snapshot ordering deterministically and produces identical analysis fingerprints', async () => {
    const fileHelper = { path: 'src/helper.ts', content: helperCode };
    const fileApp = { path: 'src/app.ts', content: appCode };

    const snapshotForward = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-pdet-norm',
        organizationId: org,
        files: [fileHelper, fileApp],
      },
      org,
    );

    const snapshotReverse = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-pdet-norm',
        organizationId: org,
        files: [fileApp, fileHelper],
      },
      org,
    );

    expect(snapshotForward.snapshotId).toBe(snapshotReverse.snapshotId);
    expect(snapshotForward.totalBytes).toBe(snapshotReverse.totalBytes);
    expect(snapshotForward.files).toHaveLength(2);
    expect(snapshotForward.files[0].path).toBe('src/app.ts');
    expect(snapshotForward.files[1].path).toBe('src/helper.ts');
    expect(snapshotReverse.files[0].path).toBe('src/app.ts');
    expect(snapshotReverse.files[1].path).toBe('src/helper.ts');

    const validatedSnapshot = await validateSnapshot(snapshotForward, org);
    expect(validatedSnapshot.snapshotId).toBe(snapshotForward.snapshotId);

    const ingestionForward = await ingestExpress(snapshotForward, org);
    const ingestionReverse = await ingestExpress(snapshotReverse, org);

    expect(ingestionForward.ingestionIdentity).toBe(ingestionReverse.ingestionIdentity);
    expect(ingestionForward.routes).toHaveLength(1);
    expect(ingestionForward.routes[0].routeIdentity).toBe(ingestionReverse.routes[0].routeIdentity);

    const validatedIngestion = await validateExpressIngestion(ingestionForward, org);
    expect(validatedIngestion.ingestionIdentity).toBe(ingestionForward.ingestionIdentity);

    const analysisForward = await detectSqlInjection(snapshotForward, ingestionForward, org);
    const analysisReverse = await detectSqlInjection(snapshotReverse, ingestionReverse, org);

    expect(analysisForward.status).toBe('DETECTED');
    expect(analysisReverse.status).toBe('DETECTED');
    expect(analysisForward.resultFingerprint).toBe(analysisReverse.resultFingerprint);
    expect(analysisForward.findings).toHaveLength(1);
    expect(analysisReverse.findings).toHaveLength(1);
    expect(analysisForward.findings[0].findingId).toBe(analysisReverse.findings[0].findingId);

    const validatedAnalysis = await validateSqlAnalysis(
      analysisForward,
      snapshotForward,
      ingestionForward,
      org,
    );
    expect(validatedAnalysis.resultFingerprint).toBe(analysisForward.resultFingerprint);

    const flowFiles = new Set(analysisForward.findings[0].flow.map((step) => step.location.filePath));
    expect(flowFiles.has('src/app.ts')).toBe(true);
    expect(flowFiles.has('src/helper.ts')).toBe(true);
  });

  it('preserves non-authoritative candidate boundary across cross-file hypotheses', async () => {
    const fileHelper = { path: 'src/helper.ts', content: helperCode };
    const fileApp = { path: 'src/app.ts', content: appCode };

    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-pdet-norm-candidate',
        organizationId: org,
        files: [fileApp, fileHelper],
      },
      org,
    );

    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);
    expect(analysis.status).toBe('DETECTED');

    const fakeSha = 'a'.repeat(40);
    const candidateBridge = createSqlCandidateBridge(async () => fakeSha);
    const hypotheses = await candidateBridge(analysis, snapshot, ingestion, org);

    expect(hypotheses).toHaveLength(1);
    expect(hypotheses[0].candidate.verificationState).toBe('CANDIDATE');
    expect(hypotheses[0].candidate.reachabilityState).toBe('REACHABLE');
    expect(hypotheses[0].candidate.snapshot.commitSha).toBe(fakeSha);
    expect((hypotheses[0].candidate as any).verificationState).not.toBe('VERIFIED');

    const refusingBridge = createSqlCandidateBridge(async () => {
      throw new Error('M3_CHECKED_COMMIT_REQUIRED');
    });

    await expect(
      refusingBridge(analysis, snapshot, ingestion, org),
    ).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
  });

  it('rejects canonical path collisions across case variations at normalization boundary', async () => {
    const fileApp = { path: 'src/app.ts', content: appCode };
    const collidingFile = { path: 'SRC/APP.TS', content: appCode };

    await expect(
      captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: 'repo-pdet-norm-collision',
          organizationId: org,
          files: [fileApp, collidingFile],
        },
        org,
      ),
    ).rejects.toThrow();
  });
});
