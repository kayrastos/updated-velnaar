import { describe, it, expect } from 'vitest';
import {
  captureSnapshot,
  validateSnapshot,
  canonical,
  type SourceSnapshot,
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

const org = 'org_pdet_multi';
const repoId = 'repo-pdet-multi';
const fixtureId = 'm2-case-001';
const commitSha = 'a'.repeat(40);

const appCode = `import express from 'express';

export function createApp(db: any) {
  const app = express();

  function handleUsers(req: any, res: any) {
    const query = req.query.id;
    const stmt = db.prepare('SELECT * FROM users WHERE id = ' + query);
    const rows = stmt.all();
    return res.json(rows);
  }

  app.get('/users', handleUsers);
  return app;
}
`;

describe('Pipeline Determinism: Multi-Stage Replay Determinism', () => {
  it('preserves exact identities, fingerprints, and candidate bindings across replays', async () => {
    // Stage 1: Snapshot capture
    const snapshot1 = await captureSnapshot(
      {
        fixtureId,
        repositoryId: repoId,
        organizationId: org,
        files: [{ path: 'src/app.ts', content: appCode }],
      },
      org,
    );

    // Stage 2: Express ingestion
    const ingestion1 = await ingestExpress(snapshot1, org);

    // Stage 3: Detection
    const analysis1 = await detectSqlInjection(snapshot1, ingestion1, org);

    // Stage 4: Candidate bridge
    const bridge1 = createSqlCandidateBridge(async (_snap: SourceSnapshot) => commitSha);
    const candidates1 = await bridge1(analysis1, snapshot1, ingestion1, org);

    expect(analysis1.status).toBe('DETECTED');
    expect(analysis1.findings.length).toBe(1);
    expect(candidates1.length).toBe(1);
    expect(candidates1[0].candidate.verificationState).toBe('CANDIDATE');
    expect(candidates1[0].candidate.verificationState).not.toBe('VERIFIED');

    // Stage 1 replay from identical raw inputs
    const snapshot2 = await captureSnapshot(
      {
        fixtureId,
        repositoryId: repoId,
        organizationId: org,
        files: [{ path: 'src/app.ts', content: appCode }],
      },
      org,
    );

    // Stage 2 replay
    const ingestion2 = await ingestExpress(snapshot2, org);

    // Stage 3 replay
    const analysis2 = await detectSqlInjection(snapshot2, ingestion2, org);

    // Stage 4 replay
    const bridge2 = createSqlCandidateBridge(async (_snap: SourceSnapshot) => commitSha);
    const candidates2 = await bridge2(analysis2, snapshot2, ingestion2, org);

    // Replay determinism assertions across runs 1 and 2
    expect(snapshot2.snapshotId).toBe(snapshot1.snapshotId);
    expect(canonical(snapshot2)).toBe(canonical(snapshot1));

    expect(ingestion2.ingestionIdentity).toBe(ingestion1.ingestionIdentity);
    expect(canonical(ingestion2)).toBe(canonical(ingestion1));

    expect(analysis2.resultFingerprint).toBe(analysis1.resultFingerprint);
    expect(canonical(analysis2)).toBe(canonical(analysis1));

    expect(candidates2[0].candidateBinding).toBe(candidates1[0].candidateBinding);
    expect(canonical(candidates2)).toBe(canonical(candidates1));

    // Replay from validated intermediate representations
    const validatedSnapshot = await validateSnapshot(snapshot1, org);
    const validatedIngestion = await validateExpressIngestion(ingestion1, org);
    const validatedAnalysis = await validateSqlAnalysis(
      analysis1,
      validatedSnapshot,
      validatedIngestion,
      org,
    );

    const bridge3 = createSqlCandidateBridge(async (_snap: SourceSnapshot) => commitSha);
    const candidates3 = await bridge3(
      validatedAnalysis,
      validatedSnapshot,
      validatedIngestion,
      org,
    );

    expect(validatedSnapshot.snapshotId).toBe(snapshot1.snapshotId);
    expect(canonical(validatedSnapshot)).toBe(canonical(snapshot1));

    expect(validatedIngestion.ingestionIdentity).toBe(ingestion1.ingestionIdentity);
    expect(canonical(validatedIngestion)).toBe(canonical(ingestion1));

    expect(validatedAnalysis.resultFingerprint).toBe(analysis1.resultFingerprint);
    expect(canonical(validatedAnalysis)).toBe(canonical(analysis1));

    expect(candidates3[0].candidateBinding).toBe(candidates1[0].candidateBinding);
    expect(canonical(candidates3)).toBe(canonical(candidates1));
  });

  it('fails closed when tenant boundary is crossed at any pipeline stage', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId,
        repositoryId: repoId,
        organizationId: org,
        files: [{ path: 'src/app.ts', content: appCode }],
      },
      org,
    );
    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);

    await expect(validateSnapshot(snapshot, 'foreign_org')).rejects.toThrow();
    await expect(validateExpressIngestion(ingestion, 'foreign_org')).rejects.toThrow();
    await expect(detectSqlInjection(snapshot, ingestion, 'foreign_org')).rejects.toThrow();
    await expect(validateSqlAnalysis(analysis, snapshot, ingestion, 'foreign_org')).rejects.toThrow();
  });

  it('fails closed on forged or unverified commit capability in candidate bridge', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId,
        repositoryId: repoId,
        organizationId: org,
        files: [{ path: 'src/app.ts', content: appCode }],
      },
      org,
    );
    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);

    const badBridge = createSqlCandidateBridge(async (_snap: SourceSnapshot) => 'invalid-sha');
    await expect(badBridge(analysis, snapshot, ingestion, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
  });
});
