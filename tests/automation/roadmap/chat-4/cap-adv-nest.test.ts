import { describe, it, expect } from 'vitest';
import {
  isTrustedCommitCapability,
  assertTrustedCommitCapability,
  type RepositoryIngestion,
  type TrustedCommitCapability,
} from '../../../../worker/intelligence/ingestion/repository';
import type { SourceSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';

function createSyntheticIngestion(overrides?: Partial<RepositoryIngestion>): RepositoryIngestion {
  const snapshot: SourceSnapshot = {
    version: 'velnar-local-source-snapshot-v2',
    fixtureId: 'm2-case-001',
    repositoryId: 'repo-cap-nest',
    organizationId: 'org_m4',
    snapshotId: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    totalBytes: 32,
    files: [
      {
        path: 'src/routes.ts',
        content: 'export const bound = true;\n',
        byteLength: 27,
        contentDigest: 'sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
        fileIdentity: 'sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
      },
    ],
  };

  return {
    version: 'velnar-repository-ingestion-v1',
    organizationId: 'org_m4',
    repositoryId: 'repo-cap-nest',
    commitSha: '1'.repeat(40),
    snapshot,
    ingestionIdentity: 'sha256:1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff',
    ...overrides,
  };
}

describe('Capability Enforcement - Adversarial Nested Edge Cases', () => {
  const genuineIngestion = createSyntheticIngestion();
  const fakeCapability: TrustedCommitCapability = Object.freeze({
    [Symbol.toStringTag]: 'TrustedCommitCapability' as const,
  });

  it('refuses capability candidates wrapped in nested container objects', () => {
    const singleWrap = { capability: fakeCapability };
    const deepWrap = {
      level1: {
        level2: {
          level3: {
            capability: fakeCapability,
          },
        },
      },
    };
    const taggedContainer = {
      [Symbol.toStringTag]: 'TrustedCommitCapability',
      nested: {
        inner: fakeCapability,
      },
    };

    expect(isTrustedCommitCapability(singleWrap, genuineIngestion)).toBe(false);
    expect(() => assertTrustedCommitCapability(singleWrap, genuineIngestion)).toThrow('unauthorized commit capability');

    expect(isTrustedCommitCapability(deepWrap, genuineIngestion)).toBe(false);
    expect(() => assertTrustedCommitCapability(deepWrap, genuineIngestion)).toThrow('unauthorized commit capability');

    expect(isTrustedCommitCapability(taggedContainer, genuineIngestion)).toBe(false);
    expect(() => assertTrustedCommitCapability(taggedContainer, genuineIngestion)).toThrow('unauthorized commit capability');
  });

  it('refuses adversarial candidates using nested prototype inheritance chains', () => {
    const proto = Object.freeze({
      [Symbol.toStringTag]: 'TrustedCommitCapability' as const,
    });
    const child = Object.create(proto);
    const grandChild = Object.create(child);

    expect(isTrustedCommitCapability(proto, genuineIngestion)).toBe(false);
    expect(() => assertTrustedCommitCapability(proto, genuineIngestion)).toThrow('unauthorized commit capability');

    expect(isTrustedCommitCapability(child, genuineIngestion)).toBe(false);
    expect(() => assertTrustedCommitCapability(child, genuineIngestion)).toThrow('unauthorized commit capability');

    expect(isTrustedCommitCapability(grandChild, genuineIngestion)).toBe(false);
    expect(() => assertTrustedCommitCapability(grandChild, genuineIngestion)).toThrow('unauthorized commit capability');
  });

  it('refuses adversarial candidates wrapped in nested proxy layers', () => {
    const proxy1 = new Proxy(fakeCapability, {});
    const proxy2 = new Proxy(proxy1, {
      get(target, prop, receiver) {
        return Reflect.get(target, prop, receiver);
      },
    });

    expect(isTrustedCommitCapability(proxy1, genuineIngestion)).toBe(false);
    expect(() => assertTrustedCommitCapability(proxy1, genuineIngestion)).toThrow('unauthorized commit capability');

    expect(isTrustedCommitCapability(proxy2, genuineIngestion)).toBe(false);
    expect(() => assertTrustedCommitCapability(proxy2, genuineIngestion)).toThrow('unauthorized commit capability');
  });

  it('refuses adversarial candidates with circular nested references', () => {
    const circular: Record<string, unknown> = {
      [Symbol.toStringTag]: 'TrustedCommitCapability',
    };
    circular.self = circular;
    circular.nested = { parent: circular };

    expect(isTrustedCommitCapability(circular, genuineIngestion)).toBe(false);
    expect(() => assertTrustedCommitCapability(circular, genuineIngestion)).toThrow('unauthorized commit capability');
  });

  it('refuses adversarial candidates with nested throwing accessor traps', () => {
    const trap = {
      get [Symbol.toStringTag]() {
        throw new Error('adversarial getter trap');
      },
      get nested() {
        throw new Error('adversarial nested getter');
      },
    };

    expect(isTrustedCommitCapability(trap, genuineIngestion)).toBe(false);
    expect(() => assertTrustedCommitCapability(trap, genuineIngestion)).toThrow('unauthorized commit capability');
  });

  it('refuses capability validation when ingestion has nested property mutations', () => {
    const mutatedSnapshotIngestion = createSyntheticIngestion({
      snapshot: {
        ...genuineIngestion.snapshot,
        snapshotId: 'sha256:mutated-nested-snapshot-id',
      },
    });

    const mutatedFilesIngestion = createSyntheticIngestion({
      snapshot: {
        ...genuineIngestion.snapshot,
        files: [],
      },
    });

    expect(isTrustedCommitCapability(fakeCapability, mutatedSnapshotIngestion)).toBe(false);
    expect(() => assertTrustedCommitCapability(fakeCapability, mutatedSnapshotIngestion)).toThrow('unauthorized commit capability');

    expect(isTrustedCommitCapability(fakeCapability, mutatedFilesIngestion)).toBe(false);
    expect(() => assertTrustedCommitCapability(fakeCapability, mutatedFilesIngestion)).toThrow('unauthorized commit capability');
  });

  it('refuses adversarial candidates embedded in nested array and collection structures', () => {
    const nestedArray = [[fakeCapability]];
    const nestedMap = new Map([
      ['level1', new Map([['level2', fakeCapability]])],
    ]);
    const nestedSet = new Set([new Set([fakeCapability])]);

    expect(isTrustedCommitCapability(nestedArray, genuineIngestion)).toBe(false);
    expect(() => assertTrustedCommitCapability(nestedArray, genuineIngestion)).toThrow('unauthorized commit capability');

    expect(isTrustedCommitCapability(nestedMap, genuineIngestion)).toBe(false);
    expect(() => assertTrustedCommitCapability(nestedMap, genuineIngestion)).toThrow('unauthorized commit capability');

    expect(isTrustedCommitCapability(nestedSet, genuineIngestion)).toBe(false);
    expect(() => assertTrustedCommitCapability(nestedSet, genuineIngestion)).toThrow('unauthorized commit capability');
  });

  it('refuses null-prototype nested objects attempting capability masquerading', () => {
    const nullProto = Object.create(null);
    nullProto[Symbol.toStringTag] = 'TrustedCommitCapability';
    nullProto.nested = Object.create(null);

    expect(isTrustedCommitCapability(nullProto, genuineIngestion)).toBe(false);
    expect(() => assertTrustedCommitCapability(nullProto, genuineIngestion)).toThrow('unauthorized commit capability');
  });
});
