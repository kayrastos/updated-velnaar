import { describe, it, expect } from 'vitest';
import {
  isTrustedCommitCapability,
  assertTrustedCommitCapability,
  validateRepositoryIngestion,
} from '../../../../worker/intelligence/ingestion/repository';
import {
  captureSnapshot,
  validateSnapshot,
  detachJson,
  hash,
} from '../../../../worker/intelligence/ingestion/snapshot';

describe('Roadmap Chat-4: Capability Enforcement and Normalization Boundary (Nested)', () => {
  const orgId = 'org_cap_norm_nest';
  const repoId = 'repo-cap-nest';

  async function createValidFixture() {
    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: repoId,
        organizationId: orgId,
        files: [
          {
            path: 'src/routes.ts',
            content: 'export const status = "active";\n',
          },
        ],
      },
      orgId,
    );

    const commitSha = 'a'.repeat(40);
    const body = {
      version: 'velnar-repository-ingestion-v1' as const,
      organizationId: orgId,
      repositoryId: repoId,
      commitSha,
      snapshot,
    };
    const ingestionIdentity = await hash('velnar-repository-ingestion-v1', body);

    return {
      record: {
        ...body,
        ingestionIdentity,
      },
      snapshot,
      commitSha,
    };
  }

  it('enforces that nested structural normalization does not mint trusted commit capabilities', async () => {
    const { record } = await createValidFixture();

    const validated = await validateRepositoryIngestion(record, orgId);

    expect((validated as any).capability).toBeUndefined();

    const forgedEmpty = {};
    const forgedTag = { [Symbol.toStringTag]: 'TrustedCommitCapability' };
    const forgedFrozen = Object.freeze({ [Symbol.toStringTag]: 'TrustedCommitCapability' });

    expect(isTrustedCommitCapability(forgedEmpty, validated)).toBe(false);
    expect(isTrustedCommitCapability(forgedTag, validated)).toBe(false);
    expect(isTrustedCommitCapability(forgedFrozen, validated)).toBe(false);
    expect(isTrustedCommitCapability(null, validated)).toBe(false);
    expect(isTrustedCommitCapability(undefined, validated)).toBe(false);

    expect(() => assertTrustedCommitCapability(forgedTag, validated)).toThrow(
      'unauthorized commit capability',
    );
  });

  it('rejects nested property tampering across snapshot and repository normalization boundaries', async () => {
    const { record, snapshot } = await createValidFixture();

    const tamperedSnapshotId = {
      ...record,
      snapshot: {
        ...snapshot,
        snapshotId: 'sha256:' + 'f'.repeat(64),
      },
    };

    await expect(
      validateRepositoryIngestion(tamperedSnapshotId, orgId),
    ).rejects.toThrow('snapshot integrity mismatch');

    const mismatchedTenantSnapshot = {
      ...record,
      snapshot: {
        ...snapshot,
        organizationId: 'foreign_org',
      },
    };

    await expect(
      validateRepositoryIngestion(mismatchedTenantSnapshot, orgId),
    ).rejects.toThrow();
  });

  it('fails closed on nested prototype pollution and accessor injection at normalization boundaries', async () => {
    const { record } = await createValidFixture();

    const accessorRecord = {
      ...record,
      get organizationId() {
        return orgId;
      },
    };

    await expect(
      validateRepositoryIngestion(accessorRecord, orgId),
    ).rejects.toThrow('data fields required');

    const prototypeRecord = {
      ...record,
      snapshot: Object.create({ inherited: true }, Object.getOwnPropertyDescriptors(record.snapshot)),
    };

    await expect(
      validateRepositoryIngestion(prototypeRecord, orgId),
    ).rejects.toThrow('plain object required');

    let nestedDeep: any = 'leaf';
    for (let depth = 0; depth < 20; depth++) {
      nestedDeep = { child: nestedDeep };
    }

    expect(() => detachJson(nestedDeep)).toThrow('metadata complexity');
  });

  it('enforces path normalization boundaries on nested snapshot file definitions', async () => {
    await expect(
      captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: repoId,
          organizationId: orgId,
          files: [
            {
              path: 'src/../routes.ts',
              content: 'export const bad = true;\n',
            },
          ],
        },
        orgId,
      ),
    ).rejects.toThrow('path component');

    await expect(
      captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: repoId,
          organizationId: orgId,
          files: [
            {
              path: 'src//routes.ts',
              content: 'export const bad = true;\n',
            },
          ],
        },
        orgId,
      ),
    ).rejects.toThrow('path component');

    await expect(
      captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: repoId,
          organizationId: orgId,
          files: [
            {
              path: 'src/types.d.ts',
              content: 'export type X = number;\n',
            },
          ],
        },
        orgId,
      ),
    ).rejects.toThrow('unsupported extension');
  });

  it('ensures capability verification cannot be bypassed through nested wrapper objects', async () => {
    const { record } = await createValidFixture();
    const validated = await validateRepositoryIngestion(record, orgId);

    const wrapped = {
      nested: {
        capability: { [Symbol.toStringTag]: 'TrustedCommitCapability' },
      },
    };

    expect(isTrustedCommitCapability(wrapped, validated)).toBe(false);
    expect(isTrustedCommitCapability(wrapped.nested, validated)).toBe(false);
    expect(isTrustedCommitCapability(wrapped.nested.capability, validated)).toBe(false);

    expect(() => assertTrustedCommitCapability(wrapped, validated)).toThrow(
      'unauthorized commit capability',
    );
  });
});
