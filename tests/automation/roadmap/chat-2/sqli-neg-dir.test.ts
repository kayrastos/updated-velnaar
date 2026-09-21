import { describe, expect, it } from 'vitest';
import { detectSqlInjection } from '../../../../worker/intelligence/detection/sqlInjection';
import { captureSnapshot, type SnapshotInput } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress } from '../../../../worker/intelligence/ingestion/express';

const ORG = 'org_test_neg_dir';

function makeInput(sourceCode: string): SnapshotInput {
  return {
    fixtureId: 'm2-case-001',
    repositoryId: 'repo_neg_dir',
    organizationId: ORG,
    files: [
      {
        path: 'src/routes.ts',
        content: sourceCode,
      },
    ],
  };
}

describe('SQL Injection detector negative control: direct patterns', () => {
  it('does not detect SQL injection when query uses parameterized placeholders with constant query', async () => {
    const code = `
import express from 'express';

export function createApp(db: any) {
  const app = express();

  function handler(req: any, res: any) {
    const stmt = db.prepare('SELECT id, name FROM users WHERE id = ?');
    const rows = stmt.all(req.query.id);
    return res.json(rows);
  }

  app.get('/user', handler);
  return app;
}
`;
    const raw = makeInput(code);
    const snapshot = await captureSnapshot(raw, ORG);
    const ingestion = await ingestExpress(snapshot, ORG);
    const result = await detectSqlInjection(snapshot, ingestion, ORG);

    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
  });

  it('does not detect SQL injection when query executes a static string constant without user input', async () => {
    const code = `
import express from 'express';

export function createApp(db: any) {
  const app = express();

  function handler(req: any, res: any) {
    const query = 'SELECT id, status FROM health_check';
    const stmt = db.prepare(query);
    const rows = stmt.all();
    return res.json(rows);
  }

  app.get('/health', handler);
  return app;
}
`;
    const raw = makeInput(code);
    const snapshot = await captureSnapshot(raw, ORG);
    const ingestion = await ingestExpress(snapshot, ORG);
    const result = await detectSqlInjection(snapshot, ingestion, ORG);

    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
  });

  it('does not detect SQL injection when constant concatenation does not involve request data', async () => {
    const code = `
import express from 'express';

export function createApp(db: any) {
  const app = express();

  function handler(req: any, res: any) {
    const table = 'users';
    const base = 'SELECT count(*) FROM ' + table;
    const stmt = db.prepare(base);
    const rows = stmt.all();
    return res.json(rows);
  }

  app.get('/count', handler);
  return app;
}
`;
    const raw = makeInput(code);
    const snapshot = await captureSnapshot(raw, ORG);
    const ingestion = await ingestExpress(snapshot, ORG);
    const result = await detectSqlInjection(snapshot, ingestion, ORG);

    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
  });
});
