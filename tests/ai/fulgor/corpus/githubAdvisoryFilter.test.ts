import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  fetchGithubAdvisoryCandidates,
} from '../../../../scripts/fulgor/corpus/sources/githubAdvisorySource';

import type {
  FulgorHttpFetch,
} from '../../../../scripts/fulgor/corpus/sources/http';

describe(
  'FULGOR exact GHSA filter',
  () => {
    it(
      'sends an exact ghsa_id query parameter',
      async () => {
        let requestedUrl = '';

        const fetchImpl:
          FulgorHttpFetch =
          async (
            url,
          ) => {
            requestedUrl = url;

            return {
              ok: true,
              status: 200,
              json:
                async () => [],
            };
          };

        await fetchGithubAdvisoryCandidates({
          ghsaId:
            'GHSA-hqjg-pww4-pcgq',

          perPage:
            1,

          fetchImpl,
        });

        const parsed =
          new URL(
            requestedUrl,
          );

        expect(
          parsed.searchParams.get(
            'ghsa_id',
          ),
        ).toBe(
          'GHSA-hqjg-pww4-pcgq',
        );

        expect(
          parsed.searchParams.get(
            'per_page',
          ),
        ).toBe('1');
      },
    );

    it(
      'fails closed on malformed GHSA filter IDs before network access',
      async () => {
        let called = false;

        const fetchImpl:
          FulgorHttpFetch =
          async () => {
            called = true;

            throw new Error(
              'NETWORK_SHOULD_NOT_RUN',
            );
          };

        await expect(
          fetchGithubAdvisoryCandidates({
            ghsaId:
              'not-a-ghsa',

            fetchImpl,
          }),
        ).rejects.toThrow(
          'GHSA_INVALID_FILTER_ID',
        );

        expect(called)
          .toBe(false);
      },
    );
  },
);