import { describe, it, expect } from 'vitest';
import { captureSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import {
  isTrustedCommitCapability,
  assertTrustedCommitCapability,
  type RepositoryIngestion,
} from '../../../../worker/intelligence/ingestion/repository';

describe('Capability enforcement for multi-hop flow with nested router mount (RM_CAP_MHOP_NEST)', () => {
  const org = 'org_mhop_nest';
  const commitSha = 'c0ffee'.repeat(6) + 'beef';

  const appSource = `import express from 'express';

function stepTwo(value: string): string {
  return value;
}

function stepOne(value: string): string {
  return stepTwo(value);
}

export function createApp(db: any) {
  const app = express();
  const router = express.Router();

  function searchHandler(req: any, res: any) {
    const tainted = stepOne(req.query.id);
    const stmt = db.prepare('SELECT * FROM items WHERE id = ' + tainted);
    const rows = stmt.all();
    return res.json(rows);
  }

  router.get('/search', searchHandler);
  app.use('/api', router);

  return app;
}
`;

  it('detects multi-hop SQL injection flow across nested calls under router mount and produces candidate hypothesis', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-mhop-nest',
        organizationId: org,
        files: [
          {
            path: 'src/app.ts',
            content: appSource,
          },
        ],
      },
      org,
    );

    const expressIngestion = await ingestExpress(snapshot, org);
    expect(expressIngestion.routes).toHaveLength(1);
    expect(expressIngestion.routes[0].path).toBe('/api/search');
    expect(expressIngestion.routes[0].ownerKind).toBe('ROUTER');

    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
    expect(analysis.status).toBe('DETECTED');
    expect(analysis.findings).toHaveLength(1);

    const finding = analysis.findings[0];
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.routeIdentity).toBe(expressIngestion.routes[0].routeIdentity);

    const kinds = finding.flow.map((step) => step.kind);
    expect(kinds).toContain('SOURCE');
    expect(kinds).toContain('CALL');
    expect(kinds).toContain('ARGUMENT');
    expect(kinds).toContain('RETURN');
    expect(kinds).toContain('CONCAT');
    expect(kinds).toContain('SINK');

    const bridge = createSqlCandidateBridge(async (snap) => {
      expect(snap.snapshotId).toBe(snapshot.snapshotId);
      return commitSha;
    });

    const hypotheses = await bridge(analysis, snapshot, expressIngestion, org);
    expect(hypotheses).toHaveLength(1);

    const hypothesis = hypotheses[0];
    expect(hypothesis.candidate.verificationState).toBe('CANDIDATE');
    expect(hypothesis.candidate.reachabilityState).toBe('REACHABLE');
    expect(hypothesis.candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(hypothesis.candidate.snapshot.commitSha).toBe(commitSha);
    expect(typeof hypothesis.candidateBinding).toBe('string');
  });

  it('enforces capability boundaries: non-authoritative analysis and candidates do not mint commit authority', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-mhop-nest',
        organizationId: org,
        files: [
          {
            path: 'src/app.ts',
            content: appSource,
          },
        ],
      },
      org,
    );

    const expressIngestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);

    const bridge = createSqlCandidateBridge(async () => commitSha);
    const hypotheses = await bridge(analysis, snapshot, expressIngestion, org);
    const candidate = hypotheses[0].candidate;

    expect((analysis as any).capability).toBeUndefined();
    expect((candidate as any).capability).toBeUndefined();
    expect((candidate as any).verificationState).not.toBe('VERIFIED');

    const dummyIngestion: RepositoryIngestion = {
      version: 'velnar-repository-ingestion-v1',
      organizationId: org,
      repositoryId: 'repo-mhop-nest',
      commitSha,
      snapshot,
      ingestionIdentity: 'sha256:' + '0'.repeat(64),
    };

    expect(isTrustedCommitCapability(analysis, dummyIngestion)).toBe(false);
    expect(isTrustedCommitCapability(candidate, dummyIngestion)).toBe(false);
    expect(isTrustedCommitCapability({}, dummyIngestion)).toBe(false);

    expect(() => assertTrustedCommitCapability(analysis, dummyIngestion)).toThrow('unauthorized commit capability');
    expect(() => assertTrustedCommitCapability(candidate, dummyIngestion)).toThrow('unauthorized commit capability');
  });

  it('fails closed when commit verification returns an invalid or forged commit sha', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-mhop-nest',
        organizationId: org,
        files: [
          {
            path: 'src/app.ts',
            content: appSource,
          },
        ],
      },
      org,
    );

    const expressIngestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);

    const zeroShaBridge = createSqlCandidateBridge(async () => '0'.repeat(40));
    await expect(zeroShaBridge(analysis, snapshot, expressIngestion, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const invalidShaBridge = createSqlCandidateBridge(async () => 'invalid-commit-sha');
    await expect(invalidShaBridge(analysis, snapshot, expressIngestion, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
  });
});
