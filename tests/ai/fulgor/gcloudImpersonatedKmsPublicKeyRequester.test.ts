import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  createGcloudImpersonatedKmsPublicKeyRequester,
} from '../../../scripts/fulgor/cloud/gcloudImpersonatedKmsRequester';

describe(
  'gcloud impersonated KMS public-key requester',
  () => {
    it(
      'uses controller impersonation for a bounded public-key GET',
      async () => {
        const fetchImpl =
          vi.fn(
            async (
              input:
                string,

              init?:
                RequestInit,
            ) => {
              if (
                input.includes(
                  'iamcredentials.googleapis.com',
                )
              ) {
                return new Response(
                  JSON.stringify({
                    accessToken:
                      'controller-token',
                  }),
                  {
                    status:
                      200,
                  },
                );
              }

              expect(
                init?.method,
              ).toBe('GET');

              expect(
                (
                  init?.headers as
                    Record<string, string>
                ).authorization,
              ).toBe(
                'Bearer controller-token',
              );

              return new Response(
                JSON.stringify({
                  name:
                    'projects/p/locations/europe-west4/keyRings/r/cryptoKeys/k/cryptoKeyVersions/1',

                  pem:
                    'PUBLIC',
                }),
                {
                  status:
                    200,
                },
              );
            },
          );

        const requester =
          createGcloudImpersonatedKmsPublicKeyRequester(
            'controller@project-1.iam.gserviceaccount.com',
            () => ({
              status:
                0,

              stdout:
                'source-token\n',
            }),
            fetchImpl,
          );

        const resource =
          'projects/p/locations/europe-west4/' +
          'keyRings/r/cryptoKeys/k/' +
          'cryptoKeyVersions/1';

        await expect(
          requester({
            url:
              `https://cloudkms.googleapis.com/v1/${resource}/publicKey`,

            method:
              'GET',
          }),
        ).resolves.toMatchObject({
          name:
            resource,
        });

        expect(
          fetchImpl,
        ).toHaveBeenCalledTimes(2);
      },
    );

    it(
      'rejects any URL outside the exact KMS public-key surface',
      async () => {
        const requester =
          createGcloudImpersonatedKmsPublicKeyRequester(
            'controller@project-1.iam.gserviceaccount.com',
            () => ({
              status:
                0,

              stdout:
                'source-token',
            }),
            async () =>
              new Response(
                '{}',
                {
                  status:
                    200,
                },
              ),
          );

        await expect(
          requester({
            url:
              'https://example.com/not-kms',

            method:
              'GET',
          }),
        ).rejects.toThrow(
          /GCLOUD_IMPERSONATED_KMS_REQUEST_FAILED/,
        );
      },
    );
  },
);
