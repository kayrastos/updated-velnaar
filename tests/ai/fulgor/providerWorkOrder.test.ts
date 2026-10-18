import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  claimProviderWork,
  countsAsCompletedBacklog,
  createProviderWorkOrder,
  createProviderWorkRecord,
  expireProviderLease,
  isAutomaticallyLeaseable,
  parseProviderWorkRecord,
  requiresOperatorReview,
  serializeProviderWorkRecord,
  settleProviderWork,
} from '../../../scripts/fulgor/orchestration/providerWorkOrder';

const baseline =
  '0123456789abcdef0123456789abcdef01234567';

function pending(
  affinity:
    'codex' |
    'antigravity' |
    'either' =
      'either',
) {
  const order =
    createProviderWorkOrder({
      jobId:
        'job-001',

      baseline,

      task:
        'Inspect the bounded task and return a host-bound work product.',

      evidenceIds:
        ['E1', 'E2'],

      affinity,
    });

  return createProviderWorkRecord(
    order,
    1_000,
  );
}

describe(
  'VELNAR provider work-order lifecycle',
  () => {
    it(
      'starts as pending and leaseable',
      () => {
        const record =
          pending();

        expect(record.state)
          .toBe('PENDING');

        expect(record.attempts)
          .toBe(0);

        expect(
          isAutomaticallyLeaseable(
            record,
          ),
        ).toBe(true);

        expect(
          countsAsCompletedBacklog(
            record,
          ),
        ).toBe(false);
      },
    );

    it(
      'round-trips through strict serialized validation',
      () => {
        const record =
          pending();

        const raw =
          serializeProviderWorkRecord(
            record,
          );

        expect(
          parseProviderWorkRecord(
            raw,
          ),
        ).toEqual(record);
      },
    );

    it(
      'permits only the configured provider affinity',
      () => {
        const record =
          pending('codex');

        expect(() =>
          claimProviderWork(
            record,
            'antigravity',
            'agy-01',
            2_000,
            60_000,
          ),
        ).toThrow(
          /PROVIDER_NOT_ALLOWED/,
        );

        expect(
          claimProviderWork(
            record,
            'codex',
            'codex-01',
            2_000,
            60_000,
          ).state,
        ).toBe('LEASED');
      },
    );

    it(
      'allows either-affinity work to be claimed by exactly one lane',
      () => {
        const record =
          pending('either');

        const leased =
          claimProviderWork(
            record,
            'codex',
            'codex-01',
            2_000,
            60_000,
          );

        expect(leased.attempts)
          .toBe(1);

        expect(
          leased.lease?.provider,
        ).toBe('codex');

        expect(() =>
          claimProviderWork(
            leased,
            'antigravity',
            'agy-01',
            2_100,
            60_000,
          ),
        ).toThrow(
          /NOT_PENDING/,
        );
      },
    );

    it(
      'requires exact lease identity to settle',
      () => {
        const leased =
          claimProviderWork(
            pending(),
            'codex',
            'codex-01',
            2_000,
            60_000,
          );

        expect(() =>
          settleProviderWork(
            leased,
            'codex',
            'f'.repeat(64),
            'USEFUL_UNIQUE',
            'a'.repeat(64),
            3_000,
          ),
        ).toThrow(
          /LEASE_MISMATCH/,
        );
      },
    );

    it(
      'only USEFUL_UNIQUE completes backlog',
      () => {
        const leased =
          claimProviderWork(
            pending(),
            'codex',
            'codex-01',
            2_000,
            60_000,
          );

        const done =
          settleProviderWork(
            leased,
            'codex',
            leased.lease!.leaseId,
            'USEFUL_UNIQUE',
            'a'.repeat(64),
            3_000,
          );

        expect(done.state)
          .toBe(
            'USEFUL_COMPLETE',
          );

        expect(
          countsAsCompletedBacklog(
            done,
          ),
        ).toBe(true);

        expect(
          requiresOperatorReview(
            done,
          ),
        ).toBe(false);
      },
    );

    it(
      'BLOCKED never counts as completed backlog',
      () => {
        const leased =
          claimProviderWork(
            pending(),
            'codex',
            'codex-01',
            2_000,
            60_000,
          );

        const blocked =
          settleProviderWork(
            leased,
            'codex',
            leased.lease!.leaseId,
            'BLOCKED',
            null,
            3_000,
          );

        expect(blocked.state)
          .toBe('BLOCKED');

        expect(
          countsAsCompletedBacklog(
            blocked,
          ),
        ).toBe(false);

        expect(
          requiresOperatorReview(
            blocked,
          ),
        ).toBe(true);
      },
    );

    it(
      'duplicate useful work goes to quality hold',
      () => {
        const leased =
          claimProviderWork(
            pending(),
            'antigravity',
            'agy-01',
            2_000,
            60_000,
          );

        const duplicate =
          settleProviderWork(
            leased,
            'antigravity',
            leased.lease!.leaseId,
            'USEFUL_DUPLICATE',
            'b'.repeat(64),
            3_000,
          );

        expect(duplicate.state)
          .toBe(
            'QUALITY_HOLD',
          );

        expect(
          countsAsCompletedBacklog(
            duplicate,
          ),
        ).toBe(false);
      },
    );

    it(
      'protocol and contract failures go to quality hold without blind retry',
      () => {
        for (
          const outcome of [
            'PROTOCOL_REJECTED',
            'CONTRACT_REJECTED',
          ] as const
        ) {
          const leased =
            claimProviderWork(
              pending(),
              'codex',
              'codex-01',
              2_000,
              60_000,
            );

          const held =
            settleProviderWork(
              leased,
              'codex',
              leased.lease!.leaseId,
              outcome,
              null,
              3_000,
            );

          expect(held.state)
            .toBe(
              'QUALITY_HOLD',
            );

          expect(
            isAutomaticallyLeaseable(
              held,
            ),
          ).toBe(false);
        }
      },
    );

    it(
      'transport failure goes to recovery hold, not pending',
      () => {
        const leased =
          claimProviderWork(
            pending(),
            'codex',
            'codex-01',
            2_000,
            60_000,
          );

        const held =
          settleProviderWork(
            leased,
            'codex',
            leased.lease!.leaseId,
            'TRANSPORT_FAILURE',
            null,
            3_000,
          );

        expect(held.state)
          .toBe(
            'RECOVERY_HOLD',
          );

        expect(
          held.recoveryHoldReason,
        ).toBe(
          'TRANSPORT_FAILURE',
        );

        expect(
          isAutomaticallyLeaseable(
            held,
          ),
        ).toBe(false);
      },
    );

    it(
      'expired lease does not silently retry and burn quota again',
      () => {
        const leased =
          claimProviderWork(
            pending(),
            'codex',
            'codex-01',
            2_000,
            5_000,
          );

        const held =
          expireProviderLease(
            leased,
            7_000,
          );

        expect(held.state)
          .toBe(
            'RECOVERY_HOLD',
          );

        expect(
          held.recoveryHoldReason,
        ).toBe(
          'LEASE_EXPIRED',
        );

        expect(
          isAutomaticallyLeaseable(
            held,
          ),
        ).toBe(false);

        expect(
          requiresOperatorReview(
            held,
          ),
        ).toBe(true);
      },
    );

    it(
      'late output from an expired lease is rejected',
      () => {
        const leased =
          claimProviderWork(
            pending(),
            'codex',
            'codex-01',
            2_000,
            5_000,
          );

        expect(() =>
          settleProviderWork(
            leased,
            'codex',
            leased.lease!.leaseId,
            'USEFUL_UNIQUE',
            'a'.repeat(64),
            7_001,
          ),
        ).toThrow(
          /LEASE_EXPIRED/,
        );
      },
    );

    it(
      'rejects unknown persisted fields',
      () => {
        const record =
          pending();

        const value =
          JSON.parse(
            serializeProviderWorkRecord(
              record,
            ),
          );

        value.fakeSuccess =
          true;

        expect(() =>
          parseProviderWorkRecord(
            JSON.stringify(
              value,
            ),
          ),
        ).toThrow(
          /SCHEMA_INVALID/,
        );
      },
    );

    it(
      'rejects forged persisted useful completion',
      () => {
        const record =
          pending();

        const value =
          JSON.parse(
            serializeProviderWorkRecord(
              record,
            ),
          );

        value.state =
          'USEFUL_COMPLETE';

        expect(() =>
          parseProviderWorkRecord(
            JSON.stringify(
              value,
            ),
          ),
        ).toThrow(
          /COMPLETE_INVALID/,
        );
      },
    );
  },
);


describe(
  'provider work-order strictness hardening',
  () => {
    function mutableSerialized(
      record = pending(),
    ): any {
      return JSON.parse(
        String(
          serializeProviderWorkRecord(
            record,
          ),
        ),
      );
    }

    it(
      'rejects coercible non-string serialized work-order fields',
      () => {
        const cases: Array<{
          mutate:
            (raw: any) => void;

          expected:
            RegExp;
        }> = [
          {
            mutate:
              raw => {
                raw.order.jobId =
                  123;
              },

            expected:
              /JOB_ID_TYPE_INVALID/,
          },

          {
            mutate:
              raw => {
                raw.order.baseline = {
                  value:
                    baseline,
                };
              },

            expected:
              /BASELINE_TYPE_INVALID/,
          },

          {
            mutate:
              raw => {
                raw.order.task =
                  456;
              },

            expected:
              /TASK_TYPE_INVALID/,
          },

          {
            mutate:
              raw => {
                raw.order.evidenceIds =
                  ['E1', 2];
              },

            expected:
              /EVIDENCE_ID_TYPE_INVALID/,
          },
        ];

        for (
          const testCase
          of cases
        ) {
          const raw =
            mutableSerialized();

          testCase.mutate(
            raw,
          );

          expect(() =>
            parseProviderWorkRecord(
              JSON.stringify(
                raw,
              ),
            ),
          ).toThrow(
            testCase.expected,
          );
        }
      },
    );

    it(
      'rejects settlement exactly at lease expiry boundary',
      () => {
        const leased =
          claimProviderWork(
            pending('codex'),
            'codex',
            'boundary-settle',
            2_000,
            5_000,
          );

        expect(
          leased.lease
            ?.expiresAtMs,
        ).toBe(
          7_000,
        );

        expect(() =>
          settleProviderWork(
            leased,
            'codex',
            leased.lease!
              .leaseId,
            'BLOCKED',
            null,
            7_000,
          ),
        ).toThrow(
          /LEASE_EXPIRED/,
        );
      },
    );

    it(
      'expires a lease exactly at its expiry boundary',
      () => {
        const leased =
          claimProviderWork(
            pending('codex'),
            'codex',
            'boundary-expire',
            2_000,
            5_000,
          );

        const expired =
          expireProviderLease(
            leased,
            7_000,
          );

        expect(
          expired.state,
        ).toBe(
          'RECOVERY_HOLD',
        );

        expect(
          expired
            .recoveryHoldReason,
        ).toBe(
          'LEASE_EXPIRED',
        );
      },
    );

    it(
      'rejects lease expiry timestamp overflow',
      () => {
        expect(() =>
          claimProviderWork(
            pending('codex'),
            'codex',
            'expiry-overflow',
            Number.MAX_SAFE_INTEGER -
              1_000,
            5_000,
          ),
        ).toThrow(
          /LEASE_EXPIRY_OVERFLOW/,
        );
      },
    );

    it(
      'rejects attempt counter overflow before increment',
      () => {
        const raw =
          mutableSerialized();

        raw.attempts =
          Number.MAX_SAFE_INTEGER;

        const record =
          parseProviderWorkRecord(
            JSON.stringify(
              raw,
            ),
          );

        expect(() =>
          claimProviderWork(
            record,
            'codex',
            'attempt-overflow',
            2_000,
            5_000,
          ),
        ).toThrow(
          /ATTEMPT_OVERFLOW/,
        );
      },
    );
  },
);
