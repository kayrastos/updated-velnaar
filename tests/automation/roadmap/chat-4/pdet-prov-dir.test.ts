import { describe, it, expect } from 'vitest';
import { captureSnapshot, validateSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress, validateExpressIngestion } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { isTrustedCommitCapability } from '../../../../worker/intelligence/ingestion/repository';

describe('V1 Pipeline Determinism: Provenance Integrity Direct', () => {
  const org = 'org_pdet_prov_dir';
  const repositoryId = 'repo-pdet-prov-dir';
  const fixtureId = 'm2-case-001';
  const commitSha = 'a'.repeat(40);

  const files = [
    {
      path: 'src/routes.ts',
      content: `import express from 'express';

export function createApp(db: any) {
  const app = express();

  function handleSearch(req: any, res: any) {
    const term = req.query.q;
    const stmt = db.prepare('SELECT * FROM items WHERE name = ' + term);
    const rows = stmt.all();
    res.json(rows);
  }

  app.get('/search', handleSearch);

  return app;
}
`,
    },
  ];

  it('bounds provenance to trusted ingestion while analysis output remains strictly non-authoritative', async () => {
    const snapshot = await captureSnapshot(
      { fixtureId, repositoryId, organizationId: org, files },
      org,
    );
    const validatedSnapshot = await validateSnapshot(snapshot, org);
    expect(validatedSnapshot.snapshotId).toBe(snapshot.snapshotId);

    const expressIngestion = await ingestExpress(snapshot, org);
    const validatedIngestion = await validateExpressIngestion(expressIngestion, org);
    expect(validatedIngestion.ingestionIdentity).toBe(expressIngestion.ingestionIdentity);
    expect(expressIngestion.routes.length).toBe(1);
    expect(expressIngestion.routes[0].path).toBe('/search');

    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
    expect(analysis.status).toBe('DETECTED');
    expect(analysis.findings.length).toBe(1);
    expect(analysis.findings[0].vulnerabilityClass).toBe('SQL_INJECTION');

    const validatedAnalysis = await validateSqlAnalysis(analysis, snapshot, expressIngestion, org);
    expect(validatedAnalysis.resultFingerprint).toBe(analysis.resultFingerprint);

    expect((analysis as any).capability).toBeUndefined();
    expect((analysis as any).status).not.toBe('VERIFIED');

    let checkedCommitSnapshotId: string | null = null;
    const bridge = createSqlCandidateBridge(async (snap) => {
      checkedCommitSnapshotId = snap.snapshotId;
      return commitSha;
    });

    const hypotheses = await bridge(analysis, snapshot, expressIngestion, org);
    expect(checkedCommitSnapshotId).toBe(snapshot.snapshotId);
    expect(hypotheses.length).toBe(1);

    const { candidate, candidateBinding } = hypotheses[0];
    expect(candidate.organizationId).toBe(org);
    expect(candidate.snapshot.snapshotId).toBe(snapshot.snapshotId);
    expect(candidate.snapshot.commitSha).toBe(commitSha);
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.reachabilityState).toBe('REACHABLE');

    expect(candidate.verificationState).toBe('CANDIDATE');
    expect((candidate as any).verificationState).not.toBe('VERIFIED');
    expect((candidate as any).capability).toBeUndefined();
    expect((candidate as any).action).toBeUndefined();
    expect(typeof candidateBinding).toBe('string');
    expect(candidateBinding.length).toBeGreaterThan(0);

    expect(isTrustedCommitCapability({}, {} as any)).toBe(false);
    expect(isTrustedCommitCapability({ [Symbol.toStringTag]: 'TrustedCommitCapability' }, {} as any)).toBe(false);
  });

  it('preserves bit-for-bit pipeline determinism across independent direct runs', async () => {
    const bridge = createSqlCandidateBridge(async () => commitSha);

    const snapshotA = await captureSnapshot({ fixtureId, repositoryId, organizationId: org, files }, org);
    const expressA = await ingestExpress(snapshotA, org);
    const analysisA = await detectSqlInjection(snapshotA, expressA, org);
    const hypothesesA = await bridge(analysisA, snapshotA, expressA, org);

    const snapshotB = await captureSnapshot({ fixtureId, repositoryId, organizationId: org, files }, org);
    const expressB = await ingestExpress(snapshotB, org);
    const analysisB = await detectSqlInjection(snapshotB, expressB, org);
    const hypothesesB = await bridge(analysisB, snapshotB, expressB, org);

    expect(snapshotA.snapshotId).toBe(snapshotB.snapshotId);
    expect(expressA.ingestionIdentity).toBe(expressB.ingestionIdentity);
    expect(expressA.routes[0].routeIdentity).toBe(expressB.routes[0].routeIdentity);
    expect(analysisA.resultFingerprint).toBe(analysisB.resultFingerprint);
    expect(analysisA.findings[0].findingId).toBe(analysisB.findings[0].findingId);
    expect(hypothesesA[0].candidate.candidateId).toBe(hypothesesB[0].candidate.candidateId);
    expect(hypothesesA[0].candidateBinding).toBe(hypothesesB[0].candidateBinding);
  });

  it('fails closed when snapshot provenance is mismatched, tampered, or missing commit provenance', async () => {
    const snapshot = await captureSnapshot({ fixtureId, repositoryId, organizationId: org, files }, org);
    const expressIngestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);

    const foreignSnapshot = await captureSnapshot(
      { fixtureId: 'm2-case-002', repositoryId, organizationId: org, files },
      org,
    );
    await expect(
      detectSqlInjection(foreignSnapshot, expressIngestion, org),
    ).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');

    const tamperedAnalysis = {
      ...analysis,
      resultFingerprint: 'sha256:' + '0'.repeat(64),
    };
    await expect(
      validateSqlAnalysis(tamperedAnalysis, snapshot, expressIngestion, org),
    ).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');

    const bridgeZeroCommit = createSqlCandidateBridge(async () => '0'.repeat(40));
    await expect(
      bridgeZeroCommit(analysis, snapshot, expressIngestion, org),
    ).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const bridgeMalformedCommit = createSqlCandidateBridge(async () => 'not-a-valid-sha');
    await expect(
      bridgeMalformedCommit(analysis, snapshot, expressIngestion, org),
    ).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
  });
});
