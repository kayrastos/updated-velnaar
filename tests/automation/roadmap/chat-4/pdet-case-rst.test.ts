import { describe, it, expect } from 'vitest';
import { captureSnapshot, validateSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress, validateExpressIngestion } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';

const orgId = 'org_case_pdet';
const repoId = 'case-pdet-repo';
const fixtureId = 'm2-case-001';

const caseSourceCode = `import express from 'express';

export function createApp(db) {
  const app = express();

  function handleCaseAudit(req, res) {
    const caseToken = req.query.CaseToken;
    const stmt = db.prepare('SELECT * FROM audits WHERE token = ' + caseToken);
    return res.json(stmt.all());
  }

  app.get('/api/CaseAudit', handleCaseAudit);
  return app;
}
`;

describe('Chat-4 Pipeline Determinism: Case Sensitivity and Restart Resume', () => {
  it('deterministically captures, ingests, detects, and resumes case-sensitive pipeline state', async () => {
    const snapshot = await captureSnapshot({
      fixtureId,
      repositoryId: repoId,
      organizationId: orgId,
      files: [{ path: 'src/CaseSensitiveApp.ts', content: caseSourceCode }],
    }, orgId);

    expect(snapshot.snapshotId).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(snapshot.files[0].path).toBe('src/CaseSensitiveApp.ts');

    const ingestion = await ingestExpress(snapshot, orgId);
    expect(ingestion.ingestionIdentity).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(ingestion.routes).toHaveLength(1);
    expect(ingestion.routes[0].path).toBe('/api/CaseAudit');
    expect(ingestion.routes[0].method).toBe('GET');

    const analysis = await detectSqlInjection(snapshot, ingestion, orgId);
    expect(analysis.status).toBe('DETECTED');
    expect(analysis.resultFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(analysis.findings).toHaveLength(1);
    expect(analysis.findings[0].source.symbol).toBe('query.CaseToken');

    const serializedSnapshot = JSON.parse(JSON.stringify(snapshot));
    const serializedIngestion = JSON.parse(JSON.stringify(ingestion));
    const serializedAnalysis = JSON.parse(JSON.stringify(analysis));

    const resumedSnapshot = await validateSnapshot(serializedSnapshot, orgId);
    expect(resumedSnapshot.snapshotId).toBe(snapshot.snapshotId);

    const resumedIngestion = await validateExpressIngestion(serializedIngestion, orgId);
    expect(resumedIngestion.ingestionIdentity).toBe(ingestion.ingestionIdentity);
    expect(resumedIngestion.routes[0].path).toBe('/api/CaseAudit');

    const resumedAnalysis = await validateSqlAnalysis(serializedAnalysis, resumedSnapshot, resumedIngestion, orgId);
    expect(resumedAnalysis.resultFingerprint).toBe(analysis.resultFingerprint);
    expect(resumedAnalysis.status).toBe('DETECTED');
    expect(resumedAnalysis.findings[0].source.symbol).toBe('query.CaseToken');

    const replaySnapshot = await captureSnapshot({
      fixtureId,
      repositoryId: repoId,
      organizationId: orgId,
      files: [{ path: 'src/CaseSensitiveApp.ts', content: caseSourceCode }],
    }, orgId);
    const replayIngestion = await ingestExpress(replaySnapshot, orgId);
    const replayAnalysis = await detectSqlInjection(replaySnapshot, replayIngestion, orgId);

    expect(replaySnapshot.snapshotId).toBe(snapshot.snapshotId);
    expect(replayIngestion.ingestionIdentity).toBe(ingestion.ingestionIdentity);
    expect(replayAnalysis.resultFingerprint).toBe(analysis.resultFingerprint);
  });

  it('fails closed on case collisions during snapshot capture', async () => {
    await expect(captureSnapshot({
      fixtureId,
      repositoryId: repoId,
      organizationId: orgId,
      files: [
        { path: 'src/CaseSensitiveApp.ts', content: caseSourceCode },
        { path: 'src/casesensitiveapp.ts', content: caseSourceCode },
      ],
    }, orgId)).rejects.toThrow('duplicate canonical path');
  });

  it('fails closed on altered case or corrupted state across restart resume', async () => {
    const snapshot = await captureSnapshot({
      fixtureId,
      repositoryId: repoId,
      organizationId: orgId,
      files: [{ path: 'src/CaseSensitiveApp.ts', content: caseSourceCode }],
    }, orgId);
    const ingestion = await ingestExpress(snapshot, orgId);
    const analysis = await detectSqlInjection(snapshot, ingestion, orgId);

    const tamperedSnapshot = JSON.parse(JSON.stringify(snapshot));
    tamperedSnapshot.files[0].path = 'src/casesensitiveapp.ts';
    await expect(validateSnapshot(tamperedSnapshot, orgId)).rejects.toThrow();

    const tamperedIngestion = JSON.parse(JSON.stringify(ingestion));
    tamperedIngestion.routes[0].path = '/api/caseaudit';
    await expect(validateExpressIngestion(tamperedIngestion, orgId)).rejects.toThrow();

    const tamperedAnalysis = JSON.parse(JSON.stringify(analysis));
    tamperedAnalysis.findings[0].source.symbol = 'query.casetoken';
    await expect(validateSqlAnalysis(tamperedAnalysis, snapshot, ingestion, orgId)).rejects.toThrow();

    await expect(validateSnapshot(snapshot, 'org_foreign')).rejects.toThrow('tenant mismatch');
    await expect(validateExpressIngestion(ingestion, 'org_foreign')).rejects.toThrow('tenant mismatch');
  });
});
