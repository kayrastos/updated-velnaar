import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  fetchOsvById,
} from '../../../../scripts/fulgor/corpus/sources/osvSource';

import type {
  FulgorHttpFetch,
} from '../../../../scripts/fulgor/corpus/sources/http';

const INTRODUCED =
  '1111111111111111111111111111111111111111';

const FIXED =
  '2222222222222222222222222222222222222222';

function response(
  payload: unknown,
) {
  return {
    ok: true,
    status: 200,

    json: async () =>
      payload,
  };
}

describe(
  'FULGOR structured OSV GIT ranges',
  () => {
    it(
      'preserves exact introduced and fixed GIT events structurally',
      async () => {
        const fetchImpl:
          FulgorHttpFetch =
          async () =>
            response({
              id:
                'CVE-2026-9001',

              aliases: [],

              summary:
                'test',

              details:
                'test',

              references: [],

              affected: [
                {
                  package: {
                    ecosystem:
                      'npm',

                    name:
                      '@example/project',
                  },

                  ranges: [
                    {
                      type:
                        'GIT',

                      repo:
                        'https://github.com/example/project',

                      events: [
                        {
                          introduced:
                            INTRODUCED,
                        },
                        {
                          fixed:
                            FIXED,
                        },
                      ],
                    },
                  ],
                },
              ],
            });

        const candidate =
          await fetchOsvById(
            'CVE-2026-9001',
            {
              fetchImpl,
            },
          );

        expect(
          candidate
            .affectedPackages[0]
            .gitRanges,
        ).toEqual([
          {
            repositoryUrl:
              'https://github.com/example/project',

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
                  FIXED,
              },
            ],
          },
        ]);
      },
    );

    it(
      'does not structurally accept abbreviated fixed commit identifiers',
      async () => {
        const fetchImpl:
          FulgorHttpFetch =
          async () =>
            response({
              id:
                'CVE-2026-9002',

              aliases: [],

              summary:
                'test',

              details:
                'test',

              references: [],

              affected: [
                {
                  package: {
                    ecosystem:
                      'npm',

                    name:
                      '@example/project',
                  },

                  ranges: [
                    {
                      type:
                        'GIT',

                      repo:
                        'https://github.com/example/project',

                      events: [
                        {
                          introduced:
                            '0',
                        },
                        {
                          fixed:
                            'abc123',
                        },
                      ],
                    },
                  ],
                },
              ],
            });

        const candidate =
          await fetchOsvById(
            'CVE-2026-9002',
            {
              fetchImpl,
            },
          );

        expect(
          candidate
            .affectedPackages[0]
            .gitRanges,
        ).toEqual([
          {
            repositoryUrl:
              'https://github.com/example/project',

            events: [
              {
                kind:
                  'INTRODUCED',

                commit:
                  '0',
              },
            ],
          },
        ]);
      },
    );
  },
);
