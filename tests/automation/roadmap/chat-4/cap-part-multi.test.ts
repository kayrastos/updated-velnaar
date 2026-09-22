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
import {
  assertTrustedCommitCapability,
  isTrustedCommitCapability,
  validateRepositoryIngestion,
} from '../../../../worker/intelligence/ingestion/repository';

describe('Capability Enforcement - Multi-Stage Partial Input Fail-Closed', () => {
  const org = 'org_test_cap_part';
  const repoId = 'repo-part-multi';

  const validSource = `import express from 'express';

export function createApp(db: any) {
  function userHandler(req: any, res: any) {
    const name = req.query.name;
    const stmt = db.prepare('SELECT * FROM users WHERE name = ' + name);
    res.json(stmt.all());
  }

  const app = express();
  app.get('/users', userHandler);
  return app;
}
`;

  async function createValidSnapshot(): Promise<SourceSnapshot> {
    return captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: repoId,
        organizationId: org,
        files: [{ path: 'src/routes.ts', content: validSource }],
      },
      org,
    );
  }

  it('fails closed on partial inputs at Stage 1 (snapshot capture and validation)', async () => {
    await expect(captureSnapshot(null, org)).rejects.toThrow();
    await expect(captureSnapshot({}, org)).rejects.toThrow();
    await expect(
      captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: repoId,
        },
        org,
      ),
    ).rejects.toThrow();
    await expect(
      captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: repoId,
          organizationId: org,
          files: [],
        },
        org,
      ),
    ).rejects.toThrow();
    await expect(
      captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: repoId,
          organizationId: org,
          files: [{ path: 'src/routes.ts' }],
        },
        org,
      ),
    ).rejects.toThrow();

    await expect(validateSnapshot(null, org)).rejects.toThrow();
    await expect(validateSnapshot({}, org)).rejects.toThrow();
    await expect(
      validateSnapshot(
        {
          version: 'velnar-local-source-snapshot-v2',
          fixtureId: 'm2-case-001',
          repositoryId: repoId,
          organizationId: org,
        },
        org,
      ),
    ).rejects.toThrow();
  });

  it('fails closed on partial inputs at Stage 2 (Express ingestion and validation)', async () => {
    const snapshot = await createValidSnapshot();

    await expect(ingestExpress(null, org)).rejects.toThrow();
    await expect(ingestExpress({}, org)).rejects.toThrow();
    await expect(
      ingestExpress(
        {
          version: snapshot.version,
          snapshotId: snapshot.snapshotId,
        },
        org,
      ),
    ).rejects.toThrow();

    await expect(validateExpressIngestion(null as any, org)).rejects.toThrow();
    await expect(validateExpressIngestion({} as any, org)).rejects.toThrow();
    await expect(
      validateExpressIngestion(
        {
          version: 'velnar-express-ingestion-v1',
          snapshot,
        } as any,
        org,
      ),
    ).rejects.toThrow();
  });

  it('fails closed on partial inputs at Stage 3 (SQL detection and analysis validation)', async () => {
    const snapshot = await createValidSnapshot();
    const expressIngestion = await ingestExpress(snapshot, org);

    await expect(detectSqlInjection(null as any, expressIngestion, org)).rejects.toThrow();
    await expect(detectSqlInjection(snapshot, null as any, org)).rejects.toThrow();
    await expect(
      detectSqlInjection(
        { ...snapshot, snapshotId: 'sha256:corrupted' },
        expressIngestion,
        org,
      ),
    ).rejects.toThrow();

    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
    expect(analysis.status).toBe('DETECTED');

    await expect(validateSqlAnalysis(null, snapshot, expressIngestion, org)).rejects.toThrow();
    await expect(validateSqlAnalysis({}, snapshot, expressIngestion, org)).rejects.toThrow();
    await expect(
      validateSqlAnalysis(
        {
          version: analysis.version,
          ruleId: analysis.ruleId,
          status: analysis.status,
        },
        snapshot,
        expressIngestion,
        org,
      ),
    ).rejects.toThrow();
  });

  it('fails closed on partial inputs at Stage 4 (candidate bridge and commit verification)', async () => {
    const snapshot = await createValidSnapshot();
    const expressIngestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);

    const validCommitSha = 'a'.repeat(40);
    const bridge = createSqlCandidateBridge(async () => validCommitSha);

    await expect(bridge(null, snapshot, expressIngestion, org)).rejects.toThrow();
    await expect(bridge(analysis, null as any, expressIngestion, org)).rejects.toThrow();
    await expect(bridge(analysis, snapshot, null as any, org)).rejects.toThrow();
    await expect(
      bridge(
        { ...analysis, status: 'NOT_DETECTED' },
        snapshot,
        expressIngestion,
        org,
      ),
    ).rejects.toThrow();

    const emptyShaBridge = createSqlCandidateBridge(async () => '');
    await expect(
      emptyShaBridge(analysis, snapshot, expressIngestion, org),
    ).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const shortShaBridge = createSqlCandidateBridge(async () => 'abc123');
    await expect(
      shortShaBridge(analysis, snapshot, expressIngestion, org),
    ).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const zeroShaBridge = createSqlCandidateBridge(async () => '0'.repeat(40));
    await expect(
      zeroShaBridge(analysis, snapshot, expressIngestion, org),
    ).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
  });

  it('enforces capability boundaries and fails closed on partial capability and ingestion objects', async () => {
    const snapshot = await createValidSnapshot();
    const validCommitSha = 'b'.repeat(40);

    const partialCapability = {};
    const taggedCapability = { [Symbol.toStringTag]: 'TrustedCommitCapability' };

    const partialIngestion: any = {
      version: 'velnar-repository-ingestion-v1',
      organizationId: org,
      repositoryId: repoId,
      commitSha: validCommitSha,
    };

    expect(isTrustedCommitCapability(partialCapability, partialIngestion)).toBe(false);
    expect(isTrustedCommitCapability(taggedCapability, partialIngestion)).toBe(false);
    expect(isTrustedCommitCapability(null, partialIngestion)).toBe(false);
    expect(isTrustedCommitCapability(undefined, partialIngestion)).toBe(false);

    expect(() =>
      assertTrustedCommitCapability(partialCapability, partialIngestion),
    ).toThrow('unauthorized commit capability');
    expect(() =>
      assertTrustedCommitCapability(taggedCapability, partialIngestion),
    ).toThrow('unauthorized commit capability');

    await expect(validateRepositoryIngestion(null, org)).rejects.toThrow();
    await expect(validateRepositoryIngestion({}, org)).rejects.toThrow();
    await expect(validateRepositoryIngestion(partialIngestion, org)).rejects.toThrow();

    const fullValidBody = {
      version: 'velnar-repository-ingestion-v1' as const,
      organizationId: org,
      repositoryId: repoId,
      commitSha: validCommitSha,
      snapshot,
      ingestionIdentity: 'sha256:placeholder',
    };
    await expect(validateRepositoryIngestion(fullValidBody, org)).rejects.toThrow();
  });

  it('ensures candidates never mint capability and partial multi-stage flows remain non-authoritative', async () => {
    const snapshot = await createValidSnapshot();
    const expressIngestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);

    const validCommitSha = 'c'.repeat(40);
    const bridge = createSqlCandidateBridge(async () => validCommitSha);
    const candidateResults = await bridge(analysis, snapshot, expressIngestion, org);

    expect(candidateResults.length).toBeGreaterThan(0);
    for (const hypothesis of candidateResults) {
      expect(hypothesis.candidate.verificationState).toBe('CANDIDATE');
      expect(isTrustedCommitCapability(hypothesis.candidate, {} as any)).toBe(false);
      expect(isTrustedCommitCapability(hypothesis, {} as any)).toBe(false);
      expect(() =>
        assertTrustedCommitCapability(hypothesis.candidate, {} as any),
      ).toThrow('unauthorized commit capability');
    }
  });
});
