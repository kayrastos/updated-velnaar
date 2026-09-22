import { describe, it, expect } from 'vitest';
import { captureSnapshot, validateSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress, validateExpressIngestion } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';

const org = 'org_velnar_pdet';
const repoId = 'repo_pdet_wrap_nest';
const fixtureId = 'm2-case-001';
const commitSha = 'c0ffee1234567890abcdef1234567890abcdef12';

const APP_SOURCE = `import express from 'express';

export function createApp(db: any) {
  const app = express();
  const router = express.Router();

  function queryWrapper(database: any, input: any) {
    const stmt = database.prepare('SELECT * FROM accounts WHERE id = ' + input);
    return stmt.all();
  }

  function searchHandler(req: any, res: any) {
    const id = req.query.id;
    const records = queryWrapper(db, id);
    return res.json(records);
  }

  router.get('/lookup', searchHandler);
  app.use('/api', router);
  return app;
}
`;

describe('Pipeline Determinism - Wrapper Boundary Nested Router (RM_PDET_WRAP_NEST)', () => {
  it('deterministically analyzes nested router routes across wrapper function boundaries', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId,
        repositoryId: repoId,
        organizationId: org,
        files: [{ path: 'src/app.ts', content: APP_SOURCE }],
      },
      org,
    );

    const expressIngestion = await ingestExpress(snapshot, org);
    expect(expressIngestion.routes).toHaveLength(1);
    expect(expressIngestion.routes[0].path).toBe('/api/lookup');
    expect(expressIngestion.routes[0].method).toBe('GET');
    expect(expressIngestion.routes[0].ownerKind).toBe('ROUTER');

    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
    expect(analysis.status).toBe('DETECTED');
    expect(analysis.findings).toHaveLength(1);

    const finding = analysis.findings[0];
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.routeIdentity).toBe(expressIngestion.routes[0].routeIdentity);
    expect(finding.source.symbol).toBe('query.id');
    expect(finding.sink.symbol).toBe('db.prepare');

    const kinds = finding.flow.map((step) => step.kind);
    expect(kinds).toContain('SOURCE');
    expect(kinds).toContain('VARIABLE');
    expect(kinds).toContain('CALL');
    expect(kinds).toContain('ARGUMENT');
    expect(kinds).toContain('CONCAT');
    expect(kinds).toContain('SINK');
    expect(kinds[0]).toBe('SOURCE');
    expect(kinds[kinds.length - 1]).toBe('SINK');
  });

  it('preserves bit-for-bit determinism across pipeline re-runs', async () => {
    const snapshotA = await captureSnapshot(
      {
        fixtureId,
        repositoryId: repoId,
        organizationId: org,
        files: [{ path: 'src/app.ts', content: APP_SOURCE }],
      },
      org,
    );
    const expressA = await ingestExpress(snapshotA, org);
    const analysisA = await detectSqlInjection(snapshotA, expressA, org);
    const bridgeA = createSqlCandidateBridge(async () => commitSha);
    const hypothesesA = await bridgeA(analysisA, snapshotA, expressA, org);

    const snapshotB = await captureSnapshot(
      {
        fixtureId,
        repositoryId: repoId,
        organizationId: org,
        files: [{ path: 'src/app.ts', content: APP_SOURCE }],
      },
      org,
    );
    const expressB = await ingestExpress(snapshotB, org);
    const analysisB = await detectSqlInjection(snapshotB, expressB, org);
    const bridgeB = createSqlCandidateBridge(async () => commitSha);
    const hypothesesB = await bridgeB(analysisB, snapshotB, expressB, org);

    expect(snapshotA.snapshotId).toBe(snapshotB.snapshotId);
    expect(expressA.ingestionIdentity).toBe(expressB.ingestionIdentity);
    expect(analysisA.resultFingerprint).toBe(analysisB.resultFingerprint);
    expect(analysisA.findings[0].findingId).toBe(analysisB.findings[0].findingId);
    expect(hypothesesA[0].candidate.candidateId).toBe(hypothesesB[0].candidate.candidateId);
    expect(hypothesesA[0].candidateBinding).toBe(hypothesesB[0].candidateBinding);
  });

  it('enforces non-authoritative CANDIDATE state and candidate binding', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId,
        repositoryId: repoId,
        organizationId: org,
        files: [{ path: 'src/app.ts', content: APP_SOURCE }],
      },
      org,
    );
    const expressIngestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);

    const bridge = createSqlCandidateBridge(async () => commitSha);
    const hypotheses = await bridge(analysis, snapshot, expressIngestion, org);
    expect(hypotheses).toHaveLength(1);

    const { candidate, candidateBinding } = hypotheses[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.context.routeId).toBe(expressIngestion.routes[0].routeIdentity);
    expect(candidate.snapshot.commitSha).toBe(commitSha);
    expect(typeof candidateBinding).toBe('string');
    expect(candidateBinding.length).toBeGreaterThan(0);

    const invalidBridge = createSqlCandidateBridge(async () => '0000000000000000000000000000000000000000');
    await expect(invalidBridge(analysis, snapshot, expressIngestion, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
  });

  it('fails closed when analysis or snapshot integrity is compromised at the wrapper boundary', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId,
        repositoryId: repoId,
        organizationId: org,
        files: [{ path: 'src/app.ts', content: APP_SOURCE }],
      },
      org,
    );
    const expressIngestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);

    const validatedAnalysis = await validateSqlAnalysis(analysis, snapshot, expressIngestion, org);
    expect(validatedAnalysis.resultFingerprint).toBe(analysis.resultFingerprint);

    const tamperedAnalysis = {
      ...analysis,
      status: 'NOT_DETECTED' as const,
      findings: [],
    };
    await expect(validateSqlAnalysis(tamperedAnalysis, snapshot, expressIngestion, org)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');

    await expect(validateSnapshot(snapshot, 'foreign_org')).rejects.toThrow();
    await expect(validateExpressIngestion(expressIngestion, 'foreign_org')).rejects.toThrow();
  });
});
