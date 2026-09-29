import {
  createHash,
} from 'node:crypto';

import {
  verifyTrainingMaterializationManifest,
} from './trainingMaterializationManifest';

import {
  verifyQwenQloraExecutionBinding,
} from './qwenQloraExecutionBinding';

import type {
  QwenQloraExecutionBinding,
} from './qwenQloraExecutionBinding';

import type {
  QwenQloraRunnerContract,
  QwenQloraRunnerContractInput,
} from './qwenQloraRunnerContract';

import {
  consumeTrainingExecutionAuthorization,
} from '../corpus/authorization/trainingExecutionAuthorization';

import type {
  TrainingAuthorizationConsumeResult,
  TrainingExecutionAuthorization,
} from '../corpus/authorization/trainingExecutionAuthorization';

import {
  PRODUCTION_FULGOR_CORPUS_REGISTRY_TRUST_ANCHOR_PROVISIONED,
  resolveProductionFulgorCorpusRegistryPublicKey,
} from '../corpus/authorization/productionCorpusRegistryTrust';

import type {
  D1TrainingAuthorizationReplayStore,
} from '../corpus/authorization/d1TrainingAuthorizationReplayStore';

import type {
  SignedCorpusRegistry,
} from '../corpus/registry/signedCorpusRegistry';

import type {
  CorpusSplitBundle,
} from '../corpus/registry/sealedSplitManifest';

export const FULGOR_QWEN_QLORA_AUTHORIZED_LAUNCH_GATE_VERSION =
  'FULGOR_QWEN_QLORA_AUTHORIZED_LAUNCH_GATE_V1' as const;

export interface QwenQloraLaunchGateRequest {
  binding:
    QwenQloraExecutionBinding;

  authorization:
    TrainingExecutionAuthorization;

  runnerContract:
    QwenQloraRunnerContract;

  runnerContractInput:
    QwenQloraRunnerContractInput;

  registry:
    SignedCorpusRegistry;

  splitBundle:
    CorpusSplitBundle;
}

export interface QwenQloraLaunchCapabilityIssueRequest {
  schemaVersion:
    'FULGOR_QWEN_QLORA_LAUNCH_CAPABILITY_REQUEST_V1';

  trainingRunId:
    string;

  authorizationPayloadSha256:
    string;

  executionBindingPayloadSha256:
    string;

  runnerContractSha256:
    string;

  modelId:
    string;

  modelRevisionSha:
    string;

  sourceJsonlExportSha256:
    string;

  trainJsonlSha256:
    string;

  devJsonlSha256:
    string;

  sourceFinalHoldoutCommitmentSha256:
    string;

  targetRuntime:
    'GCE_SPOT_SINGLE_L4_24GB';

  expectedGpu:
    'NVIDIA_L4_24GB';

  expectedGpuCount:
    1;

  authorizationConsumed:
    true;

  finalHoldoutRecordIdsExposed:
    false;

  promotionAuthorized:
    false;

  deploymentAuthorized:
    false;

  requestSha256:
    string;
}

export interface QwenQloraLaunchCapabilityIssuer<TCapability> {
  issue(
    request:
      Readonly<QwenQloraLaunchCapabilityIssueRequest>,
  ):
    | TCapability
    | Promise<TCapability>;
}

export interface QwenQloraLaunchGateDependencies {
  verifyMaterialization(
    request:
      Readonly<QwenQloraLaunchGateRequest>,
  ):
    | boolean
    | Promise<boolean>;

  verifyBinding(
    request:
      Readonly<QwenQloraLaunchGateRequest>,
  ):
    | boolean
    | Promise<boolean>;

  consumeAuthorization(
    request:
      Readonly<QwenQloraLaunchGateRequest>,
  ):
    | TrainingAuthorizationConsumeResult
    | Promise<TrainingAuthorizationConsumeResult>;
}

export type QwenQloraLaunchGateFailureCode =
  | 'CORPUS_REGISTRY_TRUST_ANCHOR_NOT_PROVISIONED'
  | 'MATERIALIZATION_MANIFEST_REJECTED'
  | 'EXECUTION_BINDING_REJECTED'
  | 'TRAINING_AUTHORIZATION_REJECTED'
  | 'TRAINING_AUTHORIZATION_NONCE_NOT_CONSUMED'
  | 'LAUNCH_CAPABILITY_ISSUER_FAILED_AFTER_AUTHORIZATION_CONSUMED'
  | 'EMPTY_LAUNCH_CAPABILITY_AFTER_AUTHORIZATION_CONSUMED';

export interface QwenQloraLaunchGateResult<TCapability> {
  schemaVersion:
    typeof FULGOR_QWEN_QLORA_AUTHORIZED_LAUNCH_GATE_VERSION;

  accepted:
    boolean;

  launchCapabilityIssued:
    boolean;

  authorizationResult:
    TrainingAuthorizationConsumeResult | null;

  launchCapability:
    TCapability | null;

  failureCodes:
    readonly QwenQloraLaunchGateFailureCode[];

  cloudProvisioningPerformed:
    false;

  trainingStarted:
    false;

  promotionPerformed:
    false;

  deploymentPerformed:
    false;
}

function canonical(
  value: unknown,
): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(
      canonical,
    );
  }

  const source =
    value as Record<string, unknown>;

  const result:
    Record<string, unknown> = {};

  for (
    const key of
    Object.keys(source).sort()
  ) {
    result[key] =
      canonical(
        source[key],
      );
  }

  return result;
}

function sha256(
  value: unknown,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        canonical(value),
      ),
      'utf8',
    )
    .digest('hex');
}

function denied<TCapability>(
  failure:
    QwenQloraLaunchGateFailureCode,

  authorizationResult:
    TrainingAuthorizationConsumeResult | null =
      null,
): QwenQloraLaunchGateResult<TCapability> {
  return Object.freeze({
    schemaVersion:
      FULGOR_QWEN_QLORA_AUTHORIZED_LAUNCH_GATE_VERSION,

    accepted:
      false,

    launchCapabilityIssued:
      false,

    authorizationResult,

    launchCapability:
      null,

    failureCodes:
      Object.freeze([
        failure,
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

function buildIssueRequest(
  request:
    Readonly<QwenQloraLaunchGateRequest>,
): QwenQloraLaunchCapabilityIssueRequest {
  const core = {
    schemaVersion:
      'FULGOR_QWEN_QLORA_LAUNCH_CAPABILITY_REQUEST_V1' as const,

    trainingRunId:
      request.authorization
        .trainingRunId,

    authorizationPayloadSha256:
      request.authorization
        .payloadSha256,

    executionBindingPayloadSha256:
      request.binding
        .bindingPayloadSha256,

    runnerContractSha256:
      request.runnerContract
        .contractSha256,

    modelId:
      request.runnerContract
        .model
        .modelId,

    modelRevisionSha:
      request.runnerContract
        .model
        .modelRevisionSha,

    sourceJsonlExportSha256:
      request.runnerContract
        .dataBinding
        .sourceJsonlExportSha256,

    trainJsonlSha256:
      request.runnerContract
        .dataBinding
        .trainJsonlSha256,

    devJsonlSha256:
      request.runnerContract
        .dataBinding
        .devJsonlSha256,

    sourceFinalHoldoutCommitmentSha256:
      request.runnerContract
        .dataBinding
        .sourceFinalHoldoutCommitmentSha256,

    targetRuntime:
      request.runnerContract
        .runtime
        .targetRuntime,

    expectedGpu:
      request.runnerContract
        .runtime
        .expectedGpu,

    expectedGpuCount:
      request.runnerContract
        .runtime
        .expectedGpuCount,

    authorizationConsumed:
      true as const,

    finalHoldoutRecordIdsExposed:
      false as const,

    promotionAuthorized:
      false as const,

    deploymentAuthorized:
      false as const,
  };

  return Object.freeze({
    ...core,

    requestSha256:
      sha256(
        core,
      ),
  });
}

async function runGate<TCapability>(
  request:
    QwenQloraLaunchGateRequest,

  dependencies:
    QwenQloraLaunchGateDependencies,

  issuer:
    QwenQloraLaunchCapabilityIssuer<TCapability>,
): Promise<QwenQloraLaunchGateResult<TCapability>> {
  const snapshot =
    structuredClone(
      request,
    );

  if (
    !await dependencies
      .verifyMaterialization(
        snapshot,
      )
  ) {
    return denied(
      'MATERIALIZATION_MANIFEST_REJECTED',
    );
  }

  if (
    !await dependencies
      .verifyBinding(
        snapshot,
      )
  ) {
    return denied(
      'EXECUTION_BINDING_REJECTED',
    );
  }

  const authorizationResult =
    await dependencies
      .consumeAuthorization(
        snapshot,
      );

  if (
    authorizationResult
      .authorized !==
      true
  ) {
    return denied(
      'TRAINING_AUTHORIZATION_REJECTED',
      authorizationResult,
    );
  }

  if (
    authorizationResult
      .nonceConsumed !==
      true
  ) {
    return denied(
      'TRAINING_AUTHORIZATION_NONCE_NOT_CONSUMED',
      authorizationResult,
    );
  }

  let launchCapability:
    TCapability;

  try {
    launchCapability =
      await issuer.issue(
        buildIssueRequest(
          snapshot,
        ),
      );
  }
  catch {
    return denied(
      'LAUNCH_CAPABILITY_ISSUER_FAILED_AFTER_AUTHORIZATION_CONSUMED',
      authorizationResult,
    );
  }

  if (
    launchCapability === null ||
    launchCapability === undefined
  ) {
    return denied(
      'EMPTY_LAUNCH_CAPABILITY_AFTER_AUTHORIZATION_CONSUMED',
      authorizationResult,
    );
  }

  return Object.freeze({
    schemaVersion:
      FULGOR_QWEN_QLORA_AUTHORIZED_LAUNCH_GATE_VERSION,

    accepted:
      true,

    launchCapabilityIssued:
      true,

    authorizationResult,

    launchCapability,

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

export async function authorizeQwenQloraLaunchWithDependenciesForTesting<
  TCapability,
>(
  request:
    QwenQloraLaunchGateRequest,

  dependencies:
    QwenQloraLaunchGateDependencies,

  issuer:
    QwenQloraLaunchCapabilityIssuer<TCapability>,
): Promise<QwenQloraLaunchGateResult<TCapability>> {
  return runGate(
    request,
    dependencies,
    issuer,
  );
}

export async function authorizeQwenQloraLaunch<
  TCapability,
>(
  request:
    QwenQloraLaunchGateRequest,

  replayStore:
    D1TrainingAuthorizationReplayStore,

  issuer:
    QwenQloraLaunchCapabilityIssuer<TCapability>,
): Promise<QwenQloraLaunchGateResult<TCapability>> {
  if (
    !PRODUCTION_FULGOR_CORPUS_REGISTRY_TRUST_ANCHOR_PROVISIONED
  ) {
    return denied(
      'CORPUS_REGISTRY_TRUST_ANCHOR_NOT_PROVISIONED',
    );
  }

  const registryPublicKey =
    resolveProductionFulgorCorpusRegistryPublicKey();

  if (registryPublicKey === null) {
    return denied(
      'CORPUS_REGISTRY_TRUST_ANCHOR_NOT_PROVISIONED',
    );
  }

  return runGate(
    request,

    {
      verifyMaterialization(
        snapshot,
      ) {
        return verifyTrainingMaterializationManifest(
          snapshot
            .runnerContractInput
            .sourceManifest,
          snapshot.registry,
          snapshot.splitBundle,
          registryPublicKey,
        ).accepted;
      },

      verifyBinding(
        snapshot,
      ) {
        return verifyQwenQloraExecutionBinding(
          snapshot.binding,
          snapshot.authorization,
          snapshot.runnerContract,
          snapshot.runnerContractInput,
        ).accepted;
      },

      consumeAuthorization(
        snapshot,
      ) {
        return consumeTrainingExecutionAuthorization(
          snapshot.authorization,
          snapshot.registry,
          snapshot.splitBundle,
          replayStore,
        );
      },
    },

    issuer,
  );
}
