import { describe, it, expect } from 'vitest';
import {
  captureSnapshot,
  validateSnapshot,
  hash,
  type SourceSnapshot,
  type SourceInput,
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
  type RepositoryIngestion,
} from '../../../../worker/intelligence/ingestion/repository';

const org = 'org_velnar_pdet';
const repoId = 'repo-pdet-stale-cross';
const fixtureId = 'm2-case-001';

const appSource = `import express from 'express';
import { sanitizeParam } from './sanitizer';

export function createApp(db: any) {
  const app = express();
  function searchHandler(req: any, res: any) {
    const term = req.query.term;
    const clean = sanitizeParam(term);
    const statement = db.prepare('SELECT * FROM items WHERE name = ' + clean);
    res.json(statement.all());
  }
  app.get('/search', searchHandler);
  return app;
}
`;

const sanitizerV1Source = `export function sanitizeParam(raw: any) {
  return raw;
}
`;

const sanitizerV2Source = `export function sanitizeParam(raw: any) {
  return 'safe_constant';
}
`;

const filesV1: readonly SourceInput[] = [
  { path: 'src/routes/app.ts', content: appSource },
  { path: 'src/routes/sanitizer.ts', content: sanitizerV1Source },
];

const filesV2: readonly SourceInput[] = [
  { path: 'src/routes/app.ts', content: appSource },
  { path: 'src/routes/sanitizer.ts', content: sanitizerV2Source },
];

describe('Pipeline Determinism: Cross-File Stale State Rejection', () => {
  it('rejects stale cross-file ingestion when paired with a fresh snapshot at detection boundary', async () => {
    const snapshotV1 = await captureSnapshot({ fixtureId, repositoryId: repoId, organizationId: org, files: filesV1 }, org);
    const snapshotV2 = await captureSnapshot({ fixtureId, repositoryId: repoId, organizationId: org, files: filesV2 }, org);

    expect(snapshotV1.snapshotId).not.toBe(snapshotV2.snapshotId);

    const ingestionV1 = await ingestExpress(snapshotV1, org);
    const ingestionV2 = await ingestExpress(snapshotV2, org);

    expect(ingestionV1.ingestionIdentity).not.toBe(ingestionV2.ingestionIdentity);

    const analysisV1 = await detectSqlInjection(snapshotV1, ingestionV1, org);
    expect(analysisV1.status).toBe('DETECTED');
    expect(analysisV1.findings).toHaveLength(1);

    const analysisV2 = await detectSqlInjection(snapshotV2, ingestionV2, org);
    expect(analysisV2.status).toBe('NOT_DETECTED');
    expect(analysisV2.findings).toHaveLength(0);

    await expect(detectSqlInjection(snapshotV2, ingestionV1, org)).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
    await expect(detectSqlInjection(snapshotV1, ingestionV2, org)).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
  });

  it('rejects stale cross-file analysis when validated against a fresh snapshot/ingestion pair', async () => {
    const snapshotV1 = await captureSnapshot({ fixtureId, repositoryId: repoId, organizationId: org, files: filesV1 }, org);
    const snapshotV2 = await captureSnapshot({ fixtureId, repositoryId: repoId, organizationId: org, files: filesV2 }, org);

    const ingestionV1 = await ingestExpress(snapshotV1, org);
    const ingestionV2 = await ingestExpress(snapshotV2, org);

    const analysisV1 = await detectSqlInjection(snapshotV1, ingestionV1, org);
    const analysisV2 = await detectSqlInjection(snapshotV2, ingestionV2, org);

    expect(analysisV1.resultFingerprint).not.toBe(analysisV2.resultFingerprint);

    await expect(validateSqlAnalysis(analysisV1, snapshotV2, ingestionV2, org)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
    await expect(validateSqlAnalysis(analysisV2, snapshotV1, ingestionV1, org)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
    await expect(validateSqlAnalysis(analysisV1, snapshotV2, ingestionV1, org)).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
  });

  it('rejects stale cross-file state through the candidate bridge and preserves candidate non-authority', async () => {
    const snapshotV1 = await captureSnapshot({ fixtureId, repositoryId: repoId, organizationId: org, files: filesV1 }, org);
    const snapshotV2 = await captureSnapshot({ fixtureId, repositoryId: repoId, organizationId: org, files: filesV2 }, org);

    const ingestionV1 = await ingestExpress(snapshotV1, org);
    const ingestionV2 = await ingestExpress(snapshotV2, org);

    const analysisV1 = await detectSqlInjection(snapshotV1, ingestionV1, org);
    const analysisV2 = await detectSqlInjection(snapshotV2, ingestionV2, org);

    const dummyCommitSha = 'a'.repeat(40);
    const verifyCommittedCode = async (snapshot: SourceSnapshot): Promise<string> => {
      if (snapshot.snapshotId !== snapshotV1.snapshotId) {
        throw new Error('M4_STALE_SNAPSHOT_COMMIT_MISMATCH');
      }
      return dummyCommitSha;
    };

    const bridge = createSqlCandidateBridge(verifyCommittedCode);

    await expect(bridge(analysisV1, snapshotV2, ingestionV2, org)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
    await expect(bridge(analysisV1, snapshotV2, ingestionV1, org)).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');

    const cleanCandidates = await bridge(analysisV2, snapshotV2, ingestionV2, org);
    expect(cleanCandidates).toHaveLength(0);

    const genuineCandidates = await bridge(analysisV1, snapshotV1, ingestionV1, org);
    expect(genuineCandidates).toHaveLength(1);

    const candidate = genuineCandidates[0].candidate;
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.snapshot.snapshotId).toBe(snapshotV1.snapshotId);
    expect(candidate.snapshot.commitSha).toBe(dummyCommitSha);
    expect((candidate as any).capability).toBeUndefined();
    expect((candidate as any).verified).toBeUndefined();
  });

  it('rejects forged cross-file repository ingestion records with mismatched snapshot or identity', async () => {
    const snapshotV1 = await captureSnapshot({ fixtureId, repositoryId: repoId, organizationId: org, files: filesV1 }, org);
    const snapshotV2 = await captureSnapshot({ fixtureId, repositoryId: repoId, organizationId: org, files: filesV2 }, org);

    const commitSha = 'b'.repeat(40);
    const bodyV1 = {
      version: 'velnar-repository-ingestion-v1' as const,
      organizationId: org,
      repositoryId: repoId,
      commitSha,
      snapshot: snapshotV1,
    };
    const ingestionIdentityV1 = await hash('velnar-repository-ingestion-v1', bodyV1);
    const genuineRecord: RepositoryIngestion = {
      ...bodyV1,
      ingestionIdentity: ingestionIdentityV1,
    };

    const validated = await validateRepositoryIngestion(genuineRecord, org);
    expect(validated.snapshot.snapshotId).toBe(snapshotV1.snapshotId);

    const staleSubstituted = {
      ...genuineRecord,
      snapshot: snapshotV2,
    };
    await expect(validateRepositoryIngestion(staleSubstituted, org)).rejects.toThrow('ingestion identity mismatch');

    await expect(validateRepositoryIngestion(genuineRecord, 'foreign_org')).rejects.toThrow('tenant mismatch');
  });

  it('rejects duplicate canonical file paths in cross-file snapshot input', async () => {
    const duplicateFiles: readonly SourceInput[] = [
      ...filesV1,
      { path: 'src/routes/APP.ts', content: 'export const duplicate = true;\n' },
    ];

    await expect(captureSnapshot({
      fixtureId,
      repositoryId: repoId,
      organizationId: org,
      files: duplicateFiles,
    }, org)).rejects.toThrow('duplicate canonical path');
  });
});
