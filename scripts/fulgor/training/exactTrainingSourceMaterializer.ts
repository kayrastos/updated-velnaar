import {
  createHash,
} from 'node:crypto';

import {
  rm,
} from 'node:fs/promises';

import {
  dirname,
} from 'node:path';

import {
  materializeBareRepositoryPair,
} from '../corpus/materialization/bareRepositoryMaterializer';

import {
  extractRepositoryPairEvidence,
} from '../corpus/materialization/repositoryPairEvidence';

import {
  DefaultGitProcessRunner,
} from '../corpus/materialization/gitProcess';

import type {
  GitProcessResult,
  GitProcessRunner,
} from '../corpus/materialization/gitProcess';

import type {
  FulgorTrainingMaterializationRequest,
} from './trainingMaterializationManifest';

export const FULGOR_EXACT_TRAINING_SOURCE_VERSION =
  'FULGOR_EXACT_TRAINING_SOURCE_V1' as const;

export interface ExactTrainingSourceMaterializationInput {
  request:
    FulgorTrainingMaterializationRequest;

  workspaceRoot:
    string;

  timeoutMs?: number;

  maxSourceBytes?: number;

  maxDiffBytes?: number;

  maxChangedFiles?: number;

  maxObjectStoreGrowthKiB?: number;
}

export interface ExactTrainingSourceArtifact {
  schemaVersion:
    typeof FULGOR_EXACT_TRAINING_SOURCE_VERSION;

  state:
    'EXACT_MATERIALIZED_SOURCE_NO_EXECUTION_AUTHORITY';

  split:
    'TRAIN' | 'DEV';

  recordId:
    string;

  recordSha256:
    string;

  pairGroupKey:
    string;

  repository:
    string;

  sourceCommitSha:
    string;

  vulnerableCommitSha:
    string;

  fixedCommitSha:
    string;

  sourcePath:
    string;

  sourceBlobObjectId:
    string;

  sourceByteLength:
    number;

  sourceSha256:
    string;

  sourceText:
    string;

  pairDiffByteLength:
    number;

  pairDiffSha256:
    string;

  pairDiffText:
    string;

  changedFiles:
    readonly string[];

  fixRelationship:
    'DIRECT_SINGLE_PARENT';

  licenseContinuity:
    'MATCH';

  checkoutAllowed:
    false;

  hooksAllowed:
    false;

  submodulesAllowed:
    false;

  repositoryCodeExecutionAllowed:
    false;

  trainingExecutionAuthorized:
    false;

  promotionAuthorized:
    false;

  deploymentAuthorized:
    false;

  artifactSha256:
    string;
}

const SHA =
  /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

const SHA256 =
  /^[a-f0-9]{64}$/;

const REPOSITORY =
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const REGULAR_BLOB_MODE =
  /^(?:100644|100755)$/;

const DEFAULT_TIMEOUT_MS =
  30_000;

const DEFAULT_MAX_SOURCE_BYTES =
  524_288;

const DEFAULT_MAX_DIFF_BYTES =
  2_097_152;

const DEFAULT_MAX_CHANGED_FILES =
  64;

const DEFAULT_MAX_OBJECT_STORE_GROWTH_KIB =
  8_192;

function canonicalRemote(
  repository: string,
): string {
  return (
    `https://github.com/${repository}.git`
  );
}

function sha256Bytes(
  bytes: Uint8Array,
): string {
  return createHash('sha256')
    .update(bytes)
    .digest('hex');
}

function normalize(
  value: unknown,
): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(
        'EXACT_SOURCE_NON_CANONICAL_NUMBER',
      );
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.map(
      normalize,
    );
  }

  if (
    typeof value === 'object'
  ) {
    const source =
      value as Record<string, unknown>;

    const target:
      Record<string, unknown> = {};

    for (
      const key of
      Object.keys(source).sort()
    ) {
      const item =
        source[key];

      if (item === undefined) {
        throw new Error(
          'EXACT_SOURCE_NON_CANONICAL_UNDEFINED',
        );
      }

      target[key] =
        normalize(item);
    }

    return target;
  }

  throw new Error(
    'EXACT_SOURCE_NON_CANONICAL_VALUE',
  );
}

function sha256Object(
  value: unknown,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        normalize(value),
      ),
      'utf8',
    )
    .digest('hex');
}

function strictUtf8(
  bytes: Uint8Array,
  errorCode: string,
): string {
  try {
    return new TextDecoder(
      'utf-8',
      {
        fatal: true,
      },
    ).decode(bytes);
  }
  catch {
    throw new Error(
      errorCode,
    );
  }
}

function deepFreeze<T>(
  value: T,
): T {
  if (
    value !== null &&
    typeof value === 'object'
  ) {
    for (
      const child of
      Object.values(
        value as Record<string, unknown>,
      )
    ) {
      deepFreeze(child);
    }

    Object.freeze(value);
  }

  return value;
}

function assertPositiveInteger(
  value: number,
  code: string,
): void {
  if (
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    throw new Error(code);
  }
}

function assertRequest(
  request:
    FulgorTrainingMaterializationRequest,
): void {
  if (
    request.schemaVersion !==
      'FULGOR_TRAINING_MATERIALIZATION_REQUEST_V1' ||
    (
      request.split !== 'TRAIN' &&
      request.split !== 'DEV'
    ) ||
    !REPOSITORY.test(
      request.repository,
    ) ||
    !SHA256.test(
      request.recordSha256,
    ) ||
    !SHA256.test(
      request.pairGroupKey,
    ) ||
    !SHA.test(
      request.sourceCommitSha,
    ) ||
    !SHA.test(
      request.vulnerableCommitSha,
    ) ||
    !SHA.test(
      request.fixedCommitSha,
    ) ||
    request.sourceImmutableRevision !==
      request.sourceCommitSha ||
    (
      request.sourceCommitSha !==
        request.vulnerableCommitSha &&
      request.sourceCommitSha !==
        request.fixedCommitSha
    ) ||
    !SHA256.test(
      request.sourceContentSha256,
    )
  ) {
    throw new Error(
      'INVALID_EXACT_TRAINING_SOURCE_REQUEST',
    );
  }
}

function safeGitPrefix(
  bareRepositoryPath: string,
): string[] {
  return [
    '-c',
    `core.hooksPath=${bareRepositoryPath}.disabled-hooks`,

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

async function runBytes(
  runner:
    GitProcessRunner,

  bareRepositoryPath:
    string,

  args:
    readonly string[],

  timeoutMs:
    number,

  maxOutputBytes:
    number,
): Promise<Uint8Array> {
  const result:
    GitProcessResult =
      await runner.run({
        args: [
          ...safeGitPrefix(
            bareRepositoryPath,
          ),

          '-C',
          bareRepositoryPath,

          ...args,
        ],

        timeoutMs,
        maxOutputBytes,
      });

  if (result.exitCode !== 0) {
    throw new Error(
      [
        'EXACT_SOURCE_GIT_FAILED',
        args[0] ?? 'unknown',
        String(result.exitCode),
      ].join(':'),
    );
  }

  if (
    result.stdoutBytes ===
    undefined
  ) {
    throw new Error(
      'EXACT_SOURCE_BYTES_UNAVAILABLE',
    );
  }

  return result.stdoutBytes;
}

interface TreeBlob {
  path:
    string;

  objectId:
    string;
}

function parseTreeBlob(
  bytes:
    Uint8Array,

  expectedPath:
    string,
): TreeBlob | null {
  if (bytes.byteLength === 0) {
    return null;
  }

  const decoded =
    strictUtf8(
      bytes,
      'EXACT_SOURCE_INVALID_UTF8_TREE_RECORD',
    );

  const records =
    decoded
      .split('\0')
      .filter(
        (record) =>
          record.length > 0,
      );

  if (records.length !== 1) {
    throw new Error(
      'EXACT_SOURCE_AMBIGUOUS_TREE_RECORD',
    );
  }

  const tabIndex =
    records[0].indexOf('\t');

  if (tabIndex <= 0) {
    throw new Error(
      'EXACT_SOURCE_INVALID_TREE_RECORD',
    );
  }

  const metadata =
    records[0]
      .slice(
        0,
        tabIndex,
      )
      .split(' ');

  const path =
    records[0]
      .slice(
        tabIndex + 1,
      );

  if (
    metadata.length !== 3 ||
    !REGULAR_BLOB_MODE.test(
      metadata[0],
    ) ||
    metadata[1] !== 'blob' ||
    !SHA.test(
      metadata[2],
    ) ||
    path !== expectedPath
  ) {
    throw new Error(
      'EXACT_SOURCE_INVALID_TREE_BLOB',
    );
  }

  return {
    path,

    objectId:
      metadata[2],
  };
}

interface SourceCandidate {
  path:
    string;

  objectId:
    string;

  bytes:
    Uint8Array;
}

async function findExactSourceCandidate(
  request:
    FulgorTrainingMaterializationRequest,

  changedFiles:
    readonly string[],

  bareRepositoryPath:
    string,

  runner:
    GitProcessRunner,

  timeoutMs:
    number,

  maxSourceBytes:
    number,
): Promise<SourceCandidate> {
  const matches:
    SourceCandidate[] = [];

  for (
    const path of
    changedFiles
  ) {
    const treeBytes =
      await runBytes(
        runner,
        bareRepositoryPath,
        [
          'ls-tree',
          '-z',

          request.sourceCommitSha,

          '--',
          path,
        ],
        timeoutMs,
        262_144,
      );

    const blob =
      parseTreeBlob(
        treeBytes,
        path,
      );

    /*
     * Added/deleted files can legitimately be absent from one
     * member of the pair.
     */
    if (blob === null) {
      continue;
    }

    const bytes =
      await runBytes(
        runner,
        bareRepositoryPath,
        [
          'cat-file',
          'blob',
          blob.objectId,
        ],
        timeoutMs,
        maxSourceBytes,
      );

    if (
      sha256Bytes(bytes) ===
      request.sourceContentSha256
    ) {
      matches.push({
        path:
          blob.path,

        objectId:
          blob.objectId,

        bytes,
      });
    }
  }

  if (matches.length === 0) {
    throw new Error(
      'EXACT_SOURCE_HASH_NOT_FOUND',
    );
  }

  if (matches.length !== 1) {
    throw new Error(
      'EXACT_SOURCE_HASH_AMBIGUOUS',
    );
  }

  return matches[0];
}

async function cleanupMaterialization(
  bareRepositoryPath:
    string,
): Promise<void> {
  await rm(
    dirname(
      bareRepositoryPath,
    ),
    {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 250,
    },
  );
}

export async function materializeExactTrainingSource(
  input:
    ExactTrainingSourceMaterializationInput,

  runner:
    GitProcessRunner =
      new DefaultGitProcessRunner(),
): Promise<ExactTrainingSourceArtifact> {
  assertRequest(
    input.request,
  );

  if (
    input.workspaceRoot
      .trim()
      .length === 0
  ) {
    throw new Error(
      'INVALID_EXACT_SOURCE_WORKSPACE_ROOT',
    );
  }

  const timeoutMs =
    input.timeoutMs ??
    DEFAULT_TIMEOUT_MS;

  const maxSourceBytes =
    input.maxSourceBytes ??
    DEFAULT_MAX_SOURCE_BYTES;

  const maxDiffBytes =
    input.maxDiffBytes ??
    DEFAULT_MAX_DIFF_BYTES;

  const maxChangedFiles =
    input.maxChangedFiles ??
    DEFAULT_MAX_CHANGED_FILES;

  const maxObjectStoreGrowthKiB =
    input.maxObjectStoreGrowthKiB ??
    DEFAULT_MAX_OBJECT_STORE_GROWTH_KIB;

  assertPositiveInteger(
    timeoutMs,
    'INVALID_EXACT_SOURCE_TIMEOUT',
  );

  assertPositiveInteger(
    maxSourceBytes,
    'INVALID_EXACT_SOURCE_BYTE_LIMIT',
  );

  assertPositiveInteger(
    maxDiffBytes,
    'INVALID_EXACT_DIFF_BYTE_LIMIT',
  );

  assertPositiveInteger(
    maxChangedFiles,
    'INVALID_EXACT_CHANGED_FILE_LIMIT',
  );

  assertPositiveInteger(
    maxObjectStoreGrowthKiB,
    'INVALID_EXACT_OBJECT_STORE_LIMIT',
  );

  const request =
    input.request;

  let bareRepositoryPath:
    string | null = null;

  try {
    const materialized =
      await materializeBareRepositoryPair(
        {
          repository:
            request.repository,

          vulnerableCommitSha:
            request.vulnerableCommitSha,

          fixedCommitSha:
            request.fixedCommitSha,

          workspaceRoot:
            input.workspaceRoot,

          timeoutMs,

          maxOutputBytes:
            1_048_576,

          retainMaterialization:
            true,
        },

        runner,
      );

    bareRepositoryPath =
      materialized
        .materializationPath;

    if (
      bareRepositoryPath === null
    ) {
      throw new Error(
        'EXACT_SOURCE_MATERIALIZATION_NOT_RETAINED',
      );
    }

    const evidence =
      materialized.evidence;

    const policy =
      materialized
        .executionPolicy;

    if (
      evidence.repository !==
        request.repository ||
      evidence.resolvedOriginUrl !==
        canonicalRemote(
          request.repository,
        ) ||
      evidence
        .requestedVulnerableCommitSha !==
        request.vulnerableCommitSha ||
      evidence
        .requestedFixedCommitSha !==
        request.fixedCommitSha ||
      evidence
        .materializedVulnerableHead !==
        request.vulnerableCommitSha ||
      evidence
        .materializedFixedHead !==
        request.fixedCommitSha ||
      evidence
        .vulnerableCommitExists !==
        true ||
      evidence
        .fixedCommitExists !==
        true ||
      evidence
        .cleanMaterialization !==
        true ||
      policy.bareRepository !==
        true ||
      policy.checkoutAllowed !==
        false ||
      policy.hooksAllowed !==
        false ||
      policy.submodulesAllowed !==
        false ||
      policy
        .repositoryCodeExecutionAllowed !==
        false
    ) {
      throw new Error(
        'EXACT_SOURCE_MATERIALIZATION_IDENTITY_REJECTED',
      );
    }

    const pairEvidence =
      await extractRepositoryPairEvidence(
        {
          repository:
            request.repository,

          bareRepositoryPath,

          vulnerableCommitSha:
            request.vulnerableCommitSha,

          fixedCommitSha:
            request.fixedCommitSha,

          timeoutMs,

          maxMetadataBytes:
            524_288,

          maxDiffBytes,

          maxChangedFiles,

          maxHydrationObjectStoreGrowthKiB:
            maxObjectStoreGrowthKiB,
        },

        runner,
      );

    if (
      pairEvidence
        .vulnerableCommitSha !==
        request.vulnerableCommitSha ||
      pairEvidence
        .fixedCommitSha !==
        request.fixedCommitSha ||
      pairEvidence
        .fixRelationship !==
        'DIRECT_SINGLE_PARENT' ||
      pairEvidence
        .licenseContinuity !==
        'MATCH' ||
      pairEvidence
        .eligibleForCorpusReview !==
        true ||
      pairEvidence
        .changedFiles.length ===
        0
    ) {
      throw new Error(
        'EXACT_SOURCE_PAIR_EVIDENCE_REJECTED',
      );
    }

    const source =
      await findExactSourceCandidate(
        request,
        pairEvidence.changedFiles,
        bareRepositoryPath,
        runner,
        timeoutMs,
        maxSourceBytes,
      );

    const sourceText =
      strictUtf8(
        source.bytes,
        'EXACT_SOURCE_ARTIFACT_NOT_UTF8',
      );

    const diffBytes =
      await runBytes(
        runner,
        bareRepositoryPath,
        [
          'diff',
          '--binary',
          '--full-index',
          '--no-ext-diff',
          '--no-textconv',
          '--no-renames',

          request.vulnerableCommitSha,
          request.fixedCommitSha,

          '--',
        ],
        timeoutMs,
        maxDiffBytes,
      );

    if (diffBytes.byteLength === 0) {
      throw new Error(
        'EXACT_SOURCE_EMPTY_PAIR_DIFF',
      );
    }

    const pairDiffText =
      strictUtf8(
        diffBytes,
        'EXACT_SOURCE_DIFF_NOT_UTF8',
      );

    const core = {
      schemaVersion:
        FULGOR_EXACT_TRAINING_SOURCE_VERSION,

      state:
        'EXACT_MATERIALIZED_SOURCE_NO_EXECUTION_AUTHORITY' as const,

      split:
        request.split,

      recordId:
        request.recordId,

      recordSha256:
        request.recordSha256,

      pairGroupKey:
        request.pairGroupKey,

      repository:
        request.repository,

      sourceCommitSha:
        request.sourceCommitSha,

      vulnerableCommitSha:
        request.vulnerableCommitSha,

      fixedCommitSha:
        request.fixedCommitSha,

      sourcePath:
        source.path,

      sourceBlobObjectId:
        source.objectId,

      sourceByteLength:
        source.bytes.byteLength,

      sourceSha256:
        sha256Bytes(
          source.bytes,
        ),

      sourceText,

      pairDiffByteLength:
        diffBytes.byteLength,

      pairDiffSha256:
        sha256Bytes(
          diffBytes,
        ),

      pairDiffText,

      changedFiles:
        [...pairEvidence
          .changedFiles],

      fixRelationship:
        'DIRECT_SINGLE_PARENT' as const,

      licenseContinuity:
        'MATCH' as const,

      checkoutAllowed:
        false as const,

      hooksAllowed:
        false as const,

      submodulesAllowed:
        false as const,

      repositoryCodeExecutionAllowed:
        false as const,

      trainingExecutionAuthorized:
        false as const,

      promotionAuthorized:
        false as const,

      deploymentAuthorized:
        false as const,
    };

    return deepFreeze({
      ...core,

      artifactSha256:
        sha256Object(core),
    });
  }
  finally {
    if (
      bareRepositoryPath !== null
    ) {
      await cleanupMaterialization(
        bareRepositoryPath,
      );
    }
  }
}
