import { describe, it, expect } from 'vitest';
import { captureSnapshot, validateSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress, validateExpressIngestion, resolveImport } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';

const org = 'org_case_cross';

const querySource = `export function buildQuery(param: any) {
  return "SELECT * FROM users WHERE id = '" + param;
}
`;

const appExactSource = `import express from 'express';
import { buildQuery } from './query';

export function createApp(db: any) {
  const app = express();
  function userHandler(req: any, res: any) {
    const id = req.query.id;
    const sql = buildQuery(id);
    const statement = db.prepare(sql);
    const rows = statement.all();
    res.json(rows);
  }
  app.get('/users', userHandler);
  return app;
}
`;

const appSymbolCaseMismatchSource = `import express from 'express';
import { BuildQuery } from './query';

export function createApp(db: any) {
  const app = express();
  function userHandler(req: any, res: any) {
    const id = req.query.id;
    const sql = BuildQuery(id);
    const statement = db.prepare(sql);
    const rows = statement.all();
    res.json(rows);
  }
  app.get('/users', userHandler);
  return app;
}
`;

const appFileCaseMismatchSource = `import express from 'express';
import { buildQuery } from './Query';

export function createApp(db: any) {
  const app = express();
  function userHandler(req: any, res: any) {
    const id = req.query.id;
    const sql = buildQuery(id);
    const statement = db.prepare(sql);
    const rows = statement.all();
    res.json(rows);
  }
  app.get('/users', userHandler);
  return app;
}
`;

describe('V1 Pipeline Determinism: Cross-File Case Sensitivity', () => {
  it('enforces exact case matching in cross-file import specifiers and rejects case-drifted paths', async () => {
    const knownPaths = ['src/app.ts', 'src/query.ts'];

    expect(resolveImport('src/app.ts', './query', knownPaths)).toBe('src/query.ts');
    expect(() => resolveImport('src/app.ts', './Query', knownPaths)).toThrow('missing or ambiguous source import');
    expect(() => resolveImport('src/app.ts', './QUERY', knownPaths)).toThrow('missing or ambiguous source import');

    const mismatchedSnapshot = await captureSnapshot({
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-case-path-mismatch',
      organizationId: org,
      files: [
        { path: 'src/app.ts', content: appFileCaseMismatchSource },
        { path: 'src/query.ts', content: querySource },
      ],
    }, org);

    await expect(ingestExpress(mismatchedSnapshot, org)).rejects.toThrow('missing or ambiguous source import');
  });

  it('enforces case-sensitive symbol resolution across files and records analysis limitation on mismatch', async () => {
    const symbolMismatchSnapshot = await captureSnapshot({
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-case-symbol-mismatch',
      organizationId: org,
      files: [
        { path: 'src/app.ts', content: appSymbolCaseMismatchSource },
        { path: 'src/query.ts', content: querySource },
      ],
    }, org);

    const ingestion = await ingestExpress(symbolMismatchSnapshot, org);
    const analysis = await detectSqlInjection(symbolMismatchSnapshot, ingestion, org);

    expect(analysis.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(analysis.findings).toHaveLength(0);
    expect(analysis.limitations).toHaveLength(1);
    expect(analysis.limitations[0].code).toBe('UNSUPPORTED_IMPORT');
  });

  it('rejects cross-file snapshot paths that collide under canonical case-folding', async () => {
    await expect(captureSnapshot({
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-case-collision',
      organizationId: org,
      files: [
        { path: 'src/query.ts', content: querySource },
        { path: 'src/Query.ts', content: querySource },
      ],
    }, org)).rejects.toThrow('duplicate canonical path');
  });

  it('produces deterministic analysis fingerprints and non-authoritative candidate hypotheses when case matches exactly', async () => {
    const files = [
      { path: 'src/app.ts', content: appExactSource },
      { path: 'src/query.ts', content: querySource },
    ];

    const snapshotA = await captureSnapshot({
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-case-exact',
      organizationId: org,
      files,
    }, org);

    const snapshotB = await captureSnapshot({
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-case-exact',
      organizationId: org,
      files,
    }, org);

    expect(snapshotA.snapshotId).toBe(snapshotB.snapshotId);
    await validateSnapshot(snapshotA, org);

    const ingestionA = await ingestExpress(snapshotA, org);
    const ingestionB = await ingestExpress(snapshotB, org);

    expect(ingestionA.ingestionIdentity).toBe(ingestionB.ingestionIdentity);
    await validateExpressIngestion(ingestionA, org);

    const analysisA = await detectSqlInjection(snapshotA, ingestionA, org);
    const analysisB = await detectSqlInjection(snapshotB, ingestionB, org);

    expect(analysisA.status).toBe('DETECTED');
    expect(analysisA.resultFingerprint).toBe(analysisB.resultFingerprint);
    expect(analysisA.findings).toHaveLength(1);
    expect(analysisA.findings[0].vulnerabilityClass).toBe('SQL_INJECTION');
    await validateSqlAnalysis(analysisA, snapshotA, ingestionA, org);

    const commitSha = 'a'.repeat(40);
    const bridge = createSqlCandidateBridge(async () => commitSha);
    const candidatesA = await bridge(analysisA, snapshotA, ingestionA, org);
    const candidatesB = await bridge(analysisB, snapshotB, ingestionB, org);

    expect(candidatesA).toHaveLength(1);
    expect(candidatesA[0].candidate.verificationState).toBe('CANDIDATE');
    expect(candidatesA[0].candidate.reachabilityState).toBe('REACHABLE');
    expect(candidatesA[0].candidateBinding).toBe(candidatesB[0].candidateBinding);
  });
});
