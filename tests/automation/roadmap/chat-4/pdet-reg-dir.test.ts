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

describe('V1 Pipeline Determinism Regression Lock - Direct', () => {
  const org = 'org_pdet_dir';
  const repositoryId = 'repo-pdet-dir';
  const fixtureId = 'm2-case-001';
  const validCommitSha = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

  const appSource = [
    "import express from 'express';",
    '',
    'export function createApp(db: any) {',
    '  const app = express();',
    '',
    '  function handleUsers(req: any, res: any) {',
    '    const userId = req.query.id;',
    "    const sql = 'SELECT * FROM users WHERE id = ' + userId;",
    '    const stmt = db.prepare(sql);',
    '    const rows = stmt.all();',
    '    res.json(rows);',
    '  }',
    '',
    "  app.get('/users', handleUsers);",
    '  return app;',
    '}',
    '',
  ].join('\n');

  const snapshotInput = {
    fixtureId,
    repositoryId,
    organizationId: org,
    files: [
      {
        path: 'src/app.ts',
        content: appSource,
      },
    ],
  };

  it('preserves identity determinism across repeated direct pipeline runs', async () => {
    const snapshotA = await captureSnapshot(snapshotInput, org);
    const expressA = await ingestExpress(snapshotA, org);
    const analysisA = await detectSqlInjection(snapshotA, expressA, org);

    const bridge = createSqlCandidateBridge(async () => validCommitSha);
    const candidatesA = await bridge(analysisA, snapshotA, expressA, org);

    const snapshotB = await captureSnapshot(snapshotInput, org);
    const expressB = await ingestExpress(snapshotB, org);
    const analysisB = await detectSqlInjection(snapshotB, expressB, org);
    const candidatesB = await bridge(analysisB, snapshotB, expressB, org);

    expect(snapshotA.snapshotId).toBe(snapshotB.snapshotId);
    expect(snapshotA.totalBytes).toBe(snapshotB.totalBytes);
    expect(snapshotA.files[0].fileIdentity).toBe(snapshotB.files[0].fileIdentity);

    expect(expressA.ingestionIdentity).toBe(expressB.ingestionIdentity);
    expect(expressA.routes.length).toBe(1);
    expect(expressA.routes[0].routeIdentity).toBe(expressB.routes[0].routeIdentity);

    expect(analysisA.status).toBe('DETECTED');
    expect(analysisA.resultFingerprint).toBe(analysisB.resultFingerprint);
    expect(analysisA.findings.length).toBe(1);
    expect(analysisA.findings[0].findingId).toBe(analysisB.findings[0].findingId);

    expect(candidatesA.length).toBe(1);
    expect(candidatesA[0].candidate.candidateId).toBe(candidatesB[0].candidate.candidateId);
    expect(candidatesA[0].candidateBinding).toBe(candidatesB[0].candidateBinding);
  });

  it('locks non-authoritative candidate boundary and enforces commit verification', async () => {
    const snapshot = await captureSnapshot(snapshotInput, org);
    const expressIngestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);

    const bridge = createSqlCandidateBridge(async () => validCommitSha);
    const candidates = await bridge(analysis, snapshot, expressIngestion, org);

    expect(candidates.length).toBe(1);
    const item = candidates[0];

    expect(item.candidate.verificationState).toBe('CANDIDATE');
    expect(item.candidate.reachabilityState).toBe('REACHABLE');
    expect(item.candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(item.candidate.snapshot.commitSha).toBe(validCommitSha);
    expect(item.candidate.snapshot.sourceProvider).toBe('LOCAL_FIXTURE');
    expect(item.candidateBinding).toBeDefined();

    const zeroShaBridge = createSqlCandidateBridge(async () => '0'.repeat(40));
    await expect(zeroShaBridge(analysis, snapshot, expressIngestion, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const invalidFormatBridge = createSqlCandidateBridge(async () => 'not-a-valid-sha');
    await expect(invalidFormatBridge(analysis, snapshot, expressIngestion, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
  });

  it('validates idempotency and rejects tampered analysis or tenant mismatch', async () => {
    const snapshot = await captureSnapshot(snapshotInput, org);
    const expressIngestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);

    const revalidatedSnapshot = await validateSnapshot(snapshot, org);
    expect(revalidatedSnapshot.snapshotId).toBe(snapshot.snapshotId);

    const revalidatedExpress = await validateExpressIngestion(expressIngestion, org);
    expect(revalidatedExpress.ingestionIdentity).toBe(expressIngestion.ingestionIdentity);

    const revalidatedAnalysis = await validateSqlAnalysis(analysis, snapshot, expressIngestion, org);
    expect(revalidatedAnalysis.resultFingerprint).toBe(analysis.resultFingerprint);

    const tamperedAnalysis = {
      ...analysis,
      status: 'NOT_DETECTED',
    };
    await expect(validateSqlAnalysis(tamperedAnalysis, snapshot, expressIngestion, org)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');

    await expect(captureSnapshot(snapshotInput, 'foreign_org')).rejects.toThrow('tenant mismatch');
    await expect(validateSnapshot(snapshot, 'foreign_org')).rejects.toThrow('tenant mismatch');
    await expect(validateExpressIngestion(expressIngestion, 'foreign_org')).rejects.toThrow('tenant mismatch');

    const mismatchedSnapshot = await captureSnapshot(
      {
        ...snapshotInput,
        repositoryId: 'repo-pdet-mismatch',
      },
      org,
    );
    await expect(detectSqlInjection(mismatchedSnapshot, expressIngestion, org)).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
  });
});
