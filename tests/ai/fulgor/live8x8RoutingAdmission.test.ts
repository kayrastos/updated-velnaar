import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest';

import {
  mkdtempSync,
  rmSync,
} from 'node:fs';

import {
  tmpdir,
} from 'node:os';

import {
  join,
} from 'node:path';

import {
  emptyProviderQualityCounters,
} from '../../../scripts/fulgor/orchestration/providerWorkAccounting';

import {
  createProviderWorkOrder,
} from '../../../scripts/fulgor/orchestration/providerWorkOrder';

import {
  runLive8x8OneShot,
  type Live8x8OneShotJob,
} from '../../../scripts/fulgor/orchestration/live8x8OneShotRunner';

const baseline =
  '0123456789abcdef0123456789abcdef01234567';

const roots:
  string[] = [];

function root():
  string {
  const value =
    mkdtempSync(
      join(
        tmpdir(),
        'velnar-routed-one-shot-',
      ),
    );

  roots.push(value);

  return value;
}

afterEach(
  () => {
    while (
      roots.length > 0
    ) {
      rmSync(
        roots.pop()!,
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

function lane(
  provider:
    'codex' |
    'antigravity',
) {
  return Object.freeze({
    provider,

    taskClass:
      'GENERAL' as const,

    counters:
      emptyProviderQualityCounters(
        provider,
      ),

    certified:
      false,

    qualityCircuit:
      'CLOSED' as const,

    quotaCircuit:
      'CLOSED' as const,

    availableSlots:
      8,
  });
}

function routedJob(
  provider:
    'codex' |
    'antigravity',

  index:
    number,
): Live8x8OneShotJob {
  const jobId =
    `${provider}-${index}`;

  return Object.freeze({
    order:
      createProviderWorkOrder({
        jobId,

        baseline,

        task:
          `Bounded ${provider} task ${index}`,

        evidenceIds:
          ['E1'],

        affinity:
          provider,
      }),

    capsule:
      Object.freeze({
        taskId:
          jobId,

        baseline,

        evidence:
          Object.freeze([
            Object.freeze({
              id:
                'E1',

              path:
                'src/a.ts',

              sha256:
                '1'.repeat(64),
            }),
          ]),
      }),

    routing:
      Object.freeze({
        taskClass:
          'GENERAL' as const,

        codex:
          lane('codex'),

        antigravity:
          lane('antigravity'),
      }),
  });
}

describe(
  'VELNAR live routed admission',
  () => {
    it(
      'holds uncertified host evidence before provider invocation',
      async () => {
        const jobs:
          Live8x8OneShotJob[] =
            [];

        for (
          let index = 1;
          index <= 8;
          index += 1
        ) {
          jobs.push(
            routedJob(
              'codex',
              index,
            ),
          );
        }

        for (
          let index = 1;
          index <= 8;
          index += 1
        ) {
          jobs.push(
            routedJob(
              'antigravity',
              index,
            ),
          );
        }

        let calls =
          0;

        await expect(
          runLive8x8OneShot({
            queuePath:
              join(
                root(),
                'queue.sqlite',
              ),

            jobs:
              Object.freeze(
                jobs,
              ),

            invokeProvider:
              async () => {
                calls += 1;

                return Object.freeze({
                  source:
                    'LIVE_PROVIDER' as const,

                  transport:
                    'FAILURE' as const,
                });
              },

            nowMs:
              () => 1_000,

            leaseDurationMs:
              60_000,
          }),
        ).rejects.toThrow(
          /LIVE_8X8_ROUTING_ADMISSION_HOLD/,
        );

        expect(calls)
          .toBe(0);
      },
    );
  },
);
