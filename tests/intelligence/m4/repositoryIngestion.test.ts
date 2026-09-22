import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';
import { FIXTURES } from '../m2/support/catalog';
import { loadFixture } from '../m2/support/loadFixture';
import { INGESTION_LIMITS, hash } from '../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress } from '../../../worker/intelligence/ingestion/express';
import { detectSqlInjection } from '../../../worker/intelligence/detection/sqlInjection';
import {
  ingestRepository,
  verifyCommittedRepository,
  validateRepositoryIngestion,
  assertTrustedCommitCapability,
  isTrustedCommitCapability,
  readBoundedMetadataFile,
  MAX_METADATA_BYTES,
  MAX_PACKED_REFS_BYTES,
  MAX_PACK_INDEX_BYTES,
} from '../../../worker/intelligence/ingestion/repository';

const org = 'org_m4';
const trustedStagingRoot = path.resolve('node_modules/.cache');
const previousTrustedStagingRoot = process.env.VELNAR_M4_TRUSTED_STAGING_ROOT;

fs.mkdirSync(trustedStagingRoot, { recursive: true });
process.env.VELNAR_M4_TRUSTED_STAGING_ROOT = trustedStagingRoot;

afterAll(() => {
  if (previousTrustedStagingRoot === undefined) {
    delete process.env.VELNAR_M4_TRUSTED_STAGING_ROOT;
  } else {
    process.env.VELNAR_M4_TRUSTED_STAGING_ROOT = previousTrustedStagingRoot;
  }
});

function runGit(repoPath: string, args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.toUpperCase().startsWith('GIT_')));
  Object.assign(env, {
    GIT_AUTHOR_NAME: 'Test Author',
    GIT_AUTHOR_EMAIL: 'author@example.com',
    GIT_AUTHOR_DATE: '2026-09-01T00:00:00Z',
    GIT_COMMITTER_NAME: 'Test Committer',
    GIT_COMMITTER_EMAIL: 'committer@example.com',
    GIT_COMMITTER_DATE: '2026-09-01T00:00:00Z',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: 'NUL',
  });
  return execFileSync('git', args, { cwd: repoPath, env, encoding: 'utf8', shell: false, windowsHide: true }).trim();
}

function createGitRepo(repoDir: string, files: readonly { path: string; content: string }[]): string {
  fs.mkdirSync(repoDir, { recursive: true });
  runGit(repoDir, ['init', '-b', 'main']);
  runGit(repoDir, ['config', 'user.name', 'Test Committer']);
  runGit(repoDir, ['config', 'user.email', 'committer@example.com']);
  for (const file of files) {
    const fullPath = path.join(repoDir, file.path);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, file.content, 'utf8');
  }
  runGit(repoDir, ['add', '.']);
  runGit(repoDir, ['commit', '-m', 'initial commit']);
  return runGit(repoDir, ['rev-parse', 'HEAD']);
}

function cleanupDir(dir: string): void {
  if (!fs.existsSync(dir)) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Safe test cleanup ignore
  }
}

describe('M4 Bounded Local Repository Snapshot Ingestion', () => {
  it('ingests canonical M2 fixture 0 into trusted snapshot and yields DETECTED SQLi analysis', async () => {
    const repoDir = path.resolve('node_modules/.cache/m4-canonical-ingest');
    try {
      const canonicalInput = loadFixture(FIXTURES[0].fixtureId, org);
      const commitSha = createGitRepo(repoDir, canonicalInput.files);

      const result = await ingestRepository({
        repositoryPath: repoDir,
        organizationId: org,
        repositoryId: 'local-express-benchmark',
        fixtureId: FIXTURES[0].fixtureId,
      });

      assertTrustedCommitCapability(result.capability, result.ingestion);
      expect(isTrustedCommitCapability(result.capability, result.ingestion)).toBe(true);
      expect(result.ingestion.commitSha).toBe(commitSha);
      expect(result.ingestion.snapshot.files.length).toBe(canonicalInput.files.length);

      const expressIngestion = await ingestExpress(result.ingestion.snapshot, org);
      const analysis = await detectSqlInjection(result.ingestion.snapshot, expressIngestion, org);
      expect(analysis.status).toBe('DETECTED');
      expect(analysis.findings.length).toBeGreaterThan(0);
    } finally {
      cleanupDir(repoDir);
    }
  });

  it('preserves snapshot identity across different machine paths while binding distinct commit provenance', async () => {
    const repoA = path.resolve('node_modules/.cache/m4-det-path-a');
    const repoB = path.resolve('node_modules/.cache/m4-det-path-b');
    try {
      const files = [{ path: 'src/routes.ts', content: 'export const value = 42;\n' }];
      const shaA = createGitRepo(repoA, files);
      const shaB = createGitRepo(repoB, files);

      const resultA = await ingestRepository({ repositoryPath: repoA, organizationId: org, repositoryId: 'repo-det' });
      const resultB = await ingestRepository({ repositoryPath: repoB, organizationId: org, repositoryId: 'repo-det' });

      expect(resultA.ingestion.snapshot.snapshotId).toBe(resultB.ingestion.snapshot.snapshotId);
      expect(resultA.ingestion.commitSha).toBe(shaA);
      expect(resultB.ingestion.commitSha).toBe(shaB);
    } finally {
      cleanupDir(repoA);
      cleanupDir(repoB);
    }
  });

  it('prevents forged commit provenance from minting runtime authority capability', async () => {
    const repoDir = path.resolve('node_modules/.cache/m4-forged-authority');
    try {
      const files = [{ path: 'src/routes.ts', content: 'export const token = "abc";\n' }];
      createGitRepo(repoDir, files);

      const genuine = await ingestRepository({ repositoryPath: repoDir, organizationId: org, repositoryId: 'repo-auth' });
      assertTrustedCommitCapability(genuine.capability, genuine.ingestion);

      const forgedSha = 'f'.repeat(40);
      const forgedBody = {
        version: genuine.ingestion.version,
        organizationId: genuine.ingestion.organizationId,
        repositoryId: genuine.ingestion.repositoryId,
        commitSha: forgedSha,
        snapshot: genuine.ingestion.snapshot,
      };
      const forgedIdentity = await hash('velnar-repository-ingestion-v1', forgedBody);
      const forgedRecord = {
        ...forgedBody,
        ingestionIdentity: forgedIdentity,
      };

      const structural = await validateRepositoryIngestion(forgedRecord, org);
      expect((structural as any).capability).toBeUndefined();

      await expect(verifyCommittedRepository(repoDir, forgedRecord, org)).rejects.toThrow();

      const verified = await verifyCommittedRepository(repoDir, genuine.ingestion, org);
      assertTrustedCommitCapability(verified.capability, verified.ingestion);
    } finally {
      cleanupDir(repoDir);
    }
  });

  it('snapshots mutable caller options before the first await boundary', async () => {
    const repoDir = path.resolve('node_modules/.cache/m4-mutable-options');

    try {
      const files = [{
        path: 'src/routes.ts',
        content: 'export const stable = true;\n',
      }];

      createGitRepo(repoDir, files);

      const options: any = {
        repositoryPath: repoDir,
        organizationId: org,
        repositoryId: 'repo-original',
      };

      const promise = ingestRepository(options);

      options.organizationId = 'org_mutated';
      options.repositoryId = 'repo-mutated';

      const result = await promise;

      expect(result.ingestion.organizationId).toBe(org);
      expect(result.ingestion.repositoryId).toBe('repo-original');
      expect(result.ingestion.snapshot.organizationId).toBe(org);
      expect(result.ingestion.snapshot.repositoryId).toBe('repo-original');

      assertTrustedCommitCapability(
        result.capability,
        result.ingestion,
      );
    } finally {
      cleanupDir(repoDir);
    }
  });

  it('reads accessor-backed caller identity fields exactly once', async () => {
    const repoDir = path.resolve('node_modules/.cache/m4-accessor-options');

    try {
      const files = [{
        path: 'src/routes.ts',
        content: 'export const accessor = true;\n',
      }];

      createGitRepo(repoDir, files);

      let repositoryPathReads = 0;
      let organizationReads = 0;
      let repositoryReads = 0;

      const options: any = {
        get repositoryPath() {
          repositoryPathReads++;
          return repoDir;
        },
        get organizationId() {
          organizationReads++;
          return org;
        },
        get repositoryId() {
          repositoryReads++;
          return 'repo-accessor';
        },
      };

      const result =
        await ingestRepository(options);

      expect(repositoryPathReads).toBe(1);
      expect(organizationReads).toBe(1);
      expect(repositoryReads).toBe(1);

      assertTrustedCommitCapability(
        result.capability,
        result.ingestion,
      );
    } finally {
      cleanupDir(repoDir);
    }
  });

  it('binds runtime capability to the exact verified ingestion object', async () => {
    const repoDir = path.resolve('node_modules/.cache/m4-capability-binding');

    try {
      const files = [{
        path: 'src/routes.ts',
        content: 'export const bound = true;\n',
      }];

      createGitRepo(repoDir, files);

      const genuine =
        await ingestRepository({
          repositoryPath: repoDir,
          organizationId: org,
          repositoryId: 'repo-cap-a',
        });

      const other =
        await ingestRepository({
          repositoryPath: repoDir,
          organizationId: org,
          repositoryId: 'repo-cap-b',
        });

      expect(
        isTrustedCommitCapability(
          genuine.capability,
          genuine.ingestion,
        ),
      ).toBe(true);

      const clonedCapability = {
        ...genuine.capability,
      };

      expect(
        isTrustedCommitCapability(
          clonedCapability,
          genuine.ingestion,
        ),
      ).toBe(false);

      const spreadIngestion = {
        ...genuine.ingestion,
      };

      expect(
        isTrustedCommitCapability(
          genuine.capability,
          spreadIngestion,
        ),
      ).toBe(false);

      const jsonRoundTrip =
        JSON.parse(
          JSON.stringify(
            genuine.ingestion,
          ),
        );

      expect(
        isTrustedCommitCapability(
          genuine.capability,
          jsonRoundTrip,
        ),
      ).toBe(false);

      expect(
        isTrustedCommitCapability(
          genuine.capability,
          other.ingestion,
        ),
      ).toBe(false);

      const substituted = {
        ...genuine,
        ingestion:
          other.ingestion,
      };

      expect(() =>
        assertTrustedCommitCapability(
          substituted.capability,
          substituted.ingestion,
        ),
      ).toThrow();
    } finally {
      cleanupDir(repoDir);
    }
  });
  it('rejects oversized Git blob by size preflight before materialization', async () => {
    const repoDir = path.resolve('node_modules/.cache/m4-oversized-blob');
    try {
      const files = [{ path: 'src/routes.ts', content: 'x'.repeat(INGESTION_LIMITS.maxFileBytes + 1) }];
      createGitRepo(repoDir, files);
      await expect(ingestRepository({ repositoryPath: repoDir, organizationId: org, repositoryId: 'repo-oversized' })).rejects.toThrow('Git object exceeds maxFileBytes');
    } finally {
      cleanupDir(repoDir);
    }
  });

  it('rejects repositories exceeding maxFiles limit', async () => {
    const repoDir = path.resolve('node_modules/.cache/m4-file-count');
    try {
      const files = Array.from({ length: INGESTION_LIMITS.maxFiles + 1 }, (_, i) => ({
        path: `src/f${i}.ts`,
        content: `export const f${i} = ${i};\n`,
      }));
      createGitRepo(repoDir, files);
      await expect(ingestRepository({ repositoryPath: repoDir, organizationId: org, repositoryId: 'repo-files' })).rejects.toThrow();
    } finally {
      cleanupDir(repoDir);
    }
  }, 30000);

  it('refuses loose-object and refs junction indirection', async () => {
    const looseRepo = path.resolve('node_modules/.cache/m4-loose-object-link');
    const refsRepo = path.resolve('node_modules/.cache/m4-refs-link');
    const outsideDir = path.resolve('node_modules/.cache/m4-internal-link-outside');

    try {
      fs.mkdirSync(outsideDir, { recursive: true });

      createGitRepo(looseRepo, [{
        path: 'src/routes.ts',
        content: 'export const loose = true;\n',
      }]);

      const objectsDir =
        path.join(looseRepo, '.git', 'objects');

      const fanout =
        fs.readdirSync(objectsDir).find(
          (name) =>
            /^[0-9a-f]{2}$/i.test(name),
        );

      if (!fanout) {
        throw new Error(
          'fixture construction failed: loose object fanout missing',
        );
      }

      fs.symlinkSync(
        outsideDir,
        path.join(
          objectsDir,
          fanout,
          'escape-junction',
        ),
        'junction',
      );

      await expect(
        ingestRepository({
          repositoryPath: looseRepo,
          organizationId: org,
          repositoryId: 'repo-loose-link',
        }),
      ).rejects.toThrow();

      createGitRepo(refsRepo, [{
        path: 'src/routes.ts',
        content: 'export const refs = true;\n',
      }]);

      fs.symlinkSync(
        outsideDir,
        path.join(
          refsRepo,
          '.git',
          'refs',
          'escape-junction',
        ),
        'junction',
      );

      await expect(
        ingestRepository({
          repositoryPath: refsRepo,
          organizationId: org,
          repositoryId: 'repo-refs-link',
        }),
      ).rejects.toThrow();
    } finally {
      cleanupDir(looseRepo);
      cleanupDir(refsRepo);
      cleanupDir(outsideDir);
    }
  });

  it('refuses pack metadata junction indirection', async () => {
    const repoDir = path.resolve('node_modules/.cache/m4-pack-link');
    const outsideDir = path.resolve('node_modules/.cache/m4-pack-outside');

    try {
      createGitRepo(repoDir, [{
        path: 'src/routes.ts',
        content: 'export const pack = true;\n',
      }]);

      fs.mkdirSync(outsideDir, { recursive: true });

      const packDir =
        path.join(
          repoDir,
          '.git',
          'objects',
          'pack',
        );

      fs.mkdirSync(packDir, { recursive: true });

      fs.symlinkSync(
        outsideDir,
        path.join(packDir, 'escape-junction'),
        'junction',
      );

      await expect(
        ingestRepository({
          repositoryPath: repoDir,
          organizationId: org,
          repositoryId: 'repo-pack-link',
        }),
      ).rejects.toThrow();
    } finally {
      cleanupDir(repoDir);
      cleanupDir(outsideDir);
    }
  });

  it('rejects repository-controlled config includes and config.worktree', async () => {
    const includeRepo = path.resolve('node_modules/.cache/m4-config-include');
    const worktreeConfigRepo = path.resolve('node_modules/.cache/m4-config-worktree');

    try {
      createGitRepo(includeRepo, [{
        path: 'src/routes.ts',
        content: 'export const config = true;\n',
      }]);

      fs.appendFileSync(
        path.join(includeRepo, '.git', 'config'),
        '\n[include]\n\tpath = C:/not-allowed/config\n',
        'utf8',
      );

      await expect(
        ingestRepository({
          repositoryPath: includeRepo,
          organizationId: org,
          repositoryId: 'repo-config-include',
        }),
      ).rejects.toThrow('Git config include refused');

      createGitRepo(worktreeConfigRepo, [{
        path: 'src/routes.ts',
        content: 'export const worktreeConfig = true;\n',
      }]);

      fs.writeFileSync(
        path.join(
          worktreeConfigRepo,
          '.git',
          'config.worktree',
        ),
        '[core]\n\tbare = false\n',
        'utf8',
      );

      await expect(
        ingestRepository({
          repositoryPath: worktreeConfigRepo,
          organizationId: org,
          repositoryId: 'repo-config-worktree',
        }),
      ).rejects.toThrow('Git config.worktree refused');
    } finally {
      cleanupDir(includeRepo);
      cleanupDir(worktreeConfigRepo);
    }
  });

  it('rejects same-line include and includeIf directives before Git execution', async () => {
    const includeRepo =
      path.resolve(
        'node_modules/.cache/m4-config-same-line-include',
      );

    const includeIfRepo =
      path.resolve(
        'node_modules/.cache/m4-config-same-line-include-if',
      );

    try {
      createGitRepo(
        includeRepo,
        [{
          path: 'src/routes.ts',
          content:
            'export const includeSameLine = true;\n',
        }],
      );

      fs.appendFileSync(
        path.join(
          includeRepo,
          '.git',
          'config',
        ),
        '\n[include] path = //server/share/outside-config # trailing comment\n',
        'utf8',
      );

      await expect(
        ingestRepository({
          repositoryPath:
            includeRepo,
          organizationId: org,
          repositoryId:
            'repo-config-same-line-include',
        }),
      ).rejects.toThrow(
        'Git config include refused',
      );

      createGitRepo(
        includeIfRepo,
        [{
          path: 'src/routes.ts',
          content:
            'export const includeIfSameLine = true;\n',
        }],
      );

      fs.appendFileSync(
        path.join(
          includeIfRepo,
          '.git',
          'config',
        ),
        '\n[includeIf "gitdir:C:/workspace/"] path = //server/share/outside-config ; trailing comment\n',
        'utf8',
      );

      await expect(
        ingestRepository({
          repositoryPath:
            includeIfRepo,
          organizationId: org,
          repositoryId:
            'repo-config-same-line-include-if',
        }),
      ).rejects.toThrow(
        'Git config include refused',
      );
    } finally {
      cleanupDir(includeRepo);
      cleanupDir(includeIfRepo);
    }
  });
  it('bounds packed refs and pack-index metadata before Git execution', async () => {
    const packedRefsRepo = path.resolve('node_modules/.cache/m4-packed-refs-bound');
    const packIndexRepo = path.resolve('node_modules/.cache/m4-pack-index-bound');

    try {
      createGitRepo(packedRefsRepo, [{
        path: 'src/routes.ts',
        content: 'export const packedRefs = true;\n',
      }]);

      fs.writeFileSync(
        path.join(
          packedRefsRepo,
          '.git',
          'packed-refs',
        ),
        'x'.repeat(
          MAX_PACKED_REFS_BYTES + 1,
        ),
        'utf8',
      );

      await expect(
        ingestRepository({
          repositoryPath: packedRefsRepo,
          organizationId: org,
          repositoryId: 'repo-packed-refs-bound',
        }),
      ).rejects.toThrow(
        'Git packed-refs exceeds metadata size boundary',
      );

      createGitRepo(packIndexRepo, [{
        path: 'src/routes.ts',
        content: 'export const packIndex = true;\n',
      }]);

      const packDir =
        path.join(
          packIndexRepo,
          '.git',
          'objects',
          'pack',
        );

      fs.mkdirSync(
        packDir,
        { recursive: true },
      );

      fs.writeFileSync(
        path.join(
          packDir,
          'pack-test.idx',
        ),
        Buffer.alloc(
          MAX_PACK_INDEX_BYTES + 1,
        ),
      );

      await expect(
        ingestRepository({
          repositoryPath: packIndexRepo,
          organizationId: org,
          repositoryId: 'repo-pack-index-bound',
        }),
      ).rejects.toThrow(
        'Git pack index metadata exceeds metadata size boundary',
      );
    } finally {
      cleanupDir(packedRefsRepo);
      cleanupDir(packIndexRepo);
    }
  });

  it('fails closed on directory-form .git/commondir before external common config can reach Git', async () => {
    const repoDir =
      path.resolve(
        'node_modules/.cache/m4-directory-commondir',
      );

    const outsideCommon =
      path.resolve(
        'node_modules/.cache/m4-directory-commondir-outside',
      );

    try {
      createGitRepo(
        repoDir,
        [{
          path: 'src/routes.ts',
          content:
            'export const directoryCommonDir = true;\n',
        }],
      );

      fs.mkdirSync(
        outsideCommon,
        { recursive: true },
      );

      fs.writeFileSync(
        path.join(
          outsideCommon,
          'config',
        ),
        '[include] path = //server/share/outside-config\n',
        'utf8',
      );

      fs.writeFileSync(
        path.join(
          repoDir,
          '.git',
          'commondir',
        ),
        `${outsideCommon}\n`,
        'utf8',
      );

      await expect(
        ingestRepository({
          repositoryPath:
            repoDir,
          organizationId:
            org,
          repositoryId:
            'repo-directory-commondir',
        }),
      ).rejects.toThrow(
        'Git commondir in directory repository refused',
      );
    } finally {
      cleanupDir(repoDir);
      cleanupDir(outsideCommon);
    }
  });
  it('rejects unsafe gitdir and commondir junction targets before invoking Git', async () => {
    const gitdirRoot = path.resolve('node_modules/.cache/m4-gitdir-root');
    const gitdirOutside = path.resolve('node_modules/.cache/m4-gitdir-outside');
    const gitdirJunction = path.resolve('node_modules/.cache/m4-gitdir-junction');

    const commonRoot = path.resolve('node_modules/.cache/m4-common-root');
    const commonGitDir = path.resolve('node_modules/.cache/m4-common-gitdir');
    const commonOutside = path.resolve('node_modules/.cache/m4-common-outside');
    const commonJunction = path.resolve('node_modules/.cache/m4-common-junction');

    try {
      fs.mkdirSync(gitdirRoot, { recursive: true });
      fs.mkdirSync(gitdirOutside, { recursive: true });

      fs.symlinkSync(
        gitdirOutside,
        gitdirJunction,
        'junction',
      );

      fs.writeFileSync(
        path.join(gitdirRoot, '.git'),
        `gitdir: ${gitdirJunction}\n`,
        'utf8',
      );

      await expect(
        ingestRepository({
          repositoryPath: gitdirRoot,
          organizationId: org,
          repositoryId: 'repo-gitdir-junction',
        }),
      ).rejects.toThrow();

      fs.mkdirSync(commonRoot, { recursive: true });
      fs.mkdirSync(commonGitDir, { recursive: true });
      fs.mkdirSync(commonOutside, { recursive: true });

      fs.writeFileSync(
        path.join(commonRoot, '.git'),
        `gitdir: ${commonGitDir}\n`,
        'utf8',
      );

      fs.symlinkSync(
        commonOutside,
        commonJunction,
        'junction',
      );

      fs.writeFileSync(
        path.join(
          commonGitDir,
          'commondir',
        ),
        `${commonJunction}\n`,
        'utf8',
      );

      await expect(
        ingestRepository({
          repositoryPath: commonRoot,
          organizationId: org,
          repositoryId: 'repo-commondir-junction',
        }),
      ).rejects.toThrow();
    } finally {
      cleanupDir(gitdirRoot);
      cleanupDir(gitdirJunction);
      cleanupDir(gitdirOutside);

      cleanupDir(commonRoot);
      cleanupDir(commonGitDir);
      cleanupDir(commonJunction);
      cleanupDir(commonOutside);
    }
  });
  it('refuses internal Git metadata symlink or junction redirection', async () => {
    const repoDir = path.resolve('node_modules/.cache/m4-meta-link');
    const outsideDir = path.resolve('node_modules/.cache/m4-meta-outside');
    try {
      const files = [{ path: 'src/routes.ts', content: 'export const item = 1;\n' }];
      createGitRepo(repoDir, files);
      fs.mkdirSync(outsideDir, { recursive: true });
      const objectsInfoDir = path.join(repoDir, '.git', 'objects', 'info');
      fs.mkdirSync(objectsInfoDir, { recursive: true });
      const linkTarget = path.join(objectsInfoDir, 'escape-link');
      fs.symlinkSync(outsideDir, linkTarget, 'junction');
      await expect(ingestRepository({ repositoryPath: repoDir, organizationId: org, repositoryId: 'repo-link' })).rejects.toThrow();
    } finally {
      cleanupDir(repoDir);
      cleanupDir(outsideDir);
    }
  });

  it('bounds metadata reads and rejects oversized or symlinked metadata files', () => {
    const tempDir = path.resolve('node_modules/.cache/m4-meta-bounds');
    fs.mkdirSync(tempDir, { recursive: true });
    const oversizedFile = path.join(tempDir, 'oversized.txt');
    const normalFile = path.join(tempDir, 'normal.txt');
    const junctionTargetDir = path.join(tempDir, 'junction-target');
    const junctionDir = path.join(tempDir, 'junction');
    try {
      fs.writeFileSync(oversizedFile, 'x'.repeat(MAX_METADATA_BYTES + 1), 'utf8');
      expect(() => readBoundedMetadataFile(oversizedFile)).toThrow();

      fs.writeFileSync(normalFile, 'gitdir: ../somewhere', 'utf8');
      expect(readBoundedMetadataFile(normalFile)).toBe('gitdir: ../somewhere');

      fs.mkdirSync(junctionTargetDir, { recursive: true });
      const targetMetadata = path.join(junctionTargetDir, 'metadata.txt');
      fs.writeFileSync(targetMetadata, 'gitdir: ../somewhere', 'utf8');
      fs.symlinkSync(junctionTargetDir, junctionDir, 'junction');

      expect(() =>
        readBoundedMetadataFile(path.join(junctionDir, 'metadata.txt')),
      ).toThrow();
    } finally {
      cleanupDir(tempDir);
    }
  });

  it('neutralizes inherited hostile GIT_* environment variables', async () => {
    const repoDir = path.resolve('node_modules/.cache/m4-env-neutral');
    try {
      const files = [{ path: 'src/routes.ts', content: 'export const active = true;\n' }];
      createGitRepo(repoDir, files);
      const originalGitDir = process.env.GIT_DIR;
      const originalGitWorkTree = process.env.GIT_WORK_TREE;
      try {
        process.env.GIT_DIR = 'C:\\nonexistent\\hostile_git_dir';
        process.env.GIT_WORK_TREE = 'C:\\nonexistent\\hostile_work_tree';
        const result = await ingestRepository({ repositoryPath: repoDir, organizationId: org, repositoryId: 'repo-env' });
        assertTrustedCommitCapability(result.capability, result.ingestion);
        expect(result.ingestion.snapshot.files).toHaveLength(1);
      } finally {
        if (originalGitDir === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = originalGitDir;
        if (originalGitWorkTree === undefined) delete process.env.GIT_WORK_TREE; else process.env.GIT_WORK_TREE = originalGitWorkTree;
      }
    } finally {
      cleanupDir(repoDir);
    }
  });

  it('rejects nested subdirectories that are not themselves a repository root', async () => {
    const repoDir = path.resolve('node_modules/.cache/m4-nested-root');
    try {
      const files = [{ path: 'src/routes.ts', content: 'export const ok = true;\n' }];
      createGitRepo(repoDir, files);
      const nestedSubdir = path.join(repoDir, 'src');
      await expect(ingestRepository({ repositoryPath: nestedSubdir, organizationId: org, repositoryId: 'repo-nested' })).rejects.toThrow();
    } finally {
      cleanupDir(repoDir);
    }
  });

  it('fails closed when Git object alternates are present', async () => {
    const repoDir = path.resolve('node_modules/.cache/m4-alternates');
    try {
      const files = [{ path: 'src/routes.ts', content: 'export const safe = true;\n' }];
      createGitRepo(repoDir, files);
      const alternatesPath = path.join(repoDir, '.git', 'objects', 'info', 'alternates');
      fs.mkdirSync(path.dirname(alternatesPath), { recursive: true });
      fs.writeFileSync(alternatesPath, '/some/other/objects\n', 'utf8');
      await expect(ingestRepository({ repositoryPath: repoDir, organizationId: org, repositoryId: 'repo-alt' })).rejects.toThrow();
    } finally {
      cleanupDir(repoDir);
    }
  });

  it('rejects foreign tenant during structural validation', async () => {
    const repoDir = path.resolve('node_modules/.cache/m4-tenant');
    try {
      const files = [{ path: 'src/routes.ts', content: 'export const tenant = 1;\n' }];
      createGitRepo(repoDir, files);
      const res = await ingestRepository({ repositoryPath: repoDir, organizationId: org, repositoryId: 'repo-tenant' });
      await expect(validateRepositoryIngestion(res.ingestion, 'foreign_org')).rejects.toThrow('tenant mismatch');
    } finally {
      cleanupDir(repoDir);
    }
  });
  it('uses a trusted absolute Git executable instead of repository-root executable names', async () => {
    const repoDir = path.resolve('node_modules/.cache/m4-git-executable-hijack');
    try {
      createGitRepo(repoDir, [{
        path: 'src/routes.ts',
        content: 'export const trustedGit = true;\n',
      }]);

      fs.writeFileSync(
        path.join(repoDir, process.platform === 'win32' ? 'git.com' : 'git'),
        'not a trusted executable',
        'utf8',
      );

      if (process.platform === 'win32') {
        fs.writeFileSync(
          path.join(repoDir, 'git.exe'),
          'not a trusted executable',
          'utf8',
        );
      }

      const result = await ingestRepository({
        repositoryPath: repoDir,
        organizationId: org,
        repositoryId: 'repo-git-executable-hijack',
      });

      assertTrustedCommitCapability(result.capability, result.ingestion);
    } finally {
      cleanupDir(repoDir);
    }
  });

  it('rejects network/device repository roots and refuses gitfile layouts before target traversal', async () => {
    await expect(
      ingestRepository({
        repositoryPath: '\\\\server\\share\\repo',
        organizationId: org,
        repositoryId: 'repo-unc-root',
      }),
    ).rejects.toThrow('network/device-qualified repository path refused');

    await expect(
      ingestRepository({
        repositoryPath: '\\\\?\\C:\\outside\\repo',
        organizationId: org,
        repositoryId: 'repo-device-root',
      }),
    ).rejects.toThrow('network/device-qualified repository path refused');

    const gitdirRoot = path.resolve('node_modules/.cache/m4-unc-gitdir-root');
    const commonRoot = path.resolve('node_modules/.cache/m4-unc-common-root');
    const commonGitDir = path.resolve('node_modules/.cache/m4-unc-common-gitdir');

    try {
      fs.mkdirSync(gitdirRoot, { recursive: true });
      fs.writeFileSync(
        path.join(gitdirRoot, '.git'),
        'gitdir: \\\\server\\share\\repo.git\n',
        'utf8',
      );

      await expect(
        ingestRepository({
          repositoryPath: gitdirRoot,
          organizationId: org,
          repositoryId: 'repo-unc-gitdir',
        }),
      ).rejects.toThrow('Git file/linked-worktree repositories refused in V1');

      fs.mkdirSync(commonRoot, { recursive: true });
      fs.mkdirSync(commonGitDir, { recursive: true });
      fs.writeFileSync(
        path.join(commonRoot, '.git'),
        `gitdir: ${commonGitDir}\n`,
        'utf8',
      );
      fs.writeFileSync(
        path.join(commonGitDir, 'commondir'),
        '\\\\server\\share\\common.git\n',
        'utf8',
      );

      await expect(
        ingestRepository({
          repositoryPath: commonRoot,
          organizationId: org,
          repositoryId: 'repo-unc-commondir',
        }),
      ).rejects.toThrow('Git file/linked-worktree repositories refused in V1');
    } finally {
      cleanupDir(gitdirRoot);
      cleanupDir(commonRoot);
      cleanupDir(commonGitDir);
    }
  });

  it('refuses core.worktree and ref-storage configuration before materialization', async () => {
    const worktreeRepo = path.resolve('node_modules/.cache/m4-core-worktree-config');
    const reftableConfigRepo = path.resolve('node_modules/.cache/m4-reftable-config');

    try {
      createGitRepo(worktreeRepo, [{
        path: 'src/routes.ts',
        content: 'export const coreWorktree = true;\n',
      }]);

      fs.appendFileSync(
        path.join(worktreeRepo, '.git', 'config'),
        '\n[core] worktree = //server/share/outside\n',
        'utf8',
      );

      await expect(
        ingestRepository({
          repositoryPath: worktreeRepo,
          organizationId: org,
          repositoryId: 'repo-core-worktree-config',
        }),
      ).rejects.toThrow('Git core.worktree/ref storage config refused');

      createGitRepo(reftableConfigRepo, [{
        path: 'src/routes.ts',
        content: 'export const reftableConfig = true;\n',
      }]);

      fs.appendFileSync(
        path.join(reftableConfigRepo, '.git', 'config'),
        '\n[extensions]\n\trefStorage = reftable\n',
        'utf8',
      );

      await expect(
        ingestRepository({
          repositoryPath: reftableConfigRepo,
          organizationId: org,
          repositoryId: 'repo-reftable-config',
        }),
      ).rejects.toThrow();
    } finally {
      cleanupDir(worktreeRepo);
      cleanupDir(reftableConfigRepo);
    }
  });

  it('fails closed on grafts, shallow repositories, reftable storage, and promisor packs', async () => {
    const graftRepo = path.resolve('node_modules/.cache/m4-grafts-refused');
    const shallowRepo = path.resolve('node_modules/.cache/m4-shallow-refused');
    const reftableRepo = path.resolve('node_modules/.cache/m4-reftable-refused');
    const promisorRepo = path.resolve('node_modules/.cache/m4-promisor-refused');

    try {
      createGitRepo(graftRepo, [{
        path: 'src/routes.ts',
        content: 'export const graft = true;\n',
      }]);
      fs.mkdirSync(path.join(graftRepo, '.git', 'info'), { recursive: true });
      fs.writeFileSync(path.join(graftRepo, '.git', 'info', 'grafts'), 'x\n', 'utf8');
      await expect(
        ingestRepository({ repositoryPath: graftRepo, organizationId: org, repositoryId: 'repo-grafts' }),
      ).rejects.toThrow('Git graft metadata refused in V1');

      const shallowSha = createGitRepo(shallowRepo, [{
        path: 'src/routes.ts',
        content: 'export const shallow = true;\n',
      }]);
      fs.writeFileSync(path.join(shallowRepo, '.git', 'shallow'), `${shallowSha}\n`, 'utf8');
      await expect(
        ingestRepository({ repositoryPath: shallowRepo, organizationId: org, repositoryId: 'repo-shallow' }),
      ).rejects.toThrow('Git shallow repository metadata refused in V1');

      createGitRepo(reftableRepo, [{
        path: 'src/routes.ts',
        content: 'export const reftable = true;\n',
      }]);
      fs.mkdirSync(path.join(reftableRepo, '.git', 'reftable'), { recursive: true });
      await expect(
        ingestRepository({ repositoryPath: reftableRepo, organizationId: org, repositoryId: 'repo-reftable' }),
      ).rejects.toThrow('Git reftable storage refused in V1');

      createGitRepo(promisorRepo, [{
        path: 'src/routes.ts',
        content: 'export const promisor = true;\n',
      }]);
      const packDir = path.join(promisorRepo, '.git', 'objects', 'pack');
      fs.mkdirSync(packDir, { recursive: true });
      fs.writeFileSync(path.join(packDir, 'pack-test.promisor'), '', 'utf8');
      await expect(
        ingestRepository({ repositoryPath: promisorRepo, organizationId: org, repositoryId: 'repo-promisor' }),
      ).rejects.toThrow('Git promisor/partial-clone metadata refused');
    } finally {
      cleanupDir(graftRepo);
      cleanupDir(shallowRepo);
      cleanupDir(reftableRepo);
      cleanupDir(promisorRepo);
    }
  });

  it('fails closed on all gitfile and linked-worktree layouts in V1', async () => {
    const mainRepo = path.resolve('node_modules/.cache/m4-linked-main');
    const worktreeDir = path.resolve('node_modules/.cache/m4-linked-worktree');
    const manualGitfileRoot = path.resolve('node_modules/.cache/m4-manual-gitfile-root');
    const manualGitDir = path.resolve('node_modules/.cache/m4-manual-gitfile-target');

    try {
      createGitRepo(mainRepo, [{
        path: 'src/routes.ts',
        content: 'export const linked = true;\n',
      }]);

      cleanupDir(worktreeDir);
      runGit(mainRepo, ['worktree', 'add', '-b', 'm4-linked-branch', worktreeDir]);

      await expect(
        ingestRepository({
          repositoryPath: worktreeDir,
          organizationId: org,
          repositoryId: 'repo-linked-worktree-refused',
        }),
      ).rejects.toThrow('Git file/linked-worktree repositories refused in V1');

      fs.mkdirSync(manualGitfileRoot, { recursive: true });
      fs.mkdirSync(manualGitDir, { recursive: true });
      fs.writeFileSync(
        path.join(manualGitfileRoot, '.git'),
        `gitdir: ${manualGitDir}\n`,
        'utf8',
      );

      await expect(
        ingestRepository({
          repositoryPath: manualGitfileRoot,
          organizationId: org,
          repositoryId: 'repo-manual-gitfile-refused',
        }),
      ).rejects.toThrow('Git file/linked-worktree repositories refused in V1');
    } finally {
      cleanupDir(worktreeDir);
      cleanupDir(mainRepo);
      cleanupDir(manualGitfileRoot);
      cleanupDir(manualGitDir);
    }
  });

  it('rejects verification when live .git is replaced before authority mint', async () => {
    const repoDir = path.resolve('node_modules/.cache/m4-materialized-toctou');

    try {
      createGitRepo(repoDir, [{
        path: 'src/routes.ts',
        content: 'export const stableArtifact = true;\n',
      }]);

      const genuine = await ingestRepository({
        repositoryPath: repoDir,
        organizationId: org,
        repositoryId: 'repo-materialized-toctou',
      });

      const verificationPromise = verifyCommittedRepository(
        repoDir,
        genuine.ingestion,
        org,
      );

      const liveGit = path.join(repoDir, '.git');
      const movedGit = path.join(repoDir, '.git-before-swap');
      fs.renameSync(liveGit, movedGit);
      fs.mkdirSync(path.join(liveGit, 'refs', 'heads'), { recursive: true });
      fs.mkdirSync(path.join(liveGit, 'objects'), { recursive: true });
      fs.writeFileSync(path.join(liveGit, 'HEAD'), 'ref: refs/heads/evil\n', 'utf8');
      fs.writeFileSync(
        path.join(liveGit, 'refs', 'heads', 'evil'),
        `${genuine.ingestion.commitSha}\n`,
        'utf8',
      );

      await expect(verificationPromise).rejects.toThrow(
        'source Git .git identity changed before authority mint',
      );
    } finally {
      cleanupDir(repoDir);
    }
  });

  it('rejects a loose object whose path SHA does not match its actual Git object content', async () => {
    const repoDir = path.resolve('node_modules/.cache/m4-object-hash-mismatch');

    try {
      createGitRepo(repoDir, [{
        path: 'src/routes.ts',
        content: 'export const originalObject = true;\n',
      }]);

      const blobSha = runGit(repoDir, ['rev-parse', 'HEAD:src/routes.ts']);
      const objectPath = path.join(
        repoDir,
        '.git',
        'objects',
        blobSha.slice(0, 2),
        blobSha.slice(2),
      );

      const replacement = Buffer.from(
        'export const attackerSelectedObject = true;\n',
        'utf8',
      );
      const loosePayload = Buffer.concat([
        Buffer.from(`blob ${replacement.length}\0`, 'utf8'),
        replacement,
      ]);

      fs.chmodSync(objectPath, 0o666);
      fs.writeFileSync(
        objectPath,
        zlib.deflateSync(loosePayload),
      );

      await expect(
        ingestRepository({
          repositoryPath: repoDir,
          organizationId: org,
          repositoryId: 'repo-object-hash-mismatch',
        }),
      ).rejects.toThrow('local Git read failed');
    } finally {
      cleanupDir(repoDir);
    }
  });

  it('rejects source HEAD changes that occur during async verification before authority mint', async () => {
    const repoDir = path.resolve('node_modules/.cache/m4-verify-head-change');

    try {
      createGitRepo(repoDir, [{
        path: 'src/routes.ts',
        content: 'export const verifyHead = true;\n',
      }]);

      const genuine = await ingestRepository({
        repositoryPath: repoDir,
        organizationId: org,
        repositoryId: 'repo-verify-head-change',
      });

      const verificationPromise = verifyCommittedRepository(
        repoDir,
        genuine.ingestion,
        org,
      );

      runGit(repoDir, ['commit', '--allow-empty', '-m', 'advance head during verification']);

      await expect(verificationPromise).rejects.toThrow(
        'source Git HEAD changed before authority mint',
      );
    } finally {
      cleanupDir(repoDir);
    }
  });

  it('rejects arbitrary live repositories outside the host-controlled trusted staging root', async () => {
    const liveRepo = path.resolve('node_modules/m4-untrusted-live-repo');

    try {
      createGitRepo(liveRepo, [{
        path: 'src/routes.ts',
        content: 'export const liveMutable = true;\n',
      }]);

      await expect(
        ingestRepository({
          repositoryPath: liveRepo,
          organizationId: org,
          repositoryId: 'repo-untrusted-live',
        }),
      ).rejects.toThrow('repository path outside trusted staging root');
    } finally {
      cleanupDir(liveRepo);
    }
  });

  it('fails closed when the host trusted-staging boundary is not configured', async () => {
    const repoDir = path.resolve('node_modules/.cache/m4-staging-config-required');
    const configured = process.env.VELNAR_M4_TRUSTED_STAGING_ROOT;

    try {
      createGitRepo(repoDir, [{
        path: 'src/routes.ts',
        content: 'export const stagingRequired = true;\n',
      }]);

      delete process.env.VELNAR_M4_TRUSTED_STAGING_ROOT;

      await expect(
        ingestRepository({
          repositoryPath: repoDir,
          organizationId: org,
          repositoryId: 'repo-staging-config-required',
        }),
      ).rejects.toThrow('trusted staging root not configured');
    } finally {
      if (configured === undefined) {
        delete process.env.VELNAR_M4_TRUSTED_STAGING_ROOT;
      } else {
        process.env.VELNAR_M4_TRUSTED_STAGING_ROOT = configured;
      }
      cleanupDir(repoDir);
    }
  });


});
