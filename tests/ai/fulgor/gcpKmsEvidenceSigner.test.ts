import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  GcpKmsEvidenceSigner,
} from '../../../scripts/fulgor/cloud/gcpKmsEvidenceSigner';

const resource =
  'projects/velnar-test/locations/global/' +
  'keyRings/fulgor/cryptoKeys/evidence/' +
  'cryptoKeyVersions/1';

describe(
  'GcpKmsEvidenceSigner',
  () => {
    it(
      'signs using exact KMS key version',
      async () => {
        let captured: unknown = null;

        const expected =
          Buffer.alloc(64, 7);

        const signer =
          new GcpKmsEvidenceSigner({
            keyId:
              'gcp-kms-ed25519-v1',

            keyVersionResource:
              resource,

            requester:
              async (request) => {
                captured = request;

                return {
                  name: resource,
                  signature:
                    expected.toString(
                      'base64',
                    ),
                };
              },
          });

        const payload =
          Buffer.from('fulgor');

        const actual =
          await signer.sign(payload);

        expect(
          Buffer.from(actual)
            .equals(expected),
        ).toBe(true);

        expect(captured).toEqual({
          url:
            'https://cloudkms.googleapis.com/v1/' +
            resource +
            ':asymmetricSign',

          method: 'POST',

          data: {
            data:
              payload.toString(
                'base64',
              ),
          },
        });
      },
    );

    it(
      'fails on key version mismatch',
      async () => {
        const signer =
          new GcpKmsEvidenceSigner({
            keyId:
              'gcp-kms-ed25519-v1',

            keyVersionResource:
              resource,

            requester:
              async () => ({
                name:
                  resource + '-wrong',

                signature:
                  Buffer.alloc(64, 1)
                    .toString('base64'),
              }),
          });

        await expect(
          signer.sign(
            Buffer.from('payload'),
          ),
        ).rejects.toMatchObject({
          code:
            'KMS_KEY_VERSION_MISMATCH',
        });
      },
    );

    it(
      'rejects invalid signature length',
      async () => {
        const signer =
          new GcpKmsEvidenceSigner({
            keyId:
              'gcp-kms-ed25519-v1',

            keyVersionResource:
              resource,

            requester:
              async () => ({
                name: resource,

                signature:
                  Buffer.alloc(63, 1)
                    .toString('base64'),
              }),
          });

        await expect(
          signer.sign(
            Buffer.from('payload'),
          ),
        ).rejects.toMatchObject({
          code:
            'KMS_SIGNATURE_INVALID',
        });
      },
    );

    it(
      'fails closed on requester failure',
      async () => {
        const signer =
          new GcpKmsEvidenceSigner({
            keyId:
              'gcp-kms-ed25519-v1',

            keyVersionResource:
              resource,

            requester:
              async () => {
                throw new Error(
                  'network',
                );
              },
          });

        await expect(
          signer.sign(
            Buffer.from('payload'),
          ),
        ).rejects.toMatchObject({
          code:
            'KMS_REQUEST_FAILED',
        });
      },
    );
  },
);