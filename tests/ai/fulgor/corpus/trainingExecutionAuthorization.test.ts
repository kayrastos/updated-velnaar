import {
  generateKeyPairSync,
} from 'node:crypto';

import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  createSignedCorpusRegistry,
} from '../../../../scripts/fulgor/corpus/registry/signedCorpusRegistry';

import {
  createSealedCorpusSplitBundle,
} from '../../../../scripts/fulgor/corpus/registry/sealedSplitManifest';

import {
  consumeTrainingExecutionAuthorization,
  createInMemoryTrainingAuthorizationReplayStore,
  createTrainingExecutionAuthorization,
} from '../../../../scripts/fulgor/corpus/authorization/trainingExecutionAuthorization';

import type {
  FulgorCorpusRecord,
} from '../../../../scripts/fulgor/corpus/corpusRecord';

function record(
  role:
    'VULNERABLE' | 'FIXED',

  seed = 1,
): FulgorCorpusRecord {
  const vulnerable =
    role ===
      'VULNERABLE';

  const vulnerableSha =
    seed
      .toString(16)
      .padStart(
        40,
        '1',
      )
      .slice(-40);

  const fixedSha =
    (seed + 1)
      .toString(16)
      .padStart(
        40,
        '2',
      )
      .slice(-40);

  return {
    schemaVersion:
      'FULGOR_CORPUS_RECORD_V1',

    recordId:
      vulnerable
        ? `FCV1-VULNERABLE-${seed
            .toString(16)
            .toUpperCase()
            .padStart(24, 'A')}`
        : `FCV1-FIXED-${seed
            .toString(16)
            .toUpperCase()
            .padStart(24, 'B')}`,

    family:
      'PATH_TRAVERSAL',

    verdict:
      vulnerable
        ? 'CONFIRMED_RISK'
        : 'REJECT_CANDIDATE',

    role,

    classification:
      'WHITE_PUBLIC',

    source: {
      sourceKind:
        'GHSA',

      sourceUrl:
        `https://github.com/advisories/GHSA-test-${seed}`,

      repository:
        `example/project-${seed}`,

      advisoryId:
        `GHSA-test-${seed}`,

      immutableRevision:
        vulnerable
          ? vulnerableSha
          : fixedSha,

      license:
        'MIT',

      licenseUrl:
        null,
    },

    provenance: {
      vulnerableCommitSha:
        vulnerableSha,

      fixedCommitSha:
        fixedSha,

      sourceCommitSha:
        vulnerable
          ? vulnerableSha
          : fixedSha,

      sourceContentSha256:
        (
          vulnerable
            ? 'a'
            : 'b'
        ).repeat(64),
    },

    verification: {
      proofTypes: [
        'PATCH_DIFF',
        'EXECUTABLE',
      ],

      executableVerified:
        true,

      staticAnalysisVerified:
        false,

      notes: [
        'independently verified',
      ],
    },

    prompt:
      'Assess path traversal behavior.',

    expectedEvidence: [
      'Exact behavior evidence.',
    ],

    expectedRemediation: [
      'Reject escaped paths.',
    ],

    createdAtUtc:
      '2026-09-29T06:00:00Z',
  };
}

function fixture(
  seed = 1,
) {
  const registryKeys =
    generateKeyPairSync(
      'ed25519',
    );

  const authorizationKeys =
    generateKeyPairSync(
      'ed25519',
    );

  const registry =
    createSignedCorpusRegistry(
      [
        record(
          'VULNERABLE',
          seed,
        ),

        record(
          'FIXED',
          seed,
        ),
      ],
      registryKeys.privateKey,
      'registry-test-key',
      '2026-09-29T06:00:00Z',
    );

  const splitBundle =
    createSealedCorpusSplitBundle(
      registry,
      registryKeys.publicKey,
    );

  const authorization =
    createTrainingExecutionAuthorization({
      registry,
      splitBundle,

      registryPublicKey:
        registryKeys.publicKey,

      authorizationPrivateKey:
        authorizationKeys.privateKey,

      signerKeyId:
        'training-auth-key-1',

      humanApproverId:
        'human-approver-1',

      explicitHumanApproval:
        true,

      trainingRunId:
        'candidate-run-001',

      nonce:
        'nonce-000000000001',

      issuedAtUtc:
        '2026-09-29T07:00:00Z',

      expiresAtUtc:
        '2026-09-29T07:15:00Z',
    });

  return {
    registryKeys,
    authorizationKeys,
    registry,
    splitBundle,
    authorization,
  };
}

describe(
  'FULGOR training execution authorization',
  () => {
    it(
      'authorizes one exact signed training execution',
      () => {
        const data =
          fixture();

        const replay =
          createInMemoryTrainingAuthorizationReplayStore();

        const result =
          consumeTrainingExecutionAuthorization(
            data.authorization,
            data.registry,
            data.splitBundle,
            data.registryKeys.publicKey,
            data.authorizationKeys.publicKey,
            replay,
            '2026-09-29T07:05:00Z',
          );

        expect(result)
          .toEqual({
            authorized:
              true,

            nonceConsumed:
              true,

            failureCodes: [],
          });
      },
    );

    it(
      'requires explicit human approval at issuance',
      () => {
        const registryKeys =
          generateKeyPairSync(
            'ed25519',
          );

        const authorizationKeys =
          generateKeyPairSync(
            'ed25519',
          );

        const registry =
          createSignedCorpusRegistry(
            [
              record(
                'VULNERABLE',
              ),
              record(
                'FIXED',
              ),
            ],
            registryKeys.privateKey,
            'registry-test-key',
            '2026-09-29T06:00:00Z',
          );

        const splitBundle =
          createSealedCorpusSplitBundle(
            registry,
            registryKeys.publicKey,
          );

        expect(
          () =>
            createTrainingExecutionAuthorization({
              registry,
              splitBundle,

              registryPublicKey:
                registryKeys.publicKey,

              authorizationPrivateKey:
                authorizationKeys.privateKey,

              signerKeyId:
                'training-auth-key-1',

              humanApproverId:
                'human-approver-1',

              explicitHumanApproval:
                false,

              trainingRunId:
                'candidate-run-001',

              nonce:
                'nonce-000000000001',

              issuedAtUtc:
                '2026-09-29T07:00:00Z',

              expiresAtUtc:
                '2026-09-29T07:15:00Z',
            }),
        ).toThrow(
          'AUTH_HUMAN_APPROVAL_REQUIRED',
        );
      },
    );

    it(
      'rejects replay of a consumed authorization',
      () => {
        const data =
          fixture();

        const replay =
          createInMemoryTrainingAuthorizationReplayStore();

        const first =
          consumeTrainingExecutionAuthorization(
            data.authorization,
            data.registry,
            data.splitBundle,
            data.registryKeys.publicKey,
            data.authorizationKeys.publicKey,
            replay,
            '2026-09-29T07:05:00Z',
          );

        const second =
          consumeTrainingExecutionAuthorization(
            data.authorization,
            data.registry,
            data.splitBundle,
            data.registryKeys.publicKey,
            data.authorizationKeys.publicKey,
            replay,
            '2026-09-29T07:06:00Z',
          );

        expect(
          first.authorized,
        ).toBe(true);

        expect(
          second.authorized,
        ).toBe(false);

        expect(
          second.failureCodes,
        ).toContain(
          'REPLAY_DETECTED',
        );
      },
    );

    it(
      'rejects expired authorization',
      () => {
        const data =
          fixture();

        const result =
          consumeTrainingExecutionAuthorization(
            data.authorization,
            data.registry,
            data.splitBundle,
            data.registryKeys.publicKey,
            data.authorizationKeys.publicKey,
            createInMemoryTrainingAuthorizationReplayStore(),
            '2026-09-29T07:30:00Z',
          );

        expect(
          result.authorized,
        ).toBe(false);

        expect(
          result.failureCodes,
        ).toContain(
          'AUTHORIZATION_EXPIRED',
        );
      },
    );

    it(
      'rejects training manifest tampering',
      () => {
        const data =
          fixture();

        const tampered =
          structuredClone(
            data.authorization,
          ) as typeof data.authorization;

        (
          tampered as {
            sourceTrainingManifestSha256:
              string;
          }
        ).sourceTrainingManifestSha256 =
          'f'.repeat(64);

        const result =
          consumeTrainingExecutionAuthorization(
            tampered,
            data.registry,
            data.splitBundle,
            data.registryKeys.publicKey,
            data.authorizationKeys.publicKey,
            createInMemoryTrainingAuthorizationReplayStore(),
            '2026-09-29T07:05:00Z',
          );

        expect(
          result.authorized,
        ).toBe(false);

        expect(
          result.failureCodes,
        ).toContain(
          'MANIFEST_BINDING_MISMATCH',
        );

        expect(
          result.failureCodes,
        ).toContain(
          'INVALID_SIGNATURE',
        );
      },
    );

    it(
      'rejects use against another valid registry',
      () => {
        const first =
          fixture(1);

        const otherRegistry =
          createSignedCorpusRegistry(
            [
              record(
                'VULNERABLE',
                2,
              ),

              record(
                'FIXED',
                2,
              ),
            ],
            first
              .registryKeys
              .privateKey,
            'registry-test-key',
            '2026-09-29T06:00:00Z',
          );

        const otherSplit =
          createSealedCorpusSplitBundle(
            otherRegistry,
            first
              .registryKeys
              .publicKey,
          );

        const result =
          consumeTrainingExecutionAuthorization(
            first.authorization,
            otherRegistry,
            otherSplit,
            first
              .registryKeys
              .publicKey,
            first
              .authorizationKeys
              .publicKey,
            createInMemoryTrainingAuthorizationReplayStore(),
            '2026-09-29T07:05:00Z',
          );

        expect(
          result.authorized,
        ).toBe(false);

        expect(
          result.failureCodes,
        ).toContain(
          'REGISTRY_BINDING_MISMATCH',
        );
      },
    );

    it(
      'rejects authorization signed by another key',
      () => {
        const data =
          fixture();

        const otherKey =
          generateKeyPairSync(
            'ed25519',
          );

        const result =
          consumeTrainingExecutionAuthorization(
            data.authorization,
            data.registry,
            data.splitBundle,
            data.registryKeys.publicKey,
            otherKey.publicKey,
            createInMemoryTrainingAuthorizationReplayStore(),
            '2026-09-29T07:05:00Z',
          );

        expect(
          result.authorized,
        ).toBe(false);

        expect(
          result.failureCodes,
        ).toContain(
          'PUBLIC_KEY_MISMATCH',
        );

        expect(
          result.failureCodes,
        ).toContain(
          'INVALID_SIGNATURE',
        );
      },
    );

    it(
      'authorizes training only and never promotion or deployment',
      () => {
        const data =
          fixture();

        expect(
          data.authorization
            .trainingExecutionAuthorized,
        ).toBe(true);

        expect(
          data.authorization
            .promotionAuthorized,
        ).toBe(false);

        expect(
          data.authorization
            .deploymentAuthorized,
        ).toBe(false);
      },
    );
  },
);
