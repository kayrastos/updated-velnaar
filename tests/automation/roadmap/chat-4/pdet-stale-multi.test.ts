import { describe, it, expect } from 'vitest';
import { captureSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';

const orgId = 'org_pdet_multi';

const codeV1 = `import express from 'express';

export function createApp(db: any) {
  const app = express();
  function search(req: any, res: any) {
    const term = req.query.term;
    const query = 'SELECT * FROM items WHERE name = ' + term;
    const stmt = db.prepare(query);
    const rows = stmt.all();
    return res.json(rows);
  }
  app.get('/search', search);
  return app;
}
`;

const codeV2 = `import express from 'express';

export function createApp(db: any) {
  const app = express();
  function search(req: any, res: any) {
    const term = req.query.filter;
    const query = 'SELECT * FROM items WHERE category = ' + term;
    const stmt = db.prepare(query);
    const rows = stmt.all();
    return res.json(rows);
  }
  app.get('/search', search);
  return app;
}
`;

describe('Pipeline Determinism: Multi-Stage Stale State Rejection', () => {
  it('rejects stale and mismatched artifacts across snapshot, ingestion, detection, and bridge stages', async () => {
    const snapshotV1 = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-pdet-multi',
        organizationId: orgId,
        files: [{ path: 'src/app.ts', content: codeV1 }],
      },
      orgId,
    );

    const snapshotV2 = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-pdet-multi',
        organizationId: orgId,
        files: [{ path: 'src/app.ts', content: codeV2 }],
      },
      orgId,
    );

    expect(snapshotV1.snapshotId).not.toBe(snapshotV2.snapshotId);

    const ingestionV1 = await ingestExpress(snapshotV1, orgId);
    const ingestionV2 = await ingestExpress(snapshotV2, orgId);

    expect(ingestionV1.ingestionIdentity).not.toBe(ingestionV2.ingestionIdentity);
    expect(ingestionV1.snapshot.snapshotId).toBe(snapshotV1.snapshotId);
    expect(ingestionV2.snapshot.snapshotId).toBe(snapshotV2.snapshotId);

    await expect(
      detectSqlInjection(snapshotV1, ingestionV2, orgId),
    ).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');

    await expect(
      detectSqlInjection(snapshotV2, ingestionV1, orgId),
    ).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');

    const analysisV1 = await detectSqlInjection(snapshotV1, ingestionV1, orgId);
    const analysisV2 = await detectSqlInjection(snapshotV2, ingestionV2, orgId);

    expect(analysisV1.status).toBe('DETECTED');
    expect(analysisV2.status).toBe('DETECTED');
    expect(analysisV1.resultFingerprint).not.toBe(analysisV2.resultFingerprint);

    await expect(
      validateSqlAnalysis(analysisV1, snapshotV2, ingestionV2, orgId),
    ).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');

    await expect(
      validateSqlAnalysis(analysisV2, snapshotV1, ingestionV1, orgId),
    ).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');

    await expect(
      validateSqlAnalysis(analysisV2, snapshotV1, ingestionV2, orgId),
    ).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');

    await expect(
      validateSqlAnalysis(analysisV1, snapshotV2, ingestionV1, orgId),
    ).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');

    const validCommit = '1'.repeat(40);
    const bridge = createSqlCandidateBridge(async (snapshot) => {
      if (snapshot.snapshotId !== snapshotV2.snapshotId) {
        throw new Error('M3_STALE_SNAPSHOT_AT_COMMIT_CHECK');
      }
      return validCommit;
    });

    await expect(
      bridge(analysisV1, snapshotV2, ingestionV2, orgId),
    ).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');

    await expect(
      bridge(analysisV2, snapshotV1, ingestionV2, orgId),
    ).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');

    await expect(
      bridge(analysisV2, snapshotV2, ingestionV1, orgId),
    ).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');

    await expect(
      bridge(analysisV1, snapshotV1, ingestionV1, orgId),
    ).rejects.toThrow('M3_STALE_SNAPSHOT_AT_COMMIT_CHECK');

    const validValidated = await validateSqlAnalysis(analysisV2, snapshotV2, ingestionV2, orgId);
    expect(validValidated.resultFingerprint).toBe(analysisV2.resultFingerprint);

    const hypotheses = await bridge(analysisV2, snapshotV2, ingestionV2, orgId);
    expect(hypotheses.length).toBeGreaterThan(0);
    for (const item of hypotheses) {
      expect(item.candidate.verificationState).toBe('CANDIDATE');
      expect(item.candidate.snapshot.snapshotId).toBe(snapshotV2.snapshotId);
      expect(item.candidate.snapshot.commitSha).toBe(validCommit);
      expect(typeof item.candidateBinding).toBe('string');
      expect(item.candidateBinding.length).toBeGreaterThan(0);
    }
  });
});
