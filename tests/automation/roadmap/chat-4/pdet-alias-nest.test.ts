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

const org = 'org_chat4_pdet';
const repoId = 'repo_pdet_alias_nest';
const fixtureId = 'm2-case-001';

const sourceApp = `import express from 'express';

export function createApp(db: any) {
  const app = express();

  function nestInner(val: any) {
    const inner1 = val;
    const inner2 = inner1;
    return inner2;
  }

  function nestOuter(val: any) {
    const outer1 = val;
    const outer2 = nestInner(outer1);
    const outer3 = outer2;
    return outer3;
  }

  function handleNestedAlias(req: any, res: any) {
    const rawInput = req.query.category;
    const alias1 = rawInput;
    const alias2 = alias1;
    const alias3 = nestOuter(alias2);
    const alias4 = alias3;
    const query = "SELECT * FROM products WHERE category = '" + alias4 + "'";
    const stmt = db.prepare(query);
    const rows = stmt.all();
    return res.json(rows);
  }

  function handleSafeParam(req: any, res: any) {
    const rawInput = req.query.category;
    const safeAlias = rawInput;
    const stmt = db.prepare('SELECT * FROM products WHERE category = ?');
    const rows = stmt.all(safeAlias);
    return res.json(rows);
  }

  app.get('/products/nested', handleNestedAlias);
  app.get('/products/safe', handleSafeParam);

  return app;
}
`;

describe('Pipeline Determinism: Nested Alias Propagation', () => {
  it('deterministically captures, ingests, and analyzes nested alias SQL injection', async () => {
    const inputA = {
      fixtureId,
      repositoryId: repoId,
      organizationId: org,
      files: [{ path: 'src/app.ts', content: sourceApp }],
    };
    const inputB = {
      fixtureId,
      repositoryId: repoId,
      organizationId: org,
      files: [{ path: 'src/app.ts', content: sourceApp }],
    };

    const snapA = await captureSnapshot(inputA, org);
    const snapB = await captureSnapshot(inputB, org);
    expect(snapA.snapshotId).toBe(snapB.snapshotId);
    expect(canonical(snapA)).toBe(canonical(snapB));

    const validSnapA = await validateSnapshot(snapA, org);
    const validSnapB = await validateSnapshot(snapB, org);
    expect(validSnapA.snapshotId).toBe(validSnapB.snapshotId);

    const expA = await ingestExpress(validSnapA, org);
    const expB = await ingestExpress(validSnapB, org);
    expect(expA.ingestionIdentity).toBe(expB.ingestionIdentity);
    expect(canonical(expA)).toBe(canonical(expB));

    const validExpA = await validateExpressIngestion(expA, org);
    const validExpB = await validateExpressIngestion(expB, org);
    expect(validExpA.ingestionIdentity).toBe(validExpB.ingestionIdentity);

    const analysisA = await detectSqlInjection(validSnapA, validExpA, org);
    const analysisB = await detectSqlInjection(validSnapB, validExpB, org);

    expect(analysisA.status).toBe('DETECTED');
    expect(analysisB.status).toBe('DETECTED');
    expect(analysisA.findings).toHaveLength(1);
    expect(analysisB.findings).toHaveLength(1);
    expect(analysisA.resultFingerprint).toBe(analysisB.resultFingerprint);
    expect(analysisA.findings[0].findingId).toBe(analysisB.findings[0].findingId);
    expect(canonical(analysisA)).toBe(canonical(analysisB));

    const verifiedAnalysisA = await validateSqlAnalysis(analysisA, validSnapA, validExpA, org);
    const verifiedAnalysisB = await validateSqlAnalysis(analysisB, validSnapB, validExpB, org);
    expect(verifiedAnalysisA.resultFingerprint).toBe(verifiedAnalysisB.resultFingerprint);

    const flowKinds = analysisA.findings[0].flow.map((s) => s.kind);
    expect(flowKinds[0]).toBe('SOURCE');
    expect(flowKinds[flowKinds.length - 1]).toBe('SINK');
    expect(flowKinds).toContain('CALL');
    expect(flowKinds).toContain('ARGUMENT');
    expect(flowKinds).toContain('VARIABLE');
    expect(flowKinds).toContain('RETURN');
    expect(flowKinds).toContain('CONCAT');
  });

  it('generates deterministic candidate hypotheses bounded to non-authoritative CANDIDATE state', async () => {
    const snapshot = await captureSnapshot({
      fixtureId,
      repositoryId: repoId,
      organizationId: org,
      files: [{ path: 'src/app.ts', content: sourceApp }],
    }, org);
    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);

    const testCommit = 'c'.repeat(40);
    const bridge = createSqlCandidateBridge(async () => testCommit);

    const hypothesesA = await bridge(analysis, snapshot, ingestion, org);
    const hypothesesB = await bridge(analysis, snapshot, ingestion, org);

    expect(hypothesesA).toHaveLength(1);
    expect(hypothesesB).toHaveLength(1);

    const candA = hypothesesA[0];
    const candB = hypothesesB[0];

    expect(candA.candidate.verificationState).toBe('CANDIDATE');
    expect(candA.candidate.verificationState).not.toBe('VERIFIED');
    expect(candA.candidate.reachabilityState).toBe('REACHABLE');
    expect(candA.candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candA.candidate.candidateId).toBe(candB.candidate.candidateId);
    expect(candA.candidateBinding).toBe(candB.candidateBinding);
    expect(canonical(candA)).toBe(canonical(candB));
  });

  it('fails closed when snapshot or analysis is modified or misbound', async () => {
    const snapshot = await captureSnapshot({
      fixtureId,
      repositoryId: repoId,
      organizationId: org,
      files: [{ path: 'src/app.ts', content: sourceApp }],
    }, org);
    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);

    await expect(validateSnapshot(snapshot, 'foreign_org')).rejects.toThrow();
    await expect(validateExpressIngestion(ingestion, 'foreign_org')).rejects.toThrow();

    const tamperedAnalysis = { ...analysis, resultFingerprint: 'sha256:tampered' };
    await expect(validateSqlAnalysis(tamperedAnalysis, snapshot, ingestion, org)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
  });
});
