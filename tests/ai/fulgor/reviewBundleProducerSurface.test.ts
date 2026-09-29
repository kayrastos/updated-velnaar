import {
  createHash,
} from 'node:crypto';

import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from 'node:fs/promises';

import {
  tmpdir,
} from 'node:os';

import {
  join,
} from 'node:path';

import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  scanReviewBundlesOnce,
} from '../../../scripts/fulgor/cloud/reviewBundleFeeder';

function sha256(
  value: string | Buffer,
): string {
  return createHash('sha256')
    .update(value)
    .digest('hex');
}

class FakeStore {
  jobs: any[] = [];

  async snapshot() {
    return {
      jobs:
        this.jobs.map(
          (job) => ({
            job,
          }),
        ),
    };
  }

  async enqueue(
    job: any,
  ) {
    this.jobs.push(job);
  }
}

async function makeFixture(
  root: string,
  name: string,
  trackedPatch: string,
) {
  const bundle =
    join(
      root,
      name,
    );

  const relative =
    'tests/intelligence/m4/producerSurface.test.ts';

  const snapshotDir =
    join(
      bundle,
      'files',
      'tests',
      'intelligence',
      'm4',
    );

  await mkdir(
    snapshotDir,
    {
      recursive: true,
    },
  );

  const manifest = {
    slot: 2,

    role:
      'discovery-intelligence',

    packageId:
      `PKG-${name}`,

    head:
      'a'.repeat(40),

    workEpoch:
      1,

    patchHash:
      'legacy-producer-hash',

    createdAt:
      '2026-09-23T20:00:00.000Z',

    paths: [
      {
        status:
          '??',

        path:
          relative,
      },
    ],

    autoCommit:
      false,

    autoPush:
      false,

    autoMerge:
      false,

    deploy:
      false,

    purpose:
      'Synthetic producer compatibility fixture.',
  };

  const manifestRaw =
    JSON.stringify(
      manifest,
      null,
      2,
    );

  const snapshot =
    'export const producerSurface = true;\n';

  await writeFile(
    join(
      bundle,
      'manifest.json',
    ),
    manifestRaw,
    'utf8',
  );

  await writeFile(
    join(
      bundle,
      'git-status.txt',
    ),
    `?? ${relative}\n`,
    'utf8',
  );

  await writeFile(
    join(
      bundle,
      'tracked.patch',
    ),
    trackedPatch,
    'utf8',
  );

  await writeFile(
    join(
      snapshotDir,
      'producerSurface.test.ts',
    ),
    snapshot,
    'utf8',
  );

  await writeFile(
    join(
      bundle,
      'fulgor-admission.json',
    ),
    JSON.stringify(
      {
        schemaVersion:
          'VELNAR_FULGOR_CLOUD_ADMISSION_V1',

        packageId:
          manifest.packageId,

        manifestSha256:
          sha256(
            manifestRaw,
          ),

        snapshotSha256:
          sha256(
            Buffer.from(
              snapshot,
              'utf8',
            ),
          ),

        dataClass:
          'WHITE',

        cloudVerificationAllowed:
          true,
      },
      null,
      2,
    ),
    'utf8',
  );
}

const dependencies = {
  /*
   * Synthetic validation clock.
   *
   * Review-bundle fixtures are materialized at test runtime,
   * so this injected clock must remain later than their
   * filesystem mtimes. Keep it fixed and independent from
   * the host wall-clock date.
   */
  now:
    () =>
      Date.parse(
        '9999-12-31T23:59:59.999Z',
      ),

  commitExists:
    async () =>
      true,

  pathExistsAtCommit:
    async () =>
      false,

  dryRunApply:
    async () =>
      true,
};

describe(
  'current VELNAR producer surface',
  () => {
    it(
      'accepts five-file bundle with empty tracked.patch',
      async () => {
        const root =
          await mkdtemp(
            join(
              tmpdir(),
              'fulgor-producer-good-',
            ),
          );

        try {
          await makeFixture(
            root,
            'good',
            '\n',
          );

          const store =
            new FakeStore();

          const result =
            await scanReviewBundlesOnce(
              {
                bundleRoot:
                  root,

                repoRoot:
                  'D:/repo',

                notBeforeMs:
                  Date.parse(
                    '2026-09-23T19:00:00.000Z',
                  ),

                stabilityWindowMs:
                  0,
              },
              store,
              dependencies,
            );

          expect(
            result.enqueued,
          ).toBe(1);

          expect(
            store.jobs,
          ).toHaveLength(1);
        } finally {
          await rm(
            root,
            {
              recursive: true,
              force: true,
            },
          );
        }
      },
    );

    it(
      'refuses non-empty tracked.patch',
      async () => {
        const root =
          await mkdtemp(
            join(
              tmpdir(),
              'fulgor-producer-bad-',
            ),
          );

        try {
          await makeFixture(
            root,
            'bad',
            'diff --git a/a b/a\n',
          );

          const store =
            new FakeStore();

          const result =
            await scanReviewBundlesOnce(
              {
                bundleRoot:
                  root,

                repoRoot:
                  'D:/repo',

                notBeforeMs:
                  Date.parse(
                    '2026-09-23T19:00:00.000Z',
                  ),

                stabilityWindowMs:
                  0,
              },
              store,
              dependencies,
            );

          expect(
            result.enqueued,
          ).toBe(0);

          expect(
            result.refused,
          ).toBe(1);
        } finally {
          await rm(
            root,
            {
              recursive: true,
              force: true,
            },
          );
        }
      },
    );
  },
);