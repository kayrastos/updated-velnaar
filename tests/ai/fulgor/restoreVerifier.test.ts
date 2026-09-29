import {
  copyFile,
  mkdir,
  mkdtemp,
  rm,
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
  computeProvenanceManifestSha256,
  sha256File,
  type FulgorProvenanceManifestV1,
} from '../../../scripts/fulgor/evidence/provenanceBackup';

import {
  verifyRestore,
} from '../../../scripts/fulgor/recovery/restoreVerifier';

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
    await rm(roots.pop()!, {
      recursive: true,
      force: true,
    });
  }
});

async function makeSnapshot() {
  const source = await makeRoot(
    'fulgor-source-',
  );

  await mkdir(path.join(source, 'data'));

  const sourceFile = path.join(
    source,
    'data',
    'result.bin',
  );

  await writeFile(
    sourceFile,
    'sealed-evidence',
  );

  const digest =
    await sha256File(sourceFile);

  const snapshot =
    await buildProvenanceManifest(
      source,
      [
        {
          path: 'data/result.bin',
          expectedSha256: digest,
          role: 'gate_evidence',
          opaqueSemantic: true,
        },
      ],
      [
        {
          path: 'markers/not-used',
          expectedPresent: false,
          phase: 'final_holdout',
        },
      ],
    );

  return {
    sourceFile,
    snapshot,
  };
}

describe('Fulgor restoreVerifier', () => {
  it('verifies an exact restore', async () => {
    const {
      sourceFile,
      snapshot,
    } = await makeSnapshot();

    const restore = await makeRoot(
      'fulgor-restore-',
    );

    await mkdir(path.join(restore, 'data'));

    await copyFile(
      sourceFile,
      path.join(
        restore,
        'data',
        'result.bin',
      ),
    );

    const result =
      await verifyRestore(
        restore,
        snapshot,
      );

    expect(result.verified).toBe(true);
    expect(result.filesVerified).toBe(1);
    expect(result.markersVerified).toBe(1);
    expect(result.semanticContentRead)
      .toBe(false);
  });

  it('fails on restored-byte tampering', async () => {
    const {
      snapshot,
    } = await makeSnapshot();

    const restore = await makeRoot(
      'fulgor-restore-',
    );

    await mkdir(path.join(restore, 'data'));

    await writeFile(
      path.join(
        restore,
        'data',
        'result.bin',
      ),
      'tampered',
    );

    const result =
      await verifyRestore(
        restore,
        snapshot,
      );

    expect(result.verified).toBe(false);

    expect(
      result.failures.some(
        (item) =>
          item.error === 'SHA256_MISMATCH',
      ),
    ).toBe(true);
  });

  it('fails on a missing restored file', async () => {
    const {
      snapshot,
    } = await makeSnapshot();

    const restore = await makeRoot(
      'fulgor-restore-',
    );

    const result =
      await verifyRestore(
        restore,
        snapshot,
      );

    expect(result.verified).toBe(false);

    expect(
      result.failures.some(
        (item) =>
          item.error ===
          'MISSING_OR_NOT_REGULAR',
      ),
    ).toBe(true);
  });

  it('rejects a tampered manifest self-hash', async () => {
    const {
      snapshot,
    } = await makeSnapshot();

    const tampered = {
      ...snapshot,
      rootName: 'changed',
    };

    const restore = await makeRoot(
      'fulgor-restore-',
    );

    const result =
      await verifyRestore(
        restore,
        tampered,
      );

    expect(result.verified).toBe(false);

    expect(result.failures).toEqual([
      {
        error:
          'INVALID_SOURCE_MANIFEST_SELF_HASH',
      },
    ]);
  });

  it('rejects duplicate artifact paths even with a valid self-hash', async () => {
    const {
      snapshot,
    } = await makeSnapshot();

    const duplicate =
      structuredClone(snapshot) as
        FulgorProvenanceManifestV1;

    duplicate.artifacts.push(
      structuredClone(
        duplicate.artifacts[0],
      ),
    );

    duplicate.manifestSha256 =
      computeProvenanceManifestSha256(
        duplicate,
      );

    const restore = await makeRoot(
      'fulgor-restore-',
    );

    await mkdir(path.join(restore, 'data'));

    await writeFile(
      path.join(
        restore,
        'data',
        'result.bin',
      ),
      'sealed-evidence',
    );

    const result =
      await verifyRestore(
        restore,
        duplicate,
      );

    expect(result.verified).toBe(false);

    expect(result.failures).toContainEqual({
      path: 'data/result.bin',
      error: 'DUPLICATE_ARTIFACT_PATH',
    });
  });
});