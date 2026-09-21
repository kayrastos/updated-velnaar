import { describe, it, expect } from 'vitest';
import { captureSnapshot, validateSnapshot, canonical } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress, validateExpressIngestion } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';

const ORG_ID = 'org_pdet_nest_nest';
const REPO_ID = 'repo-pdet-nest-nest';
const FIXTURE_ID = 'm2-case-001';

const APP_CODE = `import express from 'express';

export function createApp(db: any) {
  function wrapQuery(val: any) {
    return "SELECT * FROM accounts WHERE id = '" + val + "'";
  }

  function formatQuery(val: any) {
    const q = wrapQuery(val);
    return q;
  }

  function handleQuery(req: any, res: any) {
    const raw = req.query.id;
    const sql = formatQuery(raw);
    const stmt = db.prepare(sql);
    const rows = stmt.all();
    return res.json(rows);
  }

  const app = express();
  const router = express.Router();
  router.get('/query', handleQuery);
  app.use('/api', router);
  return app;
}
`;

function buildSnapshotInput() {
  return {
    fixtureId: FIXTURE_ID,
    repositoryId: REPO_ID,
    organizationId: ORG_ID,
    files: [
      {
        path: 'src/app.ts',
        content: APP_CODE,
      },
    ],
  };
}

describe('Pipeline Determinism: Nested Flow in Nested Router', () => {
  it('deterministically ingests and detects nested helper flow on nested router mounts', async () => {
    const input1 = buildSnapshotInput();
    const input2 = buildSnapshotInput();

    const snapshot1 = await captureSnapshot(input1, ORG_ID);
    const snapshot2 = await captureSnapshot(input2, ORG_ID);

    expect(snapshot1.snapshotId).toBe(snapshot2.snapshotId);
    expect(snapshot1.totalBytes).toBe(snapshot2.totalBytes);

    const express1 = await ingestExpress(snapshot1, ORG_ID);
    const express2 = await ingestExpress(snapshot2, ORG_ID);

    expect(express1.ingestionIdentity).toBe(express2.ingestionIdentity);
    expect(express1.routes).toHaveLength(1);
    expect(express1.routes[0].path).toBe('/api/query');
    expect(express1.routes[0].ownerKind).toBe('ROUTER');
    expect(express1.routes[0].mount).not.toBeNull();
    expect(express1.routes[0].mount?.prefix).toBe('/api');

    const analysis1 = await detectSqlInjection(snapshot1, express1, ORG_ID);
    const analysis2 = await detectSqlInjection(snapshot2, express2, ORG_ID);

    expect(analysis1.status).toBe('DETECTED');
    expect(analysis2.status).toBe('DETECTED');
    expect(analysis1.resultFingerprint).toBe(analysis2.resultFingerprint);
    expect(analysis1.findings).toHaveLength(1);
    expect(analysis2.findings).toHaveLength(1);
    expect(analysis1.findings[0].findingId).toBe(analysis2.findings[0].findingId);
    expect(canonical(analysis1)).toBe(canonical(analysis2));

    const flowKinds = analysis1.findings[0].flow.map((step) => step.kind);
    expect(flowKinds).toContain('SOURCE');
    expect(flowKinds).toContain('CALL');
    expect(flowKinds).toContain('ARGUMENT');
    expect(flowKinds).toContain('CONCAT');
    expect(flowKinds).toContain('VARIABLE');
    expect(flowKinds).toContain('RETURN');
    expect(flowKinds).toContain('SINK');
  });

  it('validates structural integrity across pipeline layers and rejects forged fingerprints', async () => {
    const snapshot = await captureSnapshot(buildSnapshotInput(), ORG_ID);
    const express = await ingestExpress(snapshot, ORG_ID);
    const analysis = await detectSqlInjection(snapshot, express, ORG_ID);

    const validatedSnapshot = await validateSnapshot(snapshot, ORG_ID);
    expect(validatedSnapshot.snapshotId).toBe(snapshot.snapshotId);

    const validatedExpress = await validateExpressIngestion(express, ORG_ID);
    expect(validatedExpress.ingestionIdentity).toBe(express.ingestionIdentity);

    const validatedAnalysis = await validateSqlAnalysis(analysis, snapshot, express, ORG_ID);
    expect(validatedAnalysis.resultFingerprint).toBe(analysis.resultFingerprint);

    const forgedAnalysis = {
      ...analysis,
      resultFingerprint: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    };
    await expect(validateSqlAnalysis(forgedAnalysis, snapshot, express, ORG_ID)).rejects.toThrow(
      'M3_ANALYSIS_INTEGRITY_MISMATCH',
    );
  });

  it('preserves candidate-only verification state and computes deterministic candidate binding', async () => {
    const snapshot = await captureSnapshot(buildSnapshotInput(), ORG_ID);
    const express = await ingestExpress(snapshot, ORG_ID);
    const analysis = await detectSqlInjection(snapshot, express, ORG_ID);

    const mockSha = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
    const bridge = createSqlCandidateBridge(async () => mockSha);

    const hypotheses1 = await bridge(analysis, snapshot, express, ORG_ID);
    const hypotheses2 = await bridge(analysis, snapshot, express, ORG_ID);

    expect(hypotheses1).toHaveLength(1);
    expect(hypotheses2).toHaveLength(1);

    const h1 = hypotheses1[0];
    const h2 = hypotheses2[0];

    expect(h1.candidateBinding).toBe(h2.candidateBinding);
    expect(h1.candidate.candidateId).toBe(h2.candidate.candidateId);
    expect(h1.candidate.verificationState).toBe('CANDIDATE');
    expect(h1.candidate.verificationState).not.toBe('VERIFIED');
    expect(h1.candidate.reachabilityState).toBe('REACHABLE');
    expect(h1.candidate.vulnerabilityClass).toBe('SQL_INJECTION');
  });
});
