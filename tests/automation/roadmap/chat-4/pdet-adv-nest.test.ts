import { describe, it, expect } from 'vitest';
import {
  captureSnapshot,
  validateSnapshot,
  detachJson,
  type SourceSnapshot,
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

const org = 'org_pdet_nest';
const repoId = 'repo-pdet-nest';
const fixtureId = 'm2-case-001';

describe('Pipeline Determinism Adversarial Edge Case: Nested', () => {
  it('deterministically analyzes multi-level nested helper function calls with taint propagation', async () => {
    const routeCode = [
      "import express from 'express';",
      "",
      "export function createApp(db: any) {",
      "  const app = express();",
      "",
      "  function leafHelper(val: any) {",
      '    return "SELECT * FROM items WHERE id = " + val;',
      "  }",
      "",
      "  function midHelper(param: any) {",
      "    const intermediate = leafHelper(param);",
      "    return intermediate;",
      "  }",
      "",
      "  function handler(req: any, res: any) {",
      "    const sql = midHelper(req.query.id);",
      "    return res.json(db.prepare(sql).all());",
      "  }",
      "",
      "  app.get('/items', handler);",
      "  return app;",
      "}",
      "",
    ].join('\n');

    const snapshot = await captureSnapshot(
      {
        fixtureId,
        repositoryId: repoId,
        organizationId: org,
        files: [{ path: 'src/routes.ts', content: routeCode }],
      },
      org,
    );

    const expressIngestion = await ingestExpress(snapshot, org);
    expect(expressIngestion.routes.length).toBe(1);

    const analysisA = await detectSqlInjection(snapshot, expressIngestion, org);
    const analysisB = await detectSqlInjection(snapshot, expressIngestion, org);

    expect(analysisA.status).toBe('DETECTED');
    expect(analysisB.status).toBe('DETECTED');
    expect(analysisA.resultFingerprint).toBe(analysisB.resultFingerprint);
    expect(analysisA.findings.length).toBe(1);
    expect(analysisB.findings.length).toBe(1);
    expect(analysisA.findings[0].findingId).toBe(analysisB.findings[0].findingId);

    const verifiedAnalysis = await validateSqlAnalysis(analysisA, snapshot, expressIngestion, org);
    expect(verifiedAnalysis.resultFingerprint).toBe(analysisA.resultFingerprint);

    const dummyCommitSha = 'a'.repeat(40);
    const bridge = createSqlCandidateBridge(async () => dummyCommitSha);

    const hypothesesA = await bridge(analysisA, snapshot, expressIngestion, org);
    const hypothesesB = await bridge(analysisB, snapshot, expressIngestion, org);

    expect(hypothesesA.length).toBe(1);
    expect(hypothesesB.length).toBe(1);
    expect(hypothesesA[0].candidate.candidateId).toBe(hypothesesB[0].candidate.candidateId);
    expect(hypothesesA[0].candidateBinding).toBe(hypothesesB[0].candidateBinding);
    expect(hypothesesA[0].candidate.verificationState).toBe('CANDIDATE');
  });

  it('deterministically limits call cycles in adversarial nested recursive functions to ANALYSIS_INCONCLUSIVE', async () => {
    const routeCode = [
      "import express from 'express';",
      "",
      "export function createApp(db: any) {",
      "  const app = express();",
      "",
      "  function cycleA(val: any) {",
      "    return cycleB(val);",
      "  }",
      "",
      "  function cycleB(val: any) {",
      "    return cycleA(val);",
      "  }",
      "",
      "  function handler(req: any, res: any) {",
      "    const sql = cycleA(req.query.id);",
      "    return res.json(db.prepare(sql).all());",
      "  }",
      "",
      "  app.get('/cycle', handler);",
      "  return app;",
      "}",
      "",
    ].join('\n');

    const snapshot = await captureSnapshot(
      {
        fixtureId,
        repositoryId: repoId,
        organizationId: org,
        files: [{ path: 'src/routes.ts', content: routeCode }],
      },
      org,
    );

    const expressIngestion = await ingestExpress(snapshot, org);

    const analysisA = await detectSqlInjection(snapshot, expressIngestion, org);
    const analysisB = await detectSqlInjection(snapshot, expressIngestion, org);

    expect(analysisA.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(analysisB.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(analysisA.resultFingerprint).toBe(analysisB.resultFingerprint);
    expect(analysisA.limitations.length).toBe(1);
    expect(analysisA.limitations[0].code).toBe('CALL_CYCLE');
    expect(analysisA.findings.length).toBe(0);

    const dummyCommitSha = 'a'.repeat(40);
    const bridge = createSqlCandidateBridge(async () => dummyCommitSha);
    const hypotheses = await bridge(analysisA, snapshot, expressIngestion, org);
    expect(hypotheses).toEqual([]);
  });

  it('deterministically propagates taint through deeply nested parenthesized binary concatenations', async () => {
    const routeCode = [
      "import express from 'express';",
      "",
      "export function createApp(db: any) {",
      "  const app = express();",
      "",
      "  function handler(req: any, res: any) {",
      '    const sql = ("SELECT * FROM items WHERE " + ("tenant = \'default\' AND " + ("category = \'all\' AND " + ("id = " + req.query.id))));',
      "    return res.json(db.prepare(sql).all());",
      "  }",
      "",
      "  app.get('/nested-concat', handler);",
      "  return app;",
      "}",
      "",
    ].join('\n');

    const snapshot = await captureSnapshot(
      {
        fixtureId,
        repositoryId: repoId,
        organizationId: org,
        files: [{ path: 'src/routes.ts', content: routeCode }],
      },
      org,
    );

    const expressIngestion = await ingestExpress(snapshot, org);
    const analysisA = await detectSqlInjection(snapshot, expressIngestion, org);
    const analysisB = await detectSqlInjection(snapshot, expressIngestion, org);

    expect(analysisA.status).toBe('DETECTED');
    expect(analysisB.status).toBe('DETECTED');
    expect(analysisA.resultFingerprint).toBe(analysisB.resultFingerprint);
    expect(analysisA.findings.length).toBe(1);

    const concatSteps = analysisA.findings[0].flow.filter((step) => step.kind === 'CONCAT');
    expect(concatSteps.length).toBeGreaterThanOrEqual(2);
  });

  it('fails closed deterministically on adversarial nested router mount attempts', async () => {
    const routeCode = [
      "import express from 'express';",
      "",
      "export function createApp(db: any) {",
      "  const app = express();",
      "  const parentRouter = express.Router();",
      "  const childRouter = express.Router();",
      "",
      "  function handler(req: any, res: any) {",
      '    return res.json(db.prepare("SELECT 1").all());',
      "  }",
      "",
      "  childRouter.get('/leaf', handler);",
      "  parentRouter.use('/sub', childRouter);",
      "  app.use('/api', parentRouter);",
      "  return app;",
      "}",
      "",
    ].join('\n');

    const snapshot = await captureSnapshot(
      {
        fixtureId,
        repositoryId: repoId,
        organizationId: org,
        files: [{ path: 'src/routes.ts', content: routeCode }],
      },
      org,
    );

    await expect(ingestExpress(snapshot, org)).rejects.toThrow('unsupported router mount');
    await expect(ingestExpress(snapshot, org)).rejects.toThrow('unsupported router mount');
  });

  it('bounds adversarial nested JSON metadata complexity in detachJson', () => {
    let deepObj: any = { leaf: true };
    for (let i = 0; i < 20; i++) {
      deepObj = { nested: deepObj };
    }

    expect(() => detachJson(deepObj)).toThrow('metadata complexity');

    let boundedObj: any = { leaf: 'val' };
    for (let i = 0; i < 15; i++) {
      boundedObj = { nested: boundedObj };
    }

    const detached1 = detachJson(boundedObj);
    const detached2 = detachJson(boundedObj);
    expect(JSON.stringify(detached1)).toBe(JSON.stringify(detached2));
  });

  it('preserves snapshot determinism across deeply nested directory structures and rejects traversal components', async () => {
    const file1 = {
      path: 'src/modules/sub1/sub2/routes.ts',
      content: 'export const value = 1;\n',
    };
    const file2 = {
      path: 'src/modules/sub1/utils.ts',
      content: 'export const helper = true;\n',
    };

    const snapForward = await captureSnapshot(
      {
        fixtureId,
        repositoryId: repoId,
        organizationId: org,
        files: [file1, file2],
      },
      org,
    );

    const snapReversed = await captureSnapshot(
      {
        fixtureId,
        repositoryId: repoId,
        organizationId: org,
        files: [file2, file1],
      },
      org,
    );

    expect(snapForward.snapshotId).toBe(snapReversed.snapshotId);
    expect(snapForward.files[0].path).toBe('src/modules/sub1/sub2/routes.ts');
    expect(snapForward.files[1].path).toBe('src/modules/sub1/utils.ts');

    await expect(
      captureSnapshot(
        {
          fixtureId,
          repositoryId: repoId,
          organizationId: org,
          files: [{ path: 'src/nested/../routes.ts', content: 'export const invalid = true;\n' }],
        },
        org,
      ),
    ).rejects.toThrow('path component');

    await expect(
      captureSnapshot(
        {
          fixtureId,
          repositoryId: repoId,
          organizationId: org,
          files: [{ path: 'src/nested//routes.ts', content: 'export const invalid = true;\n' }],
        },
        org,
      ),
    ).rejects.toThrow('path component');
  });

  it('verifies candidate bridge enforces commit validation and non-authoritative candidate boundary', async () => {
    const routeCode = [
      "import express from 'express';",
      "",
      "export function createApp(db: any) {",
      "  const app = express();",
      "  function handler(req: any, res: any) {",
      '    const sql = "SELECT * FROM items WHERE id = " + req.query.id;',
      "    return res.json(db.prepare(sql).all());",
      "  }",
      "  app.get('/items', handler);",
      "  return app;",
      "}",
      "",
    ].join('\n');

    const snapshot = await captureSnapshot(
      {
        fixtureId,
        repositoryId: repoId,
        organizationId: org,
        files: [{ path: 'src/routes.ts', content: routeCode }],
      },
      org,
    );

    const expressIngestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
    expect(analysis.status).toBe('DETECTED');

    const zeroBridge = createSqlCandidateBridge(async () => '0'.repeat(40));
    await expect(zeroBridge(analysis, snapshot, expressIngestion, org)).rejects.toThrow(
      'M3_CHECKED_COMMIT_REQUIRED',
    );

    const invalidBridge = createSqlCandidateBridge(async () => 'not-a-sha');
    await expect(invalidBridge(analysis, snapshot, expressIngestion, org)).rejects.toThrow(
      'M3_CHECKED_COMMIT_REQUIRED',
    );
  });
});
