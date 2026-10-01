import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  computeGceQloraExecutorRequestSha256,
  preflightGceQloraContainerRuntime,
} from '../../../scripts/fulgor/training/gceQloraContainerRuntimePreflight';

import type {
  GceQloraExecutorHandoffResult,
} from '../../../scripts/fulgor/training/gceQloraExecutorHandoff';

function request():
  Record<string, unknown> {
  return {
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

      outputDir:
        '/mnt/fulgor/output/candidate-001',
    },

    data: {
      trainJsonlPath:
        '/mnt/fulgor/data/train.jsonl',

      trainJsonlSha256:
        'e'.repeat(64),

      trainExampleCount:
        10,

      devJsonlPath:
        '/mnt/fulgor/data/dev.jsonl',

      devJsonlSha256:
        'f'.repeat(64),

      devExampleCount:
        3,

      sourceFinalHoldoutCommitmentSha256:
        '1'.repeat(64),
    },
  };
}

function handoff(
  executorRequest =
    request(),
): GceQloraExecutorHandoffResult {
  return {
    schemaVersion:
      'FULGOR_GCE_QLORA_EXECUTOR_HANDOFF_V1',

    accepted:
      true,

    capabilityVerified:
      true,

    capabilityConsumed:
      true,

    executorPreflightReady:
      true,

    trainingExecutionAuthorized:
      false,

    executorRequest,

    executorRequestSha256:
      computeGceQloraExecutorRequestSha256(
        executorRequest,
      ),

    containerImageDigest:
      'europe-west4-docker.pkg.dev/' +
      'velnar-fulgor/fulgor/qwen-qlora@sha256:' +
      '9'.repeat(64),

    failureCodes: [],

    cloudProvisioningPerformed:
      false,

    trainingStarted:
      false,

    promotionPerformed:
      false,

    deploymentPerformed:
      false,
  };
}

describe(
  'FULGOR immutable QLoRA container runtime preflight',
  () => {
    it(
      'binds an immutable image digest and exact executor request without authorizing execution',
      () => {
        const result =
          preflightGceQloraContainerRuntime(
            handoff(),
          );

        expect(
          result.accepted,
        ).toBe(true);

        expect(
          result.immutableImageBound,
        ).toBe(true);

        expect(
          result.executorRequestIntegrityVerified,
        ).toBe(true);

        expect(
          result.containerPulled,
        ).toBe(false);

        expect(
          result.containerStarted,
        ).toBe(false);

        expect(
          result.modelDownloadStarted,
        ).toBe(false);

        expect(
          result.cloudProvisioningPerformed,
        ).toBe(false);

        expect(
          result.trainingStarted,
        ).toBe(false);

        expect(
          result.runtimeSpec,
        ).toMatchObject({
          imageReferencePolicy:
            'IMMUTABLE_DIGEST_ONLY',

          networkPackageInstallAllowed:
            false,

          floatingImageReferenceAllowed:
            false,

          modelDownloadAuthorized:
            false,

          containerStartAuthorized:
            false,

          cloudProvisioningAuthorized:
            false,

          trainingExecutionAuthorized:
            false,

          promotionAuthorized:
            false,

          deploymentAuthorized:
            false,
        });

        expect(
          result.runtimeSpec
            ?.runtimeSpecSha256,
        ).toMatch(
          /^[a-f0-9]{64}$/,
        );
      },
    );

    it(
      'is deterministic for the same immutable handoff',
      () => {
        const input =
          handoff();

        const first =
          preflightGceQloraContainerRuntime(
            input,
          );

        const second =
          preflightGceQloraContainerRuntime(
            input,
          );

        expect(
          first.runtimeSpec
            ?.runtimeSpecSha256,
        ).toBe(
          second.runtimeSpec
            ?.runtimeSpecSha256,
        );
      },
    );

    it(
      'rejects a floating image reference',
      () => {
        const input =
          handoff();

        (
          input as {
            containerImageDigest:
              string;
          }
        ).containerImageDigest =
          'europe-west4-docker.pkg.dev/' +
          'velnar-fulgor/fulgor/qwen-qlora:latest';

        const result =
          preflightGceQloraContainerRuntime(
            input,
          );

        expect(
          result.accepted,
        ).toBe(false);

        expect(
          result.failureCodes,
        ).toEqual([
          'INVALID_CONTAINER_IMAGE_DIGEST',
        ]);
      },
    );

    it(
      'rejects executor request mutation after handoff digest binding',
      () => {
        const input =
          handoff();

        const mutable =
          input.executorRequest as
            Record<string, unknown>;

        const output =
          mutable.output as
            Record<string, unknown>;

        output.pushToHub =
          true;

        const result =
          preflightGceQloraContainerRuntime(
            input,
          );

        expect(
          result.accepted,
        ).toBe(false);

        expect(
          result.failureCodes,
        ).toEqual([
          'EXECUTOR_REQUEST_DIGEST_MISMATCH',
        ]);
      },
    );

    it(
      'rejects authority escalation even when caller recomputes the request digest',
      () => {
        const executorRequest =
          request();

        executorRequest[
          'trainingExecutionAuthorized'
        ] = true;

        const input =
          handoff(
            executorRequest,
          );

        const result =
          preflightGceQloraContainerRuntime(
            input,
          );

        expect(
          result.accepted,
        ).toBe(false);

        expect(
          result.failureCodes,
        ).toEqual([
          'EXECUTOR_REQUEST_AUTHORITY_ESCALATION',
        ]);
      },
    );

    it(
      'rejects a handoff whose capability was not consumed',
      () => {
        const input =
          handoff();

        (
          input as {
            capabilityConsumed:
              boolean;
          }
        ).capabilityConsumed =
          false;

        const result =
          preflightGceQloraContainerRuntime(
            input,
          );

        expect(
          result.accepted,
        ).toBe(false);

        expect(
          result.failureCodes,
        ).toEqual([
          'HANDOFF_AUTHORITY_STATE_INVALID',
        ]);
      },
    );
  },
);