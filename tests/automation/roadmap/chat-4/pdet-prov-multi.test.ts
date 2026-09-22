import { describe, it, expect } from 'vitest';
import {
  captureSnapshot,
  validateSnapshot,
  hash,
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
import {
  validateRepositoryIngestion,
  isTrustedCommitCapability,
  assertTrustedCommitCapability,
} from '../../../../worker/intelligence/ingestion/repository';

const org = 'org_pdet_multi';
const repoId = 'repo_pdet_multi';
const fixtureId = 'm2-case-001';
const commitSha = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

const expressAppSource = `import express from 'express';

export function createApp(db: any) {
  const app = express();

  function queryHandler(req: any, res: any) {
    const term = req.query.term;
    const stmt = db.prepare('SELECT * FROM items WHERE name = ' + term);
    const rows = stmt.all();
    return res.json(rows);
  }

  app.get('/items', queryHandler);
  return app;
}
`;

const safeAppSource = `import express from 'express';

export function createApp(db: any) {
  const app = express();

  function safeHandler(req: any, res: any) {
    const stmt = db.prepare('SELECT * FROM items');
    const rows = stmt.all();
    return res.json(rows);
  }

  app.get('/items', safeHandler);
  return app;
}
`;

async function makeRepoRecord(snapshot: SourceSnapshot, sha = commitSha) {
  const body = {
    version: 'velnar-repository-ingestion-v1' as const,
    organizationId: org,
    repositoryId: repoId,
    commitSha: sha,
    snapshot,
  };
  const ingestionIdentity = await hash('velnar-repository-ingestion-v1', body);
  return { ...body, ingestionIdentity };
}

describe('Multi-Stage Pipeline Determinism and Provenance Integrity', () => {
  it('executes multi-stage pipeline deterministically across independent runs', async () => {
    const input = {
      fixtureId,
      repositoryId: repoId,
      organizationId: org,
      files: [{ path: 'src/app.ts', content: expressAppSource }],
    };

    const snapshotA = await captureSnapshot(input, org);
    const snapshotB = await captureSnapshot(input, org);

    expect(snapshotA.snapshotId).toBe(snapshotB.snapshotId);
    expect(snapshotA.totalBytes).toBe(snapshotB.totalBytes);
    expect(snapshotA.files[0].fileIdentity).toBe(snapshotB.files[0].fileIdentity);
    expect(snapshotA.files[0].contentDigest).toBe(snapshotB.files[0].contentDigest);

    const validatedA = await validateSnapshot(snapshotA, org);
    expect(validatedA.snapshotId).toBe(snapshotA.snapshotId);

    const expressA = await ingestExpress(snapshotA, org);
    const expressB = await ingestExpress(snapshotB, org);

    expect(expressA.ingestionIdentity).toBe(expressB.ingestionIdentity);
    expect(expressA.routes.length).toBe(1);
    expect(expressA.routes[0].routeIdentity).toBe(expressB.routes[0].routeIdentity);

    const analysisA = await detectSqlInjection(snapshotA, expressA, org);
    const analysisB = await detectSqlInjection(snapshotB, expressB, org);

    expect(analysisA.status).toBe('DETECTED');
    expect(analysisB.status).toBe('DETECTED');
    expect(analysisA.resultFingerprint).toBe(analysisB.resultFingerprint);
    expect(analysisA.findings.length).toBe(1);
    expect(analysisA.findings[0].findingId).toBe(analysisB.findings[0].findingId);
    expect(analysisA.findings[0].flow[0].id).toBe(analysisB.findings[0].flow[0].id);

    const bridgeA = createSqlCandidateBridge(async () => commitSha);
    const bridgeB = createSqlCandidateBridge(async () => commitSha);

    const candidatesA = await bridgeA(analysisA, snapshotA, expressA, org);
    const candidatesB = await bridgeB(analysisB, snapshotB, expressB, org);

    expect(candidatesA.length).toBe(1);
    expect(candidatesB.length).toBe(1);
    expect(candidatesA[0].candidate.candidateId).toBe(candidatesB[0].candidate.candidateId);
    expect(candidatesA[0].candidateBinding).toBe(candidatesB[0].candidateBinding);
    expect(candidatesA[0].candidate.verificationState).toBe('CANDIDATE');
  });

  it('preserves repository ingestion provenance and rejects foreign tenant or forged commit', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId,
        repositoryId: repoId,
        organizationId: org,
        files: [{ path: 'src/app.ts', content: expressAppSource }],
      },
      org,
    );

    const repoRecord = await makeRepoRecord(snapshot);
    const valid = await validateRepositoryIngestion(repoRecord, org);

    expect(valid.ingestionIdentity).toBe(repoRecord.ingestionIdentity);
    expect(valid.commitSha).toBe(commitSha);
    expect(valid.snapshot.snapshotId).toBe(snapshot.snapshotId);
    expect((valid as any).capability).toBeUndefined();
    expect(isTrustedCommitCapability((valid as any).capability, valid)).toBe(false);
    expect(() => assertTrustedCommitCapability((valid as any).capability, valid)).toThrow();

    await expect(validateRepositoryIngestion(repoRecord, 'foreign_org')).rejects.toThrow();

    const forgedCommit = { ...repoRecord, commitSha: 'e'.repeat(40) };
    await expect(validateRepositoryIngestion(forgedCommit, org)).rejects.toThrow();

    const mismatchedRepo = { ...repoRecord, repositoryId: 'other_repo' };
    await expect(validateRepositoryIngestion(mismatchedRepo, org)).rejects.toThrow();
  });

  it('enforces cross-stage snapshot and analysis provenance binding', async () => {
    const inputA = {
      fixtureId,
      repositoryId: repoId,
      organizationId: org,
      files: [{ path: 'src/app.ts', content: expressAppSource }],
    };

    const snapshotA = await captureSnapshot(inputA, org);
    const expressA = await ingestExpress(snapshotA, org);

    const otherSnapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-002',
        repositoryId: repoId,
        organizationId: org,
        files: [{ path: 'src/app.ts', content: safeAppSource }],
      },
      org,
    );

    await expect(detectSqlInjection(otherSnapshot, expressA, org)).rejects.toThrow(
      'M3_ANALYSIS_SNAPSHOT_MISMATCH',
    );

    const validatedExpress = await validateExpressIngestion(expressA, org);
    expect(validatedExpress.ingestionIdentity).toBe(expressA.ingestionIdentity);

    const analysis = await detectSqlInjection(snapshotA, expressA, org);
    const validatedAnalysis = await validateSqlAnalysis(analysis, snapshotA, expressA, org);
    expect(validatedAnalysis.resultFingerprint).toBe(analysis.resultFingerprint);

    const tamperedAnalysis = { ...analysis, status: 'NOT_DETECTED' as const };
    await expect(
      validateSqlAnalysis(tamperedAnalysis, snapshotA, expressA, org),
    ).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
  });

  it('bounds candidate bridge to checked commit provenance and non-authoritative candidate state', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId,
        repositoryId: repoId,
        organizationId: org,
        files: [{ path: 'src/app.ts', content: expressAppSource }],
      },
      org,
    );

    const express = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, express, org);

    let callbackSnapshotId = '';
    const bridge = createSqlCandidateBridge(async (snap) => {
      callbackSnapshotId = snap.snapshotId;
      return commitSha;
    });

    const candidates = await bridge(analysis, snapshot, express, org);
    expect(callbackSnapshotId).toBe(snapshot.snapshotId);
    expect(candidates.length).toBe(1);

    const { candidate, candidateBinding } = candidates[0];
    expect(typeof candidateBinding).toBe('string');
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.snapshot.commitSha).toBe(commitSha);
    expect(candidate.snapshot.snapshotId).toBe(snapshot.snapshotId);
    expect((candidate as any).capability).toBeUndefined();

    const badShaBridge = createSqlCandidateBridge(async () => '0'.repeat(40));
    await expect(badShaBridge(analysis, snapshot, express, org)).rejects.toThrow(
      'M3_CHECKED_COMMIT_REQUIRED',
    );

    const safeSnapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-002',
        repositoryId: repoId,
        organizationId: org,
        files: [{ path: 'src/app.ts', content: safeAppSource }],
      },
      org,
    );
    const safeExpress = await ingestExpress(safeSnapshot, org);
    const safeAnalysis = await detectSqlInjection(safeSnapshot, safeExpress, org);
    expect(safeAnalysis.status).toBe('NOT_DETECTED');

    const emptyBridge = createSqlCandidateBridge(async () => commitSha);
    const noCandidates = await emptyBridge(safeAnalysis, safeSnapshot, safeExpress, org);
    expect(noCandidates).toEqual([]);
  });
});
