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
} from './trainingAuthorizationTrustPolicy';

import type {
  TrainingAuthorizationTrustPolicy,
} from './trainingAuthorizationTrustPolicy';

import {
  PRODUCTION_FULGOR_TRAINING_AUTHORIZATION_TRUST_ANCHOR_PROVISIONED,
  PRODUCTION_FULGOR_TRAINING_AUTHORIZATION_TRUST_POLICY,
} from './productionTrainingAuthorizationTrust';

import {
  verifySignedCorpusRegistry,
} from '../registry/signedCorpusRegistry';

import {
  verifySealedCorpusSplitBundle,
} from '../registry/sealedSplitManifest';

import type {
  SignedCorpusRegistry,
} from '../registry/signedCorpusRegistry';

import type {
  CorpusSplitBundle,
} from '../registry/sealedSplitManifest';

export const FULGOR_TRAINING_EXECUTION_AUTHORIZATION_VERSION =
  'FULGOR_TRAINING_EXECUTION_AUTHORIZATION_V1' as const;

const MAX_AUTHORIZATION_TTL_MS =
  30 * 60 * 1000;

const MAX_CLOCK_SKEW_MS =
  60 * 1000;

const TOKEN_VALUE =
  /^[A-Za-z0-9._:-]{8,128}$/;

const NONCE_VALUE =
  /^[A-Za-z0-9_-]{16,128}$/;

export interface TrainingExecutionAuthorizationRequest {
  registry:
    SignedCorpusRegistry;

  splitBundle:
    CorpusSplitBundle;

  registryPublicKey:
    KeyObject;

  authorizationPrivateKey:
    KeyObject;

  signerKeyId:
    string;

  humanApproverId:
    string;

  explicitHumanApproval:
    boolean;

  trainingRunId:
    string;

  nonce:
    string;

  issuedAtUtc:
    string;

  expiresAtUtc:
    string;
}

export interface TrainingExecutionAuthorization {
  schemaVersion:
    typeof FULGOR_TRAINING_EXECUTION_AUTHORIZATION_VERSION;

  state:
    'SIGNED_SINGLE_USE_TRAINING_EXECUTION_AUTHORIZATION';

  action:
    'START_CANDIDATE_TRAINING';

  trainingRunId:
    string;

  humanApproverId:
    string;

  explicitHumanApproval:
    true;

  sourceRegistryPayloadSha256:
    string;

  sourceTrainingManifestSha256:
    string;

  sourceFinalHoldoutCommitmentSha256:
    string;

  nonce:
    string;

  issuedAtUtc:
    string;

  expiresAtUtc:
    string;

  trainingExecutionAuthorized:
    true;

  promotionAuthorized:
    false;

  deploymentAuthorized:
    false;

  signerKeyId:
    string;

  signerPublicKeySha256:
    string;

  payloadSha256:
    string;

  signatureAlgorithm:
    'Ed25519';

  signatureBase64:
    string;
}

export type TrainingAuthorizationFailureCode =
  | 'REGISTRY_REJECTED'
  | 'SPLIT_BUNDLE_REJECTED'
  | 'INVALID_ACTION'
  | 'HUMAN_APPROVAL_REQUIRED'
  | 'INVALID_RUN_ID'
  | 'INVALID_APPROVER_ID'
  | 'INVALID_NONCE'
  | 'INVALID_TIME_WINDOW'
  | 'AUTHORIZATION_TTL_TOO_LONG'
  | 'AUTHORIZATION_NOT_YET_VALID'
  | 'AUTHORIZATION_EXPIRED'
  | 'REGISTRY_BINDING_MISMATCH'
  | 'MANIFEST_BINDING_MISMATCH'
  | 'HOLDOUT_BINDING_MISMATCH'
  | 'SIGNER_TRUST_ANCHOR_NOT_PROVISIONED'
  | 'SIGNER_TRUST_POLICY_INVALID'
  | 'UNKNOWN_SIGNER'
  | 'SIGNER_REVOKED'
  | 'SIGNER_ALGORITHM_MISMATCH'
  | 'SIGNER_FINGERPRINT_MISMATCH'
  | 'PUBLIC_KEY_MISMATCH'
  | 'PAYLOAD_DIGEST_MISMATCH'
  | 'INVALID_SIGNATURE'
  | 'REPLAY_DETECTED'
  | 'REPLAY_BACKEND_UNAVAILABLE'
  | 'AUTHORITY_ESCAPE';

export interface TrainingAuthorizationConsumeResult {
  authorized: boolean;

  nonceConsumed: boolean;

  failureCodes:
    readonly TrainingAuthorizationFailureCode[];
}

export type TrainingAuthorizationReplayConsumeResult =
  | 'CONSUMED'
  | 'ALREADY_CONSUMED'
  | 'BACKEND_UNAVAILABLE';

export interface TrainingAuthorizationReplayStore {
  /*
   * Production implementations MUST perform the check-and-consume
   * operation atomically in one authoritative durable transaction.
   *
   * A separate preflight read is not an authorization primitive.
   *
   * Implementations may be synchronous test stores or asynchronous
   * durable production stores.
   */
  consumeOnce(
    authorization:
      Readonly<TrainingExecutionAuthorization>,
  ):
    | TrainingAuthorizationReplayConsumeResult
    | Promise<TrainingAuthorizationReplayConsumeResult>;
}

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

  if (
    typeof value === 'number'
  ) {
    if (!Number.isFinite(value)) {
      throw new Error(
        'AUTH_NON_CANONICAL_NUMBER',
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
      value as Record<
        string,
        unknown
      >;

    const target:
      Record<
        string,
        unknown
      > = {};

    for (
      const key of
      Object.keys(source).sort()
    ) {
      const item =
        source[key];

      if (item === undefined) {
        throw new Error(
          'AUTH_NON_CANONICAL_UNDEFINED',
        );
      }

      target[key] =
        normalize(item);
    }

    return target;
  }

  throw new Error(
    'AUTH_NON_CANONICAL_VALUE',
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

function sha256(
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

  const exported =
    publicKey.export({
      type: 'spki',
      format: 'der',
    });

  return createHash('sha256')
    .update(exported)
    .digest('hex');
}

function parseTime(
  value: string,
): number {
  return Date.parse(value);
}

function unsignedPayload(
  authorization:
    Omit<
      TrainingExecutionAuthorization,
      'payloadSha256'
        | 'signatureAlgorithm'
        | 'signatureBase64'
    >,
) {
  return authorization;
}

export function createInMemoryTrainingAuthorizationReplayStore():
  TrainingAuthorizationReplayStore {
  const consumed =
    new Set<string>();

  return {
    consumeOnce(
      authorization:
        Readonly<TrainingExecutionAuthorization>,
    ):
      TrainingAuthorizationReplayConsumeResult {
      const replayIdentity =
        authorization.payloadSha256;

      if (
        consumed.has(
          replayIdentity,
        )
      ) {
        return 'ALREADY_CONSUMED';
      }

      consumed.add(
        replayIdentity,
      );

      return 'CONSUMED';
    },
  };
}

export function createTrainingExecutionAuthorization(
  request:
    TrainingExecutionAuthorizationRequest,
): TrainingExecutionAuthorization {
  if (
    request.authorizationPrivateKey
      .type !==
      'private'
  ) {
    throw new Error(
      'AUTH_PRIVATE_KEY_REQUIRED',
    );
  }

  const registryVerification =
    verifySignedCorpusRegistry(
      request.registry,
      request.registryPublicKey,
    );

  if (!registryVerification.accepted) {
    throw new Error(
      'AUTH_REGISTRY_REJECTED',
    );
  }

  const splitVerification =
    verifySealedCorpusSplitBundle(
      request.splitBundle,
      request.registry,
      request.registryPublicKey,
    );

  if (!splitVerification.accepted) {
    throw new Error(
      'AUTH_SPLIT_BUNDLE_REJECTED',
    );
  }

  if (
    request.explicitHumanApproval !==
      true
  ) {
    throw new Error(
      'AUTH_HUMAN_APPROVAL_REQUIRED',
    );
  }

  if (
    !TOKEN_VALUE.test(
      request.trainingRunId,
    )
  ) {
    throw new Error(
      'AUTH_INVALID_RUN_ID',
    );
  }

  if (
    !TOKEN_VALUE.test(
      request.humanApproverId,
    )
  ) {
    throw new Error(
      'AUTH_INVALID_APPROVER_ID',
    );
  }

  if (
    !TOKEN_VALUE.test(
      request.signerKeyId,
    )
  ) {
    throw new Error(
      'AUTH_INVALID_SIGNER_ID',
    );
  }

  if (
    !NONCE_VALUE.test(
      request.nonce,
    )
  ) {
    throw new Error(
      'AUTH_INVALID_NONCE',
    );
  }

  const issued =
    parseTime(
      request.issuedAtUtc,
    );

  const expires =
    parseTime(
      request.expiresAtUtc,
    );

  if (
    Number.isNaN(issued) ||
    Number.isNaN(expires) ||
    expires <= issued
  ) {
    throw new Error(
      'AUTH_INVALID_TIME_WINDOW',
    );
  }

  if (
    expires - issued >
      MAX_AUTHORIZATION_TTL_MS
  ) {
    throw new Error(
      'AUTH_TTL_TOO_LONG',
    );
  }

  const core =
    unsignedPayload({
      schemaVersion:
        FULGOR_TRAINING_EXECUTION_AUTHORIZATION_VERSION,

      state:
        'SIGNED_SINGLE_USE_TRAINING_EXECUTION_AUTHORIZATION',

      action:
        'START_CANDIDATE_TRAINING',

      trainingRunId:
        request.trainingRunId,

      humanApproverId:
        request.humanApproverId,

      explicitHumanApproval:
        true,

      sourceRegistryPayloadSha256:
        request.registry
          .registryPayloadSha256,

      sourceTrainingManifestSha256:
        request.splitBundle
          .trainingView
          .manifestSha256,

      sourceFinalHoldoutCommitmentSha256:
        request.splitBundle
          .sealedFinalHoldout
          .holdoutCommitmentSha256,

      nonce:
        request.nonce,

      issuedAtUtc:
        request.issuedAtUtc,

      expiresAtUtc:
        request.expiresAtUtc,

      trainingExecutionAuthorized:
        true,

      promotionAuthorized:
        false,

      deploymentAuthorized:
        false,

      signerKeyId:
        request.signerKeyId,

      signerPublicKeySha256:
        publicKeySha256(
          request.authorizationPrivateKey,
        ),
    });

  const payloadBytes =
    canonicalBytes(
      core,
    );

  const payloadSha256 =
    createHash('sha256')
      .update(
        payloadBytes,
      )
      .digest('hex');

  const signatureBase64 =
    Buffer.from(
      cryptoSign(
        null,
        payloadBytes,
        request
          .authorizationPrivateKey,
      ),
    ).toString(
      'base64',
    );

  return {
    ...core,

    payloadSha256,

    signatureAlgorithm:
      'Ed25519',

    signatureBase64,
  };
}

export async function consumeTrainingExecutionAuthorizationWithPolicyForTesting(
  authorization:
    TrainingExecutionAuthorization,

  registry:
    SignedCorpusRegistry,

  splitBundle:
    CorpusSplitBundle,

  registryPublicKey:
    KeyObject,

  authorizationTrustPolicy:
    TrainingAuthorizationTrustPolicy,

  replayStore:
    TrainingAuthorizationReplayStore,

  nowUtc:
    string,
): Promise<TrainingAuthorizationConsumeResult> {
  const failures:
    TrainingAuthorizationFailureCode[] = [];

  const registryVerification =
    verifySignedCorpusRegistry(
      registry,
      registryPublicKey,
    );

  if (!registryVerification.accepted) {
    failures.push(
      'REGISTRY_REJECTED',
    );
  }

  const splitVerification =
    verifySealedCorpusSplitBundle(
      splitBundle,
      registry,
      registryPublicKey,
    );

  if (!splitVerification.accepted) {
    failures.push(
      'SPLIT_BUNDLE_REJECTED',
    );
  }

  if (
    authorization.action !==
      'START_CANDIDATE_TRAINING'
  ) {
    failures.push(
      'INVALID_ACTION',
    );
  }

  if (
    authorization
      .explicitHumanApproval !==
      true
  ) {
    failures.push(
      'HUMAN_APPROVAL_REQUIRED',
    );
  }

  if (
    !TOKEN_VALUE.test(
      authorization
        .trainingRunId,
    )
  ) {
    failures.push(
      'INVALID_RUN_ID',
    );
  }

  if (
    !TOKEN_VALUE.test(
      authorization
        .humanApproverId,
    )
  ) {
    failures.push(
      'INVALID_APPROVER_ID',
    );
  }

  if (
    !NONCE_VALUE.test(
      authorization.nonce,
    )
  ) {
    failures.push(
      'INVALID_NONCE',
    );
  }

  if (
    authorization
      .trainingExecutionAuthorized !==
      true ||
    authorization
      .promotionAuthorized !==
      false ||
    authorization
      .deploymentAuthorized !==
      false
  ) {
    failures.push(
      'AUTHORITY_ESCAPE',
    );
  }

  if (
    authorization
      .sourceRegistryPayloadSha256 !==
      registry
        .registryPayloadSha256
  ) {
    failures.push(
      'REGISTRY_BINDING_MISMATCH',
    );
  }

  if (
    authorization
      .sourceTrainingManifestSha256 !==
      splitBundle
        .trainingView
        .manifestSha256
  ) {
    failures.push(
      'MANIFEST_BINDING_MISMATCH',
    );
  }

  if (
    authorization
      .sourceFinalHoldoutCommitmentSha256 !==
      splitBundle
        .sealedFinalHoldout
        .holdoutCommitmentSha256
  ) {
    failures.push(
      'HOLDOUT_BINDING_MISMATCH',
    );
  }

  const signerResolution =
    resolveTrainingAuthorizationTrustedSigner(
      authorizationTrustPolicy,
      {
        signerKeyId:
          authorization.signerKeyId,

        signerPublicKeySha256:
          authorization.signerPublicKeySha256,

        algorithm:
          authorization.signatureAlgorithm,
      },
    );

  let trustedAuthorizationPublicKey:
    KeyObject | null =
      null;

  if (
    signerResolution.resolved ===
      false
  ) {
    failures.push(
      signerResolution.failureCode,
    );
  }
  else {
    trustedAuthorizationPublicKey =
      signerResolution.publicKey;
  }

  const {
    payloadSha256:
      _payloadSha256,

    signatureAlgorithm:
      _signatureAlgorithm,

    signatureBase64:
      _signatureBase64,

    ...core
  } = authorization;

  const payloadBytes =
    canonicalBytes(
      core,
    );

  const recomputedPayloadSha256 =
    createHash('sha256')
      .update(payloadBytes)
      .digest('hex');

  if (
    authorization
      .payloadSha256 !==
      recomputedPayloadSha256
  ) {
    failures.push(
      'PAYLOAD_DIGEST_MISMATCH',
    );
  }

  if (
    trustedAuthorizationPublicKey !==
      null
  ) {
    let signatureValid =
      false;

    try {
      signatureValid =
        cryptoVerify(
          null,
          payloadBytes,
          trustedAuthorizationPublicKey,
          Buffer.from(
            authorization
              .signatureBase64,
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

  const issued =
    parseTime(
      authorization.issuedAtUtc,
    );

  const expires =
    parseTime(
      authorization.expiresAtUtc,
    );

  const now =
    parseTime(
      nowUtc,
    );

  if (
    Number.isNaN(issued) ||
    Number.isNaN(expires) ||
    Number.isNaN(now) ||
    expires <= issued
  ) {
    failures.push(
      'INVALID_TIME_WINDOW',
    );
  }
  else {
    if (
      expires - issued >
        MAX_AUTHORIZATION_TTL_MS
    ) {
      failures.push(
        'AUTHORIZATION_TTL_TOO_LONG',
      );
    }

    if (
      issued >
        now + MAX_CLOCK_SKEW_MS
    ) {
      failures.push(
        'AUTHORIZATION_NOT_YET_VALID',
      );
    }

    if (now > expires) {
      failures.push(
        'AUTHORIZATION_EXPIRED',
      );
    }
  }


  const uniqueFailures =
    [...new Set(
      failures,
    )];

  if (
    uniqueFailures.length >
      0
  ) {
    return {
      authorized:
        false,

      nonceConsumed:
        false,

      failureCodes:
        uniqueFailures,
    };
  }

  let consumeResult:
    TrainingAuthorizationReplayConsumeResult;

  try {
    consumeResult =
      await replayStore.consumeOnce(
        authorization,
      );
  }
  catch {
    return {
      authorized:
        false,

      nonceConsumed:
        false,

      failureCodes: [
        'REPLAY_BACKEND_UNAVAILABLE',
      ],
    };
  }

  if (
    consumeResult ===
      'ALREADY_CONSUMED'
  ) {
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

  if (
    consumeResult !==
      'CONSUMED'
  ) {
    return {
      authorized:
        false,

      nonceConsumed:
        false,

      failureCodes: [
        'REPLAY_BACKEND_UNAVAILABLE',
      ],
    };
  }

  return {
    authorized:
      true,

    nonceConsumed:
      true,

    failureCodes: [],
  };
}
/**
 * Canonical production entrypoint.
 *
 * Security boundary:
 * - caller cannot provide signer public key
 * - caller cannot provide trust policy
 * - caller cannot override verification time
 * - production trust anchor must be provisioned server-side
 */
export async function consumeTrainingExecutionAuthorization(
  authorization:
    TrainingExecutionAuthorization,

  registry:
    SignedCorpusRegistry,

  splitBundle:
    CorpusSplitBundle,

  registryPublicKey:
    KeyObject,

  replayStore:
    TrainingAuthorizationReplayStore,
): Promise<TrainingAuthorizationConsumeResult> {
  if (
    !PRODUCTION_FULGOR_TRAINING_AUTHORIZATION_TRUST_ANCHOR_PROVISIONED
  ) {
    return {
      authorized:
        false,

      nonceConsumed:
        false,

      failureCodes: [
        'SIGNER_TRUST_ANCHOR_NOT_PROVISIONED',
      ],
    };
  }

  return consumeTrainingExecutionAuthorizationWithPolicyForTesting(
    authorization,
    registry,
    splitBundle,
    registryPublicKey,
    PRODUCTION_FULGOR_TRAINING_AUTHORIZATION_TRUST_POLICY,
    replayStore,
    new Date().toISOString(),
  );
}
