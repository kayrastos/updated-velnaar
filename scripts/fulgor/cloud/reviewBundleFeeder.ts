import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';

import {
  lstat,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';

import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { TextDecoder } from 'node:util';

import type {
  FulgorAutomationJob,
} from '../automation/types';

import {
  verifyWhiteCloudAdmission,
} from './reviewBundleAdmission';

const HEX40 = /^[0-9a-f]{40}$/i;
const SAFE_PATH = /^[A-Za-z0-9._/-]+$/;

const DEFAULT_MAX_BYTES = 200 * 1024;
const DEFAULT_STABILITY_MS = 30_000;

export interface ReviewBundleFeederStore {
  snapshot(): Promise<{
    jobs: Array<{
      job: {
        jobId: string;
      };
    }>;
  }>;

  enqueue(
    job: FulgorAutomationJob,
  ): Promise<void>;
}

export interface ReviewBundleFeederOptions {
  bundleRoot: string;
  repoRoot: string;
  notBeforeMs: number;

  maxEnqueuePerScan?: number;
  maxSnapshotBytes?: number;
  stabilityWindowMs?: number;
}

export interface ReviewBundleFeederSummary {
  scanned: number;
  eligible: number;
  enqueued: number;
  duplicateSkipped: number;
  oldSkipped: number;
  unstableSkipped: number;
  refused: number;
}

export interface ReviewBundleGitDependencies {
  now(): number;

  commitExists(
    repo: string,
    commit: string,
  ): Promise<boolean>;

  pathExistsAtCommit(
    repo: string,
    commit: string,
    relative: string,
  ): Promise<boolean>;

  dryRunApply(
    repo: string,
    commit: string,
    patch: string,
  ): Promise<boolean>;
}

interface ReviewManifest {
  packageId: string;
  role: string;
  head: string;
  createdAt: string;
  purpose: string;

  paths: Array<{
    status: '??';
    path: string;
  }>;

  autoCommit: false;
  autoPush: false;
  autoMerge: false;
  deploy: false;
}

interface LoadedManifest {
  manifest: ReviewManifest;
  raw: string;
  manifestPath: string;
}

function sha256(
  value: string | Buffer,
): string {
  return createHash('sha256')
    .update(value)
    .digest('hex');
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function requiredString(
  value: unknown,
): string | null {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0
  ) {
    return null;
  }

  return value;
}

function safeRepoPath(
  value: string,
): string | null {
  const normalized =
    value.replace(/\\/g, '/');

  if (
    normalized.length === 0 ||
    !SAFE_PATH.test(normalized) ||
    path.posix.isAbsolute(normalized) ||
    path.win32.isAbsolute(normalized)
  ) {
    return null;
  }

  const parts =
    normalized.split('/');

  if (
    parts.some(
      (part) =>
        part.length === 0 ||
        part === '.' ||
        part === '..',
    )
  ) {
    return null;
  }

  return normalized;
}

async function safeFile(
  root: string,
  relative: string,
): Promise<string> {
  const normalized =
    safeRepoPath(relative);

  if (!normalized) {
    throw new Error('UNSAFE_PATH');
  }

  const rootInfo =
    await lstat(root);

  if (
    rootInfo.isSymbolicLink() ||
    !rootInfo.isDirectory()
  ) {
    throw new Error('UNSAFE_ROOT');
  }

  const rootReal =
    await realpath(root);

  let current =
    rootReal;

  for (
    const part of
    normalized.split('/')
  ) {
    current =
      path.join(
        current,
        part,
      );

    const info =
      await lstat(current);

    if (info.isSymbolicLink()) {
      throw new Error(
        'SYMLINK_REFUSED',
      );
    }
  }

  const resolved =
    await realpath(current);

  const relation =
    path.relative(
      rootReal,
      resolved,
    );

  if (
    relation === '..' ||
    relation.startsWith(
      `..${path.sep}`,
    ) ||
    path.isAbsolute(relation)
  ) {
    throw new Error(
      'PATH_ESCAPE',
    );
  }

  const info =
    await lstat(resolved);

  if (!info.isFile()) {
    throw new Error(
      'NOT_REGULAR_FILE',
    );
  }

  return resolved;
}

async function countFiles(
  root: string,
): Promise<number> {
  let total = 0;

  const entries =
    await readdir(
      root,
      {
        withFileTypes: true,
      },
    );

  for (const entry of entries) {
    const candidate =
      path.join(
        root,
        entry.name,
      );

    if (entry.isSymbolicLink()) {
      throw new Error(
        'BUNDLE_SYMLINK_REFUSED',
      );
    }

    if (entry.isDirectory()) {
      total +=
        await countFiles(
          candidate,
        );

      continue;
    }

    if (!entry.isFile()) {
      throw new Error(
        'UNSUPPORTED_ENTRY',
      );
    }

    total += 1;
  }

  return total;
}

function parseManifest(
  input: unknown,
): ReviewManifest | null {
  if (!isRecord(input)) {
    return null;
  }

  const packageId =
    requiredString(
      input.packageId,
    );

  const role =
    requiredString(
      input.role,
    );

  const head =
    requiredString(
      input.head,
    );

  const createdAt =
    requiredString(
      input.createdAt,
    );

  const purpose =
    requiredString(
      input.purpose,
    );

  if (
    !packageId ||
    !role ||
    !head ||
    !createdAt ||
    !purpose ||
    !HEX40.test(head)
  ) {
    return null;
  }

  if (
    input.autoCommit !== false ||
    input.autoPush !== false ||
    input.autoMerge !== false ||
    input.deploy !== false
  ) {
    return null;
  }

  if (
    !Array.isArray(input.paths) ||
    input.paths.length !== 1
  ) {
    return null;
  }

  const item =
    input.paths[0];

  if (
    !isRecord(item) ||
    item.status !== '??' ||
    typeof item.path !== 'string'
  ) {
    return null;
  }

  const relative =
    safeRepoPath(
      item.path,
    );

  if (
    !relative ||
    !relative.startsWith(
      'tests/',
    )
  ) {
    return null;
  }

  if (
    role ===
    'fulgor-verification'
  ) {
    return null;
  }

  if (
    !Number.isFinite(
      Date.parse(createdAt),
    )
  ) {
    return null;
  }

  return {
    packageId,
    role,
    head:
      head.toLowerCase(),
    createdAt,
    purpose,

    paths: [
      {
        status: '??',
        path:
          relative,
      },
    ],

    autoCommit: false,
    autoPush: false,
    autoMerge: false,
    deploy: false,
  };
}

async function loadManifest(
  bundle: string,
): Promise<LoadedManifest> {
  const manifestPath =
    await safeFile(
      bundle,
      'manifest.json',
    );

  const raw =
    await readFile(
      manifestPath,
      'utf8',
    );

  const manifest =
    parseManifest(
      JSON.parse(raw),
    );

  if (!manifest) {
    throw new Error(
      'INVALID_MANIFEST',
    );
  }

  return {
    manifest,
    raw,
    manifestPath,
  };
}

function normalizedLines(
  value: string,
): string[] {
  const lines =
    value
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n');

  if (
    lines.length > 0 &&
    lines[
      lines.length - 1
    ] === ''
  ) {
    lines.pop();
  }

  if (lines.length === 0) {
    throw new Error(
      'EMPTY_SNAPSHOT',
    );
  }

  return lines;
}

function newFilePatch(
  relative: string,
  lines: readonly string[],
): string {
  return [
    `diff --git a/${relative} b/${relative}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${relative}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map(
      (line) =>
        `+${line}`,
    ),
    '',
  ].join('\n');
}

function git(
  repo: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv =
    process.env,
): Promise<string> {
  return new Promise(
    (resolve, reject) => {
      execFile(
        'git',
        [
          '-C',
          repo,
          ...args,
        ],
        {
          windowsHide: true,
          encoding: 'utf8',
          maxBuffer:
            4 * 1024 * 1024,
          env,
        },
        (
          error,
          stdout,
        ) => {
          if (error) {
            reject(error);
            return;
          }

          resolve(
            String(stdout),
          );
        },
      );
    },
  );
}

const productionGit:
ReviewBundleGitDependencies = {
  now:
    () =>
      Date.now(),

  commitExists:
    async (
      repo,
      commit,
    ) => {
      try {
        await git(
          repo,
          [
            'cat-file',
            '-e',
            `${commit}^{commit}`,
          ],
        );

        return true;
      } catch {
        return false;
      }
    },

  pathExistsAtCommit:
    async (
      repo,
      commit,
      relative,
    ) => {
      const output =
        await git(
          repo,
          [
            'ls-tree',
            '-r',
            '--name-only',
            commit,
            '--',
            relative,
          ],
        );

      return (
        output.trim().length > 0
      );
    },

  dryRunApply:
    async (
      repo,
      commit,
      patch,
    ) => {
      const temp =
        await mkdtemp(
          path.join(
            tmpdir(),
            'fulgor-feed-',
          ),
        );

      const patchPath =
        path.join(
          temp,
          'candidate.patch',
        );

      const indexPath =
        path.join(
          temp,
          'index',
        );

      try {
        await writeFile(
          patchPath,
          patch,
          'utf8',
        );

        const env = {
          ...process.env,
          GIT_INDEX_FILE:
            indexPath,
        };

        await git(
          repo,
          [
            'read-tree',
            commit,
          ],
          env,
        );

        await git(
          repo,
          [
            'apply',
            '--cached',
            '--check',
            '--whitespace=nowarn',
            patchPath,
          ],
          env,
        );

        return true;
      } catch {
        return false;
      } finally {
        await rm(
          temp,
          {
            recursive: true,
            force: true,
          },
        );
      }
    },
};

async function buildJob(
  bundle: string,
  loaded: LoadedManifest,
  options: {
    repoRoot: string;
    maxSnapshotBytes: number;
    stabilityWindowMs: number;
  },
  dependencies:
    ReviewBundleGitDependencies,
): Promise<FulgorAutomationJob> {
  const manifest =
    loaded.manifest;

  const relative =
    manifest.paths[0].path;

  const bundleFileCount =
    await countFiles(bundle);

  if (
    bundleFileCount !== 4 &&
    bundleFileCount !== 5
  ) {
    throw new Error(
      'UNSUPPORTED_FILE_COUNT',
    );
  }

  let trackedPatchPath:
    string | null =
      null;

  try {
    trackedPatchPath =
      await safeFile(
        bundle,
        'tracked.patch',
      );
  } catch {
    if (bundleFileCount === 5) {
      throw new Error(
        'EXPECTED_TRACKED_PATCH_MISSING',
      );
    }
  }

  if (trackedPatchPath) {
    const trackedPatch =
      await readFile(
        trackedPatchPath,
        'utf8',
      );

    if (
      trackedPatch.trim().length !==
      0
    ) {
      throw new Error(
        'TRACKED_PATCH_NOT_SUPPORTED',
      );
    }
  }

  const statusPath =
    await safeFile(
      bundle,
      'git-status.txt',
    );

  const statusText =
    await readFile(
      statusPath,
      'utf8',
    );

  const statusLines =
    statusText
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .filter(
        (line) =>
          line.length > 0,
      );

  if (
    statusLines.length !== 1 ||
    statusLines[0] !==
      `?? ${relative}`
  ) {
    throw new Error(
      'STATUS_BINDING_INVALID',
    );
  }

  const admissionPath =
    await safeFile(
      bundle,
      'fulgor-admission.json',
    );

  const snapshotPath =
    await safeFile(
      bundle,
      `files/${relative}`,
    );

  const [
    manifestInfo,
    statusInfo,
    admissionInfo,
    snapshotInfo,
  ] =
    await Promise.all([
      stat(
        loaded.manifestPath,
      ),
      stat(
        statusPath,
      ),
      stat(
        admissionPath,
      ),
      stat(
        snapshotPath,
      ),
    ]);

  const newest =
    Math.max(
      manifestInfo.mtimeMs,
      statusInfo.mtimeMs,
      admissionInfo.mtimeMs,
      snapshotInfo.mtimeMs,
    );

  if (
    dependencies.now() -
      newest <
    options.stabilityWindowMs
  ) {
    throw new Error(
      'BUNDLE_NOT_STABLE',
    );
  }

  if (
    snapshotInfo.size <= 0 ||
    snapshotInfo.size >
      options.maxSnapshotBytes
  ) {
    throw new Error(
      'SNAPSHOT_SIZE_INVALID',
    );
  }

  const bytes =
    await readFile(
      snapshotPath,
    );

  if (bytes.includes(0)) {
    throw new Error(
      'NUL_PAYLOAD_REFUSED',
    );
  }

  const manifestSha =
    sha256(
      loaded.raw,
    );

  const snapshotSha =
    sha256(
      bytes,
    );

  let admissionRaw:
    unknown;

  try {
    admissionRaw =
      JSON.parse(
        await readFile(
          admissionPath,
          'utf8',
        ),
      );
  } catch {
    throw new Error(
      'INVALID_ADMISSION_JSON',
    );
  }

  verifyWhiteCloudAdmission(
    admissionRaw,
    {
      packageId:
        manifest.packageId,

      manifestSha256:
        manifestSha,

      snapshotSha256:
        snapshotSha,
    },
  );

  let text: string;

  try {
    text =
      new TextDecoder(
        'utf-8',
        {
          fatal: true,
        },
      ).decode(bytes);
  } catch {
    throw new Error(
      'INVALID_UTF8',
    );
  }

  const lines =
    normalizedLines(
      text,
    );

  if (lines.length > 500) {
    throw new Error(
      'CHANGED_LINE_LIMIT_EXCEEDED',
    );
  }

  const patch =
    newFilePatch(
      relative,
      lines,
    );

  if (
    !await dependencies
      .commitExists(
        options.repoRoot,
        manifest.head,
      )
  ) {
    throw new Error(
      'BASELINE_MISSING',
    );
  }

  if (
    await dependencies
      .pathExistsAtCommit(
        options.repoRoot,
        manifest.head,
        relative,
      )
  ) {
    throw new Error(
      'BASELINE_PATH_CONFLICT',
    );
  }

  if (
    !await dependencies
      .dryRunApply(
        options.repoRoot,
        manifest.head,
        patch,
      )
  ) {
    throw new Error(
      'DRY_RUN_APPLY_FAILED',
    );
  }

  const identity =
    sha256(
      [
        manifest.packageId,
        manifestSha,
        relative,
        snapshotSha,
      ].join('\0'),
    );

  return {
    jobId:
      `RB-${identity.slice(0, 32)}`,

    problem:
      manifest.purpose,

    diagnosis:
      'One new test file is declared under the bounded tests/ scope against a pinned baseline.',

    plan:
      'Verify only the declared test-file candidate and its stated purpose.',

    candidate: {
      blindedId:
        `blind-${identity.slice(32, 56)}`,

      patch,

      canonicalDiffSummary:
        [
          `new test file ${relative}`,
          '1 file',
          '1 hunk',
          `${lines.length} added lines`,
          `snapshot sha256 ${snapshotSha}`,
        ].join('; '),
    },

    staticGatePolicy: {
      allowedScope: [
        'tests',
      ],

      forbiddenPaths: [
        'tests/secrets',
      ],

      maxFiles: 1,
      maxHunks: 1,
      maxChangedLines:
        lines.length,
    },

    dryRunApplySucceeded:
      true,
  };
}

export async function scanReviewBundlesOnce(
  options: ReviewBundleFeederOptions,
  store: ReviewBundleFeederStore,
  dependencies:
    ReviewBundleGitDependencies =
      productionGit,
): Promise<ReviewBundleFeederSummary> {
  const maxEnqueue =
    options.maxEnqueuePerScan ??
    1;

  const maxBytes =
    options.maxSnapshotBytes ??
    DEFAULT_MAX_BYTES;

  const stabilityMs =
    options.stabilityWindowMs ??
    DEFAULT_STABILITY_MS;

  if (
    !Number.isFinite(
      options.notBeforeMs,
    ) ||
    !Number.isInteger(
      maxEnqueue,
    ) ||
    maxEnqueue < 1 ||
    maxEnqueue > 4 ||
    !Number.isSafeInteger(
      maxBytes,
    ) ||
    maxBytes <= 0 ||
    !Number.isSafeInteger(
      stabilityMs,
    ) ||
    stabilityMs < 0
  ) {
    throw new Error(
      'INVALID_FEEDER_CONFIG',
    );
  }

  const rootInfo =
    await lstat(
      options.bundleRoot,
    );

  if (
    rootInfo.isSymbolicLink() ||
    !rootInfo.isDirectory()
  ) {
    throw new Error(
      'INVALID_BUNDLE_ROOT',
    );
  }

  const entries =
    await readdir(
      options.bundleRoot,
      {
        withFileTypes: true,
      },
    );

  const dirs =
    entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          !entry.isSymbolicLink(),
      )
      .map(
        (entry) =>
          path.join(
            options.bundleRoot,
            entry.name,
          ),
      )
      .sort()
      .reverse();

  const snapshot =
    await store.snapshot();

  const known =
    new Set(
      snapshot.jobs.map(
        (record) =>
          record.job.jobId,
      ),
    );

  const result:
  ReviewBundleFeederSummary = {
    scanned: 0,
    eligible: 0,
    enqueued: 0,
    duplicateSkipped: 0,
    oldSkipped: 0,
    unstableSkipped: 0,
    refused: 0,
  };

  for (const bundle of dirs) {
    if (
      result.enqueued >=
      maxEnqueue
    ) {
      break;
    }

    result.scanned += 1;

    try {
      const loaded =
        await loadManifest(
          bundle,
        );

      if (
        Date.parse(
          loaded.manifest.createdAt,
        ) <
        options.notBeforeMs
      ) {
        result.oldSkipped += 1;
        continue;
      }

      let job:
        FulgorAutomationJob;

      try {
        job =
          await buildJob(
            bundle,
            loaded,
            {
              repoRoot:
                options.repoRoot,
              maxSnapshotBytes:
                maxBytes,
              stabilityWindowMs:
                stabilityMs,
            },
            dependencies,
          );
      } catch (error) {
        if (
          error instanceof Error &&
          error.message ===
            'BUNDLE_NOT_STABLE'
        ) {
          result.unstableSkipped += 1;
          continue;
        }

        throw error;
      }

      result.eligible += 1;

      if (
        known.has(
          job.jobId,
        )
      ) {
        result.duplicateSkipped += 1;
        continue;
      }

      await store.enqueue(job);

      known.add(
        job.jobId,
      );

      result.enqueued += 1;
    } catch {
      result.refused += 1;
    }
  }

  return result;
}