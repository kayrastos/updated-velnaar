import {
  createHash,
  randomBytes,
} from 'node:crypto';

import type {
  QwenQloraLaunchCapabilityIssueRequest,
  QwenQloraLaunchCapabilityIssuer,
} from './qwenQloraAuthorizedLaunchGate';

export const FULGOR_GCE_QLORA_LAUNCH_CAPABILITY_VERSION =
  'FULGOR_GCE_QLORA_LAUNCH_CAPABILITY_V1' as const;

export const FULGOR_GCE_QLORA_LAUNCH_AUTHORITY =
  'FULGOR_GCE_QLORA_LAUNCH_AUTHORITY_V1' as const;

export const FULGOR_GCE_QLORA_LAUNCH_SIGNATURE_ALGORITHM =
  'Ed25519' as const;

const DOMAIN =
  'velnar.fulgor.gce-qlora-launch-capability.v1\u0000';

const SHA256 =
  /^[a-f0-9]{64}$/;

const SHA40 =
  /^[a-f0-9]{40}$/;

const CAPABILITY_ID =
  /^[a-f0-9]{64}$/;

const KEY_ID =
  /^[A-Za-z0-9._:-]{1,128}$/;

const PROJECT_ID =
  /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

const SERVICE_ACCOUNT =
  /^[a-z0-9][a-z0-9._-]*@[a-z0-9-]+\.iam\.gserviceaccount\.com$/i;

const DIGEST_IMAGE =
  /^[^\s@]+@sha256:[a-f0-9]{64}$/;

const UTC =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export type GceQloraZone =
  | 'europe-west4-a'
  | 'europe-west4-b'
  | 'europe-west4-c';

export type GceQloraLaunchCapabilityFailureCode =
  | 'INVALID_SIGNER'
  | 'INVALID_PROJECT_ID'
  | 'INVALID_ZONE'
  | 'INVALID_RUNTIME_SERVICE_ACCOUNT'
  | 'INVALID_CONTAINER_IMAGE_DIGEST'
  | 'INVALID_TTL'
  | 'INVALID_CAPABILITY_ID'
  | 'INVALID_ISSUE_REQUEST'
  | 'AUTHORIZATION_ALREADY_EXPIRED'
  | 'SIGNER_FAILURE'
  | 'INVALID_SIGNATURE_LENGTH';

export class GceQloraLaunchCapabilityError
extends Error {
  readonly code:
    GceQloraLaunchCapabilityFailureCode;

  constructor(
    code:
      GceQloraLaunchCapabilityFailureCode,
  ) {
    super(code);

    this.name =
      'GceQloraLaunchCapabilityError';

    this.code =
      code;
  }
}

export interface GceQloraLaunchCapabilitySigner {
  algorithm:
    typeof FULGOR_GCE_QLORA_LAUNCH_SIGNATURE_ALGORITHM;

  keyId:
    string;

  sign(
    payload:
      Uint8Array,
  ):
    Promise<Uint8Array>;
}

export interface GceQloraLaunchCapabilityVerifier {
  algorithm:
    typeof FULGOR_GCE_QLORA_LAUNCH_SIGNATURE_ALGORITHM;

  keyId:
    string;

  verify(
    payload:
      Uint8Array,

    signature:
      Uint8Array,
  ):
    Promise<boolean>;
}

export interface GceQloraLaunchCapabilityIssuerOptions {
  projectId:
    string;

  zone:
    GceQloraZone;

  runtimeServiceAccount:
    string;

  containerImageDigest:
    string;

  maxTtlSeconds:
    number;

  signer:
    GceQloraLaunchCapabilitySigner;

  clock?:
    () => string;

  capabilityIdFactory?:
    () => string;
}

export interface GceQloraLaunchCapability {
  schemaVersion:
    typeof FULGOR_GCE_QLORA_LAUNCH_CAPABILITY_VERSION;

  authority:
    typeof FULGOR_GCE_QLORA_LAUNCH_AUTHORITY;

  algorithm:
    typeof FULGOR_GCE_QLORA_LAUNCH_SIGNATURE_ALGORITHM;

  keyId:
    string;

  capabilityId:
    string;

  issuedAtUtc:
    string;

  expiresAtUtc:
    string;

  maxLaunchCount:
    1;

  launch: {
    requestSha256:
      string;

    trainingRunId:
      string;

    authorizationPayloadSha256:
      string;

    executionBindingPayloadSha256:
      string;

    runnerContractSha256:
      string;

    sourceRegistryPayloadSha256:
      string;

    sourceTrainingManifestSha256:
      string;

    sourceJsonlExportSha256:
      string;

    trainJsonlSha256:
      string;

    devJsonlSha256:
      string;

    sourceFinalHoldoutCommitmentSha256:
      string;

    modelId:
      'Qwen/Qwen3.8-27B';

    modelRevisionSha:
      string;

    projectId:
      string;

    zone:
      GceQloraZone;

    machineType:
      'g2-standard-16';

    provisioningModel:
      'SPOT';

    expectedGpu:
      'NVIDIA_L4_24GB';

    expectedGpuCount:
      1;

    runtimeServiceAccount:
      string;

    containerImageDigest:
      string;

    finalHoldoutRecordIdsExposed:
      false;

    promotionAuthorized:
      false;

    deploymentAuthorized:
      false;
  };

  payloadSha256:
    string;

  signatureBase64:
    string;
}

function fail(
  code:
    GceQloraLaunchCapabilityFailureCode,
): never {
  throw new GceQloraLaunchCapabilityError(
    code,
  );
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
      return fail(
        'INVALID_ISSUE_REQUEST',
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
        return fail(
          'INVALID_ISSUE_REQUEST',
        );
      }

      output[key] =
        canonicalize(item);
    }

    return output;
  }

  return fail(
    'INVALID_ISSUE_REQUEST',
  );
}

function canonicalJson(
  value:
    unknown,
): string {
  return JSON.stringify(
    canonicalize(value),
  );
}

function sha256Object(
  value:
    unknown,
): string {
  return createHash('sha256')
    .update(
      canonicalJson(value),
      'utf8',
    )
    .digest('hex');
}

function signingBytes(
  body:
    Omit<
      GceQloraLaunchCapability,
      'signatureBase64'
    >,
): Uint8Array {
  return Buffer.from(
    DOMAIN +
    canonicalJson(body),
    'utf8',
  );
}

function parseUtc(
  value:
    string,
): number {
  if (!UTC.test(value)) {
    return fail(
      'INVALID_ISSUE_REQUEST',
    );
  }

  const parsed =
    Date.parse(value);

  if (!Number.isFinite(parsed)) {
    return fail(
      'INVALID_ISSUE_REQUEST',
    );
  }

  return parsed;
}

function assertSha256(
  value:
    string,
): void {
  if (!SHA256.test(value)) {
    return fail(
      'INVALID_ISSUE_REQUEST',
    );
  }
}

function assertIssueRequest(
  request:
    Readonly<QwenQloraLaunchCapabilityIssueRequest>,
): void {
  if (
    request.schemaVersion !==
      'FULGOR_QWEN_QLORA_LAUNCH_CAPABILITY_REQUEST_V1' ||
    request.authorizationConsumed !==
      true ||
    request.finalHoldoutRecordIdsExposed !==
      false ||
    request.promotionAuthorized !==
      false ||
    request.deploymentAuthorized !==
      false ||
    request.targetRuntime !==
      'GCE_SPOT_SINGLE_L4_24GB' ||
    request.expectedGpu !==
      'NVIDIA_L4_24GB' ||
    request.expectedGpuCount !==
      1 ||
    request.modelId !==
      'Qwen/Qwen3.8-27B' ||
    !SHA40.test(
      request.modelRevisionSha,
    )
  ) {
    return fail(
      'INVALID_ISSUE_REQUEST',
    );
  }

  for (
    const value of [
      request.requestSha256,
      request.authorizationPayloadSha256,
      request.executionBindingPayloadSha256,
      request.runnerContractSha256,
      request.sourceRegistryPayloadSha256,
      request.sourceTrainingManifestSha256,
      request.sourceJsonlExportSha256,
      request.trainJsonlSha256,
      request.devJsonlSha256,
      request.sourceFinalHoldoutCommitmentSha256,
    ]
  ) {
    assertSha256(value);
  }

  parseUtc(
    request.authorizationExpiresAtUtc,
  );

  if (
    typeof request.trainingRunId !==
      'string' ||
    request.trainingRunId.length ===
      0 ||
    request.trainingRunId.length >
      256
  ) {
    return fail(
      'INVALID_ISSUE_REQUEST',
    );
  }
}

function capabilityCore(
  capability:
    GceQloraLaunchCapability,
) {
  return {
    capabilityId:
      capability.capabilityId,

    issuedAtUtc:
      capability.issuedAtUtc,

    expiresAtUtc:
      capability.expiresAtUtc,

    maxLaunchCount:
      capability.maxLaunchCount,

    launch:
      capability.launch,
  };
}

export function createGceQloraLaunchCapabilityIssuer(
  options:
    GceQloraLaunchCapabilityIssuerOptions,
): QwenQloraLaunchCapabilityIssuer<
  GceQloraLaunchCapability
> {
  if (
    options.signer.algorithm !==
      FULGOR_GCE_QLORA_LAUNCH_SIGNATURE_ALGORITHM ||
    !KEY_ID.test(
      options.signer.keyId,
    )
  ) {
    return fail(
      'INVALID_SIGNER',
    );
  }

  if (
    !PROJECT_ID.test(
      options.projectId,
    )
  ) {
    return fail(
      'INVALID_PROJECT_ID',
    );
  }

  if (
    options.zone !==
      'europe-west4-a' &&
    options.zone !==
      'europe-west4-b' &&
    options.zone !==
      'europe-west4-c'
  ) {
    return fail(
      'INVALID_ZONE',
    );
  }

  if (
    !SERVICE_ACCOUNT.test(
      options.runtimeServiceAccount,
    )
  ) {
    return fail(
      'INVALID_RUNTIME_SERVICE_ACCOUNT',
    );
  }

  if (
    options.containerImageDigest.length >
      2048 ||
    !DIGEST_IMAGE.test(
      options.containerImageDigest,
    )
  ) {
    return fail(
      'INVALID_CONTAINER_IMAGE_DIGEST',
    );
  }

  if (
    !Number.isSafeInteger(
      options.maxTtlSeconds,
    ) ||
    options.maxTtlSeconds <
      60 ||
    options.maxTtlSeconds >
      1800
  ) {
    return fail(
      'INVALID_TTL',
    );
  }

  const clock =
    options.clock ??
    (() =>
      new Date()
        .toISOString());

  const capabilityIdFactory =
    options.capabilityIdFactory ??
    (() =>
      Buffer.from(
        randomBytes(32),
      ).toString('hex'));

  return {
    async issue(
      request,
    ) {
      assertIssueRequest(
        request,
      );

      const issuedAtUtc =
        clock();

      const issuedAtMs =
        parseUtc(
          issuedAtUtc,
        );

      const authorizationExpiryMs =
        parseUtc(
          request
            .authorizationExpiresAtUtc,
        );

      if (
        authorizationExpiryMs <=
          issuedAtMs
      ) {
        return fail(
          'AUTHORIZATION_ALREADY_EXPIRED',
        );
      }

      const expiresAtMs =
        Math.min(
          issuedAtMs +
            options.maxTtlSeconds *
            1000,

          authorizationExpiryMs,
        );

      if (
        expiresAtMs <=
          issuedAtMs
      ) {
        return fail(
          'AUTHORIZATION_ALREADY_EXPIRED',
        );
      }

      const capabilityId =
        capabilityIdFactory();

      if (
        !CAPABILITY_ID.test(
          capabilityId,
        )
      ) {
        return fail(
          'INVALID_CAPABILITY_ID',
        );
      }

      const launch = {
        requestSha256:
          request.requestSha256,

        trainingRunId:
          request.trainingRunId,

        authorizationPayloadSha256:
          request
            .authorizationPayloadSha256,

        executionBindingPayloadSha256:
          request
            .executionBindingPayloadSha256,

        runnerContractSha256:
          request
            .runnerContractSha256,

        sourceRegistryPayloadSha256:
          request
            .sourceRegistryPayloadSha256,

        sourceTrainingManifestSha256:
          request
            .sourceTrainingManifestSha256,

        sourceJsonlExportSha256:
          request
            .sourceJsonlExportSha256,

        trainJsonlSha256:
          request.trainJsonlSha256,

        devJsonlSha256:
          request.devJsonlSha256,

        sourceFinalHoldoutCommitmentSha256:
          request
            .sourceFinalHoldoutCommitmentSha256,

        modelId:
          'Qwen/Qwen3.8-27B' as const,

        modelRevisionSha:
          request.modelRevisionSha,

        projectId:
          options.projectId,

        zone:
          options.zone,

        machineType:
          'g2-standard-16' as const,

        provisioningModel:
          'SPOT' as const,

        expectedGpu:
          'NVIDIA_L4_24GB' as const,

        expectedGpuCount:
          1 as const,

        runtimeServiceAccount:
          options.runtimeServiceAccount,

        containerImageDigest:
          options.containerImageDigest,

        finalHoldoutRecordIdsExposed:
          false as const,

        promotionAuthorized:
          false as const,

        deploymentAuthorized:
          false as const,
      };

      const core = {
        capabilityId,

        issuedAtUtc,

        expiresAtUtc:
          new Date(
            expiresAtMs,
          ).toISOString(),

        maxLaunchCount:
          1 as const,

        launch,
      };

      const payloadSha256 =
        sha256Object(
          core,
        );

      const body = {
        schemaVersion:
          FULGOR_GCE_QLORA_LAUNCH_CAPABILITY_VERSION,

        authority:
          FULGOR_GCE_QLORA_LAUNCH_AUTHORITY,

        algorithm:
          FULGOR_GCE_QLORA_LAUNCH_SIGNATURE_ALGORITHM,

        keyId:
          options.signer.keyId,

        ...core,

        payloadSha256,
      };

      let signature:
        Uint8Array;

      try {
        signature =
          await options.signer.sign(
            signingBytes(
              body,
            ),
          );
      }
      catch {
        return fail(
          'SIGNER_FAILURE',
        );
      }

      if (
        signature.byteLength !==
          64
      ) {
        return fail(
          'INVALID_SIGNATURE_LENGTH',
        );
      }

      return Object.freeze({
        ...body,

        launch:
          Object.freeze(
            launch,
          ),

        signatureBase64:
          Buffer.from(
            signature,
          ).toString(
            'base64',
          ),
      });
    },
  };
}

export async function verifyGceQloraLaunchCapability(
  capability:
    GceQloraLaunchCapability,

  verifier:
    GceQloraLaunchCapabilityVerifier,

  nowUtc:
    string,
): Promise<boolean> {
  if (
    capability.schemaVersion !==
      FULGOR_GCE_QLORA_LAUNCH_CAPABILITY_VERSION ||
    capability.authority !==
      FULGOR_GCE_QLORA_LAUNCH_AUTHORITY ||
    capability.algorithm !==
      FULGOR_GCE_QLORA_LAUNCH_SIGNATURE_ALGORITHM ||
    capability.keyId !==
      verifier.keyId ||
    verifier.algorithm !==
      FULGOR_GCE_QLORA_LAUNCH_SIGNATURE_ALGORITHM ||
    !KEY_ID.test(
      capability.keyId,
    ) ||
    !CAPABILITY_ID.test(
      capability.capabilityId,
    ) ||
    capability.maxLaunchCount !==
      1
  ) {
    return false;
  }

  let nowMs:
    number;

  let expiryMs:
    number;

  try {
    nowMs =
      parseUtc(nowUtc);

    expiryMs =
      parseUtc(
        capability.expiresAtUtc,
      );
  }
  catch {
    return false;
  }

  if (
    nowMs >=
      expiryMs
  ) {
    return false;
  }

  const expectedPayloadSha256 =
    sha256Object(
      capabilityCore(
        capability,
      ),
    );

  if (
    capability.payloadSha256 !==
      expectedPayloadSha256
  ) {
    return false;
  }

  let signature:
    Buffer;

  try {
    signature =
      Buffer.from(
        capability.signatureBase64,
        'base64',
      );
  }
  catch {
    return false;
  }

  if (
    signature.byteLength !==
      64 ||
    Buffer.from(
      signature,
    ).toString(
      'base64',
    ) !==
      capability.signatureBase64
  ) {
    return false;
  }

  const {
    signatureBase64:
      _signatureBase64,

    ...body
  } = capability;

  try {
    return await verifier.verify(
      signingBytes(
        body,
      ),
      signature,
    );
  }
  catch {
    return false;
  }
}
export async function verifyGceQloraLaunchCapabilityForTesting(
  capability:
    GceQloraLaunchCapability,

  verifier:
    GceQloraLaunchCapabilityVerifier,

  nowUtc:
    string,
): Promise<boolean> {
  return verifyGceQloraLaunchCapability(
    capability,
    verifier,
    nowUtc,
  );
}