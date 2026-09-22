import { describe, it, expect } from 'vitest';
import { captureSnapshot, validateSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress, validateExpressIngestion } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';

const org = 'org_pdet_rst';
const fixtureId = 'm2-case-001';
const repoId = 'repo-pdet-order-rst';
const validCommitSha = 'a'.repeat(40);

function createFixtureFiles(): { path: string; content: string }[] {
  return [
    {
      path: 'src/app.ts',
      content: `import express from 'express';

export function createApp(db: any) {
  const app = express();

  function handleSearch(req: any, res: any) {
    const term = req.query.term;
    const stmt = db.prepare('SELECT * FROM items WHERE name = ' + term);
    const rows = stmt.all();
    return res.json(rows);
  }

  function handleFilter(req: any, res: any) {
    const cat = req.query.category;
    const stmt = db.prepare('SELECT * FROM items WHERE category = ' + cat);
    const rows = stmt.all();
    return res.json(rows);
  }

  function handleHealth(req: any, res: any) {
    const stmt = db.prepare('SELECT 1');
    const rows = stmt.all();
    return res.json(rows);
  }

  app.get('/search', handleSearch);
  app.get('/filter', handleFilter);
  app.get('/health', handleHealth);
  return app;
}
`,
    },
    {
      path: 'src/config.ts',
      content: 'export const config = "v1-deterministic";\n',
    },
  ];
}

describe('PDET Order Stability & Restart-Resume Determinism (RM_PDET_ORDER_RST)', () => {
  it('preserves bit-for-bit pipeline determinism and route/finding order across staged restart-resume checkpoints', async () => {
    const files = createFixtureFiles();

    const directSnapshot = await captureSnapshot(
      { fixtureId, repositoryId: repoId, organizationId: org, files },
      org,
    );
    const directIngestion = await ingestExpress(directSnapshot, org);
    const directAnalysis = await detectSqlInjection(directSnapshot, directIngestion, org);
    const directBridge = createSqlCandidateBridge(async () => validCommitSha);
    const directCandidates = await directBridge(directAnalysis, directSnapshot, directIngestion, org);

    const checkpoint1Json = JSON.stringify(directSnapshot);
    const resumedSnapshot = await validateSnapshot(JSON.parse(checkpoint1Json), org);
    expect(resumedSnapshot.snapshotId).toBe(directSnapshot.snapshotId);
    expect(resumedSnapshot.files.map((f) => f.path)).toEqual(directSnapshot.files.map((f) => f.path));

    const stage2Ingestion = await ingestExpress(resumedSnapshot, org);
    const checkpoint2Json = JSON.stringify(stage2Ingestion);
    const resumedIngestion = await validateExpressIngestion(JSON.parse(checkpoint2Json), org);
    expect(resumedIngestion.ingestionIdentity).toBe(directIngestion.ingestionIdentity);
    expect(resumedIngestion.routes.map((r) => r.routeIdentity)).toEqual(
      directIngestion.routes.map((r) => r.routeIdentity),
    );
    expect(resumedIngestion.routes.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /search',
      'GET /filter',
      'GET /health',
    ]);

    const stage3Analysis = await detectSqlInjection(resumedSnapshot, resumedIngestion, org);
    const checkpoint3Json = JSON.stringify(stage3Analysis);
    const resumedAnalysis = await validateSqlAnalysis(
      JSON.parse(checkpoint3Json),
      resumedSnapshot,
      resumedIngestion,
      org,
    );
    expect(resumedAnalysis.resultFingerprint).toBe(directAnalysis.resultFingerprint);
    expect(resumedAnalysis.findings.length).toBe(2);
    expect(resumedAnalysis.findings.map((f) => f.findingId)).toEqual(
      directAnalysis.findings.map((f) => f.findingId),
    );
    expect(resumedAnalysis.findings.map((f) => f.routeIdentity)).toEqual(
      directAnalysis.findings.map((f) => f.routeIdentity),
    );

    const resumedBridge = createSqlCandidateBridge(async () => validCommitSha);
    const resumedCandidates = await resumedBridge(
      resumedAnalysis,
      resumedSnapshot,
      resumedIngestion,
      org,
    );
    expect(resumedCandidates.length).toBe(directCandidates.length);
    expect(resumedCandidates.map((c) => c.candidateBinding)).toEqual(
      directCandidates.map((c) => c.candidateBinding),
    );
    expect(resumedCandidates.map((c) => c.candidate.candidateId)).toEqual(
      directCandidates.map((c) => c.candidate.candidateId),
    );
    expect(resumedCandidates[0].candidate.verificationState).toBe('CANDIDATE');
    expect(resumedCandidates[1].candidate.verificationState).toBe('CANDIDATE');
  });

  it('guarantees deterministic order stability when re-ingesting after restart with permuted input file sequence', async () => {
    const originalFiles = createFixtureFiles();
    const permutedFiles = [...originalFiles].reverse();

    const snapshotA = await captureSnapshot(
      { fixtureId, repositoryId: repoId, organizationId: org, files: originalFiles },
      org,
    );
    const snapshotB = await captureSnapshot(
      { fixtureId, repositoryId: repoId, organizationId: org, files: permutedFiles },
      org,
    );

    expect(snapshotB.snapshotId).toBe(snapshotA.snapshotId);
    expect(snapshotB.files.map((f) => f.path)).toEqual(snapshotA.files.map((f) => f.path));

    const resumedSnapshotB = await validateSnapshot(JSON.parse(JSON.stringify(snapshotB)), org);
    const ingestionB = await ingestExpress(resumedSnapshotB, org);
    const analysisB = await detectSqlInjection(resumedSnapshotB, ingestionB, org);

    const bridge = createSqlCandidateBridge(async () => validCommitSha);
    const candidatesB = await bridge(analysisB, resumedSnapshotB, ingestionB, org);

    const ingestionA = await ingestExpress(snapshotA, org);
    const analysisA = await detectSqlInjection(snapshotA, ingestionA, org);
    const candidatesA = await bridge(analysisA, snapshotA, ingestionA, org);

    expect(ingestionB.ingestionIdentity).toBe(ingestionA.ingestionIdentity);
    expect(analysisB.resultFingerprint).toBe(analysisA.resultFingerprint);
    expect(candidatesB.map((c) => c.candidateBinding)).toEqual(
      candidatesA.map((c) => c.candidateBinding),
    );
  });

  it('fails closed when resumed checkpoint state tampers with route order', async () => {
    const files = createFixtureFiles();
    const snapshot = await captureSnapshot(
      { fixtureId, repositoryId: repoId, organizationId: org, files },
      org,
    );
    const ingestion = await ingestExpress(snapshot, org);

    const tampered = JSON.parse(JSON.stringify(ingestion));
    const [first, second, third] = tampered.routes;
    tampered.routes = [second, first, third];

    await expect(validateExpressIngestion(tampered, org)).rejects.toThrow();
  });

  it('fails closed when resumed checkpoint state tampers with finding order in SQL analysis', async () => {
    const files = createFixtureFiles();
    const snapshot = await captureSnapshot(
      { fixtureId, repositoryId: repoId, organizationId: org, files },
      org,
    );
    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);

    const tampered = JSON.parse(JSON.stringify(analysis));
    expect(tampered.findings.length).toBe(2);
    const [finding0, finding1] = tampered.findings;
    tampered.findings = [finding1, finding0];

    await expect(validateSqlAnalysis(tampered, snapshot, ingestion, org)).rejects.toThrow(
      'M3_ANALYSIS_INTEGRITY_MISMATCH',
    );
  });

  it('enforces non-authoritative candidate boundary across restart-resume cycles', async () => {
    const files = createFixtureFiles();
    const snapshot = await captureSnapshot(
      { fixtureId, repositoryId: repoId, organizationId: org, files },
      org,
    );
    const resumedSnapshot = await validateSnapshot(JSON.parse(JSON.stringify(snapshot)), org);
    const resumedIngestion = await validateExpressIngestion(
      JSON.parse(JSON.stringify(await ingestExpress(resumedSnapshot, org))),
      org,
    );
    const resumedAnalysis = await validateSqlAnalysis(
      JSON.parse(JSON.stringify(await detectSqlInjection(resumedSnapshot, resumedIngestion, org))),
      resumedSnapshot,
      resumedIngestion,
      org,
    );

    const invalidShaBridge = createSqlCandidateBridge(async () => '0'.repeat(40));
    await expect(
      invalidShaBridge(resumedAnalysis, resumedSnapshot, resumedIngestion, org),
    ).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const validBridge = createSqlCandidateBridge(async () => validCommitSha);
    const candidates = await validBridge(resumedAnalysis, resumedSnapshot, resumedIngestion, org);

    for (const item of candidates) {
      expect(item.candidate.verificationState).toBe('CANDIDATE');
      expect(item.candidate.reachabilityState).toBe('REACHABLE');
      expect((item.candidate as any).capability).toBeUndefined();
    }
  });
});
