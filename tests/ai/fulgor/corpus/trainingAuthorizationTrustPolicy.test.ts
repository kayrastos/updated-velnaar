import {
  generateKeyPairSync,
} from 'node:crypto';

import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  computeTrainingAuthorizationPublicKeySha256FromPem,
  createTrainingAuthorizationTrustPolicy,
  resolveTrainingAuthorizationTrustedSigner,
  validateTrainingAuthorizationTrustPolicy,
} from '../../../../scripts/fulgor/corpus/authorization/trainingAuthorizationTrustPolicy';

function keyMaterial() {
  const keys =
    generateKeyPairSync(
      'ed25519',
    );

  const publicKeyPem =
    keys.publicKey
      .export({
        type:
          'spki',

        format:
          'pem',
      })
      .toString();

  const fingerprint =
    computeTrainingAuthorizationPublicKeySha256FromPem(
      publicKeyPem,
    );

  return {
    keys,
    publicKeyPem,
    fingerprint,
  };
}

function entry(
  signerKeyId:
    string,

  status:
    'ACTIVE' | 'REVOKED' =
      'ACTIVE',
) {
  const key =
    keyMaterial();

  return {
    key,

    signer: {
      signerKeyId,

      status,

      algorithm:
        'Ed25519' as const,

      signerPublicKeySha256:
        key.fingerprint,

      publicKeyPem:
        key.publicKeyPem,
    },
  };
}

describe(
  'FULGOR training authorization trust policy',
  () => {
    it(
      'resolves an active pinned Ed25519 signer',
      () => {
        const active =
          entry(
            'training-key-v1',
          );

        const policy =
          createTrainingAuthorizationTrustPolicy([
            active.signer,
          ]);

        const result =
          resolveTrainingAuthorizationTrustedSigner(
            policy,
            {
              signerKeyId:
                active.signer
                  .signerKeyId,

              signerPublicKeySha256:
                active.signer
                  .signerPublicKeySha256,

              algorithm:
                'Ed25519',
            },
          );

        expect(
          result.resolved,
        ).toBe(true);
      },
    );

    it(
      'fails closed for an unknown signer',
      () => {
        const policy =
          createTrainingAuthorizationTrustPolicy(
            [],
          );

        const result =
          resolveTrainingAuthorizationTrustedSigner(
            policy,
            {
              signerKeyId:
                'unknown-key',

              signerPublicKeySha256:
                'a'.repeat(64),

              algorithm:
                'Ed25519',
            },
          );

        expect(result)
          .toMatchObject({
            resolved:
              false,

            failureCode:
              'UNKNOWN_SIGNER',
          });
      },
    );

    it(
      'fails closed for a revoked signer',
      () => {
        const revoked =
          entry(
            'training-key-v1',
            'REVOKED',
          );

        const policy =
          createTrainingAuthorizationTrustPolicy([
            revoked.signer,
          ]);

        const result =
          resolveTrainingAuthorizationTrustedSigner(
            policy,
            {
              signerKeyId:
                revoked.signer
                  .signerKeyId,

              signerPublicKeySha256:
                revoked.signer
                  .signerPublicKeySha256,

              algorithm:
                'Ed25519',
            },
          );

        expect(result)
          .toMatchObject({
            resolved:
              false,

            failureCode:
              'SIGNER_REVOKED',
          });
      },
    );

    it(
      'rejects a fingerprint that differs from the pinned signer',
      () => {
        const active =
          entry(
            'training-key-v1',
          );

        const other =
          keyMaterial();

        const policy =
          createTrainingAuthorizationTrustPolicy([
            active.signer,
          ]);

        const result =
          resolveTrainingAuthorizationTrustedSigner(
            policy,
            {
              signerKeyId:
                active.signer
                  .signerKeyId,

              signerPublicKeySha256:
                other.fingerprint,

              algorithm:
                'Ed25519',
            },
          );

        expect(result)
          .toMatchObject({
            resolved:
              false,

            failureCode:
              'SIGNER_FINGERPRINT_MISMATCH',
          });
      },
    );

    it(
      'rejects a signer algorithm mismatch',
      () => {
        const active =
          entry(
            'training-key-v1',
          );

        const policy =
          createTrainingAuthorizationTrustPolicy([
            active.signer,
          ]);

        const result =
          resolveTrainingAuthorizationTrustedSigner(
            policy,
            {
              signerKeyId:
                active.signer
                  .signerKeyId,

              signerPublicKeySha256:
                active.signer
                  .signerPublicKeySha256,

              algorithm:
                'RSA',
            },
          );

        expect(result)
          .toMatchObject({
            resolved:
              false,

            failureCode:
              'SIGNER_ALGORITHM_MISMATCH',
          });
      },
    );

    it(
      'rejects a policy whose declared fingerprint does not match its key',
      () => {
        const active =
          entry(
            'training-key-v1',
          );

        expect(
          () =>
            createTrainingAuthorizationTrustPolicy([
              {
                ...active.signer,

                signerPublicKeySha256:
                  '0'.repeat(64),
              },
            ]),
        ).toThrow(
          /FINGERPRINT_KEY_MISMATCH/,
        );
      },
    );

    it(
      'rejects private key material from the trust registry',
      () => {
        const keys =
          generateKeyPairSync(
            'ed25519',
          );

        const privateKeyPem =
          keys.privateKey
            .export({
              type:
                'pkcs8',

              format:
                'pem',
            })
            .toString();

        expect(
          () =>
            createTrainingAuthorizationTrustPolicy([
              {
                signerKeyId:
                  'training-key-v1',

                status:
                  'ACTIVE',

                algorithm:
                  'Ed25519',

                signerPublicKeySha256:
                  'a'.repeat(64),

                publicKeyPem:
                  privateKeyPem,
              },
            ]),
        ).toThrow(
          /PRIVATE_KEY_MATERIAL_FORBIDDEN/,
        );
      },
    );

    it(
      'supports explicit rotation by rejecting the revoked old key and accepting the active new key',
      () => {
        const oldSigner =
          entry(
            'training-key-2026-v1',
            'REVOKED',
          );

        const newSigner =
          entry(
            'training-key-2026-v2',
            'ACTIVE',
          );

        const policy =
          createTrainingAuthorizationTrustPolicy([
            oldSigner.signer,
            newSigner.signer,
          ]);

        const oldResult =
          resolveTrainingAuthorizationTrustedSigner(
            policy,
            {
              signerKeyId:
                oldSigner.signer
                  .signerKeyId,

              signerPublicKeySha256:
                oldSigner.signer
                  .signerPublicKeySha256,

              algorithm:
                'Ed25519',
            },
          );

        const newResult =
          resolveTrainingAuthorizationTrustedSigner(
            policy,
            {
              signerKeyId:
                newSigner.signer
                  .signerKeyId,

              signerPublicKeySha256:
                newSigner.signer
                  .signerPublicKeySha256,

              algorithm:
                'Ed25519',
            },
          );

        expect(oldResult)
          .toMatchObject({
            resolved:
              false,

            failureCode:
              'SIGNER_REVOKED',
          });

        expect(
          newResult.resolved,
        ).toBe(true);

        const validation =
          validateTrainingAuthorizationTrustPolicy(
            policy,
          );

        expect(
          validation.valid,
        ).toBe(true);
      },
    );
  },
);
