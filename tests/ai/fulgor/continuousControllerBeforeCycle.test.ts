import {
  writeFile,
  mkdtemp,
  rm,
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
  runContinuousController,
} from '../../../scripts/fulgor/cloud/continuousControllerRunner';

import {
  loadFulgorGcpConfig,
} from '../../../scripts/fulgor/cloud/gcpConfig';

import type {
  L4WorkerTransport,
} from '../../../scripts/fulgor/cloud/l4WorkerClient';

describe(
  'continuous controller beforeCycle',
  () => {
    it(
      'runs beforeCycle before one idle cycle',
      async () => {
        const root =
          await mkdtemp(
            join(
              tmpdir(),
              'fulgor-before-cycle-',
            ),
          );

        try {
          const statePath =
            join(
              root,
              'state.json',
            );

          const config =
            loadFulgorGcpConfig({
              FULGOR_GCP_PROJECT_ID:
                'test-project',

              FULGOR_GCP_REGION:
                'europe-west4',

              FULGOR_CONTROLLER_STATE_PATH:
                statePath,

              FULGOR_L4_WORKER_ORIGIN:
                'https://test-worker.run.app',

              FULGOR_L4_WORKER_RUNTIME_SERVICE_ACCOUNT:
                'worker@test-project.iam.gserviceaccount.com',

              FULGOR_L4_EXPECTED_MODEL_ID:
                'Qwen/Qwen3.8-27B',

              FULGOR_L4_TIMEOUT_MS:
                '1000',

              FULGOR_MAX_JOBS_PER_RUN:
                '1',

              FULGOR_QUEUE_MAX_DEPTH:
                '32',
            });

          const transport:
          L4WorkerTransport = {
            send:
              async () => {
                throw new Error(
                  'UNEXPECTED_WORKER_SEND',
                );
              },
          };

          let runs = 0;

          const stopPath =
            `${statePath}.runner-stop`;

          const result =
            await runContinuousController(
              config,
              transport,
              {
                pollIntervalMs:
                  1000,

                beforeCycle:
                  async () => {
                    runs += 1;
                  },

                dependencies: {
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

          expect(runs)
            .toBe(1);

          expect(result.cycles)
            .toBe(1);

          expect(result.reason)
            .toBe('MANUAL_STOP');
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