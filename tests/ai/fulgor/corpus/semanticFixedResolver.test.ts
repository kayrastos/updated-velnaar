import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  classifyMaterializedFixedRelationship,
  extractSemanticFixedBoundaries,
} from '../../../../scripts/fulgor/corpus/sources/semanticFixedResolver';

import type {
  FulgorAdvisoryCandidate,
} from '../../../../scripts/fulgor/corpus/sources/advisoryCandidate';

const INTRODUCED =
  '1111111111111111111111111111111111111111';

const PATCH =
  '2222222222222222222222222222222222222222';

const BOUNDARY =
  '3333333333333333333333333333333333333333';

function candidate(
  repositoryUrl:
    string | null =
      'https://github.com/example/project',
  fixed:
    string =
      BOUNDARY,
): FulgorAdvisoryCandidate {
  return {
    schemaVersion:
      'FULGOR_ADVISORY_CANDIDATE_V1',

    trustState:
      'UNTRUSTED_SOURCE_CANDIDATE',

    provider:
      'OSV',

    advisoryId:
      'CVE-2026-9001',

    aliases: [],

    summary:
      'test',

    details:
      'test',

    severity:
      null,

    cwes:
      ['CWE-22'],

    references: [],

    affectedPackages: [
      {
        ecosystem:
          'npm',

        name:
          '@example/project',

        ranges: [],

        gitRanges: [
          {
            repositoryUrl,

            events: [
              {
                kind:
                  'INTRODUCED',

                commit:
                  INTRODUCED,
              },
              {
                kind:
                  'FIXED',

                commit:
                  fixed,
              },
            ],
          },
        ],
      },
    ],

    publishedAtUtc:
      null,

    modifiedAtUtc:
      null,

    withdrawnAtUtc:
      null,

    sourceUrl:
      'https://osv.dev/vulnerability/CVE-2026-9001',

    fetchedAtUtc:
      '2026-09-29T10:00:00.000Z',
  };
}

describe(
  'FULGOR semantic fixed resolver',
  () => {
    it(
      'extracts OSV fixed events only as untrusted range-boundary hypotheses',
      () => {
        const result =
          extractSemanticFixedBoundaries(
            candidate(),
          );

        expect(result)
          .toHaveLength(1);

        expect(result[0])
          .toMatchObject({
            trustState:
              'UNTRUSTED_FIXED_RANGE_BOUNDARY',

            repository:
              'example/project',

            fixedCommitSha:
              BOUNDARY,

            introducedCommitSha:
              INTRODUCED,

            introducedFromRepositoryRoot:
              false,

            semanticRole:
              'OSV_GIT_FIXED_RANGE_BOUNDARY',
          });
      },
    );

    it(
      'rejects non-exact fixed commit identifiers',
      () => {
        expect(
          extractSemanticFixedBoundaries(
            candidate(
              undefined,
              'abc123',
            ),
          ),
        ).toEqual([]);
      },
    );

    it(
      'rejects non-GitHub repository identities for V1 semantic resolution',
      () => {
        expect(
          extractSemanticFixedBoundaries(
            candidate(
              'https://example.com/example/project',
            ),
          ),
        ).toEqual([]);
      },
    );

    it(
      'classifies a direct patch followed by a later OSV boundary without replacing the patch',
      () => {
        expect(
          classifyMaterializedFixedRelationship({
            vulnerableCommitSha:
              INTRODUCED,

            patchCommitSha:
              PATCH,

            fixedBoundaryCommitSha:
              BOUNDARY,

            patchParentCommitShas:
              [INTRODUCED],

            patchIsAncestorOfFixedBoundary:
              true,

            fixedBoundaryIsAncestorOfPatch:
              false,
          }),
        ).toBe(
          'PATCH_PRECEDES_FIXED_RANGE_BOUNDARY',
        );
      },
    );

    it(
      'allows patch and fixed boundary to be the same exact commit when graph evidence proves it',
      () => {
        expect(
          classifyMaterializedFixedRelationship({
            vulnerableCommitSha:
              INTRODUCED,

            patchCommitSha:
              PATCH,

            fixedBoundaryCommitSha:
              PATCH,

            patchParentCommitShas:
              [INTRODUCED],

            patchIsAncestorOfFixedBoundary:
              true,

            fixedBoundaryIsAncestorOfPatch:
              true,
          }),
        ).toBe(
          'PATCH_EQUALS_FIXED_RANGE_BOUNDARY',
        );
      },
    );

    it(
      'fails closed when the patch is not the vulnerable commit direct child',
      () => {
        expect(
          classifyMaterializedFixedRelationship({
            vulnerableCommitSha:
              INTRODUCED,

            patchCommitSha:
              PATCH,

            fixedBoundaryCommitSha:
              BOUNDARY,

            patchParentCommitShas:
              [
                '4444444444444444444444444444444444444444',
              ],

            patchIsAncestorOfFixedBoundary:
              true,

            fixedBoundaryIsAncestorOfPatch:
              false,
          }),
        ).toBe(
          'REQUIRES_FURTHER_REVIEW',
        );
      },
    );
  },
);
