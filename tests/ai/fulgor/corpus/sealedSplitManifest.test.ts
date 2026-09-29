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
  verifySealedCorpusSplitBundle,
} from '../../../../scripts/fulgor/corpus/registry/sealedSplitManifest';

import type {
  FulgorCorpusRecord,
} from '../../../../scripts/fulgor/corpus/corpusRecord';

function sha40(
  number: number,
): string {
  return number
    .toString(16)
    .padStart(
      40,
      '0',
    );
}

function sha64(
  number: number,
): string {
  return number
    .toString(16)
    .padStart(
      64,
      '0',
    );
}

function suffix(
  number: number,
): string {
  return number
    .toString(16)
    .toUpperCase()
    .padStart(
      24,
      '0',
    );
}

function pair(
  number: number,
): FulgorCorpusRecord[] {
  const vulnerableSha =
    sha40(
      number * 2 + 1,
    );

  const fixedSha =
    sha40(
      number * 2 + 2,
    );

  const advisoryId =
    `GHSA-aaaa-bbbb-${number
      .toString(16)
      .padStart(4, '0')}`;

  const make =
    (
      role:
        'VULNERABLE'
          | 'FIXED',
    ): FulgorCorpusRecord => {
      const vulnerable =
        role ===
          'VULNERABLE';

      return {
        schemaVersion:
          'FULGOR_CORPUS_RECORD_V1',

        recordId:
          `FCV1-${role}-${suffix(
            number * 2 +
              (vulnerable
                ? 1
                : 2),
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
            `example/project-${number}`,

          advisoryId,

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
            sha64(
              number * 2 +
                (vulnerable
                  ? 1
                  : 2),
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
          'Assess the path behavior.',

        expectedEvidence: [
          'Evidence exists.',
        ],

        expectedRemediation: [
          'Reject escaped paths.',
        ],

        createdAtUtc:
          '2026-09-27T12:00:00Z',
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
      ) => pair(
        index + 1,
      ),
    ).flat();

  const registry =
    createSignedCorpusRegistry(
      records,
      keys.privateKey,
      'split-test-key',
      '2026-09-27T12:00:00Z',
    );

  return {
    ...keys,
    registry,
  };
}

describe(
  'FULGOR sealed corpus split manifest',
  () => {
    it(
      'deterministically creates train dev and sealed final holdout views',
      () => {
        const {
          registry,
          publicKey,
        } = fixture();

        const first =
          createSealedCorpusSplitBundle(
            registry,
            publicKey,
          );

        const second =
          createSealedCorpusSplitBundle(
            registry,
            publicKey,
          );

        expect(
          first.trainingView
            .manifestSha256,
        ).toBe(
          second.trainingView
            .manifestSha256,
        );

        expect(
          first
            .sealedFinalHoldout
            .holdoutCommitmentSha256,
        ).toBe(
          second
            .sealedFinalHoldout
            .holdoutCommitmentSha256,
        );

        expect(
          first.trainingView
            .trainRecordIds
            .length,
        ).toBeGreaterThan(0);

        expect(
          first.trainingView
            .devRecordIds
            .length,
        ).toBeGreaterThan(0);

        expect(
          first
            .sealedFinalHoldout
            .recordIds
            .length,
        ).toBeGreaterThan(0);
      },
    );

    it(
      'never splits vulnerable and fixed members of one pair across partitions',
      () => {
        const {
          registry,
          publicKey,
        } = fixture();

        const bundle =
          createSealedCorpusSplitBundle(
            registry,
            publicKey,
          );

        const train =
          new Set(
            bundle.trainingView
              .trainPairGroupKeys,
          );

        const dev =
          new Set(
            bundle.trainingView
              .devPairGroupKeys,
          );

        const holdout =
          new Set(
            bundle
              .sealedFinalHoldout
              .pairGroupKeys,
          );

        for (
          const entry of
          registry.entries
        ) {
          const memberships =
            [
              train.has(
                entry.pairGroupKey,
              ),
              dev.has(
                entry.pairGroupKey,
              ),
              holdout.has(
                entry.pairGroupKey,
              ),
            ].filter(Boolean);

          expect(
            memberships.length,
          ).toBe(1);
        }
      },
    );

    it(
      'does not expose final holdout record IDs in the training view',
      () => {
        const {
          registry,
          publicKey,
        } = fixture();

        const bundle =
          createSealedCorpusSplitBundle(
            registry,
            publicKey,
          );

        expect(
          bundle.trainingView
            .finalHoldoutRecordIdsExposed,
        ).toBe(false);

        const serialized =
          JSON.stringify(
            bundle.trainingView,
          );

        for (
          const id of
          bundle
            .sealedFinalHoldout
            .recordIds
        ) {
          expect(serialized)
            .not.toContain(id);
        }
      },
    );

    it(
      'verifies an untouched derived split bundle',
      () => {
        const {
          registry,
          publicKey,
        } = fixture();

        const bundle =
          createSealedCorpusSplitBundle(
            registry,
            publicKey,
          );

        expect(
          verifySealedCorpusSplitBundle(
            bundle,
            registry,
            publicKey,
          ),
        ).toEqual({
          accepted: true,
          failureCodes: [],
        });
      },
    );

    it(
      'detects training manifest tampering',
      () => {
        const {
          registry,
          publicKey,
        } = fixture();

        const original =
          createSealedCorpusSplitBundle(
            registry,
            publicKey,
          );

        const tampered =
          structuredClone(
            original,
          ) as typeof original;

        (
          tampered.trainingView
            .trainRecordIds as string[]
        ).push(
          'FCV1-INJECTED',
        );

        const verified =
          verifySealedCorpusSplitBundle(
            tampered,
            registry,
            publicKey,
          );

        expect(
          verified.accepted,
        ).toBe(false);

        expect(
          verified.failureCodes,
        ).toContain(
          'TRAINING_VIEW_TAMPERED',
        );
      },
    );

    it(
      'detects sealed holdout tampering',
      () => {
        const {
          registry,
          publicKey,
        } = fixture();

        const original =
          createSealedCorpusSplitBundle(
            registry,
            publicKey,
          );

        const tampered =
          structuredClone(
            original,
          ) as typeof original;

        (
          tampered
            .sealedFinalHoldout
            .recordIds as string[]
        ).push(
          'FCV1-INJECTED-HOLDOUT',
        );

        const verified =
          verifySealedCorpusSplitBundle(
            tampered,
            registry,
            publicKey,
          );

        expect(
          verified.accepted,
        ).toBe(false);

        expect(
          verified.failureCodes,
        ).toContain(
          'HOLDOUT_TAMPERED',
        );
      },
    );

    it(
      'never grants train promote or deploy authority',
      () => {
        const {
          registry,
          publicKey,
        } = fixture();

        const bundle =
          createSealedCorpusSplitBundle(
            registry,
            publicKey,
          );

        expect(
          bundle.trainingView
            .trainingExecutionAuthorized,
        ).toBe(false);

        expect(
          bundle.trainingView
            .promotionAuthorized,
        ).toBe(false);

        expect(
          bundle.trainingView
            .deploymentAuthorized,
        ).toBe(false);

        expect(
          bundle
            .sealedFinalHoldout
            .trainingVisible,
        ).toBe(false);

        expect(
          bundle
            .sealedFinalHoldout
            .evaluationOnly,
        ).toBe(true);
      },
    );
  },
);