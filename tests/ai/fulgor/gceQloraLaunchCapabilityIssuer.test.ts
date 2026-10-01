import {
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
} from 'node:crypto';

import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  createGceQloraLaunchCapabilityIssuer,
  verifyGceQloraLaunchCapabilityForTesting,
} from '../../../scripts/fulgor/training/gceQloraLaunchCapabilityIssuer';

import type {
  GceQloraLaunchCapability,
} from '../../../scripts/fulgor/training/gceQloraLaunchCapabilityIssuer';

import type {
  QwenQloraLaunchCapabilityIssueRequest,
} from '../../../scripts/fulgor/training/qwenQloraAuthorizedLaunchGate';

function issueRequest():
  QwenQloraLaunchCapabilityIssueRequest {
  return {
    schemaVersion:
      'FULGOR_QWEN_QLORA_LAUNCH_CAPABILITY_REQUEST_V1',

    trainingRunId:
      'candidate-run-001',

    authorizationPayloadSha256:
      'a'.repeat(64),

    executionBindingPayloadSha256:
      'b'.repeat(64),

    runnerContractSha256:
      'c'.repeat(64),

    sourceRegistryPayloadSha256:
      '2'.repeat(64),

    sourceTrainingManifestSha256:
      '3'.repeat(64),

    modelId:
      'Qwen/Qwen3.8-27B',

    modelRevisionSha:
      '1d4bf0f2ff6012fd82039f2fa52739d0dd7c60c0',

    sourceJsonlExportSha256:
      'd'.repeat(64),

    trainJsonlSha256:
      'e'.repeat(64),

    devJsonlSha256:
      'f'.repeat(64),

    sourceFinalHoldoutCommitmentSha256:
      '1'.repeat(64),

    authorizationExpiresAtUtc:
      '2026-09-29T20:04:00Z',

    targetRuntime:
      'GCE_SPOT_SINGLE_L4_24GB',

    expectedGpu:
      'NVIDIA_L4_24GB',

    expectedGpuCount:
      1,

    authorizationConsumed:
      true,

    finalHoldoutRecordIdsExposed:
      false,

    promotionAuthorized:
      false,

    deploymentAuthorized:
      false,

    requestSha256:
      '4'.repeat(64),
  };
}

function fixture() {
  const keys =
    generateKeyPairSync(
      'ed25519',
    );

  const signer = {
    algorithm:
      'Ed25519' as const,

    keyId:
      'fulgor-gce-launch-capability-v1',

    async sign(
      payload:
        Uint8Array,
    ) {
      return new Uint8Array(
        cryptoSign(
          null,
          payload,
          keys.privateKey,
        ),
      );
    },
  };

  const verifier = {
    algorithm:
      'Ed25519' as const,

    keyId:
      signer.keyId,

    async verify(
      payload:
        Uint8Array,

      signature:
        Uint8Array,
    ) {
      return cryptoVerify(
        null,
        payload,
        keys.publicKey,
        signature,
      );
    },
  };

  const issuer =
    createGceQloraLaunchCapabilityIssuer({
      projectId:
        'velnar-fulgor',

      zone:
        'europe-west4-b',

      runtimeServiceAccount:
        'fulgor-training@velnar-fulgor.iam.gserviceaccount.com',

      containerImageDigest:
        'europe-west4-docker.pkg.dev/' +
        'velnar-fulgor/fulgor/qwen-qlora@sha256:' +
        '9'.repeat(64),

      maxTtlSeconds:
        600,

      signer,

      clock:
        () =>
          '2026-09-29T20:00:00Z',

      capabilityIdFactory:
        () =>
          '8'.repeat(64),
    });

  return {
    signer,
    verifier,
    issuer,
  };
}

describe(
  'FULGOR GCE QLoRA launch capability issuer',
  () => {
    it(
      'issues a signed one-launch Spot L4 capability bound to the complete training identity',
      async () => {
        const data =
          fixture();

        const capability =
          await data.issuer.issue(
            issueRequest(),
          );

        expect(
          capability.capabilityId,
        ).toBe(
          '8'.repeat(64),
        );

        expect(
          capability.maxLaunchCount,
        ).toBe(1);

        expect(
          capability.expiresAtUtc,
        ).toBe(
          '2026-09-29T20:04:00.000Z',
        );

        expect(
          capability.launch,
        ).toMatchObject({
          projectId:
            'velnar-fulgor',

          zone:
            'europe-west4-b',

          machineType:
            'g2-standard-16',

          provisioningModel:
            'SPOT',

          expectedGpu:
            'NVIDIA_L4_24GB',

          expectedGpuCount:
            1,

          modelId:
            'Qwen/Qwen3.8-27B',

          sourceRegistryPayloadSha256:
            '2'.repeat(64),

          sourceTrainingManifestSha256:
            '3'.repeat(64),
        });

        await expect(
          verifyGceQloraLaunchCapabilityForTesting(
            capability,
            data.verifier,
            '2026-09-29T20:03:59Z',
          ),
        ).resolves.toBe(true);
      },
    );

    it(
      'rejects capability tampering',
      async () => {
        const data =
          fixture();

        const capability =
          await data.issuer.issue(
            issueRequest(),
          );

        const tampered =
          structuredClone(
            capability,
          ) as GceQloraLaunchCapability;

        (
          tampered.launch as {
            modelRevisionSha:
              string;
          }
        ).modelRevisionSha =
          'f'.repeat(40);

        await expect(
          verifyGceQloraLaunchCapabilityForTesting(
            tampered,
            data.verifier,
            '2026-09-29T20:01:00Z',
          ),
        ).resolves.toBe(false);
      },
    );

    it(
      'rejects an expired capability',
      async () => {
        const data =
          fixture();

        const capability =
          await data.issuer.issue(
            issueRequest(),
          );

        await expect(
          verifyGceQloraLaunchCapabilityForTesting(
            capability,
            data.verifier,
            '2026-09-29T20:04:00.000Z',
          ),
        ).resolves.toBe(false);
      },
    );

    it(
      'rejects floating container tags',
      () => {
        const data =
          fixture();

        expect(
          () =>
            createGceQloraLaunchCapabilityIssuer({
              projectId:
                'velnar-fulgor',

              zone:
                'europe-west4-b',

              runtimeServiceAccount:
                'fulgor-training@velnar-fulgor.iam.gserviceaccount.com',

              containerImageDigest:
                'europe-west4-docker.pkg.dev/' +
                'velnar-fulgor/fulgor/qwen-qlora:latest',

              maxTtlSeconds:
                300,

              signer:
                data.signer,
            }),
        ).toThrow(
          'INVALID_CONTAINER_IMAGE_DIGEST',
        );
      },
    );

    it(
      'rejects issue after authorization expiry',
      async () => {
        const data =
          fixture();

        const issuer =
          createGceQloraLaunchCapabilityIssuer({
            projectId:
              'velnar-fulgor',

            zone:
              'europe-west4-b',

            runtimeServiceAccount:
              'fulgor-training@velnar-fulgor.iam.gserviceaccount.com',

            containerImageDigest:
              'europe-west4-docker.pkg.dev/' +
              'velnar-fulgor/fulgor/qwen-qlora@sha256:' +
              '9'.repeat(64),

            maxTtlSeconds:
              300,

            signer:
              data.signer,

            clock:
              () =>
                '2026-09-29T20:05:00Z',
          });

        await expect(
          issuer.issue(
            issueRequest(),
          ),
        ).rejects.toMatchObject({
          code:
            'AUTHORIZATION_ALREADY_EXPIRED',
        });
      },
    );

    it(
      'rejects a non-authorized launch request',
      async () => {
        const data =
          fixture();

        const request =
          issueRequest();

        (
          request as {
            authorizationConsumed:
              boolean;
          }
        ).authorizationConsumed =
          false;

        await expect(
          data.issuer.issue(
            request,
          ),
        ).rejects.toMatchObject({
          code:
            'INVALID_ISSUE_REQUEST',
        });
      },
    );
  },
);
