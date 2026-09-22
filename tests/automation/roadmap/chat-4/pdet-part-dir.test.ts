import { describe, it, expect } from 'vitest';
import {
  captureSnapshot,
  validateSnapshot,
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
  validateRepositoryIngestion,
  ingestRepository,
  isTrustedCommitCapability,
  assertTrustedCommitCapability,
} from '../../../../worker/intelligence/ingestion/repository';

const org = 'org_pdet_part';
const repo = 'repo_pdet_part';
const fixture = 'm2-case-001';

const validAppSource = `import express from 'express';

export function createApp(db: any) {
  const app = express();
  function handleRoot(req: any, res: any) {
    return;
  }
  app.get('/health', handleRoot);
  return app;
}
`;

const emptyRoutesSource = `import express from 'express';

export function createApp(db: any) {
  const app = express();
  return app;
}
`;

async function createBaseline() {
  const snapshot = await captureSnapshot(
    {
      fixtureId: fixture,
      repositoryId: repo,
      organizationId: org,
      files: [
        {
          path: 'src/app.ts',
          content: validAppSource,
        },
      ],
    },
    org,
  );
  const ingestion = await ingestExpress(snapshot, org);
  return { snapshot, ingestion };
}

describe('Platform Integration - Pipeline Determinism Partial Input Fail-Closed (Direct)', () => {
  it('fails closed on partial top-level captureSnapshot input fields', async () => {
    const files = [{ path: 'src/app.ts', content: validAppSource }];

    await expect(
      captureSnapshot(
        { repositoryId: repo, organizationId: org, files } as any,
        org,
      ),
    ).rejects.toThrow('unknown or missing metadata');

    await expect(
      captureSnapshot(
        { fixtureId: fixture, organizationId: org, files } as any,
        org,
      ),
    ).rejects.toThrow('unknown or missing metadata');

    await expect(
      captureSnapshot(
        { fixtureId: fixture, repositoryId: repo, files } as any,
        org,
      ),
    ).rejects.toThrow('unknown or missing metadata');

    await expect(
      captureSnapshot(
        { fixtureId: fixture, repositoryId: repo, organizationId: org } as any,
        org,
      ),
    ).rejects.toThrow('unknown or missing metadata');
  });

  it('fails closed on partial file descriptors and empty file arrays in captureSnapshot', async () => {
    await expect(
      captureSnapshot(
        {
          fixtureId: fixture,
          repositoryId: repo,
          organizationId: org,
          files: [],
        },
        org,
      ),
    ).rejects.toThrow('array bounds or shape');

    await expect(
      captureSnapshot(
        {
          fixtureId: fixture,
          repositoryId: repo,
          organizationId: org,
          files: [{ content: validAppSource }] as any,
        },
        org,
      ),
    ).rejects.toThrow('unknown or missing metadata');

    await expect(
      captureSnapshot(
        {
          fixtureId: fixture,
          repositoryId: repo,
          organizationId: org,
          files: [{ path: 'src/app.ts' }] as any,
        },
        org,
      ),
    ).rejects.toThrow('unknown or missing metadata');
  });

  it('fails closed on partial snapshot records during validateSnapshot', async () => {
    const { snapshot } = await createBaseline();

    const withoutSnapshotId = { ...snapshot } as any;
    delete withoutSnapshotId.snapshotId;
    await expect(validateSnapshot(withoutSnapshotId, org)).rejects.toThrow(
      'unknown or missing metadata',
    );

    const withoutTotalBytes = { ...snapshot } as any;
    delete withoutTotalBytes.totalBytes;
    await expect(validateSnapshot(withoutTotalBytes, org)).rejects.toThrow(
      'unknown or missing metadata',
    );

    const withoutVersion = { ...snapshot } as any;
    delete withoutVersion.version;
    await expect(validateSnapshot(withoutVersion, org)).rejects.toThrow(
      'unknown or missing metadata',
    );

    const partialFiles = snapshot.files.map((file) => {
      const copy = { ...file } as any;
      delete copy.contentDigest;
      return copy;
    });
    const withPartialFile = { ...snapshot, files: partialFiles };
    await expect(validateSnapshot(withPartialFile as any, org)).rejects.toThrow(
      'unknown or missing metadata',
    );
  });

  it('fails closed on partial snapshots and empty route topologies in Express ingestion', async () => {
    const partialSnapshot: any = {
      version: 'velnar-local-source-snapshot-v2',
      fixtureId: fixture,
      repositoryId: repo,
      organizationId: org,
      totalBytes: 100,
    };
    await expect(ingestExpress(partialSnapshot, org)).rejects.toThrow(
      'unknown or missing metadata',
    );

    const emptyRoutesSnapshot = await captureSnapshot(
      {
        fixtureId: fixture,
        repositoryId: repo,
        organizationId: org,
        files: [{ path: 'src/app.ts', content: emptyRoutesSource }],
      },
      org,
    );
    await expect(ingestExpress(emptyRoutesSnapshot, org)).rejects.toThrow(
      'no supported Express route',
    );
  });

  it('fails closed on partial Express ingestion records during validation', async () => {
    const { ingestion } = await createBaseline();

    const withoutRoutes = { ...ingestion } as any;
    delete withoutRoutes.routes;
    await expect(validateExpressIngestion(withoutRoutes, org)).rejects.toThrow(
      'unknown or missing metadata',
    );

    const withoutSourceUnits = { ...ingestion } as any;
    delete withoutSourceUnits.sourceUnits;
    await expect(validateExpressIngestion(withoutSourceUnits, org)).rejects.toThrow(
      'unknown or missing metadata',
    );

    const withoutIdentity = { ...ingestion } as any;
    delete withoutIdentity.ingestionIdentity;
    await expect(validateExpressIngestion(withoutIdentity, org)).rejects.toThrow(
      'unknown or missing metadata',
    );

    const withoutSnapshot = { ...ingestion } as any;
    delete withoutSnapshot.snapshot;
    await expect(validateExpressIngestion(withoutSnapshot, org)).rejects.toThrow(
      'unknown or missing metadata',
    );
  });

  it('fails closed on partial detection inputs and mismatched snapshot linkages', async () => {
    const { snapshot, ingestion } = await createBaseline();

    const partialSnapshot = { ...snapshot } as any;
    delete partialSnapshot.snapshotId;
    await expect(
      detectSqlInjection(partialSnapshot, ingestion, org),
    ).rejects.toThrow('unknown or missing metadata');

    const partialIngestion = { ...ingestion } as any;
    delete partialIngestion.routes;
    await expect(
      detectSqlInjection(snapshot, partialIngestion, org),
    ).rejects.toThrow('unknown or missing metadata');

    const mismatchedSnapshot = {
      ...snapshot,
      snapshotId: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    };
    await expect(
      detectSqlInjection(mismatchedSnapshot, ingestion, org),
    ).rejects.toThrow();
  });

  it('fails closed on partial analysis records during validateSqlAnalysis', async () => {
    const { snapshot, ingestion } = await createBaseline();
    const genuineAnalysis = await detectSqlInjection(snapshot, ingestion, org);

    const withoutFingerprint = { ...genuineAnalysis } as any;
    delete withoutFingerprint.resultFingerprint;
    await expect(
      validateSqlAnalysis(withoutFingerprint, snapshot, ingestion, org),
    ).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');

    const withoutFindings = { ...genuineAnalysis } as any;
    delete withoutFindings.findings;
    await expect(
      validateSqlAnalysis(withoutFindings, snapshot, ingestion, org),
    ).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');

    const withoutStatus = { ...genuineAnalysis } as any;
    delete withoutStatus.status;
    await expect(
      validateSqlAnalysis(withoutStatus, snapshot, ingestion, org),
    ).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
  });

  it('fails closed on partial bridge inputs and refused candidate authority', async () => {
    const { snapshot, ingestion } = await createBaseline();
    const genuineAnalysis = await detectSqlInjection(snapshot, ingestion, org);
    const bridge = createSqlCandidateBridge(async () => '1'.repeat(40));

    const candidates = await bridge(genuineAnalysis, snapshot, ingestion, org);
    expect(candidates).toEqual([]);
    expect(Object.isFrozen(candidates)).toBe(true);

    const partialAnalysis = { ...genuineAnalysis } as any;
    delete partialAnalysis.resultFingerprint;
    await expect(
      bridge(partialAnalysis, snapshot, ingestion, org),
    ).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');

    const partialSnapshot = { ...snapshot } as any;
    delete partialSnapshot.snapshotId;
    await expect(
      bridge(genuineAnalysis, partialSnapshot, ingestion, org),
    ).rejects.toThrow('unknown or missing metadata');

    const partialIngestion = { ...ingestion } as any;
    delete partialIngestion.routes;
    await expect(
      bridge(genuineAnalysis, snapshot, partialIngestion, org),
    ).rejects.toThrow('unknown or missing metadata');
  });

  it('fails closed on partial repository ingestion records and options', async () => {
    const { snapshot } = await createBaseline();
    const partialRecord: any = {
      version: 'velnar-repository-ingestion-v1',
      organizationId: org,
      repositoryId: repo,
      commitSha: 'a'.repeat(40),
      snapshot,
    };
    await expect(
      validateRepositoryIngestion(partialRecord, org),
    ).rejects.toThrow('unknown or missing metadata');

    const truncatedCommitSha = {
      ...partialRecord,
      commitSha: '1234',
      ingestionIdentity: 'sha256:1111',
    };
    await expect(
      validateRepositoryIngestion(truncatedCommitSha, org),
    ).rejects.toThrow('Git commit identity');

    await expect(
      ingestRepository({
        repositoryPath: 'C:\\valid\\path',
        repositoryId: repo,
      } as any),
    ).rejects.toThrow('identifier');

    await expect(
      ingestRepository({
        repositoryPath: 'C:\\valid\\path',
        organizationId: org,
      } as any),
    ).rejects.toThrow('identifier');

    await expect(
      ingestRepository({
        organizationId: org,
        repositoryId: repo,
      } as any),
    ).rejects.toThrow('network/device-qualified repository path refused');

    await expect(
      ingestRepository({
        repositoryPath: '',
        organizationId: org,
        repositoryId: repo,
      }),
    ).rejects.toThrow('network/device-qualified repository path refused');
  });

  it('refuses partial or unminted commit capabilities unconditionally', async () => {
    const { snapshot } = await createBaseline();
    const fakeIngestion: any = {
      version: 'velnar-repository-ingestion-v1',
      organizationId: org,
      repositoryId: repo,
      commitSha: 'a'.repeat(40),
      snapshot,
      ingestionIdentity: 'sha256:0000',
    };

    expect(isTrustedCommitCapability({}, fakeIngestion)).toBe(false);
    expect(
      isTrustedCommitCapability(
        { [Symbol.toStringTag]: 'TrustedCommitCapability' },
        fakeIngestion,
      ),
    ).toBe(false);
    expect(isTrustedCommitCapability(null, fakeIngestion)).toBe(false);
    expect(isTrustedCommitCapability(undefined, fakeIngestion)).toBe(false);

    expect(() => assertTrustedCommitCapability({}, fakeIngestion)).toThrow(
      'unauthorized commit capability',
    );
    expect(() => assertTrustedCommitCapability(null, fakeIngestion)).toThrow(
      'unauthorized commit capability',
    );
    expect(() => assertTrustedCommitCapability(undefined, fakeIngestion)).toThrow(
      'unauthorized commit capability',
    );
  });

  it('guarantees deterministic fail-closed behavior across repeated evaluations', async () => {
    const files = [{ path: 'src/app.ts', content: validAppSource }];
    const partialInput = { repositoryId: repo, organizationId: org, files } as any;

    const snapshotErrors: string[] = [];
    for (let i = 0; i < 5; i++) {
      let threw = false;
      try {
        await captureSnapshot(partialInput, org);
      } catch (err: any) {
        threw = true;
        snapshotErrors.push(err.message);
      }
      expect(threw).toBe(true);
    }
    expect(snapshotErrors).toHaveLength(5);
    expect(new Set(snapshotErrors).size).toBe(1);
    expect(snapshotErrors[0]).toContain('unknown or missing metadata');

    const repoOptionErrors: string[] = [];
    for (let i = 0; i < 5; i++) {
      let threw = false;
      try {
        await ingestRepository({
          repositoryPath: '',
          organizationId: org,
          repositoryId: repo,
        });
      } catch (err: any) {
        threw = true;
        repoOptionErrors.push(err.message);
      }
      expect(threw).toBe(true);
    }
    expect(repoOptionErrors).toHaveLength(5);
    expect(new Set(repoOptionErrors).size).toBe(1);
    expect(repoOptionErrors[0]).toContain('network/device-qualified repository path refused');
  });
});
