import { describe, it, expect } from 'vitest';
import { captureSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';

describe('Pipeline Determinism - Duplicate Collapse - Nested Calls', () => {
  const org = 'org_pdet_dup_nest';
  const commitSha = 'a'.repeat(40);

  const fixtureContent = `import express from 'express';

function innerHelper(val: any) {
  const p = val + '';
  const duplicated = p + p;
  return duplicated;
}

function middleHelper(mid: any) {
  const processed = innerHelper(mid);
  return processed;
}

function outerHelper(input: any) {
  const formatted = middleHelper(input);
  const sql = 'SELECT * FROM items WHERE id = ' + formatted;
  return sql;
}

export function createApp(db: any) {
  const app = express();

  function handleSearch(req: any, res: any) {
    const query = outerHelper(req.query.id);
    const stmt = db.prepare(query);
    return res.json(stmt.all());
  }

  app.get('/search', handleSearch);
  return app;
}
`;

  it('collapses duplicate flow steps through nested call chains deterministically', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-pdet-nest',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: fixtureContent }],
      },
      org,
    );

    const expressIngestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);

    expect(analysis.status).toBe('DETECTED');
    expect(analysis.findings.length).toBe(1);

    const finding = analysis.findings[0];
    expect(finding).toBeDefined();
    if (!finding) throw new Error('finding required');
    expect(finding.source.symbol).toBe('query.id');
    expect(finding.sink.symbol).toBe('db.prepare');

    const sourceSteps = finding.flow.filter((s) => s.kind === 'SOURCE');
    expect(sourceSteps.length).toBe(1);

    const bridge = createSqlCandidateBridge(async () => commitSha);
    const hypotheses = await bridge(analysis, snapshot, expressIngestion, org);

    expect(hypotheses.length).toBe(1);
    const hypothesis = hypotheses[0];
    expect(hypothesis).toBeDefined();
    if (!hypothesis) throw new Error('hypothesis required');
    expect(hypothesis.candidate.verificationState).toBe('CANDIDATE');
    expect(hypothesis.candidate.reachabilityState).toBe('REACHABLE');
    expect(hypothesis.candidate.vulnerabilityClass).toBe('SQL_INJECTION');
  });

  it('preserves complete pipeline determinism across multiple analysis passes', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-pdet-nest',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: fixtureContent }],
      },
      org,
    );

    const expressIngestion = await ingestExpress(snapshot, org);
    const analysisA = await detectSqlInjection(snapshot, expressIngestion, org);
    const analysisB = await detectSqlInjection(snapshot, expressIngestion, org);

    expect(analysisA.resultFingerprint).toBe(analysisB.resultFingerprint);
    const findingA = analysisA.findings[0];
    const findingB = analysisB.findings[0];
    expect(findingA).toBeDefined();
    expect(findingB).toBeDefined();
    if (!findingA || !findingB) throw new Error('findings required');
    expect(findingA.findingId).toBe(findingB.findingId);
    expect(findingA.flow.length).toBe(findingB.flow.length);

    const bridge = createSqlCandidateBridge(async () => commitSha);
    const hypothesesA = await bridge(analysisA, snapshot, expressIngestion, org);
    const hypothesesB = await bridge(analysisB, snapshot, expressIngestion, org);

    const hypA = hypothesesA[0];
    const hypB = hypothesesB[0];
    expect(hypA).toBeDefined();
    expect(hypB).toBeDefined();
    if (!hypA || !hypB) throw new Error('hypotheses required');
    expect(hypA.candidate.candidateId).toBe(hypB.candidate.candidateId);
    expect(hypA.candidateBinding).toBe(hypB.candidateBinding);
  });
});
