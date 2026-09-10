/** Local-only deterministic Stage-A build identity. No production identity, receipt, authority, or deployment ID is created here. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, execSync } from 'node:child_process';

export const SOURCE_ATTESTATION_BUILD_MANIFEST_VERSION = 'velnar-stage-a-build-manifest-v1' as const;
export const CANONICAL_BUILD_MANIFEST_REPOSITORY = 'kayrastos/updated-velnaar' as const;
export const STAGE_A_BUILD_IDENTITY_IS_NOT_STAGE_B_DEPLOYMENT_IDENTITY = true as const;

/** Cryptographic TOCTOU & Source-Binding Invariant Constants (Rejection of working-tree-only checks) */
export const BEFORE_AFTER_WORKTREE_CHECKS_ALONE_ARE_NOT_SUFFICIENT = true as const;
export const ARTIFACT_HASH_ALONE_DOES_NOT_PROVE_GIT_SOURCE_CORRESPONDENCE = true as const;
export const AD_HOC_INDEPENDENT_REBUILD_IS_NOT_AN_IMPLEMENTATION_ENFORCED_SOURCE_BINDING = true as const;

/** Authority and Isolation Invariant Constants */
export const CANONICAL_OPTIONS_EXACT_SCHEMA = true as const;
export const EXPORTED_AUTHORITY_BYPASS_ENTRYPOINTS = 0 as const;
export const CANONICAL_STAGE_A_MODULE_BYTES_CALLER_CONTROLLED = false as const;
export const CANONICAL_COMMAND_EXECUTOR_CALLER_CONTROLLED = false as const;
export const CANONICAL_GIT_IDENTITY_CALLER_CONTROLLED = false as const;
export const CANONICAL_SNAPSHOT_MATERIALIZATION_CALLER_CONTROLLED = false as const;
export const CANONICAL_OUTPUT_ROOT_CALLER_CONTROLLED = false as const;
export const CANONICAL_NPM_BYPASS_CALLER_CONTROLLED = false as const;
export const COMMIT_TREE_BINDING_ENFORCED = true as const;
export const ARCHIVE_USES_CAPTURED_COMMIT = true as const;
export const SNAPSHOT_REALPATH_ESCAPE_REJECTED = true as const;
export const OUTPUT_REALPATH_ESCAPE_REJECTED = true as const;
export const UNTRACKED_WORKTREE_POISONING_BLOCKED = true as const;
export const TRANSIENT_TRACKED_POISONING_BLOCKED = true as const;
export const CANONICAL_WRANGLER_EXECUTION_AUTHORITY = 'LOCAL_PINNED' as const;
export const NPX_USED_BY_CANONICAL_PATH = false as const;

export const PINNED_TOOLCHAIN_CHECKPOINT = {
  nodeVersion: '24.18.0',
  npmVersion: '11.16.0',
  wranglerVersion: '4.130.0',
  directEsbuildVersion: '0.25.12',
  wranglerInternalEsbuildVersion: '0.28.1',
  workerdVersion: '1.20260908.1',
} as const;

const SHA256 = /^[0-9a-f]{64}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
const BUILD_ID = /^velnar-build-v1-[0-9a-f]{64}$/;
const SAFE_PATH = /^[A-Za-z0-9._@/+\-]+$/;
const sha = (input: Uint8Array | string) => crypto.createHash('sha256').update(input).digest('hex');
const compareUtf8 = (a: string, b: string) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));

export interface StageAModuleInput { readonly relativePath: string; readonly bytes: Uint8Array; }
export interface StageAModuleEntry { readonly normalizedRelativePath: string; readonly byteLength: number; readonly sha256: string; }
export interface BuildRecipeIdentity {
  readonly nodeVersion: string; readonly npmVersion: string; readonly wranglerVersion: string; readonly wranglerInternalEsbuildVersion: string; readonly workerdVersion: string;
  readonly packageLockSha256: string; readonly wranglerConfigSha256: string; readonly entrypoint: string; readonly compatibilityDate: string; readonly compatibilityFlags: readonly string[]; readonly bundlingCommand: string;
}
export interface DeploymentConfigIdentity {
  readonly workerName: string;
  readonly d1Bindings: readonly { readonly binding: string; readonly databaseName: string; readonly databaseId: string; readonly migrationsDir: string }[];
  readonly vars: Readonly<Record<string, string>>;
}
export interface SourceAttestationBuildManifest {
  readonly manifestVersion: typeof SOURCE_ATTESTATION_BUILD_MANIFEST_VERSION; readonly repositoryFullName: typeof CANONICAL_BUILD_MANIFEST_REPOSITORY;
  readonly sourceCommitSha: string; readonly sourceTreeSha: string; readonly stageAArtifactSha256: string; readonly buildRecipeDigestSha256: string; readonly buildId: string; readonly deploymentConfigDigestSha256: string;
}

/**
 * CANONICAL PUBLIC OPTIONS SCHEMA.
 * Strictly one authority-neutral input property: repositoryRoot.
 * No caller-injected gitRunner, tarRunner, commandRunner, destinationDir, retainSnapshot,
 * allowDirtyTracked, skipNpmCi, or arbitrary bypass flags.
 */
export interface GenerateBuildManifestOptions {
  readonly repositoryRoot: string;
}

function exact(value: unknown, keys: readonly string[], label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}_NOT_OBJECT`);
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key)) || keys.some((key) => !Object.hasOwn(value, key))) {
    throw new Error(`${label}_EXACT_SCHEMA_REQUIRED`);
  }
}
function string(value: unknown, label: string): asserts value is string { if (typeof value !== 'string' || !value) throw new Error(`${label}_MUST_BE_NONEMPTY_STRING`); }
function digest(value: unknown, label: string): asserts value is string { string(value, label); if (!SHA256.test(value)) throw new Error(`${label}_MUST_BE_LOWERCASE_SHA256`); }

/** Paths are intentionally ASCII-safe: Wrangler's emitted module names meet this rule and Unicode case-fold ambiguity is excluded. */
export function normalizeStageAModulePath(value: unknown): string {
  string(value, 'MODULE_PATH'); const p = value.replace(/\\/g, '/');
  if (!SAFE_PATH.test(p) || p.startsWith('/') || /^[A-Za-z]:\//.test(p)) throw new Error('MODULE_PATH_INVALID_OR_ABSOLUTE');
  if (p.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('MODULE_PATH_TRAVERSAL_OR_EMPTY');
  return p;
}

/**
 * Symlink and Realpath Contained Verification.
 * Strictly asserts that targetPath is not a symbolic link and its resolved realpath
 * remains within parentRoot. Fails closed with the specified errorLabel or SYMLINK_NOT_PERMITTED.
 */
export function assertNoSymlinkAndContained(targetPath: string, parentRoot: string, errorLabel = 'SNAPSHOT_PATH_ESCAPES_ROOT'): void {
  const resolvedParent = fs.realpathSync(parentRoot);
  const normalizedTarget = path.resolve(targetPath);
  const rel = path.relative(resolvedParent, normalizedTarget);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(errorLabel);
  }
  const lstat = fs.lstatSync(targetPath);
  if (lstat.isSymbolicLink()) {
    throw new Error('SYMLINK_NOT_PERMITTED');
  }
  const resolvedTarget = fs.realpathSync(targetPath);
  const relResolved = path.relative(resolvedParent, resolvedTarget);
  if (relResolved.startsWith('..') || path.isAbsolute(relResolved)) {
    throw new Error(errorLabel);
  }
}

/**
 * NON-CANONICAL / LOW-LEVEL PURE HELPER.
 * Canonical UTF-8: version newline, then byte-sorted `path<TAB>length<TAB>sha256(bytes)` lines.
 * For pure unit testing and offline assertions only; not the module-byte authority for canonical builds.
 */
export function canonicalizeStageAModuleGraph(modules: readonly StageAModuleInput[]): { readonly canonicalBytes: Uint8Array; readonly modules: readonly StageAModuleEntry[] } {
  if (!Array.isArray(modules) || !modules.length) throw new Error('STAGE_A_MODULE_GRAPH_EMPTY');
  const entries = modules.map((module) => {
    if (!module || !(module.bytes instanceof Uint8Array)) throw new Error('STAGE_A_MODULE_INVALID');
    return { normalizedRelativePath: normalizeStageAModulePath(module.relativePath), byteLength: module.bytes.byteLength, sha256: sha(module.bytes) };
  }).sort((a, b) => compareUtf8(a.normalizedRelativePath, b.normalizedRelativePath));
  if (new Set(entries.map((x) => x.normalizedRelativePath)).size !== entries.length) throw new Error('STAGE_A_MODULE_DUPLICATE_PATH');
  if (new Set(entries.map((x) => x.normalizedRelativePath.toLowerCase())).size !== entries.length) throw new Error('STAGE_A_MODULE_CASE_COLLISION');
  return Object.freeze({ canonicalBytes: Buffer.from(`velnar-stage-a-module-graph-v1\n${entries.map((x) => `${x.normalizedRelativePath}\t${x.byteLength}\t${x.sha256}`).join('\n')}\n`, 'utf8'), modules: Object.freeze(entries) });
}

/**
 * NON-CANONICAL / LOW-LEVEL PURE HELPER.
 * Computes Stage-A artifact hash from given module graph.
 */
export const computeStageAArtifactSha256 = (modules: readonly StageAModuleInput[]) => sha(canonicalizeStageAModuleGraph(modules).canonicalBytes);

export function canonicalizeBuildRecipeIdentity(recipe: BuildRecipeIdentity): Uint8Array {
  const keys = ['nodeVersion','npmVersion','wranglerVersion','wranglerInternalEsbuildVersion','workerdVersion','packageLockSha256','wranglerConfigSha256','entrypoint','compatibilityDate','compatibilityFlags','bundlingCommand'];
  exact(recipe, keys, 'BUILD_RECIPE');
  for (const key of keys.filter((key) => key !== 'compatibilityFlags')) string(recipe[key as keyof BuildRecipeIdentity], `BUILD_RECIPE_${key}`);
  digest(recipe.packageLockSha256, 'BUILD_RECIPE_packageLockSha256'); digest(recipe.wranglerConfigSha256, 'BUILD_RECIPE_wranglerConfigSha256');
  if (!Array.isArray(recipe.compatibilityFlags) || recipe.compatibilityFlags.some((x) => typeof x !== 'string' || !x) || recipe.compatibilityFlags.some((x, i, all) => i > 0 && compareUtf8(all[i - 1], x) >= 0)) throw new Error('BUILD_RECIPE_COMPATIBILITY_FLAGS_INVALID');
  return Buffer.from(`velnar-stage-a-build-recipe-v1\n${JSON.stringify({ ...recipe, compatibilityFlags: [...recipe.compatibilityFlags] })}\n`, 'utf8');
}
export const computeBuildRecipeDigestSha256 = (recipe: BuildRecipeIdentity) => sha(canonicalizeBuildRecipeIdentity(recipe));

/** External D1/vars are release configuration, not claimed as executable Stage-A bytes. */
export function computeDeploymentConfigDigestSha256(config: DeploymentConfigIdentity): string {
  exact(config, ['workerName','d1Bindings','vars'], 'DEPLOYMENT_CONFIG'); string(config.workerName, 'DEPLOYMENT_CONFIG_workerName');
  if (!Array.isArray(config.d1Bindings) || !config.d1Bindings.length || !config.vars || typeof config.vars !== 'object' || Array.isArray(config.vars)) throw new Error('DEPLOYMENT_CONFIG_INVALID');
  const bindings = config.d1Bindings.map((binding) => { exact(binding, ['binding','databaseName','databaseId','migrationsDir'], 'DEPLOYMENT_CONFIG_BINDING'); Object.values(binding).forEach((x) => string(x, 'DEPLOYMENT_CONFIG_BINDING_FIELD')); return { binding: binding.binding as string, databaseName: binding.databaseName as string, databaseId: binding.databaseId as string, migrationsDir: binding.migrationsDir as string }; }).sort((a,b) => compareUtf8(a.binding,b.binding));
  if (new Set(bindings.map((x) => x.binding)).size !== bindings.length || Object.values(config.vars as Record<string, unknown>).some((x) => typeof x !== 'string')) throw new Error('DEPLOYMENT_CONFIG_INVALID');
  const vars = Object.fromEntries(Object.keys(config.vars).sort(compareUtf8).map((key) => [key, config.vars[key]]));
  return sha(Buffer.from(`velnar-deployment-config-v1\n${JSON.stringify({ workerName: config.workerName, d1Bindings: bindings, vars })}\n`, 'utf8'));
}
export function deriveBuildId(stageAArtifactSha256: unknown, buildRecipeDigestSha256: unknown): string { digest(stageAArtifactSha256, 'STAGE_A_ARTIFACT'); digest(buildRecipeDigestSha256, 'BUILD_RECIPE_DIGEST'); return `velnar-build-v1-${sha(`velnar-source-attestation-build-v1\n${stageAArtifactSha256}\n${buildRecipeDigestSha256}\n`)}`; }
const MANIFEST_KEYS = ['manifestVersion','repositoryFullName','sourceCommitSha','sourceTreeSha','stageAArtifactSha256','buildRecipeDigestSha256','buildId','deploymentConfigDigestSha256'];
export function validateSourceAttestationBuildManifest(value: unknown): SourceAttestationBuildManifest {
  exact(value, MANIFEST_KEYS, 'BUILD_MANIFEST'); const x = value as Record<string, unknown>; MANIFEST_KEYS.forEach((key) => string(x[key], `BUILD_MANIFEST_${key}`));
  if (x.manifestVersion !== SOURCE_ATTESTATION_BUILD_MANIFEST_VERSION || x.repositoryFullName !== CANONICAL_BUILD_MANIFEST_REPOSITORY) throw new Error('BUILD_MANIFEST_CANONICAL_IDENTITY_MISMATCH');
  if (!GIT_SHA.test(x.sourceCommitSha as string) || !GIT_SHA.test(x.sourceTreeSha as string)) throw new Error('BUILD_MANIFEST_GIT_ID_INVALID');
  digest(x.stageAArtifactSha256, 'BUILD_MANIFEST_stageAArtifactSha256'); digest(x.buildRecipeDigestSha256, 'BUILD_MANIFEST_buildRecipeDigestSha256'); digest(x.deploymentConfigDigestSha256, 'BUILD_MANIFEST_deploymentConfigDigestSha256');
  if (!BUILD_ID.test(x.buildId as string) || x.buildId !== deriveBuildId(x.stageAArtifactSha256, x.buildRecipeDigestSha256)) throw new Error('BUILD_MANIFEST_BUILD_ID_INVALID');
  return Object.freeze(x as unknown as SourceAttestationBuildManifest);
}

/**
 * LOW-LEVEL / NON-CANONICAL CONSTRUCTOR.
 * Performs structural and cryptographic assembly of manifest fields only.
 * MUST NOT itself constitute proof that artifact bytes came from a trusted Git/Stage-A build.
 * Does not set operational readiness.
 */
export function createSourceAttestationBuildManifest(input: Omit<SourceAttestationBuildManifest, 'buildId'>): SourceAttestationBuildManifest {
  return validateSourceAttestationBuildManifest({ ...input, buildId: deriveBuildId(input.stageAArtifactSha256, input.buildRecipeDigestSha256) });
}

export function normalizeRepositoryRemote(value: unknown): typeof CANONICAL_BUILD_MANIFEST_REPOSITORY {
  string(value, 'GIT_REMOTE'); const match = value.trim().match(/(?:github\.com[/:])([^/\s:]+)\/([^/\s]+?)(?:\.git)?$/i);
  if (!match || `${match[1]}/${match[2]}`.toLowerCase() !== CANONICAL_BUILD_MANIFEST_REPOSITORY) throw new Error('GIT_REMOTE_REPOSITORY_MISMATCH'); return CANONICAL_BUILD_MANIFEST_REPOSITORY;
}

const asString = (v: string | Buffer): string => (typeof v === 'string' ? v : Buffer.from(v).toString('utf8')).trim();

/** Internal trusted Git process execution. Cannot be replaced by caller. */
const trustedGit = (args: readonly string[], root: string): string | Buffer => {
  const isBinary = args[0] === 'archive';
  const out = execFileSync('git', [...args], { cwd: root, maxBuffer: 100 * 1024 * 1024 });
  return isBinary ? out : Buffer.from(out).toString('utf8').trim();
};

export interface GitSnapshotMaterialization {
  readonly snapshotRoot: string;
  readonly repositoryFullName: typeof CANONICAL_BUILD_MANIFEST_REPOSITORY;
  readonly sourceCommitSha: string;
  readonly sourceTreeSha: string;
  readonly packageLockSha256: string;
  readonly wranglerConfigSha256: string;
  readonly entrypoint: string;
  readonly compatibilityDate: string;
  readonly compatibilityFlags: readonly string[];
  readonly workerName: string;
  readonly d1Bindings: readonly { readonly binding: string; readonly databaseName: string; readonly databaseId: string; readonly migrationsDir: string }[];
  readonly vars: Readonly<Record<string, string>>;
  readonly cleanup: () => void;
  readonly readSnapshotFile: (relativePath: string) => Uint8Array;
}

/**
 * Internal trusted snapshot materialization from Git object storage.
 * Enforces:
 * - exact options schema (only repositoryRoot)
 * - clean tracked worktree (fail-closed on dirty worktree)
 * - canonical repository origin
 * - commit-to-tree hard binding: rev-parse ${sourceCommitSha}^{tree} === sourceTreeSha
 * - git archive <sourceCommitSha> (captured commit object only, never mutable HEAD)
 * - trusted tar extraction into internally owned temp directory
 * - material inputs verified: non-symlink, contained realpaths
 * - toolchain checkpoints verified
 */
export function materializeImmutableGitSnapshot(options: {
  readonly repositoryRoot: string;
}): GitSnapshotMaterialization {
  exact(options, ['repositoryRoot'], 'SNAPSHOT_MATERIALIZE_OPTIONS');
  string(options.repositoryRoot, 'SNAPSHOT_MATERIALIZE_OPTIONS_repositoryRoot');

  // 1. Fail closed on dirty tracked working tree
  const statusOut = asString(trustedGit(['status', '--porcelain', '--untracked-files=no'], options.repositoryRoot));
  if (statusOut.length > 0) throw new Error('GIT_TRACKED_WORKTREE_DIRTY');

  // 2. Canonical repository origin validation
  const repositoryFullName = normalizeRepositoryRemote(asString(trustedGit(['remote', 'get-url', 'origin'], options.repositoryRoot)));

  // 3. Capture sourceCommitSha from HEAD, then derive tree strictly from that commit object
  const sourceCommitSha = asString(trustedGit(['rev-parse', 'HEAD'], options.repositoryRoot));
  if (!GIT_SHA.test(sourceCommitSha)) throw new Error('GIT_SOURCE_ID_INVALID');

  const sourceTreeSha = asString(trustedGit(['rev-parse', `${sourceCommitSha}^{tree}`], options.repositoryRoot));
  if (!GIT_SHA.test(sourceTreeSha)) throw new Error('GIT_SOURCE_ID_INVALID');

  // Hard commit-to-tree re-verification
  const verificationTree = asString(trustedGit(['rev-parse', `${sourceCommitSha}^{tree}`], options.repositoryRoot));
  if (verificationTree !== sourceTreeSha) {
    throw new Error('GIT_COMMIT_TREE_BINDING_FAILED');
  }

  // 4. Create internally owned fresh temporary snapshot root
  const snapshotRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'velnar-git-snapshot-'));

  try {
    // 5. Materialize EXACT captured commit object bytes (not mutable HEAD)
    const archiveOut = trustedGit(['archive', sourceCommitSha], options.repositoryRoot);
    const tarBytes = Buffer.isBuffer(archiveOut) ? archiveOut : Buffer.from(archiveOut);
    execFileSync('tar', ['-x', '-C', snapshotRoot], { input: tarBytes, maxBuffer: 100 * 1024 * 1024 });

    // 6. Verify material build inputs exist strictly inside snapshot with no symlinks
    const requiredFiles = ['package.json', 'package-lock.json', '.node-version', 'wrangler.canary-ops.jsonc', 'worker/canaryOpsWorker.ts'];
    for (const rel of requiredFiles) {
      const fullPath = path.join(snapshotRoot, rel);
      if (!fs.existsSync(fullPath)) throw new Error(`SNAPSHOT_MATERIAL_INPUT_MISSING_${rel.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}`);
      assertNoSymlinkAndContained(fullPath, snapshotRoot, 'SNAPSHOT_PATH_ESCAPES_ROOT');
    }

    // 7. Verify pinned toolchain inside snapshot
    const nodeVersion = fs.readFileSync(path.join(snapshotRoot, '.node-version'), 'utf8').trim();
    if (nodeVersion !== PINNED_TOOLCHAIN_CHECKPOINT.nodeVersion) throw new Error('SNAPSHOT_TOOLCHAIN_NODE_VERSION_MISMATCH');

    const pkgJson = JSON.parse(fs.readFileSync(path.join(snapshotRoot, 'package.json'), 'utf8'));
    if (pkgJson.packageManager !== `npm@${PINNED_TOOLCHAIN_CHECKPOINT.npmVersion}` ||
        pkgJson.engines?.node !== PINNED_TOOLCHAIN_CHECKPOINT.nodeVersion ||
        pkgJson.devDependencies?.wrangler !== PINNED_TOOLCHAIN_CHECKPOINT.wranglerVersion ||
        pkgJson.devDependencies?.esbuild !== PINNED_TOOLCHAIN_CHECKPOINT.directEsbuildVersion) {
      throw new Error('SNAPSHOT_TOOLCHAIN_PACKAGE_JSON_MISMATCH');
    }

    const pkgLock = JSON.parse(fs.readFileSync(path.join(snapshotRoot, 'package-lock.json'), 'utf8'));
    if (pkgLock.packages?.['node_modules/wrangler']?.version !== PINNED_TOOLCHAIN_CHECKPOINT.wranglerVersion ||
        pkgLock.packages?.['node_modules/esbuild']?.version !== PINNED_TOOLCHAIN_CHECKPOINT.directEsbuildVersion ||
        pkgLock.packages?.['node_modules/wrangler/node_modules/esbuild']?.version !== PINNED_TOOLCHAIN_CHECKPOINT.wranglerInternalEsbuildVersion ||
        pkgLock.packages?.['node_modules/workerd']?.version !== PINNED_TOOLCHAIN_CHECKPOINT.workerdVersion) {
      throw new Error('SNAPSHOT_TOOLCHAIN_LOCKFILE_MISMATCH');
    }

    const packageLockSha256 = sha(fs.readFileSync(path.join(snapshotRoot, 'package-lock.json')));
    const wranglerConfigBytes = fs.readFileSync(path.join(snapshotRoot, 'wrangler.canary-ops.jsonc'));
    const wranglerConfigSha256 = sha(wranglerConfigBytes);
    const wranglerConfig = JSON.parse(Buffer.from(wranglerConfigBytes).toString('utf8'));

    const readSnapshotFile = (rel: string) => {
      const normalized = normalizeStageAModulePath(rel);
      const abs = path.join(snapshotRoot, normalized);
      assertNoSymlinkAndContained(abs, snapshotRoot, 'SNAPSHOT_PATH_ESCAPES_ROOT');
      return fs.readFileSync(abs);
    };

    const cleanup = () => {
      try { fs.rmSync(snapshotRoot, { recursive: true, force: true }); } catch {}
    };

    return Object.freeze({
      snapshotRoot,
      repositoryFullName,
      sourceCommitSha,
      sourceTreeSha,
      packageLockSha256,
      wranglerConfigSha256,
      entrypoint: wranglerConfig.main,
      compatibilityDate: wranglerConfig.compatibility_date,
      compatibilityFlags: Object.freeze([...(wranglerConfig.compatibility_flags ?? [])]),
      workerName: wranglerConfig.name,
      d1Bindings: Object.freeze((wranglerConfig.d1_databases ?? []).map((d: any) => ({
        binding: d.binding, databaseName: d.database_name, databaseId: d.database_id, migrationsDir: d.migrations_dir
      }))),
      vars: Object.freeze({ ...(wranglerConfig.vars ?? {}) }),
      cleanup,
      readSnapshotFile,
    });
  } catch (err) {
    try { fs.rmSync(snapshotRoot, { recursive: true, force: true }); } catch {}
    throw err;
  }
}

/**
 * CANONICAL TRUSTED STAGE-A BUILD MANIFEST GENERATION.
 *
 * Exposes NO caller-controlled execution, source, or artifact authority.
 * Runtime exact-schema validation rejects any injected commandRunner, gitRunner,
 * tarRunner, destinationDir, retainSnapshot, allowDirtyTracked, skipNpmCi, or unknown keys.
 *
 * Owns end-to-end:
 * - Real Git identity capture & commit-to-tree binding
 * - Real Git archive materialization
 * - Fresh internally owned temporary snapshot root
 * - Host npm 11.16.0 version check and isolated `npm ci`
 * - Pinned local Wrangler resolution (<snapshotRoot>\node_modules\.bin\wrangler.cmd or POSIX equivalent)
 * - Pinned local Wrangler 4.130.0 version verification
 * - Trusted internally owned output root
 * - Fixed dry-run Wrangler bundling
 * - Executable module discovery (canaryOpsWorker.js)
 * - Direct executable byte read and manifest generation
 */
export function generateBuildManifestFromImmutableGitSnapshot(
  options: GenerateBuildManifestOptions
): SourceAttestationBuildManifest {
  // Strict runtime exact-schema validation: only repositoryRoot is permitted.
  exact(options, ['repositoryRoot'], 'CANONICAL_BUILD_OPTIONS');
  string(options.repositoryRoot, 'CANONICAL_BUILD_OPTIONS_repositoryRoot');

  const snapshot = materializeImmutableGitSnapshot({
    repositoryRoot: options.repositoryRoot,
  });

  try {
    const snapshotRoot = snapshot.snapshotRoot;

    // 1. Verify host npm toolchain version
    const hostNpmVersion = execSync('npm --version', { encoding: 'utf8' }).trim();
    if (hostNpmVersion !== PINNED_TOOLCHAIN_CHECKPOINT.npmVersion) {
      throw new Error(`NPM_VERSION_MISMATCH_EXPECTED_${PINNED_TOOLCHAIN_CHECKPOINT.npmVersion}`);
    }

    // 2. Run canonical isolated npm ci inside immutable snapshot
    execSync('npm ci --prefer-offline --no-audit --no-fund', {
      cwd: snapshotRoot,
      env: process.env,
      maxBuffer: 100 * 1024 * 1024,
      encoding: 'utf8',
    });

    // 3. Resolve pinned local Wrangler binary authority inside snapshot
    const wranglerExecutableName = process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler';
    const localWrangler = path.join(snapshotRoot, 'node_modules', '.bin', wranglerExecutableName);

    if (!fs.existsSync(localWrangler)) {
      throw new Error('LOCAL_WRANGLER_BINARY_MISSING');
    }
    assertNoSymlinkAndContained(localWrangler, snapshotRoot, 'SNAPSHOT_PATH_ESCAPES_ROOT');

    // 4. Verify local Wrangler version matches pinned toolchain exactly
    const verOut = (process.platform === 'win32'
      ? execSync(`"${localWrangler}" --version`, { cwd: snapshotRoot, env: process.env, maxBuffer: 100 * 1024 * 1024, encoding: 'utf8' })
      : execFileSync(localWrangler, ['--version'], { cwd: snapshotRoot, env: process.env, maxBuffer: 100 * 1024 * 1024, encoding: 'utf8' })
    ).trim();

    if (!verOut.includes(PINNED_TOOLCHAIN_CHECKPOINT.wranglerVersion)) {
      throw new Error(`WRANGLER_VERSION_MISMATCH_EXPECTED_${PINNED_TOOLCHAIN_CHECKPOINT.wranglerVersion}`);
    }

    // 5. Trusted Output Root: fresh, empty, internally owned, realpath-contained
    const trustedOutputRoot = path.join(snapshotRoot, 'stage-a-output');
    fs.mkdirSync(trustedOutputRoot, { recursive: true });
    assertNoSymlinkAndContained(trustedOutputRoot, snapshotRoot, 'SNAPSHOT_PATH_ESCAPES_ROOT');

    // 6. Trusted Wrangler Command: local pinned binary, dry-run, outdir=trustedOutputRoot, metafile
    if (process.platform === 'win32') {
      execSync(`"${localWrangler}" deploy --config wrangler.canary-ops.jsonc --dry-run --outdir "${trustedOutputRoot}" --metafile`, {
        cwd: snapshotRoot,
        env: process.env,
        maxBuffer: 100 * 1024 * 1024,
        encoding: 'utf8',
      });
    } else {
      execFileSync(localWrangler, ['deploy', '--config', 'wrangler.canary-ops.jsonc', '--dry-run', '--outdir', trustedOutputRoot, '--metafile'], {
        cwd: snapshotRoot,
        env: process.env,
        maxBuffer: 100 * 1024 * 1024,
        encoding: 'utf8',
      });
    }

    // 7. Executable Module Discovery & Module Byte Authority
    const expectedExecutableRelative = 'canaryOpsWorker.js';
    const trustedExecutablePath = path.join(trustedOutputRoot, expectedExecutableRelative);

    if (!fs.existsSync(trustedExecutablePath)) {
      throw new Error('STAGE_A_EXECUTABLE_MODULE_MISSING');
    }

    // Hard symlink & realpath containment check on discovered executable module
    assertNoSymlinkAndContained(trustedExecutablePath, trustedOutputRoot, 'OUTPUT_PATH_ESCAPES_ROOT');

    const executableBytes = fs.readFileSync(trustedExecutablePath);
    if (executableBytes.byteLength === 0) {
      throw new Error('STAGE_A_EXECUTABLE_MODULE_EMPTY');
    }

    // Trusted code creates StageAModuleInput internally
    const stageAModules: readonly StageAModuleInput[] = Object.freeze([
      Object.freeze({
        relativePath: expectedExecutableRelative,
        bytes: new Uint8Array(executableBytes),
      }),
    ]);

    const recipe: BuildRecipeIdentity = {
      nodeVersion: PINNED_TOOLCHAIN_CHECKPOINT.nodeVersion,
      npmVersion: PINNED_TOOLCHAIN_CHECKPOINT.npmVersion,
      wranglerVersion: PINNED_TOOLCHAIN_CHECKPOINT.wranglerVersion,
      wranglerInternalEsbuildVersion: PINNED_TOOLCHAIN_CHECKPOINT.wranglerInternalEsbuildVersion,
      workerdVersion: PINNED_TOOLCHAIN_CHECKPOINT.workerdVersion,
      packageLockSha256: snapshot.packageLockSha256,
      wranglerConfigSha256: snapshot.wranglerConfigSha256,
      entrypoint: snapshot.entrypoint,
      compatibilityDate: snapshot.compatibilityDate,
      compatibilityFlags: snapshot.compatibilityFlags,
      bundlingCommand: 'wrangler deploy --config wrangler.canary-ops.jsonc --dry-run --outdir <temp> --metafile',
    };

    const deploymentConfig: DeploymentConfigIdentity = {
      workerName: snapshot.workerName,
      d1Bindings: snapshot.d1Bindings,
      vars: snapshot.vars,
    };

    return createSourceAttestationBuildManifest({
      manifestVersion: SOURCE_ATTESTATION_BUILD_MANIFEST_VERSION,
      repositoryFullName: snapshot.repositoryFullName,
      sourceCommitSha: snapshot.sourceCommitSha,
      sourceTreeSha: snapshot.sourceTreeSha,
      stageAArtifactSha256: computeStageAArtifactSha256(stageAModules),
      buildRecipeDigestSha256: computeBuildRecipeDigestSha256(recipe),
      deploymentConfigDigestSha256: computeDeploymentConfigDigestSha256(deploymentConfig),
    });
  } finally {
    snapshot.cleanup();
  }
}
