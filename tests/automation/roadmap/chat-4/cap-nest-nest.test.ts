import { describe, it, expect } from 'vitest';
import { captureSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import {
  isTrustedCommitCapability,
  assertTrustedCommitCapability,
} from '../../../../worker/intelligence/ingestion/repository';

describe('Capability enforcement: nested flow (nested calls)', () => {
  const org = 'org_velnar_test';
  const repoId = 'repo_nest_nest';
  const fixtureId = 'm2-case-001';

  it('detects SQL injection across nested function calls while preserving non-authoritative boundary', async () => {
    const routeCode = [
      "import express from 'express';",
      '',
      'function buildQuery(input: any) {',
      "  return 'SELECT * FROM records WHERE id = ' + input;",
      '}',
      '',
      'function executeNested(database: any, rawInput: any) {',
      '  const sql = buildQuery(rawInput);',
      '  const stmt = database.prepare(sql);',
      '  return stmt.all();',
      '}',
      '',
      'function dispatchQuery(database: any, param: any) {',
      '  return executeNested(database, param);',
      '}',
      '',
      'export function createApp(db: any) {',
      '  function recordHandler(req: any, res: any) {',
      '    const rows = dispatchQuery(db, req.query.id);',
      '    return res.json(rows);',
      '  }',
      '',
      '  const app = express();',
      "  app.get('/records', recordHandler);",
      '  return app;',
      '}',
    ].join('\n');

    const snapshot = await captureSnapshot(
      {
        fixtureId,
        repositoryId: repoId,
        organizationId: org,
        files: [
          {
            path: 'src/routes.ts',
            content: routeCode,
          },
        ],
      },
      org,
    );

    expect(snapshot.snapshotId).toBeDefined();
    expect(snapshot.files).toHaveLength(1);

    const expressIngestion = await ingestExpress(snapshot, org);
    expect(expressIngestion.routes).toHaveLength(1);
    expect(expressIngestion.routes[0].path).toBe('/records');

    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
    expect(analysis.status).toBe('DETECTED');
    expect(analysis.findings).toHaveLength(1);

    const finding = analysis.findings[0];
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.source.symbol).toBe('query.id');
    expect(finding.sink.symbol).toBe('db.prepare');
    expect(finding.flow.length).toBeGreaterThanOrEqual(4);

    expect((analysis as any).capability).toBeUndefined();
    expect((analysis as any).verificationState).toBeUndefined();
    expect((analysis as any).actionAuthority).toBeUndefined();

    expect(isTrustedCommitCapability((analysis as any).capability, {} as any)).toBe(false);
    expect(() => assertTrustedCommitCapability((analysis as any).capability, {} as any)).toThrow(
      'unauthorized commit capability',
    );

    const checkedSha = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
    const bridge = createSqlCandidateBridge(async (snap) => {
      expect(snap.snapshotId).toBe(snapshot.snapshotId);
      return checkedSha;
    });

    const candidates = await bridge(analysis, snapshot, expressIngestion, org);
    expect(candidates).toHaveLength(1);

    const { candidate, candidateBinding } = candidates[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidateBinding).toBeDefined();
    expect((candidate as any).capability).toBeUndefined();
    expect((candidate as any).verificationAuthority).toBeUndefined();

    expect(isTrustedCommitCapability((candidate as any).capability, {} as any)).toBe(false);
    expect(() => assertTrustedCommitCapability((candidate as any).capability, {} as any)).toThrow(
      'unauthorized commit capability',
    );
  });

  it('refuses capability minting or authority elevation for unverified or forged states', () => {
    const forgedCapability = Object.freeze({
      [Symbol.toStringTag]: 'TrustedCommitCapability' as const,
      forged: true,
    });

    const dummyIngestion = {
      version: 'velnar-repository-ingestion-v1' as const,
      organizationId: org,
      repositoryId: repoId,
      commitSha: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      snapshot: {
        version: 'velnar-local-source-snapshot-v2' as const,
        fixtureId,
        repositoryId: repoId,
        organizationId: org,
        snapshotId: 'fake-snapshot-id',
        totalBytes: 100,
        files: [],
      },
      ingestionIdentity: 'fake-identity',
    };

    expect(isTrustedCommitCapability(forgedCapability, dummyIngestion as any)).toBe(false);
    expect(() => assertTrustedCommitCapability(forgedCapability, dummyIngestion as any)).toThrow(
      'unauthorized commit capability',
    );
  });
});
