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
} from '../../../scripts/fulgor/corpus/registry/signedCorpusRegistry';

import {
  createSealedCorpusSplitBundle,
} from '../../../scripts/fulgor/corpus/registry/sealedSplitManifest';

import {
  createTrainingMaterializationManifest,
  verifyTrainingMaterializationManifest,
} from '../../../scripts/fulgor/training/trainingMaterializationManifest';

import type {
  FulgorCorpusRecord,
} from '../../../scripts/fulgor/corpus/corpusRecord';

function sha40(
  value: number,
): string {
  return value
    .toString(16)
    .padStart(
      40,
      '0',
    );
}

function sha64(
  value: number,
): string {
  return value
    .toString(16)
    .padStart(
      64,
      '0',
    );
}

function pair(
  index: number,
): FulgorCorpusRecord[] {
  const vulnerableSha =
    sha40(
      index * 2 + 1,
    );

  const fixedSha =
    sha40(
      index * 2 + 2,
    );

  const advisoryId =
    `GHSA-aaaa-bbbb-${index
      .toString(16)
      .padStart(4, '0')}`;

  const make =
    (
      role:
        'VULNERABLE' | 'FIXED',
    ): FulgorCorpusRecord => {
      const vulnerable =
        role === 'VULNERABLE';

      const sourceSha =
        vulnerable
          ? vulnerableSha
          : fixedSha;

      return {
        schemaVersion:
          'FULGOR_CORPUS_RECORD_V1',

        recordId:
          `FCV1-${role}-${(
            index * 2 +
            (
              vulnerable
                ? 1
                : 2
            )
          )
            .toString(16)
            .toUpperCase()
            .padStart(
              24,
              '0',
            )}`,

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
            `https://github.com/advisories/${advisoryId}`,

          repository:
            `example/project-${index}`,

          advisoryId,

          immutableRevision:
            sourceSha,

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
            sourceSha,

          sourceContentSha256:
            sha64(
              index * 2 +
                (
                  vulnerable
                    ? 1
                    : 2
                ),
            ),
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
            'verified',
          ],
        },

        prompt:
          `Assess exact pair ${index}.`,

        expectedEvidence: [
          'Use exact materialized evidence.',
        ],

        expectedRemediation: [
          'Preserve verified boundary.',
        ],

        createdAtUtc:
          '2026-09-29T12:00:00Z',
      };
    };

  return [
    make(
      'VULNERABLE',
    ),

    make(
      'FIXED',
    ),
  ];
}

function fixture() {
  const keys =
    generateKeyPairSync(
      'ed25519',
    );

  const records =
    Array.from(
      {
        length: 100,
      },

      (
        _,
        index,
      ) =>
        pair(
          index + 1,
        ),
    ).flat();

  const registry =
    createSignedCorpusRegistry(
      records,
      keys.privateKey,
      'training-materialization-key',
      '2026-09-29T12:00:00Z',
    );

  const splitBundle =
    createSealedCorpusSplitBundle(
      registry,
      keys.publicKey,
    );

  return {
    ...keys,
    registry,
    splitBundle,
  };
}

describe(
  'FULGOR training materialization manifest',
  () => {
    it(
      'is deterministic and matches train/dev membership',
      () => {
        const {
          registry,
          splitBundle,
          publicKey,
        } = fixture();

        const first =
          createTrainingMaterializationManifest(
            registry,
            splitBundle,
            publicKey,
          );

        const second =
          createTrainingMaterializationManifest(
            registry,
            splitBundle,
            publicKey,
          );

        expect(
          first.manifestSha256,
        ).toBe(
          second.manifestSha256,
        );

        expect(
          first.trainRequests.length,
        ).toBe(
          splitBundle
            .trainingView
            .trainRecordIds
            .length,
        );

        expect(
          first.devRequests.length,
        ).toBe(
          splitBundle
            .trainingView
            .devRecordIds
            .length,
        );
      },
    );

    it(
      'does not expose final holdout record identities',
      () => {
        const {
          registry,
          splitBundle,
          publicKey,
        } = fixture();

        const manifest =
          createTrainingMaterializationManifest(
            registry,
            splitBundle,
            publicKey,
          );

        const serialized =
          JSON.stringify(
            manifest,
          );

        for (
          const id of
          splitBundle
            .sealedFinalHoldout
            .recordIds
        ) {
          expect(
            serialized,
          ).not.toContain(
            id,
          );
        }

        expect(
          manifest
            .finalHoldoutRecordIdsExposed,
        ).toBe(false);
      },
    );

    it(
      'grants no execution promotion or deployment authority',
      () => {
        const {
          registry,
          splitBundle,
          publicKey,
        } = fixture();

        const manifest =
          createTrainingMaterializationManifest(
            registry,
            splitBundle,
            publicKey,
          );

        expect(
          manifest
            .trainingExecutionAuthorized,
        ).toBe(false);

        expect(
          manifest
            .promotionAuthorized,
        ).toBe(false);

        expect(
          manifest
            .deploymentAuthorized,
        ).toBe(false);
      },
    );

    it(
      'verifies untouched derived manifest',
      () => {
        const {
          registry,
          splitBundle,
          publicKey,
        } = fixture();

        const manifest =
          createTrainingMaterializationManifest(
            registry,
            splitBundle,
            publicKey,
          );

        expect(
          verifyTrainingMaterializationManifest(
            manifest,
            registry,
            splitBundle,
            publicKey,
          ),
        ).toEqual({
          accepted:
            true,

          failureCodes:
            [],
        });
      },
    );

    it(
      'rejects tampered materialization requests',
      () => {
        const {
          registry,
          splitBundle,
          publicKey,
        } = fixture();

        const original =
          createTrainingMaterializationManifest(
            registry,
            splitBundle,
            publicKey,
          );

        const tampered =
          structuredClone(
            original,
          );

        tampered
          .trainRequests[0]
          .repository =
            'attacker/repository';

        const verification =
          verifyTrainingMaterializationManifest(
            tampered,
            registry,
            splitBundle,
            publicKey,
          );

        expect(
          verification.accepted,
        ).toBe(false);

        expect(
          verification.failureCodes,
        ).toContain(
          'MANIFEST_DIGEST_MISMATCH',
        );

        expect(
          verification.failureCodes,
        ).toContain(
          'MANIFEST_DERIVATION_MISMATCH',
        );
      },
    );

    it(
      'binds every visible record to exact immutable source identity',
      () => {
        const {
          registry,
          splitBundle,
          publicKey,
        } = fixture();

        const manifest =
          createTrainingMaterializationManifest(
            registry,
            splitBundle,
            publicKey,
          );

        for (
          const request of
          [
            ...manifest.trainRequests,
            ...manifest.devRequests,
          ]
        ) {
          expect(
            request
              .sourceImmutableRevision,
          ).toBe(
            request
              .sourceCommitSha,
          );

          expect(
            request.sourceCommitSha,
          ).toMatch(
            /^[a-f0-9]{40}$/,
          );

          expect(
            request.vulnerableCommitSha,
          ).toMatch(
            /^[a-f0-9]{40}$/,
          );

          expect(
            request.fixedCommitSha,
          ).toMatch(
            /^[a-f0-9]{40}$/,
          );

          expect(
            request.sourceContentSha256,
          ).toMatch(
            /^[a-f0-9]{64}$/,
          );

          expect(
            request.recordSha256,
          ).toMatch(
            /^[a-f0-9]{64}$/,
          );

          expect(
            request.pairGroupKey,
          ).toMatch(
            /^[a-f0-9]{64}$/,
          );
        }
      },
    );
  },
);
