import { describe, it, expect } from 'vitest';
import {
  captureSnapshot,
  validateSnapshot,
  type SourceSnapshot,
} from '../../../../worker/intelligence/ingestion/snapshot';
import {
  ingestExpress,
  validateExpressIngestion,
  type ExpressIngestion,
} from '../../../../worker/intelligence/ingestion/express';
import {
  detectSqlInjection,
  validateSqlAnalysis,
} from '../../../../worker/intelligence/detection/sqlInjection';
import {
  createSqlCandidateBridge,
} from '../../../../worker/intelligence/detection/candidate';

const org = 'org_apex_holding';
const repoId = 'repo-pdet-neg-cross';
const fixtureId = 'm2-case-001';

const queryFileContent = `export function getSafeUserQuery() {
  return 'SELECT id, username, email FROM users WHERE id = ?';
}

export function getSafeProfileQuery() {
  return 'SELECT id, bio, avatar_url FROM profiles WHERE user_id = ?';
}
`;

const appFileContent = `import express from 'express';
import { getSafeUserQuery, getSafeProfileQuery } from './query';

export function createApp(db: any) {
  const app = express();
  function handleGetUser(req: any, res: any) {
    const query = getSafeUserQuery();
    const stmt = db.prepare(query);
    const rows = stmt.all(req.query.id);
    return res.json(rows);
  }
  function handleGetProfile(req: any, res: any) {
    const query = getSafeProfileQuery();
    const stmt = db.prepare(query);
    const rows = stmt.all(req.query.userId);
    return res.json(rows);
  }
  app.get('/users', handleGetUser);
  app.get('/profile', handleGetProfile);
  return app;
}
`;

const canonicalFiles = [
  { path: 'src/app.ts', content: appFileContent },
  { path: 'src/query.ts', content: queryFileContent },
];

async function runPipeline(files = canonicalFiles) {
  const snapshot = await captureSnapshot(
    { fixtureId, repositoryId: repoId, organizationId: org, files },
    org,
  );
  const ingestion = await ingestExpress(snapshot, org);
  const analysis = await detectSqlInjection(snapshot, ingestion, org);
  return { snapshot, ingestion, analysis };
}

describe('Roadmap Chat-4: Pipeline Determinism Negative Control Cross-File', () => {
  it('deterministically yields NOT_DETECTED with zero findings across multiple pipeline runs', async () => {
    const run1 = await runPipeline();
    const run2 = await runPipeline();
    const run3 = await runPipeline();

    expect(run1.snapshot.snapshotId).toBe(run2.snapshot.snapshotId);
    expect(run2.snapshot.snapshotId).toBe(run3.snapshot.snapshotId);

    expect(run1.ingestion.ingestionIdentity).toBe(run2.ingestion.ingestionIdentity);
    expect(run2.ingestion.ingestionIdentity).toBe(run3.ingestion.ingestionIdentity);

    expect(run1.analysis.resultFingerprint).toBe(run2.analysis.resultFingerprint);
    expect(run2.analysis.resultFingerprint).toBe(run3.analysis.resultFingerprint);

    expect(run1.analysis.status).toBe('NOT_DETECTED');
    expect(run1.analysis.findings).toHaveLength(0);
    expect(run1.analysis.limitations).toHaveLength(0);

    expect(run1.analysis.routeIdentities).toHaveLength(2);
    expect(run1.analysis.routeIdentities).toEqual(run2.analysis.routeIdentities);
  });

  it('preserves snapshot and pipeline determinism under file ordering permutation', async () => {
    const canonical = await runPipeline(canonicalFiles);
    const permutedFiles = [
      { path: 'src/query.ts', content: queryFileContent },
      { path: 'src/app.ts', content: appFileContent },
    ];
    const permuted = await runPipeline(permutedFiles);

    expect(permuted.snapshot.snapshotId).toBe(canonical.snapshot.snapshotId);
    expect(permuted.snapshot.totalBytes).toBe(canonical.snapshot.totalBytes);
    expect(permuted.ingestion.ingestionIdentity).toBe(canonical.ingestion.ingestionIdentity);
    expect(permuted.analysis.resultFingerprint).toBe(canonical.analysis.resultFingerprint);
    expect(permuted.analysis.status).toBe('NOT_DETECTED');
    expect(permuted.analysis.findings).toHaveLength(0);
  });

  it('confirms pipeline structural and integrity validation round-trips without drift', async () => {
    const { snapshot, ingestion, analysis } = await runPipeline();

    const validatedSnapshot = await validateSnapshot(snapshot, org);
    expect(validatedSnapshot.snapshotId).toBe(snapshot.snapshotId);

    const validatedIngestion = await validateExpressIngestion(ingestion, org);
    expect(validatedIngestion.ingestionIdentity).toBe(ingestion.ingestionIdentity);

    const validatedAnalysis = await validateSqlAnalysis(analysis, snapshot, ingestion, org);
    expect(validatedAnalysis.resultFingerprint).toBe(analysis.resultFingerprint);
    expect(validatedAnalysis.status).toBe('NOT_DETECTED');
  });

  it('fails closed when foreign tenant or tampered analysis metadata is provided', async () => {
    const { snapshot, ingestion, analysis } = await runPipeline();

    await expect(validateSnapshot(snapshot, 'foreign_org')).rejects.toThrow('tenant mismatch');
    await expect(validateExpressIngestion(ingestion, 'foreign_org')).rejects.toThrow('tenant mismatch');
    await expect(detectSqlInjection(snapshot, ingestion, 'foreign_org')).rejects.toThrow('tenant mismatch');

    const forgedStatus = { ...analysis, status: 'DETECTED' as const };
    await expect(
      validateSqlAnalysis(forgedStatus, snapshot, ingestion, org),
    ).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');

    const forgedFingerprint = {
      ...analysis,
      resultFingerprint: 'sha256:' + '0'.repeat(64),
    };
    await expect(
      validateSqlAnalysis(forgedFingerprint, snapshot, ingestion, org),
    ).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
  });

  it('enforces candidate bridge negative control contract without minting authority', async () => {
    const { snapshot, ingestion, analysis } = await runPipeline();

    let commitVerificationCalls = 0;
    const verifyCommit = async (_snap: SourceSnapshot): Promise<string> => {
      commitVerificationCalls++;
      return 'a'.repeat(40);
    };

    const bridge = createSqlCandidateBridge(verifyCommit);
    const candidates = await bridge(analysis, snapshot, ingestion, org);

    expect(candidates).toEqual([]);
    expect(Object.isFrozen(candidates)).toBe(true);
    expect(commitVerificationCalls).toBe(0);
  });
});
