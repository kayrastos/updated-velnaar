import type {
  D1Database,
} from '@cloudflare/workers-types';

import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  buildFulgorD1ReplayReservationRequest,
  computeFulgorTrainingAuthorizationReplayKey,
  D1TrainingAuthorizationReplayStore,
  FULGOR_TRAINING_REPLAY_AUTHORITY_ID,
} from '../../../../scripts/fulgor/corpus/authorization/d1TrainingAuthorizationReplayStore';

import type {
  TrainingExecutionAuthorization,
} from '../../../../scripts/fulgor/corpus/authorization/trainingExecutionAuthorization';

function authorization(
  payloadSha256 =
    'a'.repeat(64),
): TrainingExecutionAuthorization {
  return {
    schemaVersion:
      'FULGOR_TRAINING_EXECUTION_AUTHORIZATION_V1',

    state:
      'SIGNED_SINGLE_USE_TRAINING_EXECUTION_AUTHORIZATION',

    action:
      'START_CANDIDATE_TRAINING',

    trainingRunId:
      'candidate-run-001',

    humanApproverId:
      'human-approver-1',

    explicitHumanApproval:
      true,

    sourceRegistryPayloadSha256:
      '1'.repeat(64),

    sourceTrainingManifestSha256:
      '2'.repeat(64),

    sourceFinalHoldoutCommitmentSha256:
      '3'.repeat(64),

    nonce:
      'nonce-000000000001',

    issuedAtUtc:
      new Date(
        Date.now() - 60_000,
      ).toISOString(),

    expiresAtUtc:
      new Date(
        Date.now() + 600_000,
      ).toISOString(),

    trainingExecutionAuthorized:
      true,

    promotionAuthorized:
      false,

    deploymentAuthorized:
      false,

    signerKeyId:
      'training-auth-key-1',

    signerPublicKeySha256:
      'b'.repeat(64),

    payloadSha256,

    signatureAlgorithm:
      'Ed25519',

    signatureBase64:
      'offline-test-signature',
  };
}

function mockD1(
  mode:
    | 'RESERVED'
    | 'ALREADY_RESERVED'
    | 'THROW',
): D1Database {
  return {
    prepare() {
      return {
        bind(
          ...params:
            unknown[]
        ) {
          return {
            async all() {
              if (
                mode ===
                  'THROW'
              ) {
                throw new Error(
                  'offline-d1-failure',
                );
              }

              if (
                mode ===
                  'ALREADY_RESERVED'
              ) {
                return {
                  success:
                    true,

                  results: [],

                  meta: {
                    changed_db:
                      false,

                    rows_written:
                      0,
                  },
                };
              }

              return {
                success:
                  true,

                results: [
                  {
                    replay_key:
                      params[0],
                  },
                ],

                meta: {
                  changed_db:
                    true,

                  rows_written:
                    1,
                },
              };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

describe(
  'FULGOR D1 training authorization replay store',
  () => {
    it(
      'builds a deterministic D1-compatible reservation',
      () => {
        const auth =
          authorization();

        const first =
          buildFulgorD1ReplayReservationRequest(
            auth,
          );

        const second =
          buildFulgorD1ReplayReservationRequest(
            auth,
          );

        expect(first)
          .toEqual(second);

        expect(
          first.replayKey,
        ).toMatch(
          /^[0-9a-f]{64}$/,
        );

        expect(
          first.authorizationPayloadDigestSha256,
        ).toBe(
          auth.payloadSha256,
        );

        expect(
          first.authorityId,
        ).toBe(
          FULGOR_TRAINING_REPLAY_AUTHORITY_ID,
        );

        expect(
          first.runNonce,
        ).toBe(
          auth.nonce,
        );

        expect(
          first.keyVersion,
        ).toMatch(
          /^fulgor-[0-9a-f]{32}$/,
        );
      },
    );

    it(
      'changes replay identity when authorization payload identity changes',
      () => {
        const first =
          computeFulgorTrainingAuthorizationReplayKey(
            authorization(
              'a'.repeat(64),
            ),
          );

        const second =
          computeFulgorTrainingAuthorizationReplayKey(
            authorization(
              'c'.repeat(64),
            ),
          );

        expect(first)
          .not.toBe(second);
      },
    );

    it(
      'maps a successful atomic D1 reservation to consumed',
      async () => {
        const store =
          new D1TrainingAuthorizationReplayStore(
            mockD1(
              'RESERVED',
            ),
          );

        await expect(
          store.consumeOnce(
            authorization(),
          ),
        ).resolves.toBe(
          'CONSUMED',
        );
      },
    );

    it(
      'maps an existing replay key to already consumed',
      async () => {
        const store =
          new D1TrainingAuthorizationReplayStore(
            mockD1(
              'ALREADY_RESERVED',
            ),
          );

        await expect(
          store.consumeOnce(
            authorization(),
          ),
        ).resolves.toBe(
          'ALREADY_CONSUMED',
        );
      },
    );

    it(
      'fails closed when D1 outcome is unavailable',
      async () => {
        const store =
          new D1TrainingAuthorizationReplayStore(
            mockD1(
              'THROW',
            ),
          );

        await expect(
          store.consumeOnce(
            authorization(),
          ),
        ).resolves.toBe(
          'BACKEND_UNAVAILABLE',
        );
      },
    );
  },
);
