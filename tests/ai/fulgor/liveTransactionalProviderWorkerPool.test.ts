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
  issueLiveTierCanaryPermit,
} from '../../../scripts/fulgor/scheduler/liveProviderTierGate';

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
      'admits exactly one explicit 9+9 canary permit and rejects replay while default 9 remains denied',
      async () => {
        const adaptiveDecision =
          Object.freeze({
            schemaVersion:
              'VELNAR_ADAPTIVE_PROVIDER_SCALER_V1',

            codex:
              Object.freeze({
                provider:
                  'codex' as const,

                action:
                  'SCALE_UP' as const,

                reason:
                  'HEALTHY_SCALE_UP' as const,

                previousTargetSlots:
                  8,

                nextTargetSlots:
                  9,

                usefulYield:
                  1,

                nextHealthyWindows:
                  0,

                throughputRatioToPriorTier:
                  null,
              }),

            antigravity:
              Object.freeze({
                provider:
                  'antigravity' as const,

                action:
                  'SCALE_UP' as const,

                reason:
                  'HEALTHY_SCALE_UP' as const,

                previousTargetSlots:
                  8,

                nextTargetSlots:
                  9,

                usefulYield:
                  1,

                nextHealthyWindows:
                  0,

                throughputRatioToPriorTier:
                  null,
              }),

            nextState:
              Object.freeze({
                codex:
                  Object.freeze({
                    provider:
                      'codex' as const,

                    targetSlots:
                      9,

                    healthyWindows:
                      0,

                    lastTargetChangeAtMs:
                      600_000,

                    priorTierUsefulPerMinute:
                      10,
                  }),

                antigravity:
                  Object.freeze({
                    provider:
                      'antigravity' as const,

                    targetSlots:
                      9,

                    healthyWindows:
                      0,

                    lastTargetChangeAtMs:
                      600_000,

                    priorTierUsefulPerMinute:
                      10,
                  }),

                preferAntigravityFirst:
                  false,
              }),

            totalTargetSlots:
              18,

            liveEnvelopeExpanded:
              false as const,

            authorityGranted:
              false as const,
          });

        const db =
          join(
            root(),
            'tier-gate.sqlite',
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

        /*
         * Existing default remains fail closed.
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

        const permit =
          issueLiveTierCanaryPermit({
            baseline,

            nowMs:
              1_000_000,

            ttlMs:
              60_000,

            previousTierEvidenceSha256:
              'b'.repeat(64),

            adaptiveDecision,
          });

        const result =
          await runLiveTransactionalProviderWorkerPool({
            ...base,

            codexSlots:
              9,

            antigravitySlots:
              9,

            currentBaseline:
              baseline,

            liveTierCanaryPermit:
              permit,
          });

        /*
         * Empty queue: proving admission does not call
         * an injected provider.
         */
        expect(
          result.totalSlots,
        ).toBe(18);

        expect(
          result.totalLiveProviderCalls,
        ).toBe(0);

        await expect(
          runLiveTransactionalProviderWorkerPool({
            ...base,

            codexSlots:
              9,

            antigravitySlots:
              9,

            currentBaseline:
              baseline,

            liveTierCanaryPermit:
              permit,
          }),
        ).rejects.toThrow(
          /PERMIT_REPLAYED/,
        );
      },
    );

  },
);
