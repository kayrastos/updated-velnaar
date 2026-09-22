import type {
  AddressInfo,
} from 'node:net';

import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  createL4WorkerServer,
} from '../../../scripts/fulgor/cloud/l4WorkerServer';

import type {
  L4InferenceAdapter,
} from '../../../scripts/fulgor/cloud/l4WorkerServer';

const MODEL_ID =
  'Qwen/Qwen3.8-27B';

const servers: Array<
  ReturnType<typeof createL4WorkerServer>
> = [];

function adapter(
  overrides: Partial<
    L4InferenceAdapter
  > = {},
): L4InferenceAdapter {
  return {
    isReady:
      overrides.isReady ??
      vi.fn().mockResolvedValue(true),

    verify:
      overrides.verify ??
      vi.fn().mockResolvedValue({
        verdict: 'SUPPORTED',
        rationale: 'verified',
      }),
  };
}

async function start(
  inferenceAdapter = adapter(),
) {
  const server = createL4WorkerServer(
    {
      expectedModelId: MODEL_ID,
      inferenceTimeoutMs: 1000,
    },
    inferenceAdapter,
  );

  servers.push(server);

  await new Promise<void>(
    (resolve, reject) => {
      server.once('error', reject);
      server.listen(
        0,
        '127.0.0.1',
        () => resolve(),
      );
    },
  );

  const address =
    server.address() as AddressInfo;

  return {
    server,
    adapter: inferenceAdapter,
    origin:
      `http://127.0.0.1:${address.port}`,
  };
}

function requestBody() {
  return JSON.stringify({
    schemaVersion:
      'FULGOR_L4_REQUEST_V1',
    modelId: MODEL_ID,
    request: {
      problem: 'problem',
      diagnosis: 'diagnosis',
      plan: 'plan',
      candidate: {
        blindedId: 'blind-1',
        patch: 'diff --git a/a b/a',
        canonicalDiffSummary:
          'one file changed',
      },
    },
  });
}

async function verifyRequest(
  origin: string,
  overrides: RequestInit = {},
) {
  return fetch(
    `${origin}/v1/verify`,
    {
      method: 'POST',
      headers: {
        'content-type':
          'application/json',
        'x-fulgor-schema':
          'FULGOR_L4_REQUEST_V1',
      },
      body: requestBody(),
      ...overrides,
    },
  );
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      server =>
        new Promise<void>(resolve => {
          server.close(() => resolve());
        }),
    ),
  );
});

describe('Fulgor L4 worker HTTP boundary', () => {
  it('serves health and readiness separately', async () => {
    const { origin } = await start();

    const health = await fetch(
      `${origin}/healthz`,
    );

    const ready = await fetch(
      `${origin}/readyz`,
    );

    expect(health.status).toBe(200);
    expect(ready.status).toBe(200);
  });

  it('returns 503 readiness when inference adapter is not ready', async () => {
    const { origin } = await start(
      adapter({
        isReady:
          vi.fn().mockResolvedValue(false),
      }),
    );

    const ready = await fetch(
      `${origin}/readyz`,
    );

    expect(ready.status).toBe(503);
  });

  it('accepts the exact client contract and binds response identity itself', async () => {
    const inferenceAdapter = adapter();
    const { origin } =
      await start(inferenceAdapter);

    const response =
      await verifyRequest(origin);

    expect(response.status).toBe(200);

    await expect(
      response.json(),
    ).resolves.toEqual({
      schemaVersion:
        'FULGOR_L4_RESPONSE_V1',
      modelId: MODEL_ID,
      response: {
        blindedId: 'blind-1',
        verdict: 'SUPPORTED',
        rationale: 'verified',
      },
    });

    expect(
      inferenceAdapter.verify,
    ).toHaveBeenCalledTimes(1);

    expect(
      inferenceAdapter.verify,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        candidate:
          expect.objectContaining({
            blindedId: 'blind-1',
          }),
      }),
      MODEL_ID,
      expect.any(AbortSignal),
    );
  });

  it('rejects model mismatch without invoking inference', async () => {
    const verify = vi.fn();
    const { origin } = await start(
      adapter({ verify }),
    );

    const body = JSON.parse(
      requestBody(),
    );
    body.modelId = 'wrong-model';

    const response = await verifyRequest(
      origin,
      {
        body: JSON.stringify(body),
      },
    );

    expect(response.status).toBe(409);
    expect(verify).not.toHaveBeenCalled();
  });

  it('requires the exact schema header', async () => {
    const verify = vi.fn();
    const { origin } = await start(
      adapter({ verify }),
    );

    const response = await verifyRequest(
      origin,
      {
        headers: {
          'content-type':
            'application/json',
          'x-fulgor-schema':
            'WRONG_SCHEMA',
        },
      },
    );

    expect(response.status).toBe(400);
    expect(verify).not.toHaveBeenCalled();
  });

  it('rejects content encodings at the worker boundary', async () => {
    const { origin } = await start();

    const response = await verifyRequest(
      origin,
      {
        headers: {
          'content-type':
            'application/json',
          'content-encoding': 'gzip',
          'x-fulgor-schema':
            'FULGOR_L4_REQUEST_V1',
        },
      },
    );

    expect(response.status).toBe(415);
  });

  it('rejects query-bearing verify routes', async () => {
    const { origin } = await start();

    const response = await fetch(
      `${origin}/v1/verify?admin=true`,
      {
        method: 'POST',
        headers: {
          'content-type':
            'application/json',
          'x-fulgor-schema':
            'FULGOR_L4_REQUEST_V1',
        },
        body: requestBody(),
      },
    );

    expect(response.status).toBe(404);
  });

  it('fails closed when inference throws', async () => {
    const { origin } = await start(
      adapter({
        verify:
          vi.fn().mockRejectedValue(
            new Error('backend failed'),
          ),
      }),
    );

    const response =
      await verifyRequest(origin);

    expect(response.status).toBe(503);

    await expect(
      response.json(),
    ).resolves.toEqual({
      error: 'INFERENCE_UNAVAILABLE',
    });
  });

  it('times out inference without retry', async () => {
    let observedSignal:
      AbortSignal | undefined;

    const verify = vi.fn(
      (
        _request: unknown,
        _modelId: string,
        signal: AbortSignal,
      ) => {
        observedSignal = signal;

        return new Promise<never>(
          (_resolve, reject) => {
            signal.addEventListener(
              'abort',
              () => reject(
                new Error('aborted'),
              ),
              { once: true },
            );
          },
        );
      },
    );

    const server = createL4WorkerServer(
      {
        expectedModelId: MODEL_ID,
        inferenceTimeoutMs: 1000,
      },
      adapter({ verify }),
    );

    servers.push(server);

    await new Promise<void>(resolve => {
      server.listen(
        0,
        '127.0.0.1',
        () => resolve(),
      );
    });

    const address =
      server.address() as AddressInfo;

    const response = await verifyRequest(
      `http://127.0.0.1:${address.port}`,
    );

    expect(response.status).toBe(504);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(observedSignal?.aborted)
      .toBe(true);
  });
});
