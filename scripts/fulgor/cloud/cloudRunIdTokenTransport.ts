import {
  GoogleAuth,
} from 'google-auth-library';

import {
  FULGOR_L4_MAX_TIMEOUT_MS,
} from './gcpConfig';

import {
  L4WorkerClientError,
} from './l4WorkerClient';

import type {
  L4WorkerTransport,
  L4WorkerTransportRequest,
  L4WorkerTransportResponse,
} from './l4WorkerClient';

export interface L4IdTokenProvider {
  fetchIdToken(
    audience: string,
  ): Promise<string>;
}

export type L4Fetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function assertPinnedCloudRunRequest(
  request: L4WorkerTransportRequest,
): void {
  let endpoint: URL;
  let audience: URL;

  try {
    endpoint = new URL(
      request.endpoint,
    );

    audience = new URL(
      request.audience,
    );
  } catch {
    throw new L4WorkerClientError(
      'TRANSPORT_ERROR',
    );
  }

  const hostname =
    audience.hostname.toLowerCase();

  const exactEndpoint =
    `${audience.origin}/v1/verify`;

  if (
    audience.protocol !== 'https:' ||
    audience.username.length !== 0 ||
    audience.password.length !== 0 ||
    audience.port.length !== 0 ||
    audience.search.length !== 0 ||
    audience.hash.length !== 0 ||
    audience.pathname !== '/' ||
    !hostname.endsWith('.run.app') ||
    hostname === 'run.app' ||
    endpoint.origin !== audience.origin ||
    endpoint.protocol !== 'https:' ||
    endpoint.username.length !== 0 ||
    endpoint.password.length !== 0 ||
    endpoint.port.length !== 0 ||
    endpoint.search.length !== 0 ||
    endpoint.hash.length !== 0 ||
    endpoint.pathname !== '/v1/verify' ||
    request.endpoint !== exactEndpoint ||
    request.audience !== audience.origin
  ) {
    throw new L4WorkerClientError(
      'TRANSPORT_ERROR',
    );
  }
}

function assertNoCallerAuthHeaders(
  headers: Readonly<Record<string, string>>,
): void {
  for (const name of Object.keys(headers)) {
    if (
      name.toLowerCase() ===
        'authorization' ||
      name.toLowerCase() ===
        'x-serverless-authorization'
    ) {
      throw new L4WorkerClientError(
        'TRANSPORT_ERROR',
      );
    }
  }
}

async function deadlineRace<T>(
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

export class GoogleAuthIdTokenProvider
implements L4IdTokenProvider {
  private readonly auth:
    GoogleAuth;

  private readonly clients =
    new Map<
      string,
      Awaited<
        ReturnType<
          GoogleAuth['getIdTokenClient']
        >
      >
    >();

  constructor(
    auth: GoogleAuth =
      new GoogleAuth(),
  ) {
    this.auth = auth;
  }

  async fetchIdToken(
    audience: string,
  ): Promise<string> {
    let client =
      this.clients.get(
        audience,
      );

    if (client === undefined) {
      client =
        await this.auth
          .getIdTokenClient(
            audience,
          );

      this.clients.set(
        audience,
        client,
      );
    }

    /*
     * getRequestHeaders() uses IdTokenClient's own
     * expiry-aware ID-token cache. We only extract
     * the Google-authenticated header here; the
     * worker request itself still uses native fetch
     * with redirect:'error'.
     */
    const headers =
      await client
        .getRequestHeaders();

    const authorization =
      headers.get(
        'authorization',
      );

    const prefix = 'Bearer ';

    if (
      typeof authorization !==
        'string' ||
      !authorization.startsWith(
        prefix,
      )
    ) {
      throw new L4WorkerClientError(
        'TRANSPORT_ERROR',
      );
    }

    const token =
      authorization.slice(
        prefix.length,
      );

    if (
      token.length === 0 ||
      /\s/.test(token)
    ) {
      throw new L4WorkerClientError(
        'TRANSPORT_ERROR',
      );
    }

    return token;
  }
}

export class CloudRunIdTokenTransport
implements L4WorkerTransport {
  private readonly tokenProvider:
    L4IdTokenProvider;

  private readonly fetchImpl:
    L4Fetch;

  constructor(
    tokenProvider:
      L4IdTokenProvider =
        new GoogleAuthIdTokenProvider(),
    fetchImpl:
      L4Fetch = globalThis.fetch,
  ) {
    this.tokenProvider =
      tokenProvider;

    this.fetchImpl =
      fetchImpl;
  }

  async send(
    request: L4WorkerTransportRequest,
  ): Promise<L4WorkerTransportResponse> {
    assertPinnedCloudRunRequest(
      request,
    );

    assertNoCallerAuthHeaders(
      request.headers,
    );

    if (
      !Number.isSafeInteger(
        request.timeoutMs,
      ) ||
      request.timeoutMs < 1 ||
      request.timeoutMs > FULGOR_L4_MAX_TIMEOUT_MS
    ) {
      throw new L4WorkerClientError(
        'TRANSPORT_ERROR',
      );
    }

    const startedAt = Date.now();

    let token: string;

    try {
      token =
        await deadlineRace(
          this.tokenProvider
            .fetchIdToken(
              request.audience,
            ),
          request.timeoutMs,
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

    if (
      typeof token !== 'string' ||
      token.length === 0 ||
      /\s/.test(token)
    ) {
      throw new L4WorkerClientError(
        'TRANSPORT_ERROR',
      );
    }

    const elapsed =
      Date.now() - startedAt;

    const remainingMs =
      request.timeoutMs - elapsed;

    if (remainingMs <= 0) {
      throw new L4WorkerClientError(
        'TIMEOUT',
      );
    }

    const abortController =
      new AbortController();

    const timeoutHandle =
      setTimeout(
        () => {
          abortController.abort(
            new Error(
              'FULGOR_L4_HARD_TIMEOUT',
            ),
          );
        },
        remainingMs,
      );

    try {
      const response =
        await this.fetchImpl(
          request.endpoint,
          {
            method: 'POST',
            redirect: 'error',
            signal:
              abortController.signal,

            headers: {
              ...request.headers,
              Authorization:
                `Bearer ${token}`,
            },

            body: request.body,
          },
        );

      return {
        status: response.status,
        contentType:
          response.headers.get(
            'content-type',
          ),
        body: await response.text(),
      };
    } catch (error) {
      if (
        abortController.signal.aborted
      ) {
        throw new L4WorkerClientError(
          'TIMEOUT',
        );
      }

      if (
        error instanceof
          L4WorkerClientError
      ) {
        throw error;
      }

      throw new L4WorkerClientError(
        'TRANSPORT_ERROR',
      );
    } finally {
      clearTimeout(
        timeoutHandle,
      );
    }
  }
}
