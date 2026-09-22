import { describe, it, expect } from 'vitest';
import {
  captureSnapshot,
  detachJson,
} from '../../../../worker/intelligence/ingestion/snapshot';
import {
  ingestExpress,
} from '../../../../worker/intelligence/ingestion/express';
import {
  detectSqlInjection,
  validateSqlAnalysis,
} from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';

describe('Pipeline Determinism: Malformed Nested Input (RM_PDET_MAL_NEST)', () => {
  const org = 'org_velnar_pdet_mal_nest';
  const repo = 'repo-pdet-mal-nest';

  it('deterministically rejects nested router mounted onto router across sequential and concurrent runs', async () => {
    const routerOnRouterCode = `import express from 'express';

function handleItem(req: any, res: any) {
  res.json([]);
}

export function createApp(db: any) {
  const app = express();
  const apiRouter = express.Router();
  const subRouter = express.Router();
  subRouter.get('/items', handleItem);
  apiRouter.use('/sub', subRouter);
  app.use('/api', apiRouter);
  return app;
}
`;

    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: repo,
        organizationId: org,
        files: [{ path: 'src/routes.ts', content: routerOnRouterCode }],
      },
      org,
    );

    const runIngest = () => ingestExpress(snapshot, org);

    await expect(runIngest()).rejects.toThrow('M2_INGESTION_ERROR: unsupported router mount');

    const results = await Promise.allSettled([
      runIngest(),
      runIngest(),
      runIngest(),
      runIngest(),
    ]);

    for (const res of results) {
      expect(res.status).toBe('rejected');
      if (res.status === 'rejected') {
        expect((res.reason as Error).message).toBe('M2_INGESTION_ERROR: unsupported router mount');
      }
    }
  });

  it('deterministically rejects unmounted nested router instances', async () => {
    const unmountedRouterCode = `import express from 'express';

function handleItem(req: any, res: any) {
  res.json([]);
}

function handleRoot(req: any, res: any) {
  res.json([]);
}

export function createApp(db: any) {
  const app = express();
  const orphanRouter = express.Router();
  orphanRouter.get('/orphan', handleItem);
  app.get('/root', handleRoot);
  return app;
}
`;

    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: repo,
        organizationId: org,
        files: [{ path: 'src/routes.ts', content: unmountedRouterCode }],
      },
      org,
    );

    for (let i = 0; i < 3; i++) {
      await expect(ingestExpress(snapshot, org)).rejects.toThrow(
        'M2_INGESTION_ERROR: unmounted router',
      );
    }
  });

  it('deterministically rejects malformed nested mount path syntax', async () => {
    const malformedMountPathCode = `import express from 'express';

function handleItem(req: any, res: any) {
  res.json([]);
}

export function createApp(db: any) {
  const app = express();
  const router = express.Router();
  router.get('/items', handleItem);
  app.use('/nested//invalid', router);
  return app;
}
`;

    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: repo,
        organizationId: org,
        files: [{ path: 'src/routes.ts', content: malformedMountPathCode }],
      },
      org,
    );

    for (let i = 0; i < 3; i++) {
      await expect(ingestExpress(snapshot, org)).rejects.toThrow(
        'M2_INGESTION_ERROR: literal bounded route path required',
      );
    }
  });

  it('deterministically rejects duplicate router mounts', async () => {
    const duplicateMountCode = `import express from 'express';

function handleItem(req: any, res: any) {
  res.json([]);
}

export function createApp(db: any) {
  const app = express();
  const router = express.Router();
  router.get('/items', handleItem);
  app.use('/v1', router);
  app.use('/v2', router);
  return app;
}
`;

    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: repo,
        organizationId: org,
        files: [{ path: 'src/routes.ts', content: duplicateMountCode }],
      },
      org,
    );

    for (let i = 0; i < 3; i++) {
      await expect(ingestExpress(snapshot, org)).rejects.toThrow(
        'M2_INGESTION_ERROR: unsupported router mount',
      );
    }
  });

  it('deterministically bounds nested call cycle in handler flow to inconclusive analysis without minting authority', async () => {
    const nestedCallCycleCode = `import express from 'express';

function recurseA(val: any): any {
  return recurseB(val);
}

function recurseB(val: any): any {
  return recurseA(val);
}

function handleSearch(req: any, res: any) {
  const input = req.query.keyword;
  const processed = recurseA(input);
  res.json([]);
}

export function createApp(db: any) {
  const app = express();
  const router = express.Router();
  router.get('/search', handleSearch);
  app.use('/api', router);
  return app;
}
`;

    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: repo,
        organizationId: org,
        files: [{ path: 'src/routes.ts', content: nestedCallCycleCode }],
      },
      org,
    );

    const ingestion = await ingestExpress(snapshot, org);
    expect(ingestion.routes).toHaveLength(1);
    expect(ingestion.routes[0].path).toBe('/api/search');

    const analysis1 = await detectSqlInjection(snapshot, ingestion, org);
    const analysis2 = await detectSqlInjection(snapshot, ingestion, org);
    const analysis3 = await detectSqlInjection(snapshot, ingestion, org);

    expect(analysis1.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(analysis1.findings).toHaveLength(0);
    expect(analysis1.limitations.length).toBeGreaterThan(0);
    expect(analysis1.limitations[0].code).toBe('CALL_CYCLE');

    expect(analysis1.resultFingerprint).toBe(analysis2.resultFingerprint);
    expect(analysis2.resultFingerprint).toBe(analysis3.resultFingerprint);

    const validated = await validateSqlAnalysis(analysis1, snapshot, ingestion, org);
    expect(validated.resultFingerprint).toBe(analysis1.resultFingerprint);

    const bridge = createSqlCandidateBridge(async () => 'a'.repeat(40));
    const hypotheses = await bridge(analysis1, snapshot, ingestion, org);
    expect(hypotheses).toEqual([]);
  });

  it('deterministically rejects deep object nesting in detached json metadata', () => {
    let deeplyNested: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < 20; i++) {
      deeplyNested = { child: deeplyNested };
    }

    for (let i = 0; i < 3; i++) {
      expect(() => detachJson(deeplyNested)).toThrow(
        'M2_INGESTION_ERROR: metadata complexity',
      );
    }
  });

  it('deterministically rejects nested relative path traversal in snapshot capture', async () => {
    const traversalInput = {
      fixtureId: 'm2-case-001',
      repositoryId: repo,
      organizationId: org,
      files: [
        {
          path: 'src/routes/nested/../../escape.ts',
          content: 'export const item = 1;\n',
        },
      ],
    };

    for (let i = 0; i < 3; i++) {
      await expect(captureSnapshot(traversalInput, org)).rejects.toThrow(
        'M2_INGESTION_ERROR: path component',
      );
    }
  });
});
