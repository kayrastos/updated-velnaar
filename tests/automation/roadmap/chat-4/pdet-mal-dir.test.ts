import { describe, it, expect } from 'vitest';
import {
  captureSnapshot,
  validateSnapshot,
  INGESTION_LIMITS,
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

const org = 'org_pdet_mal_dir';
const validRepo = 'repo_pdet_mal_dir';
const validFixture = 'm2-case-001';

const validSourceA = `import express from 'express';
export function createApp(db: any) {
  const app = express();
  function getItems(req: any, res: any) {
    const q = req.query.id;
    const stmt = db.prepare("SELECT * FROM items WHERE id = " + q);
    return res.json(stmt.all());
  }
  app.get('/items', getItems);
  return app;
}
`;

const validSourceB = `import express from 'express';
export function createApp(db: any) {
  const app = express();
  function getOrders(req: any, res: any) {
    const q = req.query.orderId;
    const stmt = db.prepare("SELECT * FROM orders WHERE id = " + q);
    return res.json(stmt.all());
  }
  app.get('/orders', getOrders);
  return app;
}
`;

async function getRejectionMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    throw new Error('Expected promise to reject but it resolved');
  } catch (error: any) {
    return error.message;
  }
}

describe('V1 Platform Integration - Pipeline Determinism on Direct Malformed Input (RM_PDET_MAL_DIR)', () => {
  it('deterministically rejects malformed snapshot payload structures across repeated evaluations', async () => {
    const malformedOrgCases = [
      { raw: { fixtureId: validFixture, repositoryId: validRepo, organizationId: 'invalid org space', files: [{ path: 'src/app.ts', content: validSourceA }] }, expectedOrg: 'invalid org space', expectedError: 'M2_INGESTION_ERROR: identifier' },
      { raw: { fixtureId: validFixture, repositoryId: validRepo, organizationId: org, files: [{ path: 'src/app.ts', content: validSourceA }] }, expectedOrg: 'different_org', expectedError: 'M2_INGESTION_ERROR: tenant mismatch' },
    ];

    for (const testCase of malformedOrgCases) {
      const err1 = await getRejectionMessage(captureSnapshot(testCase.raw, testCase.expectedOrg));
      const err2 = await getRejectionMessage(captureSnapshot(testCase.raw, testCase.expectedOrg));
      expect(err1).toBe(testCase.expectedError);
      expect(err2).toBe(testCase.expectedError);
      expect(err1).toBe(err2);
    }

    const malformedFixture = {
      fixtureId: 'm2-case-999',
      repositoryId: validRepo,
      organizationId: org,
      files: [{ path: 'src/app.ts', content: validSourceA }],
    };
    const fixErr1 = await getRejectionMessage(captureSnapshot(malformedFixture, org));
    const fixErr2 = await getRejectionMessage(captureSnapshot(malformedFixture, org));
    expect(fixErr1).toBe('M2_INGESTION_ERROR: opaque case identity required');
    expect(fixErr2).toBe('M2_INGESTION_ERROR: opaque case identity required');
    expect(fixErr1).toBe(fixErr2);

    const malformedPathCases = [
      { path: 'src/../escape.ts', error: 'M2_INGESTION_ERROR: path component' },
      { path: 'src/nul.ts', error: 'M2_INGESTION_ERROR: path component' },
      { path: 'src/routes.txt', error: 'M2_INGESTION_ERROR: unsupported extension' },
      { path: 'src/routes.d.ts', error: 'M2_INGESTION_ERROR: unsupported extension' },
    ];

    for (const item of malformedPathCases) {
      const payload = {
        fixtureId: validFixture,
        repositoryId: validRepo,
        organizationId: org,
        files: [{ path: item.path, content: validSourceA }],
      };
      const pathErr1 = await getRejectionMessage(captureSnapshot(payload, org));
      const pathErr2 = await getRejectionMessage(captureSnapshot(payload, org));
      expect(pathErr1).toBe(item.error);
      expect(pathErr2).toBe(item.error);
      expect(pathErr1).toBe(pathErr2);
    }

    const nullBytePayload = {
      fixtureId: validFixture,
      repositoryId: validRepo,
      organizationId: org,
      files: [{ path: 'src/app.ts', content: 'export const x = 1;\0' }],
    };
    const nullErr1 = await getRejectionMessage(captureSnapshot(nullBytePayload, org));
    const nullErr2 = await getRejectionMessage(captureSnapshot(nullBytePayload, org));
    expect(nullErr1).toBe('M2_INGESTION_ERROR: source content');
    expect(nullErr2).toBe('M2_INGESTION_ERROR: source content');
    expect(nullErr1).toBe(nullErr2);

    const oversizedPayload = {
      fixtureId: validFixture,
      repositoryId: validRepo,
      organizationId: org,
      files: [{ path: 'src/app.ts', content: 'x'.repeat(INGESTION_LIMITS.maxFileBytes + 1) }],
    };
    const sizeErr1 = await getRejectionMessage(captureSnapshot(oversizedPayload, org));
    const sizeErr2 = await getRejectionMessage(captureSnapshot(oversizedPayload, org));
    expect(sizeErr1).toBe('M2_INGESTION_ERROR: source content');
    expect(sizeErr2).toBe('M2_INGESTION_ERROR: source content');
    expect(sizeErr1).toBe(sizeErr2);

    const extraPropertyPayload = {
      fixtureId: validFixture,
      repositoryId: validRepo,
      organizationId: org,
      files: [{ path: 'src/app.ts', content: validSourceA }],
      unauthorizedProperty: 'injected',
    };
    const extraErr1 = await getRejectionMessage(captureSnapshot(extraPropertyPayload, org));
    const extraErr2 = await getRejectionMessage(captureSnapshot(extraPropertyPayload, org));
    expect(extraErr1).toBe('M2_INGESTION_ERROR: unknown or missing metadata');
    expect(extraErr2).toBe('M2_INGESTION_ERROR: unknown or missing metadata');
    expect(extraErr1).toBe(extraErr2);

    const emptyFilesPayload = {
      fixtureId: validFixture,
      repositoryId: validRepo,
      organizationId: org,
      files: [],
    };
    const emptyErr1 = await getRejectionMessage(captureSnapshot(emptyFilesPayload, org));
    const emptyErr2 = await getRejectionMessage(captureSnapshot(emptyFilesPayload, org));
    expect(emptyErr1).toBe('M2_INGESTION_ERROR: array bounds or shape');
    expect(emptyErr2).toBe('M2_INGESTION_ERROR: array bounds or shape');
    expect(emptyErr1).toBe(emptyErr2);
  });

  it('deterministically rejects malformed Express source code units across repeated pipeline runs', async () => {
    const unparseableSnapshot = await captureSnapshot({
      fixtureId: validFixture,
      repositoryId: validRepo,
      organizationId: org,
      files: [{ path: 'src/app.ts', content: 'const invalid syntax = ;;; {{' }],
    }, org);

    const synErr1 = await getRejectionMessage(ingestExpress(unparseableSnapshot, org));
    const synErr2 = await getRejectionMessage(ingestExpress(unparseableSnapshot, org));
    expect(synErr1).toBe('M2_INGESTION_ERROR: malformed source unit');
    expect(synErr2).toBe('M2_INGESTION_ERROR: malformed source unit');
    expect(synErr1).toBe(synErr2);

    const missingFactorySnapshot = await captureSnapshot({
      fixtureId: validFixture,
      repositoryId: validRepo,
      organizationId: org,
      files: [{ path: 'src/app.ts', content: 'export const value = 42;\n' }],
    }, org);

    const factoryErr1 = await getRejectionMessage(ingestExpress(missingFactorySnapshot, org));
    const factoryErr2 = await getRejectionMessage(ingestExpress(missingFactorySnapshot, org));
    expect(factoryErr1).toBe('M2_INGESTION_ERROR: no supported Express route');
    expect(factoryErr2).toBe('M2_INGESTION_ERROR: no supported Express route');
    expect(factoryErr1).toBe(factoryErr2);

    const duplicateRouteSource = `import express from 'express';
export function createApp(db: any) {
  const app = express();
  function handlerA(req: any, res: any) { return res.json(db.prepare("SELECT 1").all()); }
  function handlerB(req: any, res: any) { return res.json(db.prepare("SELECT 2").all()); }
  app.get('/dup', handlerA);
  app.get('/dup', handlerB);
  return app;
}
`;
    const duplicateRouteSnapshot = await captureSnapshot({
      fixtureId: validFixture,
      repositoryId: validRepo,
      organizationId: org,
      files: [{ path: 'src/app.ts', content: duplicateRouteSource }],
    }, org);

    const dupErr1 = await getRejectionMessage(ingestExpress(duplicateRouteSnapshot, org));
    const dupErr2 = await getRejectionMessage(ingestExpress(duplicateRouteSnapshot, org));
    expect(dupErr1).toBe('M2_INGESTION_ERROR: ambiguous duplicate route');
    expect(dupErr2).toBe('M2_INGESTION_ERROR: ambiguous duplicate route');
    expect(dupErr1).toBe(dupErr2);
  });

  it('deterministically rejects mismatched direct pipeline stage handoffs', async () => {
    const snapshotA = await captureSnapshot({
      fixtureId: validFixture,
      repositoryId: validRepo,
      organizationId: org,
      files: [{ path: 'src/app.ts', content: validSourceA }],
    }, org);

    const snapshotB = await captureSnapshot({
      fixtureId: 'm2-case-002',
      repositoryId: validRepo,
      organizationId: org,
      files: [{ path: 'src/app.ts', content: validSourceB }],
    }, org);

    const ingestionA = await ingestExpress(snapshotA, org);
    const ingestionB = await ingestExpress(snapshotB, org);

    const mismatchErr1 = await getRejectionMessage(detectSqlInjection(snapshotA, ingestionB, org));
    const mismatchErr2 = await getRejectionMessage(detectSqlInjection(snapshotA, ingestionB, org));
    expect(mismatchErr1).toBe('M3_ANALYSIS_SNAPSHOT_MISMATCH');
    expect(mismatchErr2).toBe('M3_ANALYSIS_SNAPSHOT_MISMATCH');
    expect(mismatchErr1).toBe(mismatchErr2);

    const reverseMismatchErr1 = await getRejectionMessage(detectSqlInjection(snapshotB, ingestionA, org));
    const reverseMismatchErr2 = await getRejectionMessage(detectSqlInjection(snapshotB, ingestionA, org));
    expect(reverseMismatchErr1).toBe('M3_ANALYSIS_SNAPSHOT_MISMATCH');
    expect(reverseMismatchErr2).toBe('M3_ANALYSIS_SNAPSHOT_MISMATCH');
    expect(reverseMismatchErr1).toBe(reverseMismatchErr2);
  });

  it('deterministically rejects forged or corrupted ingestion, snapshot, and analysis metadata', async () => {
    const snapshot = await captureSnapshot({
      fixtureId: validFixture,
      repositoryId: validRepo,
      organizationId: org,
      files: [{ path: 'src/app.ts', content: validSourceA }],
    }, org);

    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);
    expect(analysis.status).toBe('DETECTED');
    expect(analysis.findings.length).toBeGreaterThan(0);

    const tamperedSnapshot = { ...snapshot, totalBytes: snapshot.totalBytes + 1 };
    const snapErr1 = await getRejectionMessage(validateSnapshot(tamperedSnapshot, org));
    const snapErr2 = await getRejectionMessage(validateSnapshot(tamperedSnapshot, org));
    expect(snapErr1).toBe('M2_INGESTION_ERROR: snapshot integrity mismatch');
    expect(snapErr2).toBe('M2_INGESTION_ERROR: snapshot integrity mismatch');
    expect(snapErr1).toBe(snapErr2);

    const corruptedIngestion = {
      ...ingestion,
      ingestionIdentity: 'sha256:' + 'f'.repeat(64),
    };
    const ingErr1 = await getRejectionMessage(validateExpressIngestion(corruptedIngestion, org));
    const ingErr2 = await getRejectionMessage(validateExpressIngestion(corruptedIngestion, org));
    expect(ingErr1).toBe('M2_INGESTION_ERROR: ingestion metadata mismatch');
    expect(ingErr2).toBe('M2_INGESTION_ERROR: ingestion metadata mismatch');
    expect(ingErr1).toBe(ingErr2);

    const tamperedAnalysis = {
      ...analysis,
      status: 'NOT_DETECTED',
    };
    const anaErr1 = await getRejectionMessage(validateSqlAnalysis(tamperedAnalysis, snapshot, ingestion, org));
    const anaErr2 = await getRejectionMessage(validateSqlAnalysis(tamperedAnalysis, snapshot, ingestion, org));
    expect(anaErr1).toBe('M3_ANALYSIS_INTEGRITY_MISMATCH');
    expect(anaErr2).toBe('M3_ANALYSIS_INTEGRITY_MISMATCH');
    expect(anaErr1).toBe(anaErr2);
  });

  it('deterministically rejects malformed commit authority and preserves candidate non-authoritative boundary', async () => {
    const snapshot = await captureSnapshot({
      fixtureId: validFixture,
      repositoryId: validRepo,
      organizationId: org,
      files: [{ path: 'src/app.ts', content: validSourceA }],
    }, org);

    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);
    expect(analysis.status).toBe('DETECTED');

    const malformedCommitCallbacks = [
      () => Promise.resolve('0'.repeat(40)),
      () => Promise.resolve('not-a-valid-hex-commit-sha-value!'),
      () => Promise.resolve('1234abcd'),
      () => Promise.resolve(''),
    ];

    for (const badCallback of malformedCommitCallbacks) {
      const bridge = createSqlCandidateBridge(badCallback);
      const commitErr1 = await getRejectionMessage(bridge(analysis, snapshot, ingestion, org));
      const commitErr2 = await getRejectionMessage(bridge(analysis, snapshot, ingestion, org));
      expect(commitErr1).toBe('M3_CHECKED_COMMIT_REQUIRED');
      expect(commitErr2).toBe('M3_CHECKED_COMMIT_REQUIRED');
      expect(commitErr1).toBe(commitErr2);
    }

    const genuineCommitSha = 'a'.repeat(40);
    const validBridge = createSqlCandidateBridge(async () => genuineCommitSha);
    const hypotheses = await validBridge(analysis, snapshot, ingestion, org);

    expect(hypotheses.length).toBeGreaterThan(0);
    for (const h of hypotheses) {
      expect(h.candidate.verificationState).toBe('CANDIDATE');
      expect((h.candidate as any).verificationState).not.toBe('VERIFIED');
      expect(h.candidate.reachabilityState).toBe('REACHABLE');
      expect(h.candidate.snapshot.commitSha).toBe(genuineCommitSha);
      expect(typeof h.candidateBinding).toBe('string');
      expect(h.candidateBinding.length).toBeGreaterThan(0);
    }
  });
});
