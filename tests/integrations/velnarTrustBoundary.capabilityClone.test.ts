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
} from '../../worker/intelligence/ingestion/repository';
import { ingestExpress } from '../../worker/intelligence/ingestion/express';
import { detectSqlInjection } from '../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../worker/intelligence/detection/candidate';

const org = 'org_trust_boundary';
const trustedStagingRoot = path.resolve('node_modules/.cache');
const previousTrustedStagingRoot = process.env.VELNAR_M4_TRUSTED_STAGING_ROOT;

fs.mkdirSync(trustedStagingRoot, { recursive: true });
const canonicalStagingRoot = fs.realpathSync.native(trustedStagingRoot);
process.env.VELNAR_M4_TRUSTED_STAGING_ROOT = canonicalStagingRoot;

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
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
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

const routeSource = [
  "import express from 'express';",
  '',
  'export function createApp(db: any) {',
  '  const app = express();',
  '  function queryHandler(req: any, res: any) {',
  '    const term = req.query.term;',
  "    const stmt = db.prepare('SELECT * FROM items WHERE name = ' + term);",
  '    res.json(stmt.all());',
  '  }',
  "  app.get('/search', queryHandler);",
  '  return app;',
  '}',
  '',
].join('\n');

describe('Velnar Trust Boundary Capability Clone and Downstream Isolation', () => {
  it('proves repository authority capability is not transferable while downstream analysis remains non-authoritative', async () => {
    const repoA = path.join(canonicalStagingRoot, 'cap-clone-test-a');
    const repoB = path.join(canonicalStagingRoot, 'cap-clone-test-b');

    try {
      const files = [{ path: 'src/routes.ts', content: routeSource }];
      const commitShaA = createGitRepo(repoA, files);
      const commitShaB = createGitRepo(repoB, files);

      const genuine = await ingestRepository({
        repositoryPath: repoA,
        organizationId: org,
        repositoryId: 'repo-cap-a',
        fixtureId: 'm2-case-001',
      });

      const other = await ingestRepository({
        repositoryPath: repoB,
        organizationId: org,
        repositoryId: 'repo-cap-b',
        fixtureId: 'm2-case-001',
      });

      expect(genuine.ingestion.commitSha).toBe(commitShaA);
      expect(other.ingestion.commitSha).toBe(commitShaB);

      assertTrustedCommitCapability(genuine.capability, genuine.ingestion);
      expect(isTrustedCommitCapability(genuine.capability, genuine.ingestion)).toBe(true);

      const clonedCapability = {
        ...genuine.capability,
      };
      expect(isTrustedCommitCapability(clonedCapability, genuine.ingestion)).toBe(false);
      expect(() => assertTrustedCommitCapability(clonedCapability, genuine.ingestion)).toThrow('unauthorized commit capability');

      const spreadIngestion = {
        ...genuine.ingestion,
      };
      expect(isTrustedCommitCapability(genuine.capability, spreadIngestion)).toBe(false);
      expect(() => assertTrustedCommitCapability(genuine.capability, spreadIngestion)).toThrow('unauthorized commit capability');

      const jsonRoundTrip = JSON.parse(JSON.stringify(genuine.ingestion));
      expect(isTrustedCommitCapability(genuine.capability, jsonRoundTrip)).toBe(false);
      expect(() => assertTrustedCommitCapability(genuine.capability, jsonRoundTrip)).toThrow('unauthorized commit capability');

      expect(isTrustedCommitCapability(genuine.capability, other.ingestion)).toBe(false);
      expect(() => assertTrustedCommitCapability(genuine.capability, other.ingestion)).toThrow('unauthorized commit capability');

      const substituted = {
        ...genuine,
        ingestion: other.ingestion,
      };
      expect(isTrustedCommitCapability(substituted.capability, substituted.ingestion)).toBe(false);
      expect(() => assertTrustedCommitCapability(substituted.capability, substituted.ingestion)).toThrow('unauthorized commit capability');

      const structural = await validateRepositoryIngestion(genuine.ingestion, org);
      expect((structural as any).capability).toBeUndefined();
      expect(isTrustedCommitCapability((structural as any).capability, genuine.ingestion)).toBe(false);
      expect(isTrustedCommitCapability(genuine.capability, structural)).toBe(false);
      expect(() => assertTrustedCommitCapability(genuine.capability, structural)).toThrow('unauthorized commit capability');

      const expressIngestion = await ingestExpress(genuine.ingestion.snapshot, org);
      expect((expressIngestion as any).capability).toBeUndefined();
      expect(isTrustedCommitCapability((expressIngestion as any).capability, genuine.ingestion)).toBe(false);
      expect(isTrustedCommitCapability(genuine.capability, expressIngestion as any)).toBe(false);
      expect(() => assertTrustedCommitCapability(genuine.capability, expressIngestion as any)).toThrow('unauthorized commit capability');

      const analysis = await detectSqlInjection(genuine.ingestion.snapshot, expressIngestion, org);
      expect(analysis.status).toBe('DETECTED');
      expect(analysis.findings.length).toBeGreaterThan(0);
      expect((analysis as any).capability).toBeUndefined();
      expect(isTrustedCommitCapability((analysis as any).capability, genuine.ingestion)).toBe(false);
      expect(isTrustedCommitCapability(genuine.capability, analysis as any)).toBe(false);
      expect(() => assertTrustedCommitCapability(genuine.capability, analysis as any)).toThrow('unauthorized commit capability');

      const bridge = createSqlCandidateBridge(async () => genuine.ingestion.commitSha);
      const candidates = await bridge(analysis, genuine.ingestion.snapshot, expressIngestion, org);
      expect(candidates.length).toBeGreaterThan(0);
      for (const item of candidates) {
        expect(item.candidate.verificationState).toBe('CANDIDATE');
        expect((item.candidate as any).capability).toBeUndefined();
        expect((item as any).capability).toBeUndefined();
        expect(isTrustedCommitCapability((item as any).capability, genuine.ingestion)).toBe(false);
        expect(isTrustedCommitCapability(genuine.capability, item.candidate as any)).toBe(false);
        expect(() => assertTrustedCommitCapability(genuine.capability, item.candidate as any)).toThrow('unauthorized commit capability');
      }

      const verified = await verifyCommittedRepository(repoA, genuine.ingestion, org);
      assertTrustedCommitCapability(verified.capability, verified.ingestion);
      expect(isTrustedCommitCapability(verified.capability, verified.ingestion)).toBe(true);
      expect(isTrustedCommitCapability(verified.capability, genuine.ingestion)).toBe(false);
    } finally {
      cleanupDir(repoA);
      cleanupDir(repoB);
    }
  });
});
