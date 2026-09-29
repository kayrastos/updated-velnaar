import {
  Buffer,
} from 'node:buffer';

import {
  parseBlindedVerifierRequest,
  parseBlindedVerifierResponse,
} from '../verification/blindedVerifier';

import type {
  BlindedVerifierRequest,
  BlindedVerifierResponse,
} from '../verification/blindedVerifier';

import type {
  FulgorVerifierWorker,
} from '../automation/types';

import type {
  FulgorGcpConfig,
} from './gcpConfig';

export type L4WorkerFailureCode =
  | 'REQUEST_TOO_LARGE'
  | 'TIMEOUT'
  | 'TRANSPORT_ERROR'
  | 'HTTP_STATUS'
  | 'INVALID_CONTENT_TYPE'
  | 'RESPONSE_TOO_LARGE'
  | 'INVALID_JSON'
  | 'INVALID_ENVELOPE'
  | 'MODEL_ID_MISMATCH'
  | 'BLINDED_ID_MISMATCH';

export class L4WorkerClientError extends Error {
  readonly code: L4WorkerFailureCode;

  constructor(
    code: L4WorkerFailureCode,
  ) {
    super(code);
    this.name = 'L4WorkerClientError';
    this.code = code;
  }
}

export interface L4WorkerTransportRequest {
  endpoint: string;
  audience: string;
  timeoutMs: number;

  headers: Readonly<
    Record<string, string>
  >;

  body: string;
}

export interface L4WorkerTransportResponse {
  status: number;
  contentType: string | null;
  body: string;
}

export interface L4WorkerTransport {
  send(
    request: L4WorkerTransportRequest,
  ): Promise<L4WorkerTransportResponse>;
}

const MAX_REQUEST_BYTES =
  2 * 1024 * 1024;

const MAX_RESPONSE_BYTES =
  64 * 1024;

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function exactKeys(
  value: unknown,
  expected: readonly string[],
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new L4WorkerClientError(
      'INVALID_ENVELOPE',
    );
  }

  const actual =
    Object.keys(value).sort();

  const sortedExpected =
    [...expected].sort();

  if (
    actual.length !==
      sortedExpected.length ||
    actual.some(
      (key, index) =>
        key !== sortedExpected[index],
    )
  ) {
    throw new L4WorkerClientError(
      'INVALID_ENVELOPE',
    );
  }

  return value;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer:
    ReturnType<typeof setTimeout> |
    undefined;

  const timeout =
    new Promise<never>(
      (_resolve, reject) => {
        timer = setTimeout(
          () => {
            reject(
              new L4WorkerClientError(
                'TIMEOUT',
              ),
            );
          },
          timeoutMs,
        );
      },
    );

  try {
    return await Promise.race([
      promise,
      timeout,
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

export class L4WorkerClient
implements FulgorVerifierWorker {
  private readonly config:
    FulgorGcpConfig;

  private readonly transport:
    L4WorkerTransport;

  constructor(
    config: FulgorGcpConfig,
    transport: L4WorkerTransport,
  ) {
    this.config = config;
    this.transport = transport;
  }

  async verify(
    input: BlindedVerifierRequest,
  ): Promise<BlindedVerifierResponse> {
    const request =
      parseBlindedVerifierRequest(
        input,
      );

    /*
     * Only the blinded verifier contract is
     * permitted across the worker boundary.
     */
    const body = JSON.stringify({
      schemaVersion:
        'FULGOR_L4_REQUEST_V1',

      modelId:
        this.config.expectedModelId,

      request,
    });

    if (
      Buffer.byteLength(
        body,
        'utf8',
      ) > MAX_REQUEST_BYTES
    ) {
      throw new L4WorkerClientError(
        'REQUEST_TOO_LARGE',
      );
    }

    let transportResponse:
      L4WorkerTransportResponse;

    try {
      transportResponse =
        await withTimeout(
          this.transport.send({
            endpoint:
              this.config.workerEndpoint,

            audience:
              this.config.workerAudience,

            timeoutMs:
              this.config.timeoutMs,

            headers: {
              accept: 'application/json',
              'content-type':
                'application/json',
              'x-fulgor-schema':
                'FULGOR_L4_REQUEST_V1',
            },

            body,
          }),
          this.config.timeoutMs,
        );
    } catch (error) {
      if (
        error instanceof
          L4WorkerClientError
      ) {
        throw error;
      }

      throw new L4WorkerClientError(
        'TRANSPORT_ERROR',
      );
    }

    /*
     * reachable != authorized
     *
     * Authorization is established by the Cloud Run
     * IAM boundary before this response exists:
     * exact pinned origin + exact audience + Google-
     * signed ID token + roles/run.invoker. The body
     * is never allowed to self-assert peer identity.
     */
    if (transportResponse.status !== 200) {
      throw new L4WorkerClientError(
        'HTTP_STATUS',
      );
    }

    if (
      transportResponse.contentType ===
        null ||
      !transportResponse.contentType
        .toLowerCase()
        .startsWith('application/json')
    ) {
      throw new L4WorkerClientError(
        'INVALID_CONTENT_TYPE',
      );
    }

    if (
      Buffer.byteLength(
        transportResponse.body,
        'utf8',
      ) > MAX_RESPONSE_BYTES
    ) {
      throw new L4WorkerClientError(
        'RESPONSE_TOO_LARGE',
      );
    }

    let decoded: unknown;

    try {
      decoded = JSON.parse(
        transportResponse.body,
      );
    } catch {
      throw new L4WorkerClientError(
        'INVALID_JSON',
      );
    }

    const envelope =
      exactKeys(
        decoded,
        [
          'schemaVersion',
          'modelId',
          'response',
        ],
      );

    if (
      envelope.schemaVersion !==
        'FULGOR_L4_RESPONSE_V1'
    ) {
      throw new L4WorkerClientError(
        'INVALID_ENVELOPE',
      );
    }

    if (
      envelope.modelId !==
        this.config.expectedModelId
    ) {
      throw new L4WorkerClientError(
        'MODEL_ID_MISMATCH',
      );
    }

    let parsed:
      BlindedVerifierResponse;

    try {
      parsed =
        parseBlindedVerifierResponse(
          envelope.response,
        );
    } catch {
      throw new L4WorkerClientError(
        'INVALID_ENVELOPE',
      );
    }

    if (
      parsed.blindedId !==
        request.candidate.blindedId
    ) {
      throw new L4WorkerClientError(
        'BLINDED_ID_MISMATCH',
      );
    }

    return parsed;
  }
}