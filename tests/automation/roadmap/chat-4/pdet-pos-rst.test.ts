import { describe, it, expect } from 'vitest';
import { captureSnapshot, validateSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress, validateExpressIngestion } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';

describe('Pipeline Determinism Positive Control: Restart and Resume', () => {
  const organizationId = 'org_pipeline_det';
  const repositoryId = 'repo_pipeline_det';
  const fixtureId = 'm2-case-001';
  const commitSha = 'a'.repeat(40);

  const fixtureFiles = [
    {
      path: 'src/routes.ts',
      content: `import express from 'express';

export function createApp(db: any) {
  function searchHandler(req: any, res: any) {
    const q = req.query.term;
    const stmt = db.prepare("SELECT * FROM items WHERE name = '" + q + "'");
    const rows = stmt.all();
    res.json(rows);
  }

  const app = express();
  app.get('/search', searchHandler);
  return app;
}
`,
    },
  ];

  it('preserves determinism across full pipeline cold restart', async () => {
    const input = {
      fixtureId,
      repositoryId,
      organizationId,
      files: fixtureFiles,
    };

    const snapshot1 = await captureSnapshot(input, organizationId);
    const express1 = await ingestExpress(snapshot1, organizationId);
    const analysis1 = await detectSqlInjection(snapshot1, express1, organizationId);

    expect(analysis1.status).toBe('DETECTED');
    expect(analysis1.findings.length).toBe(1);

    const bridge1 = createSqlCandidateBridge(async () => commitSha);
    const candidates1 = await bridge1(analysis1, snapshot1, express1, organizationId);
    expect(candidates1.length).toBe(1);
    expect(candidates1[0].candidate.verificationState).toBe('CANDIDATE');

    const snapshot2 = await captureSnapshot(input, organizationId);
    const express2 = await ingestExpress(snapshot2, organizationId);
    const analysis2 = await detectSqlInjection(snapshot2, express2, organizationId);
    const bridge2 = createSqlCandidateBridge(async () => commitSha);
    const candidates2 = await bridge2(analysis2, snapshot2, express2, organizationId);

    expect(snapshot2.snapshotId).toBe(snapshot1.snapshotId);
    expect(express2.ingestionIdentity).toBe(express1.ingestionIdentity);
    expect(analysis2.resultFingerprint).toBe(analysis1.resultFingerprint);
    expect(analysis2.findings).toEqual(analysis1.findings);
    expect(candidates2[0].candidate.candidateId).toBe(candidates1[0].candidate.candidateId);
    expect(candidates2[0].candidateBinding).toBe(candidates1[0].candidateBinding);
  });

  it('preserves determinism when resuming from serialized snapshot checkpoint', async () => {
    const input = {
      fixtureId,
      repositoryId,
      organizationId,
      files: fixtureFiles,
    };

    const baselineSnapshot = await captureSnapshot(input, organizationId);
    const baselineExpress = await ingestExpress(baselineSnapshot, organizationId);
    const baselineAnalysis = await detectSqlInjection(baselineSnapshot, baselineExpress, organizationId);

    const serializedSnapshot = JSON.parse(JSON.stringify(baselineSnapshot));
    const resumedSnapshot = await validateSnapshot(serializedSnapshot, organizationId);
    expect(resumedSnapshot.snapshotId).toBe(baselineSnapshot.snapshotId);

    const resumedExpress = await ingestExpress(resumedSnapshot, organizationId);
    expect(resumedExpress.ingestionIdentity).toBe(baselineExpress.ingestionIdentity);

    const resumedAnalysis = await detectSqlInjection(resumedSnapshot, resumedExpress, organizationId);
    expect(resumedAnalysis.resultFingerprint).toBe(baselineAnalysis.resultFingerprint);
    expect(resumedAnalysis.status).toBe('DETECTED');
    expect(resumedAnalysis.findings).toEqual(baselineAnalysis.findings);
  });

  it('preserves determinism when resuming from serialized express ingestion checkpoint', async () => {
    const input = {
      fixtureId,
      repositoryId,
      organizationId,
      files: fixtureFiles,
    };

    const snapshot = await captureSnapshot(input, organizationId);
    const express = await ingestExpress(snapshot, organizationId);
    const baselineAnalysis = await detectSqlInjection(snapshot, express, organizationId);

    const serializedExpress = JSON.parse(JSON.stringify(express));
    const resumedExpress = await validateExpressIngestion(serializedExpress, organizationId);
    expect(resumedExpress.ingestionIdentity).toBe(express.ingestionIdentity);

    const resumedAnalysis = await detectSqlInjection(snapshot, resumedExpress, organizationId);
    expect(resumedAnalysis.resultFingerprint).toBe(baselineAnalysis.resultFingerprint);
    expect(resumedAnalysis.status).toBe('DETECTED');
    expect(resumedAnalysis.findings).toEqual(baselineAnalysis.findings);

    const serializedAnalysis = JSON.parse(JSON.stringify(resumedAnalysis));
    const validatedAnalysis = await validateSqlAnalysis(serializedAnalysis, snapshot, resumedExpress, organizationId);
    expect(validatedAnalysis.resultFingerprint).toBe(baselineAnalysis.resultFingerprint);
  });
});
