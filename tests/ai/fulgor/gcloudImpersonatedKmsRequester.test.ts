import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  createGcloudImpersonatedKmsRequester,
} from '../../../scripts/fulgor/cloud/gcloudImpersonatedKmsRequester';

const controller =
  'fulgor-controller@test-project.iam.gserviceaccount.com';

const resource =
  'projects/test-project/locations/europe-west4/' +
  'keyRings/fulgor/cryptoKeys/evidence/' +
  'cryptoKeyVersions/1';

const request = {
  url:
    'https://cloudkms.googleapis.com/v1/' +
    resource +
    ':asymmetricSign',

  method:
    'POST' as const,

  data: {
    data:
      Buffer.from('fulgor')
        .toString('base64'),
  },
};

describe(
  'gcloud impersonated KMS requester',
  () => {
    it(
      'uses the controller access token for KMS',
      async () => {
        const command =
          vi.fn().mockReturnValue({
            status: 0,
            stdout:
              'source-user-token',
          });

        const fetchImpl =
          vi.fn()
            .mockResolvedValueOnce(
              new Response(
                JSON.stringify({
                  accessToken:
                    'controller-access-token',

                  expireTime:
                    '2099-01-01T00:00:00Z',
                }),
                {
                  status: 200,
                },
              ),
            )
            .mockResolvedValueOnce(
              new Response(
                JSON.stringify({
                  name:
                    resource,

                  signature:
                    Buffer.alloc(64, 7)
                      .toString('base64'),
                }),
                {
                  status: 200,
                },
              ),
            );

        const requester =
          createGcloudImpersonatedKmsRequester(
            controller,
            command,
            fetchImpl,
          );

        const result =
          await requester(request);

        expect(command)
          .toHaveBeenCalledTimes(1);

        expect(fetchImpl)
          .toHaveBeenCalledTimes(2);

        const iamCall =
          fetchImpl.mock.calls[0];

        expect(
          String(iamCall[0]),
        ).toContain(
          ':generateAccessToken',
        );

        expect(
          (
            iamCall[1]!.headers as
              Record<string, string>
          ).authorization,
        ).toBe(
          'Bearer source-user-token',
        );

        const kmsCall =
          fetchImpl.mock.calls[1];

        expect(kmsCall[0])
          .toBe(request.url);

        expect(
          (
            kmsCall[1]!.headers as
              Record<string, string>
          ).authorization,
        ).toBe(
          'Bearer controller-access-token',
        );

        expect(result)
          .toMatchObject({
            name:
              resource,
          });
      },
    );

    it(
      'fails closed when source token acquisition fails',
      async () => {
        const fetchImpl =
          vi.fn();

        const requester =
          createGcloudImpersonatedKmsRequester(
            controller,
            () => ({
              status: 1,
              stdout: '',
            }),
            fetchImpl,
          );

        await expect(
          requester(request),
        ).rejects.toBeDefined();

        expect(fetchImpl)
          .not.toHaveBeenCalled();
      },
    );

    it(
      'fails closed when impersonation response lacks accessToken',
      async () => {
        const fetchImpl =
          vi.fn().mockResolvedValue(
            new Response(
              JSON.stringify({
                expireTime:
                  '2099-01-01T00:00:00Z',
              }),
              {
                status: 200,
              },
            ),
          );

        const requester =
          createGcloudImpersonatedKmsRequester(
            controller,
            () => ({
              status: 0,
              stdout:
                'source-user-token',
            }),
            fetchImpl,
          );

        await expect(
          requester(request),
        ).rejects.toBeDefined();

        expect(fetchImpl)
          .toHaveBeenCalledTimes(1);
      },
    );

    it(
      'rejects non-KMS destination before credentials are acquired',
      async () => {
        const command =
          vi.fn();

        const fetchImpl =
          vi.fn();

        const requester =
          createGcloudImpersonatedKmsRequester(
            controller,
            command,
            fetchImpl,
          );

        await expect(
          requester({
            ...request,

            url:
              'https://example.com/sign',
          }),
        ).rejects.toBeDefined();

        expect(command)
          .not.toHaveBeenCalled();

        expect(fetchImpl)
          .not.toHaveBeenCalled();
      },
    );
  },
);