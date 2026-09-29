import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest';

import {
  auditSeals,
} from '../../../scripts/fulgor/evidence/sealAudit';

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(
    path.join(tmpdir(), 'fulgor-seal-'),
  );

  roots.push(root);

  await mkdir(
    path.join(root, 'seals'),
    { recursive: true },
  );

  return root;
}

function sha(text: string): string {
  return createHash('sha256')
    .update(text, 'utf8')
    .digest('hex');
}

afterEach(async () => {
  while (roots.length > 0) {
    await rm(roots.pop()!, {
      recursive: true,
      force: true,
    });
  }
});

describe('Fulgor sealAudit', () => {
  it('classifies an unchanged target as CURRENT', async () => {
    const root = await makeRoot();

    await writeFile(
      path.join(root, 'target.txt'),
      'current',
    );

    await writeFile(
      path.join(root, 'seals', 'current.txt'),
      `${sha('current')}  target.txt\n`,
    );

    const result =
      await auditSeals(
        root,
        [
          {
            id: 'seal-current',
            path: 'seals/current.txt',
          },
        ],
      );

    expect(result.verified).toBe(true);

    expect(result.entries[0].status)
      .toBe('CURRENT');
  });

  it('fails closed on unexplained drift', async () => {
    const root = await makeRoot();

    await writeFile(
      path.join(root, 'target.txt'),
      'new',
    );

    await writeFile(
      path.join(root, 'seals', 'old.txt'),
      `${sha('old')}  target.txt\n`,
    );

    const result =
      await auditSeals(
        root,
        [
          {
            id: 'old',
            path: 'seals/old.txt',
          },
        ],
      );

    expect(result.verified).toBe(false);

    expect(result.entries[0].status)
      .toBe('UNRESOLVED_DRIFT');
  });

  it('recognizes an explicit valid successor', async () => {
    const root = await makeRoot();

    await writeFile(
      path.join(root, 'target.txt'),
      'new',
    );

    await writeFile(
      path.join(root, 'seals', 'old.txt'),
      `${sha('old')}  target.txt\n`,
    );

    await writeFile(
      path.join(root, 'seals', 'new.txt'),
      `${sha('new')}  target.txt\n`,
    );

    const result =
      await auditSeals(
        root,
        [
          {
            id: 'old',
            path: 'seals/old.txt',
          },
          {
            id: 'new',
            path: 'seals/new.txt',
          },
        ],
        [
          {
            historicalSealId: 'old',
            target: 'target.txt',
            successorSealId: 'new',
          },
        ],
      );

    const oldEntry =
      result.entries.find(
        (entry) =>
          entry.sealId === 'old',
      );

    const newEntry =
      result.entries.find(
        (entry) =>
          entry.sealId === 'new',
      );

    expect(oldEntry?.status)
      .toBe('SUPERSEDED');

    expect(newEntry?.status)
      .toBe('CURRENT');

    expect(result.verified).toBe(true);
  });

  it('rejects a missing successor seal', async () => {
    const root = await makeRoot();

    await writeFile(
      path.join(root, 'target.txt'),
      'new',
    );

    await writeFile(
      path.join(root, 'seals', 'old.txt'),
      `${sha('old')}  target.txt\n`,
    );

    const result =
      await auditSeals(
        root,
        [
          {
            id: 'old',
            path: 'seals/old.txt',
          },
        ],
        [
          {
            historicalSealId: 'old',
            target: 'target.txt',
            successorSealId: 'missing',
          },
        ],
      );

    expect(result.verified).toBe(false);

    expect(
      result.configurationErrors,
    ).toContain(
      'MISSING_SUCCESSOR_SEAL:missing',
    );
  });

  it('rejects successor that does not bind the target', async () => {
    const root = await makeRoot();

    await writeFile(
      path.join(root, 'target.txt'),
      'new',
    );

    await writeFile(
      path.join(root, 'other.txt'),
      'other',
    );

    await writeFile(
      path.join(root, 'seals', 'old.txt'),
      `${sha('old')}  target.txt\n`,
    );

    await writeFile(
      path.join(root, 'seals', 'new.txt'),
      `${sha('other')}  other.txt\n`,
    );

    const result =
      await auditSeals(
        root,
        [
          {
            id: 'old',
            path: 'seals/old.txt',
          },
          {
            id: 'new',
            path: 'seals/new.txt',
          },
        ],
        [
          {
            historicalSealId: 'old',
            target: 'target.txt',
            successorSealId: 'new',
          },
        ],
      );

    expect(result.verified).toBe(false);

    expect(
      result.configurationErrors,
    ).toContain(
      'SUCCESSOR_SEAL_DOES_NOT_BIND_TARGET:new:target.txt',
    );
  });

  it('fails closed on an unsafe assertion target', async () => {
    const root = await makeRoot();

    await writeFile(
      path.join(root, 'seals', 'unsafe.txt'),
      `${sha('x')}  ../escape.txt\n`,
    );

    const result =
      await auditSeals(
        root,
        [
          {
            id: 'unsafe',
            path: 'seals/unsafe.txt',
          },
        ],
      );

    expect(result.verified).toBe(false);

    expect(result.entries[0].errorCode)
      .toBe('UNSAFE_PATH');
  });

  it('rejects duplicate supersession declarations', async () => {
    const root = await makeRoot();

    await writeFile(
      path.join(root, 'target.txt'),
      'new',
    );

    await writeFile(
      path.join(root, 'seals', 'old.txt'),
      `${sha('old')}  target.txt\n`,
    );

    await writeFile(
      path.join(root, 'seals', 'new.txt'),
      `${sha('new')}  target.txt\n`,
    );

    const declaration = {
      historicalSealId: 'old',
      target: 'target.txt',
      successorSealId: 'new',
    };

    const result =
      await auditSeals(
        root,
        [
          {
            id: 'old',
            path: 'seals/old.txt',
          },
          {
            id: 'new',
            path: 'seals/new.txt',
          },
        ],
        [
          declaration,
          declaration,
        ],
      );

    expect(result.verified).toBe(false);

    expect(
      result.configurationErrors,
    ).toContain(
      'DUPLICATE_SUPERSESSION:old:target.txt',
    );
  });

  it('fails closed on a malformed non-empty seal line', async () => {
    const root = await makeRoot();

    await writeFile(
      path.join(root, 'target.txt'),
      'current',
    );

    await writeFile(
      path.join(root, 'seals', 'bad.txt'),
      `this-is-not-a-valid-assertion\n${sha('current')}  target.txt\n`,
    );

    const result =
      await auditSeals(
        root,
        [
          {
            id: 'bad',
            path: 'seals/bad.txt',
          },
        ],
      );

    expect(result.verified).toBe(false);

    expect(
      result.configurationErrors,
    ).toContain(
      'MALFORMED_SEAL_ASSERTION:bad',
    );
  });

  it('rejects path aliases inside one seal', async () => {
    const root = await makeRoot();

    await mkdir(path.join(root, 'dir'));

    await writeFile(
      path.join(root, 'dir', 'target.txt'),
      'current',
    );

    await writeFile(
      path.join(root, 'seals', 'alias.txt'),
      `${sha('current')}  dir/target.txt\n${sha('current')}  dir\\target.txt\n`,
    );

    const result =
      await auditSeals(
        root,
        [
          {
            id: 'alias',
            path: 'seals/alias.txt',
          },
        ],
      );

    expect(result.verified).toBe(false);

    expect(
      result.configurationErrors.some(
        (item) =>
          item.startsWith('DUPLICATE_TARGET_ALIAS:alias:'),
      ),
    ).toBe(true);
  });});