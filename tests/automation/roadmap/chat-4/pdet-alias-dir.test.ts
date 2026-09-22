import { describe, it, expect } from 'vitest';
import { captureSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection } from '../../../../worker/intelligence/detection/sqlInjection';

describe('Pipeline determinism - direct alias propagation', () => {
  it('propagates taint deterministically through direct variable aliasing to SQL injection sink', async () => {
    const org = 'org_pdet_alias_dir';
    const repo = 'repo_pdet_alias_dir';
    const fixtureId = 'm2-case-001';

    const sourceCode = [
      "import express from 'express';",
      '',
      'export function createApp(db: any) {',
      '  const app = express();',
      '',
      '  function handler(req: any, res: any) {',
      '    const rawId = req.query.id;',
      '    const directAlias = rawId;',
      "    const statement = db.prepare('SELECT * FROM users WHERE id = ' + directAlias);",
      '    const rows = statement.all();',
      '    res.json(rows);',
      '  }',
      '',
      "  app.get('/users', handler);",
      '  return app;',
      '}',
      '',
    ].join('\n');

    const input = {
      fixtureId,
      repositoryId: repo,
      organizationId: org,
      files: [
        {
          path: 'src/app.ts',
          content: sourceCode,
        },
      ],
    };

    const snapshotA = await captureSnapshot(input, org);
    const ingestionA = await ingestExpress(snapshotA, org);
    const analysisA = await detectSqlInjection(snapshotA, ingestionA, org);

    const snapshotB = await captureSnapshot(input, org);
    const ingestionB = await ingestExpress(snapshotB, org);
    const analysisB = await detectSqlInjection(snapshotB, ingestionB, org);

    expect(snapshotA.snapshotId).toBe(snapshotB.snapshotId);
    expect(ingestionA.ingestionIdentity).toBe(ingestionB.ingestionIdentity);
    expect(analysisA.resultFingerprint).toBe(analysisB.resultFingerprint);

    expect(analysisA.status).toBe('DETECTED');
    expect(analysisB.status).toBe('DETECTED');

    expect(analysisA.findings.length).toBe(1);
    expect(analysisB.findings.length).toBe(1);

    const findingA = analysisA.findings[0];
    const findingB = analysisB.findings[0];

    expect(findingA).toBeDefined();
    expect(findingB).toBeDefined();

    if (!findingA || !findingB) {
      throw new Error('Expected findings to be defined');
    }

    expect(findingA.findingId).toBe(findingB.findingId);
    expect(findingA.routeIdentity).toBe(findingB.routeIdentity);

    const stepSummary = findingA.flow.map((step) => ({
      kind: step.kind,
      symbol: step.location.symbol,
    }));

    expect(stepSummary).toEqual([
      { kind: 'SOURCE', symbol: 'query.id' },
      { kind: 'VARIABLE', symbol: 'rawId' },
      { kind: 'VARIABLE', symbol: 'directAlias' },
      { kind: 'CONCAT', symbol: '+' },
      { kind: 'SINK', symbol: 'db.prepare' },
    ]);

    expect(findingA.flow).toEqual(findingB.flow);
  });
});
