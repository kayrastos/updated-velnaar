import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  CloudRunIdTokenTransport,
  GoogleAuthIdTokenProvider,
} from '../../../scripts/fulgor/cloud/cloudRunIdTokenTransport';

import {
  L4WorkerClientError,
} from '../../../scripts/fulgor/cloud/l4WorkerClient';

function request(
  overrides: Partial<{
    endpoint: string;
    audience: string;
    timeoutMs: number;
    headers: Record<string, string>;
  }> = {},
) {
  const audience =
    overrides.audience ??
    'https://fulgor-l4-worker-abc-uc.a.run.app';

  return {
    endpoint:
      overrides.endpoint ??
      `${audience}/v1/verify`,

    audience,

    timeoutMs:
      overrides.timeoutMs ??
      30000,

    headers:
      overrides.headers ?? {
        accept: 'application/json',
        'content-type':
          'application/json',
        'x-fulgor-schema':
          'FULGOR_L4_REQUEST_V1',
      },

    body: '{"hello":"world"}',
  };
}

function okResponse() {
  return new Response(
    '{"ok":true}',
    {
      status: 200,
      headers: {
        'content-type':
          'application/json; charset=utf-8',
      },
    },
  );
}

describe('Cloud Run ID-token transport', () => {
  it('obtains the Google ID token from an audience-bound IdTokenClient without making the worker request itself', async () => {
    const getRequestHeaders =
      vi.fn().mockResolvedValue(
        new Headers({
          authorization:
            'Bearer google-id-token',
        }),
      );

    const getIdTokenClient =
      vi.fn().mockResolvedValue({
        getRequestHeaders,
      });

    const provider =
      new GoogleAuthIdTokenProvider(
        {
          getIdTokenClient,
        } as any,
      );

    const audience =
      'https://fulgor-l4-worker-abc-uc.a.run.app';

    await expect(
      provider.fetchIdToken(
        audience,
      ),
    ).resolves.toBe(
      'google-id-token',
    );

    await expect(
      provider.fetchIdToken(
        audience,
      ),
    ).resolves.toBe(
      'google-id-token',
    );

    expect(getIdTokenClient)
      .toHaveBeenCalledTimes(1);

    expect(getIdTokenClient)
      .toHaveBeenCalledWith(
        audience,
      );

    expect(getRequestHeaders)
      .toHaveBeenCalledTimes(2);
  });

  it('uses exact audience, bearer ID token, POST, redirect:error, and one worker fetch', async () => {
    const fetchIdToken =
      vi.fn().mockResolvedValue(
        'signed.google.id.token',
      );

    const fetchImpl =
      vi.fn().mockResolvedValue(
        okResponse(),
      );

    const transport =
      new CloudRunIdTokenTransport(
        { fetchIdToken },
        fetchImpl,
      );

    const input = request();

    const response =
      await transport.send(input);

    expect(fetchIdToken)
      .toHaveBeenCalledTimes(1);

    expect(fetchIdToken)
      .toHaveBeenCalledWith(
        input.audience,
      );

    expect(fetchImpl)
      .toHaveBeenCalledTimes(1);

    const [url, init] =
      fetchImpl.mock.calls[0];

    expect(url)
      .toBe(input.endpoint);

    expect(init.method)
      .toBe('POST');

    expect(init.redirect)
      .toBe('error');

    expect(init.headers)
      .toMatchObject({
        Authorization:
          'Bearer signed.google.id.token',
        'content-type':
          'application/json',
      });

    expect(response)
      .toEqual({
        status: 200,
        contentType:
          'application/json; charset=utf-8',
        body: '{"ok":true}',
      });
  });

  it('rejects non-Cloud-Run target before token acquisition or network', async () => {
    const fetchIdToken = vi.fn();
    const fetchImpl = vi.fn();

    const transport =
      new CloudRunIdTokenTransport(
        { fetchIdToken },
        fetchImpl,
      );

    await expect(
      transport.send(
        request({
          audience:
            'https://attacker.example',
          endpoint:
            'https://attacker.example/v1/verify',
        }),
      ),
    ).rejects.toEqual(
      new L4WorkerClientError(
        'TRANSPORT_ERROR',
      ),
    );

    expect(fetchIdToken)
      .not.toHaveBeenCalled();

    expect(fetchImpl)
      .not.toHaveBeenCalled();
  });

  it('rejects endpoint/audience origin drift before token acquisition', async () => {
    const fetchIdToken = vi.fn();
    const fetchImpl = vi.fn();

    const transport =
      new CloudRunIdTokenTransport(
        { fetchIdToken },
        fetchImpl,
      );

    await expect(
      transport.send(
        request({
          endpoint:
            'https://other-worker-xyz-uc.a.run.app/v1/verify',
        }),
      ),
    ).rejects.toEqual(
      new L4WorkerClientError(
        'TRANSPORT_ERROR',
      ),
    );

    expect(fetchIdToken)
      .not.toHaveBeenCalled();

    expect(fetchImpl)
      .not.toHaveBeenCalled();
  });

  it('rejects any endpoint other than exact /v1/verify', async () => {
    const fetchIdToken = vi.fn();
    const fetchImpl = vi.fn();

    const transport =
      new CloudRunIdTokenTransport(
        { fetchIdToken },
        fetchImpl,
      );

    await expect(
      transport.send(
        request({
          endpoint:
            'https://fulgor-l4-worker-abc-uc.a.run.app/admin',
        }),
      ),
    ).rejects.toEqual(
      new L4WorkerClientError(
        'TRANSPORT_ERROR',
      ),
    );

    expect(fetchIdToken)
      .not.toHaveBeenCalled();
  });

  it('does not allow caller-provided Authorization to override transport authority', async () => {
    const fetchIdToken = vi.fn();
    const fetchImpl = vi.fn();

    const transport =
      new CloudRunIdTokenTransport(
        { fetchIdToken },
        fetchImpl,
      );

    await expect(
      transport.send(
        request({
          headers: {
            Authorization:
              'Bearer attacker-token',
          },
        }),
      ),
    ).rejects.toEqual(
      new L4WorkerClientError(
        'TRANSPORT_ERROR',
      ),
    );

    expect(fetchIdToken)
      .not.toHaveBeenCalled();

    expect(fetchImpl)
      .not.toHaveBeenCalled();
  });

  it('does not allow caller-provided X-Serverless-Authorization to shadow transport authority', async () => {
    const fetchIdToken = vi.fn();
    const fetchImpl = vi.fn();

    const transport =
      new CloudRunIdTokenTransport(
        { fetchIdToken },
        fetchImpl,
      );

    await expect(
      transport.send(
        request({
          headers: {
            'X-Serverless-Authorization':
              'Bearer attacker-token',
          },
        }),
      ),
    ).rejects.toEqual(
      new L4WorkerClientError(
        'TRANSPORT_ERROR',
      ),
    );

    expect(fetchIdToken)
      .not.toHaveBeenCalled();

    expect(fetchImpl)
      .not.toHaveBeenCalled();
  });

  it('rejects malformed injected token material before worker fetch', async () => {
    const fetchIdToken =
      vi.fn().mockResolvedValue(
        'bad token with spaces',
      );

    const fetchImpl = vi.fn();

    const transport =
      new CloudRunIdTokenTransport(
        { fetchIdToken },
        fetchImpl,
      );

    await expect(
      transport.send(request()),
    ).rejects.toEqual(
      new L4WorkerClientError(
        'TRANSPORT_ERROR',
      ),
    );

    expect(fetchIdToken)
      .toHaveBeenCalledTimes(1);

    expect(fetchImpl)
      .not.toHaveBeenCalled();
  });

  it('fails closed when ID-token acquisition fails and never calls worker', async () => {
    const fetchIdToken =
      vi.fn().mockRejectedValue(
        new Error('adc unavailable'),
      );

    const fetchImpl = vi.fn();

    const transport =
      new CloudRunIdTokenTransport(
        { fetchIdToken },
        fetchImpl,
      );

    await expect(
      transport.send(request()),
    ).rejects.toEqual(
      new L4WorkerClientError(
        'TRANSPORT_ERROR',
      ),
    );

    expect(fetchIdToken)
      .toHaveBeenCalledTimes(1);

    expect(fetchImpl)
      .not.toHaveBeenCalled();
  });

  it('times out token acquisition without retry', async () => {
    const fetchIdToken =
      vi.fn().mockImplementation(
        () =>
          new Promise(() => {
            // deliberately unresolved
          }),
      );

    const fetchImpl = vi.fn();

    const transport =
      new CloudRunIdTokenTransport(
        { fetchIdToken },
        fetchImpl,
      );

    await expect(
      transport.send(
        request({
          timeoutMs: 10,
        }),
      ),
    ).rejects.toEqual(
      new L4WorkerClientError(
        'TIMEOUT',
      ),
    );

    expect(fetchIdToken)
      .toHaveBeenCalledTimes(1);

    expect(fetchImpl)
      .not.toHaveBeenCalled();
  });

  it('aborts worker fetch on hard timeout and never retries', async () => {
    const fetchIdToken =
      vi.fn().mockResolvedValue(
        'signed.google.id.token',
      );

    const fetchImpl =
      vi.fn().mockImplementation(
        (_url: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>(
            (_resolve, reject) => {
              const signal =
                init?.signal;

              signal?.addEventListener(
                'abort',
                () => {
                  reject(
                    new Error('aborted'),
                  );
                },
                { once: true },
              );
            },
          ),
      );

    const transport =
      new CloudRunIdTokenTransport(
        { fetchIdToken },
        fetchImpl,
      );

    await expect(
      transport.send(
        request({
          timeoutMs: 10,
        }),
      ),
    ).rejects.toEqual(
      new L4WorkerClientError(
        'TIMEOUT',
      ),
    );

    expect(fetchIdToken)
      .toHaveBeenCalledTimes(1);

    expect(fetchImpl)
      .toHaveBeenCalledTimes(1);
  });

  it('maps network failure to TRANSPORT_ERROR without retry', async () => {
    const fetchIdToken =
      vi.fn().mockResolvedValue(
        'signed.google.id.token',
      );

    const fetchImpl =
      vi.fn().mockRejectedValue(
        new Error('network down'),
      );

    const transport =
      new CloudRunIdTokenTransport(
        { fetchIdToken },
        fetchImpl,
      );

    await expect(
      transport.send(request()),
    ).rejects.toEqual(
      new L4WorkerClientError(
        'TRANSPORT_ERROR',
      ),
    );

    expect(fetchIdToken)
      .toHaveBeenCalledTimes(1);

    expect(fetchImpl)
      .toHaveBeenCalledTimes(1);
  });

  it('accepts the 360-second transport timeout bound', async () => {
    const fetchIdToken =
      vi.fn().mockResolvedValue(
        'signed.google.id.token',
      );

    const fetchImpl =
      vi.fn().mockResolvedValue(
        okResponse(),
      );

    const transport =
      new CloudRunIdTokenTransport(
        { fetchIdToken },
        fetchImpl,
      );

    await expect(
      transport.send(
        request({
          timeoutMs: 360000,
        }),
      ),
    ).resolves.toMatchObject({
      status: 200,
    });

    expect(fetchIdToken)
      .toHaveBeenCalledTimes(1);

    expect(fetchImpl)
      .toHaveBeenCalledTimes(1);
  });

  it('rejects timeout above the 360-second transport bound before token or network use', async () => {
    const fetchIdToken =
      vi.fn();

    const fetchImpl =
      vi.fn();

    const transport =
      new CloudRunIdTokenTransport(
        { fetchIdToken },
        fetchImpl,
      );

    await expect(
      transport.send(
        request({
          timeoutMs: 360001,
        }),
      ),
    ).rejects.toEqual(
      new L4WorkerClientError(
        'TRANSPORT_ERROR',
      ),
    );

    expect(fetchIdToken)
      .not.toHaveBeenCalled();

    expect(fetchImpl)
      .not.toHaveBeenCalled();
  });
});
