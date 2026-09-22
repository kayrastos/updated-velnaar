import { describe, it, expect } from 'vitest';
import {
  assertTrustedCommitCapability,
  isTrustedCommitCapability,
  type RepositoryIngestion,
  type TrustedCommitCapability,
} from '../../../../worker/intelligence/ingestion/repository';
import type { SourceSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';

function createMockSnapshot(org: string, repo: string): SourceSnapshot {
  return {
    version: 'velnar-local-source-snapshot-v2',
    fixtureId: 'm2-case-001',
    repositoryId: repo,
    organizationId: org,
    snapshotId: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    totalBytes: 25,
    files: [
      {
        path: 'src/index.ts',
        content: 'export const value = 1;\n',
        byteLength: 25,
        contentDigest: 'sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
        fileIdentity: 'sha256:1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff',
      },
    ],
  };
}

function createMockIngestion(org: string, repo: string, commitSha: string): RepositoryIngestion {
  const snapshot = createMockSnapshot(org, repo);
  return {
    version: 'velnar-repository-ingestion-v1',
    organizationId: org,
    repositoryId: repo,
    commitSha,
    snapshot,
    ingestionIdentity: 'sha256:mockingestionidentity00000000000000000000000000000000000000000000',
  };
}

describe('Direct Capability Enforcement - Negative Control', () => {
  const org = 'org_neg_test';
  const repoA = 'repo-a';
  const repoB = 'repo-b';
  const shaA = 'a'.repeat(40);
  const shaB = 'b'.repeat(40);

  it('rejects direct forged object claims as trusted commit capability', () => {
    const ingestion = createMockIngestion(org, repoA, shaA);

    const syntheticCapability = Object.freeze({
      [Symbol.toStringTag]: 'TrustedCommitCapability' as const,
    }) as unknown as TrustedCommitCapability;

    expect(isTrustedCommitCapability(syntheticCapability, ingestion)).toBe(false);
    expect(() => assertTrustedCommitCapability(syntheticCapability, ingestion)).toThrow('unauthorized commit capability');
  });

  it('rejects non-object and null candidates as trusted commit capability', () => {
    const ingestion = createMockIngestion(org, repoA, shaA);

    expect(isTrustedCommitCapability(null, ingestion)).toBe(false);
    expect(isTrustedCommitCapability(undefined, ingestion)).toBe(false);
    expect(isTrustedCommitCapability('TrustedCommitCapability', ingestion)).toBe(false);
    expect(isTrustedCommitCapability(12345, ingestion)).toBe(false);
    expect(isTrustedCommitCapability({}, ingestion)).toBe(false);

    expect(() => assertTrustedCommitCapability(null, ingestion)).toThrow('unauthorized commit capability');
    expect(() => assertTrustedCommitCapability(undefined, ingestion)).toThrow('unauthorized commit capability');
    expect(() => assertTrustedCommitCapability({}, ingestion)).toThrow('unauthorized commit capability');
  });

  it('rejects structural clone or spread of an unauthorized capability object', () => {
    const ingestion = createMockIngestion(org, repoA, shaA);
    const candidate = Object.assign(Object.create(null), {
      [Symbol.toStringTag]: 'TrustedCommitCapability',
      authorized: true,
    });

    const cloned = { ...candidate };
    expect(isTrustedCommitCapability(candidate, ingestion)).toBe(false);
    expect(isTrustedCommitCapability(cloned, ingestion)).toBe(false);
    expect(() => assertTrustedCommitCapability(cloned, ingestion)).toThrow('unauthorized commit capability');
  });

  it('refuses capability binding across distinct ingestion identities', () => {
    const ingestionA = createMockIngestion(org, repoA, shaA);
    const ingestionB = createMockIngestion(org, repoB, shaB);

    const arbitraryCapability = Object.freeze({
      [Symbol.toStringTag]: 'TrustedCommitCapability' as const,
    }) as unknown as TrustedCommitCapability;

    expect(isTrustedCommitCapability(arbitraryCapability, ingestionA)).toBe(false);
    expect(isTrustedCommitCapability(arbitraryCapability, ingestionB)).toBe(false);
    expect(() => assertTrustedCommitCapability(arbitraryCapability, ingestionA)).toThrow();
    expect(() => assertTrustedCommitCapability(arbitraryCapability, ingestionB)).toThrow();
  });
});
