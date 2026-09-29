import {
  createHash,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
} from 'node:crypto';

import type {
  KeyObject,
} from 'node:crypto';

import {
  resolveTrainingAuthorizationTrustedSigner,
} from '../corpus/authorization/trainingAuthorizationTrustPolicy';

import type {
  TrainingAuthorizationTrustPolicy,
} from '../corpus/authorization/trainingAuthorizationTrustPolicy';

import {
  PRODUCTION_FULGOR_TRAINING_AUTHORIZATION_TRUST_ANCHOR_PROVISIONED,
  PRODUCTION_FULGOR_TRAINING_AUTHORIZATION_TRUST_POLICY,
} from '../corpus/authorization/productionTrainingAuthorizationTrust';

import type {
  TrainingExecutionAuthorization,
} from '../corpus/authorization/trainingExecutionAuthorization';

import {
  verifyQwenQloraRunnerContract,
} from './qwenQloraRunnerContract';

import type {
  QwenQloraRunnerContract,
  QwenQloraRunnerContractInput,
} from './qwenQloraRunnerContract';

export const FULGOR_QWEN_QLORA_EXECUTION_BINDING_VERSION =
  'FULGOR_QWEN_QLORA_EXECUTION_BINDING_V1' as const;

export interface QwenQloraExecutionBindingRequest {
  authorization:
    TrainingExecutionAuthorization;

  runnerContract:
    QwenQloraRunnerContract;

  runnerContractInput:
    QwenQloraRunnerContractInput;

  authorizationPrivateKey:
    KeyObject;
}

export interface QwenQloraExecutionBinding {
  schemaVersion:
    typeof FULGOR_QWEN_QLORA_EXECUTION_BINDING_VERSION;

  state:
    'SIGNED_QLORA_EXECUTION_BINDING_REQUIRES_SINGLE_USE_AUTHORIZATION';

  action:
    'BIND_QWEN_QLORA_CANDIDATE_TRAINING';

  trainingRunId:
    string;

  humanApproverId:
    string;

  authorizationPayloadSha256:
    string;

  authorizationNonce:
    string;

  authorizationExpiresAtUtc:
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

  sourceRegistryPayloadSha256:
    string;

  sourceTrainingManifestSha256:
    string;

  sourceFinalHoldoutCommitmentSha256:
    string;

  authorizationRequiredAtExecution:
    true;

  singleUseAuthorizationRequired:
    true;

  standaloneTrainingExecutionAuthorized:
    false;

  promotionAuthorized:
    false;

  deploymentAuthorized:
    false;

  signerKeyId:
    string;

  signerPublicKeySha256:
    string;

  bindingPayloadSha256:
    string;

  signatureAlgorithm:
    'Ed25519';

  signatureBase64:
    string;
}

export type QwenQloraExecutionBindingFailureCode =
  | 'INVALID_AUTHORIZATION'
  | 'RUNNER_CONTRACT_REJECTED'
  | 'AUTHORIZATION_BINDING_MISMATCH'
  | 'AUTHORITY_ESCAPE'
  | 'PAYLOAD_DIGEST_MISMATCH'
  | 'INVALID_SIGNATURE'
  | 'SIGNER_TRUST_ANCHOR_NOT_PROVISIONED'
  | 'SIGNER_TRUST_POLICY_INVALID'
  | 'UNKNOWN_SIGNER'
  | 'SIGNER_REVOKED'
  | 'SIGNER_ALGORITHM_MISMATCH'
  | 'SIGNER_FINGERPRINT_MISMATCH';

export interface QwenQloraExecutionBindingVerification {
  accepted:
    boolean;

  failureCodes:
    readonly QwenQloraExecutionBindingFailureCode[];
}

const SHA256 =
  /^[a-f0-9]{64}$/;

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
        'QLORA_BINDING_NON_CANONICAL_NUMBER',
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
          'QLORA_BINDING_NON_CANONICAL_UNDEFINED',
        );
      }

      target[key] =
        normalize(item);
    }

    return target;
  }

  throw new Error(
    'QLORA_BINDING_NON_CANONICAL_VALUE',
  );
}

function canonicalBytes(
  value: unknown,
): Buffer {
  return Buffer.from(
    JSON.stringify(
      normalize(value),
    ),
    'utf8',
  );
}

function digest(
  value: unknown,
): string {
  return createHash('sha256')
    .update(
      canonicalBytes(value),
    )
    .digest('hex');
}

function publicKeySha256(
  key:
    KeyObject,
): string {
  const publicKey =
    key.type === 'private'
      ? createPublicKey(key)
      : key;

  return createHash('sha256')
    .update(
      publicKey.export({
        type:
          'spki',

        format:
          'der',
      }),
    )
    .digest('hex');
}

function authorizationShapeValid(
  authorization:
    TrainingExecutionAuthorization,
): boolean {
  return (
    authorization.schemaVersion ===
      'FULGOR_TRAINING_EXECUTION_AUTHORIZATION_V1' &&
    authorization.state ===
      'SIGNED_SINGLE_USE_TRAINING_EXECUTION_AUTHORIZATION' &&
    authorization.action ===
      'START_CANDIDATE_TRAINING' &&
    authorization.explicitHumanApproval ===
      true &&
    authorization.trainingExecutionAuthorized ===
      true &&
    authorization.promotionAuthorized ===
      false &&
    authorization.deploymentAuthorized ===
      false &&
    authorization.signatureAlgorithm ===
      'Ed25519' &&
    SHA256.test(
      authorization.payloadSha256,
    ) &&
    SHA256.test(
      authorization.signerPublicKeySha256,
    ) &&
    SHA256.test(
      authorization.sourceRegistryPayloadSha256,
    ) &&
    SHA256.test(
      authorization.sourceTrainingManifestSha256,
    ) &&
    SHA256.test(
      authorization.sourceFinalHoldoutCommitmentSha256,
    )
  );
}

function contractMatchesAuthorization(
  authorization:
    TrainingExecutionAuthorization,

  contract:
    QwenQloraRunnerContract,
): boolean {
  return (
    contract.dataBinding
      .sourceRegistryPayloadSha256 ===
      authorization
        .sourceRegistryPayloadSha256 &&
    contract.dataBinding
      .sourceTrainingManifestSha256 ===
      authorization
        .sourceTrainingManifestSha256 &&
    contract.dataBinding
      .sourceFinalHoldoutCommitmentSha256 ===
      authorization
        .sourceFinalHoldoutCommitmentSha256
  );
}

function bindingCore(
  binding:
    QwenQloraExecutionBinding,
) {
  const {
    bindingPayloadSha256:
      _bindingPayloadSha256,

    signatureAlgorithm:
      _signatureAlgorithm,

    signatureBase64:
      _signatureBase64,

    ...core
  } = binding;

  return core;
}

export function createQwenQloraExecutionBinding(
  request:
    QwenQloraExecutionBindingRequest,
): QwenQloraExecutionBinding {
  if (
    request.authorizationPrivateKey.type !==
      'private' ||
    request.authorizationPrivateKey
      .asymmetricKeyType !==
      'ed25519'
  ) {
    throw new Error(
      'QLORA_BINDING_ED25519_PRIVATE_KEY_REQUIRED',
    );
  }

  if (
    !authorizationShapeValid(
      request.authorization,
    )
  ) {
    throw new Error(
      'QLORA_BINDING_INVALID_AUTHORIZATION',
    );
  }

  if (
    !verifyQwenQloraRunnerContract(
      request.runnerContract,
      request.runnerContractInput,
    )
  ) {
    throw new Error(
      'QLORA_BINDING_RUNNER_CONTRACT_REJECTED',
    );
  }

  if (
    !contractMatchesAuthorization(
      request.authorization,
      request.runnerContract,
    )
  ) {
    throw new Error(
      'QLORA_BINDING_AUTHORIZATION_DATA_MISMATCH',
    );
  }

  const signerFingerprint =
    publicKeySha256(
      request.authorizationPrivateKey,
    );

  if (
    signerFingerprint !==
      request.authorization
        .signerPublicKeySha256
  ) {
    throw new Error(
      'QLORA_BINDING_SIGNER_KEY_MISMATCH',
    );
  }

  const core = {
    schemaVersion:
      FULGOR_QWEN_QLORA_EXECUTION_BINDING_VERSION,

    state:
      'SIGNED_QLORA_EXECUTION_BINDING_REQUIRES_SINGLE_USE_AUTHORIZATION' as const,

    action:
      'BIND_QWEN_QLORA_CANDIDATE_TRAINING' as const,

    trainingRunId:
      request.authorization
        .trainingRunId,

    humanApproverId:
      request.authorization
        .humanApproverId,

    authorizationPayloadSha256:
      request.authorization
        .payloadSha256,

    authorizationNonce:
      request.authorization
        .nonce,

    authorizationExpiresAtUtc:
      request.authorization
        .expiresAtUtc,

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

    sourceRegistryPayloadSha256:
      request.runnerContract
        .dataBinding
        .sourceRegistryPayloadSha256,

    sourceTrainingManifestSha256:
      request.runnerContract
        .dataBinding
        .sourceTrainingManifestSha256,

    sourceFinalHoldoutCommitmentSha256:
      request.runnerContract
        .dataBinding
        .sourceFinalHoldoutCommitmentSha256,

    authorizationRequiredAtExecution:
      true as const,

    singleUseAuthorizationRequired:
      true as const,

    standaloneTrainingExecutionAuthorized:
      false as const,

    promotionAuthorized:
      false as const,

    deploymentAuthorized:
      false as const,

    signerKeyId:
      request.authorization
        .signerKeyId,

    signerPublicKeySha256:
      signerFingerprint,
  };

  const payloadBytes =
    canonicalBytes(core);

  const bindingPayloadSha256 =
    createHash('sha256')
      .update(payloadBytes)
      .digest('hex');

  const signatureBase64 =
    Buffer.from(
      cryptoSign(
        null,
        payloadBytes,
        request.authorizationPrivateKey,
      ),
    ).toString(
      'base64',
    );

  return Object.freeze({
    ...core,

    bindingPayloadSha256,

    signatureAlgorithm:
      'Ed25519' as const,

    signatureBase64,
  });
}

export function verifyQwenQloraExecutionBindingWithPolicyForTesting(
  binding:
    QwenQloraExecutionBinding,

  authorization:
    TrainingExecutionAuthorization,

  runnerContract:
    QwenQloraRunnerContract,

  runnerContractInput:
    QwenQloraRunnerContractInput,

  trustPolicy:
    TrainingAuthorizationTrustPolicy,
): QwenQloraExecutionBindingVerification {
  const failures:
    QwenQloraExecutionBindingFailureCode[] = [];

  if (
    !authorizationShapeValid(
      authorization,
    )
  ) {
    failures.push(
      'INVALID_AUTHORIZATION',
    );
  }

  if (
    !verifyQwenQloraRunnerContract(
      runnerContract,
      runnerContractInput,
    )
  ) {
    failures.push(
      'RUNNER_CONTRACT_REJECTED',
    );
  }

  if (
    !contractMatchesAuthorization(
      authorization,
      runnerContract,
    ) ||
    binding.trainingRunId !==
      authorization.trainingRunId ||
    binding.humanApproverId !==
      authorization.humanApproverId ||
    binding.authorizationPayloadSha256 !==
      authorization.payloadSha256 ||
    binding.authorizationNonce !==
      authorization.nonce ||
    binding.authorizationExpiresAtUtc !==
      authorization.expiresAtUtc ||
    binding.runnerContractSha256 !==
      runnerContract.contractSha256 ||
    binding.modelId !==
      runnerContract.model.modelId ||
    binding.modelRevisionSha !==
      runnerContract.model.modelRevisionSha ||
    binding.sourceJsonlExportSha256 !==
      runnerContract
        .dataBinding
        .sourceJsonlExportSha256 ||
    binding.trainJsonlSha256 !==
      runnerContract
        .dataBinding
        .trainJsonlSha256 ||
    binding.devJsonlSha256 !==
      runnerContract
        .dataBinding
        .devJsonlSha256 ||
    binding.sourceRegistryPayloadSha256 !==
      authorization
        .sourceRegistryPayloadSha256 ||
    binding.sourceTrainingManifestSha256 !==
      authorization
        .sourceTrainingManifestSha256 ||
    binding.sourceFinalHoldoutCommitmentSha256 !==
      authorization
        .sourceFinalHoldoutCommitmentSha256 ||
    binding.signerKeyId !==
      authorization.signerKeyId ||
    binding.signerPublicKeySha256 !==
      authorization.signerPublicKeySha256
  ) {
    failures.push(
      'AUTHORIZATION_BINDING_MISMATCH',
    );
  }

  if (
    binding.authorizationRequiredAtExecution !==
      true ||
    binding.singleUseAuthorizationRequired !==
      true ||
    binding.standaloneTrainingExecutionAuthorized !==
      false ||
    binding.promotionAuthorized !==
      false ||
    binding.deploymentAuthorized !==
      false
  ) {
    failures.push(
      'AUTHORITY_ESCAPE',
    );
  }

  const core =
    bindingCore(
      binding,
    );

  const recomputedDigest =
    digest(core);

  if (
    binding.bindingPayloadSha256 !==
      recomputedDigest
  ) {
    failures.push(
      'PAYLOAD_DIGEST_MISMATCH',
    );
  }

  const signerResolution =
    resolveTrainingAuthorizationTrustedSigner(
      trustPolicy,
      {
        signerKeyId:
          binding.signerKeyId,

        signerPublicKeySha256:
          binding.signerPublicKeySha256,

        algorithm:
          binding.signatureAlgorithm,
      },
    );

  if (
    signerResolution.resolved ===
      false
  ) {
    failures.push(
      signerResolution.failureCode,
    );
  }
  else {
    let signatureValid =
      false;

    try {
      signatureValid =
        cryptoVerify(
          null,
          canonicalBytes(core),
          signerResolution.publicKey,
          Buffer.from(
            binding.signatureBase64,
            'base64',
          ),
        );
    }
    catch {
      signatureValid =
        false;
    }

    if (!signatureValid) {
      failures.push(
        'INVALID_SIGNATURE',
      );
    }
  }

  const unique =
    [...new Set(
      failures,
    )];

  return {
    accepted:
      unique.length === 0,

    failureCodes:
      unique,
  };
}

export function verifyQwenQloraExecutionBinding(
  binding:
    QwenQloraExecutionBinding,

  authorization:
    TrainingExecutionAuthorization,

  runnerContract:
    QwenQloraRunnerContract,

  runnerContractInput:
    QwenQloraRunnerContractInput,
): QwenQloraExecutionBindingVerification {
  if (
    !PRODUCTION_FULGOR_TRAINING_AUTHORIZATION_TRUST_ANCHOR_PROVISIONED
  ) {
    return {
      accepted:
        false,

      failureCodes: [
        'SIGNER_TRUST_ANCHOR_NOT_PROVISIONED',
      ],
    };
  }

  return verifyQwenQloraExecutionBindingWithPolicyForTesting(
    binding,
    authorization,
    runnerContract,
    runnerContractInput,
    PRODUCTION_FULGOR_TRAINING_AUTHORIZATION_TRUST_POLICY,
  );
}
