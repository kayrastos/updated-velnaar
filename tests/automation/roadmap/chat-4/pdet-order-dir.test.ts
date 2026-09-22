import { describe, it, expect } from 'vitest';
import {
  captureSnapshot,
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

const orgId = 'org_pdet_dir';
const repoId = 'repo_pdet_dir';
const fixtureId = 'm2-case-001';
const commitSha = 'a'.repeat(40);

const directAlphaSource = `import express from 'express';

export function createApp(db: any) {
  const app = express();

  function alphaHandler(req: any, res: any) {
    const term = req.query.q;
    const query = "SELECT * FROM alpha WHERE name = '" + term + "'";
    const statement = db.prepare(query);
    return res.json(statement.all());
  }

  function safeHandler(req: any, res: any) {
    const statement = db.prepare('SELECT * FROM alpha WHERE id = 1');
    return res.json(statement.all());
  }

  app.get('/alpha', alphaHandler);
  app.get('/alpha/safe', safeHandler);
  return app;
}
`;

const directBetaSource = `import express from 'express';

export function createApp(db: any) {
  const app = express();

  function betaHandler(req: any, res: any) {
    const term = req.query.id;
    const query = "SELECT * FROM beta WHERE key = '" + term + "'";
    const statement = db.prepare(query);
    return res.json(statement.all());
  }

  app.get('/beta', betaHandler);
  return app;
}
`;

describe('Pipeline Determinism: Direct Route Order Stability', () => {
  it('preserves complete pipeline determinism across input file order permutations', async () => {
    const filesOrderA = [
      { path: 'src/directAlpha.ts', content: directAlphaSource },
      { path: 'src/directBeta.ts', content: directBetaSource },
    ];
    const filesOrderB = [
      { path: 'src/directBeta.ts', content: directBetaSource },
      { path: 'src/directAlpha.ts', content: directAlphaSource },
    ];

    const snapshotA = await captureSnapshot(
      { fixtureId, repositoryId: repoId, organizationId: orgId, files: filesOrderA },
      orgId,
    );
    const snapshotB = await captureSnapshot(
      { fixtureId, repositoryId: repoId, organizationId: orgId, files: filesOrderB },
      orgId,
    );

    expect(snapshotA.snapshotId).toBe(snapshotB.snapshotId);
    expect(snapshotA.totalBytes).toBe(snapshotB.totalBytes);
    expect(canonical(snapshotA)).toBe(canonical(snapshotB));

    const ingestionA = await ingestExpress(snapshotA, orgId);
    const ingestionB = await ingestExpress(snapshotB, orgId);

    expect(ingestionA.ingestionIdentity).toBe(ingestionB.ingestionIdentity);
    expect(canonical(ingestionA)).toBe(canonical(ingestionB));
    expect(ingestionA.routes.length).toBe(3);

    const validatedIngestionA = await validateExpressIngestion(ingestionA, orgId);
    expect(validatedIngestionA.ingestionIdentity).toBe(ingestionA.ingestionIdentity);

    const analysisA = await detectSqlInjection(snapshotA, ingestionA, orgId);
    const analysisB = await detectSqlInjection(snapshotB, ingestionB, orgId);

    expect(analysisA.status).toBe('DETECTED');
    expect(analysisB.status).toBe('DETECTED');
    expect(analysisA.resultFingerprint).toBe(analysisB.resultFingerprint);
    expect(analysisA.findings.length).toBe(2);
    expect(canonical(analysisA)).toBe(canonical(analysisB));

    const validatedAnalysisA = await validateSqlAnalysis(analysisA, snapshotA, ingestionA, orgId);
    expect(validatedAnalysisA.resultFingerprint).toBe(analysisA.resultFingerprint);

    const bridge = createSqlCandidateBridge(async () => commitSha);
    const candidatesA = await bridge(analysisA, snapshotA, ingestionA, orgId);
    const candidatesB = await bridge(analysisB, snapshotB, ingestionB, orgId);

    expect(candidatesA.length).toBe(2);
    expect(canonical(candidatesA)).toBe(canonical(candidatesB));
    expect(candidatesA[0].candidateBinding).toBe(candidatesB[0].candidateBinding);
    expect(candidatesA[1].candidateBinding).toBe(candidatesB[1].candidateBinding);
  });

  it('guarantees sequential repeatability and route identity stability for direct route declarations', async () => {
    const files = [
      { path: 'src/directAlpha.ts', content: directAlphaSource },
    ];

    const snapshot = await captureSnapshot(
      { fixtureId, repositoryId: repoId, organizationId: orgId, files },
      orgId,
    );

    const [run1Ingestion, run2Ingestion] = await Promise.all([
      ingestExpress(snapshot, orgId),
      ingestExpress(snapshot, orgId),
    ]);
    expect(run1Ingestion.ingestionIdentity).toBe(run2Ingestion.ingestionIdentity);
    expect(canonical(run1Ingestion.routes)).toBe(canonical(run2Ingestion.routes));

    const [run1Analysis, run2Analysis] = await Promise.all([
      detectSqlInjection(snapshot, run1Ingestion, orgId),
      detectSqlInjection(snapshot, run2Ingestion, orgId),
    ]);
    expect(run1Analysis.resultFingerprint).toBe(run2Analysis.resultFingerprint);
    expect(canonical(run1Analysis.findings)).toBe(canonical(run2Analysis.findings));
    expect(run1Analysis.findings.length).toBe(1);
    expect(run1Analysis.findings[0].routeIdentity).toBe(run1Ingestion.routes[0].routeIdentity);

    const bridge = createSqlCandidateBridge(async () => commitSha);
    const candidates = await bridge(run1Analysis, snapshot, run1Ingestion, orgId);
    expect(candidates.length).toBe(1);
    expect(candidates[0].candidate.verificationState).toBe('CANDIDATE');
    expect(candidates[0].candidate.reachabilityState).toBe('REACHABLE');
  });

  it('preserves bounded non-authoritative candidate state and fails closed on corrupted bindings', async () => {
    const files = [
      { path: 'src/directBeta.ts', content: directBetaSource },
    ];

    const snapshot = await captureSnapshot(
      { fixtureId, repositoryId: repoId, organizationId: orgId, files },
      orgId,
    );
    const ingestion = await ingestExpress(snapshot, orgId);
    const analysis = await detectSqlInjection(snapshot, ingestion, orgId);

    const bridgeWithInvalidCommit = createSqlCandidateBridge(async () => 'not-a-valid-sha');
    await expect(
      bridgeWithInvalidCommit(analysis, snapshot, ingestion, orgId),
    ).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const foreignSnapshot = await captureSnapshot(
      { fixtureId, repositoryId: 'foreign_repo', organizationId: 'foreign_org', files },
      'foreign_org',
    );

    await expect(
      validateSqlAnalysis(analysis, foreignSnapshot, ingestion, orgId),
    ).rejects.toThrow();

    await expect(
      validateExpressIngestion(ingestion, 'foreign_org'),
    ).rejects.toThrow();
  });
});
