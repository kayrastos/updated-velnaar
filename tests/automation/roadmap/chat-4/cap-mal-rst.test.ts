import { describe, it, expect } from 'vitest';
import {
  captureSnapshot,
  validateSnapshot,
  hash,
} from '../../../../worker/intelligence/ingestion/snapshot';
import {
  validateRepositoryIngestion,
  verifyCommittedRepository,
  isTrustedCommitCapability,
  assertTrustedCommitCapability,
  type RepositoryIngestion,
} from '../../../../worker/intelligence/ingestion/repository';

describe('Capability enforcement on malformed input during restart and resume', () => {
  const org = 'org_chat4_rst';
  const repositoryId = 'repo-mal-rst';

  async function createValidFixture() {
    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId,
        organizationId: org,
        files: [
          {
            path: 'src/app.ts',
            content: 'export const active = true;\n',
          },
        ],
      },
      org,
    );

    const body = {
      version: 'velnar-repository-ingestion-v1' as const,
      organizationId: org,
      repositoryId,
      commitSha: 'a'.repeat(40),
      snapshot,
    };

    const ingestionIdentity = await hash('velnar-repository-ingestion-v1', body);
    const validRecord: RepositoryIngestion = {
      ...body,
      ingestionIdentity,
    };

    return { snapshot, validRecord, ingestionIdentity };
  }

  it('rejects malformed or tampered serialized ingestion payloads during restart/resume', async () => {
    const { validRecord, ingestionIdentity } = await createValidFixture();

    const validated = await validateRepositoryIngestion(validRecord, org);
    expect(validated.ingestionIdentity).toBe(ingestionIdentity);
    expect((validated as any).capability).toBeUndefined();

    await expect(validateRepositoryIngestion(null, org)).rejects.toThrow('plain object required');
    await expect(validateRepositoryIngestion('invalid', org)).rejects.toThrow('plain object required');
    await expect(validateRepositoryIngestion([], org)).rejects.toThrow('plain object required');

    await expect(
      validateRepositoryIngestion({ ...validRecord, version: 'velnar-repository-ingestion-v2' }, org),
    ).rejects.toThrow('invalid repository ingestion version');

    await expect(
      validateRepositoryIngestion({ ...validRecord, commitSha: '0'.repeat(40) }, org),
    ).rejects.toThrow('Git commit identity');

    await expect(
      validateRepositoryIngestion({ ...validRecord, commitSha: 'not-a-valid-hex-commit-sha' }, org),
    ).rejects.toThrow('Git commit identity');

    await expect(
      validateRepositoryIngestion({ ...validRecord, commitSha: 'a'.repeat(39) }, org),
    ).rejects.toThrow('Git commit identity');

    await expect(
      validateRepositoryIngestion(validRecord, 'foreign_org'),
    ).rejects.toThrow('tenant mismatch');

    const foreignSnapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId,
        organizationId: 'foreign_org',
        files: [{ path: 'src/app.ts', content: 'export const active = true;\n' }],
      },
      'foreign_org',
    );

    await expect(
      validateRepositoryIngestion({ ...validRecord, snapshot: foreignSnapshot }, org),
    ).rejects.toThrow();

    await expect(
      validateRepositoryIngestion(
        { ...validRecord, ingestionIdentity: 'sha256:0000000000000000000000000000000000000000000000000000000000000000' },
        org,
      ),
    ).rejects.toThrow('ingestion identity mismatch');

    await expect(
      validateRepositoryIngestion({ ...validRecord, capability: 'forged' } as any, org),
    ).rejects.toThrow('unknown or missing metadata');
  });

  it('strictly rejects serialized, forged, or rehydrated capability objects across restart boundaries', async () => {
    const { validRecord } = await createValidFixture();
    const validated = await validateRepositoryIngestion(validRecord, org);

    expect(isTrustedCommitCapability(null, validated)).toBe(false);
    expect(isTrustedCommitCapability(undefined, validated)).toBe(false);
    expect(isTrustedCommitCapability({}, validated)).toBe(false);
    expect(
      isTrustedCommitCapability(
        { [Symbol.toStringTag]: 'TrustedCommitCapability' },
        validated,
      ),
    ).toBe(false);

    const serializedCapability = JSON.parse(
      JSON.stringify({ [Symbol.toStringTag]: 'TrustedCommitCapability' }),
    );
    expect(isTrustedCommitCapability(serializedCapability, validated)).toBe(false);

    expect(() =>
      assertTrustedCommitCapability(serializedCapability, validated),
    ).toThrow('unauthorized commit capability');

    expect(() =>
      assertTrustedCommitCapability({}, validated),
    ).toThrow('unauthorized commit capability');
  });

  it('fails closed when restarting verification on malformed repository paths', async () => {
    const { validRecord } = await createValidFixture();

    await expect(
      verifyCommittedRepository('', validRecord, org),
    ).rejects.toThrow('network/device-qualified repository path refused');

    await expect(
      verifyCommittedRepository('\\\\server\\share\\repo', validRecord, org),
    ).rejects.toThrow('network/device-qualified repository path refused');

    await expect(
      verifyCommittedRepository('\\\\?\\C:\\malformed\\repo', validRecord, org),
    ).rejects.toThrow('network/device-qualified repository path refused');

    await expect(
      verifyCommittedRepository('//server/share/repo', validRecord, org),
    ).rejects.toThrow('network/device-qualified repository path refused');
  });

  it('ensures re-ingested or resumed snapshot analysis remains non-authoritative candidate findings', async () => {
    const { snapshot, validRecord } = await createValidFixture();
    const validatedSnapshot = await validateSnapshot(snapshot, org);

    expect(validatedSnapshot.snapshotId).toBe(snapshot.snapshotId);
    expect((validatedSnapshot as any).capability).toBeUndefined();

    expect(isTrustedCommitCapability(validatedSnapshot, validRecord)).toBe(false);
    expect(() =>
      assertTrustedCommitCapability(validatedSnapshot, validRecord),
    ).toThrow('unauthorized commit capability');
  });
});
