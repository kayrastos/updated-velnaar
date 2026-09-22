import { describe, it, expect } from 'vitest';
import { captureSnapshot, validateSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress, validateExpressIngestion } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';

const org = 'org_pdet_mal_cross';
const repoId = 'repo-pdet-mal-cross';
const fixtureId = 'm2-case-001';

describe('Pipeline Determinism: Malformed Input: Cross-File', () => {
  it('deterministically yields ANALYSIS_INCONCLUSIVE with IMPORT_CYCLE on circular cross-file dependencies', async () => {
    const appCode = [
      "import express from 'express';",
      "import { helperB } from './helper';",
      '',
      'export function createApp(db: any) {',
      '  const app = express();',
      '  function handler(req: any, res: any) {',
      '    const q = req.query.id;',
      '    const r = helperB(q);',
      "    const stmt = db.prepare('SELECT * FROM users WHERE id = ' + r);",
      '    res.json(stmt.all());',
      '  }',
      "  app.get('/users', handler);",
      '  return app;',
      '}',
      '',
      'export function helperA(val: any) {',
      '  return helperB(val);',
      '}',
      '',
    ].join('\n');

    const helperCode = [
      "import { helperA } from './app';",
      '',
      'export function helperB(val: any) {',
      '  return helperA(val);',
      '}',
      '',
    ].join('\n');

    const files = [
      { path: 'src/app.ts', content: appCode },
      { path: 'src/helper.ts', content: helperCode },
    ];

    const snapshot1 = await captureSnapshot({ fixtureId, repositoryId: repoId, organizationId: org, files }, org);
    const snapshot2 = await captureSnapshot({ fixtureId, repositoryId: repoId, organizationId: org, files }, org);
    expect(snapshot1.snapshotId).toBe(snapshot2.snapshotId);

    const ingestion1 = await ingestExpress(snapshot1, org);
    const ingestion2 = await ingestExpress(snapshot2, org);
    expect(ingestion1.ingestionIdentity).toBe(ingestion2.ingestionIdentity);
    expect(ingestion1.routes).toHaveLength(1);

    const analysis1 = await detectSqlInjection(snapshot1, ingestion1, org);
    const analysis2 = await detectSqlInjection(snapshot2, ingestion2, org);

    expect(analysis1.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(analysis2.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(analysis1.resultFingerprint).toBe(analysis2.resultFingerprint);
    expect(analysis1.findings).toHaveLength(0);
    expect(analysis2.findings).toHaveLength(0);
    expect(analysis1.limitations).toEqual([{ code: 'IMPORT_CYCLE', location: null }]);
    expect(analysis2.limitations).toEqual([{ code: 'IMPORT_CYCLE', location: null }]);

    const verifiedAnalysis = await validateSqlAnalysis(analysis1, snapshot1, ingestion1, org);
    expect(verifiedAnalysis.resultFingerprint).toBe(analysis1.resultFingerprint);

    let verifierCalled = false;
    const bridge = createSqlCandidateBridge(async () => {
      verifierCalled = true;
      return 'a'.repeat(40);
    });

    const candidates = await bridge(analysis1, snapshot1, ingestion1, org);
    expect(candidates).toEqual([]);
    expect(verifierCalled).toBe(false);
  });

  it('deterministically yields ANALYSIS_INCONCLUSIVE with UNSUPPORTED_IMPORT on missing cross-file export', async () => {
    const appCode = [
      "import express from 'express';",
      "import { missingHelper } from './helper';",
      '',
      'export function createApp(db: any) {',
      '  const app = express();',
      '  function handler(req: any, res: any) {',
      '    const q = req.query.id;',
      '    const r = missingHelper(q);',
      "    const stmt = db.prepare('SELECT * FROM users WHERE id = ' + r);",
      '    res.json(stmt.all());',
      '  }',
      "  app.get('/users', handler);",
      '  return app;',
      '}',
      '',
    ].join('\n');

    const helperCode = [
      'export function existingHelper(val: any) {',
      '  return val;',
      '}',
      '',
    ].join('\n');

    const files = [
      { path: 'src/app.ts', content: appCode },
      { path: 'src/helper.ts', content: helperCode },
    ];

    const snapshot = await captureSnapshot({ fixtureId, repositoryId: repoId, organizationId: org, files }, org);
    const ingestion = await ingestExpress(snapshot, org);

    const analysis1 = await detectSqlInjection(snapshot, ingestion, org);
    const analysis2 = await detectSqlInjection(snapshot, ingestion, org);

    expect(analysis1.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(analysis2.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(analysis1.resultFingerprint).toBe(analysis2.resultFingerprint);
    expect(analysis1.findings).toHaveLength(0);
    expect(analysis1.limitations).toEqual([{ code: 'UNSUPPORTED_IMPORT', location: null }]);
    expect(analysis2.limitations).toEqual([{ code: 'UNSUPPORTED_IMPORT', location: null }]);

    const bridge = createSqlCandidateBridge(async () => {
      throw new Error('should not be invoked');
    });
    const candidates = await bridge(analysis1, snapshot, ingestion, org);
    expect(candidates).toEqual([]);
  });

  it('deterministically rejects cross-file directory traversal import at Express ingestion', async () => {
    const files = [
      {
        path: 'src/app.ts',
        content: [
          "import express from 'express';",
          "import { helper } from '../outside';",
          '',
          'export function createApp(db: any) {',
          '  const app = express();',
          '  function handler(req: any, res: any) { res.json([]); }',
          "  app.get('/users', handler);",
          '  return app;',
          '}',
          '',
        ].join('\n'),
      },
      {
        path: 'src/outside.ts',
        content: 'export function helper(v: any) { return v; }\n',
      },
    ];

    const snapshot = await captureSnapshot({ fixtureId, repositoryId: repoId, organizationId: org, files }, org);

    await expect(ingestExpress(snapshot, org)).rejects.toThrow('M2_INGESTION_ERROR: unsupported source import');
    await expect(ingestExpress(snapshot, org)).rejects.toThrow('M2_INGESTION_ERROR: unsupported source import');
  });

  it('deterministically rejects cross-file import pointing to nonexistent module at Express ingestion', async () => {
    const files = [
      {
        path: 'src/app.ts',
        content: [
          "import express from 'express';",
          "import { helper } from './nonexistent';",
          '',
          'export function createApp(db: any) {',
          '  const app = express();',
          '  function handler(req: any, res: any) { res.json([]); }',
          "  app.get('/users', handler);",
          '  return app;',
          '}',
          '',
        ].join('\n'),
      },
    ];

    const snapshot = await captureSnapshot({ fixtureId, repositoryId: repoId, organizationId: org, files }, org);

    await expect(ingestExpress(snapshot, org)).rejects.toThrow('M2_INGESTION_ERROR: missing or ambiguous source import');
    await expect(ingestExpress(snapshot, org)).rejects.toThrow('M2_INGESTION_ERROR: missing or ambiguous source import');
  });

  it('deterministically rejects cross-file imported module containing malformed source syntax at Express ingestion', async () => {
    const files = [
      {
        path: 'src/app.ts',
        content: [
          "import express from 'express';",
          "import { broken } from './broken';",
          '',
          'export function createApp(db: any) {',
          '  const app = express();',
          '  function handler(req: any, res: any) { res.json([]); }',
          "  app.get('/users', handler);",
          '  return app;',
          '}',
          '',
        ].join('\n'),
      },
      {
        path: 'src/broken.ts',
        content: 'export const = ;\n',
      },
    ];

    const snapshot = await captureSnapshot({ fixtureId, repositoryId: repoId, organizationId: org, files }, org);

    await expect(ingestExpress(snapshot, org)).rejects.toThrow('M2_INGESTION_ERROR: malformed source unit');
    await expect(ingestExpress(snapshot, org)).rejects.toThrow('M2_INGESTION_ERROR: malformed source unit');
  });

  it('preserves non-authoritative boundary across repeated runs and structural validations', async () => {
    const files = [
      {
        path: 'src/app.ts',
        content: [
          "import express from 'express';",
          "import { loop } from './cycle';",
          '',
          'export function createApp(db: any) {',
          '  const app = express();',
          '  function handler(req: any, res: any) { res.json(db.prepare(loop(req.query.id)).all()); }',
          "  app.get('/test', handler);",
          '  return app;',
          '}',
          'export function ping(v: any) { return loop(v); }',
          '',
        ].join('\n'),
      },
      {
        path: 'src/cycle.ts',
        content: [
          "import { ping } from './app';",
          'export function loop(v: any) { return ping(v); }',
          '',
        ].join('\n'),
      },
    ];

    const snapshot = await captureSnapshot({ fixtureId, repositoryId: repoId, organizationId: org, files }, org);
    const validatedSnapshot = await validateSnapshot(snapshot, org);
    expect(validatedSnapshot.snapshotId).toBe(snapshot.snapshotId);

    const ingestion = await ingestExpress(snapshot, org);
    const validatedIngestion = await validateExpressIngestion(ingestion, org);
    expect(validatedIngestion.ingestionIdentity).toBe(ingestion.ingestionIdentity);

    const analysis = await detectSqlInjection(snapshot, ingestion, org);
    expect(analysis.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(analysis.findings).toHaveLength(0);
    expect(analysis.limitations).toHaveLength(1);
    expect(analysis.limitations[0].code).toBe('IMPORT_CYCLE');
  });
});
