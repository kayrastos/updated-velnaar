import {
  createHash,
} from 'node:crypto';

import {
  DefaultGitProcessRunner,
} from './gitProcess';

import {
  detectReviewEligibleSpdxLicense,
} from '../validation/spdxLicenseDetector';

import type {
  ReviewEligibleSpdxId,
} from '../validation/spdxLicenseDetector';

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

  /*
   * Derived only from the exact materialized license blob.
   * Caller/advisory metadata is never SPDX authority.
   */
  detectedSpdxId?:
    ReviewEligibleSpdxId | null;
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
  repository:
    string;

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

  /*
   * Maximum cumulative growth of the Git object database caused
   * by explicit post-materialization blob hydration.
   *
   * Unit is KiB because `git count-objects -v` reports object
   * database disk consumption in KiB.
   */
  maxHydrationObjectStoreGrowthKiB?:
    number;
}

const SHA =
  /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

const REPOSITORY =
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const ZERO_OBJECT_ID =
  /^(?:0{40}|0{64})$/;

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

interface ChangedBlobRecord {
  path: string;
  oldObjectId: string | null;
  newObjectId: string | null;
}

function canonicalRemote(
  repository: string,
): string {
  return (
    `https://github.com/${repository}.git`
  );
}

function parseRawChangedBlobRecords(
  bytes: Uint8Array,
): readonly ChangedBlobRecord[] {
  if (bytes.byteLength === 0) {
    return [];
  }

  const fields =
    strictUtf8(bytes)
      .split('\0');

  if (
    fields.length > 0 &&
    fields[
      fields.length - 1
    ] === ''
  ) {
    fields.pop();
  }

  if (
    fields.length % 2 !== 0
  ) {
    throw new Error(
      'PAIR_EVIDENCE_INVALID_RAW_DIFF_RECORD',
    );
  }

  const records:
    ChangedBlobRecord[] = [];

  for (
    let index = 0;
    index < fields.length;
    index += 2
  ) {
    const header =
      fields[index];

    const path =
      fields[index + 1];

    const match =
      /^:([0-7]{6}) ([0-7]{6}) ([a-f0-9]{40}|[a-f0-9]{64}) ([a-f0-9]{40}|[a-f0-9]{64}) ([A-Z][0-9]*)$/
        .exec(header);

    if (
      !match ||
      path.length === 0
    ) {
      throw new Error(
        'PAIR_EVIDENCE_INVALID_RAW_DIFF_RECORD',
      );
    }

    const oldObjectId =
      ZERO_OBJECT_ID.test(
        match[3],
      )
        ? null
        : match[3];

    const newObjectId =
      ZERO_OBJECT_ID.test(
        match[4],
      )
        ? null
        : match[4];

    records.push({
      path,
      oldObjectId,
      newObjectId,
    });
  }

  return records;
}

function sameChangedPaths(
  changedFiles: readonly string[],
  rawRecords:
    readonly ChangedBlobRecord[],
): boolean {
  if (
    changedFiles.length !==
    rawRecords.length
  ) {
    return false;
  }

  const left =
    [...changedFiles]
      .sort();

  const right =
    rawRecords
      .map(
        (record) =>
          record.path,
      )
      .sort();

  return left.every(
    (path, index) =>
      path === right[index],
  );
}

async function assertLocalNetworkConfigSafe(
  runner: GitProcessRunner,
  prefix: readonly string[],
  bareRepositoryPath: string,
  timeoutMs: number,
  maxOutputBytes: number,
): Promise<void> {
  const result =
    await runner.run({
      args:
        command(
          prefix,
          bareRepositoryPath,
          [
            'config',
            '--local',
            '--name-only',
            '--get-regexp',
            '^(url\.|http\.|credential\.|remote\..*\.proxy$|core\.gitproxy$)',
          ],
        ),

      timeoutMs,
      maxOutputBytes,
    });

  /*
   * git config --get-regexp returns 1 when no matching
   * configuration exists.
   */
  if (result.exitCode === 1) {
    return;
  }

  if (result.exitCode !== 0) {
    throw new Error(
      [
        'PAIR_EVIDENCE_GIT_FAILED',
        'config',
        String(result.exitCode),
      ].join(':'),
    );
  }

  if (
    result.stdout
      .trim()
      .length > 0
  ) {
    throw new Error(
      'PAIR_EVIDENCE_UNSAFE_LOCAL_NETWORK_CONFIG',
    );
  }
}

async function exactBlobIsLocal(
  runner: GitProcessRunner,
  prefix: readonly string[],
  bareRepositoryPath: string,
  objectId: string,
  timeoutMs: number,
  maxOutputBytes: number,
): Promise<boolean> {
  if (!SHA.test(objectId)) {
    throw new Error(
      'PAIR_EVIDENCE_INVALID_BLOB_OBJECT_ID',
    );
  }

  const result =
    await runner.run({
      args:
        command(
          prefix,
          bareRepositoryPath,
          [
            'cat-file',
            '-e',
            `${objectId}^{blob}`,
          ],
        ),

      timeoutMs,
      maxOutputBytes,
    });

  return result.exitCode === 0;
}

async function hydrateExactBlob(
  runner: GitProcessRunner,
  prefix: readonly string[],
  bareRepositoryPath: string,
  objectId: string,
  timeoutMs: number,
  maxOutputBytes: number,
): Promise<void> {
  if (
    await exactBlobIsLocal(
      runner,
      prefix,
      bareRepositoryPath,
      objectId,
      timeoutMs,
      maxOutputBytes,
    )
  ) {
    return;
  }

  /*
   * This is the only post-materialization network phase.
   * The object identity is derived from authenticated Git
   * tree metadata rather than caller-provided arbitrary input.
   */
  await runResult(
    runner,
    prefix,
    bareRepositoryPath,
    [
      'fetch',
      '--no-tags',
      '--no-recurse-submodules',
      'origin',
      objectId,
    ],
    timeoutMs,
    maxOutputBytes,
  );

  if (
    !await exactBlobIsLocal(
      runner,
      prefix,
      bareRepositoryPath,
      objectId,
      timeoutMs,
      maxOutputBytes,
    )
  ) {
    throw new Error(
      'PAIR_EVIDENCE_EXPLICIT_BLOB_FETCH_FAILED',
    );
  }
}
interface ObjectStoreUsage {
  objectKiB: number;
  garbageKiB: number;
}

function parseObjectStoreUsage(
  text: string,
): ObjectStoreUsage {
  const values =
    new Map<string, number>();

  for (
    const rawLine of
    text.split('\n')
  ) {
    const line =
      rawLine.trim();

    if (line.length === 0) {
      continue;
    }

    if (
      line.startsWith(
        'alternate: ',
      )
    ) {
      throw new Error(
        'PAIR_EVIDENCE_OBJECT_STORE_ALTERNATE_REJECTED',
      );
    }

    const match =
      /^([a-z-]+): ([0-9]+)$/
        .exec(line);

    if (!match) {
      throw new Error(
        'PAIR_EVIDENCE_INVALID_OBJECT_STORE_REPORT',
      );
    }

    values.set(
      match[1],
      Number(match[2]),
    );
  }

  for (
    const required of [
      'size',
      'size-pack',
      'garbage',
      'size-garbage',
    ]
  ) {
    if (
      !values.has(required)
    ) {
      throw new Error(
        'PAIR_EVIDENCE_INCOMPLETE_OBJECT_STORE_REPORT',
      );
    }
  }

  const size =
    values.get('size')!;

  const sizePack =
    values.get('size-pack')!;

  const garbage =
    values.get('garbage')!;

  const sizeGarbage =
    values.get('size-garbage')!;

  if (
    !Number.isSafeInteger(size) ||
    !Number.isSafeInteger(sizePack) ||
    !Number.isSafeInteger(garbage) ||
    !Number.isSafeInteger(sizeGarbage)
  ) {
    throw new Error(
      'PAIR_EVIDENCE_INVALID_OBJECT_STORE_REPORT',
    );
  }

  if (
    garbage !== 0 ||
    sizeGarbage !== 0
  ) {
    throw new Error(
      'PAIR_EVIDENCE_OBJECT_STORE_GARBAGE_REJECTED',
    );
  }

  return {
    objectKiB:
      size + sizePack,

    garbageKiB:
      sizeGarbage,
  };
}

async function objectStoreUsage(
  runner: GitProcessRunner,
  prefix: readonly string[],
  bareRepositoryPath: string,
  timeoutMs: number,
  maxOutputBytes: number,
): Promise<ObjectStoreUsage> {
  const report =
    await runText(
      runner,
      prefix,
      bareRepositoryPath,
      [
        'count-objects',
        '-v',
      ],
      timeoutMs,
      maxOutputBytes,
    );

  return parseObjectStoreUsage(
    report,
  );
}

async function assertHydrationGrowthWithinBound(
  runner: GitProcessRunner,
  prefix: readonly string[],
  bareRepositoryPath: string,
  timeoutMs: number,
  maxOutputBytes: number,
  baselineObjectKiB: number,
  maxGrowthKiB: number,
): Promise<void> {
  const current =
    await objectStoreUsage(
      runner,
      prefix,
      bareRepositoryPath,
      timeoutMs,
      maxOutputBytes,
    );

  const growthKiB =
    current.objectKiB -
    baselineObjectKiB;

  if (growthKiB < 0) {
    throw new Error(
      'PAIR_EVIDENCE_OBJECT_STORE_SHRANK_UNEXPECTEDLY',
    );
  }

  if (
    growthKiB >
    maxGrowthKiB
  ) {
    throw new Error(
      [
        'PAIR_EVIDENCE_OBJECT_STORE_GROWTH_LIMIT_EXCEEDED',
        String(growthKiB),
        String(maxGrowthKiB),
      ].join(':'),
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
      detectedSpdxId: null,
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
      detectedSpdxId: null,
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

  await hydrateExactBlob(
    runner,
    prefix,
    bareRepositoryPath,
    match[2],
    timeoutMs,
    maxMetadataBytes,
  );

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

  const detectedLicense =
    detectReviewEligibleSpdxLicense(
      strictUtf8(
        blob,
      ),
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

    detectedSpdxId:
      detectedLicense
        .spdxId,
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
    !REPOSITORY.test(
      request.repository,
    )
  ) {
    throw new Error(
      'PAIR_EVIDENCE_INVALID_REPOSITORY',
    );
  }

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

  const maxHydrationObjectStoreGrowthKiB =
    request
      .maxHydrationObjectStoreGrowthKiB ??
    Math.ceil(
      maxDiffBytes / 1024,
    );

  if (
    !Number.isSafeInteger(
      maxHydrationObjectStoreGrowthKiB,
    ) ||
    maxHydrationObjectStoreGrowthKiB <= 0
  ) {
    throw new Error(
      'PAIR_EVIDENCE_INVALID_OBJECT_STORE_GROWTH_LIMIT',
    );
  }

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

  const resolvedOrigin =
    await runText(
      runner,
      prefix,
      request.bareRepositoryPath,
      [
        'remote',
        'get-url',
        'origin',
      ],
      timeoutMs,
      maxMetadataBytes,
    );

  if (
    resolvedOrigin !==
    canonicalRemote(
      request.repository,
    )
  ) {
    throw new Error(
      'PAIR_EVIDENCE_ORIGIN_MISMATCH',
    );
  }

  await assertLocalNetworkConfigSafe(
    runner,
    prefix,
    request.bareRepositoryPath,
    timeoutMs,
    maxMetadataBytes,
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

  /*
   * Bound the network phase before requesting any missing blob.
   */
  if (
    changedFiles.length >
    maxChangedFiles
  ) {
    throw new Error(
      'PAIR_EVIDENCE_CHANGED_FILE_LIMIT_EXCEEDED',
    );
  }

  const rawChangedBytes =
    await runBytes(
      runner,
      prefix,
      request.bareRepositoryPath,
      [
        'diff-tree',
        '-r',
        '--raw',
        '-z',
        '--no-abbrev',
        '--no-renames',

        request.vulnerableCommitSha,
        request.fixedCommitSha,

        '--',
      ],
      timeoutMs,
      maxMetadataBytes,
    );

  const rawChangedRecords =
    parseRawChangedBlobRecords(
      rawChangedBytes,
    );

  if (
    !sameChangedPaths(
      changedFiles,
      rawChangedRecords,
    )
  ) {
    throw new Error(
      'PAIR_EVIDENCE_RAW_DIFF_PATH_MISMATCH',
    );
  }

  const changedBlobObjectIds =
    [
      ...new Set(
        rawChangedRecords
          .flatMap(
            (record) => [
              record.oldObjectId,
              record.newObjectId,
            ],
          )
          .filter(
            (
              objectId,
            ): objectId is string =>
              objectId !== null,
          ),
      ),
    ];

  if (
    changedBlobObjectIds.length >
    maxChangedFiles * 2
  ) {
    throw new Error(
      'PAIR_EVIDENCE_BLOB_OBJECT_LIMIT_EXCEEDED',
    );
  }

  const hydrationBaseline =
    await objectStoreUsage(
      runner,
      prefix,
      request.bareRepositoryPath,
      timeoutMs,
      maxMetadataBytes,
    );

  const hydrationBaselineObjectKiB =
    hydrationBaseline.objectKiB;

  for (
    const objectId of
    changedBlobObjectIds
  ) {
    await hydrateExactBlob(
      runner,
      prefix,
      request.bareRepositoryPath,
      objectId,
      timeoutMs,
      maxMetadataBytes,
    );

    await assertHydrationGrowthWithinBound(
      runner,
      prefix,
      request.bareRepositoryPath,
      timeoutMs,
      maxMetadataBytes,
      hydrationBaselineObjectKiB,
      maxHydrationObjectStoreGrowthKiB,
    );
  }

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

  await assertHydrationGrowthWithinBound(
    runner,
    prefix,
    request.bareRepositoryPath,
    timeoutMs,
    maxMetadataBytes,
    hydrationBaselineObjectKiB,
    maxHydrationObjectStoreGrowthKiB,
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

  await assertHydrationGrowthWithinBound(
    runner,
    prefix,
    request.bareRepositoryPath,
    timeoutMs,
    maxMetadataBytes,
    hydrationBaselineObjectKiB,
    maxHydrationObjectStoreGrowthKiB,
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
