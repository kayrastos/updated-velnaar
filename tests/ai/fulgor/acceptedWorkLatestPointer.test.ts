import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';

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
  ACCEPTED_WORK_LATEST_POINTER_SCHEMA,
  publishAcceptedWorkLatestPointer,
  readAcceptedWorkLatestPointer,
} from '../../../scripts/fulgor/orchestration/acceptedWorkLatestPointer';

describe(
  'accepted work latest pointer',
  () => {
    it(
      'publishes and re-reads an exact private pointer',
      async () => {
        const root =
          mkdtempSync(
            join(
              tmpdir(),
              'velnar-pointer-',
            ),
          );

        try {
          chmodSync(
            root,
            0o700,
          );

          const requestId =
            'pointer-test-001';

          const runDirectory =
            join(
              root,
              `live-8x8-${requestId}`,
            );

          mkdirSync(
            runDirectory,
            {
              mode:
                0o700,
            },
          );

          const queuePath =
            join(
              runDirectory,
              'queue.sqlite',
            );

          writeFileSync(
            queuePath,
            'sqlite-placeholder',
            {
              mode:
                0o600,
            },
          );

          const pointerPath =
            await publishAcceptedWorkLatestPointer(
              root,
              {
                schemaVersion:
                  ACCEPTED_WORK_LATEST_POINTER_SCHEMA,

                requestId,

                baseline:
                  'a'.repeat(40),

                runDirectory,
                queuePath,

                usefulUnique:
                  15,

                completedAtMs:
                  123456,
              },
            );

          const loaded =
            await readAcceptedWorkLatestPointer(
              pointerPath,
              root,
            );

          expect(
            loaded.requestId,
          ).toBe(
            requestId,
          );

          expect(
            loaded.usefulUnique,
          ).toBe(15);

          expect(
            loaded.queuePath,
          ).toBe(
            queuePath,
          );
        } finally {
          rmSync(
            root,
            {
              recursive:
                true,

              force:
                true,
            },
          );
        }
      },
    );

    it(
      'rejects a symlink queue target',
      async () => {
        const root =
          mkdtempSync(
            join(
              tmpdir(),
              'velnar-pointer-link-',
            ),
          );

        try {
          chmodSync(
            root,
            0o700,
          );

          const requestId =
            'link-test';

          const runDirectory =
            join(
              root,
              `live-8x8-${requestId}`,
            );

          mkdirSync(
            runDirectory,
            {
              mode:
                0o700,
            },
          );

          const realQueue =
            join(
              root,
              'real.sqlite',
            );

          writeFileSync(
            realQueue,
            'real',
            {
              mode:
                0o600,
            },
          );

          const queuePath =
            join(
              runDirectory,
              'queue.sqlite',
            );

          symlinkSync(
            realQueue,
            queuePath,
          );

          await expect(
            publishAcceptedWorkLatestPointer(
              root,
              {
                schemaVersion:
                  ACCEPTED_WORK_LATEST_POINTER_SCHEMA,

                requestId,

                baseline:
                  'a'.repeat(40),

                runDirectory,
                queuePath,

                usefulUnique:
                  1,

                completedAtMs:
                  1,
              },
            ),
          ).rejects.toThrow();
        } finally {
          rmSync(
            root,
            {
              recursive:
                true,

              force:
                true,
            },
          );
        }
      },
    );
  },
);
