import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';

import {
  join,
} from 'node:path';

import {
  tmpdir,
} from 'node:os';

import {
  DatabaseSync,
} from 'node:sqlite';

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
  certifyProviderQuality,
} from '../../../scripts/fulgor/orchestration/providerWorkAccounting';

import {
  parseProviderWorkProduct,
} from '../../../scripts/fulgor/orchestration/providerWorkProductGate';

import {
  TransactionalProviderQueue,
} from '../../../scripts/fulgor/orchestration/transactionalProviderQueue';

const baseline =
  '0123456789abcdef0123456789abcdef01234567';

const roots:
  string[] = [];

function makeRoot(): string {
  const root =
    mkdtempSync(
      join(
        tmpdir(),
        'velnar-provider-queue-',
      ),
    );

  roots.push(root);

  return root;
}

function order(
  id: string,
  affinity:
    'codex' |
    'antigravity' |
    'either' =
      'either',
) {
  return createProviderWorkOrder({
    jobId: id,
    baseline,

    task:
      'Return only a host-bound useful work product.',

    evidenceIds:
      ['E1', 'E2'],

    affinity,
  });
}


function accepted(
  taskId: string,
  provider:
    'codex' |
    'antigravity',
  identity = taskId,
) {
  const candidatePath =
    `tests/${identity}.test.ts`;

  return parseProviderWorkProduct(
    JSON.stringify({
      schemaVersion:
        'VELNAR_PROVIDER_WORK_PRODUCT_V1',

      provider,
      taskId,
      baseline,

      status:
        'PROPOSE_CHANGE',

      summary:
        'Bounded regression candidate.',

      evidenceIds:
        ['E1', 'E2'],

      candidate: {
        path:
          candidatePath,

        content:
          [
            "import { describe, expect, it } from 'vitest';",
            '',
            `describe('${identity}', () => {`,
            "  it('holds', () => {",
            '    expect(true).toBe(true);',
            '  });',
            '});',
            '',
          ].join('\n'),
      },

      tests: [
        `npx vitest run ${candidatePath}`,
      ],

      blocker:
        null,
    }),
    {
      taskId,
      baseline,

      evidence: [
        {
          id:
            'E1',

          path:
            'scripts/evidence-one.ts',

          sha256:
            '1'.repeat(64),
        },
        {
          id:
            'E2',

          path:
            'scripts/evidence-two.ts',

          sha256:
            '2'.repeat(64),
        },
      ],
    },
    provider,
  );
}

afterEach(
  () => {
    for (
      const root
      of roots.splice(0)
    ) {
      rmSync(
        root,
        {
          recursive: true,
          force: true,
        },
      );
    }
  },
);

describe(
  'transactional provider queue',
  () => {
    it(
      'creates a WAL queue with restrictive DB permissions',
      () => {
        const root =
          makeRoot();

        const dbPath =
          join(
            root,
            'queue.sqlite',
          );

        const queue =
          new TransactionalProviderQueue(
            dbPath,
          );

        expect(
          queue.integrityCheck(),
        ).toBe(true);

        const mode =
          lstatSync(dbPath)
            .mode & 0o777;

        expect(mode)
          .toBe(0o600);

        queue.close();
      },
    );

    it(
      'persists a pending job across reopen',
      () => {
        const root =
          makeRoot();

        const dbPath =
          join(
            root,
            'queue.sqlite',
          );

        let queue =
          new TransactionalProviderQueue(
            dbPath,
          );

        queue.enqueue(
          order(
            'job-persist-001',
            'codex',
          ),
          1000,
        );

        queue.close();

        queue =
          new TransactionalProviderQueue(
            dbPath,
          );

        const loaded =
          queue.get(
            'job-persist-001',
          );

        expect(loaded?.state)
          .toBe('PENDING');

        expect(
          loaded?.order.affinity,
        ).toBe('codex');

        queue.close();
      },
    );

    it(
      'rejects duplicate job identity',
      () => {
        const root =
          makeRoot();

        const queue =
          new TransactionalProviderQueue(
            join(
              root,
              'queue.sqlite',
            ),
          );

        const value =
          order(
            'job-dup-001',
          );

        queue.enqueue(
          value,
          1000,
        );

        expect(() =>
          queue.enqueue(
            value,
            1001,
          ),
        ).toThrow(
          /JOB_ALREADY_EXISTS/,
        );

        queue.close();
      },
    );

    it(
      'keeps provider affinity independent',
      () => {
        const root =
          makeRoot();

        const queue =
          new TransactionalProviderQueue(
            join(
              root,
              'queue.sqlite',
            ),
          );

        queue.enqueue(
          order(
            'job-codex-only',
            'codex',
          ),
          1000,
        );

        expect(
          queue.claimNext(
            'antigravity',
            'agy-01',
            2000,
            60_000,
          ),
        ).toBeNull();

        const codex =
          queue.claimNext(
            'codex',
            'codex-01',
            2000,
            60_000,
          );

        expect(
          codex?.lease?.provider,
        ).toBe('codex');

        queue.close();
      },
    );

    it(
      'allows either-affinity work to be claimed only once',
      () => {
        const root =
          makeRoot();

        const queue =
          new TransactionalProviderQueue(
            join(
              root,
              'queue.sqlite',
            ),
          );

        queue.enqueue(
          order(
            'job-either-001',
            'either',
          ),
          1000,
        );

        const codex =
          queue.claimNext(
            'codex',
            'codex-01',
            2000,
            60_000,
          );

        expect(codex)
          .not.toBeNull();

        expect(
          queue.claimNext(
            'antigravity',
            'agy-01',
            2001,
            60_000,
          ),
        ).toBeNull();

        queue.close();
      },
    );

    it(
      'prevents one provider slot owning two jobs',
      () => {
        const root =
          makeRoot();

        const queue =
          new TransactionalProviderQueue(
            join(
              root,
              'queue.sqlite',
            ),
          );

        queue.enqueue(
          order(
            'job-slot-a',
            'codex',
          ),
          1000,
        );

        queue.enqueue(
          order(
            'job-slot-b',
            'codex',
          ),
          1001,
        );

        queue.claimNext(
          'codex',
          'codex-01',
          2000,
          60_000,
        );

        expect(() =>
          queue.claimNext(
            'codex',
            'codex-01',
            2001,
            60_000,
          ),
        ).toThrow(
          /SLOT_ALREADY_LEASED/,
        );

        queue.close();
      },
    );

    it(
      'permits different slots to lease independent jobs',
      () => {
        const root =
          makeRoot();

        const queue =
          new TransactionalProviderQueue(
            join(
              root,
              'queue.sqlite',
            ),
          );

        for (
          let i = 1;
          i <= 16;
          i += 1
        ) {
          queue.enqueue(
            order(
              `job-${i}`,
              i <= 8
                ? 'codex'
                : 'antigravity',
            ),
            1000 + i,
          );
        }

        for (
          let i = 1;
          i <= 8;
          i += 1
        ) {
          expect(
            queue.claimNext(
              'codex',
              `codex-${i}`,
              2000 + i,
              60_000,
            ),
          ).not.toBeNull();

          expect(
            queue.claimNext(
              'antigravity',
              `agy-${i}`,
              3000 + i,
              60_000,
            ),
          ).not.toBeNull();
        }

        expect(
          queue.stateCounts(),
        ).toEqual({
          LEASED: 16,
        });

        queue.close();
      },
    );

    it(
      'only useful unique settlement becomes useful complete',
      () => {
        const root =
          makeRoot();

        const queue =
          new TransactionalProviderQueue(
            join(
              root,
              'queue.sqlite',
            ),
          );

        queue.enqueue(
          order(
            'job-complete',
            'codex',
          ),
          1000,
        );

        const leased =
          queue.claimNext(
            'codex',
            'codex-01',
            2000,
            60_000,
          )!;

        const settled =
          queue.settleUseful(
            'codex',
            leased.lease!.leaseId,
            accepted(
              'job-complete',
              'codex',
            ),
            3000,
          );

        expect(settled.state)
          .toBe(
            'USEFUL_COMPLETE',
          );

        expect(
          queue.stateCounts(),
        ).toEqual({
          USEFUL_COMPLETE: 1,
        });

        queue.close();
      },
    );

    it(
      'persists canonical accepted work across restart',
      () => {
        const root =
          makeRoot();

        const dbPath =
          join(
            root,
            'queue.sqlite',
          );

        let queue =
          new TransactionalProviderQueue(
            dbPath,
          );

        queue.enqueue(
          order(
            'job-durable',
            'codex',
          ),
          1000,
        );

        const leased =
          queue.claimNext(
            'codex',
            'codex-01',
            2000,
            60_000,
          )!;

        queue.settleUseful(
          'codex',
          leased.lease!.leaseId,
          accepted(
            'job-durable',
            'codex',
          ),
          3000,
        );

        const before =
          queue.getAcceptedWorkProduct(
            'job-durable',
          );

        expect(before)
          .not.toBeNull();

        expect(
          before?.accepted
            .workProduct
            .candidate
            ?.path,
        ).toBe(
          'tests/job-durable.test.ts',
        );

        expect(
          before?.evidenceCount,
        ).toBe(2);

        expect(
          before?.accepted
            .verified,
        ).toBe(false);

        expect(
          before?.accepted
            .authorityGranted,
        ).toBe(false);

        queue.close();

        queue =
          new TransactionalProviderQueue(
            dbPath,
          );

        const after =
          queue.getAcceptedWorkProduct(
            'job-durable',
          );

        expect(after)
          .toEqual(before);

        expect(
          queue.listAcceptedWorkProducts(),
        ).toHaveLength(1);

        queue.close();
      },
    );

    it(
      'rolls back fingerprint and accepted persistence when binding is invalid',
      () => {
        const root =
          makeRoot();

        const dbPath =
          join(
            root,
            'queue.sqlite',
          );

        const queue =
          new TransactionalProviderQueue(
            dbPath,
          );

        queue.enqueue(
          order(
            'job-rollback',
            'codex',
          ),
          1000,
        );

        const leased =
          queue.claimNext(
            'codex',
            'codex-01',
            2000,
            60_000,
          )!;

        expect(() =>
          queue.settleUseful(
            'codex',
            leased.lease!.leaseId,
            accepted(
              'different-task',
              'codex',
            ),
            3000,
          ),
        ).toThrow();

        expect(
          queue.get(
            'job-rollback',
          )?.state,
        ).toBe(
          'LEASED',
        );

        expect(
          queue.listAcceptedWorkProducts(),
        ).toHaveLength(0);

        const db =
          new DatabaseSync(
            dbPath,
          );

        const count =
          db.prepare(`
            SELECT COUNT(*) AS count
            FROM work_fingerprints
          `)
            .get() as {
              count: number;
            };

        expect(
          Number(
            count.count,
          ),
        ).toBe(0);

        db.close();
        queue.close();
      },
    );

    it(
      'migrates V3 queues additively through V4 to V5',
      () => {
        const root =
          makeRoot();

        const dbPath =
          join(
            root,
            'queue.sqlite',
          );

        let queue =
          new TransactionalProviderQueue(
            dbPath,
          );

        queue.enqueue(
          order(
            'job-v3-preserved',
            'codex',
          ),
          1000,
        );

        queue.close();

        const db =
          new DatabaseSync(
            dbPath,
          );

        db.exec(`
          DROP TABLE accepted_work_products;
          DROP TABLE blocked_work_diagnostics;

          UPDATE queue_meta
          SET value =
            'VELNAR_TRANSACTIONAL_PROVIDER_QUEUE_V3'
          WHERE key = 'schema';
        `);

        db.close();

        queue =
          new TransactionalProviderQueue(
            dbPath,
          );

        expect(
          queue.get(
            'job-v3-preserved',
          )?.state,
        ).toBe(
          'PENDING',
        );

        expect(
          queue.listAcceptedWorkProducts(),
        ).toHaveLength(0);

        const migrated =
          new DatabaseSync(
            dbPath,
          );

        const schema =
          migrated.prepare(`
            SELECT value
            FROM queue_meta
            WHERE key = 'schema'
          `)
            .get() as {
              value: string;
            };

        expect(
          schema.value,
        ).toBe(
          'VELNAR_TRANSACTIONAL_PROVIDER_QUEUE_V5',
        );

        const table =
          migrated.prepare(`
            SELECT name
            FROM sqlite_master
            WHERE
              type = 'table'
              AND
              name = 'accepted_work_products'
          `)
            .get();

        expect(table)
          .toBeTruthy();

        migrated.close();
        queue.close();
      },
    );

    it(
      'does not allow generic settlement to bypass atomic BLOCKED diagnostics',
      () => {
        const root =
          makeRoot();

        const queue =
          new TransactionalProviderQueue(
            join(
              root,
              'queue.sqlite',
            ),
          );

        const jobId =
          'job-generic-blocked-denied';

        queue.enqueue(
          order(
            jobId,
            'codex',
          ),
          1000,
        );

        const leased =
          queue.claimNext(
            'codex',
            'codex-01',
            2000,
            60_000,
          )!;

        expect(() =>
          queue.settle(
            'codex',
            leased.lease!.leaseId,
            'BLOCKED',
            null,
            3000,
          ),
        ).toThrow(
          /USE_SETTLE_BLOCKED/,
        );

        /*
         * Guard fires before the queue transaction:
         * the caller did not consume the lease and did
         * not manufacture a diagnostic-less BLOCKED row.
         */
        expect(
          queue.get(
            jobId,
          )?.state,
        ).toBe(
          'LEASED',
        );

        expect(
          queue.getBlockedWorkDiagnostic(
            jobId,
          ),
        ).toBeNull();

        expect(
          queue.getAcceptedWorkProduct(
            jobId,
          ),
        ).toBeNull();

        queue.close();
      },
    );

    it(
      'does not allow a caller to self-declare useful uniqueness',
      () => {
        const root =
          makeRoot();

        const queue =
          new TransactionalProviderQueue(
            join(
              root,
              'queue.sqlite',
            ),
          );

        queue.enqueue(
          order(
            'job-self-declare',
            'codex',
          ),
          1000,
        );

        const leased =
          queue.claimNext(
            'codex',
            'codex-01',
            2000,
            60_000,
          )!;

        expect(() =>
          queue.settle(
            'codex',
            leased.lease!.leaseId,
            'USEFUL_UNIQUE',
            'a'.repeat(64),
            3000,
          ),
        ).toThrow(
          /USE_SETTLE_USEFUL/,
        );

        queue.close();
      },
    );

    it(
      'classifies the first persistent fingerprint as unique and same-provider repeat as duplicate',
      () => {
        const root =
          makeRoot();

        const queue =
          new TransactionalProviderQueue(
            join(
              root,
              'queue.sqlite',
            ),
          );

        queue.enqueue(
          order(
            'job-first-fingerprint',
            'codex',
          ),
          1000,
        );

        queue.enqueue(
          order(
            'job-second-fingerprint',
            'codex',
          ),
          1001,
        );

        const first =
          queue.claimNext(
            'codex',
            'codex-01',
            2000,
            60_000,
          )!;

        const firstResult =
          queue.settleUseful(
            'codex',
            first.lease!.leaseId,
            accepted(
              'job-first-fingerprint',
              'codex',
              'shared-fingerprint',
            ),
            3000,
          );

        expect(
          firstResult.lastOutcome,
        ).toBe(
          'USEFUL_UNIQUE',
        );

        expect(
          firstResult.state,
        ).toBe(
          'USEFUL_COMPLETE',
        );

        const second =
          queue.claimNext(
            'codex',
            'codex-02',
            4000,
            60_000,
          )!;

        const secondResult =
          queue.settleUseful(
            'codex',
            second.lease!.leaseId,
            accepted(
              'job-second-fingerprint',
              'codex',
              'shared-fingerprint',
            ),
            5000,
          );

        expect(
          secondResult.lastOutcome,
        ).toBe(
          'USEFUL_DUPLICATE',
        );

        expect(
          secondResult.state,
        ).toBe(
          'QUALITY_HOLD',
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
      'preserves useful-work identity across queue restart',
      () => {
        const root =
          makeRoot();

        const dbPath =
          join(
            root,
            'queue.sqlite',
          );

        let queue =
          new TransactionalProviderQueue(
            dbPath,
          );

        queue.enqueue(
          order(
            'job-before-restart',
            'codex',
          ),
          1000,
        );

        const first =
          queue.claimNext(
            'codex',
            'codex-01',
            2000,
            60_000,
          )!;

        queue.settleUseful(
          'codex',
          first.lease!.leaseId,
          accepted(
            'job-before-restart',
            'codex',
            'restart-shared',
          ),
          3000,
        );

        queue.close();

        queue =
          new TransactionalProviderQueue(
            dbPath,
          );

        queue.enqueue(
          order(
            'job-after-restart',
            'codex',
          ),
          4000,
        );

        const second =
          queue.claimNext(
            'codex',
            'codex-02',
            5000,
            60_000,
          )!;

        const result =
          queue.settleUseful(
            'codex',
            second.lease!.leaseId,
            accepted(
              'job-after-restart',
              'codex',
              'restart-shared',
            ),
            6000,
          );

        expect(
          result.lastOutcome,
        ).toBe(
          'USEFUL_DUPLICATE',
        );

        expect(
          result.state,
        ).toBe(
          'QUALITY_HOLD',
        );

        queue.close();
      },
    );

    it(
      'shares fingerprint authority across independent queue connections',
      () => {
        const root =
          makeRoot();

        const dbPath =
          join(
            root,
            'queue.sqlite',
          );

        const queueA =
          new TransactionalProviderQueue(
            dbPath,
          );

        const queueB =
          new TransactionalProviderQueue(
            dbPath,
          );

        queueA.enqueue(
          order(
            'job-connection-a',
            'codex',
          ),
          1000,
        );

        queueB.enqueue(
          order(
            'job-connection-b',
            'codex',
          ),
          1001,
        );

        const codex =
          queueA.claimNext(
            'codex',
            'codex-01',
            2000,
            60_000,
          )!;

        const codexSecond =
          queueB.claimNext(
            'codex',
            'codex-02',
            2001,
            60_000,
          )!;

        const first =
          queueA.settleUseful(
            'codex',
            codex.lease!.leaseId,
            accepted(
              'job-connection-a',
              'codex',
              'connection-shared',
            ),
            3000,
          );

        const second =
          queueB.settleUseful(
            'codex',
            codexSecond.lease!.leaseId,
            accepted(
              'job-connection-b',
              'codex',
              'connection-shared',
            ),
            3001,
          );

        expect(
          first.lastOutcome,
        ).toBe(
          'USEFUL_UNIQUE',
        );

        expect(
          second.lastOutcome,
        ).toBe(
          'USEFUL_DUPLICATE',
        );

        queueA.close();
        queueB.close();
      },
    );

    it(
      'quality failures persist as quality hold, not completed work',
      () => {
        const root =
          makeRoot();

        const queue =
          new TransactionalProviderQueue(
            join(
              root,
              'queue.sqlite',
            ),
          );

        queue.enqueue(
          order(
            'job-quality',
            'antigravity',
          ),
          1000,
        );

        const leased =
          queue.claimNext(
            'antigravity',
            'agy-01',
            2000,
            60_000,
          )!;

        const settled =
          queue.settle(
            'antigravity',
            leased.lease!.leaseId,
            'CONTRACT_REJECTED',
            null,
            3000,
          );

        expect(settled.state)
          .toBe(
            'QUALITY_HOLD',
          );

        expect(
          queue.stateCounts(),
        ).toEqual({
          QUALITY_HOLD: 1,
        });

        queue.close();
      },
    );

    it(
      'expired execution becomes recovery hold and never auto-requeues',
      () => {
        const root =
          makeRoot();

        const queue =
          new TransactionalProviderQueue(
            join(
              root,
              'queue.sqlite',
            ),
          );

        queue.enqueue(
          order(
            'job-expire',
            'codex',
          ),
          1000,
        );

        queue.claimNext(
          'codex',
          'codex-01',
          2000,
          5_000,
        );

        const expired =
          queue.expireDueLeases(
            7000,
          );

        expect(expired)
          .toHaveLength(1);

        expect(
          expired[0].state,
        ).toBe(
          'RECOVERY_HOLD',
        );

        expect(
          queue.claimNext(
            'codex',
            'codex-01',
            7001,
            5_000,
          ),
        ).toBeNull();

        queue.close();
      },
    );

    it(
      'does not expire a live lease early',
      () => {
        const root =
          makeRoot();

        const queue =
          new TransactionalProviderQueue(
            join(
              root,
              'queue.sqlite',
            ),
          );

        queue.enqueue(
          order(
            'job-live',
            'codex',
          ),
          1000,
        );

        queue.claimNext(
          'codex',
          'codex-01',
          2000,
          60_000,
        );

        expect(
          queue.expireDueLeases(
            30_000,
          ),
        ).toHaveLength(0);

        expect(
          queue.stateCounts(),
        ).toEqual({
          LEASED: 1,
        });

        queue.close();
      },
    );

    it(
      'detects persisted index/record divergence fail closed',
      () => {
        const root =
          makeRoot();

        const dbPath =
          join(
            root,
            'queue.sqlite',
          );

        const queue =
          new TransactionalProviderQueue(
            dbPath,
          );

        queue.enqueue(
          order(
            'job-corrupt',
            'codex',
          ),
          1000,
        );

        queue.close();

        const raw =
          new DatabaseSync(
            dbPath,
          );

        raw.prepare(`
          UPDATE jobs
          SET updated_ms = updated_ms + 1
          WHERE job_id = 'job-corrupt'
        `).run();

        raw.close();

        const reopened =
          new TransactionalProviderQueue(
            dbPath,
          );

        expect(() =>
          reopened.get(
            'job-corrupt',
          ),
        ).toThrow(
          /ROW_RECORD_MISMATCH/,
        );

        reopened.close();
      },
    );

    it(
      'rejects a symlink database target',
      () => {
        const root =
          makeRoot();

        const target =
          join(
            root,
            'target.sqlite',
          );

        const link =
          join(
            root,
            'queue.sqlite',
          );

        writeFileSync(
          target,
          '',
        );

        chmodSync(
          target,
          0o600,
        );

        symlinkSync(
          target,
          link,
        );

        expect(() =>
          new TransactionalProviderQueue(
            link,
          ),
        ).toThrow(
          /DB_PATH_UNSAFE/,
        );
      },
    );

    it(
      'starts both provider quality circuits closed',
      () => {
        const root =
          makeRoot();

        const queue =
          new TransactionalProviderQueue(
            join(
              root,
              'queue.sqlite',
            ),
          );

        expect(
          queue.providerQualityState(
            'codex',
          ),
        ).toMatchObject({
          provider: 'codex',
          state: 'CLOSED',
          reason: null,
        });

        expect(
          queue.providerQualityState(
            'antigravity',
          ),
        ).toMatchObject({
          provider:
            'antigravity',
          state: 'CLOSED',
          reason: null,
        });

        queue.close();
      },
    );

    it(
      'queue claim authority blocks an open provider while the other lane continues',
      () => {
        const root =
          makeRoot();

        const queue =
          new TransactionalProviderQueue(
            join(
              root,
              'queue.sqlite',
            ),
          );

        queue.enqueue(
          order(
            'quality-gate-codex',
            'codex',
          ),
          1000,
        );

        queue.enqueue(
          order(
            'quality-gate-agy',
            'antigravity',
          ),
          1001,
        );

        queue.openProviderQualityCircuit(
          'codex',
          'CONTRACT_REJECTED',
          1500,
        );

        expect(() =>
          queue.claimNext(
            'codex',
            'codex-01',
            2000,
            60_000,
          ),
        ).toThrow(
          /PROVIDER_QUALITY_OPEN=codex/,
        );

        const agy =
          queue.claimNext(
            'antigravity',
            'agy-01',
            2001,
            60_000,
          );

        expect(agy)
          .not.toBeNull();

        expect(
          agy?.lease?.provider,
        ).toBe(
          'antigravity',
        );

        queue.close();
      },
    );

    it(
      'contract rejection atomically moves the job to quality hold and opens only that provider',
      () => {
        const root =
          makeRoot();

        const queue =
          new TransactionalProviderQueue(
            join(
              root,
              'queue.sqlite',
            ),
          );

        queue.enqueue(
          order(
            'auto-open-contract',
            'codex',
          ),
          1000,
        );

        const leased =
          queue.claimNext(
            'codex',
            'codex-01',
            2000,
            60_000,
          )!;

        const settled =
          queue.settle(
            'codex',
            leased.lease!.leaseId,
            'CONTRACT_REJECTED',
            null,
            3000,
          );

        expect(settled.state)
          .toBe(
            'QUALITY_HOLD',
          );

        expect(
          queue.providerQualityState(
            'codex',
          ),
        ).toMatchObject({
          state: 'OPEN',
          reason:
            'CONTRACT_REJECTED',
        });

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

        queue.close();
      },
    );

    it(
      'protocol rejection also atomically opens its provider circuit',
      () => {
        const root =
          makeRoot();

        const queue =
          new TransactionalProviderQueue(
            join(
              root,
              'queue.sqlite',
            ),
          );

        queue.enqueue(
          order(
            'auto-open-protocol',
            'antigravity',
          ),
          1000,
        );

        const leased =
          queue.claimNext(
            'antigravity',
            'agy-01',
            2000,
            60_000,
          )!;

        queue.settle(
          'antigravity',
          leased.lease!.leaseId,
          'PROTOCOL_REJECTED',
          null,
          3000,
        );

        expect(
          queue.providerQualityState(
            'antigravity',
          ),
        ).toMatchObject({
          state: 'OPEN',
          reason:
            'PROTOCOL_REJECTED',
        });

        expect(
          queue.canLaunchProvider(
            'codex',
          ),
        ).toBe(true);

        queue.close();
      },
    );

    it(
      'failed settlement cannot accidentally open the provider circuit',
      () => {
        const root =
          makeRoot();

        const queue =
          new TransactionalProviderQueue(
            join(
              root,
              'queue.sqlite',
            ),
          );

        queue.enqueue(
          order(
            'bad-settle-does-not-open',
            'codex',
          ),
          1000,
        );

        const leased =
          queue.claimNext(
            'codex',
            'codex-01',
            2000,
            60_000,
          )!;

        expect(() =>
          queue.settle(
            'codex',
            'f'.repeat(64),
            'CONTRACT_REJECTED',
            null,
            3000,
          ),
        ).toThrow(
          /ACTIVE_LEASE_NOT_FOUND/,
        );

        expect(
          queue.canLaunchProvider(
            'codex',
          ),
        ).toBe(true);

        expect(
          queue.get(
            leased.order.jobId,
          )?.state,
        ).toBe(
          'LEASED',
        );

        queue.close();
      },
    );

    it(
      'opens only the failing provider quality circuit',
      () => {
        const root =
          makeRoot();

        const queue =
          new TransactionalProviderQueue(
            join(
              root,
              'queue.sqlite',
            ),
          );

        queue.openProviderQualityCircuit(
          'codex',
          'CONTRACT_REJECTED',
          1000,
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

        queue.close();
      },
    );

    it(
      'persists an open quality circuit across restart',
      () => {
        const root =
          makeRoot();

        const dbPath =
          join(
            root,
            'queue.sqlite',
          );

        let queue =
          new TransactionalProviderQueue(
            dbPath,
          );

        queue.openProviderQualityCircuit(
          'antigravity',
          'PROTOCOL_REJECTED',
          1000,
        );

        queue.close();

        queue =
          new TransactionalProviderQueue(
            dbPath,
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

        queue.close();
      },
    );

    it(
      'refuses to close an open circuit with failed certification',
      () => {
        const root =
          makeRoot();

        const queue =
          new TransactionalProviderQueue(
            join(
              root,
              'queue.sqlite',
            ),
          );

        queue.openProviderQualityCircuit(
          'codex',
          'CONTRACT_REJECTED',
          1000,
        );

        const failed =
          certifyProviderQuality(
            'codex',
            baseline,
            [
              'USEFUL_UNIQUE',
              'BLOCKED',
            ],
          );

        expect(
          failed.certified,
        ).toBe(false);

        expect(() =>
          queue.closeProviderQualityCircuit(
            failed,
            baseline,
            2000,
          ),
        ).toThrow(
          /CERT_NOT_PASS/,
        );

        expect(
          queue.canLaunchProvider(
            'codex',
          ),
        ).toBe(false);

        queue.close();
      },
    );

    it(
      'refuses certification bound to a stale baseline',
      () => {
        const root =
          makeRoot();

        const queue =
          new TransactionalProviderQueue(
            join(
              root,
              'queue.sqlite',
            ),
          );

        queue.openProviderQualityCircuit(
          'codex',
          'PROTOCOL_REJECTED',
          1000,
        );

        const staleBaseline =
          'f'.repeat(40);

        const cert =
          certifyProviderQuality(
            'codex',
            staleBaseline,
            [
              'USEFUL_UNIQUE',
            ],
          );

        expect(() =>
          queue.closeProviderQualityCircuit(
            cert,
            baseline,
            2000,
          ),
        ).toThrow(
          /BASELINE_MISMATCH/,
        );

        expect(
          queue.canLaunchProvider(
            'codex',
          ),
        ).toBe(false);

        queue.close();
      },
    );

    it(
      'closes only after successful baseline-bound certification',
      () => {
        const root =
          makeRoot();

        const dbPath =
          join(
            root,
            'queue.sqlite',
          );

        let queue =
          new TransactionalProviderQueue(
            dbPath,
          );

        queue.openProviderQualityCircuit(
          'codex',
          'CONTRACT_REJECTED',
          1000,
        );

        const cert =
          certifyProviderQuality(
            'codex',
            baseline,
            [
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
            ],
          );

        const closed =
          queue.closeProviderQualityCircuit(
            cert,
            baseline,
            2000,
          );

        expect(closed)
          .toMatchObject({
            provider: 'codex',
            state: 'CLOSED',
            reason: null,
          });

        expect(
          queue.canLaunchProvider(
            'codex',
          ),
        ).toBe(true);

        queue.close();

        queue =
          new TransactionalProviderQueue(
            dbPath,
          );

        expect(
          queue.canLaunchProvider(
            'codex',
          ),
        ).toBe(true);

        queue.close();
      },
    );

    it(
      'reports independent pending provider capacity',
      () => {
        const root =
          makeRoot();

        const queue =
          new TransactionalProviderQueue(
            join(
              root,
              'queue.sqlite',
            ),
          );

        queue.enqueue(
          order(
            'codex-one',
            'codex',
          ),
          1000,
        );

        queue.enqueue(
          order(
            'agy-one',
            'antigravity',
          ),
          1001,
        );

        queue.enqueue(
          order(
            'either-one',
            'either',
          ),
          1002,
        );

        expect(
          queue.pendingFor(
            'codex',
          ),
        ).toBe(2);

        expect(
          queue.pendingFor(
            'antigravity',
          ),
        ).toBe(2);

        queue.close();
      },
    );
    it(
      'migrates an existing V4 queue additively to V5 without changing jobs or accepted work',
      () => {
        const root =
          makeRoot();

        const dbPath =
          join(
            root,
            'queue-v4-to-v5.sqlite',
          );

        let queue =
          new TransactionalProviderQueue(
            dbPath,
          );

        queue.enqueue(
          order(
            'job-v4-preserved',
            'codex',
          ),
          1000,
        );

        queue.close();

        const db =
          new DatabaseSync(
            dbPath,
          );

        db.exec(`
          DROP TABLE blocked_work_diagnostics;

          UPDATE queue_meta
          SET value =
            'VELNAR_TRANSACTIONAL_PROVIDER_QUEUE_V4'
          WHERE key = 'schema';
        `);

        db.close();

        queue =
          new TransactionalProviderQueue(
            dbPath,
          );

        expect(
          queue.get(
            'job-v4-preserved',
          )?.state,
        ).toBe(
          'PENDING',
        );

        expect(
          queue.getBlockedWorkDiagnostic(
            'job-v4-preserved',
          ),
        ).toBeNull();

        queue.close();

        const migrated =
          new DatabaseSync(
            dbPath,
          );

        const schema =
          migrated.prepare(`
            SELECT value
            FROM queue_meta
            WHERE key = 'schema'
          `)
            .get() as {
              value: string;
            };

        const table =
          migrated.prepare(`
            SELECT name
            FROM sqlite_master
            WHERE
              type = 'table'
              AND name =
                'blocked_work_diagnostics'
          `)
            .get();

        expect(
          schema.value,
        ).toBe(
          'VELNAR_TRANSACTIONAL_PROVIDER_QUEUE_V5',
        );

        expect(
          table,
        ).toBeTruthy();

        migrated.close();
      },
    );

  },
);
