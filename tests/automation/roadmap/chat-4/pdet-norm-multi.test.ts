import { describe, it, expect } from 'vitest';
import { captureSnapshot, validateSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress, validateExpressIngestion } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';

const sampleAppSource = `import express from 'express';

export function createApp(db: any) {
  const app = express();

  function handleUsers(req: any, res: any) {
    const query = req.query.id;
    const sql = 'SELECT * FROM users WHERE id = ' + query;
    const stmt = db.prepare(sql);
    const rows = stmt.all();
    return res.json(rows);
  }

  app.get('/users', handleUsers);
  return app;
}
`;

describe('Pipeline Determinism Multi-Stage Normalization Boundary', () => {
  const org = 'org_pdet_norm_multi';
  const commitSha = 'a'.repeat(40);

  it('produces identical deterministic identities across all pipeline stages regardless of input ordering', async () => {
    const inputA = {
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-multi-stage',
      organizationId: org,
      files: [
        { path: 'src/app.ts', content: sampleAppSource },
        { path: 'src/helper.ts', content: 'export const helper = 1;\n' },
      ],
    };

    const inputB = {
      organizationId: org,
      files: [
        { content: 'export const helper = 1;\n', path: 'src/helper.ts' },
        { path: 'src/app.ts', content: sampleAppSource },
      ],
      repositoryId: 'repo-multi-stage',
      fixtureId: 'm2-case-001',
    };

    const snapshotA = await captureSnapshot(inputA, org);
    const snapshotB = await captureSnapshot(inputB, org);
    expect(snapshotA.snapshotId).toBe(snapshotB.snapshotId);
    expect(snapshotA.files.map(f => f.path)).toEqual(['src/app.ts', 'src/helper.ts']);

    const ingestionA = await ingestExpress(snapshotA, org);
    const ingestionB = await ingestExpress(snapshotB, org);
    expect(ingestionA.ingestionIdentity).toBe(ingestionB.ingestionIdentity);
    expect(ingestionA.routes.length).toBe(1);
    expect(ingestionA.routes[0].routeIdentity).toBe(ingestionB.routes[0].routeIdentity);

    const analysisA = await detectSqlInjection(snapshotA, ingestionA, org);
    const analysisB = await detectSqlInjection(snapshotB, ingestionB, org);
    expect(analysisA.status).toBe('DETECTED');
    expect(analysisA.resultFingerprint).toBe(analysisB.resultFingerprint);
    expect(analysisA.findings).toHaveLength(1);
    expect(analysisA.findings[0].findingId).toBe(analysisB.findings[0].findingId);

    const bridge = createSqlCandidateBridge(async () => commitSha);
    const hypothesesA = await bridge(analysisA, snapshotA, ingestionA, org);
    const hypothesesB = await bridge(analysisB, snapshotB, ingestionB, org);
    expect(hypothesesA).toHaveLength(1);
    expect(hypothesesA[0].candidate.candidateId).toBe(hypothesesB[0].candidate.candidateId);
    expect(hypothesesA[0].candidateBinding).toBe(hypothesesB[0].candidateBinding);
    expect(hypothesesA[0].candidate.verificationState).toBe('CANDIDATE');
    expect(hypothesesB[0].candidate.verificationState).toBe('CANDIDATE');
  });

  it('validates detached or roundtripped JSON across multi-stage boundaries without identity divergence', async () => {
    const snapshot = await captureSnapshot({
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-multi-roundtrip',
      organizationId: org,
      files: [{ path: 'src/app.ts', content: sampleAppSource }],
    }, org);

    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);

    const validatedSnapshot = await validateSnapshot(JSON.parse(JSON.stringify(snapshot)), org);
    expect(validatedSnapshot.snapshotId).toBe(snapshot.snapshotId);

    const validatedIngestion = await validateExpressIngestion(JSON.parse(JSON.stringify(ingestion)), org);
    expect(validatedIngestion.ingestionIdentity).toBe(ingestion.ingestionIdentity);

    const validatedAnalysis = await validateSqlAnalysis(JSON.parse(JSON.stringify(analysis)), snapshot, ingestion, org);
    expect(validatedAnalysis.resultFingerprint).toBe(analysis.resultFingerprint);
  });

  it('fails closed when stages are crossed with mismatched snapshots or invalid tenant bounds', async () => {
    const snapshotOne = await captureSnapshot({
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-one',
      organizationId: org,
      files: [{ path: 'src/app.ts', content: sampleAppSource }],
    }, org);

    const snapshotTwo = await captureSnapshot({
      fixtureId: 'm2-case-002',
      repositoryId: 'repo-two',
      organizationId: org,
      files: [{ path: 'src/app.ts', content: sampleAppSource }],
    }, org);

    const ingestionOne = await ingestExpress(snapshotOne, org);

    await expect(detectSqlInjection(snapshotTwo, ingestionOne, org)).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
    await expect(validateSnapshot(snapshotOne, 'foreign_org')).rejects.toThrow();
    await expect(validateExpressIngestion(ingestionOne, 'foreign_org')).rejects.toThrow();

    const bridge = createSqlCandidateBridge(async () => commitSha);
    const analysisOne = await detectSqlInjection(snapshotOne, ingestionOne, org);
    await expect(bridge(analysisOne, snapshotOne, ingestionOne, 'foreign_org')).rejects.toThrow();
  });

  it('preserves non-authoritative boundary by rejecting invalid commit capabilities', async () => {
    const snapshot = await captureSnapshot({
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-boundary',
      organizationId: org,
      files: [{ path: 'src/app.ts', content: sampleAppSource }],
    }, org);

    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);

    const zeroBridge = createSqlCandidateBridge(async () => '0'.repeat(40));
    await expect(zeroBridge(analysis, snapshot, ingestion, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const invalidShaBridge = createSqlCandidateBridge(async () => 'not-a-sha');
    await expect(invalidShaBridge(analysis, snapshot, ingestion, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
  });
});
