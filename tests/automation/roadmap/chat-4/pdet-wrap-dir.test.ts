import { describe, it, expect } from 'vitest';
import { captureSnapshot, validateSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress, validateExpressIngestion } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';

const org = 'org_pdet_wrap_dir';
const commitSha = '95b0e33efcc0c9fde40ce8eabbaef056bde2f270';

const sourceWithDirectWrapper = `import express from 'express';

function wrapQuery(input: any) {
  return 'SELECT * FROM items WHERE id = ' + input;
}

function wrapClean(input: any) {
  return 'SELECT * FROM items WHERE id = 1';
}

export function createApp(db: any) {
  const app = express();

  function directWrapHandler(req: any, res: any) {
    const rawId = req.query.id;
    const query = wrapQuery(rawId);
    const stmt = db.prepare(query);
    const rows = stmt.all();
    res.json(rows);
  }

  function cleanHandler(req: any, res: any) {
    const rawId = req.query.id;
    const query = wrapClean(rawId);
    const stmt = db.prepare(query);
    const rows = stmt.all();
    res.json(rows);
  }

  app.get('/items', directWrapHandler);
  app.get('/clean', cleanHandler);

  return app;
}
`;

const cleanOnlySource = `import express from 'express';

function wrapClean(input: any) {
  return 'SELECT * FROM items WHERE id = 1';
}

export function createApp(db: any) {
  const app = express();

  function cleanHandler(req: any, res: any) {
    const rawId = req.query.id;
    const query = wrapClean(rawId);
    const stmt = db.prepare(query);
    const rows = stmt.all();
    res.json(rows);
  }

  app.get('/clean', cleanHandler);

  return app;
}
`;

describe('V1 Pipeline Determinism: Direct Wrapper Boundary (pdet-wrap-dir)', () => {
  it('deterministically propagates taint across direct function wrapper boundary through all pipeline stages', async () => {
    const runPipeline = async () => {
      const snapshot = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: 'repo-pdet-wrap-dir',
          organizationId: org,
          files: [{ path: 'src/app.ts', content: sourceWithDirectWrapper }],
        },
        org,
      );

      const ingestion = await ingestExpress(snapshot, org);
      const analysis = await detectSqlInjection(snapshot, ingestion, org);
      const bridge = createSqlCandidateBridge(async () => commitSha);
      const candidates = await bridge(analysis, snapshot, ingestion, org);

      return { snapshot, ingestion, analysis, candidates };
    };

    const runA = await runPipeline();
    const runB = await runPipeline();

    expect(runA.snapshot.snapshotId).toBe(runB.snapshot.snapshotId);
    expect(runA.ingestion.ingestionIdentity).toBe(runB.ingestion.ingestionIdentity);
    expect(runA.analysis.resultFingerprint).toBe(runB.analysis.resultFingerprint);
    expect(runA.candidates.length).toBe(1);
    expect(runB.candidates.length).toBe(1);
    expect(runA.candidates[0].candidate.candidateId).toBe(runB.candidates[0].candidate.candidateId);
    expect(runA.candidates[0].candidateBinding).toBe(runB.candidates[0].candidateBinding);

    expect(runA.analysis.status).toBe('DETECTED');
    expect(runA.analysis.findings).toHaveLength(1);

    const finding = runA.analysis.findings[0];
    const flowKinds = finding.flow.map(step => step.kind);
    expect(flowKinds).toContain('SOURCE');
    expect(flowKinds).toContain('CALL');
    expect(flowKinds).toContain('ARGUMENT');
    expect(flowKinds).toContain('RETURN');
    expect(flowKinds).toContain('SINK');

    const hypothesis = runA.candidates[0];
    expect(hypothesis.candidate.verificationState).toBe('CANDIDATE');
    expect(hypothesis.candidate.reachabilityState).toBe('REACHABLE');
    expect(hypothesis.candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(hypothesis.candidate.snapshot.commitSha).toBe(commitSha);
    expect((hypothesis as any).capability).toBeUndefined();
    expect((hypothesis.candidate as any).capability).toBeUndefined();
  });

  it('validates structural integrity and rejects tampered artifacts at wrapper boundary', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-pdet-wrap-integrity',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: sourceWithDirectWrapper }],
      },
      org,
    );
    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);

    await expect(validateSnapshot(snapshot, org)).resolves.toBeDefined();
    await expect(validateExpressIngestion(ingestion, org)).resolves.toBeDefined();
    await expect(validateSqlAnalysis(analysis, snapshot, ingestion, org)).resolves.toBeDefined();

    const tamperedAnalysis = {
      ...analysis,
      resultFingerprint: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    };
    await expect(validateSqlAnalysis(tamperedAnalysis, snapshot, ingestion, org)).rejects.toThrow();

    await expect(validateSnapshot(snapshot, 'foreign_org')).rejects.toThrow('tenant mismatch');
    await expect(validateExpressIngestion(ingestion, 'foreign_org')).rejects.toThrow('tenant mismatch');
  });

  it('fails closed when candidate bridge commit verification fails or returns invalid commit identity', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-pdet-wrap-bridge-fail',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: sourceWithDirectWrapper }],
      },
      org,
    );
    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);

    const zeroShaBridge = createSqlCandidateBridge(async () => '0000000000000000000000000000000000000000');
    await expect(zeroShaBridge(analysis, snapshot, ingestion, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const invalidShaBridge = createSqlCandidateBridge(async () => 'invalid-commit-sha');
    await expect(invalidShaBridge(analysis, snapshot, ingestion, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const throwingBridge = createSqlCandidateBridge(async () => {
      throw new Error('M3_CHECKED_COMMIT_REQUIRED');
    });
    await expect(throwingBridge(analysis, snapshot, ingestion, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
  });

  it('returns empty candidate set when wrapper returns clean un-tainted literal query', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-pdet-wrap-clean',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: cleanOnlySource }],
      },
      org,
    );
    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);

    expect(analysis.status).toBe('NOT_DETECTED');
    expect(analysis.findings).toHaveLength(0);

    const bridge = createSqlCandidateBridge(async () => commitSha);
    const candidates = await bridge(analysis, snapshot, ingestion, org);

    expect(candidates).toHaveLength(0);
    expect(Object.isFrozen(candidates)).toBe(true);
  });
});
