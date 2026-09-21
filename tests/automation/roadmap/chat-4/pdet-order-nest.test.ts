import { describe, it, expect } from 'vitest';
import { captureSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection } from '../../../../worker/intelligence/detection/sqlInjection';

const orgId = 'org_pdet_order_nest';

function createNestedSource(order: 'forward' | 'reverse'): string {
  const helpers =
    order === 'forward'
      ? [
          '  function innerStep(val: any): any {',
          '    return val;',
          '  }',
          '  function outerStep(input: any): any {',
          '    return innerStep(input);',
          '  }',
        ].join('\n')
      : [
          '  function outerStep(input: any): any {',
          '    return innerStep(input);',
          '  }',
          '  function innerStep(val: any): any {',
          '    return val;',
          '  }',
        ].join('\n');

  return [
    "import express from 'express';",
    '',
    'export function createApp(db: any) {',
    '  const app = express();',
    helpers,
    '  function searchHandler(req: any, res: any) {',
    '    const term = req.query.term;',
    '    const validated = outerStep(term);',
    "    const sql = 'SELECT * FROM products WHERE name = ' + validated;",
    '    const stmt = db.prepare(sql);',
    '    const rows = stmt.all();',
    '    res.json(rows);',
    '  }',
    "  app.get('/search', searchHandler);",
    '  return app;',
    '}',
    '',
  ].join('\n');
}

function createMultiRouteSource(): string {
  return [
    "import express from 'express';",
    '',
    'export function createApp(db: any) {',
    '  const app = express();',
    '  function innerStep(val: any): any {',
    '    return val;',
    '  }',
    '  function outerStep(input: any): any {',
    '    return innerStep(input);',
    '  }',
    '  function firstHandler(req: any, res: any) {',
    '    const term = req.query.term;',
    '    const validated = outerStep(term);',
    "    const sql = 'SELECT * FROM products WHERE name = ' + validated;",
    '    const stmt = db.prepare(sql);',
    '    const rows = stmt.all();',
    '    res.json(rows);',
    '  }',
    '  function secondHandler(req: any, res: any) {',
    '    const id = req.query.id;',
    '    const validated = outerStep(id);',
    "    const sql = 'SELECT * FROM users WHERE id = ' + validated;",
    '    const stmt = db.prepare(sql);',
    '    const rows = stmt.all();',
    '    res.json(rows);',
    '  }',
    "  app.get('/first', firstHandler);",
    "  app.get('/second', secondHandler);",
    '  return app;',
    '}',
    '',
  ].join('\n');
}

describe('Pipeline Determinism - Order Stability Nested', () => {
  it('preserves analysis findings across nested helper declaration ordering', async () => {
    const codeForward = createNestedSource('forward');
    const codeReverse = createNestedSource('reverse');

    const snapshotForward = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-nest-fwd',
        organizationId: orgId,
        files: [{ path: 'src/app.ts', content: codeForward }],
      },
      orgId,
    );

    const snapshotReverse = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-nest-rev',
        organizationId: orgId,
        files: [{ path: 'src/app.ts', content: codeReverse }],
      },
      orgId,
    );

    const ingestionForward = await ingestExpress(snapshotForward, orgId);
    const ingestionReverse = await ingestExpress(snapshotReverse, orgId);

    expect(ingestionForward.routes.length).toBe(1);
    expect(ingestionReverse.routes.length).toBe(1);

    const analysisForward = await detectSqlInjection(snapshotForward, ingestionForward, orgId);
    const analysisReverse = await detectSqlInjection(snapshotReverse, ingestionReverse, orgId);

    expect(analysisForward.status).toBe('DETECTED');
    expect(analysisReverse.status).toBe('DETECTED');

    const findingForward = analysisForward.findings[0];
    const findingReverse = analysisReverse.findings[0];

    expect(findingForward).toBeDefined();
    expect(findingReverse).toBeDefined();
    if (!findingForward || !findingReverse) {
      throw new Error('findings missing');
    }

    expect(findingForward.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(findingReverse.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(findingForward.source.symbol).toBe(findingReverse.source.symbol);
    expect(findingForward.sink.symbol).toBe(findingReverse.sink.symbol);
  });

  it('guarantees bitwise determinism on repeated pipeline execution with nested closures', async () => {
    const code = createNestedSource('forward');

    const run1Snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-nest-det',
        organizationId: orgId,
        files: [{ path: 'src/app.ts', content: code }],
      },
      orgId,
    );

    const run2Snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-nest-det',
        organizationId: orgId,
        files: [{ path: 'src/app.ts', content: code }],
      },
      orgId,
    );

    expect(run1Snapshot.snapshotId).toBe(run2Snapshot.snapshotId);

    const run1Ingestion = await ingestExpress(run1Snapshot, orgId);
    const run2Ingestion = await ingestExpress(run2Snapshot, orgId);

    expect(run1Ingestion.ingestionIdentity).toBe(run2Ingestion.ingestionIdentity);

    const run1Analysis = await detectSqlInjection(run1Snapshot, run1Ingestion, orgId);
    const run2Analysis = await detectSqlInjection(run2Snapshot, run2Ingestion, orgId);

    expect(run1Analysis.resultFingerprint).toBe(run2Analysis.resultFingerprint);
    expect(run1Analysis.findings.length).toBe(run2Analysis.findings.length);

    const finding1 = run1Analysis.findings[0];
    const finding2 = run2Analysis.findings[0];

    expect(finding1).toBeDefined();
    expect(finding2).toBeDefined();
    if (!finding1 || !finding2) {
      throw new Error('findings missing');
    }

    expect(finding1.findingId).toBe(finding2.findingId);
  });

  it('maintains deterministic route finding order when multiple routes use nested helpers', async () => {
    const code = createMultiRouteSource();

    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-nest-multi',
        organizationId: orgId,
        files: [{ path: 'src/app.ts', content: code }],
      },
      orgId,
    );

    const ingestion = await ingestExpress(snapshot, orgId);
    expect(ingestion.routes.length).toBe(2);

    const route0 = ingestion.routes[0];
    const route1 = ingestion.routes[1];

    expect(route0).toBeDefined();
    expect(route1).toBeDefined();
    if (!route0 || !route1) {
      throw new Error('routes missing');
    }

    expect(route0.path).toBe('/first');
    expect(route1.path).toBe('/second');

    const analysis = await detectSqlInjection(snapshot, ingestion, orgId);
    expect(analysis.status).toBe('DETECTED');
    expect(analysis.findings.length).toBe(2);

    const finding0 = analysis.findings[0];
    const finding1 = analysis.findings[1];

    expect(finding0).toBeDefined();
    expect(finding1).toBeDefined();
    if (!finding0 || !finding1) {
      throw new Error('findings missing');
    }

    expect(finding0.routeIdentity).toBe(route0.routeIdentity);
    expect(finding1.routeIdentity).toBe(route1.routeIdentity);
  });
});
