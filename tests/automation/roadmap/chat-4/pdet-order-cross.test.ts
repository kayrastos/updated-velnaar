import { describe, it, expect } from 'vitest';
import {
  captureSnapshot,
  validateSnapshot,
  type SourceSnapshot,
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

const org = 'org_pdet_cross';
const repo = 'repo_pdet_cross';
const fixture = 'm2-case-001';
const validSha = 'a'.repeat(40);

describe('Pipeline Determinism: Cross-File Order Stability', () => {
  it('preserves snapshot, ingestion, analysis, and candidate determinism under input file permutation', async () => {
    const appFile = {
      path: 'src/app.ts',
      content:
        'import express from \'express\';\n' +
        'import { buildUserQuery } from \'./helper\';\n\n' +
        'export function createApp(db: any) {\n' +
        '  const app = express();\n' +
        '  function handleGetUser(req: any, res: any) {\n' +
        '    const id = req.query.id;\n' +
        '    const sql = buildUserQuery(id);\n' +
        '    const stmt = db.prepare(sql);\n' +
        '    const rows = stmt.all();\n' +
        '    return res.json(rows);\n' +
        '  }\n' +
        '  app.get(\x27/users\x27, handleGetUser);\n' +
        '  return app;\n' +
        '}\n',
    };

    const helperFile = {
      path: 'src/helper.ts',
      content:
        'export function buildUserQuery(userId: any) {\n' +
        '  const query = \x27SELECT * FROM users WHERE id = \x27 + userId;\n' +
        '  return query;\n' +
        '}\n',
    };

    const forwardFiles = [appFile, helperFile];
    const reversedFiles = [helperFile, appFile];

    const snapForward = await captureSnapshot(
      { fixtureId: fixture, repositoryId: repo, organizationId: org, files: forwardFiles },
      org,
    );
    const snapReversed = await captureSnapshot(
      { fixtureId: fixture, repositoryId: repo, organizationId: org, files: reversedFiles },
      org,
    );

    await validateSnapshot(snapForward, org);
    await validateSnapshot(snapReversed, org);

    expect(snapForward.snapshotId).toBe(snapReversed.snapshotId);
    expect(snapForward.files).toHaveLength(2);
    expect(snapReversed.files).toHaveLength(2);
    expect(snapForward.files[0].path).toBe('src/app.ts');
    expect(snapForward.files[1].path).toBe('src/helper.ts');
    expect(snapReversed.files[0].path).toBe('src/app.ts');
    expect(snapReversed.files[1].path).toBe('src/helper.ts');
    expect(snapForward.files[0].fileIdentity).toBe(snapReversed.files[0].fileIdentity);
    expect(snapForward.files[1].fileIdentity).toBe(snapReversed.files[1].fileIdentity);

    const ingestForward = await ingestExpress(snapForward, org);
    const ingestReversed = await ingestExpress(snapReversed, org);

    await validateExpressIngestion(ingestForward, org);
    await validateExpressIngestion(ingestReversed, org);

    expect(ingestForward.ingestionIdentity).toBe(ingestReversed.ingestionIdentity);
    expect(ingestForward.routes).toHaveLength(1);
    expect(ingestReversed.routes).toHaveLength(1);
    expect(ingestForward.routes[0].routeIdentity).toBe(ingestReversed.routes[0].routeIdentity);

    const analysisForward = await detectSqlInjection(snapForward, ingestForward, org);
    const analysisReversed = await detectSqlInjection(snapReversed, ingestReversed, org);

    await validateSqlAnalysis(analysisForward, snapForward, ingestForward, org);
    await validateSqlAnalysis(analysisReversed, snapReversed, ingestReversed, org);

    expect(analysisForward.status).toBe('DETECTED');
    expect(analysisReversed.status).toBe('DETECTED');
    expect(analysisForward.resultFingerprint).toBe(analysisReversed.resultFingerprint);
    expect(analysisForward.findings).toHaveLength(1);
    expect(analysisReversed.findings).toHaveLength(1);
    expect(analysisForward.findings[0].findingId).toBe(analysisReversed.findings[0].findingId);

    const candidateBridge = createSqlCandidateBridge(async () => validSha);
    const candidatesForward = await candidateBridge(analysisForward, snapForward, ingestForward, org);
    const candidatesReversed = await candidateBridge(analysisReversed, snapReversed, ingestReversed, org);

    expect(candidatesForward).toHaveLength(1);
    expect(candidatesReversed).toHaveLength(1);
    expect(candidatesForward[0].candidate.candidateId).toBe(candidatesReversed[0].candidate.candidateId);
    expect(candidatesForward[0].candidateBinding).toBe(candidatesReversed[0].candidateBinding);
    expect(candidatesForward[0].candidate.reachabilityState).toBe('REACHABLE');
    expect(candidatesForward[0].candidate.verificationState).toBe('CANDIDATE');
  });

  it('maintains cross-file order stability across multiple routes and helper exports', async () => {
    const appFile = {
      path: 'src/app.ts',
      content:
        'import express from \'express\';\n' +
        'import { getUserQuery, getOrderQuery } from \'./helper\';\n\n' +
        'export function createApp(db: any) {\n' +
        '  const app = express();\n' +
        '  function handleUsers(req: any, res: any) {\n' +
        '    const userId = req.query.userId;\n' +
        '    const sql = getUserQuery(userId);\n' +
        '    const stmt = db.prepare(sql);\n' +
        '    const rows = stmt.all();\n' +
        '    return res.json(rows);\n' +
        '  }\n' +
        '  function handleOrders(req: any, res: any) {\n' +
        '    const orderId = req.query.orderId;\n' +
        '    const sql = getOrderQuery(orderId);\n' +
        '    const stmt = db.prepare(sql);\n' +
        '    const rows = stmt.all();\n' +
        '    return res.json(rows);\n' +
        '  }\n' +
        '  app.get(\x27/users\x27, handleUsers);\n' +
        '  app.get(\x27/orders\x27, handleOrders);\n' +
        '  return app;\n' +
        '}\n',
    };

    const helperFile = {
      path: 'src/helper.ts',
      content:
        'export function getUserQuery(id: any) {\n' +
        '  const query = \x27SELECT * FROM users WHERE id = \x27 + id;\n' +
        '  return query;\n' +
        '}\n' +
        'export function getOrderQuery(id: any) {\n' +
        '  const query = \x27SELECT * FROM orders WHERE id = \x27 + id;\n' +
        '  return query;\n' +
        '}\n',
    };

    const snapForward = await captureSnapshot(
      { fixtureId: fixture, repositoryId: repo, organizationId: org, files: [appFile, helperFile] },
      org,
    );
    const snapReversed = await captureSnapshot(
      { fixtureId: fixture, repositoryId: repo, organizationId: org, files: [helperFile, appFile] },
      org,
    );

    expect(snapForward.snapshotId).toBe(snapReversed.snapshotId);

    const ingestForward = await ingestExpress(snapForward, org);
    const ingestReversed = await ingestExpress(snapReversed, org);
    expect(ingestForward.ingestionIdentity).toBe(ingestReversed.ingestionIdentity);
    expect(ingestForward.routes).toHaveLength(2);
    expect(ingestReversed.routes).toHaveLength(2);
    expect(ingestForward.routes[0].routeIdentity).toBe(ingestReversed.routes[0].routeIdentity);
    expect(ingestForward.routes[1].routeIdentity).toBe(ingestReversed.routes[1].routeIdentity);

    const analysisForward = await detectSqlInjection(snapForward, ingestForward, org);
    const analysisReversed = await detectSqlInjection(snapReversed, ingestReversed, org);
    expect(analysisForward.resultFingerprint).toBe(analysisReversed.resultFingerprint);
    expect(analysisForward.findings).toHaveLength(2);
    expect(analysisReversed.findings).toHaveLength(2);
    expect(analysisForward.findings[0].findingId).toBe(analysisReversed.findings[0].findingId);
    expect(analysisForward.findings[1].findingId).toBe(analysisReversed.findings[1].findingId);

    const candidateBridge = createSqlCandidateBridge(async () => validSha);
    const candidatesForward = await candidateBridge(analysisForward, snapForward, ingestForward, org);
    const candidatesReversed = await candidateBridge(analysisReversed, snapReversed, ingestReversed, org);
    expect(candidatesForward).toHaveLength(2);
    expect(candidatesReversed).toHaveLength(2);
    expect(candidatesForward[0].candidateBinding).toBe(candidatesReversed[0].candidateBinding);
    expect(candidatesForward[1].candidateBinding).toBe(candidatesReversed[1].candidateBinding);
  });

  it('preserves determinism when cross-file module includes both tainted and untainted helpers', async () => {
    const appFile = {
      path: 'src/app.ts',
      content:
        'import express from \'express\';\n' +
        'import { getVulnerableQuery, getSafeQuery } from \'./helper\';\n\n' +
        'export function createApp(db: any) {\n' +
        '  const app = express();\n' +
        '  function handleVuln(req: any, res: any) {\n' +
        '    const id = req.query.id;\n' +
        '    const sql = getVulnerableQuery(id);\n' +
        '    const stmt = db.prepare(sql);\n' +
        '    const rows = stmt.all();\n' +
        '    return res.json(rows);\n' +
        '  }\n' +
        '  function handleSafe(req: any, res: any) {\n' +
        '    const id = req.query.id;\n' +
        '    const sql = getSafeQuery();\n' +
        '    const stmt = db.prepare(sql);\n' +
        '    const rows = stmt.all(id);\n' +
        '    return res.json(rows);\n' +
        '  }\n' +
        '  app.get(\x27/vuln\x27, handleVuln);\n' +
        '  app.get(\x27/safe\x27, handleSafe);\n' +
        '  return app;\n' +
        '}\n',
    };

    const helperFile = {
      path: 'src/helper.ts',
      content:
        'export function getVulnerableQuery(userId: any) {\n' +
        '  const query = \x27SELECT * FROM accounts WHERE id = \x27 + userId;\n' +
        '  return query;\n' +
        '}\n' +
        'export function getSafeQuery() {\n' +
        '  const query = \x27SELECT * FROM accounts WHERE id = ?\x27;\n' +
        '  return query;\n' +
        '}\n',
    };

    const snapA = await captureSnapshot(
      { fixtureId: fixture, repositoryId: repo, organizationId: org, files: [appFile, helperFile] },
      org,
    );
    const snapB = await captureSnapshot(
      { fixtureId: fixture, repositoryId: repo, organizationId: org, files: [helperFile, appFile] },
      org,
    );

    const ingestA = await ingestExpress(snapA, org);
    const ingestB = await ingestExpress(snapB, org);

    const analysisA = await detectSqlInjection(snapA, ingestA, org);
    const analysisB = await detectSqlInjection(snapB, ingestB, org);

    expect(analysisA.status).toBe('DETECTED');
    expect(analysisB.status).toBe('DETECTED');
    expect(analysisA.resultFingerprint).toBe(analysisB.resultFingerprint);
    expect(analysisA.findings).toHaveLength(1);
    expect(analysisB.findings).toHaveLength(1);
    expect(analysisA.findings[0].findingId).toBe(analysisB.findings[0].findingId);
    expect(analysisA.findings[0].routeIdentity).toBe(ingestA.routes[0].routeIdentity);
  });

  it('enforces non-authoritative boundary and validates commit provenance on cross-file candidates', async () => {
    const appFile = {
      path: 'src/app.ts',
      content:
        'import express from \'express\';\n' +
        'import { buildQuery } from \'./helper\';\n\n' +
        'export function createApp(db: any) {\n' +
        '  const app = express();\n' +
        '  function handleQuery(req: any, res: any) {\n' +
        '    const id = req.query.id;\n' +
        '    const sql = buildQuery(id);\n' +
        '    const stmt = db.prepare(sql);\n' +
        '    const rows = stmt.all();\n' +
        '    return res.json(rows);\n' +
        '  }\n' +
        '  app.get(\x27/query\x27, handleQuery);\n' +
        '  return app;\n' +
        '}\n',
    };

    const helperFile = {
      path: 'src/helper.ts',
      content:
        'export function buildQuery(id: any) {\n' +
        '  const query = \x27SELECT 1 FROM items WHERE key = \x27 + id;\n' +
        '  return query;\n' +
        '}\n',
    };

    const snap = await captureSnapshot(
      { fixtureId: fixture, repositoryId: repo, organizationId: org, files: [helperFile, appFile] },
      org,
    );
    const ingest = await ingestExpress(snap, org);
    const analysis = await detectSqlInjection(snap, ingest, org);

    const invalidCommitBridge = createSqlCandidateBridge(async () => '0'.repeat(40));
    await expect(
      invalidCommitBridge(analysis, snap, ingest, org),
    ).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const validBridge = createSqlCandidateBridge(async () => validSha);
    const candidates = await validBridge(analysis, snap, ingest, org);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].candidate.verificationState).toBe('CANDIDATE');
    expect(candidates[0].candidate.reachabilityState).toBe('REACHABLE');
  });
});
