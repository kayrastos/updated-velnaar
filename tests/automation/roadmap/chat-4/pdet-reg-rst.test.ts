import { describe, it, expect } from 'vitest';
import { captureSnapshot, validateSnapshot, hash } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress, validateExpressIngestion } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { validateRepositoryIngestion, isTrustedCommitCapability } from '../../../../worker/intelligence/ingestion/repository';

const org = 'org_velnar_white';
const repositoryId = 'repo-pdet-reg-rst';
const commitSha = '1234567890abcdef1234567890abcdef12345678';

const SAMPLE_ROUTES_SOURCE = `import express from 'express';

export function createApp(db: any) {
  const app = express();
  function queryHandler(req: any, res: any) {
    const id = req.query.id;
    const stmt = db.prepare('SELECT * FROM accounts WHERE id = ' + id);
    const rows = stmt.all();
    res.json(rows);
  }
  app.get('/accounts', queryHandler);
  return app;
}
`;

describe('Pipeline Determinism Regression Lock: Restart Resume', () => {
  it('preserves cryptographic identity and candidate bindings across restart-resume serialization', async () => {
    const initialSnapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId,
        organizationId: org,
        files: [{ path: 'src/routes.ts', content: SAMPLE_ROUTES_SOURCE }],
      },
      org,
    );

    const initialIngestion = await ingestExpress(initialSnapshot, org);
    const initialAnalysis = await detectSqlInjection(initialSnapshot, initialIngestion, org);
    expect(initialAnalysis.status).toBe('DETECTED');
    expect(initialAnalysis.findings.length).toBe(1);

    const verifyCommittedCode = async (snap: typeof initialSnapshot) => {
      expect(snap.snapshotId).toBe(initialSnapshot.snapshotId);
      return commitSha;
    };

    const bridge = createSqlCandidateBridge(verifyCommittedCode);
    const initialHypotheses = await bridge(initialAnalysis, initialSnapshot, initialIngestion, org);
    expect(initialHypotheses.length).toBe(1);
    expect(initialHypotheses[0].candidate.verificationState).toBe('CANDIDATE');
    expect(initialHypotheses[0].candidate.reachabilityState).toBe('REACHABLE');

    const serializedSnapshot = JSON.parse(JSON.stringify(initialSnapshot));
    const serializedIngestion = JSON.parse(JSON.stringify(initialIngestion));
    const serializedAnalysis = JSON.parse(JSON.stringify(initialAnalysis));
    const serializedHypotheses = JSON.parse(JSON.stringify(initialHypotheses));

    const resumedSnapshot = await validateSnapshot(serializedSnapshot, org);
    const resumedIngestion = await validateExpressIngestion(serializedIngestion, org);
    const resumedAnalysis = await validateSqlAnalysis(serializedAnalysis, resumedSnapshot, resumedIngestion, org);
    const resumedHypotheses = await bridge(resumedAnalysis, resumedSnapshot, resumedIngestion, org);

    expect(resumedSnapshot.snapshotId).toBe(initialSnapshot.snapshotId);
    expect(resumedSnapshot.totalBytes).toBe(initialSnapshot.totalBytes);
    expect(resumedIngestion.ingestionIdentity).toBe(initialIngestion.ingestionIdentity);
    expect(resumedAnalysis.resultFingerprint).toBe(initialAnalysis.resultFingerprint);
    expect(resumedHypotheses.length).toBe(initialHypotheses.length);
    expect(resumedHypotheses[0].candidate.candidateId).toBe(initialHypotheses[0].candidate.candidateId);
    expect(resumedHypotheses[0].candidateBinding).toBe(initialHypotheses[0].candidateBinding);

    expect(resumedHypotheses[0].candidate.verificationState).toBe('CANDIDATE');
    expect(resumedHypotheses[0].candidate.reachabilityState).toBe('REACHABLE');
    expect(resumedHypotheses[0].candidate.snapshot.commitSha).toBe(commitSha);

    const cycle2Snapshot = await validateSnapshot(resumedSnapshot, org);
    const cycle2Ingestion = await validateExpressIngestion(resumedIngestion, org);
    const cycle2Analysis = await validateSqlAnalysis(resumedAnalysis, cycle2Snapshot, cycle2Ingestion, org);
    const cycle2Hypotheses = await bridge(cycle2Analysis, cycle2Snapshot, cycle2Ingestion, org);

    expect(cycle2Snapshot.snapshotId).toBe(initialSnapshot.snapshotId);
    expect(cycle2Ingestion.ingestionIdentity).toBe(initialIngestion.ingestionIdentity);
    expect(cycle2Analysis.resultFingerprint).toBe(initialAnalysis.resultFingerprint);
    expect(cycle2Hypotheses[0].candidateBinding).toBe(initialHypotheses[0].candidateBinding);
  });

  it('fails closed when serialized restart-resume checkpoints are tampered or cross tenant boundaries', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId,
        organizationId: org,
        files: [{ path: 'src/routes.ts', content: SAMPLE_ROUTES_SOURCE }],
      },
      org,
    );
    const expressIngestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);

    const serializedSnapshot = JSON.parse(JSON.stringify(snapshot));
    const serializedIngestion = JSON.parse(JSON.stringify(expressIngestion));
    const serializedAnalysis = JSON.parse(JSON.stringify(analysis));

    const tamperedSnapshot = { ...serializedSnapshot, totalBytes: serializedSnapshot.totalBytes + 1 };
    await expect(validateSnapshot(tamperedSnapshot, org)).rejects.toThrow();

    const tamperedIngestion = { ...serializedIngestion, routes: [] };
    await expect(validateExpressIngestion(tamperedIngestion, org)).rejects.toThrow();

    const tamperedAnalysis = { ...serializedAnalysis, status: 'NOT_DETECTED' };
    await expect(validateSqlAnalysis(tamperedAnalysis, snapshot, expressIngestion, org)).rejects.toThrow();

    await expect(validateSnapshot(serializedSnapshot, 'foreign_org')).rejects.toThrow();
    await expect(validateExpressIngestion(serializedIngestion, 'foreign_org')).rejects.toThrow();
    await expect(validateSqlAnalysis(serializedAnalysis, snapshot, expressIngestion, 'foreign_org')).rejects.toThrow();
  });

  it('proves resumed structural repository ingestion records do not mint runtime authority capability', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId,
        organizationId: org,
        files: [{ path: 'src/routes.ts', content: SAMPLE_ROUTES_SOURCE }],
      },
      org,
    );

    const ingestionRecord = {
      version: 'velnar-repository-ingestion-v1' as const,
      organizationId: org,
      repositoryId,
      commitSha,
      snapshot,
    };
    const ingestionIdentity = await hash('velnar-repository-ingestion-v1', ingestionRecord);
    const serializedRecord = JSON.parse(JSON.stringify({ ...ingestionRecord, ingestionIdentity }));

    const validated = await validateRepositoryIngestion(serializedRecord, org);
    expect(validated.ingestionIdentity).toBe(ingestionIdentity);
    expect(validated.commitSha).toBe(commitSha);
    expect((validated as any).capability).toBeUndefined();
    expect(isTrustedCommitCapability(validated, validated)).toBe(false);
  });
});
