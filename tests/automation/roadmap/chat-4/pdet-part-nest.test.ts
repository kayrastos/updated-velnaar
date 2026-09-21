import { describe, it, expect } from 'vitest';
import { captureSnapshot, validateSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { validateRepositoryIngestion } from '../../../../worker/intelligence/ingestion/repository';
import { ingestExpress } from '../../../../worker/intelligence/ingestion/express';

describe('Pipeline Determinism - Partial Input Fail-Closed (Nested)', () => {
  const org = 'org_pdet_nest';

  it('fails closed when snapshot input contains partial nested file entries', async () => {
    await expect(
      captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: 'repo-pdet-nest',
          organizationId: org,
          files: [{ path: 'src/routes.ts' }],
        },
        org,
      ),
    ).rejects.toThrow('unknown or missing metadata');

    await expect(
      captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: 'repo-pdet-nest',
          organizationId: org,
          files: [{ content: 'export const value = 42;\n' }],
        },
        org,
      ),
    ).rejects.toThrow('unknown or missing metadata');

    await expect(
      captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: 'repo-pdet-nest',
          organizationId: org,
          files: [
            {
              path: 'src/routes.ts',
              content: 'export const value = 42;\n',
              extra: true,
            },
          ],
        },
        org,
      ),
    ).rejects.toThrow('unknown or missing metadata');
  });

  it('fails closed when snapshot validation encounters partial nested file descriptors', async () => {
    const genuine = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-pdet-nest',
        organizationId: org,
        files: [{ path: 'src/routes.ts', content: 'export const value = 42;\n' }],
      },
      org,
    );

    await expect(
      validateSnapshot(
        {
          version: genuine.version,
          fixtureId: genuine.fixtureId,
          repositoryId: genuine.repositoryId,
          organizationId: genuine.organizationId,
          snapshotId: genuine.snapshotId,
          totalBytes: genuine.totalBytes,
          files: [
            {
              path: genuine.files[0].path,
              content: genuine.files[0].content,
              byteLength: genuine.files[0].byteLength,
              contentDigest: genuine.files[0].contentDigest,
            },
          ],
        },
        org,
      ),
    ).rejects.toThrow('unknown or missing metadata');

    await expect(
      validateSnapshot(
        {
          version: genuine.version,
          fixtureId: genuine.fixtureId,
          repositoryId: genuine.repositoryId,
          organizationId: genuine.organizationId,
          snapshotId: genuine.snapshotId,
          totalBytes: genuine.totalBytes,
          files: [
            {
              path: genuine.files[0].path,
              content: genuine.files[0].content,
              byteLength: genuine.files[0].byteLength,
              fileIdentity: genuine.files[0].fileIdentity,
            },
          ],
        },
        org,
      ),
    ).rejects.toThrow('unknown or missing metadata');
  });

  it('fails closed when repository ingestion contains partial nested snapshot structures', async () => {
    await expect(
      validateRepositoryIngestion(
        {
          version: 'velnar-repository-ingestion-v1',
          organizationId: org,
          repositoryId: 'repo-pdet-nest',
          commitSha: 'a'.repeat(40),
          snapshot: {
            version: 'velnar-local-source-snapshot-v2',
            fixtureId: 'm2-case-001',
            repositoryId: 'repo-pdet-nest',
            organizationId: org,
          },
          ingestionIdentity: 'sha256:' + '0'.repeat(64),
        },
        org,
      ),
    ).rejects.toThrow('unknown or missing metadata');

    await expect(
      validateRepositoryIngestion(
        {
          version: 'velnar-repository-ingestion-v1',
          organizationId: org,
          repositoryId: 'repo-pdet-nest',
          commitSha: 'a'.repeat(40),
          snapshot: {
            version: 'velnar-local-source-snapshot-v2',
            fixtureId: 'm2-case-001',
            repositoryId: 'repo-pdet-nest',
            organizationId: org,
            snapshotId: 'sha256:' + '0'.repeat(64),
            totalBytes: 25,
            files: [
              {
                path: 'src/routes.ts',
                content: 'export const value = 42;\n',
              },
            ],
          },
          ingestionIdentity: 'sha256:' + '0'.repeat(64),
        },
        org,
      ),
    ).rejects.toThrow('unknown or missing metadata');
  });

  it('fails closed when Express ingestion receives a snapshot with partial nested files', async () => {
    await expect(
      ingestExpress(
        {
          version: 'velnar-local-source-snapshot-v2',
          fixtureId: 'm2-case-001',
          repositoryId: 'repo-pdet-nest',
          organizationId: org,
          snapshotId: 'sha256:' + '0'.repeat(64),
          totalBytes: 25,
          files: [
            {
              path: 'src/routes.ts',
              content: 'export const value = 42;\n',
            },
          ],
        },
        org,
      ),
    ).rejects.toThrow('unknown or missing metadata');
  });

  it('deterministically fails closed across repeated invocations with identical partial nested inputs', async () => {
    const partialPayload = {
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-pdet-nest',
      organizationId: org,
      files: [{ path: 'src/routes.ts' }],
    };

    const run1 = captureSnapshot(partialPayload, org);
    const run2 = captureSnapshot(partialPayload, org);

    await expect(run1).rejects.toThrow('unknown or missing metadata');
    await expect(run2).rejects.toThrow('unknown or missing metadata');
  });
});
