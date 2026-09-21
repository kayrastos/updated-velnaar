import { describe, it, expect } from 'vitest';
import {
  captureSnapshot,
  validateSnapshot,
  hash,
  type SourceSnapshot,
} from '../../../../worker/intelligence/ingestion/snapshot';
import {
  ingestExpress,
  validateExpressIngestion,
  type ExpressIngestion,
} from '../../../../worker/intelligence/ingestion/express';
import {
  detectSqlInjection,
  validateSqlAnalysis,
} from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import {
  isTrustedCommitCapability,
  assertTrustedCommitCapability,
  validateRepositoryIngestion,
  type RepositoryIngestion,
} from '../../../../worker/intelligence/ingestion/repository';

const org = 'org_test';
const validCommitSha = 'a'.repeat(40);

const vulnerableSource = `import express from 'express';

export function createApp(db: any) {
  const app = express();

  function queryUser(req: any, res: any) {
    const userId = req.query.id;
    const sql = 'SELECT * FROM users WHERE id = ' + userId;
    const statement = db.prepare(sql);
    const rows = statement.all();
    res.json(rows);
  }

  app.get('/users', queryUser);
  return app;
}
`;

const cleanSource = `import express from 'express';

export function createApp(db: any) {
  const app = express();

  function listUsers(req: any, res: any) {
    const statement = db.prepare('SELECT * FROM users');
    const rows = statement.all();
    res.json(rows);
  }

  app.get('/users', listUsers);
  return app;
}
`;

async function buildMultiStageContext(sourceCode: string) {
  const snapshot = await captureSnapshot(
    {
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-cap-wrap-multi',
      organizationId: org,
      files: [{ path: 'src/app.ts', content: sourceCode }],
    },
    org,
  );

  const expressIngestion = await ingestExpress(snapshot, org);
  const sqlAnalysis = await detectSqlInjection(snapshot, expressIngestion, org);

  const ingestionRecordBody = {
    version: 'velnar-repository-ingestion-v1' as const,
    organizationId: org,
    repositoryId: 'repo-cap-wrap-multi',
    commitSha: validCommitSha,
    snapshot,
  };
  const ingestionIdentity = await hash('velnar-repository-ingestion-v1', ingestionRecordBody);
  const ingestionRecord = { ...ingestionRecordBody, ingestionIdentity };
  const repositoryIngestion = await validateRepositoryIngestion(ingestionRecord, org);

  return { snapshot, expressIngestion, sqlAnalysis, repositoryIngestion };
}

describe('Multi-Stage Capability Enforcement Wrapper Boundary', () => {
  it('enforces wrapper boundary where wrapper objects cannot mint or forge commit capability across stages', async () => {
    const { repositoryIngestion } = await buildMultiStageContext(vulnerableSource);

    const syntheticCapability = Object.freeze({
      [Symbol.toStringTag]: 'TrustedCommitCapability' as const,
    });
    expect(isTrustedCommitCapability(syntheticCapability, repositoryIngestion)).toBe(false);
    expect(() =>
      assertTrustedCommitCapability(syntheticCapability, repositoryIngestion),
    ).toThrow('unauthorized commit capability');

    const wrapperProxy = new Proxy(syntheticCapability, {});
    expect(isTrustedCommitCapability(wrapperProxy, repositoryIngestion)).toBe(false);
    expect(() =>
      assertTrustedCommitCapability(wrapperProxy, repositoryIngestion),
    ).toThrow('unauthorized commit capability');

    const delegatedWrapper = {
      innerCapability: syntheticCapability,
      stage: 'express-to-analysis',
    };
    expect(isTrustedCommitCapability(delegatedWrapper, repositoryIngestion)).toBe(false);
    expect(() =>
      assertTrustedCommitCapability(delegatedWrapper, repositoryIngestion),
    ).toThrow('unauthorized commit capability');
  });

  it('rejects wrapped or cloned ingestion records across multi-stage capability checks', async () => {
    const { repositoryIngestion } = await buildMultiStageContext(vulnerableSource);

    const wrappedIngestion = {
      ...repositoryIngestion,
      wrapperStage: 'pipeline-wrapper',
    };
    expect(isTrustedCommitCapability(repositoryIngestion, wrappedIngestion as any)).toBe(false);
    expect(() =>
      assertTrustedCommitCapability(repositoryIngestion, wrappedIngestion as any),
    ).toThrow('unauthorized commit capability');

    const jsonRoundTripIngestion = JSON.parse(JSON.stringify(repositoryIngestion));
    expect(isTrustedCommitCapability(repositoryIngestion, jsonRoundTripIngestion)).toBe(false);
    expect(() =>
      assertTrustedCommitCapability(repositoryIngestion, jsonRoundTripIngestion),
    ).toThrow('unauthorized commit capability');
  });

  it('fails closed when multi-stage verification wrapper enforces capability before bridging candidates', async () => {
    const { snapshot, expressIngestion, sqlAnalysis, repositoryIngestion } =
      await buildMultiStageContext(vulnerableSource);

    expect(sqlAnalysis.status).toBe('DETECTED');
    expect(sqlAnalysis.findings.length).toBeGreaterThan(0);

    const wrappedVerifier = async (cap: unknown, targetSnapshot: SourceSnapshot): Promise<string> => {
      assertTrustedCommitCapability(cap, repositoryIngestion);
      if (targetSnapshot.snapshotId !== repositoryIngestion.snapshot.snapshotId) {
        throw new Error('STAGE_SNAPSHOT_MISMATCH');
      }
      return repositoryIngestion.commitSha;
    };

    const forgedCapability = { [Symbol.toStringTag]: 'TrustedCommitCapability' };
    const bridgeWithForgedWrapper = createSqlCandidateBridge(async (s) =>
      wrappedVerifier(forgedCapability, s),
    );

    await expect(
      bridgeWithForgedWrapper(sqlAnalysis, snapshot, expressIngestion, org),
    ).rejects.toThrow('unauthorized commit capability');
  });

  it('rejects zeroed or non-hex commit SHA at candidate bridge wrapper boundary', async () => {
    const { snapshot, expressIngestion, sqlAnalysis } =
      await buildMultiStageContext(vulnerableSource);

    const zeroShaBridge = createSqlCandidateBridge(async () => '0'.repeat(40));
    await expect(
      zeroShaBridge(sqlAnalysis, snapshot, expressIngestion, org),
    ).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const invalidHexBridge = createSqlCandidateBridge(async () => 'not-a-valid-hex-commit-sha');
    await expect(
      invalidHexBridge(sqlAnalysis, snapshot, expressIngestion, org),
    ).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
  });

  it('preserves non-authoritative CANDIDATE status across stages when commit check succeeds', async () => {
    const { snapshot, expressIngestion, sqlAnalysis } =
      await buildMultiStageContext(vulnerableSource);

    const legitimateBridge = createSqlCandidateBridge(async (s) => {
      expect(s.snapshotId).toBe(snapshot.snapshotId);
      return validCommitSha;
    });

    const candidateHypotheses = await legitimateBridge(sqlAnalysis, snapshot, expressIngestion, org);
    expect(candidateHypotheses.length).toBeGreaterThan(0);

    for (const item of candidateHypotheses) {
      expect(item.candidate.verificationState).toBe('CANDIDATE');
      expect(item.candidate.reachabilityState).toBe('REACHABLE');
      expect((item.candidate as any).capability).toBeUndefined();
      expect((item.candidate as any).verifiedAuthority).toBeUndefined();
    }
  });

  it('yields empty candidate hypotheses for clean multi-stage flow without invoking verification wrapper', async () => {
    const { snapshot, expressIngestion, sqlAnalysis } =
      await buildMultiStageContext(cleanSource);

    expect(sqlAnalysis.status).toBe('NOT_DETECTED');
    expect(sqlAnalysis.findings).toHaveLength(0);

    let verifierInvoked = false;
    const bridge = createSqlCandidateBridge(async () => {
      verifierInvoked = true;
      return validCommitSha;
    });

    const result = await bridge(sqlAnalysis, snapshot, expressIngestion, org);
    expect(result).toHaveLength(0);
    expect(verifierInvoked).toBe(false);
  });
});
