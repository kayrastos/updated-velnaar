import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  resolveFamilyFromCwes,
} from '../../../../scripts/fulgor/corpus/review/familyResolver';

import {
  buildCorpusReviewCandidate,
} from '../../../../scripts/fulgor/corpus/review/reviewCandidate';

import type {
  BuildReviewCandidateInput,
} from '../../../../scripts/fulgor/corpus/review/reviewCandidate';

import type {
  FulgorAdvisoryCandidate,
} from '../../../../scripts/fulgor/corpus/sources/advisoryCandidate';

import type {
  RepositoryPairEvidence,
} from '../../../../scripts/fulgor/corpus/materialization/repositoryPairEvidence';

const VULN =
  '1111111111111111111111111111111111111111';

const FIX =
  '2222222222222222222222222222222222222222';

function advisory():
  FulgorAdvisoryCandidate {
  return {
    schemaVersion:
      'FULGOR_ADVISORY_CANDIDATE_V1',

    trustState:
      'UNTRUSTED_SOURCE_CANDIDATE',

    provider:
      'GHSA',

    advisoryId:
      'GHSA-test-1234-5678',

    aliases: [
      'CVE-2026-1000',
    ],

    summary:
      'Path traversal',

    details:
      'test',

    severity:
      'high',

    cwes: [
      'CWE-22',
    ],

    references: [],

    affectedPackages: [],

    publishedAtUtc:
      '2026-01-01T00:00:00Z',

    modifiedAtUtc:
      '2026-01-02T00:00:00Z',

    withdrawnAtUtc:
      null,

    sourceUrl:
      'https://github.com/advisories/GHSA-test-1234-5678',

    fetchedAtUtc:
      '2026-09-27T12:00:00Z',
  };
}

function pairEvidence():
  RepositoryPairEvidence {
  const licenseHash =
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

  return {
    vulnerableCommitSha:
      VULN,

    fixedCommitSha:
      FIX,

    fixRelationship:
      'DIRECT_SINGLE_PARENT',

    fixedParents: [
      VULN,
    ],

    diffSha256:
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',

    diffByteLength:
      128,

    changedFiles: [
      'src/path.ts',
    ],

    vulnerableLicense: {
      state:
        'SINGLE_ROOT_LICENSE',

      path:
        'LICENSE',

      blobObjectId:
        'cccccccccccccccccccccccccccccccccccccccc',

      contentSha256:
        licenseHash,

      byteLength:
        1024,
    },

    fixedLicense: {
      state:
        'SINGLE_ROOT_LICENSE',

      path:
        'LICENSE',

      blobObjectId:
        'cccccccccccccccccccccccccccccccccccccccc',

      contentSha256:
        licenseHash,

      byteLength:
        1024,
    },

    licenseContinuity:
      'MATCH',

    eligibleForCorpusReview:
      true,
  };
}

function baseInput():
  BuildReviewCandidateInput {
  return {
    advisory:
      advisory(),

    repository:
      'example/project',

    vulnerableCommitSha:
      VULN,

    fixedCommitSha:
      FIX,

    exactIdentity: {
      accepted: true,
      failureCodes: [],
    },

    pairEvidence:
      pairEvidence(),

    licenseGate: {
      decision:
        'ELIGIBLE_FOR_CORPUS_REVIEW',

      reason:
        'test',
    },

    licenseSpdxId:
      'MIT',

    createdAtUtc:
      '2026-09-27T12:00:00Z',
  };
}

describe(
  'FULGOR corpus review candidate gate',
  () => {
    it(
      'resolves only deterministic CWE families',
      () => {
        expect(
          resolveFamilyFromCwes([
            'CWE-22',
          ]),
        ).toEqual({
          family:
            'PATH_TRAVERSAL',

          matchedCwes: [
            'CWE-22',
          ],

          decision:
            'RESOLVED',
        });
      },
    );

    it(
      'rejects ambiguous CWE families',
      () => {
        const result =
          resolveFamilyFromCwes([
            'CWE-22',
            'CWE-79',
          ]);

        expect(result.family)
          .toBeNull();

        expect(result.decision)
          .toBe(
            'AMBIGUOUS',
          );
      },
    );

    it(
      'builds a review-only candidate after every gate passes',
      () => {
        const result =
          buildCorpusReviewCandidate(
            baseInput(),
          );

        expect(result.accepted)
          .toBe(true);

        expect(
          result.candidate
            ?.trustState,
        ).toBe(
          'CORPUS_REVIEW_CANDIDATE',
        );

        expect(
          result.candidate
            ?.trainingAdmission,
        ).toBe(false);

        expect(
          result.candidate
            ?.vulnerabilityTruthAuthority,
        ).toBe(false);

        expect(
          result.candidate
            ?.family,
        ).toBe(
          'PATH_TRAVERSAL',
        );

        expect(
          result.candidate
            ?.candidateSha256,
        ).toMatch(
          /^[a-f0-9]{64}$/,
        );
      },
    );

    it(
      'rejects withdrawn advisories',
      () => {
        const input =
          baseInput();

        input.advisory.withdrawnAtUtc =
          '2026-02-01T00:00:00Z';

        const result =
          buildCorpusReviewCandidate(
            input,
          );

        expect(result.accepted)
          .toBe(false);

        expect(
          result.failureCodes,
        ).toContain(
          'WITHDRAWN_ADVISORY',
        );
      },
    );

    it(
      'rejects failed exact identity',
      () => {
        const input =
          baseInput();

        input.exactIdentity = {
          accepted: false,
          failureCodes: [
            'ORIGIN_IDENTITY_MISMATCH',
          ],
        };

        const result =
          buildCorpusReviewCandidate(
            input,
          );

        expect(result.accepted)
          .toBe(false);

        expect(
          result.failureCodes,
        ).toContain(
          'EXACT_IDENTITY_REJECTED',
        );
      },
    );

    it(
      'rejects pair evidence that is not review eligible',
      () => {
        const input =
          baseInput();

        input.pairEvidence =
          {
            ...input.pairEvidence,

            fixRelationship:
              'MERGE_COMMIT',

            eligibleForCorpusReview:
              false,
          };

        const result =
          buildCorpusReviewCandidate(
            input,
          );

        expect(result.accepted)
          .toBe(false);

        expect(
          result.failureCodes,
        ).toContain(
          'PAIR_EVIDENCE_REJECTED',
        );
      },
    );

    it(
      'rejects licenses requiring human review',
      () => {
        const input =
          baseInput();

        input.licenseGate = {
          decision:
            'REQUIRES_HUMAN_LICENSE_REVIEW',

          reason:
            'unknown',
        };

        const result =
          buildCorpusReviewCandidate(
            input,
          );

        expect(result.accepted)
          .toBe(false);

        expect(
          result.failureCodes,
        ).toContain(
          'LICENSE_REJECTED',
        );
      },
    );

    it(
      'rejects mismatched pair identities',
      () => {
        const input =
          baseInput();

        input.pairEvidence =
          {
            ...input.pairEvidence,

            fixedCommitSha:
              '3333333333333333333333333333333333333333',
          };

        const result =
          buildCorpusReviewCandidate(
            input,
          );

        expect(result.accepted)
          .toBe(false);

        expect(
          result.failureCodes,
        ).toContain(
          'COMMIT_PAIR_MISMATCH',
        );
      },
    );
  },
);