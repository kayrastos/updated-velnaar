import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  buildProviderTaskLaneEvidenceFromHostLedger,
  createProviderTaskClassEvidenceLedger,
  providerTaskClassCounters,
  recordHostTaskClassOutcome,
} from '../../../scripts/fulgor/scheduler/providerTaskClassEvidenceLedger';

import {
  routeProviderTask,
} from '../../../scripts/fulgor/scheduler/providerTaskRouter';

const baseline =
  '0123456789abcdef0123456789abcdef01234567';

function addUseful(
  count:
    number,

  provider:
    'codex' |
    'antigravity',

  taskClass:
    'SEMANTIC_CONTRACT' |
    'AUTHORITY_BOUNDARY',

  prefix:
    string,
) {
  let ledger =
    createProviderTaskClassEvidenceLedger(
      baseline,
    );

  for (
    let index = 0;
    index < count;
    index += 1
  ) {
    ledger =
      recordHostTaskClassOutcome(
        ledger,
        {
          jobId:
            `${prefix}-${index}`,

          baseline,

          provider,

          taskClass,

          outcome:
            'USEFUL_UNIQUE',

          observedAtMs:
            1_000 + index,
        },
      );
  }

  return ledger;
}

describe(
  'VELNAR host-owned task-class evidence ledger V1',
  () => {
    it(
      'derives certification only from exact host-recorded provider and task class outcomes',
      () => {
        let ledger =
          addUseful(
            8,
            'codex',
            'SEMANTIC_CONTRACT',
            'codex-semantic',
          );

        ledger =
          recordHostTaskClassOutcome(
            ledger,
            {
              jobId:
                'codex-authority-blocked',

              baseline,

              provider:
                'codex',

              taskClass:
                'AUTHORITY_BOUNDARY',

              outcome:
                'BLOCKED',

              observedAtMs:
                2_000,
            },
          );

        const semantic =
          buildProviderTaskLaneEvidenceFromHostLedger(
            ledger,
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

        const authority =
          buildProviderTaskLaneEvidenceFromHostLedger(
            ledger,
            'codex',
            'AUTHORITY_BOUNDARY',
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
          semantic.counters.attempts,
        ).toBe(8);

        expect(
          semantic.counters.usefulUnique,
        ).toBe(8);

        expect(
          semantic.certified,
        ).toBe(true);

        expect(
          authority.counters.attempts,
        ).toBe(1);

        expect(
          authority.counters.blocked,
        ).toBe(1);

        expect(
          authority.certified,
        ).toBe(false);
      },
    );

    it(
      'rejects duplicate host job replay instead of allowing evidence inflation or reclassification',
      () => {
        let ledger =
          createProviderTaskClassEvidenceLedger(
            baseline,
          );

        ledger =
          recordHostTaskClassOutcome(
            ledger,
            {
              jobId:
                'job-1',

              baseline,

              provider:
                'codex',

              taskClass:
                'SEMANTIC_CONTRACT',

              outcome:
                'USEFUL_UNIQUE',

              observedAtMs:
                1_000,
            },
          );

        expect(
          () =>
            recordHostTaskClassOutcome(
              ledger,
              {
                jobId:
                  'job-1',

                baseline,

                provider:
                  'antigravity',

                taskClass:
                  'AUTHORITY_BOUNDARY',

                outcome:
                  'USEFUL_UNIQUE',

                observedAtMs:
                  2_000,
              },
            ),
        ).toThrow(
          /JOB_ALREADY_RECORDED/,
        );
      },
    );

    it(
      'rejects cross-baseline evidence reuse',
      () => {
        const ledger =
          createProviderTaskClassEvidenceLedger(
            baseline,
          );

        expect(
          () =>
            recordHostTaskClassOutcome(
              ledger,
              {
                jobId:
                  'cross-baseline',

                baseline:
                  'a'.repeat(40),

                provider:
                  'codex',

                taskClass:
                  'SEMANTIC_CONTRACT',

                outcome:
                  'USEFUL_UNIQUE',

                observedAtMs:
                  1_000,
              },
            ),
        ).toThrow(
          /BASELINE_MISMATCH/,
        );
      },
    );

    it(
      'keeps BLOCKED inside the exact task-class denominator',
      () => {
        let ledger =
          createProviderTaskClassEvidenceLedger(
            baseline,
          );

        for (
          let index = 0;
          index < 7;
          index += 1
        ) {
          ledger =
            recordHostTaskClassOutcome(
              ledger,
              {
                jobId:
                  `useful-${index}`,

                baseline,

                provider:
                  'antigravity',

                taskClass:
                  'SEMANTIC_CONTRACT',

                outcome:
                  'USEFUL_UNIQUE',

                observedAtMs:
                  index,
              },
            );
        }

        ledger =
          recordHostTaskClassOutcome(
            ledger,
            {
              jobId:
                'blocked-7',

              baseline,

              provider:
                'antigravity',

              taskClass:
                'SEMANTIC_CONTRACT',

              outcome:
                'BLOCKED',

              observedAtMs:
                8,
            },
          );

        const counters =
          providerTaskClassCounters(
            ledger,
            'antigravity',
            'SEMANTIC_CONTRACT',
          );

        expect(
          counters.attempts,
        ).toBe(8);

        expect(
          counters.usefulUnique,
        ).toBe(7);

        expect(
          counters.blocked,
        ).toBe(1);
      },
    );

    it(
      'feeds the router class-specific host evidence without granting authority',
      () => {
        let ledger =
          createProviderTaskClassEvidenceLedger(
            baseline,
          );

        for (
          let index = 0;
          index < 8;
          index += 1
        ) {
          ledger =
            recordHostTaskClassOutcome(
              ledger,
              {
                jobId:
                  `codex-${index}`,

                baseline,

                provider:
                  'codex',

                taskClass:
                  'SEMANTIC_CONTRACT',

                outcome:
                  'USEFUL_UNIQUE',

                observedAtMs:
                  index,
              },
            );
        }

        for (
          let index = 0;
          index < 7;
          index += 1
        ) {
          ledger =
            recordHostTaskClassOutcome(
              ledger,
              {
                jobId:
                  `agy-useful-${index}`,

                baseline,

                provider:
                  'antigravity',

                taskClass:
                  'SEMANTIC_CONTRACT',

                outcome:
                  'USEFUL_UNIQUE',

                observedAtMs:
                  100 + index,
              },
            );
        }

        ledger =
          recordHostTaskClassOutcome(
            ledger,
            {
              jobId:
                'agy-blocked',

              baseline,

              provider:
                'antigravity',

              taskClass:
                'SEMANTIC_CONTRACT',

              outcome:
                'BLOCKED',

              observedAtMs:
                200,
            },
          );

        const codex =
          buildProviderTaskLaneEvidenceFromHostLedger(
            ledger,
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

        const antigravity =
          buildProviderTaskLaneEvidenceFromHostLedger(
            ledger,
            'antigravity',
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

        const decision =
          routeProviderTask({
            taskClass:
              'SEMANTIC_CONTRACT',

            preference:
              'AUTO',

            codex,

            antigravity,
          });

        expect(
          decision.status,
        ).toBe('ROUTE');

        expect(
          decision.provider,
        ).toBe('codex');

        expect(
          decision.authorityGranted,
        ).toBe(false);

        expect(
          decision.verificationGranted,
        ).toBe(false);

        expect(
          decision.automaticPromotionAllowed,
        ).toBe(false);
      },
    );
  },
);
