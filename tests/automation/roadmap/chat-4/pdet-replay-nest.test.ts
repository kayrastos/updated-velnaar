import { describe, it, expect } from 'vitest';
import {
  captureSnapshot,
  validateSnapshot,
  detachJson,
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
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';

const org = 'org_pdet_replay_nest';
const repoId = 'repo-pdet-replay-nest';
const commitSha = '95b0e33efcc0c9fde40ce8eabbaef056bde2f270';

const nestedAppSource = `import express from 'express';

export function createApp(db: any) {
  const app = express();
  const apiRouter = express.Router();

  function sanitizeInput(val: any) {
    return val;
  }

  function buildQuery(param: any) {
    const clean = sanitizeInput(param);
    return "SELECT * FROM items WHERE category = '" + clean + "'";
  }

  function nestedVulnerableHandler(req: any, res: any) {
    const query = buildQuery(req.query.cat);
    const stmt = db.prepare(query);
    return stmt.all();
  }

  function nestedSafeHandler(req: any, res: any) {
    const stmt = db.prepare("SELECT * FROM items WHERE category = ?");
    return stmt.all(req.query.cat);
  }

  apiRouter.get('/vuln', nestedVulnerableHandler);
  apiRouter.get('/safe', nestedSafeHandler);
  app.use('/api', apiRouter);

  return app;
}
`;

function createNestedInput() {
  return {
    fixtureId: 'm2-case-001',
    repositoryId: repoId,
    organizationId: org,
    files: [
      {
        path: 'src/nestedApp.ts',
        content: nestedAppSource,
      },
    ],
  };
}

describe('V1 Pipeline Determinism - Nested Replay Invariance', () => {
  it('preserves bitwise replay determinism across repeated pipeline evaluations of nested route architecture', async () => {
    const input = createNestedInput();
    const bridge = createSqlCandidateBridge(async () => commitSha);

    const snapshot1 = await captureSnapshot(input, org);
    const ingestion1 = await ingestExpress(snapshot1, org);
    const analysis1 = await detectSqlInjection(snapshot1, ingestion1, org);
    const candidates1 = await bridge(analysis1, snapshot1, ingestion1, org);

    const snapshot2 = await captureSnapshot(input, org);
    const ingestion2 = await ingestExpress(snapshot2, org);
    const analysis2 = await detectSqlInjection(snapshot2, ingestion2, org);
    const candidates2 = await bridge(analysis2, snapshot2, ingestion2, org);

    const snapshot3 = await captureSnapshot(input, org);
    const ingestion3 = await ingestExpress(snapshot3, org);
    const analysis3 = await detectSqlInjection(snapshot3, ingestion3, org);
    const candidates3 = await bridge(analysis3, snapshot3, ingestion3, org);

    expect(snapshot1.snapshotId).toBe(snapshot2.snapshotId);
    expect(snapshot2.snapshotId).toBe(snapshot3.snapshotId);

    expect(ingestion1.ingestionIdentity).toBe(ingestion2.ingestionIdentity);
    expect(ingestion2.ingestionIdentity).toBe(ingestion3.ingestionIdentity);
    expect(ingestion1.routes).toHaveLength(2);
    expect(ingestion1.routes[0].path).toBe('/api/vuln');
    expect(ingestion1.routes[1].path).toBe('/api/safe');
    expect(ingestion1.routes[0].routeIdentity).toBe(ingestion2.routes[0].routeIdentity);
    expect(ingestion1.routes[1].routeIdentity).toBe(ingestion2.routes[1].routeIdentity);

    expect(analysis1.status).toBe('DETECTED');
    expect(analysis2.status).toBe('DETECTED');
    expect(analysis3.status).toBe('DETECTED');
    expect(analysis1.resultFingerprint).toBe(analysis2.resultFingerprint);
    expect(analysis2.resultFingerprint).toBe(analysis3.resultFingerprint);
    expect(analysis1.findings).toHaveLength(1);
    expect(analysis2.findings).toHaveLength(1);
    expect(analysis3.findings).toHaveLength(1);
    expect(analysis1.findings[0].findingId).toBe(analysis2.findings[0].findingId);
    expect(analysis2.findings[0].findingId).toBe(analysis3.findings[0].findingId);
    expect(analysis1.findings[0].routeIdentity).toBe(ingestion1.routes[0].routeIdentity);
    expect(analysis1.limitations).toHaveLength(0);
    expect(canonical(analysis1)).toBe(canonical(analysis2));
    expect(canonical(analysis2)).toBe(canonical(analysis3));

    expect(candidates1).toHaveLength(1);
    expect(candidates2).toHaveLength(1);
    expect(candidates3).toHaveLength(1);
    expect(candidates1[0].candidate.candidateId).toBe(candidates2[0].candidate.candidateId);
    expect(candidates2[0].candidate.candidateId).toBe(candidates3[0].candidate.candidateId);
    expect(candidates1[0].candidateBinding).toBe(candidates2[0].candidateBinding);
    expect(candidates2[0].candidateBinding).toBe(candidates3[0].candidateBinding);
    expect(candidates1[0].candidate.verificationState).toBe('CANDIDATE');
    expect(candidates1[0].candidate.verificationState).not.toBe('VERIFIED');
  });

  it('guarantees replay invariance for nested call-stack flow sequence and node digests', async () => {
    const input = createNestedInput();

    const snapshotA = await captureSnapshot(input, org);
    const ingestionA = await ingestExpress(snapshotA, org);
    const analysisA = await detectSqlInjection(snapshotA, ingestionA, org);

    const snapshotB = await captureSnapshot(input, org);
    const ingestionB = await ingestExpress(snapshotB, org);
    const analysisB = await detectSqlInjection(snapshotB, ingestionB, org);

    const flowA = analysisA.findings[0].flow;
    const flowB = analysisB.findings[0].flow;

    expect(flowA.length).toBeGreaterThan(0);
    expect(flowA.length).toBe(flowB.length);

    for (let i = 0; i < flowA.length; i++) {
      expect(flowA[i].id).toBe(flowB[i].id);
      expect(flowA[i].kind).toBe(flowB[i].kind);
      expect(flowA[i].location.filePath).toBe(flowB[i].location.filePath);
      expect(flowA[i].location.line).toBe(flowB[i].location.line);
      expect(flowA[i].location.column).toBe(flowB[i].location.column);
    }

    expect(flowA[0].kind).toBe('SOURCE');
    expect(flowA[0].location.symbol).toBe('query.cat');
    expect(flowA[flowA.length - 1].kind).toBe('SINK');
    expect(flowA[flowA.length - 1].location.symbol).toBe('db.prepare');

    const kinds = flowA.map((step) => step.kind);
    expect(kinds).toContain('SOURCE');
    expect(kinds).toContain('CALL');
    expect(kinds).toContain('ARGUMENT');
    expect(kinds).toContain('RETURN');
    expect(kinds).toContain('CONCAT');
    expect(kinds).toContain('SINK');
  });

  it('revalidates detached replay objects and rejects nested structure tampering', async () => {
    const input = createNestedInput();
    const snapshot = await captureSnapshot(input, org);
    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);

    const detachedSnapshot = detachJson(snapshot);
    const detachedIngestion = detachJson(ingestion);
    const detachedAnalysis = detachJson(analysis);

    const validatedSnapshot = await validateSnapshot(detachedSnapshot, org);
    expect(validatedSnapshot.snapshotId).toBe(snapshot.snapshotId);

    const validatedIngestion = await validateExpressIngestion(detachedIngestion, org);
    expect(validatedIngestion.ingestionIdentity).toBe(ingestion.ingestionIdentity);

    const validatedAnalysis = await validateSqlAnalysis(detachedAnalysis, validatedSnapshot, validatedIngestion, org);
    expect(validatedAnalysis.resultFingerprint).toBe(analysis.resultFingerprint);

    const tamperedIngestion = detachJson(ingestion);
    tamperedIngestion.routes[0].path = '/tampered/vuln';
    await expect(validateExpressIngestion(tamperedIngestion, org)).rejects.toThrow();

    const tamperedAnalysis = detachJson(analysis);
    tamperedAnalysis.findings = [];
    await expect(validateSqlAnalysis(tamperedAnalysis, snapshot, ingestion, org)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');

    await expect(validateSnapshot(snapshot, 'foreign_org')).rejects.toThrow();
    await expect(validateExpressIngestion(ingestion, 'foreign_org')).rejects.toThrow();
  });

  it('preserves candidate bridge replay idempotency without state accumulation', async () => {
    const input = createNestedInput();
    const snapshot = await captureSnapshot(input, org);
    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);
    const bridge = createSqlCandidateBridge(async () => commitSha);

    const replay1 = await bridge(analysis, snapshot, ingestion, org);
    const replay2 = await bridge(analysis, snapshot, ingestion, org);

    expect(replay1).toEqual(replay2);
    expect(replay1[0].candidateBinding).toBe(replay2[0].candidateBinding);
    expect(replay1[0].candidate.snapshot.commitSha).toBe(commitSha);
    expect(replay1[0].candidate.snapshot.snapshotId).toBe(snapshot.snapshotId);
    expect(replay1[0].candidate.verificationState).toBe('CANDIDATE');
    expect(replay1[0].candidate.verificationState).not.toBe('VERIFIED');

    const invalidShaBridge = createSqlCandidateBridge(async () => '0000000000000000000000000000000000000000');
    await expect(invalidShaBridge(analysis, snapshot, ingestion, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
  });
});
