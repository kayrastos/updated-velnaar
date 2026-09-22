import { describe, it, expect } from 'vitest';
import { captureSnapshot, validateSnapshot, type SourceSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress, validateExpressIngestion } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';

const org = 'org_chat4_pdet';
const repoId = 'repo-pdet-nest-cross';
const fixtureId = 'm2-case-001';

const routesContent = `import express from 'express';
import { wrapQuery } from './service';

export function createApp(db: any) {
  const app = express();
  function searchHandler(req: any, res: any) {
    const term = req.query.term;
    const sql = wrapQuery(term);
    const statement = db.prepare(sql);
    const rows = statement.all();
    res.json(rows);
  }
  app.get('/search', searchHandler);
  return app;
}
`;

const serviceContent = `import { buildQuery } from './builder';

export function wrapQuery(input: any) {
  const delegated = buildQuery(input);
  return delegated;
}
`;

const builderContent = `export function buildQuery(queryParam: any) {
  const query = 'SELECT * FROM records WHERE id = ' + queryParam;
  return query;
}
`;

function createFixtureFiles() {
  return [
    { path: 'src/routes.ts', content: routesContent },
    { path: 'src/service.ts', content: serviceContent },
    { path: 'src/builder.ts', content: builderContent },
  ];
}

describe('Pipeline Determinism: Cross-File Nested-Flow SQL Injection', () => {
  it('detects cross-file nested-flow SQL injection with full provenance', async () => {
    const files = createFixtureFiles();
    const snapshot = await captureSnapshot({ fixtureId, repositoryId: repoId, organizationId: org, files }, org);
    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);

    expect(analysis.status).toBe('DETECTED');
    expect(analysis.findings).toHaveLength(1);
    expect(analysis.limitations).toHaveLength(0);

    const finding = analysis.findings[0];
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.source.filePath).toBe('src/routes.ts');
    expect(finding.source.symbol).toBe('query.term');
    expect(finding.sink.filePath).toBe('src/routes.ts');
    expect(finding.sink.symbol).toBe('db.prepare');

    const filePathsInFlow = new Set(finding.flow.map(step => step.location.filePath));
    expect(filePathsInFlow.has('src/routes.ts')).toBe(true);
    expect(filePathsInFlow.has('src/service.ts')).toBe(true);
    expect(filePathsInFlow.has('src/builder.ts')).toBe(true);
  });

  it('guarantees deterministic identities and fingerprints across repeated independent runs', async () => {
    const files1 = createFixtureFiles();
    const snapshot1 = await captureSnapshot({ fixtureId, repositoryId: repoId, organizationId: org, files: files1 }, org);
    const ingestion1 = await ingestExpress(snapshot1, org);
    const analysis1 = await detectSqlInjection(snapshot1, ingestion1, org);

    const files2 = createFixtureFiles();
    const snapshot2 = await captureSnapshot({ fixtureId, repositoryId: repoId, organizationId: org, files: files2 }, org);
    const ingestion2 = await ingestExpress(snapshot2, org);
    const analysis2 = await detectSqlInjection(snapshot2, ingestion2, org);

    expect(snapshot1.snapshotId).toBe(snapshot2.snapshotId);
    expect(snapshot1.totalBytes).toBe(snapshot2.totalBytes);
    expect(ingestion1.ingestionIdentity).toBe(ingestion2.ingestionIdentity);
    expect(analysis1.resultFingerprint).toBe(analysis2.resultFingerprint);
    expect(analysis1.findings[0].findingId).toBe(analysis2.findings[0].findingId);
    expect(analysis1.findings[0].flow).toEqual(analysis2.findings[0].flow);
  });

  it('maintains identity determinism regardless of input file ordering in snapshot capture', async () => {
    const canonicalFiles = createFixtureFiles();
    const reversedFiles = [
      { path: 'src/builder.ts', content: builderContent },
      { path: 'src/service.ts', content: serviceContent },
      { path: 'src/routes.ts', content: routesContent },
    ];

    const snapshotCanonical = await captureSnapshot({ fixtureId, repositoryId: repoId, organizationId: org, files: canonicalFiles }, org);
    const snapshotReversed = await captureSnapshot({ fixtureId, repositoryId: repoId, organizationId: org, files: reversedFiles }, org);

    expect(snapshotCanonical.snapshotId).toBe(snapshotReversed.snapshotId);

    const ingestionCanonical = await ingestExpress(snapshotCanonical, org);
    const ingestionReversed = await ingestExpress(snapshotReversed, org);
    expect(ingestionCanonical.ingestionIdentity).toBe(ingestionReversed.ingestionIdentity);

    const analysisCanonical = await detectSqlInjection(snapshotCanonical, ingestionCanonical, org);
    const analysisReversed = await detectSqlInjection(snapshotReversed, ingestionReversed, org);
    expect(analysisCanonical.resultFingerprint).toBe(analysisReversed.resultFingerprint);
  });

  it('passes strict structural and cryptographic re-validation without mutation', async () => {
    const files = createFixtureFiles();
    const snapshot = await captureSnapshot({ fixtureId, repositoryId: repoId, organizationId: org, files }, org);
    const validatedSnap = await validateSnapshot(snapshot, org);
    expect(validatedSnap.snapshotId).toBe(snapshot.snapshotId);

    const ingestion = await ingestExpress(snapshot, org);
    const validatedIngestion = await validateExpressIngestion(ingestion, org);
    expect(validatedIngestion.ingestionIdentity).toBe(ingestion.ingestionIdentity);

    const analysis = await detectSqlInjection(snapshot, ingestion, org);
    const validatedAnalysis = await validateSqlAnalysis(analysis, snapshot, ingestion, org);
    expect(validatedAnalysis.resultFingerprint).toBe(analysis.resultFingerprint);
  });

  it('generates non-authoritative candidate hypotheses with deterministic binding', async () => {
    const files = createFixtureFiles();
    const snapshot = await captureSnapshot({ fixtureId, repositoryId: repoId, organizationId: org, files }, org);
    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);

    const commitSha = 'c'.repeat(40);
    const verifyCommitted = async (_snap: SourceSnapshot) => commitSha;
    const bridge = createSqlCandidateBridge(verifyCommitted);

    const hypotheses1 = await bridge(analysis, snapshot, ingestion, org);
    const hypotheses2 = await bridge(analysis, snapshot, ingestion, org);

    expect(hypotheses1).toHaveLength(1);
    expect(hypotheses2).toHaveLength(1);

    const hyp1 = hypotheses1[0];
    const hyp2 = hypotheses2[0];

    expect(hyp1.candidate.verificationState).toBe('CANDIDATE');
    expect(hyp1.candidate.reachabilityState).toBe('REACHABLE');
    expect(hyp1.candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(hyp1.candidate.snapshot.commitSha).toBe(commitSha);
    expect(hyp1.candidate.candidateId).toBe(hyp2.candidate.candidateId);
    expect(hyp1.candidateBinding).toBe(hyp2.candidateBinding);
    expect(hyp1.candidate.verificationState).not.toBe('VERIFIED');
  });
});
