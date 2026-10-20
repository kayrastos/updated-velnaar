import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  buildProviderTaskLaneEvidenceFromHostLedger,
  buildProviderTaskClassRecoveryEvidenceFromHostLedger,
  createProviderTaskClassEvidenceLedger,
  recordHostTaskClassOutcome,
  type ProviderTaskClassEvidenceLedger,
} from '../../../scripts/fulgor/scheduler/providerTaskClassEvidenceLedger';

import {
  evaluateProviderTaskClassRecovery,
} from '../../../scripts/fulgor/scheduler/providerTaskClassRecoveryPolicy';


const baseline =
  '0123456789abcdef0123456789abcdef01234567';


function append(
  ledger:
    ProviderTaskClassEvidenceLedger,

  jobId:
    string,

  outcome:
    'TRANSPORT_FAILURE' |
    'PROTOCOL_REJECTED' |
    'CONTRACT_REJECTED' |
    'BLOCKED' |
    'USEFUL_DUPLICATE' |
    'USEFUL_UNIQUE',

  observedAtMs:
    number,
): ProviderTaskClassEvidenceLedger {
  return recordHostTaskClassOutcome(
    ledger,
    {
      jobId,
      baseline,

      provider:
        'antigravity',

      taskClass:
        'GENERAL',

      outcome,

      observedAtMs,
    },
  );
}


function certifiedHistory():
ProviderTaskClassEvidenceLedger {
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
      append(
        ledger,
        `cert-${index}`,
        'USEFUL_UNIQUE',
        1_000 + index,
      );
  }

  return ledger;
}


function withTransportFailure():
ProviderTaskClassEvidenceLedger {
  return append(
    certifiedHistory(),
    'transport-failure',
    'TRANSPORT_FAILURE',
    2_000,
  );
}


function lane(
  ledger:
    ProviderTaskClassEvidenceLedger,
) {
  return buildProviderTaskLaneEvidenceFromHostLedger(
    ledger,
    'antigravity',
    'GENERAL',
    {
      qualityCircuit:
        'CLOSED',

      quotaCircuit:
        'CLOSED',

      availableSlots:
        8,
    },
  );
}


function recovery(
  ledger:
    ProviderTaskClassEvidenceLedger,
) {
  return buildProviderTaskClassRecoveryEvidenceFromHostLedger(
    ledger,
    'antigravity',
    'GENERAL',
  );
}


describe(
  'VELNAR two-phase task-class transport recovery V1',
  () => {
    it(
      'keeps the fresh transport failure inside the bounded lane window',
      () => {
        const ledger =
          withTransportFailure();

        const current =
          lane(
            ledger,
          );

        expect(
          current.counters.attempts,
        ).toBe(
          8,
        );

        expect(
          current.counters.usefulUnique,
        ).toBe(
          7,
        );

        expect(
          current.counters.transportFailures,
        ).toBe(
          1,
        );

        expect(
          current.certified,
        ).toBe(
          false,
        );
      },
    );


    it(
      'permits exactly one probation bootstrap call after dwell',
      () => {
        const ledger =
          withTransportFailure();

        const current =
          lane(
            ledger,
          );

        const evidence =
          recovery(
            ledger,
          );

        expect(
          evidence
            .certifiedImmediatelyBeforeLatestTransportFailure,
        ).toBe(
          true,
        );

        expect(
          evidence.postFailureUsefulUnique,
        ).toBe(
          0,
        );

        const early =
          evaluateProviderTaskClassRecovery({
            baseline,

            nowMs:
              61_999,

            requestedProviderCalls:
              1,

            requestedConcurrency:
              1,

            lane:
              current,

            recovery:
              evidence,
          });

        expect(
          early,
        ).toMatchObject({
          status:
            'HOLD',

          reason:
            'RECOVERY_DWELL',

          phase:
            'PROBATION_BOOTSTRAP',

          requiredProviderCalls:
            1,
        });

        const allowed =
          evaluateProviderTaskClassRecovery({
            baseline,

            nowMs:
              62_000,

            requestedProviderCalls:
              1,

            requestedConcurrency:
              1,

            lane:
              current,

            recovery:
              evidence,
          });

        expect(
          allowed,
        ).toMatchObject({
          status:
            'ELIGIBLE',

          reason:
            'BOUNDED_TRANSPORT_RECOVERY',

          phase:
            'PROBATION_BOOTSTRAP',

          requiredProviderCalls:
            1,

          maxConcurrency:
            1,

          authorityGranted:
            false,

          executionGranted:
            false,

          verificationGranted:
            false,

          automaticPromotionAllowed:
            false,
        });

        const forbiddenEight =
          evaluateProviderTaskClassRecovery({
            baseline,

            nowMs:
              62_000,

            requestedProviderCalls:
              8,

            requestedConcurrency:
              1,

            lane:
              current,

            recovery:
              evidence,
          });

        expect(
          forbiddenEight,
        ).toMatchObject({
          status:
            'HOLD',

          reason:
            'RECOVERY_CALL_COUNT_MISMATCH',

          phase:
            'PROBATION_BOOTSTRAP',

          requiredProviderCalls:
            1,
        });
      },
    );


    it(
      'requires a separate seven-call certification phase after successful probation',
      () => {
        let ledger =
          withTransportFailure();

        ledger =
          append(
            ledger,
            'probation-success',
            'USEFUL_UNIQUE',
            3_000,
          );

        const current =
          lane(
            ledger,
          );

        const evidence =
          recovery(
            ledger,
          );

        expect(
          current.certified,
        ).toBe(
          false,
        );

        expect(
          evidence.postFailureAttempts,
        ).toBe(
          1,
        );

        expect(
          evidence.postFailureUsefulUnique,
        ).toBe(
          1,
        );

        expect(
          evidence.postFailureNonUseful,
        ).toBe(
          0,
        );

        const allowed =
          evaluateProviderTaskClassRecovery({
            baseline,

            nowMs:
              100_000,

            requestedProviderCalls:
              7,

            requestedConcurrency:
              1,

            lane:
              current,

            recovery:
              evidence,
          });

        expect(
          allowed,
        ).toMatchObject({
          status:
            'ELIGIBLE',

          reason:
            'BOUNDED_TRANSPORT_RECOVERY',

          phase:
            'BOUNDED_CERTIFICATION',

          requiredProviderCalls:
            7,

          maxConcurrency:
            1,

          authorityGranted:
            false,

          executionGranted:
            false,

          verificationGranted:
            false,

          automaticPromotionAllowed:
            false,
        });

        const reusedProbationShape =
          evaluateProviderTaskClassRecovery({
            baseline,

            nowMs:
              100_000,

            requestedProviderCalls:
              1,

            requestedConcurrency:
              1,

            lane:
              current,

            recovery:
              evidence,
          });

        expect(
          reusedProbationShape,
        ).toMatchObject({
          status:
            'HOLD',

          reason:
            'RECOVERY_CALL_COUNT_MISMATCH',

          phase:
            'BOUNDED_CERTIFICATION',

          requiredProviderCalls:
            7,
        });
      },
    );


    it(
      'rejects widened concurrency in either phase',
      () => {
        const ledger =
          withTransportFailure();

        const decision =
          evaluateProviderTaskClassRecovery({
            baseline,

            nowMs:
              62_000,

            requestedProviderCalls:
              1,

            requestedConcurrency:
              2,

            lane:
              lane(
                ledger,
              ),

            recovery:
              recovery(
                ledger,
              ),
          });

        expect(
          decision,
        ).toMatchObject({
          status:
            'HOLD',

          reason:
            'RECOVERY_CONCURRENCY_INVALID',

          phase:
            'PROBATION_BOOTSTRAP',

          requiredProviderCalls:
            1,
        });
      },
    );


    it(
      'does not use recovery after any post-failure non-useful outcome',
      () => {
        let ledger =
          withTransportFailure();

        ledger =
          append(
            ledger,
            'post-failure-blocked',
            'BLOCKED',
            3_000,
          );

        const decision =
          evaluateProviderTaskClassRecovery({
            baseline,

            nowMs:
              100_000,

            requestedProviderCalls:
              1,

            requestedConcurrency:
              1,

            lane:
              lane(
                ledger,
              ),

            recovery:
              recovery(
                ledger,
              ),
          });

        expect(
          decision,
        ).toMatchObject({
          status:
            'HOLD',

          reason:
            'POST_FAILURE_NON_USEFUL_OUTCOME',

          phase:
            null,

          requiredProviderCalls:
            0,
        });
      },
    );


    it(
      'shrinks certification remaining count and recertifies only at eight fresh uniques',
      () => {
        let ledger =
          withTransportFailure();

        for (
          let index = 0;
          index < 7;
          index += 1
        ) {
          ledger =
            append(
              ledger,
              `recovery-${index}`,
              'USEFUL_UNIQUE',
              3_000 + index,
            );
        }

        const sevenLane =
          lane(
            ledger,
          );

        const sevenRecovery =
          recovery(
            ledger,
          );

        expect(
          sevenLane.certified,
        ).toBe(
          false,
        );

        expect(
          sevenRecovery.postFailureUsefulUnique,
        ).toBe(
          7,
        );

        const finalCertificationCall =
          evaluateProviderTaskClassRecovery({
            baseline,

            nowMs:
              100_000,

            requestedProviderCalls:
              1,

            requestedConcurrency:
              1,

            lane:
              sevenLane,

            recovery:
              sevenRecovery,
          });

        expect(
          finalCertificationCall,
        ).toMatchObject({
          status:
            'ELIGIBLE',

          phase:
            'BOUNDED_CERTIFICATION',

          requiredProviderCalls:
            1,
        });

        ledger =
          append(
            ledger,
            'recovery-7',
            'USEFUL_UNIQUE',
            4_000,
          );

        const recovered =
          lane(
            ledger,
          );

        expect(
          recovered.counters.attempts,
        ).toBe(
          8,
        );

        expect(
          recovered.counters.usefulUnique,
        ).toBe(
          8,
        );

        expect(
          recovered.counters.transportFailures,
        ).toBe(
          0,
        );

        expect(
          recovered.certified,
        ).toBe(
          true,
        );

        const noLongerNeeded =
          evaluateProviderTaskClassRecovery({
            baseline,

            nowMs:
              100_000,

            requestedProviderCalls:
              1,

            requestedConcurrency:
              1,

            lane:
              recovered,

            recovery:
              recovery(
                ledger,
              ),
          });

        expect(
          noLongerNeeded,
        ).toMatchObject({
          status:
            'HOLD',

          reason:
            'LANE_ALREADY_CERTIFIED',

          phase:
            null,

          requiredProviderCalls:
            0,
        });
      },
    );
  },
);
