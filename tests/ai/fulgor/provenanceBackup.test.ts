import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest';

import {
  buildProvenanceManifest,
  sha256File,
  verifyProvenanceManifestSelfHash,
} from '../../../scripts/fulgor/evidence/provenanceBackup';

const roots: string[] = [];

async function makeRoot(
  prefix: string,
): Promise<string> {
  const root = await mkdtemp(
    path.join(tmpdir(), prefix),
  );

  roots.push(root);
  return root;
}

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop()!;
    await rm(root, {
      recursive: true,
      force: true,
    });
  }
});

describe('Fulgor provenanceBackup', () => {
  it('builds a verified opaque manifest', async () => {
    const root = await makeRoot('fulgor-prov-');

    await mkdir(path.join(root, 'evidence'));
    const file = path.join(
      root,
      'evidence',
      'result.bin',
    );

    await writeFile(file, 'opaque-payload');

    const digest = await sha256File(file);

    const manifest =
      await buildProvenanceManifest(
        root,
        [
          {
            path: 'evidence/result.bin',
            expectedSha256: digest,
            role: 'evaluation_result',
            opaqueSemantic: true,
          },
        ],
        [
          {
            path: 'markers/final.marker',
            expectedPresent: false,
            phase: 'final',
          },
        ],
      );

    expect(manifest.verified).toBe(true);
    expect(manifest.failures).toEqual([]);
    expect(manifest.semanticContentRead)
      .toBe(false);

    expect(
      verifyProvenanceManifestSelfHash(
        manifest,
      ),
    ).toBe(true);
  });

  it('fails closed on SHA mismatch', async () => {
    const root = await makeRoot('fulgor-prov-');

    await writeFile(
      path.join(root, 'artifact.bin'),
      'actual',
    );

    const manifest =
      await buildProvenanceManifest(
        root,
        [
          {
            path: 'artifact.bin',
            expectedSha256: '0'.repeat(64),
            role: 'artifact',
          },
        ],
      );

    expect(manifest.verified).toBe(false);

    expect(manifest.failures).toContainEqual({
      path: 'artifact.bin',
      error: 'SHA256_MISMATCH',
    });
  });

  it('rejects traversal paths', async () => {
    const root = await makeRoot('fulgor-prov-');

    const manifest =
      await buildProvenanceManifest(
        root,
        [
          {
            path: '../escape.bin',
            expectedSha256: '0'.repeat(64),
            role: 'artifact',
          },
        ],
      );

    expect(manifest.verified).toBe(false);

    expect(manifest.failures).toContainEqual({
      path: '../escape.bin',
      error: 'UNSAFE_PATH',
    });
  });

  it('rejects duplicate artifact paths', async () => {
    const root = await makeRoot('fulgor-prov-');

    const file = path.join(root, 'a.bin');
    await writeFile(file, 'a');

    const digest = await sha256File(file);

    const manifest =
      await buildProvenanceManifest(
        root,
        [
          {
            path: 'a.bin',
            expectedSha256: digest,
            role: 'one',
          },
          {
            path: 'a.bin',
            expectedSha256: digest,
            role: 'two',
          },
        ],
      );

    expect(manifest.verified).toBe(false);

    expect(manifest.failures).toContainEqual({
      path: 'a.bin',
      error: 'DUPLICATE_ARTIFACT_PATH',
    });
  });

  it('detects marker-state mismatch', async () => {
    const root = await makeRoot('fulgor-prov-');

    await writeFile(
      path.join(root, 'marker'),
      'x',
    );

    const manifest =
      await buildProvenanceManifest(
        root,
        [],
        [
          {
            path: 'marker',
            expectedPresent: false,
            phase: 'test',
          },
        ],
      );

    expect(manifest.verified).toBe(false);

    expect(manifest.failures).toContainEqual({
      path: 'marker',
      error: 'MARKER_STATE_MISMATCH',
    });
  });

  it('rejects a symlinked directory component', async () => {
    const root = await makeRoot('fulgor-prov-');
    const outside = await makeRoot(
      'fulgor-prov-outside-',
    );

    await writeFile(
      path.join(outside, 'payload.bin'),
      'outside',
    );

    const link = path.join(root, 'linked');

    await symlink(
      outside,
      link,
      process.platform === 'win32'
        ? 'junction'
        : 'dir',
    );

    const digest = await sha256File(
      path.join(outside, 'payload.bin'),
    );

    const manifest =
      await buildProvenanceManifest(
        root,
        [
          {
            path: 'linked/payload.bin',
            expectedSha256: digest,
            role: 'artifact',
          },
        ],
      );

    expect(manifest.verified).toBe(false);

    expect(manifest.failures).toContainEqual({
      path: 'linked/payload.bin',
      error: 'SYMLINK_REFUSED',
    });
  });

  it('rejects slash aliases of the same artifact path', async () => {
    const root = await makeRoot('fulgor-prov-');

    await mkdir(path.join(root, 'dir'));
    const file = path.join(root, 'dir', 'a.bin');
    await writeFile(file, 'a');

    const digest = await sha256File(file);

    const manifest =
      await buildProvenanceManifest(
        root,
        [
          {
            path: 'dir/a.bin',
            expectedSha256: digest,
            role: 'one',
          },
          {
            path: 'dir\\a.bin',
            expectedSha256: digest,
            role: 'two',
          },
        ],
      );

    expect(manifest.verified).toBe(false);

    expect(
      manifest.failures.some(
        (item) =>
          item.error === 'DUPLICATE_ARTIFACT_PATH',
      ),
    ).toBe(true);
  });});