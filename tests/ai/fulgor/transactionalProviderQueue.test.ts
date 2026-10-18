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
          queue.settle(
            'codex',
            leased.lease!.leaseId,
            'USEFUL_UNIQUE',
            'a'.repeat(64),
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
  },
);
