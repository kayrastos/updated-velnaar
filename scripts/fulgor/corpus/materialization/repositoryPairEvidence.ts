import {
  createHash,
} from 'node:crypto';

import {
  DefaultGitProcessRunner,
} from './gitProcess';

import type {
  GitProcessResult,
  GitProcessRunner,
} from './gitProcess';

export type FixRelationship =
  | 'DIRECT_SINGLE_PARENT'
  | 'SINGLE_PARENT_DIFFERENT'
  | 'MERGE_COMMIT'
  | 'ROOT_COMMIT';

export type LicenseBlobState =
  | 'SINGLE_ROOT_LICENSE'
  | 'NO_ROOT_LICENSE'
  | 'AMBIGUOUS_ROOT_LICENSE';

export type LicenseContinuity =
  | 'MATCH'
  | 'DIFFERENT'
  | 'MISSING_OR_AMBIGUOUS';

export interface RevisionLicenseEvidence {
  state: LicenseBlobState;

  path: string | null;

  blobObjectId:
    string | null;

  contentSha256:
    string | null;

  byteLength:
    number | null;
}

export interface RepositoryPairEvidence {
  vulnerableCommitSha:
    string;

  fixedCommitSha:
    string;

  fixRelationship:
    FixRelationship;

  fixedParents:
    readonly string[];

  diffSha256:
    string;

  diffByteLength:
    number;

  changedFiles:
    readonly string[];

  vulnerableLicense:
    RevisionLicenseEvidence;

  fixedLicense:
    RevisionLicenseEvidence;

  licenseContinuity:
    LicenseContinuity;

  eligibleForCorpusReview:
    boolean;
}

export interface RepositoryPairEvidenceRequest {
  bareRepositoryPath:
    string;

  vulnerableCommitSha:
    string;

  fixedCommitSha:
    string;

  timeoutMs?: number;

  maxMetadataBytes?: number;

  maxDiffBytes?: number;

  maxChangedFiles?: number;
}

const SHA =
  /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

const LICENSE_NAMES =
  new Set([
    'license',
    'license.md',
    'license.txt',
    'copying',
    'copying.md',
    'copying.txt',
  ]);

const REGULAR_BLOB_MODE =
  /^(?:100644|100755)$/;

const DEFAULT_TIMEOUT_MS =
  30_000;

const DEFAULT_METADATA_BYTES =
  262_144;

const DEFAULT_DIFF_BYTES =
  2_097_152;

const DEFAULT_MAX_CHANGED_FILES =
  64;

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
  bareRepositoryPath: string,
  args: readonly string[],
): string[] {
  return [
    ...prefix,
    '-C',
    bareRepositoryPath,
    ...args,
  ];
}

async function runResult(
  runner: GitProcessRunner,
  prefix: readonly string[],
  bareRepositoryPath: string,
  args: readonly string[],
  timeoutMs: number,
  maxOutputBytes: number,
): Promise<GitProcessResult> {
  const result =
    await runner.run({
      args:
        command(
          prefix,
          bareRepositoryPath,
          args,
        ),

      timeoutMs,
      maxOutputBytes,
    });

  if (result.exitCode !== 0) {
    throw new Error(
      [
        'PAIR_EVIDENCE_GIT_FAILED',
        args[0] ?? 'unknown',
        String(result.exitCode),
      ].join(':'),
    );
  }

  return result;
}

async function runText(
  runner: GitProcessRunner,
  prefix: readonly string[],
  bareRepositoryPath: string,
  args: readonly string[],
  timeoutMs: number,
  maxOutputBytes: number,
): Promise<string> {
  const result =
    await runResult(
      runner,
      prefix,
      bareRepositoryPath,
      args,
      timeoutMs,
      maxOutputBytes,
    );

  return result.stdout.trim();
}

async function runBytes(
  runner: GitProcessRunner,
  prefix: readonly string[],
  bareRepositoryPath: string,
  args: readonly string[],
  timeoutMs: number,
  maxOutputBytes: number,
): Promise<Uint8Array> {
  const result =
    await runResult(
      runner,
      prefix,
      bareRepositoryPath,
      args,
      timeoutMs,
      maxOutputBytes,
    );

  if (
    result.stdoutBytes ===
    undefined
  ) {
    throw new Error(
      'PAIR_EVIDENCE_EXACT_BYTES_UNAVAILABLE',
    );
  }

  return result.stdoutBytes;
}

function sha256(
  bytes: Uint8Array,
): string {
  return createHash('sha256')
    .update(bytes)
    .digest('hex');
}

function strictUtf8(
  bytes: Uint8Array,
): string {
  try {
    return new TextDecoder(
      'utf-8',
      {
        fatal: true,
      },
    ).decode(bytes);
  } catch {
    throw new Error(
      'PAIR_EVIDENCE_INVALID_UTF8_PATH',
    );
  }
}

function fixRelationship(
  fixedCommitSha: string,
  revListLine: string,
): {
  relationship: FixRelationship;
  parents: readonly string[];
} {
  const parts =
    revListLine
      .trim()
      .split(/\s+/)
      .filter(Boolean);

  if (
    parts.length === 0 ||
    parts[0] !== fixedCommitSha
  ) {
    throw new Error(
      'PAIR_EVIDENCE_INVALID_PARENT_RECORD',
    );
  }

  const parents =
    parts.slice(1);

  if (parents.length === 0) {
    return {
      relationship:
        'ROOT_COMMIT',
      parents,
    };
  }

  if (parents.length > 1) {
    return {
      relationship:
        'MERGE_COMMIT',
      parents,
    };
  }

  return {
    relationship:
      'SINGLE_PARENT_DIFFERENT',
    parents,
  };
}

function finalRelationship(
  vulnerableCommitSha: string,
  base: {
    relationship:
      FixRelationship;
    parents:
      readonly string[];
  },
): FixRelationship {
  if (
    base.relationship ===
      'SINGLE_PARENT_DIFFERENT' &&
    base.parents[0] ===
      vulnerableCommitSha
  ) {
    return 'DIRECT_SINGLE_PARENT';
  }

  return base.relationship;
}

function parseChangedFiles(
  bytes: Uint8Array,
): readonly string[] {
  if (bytes.byteLength === 0) {
    return [];
  }

  const decoded =
    strictUtf8(bytes);

  return decoded
    .split('\0')
    .filter(
      (entry) =>
        entry.length > 0,
    );
}

function candidateLicenseNames(
  rootListing: string,
): readonly string[] {
  return rootListing
    .split(/\r?\n/)
    .map(
      (entry) =>
        entry.trim(),
    )
    .filter(
      (entry) =>
        entry.length > 0 &&
        LICENSE_NAMES.has(
          entry.toLowerCase(),
        ),
    )
    .sort(
      (left, right) =>
        left.localeCompare(
          right,
        ),
    );
}

async function licenseEvidence(
  runner: GitProcessRunner,
  prefix: readonly string[],
  bareRepositoryPath: string,
  commitSha: string,
  timeoutMs: number,
  maxMetadataBytes: number,
): Promise<RevisionLicenseEvidence> {
  const rootListing =
    await runText(
      runner,
      prefix,
      bareRepositoryPath,
      [
        'ls-tree',
        '--name-only',
        commitSha,
      ],
      timeoutMs,
      maxMetadataBytes,
    );

  const candidates =
    candidateLicenseNames(
      rootListing,
    );

  if (candidates.length === 0) {
    return {
      state:
        'NO_ROOT_LICENSE',

      path: null,
      blobObjectId: null,
      contentSha256: null,
      byteLength: null,
    };
  }

  if (candidates.length > 1) {
    return {
      state:
        'AMBIGUOUS_ROOT_LICENSE',

      path: null,
      blobObjectId: null,
      contentSha256: null,
      byteLength: null,
    };
  }

  const path =
    candidates[0];

  const treeLine =
    await runText(
      runner,
      prefix,
      bareRepositoryPath,
      [
        'ls-tree',
        commitSha,
        '--',
        path,
      ],
      timeoutMs,
      maxMetadataBytes,
    );

  const match =
    /^([0-7]{6}) blob ([a-f0-9]{40}|[a-f0-9]{64})\t(.+)$/
      .exec(treeLine);

  if (
    !match ||
    !REGULAR_BLOB_MODE.test(
      match[1],
    ) ||
    match[3] !== path
  ) {
    throw new Error(
      'PAIR_EVIDENCE_INVALID_LICENSE_BLOB',
    );
  }

  const blob =
    await runBytes(
      runner,
      prefix,
      bareRepositoryPath,
      [
        'cat-file',
        'blob',
        `${commitSha}:${path}`,
      ],
      timeoutMs,
      maxMetadataBytes,
    );

  return {
    state:
      'SINGLE_ROOT_LICENSE',

    path,

    blobObjectId:
      match[2],

    contentSha256:
      sha256(blob),

    byteLength:
      blob.byteLength,
  };
}

function licenseContinuity(
  vulnerable:
    RevisionLicenseEvidence,

  fixed:
    RevisionLicenseEvidence,
): LicenseContinuity {
  if (
    vulnerable.state !==
      'SINGLE_ROOT_LICENSE' ||
    fixed.state !==
      'SINGLE_ROOT_LICENSE' ||
    vulnerable.contentSha256 ===
      null ||
    fixed.contentSha256 ===
      null
  ) {
    return (
      'MISSING_OR_AMBIGUOUS'
    );
  }

  return (
    vulnerable.contentSha256 ===
    fixed.contentSha256
  )
    ? 'MATCH'
    : 'DIFFERENT';
}

export async function extractRepositoryPairEvidence(
  request:
    RepositoryPairEvidenceRequest,

  runner:
    GitProcessRunner =
      new DefaultGitProcessRunner(),
): Promise<RepositoryPairEvidence> {
  if (
    request.bareRepositoryPath
      .trim().length === 0
  ) {
    throw new Error(
      'PAIR_EVIDENCE_INVALID_REPOSITORY_PATH',
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
      'PAIR_EVIDENCE_INVALID_COMMIT_PAIR',
    );
  }

  const timeoutMs =
    request.timeoutMs ??
    DEFAULT_TIMEOUT_MS;

  const maxMetadataBytes =
    request.maxMetadataBytes ??
    DEFAULT_METADATA_BYTES;

  const maxDiffBytes =
    request.maxDiffBytes ??
    DEFAULT_DIFF_BYTES;

  const maxChangedFiles =
    request.maxChangedFiles ??
    DEFAULT_MAX_CHANGED_FILES;

  if (
    !Number.isInteger(
      maxChangedFiles,
    ) ||
    maxChangedFiles <= 0
  ) {
    throw new Error(
      'PAIR_EVIDENCE_INVALID_CHANGED_FILE_LIMIT',
    );
  }

  const hooksPath =
    `${request.bareRepositoryPath}.disabled-hooks`;

  const prefix =
    safeGitPrefix(
      hooksPath,
    );

  const parentLine =
    await runText(
      runner,
      prefix,
      request.bareRepositoryPath,
      [
        'rev-list',
        '--parents',
        '-n',
        '1',
        request.fixedCommitSha,
      ],
      timeoutMs,
      maxMetadataBytes,
    );

  const baseRelationship =
    fixRelationship(
      request.fixedCommitSha,
      parentLine,
    );

  const relationship =
    finalRelationship(
      request.vulnerableCommitSha,
      baseRelationship,
    );

  const changedFileBytes =
    await runBytes(
      runner,
      prefix,
      request.bareRepositoryPath,
      [
        'diff',
        '--name-only',
        '-z',
        '--no-ext-diff',
        '--no-textconv',
        '--no-renames',

        request.vulnerableCommitSha,
        request.fixedCommitSha,

        '--',
      ],
      timeoutMs,
      maxMetadataBytes,
    );

  const changedFiles =
    parseChangedFiles(
      changedFileBytes,
    );

  const diffBytes =
    await runBytes(
      runner,
      prefix,
      request.bareRepositoryPath,
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

  const vulnerableLicense =
    await licenseEvidence(
      runner,
      prefix,
      request.bareRepositoryPath,
      request.vulnerableCommitSha,
      timeoutMs,
      maxMetadataBytes,
    );

  const fixedLicense =
    await licenseEvidence(
      runner,
      prefix,
      request.bareRepositoryPath,
      request.fixedCommitSha,
      timeoutMs,
      maxMetadataBytes,
    );

  const continuity =
    licenseContinuity(
      vulnerableLicense,
      fixedLicense,
    );

  const eligible =
    relationship ===
      'DIRECT_SINGLE_PARENT' &&
    diffBytes.byteLength > 0 &&
    changedFiles.length > 0 &&
    changedFiles.length <=
      maxChangedFiles &&
    continuity === 'MATCH';

  return {
    vulnerableCommitSha:
      request.vulnerableCommitSha,

    fixedCommitSha:
      request.fixedCommitSha,

    fixRelationship:
      relationship,

    fixedParents:
      baseRelationship.parents,

    diffSha256:
      sha256(diffBytes),

    diffByteLength:
      diffBytes.byteLength,

    changedFiles,

    vulnerableLicense,

    fixedLicense,

    licenseContinuity:
      continuity,

    eligibleForCorpusReview:
      eligible,
  };
}