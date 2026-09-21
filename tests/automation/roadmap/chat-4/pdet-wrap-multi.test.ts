import { describe, it, expect } from 'vitest';
import { captureSnapshot, canonical } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';

const org = 'org_wrap_multi';
const validCommitSha = 'a'.repeat(40);

const vulnerableSource = `import express from 'express';

export function createApp(db: any) {
  const app = express();

  function searchHandler(req: any, res: any) {
    const term = req.query.term;
    const query = 'SELECT * FROM items WHERE name = ' + term;
    const stmt = db.prepare(query);
    const rows = stmt.all();
    return res.json(rows);
  }

  app.get('/items', searchHandler);
  return app;
}
`;

const safeSource = `import express from 'express';

export function createApp(db: any) {
  const app = express();

  function safeHandler(req: any, res: any) {
    const term = req.query.term;
    const stmt = db.prepare('SELECT * FROM items WHERE name = ?');
    const rows = stmt.all(term);
    return res.json(rows);
  }

  app.get('/items', safeHandler);
  return app;
}
`;

describe('Pipeline Determinism Wrapper Boundary Multi-Stage Integration (RM_PDET_WRAP_MULTI)', () => {
  it('executes deterministic multi-stage pipeline from snapshot to candidate hypotheses', async () => {
    const input = {
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-wrap-multi',
      organizationId: org,
      files: [{ path: 'src/app.ts', content: vulnerableSource }],
    };

    const snap1 = await captureSnapshot(input, org);
    const ing1 = await ingestExpress(snap1, org);
    const det1 = await detectSqlInjection(snap1, ing1, org);

    const verifyCallback = async () => validCommitSha;
    const bridge = createSqlCandidateBridge(verifyCallback);
    const cand1 = await bridge(det1, snap1, ing1, org);

    const snap2 = await captureSnapshot(input, org);
    const ing2 = await ingestExpress(snap2, org);
    const det2 = await detectSqlInjection(snap2, ing2, org);
    const cand2 = await bridge(det2, snap2, ing2, org);

    expect(snap1.snapshotId).toBe(snap2.snapshotId);
    expect(ing1.ingestionIdentity).toBe(ing2.ingestionIdentity);
    expect(det1.resultFingerprint).toBe(det2.resultFingerprint);
    expect(cand1.length).toBe(1);
    expect(cand2.length).toBe(1);
    expect(cand1[0].candidate.candidateId).toBe(cand2[0].candidate.candidateId);
    expect(cand1[0].candidateBinding).toBe(cand2[0].candidateBinding);
    expect(canonical(cand1)).toBe(canonical(cand2));

    expect(cand1[0].candidate.verificationState).toBe('CANDIDATE');
    expect(cand1[0].candidate.reachabilityState).toBe('REACHABLE');
    expect(cand1[0].candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(cand1[0].candidate.organizationId).toBe(org);
    expect(cand1[0].candidate.snapshot.commitSha).toBe(validCommitSha);
  });

  it('preserves multi-stage determinism and returns empty frozen candidate list on clean negative pipeline', async () => {
    const input = {
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-wrap-multi-clean',
      organizationId: org,
      files: [{ path: 'src/app.ts', content: safeSource }],
    };

    const snapshot = await captureSnapshot(input, org);
    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);

    expect(analysis.status).toBe('NOT_DETECTED');
    expect(analysis.findings.length).toBe(0);

    let verifyCalled = false;
    const bridge = createSqlCandidateBridge(async () => {
      verifyCalled = true;
      return validCommitSha;
    });

    const candidates = await bridge(analysis, snapshot, ingestion, org);

    expect(candidates).toEqual([]);
    expect(Object.isFrozen(candidates)).toBe(true);
    expect(verifyCalled).toBe(false);
  });

  it('enforces wrapper boundary validation and rejects tampered intermediate stage artifacts', async () => {
    const input = {
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-wrap-multi-tamper',
      organizationId: org,
      files: [{ path: 'src/app.ts', content: vulnerableSource }],
    };

    const snapshot = await captureSnapshot(input, org);
    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);
    const bridge = createSqlCandidateBridge(async () => validCommitSha);

    const tamperedAnalysis = {
      ...analysis,
      resultFingerprint: 'sha256:' + '0'.repeat(64),
    };
    await expect(bridge(tamperedAnalysis, snapshot, ingestion, org)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');

    const tamperedSnapshot = {
      ...snapshot,
      snapshotId: 'sha256:' + '0'.repeat(64),
    };
    await expect(bridge(analysis, tamperedSnapshot, ingestion, org)).rejects.toThrow('snapshot integrity mismatch');

    const tamperedIngestion = {
      ...ingestion,
      ingestionIdentity: 'sha256:' + '0'.repeat(64),
    };
    await expect(bridge(analysis, snapshot, tamperedIngestion, org)).rejects.toThrow('ingestion metadata mismatch');
  });

  it('rejects cross-stage snapshot mismatch across wrapper boundary', async () => {
    const inputA = {
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-wrap-multi-a',
      organizationId: org,
      files: [{ path: 'src/app.ts', content: vulnerableSource }],
    };
    const inputB = {
      fixtureId: 'm2-case-002',
      repositoryId: 'repo-wrap-multi-b',
      organizationId: org,
      files: [{ path: 'src/app.ts', content: vulnerableSource }],
    };

    const snapA = await captureSnapshot(inputA, org);
    const snapB = await captureSnapshot(inputB, org);
    const ingB = await ingestExpress(snapB, org);
    const detB = await detectSqlInjection(snapB, ingB, org);

    const bridge = createSqlCandidateBridge(async () => validCommitSha);

    await expect(bridge(detB, snapA, ingB, org)).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
  });

  it('requires trusted commit verification callback and enforces non-authoritative candidate boundary', async () => {
    const input = {
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-wrap-multi-commit',
      organizationId: org,
      files: [{ path: 'src/app.ts', content: vulnerableSource }],
    };

    const snapshot = await captureSnapshot(input, org);
    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);

    const zeroShaBridge = createSqlCandidateBridge(async () => '0'.repeat(40));
    await expect(zeroShaBridge(analysis, snapshot, ingestion, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const invalidShaBridge = createSqlCandidateBridge(async () => 'not-a-valid-sha');
    await expect(invalidShaBridge(analysis, snapshot, ingestion, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const nonStringBridge = createSqlCandidateBridge(async () => null as unknown as string);
    await expect(nonStringBridge(analysis, snapshot, ingestion, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
  });

  it('enforces tenant isolation across the multi-stage wrapper boundary', async () => {
    const input = {
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-wrap-multi-tenant',
      organizationId: org,
      files: [{ path: 'src/app.ts', content: vulnerableSource }],
    };

    const snapshot = await captureSnapshot(input, org);
    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);
    const bridge = createSqlCandidateBridge(async () => validCommitSha);

    await expect(bridge(analysis, snapshot, ingestion, 'foreign_org')).rejects.toThrow('tenant mismatch');
  });
});
