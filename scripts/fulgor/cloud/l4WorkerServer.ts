import {
  Buffer,
} from 'node:buffer';

import {
  createServer,
} from 'node:http';

import type {
  IncomingMessage,
  Server,
  ServerResponse,
} from 'node:http';

import type {
  BlindedVerifierRequest,
} from '../verification/blindedVerifier';

import {
  buildL4WorkerResponseEnvelope,
  L4_MAX_REQUEST_BYTES,
  L4WorkerProtocolError,
  parseL4WorkerRequestEnvelope,
} from './l4WorkerProtocol';

import type {
  L4InferenceResult,
} from './l4WorkerProtocol';

export interface L4InferenceAdapter {
  verify(
    request: BlindedVerifierRequest,
    modelId: string,
    signal: AbortSignal,
  ): Promise<L4InferenceResult>;

  isReady(): Promise<boolean>;
}

export interface L4WorkerServerConfig {
  expectedModelId: string;
  inferenceTimeoutMs: number;
}

class L4WorkerServerError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(
    code: string,
    httpStatus: number,
  ) {
    super(code);
    this.name = 'L4WorkerServerError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  const encoded = JSON.stringify(body);

  response.statusCode = status;
  response.setHeader(
    'content-type',
    'application/json; charset=utf-8',
  );
  response.setHeader(
    'cache-control',
    'no-store',
  );
  response.setHeader(
    'x-content-type-options',
    'nosniff',
  );
  response.setHeader(
    'content-length',
    Buffer.byteLength(
      encoded,
      'utf8',
    ),
  );
  response.end(encoded);
}

function headerOccurrences(
  request: IncomingMessage,
  name: string,
): number {
  let count = 0;

  for (
    let index = 0;
    index < request.rawHeaders.length;
    index += 2
  ) {
    if (
      request.rawHeaders[index]
        .toLowerCase() ===
      name.toLowerCase()
    ) {
      count += 1;
    }
  }

  return count;
}

function requireSingleHeader(
  request: IncomingMessage,
  name: string,
): string {
  if (
    headerOccurrences(
      request,
      name,
    ) !== 1
  ) {
    throw new L4WorkerServerError(
      'INVALID_HEADERS',
      400,
    );
  }

  const value = request.headers[name];

  if (
    typeof value !== 'string' ||
    value.trim().length === 0
  ) {
    throw new L4WorkerServerError(
      'INVALID_HEADERS',
      400,
    );
  }

  return value.trim();
}

function assertVerifyHeaders(
  request: IncomingMessage,
): void {
  const contentType =
    requireSingleHeader(
      request,
      'content-type',
    )
      .toLowerCase()
      .split(';', 1)[0]
      .trim();

  if (contentType !== 'application/json') {
    throw new L4WorkerServerError(
      'INVALID_CONTENT_TYPE',
      415,
    );
  }

  if (
    requireSingleHeader(
      request,
      'x-fulgor-schema',
    ) !== 'FULGOR_L4_REQUEST_V1'
  ) {
    throw new L4WorkerServerError(
      'INVALID_SCHEMA_HEADER',
      400,
    );
  }

  const contentEncoding =
    request.headers['content-encoding'];

  if (
    contentEncoding !== undefined &&
    contentEncoding !== 'identity'
  ) {
    throw new L4WorkerServerError(
      'CONTENT_ENCODING_FORBIDDEN',
      415,
    );
  }
}

async function readBoundedBody(
  request: IncomingMessage,
): Promise<string> {
  const declaredLength =
    request.headers['content-length'];

  if (
    typeof declaredLength === 'string'
  ) {
    if (!/^\d+$/.test(declaredLength)) {
      throw new L4WorkerServerError(
        'INVALID_CONTENT_LENGTH',
        400,
      );
    }

    const parsed = Number(declaredLength);

    if (
      !Number.isSafeInteger(parsed) ||
      parsed > L4_MAX_REQUEST_BYTES
    ) {
      throw new L4WorkerServerError(
        'REQUEST_TOO_LARGE',
        413,
      );
    }
  }

  const chunks: Buffer[] = [];
  let bytes = 0;

  for await (const chunk of request) {
    const buffer =
      Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk);

    bytes += buffer.byteLength;

    if (bytes > L4_MAX_REQUEST_BYTES) {
      throw new L4WorkerServerError(
        'REQUEST_TOO_LARGE',
        413,
      );
    }

    chunks.push(buffer);
  }

  return Buffer
    .concat(chunks)
    .toString('utf8');
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
              new L4WorkerServerError(
                'INFERENCE_TIMEOUT',
                504,
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


async function runInferenceWithTimeout(
  adapter: L4InferenceAdapter,
  request: BlindedVerifierRequest,
  modelId: string,
  timeoutMs: number,
): Promise<L4InferenceResult> {
  const controller =
    new AbortController();

  let timer:
    ReturnType<typeof setTimeout> |
    undefined;

  const inferencePromise =
    adapter.verify(
      request,
      modelId,
      controller.signal,
    );

  const timeout =
    new Promise<never>(
      (_resolve, reject) => {
        timer = setTimeout(
          () => {
            reject(
              new L4WorkerServerError(
                'INFERENCE_TIMEOUT',
                504,
              ),
            );

            controller.abort();
          },
          timeoutMs,
        );
      },
    );

  try {
    return await Promise.race([
      inferencePromise,
      timeout,
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

function exactPath(
  request: IncomingMessage,
): string {
  const raw = request.url ?? '/';
  let parsed: URL;

  try {
    parsed = new URL(
      raw,
      'http://fulgor.invalid',
    );
  } catch {
    return '__INVALID__';
  }

  if (
    parsed.search.length !== 0 ||
    parsed.hash.length !== 0
  ) {
    return '__INVALID__';
  }

  return parsed.pathname;
}

export function createL4WorkerServer(
  config: L4WorkerServerConfig,
  adapter: L4InferenceAdapter,
): Server {
  if (
    typeof config.expectedModelId !==
      'string' ||
    config.expectedModelId.trim().length === 0 ||
    config.expectedModelId.length > 256 ||
    /\s/.test(config.expectedModelId)
  ) {
    throw new Error(
      'INVALID_EXPECTED_MODEL_ID',
    );
  }

  if (
    !Number.isSafeInteger(
      config.inferenceTimeoutMs,
    ) ||
    config.inferenceTimeoutMs < 1000 ||
    config.inferenceTimeoutMs > 120000
  ) {
    throw new Error(
      'INVALID_INFERENCE_TIMEOUT',
    );
  }

  let inFlight = false;

  const server = createServer(
    async (
      request,
      response,
    ) => {
      const path = exactPath(request);

      if (
        path === '/healthz' &&
        request.method === 'GET'
      ) {
        sendJson(
          response,
          200,
          { status: 'ok' },
        );
        return;
      }

      if (
        path === '/readyz' &&
        request.method === 'GET'
      ) {
        let ready = false;

        try {
          ready = await withTimeout(
            adapter.isReady(),
            Math.min(
              config.inferenceTimeoutMs,
              5000,
            ),
          );
        } catch {
          ready = false;
        }

        sendJson(
          response,
          ready ? 200 : 503,
          {
            status:
              ready
                ? 'ready'
                : 'not_ready',
          },
        );
        return;
      }

      if (path !== '/v1/verify') {
        sendJson(
          response,
          404,
          { error: 'NOT_FOUND' },
        );
        return;
      }

      if (request.method !== 'POST') {
        response.setHeader(
          'allow',
          'POST',
        );
        sendJson(
          response,
          405,
          { error: 'METHOD_NOT_ALLOWED' },
        );
        return;
      }

      if (inFlight) {
        sendJson(
          response,
          429,
          { error: 'WORKER_BUSY' },
        );
        return;
      }

      inFlight = true;

      try {
        assertVerifyHeaders(request);

        const rawBody =
          await readBoundedBody(
            request,
          );

        const envelope =
          parseL4WorkerRequestEnvelope(
            rawBody,
            config.expectedModelId,
          );

        const inferenceResult =
          await runInferenceWithTimeout(
            adapter,
            envelope.request,
            config.expectedModelId,
            config.inferenceTimeoutMs,
          );

        const output =
          buildL4WorkerResponseEnvelope(
            config.expectedModelId,
            envelope.request,
            inferenceResult,
          );

        sendJson(
          response,
          200,
          output,
        );
      } catch (error) {
        if (
          error instanceof
            L4WorkerProtocolError ||
          error instanceof
            L4WorkerServerError
        ) {
          sendJson(
            response,
            error.httpStatus,
            { error: error.code },
          );
          return;
        }

        sendJson(
          response,
          503,
          {
            error:
              'INFERENCE_UNAVAILABLE',
          },
        );
      } finally {
        inFlight = false;
      }
    },
  );

  server.requestTimeout = 125000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;

  return server;
}
