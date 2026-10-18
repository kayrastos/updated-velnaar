import {
  chmodSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';

import {
  join,
} from 'node:path';

import {
  tmpdir,
} from 'node:os';

import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest';

import type {
  Live8x8OneShotInput,
  Live8x8OneShotResult,
} from '../../../scripts/fulgor/orchestration/live8x8OneShotRunner';

import {
  LIVE_8X8_OPERATOR_REQUEST_SCHEMA,
  runLive8x8Operator,
} from '../../../scripts/fulgor/orchestration/live8x8OperatorRunner';

const baseline =
  '0123456789abcdef0123456789abcdef01234567';

const roots:
  string[] =
    [];

function root():
string {
  const value =
    mkdtempSync(
      join(
        tmpdir(),
        'velnar-live8x8-operator-',
      ),
    );

  roots.push(
    value,
  );

  return value;
}

afterEach(
  () => {
    while (
      roots.length >
        0
    ) {
      const value =
        roots.pop();

      if (
        value
      ) {
        rmSync(
          value,
          {
            recursive:
              true,

            force:
              true,
          },
        );
      }
    }
  },
);

function executable(
  directory:
    string,

  name:
    string,
): string {
  const file =
    join(
      directory,
      name,
    );

  writeFileSync(
    file,
    '#!/bin/sh\nexit 99\n',
    {
      mode:
        0o700,
    },
  );

  chmodSync(
    file,
    0o700,
  );

  return file;
}

function request() {
  const jobs =
    [
      ...Array.from(
        {
          length:
            8,
        },

        (
          _,
          index,
        ) => ({
          jobId:
            `codex-${index + 1}`,

          provider:
            'codex' as const,

          task:
            `Bounded Codex task ${index + 1}`,

          evidence: [
            {
              id:
                'E1',

              path:
                'src/a.ts',
            },
          ],
        }),
      ),

      ...Array.from(
        {
          length:
            8,
        },

        (
          _,
          index,
        ) => ({
          jobId:
            `agy-${index + 1}`,

          provider:
            'antigravity' as const,

          task:
            `Bounded Antigravity task ${index + 1}`,

          evidence: [
            {
              id:
                'E1',

              path:
                'src/a.ts',
            },
          ],
        }),
      ),
    ];

  return {
    schemaVersion:
      LIVE_8X8_OPERATOR_REQUEST_SCHEMA,

    requestId:
      'test-8x8',

    baseline,

    jobs,
  };
}

function fakeResult():
Live8x8OneShotResult {
  const stats =
    (
      provider:
        'codex'
        | 'antigravity',
    ) =>
      Object.freeze({
        provider,

        slots:
          8,

        claims:
          8,

        liveProviderCalls:
          8,

        usefulUnique:
          8,

        usefulDuplicate:
          0,

        blocked:
          0,

        protocolRejected:
          0,

        contractRejected:
          0,

        transportFailures:
          0,

        stoppedByQualityCircuit:
          0,
      });

  return Object.freeze({
    schemaVersion:
      'VELNAR_LIVE_8X8_ONE_SHOT_V1',

    baseline,

    startedAtMs:
      100,

    completedAtMs:
      200,

    elapsedMs:
      100,

    expectedProviderCalls:
      16,

    pool: Object.freeze({
      schemaVersion:
        'VELNAR_LIVE_TRANSACTIONAL_PROVIDER_POOL_V1',

      codex:
        stats(
          'codex',
        ),

      antigravity:
        stats(
          'antigravity',
        ),

      totalSlots:
        16,

      totalLiveProviderCalls:
        16,

      totalUsefulUnique:
        16,

      totalUsefulDuplicate:
        0,

      fulgorCalled:
        false,

      verificationGranted:
        false,

      authorityGranted:
        false,
    }),

    fulgorCalled:
      false,

    verificationGranted:
      false,

    authorityGranted:
      false,
  }) as Live8x8OneShotResult;
}

describe(
  'VELNAR live 8+8 operator runner',
  () => {
    it(
      'materializes host evidence from baseline and prepares exact 8+8 without executing providers',
      async () => {
        const directory =
          root();

        const repoRoot =
          join(
            directory,
            'repo',
          );

        const stateRoot =
          join(
            directory,
            'state',
          );

        const requestFile =
          join(
            directory,
            'request.json',
          );

        const fs =
          await import(
            'node:fs/promises'
          );

        await fs.mkdir(
          repoRoot,
          {
            mode:
              0o700,
          },
        );

        writeFileSync(
          requestFile,
          JSON.stringify(
            request(),
          ),
          {
            mode:
              0o600,
          },
        );

        const codex =
          executable(
            directory,
            'codex-fake',
          );

        const antigravity =
          executable(
            directory,
            'agy-fake',
          );

        let captured:
          Live8x8OneShotInput
          | null =
            null;

        const result =
          await runLive8x8Operator({
            env: {
              HOME:
                directory,

              VELNAR_REPO_ROOT:
                repoRoot,

              VELNAR_8X8_REQUEST_FILE:
                requestFile,

              VELNAR_CODEX_EXECUTABLE:
                codex,

              VELNAR_ANTIGRAVITY_EXECUTABLE:
                antigravity,
            },

            stateRoot,

            gitText:
              async (
                _repoRoot,
                args,
              ) => {
                const key =
                  args.join(' ');

                if (
                  key ===
                    'rev-parse --show-toplevel'
                ) {
                  return `${repoRoot}\n`;
                }

                if (
                  key ===
                    'status --porcelain=v1 --untracked-files=all --ignore-submodules=none'
                ) {
                  return '';
                }

                if (
                  key ===
                    'rev-parse HEAD'
                ) {
                  return `${baseline}\n`;
                }

                if (
                  key ===
                    `rev-parse --verify ${baseline}^{commit}`
                ) {
                  return `${baseline}\n`;
                }

                if (
                  key ===
                    `show ${baseline}:src/a.ts`
                ) {
                  return 'export const evidence = 1;\n';
                }

                throw new Error(
                  `UNEXPECTED_GIT=${key}`,
                );
              },

            runOneShot:
              async input => {
                captured =
                  input;

                writeFileSync(
                  input.queuePath,
                  'test-queue',
                  {
                    mode:
                      0o600,
                  },
                );

                return fakeResult();
              },
          });

        expect(
          captured,
        ).not.toBeNull();

        expect(
          captured?.jobs,
        ).toHaveLength(
          16,
        );

        expect(
          captured?.jobs.filter(
            item =>
              item.order.affinity ===
                'codex',
          ),
        ).toHaveLength(
          8,
        );

        expect(
          captured?.jobs.filter(
            item =>
              item.order.affinity ===
                'antigravity',
          ),
        ).toHaveLength(
          8,
        );

        expect(
          result.actualProviderCalls,
        ).toBe(16);

        expect(
          result.usefulUnique,
        ).toBe(16);

        expect(
          result.acceptedWorkPointerPath,
        ).toBe(
          join(
            stateRoot,
            'accepted-work-latest.json',
          ),
        );

        expect(
          result.fulgorCalled,
        ).toBe(false);

        expect(
          result.authorityGranted,
        ).toBe(false);
      },
    );

    it(
      'fails closed on a dirty repository before provider execution',
      async () => {
        const directory =
          root();

        const repoRoot =
          join(
            directory,
            'repo',
          );

        const requestFile =
          join(
            directory,
            'request.json',
          );

        const fs =
          await import(
            'node:fs/promises'
          );

        await fs.mkdir(
          repoRoot,
          {
            mode:
              0o700,
          },
        );

        writeFileSync(
          requestFile,
          JSON.stringify(
            request(),
          ),
          {
            mode:
              0o600,
          },
        );

        const codex =
          executable(
            directory,
            'codex-fake',
          );

        const antigravity =
          executable(
            directory,
            'agy-fake',
          );

        let oneShotCalled =
          false;

        await expect(
          runLive8x8Operator({
            env: {
              HOME:
                directory,

              VELNAR_REPO_ROOT:
                repoRoot,

              VELNAR_8X8_REQUEST_FILE:
                requestFile,

              VELNAR_CODEX_EXECUTABLE:
                codex,

              VELNAR_ANTIGRAVITY_EXECUTABLE:
                antigravity,
            },

            stateRoot:
              join(
                directory,
                'state',
              ),

            gitText:
              async (
                _repoRoot,
                args,
              ) => {
                const key =
                  args.join(' ');

                if (
                  key ===
                    'rev-parse --show-toplevel'
                ) {
                  return `${repoRoot}\n`;
                }

                if (
                  key ===
                    'status --porcelain=v1 --untracked-files=all --ignore-submodules=none'
                ) {
                  return '?? dirty.txt\n';
                }

                throw new Error(
                  `UNEXPECTED_GIT=${key}`,
                );
              },

            runOneShot:
              async () => {
                oneShotCalled =
                  true;

                return fakeResult();
              },
          }),
        ).rejects.toThrow(
          /LIVE_8X8_OPERATOR_FAILURE/,
        );

        expect(
          oneShotCalled,
        ).toBe(false);
      },
    );
  },
);
