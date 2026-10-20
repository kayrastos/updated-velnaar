import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest';

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';

import {
  tmpdir,
} from 'node:os';

import {
  join,
} from 'node:path';

import {
  DatabaseSync,
} from 'node:sqlite';

import {
  createProviderWorkOrder,
} from '../../../scripts/fulgor/orchestration/providerWorkOrder';

import {
  reconcileProviderTaskClassEvidence,
  recoverProviderTaskClassEvidenceStateRoot,
} from '../../../scripts/fulgor/orchestration/providerTaskClassEvidenceReconciler';

import {
  TransactionalProviderQueue,
} from '../../../scripts/fulgor/orchestration/transactionalProviderQueue';

import {
  ProviderTaskClassEvidenceStore,
} from '../../../scripts/fulgor/scheduler/providerTaskClassEvidenceStore';


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
        'velnar-reconcile-',
      ),
    );

  roots.push(
    value,
  );

  return value;
}


function order(
  jobId:
    string,

  provider:
    'codex' |
    'antigravity',
) {
  return createProviderWorkOrder({
    jobId,

    baseline,

    task:
      `bounded ${provider} reconciliation test`,

    evidenceIds:
      [
        'E1',
        'E2',
      ],

    affinity:
      provider,
  });
}


function settleFailure(
  queue:
    TransactionalProviderQueue,

  jobId:
    string,

  provider:
    'codex' |
    'antigravity',

  taskClass:
    'GENERAL' |
    'SEMANTIC_CONTRACT',

  start:
    number,

  outcome:
    'TRANSPORT_FAILURE' |
    'PROTOCOL_REJECTED' |
    'CONTRACT_REJECTED',
): void {
  queue.enqueue(
    order(
      jobId,
      provider,
    ),
    start,
    taskClass,
  );

  const claimed =
    queue.claimNext(
      provider,
      `${provider}-slot`,
      start + 100,
      60_000,
    );

  expect(
    claimed?.lease,
  ).not.toBeNull();

  queue.settle(
    provider,
    claimed!.lease!.leaseId,
    outcome,
    null,
    start + 200,
  );
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


describe(
  'queue to task-class evidence reconciliation',
  () => {
    it(
      'recovers queue settlement after crash before sidecar append and stays exact-once after restart',
      () => {
        const dir =
          root();

        const queuePath =
          join(
            dir,
            'queue.sqlite',
          );

        const ledgerPath =
          join(
            dir,
            'evidence.sqlite',
          );

        let queue =
          new TransactionalProviderQueue(
            queuePath,
          );

        let store =
          new ProviderTaskClassEvidenceStore(
            ledgerPath,
            baseline,
          );

        settleFailure(
          queue,
          'crash-window-job',
          'codex',
          'GENERAL',
          1_000,
          'TRANSPORT_FAILURE',
        );

        expect(
          queue
            .terminalTaskClassOutcomes(),
        ).toHaveLength(1);

        expect(
          store.count(),
        ).toBe(0);

        /*
         * Simulated process death:
         * durable queue commit exists but sidecar is empty.
         */
        queue.close();
        store.close();

        queue =
          new TransactionalProviderQueue(
            queuePath,
          );

        store =
          new ProviderTaskClassEvidenceStore(
            ledgerPath,
            baseline,
          );

        const first =
          reconcileProviderTaskClassEvidence(
            queue,
            store,
          );

        expect(
          first,
        ).toEqual({
          schemaVersion:
            'VELNAR_PROVIDER_TASK_CLASS_RECONCILIATION_V1',

          examined:
            1,

          appended:
            1,

          alreadyExact:
            0,
        });

        expect(
          store.count(),
        ).toBe(1);

        queue.close();
        store.close();

        /*
         * Second process restart.
         */
        queue =
          new TransactionalProviderQueue(
            queuePath,
          );

        store =
          new ProviderTaskClassEvidenceStore(
            ledgerPath,
            baseline,
          );

        const second =
          reconcileProviderTaskClassEvidence(
            queue,
            store,
          );

        expect(
          second,
        ).toEqual({
          schemaVersion:
            'VELNAR_PROVIDER_TASK_CLASS_RECONCILIATION_V1',

          examined:
            1,

          appended:
            0,

          alreadyExact:
            1,
        });

        expect(
          store.count(),
        ).toBe(1);

        queue.close();
        store.close();
      },
    );


    it(
      'resumes from an exact partially projected subset',
      () => {
        const dir =
          root();

        const queue =
          new TransactionalProviderQueue(
            join(
              dir,
              'queue.sqlite',
            ),
          );

        const store =
          new ProviderTaskClassEvidenceStore(
            join(
              dir,
              'evidence.sqlite',
            ),
            baseline,
          );

        try {
          settleFailure(
            queue,
            'partial-1',
            'codex',
            'GENERAL',
            2_000,
            'TRANSPORT_FAILURE',
          );

          settleFailure(
            queue,
            'partial-2',
            'antigravity',
            'GENERAL',
            3_000,
            'CONTRACT_REJECTED',
          );

          /*
           * Simulate crash after only first sidecar append.
           */
          store.appendHostOutcome(
            queue
              .terminalTaskClassOutcomes()
              .find(
                row =>
                  row.jobId ===
                    'partial-1',
              )!,
          );

          expect(
            store.count(),
          ).toBe(1);

          const result =
            reconcileProviderTaskClassEvidence(
              queue,
              store,
            );

          expect(
            result,
          ).toEqual({
            schemaVersion:
              'VELNAR_PROVIDER_TASK_CLASS_RECONCILIATION_V1',

            examined:
              2,

            appended:
              1,

            alreadyExact:
              1,
          });

          expect(
            store.count(),
          ).toBe(2);

          const again =
            reconcileProviderTaskClassEvidence(
              queue,
              store,
            );

          expect(
            again.appended,
          ).toBe(0);

          expect(
            again.alreadyExact,
          ).toBe(2);
        } finally {
          queue.close();
          store.close();
        }
      },
    );


    it(
      'preflights all conflicts before appending any missing projection',
      () => {
        const dir =
          root();

        const queue =
          new TransactionalProviderQueue(
            join(
              dir,
              'queue.sqlite',
            ),
          );

        const store =
          new ProviderTaskClassEvidenceStore(
            join(
              dir,
              'evidence.sqlite',
            ),
            baseline,
          );

        try {
          settleFailure(
            queue,
            'missing-before-mismatch',
            'codex',
            'GENERAL',
            4_000,
            'TRANSPORT_FAILURE',
          );

          settleFailure(
            queue,
            'mismatch-job',
            'antigravity',
            'SEMANTIC_CONTRACT',
            5_000,
            'PROTOCOL_REJECTED',
          );

          store.appendHostOutcome({
            jobId:
              'mismatch-job',

            baseline,

            provider:
              'antigravity',

            taskClass:
              'SEMANTIC_CONTRACT',

            outcome:
              'BLOCKED',

            observedAtMs:
              99_999,
          });

          expect(() =>
            reconcileProviderTaskClassEvidence(
              queue,
              store,
            ),
          ).toThrow(
            /TASK_CLASS_RECONCILIATION_EXISTING_MISMATCH/,
          );

          /*
           * Missing earlier queue row must NOT have been
           * appended before mismatch discovery.
           */
          expect(
            store.count(),
          ).toBe(1);

          expect(
            store
              .loadLedger()
              .records
              .some(
                record =>
                  record.jobId ===
                    'missing-before-mismatch',
              ),
          ).toBe(false);
        } finally {
          queue.close();
          store.close();
        }
      },
    );


    it(
      'does not invent evidence for unclassified historical rows',
      () => {
        const dir =
          root();

        const queue =
          new TransactionalProviderQueue(
            join(
              dir,
              'queue.sqlite',
            ),
          );

        const store =
          new ProviderTaskClassEvidenceStore(
            join(
              dir,
              'evidence.sqlite',
            ),
            baseline,
          );

        try {
          queue.enqueue(
            order(
              'historical-unclassified',
              'codex',
            ),
            6_000,
          );

          const claimed =
            queue.claimNext(
              'codex',
              'codex-slot',
              6_100,
              60_000,
            );

          queue.settle(
            'codex',
            claimed!.lease!.leaseId,
            'TRANSPORT_FAILURE',
            null,
            6_200,
          );

          expect(
            queue
              .terminalTaskClassOutcomes(),
          ).toEqual([]);

          const result =
            reconcileProviderTaskClassEvidence(
              queue,
              store,
            );

          expect(
            result,
          ).toEqual({
            schemaVersion:
              'VELNAR_PROVIDER_TASK_CLASS_RECONCILIATION_V1',

            examined:
              0,

            appended:
              0,

            alreadyExact:
              0,
          });

          expect(
            store.count(),
          ).toBe(0);
        } finally {
          queue.close();
          store.close();
        }
      },
    );
  },
);


describe(
  'operator-start task-class recovery',
  () => {
    it(
      'recovers an interrupted V6 run before a later operator batch',
      () => {
        const stateRoot =
          root();

        const runDirectory =
          join(
            stateRoot,
            'live-8x8-prior-run',
          );

        mkdirSync(
          runDirectory,
          {
            recursive:
              true,
          },
        );

        const queue =
          new TransactionalProviderQueue(
            join(
              runDirectory,
              'queue.sqlite',
            ),
          );

        try {
          settleFailure(
            queue,
            'startup-recovery-job',
            'codex',
            'GENERAL',
            10_000,
            'TRANSPORT_FAILURE',
          );
        } finally {
          queue.close();
        }

        const first =
          recoverProviderTaskClassEvidenceStateRoot(
            stateRoot,
          );

        expect(first)
          .toMatchObject({
            scannedRunDirectories:
              1,

            eligibleV6Queues:
              1,

            legacyQueuesSkipped:
              0,

            reconciledQueues:
              1,

            examined:
              1,

            appended:
              1,

            alreadyExact:
              0,
          });

        const ledgerPath =
          join(
            stateRoot,
            'task-class-evidence',
            `${baseline}.sqlite`,
          );

        expect(
          existsSync(
            ledgerPath,
          ),
        ).toBe(true);

        const store =
          new ProviderTaskClassEvidenceStore(
            ledgerPath,
            baseline,
          );

        try {
          expect(
            store.count(),
          ).toBe(1);
        } finally {
          store.close();
        }

        const second =
          recoverProviderTaskClassEvidenceStateRoot(
            stateRoot,
          );

        expect(
          second.appended,
        ).toBe(0);

        expect(
          second.alreadyExact,
        ).toBe(1);
      },
    );


    it(
      'observes but does not migrate historical V5 queues',
      () => {
        const stateRoot =
          root();

        const runDirectory =
          join(
            stateRoot,
            'live-8x8-legacy-run',
          );

        mkdirSync(
          runDirectory,
          {
            recursive:
              true,
          },
        );

        const queuePath =
          join(
            runDirectory,
            'queue.sqlite',
          );

        const queue =
          new TransactionalProviderQueue(
            queuePath,
          );

        settleFailure(
          queue,
          'legacy-run-job',
          'codex',
          'GENERAL',
          20_000,
          'TRANSPORT_FAILURE',
        );

        queue.close();

        const raw =
          new DatabaseSync(
            queuePath,
          );

        raw
          .prepare(`
            UPDATE queue_meta
            SET value = ?
            WHERE key = 'schema'
          `)
          .run(
            'VELNAR_TRANSACTIONAL_PROVIDER_QUEUE_V5',
          );

        raw.close();

        const result =
          recoverProviderTaskClassEvidenceStateRoot(
            stateRoot,
          );

        expect(
          result.eligibleV6Queues,
        ).toBe(0);

        expect(
          result.legacyQueuesSkipped,
        ).toBe(1);

        expect(
          result.appended,
        ).toBe(0);

        const verify =
          new DatabaseSync(
            queuePath,
            {
              readOnly:
                true,
            },
          );

        try {
          const row =
            verify
              .prepare(`
                SELECT value
                FROM queue_meta
                WHERE key = 'schema'
              `)
              .get() as {
                value:
                  string;
              };

          expect(
            row.value,
          ).toBe(
            'VELNAR_TRANSACTIONAL_PROVIDER_QUEUE_V5',
          );
        } finally {
          verify.close();
        }

        expect(
          existsSync(
            join(
              stateRoot,
              'task-class-evidence',
              `${baseline}.sqlite`,
            ),
          ),
        ).toBe(false);
      },
    );


    it(
      'wires recovery before executable checks, run creation and lane evidence reads',
      () => {
        const source =
          readFileSync(
            join(
              process.cwd(),
              'scripts/fulgor/orchestration/live8x8OperatorRunner.ts',
            ),
            'utf-8',
          );

        const stateReady =
          source.search(
            /await\s+privateDirectory\(\s*stateRoot,\s*\);/,
          );

        const recovery =
          source.search(
            /recoverProviderTaskClassEvidenceStateRoot\(\s*stateRoot,\s*\);/,
          );

        const executable =
          source.indexOf(
            'const codexExecutable',
          );

        const runDirectory =
          source.indexOf(
            'const runDirectory',
          );

        const laneEvidence =
          source.indexOf(
            '.laneEvidence(',
          );

        for (
          const position
          of [
            stateReady,
            recovery,
            executable,
            runDirectory,
            laneEvidence,
          ]
        ) {
          expect(position)
            .toBeGreaterThanOrEqual(0);
        }

        expect(
          stateReady,
        ).toBeLessThan(
          recovery,
        );

        expect(
          recovery,
        ).toBeLessThan(
          executable,
        );

        expect(
          executable,
        ).toBeLessThan(
          runDirectory,
        );

        expect(
          runDirectory,
        ).toBeLessThan(
          laneEvidence,
        );
      },
    );
  },
);

