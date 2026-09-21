import { describe, it, expect } from 'vitest';
import {
  captureSnapshot,
  validateSnapshot,
  canonical,
  hash,
} from '../../../../worker/intelligence/ingestion/snapshot';
import {
  ingestExpress,
  validateExpressIngestion,
} from '../../../../worker/intelligence/ingestion/express';
import {
  detectSqlInjection,
  validateSqlAnalysis,
} from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import {
  validateRepositoryIngestion,
  isTrustedCommitCapability,
  type RepositoryIngestion,
} from '../../../../worker/intelligence/ingestion/repository';

const sampleAppSource = `import express from 'express';

export function createApp(db: any) {
  const app = express();

  function handleAccounts(req: any, res: any) {
    const accountId = req.query.id;
    const query = 'SELECT * FROM accounts WHERE id = ' + accountId;
    const stmt = db.prepare(query);
    const rows = stmt.all();
    res.json(rows);
  }

  app.get('/accounts', handleAccounts);
  return app;
}
`;

const cleanAppSource = `import express from 'express';

export function createApp(db: any) {
  const app = express();

  function handleSafe(req: any, res: any) {
    const stmt = db.prepare('SELECT * FROM accounts WHERE id = ?');
    const rows = stmt.all('safe-id');
    res.json(rows);
  }

  app.get('/safe', handleSafe);
  return app;
}
`;

describe('Pipeline Determinism Boundary Rejection and Restart Resume (pdet-bound-rst)', () => {
  const org = 'org_pdet_bound_rst';
  const repo = 'repo_pdet_bound_rst';
  const commitSha = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

  it('guarantees deterministic resume across serialize-deserialize pipeline boundaries', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: repo,
        organizationId: org,
        files: [{ path: 'src/app.ts', content: sampleAppSource }],
      },
      org,
    );

    const expressIngestion = await ingestExpress(snapshot, org);
    const sqlAnalysis = await detectSqlInjection(snapshot, expressIngestion, org);
    const bridge = createSqlCandidateBridge(async () => commitSha);
    const candidates = await bridge(sqlAnalysis, snapshot, expressIngestion, org);

    expect(sqlAnalysis.status).toBe('DETECTED');
    expect(candidates.length).toBeGreaterThan(0);

    const persistedSnapshot = JSON.parse(JSON.stringify(snapshot));
    const persistedIngestion = JSON.parse(JSON.stringify(expressIngestion));
    const persistedAnalysis = JSON.parse(JSON.stringify(sqlAnalysis));

    const resumedSnapshot = await validateSnapshot(persistedSnapshot, org);
    const resumedIngestion = await validateExpressIngestion(persistedIngestion, org);
    const resumedAnalysis = await validateSqlAnalysis(
      persistedAnalysis,
      resumedSnapshot,
      resumedIngestion,
      org,
    );
    const resumedBridge = createSqlCandidateBridge(async () => commitSha);
    const resumedCandidates = await resumedBridge(
      resumedAnalysis,
      resumedSnapshot,
      resumedIngestion,
      org,
    );

    expect(resumedSnapshot.snapshotId).toBe(snapshot.snapshotId);
    expect(resumedIngestion.ingestionIdentity).toBe(expressIngestion.ingestionIdentity);
    expect(resumedAnalysis.resultFingerprint).toBe(sqlAnalysis.resultFingerprint);
    expect(resumedCandidates.length).toBe(candidates.length);
    expect(resumedCandidates[0].candidate.candidateId).toBe(candidates[0].candidate.candidateId);
    expect(resumedCandidates[0].candidateBinding).toBe(candidates[0].candidateBinding);

    expect(canonical(resumedSnapshot)).toBe(canonical(snapshot));
    expect(canonical(resumedIngestion)).toBe(canonical(expressIngestion));
    expect(canonical(resumedAnalysis)).toBe(canonical(sqlAnalysis));
    expect(canonical(resumedCandidates)).toBe(canonical(candidates));
  });

  it('rejects foreign tenant boundaries on restart-resume', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: repo,
        organizationId: org,
        files: [{ path: 'src/app.ts', content: sampleAppSource }],
      },
      org,
    );
    const expressIngestion = await ingestExpress(snapshot, org);
    const sqlAnalysis = await detectSqlInjection(snapshot, expressIngestion, org);

    const persistedSnapshot = JSON.parse(JSON.stringify(snapshot));
    const persistedIngestion = JSON.parse(JSON.stringify(expressIngestion));
    const persistedAnalysis = JSON.parse(JSON.stringify(sqlAnalysis));

    await expect(validateSnapshot(persistedSnapshot, 'foreign_org')).rejects.toThrow();
    await expect(validateExpressIngestion(persistedIngestion, 'foreign_org')).rejects.toThrow();

    const resumedSnapshot = await validateSnapshot(persistedSnapshot, org);
    const resumedIngestion = await validateExpressIngestion(persistedIngestion, org);

    await expect(
      validateSqlAnalysis(persistedAnalysis, resumedSnapshot, resumedIngestion, 'foreign_org'),
    ).rejects.toThrow();

    const bridge = createSqlCandidateBridge(async () => commitSha);
    await expect(
      bridge(persistedAnalysis, resumedSnapshot, resumedIngestion, 'foreign_org'),
    ).rejects.toThrow();
  });

  it('rejects tampered snapshot and ingestion state on restart-resume', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: repo,
        organizationId: org,
        files: [{ path: 'src/app.ts', content: sampleAppSource }],
      },
      org,
    );
    const expressIngestion = await ingestExpress(snapshot, org);

    const persistedSnapshot = JSON.parse(JSON.stringify(snapshot));
    const persistedIngestion = JSON.parse(JSON.stringify(expressIngestion));

    const tamperedContentSnapshot = {
      ...persistedSnapshot,
      files: [
        {
          ...persistedSnapshot.files[0],
          content: persistedSnapshot.files[0].content + '\n/* tampered */',
        },
      ],
    };
    await expect(validateSnapshot(tamperedContentSnapshot, org)).rejects.toThrow();

    const forgedIdSnapshot = {
      ...persistedSnapshot,
      snapshotId: 'sha256:' + 'f'.repeat(64),
    };
    await expect(validateSnapshot(forgedIdSnapshot, org)).rejects.toThrow();

    const emptyFilesSnapshot = {
      ...persistedSnapshot,
      files: [],
    };
    await expect(validateSnapshot(emptyFilesSnapshot, org)).rejects.toThrow();

    const tamperedRouteIngestion = {
      ...persistedIngestion,
      routes: [
        {
          ...persistedIngestion.routes[0],
          routeIdentity: 'sha256:' + 'e'.repeat(64),
        },
      ],
    };
    await expect(validateExpressIngestion(tamperedRouteIngestion, org)).rejects.toThrow();

    const forgedIdentityIngestion = {
      ...persistedIngestion,
      ingestionIdentity: 'sha256:' + '0'.repeat(64),
    };
    await expect(validateExpressIngestion(forgedIdentityIngestion, org)).rejects.toThrow();
  });

  it('rejects analysis state tampering and mismatched snapshot resumption', async () => {
    const snapshotA = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: repo,
        organizationId: org,
        files: [{ path: 'src/app.ts', content: sampleAppSource }],
      },
      org,
    );
    const ingestionA = await ingestExpress(snapshotA, org);
    const analysisA = await detectSqlInjection(snapshotA, ingestionA, org);

    const snapshotB = await captureSnapshot(
      {
        fixtureId: 'm2-case-002',
        repositoryId: repo,
        organizationId: org,
        files: [{ path: 'src/app.ts', content: cleanAppSource }],
      },
      org,
    );
    const ingestionB = await ingestExpress(snapshotB, org);

    const persistedAnalysisA = JSON.parse(JSON.stringify(analysisA));

    await expect(
      validateSqlAnalysis(persistedAnalysisA, snapshotB, ingestionB, org),
    ).rejects.toThrow();

    const tamperedFindingsAnalysis = {
      ...persistedAnalysisA,
      findings: [],
      status: 'NOT_DETECTED',
    };
    await expect(
      validateSqlAnalysis(tamperedFindingsAnalysis, snapshotA, ingestionA, org),
    ).rejects.toThrow();

    const forgedFingerprintAnalysis = {
      ...persistedAnalysisA,
      resultFingerprint: 'sha256:' + 'a'.repeat(64),
    };
    await expect(
      validateSqlAnalysis(forgedFingerprintAnalysis, snapshotA, ingestionA, org),
    ).rejects.toThrow();
  });

  it('enforces checked commit boundaries and preserves non-authoritative candidate status', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: repo,
        organizationId: org,
        files: [{ path: 'src/app.ts', content: sampleAppSource }],
      },
      org,
    );
    const expressIngestion = await ingestExpress(snapshot, org);
    const sqlAnalysis = await detectSqlInjection(snapshot, expressIngestion, org);

    const zeroCommitBridge = createSqlCandidateBridge(async () => '0'.repeat(40));
    await expect(
      zeroCommitBridge(sqlAnalysis, snapshot, expressIngestion, org),
    ).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const malformedCommitBridge = createSqlCandidateBridge(async () => 'not-a-valid-sha');
    await expect(
      malformedCommitBridge(sqlAnalysis, snapshot, expressIngestion, org),
    ).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const validBridge = createSqlCandidateBridge(async () => commitSha);
    const candidateResults = await validBridge(sqlAnalysis, snapshot, expressIngestion, org);

    expect(candidateResults.length).toBeGreaterThan(0);
    for (const hypothesis of candidateResults) {
      expect(hypothesis.candidate.verificationState).toBe('CANDIDATE');
      expect((hypothesis.candidate as any).verificationState).not.toBe('VERIFIED');
      expect((hypothesis.candidate as any).capability).toBeUndefined();
      expect(hypothesis.candidate.snapshot.commitSha).toBe(commitSha);
      expect(isTrustedCommitCapability((hypothesis as any).candidate, null as any)).toBe(false);
    }
  });

  it('rejects tampered or unauthenticated repository ingestion metadata on resume', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: repo,
        organizationId: org,
        files: [{ path: 'src/app.ts', content: sampleAppSource }],
      },
      org,
    );

    const repoRecordBody = {
      version: 'velnar-repository-ingestion-v1' as const,
      organizationId: org,
      repositoryId: repo,
      commitSha,
      snapshot,
    };
    const ingestionIdentity = await hash('velnar-repository-ingestion-v1', repoRecordBody);
    const repoRecord: RepositoryIngestion = {
      ...repoRecordBody,
      ingestionIdentity,
    };

    const validated = await validateRepositoryIngestion(repoRecord, org);
    expect(validated.ingestionIdentity).toBe(ingestionIdentity);
    expect((validated as any).capability).toBeUndefined();
    expect(isTrustedCommitCapability((validated as any).capability, validated)).toBe(false);

    await expect(validateRepositoryIngestion(repoRecord, 'foreign_org')).rejects.toThrow(
      'tenant mismatch',
    );

    const forgedRepoRecord = {
      ...repoRecord,
      ingestionIdentity: 'sha256:' + 'b'.repeat(64),
    };
    await expect(validateRepositoryIngestion(forgedRepoRecord, org)).rejects.toThrow(
      'ingestion identity mismatch',
    );

    const zeroCommitRepoRecord = {
      ...repoRecord,
      commitSha: '0'.repeat(40),
      ingestionIdentity: await hash('velnar-repository-ingestion-v1', {
        ...repoRecordBody,
        commitSha: '0'.repeat(40),
      }),
    };
    await expect(validateRepositoryIngestion(zeroCommitRepoRecord, org)).rejects.toThrow(
      'Git commit identity',
    );
  });
});
