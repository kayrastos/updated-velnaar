import { describe, it, expect } from 'vitest';
import {
  assertTrustedCommitCapability,
  isTrustedCommitCapability,
  validateRepositoryIngestion,
  type RepositoryIngestion,
} from '../../../../worker/intelligence/ingestion/repository';
import { detachJson } from '../../../../worker/intelligence/ingestion/snapshot';

const validIngestion: RepositoryIngestion = {
  version: 'velnar-repository-ingestion-v1',
  organizationId: 'org_m4',
  repositoryId: 'repo_cap_empty_nest',
  commitSha: 'a'.repeat(40),
  snapshot: {
    version: 'velnar-local-source-snapshot-v2',
    fixtureId: 'm2-case-001',
    repositoryId: 'repo_cap_empty_nest',
    organizationId: 'org_m4',
    snapshotId: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    totalBytes: 0,
    files: [],
  },
  ingestionIdentity: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
};

describe('Capability enforcement null-empty nested boundary', () => {
  it('rejects null and empty capability candidates wrapped in nested structures', () => {
    const nestedCandidates: unknown[] = [
      { capability: null },
      { capability: undefined },
      { capability: {} },
      { nested: { capability: null } },
      { nested: { capability: undefined } },
      { nested: { capability: {} } },
      { payload: { meta: { inner: { capability: null } } } },
      { target: Object.create(null) },
      { nested: [null, undefined, {}] },
      { get capability() { return null; } },
      { get capability() { return {}; } },
    ];

    for (const candidate of nestedCandidates) {
      expect(isTrustedCommitCapability(candidate, validIngestion)).toBe(false);
      expect(() =>
        assertTrustedCommitCapability(candidate, validIngestion),
      ).toThrow('unauthorized commit capability');
    }
  });

  it('rejects direct null, undefined, empty, and non-object capability candidates', () => {
    const directCandidates: unknown[] = [
      null,
      undefined,
      {},
      Object.create(null),
      '',
      0,
      false,
      [],
    ];

    for (const candidate of directCandidates) {
      expect(isTrustedCommitCapability(candidate, validIngestion)).toBe(false);
      expect(() =>
        assertTrustedCommitCapability(candidate, validIngestion),
      ).toThrow('unauthorized commit capability');
    }
  });

  it('rejects capability verification when ingestion target is null, empty, or nested invalid', () => {
    const candidate = { [Symbol.toStringTag]: 'TrustedCommitCapability' };

    expect(isTrustedCommitCapability(candidate, null as any)).toBe(false);
    expect(() =>
      assertTrustedCommitCapability(candidate, null as any),
    ).toThrow('unauthorized commit capability');

    expect(isTrustedCommitCapability(candidate, {} as any)).toBe(false);
    expect(() =>
      assertTrustedCommitCapability(candidate, {} as any),
    ).toThrow('unauthorized commit capability');

    expect(isTrustedCommitCapability(candidate, { nested: null } as any)).toBe(false);
    expect(() =>
      assertTrustedCommitCapability(candidate, { nested: null } as any),
    ).toThrow('unauthorized commit capability');

    expect(isTrustedCommitCapability(candidate, { nested: {} } as any)).toBe(false);
    expect(() =>
      assertTrustedCommitCapability(candidate, { nested: {} } as any),
    ).toThrow('unauthorized commit capability');

    expect(isTrustedCommitCapability(candidate, { nested: validIngestion } as any)).toBe(false);
    expect(() =>
      assertTrustedCommitCapability(candidate, { nested: validIngestion } as any),
    ).toThrow('unauthorized commit capability');
  });

  it('fails closed on structural ingestion validation with nested null or empty boundaries', async () => {
    await expect(validateRepositoryIngestion(null, 'org_m4')).rejects.toThrow();
    await expect(validateRepositoryIngestion({}, 'org_m4')).rejects.toThrow();

    await expect(
      validateRepositoryIngestion(
        { ...validIngestion, snapshot: null },
        'org_m4',
      ),
    ).rejects.toThrow();

    await expect(
      validateRepositoryIngestion(
        { ...validIngestion, snapshot: {} },
        'org_m4',
      ),
    ).rejects.toThrow();

    await expect(
      validateRepositoryIngestion(
        {
          ...validIngestion,
          snapshot: { ...validIngestion.snapshot, files: [] },
        },
        'org_m4',
      ),
    ).rejects.toThrow();
  });

  it('preserves clean JSON detachment without retaining prototype indirection across nested boundaries', () => {
    const nested = {
      level1: {
        level2: {
          emptyObj: {},
          nullProp: null,
          emptyList: [],
        },
      },
    };

    const detached = detachJson(nested);
    expect(detached).toEqual(nested);
    expect(Object.getPrototypeOf(detached.level1.level2)).toBe(Object.prototype);
  });
});
