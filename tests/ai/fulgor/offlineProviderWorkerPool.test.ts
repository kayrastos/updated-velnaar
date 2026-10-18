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
  PROVIDER_WORK_PRODUCT_SCHEMA,
  type HostEvidenceCapsule,
} from '../../../scripts/fulgor/orchestration/providerWorkProductGate';

import {
  createProviderWorkOrder,
  type ProviderWorkRecord,
} from '../../../scripts/fulgor/orchestration/providerWorkOrder';

import {
  TransactionalProviderQueue,
} from '../../../scripts/fulgor/orchestration/transactionalProviderQueue';

import {
  classifyWorkProductFailure,
  runOfflineProviderWorkerPool,
  type OfflineFakeProviderInput,
  type OfflineFakeProviderResult,
} from '../../../scripts/fulgor/orchestration/offlineProviderWorkerPool';

const baseline =
  '0123456789abcdef0123456789abcdef01234567';

const roots:
  string[] = [];

function root(): string {
  const value =
    mkdtempSync(
      join(
        tmpdir(),
        'velnar-offline-pool-',
      ),
    );

  roots.push(value);

  return value;
}

afterEach(
  () => {
    for (
      const value
      of roots.splice(0)
    ) {
      rmSync(
        value,
        {
          recursive: true,
          force: true,
        },
      );
    }
  },
);

interface Harness {
  readonly dbPath:
    string;

  readonly capsules:
    Map<
      string,
      HostEvidenceCapsule
    >;
}

function createHarness():
Harness {
  const base =
    root();

  return {
    dbPath:
      join(
        base,
        'queue.sqlite',
      ),

    capsules:
      new Map(),
  };
}

function capsuleFor(
  jobId: string,
  sharedEvidence = false,
): HostEvidenceCapsule {
  const key =
    sharedEvidence
      ? 'shared'
      : jobId;

  return {
    taskId:
      jobId,

    baseline,

    evidence: [
      {
        id: 'E1',

        path:
          `worker/${key}.ts`,

        sha256:
          sharedEvidence
            ? 'a'.repeat(64)
            : (
                jobId.includes(
                  'codex',
                )
                  ? 'b'
                  : 'c'
              ).repeat(64),
      },

      {
        id: 'E2',

        path:
          `tests/${key}.test.ts`,

        sha256:
          sharedEvidence
            ? 'd'.repeat(64)
            : (
                jobId.includes(
                  'codex',
                )
                  ? 'e'
                  : 'f'
              ).repeat(64),
      },
    ],
  };
}

function seed(
  harness:
    Harness,

  provider:
    'codex' |
    'antigravity',

  count:
    number,

  sharedEvidence =
    false,
): void {
  const queue =
    new TransactionalProviderQueue(
      harness.dbPath,
    );

  try {
    for (
      let index = 1;
      index <= count;
      index += 1
    ) {
      const jobId =
        `${provider}-job-${String(index)
          .padStart(3, '0')}`;

      const capsule =
        capsuleFor(
          jobId,
          sharedEvidence,
        );

      harness.capsules.set(
        jobId,
        capsule,
      );

      queue.enqueue(
        createProviderWorkOrder({
          jobId,

          baseline,

          task:
            'Produce one bounded evidence-backed offline work product.',

          evidenceIds:
            ['E1', 'E2'],

          affinity:
            provider,
        }),

        1000 + index,
      );
    }
  } finally {
    queue.close();
  }
}

function loadCapsule(
  harness:
    Harness,

  record:
    ProviderWorkRecord,
): HostEvidenceCapsule {
  const value =
    harness.capsules.get(
      record.order.jobId,
    );

  if (!value) {
    throw new Error(
      'TEST_CAPSULE_NOT_FOUND',
    );
  }

  return value;
}

function validProposal(
  input:
    OfflineFakeProviderInput,

  identity:
    string =
      input.record.order.jobId,
): OfflineFakeProviderResult {
  return {
    source:
      'OFFLINE_FAKE',

    transport:
      'OK',

    raw:
      JSON.stringify({
        schemaVersion:
          PROVIDER_WORK_PRODUCT_SCHEMA,

        provider:
          input.provider,

        taskId:
          input.capsule.taskId,

        baseline:
          input.capsule.baseline,

        status:
          'PROPOSE_CHANGE',

        summary:
          'Offline evidence-backed fake work product.',

        evidenceIds:
          ['E1', 'E2'],

        candidate: {
          path:
            `tests/generated/${identity}.test.ts`,

          content:
            `export const result = ${JSON.stringify(identity)};\n`,
        },

        tests: [
          'Run targeted regression.',
        ],

        blocker:
          null,
      }),
  };
}

function blockedResult(
  input:
    OfflineFakeProviderInput,
): OfflineFakeProviderResult {
  return {
    source:
      'OFFLINE_FAKE',

    transport:
      'OK',

    raw:
      JSON.stringify({
        schemaVersion:
          PROVIDER_WORK_PRODUCT_SCHEMA,

        provider:
          input.provider,

        taskId:
          input.capsule.taskId,

        baseline:
          input.capsule.baseline,

        status:
          'BLOCKED',

        summary:
          'Offline fixture intentionally blocked.',

        evidenceIds:
          [],

        candidate:
          null,

        tests:
          [],

        blocker:
          'Bounded fake blocker.',
      }),
  };
}

describe(
  'offline independent provider worker pool',
  () => {
    it(
      'classifies malformed wrapper as protocol failure and semantic mismatch as contract failure',
      () => {
        expect(
          classifyWorkProductFailure(
            new Error(
              'WORK_PRODUCT_INVALID_JSON',
            ),
          ),
        ).toBe(
          'PROTOCOL_REJECTED',
        );

        expect(
          classifyWorkProductFailure(
            new Error(
              'WORK_PRODUCT_UNKNOWN_EVIDENCE_ID=X',
            ),
          ),
        ).toBe(
          'CONTRACT_REJECTED',
        );
      },
    );

    it(
      'runs the certified 8+8 baseline entirely offline with unique useful throughput',
      async () => {
        const harness =
          createHarness();

        seed(
          harness,
          'codex',
          8,
        );

        seed(
          harness,
          'antigravity',
          8,
        );

        const result =
          await runOfflineProviderWorkerPool({
            queuePath:
              harness.dbPath,

            codexSlots:
              8,

            antigravitySlots:
              8,

            leaseDurationMs:
              60_000,

            maxClaimsPerSlot:
              32,

            loadCapsule:
              record =>
                loadCapsule(
                  harness,
                  record,
                ),

            invokeFakeProvider:
              async input =>
                validProposal(
                  input,
                ),
          });

        expect(
          result.totalSlots,
        ).toBe(16);

        expect(
          result.codex.slots,
        ).toBe(8);

        expect(
          result.antigravity.slots,
        ).toBe(8);

        expect(
          result.codex
            .fakeProviderCalls,
        ).toBe(8);

        expect(
          result.antigravity
            .fakeProviderCalls,
        ).toBe(8);

        expect(
          result.totalUsefulUnique,
        ).toBe(16);

        expect(
          result.totalUsefulDuplicate,
        ).toBe(0);

        expect(
          result.liveProviderCalled,
        ).toBe(false);

        expect(
          result.fulgorCalled,
        ).toBe(false);

        const queue =
          new TransactionalProviderQueue(
            harness.dbPath,
          );

        expect(
          queue.stateCounts(),
        ).toEqual({
          USEFUL_COMPLETE:
            16,
        });

        expect(
          queue.integrityCheck(),
        ).toBe(true);

        queue.close();
      },
    );

    it(
      'counts identical cross-provider work only once',
      async () => {
        const harness =
          createHarness();

        seed(
          harness,
          'codex',
          1,
          true,
        );

        seed(
          harness,
          'antigravity',
          1,
          true,
        );

        const result =
          await runOfflineProviderWorkerPool({
            queuePath:
              harness.dbPath,

            codexSlots:
              1,

            antigravitySlots:
              1,

            leaseDurationMs:
              60_000,

            maxClaimsPerSlot:
              4,

            loadCapsule:
              record => {
                /*
                 * Make both jobs resolve to the same
                 * immutable host evidence even though
                 * task IDs are different.
                 */
                return {
                  ...loadCapsule(
                    harness,
                    record,
                  ),

                  evidence: [
                    {
                      id: 'E1',
                      path:
                        'worker/shared.ts',
                      sha256:
                        'a'.repeat(64),
                    },

                    {
                      id: 'E2',
                      path:
                        'tests/shared.test.ts',
                      sha256:
                        'd'.repeat(64),
                    },
                  ],
                };
              },

            invokeFakeProvider:
              async input =>
                validProposal(
                  input,
                  'cross-provider-shared',
                ),
          });

        expect(
          result.totalFakeProviderCalls,
        ).toBe(2);

        expect(
          result.totalUsefulUnique,
        ).toBe(1);

        expect(
          result.totalUsefulDuplicate,
        ).toBe(1);

        const queue =
          new TransactionalProviderQueue(
            harness.dbPath,
          );

        expect(
          queue.stateCounts(),
        ).toEqual({
          QUALITY_HOLD: 1,
          USEFUL_COMPLETE: 1,
        });

        queue.close();
      },
    );

    it(
      'bounds a failing Codex lane to the active Codex slots while Antigravity drains independently',
      async () => {
        const harness =
          createHarness();

        seed(
          harness,
          'codex',
          32,
        );

        seed(
          harness,
          'antigravity',
          32,
        );

        const result =
          await runOfflineProviderWorkerPool({
            queuePath:
              harness.dbPath,

            codexSlots:
              8,

            antigravitySlots:
              8,

            leaseDurationMs:
              60_000,

            maxClaimsPerSlot:
              64,

            loadCapsule:
              record =>
                loadCapsule(
                  harness,
                  record,
                ),

            invokeFakeProvider:
              async input => {
                if (
                  input.provider ===
                  'codex'
                ) {
                  return {
                    source:
                      'OFFLINE_FAKE',

                    transport:
                      'OK',

                    raw:
                      JSON.stringify({
                        schemaVersion:
                          PROVIDER_WORK_PRODUCT_SCHEMA,

                        provider:
                          'codex',

                        taskId:
                          input.capsule
                            .taskId,

                        baseline:
                          input.capsule
                            .baseline,

                        status:
                          'PROPOSE_CHANGE',

                        summary:
                          'Intentional contract failure.',

                        evidenceIds:
                          [
                            'E1',
                            'INVENTED',
                          ],

                        candidate: {
                          path:
                            'tests/generated/bad.test.ts',

                          content:
                            'export const bad = true;\n',
                        },

                        tests: [
                          'Run test.',
                        ],

                        blocker:
                          null,
                      }),
                  };
                }

                return validProposal(
                  input,
                );
              },
          });

        /*
         * At most the already-active Codex slots may
         * consume fake calls before the persistent
         * circuit becomes OPEN.
         */
        expect(
          result.codex
            .fakeProviderCalls,
        ).toBeGreaterThan(0);

        expect(
          result.codex
            .fakeProviderCalls,
        ).toBeLessThanOrEqual(
          8,
        );

        expect(
          result.codex
            .contractRejected,
        ).toBe(
          result.codex
            .fakeProviderCalls,
        );

        expect(
          result.antigravity
            .fakeProviderCalls,
        ).toBe(32);

        expect(
          result.antigravity
            .usefulUnique,
        ).toBe(32);

        expect(
          result.antigravity
            .contractRejected,
        ).toBe(0);

        const queue =
          new TransactionalProviderQueue(
            harness.dbPath,
          );

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
          queue.providerQualityState(
            'codex',
          ).reason,
        ).toBe(
          'CONTRACT_REJECTED',
        );

        expect(
          queue.pendingFor(
            'codex',
          ),
        ).toBe(
          32 -
          result.codex
            .fakeProviderCalls,
        );

        expect(
          queue.pendingFor(
            'antigravity',
          ),
        ).toBe(0);

        queue.close();
      },
    );

    it(
      'bounds a failing Antigravity lane while Codex drains independently',
      async () => {
        const harness =
          createHarness();

        seed(
          harness,
          'codex',
          24,
        );

        seed(
          harness,
          'antigravity',
          24,
        );

        const result =
          await runOfflineProviderWorkerPool({
            queuePath:
              harness.dbPath,

            codexSlots:
              8,

            antigravitySlots:
              8,

            leaseDurationMs:
              60_000,

            maxClaimsPerSlot:
              64,

            loadCapsule:
              record =>
                loadCapsule(
                  harness,
                  record,
                ),

            invokeFakeProvider:
              async input => {
                if (
                  input.provider ===
                  'antigravity'
                ) {
                  return {
                    source:
                      'OFFLINE_FAKE',

                    transport:
                      'OK',

                    raw:
                      '{bad-json',
                  };
                }

                return validProposal(
                  input,
                );
              },
          });

        expect(
          result.antigravity
            .fakeProviderCalls,
        ).toBeGreaterThan(0);

        expect(
          result.antigravity
            .fakeProviderCalls,
        ).toBeLessThanOrEqual(
          8,
        );

        expect(
          result.antigravity
            .protocolRejected,
        ).toBe(
          result.antigravity
            .fakeProviderCalls,
        );

        expect(
          result.codex
            .fakeProviderCalls,
        ).toBe(24);

        expect(
          result.codex
            .usefulUnique,
        ).toBe(24);

        const queue =
          new TransactionalProviderQueue(
            harness.dbPath,
          );

        expect(
          queue.canLaunchProvider(
            'antigravity',
          ),
        ).toBe(false);

        expect(
          queue.canLaunchProvider(
            'codex',
          ),
        ).toBe(true);

        expect(
          queue.providerQualityState(
            'antigravity',
          ).reason,
        ).toBe(
          'PROTOCOL_REJECTED',
        );

        expect(
          queue.pendingFor(
            'codex',
          ),
        ).toBe(0);

        expect(
          queue.pendingFor(
            'antigravity',
          ),
        ).toBe(
          24 -
          result.antigravity
            .fakeProviderCalls,
        );

        queue.close();
      },
    );

    it(
      'does not count BLOCKED output as useful and does not poison the provider circuit',
      async () => {
        const harness =
          createHarness();

        seed(
          harness,
          'codex',
          8,
        );

        const result =
          await runOfflineProviderWorkerPool({
            queuePath:
              harness.dbPath,

            codexSlots:
              8,

            antigravitySlots:
              1,

            leaseDurationMs:
              60_000,

            maxClaimsPerSlot:
              16,

            loadCapsule:
              record =>
                loadCapsule(
                  harness,
                  record,
                ),

            invokeFakeProvider:
              async input =>
                blockedResult(
                  input,
                ),
          });

        expect(
          result.codex.blocked,
        ).toBe(8);

        expect(
          result.codex.usefulUnique,
        ).toBe(0);

        expect(
          result.codex
            .usefulDuplicate,
        ).toBe(0);

        const queue =
          new TransactionalProviderQueue(
            harness.dbPath,
          );

        expect(
          queue.canLaunchProvider(
            'codex',
          ),
        ).toBe(true);

        expect(
          queue.stateCounts(),
        ).toEqual({
          BLOCKED: 8,
        });

        queue.close();
      },
    );

    it(
      'moves uncertain fake transport execution to recovery hold without blind slot retry',
      async () => {
        const harness =
          createHarness();

        seed(
          harness,
          'codex',
          16,
        );

        const result =
          await runOfflineProviderWorkerPool({
            queuePath:
              harness.dbPath,

            codexSlots:
              8,

            antigravitySlots:
              1,

            leaseDurationMs:
              60_000,

            maxClaimsPerSlot:
              32,

            loadCapsule:
              record =>
                loadCapsule(
                  harness,
                  record,
                ),

            invokeFakeProvider:
              async () => ({
                source:
                  'OFFLINE_FAKE',

                transport:
                  'FAILURE',
              }),
          });

        /*
         * Each active slot makes at most one uncertain
         * transport attempt and then stops.
         */
        expect(
          result.codex
            .fakeProviderCalls,
        ).toBe(8);

        expect(
          result.codex
            .transportFailures,
        ).toBe(8);

        expect(
          result.codex.usefulUnique,
        ).toBe(0);

        const queue =
          new TransactionalProviderQueue(
            harness.dbPath,
          );

        expect(
          queue.stateCounts(),
        ).toEqual({
          PENDING: 8,
          RECOVERY_HOLD: 8,
        });

        expect(
          queue.canLaunchProvider(
            'codex',
          ),
        ).toBe(true);

        queue.close();
      },
    );
  },
);
