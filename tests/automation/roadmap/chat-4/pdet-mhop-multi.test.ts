import { describe, it, expect } from 'vitest';
import {
  captureSnapshot,
  validateSnapshot,
  type SnapshotInput,
} from '../../../../worker/intelligence/ingestion/snapshot';
import {
  ingestExpress,
  validateExpressIngestion,
} from '../../../../worker/intelligence/ingestion/express';
import {
  detectSqlInjection,
  validateSqlAnalysis,
} from '../../../../worker/intelligence/detection/sqlInjection';

const appSource = `import express from 'express';

export function createApp(db: any) {
  const app = express();

  function stage3(clause: any) {
    return 'SELECT id, name FROM items WHERE category = ' + clause;
  }

  function stage2(mid: any) {
    const next = stage3(mid);
    return next;
  }

  function stage1(initial: any) {
    const intermediate = stage2(initial);
    return intermediate;
  }

  function handle(req: any, res: any) {
    const tainted = req.query.category;
    const query = stage1(tainted);
    const stmt = db.prepare(query);
    const rows = stmt.all();
    res.json(rows);
  }

  app.get('/items', handle);
  return app;
}
`;

describe('Pipeline Determinism: Multi-Hop Flow Multi-Stage Integration', () => {
  const organizationId = 'org_chat4_det';
  const repositoryId = 'repo_pdet_multi';
  const fixtureId = 'm2-case-001';

  const snapshotInput: SnapshotInput = {
    fixtureId,
    repositoryId,
    organizationId,
    files: [
      {
        path: 'src/app.ts',
        content: appSource,
      },
    ],
  };

  it('proves deterministic multi-stage ingestion and multi-hop SQL injection detection', async () => {
    const snapshotA = await captureSnapshot(snapshotInput, organizationId);
    const expressA = await ingestExpress(snapshotA, organizationId);
    const analysisA = await detectSqlInjection(snapshotA, expressA, organizationId);

    const snapshotB = await captureSnapshot(snapshotInput, organizationId);
    const expressB = await ingestExpress(snapshotB, organizationId);
    const analysisB = await detectSqlInjection(snapshotB, expressB, organizationId);

    expect(snapshotA.snapshotId).toBe(snapshotB.snapshotId);
    expect(snapshotA.totalBytes).toBe(snapshotB.totalBytes);
    expect(snapshotA.files[0].contentDigest).toBe(snapshotB.files[0].contentDigest);
    expect(snapshotA.files[0].fileIdentity).toBe(snapshotB.files[0].fileIdentity);

    expect(expressA.ingestionIdentity).toBe(expressB.ingestionIdentity);
    expect(expressA.routes.length).toBe(1);
    expect(expressA.routes[0].routeIdentity).toBe(expressB.routes[0].routeIdentity);

    expect(analysisA.status).toBe('DETECTED');
    expect(analysisB.status).toBe('DETECTED');
    expect(analysisA.resultFingerprint).toBe(analysisB.resultFingerprint);
    expect(analysisA.findings.length).toBe(1);
    expect(analysisB.findings.length).toBe(1);

    const findingA = analysisA.findings[0];
    const findingB = analysisB.findings[0];

    expect(findingA.findingId).toBe(findingB.findingId);
    expect(findingA.routeIdentity).toBe(expressA.routes[0].routeIdentity);
    expect(findingA.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(findingA.source.symbol).toBe('query.category');
    expect(findingA.sink.symbol).toBe('db.prepare');

    expect(findingA.flow.length).toBe(findingB.flow.length);
    const flowIdsA = findingA.flow.map((step) => step.id);
    const flowIdsB = findingB.flow.map((step) => step.id);
    expect(flowIdsA).toEqual(flowIdsB);

    const flowKinds = findingA.flow.map((step) => step.kind);
    expect(flowKinds).toContain('SOURCE');
    expect(flowKinds).toContain('CALL');
    expect(flowKinds).toContain('ARGUMENT');
    expect(flowKinds).toContain('CONCAT');
    expect(flowKinds).toContain('RETURN');
    expect(flowKinds).toContain('VARIABLE');
    expect(flowKinds).toContain('SINK');

    const validatedSnapshot = await validateSnapshot(snapshotA, organizationId);
    expect(validatedSnapshot.snapshotId).toBe(snapshotA.snapshotId);

    const validatedExpress = await validateExpressIngestion(expressA, organizationId);
    expect(validatedExpress.ingestionIdentity).toBe(expressA.ingestionIdentity);

    const validatedAnalysis = await validateSqlAnalysis(analysisA, snapshotA, expressA, organizationId);
    expect(validatedAnalysis.resultFingerprint).toBe(analysisA.resultFingerprint);

    await expect(validateSnapshot(snapshotA, 'foreign_org')).rejects.toThrow();
    await expect(validateExpressIngestion(expressA, 'foreign_org')).rejects.toThrow();
    await expect(validateSqlAnalysis(analysisA, snapshotA, expressA, 'foreign_org')).rejects.toThrow();

    expect((analysisA as any).capability).toBeUndefined();
    expect((analysisA as any).verificationState).toBeUndefined();
  });
});
