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
  DatabaseSync,
} from 'node:sqlite';

import {
  ProviderTaskClassEvidenceStore,
} from '../../../scripts/fulgor/scheduler/providerTaskClassEvidenceStore';

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
        'velnar-task-class-store-',
      ),
    );

  roots.push(value);

  return value;
}

afterEach(
  () => {
    while (roots.length > 0) {
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
  'VELNAR durable task-class evidence store V1',
  () => {
    it(
      'persists certified host evidence across restart',
      () => {
        const dbPath =
          join(
            root(),
            'evidence.sqlite',
          );

        let store =
          new ProviderTaskClassEvidenceStore(
            dbPath,
            baseline,
          );

        for (
          let index = 0;
          index < 8;
          index += 1
        ) {
          store.appendHostOutcome({
            jobId:
              `semantic-${index}`,

            baseline,

            provider:
              'codex',

            taskClass:
              'SEMANTIC_CONTRACT',

            outcome:
              'USEFUL_UNIQUE',

            observedAtMs:
              1000 + index,
          });
        }

        expect(
          store.count(),
        ).toBe(8);

        expect(
          store.integrityCheck(),
        ).toBe(true);

        store.close();

        store =
          new ProviderTaskClassEvidenceStore(
            dbPath,
            baseline,
          );

        const lane =
          store.laneEvidence(
            'codex',
            'SEMANTIC_CONTRACT',
            {
              qualityCircuit:
                'CLOSED',

              quotaCircuit:
                'CLOSED',

              availableSlots:
                4,
            },
          );

        expect(
          lane.counters.attempts,
        ).toBe(8);

        expect(
          lane.counters.usefulUnique,
        ).toBe(8);

        expect(
          lane.certified,
        ).toBe(true);

        store.close();
      },
    );

    it(
      'denies duplicate job replay',
      () => {
        const store =
          new ProviderTaskClassEvidenceStore(
            join(
              root(),
              'duplicate.sqlite',
            ),
            baseline,
          );

        store.appendHostOutcome({
          jobId:
            'same-job',

          baseline,

          provider:
            'codex',

          taskClass:
            'AUTHORITY_BOUNDARY',

          outcome:
            'USEFUL_UNIQUE',

          observedAtMs:
            1000,
        });

        expect(
          () =>
            store.appendHostOutcome({
              jobId:
                'same-job',

              baseline,

              provider:
                'antigravity',

              taskClass:
                'SEMANTIC_CONTRACT',

              outcome:
                'USEFUL_UNIQUE',

              observedAtMs:
                2000,
            }),
        ).toThrow(
          /JOB_ALREADY_RECORDED/,
        );

        expect(
          store.count(),
        ).toBe(1);

        store.close();
      },
    );

    it(
      'denies reopening the store under another baseline',
      () => {
        const dbPath =
          join(
            root(),
            'baseline.sqlite',
          );

        const store =
          new ProviderTaskClassEvidenceStore(
            dbPath,
            baseline,
          );

        store.close();

        expect(
          () =>
            new ProviderTaskClassEvidenceStore(
              dbPath,
              'a'.repeat(40),
            ),
        ).toThrow(
          /BASELINE_MISMATCH/,
        );
      },
    );

    it(
      'persists only HOST_RUNTIME source',
      () => {
        const dbPath =
          join(
            root(),
            'source.sqlite',
          );

        const store =
          new ProviderTaskClassEvidenceStore(
            dbPath,
            baseline,
          );

        store.appendHostOutcome({
          jobId:
            'source-job',

          baseline,

          provider:
            'antigravity',

          taskClass:
            'TRANSPORT_SAFETY',

          outcome:
            'TRANSPORT_FAILURE',

          observedAtMs:
            1000,
        });

        store.close();

        const db =
          new DatabaseSync(
            dbPath,
          );

        const raw =
          db.prepare(`
            SELECT source
            FROM task_class_evidence
            WHERE job_id = ?
          `)
            .get(
              'source-job',
            );

        expect(raw)
          .not.toBeUndefined();

        const row =
          (
            raw as unknown
          ) as {
            source:
              string;
          };

        expect(
          row.source,
        ).toBe(
          'HOST_RUNTIME',
        );

        db.close();
      },
    );
  },
);
