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
import { ingestExpress } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';

const org = 'org_chat4';
const trustedStagingRoot = path.resolve('node_modules/.cache');
const previousTrustedStagingRoot = process.env.VELNAR_M4_TRUSTED_STAGING_ROOT;

fs.mkdirSync(trustedStagingRoot, { recursive: true });
const resolvedStaging = fs.realpathSync.native(trustedStagingRoot);
process.env.VELNAR_M4_TRUSTED_STAGING_ROOT = resolvedStaging;

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
    // Safe cleanup ignore
  }
}

describe('Capability enforcement across nested flow restart-resume', () => {
  it('enforces capability binding and non-authoritative candidate state for nested flow across restart-resume', async () => {
    const repoDir = path.join(resolvedStaging, 'cap-nest-rst-genuine');
    try {
      const code = `import express from 'express';

export function createApp(db: any) {
  function runQuery(sql: any) {
    const stmt = db.prepare(sql);
    return stmt.all();
  }

  function handleItems(req: any, res: any) {
    const q = req.query.id;
    const query = 'SELECT * FROM items WHERE id = ' + q;
    const rows = runQuery(query);
    return res.json(rows);
  }

  const app = express();
  const apiRouter = express.Router();
  apiRouter.get('/items', handleItems);
  app.use('/api', apiRouter);
  return app;
}
`;
      const commitSha = createGitRepo(repoDir, [{ path: 'src/routes.ts', content: code }]);

      const initial = await ingestRepository({
        repositoryPath: repoDir,
        organizationId: org,
        repositoryId: 'repo-nest-rst',
      });

      assertTrustedCommitCapability(initial.capability, initial.ingestion);
      expect(isTrustedCommitCapability(initial.capability, initial.ingestion)).toBe(true);
      expect(initial.ingestion.commitSha).toBe(commitSha);

      const expressIngestion = await ingestExpress(initial.ingestion.snapshot, org);
      expect(expressIngestion.routes).toHaveLength(1);
      expect(expressIngestion.routes[0].path).toBe('/api/items');

      const analysis = await detectSqlInjection(initial.ingestion.snapshot, expressIngestion, org);
      expect(analysis.status).toBe('DETECTED');
      expect(analysis.findings).toHaveLength(1);

      const bridge = createSqlCandidateBridge(async (snapshot) => {
        expect(snapshot.snapshotId).toBe(initial.ingestion.snapshot.snapshotId);
        return initial.ingestion.commitSha;
      });
      const hypotheses = await bridge(analysis, initial.ingestion.snapshot, expressIngestion, org);
      expect(hypotheses).toHaveLength(1);
      expect(hypotheses[0].candidate.verificationState).toBe('CANDIDATE');
      expect(hypotheses[0].candidate.reachabilityState).toBe('REACHABLE');

      const serialized = JSON.parse(JSON.stringify(initial.ingestion));
      const reloaded = await validateRepositoryIngestion(serialized, org);

      expect(isTrustedCommitCapability(initial.capability, reloaded)).toBe(false);
      expect(() => assertTrustedCommitCapability(initial.capability, reloaded)).toThrow();

      const resumed = await verifyCommittedRepository(repoDir, reloaded, org);
      assertTrustedCommitCapability(resumed.capability, resumed.ingestion);
      expect(isTrustedCommitCapability(resumed.capability, resumed.ingestion)).toBe(true);
      expect(resumed.ingestion.commitSha).toBe(commitSha);
      expect(resumed.ingestion.snapshot.snapshotId).toBe(initial.ingestion.snapshot.snapshotId);
    } finally {
      cleanupDir(repoDir);
    }
  });

  it('fails closed on restart-resume if repository HEAD changed during interruption', async () => {
    const repoDir = path.join(resolvedStaging, 'cap-nest-rst-tamper');
    try {
      const code = `import express from 'express';

export function createApp(db: any) {
  function handleItems(req: any, res: any) {
    return res.json([]);
  }
  const app = express();
  const apiRouter = express.Router();
  apiRouter.get('/items', handleItems);
  app.use('/api', apiRouter);
  return app;
}
`;
      createGitRepo(repoDir, [{ path: 'src/routes.ts', content: code }]);

      const initial = await ingestRepository({
        repositoryPath: repoDir,
        organizationId: org,
        repositoryId: 'repo-nest-rst-tamper',
      });
      const serialized = JSON.parse(JSON.stringify(initial.ingestion));
      const reloaded = await validateRepositoryIngestion(serialized, org);

      runGit(repoDir, ['commit', '--allow-empty', '-m', 'untracked head change during restart']);
      await expect(verifyCommittedRepository(repoDir, reloaded, org)).rejects.toThrow();
    } finally {
      cleanupDir(repoDir);
    }
  });
});
