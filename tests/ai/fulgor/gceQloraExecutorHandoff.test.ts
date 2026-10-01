import {
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
} from 'node:crypto';

import {
  resolve,
} from 'node:path';

import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  createGceQloraLaunchCapabilityIssuer,
  verifyGceQloraLaunchCapability,
} from '../../../scripts/fulgor/training/gceQloraLaunchCapabilityIssuer';

import type {
  GceQloraLaunchCapability,
} from '../../../scripts/fulgor/training/gceQloraLaunchCapabilityIssuer';

import {
  prepareGceQloraExecutorHandoff,
  prepareGceQloraExecutorHandoffWithDependenciesForTesting,
} from '../../../scripts/fulgor/training/gceQloraExecutorHandoff';

import type {
  GceQloraCapabilityReplayIdentity,
  GceQloraCapabilityReplayStore,
  GceQloraExecutorHandoffDependencies,
  GceQloraExecutorHandoffInput,
} from '../../../scripts/fulgor/training/gceQloraExecutorHandoff';

import type {
  QwenQloraRunnerContract,
  QwenQloraRunnerContractInput,
} from '../../../scripts/fulgor/training/qwenQloraRunnerContract';

function issueRequest() {
  return {
    schemaVersion:
      'FULGOR_QWEN_QLORA_LAUNCH_CAPABILITY_REQUEST_V1' as const,

    trainingRunId:
      'handoff-run-001',

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
      '2026-10-01T12:10:00Z',

    targetRuntime:
      'GCE_SPOT_SINGLE_L4_24GB' as const,

    expectedGpu:
      'NVIDIA_L4_24GB' as const,

    expectedGpuCount:
      1 as const,

    authorizationConsumed:
      true as const,

    finalHoldoutRecordIdsExposed:
      false as const,

    promotionAuthorized:
      false as const,

    deploymentAuthorized:
      false as const,

    requestSha256:
      '4'.repeat(64),
  };
}

function runnerContract():
  QwenQloraRunnerContract {
  return {
    schemaVersion:
      'FULGOR_QWEN_QLORA_RUNNER_CONTRACT_V1',

    state:
      'SEALED_QLORA_PLAN_REQUIRES_SINGLE_USE_TRAINING_AUTHORIZATION',

    model: {
      modelId:
        'Qwen/Qwen3.8-27B',

      modelRevisionSha:
        '1d4bf0f2ff6012fd82039f2fa52739d0dd7c60c0',

      sourceFormat:
        'HF_SAFETENSORS',

      requireSafeTensors:
        true,

      trustRemoteCode:
        false,

      ggufInputAllowed:
        false,
    },

    runtime: {
      implementation:
        'TRANSFORMERS_PEFT_BITSANDBYTES',

      targetRuntime:
        'GCE_SPOT_SINGLE_L4_24GB',

      expectedGpu:
        'NVIDIA_L4_24GB',

      expectedGpuCount:
        1,

      minimumCudaComputeCapability:
        '8.9',

      worldSize:
        1,

      finalHoldoutAccessible:
        false,
    },

    quantization: {
      loadIn4Bit:
        true,

      quantType:
        'NF4',

      computeDtype:
        'BFLOAT16',

      useDoubleQuant:
        true,

      threeBitAllowed:
        false,
    },

    lora: {
      rank:
        32,

      alpha:
        64,

      dropout:
        0.05,

      bias:
        'none',

      taskType:
        'CAUSAL_LM',

      targetScope:
        'TEXT_LANGUAGE_MODEL_ONLY',

      textModelPrefix:
        'model.language_model.layers.',

      expectedTextLayerCount:
        64,

      expectedFullAttentionLayerCount:
        16,

      expectedLinearAttentionLayerCount:
        48,

      fullAttentionTargetModules: [
        'q_proj',
        'k_proj',
        'v_proj',
        'o_proj',
      ],

      linearAttentionTargetModules: [
        'in_proj_qkv',
        'in_proj_a',
        'in_proj_b',
        'in_proj_z',
        'out_proj',
      ],

      mlpTargetModules: [
        'gate_proj',
        'up_proj',
        'down_proj',
      ],

      requireExactTargetResolution:
        true,

      visionModulesAllowed:
        false,
    },

    training: {
      maxSequenceLength:
        1536,

      perDeviceTrainBatchSize:
        1,

      perDeviceEvalBatchSize:
        1,

      gradientAccumulationSteps:
        16,

      numTrainEpochs:
        1,

      learningRate:
        0.0002,

      warmupRatio:
        0.03,

      maxGradNorm:
        1,

      optimizer:
        'PAGED_ADAMW_8BIT',

      scheduler:
        'COSINE',

      gradientCheckpointing:
        true,

      useCache:
        false,

      packing:
        false,

      seed:
        3407,
    },

    output: {
      outputKind:
        'PEFT_ADAPTER_ONLY',

      mergeAdapterIntoBase:
        false,

      pushToHub:
        false,
    },

    dataBinding: {
      sourceJsonlExportSha256:
        'd'.repeat(64),

      sourceMaterializationManifestSha256:
        '5'.repeat(64),

      sourceRegistryPayloadSha256:
        '2'.repeat(64),

      sourceTrainingManifestSha256:
        '3'.repeat(64),

      sourceFinalHoldoutCommitmentSha256:
        '1'.repeat(64),

      trainJsonlSha256:
        'e'.repeat(64),

      devJsonlSha256:
        'f'.repeat(64),

      trainExampleCount:
        10,

      devExampleCount:
        3,
    },

    execution: {
      trainingAuthorizationRequired:
        true,

      singleUseAuthorizationRequired:
        true,

      replayProtectionRequired:
        true,

      cloudProvisioningAuthorized:
        false,

      trainingExecutionAuthorized:
        false,

      promotionAuthorized:
        false,

      deploymentAuthorized:
        false,
    },

    contractSha256:
      'c'.repeat(64),
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
      'fulgor-handoff-test-v1',

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

      clock() {
        return '2026-10-01T12:00:00Z';
      },

      capabilityIdFactory() {
        return '8'.repeat(64);
      },
    });

  const consumed =
    new Set<string>();

  let consumeCalls =
    0;

  const replayStore:
    GceQloraCapabilityReplayStore = {
      consumeOnce(
        identity:
          Readonly<GceQloraCapabilityReplayIdentity>,
      ) {
        consumeCalls +=
          1;

        const key =
          identity.capabilityId +
          ':' +
          identity.payloadSha256;

        if (consumed.has(key)) {
          return 'ALREADY_CONSUMED';
        }

        consumed.add(key);

        return 'CONSUMED';
      },
    };

  return {
    verifier,
    issuer,
    replayStore,

    getConsumeCalls() {
      return consumeCalls;
    },
  };
}

async function inputFixture(
  capability:
    GceQloraLaunchCapability,
): Promise<GceQloraExecutorHandoffInput> {
  return {
    capability,

    runnerContract:
      runnerContract(),

    runnerContractInput:
      {} as unknown as
        QwenQloraRunnerContractInput,

    trainJsonlPath:
      resolve(
        'tmp',
        'fulgor',
        'train.jsonl',
      ),

    devJsonlPath:
      resolve(
        'tmp',
        'fulgor',
        'dev.jsonl',
      ),

    outputDir:
      resolve(
        'tmp',
        'fulgor',
        'adapter-output',
      ),
  };
}

function dependencies(
  data:
    ReturnType<typeof fixture>,
): GceQloraExecutorHandoffDependencies {
  return {
    verifyCapability(
      capability,
      nowUtc,
    ) {
      return verifyGceQloraLaunchCapability(
        capability,
        data.verifier,
        nowUtc,
      );
    },

    verifyRunnerContract() {
      return true;
    },

    consumeCapability(
      identity,
    ) {
      return data
        .replayStore
        .consumeOnce(
          identity,
        );
    },

    clock() {
      return '2026-10-01T12:01:00Z';
    },
  };
}

describe(
  'FULGOR signed GCE QLoRA executor handoff',
  () => {
    it(
      'verifies signed capability, consumes it once, and emits only a preflight executor request',
      async () => {
        const data =
          fixture();

        const capability =
          await data.issuer.issue(
            issueRequest(),
          );

        const result =
          await prepareGceQloraExecutorHandoffWithDependenciesForTesting(
            await inputFixture(
              capability,
            ),
            dependencies(
              data,
            ),
          );

        expect(
          result.accepted,
        ).toBe(true);

        expect(
          result.capabilityVerified,
        ).toBe(true);

        expect(
          result.capabilityConsumed,
        ).toBe(true);

        expect(
          result.executorPreflightReady,
        ).toBe(true);

        expect(
          result.trainingExecutionAuthorized,
        ).toBe(false);

        expect(
          result.cloudProvisioningPerformed,
        ).toBe(false);

        expect(
          result.trainingStarted,
        ).toBe(false);

        expect(
          result.executorRequestSha256,
        ).toMatch(
          /^[a-f0-9]{64}$/,
        );

        expect(
          result.executorRequest,
        ).toMatchObject({
          schemaVersion:
            'FULGOR_QWEN_QLORA_EXECUTOR_REQUEST_V1',

          executionIntent:
            'PREFLIGHT_ONLY',

          runnerContractSha256:
            'c'.repeat(64),

          model: {
            modelId:
              'Qwen/Qwen3.8-27B',

            modelRevisionSha:
              '1d4bf0f2ff6012fd82039f2fa52739d0dd7c60c0',

            architecture:
              'Qwen3_5ForConditionalGeneration',

            modelType:
              'qwen3_5',

            trustRemoteCode:
              false,

            ggufInputAllowed:
              false,
          },

          runtime: {
            expectedGpu:
              'NVIDIA_L4_24GB',

            expectedGpuCount:
              1,

            finalHoldoutAccessible:
              false,
          },

          output: {
            outputKind:
              'PEFT_ADAPTER_ONLY',

            mergeAdapterIntoBase:
              false,

            pushToHub:
              false,
          },

          data: {
            trainJsonlSha256:
              'e'.repeat(64),

            devJsonlSha256:
              'f'.repeat(64),

            trainExampleCount:
              10,

            devExampleCount:
              3,

            sourceFinalHoldoutCommitmentSha256:
              '1'.repeat(64),
          },
        });

        expect(
          JSON.stringify(
            result.executorRequest,
          ),
        ).not.toContain(
          'finalHoldoutPath',
        );

        expect(
          data.getConsumeCalls(),
        ).toBe(1);
      },
    );

    it(
      'rejects a tampered signed capability before replay consumption',
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
          ) as
            GceQloraLaunchCapability;

        (
          tampered.launch as {
            modelRevisionSha:
              string;
          }
        ).modelRevisionSha =
          'f'.repeat(40);

        const result =
          await prepareGceQloraExecutorHandoffWithDependenciesForTesting(
            await inputFixture(
              tampered,
            ),
            dependencies(
              data,
            ),
          );

        expect(
          result.accepted,
        ).toBe(false);

        expect(
          result.failureCodes,
        ).toEqual([
          'LAUNCH_CAPABILITY_REJECTED',
        ]);

        expect(
          data.getConsumeCalls(),
        ).toBe(0);
      },
    );

    it(
      'rejects a verified capability whose identity does not match the runner contract',
      async () => {
        const data =
          fixture();

        const capability =
          await data.issuer.issue(
            issueRequest(),
          );

        const input =
          await inputFixture(
            capability,
          );

        (
          input.runnerContract
            .dataBinding as {
              trainJsonlSha256:
                string;
            }
        ).trainJsonlSha256 =
          '7'.repeat(64);

        const result =
          await prepareGceQloraExecutorHandoffWithDependenciesForTesting(
            input,
            dependencies(
              data,
            ),
          );

        expect(
          result.accepted,
        ).toBe(false);

        expect(
          result.failureCodes,
        ).toEqual([
          'LAUNCH_CAPABILITY_CONTRACT_MISMATCH',
        ]);

        expect(
          result.capabilityVerified,
        ).toBe(true);

        expect(
          data.getConsumeCalls(),
        ).toBe(0);
      },
    );

    it(
      'allows only one handoff for one launch capability',
      async () => {
        const data =
          fixture();

        const capability =
          await data.issuer.issue(
            issueRequest(),
          );

        const input =
          await inputFixture(
            capability,
          );

        const first =
          await prepareGceQloraExecutorHandoffWithDependenciesForTesting(
            input,
            dependencies(
              data,
            ),
          );

        const second =
          await prepareGceQloraExecutorHandoffWithDependenciesForTesting(
            input,
            dependencies(
              data,
            ),
          );

        expect(
          first.accepted,
        ).toBe(true);

        expect(
          second.accepted,
        ).toBe(false);

        expect(
          second.failureCodes,
        ).toEqual([
          'LAUNCH_CAPABILITY_REPLAYED',
        ]);

        expect(
          data.getConsumeCalls(),
        ).toBe(2);
      },
    );

    it(
      'fails closed in production before touching replay storage while launch trust anchor is unprovisioned',
      async () => {
        const data =
          fixture();

        const capability =
          await data.issuer.issue(
            issueRequest(),
          );

        const result =
          await prepareGceQloraExecutorHandoff(
            await inputFixture(
              capability,
            ),
            data.replayStore,
          );

        expect(
          result.accepted,
        ).toBe(false);

        expect(
          result.failureCodes,
        ).toEqual([
          'LAUNCH_TRUST_ANCHOR_NOT_PROVISIONED',
        ]);

        expect(
          result.capabilityConsumed,
        ).toBe(false);

        expect(
          result.trainingExecutionAuthorized,
        ).toBe(false);

        expect(
          result.cloudProvisioningPerformed,
        ).toBe(false);

        expect(
          result.trainingStarted,
        ).toBe(false);

        expect(
          data.getConsumeCalls(),
        ).toBe(0);
      },
    );
  },
);