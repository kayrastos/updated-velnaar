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

const orgId = 'org_pdet_multi';
const repoId = 'repo_pdet_multi';

const cleanCode = `import express from 'express';

export function createApp(db: any) {
  const app = express();
  function handleClean(req: any, res: any) {
  }
  app.get('/clean', handleClean);
  return app;
}
`;

const vulnerableCode = `import express from 'express';

export function createApp(db: any) {
  const app = express();
  function handleVuln(req: any, res: any) {
    const query = req.query.id;
    const sql = 'SELECT id FROM items WHERE id = ' + query;
    const stmt = db.prepare(sql);
    const rows = stmt.all();
    return res.json(rows);
  }
  app.get('/items', handleVuln);
  return app;
}
`;

describe('PDET Empty & Multi-Stage Pipeline Determinism Integration', () => {
  it('preserves end-to-end pipeline determinism on clean ingestion with empty findings', async () => {
    const snapshotA = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: repoId,
        organizationId: orgId,
        files: [{ path: 'src/app.ts', content: cleanCode }],
      },
      orgId,
    );

    const snapshotB = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: repoId,
        organizationId: orgId,
        files: [{ path: 'src/app.ts', content: cleanCode }],
      },
      orgId,
    );

    expect(snapshotA.snapshotId).toBe(snapshotB.snapshotId);

    const expressA = await ingestExpress(snapshotA, orgId);
    const expressB = await ingestExpress(snapshotB, orgId);
    expect(expressA.ingestionIdentity).toBe(expressB.ingestionIdentity);

    const analysisA = await detectSqlInjection(snapshotA, expressA, orgId);
    const analysisB = await detectSqlInjection(snapshotB, expressB, orgId);
    expect(analysisA.resultFingerprint).toBe(analysisB.resultFingerprint);
    expect(analysisA.status).toBe('NOT_DETECTED');
    expect(analysisA.findings).toHaveLength(0);
    expect(analysisA.limitations).toHaveLength(0);

    const verifiedAnalysis = await validateSqlAnalysis(analysisA, snapshotA, expressA, orgId);
    expect(verifiedAnalysis.resultFingerprint).toBe(analysisA.resultFingerprint);

    let verifyCalled = false;
    const bridge = createSqlCandidateBridge(async () => {
      verifyCalled = true;
      return '1'.repeat(40);
    });

    const candidates = await bridge(analysisA, snapshotA, expressA, orgId);
    expect(candidates).toHaveLength(0);
    expect(verifyCalled).toBe(false);
  });

  it('preserves candidate boundary and non-authoritative status across multi-stage detected flow', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-002',
        repositoryId: repoId,
        organizationId: orgId,
        files: [{ path: 'src/app.ts', content: vulnerableCode }],
      },
      orgId,
    );

    const express = await ingestExpress(snapshot, orgId);
    const analysis = await detectSqlInjection(snapshot, express, orgId);
    expect(analysis.status).toBe('DETECTED');
    expect(analysis.findings.length).toBeGreaterThan(0);

    const commitSha = 'a'.repeat(40);
    const bridge = createSqlCandidateBridge(async () => commitSha);

    const resultA = await bridge(analysis, snapshot, express, orgId);
    const resultB = await bridge(analysis, snapshot, express, orgId);

    expect(resultA).toHaveLength(1);
    expect(resultA[0].candidate.reachabilityState).toBe('REACHABLE');
    expect(resultA[0].candidate.verificationState).toBe('CANDIDATE');
    expect(resultA[0].candidateBinding).toBe(resultB[0].candidateBinding);
    expect(resultA[0].candidate.candidateId).toBe(resultB[0].candidate.candidateId);
  });

  it('fails closed deterministically on null, empty, and out-of-boundary inputs across stages', async () => {
    await expect(captureSnapshot(null, orgId)).rejects.toThrow();
    await expect(validateSnapshot(null, orgId)).rejects.toThrow();
    await expect(
      captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: repoId,
          organizationId: orgId,
          files: [],
        },
        orgId,
      ),
    ).rejects.toThrow();

    await expect(ingestExpress(null, orgId)).rejects.toThrow();
    await expect(validateExpressIngestion(null as any, orgId)).rejects.toThrow();

    const emptyFileSnapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: repoId,
        organizationId: orgId,
        files: [{ path: 'src/empty.ts', content: '' }],
      },
      orgId,
    );
    expect(emptyFileSnapshot.files[0].byteLength).toBe(0);
    await expect(ingestExpress(emptyFileSnapshot, orgId)).rejects.toThrow();

    const cleanSnapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: repoId,
        organizationId: orgId,
        files: [{ path: 'src/app.ts', content: cleanCode }],
      },
      orgId,
    );
    const cleanExpress = await ingestExpress(cleanSnapshot, orgId);

    await expect(detectSqlInjection(null as any, null as any, orgId)).rejects.toThrow();
    await expect(validateSqlAnalysis(null, cleanSnapshot, cleanExpress, orgId)).rejects.toThrow();

    const mismatchedSnapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-003',
        repositoryId: 'other_repo',
        organizationId: orgId,
        files: [{ path: 'src/app.ts', content: cleanCode }],
      },
      orgId,
    );
    await expect(detectSqlInjection(mismatchedSnapshot, cleanExpress, orgId)).rejects.toThrow(
      'M3_ANALYSIS_SNAPSHOT_MISMATCH',
    );

    const vulnSnapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-002',
        repositoryId: repoId,
        organizationId: orgId,
        files: [{ path: 'src/app.ts', content: vulnerableCode }],
      },
      orgId,
    );
    const vulnExpress = await ingestExpress(vulnSnapshot, orgId);
    const vulnAnalysis = await detectSqlInjection(vulnSnapshot, vulnExpress, orgId);

    const emptyCommitBridge = createSqlCandidateBridge(async () => '');
    await expect(
      emptyCommitBridge(vulnAnalysis, vulnSnapshot, vulnExpress, orgId),
    ).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const zeroCommitBridge = createSqlCandidateBridge(async () => '0'.repeat(40));
    await expect(
      zeroCommitBridge(vulnAnalysis, vulnSnapshot, vulnExpress, orgId),
    ).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const nullCommitBridge = createSqlCandidateBridge(async () => null as any);
    await expect(
      nullCommitBridge(vulnAnalysis, vulnSnapshot, vulnExpress, orgId),
    ).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
  });
});
