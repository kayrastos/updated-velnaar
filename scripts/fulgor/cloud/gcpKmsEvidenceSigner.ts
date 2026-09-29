import { GoogleAuth } from 'google-auth-library';

import {
  FULGOR_EVIDENCE_AUTHORITY,
  FULGOR_SIGNATURE_ALGORITHM,
} from '../evidence/signedEvidence';

import type {
  EvidenceSigner,
} from '../evidence/signedEvidence';

export type GcpKmsSignerFailureCode =
  | 'INVALID_KEY_ID'
  | 'INVALID_KEY_VERSION_RESOURCE'
  | 'INVALID_PAYLOAD'
  | 'KMS_REQUEST_FAILED'
  | 'KMS_RESPONSE_INVALID'
  | 'KMS_KEY_VERSION_MISMATCH'
  | 'KMS_SIGNATURE_INVALID';

export class GcpKmsSignerError extends Error {
  readonly code: GcpKmsSignerFailureCode;

  constructor(code: GcpKmsSignerFailureCode) {
    super(code);
    this.name = 'GcpKmsSignerError';
    this.code = code;
  }
}

export interface GcpKmsSignRequest {
  url: string;
  method: 'POST';
  data: {
    data: string;
  };
}

export type GcpKmsRequester = (
  request: GcpKmsSignRequest,
) => Promise<unknown>;

export interface GcpKmsEvidenceSignerOptions {
  keyId: string;
  keyVersionResource: string;
  requester?: GcpKmsRequester;
}

const KEY_ID =
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const KEY_VERSION_RESOURCE =
  /^projects\/[^/\s]+\/locations\/[^/\s]+\/keyRings\/[^/\s]+\/cryptoKeys\/[^/\s]+\/cryptoKeyVersions\/[^/\s]+$/;

const BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function fail(
  code: GcpKmsSignerFailureCode,
): never {
  throw new GcpKmsSignerError(code);
}

async function googleKmsRequester(
  request: GcpKmsSignRequest,
): Promise<unknown> {
  const auth = new GoogleAuth({
    scopes: [
      'https://www.googleapis.com/auth/cloud-platform',
    ],
  });

  try {
    const client =
      await auth.getClient();

    const response =
      await client.request({
        url: request.url,
        method: request.method,
        data: request.data,
      });

    return response.data;
  } catch {
    return fail('KMS_REQUEST_FAILED');
  }
}

function parseSignature(
  value: unknown,
): Uint8Array {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    !BASE64.test(value)
  ) {
    return fail('KMS_SIGNATURE_INVALID');
  }

  const decoded =
    Buffer.from(value, 'base64');

  if (
    decoded.byteLength !== 64 ||
    decoded.toString('base64') !== value
  ) {
    return fail('KMS_SIGNATURE_INVALID');
  }

  return new Uint8Array(decoded);
}

/**
 * Production EvidenceSigner backed by Google Cloud KMS.
 * No private key material enters the Fulgor process.
 */
export class GcpKmsEvidenceSigner
implements EvidenceSigner {
  readonly authority =
    FULGOR_EVIDENCE_AUTHORITY;

  readonly algorithm =
    FULGOR_SIGNATURE_ALGORITHM;

  readonly keyId: string;

  private readonly keyVersionResource: string;
  private readonly requester: GcpKmsRequester;

  constructor(
    options: GcpKmsEvidenceSignerOptions,
  ) {
    if (!KEY_ID.test(options.keyId)) {
      return fail('INVALID_KEY_ID');
    }

    if (
      options.keyVersionResource.length > 2048 ||
      !KEY_VERSION_RESOURCE.test(
        options.keyVersionResource,
      )
    ) {
      return fail(
        'INVALID_KEY_VERSION_RESOURCE',
      );
    }

    this.keyId = options.keyId;
    this.keyVersionResource =
      options.keyVersionResource;

    this.requester =
      options.requester ??
      googleKmsRequester;
  }

  async sign(
    payload: Uint8Array,
  ): Promise<Uint8Array> {
    if (
      !(payload instanceof Uint8Array) ||
      payload.byteLength === 0 ||
      payload.byteLength > 1024 * 1024
    ) {
      return fail('INVALID_PAYLOAD');
    }

    const url =
      'https://cloudkms.googleapis.com/v1/' +
      this.keyVersionResource +
      ':asymmetricSign';

    let raw: unknown;

    try {
      raw =
        await this.requester({
          url,
          method: 'POST',
          data: {
            data:
              Buffer.from(payload)
                .toString('base64'),
          },
        });
    } catch (error) {
      if (
        error instanceof
        GcpKmsSignerError
      ) {
        throw error;
      }

      return fail('KMS_REQUEST_FAILED');
    }

    if (!isRecord(raw)) {
      return fail('KMS_RESPONSE_INVALID');
    }

    if (
      raw.name !==
      this.keyVersionResource
    ) {
      return fail(
        'KMS_KEY_VERSION_MISMATCH',
      );
    }

    return parseSignature(
      raw.signature,
    );
  }
}