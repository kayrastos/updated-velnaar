import {
  mkdir,
  mkdtemp,
  rm,
} from 'node:fs/promises';

import {
  join,
  resolve,
} from 'node:path';

import {
  DefaultGitProcessRunner,
} from './gitProcess';

import type {
  GitProcessRunner,
} from './gitProcess';

import type {
  RepositoryMaterializationEvidence,
} from '../validation/exactRepositoryIdentity';

export interface BareRepositoryMaterializationRequest {
  repository: string;

  vulnerableCommitSha: string;
  fixedCommitSha: string;

  workspaceRoot: string;

  timeoutMs?: number;
  maxOutputBytes?: number;

  retainMaterialization?: boolean;
}

export interface BareRepositoryMaterializationResult {
  evidence:
    RepositoryMaterializationEvidence;

  materializationPath:
    string | null;

  executionPolicy: {
    bareRepository: true;
    checkoutAllowed: false;
    hooksAllowed: false;
    submodulesAllowed: false;
    repositoryCodeExecutionAllowed: false;
  };
}

const REPOSITORY =
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const SHA =
  /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

const DEFAULT_TIMEOUT_MS =
  60_000;

const DEFAULT_MAX_OUTPUT_BYTES =
  1_048_576;

function assertRequest(
  request:
    BareRepositoryMaterializationRequest,
): void {
  if (
    !REPOSITORY.test(
      request.repository,
    )
  ) {
    throw new Error(
      'INVALID_MATERIALIZATION_REPOSITORY',
    );
  }

  if (
    !SHA.test(
      request.vulnerableCommitSha,
    ) ||
    !SHA.test(
      request.fixedCommitSha,
    ) ||
    request.vulnerableCommitSha ===
      request.fixedCommitSha
  ) {
    throw new Error(
      'INVALID_MATERIALIZATION_COMMIT_PAIR',
    );
  }

  if (
    request.workspaceRoot.trim()
      .length === 0
  ) {
    throw new Error(
      'INVALID_MATERIALIZATION_ROOT',
    );
  }
}

function safeGitPrefix(
  hooksPath: string,
): string[] {
  return [
    '-c',
    `core.hooksPath=${hooksPath}`,

    '-c',
    'credential.helper=',

    '-c',
    'protocol.file.allow=never',

    '-c',
    'protocol.ext.allow=never',

    '-c',
    'protocol.git.allow=never',

    '-c',
    'protocol.ssh.allow=never',

    '-c',
    'protocol.http.allow=never',

    '-c',
    'protocol.https.allow=always',

    '-c',
    'submodule.recurse=false',
  ];
}

function command(
  prefix: readonly string[],
  args: readonly string[],
): string[] {
  return [
    ...prefix,
    ...args,
  ];
}

async function runChecked(
  runner: GitProcessRunner,
  prefix: readonly string[],
  args: readonly string[],
  timeoutMs: number,
  maxOutputBytes: number,
): Promise<string> {
  const result =
    await runner.run({
      args:
        command(
          prefix,
          args,
        ),

      timeoutMs,
      maxOutputBytes,
    });

  if (
    result.exitCode !== 0
  ) {
    throw new Error(
      [
        'GIT_COMMAND_FAILED',
        args[0] ?? 'unknown',
        String(
          result.exitCode,
        ),
      ].join(':'),
    );
  }

  return result.stdout.trim();
}

function canonicalRemote(
  repository: string,
): string {
  return (
    `https://github.com/${repository}.git`
  );
}

function normalizeResolvedCommit(
  value: string,
): string {
  const resolved =
    value.trim().toLowerCase();

  if (!SHA.test(resolved)) {
    throw new Error(
      'INVALID_RESOLVED_COMMIT',
    );
  }

  return resolved;
}

export async function materializeBareRepositoryPair(
  request:
    BareRepositoryMaterializationRequest,

  runner:
    GitProcessRunner =
      new DefaultGitProcessRunner(),
): Promise<
  BareRepositoryMaterializationResult
> {
  assertRequest(request);

  const timeoutMs =
    request.timeoutMs ??
    DEFAULT_TIMEOUT_MS;

  const maxOutputBytes =
    request.maxOutputBytes ??
    DEFAULT_MAX_OUTPUT_BYTES;

  const workspaceRoot =
    resolve(
      request.workspaceRoot,
    );

  await mkdir(
    workspaceRoot,
    {
      recursive: true,
    },
  );

  const temporaryRoot =
    await mkdtemp(
      join(
        workspaceRoot,
        'fulgor-corpus-',
      ),
    );

  const hooksPath =
    join(
      temporaryRoot,
      'disabled-hooks',
    );

  const barePath =
    join(
      temporaryRoot,
      'objects.git',
    );

  await mkdir(
    hooksPath,
    {
      recursive: true,
    },
  );

  const prefix =
    safeGitPrefix(
      hooksPath,
    );

  let successful = false;

  try {
    await runChecked(
      runner,
      prefix,
      [
        'init',
        '--bare',
        barePath,
      ],
      timeoutMs,
      maxOutputBytes,
    );

    await runChecked(
      runner,
      prefix,
      [
        '-C',
        barePath,

        'remote',
        'add',
        'origin',

        canonicalRemote(
          request.repository,
        ),
      ],
      timeoutMs,
      maxOutputBytes,
    );

    const fetchCommit =
      async (
        sha: string,
      ) => {
        await runChecked(
          runner,
          prefix,
          [
            '-C',
            barePath,

            'fetch',

            '--no-tags',
            '--no-recurse-submodules',
            '--filter=blob:none',

            'origin',
            sha,
          ],
          timeoutMs,
          maxOutputBytes,
        );
      };

    await fetchCommit(
      request.vulnerableCommitSha,
    );

    await fetchCommit(
      request.fixedCommitSha,
    );

    const vulnerableResolved =
      normalizeResolvedCommit(
        await runChecked(
          runner,
          prefix,
          [
            '-C',
            barePath,

            'rev-parse',
            '--verify',

            `${request.vulnerableCommitSha}^{commit}`,
          ],
          timeoutMs,
          maxOutputBytes,
        ),
      );

    const fixedResolved =
      normalizeResolvedCommit(
        await runChecked(
          runner,
          prefix,
          [
            '-C',
            barePath,

            'rev-parse',
            '--verify',

            `${request.fixedCommitSha}^{commit}`,
          ],
          timeoutMs,
          maxOutputBytes,
        ),
      );

    const origin =
      await runChecked(
        runner,
        prefix,
        [
          '-C',
          barePath,

          'remote',
          'get-url',
          'origin',
        ],
        timeoutMs,
        maxOutputBytes,
      );

    const bare =
      await runChecked(
        runner,
        prefix,
        [
          '-C',
          barePath,

          'rev-parse',
          '--is-bare-repository',
        ],
        timeoutMs,
        maxOutputBytes,
      );

    const insideWorkTree =
      await runChecked(
        runner,
        prefix,
        [
          '-C',
          barePath,

          'rev-parse',
          '--is-inside-work-tree',
        ],
        timeoutMs,
        maxOutputBytes,
      );

    successful = true;

    const retain =
      request
        .retainMaterialization ===
      true;

    return {
      evidence: {
        repository:
          request.repository,

        resolvedOriginUrl:
          origin,

        requestedVulnerableCommitSha:
          request
            .vulnerableCommitSha,

        requestedFixedCommitSha:
          request
            .fixedCommitSha,

        materializedVulnerableHead:
          vulnerableResolved,

        materializedFixedHead:
          fixedResolved,

        vulnerableCommitExists:
          vulnerableResolved ===
          request
            .vulnerableCommitSha,

        fixedCommitExists:
          fixedResolved ===
          request
            .fixedCommitSha,

        cleanMaterialization:
          bare === 'true' &&
          insideWorkTree ===
            'false',
      },

      materializationPath:
        retain
          ? barePath
          : null,

      executionPolicy: {
        bareRepository: true,
        checkoutAllowed: false,
        hooksAllowed: false,
        submodulesAllowed: false,
        repositoryCodeExecutionAllowed:
          false,
      },
    };
  }
  finally {
    if (
      !request
        .retainMaterialization ||
      !successful
    ) {
      await rm(
        temporaryRoot,
        {
          recursive: true,
          force: true,

          /*
           * Windows can retain Git object/pack file handles
           * briefly after process termination.
           *
           * Retry for a strictly bounded interval only.
           */
          maxRetries: 20,
          retryDelay: 250,
        },
      );
    }
  }
}
