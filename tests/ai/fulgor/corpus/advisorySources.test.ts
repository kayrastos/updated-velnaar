import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  fetchGithubAdvisoryCandidates,
} from '../../../../scripts/fulgor/corpus/sources/githubAdvisorySource';

import {
  fetchOsvById,
  queryOsvByCommit,
} from '../../../../scripts/fulgor/corpus/sources/osvSource';

import type {
  FulgorHttpFetch,
  FulgorHttpRequest,
} from '../../../../scripts/fulgor/corpus/sources/http';

function response(
  payload: unknown,
  status = 200,
) {
  return {
    ok:
      status >= 200 &&
      status < 300,

    status,

    json: async () =>
      payload,
  };
}

describe(
  'FULGOR advisory sources',
  () => {
    it(
      'ingests GHSA only as an untrusted source candidate',
      async () => {
        let requestedUrl = '';

        const fetchImpl:
          FulgorHttpFetch =
          async (
            url,
          ) => {
            requestedUrl = url;

            return response([
              {
                ghsa_id:
                  'GHSA-abcd-1234-5678',

                cve_id:
                  'CVE-2026-0001',

                html_url:
                  'https://github.com/advisories/GHSA-abcd-1234-5678',

                summary:
                  'Path traversal test',

                description:
                  'Description',

                severity:
                  'high',

                cwes: [
                  {
                    cwe_id:
                      'CWE-22',
                  },
                ],

                references: [
                  'https://example.com/reference',
                ],

                vulnerabilities: [
                  {
                    package: {
                      ecosystem:
                        'npm',

                      name:
                        'example-package',
                    },

                    vulnerable_version_range:
                      '< 2.0.0',

                    first_patched_version: {
                      identifier:
                        '2.0.0',
                    },
                  },
                ],

                published_at:
                  '2026-01-01T00:00:00Z',

                updated_at:
                  '2026-01-02T00:00:00Z',
              },
            ]);
          };

        const result =
          await fetchGithubAdvisoryCandidates({
            perPage: 25,
            cwes: ['22'],
            fetchImpl,
            now: () =>
              new Date(
                '2026-09-27T12:00:00Z',
              ),
          });

        expect(result)
          .toHaveLength(1);

        expect(result[0].trustState)
          .toBe(
            'UNTRUSTED_SOURCE_CANDIDATE',
          );

        expect(result[0].provider)
          .toBe('GHSA');

        expect(result[0].cwes)
          .toEqual(['CWE-22']);

        expect(
          result[0].affectedPackages[0],
        ).toEqual({
          ecosystem: 'npm',
          name: 'example-package',
          ranges: [
            'vulnerable:< 2.0.0',
            'first_patched:2.0.0',
          ],
        });

        const parsed =
          new URL(requestedUrl);

        expect(
          parsed.searchParams.get(
            'type',
          ),
        ).toBe('reviewed');

        expect(
          parsed.searchParams.get(
            'cwes',
          ),
        ).toBe('22');
      },
    );

    it(
      'fails closed on malformed GHSA payloads',
      async () => {
        const fetchImpl:
          FulgorHttpFetch =
          async () =>
            response({
              not: 'an array',
            });

        await expect(
          fetchGithubAdvisoryCandidates({
            fetchImpl,
          }),
        ).rejects.toThrow(
          'GHSA_MALFORMED_RESPONSE',
        );
      },
    );

    it(
      'enforces GitHub page bounds',
      async () => {
        await expect(
          fetchGithubAdvisoryCandidates({
            perPage: 101,
          }),
        ).rejects.toThrow(
          'GHSA_INVALID_PER_PAGE',
        );
      },
    );

    it(
      'ingests OSV by ID as untrusted candidate',
      async () => {
        const fetchImpl:
          FulgorHttpFetch =
          async () =>
            response({
              id:
                'CVE-2026-0002',

              aliases: [
                'GHSA-zzzz-1111-2222',
              ],

              summary:
                'OSV summary',

              details:
                'OSV details',

              published:
                '2026-02-01T00:00:00Z',

              modified:
                '2026-02-02T00:00:00Z',

              references: [
                {
                  type: 'FIX',
                  url:
                    'https://github.com/example/project/commit/123',
                },
              ],

              affected: [
                {
                  package: {
                    ecosystem:
                      'PyPI',
                    name:
                      'example-project',
                  },

                  ranges: [
                    {
                      type: 'GIT',
                      events: [
                        {
                          introduced:
                            '0',
                        },
                        {
                          fixed:
                            'abc',
                        },
                      ],
                    },
                  ],
                },
              ],

              database_specific: {
                severity:
                  'HIGH',

                cwe_ids: [
                  'CWE-22',
                ],
              },
            });

        const result =
          await fetchOsvById(
            'CVE-2026-0002',
            {
              fetchImpl,
              now: () =>
                new Date(
                  '2026-09-27T12:00:00Z',
                ),
            },
          );

        expect(result.provider)
          .toBe('OSV');

        expect(result.trustState)
          .toBe(
            'UNTRUSTED_SOURCE_CANDIDATE',
          );

        expect(result.cwes)
          .toEqual(['CWE-22']);

        expect(result.references)
          .toEqual([
            'https://github.com/example/project/commit/123',
          ]);
      },
    );

    it(
      'queries OSV by exact commit hash',
      async () => {
        const calls:
          Array<{
            url: string;
            request:
              FulgorHttpRequest;
          }> = [];

        const commit =
          '1111111111111111111111111111111111111111';

        const fetchImpl:
          FulgorHttpFetch =
          async (
            url,
            request,
          ) => {
            calls.push({
              url,
              request,
            });

            if (
              url.endsWith(
                '/v1/query',
              )
            ) {
              return response({
                vulns: [
                  {
                    id:
                      'OSV-TEST-1',
                  },
                ],
              });
            }

            return response({
              id:
                'OSV-TEST-1',

              aliases: [],

              summary:
                'test',

              details:
                'test',

              affected: [],
              references: [],
            });
          };

        const result =
          await queryOsvByCommit(
            commit,
            {
              fetchImpl,
            },
          );

        expect(result)
          .toHaveLength(1);

        expect(calls[0].url)
          .toBe(
            'https://api.osv.dev/v1/query',
          );

        expect(calls[0].request.method)
          .toBe('POST');

        expect(
          JSON.parse(
            calls[0].request.body ??
            '{}',
          ),
        ).toEqual({
          commit,
        });

        expect(calls)
          .toHaveLength(2);
      },
    );
  },
);