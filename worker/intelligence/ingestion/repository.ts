import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { immutableCopy } from '../contracts/validators';
import {
  fail,
  hash,
  canonical,
  dataObject,
  detachJson,
  identifier,
  opaqueCaseId,
  sourcePath,
  INGESTION_LIMITS,
  captureSnapshot,
  validateSnapshot,
  type SourceSnapshot,
} from './snapshot';

export const MAX_METADATA_BYTES = 4096;
export const MAX_PACKED_REFS_BYTES = 64 * 1024;
export const MAX_PACK_INDEX_BYTES = 4 * 1024 * 1024;

const MAX_GIT_INDEX_BYTES = Math.max(64 * 1024, INGESTION_LIMITS.maxFiles * 512);
const MAX_OBJECT_TOP_LEVEL_ENTRIES = 300;
const MAX_REF_ENTRIES = 128;
const MAX_OBJECT_METADATA_ENTRIES = 256;
const MAX_PACK_ENTRIES = 128;
const MAX_LOOSE_OBJECT_ENTRIES = 4096;
const MAX_MATERIALIZED_GIT_FILES = MAX_LOOSE_OBJECT_ENTRIES + MAX_REF_ENTRIES + MAX_PACK_ENTRIES + 64;
const MAX_MATERIALIZED_GIT_BYTES = Math.max(128 * 1024 * 1024, INGESTION_LIMITS.maxSnapshotBytes * 32);
const MAX_PACK_DATA_BYTES = Math.min(MAX_MATERIALIZED_GIT_BYTES, Math.max(64 * 1024 * 1024, INGESTION_LIMITS.maxSnapshotBytes * 16));

const TRUSTED_STAGING_ROOT_ENV = 'VELNAR_M4_TRUSTED_STAGING_ROOT';

interface SourceGitLayout {
  readonly root: string;
  readonly gitDir: string;
  readonly commonDir: string;
}

interface TrustedGitContext {
  readonly sourceRoot: string;
  readonly trustedStagingRoot: string;
  readonly trustedStagingRootIdentity: fs.Stats;
  readonly sourceRootIdentity: fs.Stats;
  readonly sourceDotGitIdentity: fs.Stats;
  readonly tempRoot: string;
  readonly gitDir: string;
  readonly gitExecutable: string;
  readonly expectedCommitSha: string;
}

interface TrustedStagingBinding {
  readonly trustedStagingRoot: string;
  readonly trustedStagingRootIdentity: fs.Stats;
  readonly sourceRootIdentity: fs.Stats;
}

interface MaterializationBudget {
  files: number;
  bytes: number;
}

function isNetworkOrDevicePath(raw: string): boolean {
  const value = raw.trim().replace(/\//g, '\\');
  return value.startsWith('\\\\') || /^\\\?\?\\/i.test(value) || /^\\GLOBALROOT\\/i.test(value);
}

function normalizeLocalRepositoryPath(raw: string): string {
  if (typeof raw !== 'string' || raw.length === 0 || isNetworkOrDevicePath(raw)) {
    return fail('network/device-qualified repository path refused');
  }
  const resolved = path.resolve(raw);
  if (isNetworkOrDevicePath(resolved)) return fail('network/device-qualified repository path refused');
  return resolved;
}

function lstatOptional(target: string): fs.Stats | null {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'ENOENT') return null;
    throw error;
  }
}

function sameFileIdentity(a: fs.Stats, b: fs.Stats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.isDirectory() === b.isDirectory() && a.isFile() === b.isFile();
}

function bindTrustedStagingRepository(root: string): TrustedStagingBinding {
  /*
   * V1 security contract:
   * - the host provisions VELNAR_M4_TRUSTED_STAGING_ROOT;
   * - it is local, VELNAR-controlled, and not writable by the repository submitter;
   * - it remains quiescent from staging handoff through authority mint.
   *
   * M4 intentionally refuses arbitrary live/mutable repository paths. Defending
   * against a hostile same-user process that can mutate this trusted staging root
   * requires an OS/native snapshot or handle-relative acquisition layer and is out
   * of the V1 bounded-local-ingestion scope.
   */
  const rawStagingRoot = process.env[TRUSTED_STAGING_ROOT_ENV];
  if (typeof rawStagingRoot !== 'string' || rawStagingRoot.trim().length === 0) {
    return fail('trusted staging root not configured');
  }
  if (isNetworkOrDevicePath(rawStagingRoot)) {
    return fail('network/device-qualified trusted staging root refused');
  }

  const stagingRoot = path.resolve(rawStagingRoot);
  if (isNetworkOrDevicePath(stagingRoot)) {
    return fail('network/device-qualified trusted staging root refused');
  }

  refusePathLinks(stagingRoot);
  const stagingRootIdentity = lstatOptional(stagingRoot);
  if (
    stagingRootIdentity === null ||
    stagingRootIdentity.isSymbolicLink() ||
    !stagingRootIdentity.isDirectory()
  ) {
    return fail('trusted staging root is not a trusted local directory');
  }

  const relative = path.relative(stagingRoot, root);
  if (
    relative.length === 0 ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    return fail('repository path outside trusted staging root');
  }

  refusePathLinks(root);
  const sourceRootIdentity = lstatOptional(root);
  if (
    sourceRootIdentity === null ||
    sourceRootIdentity.isSymbolicLink() ||
    !sourceRootIdentity.isDirectory()
  ) {
    return fail('repository root is not a trusted staged directory');
  }

  const stagingReal = fs.realpathSync.native(stagingRoot);
  const sourceReal = fs.realpathSync.native(root);
  if (!isPathWithin(stagingReal, sourceReal) || stagingReal === sourceReal) {
    return fail('repository path outside trusted staging root');
  }

  return {
    trustedStagingRoot: stagingReal,
    trustedStagingRootIdentity: stagingRootIdentity,
    sourceRootIdentity,
  };
}

function isPathWithin(base: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(base), path.resolve(candidate));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export function refusePathLinks(target: string): void {
  if (isNetworkOrDevicePath(target)) fail('network/device-qualified path refused');
  const full = path.resolve(target);
  if (isNetworkOrDevicePath(full)) fail('network/device-qualified path refused');
  const parsed = path.parse(full);
  let current = parsed.root;
  for (const part of full.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = lstatOptional(current);
    if (stat === null) break;
    if (stat.isSymbolicLink()) fail('symlink/junction refused');
  }
}

export function readBoundedMetadataFile(filePath: string, maxBytes = MAX_METADATA_BYTES): string {
  refusePathLinks(filePath);
  const stat = lstatOptional(filePath);
  if (stat === null) return fail('metadata file missing');
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1) fail('nonregular/linked metadata refused');
  if (stat.size === 0 || stat.size > maxBytes) fail('metadata size boundary');

  const fd = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const opened = fs.fstatSync(fd);
    if (opened.size !== stat.size || !opened.isFile() || opened.nlink !== 1) fail('metadata file replaced during read');
    const buffer = Buffer.alloc(stat.size);
    const count = fs.readSync(fd, buffer, 0, buffer.length, 0);
    if (count !== stat.size) fail('metadata read length mismatch');
    const after = fs.fstatSync(fd);
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) fail('metadata file changed during read');
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer);
  } finally {
    fs.closeSync(fd);
  }
}

function assertBoundedRegularMetadata(filePath: string, maxBytes: number, label: string): void {
  refusePathLinks(filePath);
  const stat = lstatOptional(filePath);
  if (stat === null) return;
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1) fail(`${label} is not trusted regular metadata`);
  if (stat.size > maxBytes) fail(`${label} exceeds metadata size boundary`);
}

function readBoundedDirectoryEntries(dirPath: string, maxEntries: number, label: string): fs.Dirent[] {
  refusePathLinks(dirPath);
  const stat = lstatOptional(dirPath);
  if (stat === null || stat.isSymbolicLink() || !stat.isDirectory()) return fail(`${label} is not a trusted directory`);

  const handle = fs.opendirSync(dirPath);
  const entries: fs.Dirent[] = [];
  try {
    while (true) {
      const entry = handle.readSync();
      if (entry === null) break;
      if (entries.length >= maxEntries) fail(`${label} entry limit exceeded`);
      entries.push(entry);
    }
  } finally {
    handle.closeSync();
  }
  return entries;
}

function rejectPresentPath(target: string, message: string): void {
  refusePathLinks(target);
  if (lstatOptional(target) !== null) fail(message);
}

function rejectConfigPolicy(configPath: string): void {
  refusePathLinks(configPath);
  if (lstatOptional(configPath) === null) return;
  const content = readBoundedMetadataFile(configPath, MAX_METADATA_BYTES);

  if (/\[\s*include(?:if)?(?:\s+[^\]]*)?\s*\]/i.test(content)) fail('Git config include refused');
  if (/\bworktreeConfig\s*=\s*(?:true|yes|on|1)\b/i.test(content)) fail('Git worktree config mode refused');
  if (/\b(?:worktree|refStorage)\s*=/i.test(content)) fail('Git core.worktree/ref storage config refused');
  if (/\[\s*extensions(?:\s+[^\]]*)?\s*\]/i.test(content)) fail('Git repository extensions refused in V1');
}

function validateGitRefName(refName: string): void {
  if (
    !/^refs\/[A-Za-z0-9._\/-]+$/.test(refName) ||
    refName.includes('..') ||
    refName.includes('//') ||
    refName.endsWith('/') ||
    refName.endsWith('.lock') ||
    refName.includes('\\')
  ) fail('unsupported Git symbolic ref');
}

function readLooseRef(baseDir: string, refName: string): string | null {
  validateGitRefName(refName);
  const refPath = path.join(baseDir, ...refName.split('/'));
  if (!isPathWithin(baseDir, refPath)) fail('Git ref path escapes root');
  refusePathLinks(refPath);
  if (lstatOptional(refPath) === null) return null;
  const value = readBoundedMetadataFile(refPath, MAX_METADATA_BYTES).trim();
  if (!/^[a-f0-9]{40}$/.test(value) || /^0+$/.test(value)) fail('unsupported Git loose ref identity');
  return value;
}

function readPackedRef(packedRefsPath: string, refName: string): string | null {
  refusePathLinks(packedRefsPath);
  if (lstatOptional(packedRefsPath) === null) return null;
  const content = readBoundedMetadataFile(packedRefsPath, MAX_PACKED_REFS_BYTES);

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#') || line.startsWith('^')) continue;
    const separator = line.indexOf(' ');
    if (separator <= 0) fail('malformed Git packed-refs');
    const sha = line.slice(0, separator);
    const name = line.slice(separator + 1).trim();
    if (!/^[a-f0-9]{40}$/.test(sha) || /^0+$/.test(sha)) fail('malformed Git packed-refs identity');
    if (name === refName) return sha;
  }
  return null;
}

function resolveSourceHeadClaim(layout: SourceGitLayout): string {
  const head = readBoundedMetadataFile(path.join(layout.gitDir, 'HEAD'), MAX_METADATA_BYTES).trim();
  if (/^[a-f0-9]{40}$/.test(head) && !/^0+$/.test(head)) return head;

  const match = /^ref:\s*(refs\/[^\r\n]+)$/.exec(head);
  if (!match) return fail('unsupported Git HEAD metadata');
  const refName = match[1].trim();
  validateGitRefName(refName);

  for (const base of Array.from(new Set([layout.gitDir, layout.commonDir]))) {
    const loose = readLooseRef(base, refName);
    if (loose !== null) return loose;
  }

  const packed = readPackedRef(path.join(layout.commonDir, 'packed-refs'), refName);
  if (packed !== null) return packed;
  return fail('Git HEAD ref cannot be resolved locally');
}

function resolveSourceGitLayout(root: string): SourceGitLayout {
  refusePathLinks(root);
  const rootStat = lstatOptional(root);
  if (rootStat === null || rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    return fail('repository root is not a trusted local directory');
  }

  const dotGitPath = path.join(root, '.git');
  refusePathLinks(dotGitPath);
  const dotGitStat = lstatOptional(dotGitPath);
  if (dotGitStat === null) return fail('repository .git not found');
  if (dotGitStat.isSymbolicLink()) return fail('symlink/junction refused');

  let gitDir: string;
  let commonDir: string;

  if (dotGitStat.isDirectory()) {
    gitDir = dotGitPath;
    rejectPresentPath(path.join(gitDir, 'commondir'), 'Git commondir in directory repository refused');
    commonDir = gitDir;
  } else if (dotGitStat.isFile()) {
    // V1 deliberately refuses gitfile/linked-worktree layouts. Supporting them safely
    // requires preserving Git's split per-worktree/common ref semantics and expands the
    // mutable namespace that must be acquired atomically.
    return fail('Git file/linked-worktree repositories refused in V1');
  } else {
    return fail('invalid .git entry');
  }

  rejectConfigPolicy(path.join(commonDir, 'config'));

  for (const target of Array.from(new Set([path.join(gitDir, 'config.worktree'), path.join(commonDir, 'config.worktree')]))) {
    rejectPresentPath(target, 'Git config.worktree refused');
  }
  for (const target of Array.from(new Set([path.join(gitDir, 'shallow'), path.join(commonDir, 'shallow')]))) {
    rejectPresentPath(target, 'Git shallow repository metadata refused in V1');
  }
  for (const target of Array.from(new Set([path.join(gitDir, 'info', 'grafts'), path.join(commonDir, 'info', 'grafts')]))) {
    rejectPresentPath(target, 'Git graft metadata refused in V1');
  }
  for (const target of Array.from(new Set([path.join(gitDir, 'reftable'), path.join(commonDir, 'reftable')]))) {
    rejectPresentPath(target, 'Git reftable storage refused in V1');
  }

  const headPath = path.join(gitDir, 'HEAD');
  assertBoundedRegularMetadata(headPath, MAX_METADATA_BYTES, 'Git HEAD');
  if (lstatOptional(headPath) === null) return fail('Git HEAD metadata missing');
  assertBoundedRegularMetadata(path.join(gitDir, 'index'), MAX_GIT_INDEX_BYTES, 'Git index');
  assertBoundedRegularMetadata(path.join(commonDir, 'packed-refs'), MAX_PACKED_REFS_BYTES, 'Git packed-refs');

  return { root, gitDir, commonDir };
}

let trustedGitExecutable: string | null = null;

function resolveTrustedGitExecutable(): string {
  if (trustedGitExecutable !== null) return trustedGitExecutable;

  const pathValue = Object.entries(process.env).find(([key]) => key.toUpperCase() === 'PATH')?.[1] || '';
  const executableName = process.platform === 'win32' ? 'git.exe' : 'git';

  for (const rawDirectory of pathValue.split(path.delimiter)) {
    const directory = rawDirectory.trim().replace(/^"(.*)"$/, '$1');
    if (directory.length === 0 || !path.isAbsolute(directory) || isNetworkOrDevicePath(directory)) continue;

    try {
      const resolved = fs.realpathSync.native(path.join(directory, executableName));
      if (isNetworkOrDevicePath(resolved)) continue;
      if (fs.statSync(resolved).isFile()) {
        trustedGitExecutable = resolved;
        return resolved;
      }
    } catch {
      // Continue searching absolute host PATH entries.
    }
  }
  return fail('trusted Git executable unavailable');
}

function copyRegularFile(
  source: string,
  destination: string,
  maxBytes: number,
  label: string,
  budget: MaterializationBudget,
): void {
  refusePathLinks(source);
  const stat = lstatOptional(source);
  if (stat === null || stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1) {
    return fail(`${label} is not trusted regular metadata`);
  }
  if (stat.size > maxBytes) return fail(`${label} exceeds metadata size boundary`);
  if (budget.files + 1 > MAX_MATERIALIZED_GIT_FILES) return fail('Git materialization file limit exceeded');
  if (budget.bytes + stat.size > MAX_MATERIALIZED_GIT_BYTES) return fail('Git materialization byte limit exceeded');

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const sourceFd = fs.openSync(source, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  let destinationFd: number | null = null;

  try {
    const opened = fs.fstatSync(sourceFd);
    if (opened.size !== stat.size || !opened.isFile() || opened.nlink !== 1) return fail(`${label} changed before materialization`);

    destinationFd = fs.openSync(destination, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
    const buffer = Buffer.alloc(Math.min(64 * 1024, Math.max(1, opened.size)));
    let offset = 0;

    while (offset < opened.size) {
      const wanted = Math.min(buffer.length, opened.size - offset);
      const read = fs.readSync(sourceFd, buffer, 0, wanted, offset);
      if (read <= 0) return fail(`${label} read truncated during materialization`);

      let written = 0;
      while (written < read) {
        written += fs.writeSync(destinationFd, buffer, written, read - written);
      }
      offset += read;
    }

    const after = fs.fstatSync(sourceFd);
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) return fail(`${label} changed during materialization`);
  } finally {
    if (destinationFd !== null) fs.closeSync(destinationFd);
    fs.closeSync(sourceFd);
  }

  budget.files++;
  budget.bytes += stat.size;
}

function copyRefsTree(
  sourceDir: string,
  destinationDir: string,
  counter: { count: number },
  budget: MaterializationBudget,
  depth = 0,
): void {
  refusePathLinks(sourceDir);
  if (lstatOptional(sourceDir) === null) return;
  if (depth > 4) fail('refs hierarchy too deep');

  const remaining = MAX_REF_ENTRIES - counter.count;
  if (remaining <= 0) fail('refs entry limit exceeded');
  const entries = readBoundedDirectoryEntries(sourceDir, remaining, 'Git refs');

  for (const entry of entries) {
    counter.count++;
    const sourcePathValue = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);
    const stat = lstatOptional(sourcePathValue);

    if (stat === null || stat.isSymbolicLink()) fail('symlink/junction refused in refs');
    if (stat.isDirectory()) {
      fs.mkdirSync(destinationPath, { recursive: true });
      copyRefsTree(sourcePathValue, destinationPath, counter, budget, depth + 1);
      continue;
    }
    if (!stat.isFile()) fail('unsupported Git ref entry');
    if (lstatOptional(destinationPath) !== null) fail('conflicting common/worktree ref refused');
    copyRegularFile(sourcePathValue, destinationPath, MAX_METADATA_BYTES, 'Git loose ref', budget);
  }
}

function inspectObjectInfo(infoDir: string): void {
  refusePathLinks(infoDir);
  if (lstatOptional(infoDir) === null) return;
  const entries = readBoundedDirectoryEntries(infoDir, MAX_OBJECT_METADATA_ENTRIES, 'Git object metadata');

  for (const entry of entries) {
    const entryPath = path.join(infoDir, entry.name);
    const stat = lstatOptional(entryPath);
    if (stat === null || stat.isSymbolicLink()) fail('symlink/junction refused in Git object metadata');

    const name = entry.name.toLowerCase();
    if (name === 'alternates' || name === 'http-alternates') fail('Git alternate objects refused');
    if (stat.isFile() && stat.size > MAX_PACK_INDEX_BYTES) fail('Git object metadata file exceeds metadata size boundary');
    if (!stat.isFile() && !stat.isDirectory()) fail('unsupported Git object metadata entry');
  }
}

function copyPackDirectory(sourceDir: string, destinationDir: string, budget: MaterializationBudget): void {
  refusePathLinks(sourceDir);
  if (lstatOptional(sourceDir) === null) return;
  const entries = readBoundedDirectoryEntries(sourceDir, MAX_PACK_ENTRIES, 'Git pack directory');
  fs.mkdirSync(destinationDir, { recursive: true });

  for (const entry of entries) {
    const sourcePathValue = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);
    const stat = lstatOptional(sourcePathValue);

    if (stat === null || stat.isSymbolicLink()) fail('symlink/junction refused in Git pack metadata');
    if (!stat.isFile()) fail('unsupported Git pack entry');
    if (/\.promisor$/i.test(entry.name)) fail('Git promisor/partial-clone metadata refused');
    if (/\.keep$/i.test(entry.name)) continue;

    if (/\.pack$/i.test(entry.name)) {
      copyRegularFile(sourcePathValue, destinationPath, MAX_PACK_DATA_BYTES, 'Git pack data', budget);
      continue;
    }
    if (/\.(?:idx|rev|bitmap|mtimes)$/i.test(entry.name)) {
      copyRegularFile(sourcePathValue, destinationPath, MAX_PACK_INDEX_BYTES, 'Git pack index metadata', budget);
      continue;
    }
    fail('unsupported Git pack metadata entry');
  }
}

function copyObjects(sourceDir: string, destinationDir: string, budget: MaterializationBudget): void {
  const entries = readBoundedDirectoryEntries(sourceDir, MAX_OBJECT_TOP_LEVEL_ENTRIES, 'Git objects');
  fs.mkdirSync(destinationDir, { recursive: true });
  let looseObjectsInspected = 0;

  for (const entry of entries) {
    const sourcePathValue = path.join(sourceDir, entry.name);
    const stat = lstatOptional(sourcePathValue);
    if (stat === null || stat.isSymbolicLink()) fail('symlink/junction refused in objects');

    if (entry.name === 'info') {
      if (!stat.isDirectory()) fail('unsupported Git objects/info entry');
      inspectObjectInfo(sourcePathValue);
      continue;
    }

    if (entry.name === 'pack') {
      if (!stat.isDirectory()) fail('unsupported Git objects/pack entry');
      copyPackDirectory(sourcePathValue, path.join(destinationDir, 'pack'), budget);
      continue;
    }

    if (/^[0-9a-f]{2}$/i.test(entry.name)) {
      if (!stat.isDirectory()) fail('unsupported loose-object fanout');
      const remaining = MAX_LOOSE_OBJECT_ENTRIES - looseObjectsInspected;
      if (remaining <= 0) fail('loose object entry limit exceeded');

      const looseEntries = readBoundedDirectoryEntries(sourcePathValue, remaining, 'Git loose objects');
      const destinationFanout = path.join(destinationDir, entry.name);
      fs.mkdirSync(destinationFanout, { recursive: true });

      for (const looseEntry of looseEntries) {
        looseObjectsInspected++;
        const loosePath = path.join(sourcePathValue, looseEntry.name);
        const looseStat = lstatOptional(loosePath);

        if (looseStat === null || looseStat.isSymbolicLink()) fail('symlink/junction refused in loose objects');
        if (!/^[0-9a-f]{38}$/i.test(looseEntry.name) || !looseStat.isFile()) fail('unsupported loose object entry');
        copyRegularFile(loosePath, path.join(destinationFanout, looseEntry.name), MAX_PACK_INDEX_BYTES, 'Git loose object', budget);
      }
      continue;
    }

    fail('unsupported Git objects entry');
  }
}

function gitExec(
  context: TrustedGitContext,
  args: string[],
  maxBuffer = INGESTION_LIMITS.maxSnapshotBytes + 8192,
): Uint8Array {
  if (!path.isAbsolute(context.gitExecutable) || isNetworkOrDevicePath(context.gitExecutable)) {
    return fail('trusted Git executable identity invalid');
  }

  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_NO_LAZY_FETCH: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_ALLOW_PROTOCOL: '',
  });

  try {
    return execFileSync(
      context.gitExecutable,
      [
        `--git-dir=${context.gitDir}`,
        '--no-pager',
        '--no-replace-objects',
        '-c',
        'core.fsmonitor=false',
        '-c',
        'protocol.file.allow=never',
        ...args,
      ],
      {
        cwd: context.tempRoot,
        env,
        shell: false,
        windowsHide: true,
        timeout: 5000,
        maxBuffer,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  } catch {
    return fail('local Git read failed');
  }
}

function gitRevParseCommit(context: TrustedGitContext, ref: string): string {
  const output = new TextDecoder('utf-8', { fatal: true })
    .decode(gitExec(context, ['rev-parse', '--verify', `${ref}^{commit}`]))
    .trim();

  if (!/^[a-f0-9]{40}$/.test(output) || /^0+$/.test(output)) return fail('Git commit identity');
  return output;
}

function verifyMaterializedObjectIntegrity(context: TrustedGitContext): void {
  gitExec(
    context,
    [
      'fsck',
      '--full',
      '--strict',
      '--no-reflogs',
      '--no-dangling',
      context.expectedCommitSha,
    ],
    1024 * 1024,
  );
}

function assertSourceStableForAuthority(context: TrustedGitContext): void {
  const stagingBefore = lstatOptional(context.trustedStagingRoot);
  if (
    stagingBefore === null ||
    !sameFileIdentity(context.trustedStagingRootIdentity, stagingBefore)
  ) {
    fail('trusted staging root identity changed before authority mint');
  }

  const rootBefore = lstatOptional(context.sourceRoot);
  if (
    rootBefore === null ||
    !sameFileIdentity(context.sourceRootIdentity, rootBefore)
  ) {
    fail('source repository identity changed before authority mint');
  }

  const dotGitPath = path.join(context.sourceRoot, '.git');
  const dotGitBefore = lstatOptional(dotGitPath);
  if (
    dotGitBefore === null ||
    !sameFileIdentity(context.sourceDotGitIdentity, dotGitBefore)
  ) {
    fail('source Git .git identity changed before authority mint');
  }

  const layout = resolveSourceGitLayout(context.sourceRoot);
  if (
    layout.gitDir.toLowerCase() !== dotGitPath.toLowerCase() ||
    layout.commonDir.toLowerCase() !== dotGitPath.toLowerCase()
  ) {
    fail('source Git layout changed before authority mint');
  }

  const current = resolveSourceHeadClaim(layout);
  if (current !== context.expectedCommitSha) {
    fail('source Git HEAD changed before authority mint');
  }

  const rootAfter = lstatOptional(context.sourceRoot);
  const dotGitAfter = lstatOptional(dotGitPath);
  if (
    rootAfter === null ||
    dotGitAfter === null ||
    !sameFileIdentity(context.sourceRootIdentity, rootAfter) ||
    !sameFileIdentity(context.sourceDotGitIdentity, dotGitAfter)
  ) {
    fail('source Git identity changed during final authority check');
  }
}

function materializeTrustedGitRepository(root: string, gitExecutable: string): TrustedGitContext {
  if (isPathWithin(root, gitExecutable)) return fail('trusted Git executable may not originate from repository');

  const stagingBinding = bindTrustedStagingRepository(root);
  const layoutBefore = resolveSourceGitLayout(root);

  const dotGitIdentityBefore = fs.lstatSync(path.join(root, '.git'));
  const expectedCommitSha = resolveSourceHeadClaim(layoutBefore);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'velnar-m4-git-'));
  const materializedGitDir = path.join(tempRoot, 'repo.git');

  try {
    fs.mkdirSync(materializedGitDir);

    fs.writeFileSync(
      path.join(materializedGitDir, 'config'),
      '[core]\n\trepositoryformatversion = 0\n\tbare = true\n\tfilemode = false\n\tlogallrefupdates = false\n',
      { encoding: 'utf8', mode: 0o600, flag: 'wx' },
    );

    fs.writeFileSync(
      path.join(materializedGitDir, 'HEAD'),
      readBoundedMetadataFile(path.join(layoutBefore.gitDir, 'HEAD'), MAX_METADATA_BYTES),
      { encoding: 'utf8', mode: 0o600, flag: 'wx' },
    );

    const budget: MaterializationBudget = { files: 2, bytes: 0 };
    const packedRefs = path.join(layoutBefore.commonDir, 'packed-refs');
    if (lstatOptional(packedRefs) !== null) {
      copyRegularFile(packedRefs, path.join(materializedGitDir, 'packed-refs'), MAX_PACKED_REFS_BYTES, 'Git packed-refs', budget);
    }

    const refCounter = { count: 0 };
    copyRefsTree(path.join(layoutBefore.commonDir, 'refs'), path.join(materializedGitDir, 'refs'), refCounter, budget);
    if (layoutBefore.gitDir !== layoutBefore.commonDir) {
      copyRefsTree(path.join(layoutBefore.gitDir, 'refs'), path.join(materializedGitDir, 'refs'), refCounter, budget);
    }

    copyObjects(path.join(layoutBefore.commonDir, 'objects'), path.join(materializedGitDir, 'objects'), budget);

    const layoutAfter = resolveSourceGitLayout(root);
    if (
      layoutAfter.gitDir.toLowerCase() !== layoutBefore.gitDir.toLowerCase() ||
      layoutAfter.commonDir.toLowerCase() !== layoutBefore.commonDir.toLowerCase()
    ) return fail('Git layout changed during materialization');

    const dotGitIdentityAfter = fs.lstatSync(path.join(root, '.git'));
    if (!sameFileIdentity(dotGitIdentityBefore, dotGitIdentityAfter)) return fail('Git .git identity changed during materialization');

    const sourceHeadAfter = resolveSourceHeadClaim(layoutAfter);
    if (sourceHeadAfter !== expectedCommitSha) return fail('Git HEAD changed during materialization');

    const context: TrustedGitContext = {
      sourceRoot: root,
      trustedStagingRoot: stagingBinding.trustedStagingRoot,
      trustedStagingRootIdentity: stagingBinding.trustedStagingRootIdentity,
      sourceRootIdentity: stagingBinding.sourceRootIdentity,
      sourceDotGitIdentity: dotGitIdentityBefore,
      tempRoot,
      gitDir: materializedGitDir,
      gitExecutable,
      expectedCommitSha,
    };

    verifyMaterializedObjectIntegrity(context);

    const actualCommitSha = gitRevParseCommit(context, 'HEAD');
    if (actualCommitSha !== expectedCommitSha) return fail('materialized Git identity mismatch');

    assertSourceStableForAuthority(context);
    return context;
  } catch (error) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    throw error;
  }
}

function cleanupTrustedGitContext(context: TrustedGitContext): void {
  fs.rmSync(context.tempRoot, { recursive: true, force: true });
}

function getGitObjectSize(context: TrustedGitContext, blobSha: string): number {
  const output = new TextDecoder('utf-8', { fatal: true })
    .decode(gitExec(context, ['cat-file', '-s', blobSha], 1024))
    .trim();

  if (!/^(?:0|[1-9][0-9]*)$/.test(output)) return fail('invalid Git object size');
  const size = Number(output);
  if (!Number.isSafeInteger(size) || size < 0) return fail('invalid Git object size');
  return size;
}

function readCommittedFiles(context: TrustedGitContext, commitSha: string): { path: string; content: string }[] {
  const listing = gitExec(context, ['ls-tree', '-r', '-z', '--full-tree', commitSha]);
  const rows = new TextDecoder('utf-8', { fatal: true }).decode(listing).split(String.fromCharCode(0));
  if (rows.pop() !== '') fail('malformed Git tree listing');
  if (rows.length > INGESTION_LIMITS.maxFiles) fail('repository file count exceeds bound');

  let totalBytes = 0;
  const files: { path: string; content: string }[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const tabIndex = row.indexOf(String.fromCharCode(9));
    if (tabIndex === -1) fail('unsupported Git tree entry');

    const prefix = row.slice(0, tabIndex);
    const relPath = row.slice(tabIndex + 1);
    const parts = prefix.split(' ');
    if (parts.length !== 3 || (parts[0] !== '100644' && parts[0] !== '100755') || parts[1] !== 'blob') {
      fail('unsupported Git tree entry');
    }

    const blobSha = parts[2];
    if (!/^[a-f0-9]{40}$/.test(blobSha)) fail('unsupported Git tree entry');
    sourcePath(relPath);

    const lower = relPath.toLowerCase();
    if (seen.has(lower)) fail('duplicate canonical path');
    seen.add(lower);

    const objectSize = getGitObjectSize(context, blobSha);
    if (objectSize > INGESTION_LIMITS.maxFileBytes) fail('Git object exceeds maxFileBytes');
    totalBytes += objectSize;
    if (totalBytes > INGESTION_LIMITS.maxSnapshotBytes) fail('Git snapshot exceeds maxSnapshotBytes');

    const blobBytes = gitExec(context, ['cat-file', 'blob', blobSha], INGESTION_LIMITS.maxFileBytes + 1024);
    if (blobBytes.length !== objectSize) fail('Git blob size mismatch against preflight');

    files.push({
      path: relPath,
      content: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(blobBytes),
    });
  }

  return files;
}

export interface TrustedCommitCapability {
  readonly [Symbol.toStringTag]: 'TrustedCommitCapability';
}

const TRUSTED_CAPABILITIES =
  new WeakMap<
    object,
    RepositoryIngestion
  >();

function mintTrustedCapability(
  ingestion: RepositoryIngestion,
): TrustedCommitCapability {
  const capability:
    TrustedCommitCapability =
    Object.freeze({
      [Symbol.toStringTag]:
        'TrustedCommitCapability' as const,
    });

  TRUSTED_CAPABILITIES.set(
    capability,
    ingestion,
  );

  return capability;
}

export function isTrustedCommitCapability(
  candidate: unknown,
  ingestion: RepositoryIngestion,
): candidate is TrustedCommitCapability {
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    TRUSTED_CAPABILITIES.get(
      candidate,
    ) === ingestion
  );
}

export function assertTrustedCommitCapability(
  candidate: unknown,
  ingestion: RepositoryIngestion,
): asserts candidate is TrustedCommitCapability {
  if (
    !isTrustedCommitCapability(
      candidate,
      ingestion,
    )
  ) {
    fail('unauthorized commit capability');
  }
}

export interface IngestRepositoryOptions {
  readonly repositoryPath: string;
  readonly organizationId: string;
  readonly repositoryId: string;
  readonly fixtureId?: string;
}

export interface RepositoryIngestion {
  readonly version: 'velnar-repository-ingestion-v1';
  readonly organizationId: string;
  readonly repositoryId: string;
  readonly commitSha: string;
  readonly snapshot: SourceSnapshot;
  readonly ingestionIdentity: string;
}

export interface TrustedRepositoryIngestion {
  readonly ingestion: RepositoryIngestion;
  readonly capability: TrustedCommitCapability;
}

export async function ingestRepository(
  options: IngestRepositoryOptions,
): Promise<TrustedRepositoryIngestion> {
  const repositoryPath = options.repositoryPath;
  const organizationId = options.organizationId;
  const repositoryId = options.repositoryId;
  const fixtureId = options.fixtureId || 'm2-case-001';

  identifier(organizationId);
  identifier(repositoryId);
  opaqueCaseId(fixtureId);

  const gitExecutable = resolveTrustedGitExecutable();
  const root = normalizeLocalRepositoryPath(repositoryPath);
  const context = materializeTrustedGitRepository(root, gitExecutable);

  try {
    const commitBefore = gitRevParseCommit(context, 'HEAD');
    if (commitBefore !== context.expectedCommitSha) fail('materialized Git identity mismatch');

    const files = readCommittedFiles(context, commitBefore);
    const snapshot = await captureSnapshot(
      { fixtureId, repositoryId, organizationId, files },
      organizationId,
    );

    const commitAfter = gitRevParseCommit(context, 'HEAD');
    if (commitAfter !== commitBefore) fail('materialized Git HEAD changed during ingestion');

    const body = {
      version: 'velnar-repository-ingestion-v1' as const,
      organizationId,
      repositoryId,
      commitSha: commitBefore,
      snapshot,
    };

    const ingestionIdentity = await hash('velnar-repository-ingestion-v1', body);
    const ingestion: RepositoryIngestion = immutableCopy({ ...body, ingestionIdentity });

    assertSourceStableForAuthority(context);

    const capability = mintTrustedCapability(ingestion);

    return Object.freeze({ ingestion, capability });
  } finally {
    cleanupTrustedGitContext(context);
  }
}

export async function validateRepositoryIngestion(raw: unknown, expectedOrganizationId: string): Promise<RepositoryIngestion> {
  identifier(expectedOrganizationId);
  const r = dataObject(raw, ['version', 'organizationId', 'repositoryId', 'commitSha', 'snapshot', 'ingestionIdentity']);
  if (r.version !== 'velnar-repository-ingestion-v1') fail('invalid repository ingestion version');
  for (const key of ['organizationId', 'repositoryId']) identifier(r[key]);
  if (r.organizationId !== expectedOrganizationId) fail('tenant mismatch');
  if (typeof r.commitSha !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(r.commitSha) || /^0+$/.test(r.commitSha)) {
    fail('Git commit identity');
  }
  const snapshot = await validateSnapshot(r.snapshot, expectedOrganizationId);
  if (snapshot.organizationId !== r.organizationId || snapshot.repositoryId !== r.repositoryId) {
    fail('snapshot binding mismatch');
  }
  const detached = detachJson(r);
  const expectedIdentity = await hash('velnar-repository-ingestion-v1', {
    version: r.version,
    organizationId: r.organizationId,
    repositoryId: r.repositoryId,
    commitSha: r.commitSha,
    snapshot,
  });
  if (r.ingestionIdentity !== expectedIdentity) fail('ingestion identity mismatch');
  return immutableCopy({
    version: 'velnar-repository-ingestion-v1' as const,
    organizationId: r.organizationId,
    repositoryId: r.repositoryId,
    commitSha: r.commitSha,
    snapshot,
    ingestionIdentity: expectedIdentity,
  });
}

export async function verifyCommittedRepository(
  repositoryPath: string,
  raw: unknown,
  expectedOrganizationId: string,
): Promise<TrustedRepositoryIngestion> {
  const gitExecutable = resolveTrustedGitExecutable();
  const root = normalizeLocalRepositoryPath(repositoryPath);
  const context = materializeTrustedGitRepository(root, gitExecutable);

  try {
    const materializedHeadBefore = gitRevParseCommit(context, 'HEAD');
    if (materializedHeadBefore !== context.expectedCommitSha) fail('materialized Git identity mismatch');

    const ingestion = await validateRepositoryIngestion(raw, expectedOrganizationId);

    if (materializedHeadBefore !== ingestion.commitSha) {
      fail('Git commit mismatch with materialized repository HEAD');
    }

    const verifiedCommit = gitRevParseCommit(context, ingestion.commitSha);
    if (verifiedCommit !== ingestion.commitSha) fail('Git commit identity mismatch');

    const files = readCommittedFiles(context, ingestion.commitSha);
    const freshSnapshot = await captureSnapshot(
      {
        fixtureId: ingestion.snapshot.fixtureId,
        repositoryId: ingestion.repositoryId,
        organizationId: ingestion.organizationId,
        files,
      },
      expectedOrganizationId,
    );

    const materializedHeadAfter = gitRevParseCommit(context, 'HEAD');
    if (materializedHeadAfter !== materializedHeadBefore) {
      fail('materialized Git HEAD changed during verification');
    }

    if (freshSnapshot.snapshotId !== ingestion.snapshot.snapshotId) {
      fail('committed snapshot content mismatch');
    }

    assertSourceStableForAuthority(context);

    const capability = mintTrustedCapability(ingestion);
    return Object.freeze({ ingestion, capability });
  } finally {
    cleanupTrustedGitContext(context);
  }
}
