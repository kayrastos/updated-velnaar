import type {
  D1Database,
} from '@cloudflare/workers-types';

import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  buildFulgorGceQloraCapabilityReplayReservationRequest,
  computeFulgorGceQloraCapabilityReplayKey,
  D1GceQloraCapabilityReplayStore,
  FULGOR_GCE_QLORA_CAPABILITY_REPLAY_AUTHORITY_ID,
  FULGOR_GCE_QLORA_CAPABILITY_REPLAY_KEY_VERSION,
} from '../../../scripts/fulgor/training/d1GceQloraCapabilityReplayStore';

import type {
  GceQloraCapabilityReplayIdentity,
} from '../../../scripts/fulgor/training/gceQloraExecutorHandoff';

function identity(
  payloadSha256 =
    'a'.repeat(64),
): GceQloraCapabilityReplayIdentity {
  return {
    capabilityId:
      '8'.repeat(64),

    payloadSha256,

    expiresAtUtc:
      new Date(
        Date.now() +
        600_000,
      ).toISOString(),
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
  } as unknown as
    D1Database;
}

describe(
  'FULGOR D1 GCE QLoRA capability replay store',
  () => {
    it(
      'builds a deterministic domain-separated canonical reservation',
      () => {
        const value =
          identity();

        const first =
          computeFulgorGceQloraCapabilityReplayKey(
            value,
          );

        const second =
          computeFulgorGceQloraCapabilityReplayKey(
            value,
          );

        expect(first)
          .toBe(second);

        expect(first)
          .toMatch(
            /^[a-f0-9]{64}$/,
          );

        const request =
          buildFulgorGceQloraCapabilityReplayReservationRequest(
            value,
          );

        expect(request)
          .toEqual({
            ledgerVersion:
              'a12b2c5r-v1',

            replayKey:
              first,

            authorizationPayloadDigestSha256:
              value.payloadSha256,

            authorityId:
              FULGOR_GCE_QLORA_CAPABILITY_REPLAY_AUTHORITY_ID,

            keyVersion:
              FULGOR_GCE_QLORA_CAPABILITY_REPLAY_KEY_VERSION,

            runNonce:
              value.capabilityId,

            expiresAt:
              value.expiresAtUtc,
          });
      },
    );

    it(
      'changes replay identity when signed capability payload changes',
      () => {
        const first =
          computeFulgorGceQloraCapabilityReplayKey(
            identity(
              'a'.repeat(64),
            ),
          );

        const second =
          computeFulgorGceQloraCapabilityReplayKey(
            identity(
              'b'.repeat(64),
            ),
          );

        expect(first)
          .not.toBe(second);
      },
    );

    it(
      'maps one atomic D1 reservation to CONSUMED',
      async () => {
        const store =
          new D1GceQloraCapabilityReplayStore(
            mockD1(
              'RESERVED',
            ),
          );

        await expect(
          store.consumeOnce(
            identity(),
          ),
        ).resolves.toBe(
          'CONSUMED',
        );
      },
    );

    it(
      'maps D1 conflict to ALREADY_CONSUMED',
      async () => {
        const store =
          new D1GceQloraCapabilityReplayStore(
            mockD1(
              'ALREADY_RESERVED',
            ),
          );

        await expect(
          store.consumeOnce(
            identity(),
          ),
        ).resolves.toBe(
          'ALREADY_CONSUMED',
        );
      },
    );

    it(
      'fails closed when durable replay outcome is unavailable',
      async () => {
        const store =
          new D1GceQloraCapabilityReplayStore(
            mockD1(
              'THROW',
            ),
          );

        await expect(
          store.consumeOnce(
            identity(),
          ),
        ).resolves.toBe(
          'BACKEND_UNAVAILABLE',
        );
      },
    );
  },
);