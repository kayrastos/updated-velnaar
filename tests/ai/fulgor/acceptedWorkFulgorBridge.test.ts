import {
  createHash,
} from 'node:crypto';

import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  createFulgorBridgePlan,
  rankAcceptedCandidates,
  selectNextCandidateForFulgor,
} from '../../../scripts/fulgor/orchestration/acceptedWorkFulgorBridge';

import type {
  PersistedAcceptedWorkProduct,
} from '../../../scripts/fulgor/orchestration/transactionalProviderQueue';

const baseline =
  '0123456789abcdef0123456789abcdef01234567';

function sha(
  value: string,
): string {
  return createHash('sha256')
    .update(value)
    .digest('hex');
}

function accepted(
  provider:
    'codex' |
    'antigravity',

  jobId:
    string,

  path:
    string,

  content:
    string,

  evidenceCount = 2,
): PersistedAcceptedWorkProduct {
  const value = {
    workProduct: {
      schemaVersion:
        'VELNAR_PROVIDER_WORK_PRODUCT_V1' as const,

      provider,
      taskId:
        jobId,

      baseline,

      status:
        'PROPOSE_CHANGE' as const,

      summary:
        'Bounded candidate.',

      evidenceIds:
        ['E1', 'E2'],

      candidate: {
        path,
        content,
      },

      tests: [
        `npx vitest run ${path}`,
      ],

      blocker:
        null,
    },

    usable:
      true,

    evidenceCount,

    evidenceBindings: [
      {
        id:
          'E1',

        path:
          'scripts/a.ts',

        sha256:
          '1'.repeat(64),
      },

      {
        id:
          'E2',

        path:
          'tests/a.test.ts',

        sha256:
          '2'.repeat(64),
      },
    ],

    verified:
      false as const,

    authorityGranted:
      false as const,
  };

  return {
    jobId,

    fingerprint:
      sha(
        `${provider}:${jobId}`,
      ),

    provider,
    baseline,

    status:
      'PROPOSE_CHANGE',

    candidatePath:
      path,

    candidateSha256:
      sha(
        content,
      ),

    evidenceCount,

    acceptedSha256:
      sha(
        JSON.stringify(value),
      ),

    accepted:
      value,

    createdAtMs:
      1000,
  };
}

function noChange(
  jobId:
    string,
): PersistedAcceptedWorkProduct {
  const value = {
    workProduct: {
      schemaVersion:
        'VELNAR_PROVIDER_WORK_PRODUCT_V1' as const,

      provider:
        'codex' as const,

      taskId:
        jobId,

      baseline,

      status:
        'NO_CHANGE_NEEDED' as const,

      summary:
        'No bounded change required.',

      evidenceIds:
        ['E1', 'E2'],

      candidate:
        null,

      tests:
        [],

      blocker:
        null,
    },

    usable:
      true,

    evidenceCount:
      2,

    evidenceBindings: [
      {
        id:
          'E1',

        path:
          'scripts/a.ts',

        sha256:
          '1'.repeat(64),
      },

      {
        id:
          'E2',

        path:
          'tests/a.test.ts',

        sha256:
          '2'.repeat(64),
      },
    ],

    verified:
      false as const,

    authorityGranted:
      false as const,
  };

  return {
    jobId,

    fingerprint:
      sha(jobId),

    provider:
      'codex',

    baseline,

    status:
      'NO_CHANGE_NEEDED',

    candidatePath:
      null,

    candidateSha256:
      null,

    evidenceCount:
      2,

    acceptedSha256:
      sha(
        JSON.stringify(value),
      ),

    accepted:
      value,

    createdAtMs:
      1000,
  };
}

function patch(
  path:
    string,

  value =
    'export const bounded = true;',
): string {
  return [
    `diff --git a/${path} b/${path}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${path}`,
    '@@ -0,0 +1 @@',
    `+${value}`,
    '',
  ].join('\n');
}

describe(
  'accepted work -> FULGOR bridge',
  () => {
    it(
      'groups exact cross-provider agreement without provider bias',
      () => {
        const content =
          'export const same = true;\n';

        const input = [
          accepted(
            'codex',
            'codex-1',
            'tests/same.test.ts',
            content,
          ),

          accepted(
            'antigravity',
            'agy-1',
            'tests/same.test.ts',
            content,
          ),

          accepted(
            'codex',
            'codex-2',
            'tests/other.test.ts',
            'export const other = true;\n',
            10,
          ),
        ];

        const ranked =
          rankAcceptedCandidates(
            input,
          );

        expect(
          ranked.ranked,
        ).toHaveLength(2);

        expect(
          ranked.ranked[0]
            .candidatePath,
        ).toBe(
          'tests/same.test.ts',
        );

        expect(
          ranked.ranked[0]
            .providerSupportCount,
        ).toBe(2);

        expect(
          ranked.ranked[0]
            .providerSupport,
        ).toEqual([
          'antigravity',
          'codex',
        ]);
      },
    );

    it(
      'is deterministic independent of arrival order',
      () => {
        const input = [
          accepted(
            'codex',
            'j1',
            'tests/b.test.ts',
            'b\n',
          ),
          accepted(
            'antigravity',
            'j2',
            'tests/a.test.ts',
            'a\n',
          ),
        ];

        const forward =
          rankAcceptedCandidates(
            input,
          );

        const reversed =
          rankAcceptedCandidates(
            [...input].reverse(),
          );

        expect(
          reversed,
        ).toEqual(
          forward,
        );
      },
    );

    it(
      'excludes no-change outcomes from FULGOR patch verification',
      () => {
        const result =
          rankAcceptedCandidates([
            noChange(
              'no-change-1',
            ),
          ]);

        expect(
          result.ranked,
        ).toHaveLength(0);

        expect(
          result.excludedNoChange,
        ).toBe(1);

        expect(
          selectNextCandidateForFulgor([
            noChange(
              'no-change-2',
            ),
          ]),
        ).toBeNull();
      },
    );

    it(
      'builds a stable single-file FULGOR job with no automatic authority',
      () => {
        const selection =
          selectNextCandidateForFulgor([
            accepted(
              'codex',
              'j1',
              'tests/bridge.test.ts',
              'export const bridge = true;\n',
            ),
          ])!;

        const diff =
          patch(
            'tests/bridge.test.ts',
          );

        const first =
          createFulgorBridgePlan(
            selection,
            diff,
            true,
            {
              forbiddenPaths: [
                '.git',
                '.github/workflows',
              ],

              maxHunks:
                8,

              maxChangedLines:
                500,
            },
          );

        const second =
          createFulgorBridgePlan(
            selection,
            diff,
            true,
            {
              forbiddenPaths: [
                '.git',
                '.github/workflows',
              ],

              maxHunks:
                8,

              maxChangedLines:
                500,
            },
          );

        expect(
          second,
        ).toEqual(first);

        expect(
          first.job
            .staticGatePolicy
            .allowedScope,
        ).toEqual([
          'tests/bridge.test.ts',
        ]);

        expect(
          first.job
            .dryRunApplySucceeded,
        ).toBe(true);

        expect(
          first.automaticPromotionAllowed,
        ).toBe(false);

        expect(
          first.authorityGranted,
        ).toBe(false);

        expect(
          JSON.stringify(
            first.job,
          ),
        ).not.toMatch(
          /antigravity|codex/,
        );

        expect(
          JSON.stringify(
            first.job,
          ),
        ).not.toMatch(
          /provider support/i,
        );
      },
    );

    it(
      'fails closed when dry-run application has not succeeded',
      () => {
        const selection =
          selectNextCandidateForFulgor([
            accepted(
              'codex',
              'j1',
              'tests/dry.test.ts',
              'export const dry = true;\n',
            ),
          ])!;

        expect(() =>
          createFulgorBridgePlan(
            selection,
            patch(
              'tests/dry.test.ts',
            ),
            false,
            {
              forbiddenPaths:
                ['.git'],

              maxHunks:
                8,

              maxChangedLines:
                500,
            },
          ),
        ).toThrow(
          /DRY_RUN_REQUIRED/,
        );
      },
    );

    it(
      'fails closed if the patch touches a different path',
      () => {
        const selection =
          selectNextCandidateForFulgor([
            accepted(
              'codex',
              'j1',
              'tests/right.test.ts',
              'export const right = true;\n',
            ),
          ])!;

        expect(() =>
          createFulgorBridgePlan(
            selection,
            patch(
              'tests/wrong.test.ts',
            ),
            true,
            {
              forbiddenPaths:
                ['.git'],

              maxHunks:
                8,

              maxChangedLines:
                500,
            },
          ),
        ).toThrow();
      },
    );

    it(
      'rejects candidates inside an explicitly forbidden root',
      () => {
        const selection =
          selectNextCandidateForFulgor([
            accepted(
              'codex',
              'j1',
              '.github/workflows/unsafe.yml',
              'name: unsafe\n',
            ),
          ])!;

        expect(() =>
          createFulgorBridgePlan(
            selection,
            patch(
              '.github/workflows/unsafe.yml',
              'name: unsafe',
            ),
            true,
            {
              forbiddenPaths: [
                '.github/workflows',
              ],

              maxHunks:
                8,

              maxChangedLines:
                500,
            },
          ),
        ).toThrow(
          /CANDIDATE_FORBIDDEN/,
        );
      },
    );
  },
);
