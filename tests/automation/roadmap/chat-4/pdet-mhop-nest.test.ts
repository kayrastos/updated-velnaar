import { describe, it, expect } from 'vitest';
import { captureSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';

const org = 'org_pdet_mhop_nest';
const mockCommitSha = '95b0e33efcc0c9fde40ce8eabbaef056bde2f270';

const vulnerableSource = `import express from 'express';

function innerHop(param: any) {
  const query = 'SELECT id, name FROM items WHERE category = ' + param;
  return query;
}

function outerHop(input: any) {
  const mid = innerHop(input);
  return mid;
}

export function createApp(db: any) {
  const app = express();
  const router = express.Router();

  function searchHandler(req: any, res: any) {
    const raw = req.query.category;
    const sql = outerHop(raw);
    const rows = db.prepare(sql).all();
    return res.json(rows);
  }

  router.get('/search', searchHandler);
  app.use('/nested', router);
  return app;
}
`;

const safeSource = `import express from 'express';

function innerSafe(param: any) {
  const query = 'SELECT id, name FROM items WHERE category = ?';
  return query;
}

function outerSafe(input: any) {
  const mid = innerSafe(input);
  return mid;
}

export function createApp(db: any) {
  const app = express();
  const router = express.Router();

  function safeHandler(req: any, res: any) {
    const raw = req.query.category;
    const sql = outerSafe(raw);
    const rows = db.prepare(sql).all(raw);
    return res.json(rows);
  }

  router.get('/search', safeHandler);
  app.use('/nested', router);
  return app;
}
`;

describe('RM_PDET_MHOP_NEST: Pipeline Determinism for Multi-Hop Flow on Nested Routers', () => {
  it('deterministically captures, ingests, and analyzes multi-hop tainted flow across nested router mounts', async () => {
    const input = {
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-pdet-mhop-nest',
      organizationId: org,
      files: [{ path: 'src/app.ts', content: vulnerableSource }],
    };

    const snapshot1 = await captureSnapshot(input, org);
    const ingestion1 = await ingestExpress(snapshot1, org);
    const analysis1 = await detectSqlInjection(snapshot1, ingestion1, org);

    const snapshot2 = await captureSnapshot(input, org);
    const ingestion2 = await ingestExpress(snapshot2, org);
    const analysis2 = await detectSqlInjection(snapshot2, ingestion2, org);

    expect(snapshot1.snapshotId).toBe(snapshot2.snapshotId);
    expect(snapshot1.totalBytes).toBe(snapshot2.totalBytes);

    expect(ingestion1.ingestionIdentity).toBe(ingestion2.ingestionIdentity);
    expect(ingestion1.routes).toHaveLength(1);
    expect(ingestion1.routes[0].path).toBe('/nested/search');
    expect(ingestion1.routes[0].method).toBe('GET');
    expect(ingestion1.routes[0].ownerKind).toBe('ROUTER');
    expect(ingestion1.routes[0].mount?.prefix).toBe('/nested');

    expect(analysis1.status).toBe('DETECTED');
    expect(analysis2.status).toBe('DETECTED');
    expect(analysis1.resultFingerprint).toBe(analysis2.resultFingerprint);
    expect(analysis1.findings).toHaveLength(1);
    expect(analysis2.findings).toHaveLength(1);
    expect(analysis1.findings[0].findingId).toBe(analysis2.findings[0].findingId);

    const flow1 = analysis1.findings[0].flow;
    const flow2 = analysis2.findings[0].flow;
    expect(flow1.length).toBeGreaterThan(3);
    expect(flow1.length).toBe(flow2.length);

    for (let i = 0; i < flow1.length; i++) {
      expect(flow1[i].id).toBe(flow2[i].id);
      expect(flow1[i].kind).toBe(flow2[i].kind);
      expect(flow1[i].location.filePath).toBe(flow2[i].location.filePath);
      expect(flow1[i].location.line).toBe(flow2[i].location.line);
    }
  });

  it('validates analysis integrity against captured snapshot and rejects tampered fingerprints', async () => {
    const input = {
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-pdet-mhop-nest',
      organizationId: org,
      files: [{ path: 'src/app.ts', content: vulnerableSource }],
    };

    const snapshot = await captureSnapshot(input, org);
    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);

    const validated = await validateSqlAnalysis(analysis, snapshot, ingestion, org);
    expect(validated.resultFingerprint).toBe(analysis.resultFingerprint);

    const tampered = {
      ...analysis,
      resultFingerprint: 'sha256:' + '0'.repeat(64),
    };

    await expect(validateSqlAnalysis(tampered, snapshot, ingestion, org)).rejects.toThrow(
      'M3_ANALYSIS_INTEGRITY_MISMATCH',
    );
  });

  it('generates candidate hypothesis preserving non-authoritative boundary and deterministic binding', async () => {
    const input = {
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-pdet-mhop-nest',
      organizationId: org,
      files: [{ path: 'src/app.ts', content: vulnerableSource }],
    };

    const snapshot = await captureSnapshot(input, org);
    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);

    const verifyCode = async () => mockCommitSha;
    const bridge = createSqlCandidateBridge(verifyCode);

    const hypotheses1 = await bridge(analysis, snapshot, ingestion, org);
    const hypotheses2 = await bridge(analysis, snapshot, ingestion, org);

    expect(hypotheses1).toHaveLength(1);
    expect(hypotheses2).toHaveLength(1);

    const h1 = hypotheses1[0];
    const h2 = hypotheses2[0];

    expect(h1.candidate.candidateId).toBe(h2.candidate.candidateId);
    expect(h1.candidateBinding).toBe(h2.candidateBinding);
    expect(h1.candidate.verificationState).toBe('CANDIDATE');
    expect(h1.candidate.reachabilityState).toBe('REACHABLE');
    expect(h1.candidate.vulnerabilityClass).toBe('SQL_INJECTION');
  });

  it('deterministically reports NOT_DETECTED for clean parameterized multi-hop flow on nested router', async () => {
    const input = {
      fixtureId: 'm2-case-002',
      repositoryId: 'repo-pdet-mhop-nest-safe',
      organizationId: org,
      files: [{ path: 'src/app.ts', content: safeSource }],
    };

    const snapshot = await captureSnapshot(input, org);
    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);

    expect(analysis.status).toBe('NOT_DETECTED');
    expect(analysis.findings).toHaveLength(0);
    expect(analysis.limitations).toHaveLength(0);

    const validated = await validateSqlAnalysis(analysis, snapshot, ingestion, org);
    expect(validated.status).toBe('NOT_DETECTED');
    expect(validated.resultFingerprint).toBe(analysis.resultFingerprint);
  });
});
