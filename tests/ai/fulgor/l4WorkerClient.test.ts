import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  loadFulgorGcpConfig,
} from '../../../scripts/fulgor/cloud/gcpConfig';

import {
  L4WorkerClient,
  L4WorkerClientError,
} from '../../../scripts/fulgor/cloud/l4WorkerClient';

import type {
  L4WorkerTransport,
} from '../../../scripts/fulgor/cloud/l4WorkerClient';

function config() {
  return loadFulgorGcpConfig({
    FULGOR_GCP_PROJECT_ID:
      'velnar-fulgor',

    FULGOR_GCP_REGION:
      'europe-west4',

    FULGOR_CONTROLLER_STATE_PATH:
      'D:/fulgor/state.json',

    FULGOR_L4_WORKER_ENDPOINT:
      'https://fulgor-l4.internal/v1/verify',

    FULGOR_L4_WORKER_AUDIENCE:
      'https://fulgor-l4.internal',

    FULGOR_L4_WORKER_IDENTITY:
      'fulgor-l4-worker@velnar.iam.gserviceaccount.com',

    FULGOR_L4_EXPECTED_MODEL_ID:
      'Qwen/Qwen3.8-27B',

    FULGOR_L4_TIMEOUT_MS:
      '30000',

    FULGOR_MAX_JOBS_PER_RUN:
      '1',

    FULGOR_QUEUE_MAX_DEPTH:
      '32',
  });
}

function request() {
  return {
    problem: 'problem',
    diagnosis: 'diagnosis',
    plan: 'plan',

    candidate: {
      blindedId: 'blind-1',

      patch: [
        'diff --git a/src/a.ts b/src/a.ts',
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -1 +1 @@',
        '-old',
        '+new',
      ].join('\n'),

      canonicalDiffSummary:
        'one file changed',
    },
  };
}

function successfulTransport(
  overrides: Partial<{
    status: number;
    contentType: string | null;
    authenticatedPeer: string;
    modelId: string;
    blindedId: string;
    rawBody: string;
  }> = {},
): {
  transport: L4WorkerTransport;
  send: ReturnType<typeof vi.fn>;
} {
  const c = config();

  const body =
    overrides.rawBody ??
    JSON.stringify({
      schemaVersion:
        'FULGOR_L4_RESPONSE_V1',

      modelId:
        overrides.modelId ??
        c.expectedModelId,

      response: {
        blindedId:
          overrides.blindedId ??
          'blind-1',

        verdict: 'SUPPORTED',
        rationale: 'verified',
      },
    });

  const send =
    vi.fn().mockResolvedValue({
      status:
        overrides.status ?? 200,

      contentType:
        overrides.contentType ??
        'application/json',

      authenticatedPeer:
        overrides.authenticatedPeer ??
        c.workerIdentity,

      body,
    });

  return {
    transport: {
      send,
    },
    send,
  };
}

describe('Fulgor L4 worker client', () => {
  it('sends only the bounded blinded verification contract', async () => {
    const c = config();

    const {
      transport,
      send,
    } = successfulTransport();

    const client =
      new L4WorkerClient(
        c,
        transport,
      );

    const result =
      await client.verify(
        request(),
      );

    expect(result.verdict)
      .toBe('SUPPORTED');

    expect(send)
      .toHaveBeenCalledTimes(1);

    const transportRequest =
      send.mock.calls[0][0];

    expect(
      transportRequest.endpoint,
    ).toBe(c.workerEndpoint);

    expect(
      transportRequest.audience,
    ).toBe(c.workerAudience);

    const decoded =
      JSON.parse(
        transportRequest.body,
      );

    expect(
      Object.keys(decoded).sort(),
    ).toEqual([
      'modelId',
      'request',
      'schemaVersion',
    ]);

    expect(
      Object.keys(
        decoded.request,
      ).sort(),
    ).toEqual([
      'candidate',
      'diagnosis',
      'plan',
      'problem',
    ]);

    expect(
      Object.keys(
        decoded.request.candidate,
      ).sort(),
    ).toEqual([
      'blindedId',
      'canonicalDiffSummary',
      'patch',
    ]);
  });

  it('rejects mismatched authenticated peer identity', async () => {
    const {
      transport,
    } = successfulTransport({
      authenticatedPeer:
        'attacker@example.invalid',
    });

    const client =
      new L4WorkerClient(
        config(),
        transport,
      );

    await expect(
      client.verify(request()),
    ).rejects.toEqual(
      new L4WorkerClientError(
        'AUTHENTICATED_PEER_MISMATCH',
      ),
    );
  });

  it('rejects non-200 response', async () => {
    const {
      transport,
    } = successfulTransport({
      status: 503,
    });

    const client =
      new L4WorkerClient(
        config(),
        transport,
      );

    await expect(
      client.verify(request()),
    ).rejects.toEqual(
      new L4WorkerClientError(
        'HTTP_STATUS',
      ),
    );
  });

  it('rejects model provenance mismatch', async () => {
    const {
      transport,
    } = successfulTransport({
      modelId: 'wrong-model',
    });

    const client =
      new L4WorkerClient(
        config(),
        transport,
      );

    await expect(
      client.verify(request()),
    ).rejects.toEqual(
      new L4WorkerClientError(
        'MODEL_ID_MISMATCH',
      ),
    );
  });

  it('rejects blinded response identity mismatch', async () => {
    const {
      transport,
    } = successfulTransport({
      blindedId: 'blind-other',
    });

    const client =
      new L4WorkerClient(
        config(),
        transport,
      );

    await expect(
      client.verify(request()),
    ).rejects.toEqual(
      new L4WorkerClientError(
        'BLINDED_ID_MISMATCH',
      ),
    );
  });

  it('rejects malformed JSON', async () => {
    const {
      transport,
    } = successfulTransport({
      rawBody: '{not-json',
    });

    const client =
      new L4WorkerClient(
        config(),
        transport,
      );

    await expect(
      client.verify(request()),
    ).rejects.toEqual(
      new L4WorkerClientError(
        'INVALID_JSON',
      ),
    );
  });

  it('rejects oversized worker response', async () => {
    const {
      transport,
    } = successfulTransport({
      rawBody:
        'x'.repeat(
          70 * 1024,
        ),
    });

    const client =
      new L4WorkerClient(
        config(),
        transport,
      );

    await expect(
      client.verify(request()),
    ).rejects.toEqual(
      new L4WorkerClientError(
        'RESPONSE_TOO_LARGE',
      ),
    );
  });

  it('enforces client-side timeout without retry', async () => {
    const c = {
      ...config(),
      timeoutMs: 10,
    };

    const send =
      vi.fn().mockImplementation(
        () =>
          new Promise(() => {
            // deliberately unresolved
          }),
      );

    const client =
      new L4WorkerClient(
        c,
        { send },
      );

    await expect(
      client.verify(request()),
    ).rejects.toEqual(
      new L4WorkerClientError(
        'TIMEOUT',
      ),
    );

    expect(send)
      .toHaveBeenCalledTimes(1);
  });
});