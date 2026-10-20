import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest';

import {
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
  TransactionalProviderQueue,
} from '../../../scripts/fulgor/orchestration/transactionalProviderQueue';


const roots: string[] = [];


function root():
  string {
  const value =
    mkdtempSync(
      join(
        tmpdir(),
        'velnar-queue-v6-',
      ),
    );

  roots.push(value);

  return value;
}


function order(
  jobId:
    string,

  affinity:
    'codex' |
    'antigravity' |
    'either' =
      'codex',
) {
  return createProviderWorkOrder({
    jobId,

    baseline:
      'a'.repeat(40),

    task:
      'bounded atomicity regression',

    evidenceIds:
      [
        'E1',
        'E2',
      ],

    affinity,
  });
}


afterEach(
  () => {
    while (roots.length > 0) {
      const value =
        roots.pop();

      if (value !== undefined) {
        rmSync(
          value,
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


describe(
  'transactional provider queue V6 task-class binding',
  () => {
    it(
      'persists class and terminal outcome across restart',
      () => {
        const dbPath =
          join(
            root(),
            'queue.sqlite',
          );

        let queue =
          new TransactionalProviderQueue(
            dbPath,
          );

        queue.enqueue(
          order(
            'atomic-job-1',
            'codex',
          ),
          1_000,
          'GENERAL',
        );

        expect(
          queue.taskClass(
            'atomic-job-1',
          ),
        ).toBe(
          'GENERAL',
        );

        const lease =
          queue.claimNext(
            'codex',
            'slot-1',
            1_100,
            60_000,
          );

        expect(lease)
          .not
          .toBeNull();

        queue.settle(
          'codex',
          lease!.lease!.leaseId,
          'TRANSPORT_FAILURE',
          null,
          1_200,
        );

        expect(
          queue
            .terminalTaskClassOutcomes(),
        ).toEqual([
          {
            jobId:
              'atomic-job-1',

            baseline:
              'a'.repeat(40),

            provider:
              'codex',

            taskClass:
              'GENERAL',

            outcome:
              'TRANSPORT_FAILURE',

            observedAtMs:
              1_200,
          },
        ]);

        queue.close();

        queue =
          new TransactionalProviderQueue(
            dbPath,
          );

        try {
          expect(
            queue
              .terminalTaskClassOutcomes(),
          ).toEqual([
            {
              jobId:
                'atomic-job-1',

              baseline:
                'a'.repeat(40),

              provider:
                'codex',

              taskClass:
                'GENERAL',

              outcome:
                'TRANSPORT_FAILURE',

              observedAtMs:
                1_200,
            },
          ]);
        } finally {
          queue.close();
        }
      },
    );


    it(
      'migrates real-shape V5 without inventing task class',
      () => {
        const dbPath =
          join(
            root(),
            'real-v5.sqlite',
          );

        let queue =
          new TransactionalProviderQueue(
            dbPath,
          );

        queue.enqueue(
          order(
            'legacy-v5-job',
          ),
          1_000,
        );

        queue.close();

        const raw =
          new DatabaseSync(
            dbPath,
          );

        raw.exec(`
          ALTER TABLE jobs
          DROP COLUMN task_class;

          UPDATE queue_meta
          SET value =
            'VELNAR_TRANSACTIONAL_PROVIDER_QUEUE_V5'
          WHERE key = 'schema';
        `);

        raw.close();

        queue =
          new TransactionalProviderQueue(
            dbPath,
          );

        try {
          expect(
            queue.taskClass(
              'legacy-v5-job',
            ),
          ).toBeNull();
        } finally {
          queue.close();
        }
      },
    );


    it(
      'is idempotent when V5 metadata already has physical task_class column',
      () => {
        const dbPath =
          join(
            root(),
            'physical-v6.sqlite',
          );

        let queue =
          new TransactionalProviderQueue(
            dbPath,
          );

        queue.enqueue(
          order(
            'fixture-job',
          ),
          1_000,
          'GENERAL',
        );

        queue.close();

        const raw =
          new DatabaseSync(
            dbPath,
          );

        raw.exec(`
          UPDATE queue_meta
          SET value =
            'VELNAR_TRANSACTIONAL_PROVIDER_QUEUE_V5'
          WHERE key = 'schema';
        `);

        raw.close();

        queue =
          new TransactionalProviderQueue(
            dbPath,
          );

        try {
          expect(
            queue.taskClass(
              'fixture-job',
            ),
          ).toBe(
            'GENERAL',
          );
        } finally {
          queue.close();
        }

        const verify =
          new DatabaseSync(
            dbPath,
          );

        try {
          const columns =
            verify
              .prepare(`
                SELECT name
                FROM pragma_table_info('jobs')
                WHERE name = 'task_class'
              `)
              .all();

          expect(columns)
            .toHaveLength(1);
        } finally {
          verify.close();
        }
      },
    );


    it(
      'rejects noncanonical class',
      () => {
        const queue =
          new TransactionalProviderQueue(
            join(
              root(),
              'invalid.sqlite',
            ),
          );

        try {
          expect(() =>
            queue.enqueue(
              order(
                'invalid',
              ),
              1_000,
              (
                'NOT_A_CLASS'
              ) as never,
            ),
          ).toThrow(
            /QUEUE_TASK_CLASS_INVALID/,
          );
        } finally {
          queue.close();
        }
      },
    );


    it(
      'production admission persists task class',
      () => {
        const source =
          readFileSync(
            join(
              process.cwd(),
              'scripts/fulgor/orchestration/providerTaskRoutingAdmission.ts',
            ),
            'utf-8',
          );

        expect(source)
          .toMatch(
            /input\.queue\.enqueue\([\s\S]{0,220}input\.taskClass/,
          );
      },
    );
  },
);
