import { describe, it, expect } from 'vitest';
import {
  captureSnapshot,
  validateSnapshot,
  detachJson,
  canonical,
  hash,
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

describe('Pipeline Determinism: Null and Empty Boundary in Nested Structures', () => {
  const orgId = 'org_pdet_empty_nest';
  const repoId = 'repo_nested_det';
  const fixtureId = 'm2-case-001';
  const dummyCommitSha = 'a'.repeat(40);

  const nestedAppSource = `import express from 'express';

export function createApp(db) {
  const app = express();
  const rootRouter = express.Router();
  const apiRouter = express.Router();

  function statusHandler(req, res) {
    const stmt = db.prepare('SELECT 1');
    res.json(stmt.all());
  }

  function userHandler(req, res) {
    const query = req.query.id;
    const sql = 'SELECT * FROM users WHERE id = ' + query;
    const stmt = db.prepare(sql);
    res.json(stmt.all());
  }

  rootRouter.get('/status', statusHandler);
  apiRouter.get('/user', userHandler);

  app.use('/', rootRouter);
  app.use('/api', apiRouter);

  return app;
}
`;

  const cleanNestedAppSource = `import express from 'express';

export function createApp(db) {
  const app = express();
  const rootRouter = express.Router();

  function statusHandler(req, res) {
    const stmt = db.prepare('SELECT 1');
    res.json(stmt.all());
  }

  rootRouter.get('/status', statusHandler);
  app.use('/', rootRouter);

  return app;
}
`;

  it('preserves determinism across nested router mounts and empty prefix boundary', async () => {
    const files = [{ path: 'src/nested/app.ts', content: nestedAppSource }];

    const snap1 = await captureSnapshot({ fixtureId, repositoryId: repoId, organizationId: orgId, files }, orgId);
    const snap2 = await captureSnapshot({ fixtureId, repositoryId: repoId, organizationId: orgId, files }, orgId);

    expect(snap1.snapshotId).toBe(snap2.snapshotId);
    expect(snap1.files[0].fileIdentity).toBe(snap2.files[0].fileIdentity);

    const ing1 = await ingestExpress(snap1, orgId);
    const ing2 = await ingestExpress(snap2, orgId);

    expect(ing1.ingestionIdentity).toBe(ing2.ingestionIdentity);
    expect(ing1.routes.length).toBe(2);

    const rootRoute = ing1.routes.find((r) => r.path === '/status');
    expect(rootRoute).toBeDefined();
    expect(rootRoute?.declaredPath).toBe('/status');
    expect(rootRoute?.mount?.prefix).toBe('/');

    const nestedRoute = ing1.routes.find((r) => r.path === '/api/user');
    expect(nestedRoute).toBeDefined();
    expect(nestedRoute?.declaredPath).toBe('/user');
    expect(nestedRoute?.mount?.prefix).toBe('/api');

    const analysis1 = await detectSqlInjection(snap1, ing1, orgId);
    const analysis2 = await detectSqlInjection(snap2, ing2, orgId);

    expect(analysis1.resultFingerprint).toBe(analysis2.resultFingerprint);
    expect(analysis1.status).toBe('DETECTED');
    expect(analysis1.findings.length).toBe(1);
    expect(analysis1.findings[0].routeIdentity).toBe(nestedRoute?.routeIdentity);
  });

  it('yields empty candidate hypotheses for clean nested routes with empty flow', async () => {
    const files = [{ path: 'src/nested/cleanApp.ts', content: cleanNestedAppSource }];

    const snap = await captureSnapshot({ fixtureId, repositoryId: repoId, organizationId: orgId, files }, orgId);
    const ing = await ingestExpress(snap, orgId);
    const analysis = await detectSqlInjection(snap, ing, orgId);

    expect(analysis.status).toBe('NOT_DETECTED');
    expect(analysis.findings.length).toBe(0);
    expect(analysis.limitations.length).toBe(0);

    const bridge = createSqlCandidateBridge(async () => dummyCommitSha);
    const candidates = await bridge(analysis, snap, ing, orgId);

    expect(candidates).toEqual([]);
    expect(Object.isFrozen(candidates)).toBe(true);
  });

  it('ensures candidate bridge preserves non-authoritative candidate boundary and determinism', async () => {
    const files = [{ path: 'src/nested/app.ts', content: nestedAppSource }];

    const snap = await captureSnapshot({ fixtureId, repositoryId: repoId, organizationId: orgId, files }, orgId);
    const ing = await ingestExpress(snap, orgId);
    const analysis = await detectSqlInjection(snap, ing, orgId);

    const bridge = createSqlCandidateBridge(async () => dummyCommitSha);
    const candidates1 = await bridge(analysis, snap, ing, orgId);
    const candidates2 = await bridge(analysis, snap, ing, orgId);

    expect(candidates1.length).toBe(1);
    expect(candidates1[0].candidateBinding).toBe(candidates2[0].candidateBinding);
    expect(candidates1[0].candidate.candidateId).toBe(candidates2[0].candidate.candidateId);

    expect(candidates1[0].candidate.verificationState).toBe('CANDIDATE');
    expect((candidates1[0].candidate.verificationState as string)).not.toBe('VERIFIED');
    expect(candidates1[0].candidate.reachabilityState).toBe('REACHABLE');
  });

  it('fails closed on null or invalid commit identity in candidate bridge', async () => {
    const files = [{ path: 'src/nested/app.ts', content: nestedAppSource }];

    const snap = await captureSnapshot({ fixtureId, repositoryId: repoId, organizationId: orgId, files }, orgId);
    const ing = await ingestExpress(snap, orgId);
    const analysis = await detectSqlInjection(snap, ing, orgId);

    const zeroBridge = createSqlCandidateBridge(async () => '0'.repeat(40));
    await expect(zeroBridge(analysis, snap, ing, orgId)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const emptyBridge = createSqlCandidateBridge(async () => '');
    await expect(emptyBridge(analysis, snap, ing, orgId)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
  });

  it('validates detached JSON determinism across nested null and empty boundaries', () => {
    const nestedA = {
      zKey: 'terminal',
      aNested: {
        emptyList: [],
        emptyMap: {},
        nullValue: null,
        emptyStr: '',
        bSub: {
          flag: false,
          num: 0,
        },
      },
    };

    const nestedB = {
      aNested: {
        bSub: {
          num: 0,
          flag: false,
        },
        emptyStr: '',
        nullValue: null,
        emptyMap: {},
        emptyList: [],
      },
      zKey: 'terminal',
    };

    const detachedA = detachJson(nestedA);
    const detachedB = detachJson(nestedB);

    expect(canonical(detachedA)).toBe(canonical(detachedB));
    expect(detachedA.aNested.nullValue).toBeNull();
    expect(detachedA.aNested.emptyStr).toBe('');
    expect(detachedA.aNested.emptyList).toEqual([]);
    expect(detachedA.aNested.emptyMap).toEqual({});

    expect(() => detachJson({ badNum: -0 })).toThrow('non-JSON metadata');
    expect(() => detachJson(Object.create(null))).toThrow('plain object required');

    let deepValid: any = 'leaf';
    for (let i = 0; i < 16; i++) {
      deepValid = { next: deepValid };
    }
    expect(detachJson(deepValid)).toBeDefined();

    let deepTooDeep: any = 'leaf';
    for (let i = 0; i < 17; i++) {
      deepTooDeep = { next: deepTooDeep };
    }
    expect(() => detachJson(deepTooDeep)).toThrow('metadata complexity');
  });

  it('rejects empty files array and malformed nested path segments in snapshot capture', async () => {
    await expect(
      captureSnapshot({ fixtureId, repositoryId: repoId, organizationId: orgId, files: [] }, orgId),
    ).rejects.toThrow('array bounds or shape');

    await expect(
      captureSnapshot(
        {
          fixtureId,
          repositoryId: repoId,
          organizationId: orgId,
          files: [{ path: 'src//app.ts', content: 'export const x = 1;' }],
        },
        orgId,
      ),
    ).rejects.toThrow('path component');

    await expect(
      captureSnapshot(
        {
          fixtureId,
          repositoryId: repoId,
          organizationId: orgId,
          files: [{ path: 'src/nested/../app.ts', content: 'export const x = 1;' }],
        },
        orgId,
      ),
    ).rejects.toThrow('path component');
  });
});
