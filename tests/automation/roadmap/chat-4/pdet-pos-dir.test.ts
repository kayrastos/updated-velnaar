import { describe, it, expect } from 'vitest';
import {
  captureSnapshot,
  validateSnapshot,
  canonical,
} from '../../../../worker/intelligence/ingestion/snapshot';
import {
  ingestExpress,
  validateExpressIngestion,
} from '../../../../worker/intelligence/ingestion/express';
import {
  detectSqlInjection,
  validateSqlAnalysis,
} from '../../../../worker/intelligence/detection/sqlInjection';

const POSITIVE_SOURCE = `import express from 'express';

export function createApp(db: any) {
  function getUser(req: any, res: any) {
    const query = req.query.id;
    const sql = 'SELECT * FROM users WHERE id = ' + query;
    const statement = db.prepare(sql);
    const rows = statement.all();
    return res.json(rows);
  }

  const app = express();
  app.get('/users', getUser);
  return app;
}
`;

describe('Pipeline Determinism Positive Control Direct Integration', () => {
  it('deterministically captures, ingests, and detects SQL injection positive control', async () => {
    const orgId = 'org-pdet-pos-001';
    const repoId = 'repo-pdet-pos-001';

    const snapshotInput = {
      fixtureId: 'm2-case-001',
      repositoryId: repoId,
      organizationId: orgId,
      files: [
        {
          path: 'src/app.ts',
          content: POSITIVE_SOURCE,
        },
      ],
    };

    const snapshot1 = await captureSnapshot(snapshotInput, orgId);
    const validatedSnapshot1 = await validateSnapshot(snapshot1, orgId);
    expect(validatedSnapshot1.snapshotId).toBe(snapshot1.snapshotId);

    const expressIngestion1 = await ingestExpress(snapshot1, orgId);
    const validatedExpress1 = await validateExpressIngestion(expressIngestion1, orgId);
    expect(validatedExpress1.ingestionIdentity).toBe(expressIngestion1.ingestionIdentity);

    const analysis1 = await detectSqlInjection(snapshot1, expressIngestion1, orgId);
    const validatedAnalysis1 = await validateSqlAnalysis(analysis1, snapshot1, expressIngestion1, orgId);
    expect(validatedAnalysis1.resultFingerprint).toBe(analysis1.resultFingerprint);

    expect(analysis1.status).toBe('DETECTED');
    expect(analysis1.findings).toHaveLength(1);
    expect(analysis1.limitations).toHaveLength(0);

    const finding = analysis1.findings[0];
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.source.filePath).toBe('src/app.ts');
    expect(finding.source.symbol).toBe('query.id');
    expect(finding.sink.filePath).toBe('src/app.ts');
    expect(finding.sink.symbol).toBe('db.prepare');
    expect(finding.flow.length).toBeGreaterThan(0);

    const snapshot2 = await captureSnapshot(snapshotInput, orgId);
    const expressIngestion2 = await ingestExpress(snapshot2, orgId);
    const analysis2 = await detectSqlInjection(snapshot2, expressIngestion2, orgId);

    expect(snapshot2.snapshotId).toBe(snapshot1.snapshotId);
    expect(snapshot2.files[0].fileIdentity).toBe(snapshot1.files[0].fileIdentity);
    expect(expressIngestion2.ingestionIdentity).toBe(expressIngestion1.ingestionIdentity);
    expect(analysis2.resultFingerprint).toBe(analysis1.resultFingerprint);
    expect(analysis2.findings[0].findingId).toBe(analysis1.findings[0].findingId);
    expect(canonical(analysis2)).toBe(canonical(analysis1));
  });

  it('preserves non-authoritative boundary on positive detection', async () => {
    const orgId = 'org-pdet-pos-002';
    const repoId = 'repo-pdet-pos-002';

    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-002',
        repositoryId: repoId,
        organizationId: orgId,
        files: [{ path: 'src/app.ts', content: POSITIVE_SOURCE }],
      },
      orgId,
    );

    const expressIngestion = await ingestExpress(snapshot, orgId);
    const analysis = await detectSqlInjection(snapshot, expressIngestion, orgId);

    expect(analysis.status).toBe('DETECTED');
    expect((analysis as any).capability).toBeUndefined();
    expect((analysis as any).authority).toBeUndefined();
    expect((analysis as any).action).toBeUndefined();
    expect((analysis as any).verified).toBeUndefined();
    expect((analysis as any).verificationState).toBeUndefined();
  });

  it('fails validation when snapshot or analysis is tampered', async () => {
    const orgId = 'org-pdet-pos-003';
    const repoId = 'repo-pdet-pos-003';

    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-003',
        repositoryId: repoId,
        organizationId: orgId,
        files: [{ path: 'src/app.ts', content: POSITIVE_SOURCE }],
      },
      orgId,
    );

    const expressIngestion = await ingestExpress(snapshot, orgId);
    const analysis = await detectSqlInjection(snapshot, expressIngestion, orgId);

    const tamperedSnapshot = { ...snapshot, repositoryId: 'repo-tampered' };
    await expect(validateSnapshot(tamperedSnapshot, orgId)).rejects.toThrow();

    const tamperedAnalysis = { ...analysis, status: 'NOT_DETECTED' as const };
    await expect(validateSqlAnalysis(tamperedAnalysis, snapshot, expressIngestion, orgId)).rejects.toThrow();
  });
});
