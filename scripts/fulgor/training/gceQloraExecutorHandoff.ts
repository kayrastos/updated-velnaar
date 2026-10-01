import {
  createHash,
  verify as cryptoVerify,
} from 'node:crypto';

import {
  isAbsolute,
} from 'node:path';

import {
  FULGOR_GCE_QLORA_LAUNCH_SIGNATURE_ALGORITHM,
  verifyGceQloraLaunchCapability,
} from './gceQloraLaunchCapabilityIssuer';

import type {
  GceQloraLaunchCapability,
  GceQloraLaunchCapabilityVerifier,
} from './gceQloraLaunchCapabilityIssuer';

import {
  FULGOR_QWEN_QLORA_MODEL_ARCHITECTURE,
  FULGOR_QWEN_QLORA_MODEL_ID,
  FULGOR_QWEN_QLORA_MODEL_REVISION_SHA,
  FULGOR_QWEN_QLORA_MODEL_TYPE,
} from './qwenQloraModelPin';

import {
  verifyQwenQloraRunnerContract,
} from './qwenQloraRunnerContract';

import type {
  QwenQloraRunnerContract,
  QwenQloraRunnerContractInput,
} from './qwenQloraRunnerContract';

import {
  PRODUCTION_FULGOR_GCE_QLORA_LAUNCH_TRUST_ANCHOR_PROVISIONED,
  resolveProductionGceQloraLaunchTrust,
} from './productionGceQloraLaunchTrust';

export const FULGOR_GCE_QLORA_EXECUTOR_HANDOFF_VERSION =
  'FULGOR_GCE_QLORA_EXECUTOR_HANDOFF_V1' as const;

export const FULGOR_QWEN_QLORA_EXECUTOR_REQUEST_VERSION =
  'FULGOR_QWEN_QLORA_EXECUTOR_REQUEST_V1' as const;

const SHA256 =
  /^[a-f0-9]{64}$/;

const DIGEST_IMAGE =
  /^[^\s@]+@sha256:[a-f0-9]{64}$/;

const PROJECT_ID =
  /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

const SERVICE_ACCOUNT =
  /^[a-z0-9][a-z0-9._-]*@[a-z0-9-]+\.iam\.gserviceaccount\.com$/i;

export type GceQloraCapabilityReplayConsumeResult =
  | 'CONSUMED'
  | 'ALREADY_CONSUMED'
  | 'BACKEND_UNAVAILABLE';

export interface GceQloraCapabilityReplayIdentity {
  capabilityId:
    string;

  payloadSha256:
    string;

  expiresAtUtc:
    string;
}

export interface GceQloraCapabilityReplayStore {
  /*
   * Production implementations MUST atomically perform
   * check-and-consume in one authoritative durable transaction.
   *
   * A preflight read is not an authorization primitive.
   */
  consumeOnce(
    identity:
      Readonly<GceQloraCapabilityReplayIdentity>,
  ):
    | GceQloraCapabilityReplayConsumeResult
    | Promise<GceQloraCapabilityReplayConsumeResult>;
}

export interface GceQloraExecutorHandoffInput {
  capability:
    GceQloraLaunchCapability;

  runnerContract:
    QwenQloraRunnerContract;

  runnerContractInput:
    QwenQloraRunnerContractInput;

  trainJsonlPath:
    string;

  devJsonlPath:
    string;

  outputDir:
    string;
}

export type GceQloraExecutorHandoffFailureCode =
  | 'LAUNCH_TRUST_ANCHOR_NOT_PROVISIONED'
  | 'INVALID_LOCAL_PATH_BINDING'
  | 'RUNNER_CONTRACT_REJECTED'
  | 'LAUNCH_CAPABILITY_REJECTED'
  | 'LAUNCH_CAPABILITY_CONTRACT_MISMATCH'
  | 'LAUNCH_CAPABILITY_REPLAYED'
  | 'LAUNCH_CAPABILITY_REPLAY_BACKEND_UNAVAILABLE';

export interface GceQloraExecutorHandoffResult {
  schemaVersion:
    typeof FULGOR_GCE_QLORA_EXECUTOR_HANDOFF_VERSION;

  accepted:
    boolean;

  capabilityVerified:
    boolean;

  capabilityConsumed:
    boolean;

  executorPreflightReady:
    boolean;

  /*
   * This remains false even after capability consumption.
   *
   * The Python executor's production execute path is still
   * intentionally unwired and fail-closed.
   */
  trainingExecutionAuthorized:
    false;

  executorRequest:
    Readonly<Record<string, unknown>> | null;

  executorRequestSha256:
    string | null;

  containerImageDigest:
    string | null;

  failureCodes:
    readonly GceQloraExecutorHandoffFailureCode[];

  cloudProvisioningPerformed:
    false;

  trainingStarted:
    false;

  promotionPerformed:
    false;

  deploymentPerformed:
    false;
}

export interface GceQloraExecutorHandoffDependencies {
  verifyCapability(
    capability:
      GceQloraLaunchCapability,

    nowUtc:
      string,
  ):
    | boolean
    | Promise<boolean>;

  verifyRunnerContract(
    contract:
      QwenQloraRunnerContract,

    input:
      QwenQloraRunnerContractInput,
  ):
    boolean;

  consumeCapability(
    identity:
      Readonly<GceQloraCapabilityReplayIdentity>,
  ):
    | GceQloraCapabilityReplayConsumeResult
    | Promise<GceQloraCapabilityReplayConsumeResult>;

  clock():
    string;
}

function isRecord(
  value:
    unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function canonicalize(
  value:
    unknown,
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
        'NON_CANONICAL_NUMBER',
      );
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.map(
      canonicalize,
    );
  }

  if (isRecord(value)) {
    const output:
      Record<string, unknown> = {};

    for (
      const key of
      Object.keys(value).sort()
    ) {
      const item =
        value[key];

      if (item === undefined) {
        throw new Error(
          'NON_CANONICAL_UNDEFINED',
        );
      }

      output[key] =
        canonicalize(item);
    }

    return output;
  }

  throw new Error(
    'NON_CANONICAL_VALUE',
  );
}

function digest(
  value:
    unknown,
): string {
  return createHash(
    'sha256',
  )
    .update(
      JSON.stringify(
        canonicalize(
          value,
        ),
      ),
      'utf8',
    )
    .digest('hex');
}

function reject(
  code:
    GceQloraExecutorHandoffFailureCode,

  options?: {
    capabilityVerified?:
      boolean;
  },
): GceQloraExecutorHandoffResult {
  return Object.freeze({
    schemaVersion:
      FULGOR_GCE_QLORA_EXECUTOR_HANDOFF_VERSION,

    accepted:
      false,

    capabilityVerified:
      options?.capabilityVerified ??
      false,

    capabilityConsumed:
      false,

    executorPreflightReady:
      false,

    trainingExecutionAuthorized:
      false as const,

    executorRequest:
      null,

    executorRequestSha256:
      null,

    containerImageDigest:
      null,

    failureCodes:
      Object.freeze([
        code,
      ]),

    cloudProvisioningPerformed:
      false as const,

    trainingStarted:
      false as const,

    promotionPerformed:
      false as const,

    deploymentPerformed:
      false as const,
  });
}

function validPaths(
  input:
    GceQloraExecutorHandoffInput,
): boolean {
  return (
    input.trainJsonlPath.length >
      0 &&
    input.devJsonlPath.length >
      0 &&
    input.outputDir.length >
      0 &&
    isAbsolute(
      input.trainJsonlPath,
    ) &&
    isAbsolute(
      input.devJsonlPath,
    ) &&
    isAbsolute(
      input.outputDir,
    ) &&
    input.trainJsonlPath !==
      input.devJsonlPath &&
    input.trainJsonlPath !==
      input.outputDir &&
    input.devJsonlPath !==
      input.outputDir
  );
}

function everySha256(
  values:
    readonly string[],
): boolean {
  return values.every(
    (value) =>
      SHA256.test(
        value,
      ),
  );
}

function capabilityMatchesContract(
  capability:
    GceQloraLaunchCapability,

  contract:
    QwenQloraRunnerContract,
): boolean {
  const launch =
    capability.launch;

  return (
    capability.maxLaunchCount ===
      1 &&

    SHA256.test(
      capability.capabilityId,
    ) &&

    SHA256.test(
      capability.payloadSha256,
    ) &&

    everySha256([
      launch.requestSha256,
      launch.authorizationPayloadSha256,
      launch.executionBindingPayloadSha256,
      launch.runnerContractSha256,
      launch.sourceRegistryPayloadSha256,
      launch.sourceTrainingManifestSha256,
      launch.sourceJsonlExportSha256,
      launch.trainJsonlSha256,
      launch.devJsonlSha256,
      launch.sourceFinalHoldoutCommitmentSha256,
    ]) &&

    launch.runnerContractSha256 ===
      contract.contractSha256 &&

    launch.modelId ===
      FULGOR_QWEN_QLORA_MODEL_ID &&

    launch.modelId ===
      contract.model.modelId &&

    launch.modelRevisionSha ===
      FULGOR_QWEN_QLORA_MODEL_REVISION_SHA &&

    launch.modelRevisionSha ===
      contract.model.modelRevisionSha &&

    launch.sourceRegistryPayloadSha256 ===
      contract
        .dataBinding
        .sourceRegistryPayloadSha256 &&

    launch.sourceTrainingManifestSha256 ===
      contract
        .dataBinding
        .sourceTrainingManifestSha256 &&

    launch.sourceJsonlExportSha256 ===
      contract
        .dataBinding
        .sourceJsonlExportSha256 &&

    launch.trainJsonlSha256 ===
      contract
        .dataBinding
        .trainJsonlSha256 &&

    launch.devJsonlSha256 ===
      contract
        .dataBinding
        .devJsonlSha256 &&

    launch.sourceFinalHoldoutCommitmentSha256 ===
      contract
        .dataBinding
        .sourceFinalHoldoutCommitmentSha256 &&

    contract.runtime.targetRuntime ===
      'GCE_SPOT_SINGLE_L4_24GB' &&

    contract.runtime.expectedGpu ===
      'NVIDIA_L4_24GB' &&

    contract.runtime.expectedGpuCount ===
      1 &&

    launch.machineType ===
      'g2-standard-16' &&

    launch.provisioningModel ===
      'SPOT' &&

    launch.expectedGpu ===
      'NVIDIA_L4_24GB' &&

    launch.expectedGpuCount ===
      1 &&

    launch.finalHoldoutRecordIdsExposed ===
      false &&

    launch.promotionAuthorized ===
      false &&

    launch.deploymentAuthorized ===
      false &&

    (
      launch.zone ===
        'europe-west4-a' ||
      launch.zone ===
        'europe-west4-b' ||
      launch.zone ===
        'europe-west4-c'
    ) &&

    PROJECT_ID.test(
      launch.projectId,
    ) &&

    SERVICE_ACCOUNT.test(
      launch.runtimeServiceAccount,
    ) &&

    DIGEST_IMAGE.test(
      launch.containerImageDigest,
    )
  );
}

function buildExecutorRequest(
  input:
    GceQloraExecutorHandoffInput,
): Readonly<Record<string, unknown>> {
  const contract =
    input.runnerContract;

  const request = {
    schemaVersion:
      FULGOR_QWEN_QLORA_EXECUTOR_REQUEST_VERSION,

    executionIntent:
      'PREFLIGHT_ONLY',

    runnerContractSha256:
      contract.contractSha256,

    model: {
      modelId:
        contract.model.modelId,

      modelRevisionSha:
        contract.model.modelRevisionSha,

      architecture:
        FULGOR_QWEN_QLORA_MODEL_ARCHITECTURE,

      modelType:
        FULGOR_QWEN_QLORA_MODEL_TYPE,

      sourceFormat:
        contract.model.sourceFormat,

      requireSafeTensors:
        contract.model.requireSafeTensors,

      trustRemoteCode:
        contract.model.trustRemoteCode,

      ggufInputAllowed:
        contract.model.ggufInputAllowed,
    },

    runtime: {
      ...contract.runtime,
    },

    quantization: {
      ...contract.quantization,
    },

    lora: {
      ...contract.lora,

      fullAttentionTargetModules:
        [
          ...contract
            .lora
            .fullAttentionTargetModules,
        ],

      linearAttentionTargetModules:
        [
          ...contract
            .lora
            .linearAttentionTargetModules,
        ],

      mlpTargetModules:
        [
          ...contract
            .lora
            .mlpTargetModules,
        ],
    },

    training: {
      ...contract.training,
    },

    output: {
      ...contract.output,

      outputDir:
        input.outputDir,
    },

    data: {
      trainJsonlPath:
        input.trainJsonlPath,

      trainJsonlSha256:
        contract
          .dataBinding
          .trainJsonlSha256,

      trainExampleCount:
        contract
          .dataBinding
          .trainExampleCount,

      devJsonlPath:
        input.devJsonlPath,

      devJsonlSha256:
        contract
          .dataBinding
          .devJsonlSha256,

      devExampleCount:
        contract
          .dataBinding
          .devExampleCount,

      sourceFinalHoldoutCommitmentSha256:
        contract
          .dataBinding
          .sourceFinalHoldoutCommitmentSha256,
    },
  };

  return Object.freeze(
    request,
  );
}

async function runHandoff(
  input:
    GceQloraExecutorHandoffInput,

  dependencies:
    GceQloraExecutorHandoffDependencies,
): Promise<GceQloraExecutorHandoffResult> {
  if (!validPaths(input)) {
    return reject(
      'INVALID_LOCAL_PATH_BINDING',
    );
  }

  let contractAccepted:
    boolean;

  try {
    contractAccepted =
      dependencies
        .verifyRunnerContract(
          input.runnerContract,
          input.runnerContractInput,
        );
  }
  catch {
    contractAccepted =
      false;
  }

  if (!contractAccepted) {
    return reject(
      'RUNNER_CONTRACT_REJECTED',
    );
  }

  let nowUtc:
    string;

  try {
    nowUtc =
      dependencies.clock();
  }
  catch {
    return reject(
      'LAUNCH_CAPABILITY_REJECTED',
    );
  }

  let capabilityAccepted:
    boolean;

  try {
    capabilityAccepted =
      await dependencies
        .verifyCapability(
          input.capability,
          nowUtc,
        );
  }
  catch {
    capabilityAccepted =
      false;
  }

  if (!capabilityAccepted) {
    return reject(
      'LAUNCH_CAPABILITY_REJECTED',
    );
  }

  if (
    !capabilityMatchesContract(
      input.capability,
      input.runnerContract,
    )
  ) {
    return reject(
      'LAUNCH_CAPABILITY_CONTRACT_MISMATCH',
      {
        capabilityVerified:
          true,
      },
    );
  }

  let executorRequest:
    Readonly<Record<string, unknown>>;

  let executorRequestSha256:
    string;

  try {
    executorRequest =
      buildExecutorRequest(
        input,
      );

    executorRequestSha256 =
      digest(
        executorRequest,
      );
  }
  catch {
    return reject(
      'LAUNCH_CAPABILITY_CONTRACT_MISMATCH',
      {
        capabilityVerified:
          true,
      },
    );
  }

  const replayIdentity = {
    capabilityId:
      input
        .capability
        .capabilityId,

    payloadSha256:
      input
        .capability
        .payloadSha256,

    expiresAtUtc:
      input
        .capability
        .expiresAtUtc,
  };

  let consumeResult:
    GceQloraCapabilityReplayConsumeResult;

  try {
    consumeResult =
      await dependencies
        .consumeCapability(
          replayIdentity,
        );
  }
  catch {
    consumeResult =
      'BACKEND_UNAVAILABLE';
  }

  if (
    consumeResult ===
      'ALREADY_CONSUMED'
  ) {
    return reject(
      'LAUNCH_CAPABILITY_REPLAYED',
      {
        capabilityVerified:
          true,
      },
    );
  }

  if (
    consumeResult !==
      'CONSUMED'
  ) {
    return reject(
      'LAUNCH_CAPABILITY_REPLAY_BACKEND_UNAVAILABLE',
      {
        capabilityVerified:
          true,
      },
    );
  }

  return Object.freeze({
    schemaVersion:
      FULGOR_GCE_QLORA_EXECUTOR_HANDOFF_VERSION,

    accepted:
      true,

    capabilityVerified:
      true,

    capabilityConsumed:
      true,

    executorPreflightReady:
      true,

    trainingExecutionAuthorized:
      false as const,

    executorRequest,

    executorRequestSha256,

    containerImageDigest:
      input
        .capability
        .launch
        .containerImageDigest,

    failureCodes:
      Object.freeze([]),

    cloudProvisioningPerformed:
      false as const,

    trainingStarted:
      false as const,

    promotionPerformed:
      false as const,

    deploymentPerformed:
      false as const,
  });
}

export async function prepareGceQloraExecutorHandoffWithDependenciesForTesting(
  input:
    GceQloraExecutorHandoffInput,

  dependencies:
    GceQloraExecutorHandoffDependencies,
): Promise<GceQloraExecutorHandoffResult> {
  return runHandoff(
    input,
    dependencies,
  );
}

export async function prepareGceQloraExecutorHandoff(
  input:
    GceQloraExecutorHandoffInput,

  replayStore:
    GceQloraCapabilityReplayStore,
): Promise<GceQloraExecutorHandoffResult> {
  if (
    !PRODUCTION_FULGOR_GCE_QLORA_LAUNCH_TRUST_ANCHOR_PROVISIONED
  ) {
    return reject(
      'LAUNCH_TRUST_ANCHOR_NOT_PROVISIONED',
    );
  }

  const trust =
    resolveProductionGceQloraLaunchTrust();

  if (!trust) {
    return reject(
      'LAUNCH_TRUST_ANCHOR_NOT_PROVISIONED',
    );
  }

  const verifier:
    GceQloraLaunchCapabilityVerifier = {
      algorithm:
        FULGOR_GCE_QLORA_LAUNCH_SIGNATURE_ALGORITHM,

      keyId:
        trust.keyId,

      async verify(
        payload,
        signature,
      ) {
        try {
          return cryptoVerify(
            null,
            payload,
            trust.publicKey,
            signature,
          );
        }
        catch {
          return false;
        }
      },
    };

  return runHandoff(
    input,
    {
      verifyCapability(
        capability,
        nowUtc,
      ) {
        return verifyGceQloraLaunchCapability(
          capability,
          verifier,
          nowUtc,
        );
      },

      verifyRunnerContract(
        contract,
        contractInput,
      ) {
        return verifyQwenQloraRunnerContract(
          contract,
          contractInput,
        );
      },

      consumeCapability(
        identity,
      ) {
        return replayStore
          .consumeOnce(
            identity,
          );
      },

      clock() {
        return new Date()
          .toISOString();
      },
    },
  );
}