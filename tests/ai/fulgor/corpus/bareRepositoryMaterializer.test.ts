import {
  mkdtemp,
  rm,
} from 'node:fs/promises';

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
  materializeBareRepositoryPair,
} from '../../../../scripts/fulgor/corpus/materialization/bareRepositoryMaterializer';

import {
  validatePostMaterializationIdentity,
} from '../../../../scripts/fulgor/corpus/validation/exactRepositoryIdentity';

import type {
  GitProcessRequest,
  GitProcessResult,
  GitProcessRunner,
} from '../../../../scripts/fulgor/corpus/materialization/gitProcess';

const VULN =
  '1111111111111111111111111111111111111111';

const FIX =
  '2222222222222222222222222222222222222222';

class FakeRunner
implements GitProcessRunner {
  readonly calls:
    GitProcessRequest[] = [];

  private readonly mutate:
    (
      request:
        GitProcessRequest,
    ) => GitProcessResult;

  constructor(
    mutate:
      (
        request:
          GitProcessRequest,
      ) => GitProcessResult =
      defaultResult,
  ) {
    this.mutate = mutate;
  }

  async run(
    request:
      GitProcessRequest,
  ): Promise<GitProcessResult> {
    this.calls.push(request);

    return this.mutate(
      request,
    );
  }
}

function defaultResult(
  request: GitProcessRequest,
): GitProcessResult {
  const joined =
    request.args.join(' ');

  if (
    joined.includes(
      `${VULN}^{commit}`,
    )
  ) {
    return ok(`${VULN}\n`);
  }

  if (
    joined.includes(
      `${FIX}^{commit}`,
    )
  ) {
    return ok(`${FIX}\n`);
  }

  if (
    joined.includes(
      'remote get-url origin',
    )
  ) {
    return ok(
      'https://github.com/example/project.git\n',
    );
  }

  if (
    joined.includes(
      '--is-bare-repository',
    )
  ) {
    return ok('true\n');
  }

  if (
    joined.includes(
      '--is-inside-work-tree',
    )
  ) {
    return ok('false\n');
  }

  return ok('');
}

function ok(
  stdout: string,
): GitProcessResult {
  return {
    exitCode: 0,
    stdout,
    stderr: '',
  };
}

async function workspace():
  Promise<string> {
  return await mkdtemp(
    join(
      tmpdir(),
      'fulgor-materializer-test-',
    ),
  );
}

describe(
  'FULGOR bare repository materializer',
  () => {
    it(
      'materializes only Git objects and produces exact identity evidence',
      async () => {
        const root =
          await workspace();

        try {
          const runner =
            new FakeRunner();

          const result =
            await materializeBareRepositoryPair(
              {
                repository:
                  'example/project',

                vulnerableCommitSha:
                  VULN,

                fixedCommitSha:
                  FIX,

                workspaceRoot:
                  root,
              },
              runner,
            );

          expect(
            result.executionPolicy,
          ).toEqual({
            bareRepository:
              true,

            checkoutAllowed:
              false,

            hooksAllowed:
              false,

            submodulesAllowed:
              false,

            repositoryCodeExecutionAllowed:
              false,
          });

          expect(
            result.materializationPath,
          ).toBeNull();

          expect(
            validatePostMaterializationIdentity(
              {
                repository:
                  'example/project',

                vulnerableCommitSha:
                  VULN,

                fixedCommitSha:
                  FIX,
              },

              result.evidence,
            ),
          ).toEqual({
            accepted: true,
            failureCodes: [],
          });
        }
        finally {
          await rm(
            root,
            {
              recursive: true,
              force: true,
            },
          );
        }
      },
    );

    it(
      'never issues checkout, switch, clone, submodule update, or arbitrary shell commands',
      async () => {
        const root =
          await workspace();

        try {
          const runner =
            new FakeRunner();

          await materializeBareRepositoryPair(
            {
              repository:
                'example/project',

              vulnerableCommitSha:
                VULN,

              fixedCommitSha:
                FIX,

              workspaceRoot:
                root,
            },
            runner,
          );

          const commands =
            runner.calls.map(
              (entry) =>
                entry.args.join(' '),
            );

          const combined =
            commands.join('\n');

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
              /\bclone\b/,
            );

          expect(combined)
            .not.toMatch(
              /\bsubmodule\s+update\b/,
            );

          expect(combined)
            .not.toMatch(
              /\b(?:sh|bash|cmd|powershell)\b/,
            );

          expect(combined)
            .toContain(
              '--no-recurse-submodules',
            );
        }
        finally {
          await rm(
            root,
            {
              recursive: true,
              force: true,
            },
          );
        }
      },
    );

    it(
      'disables hooks, credentials and non-HTTPS Git protocols',
      async () => {
        const root =
          await workspace();

        try {
          const runner =
            new FakeRunner();

          await materializeBareRepositoryPair(
            {
              repository:
                'example/project',

              vulnerableCommitSha:
                VULN,

              fixedCommitSha:
                FIX,

              workspaceRoot:
                root,
            },
            runner,
          );

          for (
            const request of
            runner.calls
          ) {
            const combined =
              request.args.join(' ');

            expect(combined)
              .toContain(
                'core.hooksPath=',
              );

            expect(combined)
              .toContain(
                'credential.helper=',
              );

            expect(combined)
              .toContain(
                'protocol.file.allow=never',
              );

            expect(combined)
              .toContain(
                'protocol.ext.allow=never',
              );

            expect(combined)
              .toContain(
                'protocol.ssh.allow=never',
              );

            expect(combined)
              .toContain(
                'protocol.https.allow=always',
              );
          }
        }
        finally {
          await rm(
            root,
            {
              recursive: true,
              force: true,
            },
          );
        }
      },
    );

    it(
      'fails closed when the fetched commit resolves to another identity',
      async () => {
        const root =
          await workspace();

        try {
          const runner =
            new FakeRunner(
              (request) => {
                const joined =
                  request.args.join(
                    ' ',
                  );

                if (
                  joined.includes(
                    `${FIX}^{commit}`,
                  )
                ) {
                  return ok(
                    '3333333333333333333333333333333333333333\n',
                  );
                }

                return defaultResult(
                  request,
                );
              },
            );

          const result =
            await materializeBareRepositoryPair(
              {
                repository:
                  'example/project',

                vulnerableCommitSha:
                  VULN,

                fixedCommitSha:
                  FIX,

                workspaceRoot:
                  root,
              },
              runner,
            );

          const identity =
            validatePostMaterializationIdentity(
              {
                repository:
                  'example/project',

                vulnerableCommitSha:
                  VULN,

                fixedCommitSha:
                  FIX,
              },

              result.evidence,
            );

          expect(identity.accepted)
            .toBe(false);

          expect(
            identity.failureCodes,
          ).toContain(
            'FIXED_COMMIT_MISSING',
          );

          expect(
            identity.failureCodes,
          ).toContain(
            'FIXED_HEAD_MISMATCH',
          );
        }
        finally {
          await rm(
            root,
            {
              recursive: true,
              force: true,
            },
          );
        }
      },
    );

    it(
      'bounds every Git process by timeout and output size',
      async () => {
        const root =
          await workspace();

        try {
          const runner =
            new FakeRunner();

          await materializeBareRepositoryPair(
            {
              repository:
                'example/project',

              vulnerableCommitSha:
                VULN,

              fixedCommitSha:
                FIX,

              workspaceRoot:
                root,

              timeoutMs:
                12_345,

              maxOutputBytes:
                65_536,
            },
            runner,
          );

          expect(
            runner.calls.length,
          ).toBeGreaterThan(0);

          for (
            const request of
            runner.calls
          ) {
            expect(
              request.timeoutMs,
            ).toBe(12_345);

            expect(
              request.maxOutputBytes,
            ).toBe(65_536);
          }
        }
        finally {
          await rm(
            root,
            {
              recursive: true,
              force: true,
            },
          );
        }
      },
    );
  },
);