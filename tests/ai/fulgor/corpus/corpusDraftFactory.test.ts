import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  buildCorpusDraftBundle,
} from '../../../../scripts/fulgor/corpus/factory/reviewCandidateToDrafts';

import type {
  CorpusReviewCandidate,
} from '../../../../scripts/fulgor/corpus/review/reviewCandidate';

const VULN =
  '1111111111111111111111111111111111111111';

const FIX =
  '2222222222222222222222222222222222222222';

function candidate():
  CorpusReviewCandidate {
  return {
    schemaVersion:
      'FULGOR_CORPUS_REVIEW_CANDIDATE_V1',

    trustState:
      'CORPUS_REVIEW_CANDIDATE',

    trainingAdmission:
      false,

    vulnerabilityTruthAuthority:
      false,

    provider:
      'GHSA',

    advisoryId:
      'GHSA-test-1111-2222',

    sourceUrl:
      'https://github.com/advisories/GHSA-test-1111-2222',

    family:
      'PATH_TRAVERSAL',

    matchedCwes: [
      'CWE-22',
    ],

    repository:
      'example/project',

    vulnerableCommitSha:
      VULN,

    fixedCommitSha:
      FIX,

    diffSha256:
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',

    diffByteLength:
      123,

    changedFiles: [
      'src/path.ts',
    ],

    license: {
      spdxId:
        'MIT',

      path:
        'LICENSE',

      contentSha256:
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    },

    evidence: {
      exactIdentityAccepted:
        true,

      pairEvidenceAccepted:
        true,

      licenseReviewEligible:
        true,

      directParent:
        true,

      licenseContinuity:
        'MATCH',
    },

    createdAtUtc:
      '2026-09-27T12:00:00Z',

    candidateSha256:
      'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  };
}

describe(
  'FULGOR corpus draft factory',
  () => {
    it(
      'creates vulnerable and fixed drafts with opposite expected verdicts',
      () => {
        const bundle =
          buildCorpusDraftBundle(
            candidate(),
          );

        expect(
          bundle
            .vulnerableDraft
            .role,
        ).toBe(
          'VULNERABLE',
        );

        expect(
          bundle
            .vulnerableDraft
            .expectedVerdict,
        ).toBe(
          'CONFIRMED_RISK',
        );

        expect(
          bundle
            .fixedDraft
            .role,
        ).toBe(
          'FIXED',
        );

        expect(
          bundle
            .fixedDraft
            .expectedVerdict,
        ).toBe(
          'REJECT_CANDIDATE',
        );
      },
    );

    it(
      'keeps the entire vulnerability family in one leakage/isolation group',
      () => {
        const bundle =
          buildCorpusDraftBundle(
            candidate(),
          );

        expect(
          bundle
            .vulnerableDraft
            .corpusGroupKey,
        ).toBe(
          bundle.corpusGroupKey,
        );

        expect(
          bundle
            .fixedDraft
            .corpusGroupKey,
        ).toBe(
          bundle.corpusGroupKey,
        );

        expect(
          bundle
            .hardNegativeRequest
            .corpusGroupKey,
        ).toBe(
          bundle.corpusGroupKey,
        );
      },
    );

    it(
      'produces deterministic derivative digests',
      () => {
        const first =
          buildCorpusDraftBundle(
            candidate(),
          );

        const second =
          buildCorpusDraftBundle(
            candidate(),
          );

        expect(
          first
            .vulnerableDraft
            .draftSha256,
        ).toBe(
          second
            .vulnerableDraft
            .draftSha256,
        );

        expect(
          first
            .fixedDraft
            .draftSha256,
        ).toBe(
          second
            .fixedDraft
            .draftSha256,
        );

        expect(
          first
            .hardNegativeRequest
            .requestSha256,
        ).toBe(
          second
            .hardNegativeRequest
            .requestSha256,
        );
      },
    );

    it(
      'never upgrades drafts or generation requests to training authority',
      () => {
        const bundle =
          buildCorpusDraftBundle(
            candidate(),
          );

        expect(
          bundle
            .vulnerableDraft
            .trainingAdmission,
        ).toBe(false);

        expect(
          bundle
            .fixedDraft
            .trainingAdmission,
        ).toBe(false);

        expect(
          bundle
            .hardNegativeRequest
            .trainingAdmission,
        ).toBe(false);

        expect(
          bundle
            .hardNegativeRequest
            .generationAuthority,
        ).toBe(false);

        expect(
          bundle
            .hardNegativeRequest
            .requiresIndependentVerification,
        ).toBe(true);
      },
    );

    it(
      'rejects authority escape from an upstream review candidate',
      () => {
        const input =
          candidate();

        (
          input as unknown as {
            trainingAdmission:
              boolean;
          }
        ).trainingAdmission =
          true;

        expect(
          () =>
            buildCorpusDraftBundle(
              input,
            ),
        ).toThrow(
          'DRAFT_AUTHORITY_ESCAPE',
        );
      },
    );

    it(
      'rejects incomplete review evidence',
      () => {
        const input =
          candidate();

        (
          input.evidence as unknown as {
            directParent:
              boolean;
          }
        ).directParent =
          false;

        expect(
          () =>
            buildCorpusDraftBundle(
              input,
            ),
        ).toThrow(
          'DRAFT_EVIDENCE_INCOMPLETE',
        );
      },
    );
  },
);