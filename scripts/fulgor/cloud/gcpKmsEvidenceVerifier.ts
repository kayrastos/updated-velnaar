import {
  createPublicKey,
  verify as verifySignature,
  type KeyObject,
} from 'node:crypto';

import {
  GoogleAuth,
} from 'google-auth-library';

import {
  FULGOR_EVIDENCE_AUTHORITY,
  FULGOR_SIGNATURE_ALGORITHM,
  type EvidenceSignatureVerifier,
} from '../evidence/signedEvidence';

export type GcpKmsVerifierFailureCode =
  | 'INVALID_KEY_ID'
  | 'INVALID_KEY_VERSION_RESOURCE'
  | 'INVALID_PAYLOAD'
  | 'INVALID_SIGNATURE'
  | 'KMS_PUBLIC_KEY_REQUEST_FAILED'
  | 'KMS_PUBLIC_KEY_RESPONSE_INVALID'
  | 'KMS_KEY_VERSION_MISMATCH'
  | 'KMS_PUBLIC_KEY_INVALID'
  | 'KMS_PUBLIC_KEY_NOT_ED25519';

export class GcpKmsVerifierError extends Error {
  readonly code:
    GcpKmsVerifierFailureCode;

  constructor(
    code:
      GcpKmsVerifierFailureCode,
  ) {
    super(code);

    this.name =
      'GcpKmsVerifierError';

    this.code =
      code;
  }
}

export interface GcpKmsPublicKeyRequest {
  readonly url:
    string;

  readonly method:
    'GET';
}

export type GcpKmsPublicKeyRequester =
  (
    request:
      GcpKmsPublicKeyRequest,
  ) =>
    Promise<unknown>;

export interface GcpKmsEvidenceVerifierOptions {
  readonly keyId:
    string;

  readonly keyVersionResource:
    string;

  readonly requester?:
    GcpKmsPublicKeyRequester;
}

const KEY_ID =
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const KEY_VERSION_RESOURCE =
  /^projects\/[^/\s]+\/locations\/[^/\s]+\/keyRings\/[^/\s]+\/cryptoKeys\/[^/\s]+\/cryptoKeyVersions\/[^/\s]+$/;

function fail(
  code:
    GcpKmsVerifierFailureCode,
): never {
  throw new GcpKmsVerifierError(
    code,
  );
}

function isRecord(
  value:
    unknown,
): value is Record<string, unknown> {
  return (
    value !==
      null &&
    typeof value ===
      'object' &&
    !Array.isArray(
      value,
    )
  );
}

async function googlePublicKeyRequester(
  request:
    GcpKmsPublicKeyRequest,
): Promise<unknown> {
  const auth =
    new GoogleAuth({
      scopes: [
        'https://www.googleapis.com/auth/cloud-platform',
      ],
    });

  try {
    const client =
      await auth.getClient();

    const response =
      await client.request({
        url:
          request.url,

        method:
          request.method,
      });

    return response.data;
  } catch {
    return fail(
      'KMS_PUBLIC_KEY_REQUEST_FAILED',
    );
  }
}

/*
 * Independent verification authority for signed
 * FULGOR evidence.
 *
 * The private signing key never enters this process.
 * Verification uses only the exact public key of the
 * configured immutable CryptoKeyVersion.
 */
export class GcpKmsEvidenceVerifier
implements EvidenceSignatureVerifier {
  readonly authority =
    FULGOR_EVIDENCE_AUTHORITY;

  readonly algorithm =
    FULGOR_SIGNATURE_ALGORITHM;

  readonly keyId:
    string;

  private readonly keyVersionResource:
    string;

  private readonly requester:
    GcpKmsPublicKeyRequester;

  private publicKey:
    KeyObject |
    null =
      null;

  constructor(
    options:
      GcpKmsEvidenceVerifierOptions,
  ) {
    if (
      !KEY_ID.test(
        options.keyId,
      )
    ) {
      return fail(
        'INVALID_KEY_ID',
      );
    }

    if (
      options
        .keyVersionResource
        .length >
        2048 ||
      !KEY_VERSION_RESOURCE.test(
        options.keyVersionResource,
      )
    ) {
      return fail(
        'INVALID_KEY_VERSION_RESOURCE',
      );
    }

    this.keyId =
      options.keyId;

    this.keyVersionResource =
      options.keyVersionResource;

    this.requester =
      options.requester ??
      googlePublicKeyRequester;
  }

  private async loadPublicKey():
  Promise<KeyObject> {
    if (
      this.publicKey !==
        null
    ) {
      return this.publicKey;
    }

    const url =
      'https://cloudkms.googleapis.com/v1/' +
      this.keyVersionResource +
      '/publicKey';

    let raw:
      unknown;

    try {
      raw =
        await this.requester({
          url,
          method:
            'GET',
        });
    } catch {
      return fail(
        'KMS_PUBLIC_KEY_REQUEST_FAILED',
      );
    }

    if (
      !isRecord(
        raw,
      ) ||
      raw.name !==
        this.keyVersionResource ||
      typeof raw.pem !==
        'string' ||
      raw.pem.length <
        1 ||
      raw.pem.length >
        64 * 1024
    ) {
      return fail(
        raw !==
          null &&
        typeof raw ===
          'object' &&
        'name' in raw &&
        raw.name !==
          this.keyVersionResource
          ? 'KMS_KEY_VERSION_MISMATCH'
          : 'KMS_PUBLIC_KEY_RESPONSE_INVALID',
      );
    }

    let key:
      KeyObject;

    try {
      key =
        createPublicKey(
          raw.pem,
        );
    } catch {
      return fail(
        'KMS_PUBLIC_KEY_INVALID',
      );
    }

    if (
      key.asymmetricKeyType !==
        'ed25519'
    ) {
      return fail(
        'KMS_PUBLIC_KEY_NOT_ED25519',
      );
    }

    this.publicKey =
      key;

    return key;
  }

  async verify(
    payload:
      Uint8Array,

    signature:
      Uint8Array,
  ): Promise<boolean> {
    if (
      !(payload instanceof
        Uint8Array) ||
      payload.byteLength ===
        0 ||
      payload.byteLength >
        1024 * 1024
    ) {
      return fail(
        'INVALID_PAYLOAD',
      );
    }

    if (
      !(signature instanceof
        Uint8Array) ||
      signature.byteLength !==
        64
    ) {
      return fail(
        'INVALID_SIGNATURE',
      );
    }

    const publicKey =
      await this.loadPublicKey();

    try {
      return verifySignature(
        null,
        Buffer.from(
          payload,
        ),
        publicKey,
        Buffer.from(
          signature,
        ),
      );
    } catch {
      return false;
    }
  }
}
