import { describe, it, expect } from 'vitest';
import { captureSnapshot, hash } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import {
  isTrustedCommitCapability,
  assertTrustedCommitCapability,
  validateRepositoryIngestion,
  type RepositoryIngestion,
} from '../../../../worker/intelligence/ingestion/repository';

describe('V1 Capability Enforcement Duplicate Collapse Multi-Stage', () => {
  const org = 'org_velnar_test';
  const commitSha = '1111111111111111111111111111111111111111';

  const validSource = [
    "import express from 'express';",
    '',
    'export function createApp(db: any) {',
    '  function handleQuery(req: any, res: any) {',
    '    const user = req.query.user;',
    "    const stmt = db.prepare('SELECT * FROM users WHERE name = ' + user);",
    '    return stmt.all();',
    '  }',
    '  const app = express();',
    "  app.get('/query', handleQuery);",
    '  return app;',
    '}',
    '',
  ].join('\n');

  it('enforces duplicate path rejection at snapshot stage', async () => {
    await expect(
      captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: 'repo_test',
          organizationId: org,
          files: [
            { path: 'src/app.ts', content: validSource },
            { path: 'src/app.ts', content: validSource },
          ],
        },
        org,
      ),
    ).rejects.toThrow('duplicate canonical path');
  });

  it('enforces duplicate route rejection at express ingestion stage', async () => {
    const dupRouteSource = [
      "import express from 'express';",
      '',
      'export function createApp(db: any) {',
      '  function handleQueryA(req: any, res: any) {',
      '    const user = req.query.user;',
      "    const stmt = db.prepare('SELECT * FROM users WHERE name = ' + user);",
      '    return stmt.all();',
      '  }',
      '  function handleQueryB(req: any, res: any) {',
      '    const user = req.query.user;',
      "    const stmt = db.prepare('SELECT * FROM users WHERE name = ' + user);",
      '    return stmt.all();',
      '  }',
      '  const app = express();',
      "  app.get('/query', handleQueryA);",
      "  app.get('/query', handleQueryB);",
      '  return app;',
      '}',
      '',
    ].join('\n');

    const dupSnapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo_test',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: dupRouteSource }],
      },
      org,
    );

    await expect(ingestExpress(dupSnapshot, org)).rejects.toThrow('ambiguous duplicate route');
  });

  it('propagates multi-stage pipeline and collapses duplicate candidate hypotheses deterministically', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo_test',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: validSource }],
      },
      org,
    );

    const expressIngestion = await ingestExpress(snapshot, org);
    expect(expressIngestion.routes).toHaveLength(1);

    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
    expect(analysis.status).toBe('DETECTED');
    expect(analysis.findings).toHaveLength(1);

    const bridge = createSqlCandidateBridge(async () => commitSha);
    const hypotheses1 = await bridge(analysis, snapshot, expressIngestion, org);
    expect(hypotheses1).toHaveLength(1);
    expect(hypotheses1[0].candidate.reachabilityState).toBe('REACHABLE');
    expect(hypotheses1[0].candidate.verificationState).toBe('CANDIDATE');

    const hypotheses2 = await bridge(analysis, snapshot, expressIngestion, org);
    expect(hypotheses2).toHaveLength(1);
    expect(hypotheses2[0].candidate.candidateId).toBe(hypotheses1[0].candidate.candidateId);
    expect(hypotheses2[0].candidateBinding).toBe(hypotheses1[0].candidateBinding);
  });

  it('strictly enforces capability boundaries across multi-stage outputs and rejects non-authoritative artifacts', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo_test',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: validSource }],
      },
      org,
    );

    const expressIngestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
    const bridge = createSqlCandidateBridge(async () => commitSha);
    const hypotheses = await bridge(analysis, snapshot, expressIngestion, org);
    expect(hypotheses).toHaveLength(1);

    const mockBody = {
      version: 'velnar-repository-ingestion-v1' as const,
      organizationId: org,
      repositoryId: 'repo_test',
      commitSha,
      snapshot,
    };
    const ingestionIdentity = await hash('velnar-repository-ingestion-v1', mockBody);
    const mockIngestion: RepositoryIngestion = {
      ...mockBody,
      ingestionIdentity,
    };

    expect(isTrustedCommitCapability(hypotheses[0].candidate, mockIngestion)).toBe(false);
    expect(isTrustedCommitCapability(hypotheses[0], mockIngestion)).toBe(false);
    expect(() => assertTrustedCommitCapability(hypotheses[0].candidate, mockIngestion)).toThrow('unauthorized commit capability');

    expect(isTrustedCommitCapability(analysis, mockIngestion)).toBe(false);
    expect(isTrustedCommitCapability(expressIngestion, mockIngestion)).toBe(false);
    expect(isTrustedCommitCapability(snapshot, mockIngestion)).toBe(false);

    const forgedCapability = Object.freeze({
      [Symbol.toStringTag]: 'TrustedCommitCapability' as const,
    });
    expect(isTrustedCommitCapability(forgedCapability, mockIngestion)).toBe(false);
    expect(() => assertTrustedCommitCapability(forgedCapability, mockIngestion)).toThrow('unauthorized commit capability');

    const validated = await validateRepositoryIngestion(mockIngestion, org);
    expect(validated.ingestionIdentity).toBe(ingestionIdentity);

    const tampered = {
      ...mockIngestion,
      commitSha: '2222222222222222222222222222222222222222',
    };
    await expect(validateRepositoryIngestion(tampered, org)).rejects.toThrow();
    await expect(validateRepositoryIngestion(mockIngestion, 'org_foreign')).rejects.toThrow();
  });
});
