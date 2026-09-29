import {
  createHash,
  createPublicKey,
} from 'node:crypto';

import type {
  KeyObject,
} from 'node:crypto';

export const FULGOR_TRAINING_AUTHORIZATION_TRUST_POLICY_VERSION =
  'FULGOR_TRAINING_AUTHORIZATION_TRUST_POLICY_V1' as const;

export type TrainingAuthorizationSignerStatus =
  | 'ACTIVE'
  | 'REVOKED';

export interface TrainingAuthorizationTrustedSigner {
  readonly signerKeyId:
    string;

  readonly status:
    TrainingAuthorizationSignerStatus;

  readonly algorithm:
    'Ed25519';

  readonly signerPublicKeySha256:
    string;

  readonly publicKeyPem:
    string;
}

export interface TrainingAuthorizationTrustPolicy {
  readonly schemaVersion:
    typeof FULGOR_TRAINING_AUTHORIZATION_TRUST_POLICY_VERSION;

  readonly signers:
    readonly TrainingAuthorizationTrustedSigner[];
}

export type TrainingAuthorizationTrustFailureCode =
  | 'SIGNER_TRUST_POLICY_INVALID'
  | 'UNKNOWN_SIGNER'
  | 'SIGNER_REVOKED'
  | 'SIGNER_ALGORITHM_MISMATCH'
  | 'SIGNER_FINGERPRINT_MISMATCH';

export type TrainingAuthorizationSignerResolution =
  | {
      readonly resolved:
        true;

      readonly signer:
        TrainingAuthorizationTrustedSigner;

      readonly publicKey:
        KeyObject;

      readonly errors:
        readonly [];
    }
  | {
      readonly resolved:
        false;

      readonly failureCode:
        TrainingAuthorizationTrustFailureCode;

      readonly errors:
        readonly string[];
    };

interface TrustPolicyValidationResult {
  readonly valid:
    boolean;

  readonly errors:
    readonly string[];

  readonly signers?:
    readonly TrainingAuthorizationTrustedSigner[];
}

const EXACT_POLICY_KEYS =
  Object.freeze([
    'schemaVersion',
    'signers',
  ] as const);

const EXACT_SIGNER_KEYS =
  Object.freeze([
    'signerKeyId',
    'status',
    'algorithm',
    'signerPublicKeySha256',
    'publicKeyPem',
  ] as const);

const SAFE_SIGNER_ID =
  /^[A-Za-z0-9._:-]{1,128}$/;

const SHA256_HEX =
  /^[0-9a-f]{64}$/;

function fingerprintPublicKey(
  key:
    KeyObject,
): string {
  const exported =
    key.export({
      type:
        'spki',

      format:
        'der',
    });

  return createHash('sha256')
    .update(exported)
    .digest('hex');
}

export function computeTrainingAuthorizationPublicKeySha256FromPem(
  publicKeyPem:
    string,
): string {
  if (
    typeof publicKeyPem !==
      'string' ||
    publicKeyPem.length <
      1 ||
    publicKeyPem.length >
      8192
  ) {
    throw new Error(
      'TRUST_PUBLIC_KEY_PEM_INVALID',
    );
  }

  if (
    /PRIVATE\s+KEY/i.test(
      publicKeyPem,
    )
  ) {
    throw new Error(
      'TRUST_PRIVATE_KEY_MATERIAL_FORBIDDEN',
    );
  }

  const key =
    createPublicKey(
      publicKeyPem,
    );

  if (
    key.type !==
      'public'
  ) {
    throw new Error(
      'TRUST_PUBLIC_KEY_TYPE_INVALID',
    );
  }

  if (
    key.asymmetricKeyType !==
      'ed25519'
  ) {
    throw new Error(
      'TRUST_PUBLIC_KEY_ALGORITHM_INVALID',
    );
  }

  return fingerprintPublicKey(
    key,
  );
}

function validateSigner(
  candidate:
    unknown,
):
  | {
      valid:
        true;

      signer:
        TrainingAuthorizationTrustedSigner;

      errors:
        readonly [];
    }
  | {
      valid:
        false;

      errors:
        readonly string[];
    } {
  const errors:
    string[] = [];

  if (
    !candidate ||
    typeof candidate !==
      'object' ||
    Array.isArray(candidate)
  ) {
    return {
      valid:
        false,

      errors: [
        'TRUST_SIGNER_INVALID_OBJECT',
      ],
    };
  }

  const object =
    candidate as
      Record<string, unknown>;

  for (
    const key of
    Object.keys(object)
  ) {
    if (
      !EXACT_SIGNER_KEYS.includes(
        key as
          typeof EXACT_SIGNER_KEYS[number],
      )
    ) {
      errors.push(
        `TRUST_SIGNER_UNKNOWN_PROPERTY:${key}`,
      );
    }
  }

  for (
    const key of
    EXACT_SIGNER_KEYS
  ) {
    if (
      !Object.prototype
        .hasOwnProperty
        .call(
          object,
          key,
        )
    ) {
      errors.push(
        `TRUST_SIGNER_MISSING_PROPERTY:${key}`,
      );
    }
  }

  if (
    errors.length >
      0
  ) {
    return {
      valid:
        false,

      errors,
    };
  }

  const {
    signerKeyId,
    status,
    algorithm,
    signerPublicKeySha256,
    publicKeyPem,
  } = object;

  if (
    typeof signerKeyId !==
      'string' ||
    !SAFE_SIGNER_ID.test(
      signerKeyId,
    )
  ) {
    errors.push(
      'TRUST_SIGNER_ID_INVALID',
    );
  }

  if (
    status !==
      'ACTIVE' &&
    status !==
      'REVOKED'
  ) {
    errors.push(
      'TRUST_SIGNER_STATUS_INVALID',
    );
  }

  if (
    algorithm !==
      'Ed25519'
  ) {
    errors.push(
      'TRUST_SIGNER_ALGORITHM_INVALID',
    );
  }

  if (
    typeof signerPublicKeySha256 !==
      'string' ||
    !SHA256_HEX.test(
      signerPublicKeySha256,
    )
  ) {
    errors.push(
      'TRUST_SIGNER_FINGERPRINT_INVALID',
    );
  }

  if (
    typeof publicKeyPem !==
      'string'
  ) {
    errors.push(
      'TRUST_SIGNER_PUBLIC_KEY_INVALID',
    );
  }

  if (
    errors.length ===
      0
  ) {
    try {
      const recomputed =
        computeTrainingAuthorizationPublicKeySha256FromPem(
          publicKeyPem as
            string,
        );

      if (
        recomputed !==
          signerPublicKeySha256
      ) {
        errors.push(
          'TRUST_SIGNER_FINGERPRINT_KEY_MISMATCH',
        );
      }
    }
    catch (
      error
    ) {
      errors.push(
        error instanceof Error
          ? error.message
          : 'TRUST_SIGNER_PUBLIC_KEY_PARSE_FAILED',
      );
    }
  }

  if (
    errors.length >
      0
  ) {
    return {
      valid:
        false,

      errors,
    };
  }

  return {
    valid:
      true,

    errors: [],

    signer:
      Object.freeze({
        signerKeyId:
          signerKeyId as
            string,

        status:
          status as
            TrainingAuthorizationSignerStatus,

        algorithm:
          'Ed25519',

        signerPublicKeySha256:
          signerPublicKeySha256 as
            string,

        publicKeyPem:
          publicKeyPem as
            string,
      }),
  };
}

export function validateTrainingAuthorizationTrustPolicy(
  candidate:
    unknown,
): TrustPolicyValidationResult {
  const errors:
    string[] = [];

  if (
    !candidate ||
    typeof candidate !==
      'object' ||
    Array.isArray(candidate)
  ) {
    return {
      valid:
        false,

      errors: [
        'TRUST_POLICY_INVALID_OBJECT',
      ],
    };
  }

  const object =
    candidate as
      Record<string, unknown>;

  for (
    const key of
    Object.keys(object)
  ) {
    if (
      !EXACT_POLICY_KEYS.includes(
        key as
          typeof EXACT_POLICY_KEYS[number],
      )
    ) {
      errors.push(
        `TRUST_POLICY_UNKNOWN_PROPERTY:${key}`,
      );
    }
  }

  for (
    const key of
    EXACT_POLICY_KEYS
  ) {
    if (
      !Object.prototype
        .hasOwnProperty
        .call(
          object,
          key,
        )
    ) {
      errors.push(
        `TRUST_POLICY_MISSING_PROPERTY:${key}`,
      );
    }
  }

  if (
    object.schemaVersion !==
      FULGOR_TRAINING_AUTHORIZATION_TRUST_POLICY_VERSION
  ) {
    errors.push(
      'TRUST_POLICY_VERSION_INVALID',
    );
  }

  if (
    !Array.isArray(
      object.signers,
    )
  ) {
    errors.push(
      'TRUST_POLICY_SIGNERS_NOT_ARRAY',
    );

    return {
      valid:
        false,

      errors,
    };
  }

  const signers:
    TrainingAuthorizationTrustedSigner[] = [];

  const signerIds =
    new Set<string>();

  const fingerprints =
    new Set<string>();

  object.signers
    .forEach(
      (
        rawSigner,
        index,
      ) => {
        const validation =
          validateSigner(
            rawSigner,
          );

        if (
          !validation.valid
        ) {
          for (
            const error of
            validation.errors
          ) {
            errors.push(
              `TRUST_POLICY_SIGNER_${index}:${error}`,
            );
          }

          return;
        }

        const signer =
          validation.signer;

        if (
          signerIds.has(
            signer.signerKeyId,
          )
        ) {
          errors.push(
            `TRUST_POLICY_DUPLICATE_SIGNER_ID:${signer.signerKeyId}`,
          );
        }
        else {
          signerIds.add(
            signer.signerKeyId,
          );
        }

        if (
          fingerprints.has(
            signer
              .signerPublicKeySha256,
          )
        ) {
          errors.push(
            `TRUST_POLICY_DUPLICATE_FINGERPRINT:${signer.signerPublicKeySha256}`,
          );
        }
        else {
          fingerprints.add(
            signer
              .signerPublicKeySha256,
          );
        }

        signers.push(
          signer,
        );
      },
    );

  return {
    valid:
      errors.length ===
        0,

    errors,

    signers,
  };
}

export function createTrainingAuthorizationTrustPolicy(
  signers:
    readonly unknown[],
): TrainingAuthorizationTrustPolicy {
  const candidate = {
    schemaVersion:
      FULGOR_TRAINING_AUTHORIZATION_TRUST_POLICY_VERSION,

    signers:
      [...signers],
  };

  const validation =
    validateTrainingAuthorizationTrustPolicy(
      candidate,
    );

  if (
    !validation.valid ||
    !validation.signers
  ) {
    throw new Error(
      `TRUST_POLICY_INVALID:${validation.errors.join('|')}`,
    );
  }

  return Object.freeze({
    schemaVersion:
      FULGOR_TRAINING_AUTHORIZATION_TRUST_POLICY_VERSION,

    signers:
      Object.freeze(
        validation.signers.map(
          signer =>
            Object.freeze({
              ...signer,
            }),
        ),
      ),
  });
}

export function resolveTrainingAuthorizationTrustedSigner(
  policy:
    TrainingAuthorizationTrustPolicy,

  selector: {
    readonly signerKeyId:
      string;

    readonly signerPublicKeySha256:
      string;

    readonly algorithm:
      string;
  },
): TrainingAuthorizationSignerResolution {
  const validation =
    validateTrainingAuthorizationTrustPolicy(
      policy,
    );

  if (
    !validation.valid ||
    !validation.signers
  ) {
    return {
      resolved:
        false,

      failureCode:
        'SIGNER_TRUST_POLICY_INVALID',

      errors:
        validation.errors,
    };
  }

  const signer =
    validation.signers.find(
      candidate =>
        candidate
          .signerKeyId ===
        selector.signerKeyId,
    );

  if (!signer) {
    return {
      resolved:
        false,

      failureCode:
        'UNKNOWN_SIGNER',

      errors: [
        'TRUST_SIGNER_NOT_FOUND',
      ],
    };
  }

  if (
    signer.status ===
      'REVOKED'
  ) {
    return {
      resolved:
        false,

      failureCode:
        'SIGNER_REVOKED',

      errors: [
        'TRUST_SIGNER_REVOKED',
      ],
    };
  }

  if (
    selector.algorithm !==
      signer.algorithm
  ) {
    return {
      resolved:
        false,

      failureCode:
        'SIGNER_ALGORITHM_MISMATCH',

      errors: [
        'TRUST_SIGNER_ALGORITHM_MISMATCH',
      ],
    };
  }

  if (
    selector
      .signerPublicKeySha256 !==
    signer
      .signerPublicKeySha256
  ) {
    return {
      resolved:
        false,

      failureCode:
        'SIGNER_FINGERPRINT_MISMATCH',

      errors: [
        'TRUST_SIGNER_FINGERPRINT_MISMATCH',
      ],
    };
  }

  try {
    const publicKey =
      createPublicKey(
        signer.publicKeyPem,
      );

    return {
      resolved:
        true,

      signer,

      publicKey,

      errors: [],
    };
  }
  catch {
    return {
      resolved:
        false,

      failureCode:
        'SIGNER_TRUST_POLICY_INVALID',

      errors: [
        'TRUST_SIGNER_PUBLIC_KEY_PARSE_FAILED',
      ],
    };
  }
}
