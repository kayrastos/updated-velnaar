import {
  execFile,
} from 'node:child_process';

import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
} from 'node:fs/promises';

import {
  tmpdir,
} from 'node:os';

import {
  dirname,
  join,
  resolve,
} from 'node:path';

import {
  TextDecoder,
} from 'node:util';

import {
  createFulgorBridgePlan,
  selectNextCandidateForFulgor,
  type FulgorBridgePlan,
  type FulgorBridgePolicy,
  type RankedAcceptedCandidate,
} from './acceptedWorkFulgorBridge';

import type {
  PersistedAcceptedWorkProduct,
} from './transactionalProviderQueue';

export const ACCEPTED_WORK_GIT_MATERIALIZER_SCHEMA =
  'VELNAR_ACCEPTED_WORK_GIT_MATERIALIZER_V1' as const;

const MAX_GIT_OUTPUT_BYTES =
  1024 * 1024;

function isolatedGitEnvironment():
NodeJS.ProcessEnv {
  const environment:
    NodeJS.ProcessEnv =
      {};

  for (
    const [
      key,
      value,
    ] of Object.entries(
      process.env,
    )
  ) {
    if (
      !key.startsWith(
        'GIT_',
      ) &&
      value !==
        undefined
    ) {
      environment[key] =
        value;
    }
  }

  environment.GIT_CONFIG_NOSYSTEM =
    '1';

  environment.GIT_CONFIG_GLOBAL =
    process.platform ===
      'win32'
      ? 'NUL'
      : '/dev/null';

  environment.GIT_NO_REPLACE_OBJECTS =
    '1';

  environment.GIT_OPTIONAL_LOCKS =
    '0';

  environment.GIT_TERMINAL_PROMPT =
    '0';

  environment.LC_ALL =
    'C';

  environment.LANG =
    'C';

  return environment;
}

function isolatedGitArgs(
  args:
    readonly string[],
): string[] {
  return [
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'core.autocrlf=false',
    '-c',
    'core.safecrlf=false',
    ...args,
  ];
}

const HEX40 =
  /^[0-9a-f]{40}$/;

const HEX64 =
  /^[0-9a-f]{64}$/;

export interface BaselinePathState {
  readonly exists:
    boolean;

  readonly mode:
    '100644' |
    '100755' |
    null;

  readonly content:
    string | null;
}

export interface AcceptedWorkGitDependencies {
  commitExists(
    repoRoot:
      string,

    baseline:
      string,
  ): Promise<boolean>;

  readPathAtCommit(
    repoRoot:
      string,

    baseline:
      string,

    path:
      string,
  ): Promise<BaselinePathState>;

  dryRunApply(
    path:
      string,

    baseline:
      BaselinePathState,

    patch:
      string,
  ): Promise<boolean>;
}

export interface MaterializedFulgorCandidate {
  readonly schemaVersion:
    typeof ACCEPTED_WORK_GIT_MATERIALIZER_SCHEMA;

  readonly sourceJobId:
    string;

  readonly sourceAcceptedSha256:
    string;

  readonly sourceFingerprint:
    string;

  readonly baselinePathExisted:
    boolean;

  readonly patch:
    string;

  readonly plan:
    FulgorBridgePlan;

  readonly automaticPromotionAllowed:
    false;

  readonly authorityGranted:
    false;
}

function execGitBuffer(
  repoRoot:
    string,

  args:
    readonly string[],
): Promise<Buffer> {
  return new Promise(
    (
      resolvePromise,
      rejectPromise,
    ) => {
      execFile(
        'git',
        isolatedGitArgs(
          args,
        ),
        {
          cwd:
            repoRoot,

          encoding:
            'buffer',

          maxBuffer:
            MAX_GIT_OUTPUT_BYTES,

          env:
            isolatedGitEnvironment(),

          windowsHide:
            true,
        },
        (
          error,
          stdout,
        ) => {
          if (error) {
            rejectPromise(
              error,
            );

            return;
          }

          resolvePromise(
            Buffer.isBuffer(
              stdout,
            )
              ? stdout
              : Buffer.from(
                  stdout,
                ),
          );
        },
      );
    },
  );
}

function execGitSuccess(
  repoRoot:
    string,

  args:
    readonly string[],
): Promise<boolean> {
  return new Promise(
    (
      resolvePromise,
    ) => {
      execFile(
        'git',
        isolatedGitArgs(
          args,
        ),
        {
          cwd:
            repoRoot,

          encoding:
            'buffer',

          maxBuffer:
            MAX_GIT_OUTPUT_BYTES,

          env:
            isolatedGitEnvironment(),

          windowsHide:
            true,
        },
        (
          error,
        ) => {
          resolvePromise(
            error === null,
          );
        },
      );
    },
  );
}

function decodeUtf8(
  value:
    Buffer,
): string {
  try {
    return new TextDecoder(
      'utf-8',
      {
        fatal:
          true,

        ignoreBOM:
          true,
      },
    ).decode(
      value,
    );
  } catch {
    throw new Error(
      'FULGOR_MATERIALIZER_BASELINE_NOT_UTF8',
    );
  }
}

function normalizeRepoRoot(
  value:
    string,
): string {
  if (
    typeof value !==
      'string' ||
    value.trim().length ===
      0
  ) {
    throw new Error(
      'FULGOR_MATERIALIZER_REPO_ROOT_INVALID',
    );
  }

  return resolve(
    value,
  );
}

function fileLines(
  value:
    string,
): Readonly<{
  lines: readonly string[];
  endsWithNewline: boolean;
}> {
  if (value.length === 0) {
    return Object.freeze({
      lines:
        Object.freeze([]),

      endsWithNewline:
        true,
    });
  }

  const endsWithNewline =
    value.endsWith('\n');

  const body =
    endsWithNewline
      ? value.slice(
          0,
          -1,
        )
      : value;

  return Object.freeze({
    lines:
      Object.freeze(
        body.split('\n'),
      ),

    endsWithNewline,
  });
}

function appendFileBody(
  output:
    string[],

  prefix:
    '-' |
    '+',

  content:
    string,
): void {
  const parsed =
    fileLines(
      content,
    );

  for (
    const line
    of parsed.lines
  ) {
    output.push(
      `${prefix}${line}`,
    );
  }

  if (
    parsed.lines.length >
      0 &&
    !parsed.endsWithNewline
  ) {
    output.push(
      '\\ No newline at end of file',
    );
  }
}

function hunkRange(
  count:
    number,
): string {
  return count === 0
    ? '0,0'
    : `1,${count}`;
}

export function buildCanonicalCandidatePatch(
  path:
    string,

  baseline:
    BaselinePathState,

  candidateContent:
    string,
): string {
  if (
    typeof candidateContent !==
      'string'
  ) {
    throw new Error(
      'FULGOR_MATERIALIZER_CANDIDATE_INVALID',
    );
  }

  const before =
    baseline.exists
      ? baseline.content
      : null;

  if (
    baseline.exists &&
    (
      baseline.mode !==
        '100644' &&
      baseline.mode !==
        '100755'
    )
  ) {
    throw new Error(
      'FULGOR_MATERIALIZER_BASELINE_MODE_INVALID',
    );
  }

  if (
    baseline.exists &&
    before === null
  ) {
    throw new Error(
      'FULGOR_MATERIALIZER_BASELINE_CONTENT_MISSING',
    );
  }

  if (
    !baseline.exists &&
    (
      baseline.mode !==
        null ||
      baseline.content !==
        null
    )
  ) {
    throw new Error(
      'FULGOR_MATERIALIZER_BASELINE_STATE_INVALID',
    );
  }

  if (
    before ===
      candidateContent
  ) {
    throw new Error(
      'FULGOR_MATERIALIZER_NO_SEMANTIC_CHANGE',
    );
  }

  if (
    !baseline.exists &&
    candidateContent.length ===
      0
  ) {
    throw new Error(
      'FULGOR_MATERIALIZER_EMPTY_NEW_FILE',
    );
  }

  const oldContent =
    before ??
    '';

  const oldParsed =
    fileLines(
      oldContent,
    );

  const newParsed =
    fileLines(
      candidateContent,
    );

  const output:
    string[] = [
      `diff --git a/${path} b/${path}`,
    ];

  if (!baseline.exists) {
    output.push(
      'new file mode 100644',
      '--- /dev/null',
      `+++ b/${path}`,
    );
  } else {
    output.push(
      `--- a/${path}`,
      `+++ b/${path}`,
    );
  }

  output.push(
    `@@ -${
      hunkRange(
        oldParsed.lines.length,
      )
    } +${
      hunkRange(
        newParsed.lines.length,
      )
    } @@`,
  );

  if (baseline.exists) {
    appendFileBody(
      output,
      '-',
      oldContent,
    );
  }

  appendFileBody(
    output,
    '+',
    candidateContent,
  );

  return `${output.join('\n')}\n`;
}

function selectedSource(
  selection:
    RankedAcceptedCandidate,

  accepted:
    readonly PersistedAcceptedWorkProduct[],
): PersistedAcceptedWorkProduct {
  const memberIds =
    new Set(
      selection.memberJobIds,
    );

  const matches =
    accepted.filter(
      item =>
        memberIds.has(
          item.jobId,
        ) &&
        item.status ===
          'PROPOSE_CHANGE' &&
        item.baseline ===
          selection.baseline &&
        item.candidatePath ===
          selection.candidatePath &&
        item.candidateSha256 ===
          selection.candidateSha256 &&
        item.accepted
          .workProduct
          .candidate !==
          null,
    );

  if (
    matches.length <
      1
  ) {
    throw new Error(
      'FULGOR_MATERIALIZER_SOURCE_NOT_FOUND',
    );
  }

  matches.sort(
    (
      left,
      right,
    ) =>
      left.jobId ===
        right.jobId
        ? 0
        : left.jobId <
            right.jobId
          ? -1
          : 1,
  );

  const source =
    matches[0];

  if (
    !HEX64.test(
      source.acceptedSha256,
    ) ||
    !HEX64.test(
      source.fingerprint,
    )
  ) {
    throw new Error(
      'FULGOR_MATERIALIZER_SOURCE_HASH_INVALID',
    );
  }

  return source;
}

export async function materializeNextAcceptedWorkForFulgor(
  repoRoot:
    string,

  accepted:
    readonly PersistedAcceptedWorkProduct[],

  policy:
    FulgorBridgePolicy,

  dependencies:
    AcceptedWorkGitDependencies =
      productionAcceptedWorkGitDependencies,
): Promise<MaterializedFulgorCandidate | null> {
  const root =
    normalizeRepoRoot(
      repoRoot,
    );

  const selection =
    selectNextCandidateForFulgor(
      accepted,
    );

  if (selection === null) {
    return null;
  }

  if (
    !HEX40.test(
      selection.baseline,
    )
  ) {
    throw new Error(
      'FULGOR_MATERIALIZER_BASELINE_INVALID',
    );
  }

  if (
    !await dependencies
      .commitExists(
        root,
        selection.baseline,
      )
  ) {
    throw new Error(
      'FULGOR_MATERIALIZER_BASELINE_MISSING',
    );
  }

  const source =
    selectedSource(
      selection,
      accepted,
    );

  const candidate =
    source.accepted
      .workProduct
      .candidate;

  if (candidate === null) {
    throw new Error(
      'FULGOR_MATERIALIZER_SOURCE_CANDIDATE_MISSING',
    );
  }

  const baselinePath =
    await dependencies
      .readPathAtCommit(
        root,
        selection.baseline,
        selection.candidatePath,
      );

  const patch =
    buildCanonicalCandidatePatch(
      selection.candidatePath,
      baselinePath,
      candidate.content,
    );

  const dryRunApplySucceeded =
    await dependencies
      .dryRunApply(
        selection.candidatePath,
        baselinePath,
        patch,
      );

  if (!dryRunApplySucceeded) {
    throw new Error(
      'FULGOR_MATERIALIZER_DRY_RUN_FAILED',
    );
  }

  const plan =
    createFulgorBridgePlan(
      selection,
      patch,
      true,
      policy,
    );

  return Object.freeze({
    schemaVersion:
      ACCEPTED_WORK_GIT_MATERIALIZER_SCHEMA,

    sourceJobId:
      source.jobId,

    sourceAcceptedSha256:
      source.acceptedSha256,

    sourceFingerprint:
      source.fingerprint,

    baselinePathExisted:
      baselinePath.exists,

    patch,

    plan,

    automaticPromotionAllowed:
      false,

    authorityGranted:
      false,
  });
}

async function readPathAtCommitProduction(
  repoRoot:
    string,

  baseline:
    string,

  path:
    string,
): Promise<BaselinePathState> {
  let listing:
    Buffer;

  try {
    listing =
      await execGitBuffer(
        repoRoot,
        [
          'ls-tree',
          '-z',
          baseline,
          '--',
          path,
        ],
      );
  } catch {
    throw new Error(
      'FULGOR_MATERIALIZER_LS_TREE_FAILED',
    );
  }

  if (listing.length === 0) {
    return Object.freeze({
      exists:
        false,

      mode:
        null,

      content:
        null,
    });
  }

  const text =
    decodeUtf8(
      listing,
    );

  const records =
    text
      .split('\0')
      .filter(
        value =>
          value.length >
          0,
      );

  if (records.length !== 1) {
    throw new Error(
      'FULGOR_MATERIALIZER_BASELINE_PATH_AMBIGUOUS',
    );
  }

  const match =
    /^([0-9]{6}) ([^ ]+) ([0-9a-f]{40})\t(.+)$/
      .exec(
        records[0],
      );

  if (
    match === null ||
    match[2] !==
      'blob' ||
    match[4] !==
      path ||
    (
      match[1] !==
        '100644' &&
      match[1] !==
        '100755'
    )
  ) {
    throw new Error(
      'FULGOR_MATERIALIZER_BASELINE_PATH_UNSUPPORTED',
    );
  }

  let content:
    Buffer;

  try {
    content =
      await execGitBuffer(
        repoRoot,
        [
          'show',
          `${baseline}:${path}`,
        ],
      );
  } catch {
    throw new Error(
      'FULGOR_MATERIALIZER_BASELINE_READ_FAILED',
    );
  }

  return Object.freeze({
    exists:
      true,

    mode:
      match[1] as
        | '100644'
        | '100755',

    content:
      decodeUtf8(
        content,
      ),
  });
}

async function dryRunApplyProduction(
  path:
    string,

  baseline:
    BaselinePathState,

  patch:
    string,
): Promise<boolean> {
  const root =
    await mkdtemp(
      join(
        tmpdir(),
        'velnar-fulgor-dry-run-',
      ),
    );

  try {
    const destination =
      join(
        root,
        path,
      );

    await mkdir(
      dirname(
        destination,
      ),
      {
        recursive:
          true,
      },
    );

    if (
      baseline.exists
    ) {
      await writeFile(
        destination,
        baseline.content!,
        {
          encoding:
            'utf8',

          mode:
            baseline.mode ===
              '100755'
              ? 0o755
              : 0o644,
        },
      );
    }

    return await new Promise<boolean>(
      (
        resolvePromise,
      ) => {
        const child =
          execFile(
            'git',
            isolatedGitArgs([
              'apply',
              '--check',
              '--whitespace=nowarn',
              '-',
            ]),
            {
              cwd:
                root,

              encoding:
                'utf8',

              maxBuffer:
                MAX_GIT_OUTPUT_BYTES,

              env:
                isolatedGitEnvironment(),

              windowsHide:
                true,
            },
            (
              error,
            ) => {
              resolvePromise(
                error === null,
              );
            },
          );

        child.stdin?.end(
          patch,
          'utf8',
        );
      },
    );
  } finally {
    await rm(
      root,
      {
        recursive:
          true,

        force:
          true,
      },
    );
  }
}

export const productionAcceptedWorkGitDependencies:
AcceptedWorkGitDependencies = {
  async commitExists(
    repoRoot,
    baseline,
  ) {
    return execGitSuccess(
      repoRoot,
      [
        'cat-file',
        '-e',
        `${baseline}^{commit}`,
      ],
    );
  },

  readPathAtCommit:
    readPathAtCommitProduction,

  dryRunApply:
    dryRunApplyProduction,
};
