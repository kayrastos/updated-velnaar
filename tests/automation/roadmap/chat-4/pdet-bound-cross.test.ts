import { describe, it, expect } from 'vitest';
import {
  INGESTION_LIMITS,
  captureSnapshot,
} from '../../../../worker/intelligence/ingestion/snapshot';
import {
  ingestExpress,
} from '../../../../worker/intelligence/ingestion/express';
import {
  detectSqlInjection,
  validateSqlAnalysis,
} from '../../../../worker/intelligence/detection/sqlInjection';
import {
  createSqlCandidateBridge,
} from '../../../../worker/intelligence/detection/candidate';

const org = 'org_test';
const repoId = 'repo_pdet_cross';
const caseId = 'm2-case-001';

describe('Platform Integration - Pipeline Determinism Boundary Rejection (Cross-File)', () => {
  it('rejects cross-file snapshot when cumulative bytes exceed maxSnapshotBytes', async () => {
    const files = [
      { path: 'src/f1.ts', content: 'export const f1 = "' + 'a'.repeat(14000) + '";\n' },
      { path: 'src/f2.ts', content: 'export const f2 = "' + 'b'.repeat(14000) + '";\n' },
      { path: 'src/f3.ts', content: 'export const f3 = "' + 'c'.repeat(14000) + '";\n' },
      { path: 'src/f4.ts', content: 'export const f4 = "' + 'd'.repeat(14000) + '";\n' },
      { path: 'src/f5.ts', content: 'export const f5 = "' + 'e'.repeat(14000) + '";\n' },
    ];
    await expect(
      captureSnapshot({ fixtureId: caseId, repositoryId: repoId, organizationId: org, files }, org),
    ).rejects.toThrow('snapshot size');
  });

  it('rejects cross-file snapshot when file count exceeds maxFiles bound', async () => {
    const files = Array.from({ length: INGESTION_LIMITS.maxFiles + 1 }, (_, i) => ({
      path: `src/mod_${i}.ts`,
      content: `export const val_${i} = ${i};\n`,
    }));
    await expect(
      captureSnapshot({ fixtureId: caseId, repositoryId: repoId, organizationId: org, files }, org),
    ).rejects.toThrow('array bounds or shape');
  });

  it('rejects cross-file case-insensitive canonical path collision', async () => {
    const files = [
      { path: 'src/service.ts', content: 'export const serviceA = 1;\n' },
      { path: 'src/SERVICE.ts', content: 'export const serviceB = 2;\n' },
    ];
    await expect(
      captureSnapshot({ fixtureId: caseId, repositoryId: repoId, organizationId: org, files }, org),
    ).rejects.toThrow('duplicate canonical path');
  });

  it('rejects cross-file relative path escaping with parent directory component', async () => {
    const files = [
      { path: 'src/index.ts', content: 'export const main = true;\n' },
      { path: 'src/../outside.ts', content: 'export const outside = true;\n' },
    ];
    await expect(
      captureSnapshot({ fixtureId: caseId, repositoryId: repoId, organizationId: org, files }, org),
    ).rejects.toThrow('path component');
  });

  it('rejects cross-file import with parent directory traversal in Express ingestion', async () => {
    const files = [
      {
        path: 'src/app.ts',
        content: `import express from 'express';
import { helper } from '../helper';

export function createApp() {
  const app = express();
  function handler(req: any, res: any) {
    return res.json([]);
  }
  app.get('/test', handler);
  return app;
}
`,
      },
      {
        path: 'helper.ts',
        content: 'export function helper() { return 1; }\n',
      },
    ];
    const snapshot = await captureSnapshot({ fixtureId: caseId, repositoryId: repoId, organizationId: org, files }, org);
    await expect(ingestExpress(snapshot, org)).rejects.toThrow('unsupported source import');
  });

  it('rejects cross-file import when target module is absent from snapshot', async () => {
    const files = [
      {
        path: 'src/app.ts',
        content: `import express from 'express';
import { helper } from './missing';

export function createApp() {
  const app = express();
  function handler(req: any, res: any) {
    return res.json([]);
  }
  app.get('/test', handler);
  return app;
}
`,
      },
    ];
    const snapshot = await captureSnapshot({ fixtureId: caseId, repositoryId: repoId, organizationId: org, files }, org);
    await expect(ingestExpress(snapshot, org)).rejects.toThrow('missing or ambiguous source import');
  });

  it('rejects cross-file import when target is ambiguous between .ts and .js', async () => {
    const files = [
      {
        path: 'src/app.ts',
        content: `import express from 'express';
import { helper } from './helper';

export function createApp() {
  const app = express();
  function handler(req: any, res: any) {
    return res.json([]);
  }
  app.get('/test', handler);
  return app;
}
`,
      },
      {
        path: 'src/helper.ts',
        content: 'export function helper() { return 1; }\n',
      },
      {
        path: 'src/helper.js',
        content: 'export function helper() { return 2; }\n',
      },
    ];
    const snapshot = await captureSnapshot({ fixtureId: caseId, repositoryId: repoId, organizationId: org, files }, org);
    await expect(ingestExpress(snapshot, org)).rejects.toThrow('missing or ambiguous source import');
  });

  it('rejects cross-file duplicate route collision across modules', async () => {
    const files = [
      {
        path: 'src/app1.ts',
        content: `import express from 'express';

export function createApp() {
  const app = express();
  function handler1(req: any, res: any) {
    return res.json([]);
  }
  app.get('/items', handler1);
  return app;
}
`,
      },
      {
        path: 'src/app2.ts',
        content: `import express from 'express';

export function createApp() {
  const app = express();
  function handler2(req: any, res: any) {
    return res.json([]);
  }
  app.get('/items', handler2);
  return app;
}
`,
      },
    ];
    const snapshot = await captureSnapshot({ fixtureId: caseId, repositoryId: repoId, organizationId: org, files }, org);
    await expect(ingestExpress(snapshot, org)).rejects.toThrow('ambiguous duplicate route');
  });

  it('rejects cross-file import cycle by setting status to ANALYSIS_INCONCLUSIVE', async () => {
    const files = [
      {
        path: 'src/app.ts',
        content: `import express from 'express';
import { helper } from './helper';

export function appFunc(x: any) {
  return x;
}

export function createApp(db: any) {
  const app = express();
  function handler(req: any, res: any) {
    const val = helper(req.query.id);
    const stmt = db.prepare('SELECT * FROM items WHERE id = ' + val);
    const rows = stmt.all();
    return res.json(rows);
  }
  app.get('/items', handler);
  return app;
}
`,
      },
      {
        path: 'src/helper.ts',
        content: `import { appFunc } from './app';

export function helper(x: any) {
  return appFunc(x);
}
`,
      },
    ];
    const snapshot = await captureSnapshot({ fixtureId: caseId, repositoryId: repoId, organizationId: org, files }, org);
    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);

    expect(analysis.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(analysis.findings).toHaveLength(0);
    expect(analysis.limitations.length).toBeGreaterThan(0);
    expect(analysis.limitations[0].code).toBe('IMPORT_CYCLE');

    const verifyCommit = async () => {
      throw new Error('should not verify commit for inconclusive analysis');
    };
    const bridge = createSqlCandidateBridge(verifyCommit);
    const candidates = await bridge(analysis, snapshot, ingestion, org);
    expect(candidates).toEqual([]);
  });

  it('rejects cross-file non-closure import by setting status to ANALYSIS_INCONCLUSIVE', async () => {
    const files = [
      {
        path: 'src/app.ts',
        content: `import express from 'express';
import { configValue } from './config';

export function createApp(db: any) {
  const app = express();
  function handler(req: any, res: any) {
    const stmt = db.prepare('SELECT * FROM items WHERE active = 1');
    const rows = stmt.all();
    return res.json(rows);
  }
  app.get('/items', handler);
  return app;
}
`,
      },
      {
        path: 'src/config.ts',
        content: 'export const configValue = \'active\';\n',
      },
    ];
    const snapshot = await captureSnapshot({ fixtureId: caseId, repositoryId: repoId, organizationId: org, files }, org);
    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);

    expect(analysis.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(analysis.findings).toHaveLength(0);
    expect(analysis.limitations.length).toBeGreaterThan(0);
    expect(analysis.limitations[0].code).toBe('UNSUPPORTED_IMPORT');
  });

  it('preserves snapshot and ingestion identity regardless of cross-file input ordering', async () => {
    const fileA = {
      path: 'src/app.ts',
      content: `import express from 'express';
import { queryBuilder } from './query';

export function createApp(db: any) {
  const app = express();
  function handler(req: any, res: any) {
    const q = queryBuilder(req.query.id);
    const stmt = db.prepare(q);
    const rows = stmt.all();
    return res.json(rows);
  }
  app.get('/users', handler);
  return app;
}
`,
    };
    const fileB = {
      path: 'src/query.ts',
      content: `export function queryBuilder(id: any) {
  return 'SELECT * FROM users WHERE id = ' + id;
}
`,
    };

    const snap1 = await captureSnapshot(
      { fixtureId: caseId, repositoryId: repoId, organizationId: org, files: [fileA, fileB] },
      org,
    );
    const snap2 = await captureSnapshot(
      { fixtureId: caseId, repositoryId: repoId, organizationId: org, files: [fileB, fileA] },
      org,
    );

    expect(snap1.snapshotId).toBe(snap2.snapshotId);
    expect(snap1.totalBytes).toBe(snap2.totalBytes);
    expect(snap1.files.map(f => f.path)).toEqual(snap2.files.map(f => f.path));

    const ing1 = await ingestExpress(snap1, org);
    const ing2 = await ingestExpress(snap2, org);
    expect(ing1.ingestionIdentity).toBe(ing2.ingestionIdentity);

    const ana1 = await detectSqlInjection(snap1, ing1, org);
    const ana2 = await detectSqlInjection(snap2, ing2, org);
    expect(ana1.status).toBe('DETECTED');
    expect(ana2.status).toBe('DETECTED');
    expect(ana1.resultFingerprint).toBe(ana2.resultFingerprint);
  });

  it('rejects analysis when snapshot identity does not match ingestion snapshot', async () => {
    const file1 = {
      path: 'src/app.ts',
      content: `import express from 'express';

export function createApp(db: any) {
  const app = express();
  function handler(req: any, res: any) {
    return res.json([]);
  }
  app.get('/a', handler);
  return app;
}
`,
    };
    const file2 = {
      path: 'src/app.ts',
      content: `import express from 'express';

export function createApp(db: any) {
  const app = express();
  function handler(req: any, res: any) {
    return res.json([]);
  }
  app.get('/b', handler);
  return app;
}
`,
    };

    const snap1 = await captureSnapshot({ fixtureId: caseId, repositoryId: repoId, organizationId: org, files: [file1] }, org);
    const snap2 = await captureSnapshot({ fixtureId: caseId, repositoryId: repoId, organizationId: org, files: [file2] }, org);
    const ing2 = await ingestExpress(snap2, org);

    await expect(detectSqlInjection(snap1, ing2, org)).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');

    const ing1 = await ingestExpress(snap1, org);
    const ana1 = await detectSqlInjection(snap1, ing1, org);
    const tampered = { ...ana1, resultFingerprint: 'sha256:0000000000000000000000000000000000000000000000000000000000000000' };
    await expect(validateSqlAnalysis(tampered, snap1, ing1, org)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
  });

  it('preserves candidate-only boundary and rejects invalid commit SHA on cross-file detection', async () => {
    const fileA = {
      path: 'src/app.ts',
      content: `import express from 'express';
import { makeQuery } from './query';

export function createApp(db: any) {
  const app = express();
  function handler(req: any, res: any) {
    const sql = makeQuery(req.query.id);
    const stmt = db.prepare(sql);
    const rows = stmt.all();
    return res.json(rows);
  }
  app.get('/items', handler);
  return app;
}
`,
    };
    const fileB = {
      path: 'src/query.ts',
      content: `export function makeQuery(id: any) {
  return 'SELECT * FROM items WHERE id = ' + id;
}
`,
    };

    const snapshot = await captureSnapshot(
      { fixtureId: caseId, repositoryId: repoId, organizationId: org, files: [fileA, fileB] },
      org,
    );
    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);
    expect(analysis.status).toBe('DETECTED');

    const validSha = 'a'.repeat(40);
    const bridgeValid = createSqlCandidateBridge(async () => validSha);
    const candidates = await bridgeValid(analysis, snapshot, ingestion, org);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].candidate.verificationState).toBe('CANDIDATE');
    expect(candidates[0].candidate.snapshot.commitSha).toBe(validSha);

    const bridgeZeroSha = createSqlCandidateBridge(async () => '0'.repeat(40));
    await expect(bridgeZeroSha(analysis, snapshot, ingestion, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
  });
});
