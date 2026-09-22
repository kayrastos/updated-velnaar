import { describe, it, expect } from 'vitest';
import { captureSnapshot, validateSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress, validateExpressIngestion } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';

const org = 'org_pdet_case_nest';
const repoId = 'repo-pdet-case-nest';
const fixtureId = 'm2-case-001';

const helperCode = `export function buildNestedQuery(term: string) {
  return 'SELECT * FROM accounts WHERE id = ' + term;
}
`;

const appCode = `import express from 'express';
import { buildNestedQuery } from './modules/queryBuilder';

export function createApp(db: any) {
  const app = express();
  function nestedHandler(req: any, res: any) {
    const accountId = req.query.accountId;
    const sql = buildNestedQuery(accountId);
    const statement = db.prepare(sql);
    return res.json(statement.all());
  }
  app.get('/nested/accounts', nestedHandler);
  return app;
}
`;

describe('Pipeline Determinism: Case Sensitivity in Nested Directory Structures', () => {
  it('rejects duplicate canonical paths in nested directories differing only by case', async () => {
    await expect(
      captureSnapshot({
        fixtureId,
        repositoryId: repoId,
        organizationId: org,
        files: [
          { path: 'src/nested/modules/queryBuilder.ts', content: helperCode },
          { path: 'src/nested/Modules/queryBuilder.ts', content: helperCode },
        ],
      }, org),
    ).rejects.toThrow('duplicate canonical path');

    await expect(
      captureSnapshot({
        fixtureId,
        repositoryId: repoId,
        organizationId: org,
        files: [
          { path: 'src/nested/modules/queryBuilder.ts', content: helperCode },
          { path: 'src/nested/modules/QueryBuilder.ts', content: helperCode },
        ],
      }, org),
    ).rejects.toThrow('duplicate canonical path');
  });

  it('enforces strict case sensitivity for relative imports across nested directory levels', async () => {
    const mismatchedDirImportApp = `import express from 'express';
import { buildNestedQuery } from './Modules/queryBuilder';

export function createApp(db: any) {
  const app = express();
  function nestedHandler(req: any, res: any) {
    const accountId = req.query.accountId;
    const statement = db.prepare('SELECT 1');
    return res.json(statement.all());
  }
  app.get('/nested/accounts', nestedHandler);
  return app;
}
`;

    const snapshotMismatchedDir = await captureSnapshot({
      fixtureId,
      repositoryId: repoId,
      organizationId: org,
      files: [
        { path: 'src/nested/app.ts', content: mismatchedDirImportApp },
        { path: 'src/nested/modules/queryBuilder.ts', content: helperCode },
      ],
    }, org);

    await expect(ingestExpress(snapshotMismatchedDir, org)).rejects.toThrow('missing or ambiguous source import');

    const mismatchedFileImportApp = `import express from 'express';
import { buildNestedQuery } from './modules/QueryBuilder';

export function createApp(db: any) {
  const app = express();
  function nestedHandler(req: any, res: any) {
    const accountId = req.query.accountId;
    const statement = db.prepare('SELECT 1');
    return res.json(statement.all());
  }
  app.get('/nested/accounts', nestedHandler);
  return app;
}
`;

    const snapshotMismatchedFile = await captureSnapshot({
      fixtureId,
      repositoryId: repoId,
      organizationId: org,
      files: [
        { path: 'src/nested/app.ts', content: mismatchedFileImportApp },
        { path: 'src/nested/modules/queryBuilder.ts', content: helperCode },
      ],
    }, org);

    await expect(ingestExpress(snapshotMismatchedFile, org)).rejects.toThrow('missing or ambiguous source import');
  });

  it('preserves case sensitivity in nested route paths while detecting duplicates', async () => {
    const multiCasedRoutesApp = `import express from 'express';

export function createApp(db: any) {
  const app = express();
  function handlerA(req: any, res: any) {
    const statement = db.prepare('SELECT 1');
    return res.json(statement.all());
  }
  function handlerB(req: any, res: any) {
    const statement = db.prepare('SELECT 2');
    return res.json(statement.all());
  }
  app.get('/api/v1/nested', handlerA);
  app.get('/api/v1/Nested', handlerB);
  return app;
}
`;

    const snapshot = await captureSnapshot({
      fixtureId,
      repositoryId: repoId,
      organizationId: org,
      files: [
        { path: 'src/nested/routes.ts', content: multiCasedRoutesApp },
      ],
    }, org);

    const ingestion = await ingestExpress(snapshot, org);
    expect(ingestion.routes).toHaveLength(2);
    expect(ingestion.routes[0].path).toBe('/api/v1/nested');
    expect(ingestion.routes[1].path).toBe('/api/v1/Nested');
    expect(ingestion.routes[0].routeIdentity).not.toBe(ingestion.routes[1].routeIdentity);

    const duplicateRouteApp = `import express from 'express';

export function createApp(db: any) {
  const app = express();
  function handler1(req: any, res: any) {
    const statement = db.prepare('SELECT 1');
    return res.json(statement.all());
  }
  function handler2(req: any, res: any) {
    const statement = db.prepare('SELECT 2');
    return res.json(statement.all());
  }
  app.get('/api/v1/nested', handler1);
  app.get('/api/v1/nested', handler2);
  return app;
}
`;

    const duplicateSnapshot = await captureSnapshot({
      fixtureId,
      repositoryId: repoId,
      organizationId: org,
      files: [
        { path: 'src/nested/duplicate.ts', content: duplicateRouteApp },
      ],
    }, org);

    await expect(ingestExpress(duplicateSnapshot, org)).rejects.toThrow('ambiguous duplicate route');
  });

  it('guarantees pipeline determinism across file input order variations with nested modules', async () => {
    const filesOrder1 = [
      { path: 'src/nested/app.ts', content: appCode },
      { path: 'src/nested/modules/queryBuilder.ts', content: helperCode },
    ];
    const filesOrder2 = [
      { path: 'src/nested/modules/queryBuilder.ts', content: helperCode },
      { path: 'src/nested/app.ts', content: appCode },
    ];

    const snapshot1 = await captureSnapshot({
      fixtureId,
      repositoryId: repoId,
      organizationId: org,
      files: filesOrder1,
    }, org);

    const snapshot2 = await captureSnapshot({
      fixtureId,
      repositoryId: repoId,
      organizationId: org,
      files: filesOrder2,
    }, org);

    expect(snapshot1.snapshotId).toBe(snapshot2.snapshotId);
    expect(snapshot1.totalBytes).toBe(snapshot2.totalBytes);

    const validatedSnapshot1 = await validateSnapshot(snapshot1, org);
    const validatedSnapshot2 = await validateSnapshot(snapshot2, org);
    expect(validatedSnapshot1.snapshotId).toBe(validatedSnapshot2.snapshotId);

    const ingestion1 = await ingestExpress(snapshot1, org);
    const ingestion2 = await ingestExpress(snapshot2, org);
    expect(ingestion1.ingestionIdentity).toBe(ingestion2.ingestionIdentity);

    const validatedIngestion1 = await validateExpressIngestion(ingestion1, org);
    const validatedIngestion2 = await validateExpressIngestion(ingestion2, org);
    expect(validatedIngestion1.ingestionIdentity).toBe(validatedIngestion2.ingestionIdentity);

    const analysis1 = await detectSqlInjection(snapshot1, ingestion1, org);
    const analysis2 = await detectSqlInjection(snapshot2, ingestion2, org);
    expect(analysis1.status).toBe('DETECTED');
    expect(analysis2.status).toBe('DETECTED');
    expect(analysis1.resultFingerprint).toBe(analysis2.resultFingerprint);
    expect(analysis1.findings).toHaveLength(1);
    expect(analysis1.findings[0].findingId).toBe(analysis2.findings[0].findingId);

    const validatedAnalysis1 = await validateSqlAnalysis(analysis1, snapshot1, ingestion1, org);
    expect(validatedAnalysis1.resultFingerprint).toBe(analysis1.resultFingerprint);

    const mockSha = 'a'.repeat(40);
    const verifyCommittedCode = async () => mockSha;
    const bridge = createSqlCandidateBridge(verifyCommittedCode);

    const candidates1 = await bridge(analysis1, snapshot1, ingestion1, org);
    const candidates2 = await bridge(analysis2, snapshot2, ingestion2, org);

    expect(candidates1).toHaveLength(1);
    expect(candidates2).toHaveLength(1);
    expect(candidates1[0].candidate.candidateId).toBe(candidates2[0].candidate.candidateId);
    expect(candidates1[0].candidateBinding).toBe(candidates2[0].candidateBinding);
    expect(candidates1[0].candidate.verificationState).toBe('CANDIDATE');
    expect(candidates1[0].candidate.reachabilityState).toBe('REACHABLE');
  });

  it('preserves non-authoritative CANDIDATE boundary without VERIFIED authority', async () => {
    const snapshot = await captureSnapshot({
      fixtureId,
      repositoryId: repoId,
      organizationId: org,
      files: [
        { path: 'src/nested/app.ts', content: appCode },
        { path: 'src/nested/modules/queryBuilder.ts', content: helperCode },
      ],
    }, org);

    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);
    expect(analysis.status).toBe('DETECTED');

    const mockSha = 'b'.repeat(40);
    const bridge = createSqlCandidateBridge(async () => mockSha);
    const candidates = await bridge(analysis, snapshot, ingestion, org);

    expect(candidates).toHaveLength(1);
    const candidate = candidates[0].candidate;

    expect(candidate.verificationState).toBe('CANDIDATE');
    expect((candidate as any).verificationState).not.toBe('VERIFIED');
    expect((candidate as any).capability).toBeUndefined();
    expect((candidate as any).executionAuthority).toBeUndefined();
  });
});
