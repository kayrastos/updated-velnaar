import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, chmod, symlink, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
import { runOperator, operatorSummary } from '../../../scripts/fulgor/orchestration/operatorRunner';
import { runLiveOrchestration } from '../../../scripts/fulgor/orchestration/liveOrchestrationRuntime';
import { createAgentRunStore, type StageRecord } from '../../../scripts/fulgor/orchestration/agentRunStore';
type Evidence = Pick<StageRecord, 'stage' | 'transportOutcome'> & Partial<StageRecord>;
async function persistedRuntime(input: Parameters<typeof runLiveOrchestration>[0], evidence: Evidence[]) {
  const store = await createAgentRunStore(input.stateRoot, input.requestId);
  for (const record of evidence) await store.writeStage({
    schemaVersion: 'VELNAR_AUDIT_V1', runId: input.requestId,
    rawStdoutSha256: '0'.repeat(64), rawStderrSha256: '0'.repeat(64), rawStdoutBytes: 0, rawStderrBytes: 0,
    parsedOutcome: 'FAILED', candidatePath: null, candidateContentSha256: null, failure: null, reviewerVerdict: null,
    ...record,
  });
  await store.finalize();
  return { session: { state: 'NEEDS_REVIEW', reason: 'BLOCKED' }, runEvidenceDirectory: store.directory,
    reviewBundlePath: undefined, artifacts: store.artifacts, candidate: 'SECRET_CANDIDATE', stdout: 'SECRET_TRANSCRIPT' } as unknown as Awaited<ReturnType<typeof runLiveOrchestration>>;
}
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(r => rm(r, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'operator-')); roots.push(root);
  const repo = join(root, 'repo'); await mkdir(repo);
  const git = async (...args: string[]) => (await execFileAsync('/usr/bin/git', args, { cwd: repo, encoding: 'utf8', env: {
    ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.test', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.test',
  } })).stdout.trim();
  await git('init', '-q', '-b', 'main'); await writeFile(join(repo, 'tracked'), 'base'); await git('add', '.'); await git('commit', '-qm', 'base');
  const baseline = await git('rev-parse', 'HEAD');
  const request = join(root, 'request.json');
  const job = { schemaVersion: 'VELNAR_OPERATOR_JOB_V1', requestId: 'operator.job-1', baseline, task: 'SECRET_TASK' };
  const save = (value: unknown = job) => writeFile(request, JSON.stringify(value), { mode: 0o600 }); await save();
  const executable = join(root, 'cli'); await writeFile(executable, '#!/bin/sh\nprintf "scout evidence"\n', { mode: 0o700 });
  const bundleRoot = join(root, 'bundles'); await mkdir(bundleRoot);
  const runLive = vi.fn<typeof runLiveOrchestration>();
  runLive.mockImplementation(input => persistedRuntime(input, [{ stage: 'SCOUT', transportOutcome: 'OK' }]));
  const deps = { env: { HOME: root, PATH: '/usr/bin', VELNAR_REPO_ROOT: repo, VELNAR_OPERATOR_REQUEST_FILE: request,
    VELNAR_COPILOT_EXECUTABLE: executable, VELNAR_CODEX_EXECUTABLE: executable, VELNAR_ANTIGRAVITY_EXECUTABLE: executable,
    VELNAR_SECRET: 'secret' }, stateRoot: join(root, 'state'), tempRoot: join(root, 'temp'), bundleRoot, runLive };
  return { root, repo, git, request, job, save, executable, deps, runLive };
}
it('passes exact bounded configuration, filters child env, emits metadata only and keeps human authority', async () => {
  const s = await fixture(); const result = await runOperator(s.deps);
  const input = s.runLive.mock.calls[0][0];
  expect(input).toEqual({ requestId: expect.stringMatching(/^[a-f0-9]{64}$/), baseline: s.job.baseline, task: s.job.task, repoRoot: s.repo,
    stateRoot: s.deps.stateRoot, bundleRoot: s.deps.bundleRoot,
    copilot: { executable: s.executable, env: { HOME: s.root, PATH: '/usr/bin', TMPDIR: s.deps.tempRoot }, timeoutMs: 120000, maxStdoutBytes: 262144, maxStderrBytes: 32768 },
    codex: { executable: s.executable, env: { HOME: s.root, PATH: '/usr/bin', TMPDIR: s.deps.tempRoot }, timeoutMs: 180000, maxStdoutBytes: 131072, maxStderrBytes: 32768 },
    antigravity: { executable: s.executable, env: { HOME: s.root, PATH: '/usr/bin', TMPDIR: s.deps.tempRoot }, timeoutMs: 180000, maxStdoutBytes: 131072, maxStderrBytes: 32768 } });
  expect(result).toMatchObject({ autoCommit: false, autoPush: false, autoMerge: false, deploy: false, automaticPromotionAllowed: false, humanApprovalRequired: true });
  expect(operatorSummary(result)).not.toMatch(/SECRET|task|candidate|stdout/);
});
it.each(['json', 'extra', 'size', 'symlink', 'permissions', 'id', 'baseline', 'utf8', 'nul', 'tasksize', 'branch', 'dirty', 'untracked', 'mismatch', 'nonexistent', 'executable-link', 'missing'])('rejects %s before agents', async kind => {
  const s = await fixture();
  switch (kind) {
    case 'json': await writeFile(s.request, '{'); break;
    case 'extra': await s.save({ ...s.job, extra: true }); break;
    case 'size': await writeFile(s.request, ' '.repeat(16385)); break;
    case 'symlink': await rm(s.request); await symlink(s.executable, s.request); break;
    case 'permissions': await chmod(s.request, 0o644); break;
    case 'id': await s.save({ ...s.job, requestId: '../bad' }); break;
    case 'baseline': await s.save({ ...s.job, baseline: 'bad' }); break;
    case 'utf8': await writeFile(s.request, Buffer.from([0xff])); break;
    case 'nul': await s.save({ ...s.job, task: 'bad\0' }); break;
    case 'tasksize': await s.save({ ...s.job, task: 'x'.repeat(8193) }); break;
    case 'branch': await s.git('checkout', '-qb', 'other'); break;
    case 'dirty': await writeFile(join(s.repo, 'tracked'), 'dirty'); break;
    case 'untracked': await writeFile(join(s.repo, 'untracked'), 'dirty'); break;
    case 'mismatch': await s.git('commit', '--allow-empty', '-qm', 'next'); break;
    case 'nonexistent': await s.save({ ...s.job, baseline: 'a'.repeat(40) }); break;
    case 'executable-link': { const link = join(s.root, 'link'); await symlink(s.executable, link); s.deps.env.VELNAR_CODEX_EXECUTABLE = link; break; }
    case 'missing': s.deps.env.VELNAR_CODEX_EXECUTABLE = join(s.root, 'absent'); break;
  }
  await expect(runOperator(s.deps)).rejects.toThrow(); expect(s.runLive).not.toHaveBeenCalled();
});
it('independently rejects a baseline that cannot resolve as a commit', async () => {
  const s = await fixture(); const runProcess = vi.fn(async (config: { args: readonly string[] }) => ({ ok: true, stdout: Buffer.from(config.args[0] === 'status' ? '' : config.args[0] === 'symbolic-ref' ? 'main\n' : config.args.includes('--show-toplevel') ? s.repo + '\n' : config.args.includes('--verify') ? '' : s.job.baseline + '\n'), stderr: Buffer.alloc(0), failure: null, exitCode: 0, signal: null }));
  await expect(runOperator({ ...s.deps, runProcess })).rejects.toThrow(); expect(s.runLive).not.toHaveBeenCalled();
});
it('duplicate IDs fail through the real immutable store before another agent invocation', async () => {
  const s = await fixture(); const deps = { ...s.deps, runLive: undefined };
  await runOperator(deps);
  await expect(runOperator(deps)).rejects.toThrow();
});
it('runtime transport failures exit through rejection rather than advisory success', async () => {
  const s = await fixture();
  await writeFile(s.executable, '#!/bin/sh\nexit 7\n', { mode: 0o700 });
  await expect(runOperator({ ...s.deps, runLive: undefined })).rejects.toThrow();
});
it('service is manually invoked oneshot with no restart or deployment and README documents live adapters', async () => {
  const unit = await readFile('deploy/systemd/user/velnar-live-orchestrator.service', 'utf8');
  expect(unit).toContain('Type=oneshot'); expect(unit).not.toMatch(/Restart=|\[Install\]|WantedBy=|deploy\s|git\s|systemctl/);
  expect(unit).toContain('UMask=0077'); expect(unit).not.toContain('MemoryDenyWriteExecute');
  expect(unit).not.toContain('ProtectKernelModules=true');
  const readme = await readFile('scripts/fulgor/orchestration/README.md', 'utf8');
  expect(readme).not.toMatch(/No live adapters are supplied|No live agent adapter exists/);
  expect(readme).toContain('not auto-enabled');
});

const scout: Evidence = { stage: 'SCOUT', transportOutcome: 'OK' };
const fallback: Evidence = { stage: 'ANTIGRAVITY', transportOutcome: 'OK' };
it.each(['TIMEOUT', 'OUTPUT_LIMIT'])('accepts recovered CODEX %s with semantic NEEDS_REVIEW and unchanged authority', async transportOutcome => {
  const s = await fixture();
  s.runLive.mockImplementation(input => persistedRuntime(input, [scout, { stage: 'CODEX', transportOutcome }, fallback]));
  const result = await runOperator(s.deps);
  expect(result).toMatchObject({ finalState: 'NEEDS_REVIEW', autoCommit: false, autoPush: false,
    autoMerge: false, deploy: false, automaticPromotionAllowed: false, humanApprovalRequired: true });
});
it.each(['TIMEOUT', 'OUTPUT_LIMIT'])('rejects unrecovered CODEX %s despite advisory final state', async transportOutcome => {
  const s = await fixture();
  s.runLive.mockImplementation(input => persistedRuntime(input, [scout, { stage: 'CODEX', transportOutcome }]));
  await expect(runOperator(s.deps)).rejects.toThrow();
});
it.each(['NON_ZERO_EXIT', 'SPAWN_FAILURE', 'INVALID_CONFIG'])('rejects CODEX %s even with fabricated successful fallback evidence', async transportOutcome => {
  const s = await fixture();
  s.runLive.mockImplementation(input => persistedRuntime(input, [scout, { stage: 'CODEX', transportOutcome }, fallback]));
  await expect(runOperator(s.deps)).rejects.toThrow();
});
it.each(['SCOUT', 'ANTIGRAVITY', 'REVIEWER'] as const)('rejects every non-OK %s transport', async stage => {
  for (const transportOutcome of ['TIMEOUT', 'OUTPUT_LIMIT', 'NON_ZERO_EXIT', 'SPAWN_FAILURE', 'INVALID_CONFIG']) {
    const s = await fixture();
    const evidence: Evidence[] = stage === 'SCOUT' ? [{ stage, transportOutcome }] :
      [scout, { stage: 'CODEX', transportOutcome: 'TIMEOUT' },
        { ...fallback, transportOutcome: stage === 'ANTIGRAVITY' ? transportOutcome : 'OK' },
        ...(stage === 'REVIEWER' ? [{ stage, transportOutcome }] : [])];
    s.runLive.mockImplementation(input => persistedRuntime(input, evidence));
    await expect(runOperator(s.deps)).rejects.toThrow();
  }
});
it('preserves successful-transport MALFORMED_RESPONSE fallback and semantic NEEDS_REVIEW', async () => {
  const s = await fixture();
  s.runLive.mockImplementation(input => persistedRuntime(input, [scout,
    { stage: 'CODEX', transportOutcome: 'OK', failure: 'MALFORMED_RESPONSE' }, fallback]));
  await expect(runOperator(s.deps)).resolves.toMatchObject({ finalState: 'NEEDS_REVIEW' });
});
it.each(['unreadable', 'malformed', 'changed', 'earlier'])('fails closed on %s recovery evidence', async kind => {
  const s = await fixture();
  s.runLive.mockImplementation(async input => {
    const result = await persistedRuntime(input, [scout, { stage: 'CODEX', transportOutcome: 'TIMEOUT' }, fallback]);
    const file = join(result.runEvidenceDirectory, 'ANTIGRAVITY.json');
    if (kind === 'unreadable') await rm(file);
    else if (kind === 'malformed') await writeFile(file, '{');
    else if (kind === 'changed') await writeFile(file, JSON.stringify({ stage: 'ANTIGRAVITY', transportOutcome: 'OK' }));
    else {
      const manifest = JSON.parse(await readFile(join(result.runEvidenceDirectory, 'manifest.json'), 'utf8'));
      [manifest.stages[1], manifest.stages[2]] = [manifest.stages[2], manifest.stages[1]];
      const bytes = JSON.stringify(manifest);
      await writeFile(join(result.runEvidenceDirectory, 'manifest.json'), bytes);
      await writeFile(join(result.runEvidenceDirectory, 'manifest.sha256'), createHash('sha256').update(bytes).digest('hex') + '\n');
    }
    return result;
  });
  await expect(runOperator(s.deps)).rejects.toThrow();
});
