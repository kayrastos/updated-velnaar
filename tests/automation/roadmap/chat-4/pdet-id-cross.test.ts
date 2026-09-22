import { describe, it, expect } from 'vitest';
import {
  captureSnapshot,
  validateSnapshot,
  canonical,
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

const org = 'org_roadmap_pdet';
const repoId = 'repo-pdet-id-cross';
const fixtureId = 'm2-case-001';

const helperCode = `export function buildQuery(prefix: string, param: string) {
  return prefix + param;
}
`;

const appCode = `import express from 'express';
import { buildQuery } from './helper';

export function createApp(db: any) {
  const app = express();
  function handleUser(req: any, res: any) {
    const q = req.query.id;
    const sql = buildQuery("SELECT * FROM users WHERE id = '", q);
    const stmt = db.prepare(sql);
    const rows = stmt.all();
    res.json(rows);
  }
  app.get('/user', handleUser);
  return app;
}
`;

describe('Pipeline Determinism - Cross-File Identity Stability', () => {
  it('preserves snapshot and route identities regardless of file input ordering', async () => {
    const filesA = [
      { path: 'src/helper.ts', content: helperCode },
      { path: 'src/app.ts', content: appCode },
    ];
    const filesB = [
      { path: 'src/app.ts', content: appCode },
      { path: 'src/helper.ts', content: helperCode },
    ];

    const snapshotA = await captureSnapshot(
      { fixtureId, repositoryId: repoId, organizationId: org, files: filesA },
      org,
    );
    const snapshotB = await captureSnapshot(
      { fixtureId, repositoryId: repoId, organizationId: org, files: filesB },
      org,
    );

    expect(snapshotA.snapshotId).toBe(snapshotB.snapshotId);
    expect(snapshotA.totalBytes).toBe(snapshotB.totalBytes);
    expect(snapshotA.files.length).toBe(2);
    expect(snapshotA.files[0].path).toBe('src/app.ts');
    expect(snapshotA.files[1].path).toBe('src/helper.ts');
    expect(snapshotA.files[0].fileIdentity).toBe(snapshotB.files[0].fileIdentity);
    expect(snapshotA.files[1].fileIdentity).toBe(snapshotB.files[1].fileIdentity);

    const expressA = await ingestExpress(snapshotA, org);
    const expressB = await ingestExpress(snapshotB, org);

    expect(expressA.ingestionIdentity).toBe(expressB.ingestionIdentity);
    expect(expressA.routes.length).toBe(1);
    expect(expressA.routes[0].routeIdentity).toBe(expressB.routes[0].routeIdentity);
    expect(expressA.sourceUnits.length).toBe(2);

    const analysisA = await detectSqlInjection(snapshotA, expressA, org);
    const analysisB = await detectSqlInjection(snapshotB, expressB, org);

    expect(analysisA.status).toBe('DETECTED');
    expect(analysisB.status).toBe('DETECTED');
    expect(analysisA.resultFingerprint).toBe(analysisB.resultFingerprint);
    expect(analysisA.findings.length).toBe(1);
    expect(analysisA.findings[0].findingId).toBe(analysisB.findings[0].findingId);
    expect(canonical(analysisA)).toBe(canonical(analysisB));
  });

  it('maintains deterministic flow node identities across file boundaries', async () => {
    const files = [
      { path: 'src/helper.ts', content: helperCode },
      { path: 'src/app.ts', content: appCode },
    ];
    const snapshot = await captureSnapshot(
      { fixtureId, repositoryId: repoId, organizationId: org, files },
      org,
    );
    const expressIngestion = await ingestExpress(snapshot, org);

    const analysis1 = await detectSqlInjection(snapshot, expressIngestion, org);
    const analysis2 = await detectSqlInjection(snapshot, expressIngestion, org);

    expect(analysis1.resultFingerprint).toBe(analysis2.resultFingerprint);
    expect(analysis1.findings.length).toBe(1);

    const finding1 = analysis1.findings[0];
    const finding2 = analysis2.findings[0];
    expect(finding1.findingId).toBe(finding2.findingId);
    expect(finding1.flow.length).toBe(finding2.flow.length);

    const filePathsInFlow = finding1.flow.map((step) => step.location.filePath);
    expect(filePathsInFlow.includes('src/app.ts')).toBe(true);
    expect(filePathsInFlow.includes('src/helper.ts')).toBe(true);

    for (let i = 0; i < finding1.flow.length; i++) {
      expect(finding1.flow[i].id).toBe(finding2.flow[i].id);
      expect(finding1.flow[i].kind).toBe(finding2.flow[i].kind);
      expect(finding1.flow[i].location.filePath).toBe(finding2.flow[i].location.filePath);
    }
  });

  it('binds candidate hypotheses deterministically across file boundaries without minting authority', async () => {
    const files = [
      { path: 'src/helper.ts', content: helperCode },
      { path: 'src/app.ts', content: appCode },
    ];
    const snapshot = await captureSnapshot(
      { fixtureId, repositoryId: repoId, organizationId: org, files },
      org,
    );
    const expressIngestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);

    const commitSha = 'e'.repeat(40);
    const bridge = createSqlCandidateBridge(async () => commitSha);

    const hypotheses1 = await bridge(analysis, snapshot, expressIngestion, org);
    const hypotheses2 = await bridge(analysis, snapshot, expressIngestion, org);

    expect(hypotheses1.length).toBe(1);
    expect(hypotheses2.length).toBe(1);

    const h1 = hypotheses1[0];
    const h2 = hypotheses2[0];

    expect(h1.candidate.candidateId).toBe(h2.candidate.candidateId);
    expect(h1.candidateBinding).toBe(h2.candidateBinding);
    expect(h1.candidate.verificationState).toBe('CANDIDATE');
    expect(h1.candidate.reachabilityState).toBe('REACHABLE');
    expect(h1.candidate.snapshot.commitSha).toBe(commitSha);
    expect(h1.candidate.source.filePath).toBe('src/app.ts');
    expect(h1.candidate.sink.filePath).toBe('src/app.ts');
  });

  it('enforces structural verification integrity for cross-file snapshots, express metadata, and analysis', async () => {
    const files = [
      { path: 'src/helper.ts', content: helperCode },
      { path: 'src/app.ts', content: appCode },
    ];
    const snapshot = await captureSnapshot(
      { fixtureId, repositoryId: repoId, organizationId: org, files },
      org,
    );
    const expressIngestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);

    const validatedSnapshot = await validateSnapshot(snapshot, org);
    expect(validatedSnapshot.snapshotId).toBe(snapshot.snapshotId);

    const validatedExpress = await validateExpressIngestion(expressIngestion, org);
    expect(validatedExpress.ingestionIdentity).toBe(expressIngestion.ingestionIdentity);

    const validatedAnalysis = await validateSqlAnalysis(analysis, snapshot, expressIngestion, org);
    expect(validatedAnalysis.resultFingerprint).toBe(analysis.resultFingerprint);

    const forgedAnalysis = {
      ...analysis,
      resultFingerprint: 'sha256:' + 'f'.repeat(64),
    };
    await expect(
      validateSqlAnalysis(forgedAnalysis, snapshot, expressIngestion, org),
    ).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
  });
});
