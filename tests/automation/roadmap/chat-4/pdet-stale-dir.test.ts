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
import {
  validateRepositoryIngestion,
  isTrustedCommitCapability,
  assertTrustedCommitCapability,
} from '../../../../worker/intelligence/ingestion/repository';

const org = 'org_pdet_stale';

const VULNERABLE_SOURCE = `import express from 'express';

export function createApp(db: any) {
  const app = express();
  function searchHandler(req: any, res: any) {
    const term = req.query.term;
    const stmt = db.prepare('SELECT * FROM items WHERE name = ' + term);
    const rows = stmt.all();
    return res.json(rows);
  }
  app.get('/search', searchHandler);
  return app;
}
`;

const SAFE_SOURCE = `import express from 'express';

export function createApp(db: any) {
  const app = express();
  function searchHandler(req: any, res: any) {
    const term = req.query.term;
    const stmt = db.prepare('SELECT * FROM items WHERE name = ?');
    const rows = stmt.all(term);
    return res.json(rows);
  }
  app.get('/search', searchHandler);
  return app;
}
`;

describe('Pipeline Determinism - Direct Stale State Rejection', () => {
  it('directly rejects stale snapshot in SQL injection detection pipeline', async () => {
    const snapshotA = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-stale-direct',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: VULNERABLE_SOURCE }],
      },
      org,
    );

    const snapshotB = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-stale-direct',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: SAFE_SOURCE }],
      },
      org,
    );

    expect(snapshotA.snapshotId).not.toBe(snapshotB.snapshotId);

    const ingestionA = await ingestExpress(snapshotA, org);
    const ingestionB = await ingestExpress(snapshotB, org);

    expect(ingestionA.ingestionIdentity).not.toBe(ingestionB.ingestionIdentity);

    await expect(
      detectSqlInjection(snapshotA, ingestionB, org),
    ).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');

    await expect(
      detectSqlInjection(snapshotB, ingestionA, org),
    ).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
  });

  it('directly rejects stale analysis during validation against evolved snapshot', async () => {
    const snapshotA = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-stale-direct',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: VULNERABLE_SOURCE }],
      },
      org,
    );

    const snapshotB = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-stale-direct',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: SAFE_SOURCE }],
      },
      org,
    );

    const ingestionA = await ingestExpress(snapshotA, org);
    const ingestionB = await ingestExpress(snapshotB, org);

    const analysisA = await detectSqlInjection(snapshotA, ingestionA, org);
    const analysisB = await detectSqlInjection(snapshotB, ingestionB, org);

    expect(analysisA.status).toBe('DETECTED');
    expect(analysisB.status).toBe('NOT_DETECTED');

    await expect(
      validateSqlAnalysis(analysisA, snapshotB, ingestionB, org),
    ).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');

    await expect(
      validateSqlAnalysis(analysisB, snapshotA, ingestionA, org),
    ).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
  });

  it('directly rejects stale analysis and stale snapshot in SQL candidate bridge', async () => {
    const snapshotA = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-stale-direct',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: VULNERABLE_SOURCE }],
      },
      org,
    );

    const snapshotB = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-stale-direct',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: SAFE_SOURCE }],
      },
      org,
    );

    const ingestionA = await ingestExpress(snapshotA, org);
    const ingestionB = await ingestExpress(snapshotB, org);

    const analysisA = await detectSqlInjection(snapshotA, ingestionA, org);
    const validSha = 'a'.repeat(40);
    const bridge = createSqlCandidateBridge(async () => validSha);

    const genuineCandidates = await bridge(analysisA, snapshotA, ingestionA, org);
    expect(genuineCandidates).toHaveLength(1);
    expect(genuineCandidates[0].candidate.verificationState).toBe('CANDIDATE');
    expect(genuineCandidates[0].candidate.reachabilityState).toBe('REACHABLE');

    await expect(
      bridge(analysisA, snapshotB, ingestionB, org),
    ).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');

    await expect(
      bridge(analysisA, snapshotA, ingestionB, org),
    ).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');

    const invalidCommitBridge = createSqlCandidateBridge(async () => '0'.repeat(40));
    await expect(
      invalidCommitBridge(analysisA, snapshotA, ingestionA, org),
    ).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
  });

  it('directly rejects stale snapshot descriptor and identity mutation', async () => {
    const genuineSnapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-stale-direct',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: VULNERABLE_SOURCE }],
      },
      org,
    );

    const verified = await validateSnapshot(genuineSnapshot, org);
    expect(verified.snapshotId).toBe(genuineSnapshot.snapshotId);

    const staleSnapshot = {
      ...genuineSnapshot,
      snapshotId: 'sha256:' + 'f'.repeat(64),
    };

    await expect(
      validateSnapshot(staleSnapshot, org),
    ).rejects.toThrow('snapshot integrity mismatch');
  });

  it('directly rejects stale snapshot and identity in Express ingestion validation', async () => {
    const snapshotA = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-stale-direct',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: VULNERABLE_SOURCE }],
      },
      org,
    );

    const snapshotB = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-stale-direct',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: SAFE_SOURCE }],
      },
      org,
    );

    const ingestionA = await ingestExpress(snapshotA, org);

    const staleSnapshotIngestion = {
      ...ingestionA,
      snapshot: snapshotB,
    };

    await expect(
      validateExpressIngestion(staleSnapshotIngestion, org),
    ).rejects.toThrow('ingestion metadata mismatch');

    const staleIdentityIngestion = {
      ...ingestionA,
      ingestionIdentity: 'sha256:' + 'e'.repeat(64),
    };

    await expect(
      validateExpressIngestion(staleIdentityIngestion, org),
    ).rejects.toThrow('ingestion metadata mismatch');
  });

  it('directly rejects stale ingestion identity in repository ingestion validation', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-stale-direct',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: VULNERABLE_SOURCE }],
      },
      org,
    );

    const commitSha = 'c'.repeat(40);
    const staleRepoRecord = {
      version: 'velnar-repository-ingestion-v1',
      organizationId: org,
      repositoryId: 'repo-stale-direct',
      commitSha,
      snapshot,
      ingestionIdentity: 'sha256:' + 'd'.repeat(64),
    };

    await expect(
      validateRepositoryIngestion(staleRepoRecord, org),
    ).rejects.toThrow('ingestion identity mismatch');

    const foreignOrgRecord = {
      ...staleRepoRecord,
      organizationId: 'org_other',
    };

    await expect(
      validateRepositoryIngestion(foreignOrgRecord, org),
    ).rejects.toThrow('tenant mismatch');
  });

  it('strictly preserves candidate boundary and rejects unminted runtime capability', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-stale-direct',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: VULNERABLE_SOURCE }],
      },
      org,
    );

    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);
    const commitSha = 'b'.repeat(40);
    const bridge = createSqlCandidateBridge(async () => commitSha);

    const hypotheses = await bridge(analysis, snapshot, ingestion, org);
    expect(hypotheses).toHaveLength(1);

    const hypothesis = hypotheses[0];
    expect(hypothesis.candidate.verificationState).toBe('CANDIDATE');
    expect(hypothesis.candidate.reachabilityState).toBe('REACHABLE');
    expect((hypothesis.candidate as any).verificationState).not.toBe('VERIFIED');

    const fakeIngestion: any = {
      version: 'velnar-repository-ingestion-v1',
      organizationId: org,
      repositoryId: 'repo-stale-direct',
      commitSha,
      snapshot,
      ingestionIdentity: 'sha256:' + 'a'.repeat(64),
    };

    expect(isTrustedCommitCapability(hypothesis.candidate, fakeIngestion)).toBe(false);
    expect(isTrustedCommitCapability(hypothesis, fakeIngestion)).toBe(false);

    expect(() =>
      assertTrustedCommitCapability(hypothesis.candidate, fakeIngestion),
    ).toThrow('unauthorized commit capability');
  });

  it('preserves deterministic pipeline replay identity across independent runs', async () => {
    const run1Snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-stale-direct',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: VULNERABLE_SOURCE }],
      },
      org,
    );

    const run2Snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-stale-direct',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: VULNERABLE_SOURCE }],
      },
      org,
    );

    expect(run1Snapshot.snapshotId).toBe(run2Snapshot.snapshotId);

    const run1Ingestion = await ingestExpress(run1Snapshot, org);
    const run2Ingestion = await ingestExpress(run2Snapshot, org);

    expect(run1Ingestion.ingestionIdentity).toBe(run2Ingestion.ingestionIdentity);

    const run1Analysis = await detectSqlInjection(run1Snapshot, run1Ingestion, org);
    const run2Analysis = await detectSqlInjection(run2Snapshot, run2Ingestion, org);

    expect(run1Analysis.resultFingerprint).toBe(run2Analysis.resultFingerprint);

    const commitSha = 'd'.repeat(40);
    const bridge1 = createSqlCandidateBridge(async () => commitSha);
    const bridge2 = createSqlCandidateBridge(async () => commitSha);

    const hypotheses1 = await bridge1(run1Analysis, run1Snapshot, run1Ingestion, org);
    const hypotheses2 = await bridge2(run2Analysis, run2Snapshot, run2Ingestion, org);

    expect(hypotheses1).toHaveLength(1);
    expect(hypotheses2).toHaveLength(1);
    expect(hypotheses1[0].candidate.candidateId).toBe(hypotheses2[0].candidate.candidateId);
    expect(hypotheses1[0].candidateBinding).toBe(hypotheses2[0].candidateBinding);
  });
});
