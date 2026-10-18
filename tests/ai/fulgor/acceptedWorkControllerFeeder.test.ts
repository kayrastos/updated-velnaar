import {
  execFileSync,
} from 'node:child_process';

import {
  createHash,
} from 'node:crypto';

import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
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
  scanAcceptedWorkForFulgorOnce,
} from '../../../scripts/fulgor/orchestration/acceptedWorkControllerFeeder';

import {
  ACCEPTED_WORK_LATEST_POINTER_SCHEMA,
  publishAcceptedWorkLatestPointer,
} from '../../../scripts/fulgor/orchestration/acceptedWorkLatestPointer';

import type {
  FulgorAutomationJob,
} from '../../../scripts/fulgor/automation/types';

import type {
  PersistedAcceptedWorkProduct,
} from '../../../scripts/fulgor/orchestration/transactionalProviderQueue';

function sha(
  value:
    string,
): string {
  return createHash(
    'sha256',
  )
    .update(
      value,
    )
    .digest(
      'hex',
    );
}

function git(
  cwd:
    string,

  ...args:
    string[]
): string {
  return execFileSync(
    'git',
    args,
    {
      cwd,
      encoding:
        'utf8',
    },
  ).trim();
}

function createRepo(): {
  root: string;
  baseline: string;
} {
  const root =
    mkdtempSync(
      join(
        tmpdir(),
        'velnar-feeder-repo-',
      ),
    );

  git(
    root,
    'init',
    '-q',
  );

  git(
    root,
    'config',
    'user.email',
    'test@example.invalid',
  );

  git(
    root,
    'config',
    'user.name',
    'VELNAR Test',
  );

  writeFileSync(
    join(
      root,
      'README.md',
    ),
    'fixture\n',
    'utf8',
  );

  git(
    root,
    'add',
    '.',
  );

  git(
    root,
    'commit',
    '-q',
    '-m',
    'baseline',
  );

  return {
    root,

    baseline:
      git(
        root,
        'rev-parse',
        'HEAD',
      ),
  };
}

function accepted(
  baseline:
    string,

  provider:
    'codex' |
    'antigravity',

  jobId:
    string,

  path:
    string,

  content:
    string,
): PersistedAcceptedWorkProduct {
  const value = {
    workProduct: {
      schemaVersion:
        'VELNAR_PROVIDER_WORK_PRODUCT_V1' as const,

      provider,
      taskId:
        jobId,

      baseline,

      status:
        'PROPOSE_CHANGE' as const,

      summary:
        'Feeder test candidate.',

      evidenceIds:
        ['E1', 'E2'],

      candidate: {
        path,
        content,
      },

      tests: [
        `npx vitest run ${path}`,
      ],

      blocker:
        null,
    },

    usable:
      true,

    evidenceCount:
      2,

    evidenceBindings: [
      {
        id:
          'E1',

        path:
          'scripts/a.ts',

        sha256:
          '1'.repeat(64),
      },
      {
        id:
          'E2',

        path:
          'tests/a.test.ts',

        sha256:
          '2'.repeat(64),
      },
    ],

    verified:
      false as const,

    authorityGranted:
      false as const,
  };

  return {
    jobId,

    fingerprint:
      sha(
        `${provider}:${jobId}`,
      ),

    provider,
    baseline,

    status:
      'PROPOSE_CHANGE',

    candidatePath:
      path,

    candidateSha256:
      sha(
        content,
      ),

    evidenceCount:
      2,

    acceptedSha256:
      sha(
        JSON.stringify(
          value,
        ),
      ),

    accepted:
      value,

    createdAtMs:
      1000,
  };
}

class FakeStore {
  readonly jobs:
    FulgorAutomationJob[] =
      [];

  async snapshot() {
    return {
      jobs:
        this.jobs.map(
          job => ({
            job,
          }),
        ),
    };
  }

  async enqueue(
    job:
      FulgorAutomationJob,
  ) {
    if (
      this.jobs.some(
        existing =>
          existing.jobId ===
            job.jobId,
      )
    ) {
      throw new Error(
        'DUPLICATE_JOB',
      );
    }

    this.jobs.push(
      job,
    );
  }
}

describe(
  'accepted work controller feeder',
  () => {
    it(
      'enqueues one deterministic FULGOR job from the latest completed provider run',
      async () => {
        const repo =
          createRepo();

        const stateRoot =
          mkdtempSync(
            join(
              tmpdir(),
              'velnar-feeder-state-',
            ),
          );

        try {
          chmodSync(
            stateRoot,
            0o700,
          );

          const requestId =
            'feeder-run-001';

          const runDirectory =
            join(
              stateRoot,
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
            'placeholder',
            {
              mode:
                0o600,
            },
          );

          const rows = [
            accepted(
              repo.baseline,
              'codex',
              'codex-a',
              'tests/a.test.ts',
              'export const a = true;\n',
            ),
            accepted(
              repo.baseline,
              'antigravity',
              'agy-a',
              'tests/a.test.ts',
              'export const a = true;\n',
            ),
          ];

          await publishAcceptedWorkLatestPointer(
            stateRoot,
            {
              schemaVersion:
                ACCEPTED_WORK_LATEST_POINTER_SCHEMA,

              requestId,

              baseline:
                repo.baseline,

              runDirectory,
              queuePath,

              usefulUnique:
                rows.length,

              completedAtMs:
                1000,
            },
          );

          const store =
            new FakeStore();

          const summary =
            await scanAcceptedWorkForFulgorOnce(
              {
                stateRoot,
                repoRoot:
                  repo.root,

                sourceBindingRoot:
                  join(
                    stateRoot,
                    'source-binding',
                  ),

                policy: {
                  forbiddenPaths: [
                    '.git',
                    '.github/workflows',
                  ],

                  maxHunks:
                    8,

                  maxChangedLines:
                    500,
                },

                maxEnqueuePerScan:
                  1,
              },
              store,
              {
                loadAccepted:
                  async () =>
                    rows,
              },
            );

          expect(
            summary.enqueued,
          ).toBe(1);

          expect(
            store.jobs,
          ).toHaveLength(1);

          expect(
            store.jobs[0]
              .candidate
              .patch,
          ).toContain(
            'tests/a.test.ts',
          );

          expect(
            JSON.stringify(
              store.jobs[0],
            ),
          ).not.toMatch(
            /codex|antigravity/,
          );
        } finally {
          rmSync(
            repo.root,
            {
              recursive:
                true,

              force:
                true,
            },
          );

          rmSync(
            stateRoot,
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
      'skips a known bridge job and advances to the next deterministic candidate',
      async () => {
        const repo =
          createRepo();

        const stateRoot =
          mkdtempSync(
            join(
              tmpdir(),
              'velnar-feeder-dup-',
            ),
          );

        try {
          chmodSync(
            stateRoot,
            0o700,
          );

          const requestId =
            'feeder-run-002';

          const runDirectory =
            join(
              stateRoot,
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
            'placeholder',
            {
              mode:
                0o600,
            },
          );

          const rows = [
            accepted(
              repo.baseline,
              'codex',
              'job-a',
              'tests/a.test.ts',
              'export const a = true;\n',
            ),
            accepted(
              repo.baseline,
              'codex',
              'job-b',
              'tests/b.test.ts',
              'export const b = true;\n',
            ),
          ];

          await publishAcceptedWorkLatestPointer(
            stateRoot,
            {
              schemaVersion:
                ACCEPTED_WORK_LATEST_POINTER_SCHEMA,

              requestId,

              baseline:
                repo.baseline,

              runDirectory,
              queuePath,

              usefulUnique:
                rows.length,

              completedAtMs:
                2000,
            },
          );

          const store =
            new FakeStore();

          const first =
            await scanAcceptedWorkForFulgorOnce(
              {
                stateRoot,
                repoRoot:
                  repo.root,

                sourceBindingRoot:
                  join(
                    stateRoot,
                    'source-binding',
                  ),

                policy: {
                  forbiddenPaths:
                    ['.git'],

                  maxHunks:
                    8,

                  maxChangedLines:
                    500,
                },
              },
              store,
              {
                loadAccepted:
                  async () =>
                    rows,
              },
            );

          expect(
            first.enqueued,
          ).toBe(1);

          const firstId =
            store.jobs[0]
              .jobId;

          /*
           * Simulate a later 8x8 run rediscovering the
           * same candidate. Same VF job identity,
           * different provider-run identity.
           */
          const secondRequestId =
            'feeder-run-002-repeat';

          const secondRunDirectory =
            join(
              stateRoot,
              `live-8x8-${secondRequestId}`,
            );

          mkdirSync(
            secondRunDirectory,
            {
              mode:
                0o700,
            },
          );

          const secondQueuePath =
            join(
              secondRunDirectory,
              'queue.sqlite',
            );

          writeFileSync(
            secondQueuePath,
            'placeholder-repeat',
            {
              mode:
                0o600,
            },
          );

          await publishAcceptedWorkLatestPointer(
            stateRoot,
            {
              schemaVersion:
                ACCEPTED_WORK_LATEST_POINTER_SCHEMA,

              requestId:
                secondRequestId,

              baseline:
                repo.baseline,

              runDirectory:
                secondRunDirectory,

              queuePath:
                secondQueuePath,

              usefulUnique:
                rows.length,

              completedAtMs:
                2500,
            },
          );

          const second =
            await scanAcceptedWorkForFulgorOnce(
              {
                stateRoot,
                repoRoot:
                  repo.root,

                sourceBindingRoot:
                  join(
                    stateRoot,
                    'source-binding',
                  ),

                policy: {
                  forbiddenPaths:
                    ['.git'],

                  maxHunks:
                    8,

                  maxChangedLines:
                    500,
                },
              },
              store,
              {
                loadAccepted:
                  async () =>
                    rows,
              },
            );

          expect(
            second.duplicateSkipped,
          ).toBeGreaterThanOrEqual(1);

          expect(
            second.enqueued,
          ).toBe(1);

          expect(
            store.jobs,
          ).toHaveLength(2);

          expect(
            store.jobs[1].jobId,
          ).not.toBe(
            firstId,
          );
        } finally {
          rmSync(
            repo.root,
            {
              recursive:
                true,

              force:
                true,
            },
          );

          rmSync(
            stateRoot,
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
      'fails closed when pointer useful count does not match durable queue rows',
      async () => {
        const repo =
          createRepo();

        const stateRoot =
          mkdtempSync(
            join(
              tmpdir(),
              'velnar-feeder-mismatch-',
            ),
          );

        try {
          chmodSync(
            stateRoot,
            0o700,
          );

          const requestId =
            'feeder-run-003';

          const runDirectory =
            join(
              stateRoot,
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
            'placeholder',
            {
              mode:
                0o600,
            },
          );

          await publishAcceptedWorkLatestPointer(
            stateRoot,
            {
              schemaVersion:
                ACCEPTED_WORK_LATEST_POINTER_SCHEMA,

              requestId,

              baseline:
                repo.baseline,

              runDirectory,
              queuePath,

              usefulUnique:
                2,

              completedAtMs:
                3000,
            },
          );

          const row =
            accepted(
              repo.baseline,
              'codex',
              'job-only',
              'tests/only.test.ts',
              'export const only = true;\n',
            );

          await expect(
            scanAcceptedWorkForFulgorOnce(
              {
                stateRoot,
                repoRoot:
                  repo.root,

                sourceBindingRoot:
                  join(
                    stateRoot,
                    'source-binding',
                  ),

                policy: {
                  forbiddenPaths:
                    ['.git'],

                  maxHunks:
                    8,

                  maxChangedLines:
                    500,
                },
              },
              new FakeStore(),
              {
                loadAccepted:
                  async () =>
                    [row],
              },
            ),
          ).rejects.toThrow(
            /POINTER_QUEUE_MISMATCH/,
          );
        } finally {
          rmSync(
            repo.root,
            {
              recursive:
                true,

              force:
                true,
            },
          );

          rmSync(
            stateRoot,
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
