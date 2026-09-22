import { describe, it, expect } from 'vitest';
import {
  isTrustedCommitCapability,
  assertTrustedCommitCapability,
  type RepositoryIngestion,
} from '../../../../worker/intelligence/ingestion/repository';

const mockIngestion: RepositoryIngestion = {
  version: 'velnar-repository-ingestion-v1',
  organizationId: 'org_test_123',
  repositoryId: 'repo_test_123',
  commitSha: 'a'.repeat(40),
  snapshot: {
    version: 'velnar-local-source-snapshot-v2',
    fixtureId: 'm2-case-001',
    repositoryId: 'repo_test_123',
    organizationId: 'org_test_123',
    snapshotId: 'sha256:' + '0'.repeat(64),
    totalBytes: 100,
    files: [
      {
        path: 'src/index.ts',
        content: 'export const x = 1;',
        byteLength: 19,
        contentDigest: 'sha256:' + '1'.repeat(64),
        fileIdentity: 'sha256:' + '2'.repeat(64),
      },
    ],
  },
  ingestionIdentity: 'sha256:' + '3'.repeat(64),
};

const fakeCapability = Object.freeze({
  [Symbol.toStringTag]: 'TrustedCommitCapability' as const,
});

describe('Capability Enforcement: Malformed Nested Input', () => {
  it('refuses candidate wrapped in nested container objects and envelopes', () => {
    const nestedCandidates = [
      { nested: { capability: {} } },
      { envelope: { payload: { candidate: fakeCapability } } },
      { data: { inner: { cap: Object.create(null) } } },
      { wrapper: { level1: { level2: { capability: fakeCapability } } } },
    ];

    for (const candidate of nestedCandidates) {
      expect(isTrustedCommitCapability(candidate, mockIngestion)).toBe(false);
      expect(() => assertTrustedCommitCapability(candidate, mockIngestion)).toThrow('unauthorized commit capability');
    }
  });

  it('refuses candidate wrapped in single or multi-dimensional arrays', () => {
    const arrayCandidates = [
      [fakeCapability],
      [[fakeCapability]],
      [[[{ [Symbol.toStringTag]: 'TrustedCommitCapability' }]]],
      [{ nested: [{ capability: fakeCapability }] }],
    ];

    for (const candidate of arrayCandidates) {
      expect(isTrustedCommitCapability(candidate, mockIngestion)).toBe(false);
      expect(() => assertTrustedCommitCapability(candidate, mockIngestion)).toThrow('unauthorized commit capability');
    }
  });

  it('refuses ingestion wrapped in nested container objects and envelopes', () => {
    const nestedIngestions = [
      { nested: mockIngestion },
      { envelope: { payload: { ingestion: mockIngestion } } },
      { data: { inner: { current: mockIngestion } } },
      { wrapper: { level1: { level2: { target: mockIngestion } } } },
    ];

    for (const ingestion of nestedIngestions) {
      expect(isTrustedCommitCapability(fakeCapability, ingestion as any)).toBe(false);
      expect(() => assertTrustedCommitCapability(fakeCapability, ingestion as any)).toThrow('unauthorized commit capability');
    }
  });

  it('refuses ingestion wrapped in nested array structures', () => {
    const arrayIngestions = [
      [mockIngestion],
      [[mockIngestion]],
      [{ nested: [mockIngestion] }],
    ];

    for (const ingestion of arrayIngestions) {
      expect(isTrustedCommitCapability(fakeCapability, ingestion as any)).toBe(false);
      expect(() => assertTrustedCommitCapability(fakeCapability, ingestion as any)).toThrow('unauthorized commit capability');
    }
  });

  it('refuses candidate or ingestion with deeply nested null, undefined, and primitive leaves', () => {
    const primitiveLeaves = [
      { nested: { candidate: null } },
      { nested: { candidate: undefined } },
      { nested: { candidate: 'forged-token' } },
      { nested: { candidate: 12345 } },
      { nested: { candidate: true } },
      { nested: { candidate: Symbol('cap') } },
      { outer: { inner: { candidate: null } } },
    ];

    for (const candidate of primitiveLeaves) {
      expect(isTrustedCommitCapability(candidate, mockIngestion)).toBe(false);
      expect(() => assertTrustedCommitCapability(candidate, mockIngestion)).toThrow('unauthorized commit capability');
    }
  });

  it('refuses cross-nested candidate and ingestion structures', () => {
    const crossNested = [
      { candidate: { inner: fakeCapability }, ingestion: { inner: mockIngestion } },
      { payload: { nestedCandidate: fakeCapability, nestedIngestion: mockIngestion } },
      { candidate: { ingestion: mockIngestion } },
      { ingestion: { candidate: fakeCapability } },
    ];

    for (const item of crossNested) {
      expect(isTrustedCommitCapability(item.candidate, (item.ingestion ?? mockIngestion) as any)).toBe(false);
      expect(() => assertTrustedCommitCapability(item.candidate, (item.ingestion ?? mockIngestion) as any)).toThrow('unauthorized commit capability');
    }
  });

  it('refuses nested circular references in candidate and ingestion positions', () => {
    const circularCandidate: any = { nested: {} };
    circularCandidate.nested.self = circularCandidate;

    const circularIngestion: any = { ...mockIngestion, nested: {} };
    circularIngestion.nested.self = circularIngestion;

    expect(isTrustedCommitCapability(circularCandidate, mockIngestion)).toBe(false);
    expect(() => assertTrustedCommitCapability(circularCandidate, mockIngestion)).toThrow('unauthorized commit capability');

    expect(isTrustedCommitCapability(fakeCapability, circularIngestion)).toBe(false);
    expect(() => assertTrustedCommitCapability(fakeCapability, circularIngestion)).toThrow('unauthorized commit capability');
  });

  it('refuses frozen, sealed, and prototype-poisoned nested structures', () => {
    const poisoned = Object.assign(Object.create({ capability: true }), { nested: {} });
    const frozenNested = Object.freeze({ nested: Object.freeze({ capability: fakeCapability }) });
    const sealedNested = Object.seal({ nested: Object.seal({ capability: fakeCapability }) });

    for (const candidate of [poisoned, frozenNested, sealedNested]) {
      expect(isTrustedCommitCapability(candidate, mockIngestion)).toBe(false);
      expect(() => assertTrustedCommitCapability(candidate, mockIngestion)).toThrow('unauthorized commit capability');
    }
  });
});
