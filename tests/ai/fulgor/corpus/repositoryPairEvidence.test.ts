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

const REPOSITORY =
  'example/project';

const OLD_BLOB =
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

const NEW_BLOB =
  'cccccccccccccccccccccccccccccccccccccccc';

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

function failure(
  exitCode = 1,
): GitProcessResult {
  return {
    exitCode,
    stdout: '',
    stderr: 'expected test failure',
    stdoutBytes:
      Buffer.alloc(0),
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
      'remote get-url origin',
    )
  ) {
    return result(
      `https://github.com/${REPOSITORY}.git\n`,
    );
  }

  if (
    command.includes(
      'config --local --name-only --get-regexp',
    )
  ) {
    return result('');
  }

  if (
    command.includes(
      'diff-tree -r --raw -z --no-abbrev --no-renames',
    )
  ) {
    return result(
      Buffer.from(
        `:100644 100644 ${OLD_BLOB} ${NEW_BLOB} M\0a.ts\0`,
        'utf8',
      ),
    );
  }

  if (
    command.includes(
      'cat-file -e',
    )
  ) {
    return result('');
  }

  if (
    command.includes(
      'fetch --no-tags --no-recurse-submodules origin',
    )
  ) {
    return result('');
  }

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
              repository:
                REPOSITORY,

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
              repository:
                REPOSITORY,

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
              repository:
                REPOSITORY,

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
              repository:
                REPOSITORY,

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
            repository:
              REPOSITORY,

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
      'explicitly hydrates exact missing changed blobs before reading the full diff',
      async () => {
        const hydrated =
          new Set<string>();

        const runner =
          new FakeRunner(
            (request) => {
              const command =
                request.args.join(
                  ' ',
                );

              for (
                const objectId of [
                  OLD_BLOB,
                  NEW_BLOB,
                ]
              ) {
                if (
                  command.includes(
                    `cat-file -e ${objectId}^{blob}`,
                  )
                ) {
                  return hydrated.has(
                    objectId,
                  )
                    ? result('')
                    : failure();
                }

                if (
                  command.includes(
                    `fetch --no-tags --no-recurse-submodules origin ${objectId}`,
                  )
                ) {
                  hydrated.add(
                    objectId,
                  );

                  return result('');
                }
              }

              return defaultHandler(
                request,
              );
            },
          );

        await extractRepositoryPairEvidence(
          {
            repository:
              REPOSITORY,

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
          hydrated,
        ).toEqual(
          new Set([
            OLD_BLOB,
            NEW_BLOB,
          ]),
        );

        const fetches =
          runner.calls
            .map(
              (call) =>
                call.args.join(' '),
            )
            .filter(
              (command) =>
                command.includes(
                  'fetch --no-tags --no-recurse-submodules origin',
                ),
            );

        expect(fetches)
          .toHaveLength(2);
      },
    );

    it(
      'fails closed when origin identity changes before explicit hydration',
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
                  'remote get-url origin',
                )
              ) {
                return result(
                  'https://github.com/attacker/project.git\n',
                );
              }

              return defaultHandler(
                request,
              );
            },
          );

        await expect(
          extractRepositoryPairEvidence(
            {
              repository:
                REPOSITORY,

              bareRepositoryPath:
                'C:/tmp/repo.git',

              vulnerableCommitSha:
                VULN,

              fixedCommitSha:
                FIX,
            },

            runner,
          ),
        ).rejects.toThrow(
          'PAIR_EVIDENCE_ORIGIN_MISMATCH',
        );

        expect(
          runner.calls.some(
            (call) =>
              call.args
                .join(' ')
                .includes(
                  ' fetch ',
                ),
          ),
        ).toBe(false);
      },
    );

    it(
      'fails closed on local Git network rewrite configuration',
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
                  'config --local --name-only --get-regexp',
                )
              ) {
                return result(
                  'url.https://evil.example/.insteadof\n',
                );
              }

              return defaultHandler(
                request,
              );
            },
          );

        await expect(
          extractRepositoryPairEvidence(
            {
              repository:
                REPOSITORY,

              bareRepositoryPath:
                'C:/tmp/repo.git',

              vulnerableCommitSha:
                VULN,

              fixedCommitSha:
                FIX,
            },

            runner,
          ),
        ).rejects.toThrow(
          'PAIR_EVIDENCE_UNSAFE_LOCAL_NETWORK_CONFIG',
        );

        expect(
          runner.calls.some(
            (call) =>
              call.args
                .join(' ')
                .includes(
                  ' fetch ',
                ),
          ),
        ).toBe(false);
      },
    );
    it(
      'uses separate bounded output budgets for metadata and exact diff',
      async () => {
        const runner =
          new FakeRunner();

        await extractRepositoryPairEvidence(
          {
            repository:
              REPOSITORY,

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
