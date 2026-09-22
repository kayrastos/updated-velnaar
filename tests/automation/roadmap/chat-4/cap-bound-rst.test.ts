import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  ingestRepository,
  verifyCommittedRepository,
  validateRepositoryIngestion,
  assertTrustedCommitCapability,
  isTrustedCommitCapability,
  type RepositoryIngestion,
} from '../../../../worker/intelligence/ingestion/repository';
import { hash } from '../../../../worker/intelligence/ingestion/snapshot';

const org = 'org_chat4_rst';
const stagingBase = path.resolve('node_modules/.cache');
fs.mkdirSync(stagingBase, { recursive: true });
const trustedStagingRoot = fs.realpathSync.native(stagingBase);
const previousTrustedStagingRoot = process.env.VELNAR_M4_TRUSTED_STAGING_ROOT;

process.env.VELNAR_M4_TRUSTED_STAGING_ROOT = trustedStagingRoot;

afterAll(() => {
  if (previousTrustedStagingRoot === undefined) {
    delete process.env.VELNAR_M4_TRUSTED_STAGING_ROOT;
  } else {
    process.env.VELNAR_M4_TRUSTED_STAGING_ROOT = previousTrustedStagingRoot;
  }
});

function runGit(repoPath: string, args: string[]): string {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.toUpperCase().startsWith('GIT_')),
  );
  Object.assign(env, {
    GIT_AUTHOR_NAME: 'Test Committer',
    GIT_AUTHOR_EMAIL: 'committer@example.com',
    GIT_AUTHOR_DATE: '2026-09-01T00:00:00Z',
    GIT_COMMITTER_NAME: 'Test Committer',
    GIT_COMMITTER_EMAIL: 'committer@example.com',
    GIT_COMMITTER_DATE: '2026-09-01T00:00:00Z',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
  });
  return execFileSync('git', args, {
    cwd: repoPath,
    env,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  }).trim();
}

function createGitRepo(
  repoDir: string,
  files: readonly { path: string; content: string }[],
): string {
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

describe('Chat-4 RM_CAP_BOUND_RST: Capability Boundary Rejection on Restart/Resume', () => {
  it('rejects deserialized capability tokens across restart-resume boundary', async () => {
    const repoDir = path.join(trustedStagingRoot, 'cap-bound-rst-deserialized');
    try {
      const files = [{ path: 'src/handler.ts', content: 'export const active = true;\n' }];
      createGitRepo(repoDir, files);

      const genuine = await ingestRepository({
        repositoryPath: repoDir,
        organizationId: org,
        repositoryId: 'repo-cap-rst-1',
      });

      assertTrustedCommitCapability(genuine.capability, genuine.ingestion);
      expect(isTrustedCommitCapability(genuine.capability, genuine.ingestion)).toBe(true);

      const serialized = JSON.stringify(genuine.ingestion);
      const resumedIngestion: RepositoryIngestion = JSON.parse(serialized);

      expect(isTrustedCommitCapability(genuine.capability, resumedIngestion)).toBe(false);

      const revivedCapability = {
        [Symbol.toStringTag]: 'TrustedCommitCapability' as const,
      };
      expect(isTrustedCommitCapability(revivedCapability, resumedIngestion)).toBe(false);
      expect(isTrustedCommitCapability(revivedCapability, genuine.ingestion)).toBe(false);

      expect(() => {
        assertTrustedCommitCapability(revivedCapability, resumedIngestion);
      }).toThrow('M2_INGESTION_ERROR: unauthorized commit capability');
    } finally {
      cleanupDir(repoDir);
    }
  });

  it('refuses capability minting when resuming through structural validation alone', async () => {
    const repoDir = path.join(trustedStagingRoot, 'cap-bound-rst-structural');
    try {
      const files = [{ path: 'src/handler.ts', content: 'export const token = "abc";\n' }];
      createGitRepo(repoDir, files);

      const genuine = await ingestRepository({
        repositoryPath: repoDir,
        organizationId: org,
        repositoryId: 'repo-cap-rst-2',
      });

      const serialized = JSON.stringify(genuine.ingestion);
      const resumedIngestion = JSON.parse(serialized);

      const validated = await validateRepositoryIngestion(resumedIngestion, org);
      expect((validated as any).capability).toBeUndefined();
      expect(isTrustedCommitCapability((validated as any).capability, validated)).toBe(false);
      expect(() => {
        assertTrustedCommitCapability((validated as any).capability, validated);
      }).toThrow('M2_INGESTION_ERROR: unauthorized commit capability');
    } finally {
      cleanupDir(repoDir);
    }
  });

  it('re-mints capability on restart-resume only via authoritative repository verification', async () => {
    const repoDir = path.join(trustedStagingRoot, 'cap-bound-rst-resume-success');
    try {
      const files = [{ path: 'src/handler.ts', content: 'export const bound = 123;\n' }];
      createGitRepo(repoDir, files);

      const genuine = await ingestRepository({
        repositoryPath: repoDir,
        organizationId: org,
        repositoryId: 'repo-cap-rst-3',
      });

      const resumedIngestion = JSON.parse(JSON.stringify(genuine.ingestion));

      const resumed = await verifyCommittedRepository(repoDir, resumedIngestion, org);
      assertTrustedCommitCapability(resumed.capability, resumed.ingestion);
      expect(isTrustedCommitCapability(resumed.capability, resumed.ingestion)).toBe(true);

      expect(isTrustedCommitCapability(resumed.capability, genuine.ingestion)).toBe(false);
      expect(isTrustedCommitCapability(genuine.capability, resumed.ingestion)).toBe(false);
    } finally {
      cleanupDir(repoDir);
    }
  });

  it('rejects restart-resume verification if repository HEAD changed across restart', async () => {
    const repoDir = path.join(trustedStagingRoot, 'cap-bound-rst-head-diverged');
    try {
      const files = [{ path: 'src/handler.ts', content: 'export const base = 1;\n' }];
      createGitRepo(repoDir, files);

      const genuine = await ingestRepository({
        repositoryPath: repoDir,
        organizationId: org,
        repositoryId: 'repo-cap-rst-4',
      });

      const resumedIngestion = JSON.parse(JSON.stringify(genuine.ingestion));

      const updateFile = path.join(repoDir, 'src/handler.ts');
      fs.writeFileSync(updateFile, 'export const base = 2;\n', 'utf8');
      runGit(repoDir, ['add', '.']);
      runGit(repoDir, ['commit', '-m', 'advance HEAD while stopped']);

      await expect(
        verifyCommittedRepository(repoDir, resumedIngestion, org),
      ).rejects.toThrow();
    } finally {
      cleanupDir(repoDir);
    }
  });

  it('rejects restart-resume verification if committed metadata was altered during restart', async () => {
    const repoDir = path.join(trustedStagingRoot, 'cap-bound-rst-tampered-files');
    try {
      const files = [{ path: 'src/handler.ts', content: 'export const secure = true;\n' }];
      createGitRepo(repoDir, files);

      const genuine = await ingestRepository({
        repositoryPath: repoDir,
        organizationId: org,
        repositoryId: 'repo-cap-rst-5',
      });

      const tamperedSnapshot = {
        ...genuine.ingestion.snapshot,
        files: [
          {
            ...genuine.ingestion.snapshot.files[0],
            content: 'export const secure = false;\n',
          },
        ],
      };

      const tamperedRecord = {
        version: genuine.ingestion.version,
        organizationId: genuine.ingestion.organizationId,
        repositoryId: genuine.ingestion.repositoryId,
        commitSha: genuine.ingestion.commitSha,
        snapshot: tamperedSnapshot,
      };

      const tamperedIdentity = await hash('velnar-repository-ingestion-v1', tamperedRecord);
      const resumedTampered = {
        ...tamperedRecord,
        ingestionIdentity: tamperedIdentity,
      };

      await expect(
        verifyCommittedRepository(repoDir, resumedTampered, org),
      ).rejects.toThrow();
    } finally {
      cleanupDir(repoDir);
    }
  });
});
