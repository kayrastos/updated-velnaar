import { describe, it, expect } from 'vitest';
import { captureSnapshot, validateSnapshot, canonical } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress, validateExpressIngestion } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';

const orgId = 'org_velnar_pdet';
const repoId = 'repo-pdet-nest-dir';
const fixtureId = 'm2-case-001';

const sourceCode = `import express from 'express';

function formatQuery(input: string) {
  const query = "SELECT * FROM records WHERE id = '" + input + "'";
  return query;
}

export function createApp(db: any) {
  const app = express();

  function searchHandler(req: any, res: any) {
    const raw = req.query.id;
    const q = formatQuery(raw);
    const stmt = db.prepare(q);
    const rows = stmt.all();
    res.json(rows);
  }

  app.get('/search', searchHandler);
  return app;
}
`;

describe('Pipeline Determinism - Nested Flow Direct', () => {
  it('deterministically captures, ingests, and analyzes direct nested flow', async () => {
    const files = [{ path: 'src/app.ts', content: sourceCode }];

    const snapshotA = await captureSnapshot({ fixtureId, repositoryId: repoId, organizationId: orgId, files }, orgId);
    const snapshotB = await captureSnapshot({ fixtureId, repositoryId: repoId, organizationId: orgId, files }, orgId);

    expect(snapshotA.snapshotId).toBe(snapshotB.snapshotId);
    expect(snapshotA.totalBytes).toBe(snapshotB.totalBytes);

    const ingestionA = await ingestExpress(snapshotA, orgId);
    const ingestionB = await ingestExpress(snapshotB, orgId);

    expect(ingestionA.ingestionIdentity).toBe(ingestionB.ingestionIdentity);
    expect(ingestionA.routes.length).toBe(1);
    expect(ingestionA.routes[0].routeIdentity).toBe(ingestionB.routes[0].routeIdentity);

    const analysisA = await detectSqlInjection(snapshotA, ingestionA, orgId);
    const analysisB = await detectSqlInjection(snapshotB, ingestionB, orgId);

    expect(analysisA.status).toBe('DETECTED');
    expect(analysisA.resultFingerprint).toBe(analysisB.resultFingerprint);
    expect(analysisA.findings.length).toBe(1);
    expect(analysisA.findings[0].findingId).toBe(analysisB.findings[0].findingId);

    const flowKinds = analysisA.findings[0].flow.map((step) => step.kind);
    expect(flowKinds).toContain('SOURCE');
    expect(flowKinds).toContain('CALL');
    expect(flowKinds).toContain('ARGUMENT');
    expect(flowKinds).toContain('CONCAT');
    expect(flowKinds).toContain('RETURN');
    expect(flowKinds).toContain('SINK');

    expect(canonical(analysisA)).toBe(canonical(analysisB));
  });

  it('preserves snapshot, ingestion, and analysis validity across validation boundaries', async () => {
    const files = [{ path: 'src/app.ts', content: sourceCode }];

    const snapshot = await captureSnapshot({ fixtureId, repositoryId: repoId, organizationId: orgId, files }, orgId);
    const validatedSnapshot = await validateSnapshot(snapshot, orgId);
    expect(validatedSnapshot.snapshotId).toBe(snapshot.snapshotId);

    const ingestion = await ingestExpress(validatedSnapshot, orgId);
    const validatedIngestion = await validateExpressIngestion(ingestion, orgId);
    expect(validatedIngestion.ingestionIdentity).toBe(ingestion.ingestionIdentity);

    const analysis = await detectSqlInjection(validatedSnapshot, validatedIngestion, orgId);
    const validatedAnalysis = await validateSqlAnalysis(analysis, validatedSnapshot, validatedIngestion, orgId);
    expect(validatedAnalysis.resultFingerprint).toBe(analysis.resultFingerprint);
  });

  it('fails closed on tenant mismatch or tampered analysis fingerprint', async () => {
    const files = [{ path: 'src/app.ts', content: sourceCode }];

    const snapshot = await captureSnapshot({ fixtureId, repositoryId: repoId, organizationId: orgId, files }, orgId);
    const ingestion = await ingestExpress(snapshot, orgId);
    const analysis = await detectSqlInjection(snapshot, ingestion, orgId);

    await expect(validateSnapshot(snapshot, 'foreign_org')).rejects.toThrow();
    await expect(validateExpressIngestion(ingestion, 'foreign_org')).rejects.toThrow();

    const tamperedAnalysis = {
      ...analysis,
      resultFingerprint: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    };
    await expect(validateSqlAnalysis(tamperedAnalysis, snapshot, ingestion, orgId)).rejects.toThrow();
  });
});
