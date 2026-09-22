import { describe, it, expect } from 'vitest';
import { captureSnapshot, hash } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import {
  validateRepositoryIngestion,
  isTrustedCommitCapability,
  assertTrustedCommitCapability,
} from '../../../../worker/intelligence/ingestion/repository';

const org = 'org_pdet_rst';

const sourceCodeV1 = `import express from 'express';

export function createApp(db: any) {
  function handleQuery(req: any, res: any) {
    const term = req.query.term;
    const sql = "SELECT * FROM items WHERE name = '" + term + "'";
    const stmt = db.prepare(sql);
    const rows = stmt.all();
    return res.json(rows);
  }
  const app = express();
  app.get('/items', handleQuery);
  return app;
}
`;

const sourceCodeV2 = `import express from 'express';

export function createApp(db: any) {
  function handleQuery(req: any, res: any) {
    const safeId = req.query.id;
    const sql = "SELECT * FROM items WHERE id = '" + safeId + "'";
    const stmt = db.prepare(sql);
    const rows = stmt.all();
    return res.json(rows);
  }
  const app = express();
  app.get('/items', handleQuery);
  return app;
}
`;

const sourceCodeSafe = `import express from 'express';

export function createApp(db: any) {
  function handleQuery(req: any, res: any) {
    const term = req.query.term;
    const stmt = db.prepare("SELECT * FROM items WHERE name = ?");
    const rows = stmt.all(term);
    return res.json(rows);
  }
  const app = express();
  app.get('/items', handleQuery);
  return app;
}
`;

describe('Pipeline Determinism - Stale State Rejection Across Restart-Resume', () => {
  it('recovers identical deterministic artifacts on clean pipeline restart-resume', async () => {
    const snapA = await captureSnapshot({
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-det-baseline',
      organizationId: org,
      files: [{ path: 'src/app.ts', content: sourceCodeV1 }],
    }, org);

    const snapB = await captureSnapshot({
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-det-baseline',
      organizationId: org,
      files: [{ path: 'src/app.ts', content: sourceCodeV1 }],
    }, org);

    expect(snapA.snapshotId).toBe(snapB.snapshotId);

    const ingA = await ingestExpress(snapA, org);
    const ingB = await ingestExpress(snapB, org);
    expect(ingA.ingestionIdentity).toBe(ingB.ingestionIdentity);

    const analysisA = await detectSqlInjection(snapA, ingA, org);
    const analysisB = await detectSqlInjection(snapB, ingB, org);
    expect(analysisA.status).toBe('DETECTED');
    expect(analysisA.resultFingerprint).toBe(analysisB.resultFingerprint);

    const commitSha = '1'.repeat(40);
    const bridge = createSqlCandidateBridge(async () => commitSha);
    const candidatesA = await bridge(analysisA, snapA, ingA, org);
    const candidatesB = await bridge(analysisB, snapB, ingB, org);

    expect(candidatesA).toHaveLength(1);
    expect(candidatesB).toHaveLength(1);
    expect(candidatesA[0].candidate.candidateId).toBe(candidatesB[0].candidate.candidateId);
    expect(candidatesA[0].candidateBinding).toBe(candidatesB[0].candidateBinding);
    expect(candidatesA[0].candidate.verificationState).toBe('CANDIDATE');
  });

  it('rejects stale snapshot paired with fresh resumed express ingestion', async () => {
    const snapV1 = await captureSnapshot({
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-stale-pair',
      organizationId: org,
      files: [{ path: 'src/app.ts', content: sourceCodeV1 }],
    }, org);

    const snapV2 = await captureSnapshot({
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-stale-pair',
      organizationId: org,
      files: [{ path: 'src/app.ts', content: sourceCodeV2 }],
    }, org);

    expect(snapV1.snapshotId).not.toBe(snapV2.snapshotId);

    const ingV1 = await ingestExpress(snapV1, org);
    const ingV2 = await ingestExpress(snapV2, org);

    await expect(detectSqlInjection(snapV1, ingV2, org)).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
    await expect(detectSqlInjection(snapV2, ingV1, org)).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
  });

  it('rejects stale pre-restart analysis during resume validation', async () => {
    const snapV1 = await captureSnapshot({
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-stale-analysis',
      organizationId: org,
      files: [{ path: 'src/app.ts', content: sourceCodeV1 }],
    }, org);

    const snapV2 = await captureSnapshot({
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-stale-analysis',
      organizationId: org,
      files: [{ path: 'src/app.ts', content: sourceCodeV2 }],
    }, org);

    const ingV1 = await ingestExpress(snapV1, org);
    const ingV2 = await ingestExpress(snapV2, org);

    const analysisV1 = await detectSqlInjection(snapV1, ingV1, org);
    const analysisV2 = await detectSqlInjection(snapV2, ingV2, org);

    await expect(validateSqlAnalysis(analysisV1, snapV2, ingV2, org)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
    await expect(validateSqlAnalysis(analysisV2, snapV1, ingV1, org)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
  });

  it('rejects stale state and invalid commit credentials in candidate bridge', async () => {
    const snap = await captureSnapshot({
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-stale-bridge',
      organizationId: org,
      files: [{ path: 'src/app.ts', content: sourceCodeV1 }],
    }, org);

    const snapOther = await captureSnapshot({
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-stale-bridge',
      organizationId: org,
      files: [{ path: 'src/app.ts', content: sourceCodeV2 }],
    }, org);

    const ing = await ingestExpress(snap, org);
    const analysis = await detectSqlInjection(snap, ing, org);

    const validSha = 'c'.repeat(40);
    const bridge = createSqlCandidateBridge(async () => validSha);

    await expect(bridge(analysis, snapOther, ing, org)).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');

    const zeroShaBridge = createSqlCandidateBridge(async () => '0'.repeat(40));
    await expect(zeroShaBridge(analysis, snap, ing, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const invalidShaBridge = createSqlCandidateBridge(async () => 'not-a-valid-sha');
    await expect(invalidShaBridge(analysis, snap, ing, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const validCandidates = await bridge(analysis, snap, ing, org);
    expect(validCandidates).toHaveLength(1);
    expect(validCandidates[0].candidate.verificationState).toBe('CANDIDATE');
    expect(validCandidates[0].candidate.snapshot.commitSha).toBe(validSha);

    const snapSafe = await captureSnapshot({
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-safe-bridge',
      organizationId: org,
      files: [{ path: 'src/app.ts', content: sourceCodeSafe }],
    }, org);
    const ingSafe = await ingestExpress(snapSafe, org);
    const analysisSafe = await detectSqlInjection(snapSafe, ingSafe, org);
    expect(analysisSafe.status).toBe('NOT_DETECTED');
    const safeCandidates = await bridge(analysisSafe, snapSafe, ingSafe, org);
    expect(safeCandidates).toEqual([]);
  });

  it('rejects stale commit and snapshot tampering in serialized repository ingestion', async () => {
    const snap = await captureSnapshot({
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-stale-repo-ingest',
      organizationId: org,
      files: [{ path: 'src/app.ts', content: sourceCodeV1 }],
    }, org);

    const snapUpdated = await captureSnapshot({
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-stale-repo-ingest',
      organizationId: org,
      files: [{ path: 'src/app.ts', content: sourceCodeV2 }],
    }, org);

    const initialSha = 'd'.repeat(40);
    const body = {
      version: 'velnar-repository-ingestion-v1' as const,
      organizationId: org,
      repositoryId: 'repo-stale-repo-ingest',
      commitSha: initialSha,
      snapshot: snap,
    };
    const identity = await hash('velnar-repository-ingestion-v1', body);
    const genuineRecord = { ...body, ingestionIdentity: identity };

    const validated = await validateRepositoryIngestion(genuineRecord, org);
    expect(validated.ingestionIdentity).toBe(identity);

    await expect(
      validateRepositoryIngestion({ ...genuineRecord, commitSha: 'e'.repeat(40) }, org),
    ).rejects.toThrow('ingestion identity mismatch');

    await expect(
      validateRepositoryIngestion({ ...genuineRecord, snapshot: snapUpdated }, org),
    ).rejects.toThrow('ingestion identity mismatch');

    await expect(
      validateRepositoryIngestion(genuineRecord, 'foreign_org'),
    ).rejects.toThrow('tenant mismatch');

    expect(isTrustedCommitCapability({}, validated)).toBe(false);
    expect(() => assertTrustedCommitCapability({}, validated)).toThrow('unauthorized commit capability');
  });
});
