import { describe, it, expect } from 'vitest';
import { captureSnapshot, validateSnapshot, hash } from '../../worker/intelligence/ingestion/snapshot';
import { ingestExpress, validateExpressIngestion } from '../../worker/intelligence/ingestion/express';
import { detectSqlInjection, validateSqlAnalysis } from '../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../worker/intelligence/detection/candidate';
import {
  validateRepositoryIngestion,
  isTrustedCommitCapability,
  assertTrustedCommitCapability,
  type RepositoryIngestion,
} from '../../worker/intelligence/ingestion/repository';

describe('Clean Room V1 Contract Proof Integration Gate', () => {
  const vulnerableSource = `import express from 'express';

export function createApp(db: any) {
  const app = express();

  function searchHandler(req: any, res: any) {
    const term = req.query.term;
    const stmt = db.prepare('SELECT * FROM users WHERE name = ' + term);
    const rows = stmt.all();
    res.json(rows);
  }

  app.get('/search', searchHandler);
  return app;
}
`;

  const safeSource = `import express from 'express';

export function createApp(db: any) {
  const app = express();

  function safeHandler(req: any, res: any) {
    const term = req.query.term;
    const stmt = db.prepare('SELECT * FROM users WHERE name = ?');
    const rows = stmt.all(term);
    res.json(rows);
  }

  app.get('/safe', safeHandler);
  return app;
}
`;

  it('proves clean-room pipeline from snapshot to SQLi detection without minting authority', async () => {
    const org = 'org_clean_room';
    const repoId = 'repo-v1-proof';

    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: repoId,
        organizationId: org,
        files: [{ path: 'src/app.ts', content: vulnerableSource }],
      },
      org,
    );

    expect(snapshot.organizationId).toBe(org);
    expect(snapshot.repositoryId).toBe(repoId);
    expect(snapshot.files).toHaveLength(1);
    expect(snapshot.files[0].path).toBe('src/app.ts');

    const verifiedSnapshot = await validateSnapshot(snapshot, org);
    expect(verifiedSnapshot.snapshotId).toBe(snapshot.snapshotId);

    const expressIngestion = await ingestExpress(snapshot, org);
    expect(expressIngestion.version).toBe('velnar-express-ingestion-v1');
    expect(expressIngestion.routes).toHaveLength(1);
    expect(expressIngestion.routes[0].method).toBe('GET');
    expect(expressIngestion.routes[0].path).toBe('/search');

    const validatedExpress = await validateExpressIngestion(expressIngestion, org);
    expect(validatedExpress.ingestionIdentity).toBe(expressIngestion.ingestionIdentity);

    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
    expect(analysis.status).toBe('DETECTED');
    expect(analysis.findings).toHaveLength(1);
    expect(analysis.findings[0].vulnerabilityClass).toBe('SQL_INJECTION');
    expect(analysis.findings[0].flow.length).toBeGreaterThanOrEqual(3);

    expect((analysis as any).capability).toBeUndefined();
    expect((analysis as any).action).toBeUndefined();
    expect((analysis as any).verificationState).toBeUndefined();

    const validatedAnalysis = await validateSqlAnalysis(analysis, snapshot, expressIngestion, org);
    expect(validatedAnalysis.resultFingerprint).toBe(analysis.resultFingerprint);

    await expect(
      validateSqlAnalysis({ ...analysis, status: 'NOT_DETECTED' }, snapshot, expressIngestion, org),
    ).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
  });

  it('asserts candidate findings maintain CANDIDATE verification state and cannot mint VERIFIED authority', async () => {
    const org = 'org_clean_room';
    const repoId = 'repo-v1-proof';

    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: repoId,
        organizationId: org,
        files: [{ path: 'src/app.ts', content: vulnerableSource }],
      },
      org,
    );

    const expressIngestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
    expect(analysis.status).toBe('DETECTED');

    const validCommitSha = 'a'.repeat(40);
    let commitChecked = false;
    const bridge = createSqlCandidateBridge(async (snap) => {
      expect(snap.snapshotId).toBe(snapshot.snapshotId);
      commitChecked = true;
      return validCommitSha;
    });

    const candidates = await bridge(analysis, snapshot, expressIngestion, org);
    expect(commitChecked).toBe(true);
    expect(candidates).toHaveLength(1);

    const hypothesis = candidates[0];
    expect(hypothesis.candidateBinding).toBeTruthy();
    expect(hypothesis.candidate.vulnerabilityClass).toBe('SQL_INJECTION');

    expect(hypothesis.candidate.verificationState).toBe('CANDIDATE');
    expect(hypothesis.candidate.reachabilityState).toBe('REACHABLE');
    expect((hypothesis.candidate as any).verificationState).not.toBe('VERIFIED');
    expect((hypothesis.candidate as any).capability).toBeUndefined();
    expect((hypothesis as any).capability).toBeUndefined();

    const invalidCommitBridge = createSqlCandidateBridge(async () => 'not-a-sha');
    await expect(invalidCommitBridge(analysis, snapshot, expressIngestion, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
  });

  it('proves parameterized query yields NOT_DETECTED and returns empty candidate set', async () => {
    const org = 'org_clean_room';
    const repoId = 'repo-v1-proof';

    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-002',
        repositoryId: repoId,
        organizationId: org,
        files: [{ path: 'src/app.ts', content: safeSource }],
      },
      org,
    );

    const expressIngestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
    expect(analysis.status).toBe('NOT_DETECTED');
    expect(analysis.findings).toHaveLength(0);

    const bridge = createSqlCandidateBridge(async () => 'b'.repeat(40));
    const candidates = await bridge(analysis, snapshot, expressIngestion, org);
    expect(candidates).toHaveLength(0);
  });

  it('bounds repository provenance to trusted ingestion and enforces commit capability isolation', async () => {
    const org = 'org_clean_room';
    const repoId = 'repo-v1-proof';
    const commitSha = 'c'.repeat(40);

    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: repoId,
        organizationId: org,
        files: [{ path: 'src/app.ts', content: safeSource }],
      },
      org,
    );

    const expectedIdentity = await hash('velnar-repository-ingestion-v1', {
      version: 'velnar-repository-ingestion-v1',
      organizationId: org,
      repositoryId: repoId,
      commitSha,
      snapshot,
    });

    const ingestionRecord: RepositoryIngestion = {
      version: 'velnar-repository-ingestion-v1',
      organizationId: org,
      repositoryId: repoId,
      commitSha,
      snapshot,
      ingestionIdentity: expectedIdentity,
    };

    const validated = await validateRepositoryIngestion(ingestionRecord, org);
    expect(validated.ingestionIdentity).toBe(expectedIdentity);

    expect((validated as any).capability).toBeUndefined();
    expect(isTrustedCommitCapability((validated as any).capability, validated)).toBe(false);

    const expressIngestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
    expect(isTrustedCommitCapability(analysis, validated)).toBe(false);
    expect(() => assertTrustedCommitCapability(analysis, validated)).toThrow('unauthorized commit capability');

    await expect(validateRepositoryIngestion(ingestionRecord, 'foreign_org')).rejects.toThrow('tenant mismatch');

    const forgedRecord = { ...ingestionRecord, commitSha: '0'.repeat(40) };
    await expect(validateRepositoryIngestion(forgedRecord, org)).rejects.toThrow('Git commit identity');
  });
});
