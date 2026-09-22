import { describe, expect, it } from 'vitest';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { computeCandidateBinding, validateFindingCandidate } from '../../../../worker/intelligence/contracts';
import { captureSnapshot, type SnapshotInput } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress } from '../../../../worker/intelligence/ingestion/express';

const ORG = 'org_wrap_cross';

async function buildSnapshot(files: { path: string; content: string }[], fixtureId = 'm2-case-001') {
  const input: SnapshotInput = {
    fixtureId,
    repositoryId: 'repo-sqli-wrap-cross',
    organizationId: ORG,
    files,
  };
  const snapshot = await captureSnapshot(input, ORG);
  const ingestion = await ingestExpress(snapshot, ORG);
  return { snapshot, ingestion };
}

describe('SQL injection detector: cross-file wrapper boundary', () => {
  it('detects tainted SQL injection flow across a cross-file database wrapper boundary', async () => {
    const routesContent = [
      "import express from 'express';",
      "import { executeQuery } from './wrapper';",
      '',
      'export function createApp(db: any) {',
      '  const app = express();',
      '  function searchRoute(req: any, res: any) {',
      '    const q = req.query.q;',
      '    const query = "SELECT * FROM items WHERE name = \'" + q + "\'";',
      '    return res.json(executeQuery(db, query));',
      '  }',
      "  app.get('/search', searchRoute);",
      '  return app;',
      '}',
      '',
    ].join('\n');

    const wrapperContent = [
      'export function executeQuery(db: any, query: string) {',
      '  return db.prepare(query).all();',
      '}',
      '',
    ].join('\n');

    const { snapshot, ingestion } = await buildSnapshot([
      { path: 'src/routes.ts', content: routesContent },
      { path: 'src/wrapper.ts', content: wrapperContent },
    ]);

    const result = await detectSqlInjection(snapshot, ingestion, ORG);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);

    const finding = result.findings[0];
    expect(finding.source.filePath).toBe('src/routes.ts');
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.filePath).toBe('src/wrapper.ts');
    expect(finding.sink.symbol).toBe('db.prepare');
    expect(finding.flow[0].kind).toBe('SOURCE');
    expect(finding.flow.at(-1)!.kind).toBe('SINK');

    const filePathsInFlow = [...new Set(finding.flow.map(step => step.location.filePath))];
    expect(filePathsInFlow).toEqual(['src/routes.ts', 'src/wrapper.ts']);

    const validated = await validateSqlAnalysis(result, snapshot, ingestion, ORG);
    expect(validated.resultFingerprint).toBe(result.resultFingerprint);
  });

  it('produces no finding for safe constant queries passing through cross-file wrapper', async () => {
    const routesContent = [
      "import express from 'express';",
      "import { executeQuery } from './wrapper';",
      '',
      'export function createApp(db: any) {',
      '  const app = express();',
      '  function safeRoute(req: any, res: any) {',
      '    return res.json(executeQuery(db, "SELECT * FROM items WHERE status = \'active\'"));',
      '  }',
      "  app.get('/safe', safeRoute);",
      '  return app;',
      '}',
      '',
    ].join('\n');

    const wrapperContent = [
      'export function executeQuery(db: any, query: string) {',
      '  return db.prepare(query).all();',
      '}',
      '',
    ].join('\n');

    const { snapshot, ingestion } = await buildSnapshot([
      { path: 'src/routes.ts', content: routesContent },
      { path: 'src/wrapper.ts', content: wrapperContent },
    ]);

    const result = await detectSqlInjection(snapshot, ingestion, ORG);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toHaveLength(0);
  });

  it('traces multi-hop flow through service and repository wrapper across 3 files', async () => {
    const routesContent = [
      "import express from 'express';",
      "import { handleSearch } from './service';",
      '',
      'export function createApp(db: any) {',
      '  const app = express();',
      '  function searchRoute(req: any, res: any) {',
      '    const q = req.query.q;',
      '    return res.json(handleSearch(db, q));',
      '  }',
      "  app.get('/search', searchRoute);",
      '  return app;',
      '}',
      '',
    ].join('\n');

    const serviceContent = [
      "import { executeSql } from './repository';",
      '',
      'export function handleSearch(db: any, term: string) {',
      '  const query = "SELECT * FROM users WHERE login = \'" + term + "\'";',
      '  return executeSql(db, query);',
      '}',
      '',
    ].join('\n');

    const repoContent = [
      'export function executeSql(db: any, statement: string) {',
      '  return db.prepare(statement).all();',
      '}',
      '',
    ].join('\n');

    const { snapshot, ingestion } = await buildSnapshot([
      { path: 'src/routes.ts', content: routesContent },
      { path: 'src/service.ts', content: serviceContent },
      { path: 'src/repository.ts', content: repoContent },
    ]);

    const result = await detectSqlInjection(snapshot, ingestion, ORG);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);

    const finding = result.findings[0];
    expect(finding.source.filePath).toBe('src/routes.ts');
    expect(finding.sink.filePath).toBe('src/repository.ts');
    expect(finding.sink.symbol).toBe('db.prepare');

    const filePaths = [...new Set(finding.flow.map(step => step.location.filePath))];
    expect(filePaths).toEqual(['src/routes.ts', 'src/service.ts', 'src/repository.ts']);
  });

  it('binds cross-file wrapper finding to exact CANDIDATE state and verifiable semantic binding', async () => {
    const routesContent = [
      "import express from 'express';",
      "import { executeQuery } from './wrapper';",
      '',
      'export function createApp(db: any) {',
      '  const app = express();',
      '  function searchRoute(req: any, res: any) {',
      '    return res.json(executeQuery(db, "SELECT * FROM items WHERE id = \'" + req.query.id + "\'"));',
      '  }',
      "  app.get('/search', searchRoute);",
      '  return app;',
      '}',
      '',
    ].join('\n');

    const wrapperContent = [
      'export function executeQuery(db: any, query: string) {',
      '  return db.prepare(query).all();',
      '}',
      '',
    ].join('\n');

    const { snapshot, ingestion } = await buildSnapshot([
      { path: 'src/routes.ts', content: routesContent },
      { path: 'src/wrapper.ts', content: wrapperContent },
    ]);

    const result = await detectSqlInjection(snapshot, ingestion, ORG);
    expect(result.status).toBe('DETECTED');

    const commitSha = 'c'.repeat(40);
    const bridge = createSqlCandidateBridge(async () => commitSha);
    const candidates = await bridge(result, snapshot, ingestion, ORG);

    expect(candidates).toHaveLength(1);
    const { candidate, candidateBinding } = candidates[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.snapshot.commitSha).toBe(commitSha);
    expect(candidate.source.filePath).toBe('src/routes.ts');
    expect(candidate.sink.filePath).toBe('src/wrapper.ts');
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);
  });
});
