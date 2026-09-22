import { describe, it, expect } from 'vitest';
import { captureSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import {
  isTrustedCommitCapability,
  assertTrustedCommitCapability,
} from '../../../../worker/intelligence/ingestion/repository';

describe('V1 RM_CAP_ALIAS_CROSS: Capability Enforcement and Cross-File Alias Propagation', () => {
  const org = 'org_chat4_alias';

  it('detects SQL injection through cross-file aliased function propagation', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-cap-alias-cross',
        organizationId: org,
        files: [
          {
            path: 'src/formatters.ts',
            content: [
              'export function formatParameter(val: string) {',
              '  const sanitized = val;',
              '  return sanitized;',
              '}',
              '',
            ].join('\n'),
          },
          {
            path: 'src/routes.ts',
            content: [
              "import express from 'express';",
              "import { formatParameter as escapeIdentifier } from './formatters';",
              '',
              'export function createApp(db: any) {',
              '  const app = express();',
              '  function userLookup(req: any, res: any) {',
              '    const rawId = req.query.id;',
              '    const transformed = escapeIdentifier(rawId);',
              "    const statement = db.prepare('SELECT * FROM accounts WHERE id = ' + transformed);",
              '    res.json(statement.all());',
              '  }',
              "  app.get('/accounts', userLookup);",
              '  return app;',
              '}',
              '',
            ].join('\n'),
          },
        ],
      },
      org,
    );

    const expressIngestion = await ingestExpress(snapshot, org);
    expect(expressIngestion.routes).toHaveLength(1);
    expect(expressIngestion.routes[0].path).toBe('/accounts');
    expect(expressIngestion.routes[0].method).toBe('GET');

    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
    expect(analysis.status).toBe('DETECTED');
    expect(analysis.findings).toHaveLength(1);
    expect(analysis.findings[0].vulnerabilityClass).toBe('SQL_INJECTION');
    expect(analysis.findings[0].routeIdentity).toBe(expressIngestion.routes[0].routeIdentity);

    const flowKinds = analysis.findings[0].flow.map((step) => step.kind);
    expect(flowKinds).toContain('SOURCE');
    expect(flowKinds).toContain('CALL');
    expect(flowKinds).toContain('ARGUMENT');
    expect(flowKinds).toContain('VARIABLE');
    expect(flowKinds).toContain('RETURN');
    expect(flowKinds).toContain('CONCAT');
    expect(flowKinds).toContain('SINK');

    expect((snapshot as any).capability).toBeUndefined();
    expect((expressIngestion as any).capability).toBeUndefined();
    expect((analysis as any).capability).toBeUndefined();

    const commitSha = 'b'.repeat(40);
    const bridge = createSqlCandidateBridge(async () => commitSha);
    const hypotheses = await bridge(analysis, snapshot, expressIngestion, org);
    expect(hypotheses).toHaveLength(1);

    const candidate = hypotheses[0].candidate;
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect((candidate as any).capability).toBeUndefined();
    expect((hypotheses[0] as any).capability).toBeUndefined();
  });

  it('enforces that candidate bridge requires truthful verified commit SHA', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-cap-alias-cross-commit',
        organizationId: org,
        files: [
          {
            path: 'src/formatters.ts',
            content: 'export function pass(v: string) {\n  return v;\n}\n',
          },
          {
            path: 'src/routes.ts',
            content: [
              "import express from 'express';",
              "import { pass as aliasedPass } from './formatters';",
              '',
              'export function createApp(db: any) {',
              '  const app = express();',
              '  function handler(req: any, res: any) {',
              '    const data = aliasedPass(req.query.q);',
              "    const s = db.prepare('SELECT ' + data);",
              '    res.json(s.all());',
              '  }',
              "  app.get('/test', handler);",
              '  return app;',
              '}',
              '',
            ].join('\n'),
          },
        ],
      },
      org,
    );

    const expressIngestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
    expect(analysis.status).toBe('DETECTED');

    const invalidBridge = createSqlCandidateBridge(async () => 'not-a-valid-commit-sha');
    await expect(invalidBridge(analysis, snapshot, expressIngestion, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const zeroBridge = createSqlCandidateBridge(async () => '0'.repeat(40));
    await expect(zeroBridge(analysis, snapshot, expressIngestion, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const emptyBridge = createSqlCandidateBridge(async () => '');
    await expect(emptyBridge(analysis, snapshot, expressIngestion, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
  });

  it('fails closed when unauthorized objects or capabilities are evaluated', async () => {
    const fakeIngestion: any = {
      version: 'velnar-repository-ingestion-v1',
      organizationId: org,
      repositoryId: 'repo-unauthorized',
      commitSha: 'c'.repeat(40),
      snapshot: {
        version: 'velnar-local-source-snapshot-v2',
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-unauthorized',
        organizationId: org,
        snapshotId: 'fake-snapshot-id',
        totalBytes: 0,
        files: [],
      },
      ingestionIdentity: 'fake-identity',
    };

    expect(isTrustedCommitCapability(undefined, fakeIngestion)).toBe(false);
    expect(isTrustedCommitCapability(null, fakeIngestion)).toBe(false);
    expect(isTrustedCommitCapability({}, fakeIngestion)).toBe(false);
    expect(isTrustedCommitCapability({ [Symbol.toStringTag]: 'TrustedCommitCapability' }, fakeIngestion)).toBe(false);
    expect(isTrustedCommitCapability({ capability: true }, fakeIngestion)).toBe(false);

    expect(() => assertTrustedCommitCapability({}, fakeIngestion)).toThrow('M2_INGESTION_ERROR: unauthorized commit capability');
    expect(() => assertTrustedCommitCapability({ [Symbol.toStringTag]: 'TrustedCommitCapability' }, fakeIngestion)).toThrow('M2_INGESTION_ERROR: unauthorized commit capability');
  });

  it('avoids false positive detection on cross-file aliased safe parameterization', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-cap-alias-safe',
        organizationId: org,
        files: [
          {
            path: 'src/formatters.ts',
            content: 'export function sanitizeNumber(val: string) {\n  return val;\n}\n',
          },
          {
            path: 'src/routes.ts',
            content: [
              "import express from 'express';",
              "import { sanitizeNumber as cleanId } from './formatters';",
              '',
              'export function createApp(db: any) {',
              '  const app = express();',
              '  function safeLookup(req: any, res: any) {',
              '    const id = cleanId(req.query.id);',
              "    const statement = db.prepare('SELECT * FROM accounts WHERE id = ?');",
              '    res.json(statement.all(id));',
              '  }',
              "  app.get('/safe-accounts', safeLookup);",
              '  return app;',
              '}',
              '',
            ].join('\n'),
          },
        ],
      },
      org,
    );

    const expressIngestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
    expect(analysis.status).toBe('NOT_DETECTED');
    expect(analysis.findings).toHaveLength(0);

    const bridge = createSqlCandidateBridge(async () => 'd'.repeat(40));
    const hypotheses = await bridge(analysis, snapshot, expressIngestion, org);
    expect(hypotheses).toHaveLength(0);
  });
});
