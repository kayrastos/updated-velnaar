import {
  createHash,
} from 'node:crypto';

import {
  FULGOR_QWEN_QLORA_MODEL_ID,
  FULGOR_QWEN_QLORA_MODEL_REVISION_SHA,
} from './qwenQloraModelPin';
import {
  verifyTrainingJsonlExport,
} from './trainingJsonlExport';

import type {
  FulgorTrainingJsonlExport,
} from './trainingJsonlExport';

import type {
  FulgorTrainingMaterializationManifest,
} from './trainingMaterializationManifest';

export const FULGOR_QWEN_QLORA_RUNNER_CONTRACT_VERSION =
  'FULGOR_QWEN_QLORA_RUNNER_CONTRACT_V1' as const;

export {
  FULGOR_QWEN_QLORA_MODEL_ID,
  FULGOR_QWEN_QLORA_MODEL_REVISION_SHA,
};

export interface QwenQloraRunnerContractInput {
  trainingExport:
    FulgorTrainingJsonlExport;

  sourceManifest:
    FulgorTrainingMaterializationManifest;

  baseModelRevisionSha:
    string;
}

export interface QwenQloraRunnerContract {
  schemaVersion:
    typeof FULGOR_QWEN_QLORA_RUNNER_CONTRACT_VERSION;

  state:
    'SEALED_QLORA_PLAN_REQUIRES_SINGLE_USE_TRAINING_AUTHORIZATION';

  model: {
    modelId:
      typeof FULGOR_QWEN_QLORA_MODEL_ID;

    modelRevisionSha:
      string;

    sourceFormat:
      'HF_SAFETENSORS';

    requireSafeTensors:
      true;

    trustRemoteCode:
      false;

    ggufInputAllowed:
      false;
  };

  runtime: {
    implementation:
      'TRANSFORMERS_PEFT_BITSANDBYTES';

    targetRuntime:
      'GCE_SPOT_SINGLE_L4_24GB';

    expectedGpu:
      'NVIDIA_L4_24GB';

    expectedGpuCount:
      1;

    minimumCudaComputeCapability:
      '8.9';

    worldSize:
      1;

    finalHoldoutAccessible:
      false;
  };

  quantization: {
    loadIn4Bit:
      true;

    quantType:
      'NF4';

    computeDtype:
      'BFLOAT16';

    useDoubleQuant:
      true;

    threeBitAllowed:
      false;
  };

  lora: {
    rank:
      32;

    alpha:
      64;

    dropout:
      0.05;

    bias:
      'none';

    taskType:
      'CAUSAL_LM';

    targetScope:
      'TEXT_LANGUAGE_MODEL_ONLY';

    textModelPrefix:
      'model.language_model.layers.';

    expectedTextLayerCount:
      64;

    expectedFullAttentionLayerCount:
      16;

    expectedLinearAttentionLayerCount:
      48;

    fullAttentionTargetModules:
      readonly [
        'q_proj',
        'k_proj',
        'v_proj',
        'o_proj',
      ];

    linearAttentionTargetModules:
      readonly [
        'in_proj_qkv',
        'in_proj_a',
        'in_proj_b',
        'in_proj_z',
        'out_proj',
      ];

    mlpTargetModules:
      readonly [
        'gate_proj',
        'up_proj',
        'down_proj',
      ];

    requireExactTargetResolution:
      true;

    visionModulesAllowed:
      false;
  };

  training: {
    maxSequenceLength:
      1536;

    perDeviceTrainBatchSize:
      1;

    perDeviceEvalBatchSize:
      1;

    gradientAccumulationSteps:
      16;

    numTrainEpochs:
      1;

    learningRate:
      0.0002;

    warmupRatio:
      0.03;

    maxGradNorm:
      1;

    optimizer:
      'PAGED_ADAMW_8BIT';

    scheduler:
      'COSINE';

    gradientCheckpointing:
      true;

    useCache:
      false;

    packing:
      false;

    seed:
      3407;
  };

  output: {
    outputKind:
      'PEFT_ADAPTER_ONLY';

    mergeAdapterIntoBase:
      false;

    pushToHub:
      false;
  };

  dataBinding: {
    sourceJsonlExportSha256:
      string;

    sourceMaterializationManifestSha256:
      string;

    sourceRegistryPayloadSha256:
      string;

    sourceTrainingManifestSha256:
      string;

    sourceFinalHoldoutCommitmentSha256:
      string;

    trainJsonlSha256:
      string;

    devJsonlSha256:
      string;

    trainExampleCount:
      number;

    devExampleCount:
      number;
  };

  execution: {
    trainingAuthorizationRequired:
      true;

    singleUseAuthorizationRequired:
      true;

    replayProtectionRequired:
      true;

    cloudProvisioningAuthorized:
      false;

    trainingExecutionAuthorized:
      false;

    promotionAuthorized:
      false;

    deploymentAuthorized:
      false;
  };

  contractSha256:
    string;
}

const SHA256 =
  /^[a-f0-9]{64}$/;

const GIT_SHA40 =
  /^[a-f0-9]{40}$/;

function normalize(
  value: unknown,
): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(
        'QLORA_CONTRACT_NON_CANONICAL_NUMBER',
      );
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.map(
      normalize,
    );
  }

  if (
    typeof value === 'object'
  ) {
    const source =
      value as Record<string, unknown>;

    const target:
      Record<string, unknown> = {};

    for (
      const key of
      Object.keys(source).sort()
    ) {
      const item =
        source[key];

      if (item === undefined) {
        throw new Error(
          'QLORA_CONTRACT_NON_CANONICAL_UNDEFINED',
        );
      }

      target[key] =
        normalize(item);
    }

    return target;
  }

  throw new Error(
    'QLORA_CONTRACT_NON_CANONICAL_VALUE',
  );
}

function digest(
  value: unknown,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        normalize(value),
      ),
      'utf8',
    )
    .digest('hex');
}

function deepFreeze<T>(
  value: T,
): T {
  if (
    value !== null &&
    typeof value === 'object'
  ) {
    for (
      const child of
      Object.values(
        value as Record<string, unknown>,
      )
    ) {
      deepFreeze(child);
    }

    Object.freeze(value);
  }

  return value;
}

function assertTrainingExport(
  trainingExport:
    FulgorTrainingJsonlExport,

  sourceManifest:
    FulgorTrainingMaterializationManifest,
): void {
  if (
    trainingExport.schemaVersion !==
      'FULGOR_TRAINING_JSONL_EXPORT_V1' ||
    trainingExport.state !==
      'DETERMINISTIC_TRAINING_JSONL_REQUIRES_EXECUTION_AUTHORIZATION' ||
    !SHA256.test(
      trainingExport.exportSha256,
    ) ||
    trainingExport.train.exampleCount < 1 ||
    trainingExport.dev.exampleCount < 1 ||
    trainingExport
      .finalHoldoutRecordIdsExposed !==
      false ||
    trainingExport
      .trainingExecutionAuthorized !==
      false ||
    trainingExport
      .promotionAuthorized !==
      false ||
    trainingExport
      .deploymentAuthorized !==
      false
  ) {
    throw new Error(
      'INVALID_QLORA_TRAINING_EXPORT',
    );
  }

  const verification =
    verifyTrainingJsonlExport(
      trainingExport,
      sourceManifest,
    );

  if (!verification.accepted) {
    throw new Error(
      [
        'QLORA_TRAINING_EXPORT_REJECTED',
        ...verification.failureCodes,
      ].join(':'),
    );
  }
}

function assertModelRevision(
  revision:
    string,
): void {
  if (
    !GIT_SHA40.test(
      revision,
    ) ||
    /^0{40}$/.test(
      revision,
    ) ||
    revision !==
      FULGOR_QWEN_QLORA_MODEL_REVISION_SHA
  ) {
    throw new Error(
      'INVALID_BASE_MODEL_REVISION_SHA',
    );
  }
}

export function createQwenQloraRunnerContract(
  input:
    QwenQloraRunnerContractInput,
): QwenQloraRunnerContract {
  assertTrainingExport(
    input.trainingExport,
    input.sourceManifest,
  );

  assertModelRevision(
    input.baseModelRevisionSha,
  );

  const core = {
    schemaVersion:
      FULGOR_QWEN_QLORA_RUNNER_CONTRACT_VERSION,

    state:
      'SEALED_QLORA_PLAN_REQUIRES_SINGLE_USE_TRAINING_AUTHORIZATION' as const,

    model: {
      modelId:
        FULGOR_QWEN_QLORA_MODEL_ID,

      modelRevisionSha:
        input.baseModelRevisionSha,

      sourceFormat:
        'HF_SAFETENSORS' as const,

      requireSafeTensors:
        true as const,

      trustRemoteCode:
        false as const,

      ggufInputAllowed:
        false as const,
    },

    runtime: {
      implementation:
        'TRANSFORMERS_PEFT_BITSANDBYTES' as const,

      targetRuntime:
        'GCE_SPOT_SINGLE_L4_24GB' as const,

      expectedGpu:
        'NVIDIA_L4_24GB' as const,

      expectedGpuCount:
        1 as const,

      minimumCudaComputeCapability:
        '8.9' as const,

      worldSize:
        1 as const,

      finalHoldoutAccessible:
        false as const,
    },

    quantization: {
      loadIn4Bit:
        true as const,

      quantType:
        'NF4' as const,

      computeDtype:
        'BFLOAT16' as const,

      useDoubleQuant:
        true as const,

      threeBitAllowed:
        false as const,
    },

    lora: {
      rank:
        32 as const,

      alpha:
        64 as const,

      dropout:
        0.05 as const,

      bias:
        'none' as const,

      taskType:
        'CAUSAL_LM' as const,

      targetScope:
        'TEXT_LANGUAGE_MODEL_ONLY' as const,

      textModelPrefix:
        'model.language_model.layers.' as const,

      expectedTextLayerCount:
        64 as const,

      expectedFullAttentionLayerCount:
        16 as const,

      expectedLinearAttentionLayerCount:
        48 as const,

      fullAttentionTargetModules: [
        'q_proj',
        'k_proj',
        'v_proj',
        'o_proj',
      ] as const,

      linearAttentionTargetModules: [
        'in_proj_qkv',
        'in_proj_a',
        'in_proj_b',
        'in_proj_z',
        'out_proj',
      ] as const,

      mlpTargetModules: [
        'gate_proj',
        'up_proj',
        'down_proj',
      ] as const,

      requireExactTargetResolution:
        true as const,

      visionModulesAllowed:
        false as const,
    },

    training: {
      maxSequenceLength:
        1536 as const,

      perDeviceTrainBatchSize:
        1 as const,

      perDeviceEvalBatchSize:
        1 as const,

      gradientAccumulationSteps:
        16 as const,

      numTrainEpochs:
        1 as const,

      learningRate:
        0.0002 as const,

      warmupRatio:
        0.03 as const,

      maxGradNorm:
        1 as const,

      optimizer:
        'PAGED_ADAMW_8BIT' as const,

      scheduler:
        'COSINE' as const,

      gradientCheckpointing:
        true as const,

      useCache:
        false as const,

      packing:
        false as const,

      seed:
        3407 as const,
    },

    output: {
      outputKind:
        'PEFT_ADAPTER_ONLY' as const,

      mergeAdapterIntoBase:
        false as const,

      pushToHub:
        false as const,
    },

    dataBinding: {
      sourceJsonlExportSha256:
        input.trainingExport
          .exportSha256,

      sourceMaterializationManifestSha256:
        input.trainingExport
          .sourceMaterializationManifestSha256,

      sourceRegistryPayloadSha256:
        input.trainingExport
          .sourceRegistryPayloadSha256,

      sourceTrainingManifestSha256:
        input.trainingExport
          .sourceTrainingManifestSha256,

      sourceFinalHoldoutCommitmentSha256:
        input.trainingExport
          .sourceFinalHoldoutCommitmentSha256,

      trainJsonlSha256:
        input.trainingExport
          .train
          .jsonlSha256,

      devJsonlSha256:
        input.trainingExport
          .dev
          .jsonlSha256,

      trainExampleCount:
        input.trainingExport
          .train
          .exampleCount,

      devExampleCount:
        input.trainingExport
          .dev
          .exampleCount,
    },

    execution: {
      trainingAuthorizationRequired:
        true as const,

      singleUseAuthorizationRequired:
        true as const,

      replayProtectionRequired:
        true as const,

      cloudProvisioningAuthorized:
        false as const,

      trainingExecutionAuthorized:
        false as const,

      promotionAuthorized:
        false as const,

      deploymentAuthorized:
        false as const,
    },
  };

  return deepFreeze({
    ...core,

    contractSha256:
      digest(core),
  });
}

export function verifyQwenQloraRunnerContract(
  value:
    QwenQloraRunnerContract,

  input:
    QwenQloraRunnerContractInput,
): boolean {
  let expected:
    QwenQloraRunnerContract;

  try {
    expected =
      createQwenQloraRunnerContract(
        input,
      );
  }
  catch {
    return false;
  }

  const {
    contractSha256:
      _contractSha256,
    ...core
  } = value;

  return (
    value.contractSha256 ===
      digest(core) &&
    value.contractSha256 ===
      expected.contractSha256
  );
}
