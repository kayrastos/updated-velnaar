import {
  mkdtempSync,
  rmSync,
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

import {
  createProviderWorkOrder,
} from '../../../scripts/fulgor/orchestration/providerWorkOrder';

import {
  TransactionalProviderQueue,
} from '../../../scripts/fulgor/orchestration/transactionalProviderQueue';

import type {
  HostEvidenceCapsule,
} from '../../../scripts/fulgor/orchestration/providerWorkProductGate';

import type {
  LiveTransactionalPoolOptions,
  LiveTransactionalPoolResult,
} from '../../../scripts/fulgor/orchestration/liveTransactionalProviderWorkerPool';

import {
  runLive8x8OneShot,
} from '../../../scripts/fulgor/orchestration/live8x8OneShotRunner';

import {
  HostProviderCapacityController,
} from '../../../scripts/fulgor/scheduler/sharedProviderCapacity';

const baseline =
  '0123456789abcdef0123456789abcdef01234567';

const roots:
  string[] =
    [];

function root():
string {
  const directory =
    mkdtempSync(
      join(
        tmpdir(),
        'velnar-live8x8-one-shot-',
      ),
    );

  roots.push(
    directory,
  );

  return directory;
}

afterEach(
  () => {
    while (
      roots.length >
        0
    ) {
      const directory =
        roots.pop();

      if (
        directory
      ) {
        rmSync(
          directory,
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

function healthyLane(
  provider:
    'codex'
    | 'antigravity',
) {
  return Object.freeze({
    provider,

    taskClass:
      'GENERAL' as const,

    counters:
      Object.freeze({
        provider,

        attempts:
          8,

        transportFailures:
          0,

        protocolRejected:
          0,

        contractRejected:
          0,

        blocked:
          0,

        usefulDuplicate:
          0,

        usefulUnique:
          8,
      }),

    certified:
      true,

    qualityCircuit:
      'CLOSED' as const,

    quotaCircuit:
      'CLOSED' as const,

    availableSlots:
      8,
  });
}

function healthyRouting() {
  return Object.freeze({
    taskClass:
      'GENERAL' as const,

    codex:
      healthyLane(
        'codex',
      ),

    antigravity:
      healthyLane(
        'antigravity',
      ),
  });
}

function job(
  provider:
    'codex'
    | 'antigravity',

  index:
    number,
) {
  const jobId =
    `live8x8-${provider}-${String(
      index,
    ).padStart(2, '0')}`;

  const order =
    createProviderWorkOrder({
      jobId,

      baseline,

      task:
        `Bounded ${provider} task ${index}`,

      evidenceIds:
        ['E1', 'E2'],

      affinity:
        provider,
    });

  const capsule:
    HostEvidenceCapsule =
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
                'src/evidence-a.ts',

              sha256:
                'a'.repeat(64),
            }),

            Object.freeze({
              id:
                'E2',

              path:
                'src/evidence-b.ts',

              sha256:
                'b'.repeat(64),
            }),
          ]),
      });

  return Object.freeze({
    order,
    capsule,

    routing:
      healthyRouting(),});
}

function exactJobs() {
  return Object.freeze([
    ...Array.from(
      {
        length:
          8,
      },

      (
        _,
        index,
      ) =>
        job(
          'codex',
          index + 1,
        ),
    ),

    ...Array.from(
      {
        length:
          8,
      },

      (
        _,
        index,
      ) =>
        job(
          'antigravity',
          index + 1,
        ),
    ),
  ]);
}

function clock() {
  let value =
    10_000;

  return () => {
    value +=
      10;

    return value;
  };
}

function fakeResult():
LiveTransactionalPoolResult {
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
      'TEST_SCHEMA',

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
  }) as unknown as
    LiveTransactionalPoolResult;
}

describe(
  'VELNAR live 8+8 one-shot runner',
  () => {
    it(
      'pins exactly 8 Codex + 8 Antigravity with one claim per slot',
      async () => {
        const directory =
          root();

        const queuePath =
          join(
            directory,
            'queue.sqlite',
          );

        let captured:
          LiveTransactionalPoolOptions
          | null =
            null;

        const result =
          await runLive8x8OneShot(
            {
              queuePath,

              jobs:
                exactJobs(),

              invokeProvider:
                async () => {
                  throw new Error(
                    'REAL_PROVIDER_MUST_NOT_RUN_IN_TEST',
                  );
                },

              nowMs:
                clock(),
            },

            {
              runPool:
                async options => {
                  captured =
                    options;

                  return fakeResult();
                },
            },
          );

        expect(
          captured,
        ).not.toBeNull();

        expect(
          captured,
        ).toMatchObject({
          mode:
            'DUAL',

          codexSlots:
            8,

          antigravitySlots:
            8,

          maxClaimsPerSlot:
            1,
        });

        expect(
          captured &&
          'liveTierCanaryPermit'
            in captured,
        ).toBe(false);

        expect(
          result.expectedProviderCalls,
        ).toBe(16);

        expect(
          result.pool.totalUsefulUnique,
        ).toBe(16);

        expect(
          result.fulgorCalled,
        ).toBe(false);

        expect(
          result.verificationGranted,
        ).toBe(false);

        expect(
          result.authorityGranted,
        ).toBe(false);

        const queue =
          new TransactionalProviderQueue(
            queuePath,
          );

        try {
          for (
            const item
            of exactJobs()
          ) {
            expect(
              queue.get(
                item.order.jobId,
              ),
            ).not.toBeNull();
          }
        } finally {
          queue.close();
        }
      },
    );

    it(
      'rejects 9+7 before any pool execution',
      async () => {
        const directory =
          root();

        const jobs =
          Object.freeze([
            ...Array.from(
              {
                length:
                  9,
              },

              (
                _,
                index,
              ) =>
                job(
                  'codex',
                  index + 1,
                ),
            ),

            ...Array.from(
              {
                length:
                  7,
              },

              (
                _,
                index,
              ) =>
                job(
                  'antigravity',
                  index + 1,
                ),
            ),
          ]);

        let poolCalled =
          false;

        await expect(
          runLive8x8OneShot(
            {
              queuePath:
                join(
                  directory,
                  'queue.sqlite',
                ),

              jobs,

              invokeProvider:
                async () => {
                  throw new Error(
                    'PROVIDER_MUST_NOT_RUN',
                  );
                },

              nowMs:
                clock(),
            },

            {
              runPool:
                async () => {
                  poolCalled =
                    true;

                  return fakeResult();
                },
            },
          ),
        ).rejects.toThrow(
          /EXACT_8_PLUS_8_REQUIRED/,
        );

        expect(
          poolCalled,
        ).toBe(false);
      },
    );

    it(
      'refuses stale queue reuse',
      async () => {
        const directory =
          root();

        const queuePath =
          join(
            directory,
            'queue.sqlite',
          );

        const queue =
          new TransactionalProviderQueue(
            queuePath,
          );

        queue.close();

        await expect(
          runLive8x8OneShot({
            queuePath,

            jobs:
              exactJobs(),

            invokeProvider:
              async () => {
                throw new Error(
                  'PROVIDER_MUST_NOT_RUN',
                );
              },

            nowMs:
              clock(),
          }),
        ).rejects.toThrow(
          /QUEUE_ALREADY_EXISTS/,
        );
      },
    );

    it(
      'forwards the host sharedCapacity controller into the worker pool and denies admission when a recovery slot holds Antigravity capacity',
      async () => {
        const directory =
          root();

        const sharedCapacity =
          new HostProviderCapacityController({
            nowMs:
              clock(),
          });

        try {
          let receivedShared:
            HostProviderCapacityController
            | undefined;

          await runLive8x8OneShot(
            {
              queuePath:
                join(
                  directory,
                  'shared-pass.sqlite',
                ),

              jobs:
                exactJobs(),

              invokeProvider:
                async () => {
                  throw new Error(
                    'PROVIDER_MUST_NOT_RUN',
                  );
                },

              nowMs:
                clock(),

              sharedCapacity,
            },
            {
              runPool:
                async options => {
                  receivedShared =
                    options.sharedCapacity;

                  return fakeResult();
                },
            },
          );

          expect(
            receivedShared,
          ).toBe(
            sharedCapacity,
          );

          // Hold 1 recovery Antigravity unit on the same controller; real pool admission for 8+8 must fail closed
          const recoverySlot =
            await sharedCapacity.acquireRecoveryAntigravitySlot();

          await expect(
            runLive8x8OneShot({
              queuePath:
                join(
                  directory,
                  'shared-contended.sqlite',
                ),

              jobs:
                exactJobs(),

              invokeProvider:
                async () => {
                  throw new Error(
                    'PROVIDER_MUST_NOT_RUN',
                  );
                },

              nowMs:
                clock(),

              sharedCapacity,
            }),
          ).rejects.toThrow(
            'SHARED_CAPACITY_PROVIDER_EXHAUSTED:antigravity',
          );

          expect(
            sharedCapacity.snapshot().recoveryAntigravityHeld,
          ).toBe(1);

          expect(
            sharedCapacity.snapshot().normalAntigravityHeld,
          ).toBe(0);

          expect(
            sharedCapacity.snapshot().normalCodexHeld,
          ).toBe(0);

          await recoverySlot.release();
        } finally {
          sharedCapacity.close();
        }
      },
    );
  },
);
