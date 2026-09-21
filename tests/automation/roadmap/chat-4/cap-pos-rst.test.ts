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
} from '../../../../worker/intelligence/ingestion/repository';

const org = 'org_cap_pos_rst';
const rawStaging = process.env.VELNAR_M4_TRUSTED_STAGING_ROOT
  ? path.resolve(process.env.VELNAR_M4_TRUSTED_STAGING_ROOT)
  : path.resolve('node_modules/.cache/cap-pos-rst-staging');

fs.mkdirSync(rawStaging, { recursive: true });
const trustedStagingRoot = fs.realpathSync.native(rawStaging);
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
    GIT_AUTHOR_NAME: 'Test Author',
    GIT_AUTHOR_EMAIL: 'author@example.com',
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
    // Ignore safe test cleanup error
  }
}

describe('Capability Enforcement Positive Control: Restart-Resume', () => {
  it('re-mints trusted commit capability upon resume across process restart simulation', async () => {
    const repoDir = path.join(trustedStagingRoot, 'm4-cap-pos-rst-positive');
    try {
      const files = [{ path: 'src/app.ts', content: 'export const active = true;\n' }];
      const commitSha = createGitRepo(repoDir, files);

      const initial = await ingestRepository({
        repositoryPath: repoDir,
        organizationId: org,
        repositoryId: 'repo-rst-positive',
        fixtureId: 'm2-case-001',
      });

      assertTrustedCommitCapability(initial.capability, initial.ingestion);
      expect(isTrustedCommitCapability(initial.capability, initial.ingestion)).toBe(true);

      const persistedJson = JSON.stringify(initial.ingestion);
      const resumedRecord = JSON.parse(persistedJson);

      expect(isTrustedCommitCapability(initial.capability, resumedRecord)).toBe(false);
      expect(() => assertTrustedCommitCapability(initial.capability, resumedRecord)).toThrow();

      const resumed = await verifyCommittedRepository(repoDir, resumedRecord, org);

      assertTrustedCommitCapability(resumed.capability, resumed.ingestion);
      expect(isTrustedCommitCapability(resumed.capability, resumed.ingestion)).toBe(true);
      expect(resumed.ingestion.commitSha).toBe(commitSha);
      expect(resumed.ingestion.snapshot.snapshotId).toBe(initial.ingestion.snapshot.snapshotId);
      expect(resumed.ingestion.ingestionIdentity).toBe(initial.ingestion.ingestionIdentity);
      expect(resumed.ingestion.repositoryId).toBe('repo-rst-positive');
      expect(resumed.ingestion.organizationId).toBe(org);

      expect(isTrustedCommitCapability(resumed.capability, resumedRecord)).toBe(false);
      expect(isTrustedCommitCapability(initial.capability, resumed.ingestion)).toBe(false);
    } finally {
      cleanupDir(repoDir);
    }
  });

  it('fails closed and refuses to mint capability if repository changes during restart downtime', async () => {
    const repoDir = path.join(trustedStagingRoot, 'm4-cap-pos-rst-tampered');
    try {
      const files = [{ path: 'src/app.ts', content: 'export const version = 1;\n' }];
      createGitRepo(repoDir, files);

      const initial = await ingestRepository({
        repositoryPath: repoDir,
        organizationId: org,
        repositoryId: 'repo-rst-tampered',
        fixtureId: 'm2-case-001',
      });

      assertTrustedCommitCapability(initial.capability, initial.ingestion);

      fs.writeFileSync(path.join(repoDir, 'src/app.ts'), 'export const version = 2;\n', 'utf8');
      runGit(repoDir, ['add', '.']);
      runGit(repoDir, ['commit', '-m', 'untracked modification during downtime']);

      const persistedJson = JSON.stringify(initial.ingestion);
      const resumedRecord = JSON.parse(persistedJson);

      await expect(verifyCommittedRepository(repoDir, resumedRecord, org)).rejects.toThrow();
    } finally {
      cleanupDir(repoDir);
    }
  });

  it('validates structural ingestion record before re-minting capability on resume', async () => {
    const repoDir = path.join(trustedStagingRoot, 'm4-cap-pos-rst-structural');
    try {
      const files = [{ path: 'src/app.ts', content: 'export const validated = true;\n' }];
      createGitRepo(repoDir, files);

      const initial = await ingestRepository({
        repositoryPath: repoDir,
        organizationId: org,
        repositoryId: 'repo-rst-structural',
        fixtureId: 'm2-case-001',
      });

      const persistedJson = JSON.stringify(initial.ingestion);
      const resumedRecord = JSON.parse(persistedJson);

      const structural = await validateRepositoryIngestion(resumedRecord, org);
      expect(structural.ingestionIdentity).toBe(initial.ingestion.ingestionIdentity);
      expect((structural as any).capability).toBeUndefined();

      await expect(validateRepositoryIngestion(resumedRecord, 'other_org')).rejects.toThrow('tenant mismatch');
    } finally {
      cleanupDir(repoDir);
    }
  });
});
