import { describe, it, expect } from 'vitest';
import { captureSnapshot, validateSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress, validateExpressIngestion } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';

describe('Pipeline Determinism - Normalization Boundary - Nested Routes and Paths', () => {
  const org = 'org_pdet_nest';
  const fixtureId = 'm2-case-001';
  const repositoryId = 'repo_pdet_nest';

  const helperSource = [
    'export function formatQuery(id: any) {',
    '  const query = \'SELECT * FROM users WHERE id = \' + id;',
    '  return query;',
    '}',
    '',
  ].join('\n');

  const routeSource = [
    'import express from \'express\';',
    'import { formatQuery } from \'./helpers/query\';',
    '',
    'export function createApp(db: any) {',
    '  const app = express();',
    '  const router = express.Router();',
    '',
    '  function userHandler(req: any, res: any) {',
    '    const id = req.query.id;',
    '    const q = formatQuery(id);',
    '    const stmt = db.prepare(q);',
    '    const rows = stmt.all();',
    '    return res.json(rows);',
    '  }',
    '',
    '  router.get(\'/lookup\', userHandler);',
    '  app.use(\'/api/v1/nested\', router);',
    '  return app;',
    '}',
    '',
  ].join('\n');

  it('guarantees deterministic snapshot identity across file permutation in nested structures', async () => {
    const filesA = [
      { path: 'src/nested/helpers/query.ts', content: helperSource },
      { path: 'src/nested/routes.ts', content: routeSource },
    ];
    const filesB = [
      { path: 'src/nested/routes.ts', content: routeSource },
      { path: 'src/nested/helpers/query.ts', content: helperSource },
    ];

    const snapshotA = await captureSnapshot(
      { fixtureId, repositoryId, organizationId: org, files: filesA },
      org,
    );
    const snapshotB = await captureSnapshot(
      { fixtureId, repositoryId, organizationId: org, files: filesB },
      org,
    );

    expect(snapshotA.snapshotId).toBe(snapshotB.snapshotId);
    expect(snapshotA.totalBytes).toBe(snapshotB.totalBytes);
    expect(snapshotA.files.map((f) => f.path)).toEqual([
      'src/nested/helpers/query.ts',
      'src/nested/routes.ts',
    ]);
    expect(snapshotB.files.map((f) => f.path)).toEqual([
      'src/nested/helpers/query.ts',
      'src/nested/routes.ts',
    ]);
  });

  it('produces deterministic ingestion identity and normalized route paths for nested routers', async () => {
    const files = [
      { path: 'src/nested/helpers/query.ts', content: helperSource },
      { path: 'src/nested/routes.ts', content: routeSource },
    ];

    const snapshotA = await captureSnapshot(
      { fixtureId, repositoryId, organizationId: org, files },
      org,
    );
    const snapshotB = await captureSnapshot(
      { fixtureId, repositoryId, organizationId: org, files },
      org,
    );

    const ingestionA = await ingestExpress(snapshotA, org);
    const ingestionB = await ingestExpress(snapshotB, org);

    expect(ingestionA.ingestionIdentity).toBe(ingestionB.ingestionIdentity);
    expect(ingestionA.routes).toHaveLength(1);
    expect(ingestionA.routes[0].path).toBe('/api/v1/nested/lookup');
    expect(ingestionA.routes[0].declaredPath).toBe('/lookup');
    expect(ingestionA.routes[0].ownerKind).toBe('ROUTER');
    expect(ingestionA.routes[0].routeIdentity).toBe(ingestionB.routes[0].routeIdentity);

    const validated = await validateExpressIngestion(ingestionA, org);
    expect(validated.ingestionIdentity).toBe(ingestionA.ingestionIdentity);
  });

  it('preserves deterministic detection and candidate hypothesis bounds across nested pipeline', async () => {
    const files = [
      { path: 'src/nested/helpers/query.ts', content: helperSource },
      { path: 'src/nested/routes.ts', content: routeSource },
    ];

    const snapshot = await captureSnapshot(
      { fixtureId, repositoryId, organizationId: org, files },
      org,
    );
    const ingestion = await ingestExpress(snapshot, org);

    const analysisA = await detectSqlInjection(snapshot, ingestion, org);
    const analysisB = await detectSqlInjection(snapshot, ingestion, org);

    expect(analysisA.resultFingerprint).toBe(analysisB.resultFingerprint);
    expect(analysisA.status).toBe('DETECTED');
    expect(analysisA.findings).toHaveLength(1);
    expect(analysisA.findings[0].findingId).toBe(analysisB.findings[0].findingId);

    const validatedAnalysis = await validateSqlAnalysis(analysisA, snapshot, ingestion, org);
    expect(validatedAnalysis.resultFingerprint).toBe(analysisA.resultFingerprint);

    const commitSha = 'a'.repeat(40);
    const bridge = createSqlCandidateBridge(async () => commitSha);

    const candidatesA = await bridge(analysisA, snapshot, ingestion, org);
    const candidatesB = await bridge(analysisB, snapshot, ingestion, org);

    expect(candidatesA).toHaveLength(1);
    expect(candidatesB).toHaveLength(1);
    expect(candidatesA[0].candidate.candidateId).toBe(candidatesB[0].candidate.candidateId);
    expect(candidatesA[0].candidateBinding).toBe(candidatesB[0].candidateBinding);
    expect(candidatesA[0].candidate.verificationState).toBe('CANDIDATE');
    expect(candidatesA[0].candidate.reachabilityState).toBe('REACHABLE');
    expect(candidatesA[0].candidate.snapshot.commitSha).toBe(commitSha);
    expect(candidatesA[0].candidate.snapshot.snapshotId).toBe(snapshot.snapshotId);
  });

  it('fails closed on malformed nested path components at snapshot boundary', async () => {
    await expect(
      captureSnapshot(
        {
          fixtureId,
          repositoryId,
          organizationId: org,
          files: [{ path: 'src/nested/../routes.ts', content: routeSource }],
        },
        org,
      ),
    ).rejects.toThrow('path component');

    await expect(
      captureSnapshot(
        {
          fixtureId,
          repositoryId,
          organizationId: org,
          files: [{ path: 'src/nested/./routes.ts', content: routeSource }],
        },
        org,
      ),
    ).rejects.toThrow('path component');

    await expect(
      captureSnapshot(
        {
          fixtureId,
          repositoryId,
          organizationId: org,
          files: [{ path: 'src//nested/routes.ts', content: routeSource }],
        },
        org,
      ),
    ).rejects.toThrow('path component');
  });

  it('fails closed on invalid nested route path segments and forged fingerprints', async () => {
    const invalidRouteSource = [
      'import express from \'express\';',
      '',
      'export function createApp(db: any) {',
      '  const app = express();',
      '  const router = express.Router();',
      '',
      '  function dummyHandler(req: any, res: any) {',
      '    const stmt = db.prepare(\'SELECT 1\');',
      '    const rows = stmt.all();',
      '    return res.json(rows);',
      '  }',
      '',
      '  router.get(\'/lookup\', dummyHandler);',
      '  app.use(\'/api//nested\', router);',
      '  return app;',
      '}',
      '',
    ].join('\n');

    const invalidSnapshot = await captureSnapshot(
      {
        fixtureId,
        repositoryId,
        organizationId: org,
        files: [{ path: 'src/nested/invalid.ts', content: invalidRouteSource }],
      },
      org,
    );

    await expect(ingestExpress(invalidSnapshot, org)).rejects.toThrow(
      'literal bounded route path required',
    );

    const validSnapshot = await captureSnapshot(
      {
        fixtureId,
        repositoryId,
        organizationId: org,
        files: [
          { path: 'src/nested/helpers/query.ts', content: helperSource },
          { path: 'src/nested/routes.ts', content: routeSource },
        ],
      },
      org,
    );

    await expect(
      validateSnapshot(
        { ...validSnapshot, snapshotId: 'sha256:' + '0'.repeat(64) },
        org,
      ),
    ).rejects.toThrow('snapshot integrity mismatch');

    const ingestion = await ingestExpress(validSnapshot, org);
    const analysis = await detectSqlInjection(validSnapshot, ingestion, org);

    await expect(
      validateSqlAnalysis(
        { ...analysis, resultFingerprint: 'sha256:' + '0'.repeat(64) },
        validSnapshot,
        ingestion,
        org,
      ),
    ).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
  });
});
