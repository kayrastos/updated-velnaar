import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  acceptedWorkAuthorizationRequiresReadiness,
} from '../../../scripts/fulgor/cloud/gcpSignedEvidenceCompletion';

type Authorization =
  Parameters<
    typeof acceptedWorkAuthorizationRequiresReadiness
  >[0];

function base(): Authorization {
  return {
    schemaVersion:
      'VELNAR_ACCEPTED_WORK_AUTHORIZATION_GATE_V1',

    eligibleForHumanGatedPromotion:
      false,

    automaticPromotionAllowed:
      false,

    humanApprovalRequired:
      true,

    executionAuthorityGranted:
      false,

    deploymentAuthorityGranted:
      false,

    code:
      'HUMAN_PROMOTION_GATE_DENIED',

    humanGateCode:
      'EVIDENCE_DECISION_NOT_PASS',

    verifiedEnvelope:
      {},

    verifiedProvenance:
      {},

    sourceBinding:
      {},
  } as unknown as Authorization;
}

describe(
  'accepted-work completion authorization semantics',
  () => {
    it(
      'treats a valid semantic human-gate denial as a normal completed outcome',
      () => {
        expect(
          acceptedWorkAuthorizationRequiresReadiness(
            base(),
          ),
        ).toBe(false);
      },
    );

    it(
      'accepts VERIFIER_NOT_SUPPORTED as a semantic denial without readiness',
      () => {
        expect(
          acceptedWorkAuthorizationRequiresReadiness({
            ...base(),
            humanGateCode:
              'VERIFIER_NOT_SUPPORTED',
          } as never),
        ).toBe(false);
      },
    );

    it(
      'requires readiness only for an eligible human-gated promotion result',
      () => {
        expect(
          acceptedWorkAuthorizationRequiresReadiness({
            ...base(),

            eligibleForHumanGatedPromotion:
              true,

            code:
              'ELIGIBLE_FOR_HUMAN_GATED_PROMOTION',

            humanGateCode:
              'ELIGIBLE_FOR_HUMAN_GATED_PROMOTION',
          } as never),
        ).toBe(true);
      },
    );

    it(
      'fails closed on structural accepted-work authorization denial',
      () => {
        expect(
          () =>
            acceptedWorkAuthorizationRequiresReadiness({
              ...base(),

              code:
                'SIGNED_EVIDENCE_INVALID',

              humanGateCode:
                null,

              verifiedEnvelope:
                null,

              verifiedProvenance:
                null,

              sourceBinding:
                null,
            } as never),
        ).toThrow(
          'ACCEPTED_WORK_AUTHORIZATION_FAILURE',
        );
      },
    );

    it(
      'fails closed when a human-gate denial reports signature invalidity',
      () => {
        expect(
          () =>
            acceptedWorkAuthorizationRequiresReadiness({
              ...base(),

              humanGateCode:
                'SIGNED_EVIDENCE_INVALID',
            } as never),
        ).toThrow(
          'ACCEPTED_WORK_AUTHORIZATION_FAILURE',
        );
      },
    );

    it(
      'fails closed on any authority expansion',
      () => {
        expect(
          () =>
            acceptedWorkAuthorizationRequiresReadiness({
              ...base(),

              executionAuthorityGranted:
                true,
            } as never),
        ).toThrow(
          'ACCEPTED_WORK_AUTHORIZATION_FAILURE',
        );
      },
    );
  },
);
