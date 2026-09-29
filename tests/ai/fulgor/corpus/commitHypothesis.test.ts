import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  parseGithubCommitReference,
} from '../../../../scripts/fulgor/corpus/sources/githubCommitReference';

import {
  extractCommitHypotheses,
} from '../../../../scripts/fulgor/corpus/sources/commitHypothesis';

import type {
  FulgorAdvisoryCandidate,
} from '../../../../scripts/fulgor/corpus/sources/advisoryCandidate';

const SHA =
  '1111111111111111111111111111111111111111';

function candidate():
  FulgorAdvisoryCandidate {
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

    summary: 'test',
    details: 'test',

    severity: null,

    cwes: ['CWE-22'],

    references: [
      `https://github.com/example/project/commit/${SHA}`,
      `https://github.com/example/project/commit/${SHA}`,
      'https://example.com/not-github',
    ],

    affectedPackages: [],

    publishedAtUtc: null,
    modifiedAtUtc: null,
    withdrawnAtUtc: null,

    sourceUrl:
      'https://osv.dev/vulnerability/CVE-2026-9001',

    fetchedAtUtc:
      '2026-09-27T12:00:00.000Z',
  };
}

describe(
  'FULGOR commit hypotheses',
  () => {
    it(
      'parses exact GitHub commit references',
      () => {
        expect(
          parseGithubCommitReference(
            `https://github.com/example/project/commit/${SHA}`,
          ),
        ).toEqual({
          repository:
            'example/project',

          commitSha:
            SHA,

          canonicalUrl:
            `https://github.com/example/project/commit/${SHA}`,
        });
      },
    );

    it(
      'rejects lookalike GitHub hosts',
      () => {
        expect(
          parseGithubCommitReference(
            `https://github.com.evil.test/example/project/commit/${SHA}`,
          ),
        ).toBeNull();
      },
    );

    it(
      'rejects abbreviated SHAs',
      () => {
        expect(
          parseGithubCommitReference(
            'https://github.com/example/project/commit/1234567',
          ),
        ).toBeNull();
      },
    );

    it(
      'deduplicates references and never assigns semantic fix/vulnerable authority',
      () => {
        const result =
          extractCommitHypotheses(
            candidate(),
          );

        expect(result)
          .toHaveLength(1);

        expect(
          result[0].trustState,
        ).toBe(
          'UNTRUSTED_COMMIT_HYPOTHESIS',
        );

        expect(
          result[0].semanticRole,
        ).toBe(
          'UNCLASSIFIED_COMMIT_REFERENCE',
        );
      },
    );
  },
);