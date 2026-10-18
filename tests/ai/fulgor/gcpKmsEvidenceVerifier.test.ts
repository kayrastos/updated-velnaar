import {
  generateKeyPairSync,
  sign,
} from 'node:crypto';

import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  GcpKmsEvidenceVerifier,
} from '../../../scripts/fulgor/cloud/gcpKmsEvidenceVerifier';

const resource =
  'projects/p/locations/europe-west4/' +
  'keyRings/r/cryptoKeys/k/' +
  'cryptoKeyVersions/1';

describe(
  'GcpKmsEvidenceVerifier',
  () => {
    it(
      'verifies Ed25519 evidence with the exact KMS version public key',
      async () => {
        const {
          privateKey,
          publicKey,
        } =
          generateKeyPairSync(
            'ed25519',
          );

        const pem =
          publicKey.export({
            type:
              'spki',

            format:
              'pem',
          }).toString();

        let calls =
          0;

        const verifier =
          new GcpKmsEvidenceVerifier({
            keyId:
              'kms-test',

            keyVersionResource:
              resource,

            requester:
              async request => {
                calls +=
                  1;

                expect(
                  request,
                ).toEqual({
                  url:
                    `https://cloudkms.googleapis.com/v1/${resource}/publicKey`,

                  method:
                    'GET',
                });

                return {
                  name:
                    resource,

                  pem,
                };
              },
          });

        const payload =
          Buffer.from(
            'bound-evidence',
          );

        const signature =
          sign(
            null,
            payload,
            privateKey,
          );

        await expect(
          verifier.verify(
            payload,
            signature,
          ),
        ).resolves.toBe(true);

        await expect(
          verifier.verify(
            Buffer.from(
              'tampered',
            ),
            signature,
          ),
        ).resolves.toBe(false);

        expect(
          calls,
        ).toBe(1);
      },
    );

    it(
      'rejects a public key from a different KMS version',
      async () => {
        const {
          publicKey,
        } =
          generateKeyPairSync(
            'ed25519',
          );

        const verifier =
          new GcpKmsEvidenceVerifier({
            keyId:
              'kms-test',

            keyVersionResource:
              resource,

            requester:
              async () => ({
                name:
                  `${resource}-wrong`,

                pem:
                  publicKey.export({
                    type:
                      'spki',

                    format:
                      'pem',
                  }).toString(),
              }),
          });

        await expect(
          verifier.verify(
            Buffer.from(
              'payload',
            ),
            new Uint8Array(
              64,
            ),
          ),
        ).rejects.toThrow(
          /KMS_KEY_VERSION_MISMATCH/,
        );
      },
    );

    it(
      'rejects a non-Ed25519 public key',
      async () => {
        const {
          publicKey,
        } =
          generateKeyPairSync(
            'rsa',
            {
              modulusLength:
                2048,
            },
          );

        const verifier =
          new GcpKmsEvidenceVerifier({
            keyId:
              'kms-test',

            keyVersionResource:
              resource,

            requester:
              async () => ({
                name:
                  resource,

                pem:
                  publicKey.export({
                    type:
                      'spki',

                    format:
                      'pem',
                  }).toString(),
              }),
          });

        await expect(
          verifier.verify(
            Buffer.from(
              'payload',
            ),
            new Uint8Array(
              64,
            ),
          ),
        ).rejects.toThrow(
          /KMS_PUBLIC_KEY_NOT_ED25519/,
        );
      },
    );
  },
);
