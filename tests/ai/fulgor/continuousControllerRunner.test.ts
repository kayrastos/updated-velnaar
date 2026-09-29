import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
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
  vi,
} from 'vitest';

import {
  loadFulgorGcpConfig,
} from '../../../scripts/fulgor/cloud/gcpConfig';

import {
  ContinuousRunnerError,
  retryTransientFsMutation,
  runContinuousController,
} from '../../../scripts/fulgor/cloud/continuousControllerRunner';

import type {
  L4WorkerTransport,
} from '../../../scripts/fulgor/cloud/l4WorkerClient';

function testConfig(
  statePath: string,
) {
  return loadFulgorGcpConfig({
    FULGOR_GCP_PROJECT_ID:
      'test-project',

    FULGOR_GCP_REGION:
      'europe-west4',

    FULGOR_CONTROLLER_STATE_PATH:
      statePath,

    FULGOR_L4_WORKER_ORIGIN:
      'https://fulgor-worker-abc-ew.a.run.app',

    FULGOR_L4_WORKER_RUNTIME_SERVICE_ACCOUNT:
      'fulgor-worker@test-project.iam.gserviceaccount.com',

    FULGOR_L4_EXPECTED_MODEL_ID:
      'Qwen/Qwen3.8-27B',

    FULGOR_L4_TIMEOUT_MS:
      '360000',

    FULGOR_MAX_JOBS_PER_RUN:
      '1',

    FULGOR_QUEUE_MAX_DEPTH:
      '32',
  });
}

function fakeTransport() {
  const send =
    vi.fn(
      async () => {
        throw new Error(
          'UNEXPECTED_WORKER_CALL',
        );
      },
    );

  return {
    send,

    transport: {
      send,
    } as L4WorkerTransport,
  };
}

const liveOwnerId =
  '11111111-1111-4111-8111-111111111111';

const staleOwnerId =
  '22222222-2222-4222-8222-222222222222';

const foreignOwnerId =
  '33333333-3333-4333-8333-333333333333';

describe(
  'continuous controller runner',
  () => {
    it(
      'runs one empty bounded pass, persists a parseable heartbeat, and stops after manual stop',
      async () => {
        const root =
          await mkdtemp(
            join(
              tmpdir(),
              'fulgor-runner-',
            ),
          );

        const statePath =
          join(
            root,
            'state.json',
          );

        const stopPath =
          `${statePath}.runner-stop`;

        const fake =
          fakeTransport();

        let sleeps = 0;

        const result =
          await runContinuousController(
            testConfig(
              statePath,
            ),
            fake.transport,
            {
              pollIntervalMs:
                1000,

              dependencies: {
                sleep:
                  async () => {
                    sleeps += 1;

                    await writeFile(
                      stopPath,
                      'manual-stop',
                      'utf8',
                    );
                  },
              },
            },
          );

        expect(result)
          .toEqual({
            reason:
              'MANUAL_STOP',

            cycles:
              1,
          });

        expect(sleeps)
          .toBe(1);

        expect(fake.send)
          .not.toHaveBeenCalled();

        const heartbeat =
          JSON.parse(
            await readFile(
              `${statePath}.runner-heartbeat.json`,
              'utf8',
            ),
          );

        expect(heartbeat.status)
          .toBe('STOPPED');

        expect(heartbeat.exitReason)
          .toBe('MANUAL_STOP');

        expect(heartbeat.cycles)
          .toBe(1);

        const names =
          await readdir(
            root,
          );

        expect(
          names.some(
            (name) =>
              name.includes(
                '.runner-heartbeat.json.tmp-',
              ),
          ),
        ).toBe(false);

        expect(
          names.includes(
            'state.json.runner-heartbeat.json.bak',
          ),
        ).toBe(false);

        expect(
          names.includes(
            'state.json.runner-lock',
          ),
        ).toBe(false);
      },
    );

    it(
      'rejects a second live owner',
      async () => {
        const root =
          await mkdtemp(
            join(
              tmpdir(),
              'fulgor-live-lock-',
            ),
          );

        const statePath =
          join(
            root,
            'state.json',
          );

        const lockDir =
          `${statePath}.runner-lock`;

        await mkdir(
          lockDir,
        );

        await writeFile(
          join(
            lockDir,
            'owner.json',
          ),
          JSON.stringify({
            schemaVersion:
              'FULGOR_RUNNER_LOCK_V1',

            ownerId:
              liveOwnerId,

            pid:
              process.pid,

            startedAt:
              new Date()
                .toISOString(),
          }),
          'utf8',
        );

        await expect(
          runContinuousController(
            testConfig(
              statePath,
            ),
            fakeTransport()
              .transport,
            {
              pollIntervalMs:
                1000,
            },
          ),
        ).rejects.toEqual(
          new ContinuousRunnerError(
            'RUNNER_ALREADY_ACTIVE',
          ),
        );
      },
    );

    it(
      'recovers a verified stale owner',
      async () => {
        const root =
          await mkdtemp(
            join(
              tmpdir(),
              'fulgor-stale-lock-',
            ),
          );

        const statePath =
          join(
            root,
            'state.json',
          );

        const lockDir =
          `${statePath}.runner-lock`;

        const stopPath =
          `${statePath}.runner-stop`;

        await mkdir(
          lockDir,
        );

        await writeFile(
          join(
            lockDir,
            'owner.json',
          ),
          JSON.stringify({
            schemaVersion:
              'FULGOR_RUNNER_LOCK_V1',

            ownerId:
              staleOwnerId,

            pid:
              99999999,

            startedAt:
              '2026-01-01T00:00:00.000Z',
          }),
          'utf8',
        );

        const result =
          await runContinuousController(
            testConfig(
              statePath,
            ),
            fakeTransport()
              .transport,
            {
              pollIntervalMs:
                1000,

              dependencies: {
                isProcessAlive:
                  () => false,

                sleep:
                  async () => {
                    await writeFile(
                      stopPath,
                      'manual-stop',
                      'utf8',
                    );
                  },
              },
            },
          );

        expect(result.reason)
          .toBe('MANUAL_STOP');

        expect(result.cycles)
          .toBe(1);
      },
    );

    it(
      'fails closed on unverifiable lock ownership',
      async () => {
        const root =
          await mkdtemp(
            join(
              tmpdir(),
              'fulgor-bad-lock-',
            ),
          );

        const statePath =
          join(
            root,
            'state.json',
          );

        const lockDir =
          `${statePath}.runner-lock`;

        await mkdir(
          lockDir,
        );

        await writeFile(
          join(
            lockDir,
            'owner.json',
          ),
          '{"invalid":true}',
          'utf8',
        );

        await expect(
          runContinuousController(
            testConfig(
              statePath,
            ),
            fakeTransport()
              .transport,
            {
              pollIntervalMs:
                1000,
            },
          ),
        ).rejects.toEqual(
          new ContinuousRunnerError(
            'RUNNER_LOCK_UNVERIFIED',
          ),
        );
      },
    );

    it(
      'refuses to delete a lock whose owner changes before release',
      async () => {
        const root =
          await mkdtemp(
            join(
              tmpdir(),
              'fulgor-owner-swap-',
            ),
          );

        const statePath =
          join(
            root,
            'state.json',
          );

        const lockDir =
          `${statePath}.runner-lock`;

        const stopPath =
          `${statePath}.runner-stop`;

        const ownerPath =
          join(
            lockDir,
            'owner.json',
          );

        await expect(
          runContinuousController(
            testConfig(
              statePath,
            ),
            fakeTransport()
              .transport,
            {
              pollIntervalMs:
                1000,

              dependencies: {
                sleep:
                  async () => {
                    const current =
                      JSON.parse(
                        await readFile(
                          ownerPath,
                          'utf8',
                        ),
                      );

                    await writeFile(
                      ownerPath,
                      JSON.stringify({
                        ...current,

                        ownerId:
                          foreignOwnerId,
                      }),
                      'utf8',
                    );

                    await writeFile(
                      stopPath,
                      'manual-stop',
                      'utf8',
                    );
                  },
              },
            },
          ),
        ).rejects.toEqual(
          new ContinuousRunnerError(
            'RUNNER_LOCK_UNVERIFIED',
          ),
        );

        const preserved =
          JSON.parse(
            await readFile(
              ownerPath,
              'utf8',
            ),
          );

        expect(
          preserved.ownerId,
        ).toBe(
          foreignOwnerId,
        );
      },
    );

    it(
      'rejects unsafe poll cadence before runner ownership',
      async () => {
        const root =
          await mkdtemp(
            join(
              tmpdir(),
              'fulgor-cadence-',
            ),
          );

        await expect(
          runContinuousController(
            testConfig(
              join(
                root,
                'state.json',
              ),
            ),
            fakeTransport()
              .transport,
            {
              pollIntervalMs:
                999,
            },
          ),
        ).rejects.toEqual(
          new ContinuousRunnerError(
            'INVALID_POLL_INTERVAL',
          ),
        );
      },
    );
  },
);


/*
 * FULGOR_WINDOWS_EBUSY_RETRY_TESTS_V1
 */
describe(
  'continuous runner transient Windows fs retry',
  () => {
    function fsError(
      code: string,
    ): Error & { code: string } {
      return Object.assign(
        new Error(code),
        {
          code,
        },
      );
    }

    it(
      'recovers from two transient EBUSY failures',
      async () => {
        let attempts = 0;
        const delays: number[] = [];

        const value =
          await retryTransientFsMutation(
            async () => {
              attempts += 1;

              if (attempts < 3) {
                throw fsError(
                  'EBUSY',
                );
              }

              return 'ok';
            },

            async (milliseconds) => {
              delays.push(
                milliseconds,
              );
            },
          );

        expect(value)
          .toBe('ok');

        expect(attempts)
          .toBe(3);

        expect(delays)
          .toEqual([
            20,
            40,
          ]);
      },
    );

    it(
      'does not retry a non-transient filesystem error',
      async () => {
        let attempts = 0;
        const delays: number[] = [];

        await expect(
          retryTransientFsMutation(
            async () => {
              attempts += 1;

              throw fsError(
                'ENOENT',
              );
            },

            async (milliseconds) => {
              delays.push(
                milliseconds,
              );
            },
          ),
        ).rejects.toMatchObject({
          code: 'ENOENT',
        });

        expect(attempts)
          .toBe(1);

        expect(delays)
          .toEqual([]);
      },
    );

    it(
      'bounds persistent EBUSY to six attempts',
      async () => {
        let attempts = 0;
        const delays: number[] = [];

        await expect(
          retryTransientFsMutation(
            async () => {
              attempts += 1;

              throw fsError(
                'EBUSY',
              );
            },

            async (milliseconds) => {
              delays.push(
                milliseconds,
              );
            },
          ),
        ).rejects.toMatchObject({
          code: 'EBUSY',
        });

        expect(attempts)
          .toBe(6);

        expect(delays)
          .toEqual([
            20,
            40,
            80,
            160,
            320,
          ]);
      },
    );
  },
);
