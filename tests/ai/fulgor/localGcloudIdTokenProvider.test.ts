import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  GcloudIamIdTokenProvider,
} from '../../../scripts/fulgor/cloud/localGcloudIdTokenProvider';

import {
  L4WorkerClientError,
} from '../../../scripts/fulgor/cloud/l4WorkerClient';

const audience =
  'https://fulgor-l4-worker-abc-uc.a.run.app';

const controllerServiceAccount =
  'fulgor-controller@test-project.iam.gserviceaccount.com';

function token(
  overrides: Partial<{
    aud: string;
    email: string;
  }> = {},
): string {
  const claims = {
    aud:
      overrides.aud ??
      audience,

    email:
      overrides.email ??
      controllerServiceAccount,
  };

  return [
    'e30',
    Buffer
      .from(
        JSON.stringify(claims),
      )
      .toString('base64url'),
    'signature',
  ].join('.');
}

describe(
  'local gcloud IAM ID-token provider',
  () => {
    it(
      'generates an audience-bound controller token',
      async () => {
        const accessTokenCommand =
          vi.fn().mockReturnValue({
            status: 0,
            stdout:
              'user-access-token\n',
          });

        const fetchImpl =
          vi.fn().mockResolvedValue(
            new Response(
              JSON.stringify({
                token: token(),
              }),
              {
                status: 200,
                headers: {
                  'content-type':
                    'application/json',
                },
              },
            ),
          );

        const provider =
          new GcloudIamIdTokenProvider(
            controllerServiceAccount,
            accessTokenCommand,
            fetchImpl,
          );

        await expect(
          provider.fetchIdToken(
            audience,
          ),
        ).resolves.toBe(
          token(),
        );

        expect(accessTokenCommand)
          .toHaveBeenCalledTimes(1);

        expect(fetchImpl)
          .toHaveBeenCalledTimes(1);

        const [
          uri,
          init,
        ] =
          fetchImpl.mock.calls[0];

        expect(uri)
          .toContain(
            encodeURIComponent(
              controllerServiceAccount,
            ),
          );

        expect(init.method)
          .toBe('POST');

        const body =
          JSON.parse(
            String(init.body),
          );

        expect(body)
          .toEqual({
            audience,
            includeEmail: true,
          });
      },
    );

    it(
      'fails closed when gcloud access-token acquisition fails',
      async () => {
        const accessTokenCommand =
          vi.fn().mockReturnValue({
            status: 1,
            stdout: '',
          });

        const fetchImpl =
          vi.fn();

        const provider =
          new GcloudIamIdTokenProvider(
            controllerServiceAccount,
            accessTokenCommand,
            fetchImpl,
          );

        await expect(
          provider.fetchIdToken(
            audience,
          ),
        ).rejects.toEqual(
          new L4WorkerClientError(
            'TRANSPORT_ERROR',
          ),
        );

        expect(fetchImpl)
          .not.toHaveBeenCalled();
      },
    );

    it(
      'fails closed on IAM Credentials rejection',
      async () => {
        const accessTokenCommand =
          vi.fn().mockReturnValue({
            status: 0,
            stdout:
              'user-access-token',
          });

        const fetchImpl =
          vi.fn().mockResolvedValue(
            new Response(
              '{"error":"denied"}',
              {
                status: 403,
                headers: {
                  'content-type':
                    'application/json',
                },
              },
            ),
          );

        const provider =
          new GcloudIamIdTokenProvider(
            controllerServiceAccount,
            accessTokenCommand,
            fetchImpl,
          );

        await expect(
          provider.fetchIdToken(
            audience,
          ),
        ).rejects.toEqual(
          new L4WorkerClientError(
            'TRANSPORT_ERROR',
          ),
        );
      },
    );

    it(
      'rejects mismatched audience binding',
      async () => {
        const accessTokenCommand =
          vi.fn().mockReturnValue({
            status: 0,
            stdout:
              'user-access-token',
          });

        const fetchImpl =
          vi.fn().mockResolvedValue(
            new Response(
              JSON.stringify({
                token:
                  token({
                    aud:
                      'https://other-worker-abc-uc.a.run.app',
                  }),
              }),
              {
                status: 200,
              },
            ),
          );

        const provider =
          new GcloudIamIdTokenProvider(
            controllerServiceAccount,
            accessTokenCommand,
            fetchImpl,
          );

        await expect(
          provider.fetchIdToken(
            audience,
          ),
        ).rejects.toEqual(
          new L4WorkerClientError(
            'TRANSPORT_ERROR',
          ),
        );
      },
    );

    it(
      'rejects mismatched controller identity binding',
      async () => {
        const accessTokenCommand =
          vi.fn().mockReturnValue({
            status: 0,
            stdout:
              'user-access-token',
          });

        const fetchImpl =
          vi.fn().mockResolvedValue(
            new Response(
              JSON.stringify({
                token:
                  token({
                    email:
                      'other@test-project.iam.gserviceaccount.com',
                  }),
              }),
              {
                status: 200,
              },
            ),
          );

        const provider =
          new GcloudIamIdTokenProvider(
            controllerServiceAccount,
            accessTokenCommand,
            fetchImpl,
          );

        await expect(
          provider.fetchIdToken(
            audience,
          ),
        ).rejects.toEqual(
          new L4WorkerClientError(
            'TRANSPORT_ERROR',
          ),
        );
      },
    );

    it(
      'rejects non-Cloud-Run audience before token acquisition',
      async () => {
        const accessTokenCommand =
          vi.fn();

        const fetchImpl =
          vi.fn();

        const provider =
          new GcloudIamIdTokenProvider(
            controllerServiceAccount,
            accessTokenCommand,
            fetchImpl,
          );

        await expect(
          provider.fetchIdToken(
            'https://example.com',
          ),
        ).rejects.toEqual(
          new L4WorkerClientError(
            'TRANSPORT_ERROR',
          ),
        );

        expect(accessTokenCommand)
          .not.toHaveBeenCalled();

        expect(fetchImpl)
          .not.toHaveBeenCalled();
      },
    );
  },
);