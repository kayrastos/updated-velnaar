import {
  generateKeyPairSync,
} from 'node:crypto';

import type {
  D1Database,
} from '@cloudflare/workers-types';

import {
  describe,
  expect,
  it,
} from 'vitest';

import type {
  FulgorCorpusRecord,
} from '../../../../scripts/fulgor/corpus/corpusRecord';

import {
  createSignedCorpusRegistry,
} from '../../../../scripts/fulgor/corpus/registry/signedCorpusRegistry';

import {
  createSealedCorpusSplitBundle,
} from '../../../../scripts/fulgor/corpus/registry/sealedSplitManifest';

import {
  consumeTrainingExecutionAuthorization,
  createTrainingExecutionAuthorization,
} from '../../../../scripts/fulgor/corpus/authorization/trainingExecutionAuthorization';

import type {
  TrainingExecutionAuthorization,
} from '../../../../scripts/fulgor/corpus/authorization/trainingExecutionAuthorization';

import {
  D1TrainingAuthorizationReplayStore,
} from '../../../../scripts/fulgor/corpus/authorization/d1TrainingAuthorizationReplayStore';

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
        `https://github.com/advisories/GHSA-e2e-${seed}`,

      repository:
        `example/e2e-project-${seed}`,

      advisoryId:
        `GHSA-e2e-${seed}`,

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
        'end-to-end durable replay verification',
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

function createAuthorizationFixture() {
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
      'registry-e2e-key',
      '2026-09-29T06:00:00Z',
    );

  const splitBundle =
    createSealedCorpusSplitBundle(
      registry,
      registryKeys.publicKey,
    );

  const nowMs =
    Date.now();

  const nowUtc =
    new Date(
      nowMs,
    ).toISOString();

  const authorization =
    createTrainingExecutionAuthorization({
      registry,
      splitBundle,

      registryPublicKey:
        registryKeys.publicKey,

      authorizationPrivateKey:
        authorizationKeys.privateKey,

      signerKeyId:
        'training-auth-e2e-key-1',

      humanApproverId:
        'human-approver-e2e-1',

      explicitHumanApproval:
        true,

      trainingRunId:
        'candidate-run-e2e-001',

      nonce:
        'e2e_nonce_00000001',

      issuedAtUtc:
        new Date(
          nowMs - 60_000,
        ).toISOString(),

      expiresAtUtc:
        new Date(
          nowMs + 10 * 60_000,
        ).toISOString(),
    });

  return {
    registryKeys,
    authorizationKeys,
    registry,
    splitBundle,
    authorization,
    nowUtc,
  };
}

function createAtomicMockD1() {
  const ledger =
    new Set<string>();

  let prepareCalls =
    0;

  const db = {
    prepare() {
      prepareCalls +=
        1;

      return {
        bind(
          ...params:
            unknown[]
        ) {
          return {
            async all() {
              const replayKey =
                params[0] as string;

              if (
                ledger.has(
                  replayKey,
                )
              ) {
                return {
                  success:
                    true,

                  results: [],

                  meta: {
                    changed_db:
                      false,

                    rows_written:
                      0,
                  },
                };
              }

              ledger.add(
                replayKey,
              );

              return {
                success:
                  true,

                results: [
                  {
                    replay_key:
                      replayKey,
                  },
                ],

                meta: {
                  changed_db:
                    true,

                  rows_written:
                    1,
                },
              };
            },
          };
        },
      };
    },
  } as unknown as D1Database;

  return {
    db,
    ledger,

    getPrepareCalls() {
      return prepareCalls;
    },
  };
}

function createUnavailableD1():
  D1Database {
  return {
    prepare() {
      return {
        bind() {
          return {
            async all() {
              throw new Error(
                'simulated-d1-unavailable',
              );
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

describe(
  'FULGOR D1 end-to-end training authorization consumption',
  () => {
    it(
      'allows one exact signed authorization and rejects its durable replay',
      async () => {
        const data =
          createAuthorizationFixture();

        const storage =
          createAtomicMockD1();

        const store =
          new D1TrainingAuthorizationReplayStore(
            storage.db,
          );

        const first =
          await consumeTrainingExecutionAuthorization(
            data.authorization,
            data.registry,
            data.splitBundle,
            data.registryKeys.publicKey,
            data.authorizationKeys.publicKey,
            store,
            data.nowUtc,
          );

        expect(first)
          .toEqual({
            authorized:
              true,

            nonceConsumed:
              true,

            failureCodes: [],
          });

        expect(
          storage.ledger.size,
        ).toBe(1);

        const second =
          await consumeTrainingExecutionAuthorization(
            data.authorization,
            data.registry,
            data.splitBundle,
            data.registryKeys.publicKey,
            data.authorizationKeys.publicKey,
            store,
            data.nowUtc,
          );

        expect(
          second.authorized,
        ).toBe(false);

        expect(
          second.nonceConsumed,
        ).toBe(false);

        expect(
          second.failureCodes,
        ).toEqual([
          'REPLAY_DETECTED',
        ]);

        expect(
          storage.ledger.size,
        ).toBe(1);

        expect(
          storage.getPrepareCalls(),
        ).toBe(2);
      },
    );

    it(
      'fails closed end-to-end when durable D1 reservation is unavailable',
      async () => {
        const data =
          createAuthorizationFixture();

        const store =
          new D1TrainingAuthorizationReplayStore(
            createUnavailableD1(),
          );

        const result =
          await consumeTrainingExecutionAuthorization(
            data.authorization,
            data.registry,
            data.splitBundle,
            data.registryKeys.publicKey,
            data.authorizationKeys.publicKey,
            store,
            data.nowUtc,
          );

        expect(result)
          .toEqual({
            authorized:
              false,

            nonceConsumed:
              false,

            failureCodes: [
              'REPLAY_BACKEND_UNAVAILABLE',
            ],
          });
      },
    );

    it(
      'never reaches D1 when the signed authorization is invalid',
      async () => {
        const data =
          createAuthorizationFixture();

        const storage =
          createAtomicMockD1();

        const store =
          new D1TrainingAuthorizationReplayStore(
            storage.db,
          );

        const tampered = {
          ...data.authorization,

          sourceTrainingManifestSha256:
            'f'.repeat(64),
        } as TrainingExecutionAuthorization;

        const result =
          await consumeTrainingExecutionAuthorization(
            tampered,
            data.registry,
            data.splitBundle,
            data.registryKeys.publicKey,
            data.authorizationKeys.publicKey,
            store,
            data.nowUtc,
          );

        expect(
          result.authorized,
        ).toBe(false);

        expect(
          result.nonceConsumed,
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

        expect(
          storage.getPrepareCalls(),
        ).toBe(0);

        expect(
          storage.ledger.size,
        ).toBe(0);
      },
    );
  },
);
