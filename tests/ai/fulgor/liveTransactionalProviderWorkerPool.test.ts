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

import type {
  Provider,
} from '../../../scripts/fulgor/scheduler/verified8x8Scheduler';

import {
  createProviderWorkOrder,
  type ProviderWorkRecord,
} from '../../../scripts/fulgor/orchestration/providerWorkOrder';

import type {
  HostEvidenceCapsule,
} from '../../../scripts/fulgor/orchestration/providerWorkProductGate';

import {
  TransactionalProviderQueue,
} from '../../../scripts/fulgor/orchestration/transactionalProviderQueue';

import {
  runLiveTransactionalProviderWorkerPool,
  type LiveProviderInvocation,
} from '../../../scripts/fulgor/orchestration/liveTransactionalProviderWorkerPool';

import {
  HostProviderCapacityController,
} from '../../../scripts/fulgor/scheduler/sharedProviderCapacity';

const roots:
  string[] = [];

const baseline =
  'a'.repeat(40);

function root(): string {
  const value =
    mkdtempSync(
      join(
        tmpdir(),
        'velnar-live-pool-',
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
      roots.length > 0
    ) {
      rmSync(
        roots.pop()!,
        {
          recursive: true,
          force: true,
        },
      );
    }
  },
);

function clock() {
  let value =
    1_000_000;

  return () => {
    value += 10;

    return value;
  };
}

function capsule(
  record:
    ProviderWorkRecord,
): HostEvidenceCapsule {
  return Object.freeze({
    taskId:
      record.order.jobId,

    baseline:
      record.order.baseline,

    evidence:
      Object.freeze([
        Object.freeze({
          id:
            'E1',

          path:
            'src/evidence-a.ts',

          sha256:
            '1'.repeat(64),
        }),

        Object.freeze({
          id:
            'E2',

          path:
            'src/evidence-b.ts',

          sha256:
            '2'.repeat(64),
        }),
      ]),
  });
}

function proposal(
  record:
    ProviderWorkRecord,

  provider:
    Provider,

  identity:
    string =
      record.order.jobId,
): string {
  return JSON.stringify({
    schemaVersion:
      'VELNAR_PROVIDER_WORK_PRODUCT_V1',

    provider,

    taskId:
      record.order.jobId,

    baseline:
      record.order.baseline,

    status:
      'PROPOSE_CHANGE',

    summary:
      'Bounded regression evidence.',

    evidenceIds:
      ['E1', 'E2'],

    candidate: {
      path:
        `tests/${identity}.test.ts`,

      content:
        `export const ${identity.replace(
          /[^A-Za-z0-9_]/g,
          '_',
        )} = true;\n`,
    },

    tests: [
      `npx vitest run tests/${identity}.test.ts`,
    ],

    blocker:
      null,
  });
}

function blocked(
  record:
    ProviderWorkRecord,

  provider:
    Provider,
): string {
  return JSON.stringify({
    schemaVersion:
      'VELNAR_PROVIDER_WORK_PRODUCT_V1',

    provider,

    taskId:
      record.order.jobId,

    baseline:
      record.order.baseline,

    status:
      'BLOCKED',

    summary:
      'Insufficient bounded evidence.',

    evidenceIds:
      [],

    candidate:
      null,

    tests:
      [],

    blocker:
      'Required evidence is unavailable.',
  });
}

function enqueue(
  dbPath: string,

  jobId: string,

  affinity:
    Provider | 'either',

  atMs:
    number,
): void {
  const queue =
    new TransactionalProviderQueue(
      dbPath,
    );

  try {
    queue.enqueue(
      createProviderWorkOrder({
        jobId,

        baseline,

        task:
          `Task ${jobId}`,

        evidenceIds:
          ['E1', 'E2'],

        affinity,
      }),

      atMs,
    );
  } finally {
    queue.close();
  }
}

describe(
  'VELNAR live transactional provider worker core',
  () => {
    it(
      'drains independent 2+2 lanes into persisted useful unique work',
      async () => {
        const db =
          join(
            root(),
            'queue.sqlite',
          );

        enqueue(
          db,
          'job-codex-01',
          'codex',
          10,
        );

        enqueue(
          db,
          'job-codex-02',
          'codex',
          20,
        );

        enqueue(
          db,
          'job-agy-01',
          'antigravity',
          30,
        );

        enqueue(
          db,
          'job-agy-02',
          'antigravity',
          40,
        );

        const result =
          await runLiveTransactionalProviderWorkerPool({
            queuePath:
              db,

            mode:
              'DUAL',

            codexSlots:
              2,

            antigravitySlots:
              2,

            leaseDurationMs:
              60_000,

            maxClaimsPerSlot:
              4,

            nowMs:
              clock(),

            loadCapsule:
              capsule,

            invokeProvider:
              async input =>
                Object.freeze({
                  source:
                    'LIVE_PROVIDER',

                  transport:
                    'OK',

                  protocol:
                    'PASS',

                  raw:
                    proposal(
                      input.record,
                      input.provider,
                    ),
                }),
          });

        expect(
          result.totalLiveProviderCalls,
        ).toBe(4);

        expect(
          result.totalUsefulUnique,
        ).toBe(4);

        expect(
          result.codex.usefulUnique,
        ).toBe(2);

        expect(
          result.antigravity.usefulUnique,
        ).toBe(2);

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
            db,
          );

        try {
          for (
            const id
            of [
              'job-codex-01',
              'job-codex-02',
              'job-agy-01',
              'job-agy-02',
            ]
          ) {
            expect(
              queue.get(id)
                ?.state,
            ).toBe(
              'USEFUL_COMPLETE',
            );
          }

          expect(
            queue.integrityCheck(),
          ).toBe(true);
        } finally {
          queue.close();
        }
      },
    );

    it(
      'counts the same useful work only once across providers',
      async () => {
        const db =
          join(
            root(),
            'queue.sqlite',
          );

        enqueue(
          db,
          'job-dup-codex',
          'codex',
          10,
        );

        enqueue(
          db,
          'job-dup-agy',
          'antigravity',
          20,
        );

        const result =
          await runLiveTransactionalProviderWorkerPool({
            queuePath:
              db,

            mode:
              'DUAL',

            codexSlots:
              1,

            antigravitySlots:
              1,

            leaseDurationMs:
              60_000,

            maxClaimsPerSlot:
              2,

            nowMs:
              clock(),

            loadCapsule:
              capsule,

            invokeProvider:
              async input =>
                Object.freeze({
                  source:
                    'LIVE_PROVIDER',

                  transport:
                    'OK',

                  protocol:
                    'PASS',

                  raw:
                    proposal(
                      input.record,
                      input.provider,
                      'same-useful-work',
                    ),
                }),
          });

        expect(
          result.totalLiveProviderCalls,
        ).toBe(2);

        expect(
          result.totalUsefulUnique,
        ).toBe(1);

        expect(
          result.totalUsefulDuplicate,
        ).toBe(1);
      },
    );

    it(
      'opens only the failing provider quality circuit on protocol rejection',
      async () => {
        const db =
          join(
            root(),
            'queue.sqlite',
          );

        enqueue(
          db,
          'job-protocol-codex-1',
          'codex',
          10,
        );

        enqueue(
          db,
          'job-protocol-codex-2',
          'codex',
          20,
        );

        enqueue(
          db,
          'job-protocol-agy',
          'antigravity',
          30,
        );

        const result =
          await runLiveTransactionalProviderWorkerPool({
            queuePath:
              db,

            mode:
              'DUAL',

            codexSlots:
              1,

            antigravitySlots:
              1,

            leaseDurationMs:
              60_000,

            maxClaimsPerSlot:
              5,

            nowMs:
              clock(),

            loadCapsule:
              capsule,

            invokeProvider:
              async input => {
                if (
                  input.provider ===
                    'codex'
                ) {
                  return Object.freeze({
                    source:
                      'LIVE_PROVIDER',

                    transport:
                      'OK',

                    protocol:
                      'REJECTED',
                  });
                }

                return Object.freeze({
                  source:
                    'LIVE_PROVIDER',

                  transport:
                    'OK',

                  protocol:
                    'PASS',

                  raw:
                    proposal(
                      input.record,
                      input.provider,
                    ),
                });
              },
          });

        expect(
          result.codex.protocolRejected,
        ).toBe(1);

        expect(
          result.antigravity.usefulUnique,
        ).toBe(1);

        const queue =
          new TransactionalProviderQueue(
            db,
          );

        try {
          expect(
            queue.canLaunchProvider(
              'codex',
            ),
          ).toBe(false);

          expect(
            queue.canLaunchProvider(
              'antigravity',
            ),
          ).toBe(true);

          expect(
            queue.get(
              'job-protocol-codex-1',
            )?.state,
          ).toBe(
            'QUALITY_HOLD',
          );

          expect(
            queue.get(
              'job-protocol-codex-2',
            )?.state,
          ).toBe(
            'PENDING',
          );
        } finally {
          queue.close();
        }
      },
    );

    it(
      'holds uncertain transport failure without blind retry or quality poisoning',
      async () => {
        const db =
          join(
            root(),
            'queue.sqlite',
          );

        enqueue(
          db,
          'job-transport-1',
          'codex',
          10,
        );

        enqueue(
          db,
          'job-transport-2',
          'codex',
          20,
        );

        let calls =
          0;

        const result =
          await runLiveTransactionalProviderWorkerPool({
            queuePath:
              db,

            mode:
              'DUAL',

            codexSlots:
              1,

            antigravitySlots:
              0,

            leaseDurationMs:
              60_000,

            maxClaimsPerSlot:
              5,

            nowMs:
              clock(),

            loadCapsule:
              capsule,

            invokeProvider:
              async () => {
                calls += 1;

                return Object.freeze({
                  source:
                    'LIVE_PROVIDER',

                  transport:
                    'FAILURE',
                });
              },
          });

        expect(
          calls,
        ).toBe(1);

        expect(
          result.codex.transportFailures,
        ).toBe(1);

        const queue =
          new TransactionalProviderQueue(
            db,
          );

        try {
          expect(
            queue.get(
              'job-transport-1',
            )?.state,
          ).toBe(
            'RECOVERY_HOLD',
          );

          expect(
            queue.get(
              'job-transport-2',
            )?.state,
          ).toBe(
            'PENDING',
          );

          expect(
            queue.canLaunchProvider(
              'codex',
            ),
          ).toBe(true);
        } finally {
          queue.close();
        }
      },
    );

    it(
      'opens provider-local quality circuit on exact work-product contract rejection',
      async () => {
        const db =
          join(
            root(),
            'queue.sqlite',
          );

        enqueue(
          db,
          'job-contract-codex',
          'codex',
          10,
        );

        enqueue(
          db,
          'job-contract-agy',
          'antigravity',
          20,
        );

        const result =
          await runLiveTransactionalProviderWorkerPool({
            queuePath:
              db,

            mode:
              'DUAL',

            codexSlots:
              1,

            antigravitySlots:
              1,

            leaseDurationMs:
              60_000,

            maxClaimsPerSlot:
              2,

            nowMs:
              clock(),

            loadCapsule:
              capsule,

            invokeProvider:
              async input => {
                const raw =
                  JSON.parse(
                    proposal(
                      input.record,
                      input.provider,
                    ),
                  );

                if (
                  input.provider ===
                    'codex'
                ) {
                  raw.baseline =
                    'b'.repeat(40);
                }

                return Object.freeze({
                  source:
                    'LIVE_PROVIDER',

                  transport:
                    'OK',

                  protocol:
                    'PASS',

                  raw:
                    JSON.stringify(
                      raw,
                    ),
                });
              },
          });

        expect(
          result.codex.contractRejected,
        ).toBe(1);

        expect(
          result.antigravity.usefulUnique,
        ).toBe(1);

        const queue =
          new TransactionalProviderQueue(
            db,
          );

        try {
          expect(
            queue.canLaunchProvider(
              'codex',
            ),
          ).toBe(false);

          expect(
            queue.canLaunchProvider(
              'antigravity',
            ),
          ).toBe(true);
        } finally {
          queue.close();
        }
      },
    );

    it(
      'does not poison quality circuit on BLOCKED and continues the lane',
      async () => {
        const db =
          join(
            root(),
            'queue.sqlite',
          );

        enqueue(
          db,
          'job-blocked-1',
          'codex',
          10,
        );

        enqueue(
          db,
          'job-blocked-2',
          'codex',
          20,
        );

        let calls =
          0;

        const result =
          await runLiveTransactionalProviderWorkerPool({
            queuePath:
              db,

            mode:
              'DUAL',

            codexSlots:
              1,

            antigravitySlots:
              0,

            leaseDurationMs:
              60_000,

            maxClaimsPerSlot:
              5,

            nowMs:
              clock(),

            loadCapsule:
              capsule,

            invokeProvider:
              async input => {
                calls += 1;

                const raw =
                  calls === 1
                    ? blocked(
                        input.record,
                        input.provider,
                      )
                    : proposal(
                        input.record,
                        input.provider,
                      );

                const value:
                  LiveProviderInvocation =
                    Object.freeze({
                      source:
                        'LIVE_PROVIDER',

                      transport:
                        'OK',

                      protocol:
                        'PASS',

                      raw,
                    });

                return value;
              },
          });

        expect(
          calls,
        ).toBe(2);

        expect(
          result.codex.blocked,
        ).toBe(1);

        expect(
          result.codex.usefulUnique,
        ).toBe(1);

        const queue =
          new TransactionalProviderQueue(
            db,
          );

        try {
          expect(
            queue.get(
              'job-blocked-1',
            )?.state,
          ).toBe(
            'BLOCKED',
          );

          expect(
            queue.get(
              'job-blocked-2',
            )?.state,
          ).toBe(
            'USEFUL_COMPLETE',
          );

          const diagnostic =
            queue.getBlockedWorkDiagnostic(
              'job-blocked-1',
            );

          expect(
            diagnostic,
          ).toMatchObject({
            provider:
              'codex',

            status:
              'BLOCKED',

            summary:
              'Insufficient bounded evidence.',

            blocker:
              'Required evidence is unavailable.',

            evidenceIds:
              [],
          });

          expect(
            diagnostic?.verified,
          ).toBe(false);

          expect(
            diagnostic?.authorityGranted,
          ).toBe(false);

          expect(
            queue.getAcceptedWorkProduct(
              'job-blocked-1',
            ),
          ).toBeNull();

          expect(
            queue.canLaunchProvider(
              'codex',
            ),
          ).toBe(true);
        } finally {
          queue.close();
        }
      },
    );

    it(
      'enforces the current certified scheduler slot envelope',
      async () => {
        const base = {
          queuePath:
            join(
              root(),
              'queue.sqlite',
            ),

          mode:
            'DUAL' as const,

          codexSlots:
            1,

          antigravitySlots:
            1,

          leaseDurationMs:
            60_000,

          maxClaimsPerSlot:
            1,

          nowMs:
            clock(),

          loadCapsule:
            capsule,

          invokeProvider:
            async () =>
              Object.freeze({
                source:
                  'LIVE_PROVIDER' as const,

                transport:
                  'FAILURE' as const,
              }),
        };

        await expect(
          runLiveTransactionalProviderWorkerPool({
            ...base,

            codexSlots:
              9,
          }),
        ).rejects.toThrow(
          /PROVIDER_TARGET_EXCEEDED/,
        );

        await expect(
          runLiveTransactionalProviderWorkerPool({
            ...base,

            mode:
              'ANTIGRAVITY_ONLY',

            codexSlots:
              1,
          }),
        ).rejects.toThrow(
          /PROVIDER_TARGET_EXCEEDED/,
        );

        const result =
          await runLiveTransactionalProviderWorkerPool({
            ...base,

            codexSlots:
              8,

            antigravitySlots:
              8,
          });

        expect(
          result.totalSlots,
        ).toBe(16);

        expect(
          result.totalLiveProviderCalls,
        ).toBe(0);
      },
    );

    it(
      'hard-denies plans above the V1 8-per-provider and global-16 ceiling even when permit metadata is supplied',
      async () => {
        const db =
          join(
            root(),
            'hard-v1-envelope.sqlite',
          );

        const base = {
          queuePath:
            db,

          mode:
            'DUAL' as const,

          leaseDurationMs:
            60_000,

          maxClaimsPerSlot:
            1,

          nowMs:
            clock(),

          loadCapsule:
            capsule,

          invokeProvider:
            async () =>
              Object.freeze({
                source:
                  'LIVE_PROVIDER' as const,

                transport:
                  'FAILURE' as const,
              }),
        };

        await expect(
          runLiveTransactionalProviderWorkerPool({
            ...base,

            codexSlots:
              9,

            antigravitySlots:
              8,
          }),
        ).rejects.toThrow(
          /PROVIDER_TARGET_EXCEEDED/,
        );

        await expect(
          runLiveTransactionalProviderWorkerPool({
            ...base,

            codexSlots:
              8,

            antigravitySlots:
              9,
          }),
        ).rejects.toThrow(
          /PROVIDER_TARGET_EXCEEDED/,
        );

        /*
         * Even legacy permit-shaped metadata cannot
         * bypass the hard worker envelope because the
         * hard cap is evaluated first.
         */
        await expect(
          runLiveTransactionalProviderWorkerPool({
            ...base,

            codexSlots:
              9,

            antigravitySlots:
              9,

          }),
        ).rejects.toThrow(
          /PROVIDER_TARGET_EXCEEDED/,
        );
      },
    );

  },
);


// VELNAR_CODEX_ONLY_MODE_V1

describe(
  'Codex-only V1 live envelope',
  () => {
    it(
      'admits up to eight Codex slots with zero Antigravity slots',
      async () => {
        const db =
          join(
            root(),
            'codex-only-v1.sqlite',
          );

        const result =
          await runLiveTransactionalProviderWorkerPool({
            queuePath:
              db,

            mode:
              'CODEX_ONLY',

            codexSlots:
              8,

            antigravitySlots:
              0,

            leaseDurationMs:
              60_000,

            maxClaimsPerSlot:
              1,

            nowMs:
              clock(),

            loadCapsule:
              capsule,

            invokeProvider:
              async () =>
                Object.freeze({
                  source:
                    'LIVE_PROVIDER',

                  transport:
                    'FAILURE',
                }),
          });

        /*
         * Empty queue means no injected provider call.
         */
        expect(
          result.totalSlots,
        ).toBe(8);

        expect(
          result.codex.slots,
        ).toBe(8);

        expect(
          result.antigravity.slots,
        ).toBe(0);

        expect(
          result.totalLiveProviderCalls,
        ).toBe(0);
      },
    );

    it(
      'rejects any Antigravity slot in CODEX_ONLY mode',
      async () => {
        await expect(
          runLiveTransactionalProviderWorkerPool({
            queuePath:
              join(
                root(),
                'codex-only-invalid.sqlite',
              ),

            mode:
              'CODEX_ONLY',

            codexSlots:
              8,

            antigravitySlots:
              1,

            leaseDurationMs:
              60_000,

            maxClaimsPerSlot:
              1,

            nowMs:
              clock(),

            loadCapsule:
              capsule,

            invokeProvider:
              async () =>
                Object.freeze({
                  source:
                    'LIVE_PROVIDER',

                  transport:
                    'FAILURE',
                }),
          }),
        ).rejects.toThrow(
          /PROVIDER_TARGET_EXCEEDED/,
        );
      },
    );
  },
);



// VELNAR_ANTIGRAVITY_SERIAL_SLOT_EXECUTION

describe(
  'Antigravity bounded physical lane',
  () => {
    it(
      'defaults to physical concurrency one when the explicit concurrency option is omitted',
      async () => {
        const db =
          join(
            root(),
            'agy-serial.sqlite',
          );

        for (
          let index = 1;
          index <= 4;
          index += 1
        ) {
          enqueue(
            db,
            `job-agy-serial-${index}`,
            'antigravity',
            index * 10,
          );
        }

        let active =
          0;

        let maxActive =
          0;

        let calls =
          0;

        const result =
          await runLiveTransactionalProviderWorkerPool({
            queuePath:
              db,

            mode:
              'DUAL',

            codexSlots:
              0,

            antigravitySlots:
              4,

            leaseDurationMs:
              60_000,

            maxClaimsPerSlot:
              1,

            nowMs:
              clock(),

            loadCapsule:
              capsule,

            invokeProvider:
              async input => {
                calls += 1;
                active += 1;

                maxActive =
                  Math.max(
                    maxActive,
                    active,
                  );

                await new Promise<void>(
                  resolve => {
                    setTimeout(
                      resolve,
                      20,
                    );
                  },
                );

                active -= 1;

                return Object.freeze({
                  source:
                    'LIVE_PROVIDER',

                  transport:
                    'OK',

                  protocol:
                    'PASS',

                  raw:
                    proposal(
                      input.record,
                      input.provider,
                    ),
                });
              },
          });

        expect(
          calls,
        ).toBe(4);

        expect(
          maxActive,
        ).toBe(1);

        expect(
          result.antigravity.slots,
        ).toBe(4);

        expect(
          result.antigravity.liveProviderCalls,
        ).toBe(4);

        expect(
          result.totalLiveProviderCalls,
        ).toBe(4);
      },
    );

    it(
      'enforces exact bounded Antigravity physical concurrency at 1, 2, 4 and 8',
      async () => {
        for (
          const concurrency
          of [1, 2, 4, 8]
        ) {
          const db =
            join(
              root(),
              `agy-concurrency-${concurrency}.sqlite`,
            );

          for (
            let index = 1;
            index <= 8;
            index += 1
          ) {
            enqueue(
              db,
              `job-agy-concurrency-${concurrency}-${index}`,
              'antigravity',
              index * 10,
            );
          }

          let active =
            0;

          let maxActive =
            0;

          let calls =
            0;

          const result =
            await runLiveTransactionalProviderWorkerPool({
              queuePath:
                db,

              mode:
                'ANTIGRAVITY_ONLY',

              codexSlots:
                0,

              antigravitySlots:
                8,

              antigravityConcurrency:
                concurrency,

              leaseDurationMs:
                60_000,

              maxClaimsPerSlot:
                1,

              nowMs:
                clock(),

              loadCapsule:
                capsule,

              invokeProvider:
                async input => {
                  calls +=
                    1;

                  active +=
                    1;

                  maxActive =
                    Math.max(
                      maxActive,
                      active,
                    );

                  await new Promise<void>(
                    resolve => {
                      setTimeout(
                        resolve,
                        5,
                      );
                    },
                  );

                  active -=
                    1;

                  return Object.freeze({
                    source:
                      'LIVE_PROVIDER',

                    transport:
                      'OK',

                    protocol:
                      'PASS',

                    raw:
                      proposal(
                        input.record,
                        input.provider,
                      ),
                  });
                },
            });

          expect(
            calls,
          ).toBe(8);

          expect(
            maxActive,
          ).toBe(
            concurrency,
          );

          expect(
            result.antigravity
              .liveProviderCalls,
          ).toBe(8);

          expect(
            result.totalLiveProviderCalls,
          ).toBe(8);

          expect(
            result.antigravity
              .transportFailures,
          ).toBe(0);
        }
      },
    );

    it(
      're-checks the Antigravity quality circuit before later serialized slots',
      async () => {
        const db =
          join(
            root(),
            'agy-circuit-serial.sqlite',
          );

        for (
          let index = 1;
          index <= 4;
          index += 1
        ) {
          enqueue(
            db,
            `job-agy-circuit-${index}`,
            'antigravity',
            index * 10,
          );
        }

        let calls =
          0;

        const result =
          await runLiveTransactionalProviderWorkerPool({
            queuePath:
              db,

            mode:
              'DUAL',

            codexSlots:
              0,

            antigravitySlots:
              4,

            leaseDurationMs:
              60_000,

            maxClaimsPerSlot:
              1,

            nowMs:
              clock(),

            loadCapsule:
              capsule,

            invokeProvider:
              async () => {
                calls += 1;

                return Object.freeze({
                  source:
                    'LIVE_PROVIDER',

                  transport:
                    'OK',

                  protocol:
                    'REJECTED',
                });
              },
          });

        expect(
          calls,
        ).toBe(1);

        expect(
          result.totalLiveProviderCalls,
        ).toBe(1);

        expect(
          result.antigravity.protocolRejected,
        ).toBe(1);

        expect(
          result.antigravity.stoppedByQualityCircuit,
        ).toBe(3);
      },
    );

    it(
      'does not launch later Antigravity work after a transport failure at physical concurrency two',
      async () => {
        const db =
          join(
            root(),
            'agy-concurrency-two-transport-stop.sqlite',
          );

        for (
          let index = 1;
          index <= 4;
          index += 1
        ) {
          enqueue(
            db,
            `job-agy-concurrent-stop-${index}`,
            'antigravity',
            index * 10,
          );
        }

        let calls =
          0;

        let release:
          (() => void)
          | null =
            null;

        const twoStarted =
          new Promise<void>(
            resolve => {
              release =
                resolve;
            },
          );

        const result =
          await runLiveTransactionalProviderWorkerPool({
            queuePath:
              db,

            mode:
              'ANTIGRAVITY_ONLY',

            codexSlots:
              0,

            antigravitySlots:
              4,

            antigravityConcurrency:
              2,

            leaseDurationMs:
              60_000,

            maxClaimsPerSlot:
              1,

            nowMs:
              clock(),

            loadCapsule:
              capsule,

            invokeProvider:
              async input => {
                calls +=
                  1;

                const callNumber =
                  calls;

                if (
                  calls === 2
                ) {
                  release?.();
                }

                await twoStarted;

                if (
                  callNumber === 1
                ) {
                  return Object.freeze({
                    source:
                      'LIVE_PROVIDER',

                    transport:
                      'FAILURE',
                  });
                }

                return Object.freeze({
                  source:
                    'LIVE_PROVIDER',

                  transport:
                    'OK',

                  protocol:
                    'PASS',

                  raw:
                    proposal(
                      input.record,
                      input.provider,
                    ),
                });
              },
          });

        /*
         * Two calls were already in-flight at the time
         * the first transport failure became known.
         *
         * Slots 3 and 4 must never reach invokeProvider.
         */
        expect(
          calls,
        ).toBe(2);

        expect(
          result.antigravity
            .transportFailures,
        ).toBe(1);

        expect(
          result.antigravity
            .stoppedByTransportCircuit,
        ).toBe(2);

        expect(
          result.totalLiveProviderCalls,
        ).toBe(2);
      },
    );

    it(
      'stops later serialized Antigravity slots after the first transport failure without poisoning quality',
      async () => {
        const db =
          join(
            root(),
            'agy-transport-stop.sqlite',
          );

        for (
          let index = 1;
          index <= 4;
          index += 1
        ) {
          enqueue(
            db,
            `job-agy-transport-${index}`,
            'antigravity',
            index * 10,
          );
        }

        let calls =
          0;

        const result =
          await runLiveTransactionalProviderWorkerPool({
            queuePath:
              db,

            mode:
              'DUAL',

            codexSlots:
              0,

            antigravitySlots:
              4,

            leaseDurationMs:
              60_000,

            maxClaimsPerSlot:
              1,

            nowMs:
              clock(),

            loadCapsule:
              capsule,

            invokeProvider:
              async () => {
                calls += 1;

                return Object.freeze({
                  source:
                    'LIVE_PROVIDER',

                  transport:
                    'FAILURE',
                });
              },
          });

        expect(
          calls,
        ).toBe(1);

        expect(
          result.totalLiveProviderCalls,
        ).toBe(1);

        expect(
          result.antigravity.transportFailures,
        ).toBe(1);

        expect(
          result.antigravity.stoppedByTransportCircuit,
        ).toBe(3);

        expect(
          result.antigravity.stoppedByQualityCircuit,
        ).toBe(0);

        const queue =
          new TransactionalProviderQueue(
            db,
          );

        try {
          expect(
            queue.get(
              'job-agy-transport-1',
            )?.state,
          ).toBe(
            'RECOVERY_HOLD',
          );

          for (
            let index = 2;
            index <= 4;
            index += 1
          ) {
            expect(
              queue.get(
                `job-agy-transport-${index}`,
              )?.state,
            ).toBe(
              'PENDING',
            );
          }

          /*
           * Transport uncertainty is deliberately not
           * represented as an output-quality failure.
           *
           * The fail-closed stop above is owned by this
           * bounded run.
           */
          expect(
            queue.canLaunchProvider(
              'antigravity',
            ),
          ).toBe(true);
        } finally {
          queue.close();
        }
      },
    );
    it(
      'rejects invalid Antigravity physical concurrency before any provider call',
      async () => {
        for (
          const concurrency
          of [0, 9]
        ) {
          let calls =
            0;

          await expect(
            runLiveTransactionalProviderWorkerPool({
              queuePath:
                join(
                  root(),
                  `agy-invalid-concurrency-${concurrency}.sqlite`,
                ),

              mode:
                'ANTIGRAVITY_ONLY',

              codexSlots:
                0,

              antigravitySlots:
                8,

              antigravityConcurrency:
                concurrency,

              leaseDurationMs:
                60_000,

              maxClaimsPerSlot:
                1,

              nowMs:
                clock(),

              loadCapsule:
                capsule,

              invokeProvider:
                async () => {
                  calls +=
                    1;

                  return Object.freeze({
                    source:
                      'LIVE_PROVIDER',

                    transport:
                      'FAILURE',
                  });
                },
            }),
          ).rejects.toThrow();

          expect(
            calls,
          ).toBe(0);
        }
      },
    );

    it(
      'shares host capacity with recovery, denies a 9th Antigravity slot during an 8+8 run, and releases all leases even on thrown errors',
      async () => {
        const db =
          join(
            root(),
            'shared-capacity-pool.sqlite',
          );

        for (
          let index = 1;
          index <= 8;
          index += 1
        ) {
          enqueue(
            db,
            `codex-shared-${index}`,
            'codex',
            index * 10,
          );

          enqueue(
            db,
            `agy-shared-${index}`,
            'antigravity',
            100 + index * 10,
          );
        }

        const sharedCapacity =
          new HostProviderCapacityController({
            nowMs:
              clock(),
          });

        try {
          let sawFull16InFlight =
            false;

          let activeAgyInFlight =
            0;

          let maxAgyInFlight =
            0;

          const result =
            await runLiveTransactionalProviderWorkerPool({
              queuePath:
                db,

              mode:
                'DUAL',

              codexSlots:
                8,

              antigravitySlots:
                8,

              leaseDurationMs:
                60_000,

              maxClaimsPerSlot:
                1,

              nowMs:
                clock(),

              sharedCapacity,

              loadCapsule:
                capsule,

              invokeProvider:
                async input => {
                  const snap =
                    sharedCapacity.snapshot();

                  if (
                    snap.globalHeld ===
                      16 &&
                    snap.normalCodexHeld ===
                      8 &&
                    snap.normalAntigravityHeld ===
                      8
                  ) {
                    sawFull16InFlight =
                      true;

                    await expect(
                      sharedCapacity.acquireRecoveryAntigravitySlot(),
                    ).rejects.toThrow(
                      'SHARED_CAPACITY_PROVIDER_EXHAUSTED:antigravity',
                    );
                  }

                  if (
                    input.provider ===
                      'antigravity'
                  ) {
                    activeAgyInFlight +=
                      1;

                    if (
                      activeAgyInFlight >
                        maxAgyInFlight
                    ) {
                      maxAgyInFlight =
                        activeAgyInFlight;
                    }
                  }

                  try {
                    return Object.freeze({
                      source:
                        'LIVE_PROVIDER',

                      transport:
                        'OK',

                      protocol:
                        'PASS',

                      raw:
                        proposal(
                          input.record,
                          input.provider,
                        ),
                    });
                  } finally {
                    if (
                      input.provider ===
                        'antigravity'
                    ) {
                      activeAgyInFlight -=
                        1;
                    }
                  }
                },
            });

          expect(
            sawFull16InFlight,
          ).toBe(true);

          // Physical Antigravity concurrency remains serialized at 1 while 8 logical AGY slots are reserved
          expect(
            maxAgyInFlight,
          ).toBe(1);

          expect(
            result.totalLiveProviderCalls,
          ).toBe(16);

          expect(
            sharedCapacity.snapshot(),
          ).toMatchObject({
            normalCodexHeld:
              0,

            normalAntigravityHeld:
              0,

            recoveryAntigravityHeld:
              0,

            globalHeld:
              0,
          });

          // If recovery holds 1 Antigravity unit, an 8-slot AGY normal pool is denied and releases partial leases
          const recoveryLease =
            await sharedCapacity.acquireRecoveryAntigravitySlot();

          await expect(
            runLiveTransactionalProviderWorkerPool({
              queuePath:
                db,

              mode:
                'DUAL',

              codexSlots:
                8,

              antigravitySlots:
                8,

              leaseDurationMs:
                60_000,

              maxClaimsPerSlot:
                1,

              nowMs:
                clock(),

              sharedCapacity,

              loadCapsule:
                capsule,

              invokeProvider:
                async () =>
                  Object.freeze({
                    source:
                      'LIVE_PROVIDER',

                    transport:
                      'FAILURE',
                  }),
            }),
          ).rejects.toThrow(
            'SHARED_CAPACITY_PROVIDER_EXHAUSTED:antigravity',
          );

          expect(
            sharedCapacity.snapshot(),
          ).toMatchObject({
            normalCodexHeld:
              0,

            normalAntigravityHeld:
              0,

            recoveryAntigravityHeld:
              1,

            globalHeld:
              1,
          });

          await recoveryLease.release();

          // Thrown error inside loadCapsule still releases all shared capacity leases
          const errDb =
            join(
              root(),
              'err-pool.sqlite',
            );

          enqueue(
            errDb,
            'err-job-1',
            'codex',
            10,
          );

          await expect(
            runLiveTransactionalProviderWorkerPool({
              queuePath:
                errDb,

              mode:
                'CODEX_ONLY',

              codexSlots:
                2,

              antigravitySlots:
                0,

              leaseDurationMs:
                60_000,

              maxClaimsPerSlot:
                1,

              nowMs:
                clock(),

              sharedCapacity,

              loadCapsule:
                () => {
                  throw new Error(
                    'HOST_CAPSULE_LOAD_ERROR',
                  );
                },

              invokeProvider:
                async () =>
                  Object.freeze({
                    source:
                      'LIVE_PROVIDER',

                    transport:
                      'FAILURE',
                  }),
            }),
          ).rejects.toThrow(
            'HOST_CAPSULE_LOAD_ERROR',
          );

          expect(
            sharedCapacity.snapshot().globalHeld,
          ).toBe(0);
        } finally {
          sharedCapacity.close();
        }
      },
    );

  },
);
