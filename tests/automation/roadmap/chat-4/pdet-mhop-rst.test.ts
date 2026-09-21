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
import {
  createSqlCandidateBridge,
} from '../../../../worker/intelligence/detection/candidate';

describe('PDET Multi-Hop Flow Restart-Resume Pipeline Determinism', () => {
  const org = 'org_pdet_mhop';
  const repoId = 'pdet-mhop-rst-repo';
  const commitSha = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

  const sourceCode = `import express from 'express';

export function createApp(db) {
  const app = express();

  function hopTwo(value) {
    const prefix = "SELECT * FROM users WHERE id = '";
    const suffix = "'";
    const part = prefix + value;
    const sql = part + suffix;
    return sql;
  }

  function hopOne(tainted) {
    const step = hopTwo(tainted);
    return step;
  }

  function handleUsers(req, res) {
    const tainted = req.query.id;
    const query = hopOne(tainted);
    const stmt = db.prepare(query);
    const rows = stmt.all();
    return res.json(rows);
  }

  app.get('/users', handleUsers);
  return app;
}
`;

  it('preserves multi-hop flow determinism across restart and resume boundaries', async () => {
    const rawInput = {
      fixtureId: 'm2-case-001',
      repositoryId: repoId,
      organizationId: org,
      files: [{ path: 'src/app.ts', content: sourceCode }],
    };

    const snapshot1 = await captureSnapshot(rawInput, org);
    const ingestion1 = await ingestExpress(snapshot1, org);
    const analysis1 = await detectSqlInjection(snapshot1, ingestion1, org);

    expect(analysis1.status).toBe('DETECTED');
    expect(analysis1.findings.length).toBe(1);

    const bridge1 = createSqlCandidateBridge(async () => commitSha);
    const candidates1 = await bridge1(analysis1, snapshot1, ingestion1, org);
    expect(candidates1.length).toBe(1);

    const serializedSnapshot = JSON.stringify(snapshot1);
    const resumedSnapshot = await validateSnapshot(JSON.parse(serializedSnapshot), org);
    expect(resumedSnapshot.snapshotId).toBe(snapshot1.snapshotId);
    expect(canonical(resumedSnapshot)).toBe(canonical(snapshot1));

    const serializedIngestion = JSON.stringify(ingestion1);
    const resumedIngestion = await validateExpressIngestion(JSON.parse(serializedIngestion), org);
    expect(resumedIngestion.ingestionIdentity).toBe(ingestion1.ingestionIdentity);
    expect(canonical(resumedIngestion)).toBe(canonical(ingestion1));

    const resumedAnalysis = await detectSqlInjection(resumedSnapshot, resumedIngestion, org);
    expect(resumedAnalysis.resultFingerprint).toBe(analysis1.resultFingerprint);
    expect(canonical(resumedAnalysis)).toBe(canonical(analysis1));

    const serializedAnalysis = JSON.stringify(resumedAnalysis);
    const validatedAnalysis = await validateSqlAnalysis(JSON.parse(serializedAnalysis), resumedSnapshot, resumedIngestion, org);
    expect(validatedAnalysis.resultFingerprint).toBe(analysis1.resultFingerprint);

    const bridge2 = createSqlCandidateBridge(async () => commitSha);
    const candidates2 = await bridge2(validatedAnalysis, resumedSnapshot, resumedIngestion, org);
    expect(candidates2.length).toBe(candidates1.length);
    expect(candidates2[0].candidateBinding).toBe(candidates1[0].candidateBinding);
    expect(canonical(candidates2)).toBe(canonical(candidates1));
  });

  it('fails closed when resumed multi-hop flow artifacts are tampered with or tenant mismatched', async () => {
    const rawInput = {
      fixtureId: 'm2-case-001',
      repositoryId: repoId,
      organizationId: org,
      files: [{ path: 'src/app.ts', content: sourceCode }],
    };

    const snapshot = await captureSnapshot(rawInput, org);
    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);

    await expect(validateSnapshot(JSON.parse(JSON.stringify(snapshot)), 'foreign_org')).rejects.toThrow();
    await expect(validateExpressIngestion(JSON.parse(JSON.stringify(ingestion)), 'foreign_org')).rejects.toThrow();

    const tamperedAnalysis = JSON.parse(JSON.stringify(analysis));
    tamperedAnalysis.status = 'NOT_DETECTED';
    await expect(validateSqlAnalysis(tamperedAnalysis, snapshot, ingestion, org)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');

    const altSnapshot = await captureSnapshot({
      fixtureId: 'm2-case-002',
      repositoryId: repoId,
      organizationId: org,
      files: [{ path: 'src/app.ts', content: sourceCode }],
    }, org);
    await expect(detectSqlInjection(altSnapshot, ingestion, org)).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
  });

  it('enforces non-authoritative candidate boundary across resumed execution', async () => {
    const rawInput = {
      fixtureId: 'm2-case-001',
      repositoryId: repoId,
      organizationId: org,
      files: [{ path: 'src/app.ts', content: sourceCode }],
    };

    const snapshot = await captureSnapshot(rawInput, org);
    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);

    const bridge = createSqlCandidateBridge(async () => commitSha);
    const candidates = await bridge(analysis, snapshot, ingestion, org);

    expect(candidates[0].candidate.verificationState).toBe('CANDIDATE');
    expect(candidates[0].candidate.reachabilityState).toBe('REACHABLE');
    expect((candidates[0].candidate as any).verificationState).not.toBe('VERIFIED');

    const invalidBridge = createSqlCandidateBridge(async () => 'not-a-sha');
    await expect(invalidBridge(analysis, snapshot, ingestion, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const zeroBridge = createSqlCandidateBridge(async () => '0'.repeat(40));
    await expect(zeroBridge(analysis, snapshot, ingestion, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
  });
});
