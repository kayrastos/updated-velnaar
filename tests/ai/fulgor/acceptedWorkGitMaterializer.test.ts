import {
  execFileSync,
} from 'node:child_process';

import {
  createHash,
} from 'node:crypto';

import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';

import {
  tmpdir,
} from 'node:os';

import {
  join,
} from 'node:path';

import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  buildCanonicalCandidatePatch,
  materializeNextAcceptedWorkForFulgor,
  productionAcceptedWorkGitDependencies,
} from '../../../scripts/fulgor/orchestration/acceptedWorkGitMaterializer';

import type {
  PersistedAcceptedWorkProduct,
} from '../../../scripts/fulgor/orchestration/transactionalProviderQueue';

function sha(
  value:
    string,
): string {
  return createHash(
    'sha256',
  )
    .update(
      value,
    )
    .digest(
      'hex',
    );
}

function accepted(
  baseline:
    string,

  provider:
    'codex' |
    'antigravity',

  jobId:
    string,

  path:
    string,

  content:
    string,
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
        'Evidence-backed candidate.',

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

    evidenceCount:
      2,

    acceptedSha256:
      sha(
        JSON.stringify(
          value,
        ),
      ),

    accepted:
      value,

    createdAtMs:
      1000,
  };
}

function git(
  cwd:
    string,

  ...args:
    string[]
): string {
  return execFileSync(
    'git',
    args,
    {
      cwd,
      encoding:
        'utf8',
    },
  ).trim();
}

function repo(): {
  root: string;
  baseline: string;
} {
  const root =
    mkdtempSync(
      join(
        tmpdir(),
        'velnar-materializer-test-',
      ),
    );

  git(
    root,
    'init',
    '-q',
  );

  git(
    root,
    'config',
    'user.email',
    'test@example.invalid',
  );

  git(
    root,
    'config',
    'user.name',
    'VELNAR Test',
  );

  mkdirSync(
    join(
      root,
      'tests',
    ),
    {
      recursive:
        true,
    },
  );

  writeFileSync(
    join(
      root,
      'tests',
      'existing.test.ts',
    ),
    'export const value = 1;\n',
    'utf8',
  );

  git(
    root,
    'add',
    '.',
  );

  git(
    root,
    'commit',
    '-q',
    '-m',
    'baseline',
  );

  return {
    root,
    baseline:
      git(
        root,
        'rev-parse',
        'HEAD',
      ),
  };
}

describe(
  'accepted work Git materializer',
  () => {
    it(
      'builds a deterministic new-file patch',
      () => {
        const patch =
          buildCanonicalCandidatePatch(
            'tests/new.test.ts',
            {
              exists:
                false,

              mode:
                null,

              content:
                null,
            },
            'export const x = 1;\n',
          );

        expect(
          patch,
        ).toContain(
          'diff --git a/tests/new.test.ts b/tests/new.test.ts',
        );

        expect(
          patch,
        ).toContain(
          '--- /dev/null',
        );

        expect(
          patch,
        ).toContain(
          '+++ b/tests/new.test.ts',
        );
      },
    );

    it(
      'builds an existing-file replacement patch',
      () => {
        const patch =
          buildCanonicalCandidatePatch(
            'tests/a.test.ts',
            {
              exists:
                true,

              mode:
                '100644',

              content:
                'old\n',
            },
            'new\n',
          );

        expect(
          patch,
        ).toContain(
          '-old',
        );

        expect(
          patch,
        ).toContain(
          '+new',
        );
      },
    );

    it(
      'rejects a no-op candidate',
      () => {
        expect(() =>
          buildCanonicalCandidatePatch(
            'tests/a.test.ts',
            {
              exists:
                true,

              mode:
                '100644',

              content:
                'same\n',
            },
            'same\n',
          ),
        ).toThrow(
          /NO_SEMANTIC_CHANGE/,
        );
      },
    );

    it(
      'materializes a new file against a real pinned Git baseline',
      async () => {
        const fixture =
          repo();

        try {
          const candidate =
            accepted(
              fixture.baseline,
              'codex',
              'job-new',
              'tests/generated.test.ts',
              'export const generated = true;\n',
            );

          const result =
            await materializeNextAcceptedWorkForFulgor(
              fixture.root,
              [
                candidate,
              ],
              {
                forbiddenPaths: [
                  '.git',
                  '.github/workflows',
                ],

                maxHunks:
                  4,

                maxChangedLines:
                  100,
              },
              productionAcceptedWorkGitDependencies,
            );

          expect(result)
            .not.toBeNull();

          expect(
            result
              ?.baselinePathExisted,
          ).toBe(false);

          expect(
            result
              ?.plan
              .job
              .dryRunApplySucceeded,
          ).toBe(true);

          expect(
            result
              ?.plan
              .job
              .staticGatePolicy
              .allowedScope,
          ).toEqual([
            'tests/generated.test.ts',
          ]);

          expect(
            result
              ?.automaticPromotionAllowed,
          ).toBe(false);

          expect(
            result
              ?.authorityGranted,
          ).toBe(false);
        } finally {
          rmSync(
            fixture.root,
            {
              recursive:
                true,

              force:
                true,
            },
          );
        }
      },
    );

    it(
      'materializes an existing file against baseline content, not the dirty worktree',
      async () => {
        const fixture =
          repo();

        try {
          writeFileSync(
            join(
              fixture.root,
              'tests',
              'existing.test.ts',
            ),
            'WORKTREE-DIRTY\n',
            'utf8',
          );

          const candidate =
            accepted(
              fixture.baseline,
              'antigravity',
              'job-existing',
              'tests/existing.test.ts',
              'export const value = 2;\n',
            );

          const result =
            await materializeNextAcceptedWorkForFulgor(
              fixture.root,
              [
                candidate,
              ],
              {
                forbiddenPaths:
                  ['.git'],

                maxHunks:
                  4,

                maxChangedLines:
                  100,
              },
              productionAcceptedWorkGitDependencies,
            );

          expect(
            result?.patch,
          ).toContain(
            '-export const value = 1;',
          );

          expect(
            result?.patch,
          ).not.toContain(
            'WORKTREE-DIRTY',
          );
        } finally {
          rmSync(
            fixture.root,
            {
              recursive:
                true,

              force:
                true,
            },
          );
        }
      },
    );

    it(
      'fails closed when the pinned baseline does not exist',
      async () => {
        const fixture =
          repo();

        try {
          const missing =
            'f'.repeat(40);

          await expect(
            materializeNextAcceptedWorkForFulgor(
              fixture.root,
              [
                accepted(
                  missing,
                  'codex',
                  'job-missing',
                  'tests/missing.test.ts',
                  'export const x = 1;\n',
                ),
              ],
              {
                forbiddenPaths:
                  ['.git'],

                maxHunks:
                  4,

                maxChangedLines:
                  100,
              },
              productionAcceptedWorkGitDependencies,
            ),
          ).rejects.toThrow(
            /BASELINE_MISSING/,
          );
        } finally {
          rmSync(
            fixture.root,
            {
              recursive:
                true,

              force:
                true,
            },
          );
        }
      },
    );

    it(
      'does not prefer provider identity when exact candidate consensus exists',
      async () => {
        const fixture =
          repo();

        try {
          const path =
            'tests/consensus.test.ts';

          const content =
            'export const consensus = true;\n';

          const result =
            await materializeNextAcceptedWorkForFulgor(
              fixture.root,
              [
                accepted(
                  fixture.baseline,
                  'codex',
                  'z-codex',
                  path,
                  content,
                ),
                accepted(
                  fixture.baseline,
                  'antigravity',
                  'a-antigravity',
                  path,
                  content,
                ),
              ],
              {
                forbiddenPaths:
                  ['.git'],

                maxHunks:
                  4,

                maxChangedLines:
                  100,
              },
              productionAcceptedWorkGitDependencies,
            );

          expect(
            result
              ?.plan
              .selection
              .providerSupportCount,
          ).toBe(2);

          expect(
            result
              ?.sourceJobId,
          ).toBe(
            'a-antigravity',
          );

          expect(
            result
              ?.plan
              .job
              .problem,
          ).not.toMatch(
            /codex|antigravity/i,
          );
        } finally {
          rmSync(
            fixture.root,
            {
              recursive:
                true,

              force:
                true,
            },
          );
        }
      },
    );
  },
);
