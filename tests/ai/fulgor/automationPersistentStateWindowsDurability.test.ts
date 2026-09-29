import {
  mkdtemp,
} from 'node:fs/promises';

import {
  tmpdir,
} from 'node:os';

import {
  join,
} from 'node:path';

import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  PersistentFulgorStateStore,
} from '../../../scripts/fulgor/automation/persistentState';

import type {
  FulgorAutomationJob,
} from '../../../scripts/fulgor/automation/types';

const fsMocks =
  vi.hoisted(() => ({
    rename: vi.fn(),
    rm: vi.fn(),
  }));

vi.mock(
  'node:fs/promises',
  async () => {
    const actual =
      await vi.importActual<
        typeof import('node:fs/promises')
      >(
        'node:fs/promises',
      );

    return {
      ...actual,
      rename: fsMocks.rename,
      rm: fsMocks.rm,
    };
  },
);

function fsError(
  code: string,
): NodeJS.ErrnoException {
  const error =
    new Error(
      `synthetic-${code}`,
    ) as NodeJS.ErrnoException;

  error.code = code;

  return error;
}

function job(
  id: string,
): FulgorAutomationJob {
  return {
    jobId: id,
    problem: 'problem',
    diagnosis: 'diagnosis',
    plan: 'plan',

    candidate: {
      blindedId: `blind-${id}`,
      patch: [
        'diff --git a/src/a.ts b/src/a.ts',
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -1 +1 @@',
        '-old',
        '+new',
      ].join('\n'),
      canonicalDiffSummary:
        'one file changed',
    },

    staticGatePolicy: {
      allowedScope: ['src'],
      forbiddenPaths: ['src/secrets'],
      maxFiles: 2,
      maxHunks: 2,
      maxChangedLines: 10,
    },

    dryRunApplySucceeded: true,
  };
}

async function store(): Promise<{
  instance: PersistentFulgorStateStore;
  statePath: string;
}> {
  const root =
    await mkdtemp(
      join(
        tmpdir(),
        'fulgor-state-win-retry-',
      ),
    );

  const statePath =
    join(
      root,
      'state.json',
    );

  return {
    instance:
      new PersistentFulgorStateStore(
        statePath,
        4,
      ),
    statePath,
  };
}

describe(
  'Fulgor persistent state Windows durability',
  () => {
    beforeEach(
      async () => {
        const actual =
          await vi.importActual<
            typeof import('node:fs/promises')
          >(
            'node:fs/promises',
          );

        fsMocks.rename.mockReset();
        fsMocks.rm.mockReset();

        fsMocks.rename
          .mockImplementation(
            actual.rename,
          );

        fsMocks.rm
          .mockImplementation(
            actual.rm,
          );
      },
    );

    it(
      'recovers after two transient EBUSY destination rename failures',
      async () => {
        const {
          instance,
          statePath,
        } = await store();

        const actual =
          await vi.importActual<
            typeof import('node:fs/promises')
          >(
            'node:fs/promises',
          );

        let busyFailures = 0;

        fsMocks.rename
          .mockImplementation(
            async (
              ...args: Parameters<
                typeof actual.rename
              >
            ) => {
              const [from, to] =
                args;

              if (
                String(from)
                  .includes('.tmp-') &&
                String(to) ===
                  statePath &&
                busyFailures < 2
              ) {
                busyFailures += 1;
                throw fsError('EBUSY');
              }

              return actual.rename(
                ...args,
              );
            },
          );

        await instance.enqueue(
          job('ebusy-recovery'),
        );

        expect(
          busyFailures,
        ).toBe(2);

        const snapshot =
          await instance.snapshot();

        expect(
          snapshot.jobs,
        ).toHaveLength(1);

        expect(
          snapshot.jobs[0]
            .job.jobId,
        ).toBe(
          'ebusy-recovery',
        );
      },
    );

    it(
      'recovers after transient EACCES destination rename failure',
      async () => {
        const {
          instance,
          statePath,
        } = await store();

        const actual =
          await vi.importActual<
            typeof import('node:fs/promises')
          >(
            'node:fs/promises',
          );

        let accessFailures = 0;

        fsMocks.rename
          .mockImplementation(
            async (
              ...args: Parameters<
                typeof actual.rename
              >
            ) => {
              const [from, to] =
                args;

              if (
                String(from)
                  .includes('.tmp-') &&
                String(to) ===
                  statePath &&
                accessFailures < 1
              ) {
                accessFailures += 1;
                throw fsError('EACCES');
              }

              return actual.rename(
                ...args,
              );
            },
          );

        await instance.enqueue(
          job('eacces-recovery'),
        );

        expect(
          accessFailures,
        ).toBe(1);

        expect(
          (
            await instance.snapshot()
          ).jobs[0].job.jobId,
        ).toBe(
          'eacces-recovery',
        );
      },
    );

    it(
      'preserves initial EPERM as Windows overwrite fallback while retrying backup EPERM',
      async () => {
        const {
          instance,
          statePath,
        } = await store();

        await instance.enqueue(
          job('seed'),
        );

        const actual =
          await vi.importActual<
            typeof import('node:fs/promises')
          >(
            'node:fs/promises',
          );

        fsMocks.rename.mockReset();

        let initialFallbacks = 0;
        let backupCalls = 0;

        fsMocks.rename
          .mockImplementation(
            async (
              ...args: Parameters<
                typeof actual.rename
              >
            ) => {
              const [from, to] =
                args;

              const fromText =
                String(from);

              const toText =
                String(to);

              if (
                fromText.includes(
                  '.tmp-',
                ) &&
                toText === statePath &&
                initialFallbacks === 0
              ) {
                initialFallbacks += 1;
                throw fsError('EPERM');
              }

              if (
                fromText === statePath &&
                toText ===
                  `${statePath}.bak`
              ) {
                backupCalls += 1;

                if (
                  backupCalls <= 2
                ) {
                  throw fsError('EPERM');
                }
              }

              return actual.rename(
                ...args,
              );
            },
          );

        await instance.enqueue(
          job('second'),
        );

        expect(
          initialFallbacks,
        ).toBe(1);

        expect(
          backupCalls,
        ).toBe(3);

        const snapshot =
          await instance.snapshot();

        expect(
          snapshot.jobs.map(
            (record) =>
              record.job.jobId,
          ),
        ).toEqual([
          'seed',
          'second',
        ]);
      },
    );

    it(
      'bounds persistent EBUSY to six attempts and preserves previous state through backup recovery',
      async () => {
        const {
          instance,
          statePath,
        } = await store();

        await instance.enqueue(
          job('seed'),
        );

        const actual =
          await vi.importActual<
            typeof import('node:fs/promises')
          >(
            'node:fs/promises',
          );

        fsMocks.rename.mockReset();

        let fallbackTriggered =
          false;

        let finalRenameAttempts =
          0;

        fsMocks.rename
          .mockImplementation(
            async (
              ...args: Parameters<
                typeof actual.rename
              >
            ) => {
              const [from, to] =
                args;

              const fromText =
                String(from);

              const toText =
                String(to);

              if (
                fromText.includes(
                  '.tmp-',
                ) &&
                toText === statePath &&
                !fallbackTriggered
              ) {
                fallbackTriggered =
                  true;

                throw fsError('EPERM');
              }

              if (
                fromText.includes(
                  '.tmp-',
                ) &&
                toText === statePath
              ) {
                finalRenameAttempts +=
                  1;

                throw fsError('EBUSY');
              }

              return actual.rename(
                ...args,
              );
            },
          );

        await expect(
          instance.enqueue(
            job('must-not-commit'),
          ),
        ).rejects.toMatchObject({
          code: 'EBUSY',
        });

        expect(
          finalRenameAttempts,
        ).toBe(6);

        const recovered =
          await instance.snapshot();

        expect(
          recovered.jobs.map(
            (record) =>
              record.job.jobId,
          ),
        ).toEqual([
          'seed',
        ]);
      },
    );

    it(
      'does not retry unknown mutation errors and cleanup cannot replace the primary failure',
      async () => {
        const {
          instance,
          statePath,
        } = await store();

        let renameCalls = 0;
        let cleanupCalls = 0;

        fsMocks.rename
          .mockImplementation(
            async (
              from,
              to,
            ) => {
              if (
                String(from)
                  .includes('.tmp-') &&
                String(to) ===
                  statePath
              ) {
                renameCalls += 1;
                throw fsError('EINVAL');
              }

              throw new Error(
                'unexpected-rename',
              );
            },
          );

        fsMocks.rm
          .mockImplementation(
            async () => {
              cleanupCalls += 1;
              throw fsError('EBUSY');
            },
          );

        await expect(
          instance.enqueue(
            job('primary-error'),
          ),
        ).rejects.toMatchObject({
          code: 'EINVAL',
        });

        expect(
          renameCalls,
        ).toBe(1);

        expect(
          cleanupCalls,
        ).toBe(6);
      },
    );
  },
);