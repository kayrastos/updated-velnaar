import { describe, it, expect } from 'vitest';
import { captureSnapshot, validateSnapshot, type SnapshotInput } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress, validateExpressIngestion } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';

describe('Pipeline Determinism - Duplicate Collapse - Direct Route', () => {
  const org = 'org_pdet_dup_dir';
  const dummyCommitSha = '1'.repeat(40);

  const directDuplicateApp = `import express from 'express';

export function createApp(db: any) {
  const app = express();

  function searchHandler(req: any, res: any) {
    const q = req.query.q;
    const sql = "SELECT * FROM items WHERE name = '" + q + "' OR description = '" + q + "'";
    const stmt = db.prepare(sql);
    const rows = stmt.all();
    res.json(rows);
  }

  app.get('/search', searchHandler);

  return app;
}
`;

  const distinctSourcesApp = `import express from 'express';

export function createApp(db: any) {
  const app = express();

  function filterHandler(req: any, res: any) {
    const name = req.query.name;
    const role = req.query.role;
    const sql = "SELECT * FROM items WHERE name = '" + name + "' AND role = '" + role + "'";
    const stmt = db.prepare(sql);
    const rows = stmt.all();
    res.json(rows);
  }

  app.get('/filter', filterHandler);

  return app;
}
`;

  it('collapses duplicate flow references in a direct route handler deterministically to DETECTED', async () => {
    const input: SnapshotInput = {
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-pdet-dup-dir',
      organizationId: org,
      files: [{ path: 'src/app.ts', content: directDuplicateApp }],
    };

    const snapshot = await captureSnapshot(input, org);
    const validatedSnapshot = await validateSnapshot(snapshot, org);
    expect(validatedSnapshot.snapshotId).toBe(snapshot.snapshotId);

    const ingestion = await ingestExpress(snapshot, org);
    const validatedIngestion = await validateExpressIngestion(ingestion, org);
    expect(validatedIngestion.ingestionIdentity).toBe(ingestion.ingestionIdentity);
    expect(ingestion.routes).toHaveLength(1);
    expect(ingestion.routes[0].path).toBe('/search');
    expect(ingestion.routes[0].method).toBe('GET');

    const analysis = await detectSqlInjection(snapshot, ingestion, org);
    const validatedAnalysis = await validateSqlAnalysis(analysis, snapshot, ingestion, org);
    expect(validatedAnalysis.resultFingerprint).toBe(analysis.resultFingerprint);

    expect(analysis.status).toBe('DETECTED');
    expect(analysis.findings).toHaveLength(1);
    expect(analysis.limitations).toHaveLength(0);

    const finding = analysis.findings[0];
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.routeIdentity).toBe(ingestion.routes[0].routeIdentity);

    const sourceSteps = finding.flow.filter(step => step.kind === 'SOURCE');
    expect(sourceSteps).toHaveLength(1);
    expect(sourceSteps[0].location.symbol).toBe('query.q');

    const sinkSteps = finding.flow.filter(step => step.kind === 'SINK');
    expect(sinkSteps).toHaveLength(1);
    expect(sinkSteps[0].location.symbol).toBe('db.prepare');
  });

  it('produces invariant identities and candidate hypotheses across repeated pipeline execution', async () => {
    const input: SnapshotInput = {
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-pdet-dup-dir',
      organizationId: org,
      files: [{ path: 'src/app.ts', content: directDuplicateApp }],
    };

    const snapshot1 = await captureSnapshot(input, org);
    const snapshot2 = await captureSnapshot(input, org);
    expect(snapshot1.snapshotId).toBe(snapshot2.snapshotId);

    const ingestion1 = await ingestExpress(snapshot1, org);
    const ingestion2 = await ingestExpress(snapshot2, org);
    expect(ingestion1.ingestionIdentity).toBe(ingestion2.ingestionIdentity);
    expect(ingestion1.routes[0].routeIdentity).toBe(ingestion2.routes[0].routeIdentity);

    const analysis1 = await detectSqlInjection(snapshot1, ingestion1, org);
    const analysis2 = await detectSqlInjection(snapshot2, ingestion2, org);
    expect(analysis1.resultFingerprint).toBe(analysis2.resultFingerprint);
    expect(analysis1.findings[0].findingId).toBe(analysis2.findings[0].findingId);
    expect(analysis1.findings[0].flow).toEqual(analysis2.findings[0].flow);

    const bridge = createSqlCandidateBridge(async () => dummyCommitSha);
    const hypotheses1 = await bridge(analysis1, snapshot1, ingestion1, org);
    const hypotheses2 = await bridge(analysis2, snapshot2, ingestion2, org);

    expect(hypotheses1).toHaveLength(1);
    expect(hypotheses2).toHaveLength(1);
    expect(hypotheses1[0].candidate.candidateId).toBe(hypotheses2[0].candidate.candidateId);
    expect(hypotheses1[0].candidateBinding).toBe(hypotheses2[0].candidateBinding);
    expect(hypotheses1[0].candidate.reachabilityState).toBe('REACHABLE');
    expect(hypotheses1[0].candidate.verificationState).toBe('CANDIDATE');
    expect((hypotheses1[0].candidate as any).verificationState).not.toBe('VERIFIED');
  });

  it('fails closed to ANALYSIS_INCONCLUSIVE with MULTIPLE_SOURCES when sources are distinct', async () => {
    const input: SnapshotInput = {
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-pdet-dup-dir',
      organizationId: org,
      files: [{ path: 'src/app.ts', content: distinctSourcesApp }],
    };

    const snapshot = await captureSnapshot(input, org);
    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);

    expect(analysis.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(analysis.findings).toHaveLength(0);
    expect(analysis.limitations).toHaveLength(1);
    expect(analysis.limitations[0].code).toBe('MULTIPLE_SOURCES');
  });
});
