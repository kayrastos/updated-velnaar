import {
  createHash,
} from 'node:crypto';

import {
  FULGOR_GCE_QLORA_EXECUTOR_HANDOFF_VERSION,
  FULGOR_QWEN_QLORA_EXECUTOR_REQUEST_VERSION,
} from './gceQloraExecutorHandoff';

import type {
  GceQloraExecutorHandoffResult,
} from './gceQloraExecutorHandoff';

import {
  FULGOR_QWEN_QLORA_MODEL_ARCHITECTURE,
  FULGOR_QWEN_QLORA_MODEL_ID,
  FULGOR_QWEN_QLORA_MODEL_REVISION_SHA,
  FULGOR_QWEN_QLORA_MODEL_TYPE,
} from './qwenQloraModelPin';

export const FULGOR_GCE_QLORA_CONTAINER_RUNTIME_PREFLIGHT_VERSION =
  'FULGOR_GCE_QLORA_CONTAINER_RUNTIME_PREFLIGHT_V1' as const;

export const FULGOR_GCE_QLORA_CONTAINER_ENTRYPOINT =
  '/opt/fulgor/qwen_qlora_executor.py' as const;

export const FULGOR_GCE_QLORA_CONTAINER_REQUEST_PATH =
  '/run/fulgor/executor-request.json' as const;

export const FULGOR_GCE_QLORA_CONTAINER_DATA_ROOT =
  '/mnt/fulgor/data' as const;

export const FULGOR_GCE_QLORA_CONTAINER_OUTPUT_ROOT =
  '/mnt/fulgor/output' as const;

const SHA256 =
  /^[a-f0-9]{64}$/;

const DIGEST_IMAGE =
  /^[^\s@]+@sha256:[a-f0-9]{64}$/;

export type GceQloraContainerRuntimePreflightFailureCode =
  | 'HANDOFF_NOT_ACCEPTED'
  | 'HANDOFF_AUTHORITY_STATE_INVALID'
  | 'INVALID_CONTAINER_IMAGE_DIGEST'
  | 'INVALID_EXECUTOR_REQUEST'
  | 'EXECUTOR_REQUEST_DIGEST_MISMATCH'
  | 'EXECUTOR_REQUEST_AUTHORITY_ESCALATION';

export interface GceQloraContainerRuntimeSpec {
  schemaVersion:
    typeof FULGOR_GCE_QLORA_CONTAINER_RUNTIME_PREFLIGHT_VERSION;

  containerImageDigest:
    string;

  executorRequestSha256:
    string;

  command:
    readonly [
      'python3',
      typeof FULGOR_GCE_QLORA_CONTAINER_ENTRYPOINT,
      'container-preflight',
      '--request',
      typeof FULGOR_GCE_QLORA_CONTAINER_REQUEST_PATH,
      '--data-root',
      typeof FULGOR_GCE_QLORA_CONTAINER_DATA_ROOT,
      '--output-root',
      typeof FULGOR_GCE_QLORA_CONTAINER_OUTPUT_ROOT,
    ];

  imageReferencePolicy:
    'IMMUTABLE_DIGEST_ONLY';

  networkPackageInstallAllowed:
    false;

  floatingImageReferenceAllowed:
    false;

  modelDownloadAuthorized:
    false;

  containerStartAuthorized:
    false;

  cloudProvisioningAuthorized:
    false;

  trainingExecutionAuthorized:
    false;

  promotionAuthorized:
    false;

  deploymentAuthorized:
    false;

  runtimeSpecSha256:
    string;
}

export interface GceQloraContainerRuntimePreflightResult {
  schemaVersion:
    typeof FULGOR_GCE_QLORA_CONTAINER_RUNTIME_PREFLIGHT_VERSION;

  accepted:
    boolean;

  immutableImageBound:
    boolean;

  executorRequestIntegrityVerified:
    boolean;

  runtimeSpec:
    GceQloraContainerRuntimeSpec | null;

  failureCodes:
    readonly GceQloraContainerRuntimePreflightFailureCode[];

  containerPulled:
    false;

  containerStarted:
    false;

  modelDownloadStarted:
    false;

  cloudProvisioningPerformed:
    false;

  trainingStarted:
    false;
}

function isRecord(
  value:
    unknown,
): value is Record<string, unknown> {
  return (
    typeof value ===
      'object' &&
    value !==
      null &&
    !Array.isArray(
      value,
    )
  );
}

function canonicalize(
  value:
    unknown,
): unknown {
  if (
    value === null ||
    typeof value ===
      'string' ||
    typeof value ===
      'boolean'
  ) {
    return value;
  }

  if (
    typeof value ===
      'number'
  ) {
    if (
      !Number.isFinite(
        value,
      )
    ) {
      throw new Error(
        'NON_CANONICAL_NUMBER',
      );
    }

    return value;
  }

  if (
    Array.isArray(
      value,
    )
  ) {
    return value.map(
      canonicalize,
    );
  }

  if (
    isRecord(
      value,
    )
  ) {
    const output:
      Record<string, unknown> = {};

    for (
      const key of
      Object.keys(value).sort()
    ) {
      const item =
        value[key];

      if (
        item ===
          undefined
      ) {
        throw new Error(
          'NON_CANONICAL_UNDEFINED',
        );
      }

      output[key] =
        canonicalize(
          item,
        );
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

export function computeGceQloraExecutorRequestSha256(
  request:
    Readonly<Record<string, unknown>>,
): string {
  return digest(
    request,
  );
}

function exactKeys(
  value:
    Record<string, unknown>,

  expected:
    readonly string[],
): boolean {
  const actual =
    Object.keys(
      value,
    ).sort();

  const wanted =
    [...expected].sort();

  return (
    actual.length ===
      wanted.length &&
    actual.every(
      (
        key,
        index,
      ) =>
        key ===
        wanted[index],
    )
  );
}

function executorRequestIsStrictPreflight(
  request:
    Readonly<Record<string, unknown>>,
): boolean {
  if (
    !exactKeys(
      request as
        Record<string, unknown>,
      [
        'schemaVersion',
        'executionIntent',
        'runnerContractSha256',
        'model',
        'runtime',
        'quantization',
        'lora',
        'training',
        'output',
        'data',
      ],
    )
  ) {
    return false;
  }

  if (
    request.schemaVersion !==
      FULGOR_QWEN_QLORA_EXECUTOR_REQUEST_VERSION ||
    request.executionIntent !==
      'PREFLIGHT_ONLY' ||
    typeof request.runnerContractSha256 !==
      'string' ||
    !SHA256.test(
      request.runnerContractSha256,
    )
  ) {
    return false;
  }

  const model =
    request.model;

  const runtime =
    request.runtime;

  const output =
    request.output;

  const data =
    request.data;

  if (
    !isRecord(model) ||
    !isRecord(runtime) ||
    !isRecord(output) ||
    !isRecord(data)
  ) {
    return false;
  }

  if (
    model.modelId !==
      FULGOR_QWEN_QLORA_MODEL_ID ||
    model.modelRevisionSha !==
      FULGOR_QWEN_QLORA_MODEL_REVISION_SHA ||
    model.architecture !==
      FULGOR_QWEN_QLORA_MODEL_ARCHITECTURE ||
    model.modelType !==
      FULGOR_QWEN_QLORA_MODEL_TYPE ||
    model.sourceFormat !==
      'HF_SAFETENSORS' ||
    model.requireSafeTensors !==
      true ||
    model.trustRemoteCode !==
      false ||
    model.ggufInputAllowed !==
      false
  ) {
    return false;
  }

  if (
    runtime.implementation !==
      'TRANSFORMERS_PEFT_BITSANDBYTES' ||
    runtime.targetRuntime !==
      'GCE_SPOT_SINGLE_L4_24GB' ||
    runtime.expectedGpu !==
      'NVIDIA_L4_24GB' ||
    runtime.expectedGpuCount !==
      1 ||
    runtime.minimumCudaComputeCapability !==
      '8.9' ||
    runtime.worldSize !==
      1 ||
    runtime.finalHoldoutAccessible !==
      false
  ) {
    return false;
  }

  if (
    output.outputKind !==
      'PEFT_ADAPTER_ONLY' ||
    output.mergeAdapterIntoBase !==
      false ||
    output.pushToHub !==
      false ||
    typeof output.outputDir !==
      'string' ||
    output.outputDir.length ===
      0
  ) {
    return false;
  }

  if (
    typeof data.trainJsonlPath !==
      'string' ||
    data.trainJsonlPath.length ===
      0 ||
    typeof data.devJsonlPath !==
      'string' ||
    data.devJsonlPath.length ===
      0 ||
    typeof data.trainJsonlSha256 !==
      'string' ||
    !SHA256.test(
      data.trainJsonlSha256,
    ) ||
    typeof data.devJsonlSha256 !==
      'string' ||
    !SHA256.test(
      data.devJsonlSha256,
    ) ||
    typeof data.sourceFinalHoldoutCommitmentSha256 !==
      'string' ||
    !SHA256.test(
      data.sourceFinalHoldoutCommitmentSha256,
    ) ||
    Object.prototype.hasOwnProperty.call(
      data,
      'finalHoldoutPath',
    ) ||
    Object.prototype.hasOwnProperty.call(
      data,
      'finalHoldoutRecordIds',
    )
  ) {
    return false;
  }

  return true;
}

function containsAuthorityEscalationKey(
  value:
    unknown,
): boolean {
  const forbidden =
    new Set([
      'trainingExecutionAuthorized',
      'cloudProvisioningAuthorized',
      'promotionAuthorized',
      'deploymentAuthorized',
      'skipAuthorization',
      'skipReplayCheck',
      'allowReplay',
      'forceExecute',
      'finalHoldoutPath',
      'finalHoldoutRecordIds',
      'authorization',
      'nonce',
      'signatureBase64',
      'privateKey',
      'credentials',
      'token',
    ]);

  if (
    Array.isArray(
      value,
    )
  ) {
    return value.some(
      containsAuthorityEscalationKey,
    );
  }

  if (
    !isRecord(
      value,
    )
  ) {
    return false;
  }

  for (
    const [
      key,
      child,
    ] of
    Object.entries(
      value,
    )
  ) {
    if (
      forbidden.has(
        key,
      )
    ) {
      return true;
    }

    if (
      containsAuthorityEscalationKey(
        child,
      )
    ) {
      return true;
    }
  }

  return false;
}

function reject(
  code:
    GceQloraContainerRuntimePreflightFailureCode,

  options?: {
    immutableImageBound?:
      boolean;

    executorRequestIntegrityVerified?:
      boolean;
  },
): GceQloraContainerRuntimePreflightResult {
  return Object.freeze({
    schemaVersion:
      FULGOR_GCE_QLORA_CONTAINER_RUNTIME_PREFLIGHT_VERSION,

    accepted:
      false,

    immutableImageBound:
      options?.immutableImageBound ??
      false,

    executorRequestIntegrityVerified:
      options
        ?.executorRequestIntegrityVerified ??
      false,

    runtimeSpec:
      null,

    failureCodes:
      Object.freeze([
        code,
      ]),

    containerPulled:
      false as const,

    containerStarted:
      false as const,

    modelDownloadStarted:
      false as const,

    cloudProvisioningPerformed:
      false as const,

    trainingStarted:
      false as const,
  });
}

export function preflightGceQloraContainerRuntime(
  handoff:
    Readonly<GceQloraExecutorHandoffResult>,
): GceQloraContainerRuntimePreflightResult {
  if (
    handoff.schemaVersion !==
      FULGOR_GCE_QLORA_EXECUTOR_HANDOFF_VERSION ||
    handoff.accepted !==
      true
  ) {
    return reject(
      'HANDOFF_NOT_ACCEPTED',
    );
  }

  if (
    handoff.capabilityVerified !==
      true ||
    handoff.capabilityConsumed !==
      true ||
    handoff.executorPreflightReady !==
      true ||
    handoff.trainingExecutionAuthorized !==
      false ||
    handoff.cloudProvisioningPerformed !==
      false ||
    handoff.trainingStarted !==
      false ||
    handoff.promotionPerformed !==
      false ||
    handoff.deploymentPerformed !==
      false ||
    handoff.failureCodes.length !==
      0
  ) {
    return reject(
      'HANDOFF_AUTHORITY_STATE_INVALID',
    );
  }

  const image =
    handoff.containerImageDigest;

  if (
    typeof image !==
      'string' ||
    !DIGEST_IMAGE.test(
      image,
    )
  ) {
    return reject(
      'INVALID_CONTAINER_IMAGE_DIGEST',
    );
  }

  const request =
    handoff.executorRequest;

  if (
    !isRecord(
      request,
    ) ||
    typeof handoff.executorRequestSha256 !==
      'string' ||
    !SHA256.test(
      handoff.executorRequestSha256,
    )
  ) {
    return reject(
      'INVALID_EXECUTOR_REQUEST',
      {
        immutableImageBound:
          true,
      },
    );
  }

  let actualRequestSha256:
    string;

  try {
    actualRequestSha256 =
      computeGceQloraExecutorRequestSha256(
        request,
      );
  }
  catch {
    return reject(
      'INVALID_EXECUTOR_REQUEST',
      {
        immutableImageBound:
          true,
      },
    );
  }

  if (
    actualRequestSha256 !==
      handoff.executorRequestSha256
  ) {
    return reject(
      'EXECUTOR_REQUEST_DIGEST_MISMATCH',
      {
        immutableImageBound:
          true,
      },
    );
  }

  if (
    containsAuthorityEscalationKey(
      request,
    )
  ) {
    return reject(
      'EXECUTOR_REQUEST_AUTHORITY_ESCALATION',
      {
        immutableImageBound:
          true,

        executorRequestIntegrityVerified:
          true,
      },
    );
  }

  if (
    !executorRequestIsStrictPreflight(
      request,
    )
  ) {
    return reject(
      'INVALID_EXECUTOR_REQUEST',
      {
        immutableImageBound:
          true,

        executorRequestIntegrityVerified:
          true,
      },
    );
  }

  const runtimeCore = {
    schemaVersion:
      FULGOR_GCE_QLORA_CONTAINER_RUNTIME_PREFLIGHT_VERSION,

    containerImageDigest:
      image,

    executorRequestSha256:
      actualRequestSha256,

    command: [
      'python3',
      FULGOR_GCE_QLORA_CONTAINER_ENTRYPOINT,
      'container-preflight',
      '--request',
      FULGOR_GCE_QLORA_CONTAINER_REQUEST_PATH,
      '--data-root',
      FULGOR_GCE_QLORA_CONTAINER_DATA_ROOT,
      '--output-root',
      FULGOR_GCE_QLORA_CONTAINER_OUTPUT_ROOT,
    ] as const,

    imageReferencePolicy:
      'IMMUTABLE_DIGEST_ONLY' as const,

    networkPackageInstallAllowed:
      false as const,

    floatingImageReferenceAllowed:
      false as const,

    modelDownloadAuthorized:
      false as const,

    containerStartAuthorized:
      false as const,

    cloudProvisioningAuthorized:
      false as const,

    trainingExecutionAuthorized:
      false as const,

    promotionAuthorized:
      false as const,

    deploymentAuthorized:
      false as const,
  };

  const runtimeSpec:
    GceQloraContainerRuntimeSpec =
      Object.freeze({
        ...runtimeCore,

        runtimeSpecSha256:
          digest(
            runtimeCore,
          ),
      });

  return Object.freeze({
    schemaVersion:
      FULGOR_GCE_QLORA_CONTAINER_RUNTIME_PREFLIGHT_VERSION,

    accepted:
      true,

    immutableImageBound:
      true,

    executorRequestIntegrityVerified:
      true,

    runtimeSpec,

    failureCodes:
      Object.freeze([]),

    containerPulled:
      false as const,

    containerStarted:
      false as const,

    modelDownloadStarted:
      false as const,

    cloudProvisioningPerformed:
      false as const,

    trainingStarted:
      false as const,
  });
}