import {
  createHash,
} from 'node:crypto';

import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  extractRepositoryPairEvidence,
} from '../../../../scripts/fulgor/corpus/materialization/repositoryPairEvidence';

import type {
  GitProcessRequest,
  GitProcessResult,
  GitProcessRunner,
} from '../../../../scripts/fulgor/corpus/materialization/gitProcess';

const VULN =
  '1111111111111111111111111111111111111111';

const FIX =
  '2222222222222222222222222222222222222222';

const BLOB =
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const LICENSE =
  Buffer.from(
    'MIT License\n',
    'utf8',
  );

const DIFF =
  Buffer.from(
    [
      'diff --git a/a.ts b/a.ts',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      '',
    ].join('\n'),
    'utf8',
  );

function result(
  stdout:
    string | Uint8Array,
): GitProcessResult {
  const bytes =
    typeof stdout === 'string'
      ? Buffer.from(
          stdout,
          'utf8',
        )
      : Buffer.from(
          stdout,
        );

  return {
    exitCode: 0,

    stdout:
      bytes.toString(
        'utf8',
      ),

    stderr: '',

    stdoutBytes:
      bytes,
  };
}

class FakeRunner
implements GitProcessRunner {
  readonly calls:
    GitProcessRequest[] = [];

  constructor(
    private readonly handler:
      (
        request:
          GitProcessRequest,
      ) => GitProcessResult =
      defaultHandler,
  ) {}

  async run(
    request:
      GitProcessRequest,
  ): Promise<GitProcessResult> {
    this.calls.push(request);

    return this.handler(
      request,
    );
  }
}

function defaultHandler(
  request: GitProcessRequest,
): GitProcessResult {
  const command =
    request.args.join(' ');

  if (
    command.includes(
      `rev-list --parents -n 1 ${FIX}`,
    )
  ) {
    return result(
      `${FIX} ${VULN}\n`,
    );
  }

  if (
    command.includes(
      'diff --name-only -z',
    )
  ) {
    return result(
      Buffer.from(
        'a.ts\0',
        'utf8',
      ),
    );
  }

  if (
    command.includes(
      'diff --binary --full-index',
    )
  ) {
    return result(DIFF);
  }

  if (
    command.includes(
      `ls-tree --name-only ${VULN}`,
    ) ||
    command.includes(
      `ls-tree --name-only ${FIX}`,
    )
  ) {
    return result(
      'LICENSE\nsrc\n',
    );
  }

  if (
    command.includes(
      `ls-tree ${VULN} -- LICENSE`,
    ) ||
    command.includes(
      `ls-tree ${FIX} -- LICENSE`,
    )
  ) {
    return result(
      `100644 blob ${BLOB}\tLICENSE\n`,
    );
  }

  if (
    command.includes(
      `cat-file blob ${VULN}:LICENSE`,
    ) ||
    command.includes(
      `cat-file blob ${FIX}:LICENSE`,
    )
  ) {
    return result(
      LICENSE,
    );
  }

  throw new Error(
    `UNEXPECTED_TEST_COMMAND:${command}`,
  );
}

describe(
  'FULGOR repository pair evidence',
  () => {
    it(
      'accepts a direct single-parent fix with stable license evidence for corpus review',
      async () => {
        const evidence =
          await extractRepositoryPairEvidence(
            {
              bareRepositoryPath:
                'C:/tmp/repo.git',

              vulnerableCommitSha:
                VULN,

              fixedCommitSha:
                FIX,
            },

            new FakeRunner(),
          );

        expect(
          evidence.fixRelationship,
        ).toBe(
          'DIRECT_SINGLE_PARENT',
        );

        expect(
          evidence.changedFiles,
        ).toEqual([
          'a.ts',
        ]);

        expect(
          evidence.diffSha256,
        ).toBe(
          createHash('sha256')
            .update(DIFF)
            .digest('hex'),
        );

        expect(
          evidence.licenseContinuity,
        ).toBe('MATCH');

        expect(
          evidence.eligibleForCorpusReview,
        ).toBe(true);
      },
    );

    it(
      'rejects merge commits from automatic corpus review',
      async () => {
        const otherParent =
          '3333333333333333333333333333333333333333';

        const runner =
          new FakeRunner(
            (request) => {
              const command =
                request.args.join(
                  ' ',
                );

              if (
                command.includes(
                  `rev-list --parents -n 1 ${FIX}`,
                )
              ) {
                return result(
                  `${FIX} ${VULN} ${otherParent}\n`,
                );
              }

              return defaultHandler(
                request,
              );
            },
          );

        const evidence =
          await extractRepositoryPairEvidence(
            {
              bareRepositoryPath:
                'C:/tmp/repo.git',

              vulnerableCommitSha:
                VULN,

              fixedCommitSha:
                FIX,
            },

            runner,
          );

        expect(
          evidence.fixRelationship,
        ).toBe(
          'MERGE_COMMIT',
        );

        expect(
          evidence.eligibleForCorpusReview,
        ).toBe(false);
      },
    );

    it(
      'rejects changed license content from automatic review',
      async () => {
        const runner =
          new FakeRunner(
            (request) => {
              const command =
                request.args.join(
                  ' ',
                );

              if (
                command.includes(
                  `cat-file blob ${FIX}:LICENSE`,
                )
              ) {
                return result(
                  Buffer.from(
                    'Different License\n',
                    'utf8',
                  ),
                );
              }

              return defaultHandler(
                request,
              );
            },
          );

        const evidence =
          await extractRepositoryPairEvidence(
            {
              bareRepositoryPath:
                'C:/tmp/repo.git',

              vulnerableCommitSha:
                VULN,

              fixedCommitSha:
                FIX,
            },

            runner,
          );

        expect(
          evidence.licenseContinuity,
        ).toBe(
          'DIFFERENT',
        );

        expect(
          evidence.eligibleForCorpusReview,
        ).toBe(false);
      },
    );

    it(
      'fails automatic review for ambiguous root license files',
      async () => {
        const runner =
          new FakeRunner(
            (request) => {
              const command =
                request.args.join(
                  ' ',
                );

              if (
                command.includes(
                  'ls-tree --name-only',
                )
              ) {
                return result(
                  'LICENSE\nCOPYING\nsrc\n',
                );
              }

              return defaultHandler(
                request,
              );
            },
          );

        const evidence =
          await extractRepositoryPairEvidence(
            {
              bareRepositoryPath:
                'C:/tmp/repo.git',

              vulnerableCommitSha:
                VULN,

              fixedCommitSha:
                FIX,
            },

            runner,
          );

        expect(
          evidence.vulnerableLicense.state,
        ).toBe(
          'AMBIGUOUS_ROOT_LICENSE',
        );

        expect(
          evidence.licenseContinuity,
        ).toBe(
          'MISSING_OR_AMBIGUOUS',
        );

        expect(
          evidence.eligibleForCorpusReview,
        ).toBe(false);
      },
    );

    it(
      'does not run checkout, hooks, submodules or repository code',
      async () => {
        const runner =
          new FakeRunner();

        await extractRepositoryPairEvidence(
          {
            bareRepositoryPath:
              'C:/tmp/repo.git',

            vulnerableCommitSha:
              VULN,

            fixedCommitSha:
              FIX,
          },

          runner,
        );

        const combined =
          runner.calls
            .map(
              (call) =>
                call.args.join(' '),
            )
            .join('\n');

        expect(combined)
          .not.toMatch(
            /\bcheckout\b/,
          );

        expect(combined)
          .not.toMatch(
            /\bswitch\b/,
          );

        expect(combined)
          .not.toMatch(
            /\bsubmodule\s+update\b/,
          );

        expect(combined)
          .not.toMatch(
            /\b(?:npm|pnpm|yarn|python|node|bash|powershell|cmd)\b/,
          );

        expect(combined)
          .toContain(
            '--no-ext-diff',
          );

        expect(combined)
          .toContain(
            '--no-textconv',
          );
      },
    );

    it(
      'uses separate bounded output budgets for metadata and exact diff',
      async () => {
        const runner =
          new FakeRunner();

        await extractRepositoryPairEvidence(
          {
            bareRepositoryPath:
              'C:/tmp/repo.git',

            vulnerableCommitSha:
              VULN,

            fixedCommitSha:
              FIX,

            timeoutMs:
              12_345,

            maxMetadataBytes:
              32_768,

            maxDiffBytes:
              524_288,
          },

          runner,
        );

        for (
          const call of
          runner.calls
        ) {
          expect(
            call.timeoutMs,
          ).toBe(12_345);
        }

        const diffCall =
          runner.calls.find(
            (call) =>
              call.args
                .join(' ')
                .includes(
                  'diff --binary --full-index',
                ),
          );

        expect(diffCall)
          .toBeDefined();

        expect(
          diffCall
            ?.maxOutputBytes,
        ).toBe(524_288);
      },
    );
  },
);