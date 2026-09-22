import { describe, it, expect } from 'vitest';
import {
  captureSnapshot,
  validateSnapshot,
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

describe('V1 Pipeline Determinism: Adversarial Edge Cases Across Files (RM_PDET_ADV_CROSS)', () => {
  const org = 'org_chat4_adv';
  const repo = 'repo_pdet_adv_cross';
  const fixture = 'm2-case-001';
  const validCommitSha = 'a'.repeat(40);

  const appFile = {
    path: 'src/app.ts',
    content: `import express from 'express';
import { buildQuery } from './helper';

export function createApp(db: any) {
  const app = express();
  function getUser(req: any, res: any) {
    const id = req.query.id;
    const sql = buildQuery(id);
    const stmt = db.prepare(sql);
    const rows = stmt.all();
    res.json(rows);
  }
  app.get('/users', getUser);
  return app;
}
`,
  };

  const helperFile = {
    path: 'src/helper.ts',
    content: `export function buildQuery(query: any) {
  const prefix = 'SELECT * FROM users WHERE id = ';
  const sql = prefix + query;
  return sql;
}
`,
  };

  it('preserves snapshot, ingestion, and analysis determinism regardless of input file ordering', async () => {
    const forwardSnapshot = await captureSnapshot(
      {
        fixtureId: fixture,
        repositoryId: repo,
        organizationId: org,
        files: [helperFile, appFile],
      },
      org,
    );

    const reversedSnapshot = await captureSnapshot(
      {
        fixtureId: fixture,
        repositoryId: repo,
        organizationId: org,
        files: [appFile, helperFile],
      },
      org,
    );

    expect(forwardSnapshot.snapshotId).toBe(reversedSnapshot.snapshotId);
    expect(forwardSnapshot.totalBytes).toBe(reversedSnapshot.totalBytes);
    expect(forwardSnapshot.files.map((f) => f.path)).toEqual([
      'src/app.ts',
      'src/helper.ts',
    ]);

    const forwardIngestion = await ingestExpress(forwardSnapshot, org);
    const reversedIngestion = await ingestExpress(reversedSnapshot, org);

    expect(forwardIngestion.ingestionIdentity).toBe(
      reversedIngestion.ingestionIdentity,
    );
    expect(forwardIngestion.routes).toHaveLength(1);
    expect(forwardIngestion.routes[0].routeIdentity).toBe(
      reversedIngestion.routes[0].routeIdentity,
    );

    const forwardAnalysis = await detectSqlInjection(
      forwardSnapshot,
      forwardIngestion,
      org,
    );
    const reversedAnalysis = await detectSqlInjection(
      reversedSnapshot,
      reversedIngestion,
      org,
    );

    expect(forwardAnalysis.status).toBe('DETECTED');
    expect(reversedAnalysis.status).toBe('DETECTED');
    expect(forwardAnalysis.resultFingerprint).toBe(
      reversedAnalysis.resultFingerprint,
    );
    expect(forwardAnalysis.findings).toHaveLength(1);
    expect(forwardAnalysis.findings[0].findingId).toBe(
      reversedAnalysis.findings[0].findingId,
    );

    const validatedSnapshot = await validateSnapshot(forwardSnapshot, org);
    expect(validatedSnapshot.snapshotId).toBe(forwardSnapshot.snapshotId);

    const validatedIngestion = await validateExpressIngestion(
      forwardIngestion,
      org,
    );
    expect(validatedIngestion.ingestionIdentity).toBe(
      forwardIngestion.ingestionIdentity,
    );

    const validatedAnalysis = await validateSqlAnalysis(
      forwardAnalysis,
      forwardSnapshot,
      forwardIngestion,
      org,
    );
    expect(validatedAnalysis.resultFingerprint).toBe(
      forwardAnalysis.resultFingerprint,
    );
  });

  it('fails closed to ANALYSIS_INCONCLUSIVE on adversarial cross-file circular imports deterministically', async () => {
    const cycleA = {
      path: 'src/app.ts',
      content: `import express from 'express';
import { helperB } from './b';

export function helperA(x: any) {
  return helperB(x);
}

export function createApp(db: any) {
  const app = express();
  function getRoute(req: any, res: any) {
    const q = req.query.id;
    const sql = helperB(q);
    const stmt = db.prepare(sql);
    const rows = stmt.all();
    res.json(rows);
  }
  app.get('/cycle', getRoute);
  return app;
}
`,
    };

    const cycleB = {
      path: 'src/b.ts',
      content: `import { helperA } from './app';

export function helperB(y: any) {
  return helperA(y);
}
`,
    };

    const snapshot = await captureSnapshot(
      {
        fixtureId: fixture,
        repositoryId: repo,
        organizationId: org,
        files: [cycleA, cycleB],
      },
      org,
    );

    const ingestion = await ingestExpress(snapshot, org);
    const analysis1 = await detectSqlInjection(snapshot, ingestion, org);
    const analysis2 = await detectSqlInjection(snapshot, ingestion, org);

    expect(analysis1.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(analysis2.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(analysis1.findings).toHaveLength(0);
    expect(analysis1.limitations).toHaveLength(1);
    expect(analysis1.limitations[0].code).toBe('IMPORT_CYCLE');
    expect(analysis1.resultFingerprint).toBe(analysis2.resultFingerprint);

    const bridge = createSqlCandidateBridge(async () => validCommitSha);
    const candidates = await bridge(analysis1, snapshot, ingestion, org);
    expect(candidates).toHaveLength(0);
  });

  it('refuses adversarial path traversal imports in cross-file resolution', async () => {
    const traversalApp = {
      path: 'src/app.ts',
      content: `import express from 'express';
import { helper } from '../outside';

export function createApp(db: any) {
  const app = express();
  function getRoute(req: any, res: any) {
    res.json(db.prepare('SELECT 1').all());
  }
  app.get('/safe', getRoute);
  return app;
}
`,
    };

    const snapshot = await captureSnapshot(
      {
        fixtureId: fixture,
        repositoryId: repo,
        organizationId: org,
        files: [traversalApp],
      },
      org,
    );

    await expect(ingestExpress(snapshot, org)).rejects.toThrow(
      'unsupported source import',
    );
  });

  it('fails closed to ANALYSIS_INCONCLUSIVE when multiple taint sources join across files', async () => {
    const multiSourceHelper = {
      path: 'src/joiner.ts',
      content: `export function combine(a: any, b: any) {
  const mid = ' AND user = ';
  const part = a + mid;
  const res = part + b;
  return res;
}
`,
    };

    const multiSourceApp = {
      path: 'src/app.ts',
      content: `import express from 'express';
import { combine } from './joiner';

export function createApp(db: any) {
  const app = express();
  function search(req: any, res: any) {
    const q1 = req.query.id;
    const q2 = req.query.user;
    const sql = combine(q1, q2);
    const stmt = db.prepare(sql);
    const rows = stmt.all();
    res.json(rows);
  }
  app.get('/search', search);
  return app;
}
`,
    };

    const snapshot = await captureSnapshot(
      {
        fixtureId: fixture,
        repositoryId: repo,
        organizationId: org,
        files: [multiSourceHelper, multiSourceApp],
      },
      org,
    );

    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);

    expect(analysis.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(analysis.findings).toHaveLength(0);
    expect(analysis.limitations).toHaveLength(1);
    expect(analysis.limitations[0].code).toBe('MULTIPLE_SOURCES');
  });

  it('preserves bounded candidate authority rules and rejects invalid commit verification', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId: fixture,
        repositoryId: repo,
        organizationId: org,
        files: [helperFile, appFile],
      },
      org,
    );
    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);

    expect(analysis.status).toBe('DETECTED');

    const genuineBridge = createSqlCandidateBridge(async () => validCommitSha);
    const hypotheses = await genuineBridge(analysis, snapshot, ingestion, org);

    expect(hypotheses).toHaveLength(1);
    expect(hypotheses[0].candidate.verificationState).toBe('CANDIDATE');
    expect((hypotheses[0].candidate as any).verificationState).not.toBe(
      'VERIFIED',
    );
    expect(hypotheses[0].candidateBinding).toBeDefined();

    const forgedShaBridge = createSqlCandidateBridge(async () => '0'.repeat(40));
    await expect(
      forgedShaBridge(analysis, snapshot, ingestion, org),
    ).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
  });
});
