import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  authorizeQwenQloraLaunch,
  authorizeQwenQloraLaunchWithDependenciesForTesting,
} from '../../../scripts/fulgor/training/qwenQloraAuthorizedLaunchGate';

import type {
  QwenQloraLaunchGateDependencies,
  QwenQloraLaunchGateRequest,
} from '../../../scripts/fulgor/training/qwenQloraAuthorizedLaunchGate';

import type {
  D1TrainingAuthorizationReplayStore,
} from '../../../scripts/fulgor/corpus/authorization/d1TrainingAuthorizationReplayStore';

function requestFixture():
  QwenQloraLaunchGateRequest {
  return {
    binding: {
      bindingPayloadSha256:
        'b'.repeat(64),
    },

    authorization: {
      trainingRunId:
        'run-001',

      payloadSha256:
        'a'.repeat(64),

      expiresAtUtc:
        '2026-09-29T21:00:00Z',

      nonce:
        'secret-nonce-not-for-issuer',

      signatureBase64:
        'secret-signature-not-for-issuer',
    },

    runnerContract: {
      contractSha256:
        'c'.repeat(64),

      model: {
        modelId:
          'Qwen/Qwen3.8-27B',

        modelRevisionSha:
          '1d4bf0f2ff6012fd82039f2fa52739d0dd7c60c0',
      },

      dataBinding: {
        sourceRegistryPayloadSha256:
          '2'.repeat(64),

        sourceTrainingManifestSha256:
          '3'.repeat(64),

        sourceJsonlExportSha256:
          'd'.repeat(64),

        trainJsonlSha256:
          'e'.repeat(64),

        devJsonlSha256:
          'f'.repeat(64),

        sourceFinalHoldoutCommitmentSha256:
          '1'.repeat(64),
      },

      runtime: {
        targetRuntime:
          'GCE_SPOT_SINGLE_L4_24GB',

        expectedGpu:
          'NVIDIA_L4_24GB',

        expectedGpuCount:
          1,
      },
    },

    runnerContractInput: {
      sourceManifest: {},
    },

    registry: {},

    splitBundle: {
      sealedFinalHoldout: {
        recordIds: [
          'FINAL-HOLDOUT-MUST-NOT-LEAK',
        ],
      },
    },
  } as unknown as
    QwenQloraLaunchGateRequest;
}

describe(
  'FULGOR authorized QLoRA launch gate',
  () => {
    it(
      'verifies manifest then binding then consumes nonce then issues capability',
      async () => {
        const order:
          string[] = [];

        let issuedRequest:
          unknown =
            null;

        const result =
          await authorizeQwenQloraLaunchWithDependenciesForTesting(
            requestFixture(),

            {
              verifyMaterialization() {
                order.push(
                  'manifest',
                );

                return true;
              },

              verifyBinding() {
                order.push(
                  'binding',
                );

                return true;
              },

              consumeAuthorization() {
                order.push(
                  'consume',
                );

                return {
                  authorized:
                    true,

                  nonceConsumed:
                    true,

                  failureCodes:
                    [],
                };
              },
            },

            {
              issue(
                request,
              ) {
                order.push(
                  'issue',
                );

                issuedRequest =
                  request;

                return {
                  capability:
                    'opaque-launch-capability',
                };
              },
            },
          );

        expect(order)
          .toEqual([
            'manifest',
            'binding',
            'consume',
            'issue',
          ]);

        expect(
          result.accepted,
        ).toBe(true);

        expect(
          result.launchCapabilityIssued,
        ).toBe(true);

        const serialized =
          JSON.stringify(
            issuedRequest,
          );

        expect(serialized)
          .not.toContain(
            'secret-nonce-not-for-issuer',
          );

        expect(serialized)
          .not.toContain(
            'secret-signature-not-for-issuer',
          );

        expect(serialized)
          .not.toContain(
            'FINAL-HOLDOUT-MUST-NOT-LEAK',
          );
      },
    );

    it(
      'does not consume or issue when manifest verification fails',
      async () => {
        const calls:
          string[] = [];

        const result =
          await authorizeQwenQloraLaunchWithDependenciesForTesting(
            requestFixture(),

            {
              verifyMaterialization() {
                calls.push(
                  'manifest',
                );

                return false;
              },

              verifyBinding() {
                calls.push(
                  'binding',
                );

                return true;
              },

              consumeAuthorization() {
                calls.push(
                  'consume',
                );

                return {
                  authorized:
                    true,

                  nonceConsumed:
                    true,

                  failureCodes:
                    [],
                };
              },
            },

            {
              issue() {
                calls.push(
                  'issue',
                );

                return {};
              },
            },
          );

        expect(
          result.accepted,
        ).toBe(false);

        expect(calls)
          .toEqual([
            'manifest',
          ]);
      },
    );

    it(
      'does not consume or issue when signed binding verification fails',
      async () => {
        const calls:
          string[] = [];

        const result =
          await authorizeQwenQloraLaunchWithDependenciesForTesting(
            requestFixture(),

            {
              verifyMaterialization() {
                calls.push(
                  'manifest',
                );

                return true;
              },

              verifyBinding() {
                calls.push(
                  'binding',
                );

                return false;
              },

              consumeAuthorization() {
                calls.push(
                  'consume',
                );

                return {
                  authorized:
                    true,

                  nonceConsumed:
                    true,

                  failureCodes:
                    [],
                };
              },
            },

            {
              issue() {
                calls.push(
                  'issue',
                );

                return {};
              },
            },
          );

        expect(
          result.accepted,
        ).toBe(false);

        expect(calls)
          .toEqual([
            'manifest',
            'binding',
          ]);
      },
    );

    it(
      'does not issue before successful nonce consumption',
      async () => {
        let issuerCalls =
          0;

        const result =
          await authorizeQwenQloraLaunchWithDependenciesForTesting(
            requestFixture(),

            {
              verifyMaterialization() {
                return true;
              },

              verifyBinding() {
                return true;
              },

              consumeAuthorization() {
                return {
                  authorized:
                    false,

                  nonceConsumed:
                    false,

                  failureCodes: [
                    'REPLAY_DETECTED',
                  ],
                };
              },
            },

            {
              issue() {
                issuerCalls +=
                  1;

                return {};
              },
            },
          );

        expect(
          result.accepted,
        ).toBe(false);

        expect(
          issuerCalls,
        ).toBe(0);
      },
    );

    it(
      'allows exactly one capability for a single-use authorization',
      async () => {
        let consumed =
          false;

        let issuerCalls =
          0;

        const dependencies:
          QwenQloraLaunchGateDependencies = {
          verifyMaterialization() {
            return true;
          },

          verifyBinding() {
            return true;
          },

          consumeAuthorization() {
            if (consumed) {
              return {
                authorized:
                  false,

                nonceConsumed:
                  false,

                failureCodes: [
                  'REPLAY_DETECTED',
                ],
              };
            }

            consumed =
              true;

            return {
              authorized:
                true,

              nonceConsumed:
                true,

              failureCodes:
                [],
            };
          },
        };

        const issuer = {
          issue() {
            issuerCalls +=
              1;

            return {
              capability:
                'opaque',
            };
          },
        };

        const first =
          await authorizeQwenQloraLaunchWithDependenciesForTesting(
            requestFixture(),
            dependencies,
            issuer,
          );

        const second =
          await authorizeQwenQloraLaunchWithDependenciesForTesting(
            requestFixture(),
            dependencies,
            issuer,
          );

        expect(
          first.accepted,
        ).toBe(true);

        expect(
          second.accepted,
        ).toBe(false);

        expect(
          issuerCalls,
        ).toBe(1);
      },
    );

    it(
      'burns consumed authorization if issuer fails',
      async () => {
        let consumed =
          false;

        const dependencies:
          QwenQloraLaunchGateDependencies = {
          verifyMaterialization() {
            return true;
          },

          verifyBinding() {
            return true;
          },

          consumeAuthorization() {
            if (consumed) {
              return {
                authorized:
                  false,

                nonceConsumed:
                  false,

                failureCodes: [
                  'REPLAY_DETECTED',
                ],
              };
            }

            consumed =
              true;

            return {
              authorized:
                true,

              nonceConsumed:
                true,

              failureCodes:
                [],
            };
          },
        };

        const first =
          await authorizeQwenQloraLaunchWithDependenciesForTesting(
            requestFixture(),
            dependencies,
            {
              issue() {
                throw new Error(
                  'simulated issuer failure',
                );
              },
            },
          );

        expect(
          first.failureCodes,
        ).toEqual([
          'LAUNCH_CAPABILITY_ISSUER_FAILED_AFTER_AUTHORIZATION_CONSUMED',
        ]);

        const second =
          await authorizeQwenQloraLaunchWithDependenciesForTesting(
            requestFixture(),
            dependencies,
            {
              issue() {
                return {};
              },
            },
          );

        expect(
          second.accepted,
        ).toBe(false);
      },
    );

    it(
      'keeps production gate closed before D1 or issuer while trust anchor is absent',
      async () => {
        let issuerCalls =
          0;

        const impossibleD1 =
          new Proxy(
            {},
            {
              get() {
                throw new Error(
                  'D1_MUST_NOT_BE_REACHED',
                );
              },
            },
          ) as unknown as
            D1TrainingAuthorizationReplayStore;

        const result =
          await authorizeQwenQloraLaunch(
            requestFixture(),
            impossibleD1,
            {
              issue() {
                issuerCalls +=
                  1;

                return {};
              },
            },
          );

        expect(
          result.accepted,
        ).toBe(false);

        expect(
          result.failureCodes,
        ).toEqual([
          'CORPUS_REGISTRY_TRUST_ANCHOR_NOT_PROVISIONED',
        ]);

        expect(
          issuerCalls,
        ).toBe(0);
      },
    );
  },
);
