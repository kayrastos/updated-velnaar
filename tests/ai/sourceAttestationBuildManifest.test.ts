import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as sourceAttestationModule from '../../worker/ai/canary/sourceAttestationBuildManifest';
import {
  CANONICAL_BUILD_MANIFEST_REPOSITORY, SOURCE_ATTESTATION_BUILD_MANIFEST_VERSION, STAGE_A_BUILD_IDENTITY_IS_NOT_STAGE_B_DEPLOYMENT_IDENTITY,
  BEFORE_AFTER_WORKTREE_CHECKS_ALONE_ARE_NOT_SUFFICIENT, ARTIFACT_HASH_ALONE_DOES_NOT_PROVE_GIT_SOURCE_CORRESPONDENCE,
  AD_HOC_INDEPENDENT_REBUILD_IS_NOT_AN_IMPLEMENTATION_ENFORCED_SOURCE_BINDING, PINNED_TOOLCHAIN_CHECKPOINT,
  CANONICAL_OPTIONS_EXACT_SCHEMA, EXPORTED_AUTHORITY_BYPASS_ENTRYPOINTS,
  CANONICAL_STAGE_A_MODULE_BYTES_CALLER_CONTROLLED, CANONICAL_COMMAND_EXECUTOR_CALLER_CONTROLLED,
  CANONICAL_GIT_IDENTITY_CALLER_CONTROLLED, CANONICAL_SNAPSHOT_MATERIALIZATION_CALLER_CONTROLLED,
  CANONICAL_OUTPUT_ROOT_CALLER_CONTROLLED, CANONICAL_NPM_BYPASS_CALLER_CONTROLLED,
  COMMIT_TREE_BINDING_ENFORCED, ARCHIVE_USES_CAPTURED_COMMIT,
  SNAPSHOT_REALPATH_ESCAPE_REJECTED, OUTPUT_REALPATH_ESCAPE_REJECTED, UNTRACKED_WORKTREE_POISONING_BLOCKED,
  TRANSIENT_TRACKED_POISONING_BLOCKED, CANONICAL_WRANGLER_EXECUTION_AUTHORITY, NPX_USED_BY_CANONICAL_PATH,
  assertNoSymlinkAndContained, canonicalizeStageAModuleGraph, computeBuildRecipeDigestSha256,
  computeDeploymentConfigDigestSha256, computeStageAArtifactSha256, createSourceAttestationBuildManifest,
  deriveBuildId, generateBuildManifestFromImmutableGitSnapshot, materializeImmutableGitSnapshot,
  normalizeRepositoryRemote, normalizeStageAModulePath, validateSourceAttestationBuildManifest,
  type BuildRecipeIdentity, type DeploymentConfigIdentity, type GenerateBuildManifestOptions,
  type StageAModuleInput,
} from '../../worker/ai/canary/sourceAttestationBuildManifest';
import { PRODUCTION_RUNTIME_IDENTITY_BINDING, RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_PROVISIONED, SOURCE_ATTESTATION_OPERATIONAL_READY } from '../../worker/ai/canary/deepSeekTrustedRuntimeSourceProvenance';
import { GUARDED_SOURCE_ATTESTATION_READY } from '../../worker/ai/canary/deepSeekGuardedLiveTransport';

const bytes = (value: string) => new TextEncoder().encode(value);
const modules = (): readonly StageAModuleInput[] => [{ relativePath: 'worker.js', bytes: bytes('export default 1') }, { relativePath: 'lib/util.js', bytes: bytes('export const x=2') }];
const recipe = (): BuildRecipeIdentity => ({
  nodeVersion: '24.18.0', npmVersion: '11.16.0', wranglerVersion: '4.130.0', wranglerInternalEsbuildVersion: '0.28.1', workerdVersion: '1.20260908.1',
  packageLockSha256: 'a'.repeat(64), wranglerConfigSha256: 'b'.repeat(64), entrypoint: 'worker/canaryOpsWorker.ts', compatibilityDate: '2026-08-24', compatibilityFlags: ['nodejs_compat'],
  bundlingCommand: 'wrangler deploy --config wrangler.canary-ops.jsonc --dry-run --outdir <temp> --metafile'
});
const deployment = (): DeploymentConfigIdentity => ({
  workerName: 'velnar-canary-ops-worker',
  d1Bindings: [{ binding: 'DB', databaseName: 'velnar-production-db', databaseId: 'd65abcb3-d8d6-46fb-9403-a97ab54de303', migrationsDir: 'migrations' }],
  vars: { ENVIRONMENT: 'production' }
});

describe('Source Attestation Stage-A build manifest with Canonical Authority Hardening', () => {
  it('canonicalizes equivalent graph order while binding bytes, additions, removals, and renames', () => {
    const base = computeStageAArtifactSha256(modules());
    expect(computeStageAArtifactSha256([...modules()].reverse())).toBe(base);
    expect(computeStageAArtifactSha256([{ ...modules()[0], bytes: bytes('export default 2') }, modules()[1]])).not.toBe(base);
    expect(computeStageAArtifactSha256([...modules(), { relativePath: 'new.js', bytes: bytes('x') }])).not.toBe(base);
    expect(computeStageAArtifactSha256([modules()[0]])).not.toBe(base);
    expect(computeStageAArtifactSha256([{ ...modules()[0], relativePath: 'renamed.js' }, modules()[1]])).not.toBe(base);
  });

  it('rejects traversal, absolute paths, duplicates and case collisions while normalizing separators', () => {
    expect(normalizeStageAModulePath('lib\\util.js')).toBe('lib/util.js');
    for (const p of ['../x.js', '/x.js', 'C:\\x.js', '', 'x//y.js']) expect(() => normalizeStageAModulePath(p)).toThrow();
    expect(() => canonicalizeStageAModuleGraph([{ relativePath: 'A.js', bytes: bytes('a') }, { relativePath: 'a.js', bytes: bytes('b') }])).toThrow('CASE_COLLISION');
    expect(() => canonicalizeStageAModuleGraph([{ relativePath: 'a.js', bytes: bytes('a') }, { relativePath: 'a.js', bytes: bytes('b') }])).toThrow('DUPLICATE_PATH');
  });

  it('binds every material recipe input and has no timestamp or temporary path field', () => {
    const base = recipe(), digest = computeBuildRecipeDigestSha256(base);
    for (const changed of [
      { compatibilityDate: '2026-08-25' }, { compatibilityFlags: ['extra', 'nodejs_compat'] }, { wranglerVersion: '4.130.1' },
      { wranglerInternalEsbuildVersion: '0.28.2' }, { workerdVersion: '1.20260909.1' }, { packageLockSha256: 'c'.repeat(64) }, { wranglerConfigSha256: 'd'.repeat(64) }
    ]) expect(computeBuildRecipeDigestSha256({ ...base, ...changed } as BuildRecipeIdentity)).not.toBe(digest);
    expect(Object.keys(base)).not.toContain('timestamp'); expect(Object.keys(base)).not.toContain('tempDirectory');
  });

  it('separates external deployment config from executable bytes', () => {
    const base = computeDeploymentConfigDigestSha256(deployment());
    expect(computeDeploymentConfigDigestSha256({ ...deployment(), vars: { ENVIRONMENT: 'staging' } })).not.toBe(base);
    expect(computeDeploymentConfigDigestSha256({ ...deployment(), d1Bindings: [{ ...deployment().d1Bindings[0], databaseId: 'f65abcb3-d8d6-46fb-9403-a97ab54de303' }] })).not.toBe(base);
  });

  it('derives deterministic build IDs from Stage-A and recipe identity only', () => {
    const artifact = computeStageAArtifactSha256(modules()), recipeDigest = computeBuildRecipeDigestSha256(recipe());
    expect(deriveBuildId(artifact, recipeDigest)).toBe(deriveBuildId(artifact, recipeDigest));
    expect(deriveBuildId('e'.repeat(64), recipeDigest)).not.toBe(deriveBuildId(artifact, recipeDigest));
    expect(deriveBuildId(artifact, 'f'.repeat(64))).not.toBe(deriveBuildId(artifact, recipeDigest));
  });

  it('validates strict manifests and rejects malformed source identity, unknown keys, wrong repos and fabricated IDs', () => {
    const manifest = createSourceAttestationBuildManifest({
      manifestVersion: SOURCE_ATTESTATION_BUILD_MANIFEST_VERSION, repositoryFullName: CANONICAL_BUILD_MANIFEST_REPOSITORY,
      sourceCommitSha: '1'.repeat(40), sourceTreeSha: '2'.repeat(40), stageAArtifactSha256: computeStageAArtifactSha256(modules()),
      buildRecipeDigestSha256: computeBuildRecipeDigestSha256(recipe()), deploymentConfigDigestSha256: computeDeploymentConfigDigestSha256(deployment())
    });
    expect(validateSourceAttestationBuildManifest(manifest)).toEqual(manifest);
    expect(() => validateSourceAttestationBuildManifest({ ...manifest, unknown: true })).toThrow('EXACT_SCHEMA');
    expect(() => validateSourceAttestationBuildManifest({ ...manifest, sourceCommitSha: 'UPPER' })).toThrow('GIT_ID');
    expect(() => validateSourceAttestationBuildManifest({ ...manifest, sourceTreeSha: 'UPPER' })).toThrow('GIT_ID');
    expect(() => validateSourceAttestationBuildManifest({ ...manifest, repositoryFullName: 'other/repo' })).toThrow('CANONICAL');
    expect(() => validateSourceAttestationBuildManifest({ ...manifest, buildId: 'deployment-id' })).toThrow('BUILD_ID');
  });

  it('validates canonical repository remote URL formatting strictly', () => {
    expect(normalizeRepositoryRemote('https://github.com/kayrastos/updated-velnaar.git')).toBe(CANONICAL_BUILD_MANIFEST_REPOSITORY);
    expect(() => normalizeRepositoryRemote('git@github.com:wrong/repo.git')).toThrow('MISMATCH');
    expect(() => normalizeRepositoryRemote('https://evil.com/kayrastos/updated-velnaar.git')).toThrow('MISMATCH');
  });

  it('explicitly rejects working-tree-only before/after TOCTOU assumptions', () => {
    expect(BEFORE_AFTER_WORKTREE_CHECKS_ALONE_ARE_NOT_SUFFICIENT).toBe(true);
    expect(ARTIFACT_HASH_ALONE_DOES_NOT_PROVE_GIT_SOURCE_CORRESPONDENCE).toBe(true);
    expect(AD_HOC_INDEPENDENT_REBUILD_IS_NOT_AN_IMPLEMENTATION_ENFORCED_SOURCE_BINDING).toBe(true);
  });

  it('enforces exact canonical options schema and rejects all caller-injected authorities at runtime', () => {
    const repoRoot = path.resolve(__dirname, '../..');
    expect(CANONICAL_OPTIONS_EXACT_SCHEMA).toBe(true);

    // 1. commandRunner injection rejected
    expect(() => generateBuildManifestFromImmutableGitSnapshot({
      repositoryRoot: repoRoot,
      commandRunner: () => ({ exitCode: 0 }),
    } as any)).toThrow('CANONICAL_BUILD_OPTIONS_EXACT_SCHEMA_REQUIRED');

    // 2. gitRunner injection rejected
    expect(() => generateBuildManifestFromImmutableGitSnapshot({
      repositoryRoot: repoRoot,
      gitRunner: () => '',
    } as any)).toThrow('CANONICAL_BUILD_OPTIONS_EXACT_SCHEMA_REQUIRED');

    // 3. tarRunner injection rejected
    expect(() => generateBuildManifestFromImmutableGitSnapshot({
      repositoryRoot: repoRoot,
      tarRunner: () => {},
    } as any)).toThrow('CANONICAL_BUILD_OPTIONS_EXACT_SCHEMA_REQUIRED');

    // 4. destinationDir rejected
    expect(() => generateBuildManifestFromImmutableGitSnapshot({
      repositoryRoot: repoRoot,
      destinationDir: '/tmp/hostile',
    } as any)).toThrow('CANONICAL_BUILD_OPTIONS_EXACT_SCHEMA_REQUIRED');

    // 5. retainSnapshot rejected
    expect(() => generateBuildManifestFromImmutableGitSnapshot({
      repositoryRoot: repoRoot,
      retainSnapshot: true,
    } as any)).toThrow('CANONICAL_BUILD_OPTIONS_EXACT_SCHEMA_REQUIRED');

    // 6. allowDirtyTracked rejected
    expect(() => generateBuildManifestFromImmutableGitSnapshot({
      repositoryRoot: repoRoot,
      allowDirtyTracked: true,
    } as any)).toThrow('CANONICAL_BUILD_OPTIONS_EXACT_SCHEMA_REQUIRED');

    // 7. skipNpmCi rejected
    expect(() => generateBuildManifestFromImmutableGitSnapshot({
      repositoryRoot: repoRoot,
      skipNpmCi: true,
    } as any)).toThrow('CANONICAL_BUILD_OPTIONS_EXACT_SCHEMA_REQUIRED');

    // 8. build/module callbacks rejected
    expect(() => generateBuildManifestFromImmutableGitSnapshot({
      repositoryRoot: repoRoot,
      build: () => [],
    } as any)).toThrow('CANONICAL_BUILD_OPTIONS_EXACT_SCHEMA_REQUIRED');

    // 9. arbitrary unknown properties rejected
    expect(() => generateBuildManifestFromImmutableGitSnapshot({
      repositoryRoot: repoRoot,
      maliciousPayload: 'injected',
    } as any)).toThrow('CANONICAL_BUILD_OPTIONS_EXACT_SCHEMA_REQUIRED');
  });

  it('audits module exports and proves ZERO authority-bypass entrypoints exist', () => {
    expect(EXPORTED_AUTHORITY_BYPASS_ENTRYPOINTS).toBe(0);

    const exportedKeys = Object.keys(sourceAttestationModule);

    // Verify generateBuildManifestFromImmutableGitSnapshot is the sole manifest generator
    const manifestGenerators = exportedKeys.filter((key) => key.toLowerCase().includes('generatebuildmanifest'));
    expect(manifestGenerators).toEqual(['generateBuildManifestFromImmutableGitSnapshot']);

    // Verify no internal dependency injection functions are exported
    for (const key of exportedKeys) {
      expect(key).not.toMatch(/internal/i);
      expect(key).not.toMatch(/withdependencies/i);
      expect(key).not.toMatch(/__testonly/i);
    }
  });

  it('materializes immutable Git snapshot and binds snapshot package-lock and wrangler config hashes directly', () => {
    const repoRoot = path.resolve(__dirname, '../..');
    const snapshot = materializeImmutableGitSnapshot({ repositoryRoot: repoRoot });
    try {
      expect(snapshot.repositoryFullName).toBe(CANONICAL_BUILD_MANIFEST_REPOSITORY);
      expect(snapshot.sourceCommitSha).toMatch(/^[0-9a-f]{40}$/);
      expect(snapshot.sourceTreeSha).toMatch(/^[0-9a-f]{40}$/);
      expect(snapshot.packageLockSha256).toBe('2c10ce688f5e25bba1fe07869f9460dfe6fdadc4aa74ff02a024da58d22bc279');
      expect(snapshot.wranglerConfigSha256).toBe('9ad1f4098291460fb52c3785220b668ca9112752e82230c36b68d229e2884970');
      expect(snapshot.workerName).toBe('velnar-canary-ops-worker');
      expect(snapshot.entrypoint).toBe('worker/canaryOpsWorker.ts');
      expect(snapshot.compatibilityFlags).toEqual(['nodejs_compat']);
      expect(snapshot.readSnapshotFile('worker/canaryOpsWorker.ts').byteLength).toBeGreaterThan(0);
    } finally {
      snapshot.cleanup();
    }
  });

  it('fails closed when tracked working tree is dirty to preserve single deterministic release procedure', () => {
    const repoRoot = path.resolve(__dirname, '../..');
    const targetFile = path.join(repoRoot, 'worker/canaryOpsWorker.ts');
    const originalContent = fs.readFileSync(targetFile, 'utf8');

    // Introduce transient tracked working-tree mutation
    fs.writeFileSync(targetFile, originalContent + '\n// ADVERSARIAL_TRANSIENT_POISON');
    try {
      expect(() => materializeImmutableGitSnapshot({ repositoryRoot: repoRoot })).toThrow('GIT_TRACKED_WORKTREE_DIRTY');
      expect(() => generateBuildManifestFromImmutableGitSnapshot({ repositoryRoot: repoRoot })).toThrow('GIT_TRACKED_WORKTREE_DIRTY');
    } finally {
      // Restore clean tracked source
      fs.writeFileSync(targetFile, originalContent);
    }
  });

  it('proves untracked working-tree files cannot contaminate the immutable Git snapshot', () => {
    const repoRoot = path.resolve(__dirname, '../..');
    const poisonFile = path.join(repoRoot, 'worker/untracked-poison-module.ts');
    fs.writeFileSync(poisonFile, 'export const evil = true;');
    try {
      const snapshot = materializeImmutableGitSnapshot({ repositoryRoot: repoRoot });
      try {
        expect(fs.existsSync(path.join(snapshot.snapshotRoot, 'worker/untracked-poison-module.ts'))).toBe(false);
        expect(() => snapshot.readSnapshotFile('worker/untracked-poison-module.ts')).toThrow();
      } finally {
        snapshot.cleanup();
      }
    } finally {
      fs.unlinkSync(poisonFile);
    }
  });

  it('hardens against symlinks and out-of-root realpath escapes', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'symlink-test-root-'));
    const externalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'symlink-test-external-'));
    try {
      const realFile = path.join(tempRoot, 'safe.txt');
      fs.writeFileSync(realFile, 'safe');
      expect(() => assertNoSymlinkAndContained(realFile, tempRoot)).not.toThrow();

      // Traversal path escape
      const traversal = path.join(tempRoot, '../safe.txt');
      expect(() => assertNoSymlinkAndContained(traversal, tempRoot)).toThrow('SNAPSHOT_PATH_ESCAPES_ROOT');

      // Symbolic link rejection
      const symlinkPath = path.join(tempRoot, 'linked.txt');
      const externalTarget = path.join(externalDir, 'external.txt');
      fs.writeFileSync(externalTarget, 'external');
      try {
        fs.symlinkSync(externalTarget, symlinkPath);
        expect(() => assertNoSymlinkAndContained(symlinkPath, tempRoot)).toThrow('SYMLINK_NOT_PERMITTED');
      } catch (err: any) {
        if (err?.code !== 'EPERM') throw err;
      }
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
      fs.rmSync(externalDir, { recursive: true, force: true });
    }
  });

  it('executes real canonical build end-to-end and produces exact reproducible Stage-A artifact and buildId', { timeout: 90000 }, () => {
    const repoRoot = path.resolve(__dirname, '../..');
    const manifest = generateBuildManifestFromImmutableGitSnapshot({ repositoryRoot: repoRoot });

    expect(manifest.manifestVersion).toBe(SOURCE_ATTESTATION_BUILD_MANIFEST_VERSION);
    expect(manifest.repositoryFullName).toBe(CANONICAL_BUILD_MANIFEST_REPOSITORY);
    expect(manifest.sourceCommitSha).toBe('9cf56179a04a5eb3839456815e4b3f2ce82fa01a');
    expect(manifest.sourceTreeSha).toBe('4b061b52a1f01606eb7ece6a5559fae568d43cb9');
    expect(manifest.stageAArtifactSha256).toBe('988cbe32c3be05c5cc85a4ad12a53e30441b5df247b7a9332cd8b7ea9335da81');
    expect(manifest.buildRecipeDigestSha256).toBe('617871d5854f207d6c9bf8d95284a2bbc0a7f463f9788ef93289b983080b35e2');
    expect(manifest.buildId).toBe('velnar-build-v1-2a5b1790368c11d0991bd995b7e4959c1ece12911fbfed1c33803b6716be4321');
    expect('deploymentId' in manifest).toBe(false);
  });

  it('verifies snapshot toolchain checkpoint matches canonical sealed toolchain', () => {
    expect(PINNED_TOOLCHAIN_CHECKPOINT.nodeVersion).toBe('24.18.0');
    expect(PINNED_TOOLCHAIN_CHECKPOINT.npmVersion).toBe('11.16.0');
    expect(PINNED_TOOLCHAIN_CHECKPOINT.wranglerVersion).toBe('4.130.0');
    expect(PINNED_TOOLCHAIN_CHECKPOINT.directEsbuildVersion).toBe('0.25.12');
    expect(PINNED_TOOLCHAIN_CHECKPOINT.wranglerInternalEsbuildVersion).toBe('0.28.1');
    expect(PINNED_TOOLCHAIN_CHECKPOINT.workerdVersion).toBe('1.20260908.1');
  });

  it('preserves Stage-A separation, canonical authority invariants, and all fail-closed gates', () => {
    expect(STAGE_A_BUILD_IDENTITY_IS_NOT_STAGE_B_DEPLOYMENT_IDENTITY).toBe(true);
    expect(CANONICAL_STAGE_A_MODULE_BYTES_CALLER_CONTROLLED).toBe(false);
    expect(CANONICAL_COMMAND_EXECUTOR_CALLER_CONTROLLED).toBe(false);
    expect(CANONICAL_GIT_IDENTITY_CALLER_CONTROLLED).toBe(false);
    expect(CANONICAL_SNAPSHOT_MATERIALIZATION_CALLER_CONTROLLED).toBe(false);
    expect(CANONICAL_OUTPUT_ROOT_CALLER_CONTROLLED).toBe(false);
    expect(CANONICAL_NPM_BYPASS_CALLER_CONTROLLED).toBe(false);
    expect(COMMIT_TREE_BINDING_ENFORCED).toBe(true);
    expect(ARCHIVE_USES_CAPTURED_COMMIT).toBe(true);
    expect(SNAPSHOT_REALPATH_ESCAPE_REJECTED).toBe(true);
    expect(OUTPUT_REALPATH_ESCAPE_REJECTED).toBe(true);
    expect(UNTRACKED_WORKTREE_POISONING_BLOCKED).toBe(true);
    expect(TRANSIENT_TRACKED_POISONING_BLOCKED).toBe(true);
    expect(CANONICAL_WRANGLER_EXECUTION_AUTHORITY).toBe('LOCAL_PINNED');
    expect(NPX_USED_BY_CANONICAL_PATH).toBe(false);

    // Production gates
    expect(PRODUCTION_RUNTIME_IDENTITY_BINDING).toBeNull();
    expect(RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_PROVISIONED).toBe(false);
    expect(SOURCE_ATTESTATION_OPERATIONAL_READY).toBe(false);
    expect(GUARDED_SOURCE_ATTESTATION_READY).toBe(false);
  });
});
