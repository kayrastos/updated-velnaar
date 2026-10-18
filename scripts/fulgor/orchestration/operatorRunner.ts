import { constants } from 'node:fs';
import { access, lstat, mkdir, open, realpath, readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { TextDecoder } from 'node:util';
import { createHash } from 'node:crypto';
import { runAgentProcess } from './agentProcess';
import { runLiveOrchestration } from './liveOrchestrationRuntime';
import { assertSafeDirectory, verifyAgentRunManifest, type StageRecord, type ArtifactRecord } from './agentRunStore';

export interface OperatorRunnerDependencies {
  env?: NodeJS.ProcessEnv;
  stateRoot?: string;
  tempRoot?: string;
  bundleRoot?: string;
  runProcess?: typeof runAgentProcess;
  runLive?: typeof runLiveOrchestration;
}
export interface OperatorJob {
  schemaVersion: 'VELNAR_OPERATOR_JOB_V1'; requestId: string; baseline: string; task: string;
}
const fail = (): never => { throw new Error('OPERATOR_FAILURE'); };
async function readJob(file: string): Promise<OperatorJob> {
  if (!isAbsolute(file)) fail();
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 16384 || (stat.mode & 0o077) !== 0 ||
      (process.getuid && stat.uid !== process.getuid())) fail();
    const bytes = Buffer.alloc(16385);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > 16384) fail();
    const job = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, bytesRead)));
    if (!job || Array.isArray(job) || Object.keys(job).sort().join(',') !== 'baseline,requestId,schemaVersion,task' ||
      job.schemaVersion !== 'VELNAR_OPERATOR_JOB_V1' || typeof job.requestId !== 'string' ||
      !/^[A-Za-z0-9._-]{1,128}$/.test(job.requestId) || typeof job.baseline !== 'string' ||
      !/^[a-fA-F0-9]{40}$/.test(job.baseline) || typeof job.task !== 'string' || !job.task.trim() ||
      job.task.includes('\0') || Buffer.byteLength(job.task) > 8192 ||
      new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(job.task)) !== job.task) fail();
    return job;
  } finally { await handle.close(); }
}
async function privateDirectory(directory: string) {
  if (!isAbsolute(directory) || resolve(directory) !== directory) fail();
  // Create each missing component privately; reject symlinks, including ancestors.
  const parent = resolve(directory, '..');
  if (parent !== directory) {
    try { await lstat(parent); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await privateDirectory(parent);
    }
  }
  try { await mkdir(directory, { mode: 0o700 }); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  await assertSafeDirectory(directory);
  const stat = await lstat(directory);
  if ((stat.mode & 0o077) || (process.getuid && stat.uid !== process.getuid())) fail();
}
export async function runOperator(deps: OperatorRunnerDependencies = {}) {
  const env = deps.env ?? process.env;
  const home = env.HOME;
  if (!home || !isAbsolute(home)) fail();
  const job = await readJob(env.VELNAR_OPERATOR_REQUEST_FILE ?? join(home, '.local/state/velnar/operator/request.json'));
  const repoRoot = env.VELNAR_REPO_ROOT ?? join(home, 'updated-velnaar');
  if (!isAbsolute(repoRoot) || resolve(repoRoot) !== repoRoot || await realpath(repoRoot) !== repoRoot) fail();
  const git = async (args: string[]) => {
    const result = await (deps.runProcess ?? runAgentProcess)({ command: '/usr/bin/git', args, cwd: repoRoot,
      env: { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1', GIT_OPTIONAL_LOCKS: '0' },
      timeoutMs: 5000, maxStdoutBytes: 131072, maxStderrBytes: 8192 });
    if (!result.ok) fail();
    return Buffer.from(result.stdout).toString('utf8');
  };
  if (await git(['rev-parse', '--show-toplevel']) !== repoRoot + '\n' ||
    await git(['symbolic-ref', '--short', 'HEAD']) !== 'main\n' ||
    await git(['status', '--porcelain=v1', '--untracked-files=all', '--ignore-submodules=none']) !== '' ||
    await git(['rev-parse', 'HEAD']) !== job.baseline + '\n' ||
    await git(['rev-parse', '--verify', `${job.baseline}^{commit}`]) !== job.baseline + '\n') fail();
  const executable = async (key: string) => {
    const file = env[key];
    if (!file || !isAbsolute(file)) fail();
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) fail();
    await access(file, constants.X_OK);
    return file;
  };
  const copilot = await executable('VELNAR_COPILOT_EXECUTABLE');
  const codex = await executable('VELNAR_CODEX_EXECUTABLE');
  const antigravity = await executable('VELNAR_ANTIGRAVITY_EXECUTABLE');
  const stateRoot = deps.stateRoot ?? join(home, '.local/state/velnar/agent-runs');
  const tempRoot = deps.tempRoot ?? join(home, '.local/state/velnar/operator-tmp');
  const bundleRoot = deps.bundleRoot ?? join(home, 'VELNAR-Review-Bundles');
  await assertSafeDirectory(bundleRoot);
  await privateDirectory(stateRoot);
  await privateDirectory(tempRoot);
  const childEnv: Record<string, string> = { HOME: home, TMPDIR: tempRoot };
  for (const key of ['PATH', 'LANG', 'LC_ALL', 'XDG_CONFIG_HOME']) if (env[key] !== undefined) childEnv[key] = env[key]!;
  if (Object.values(childEnv).some(v => v.includes('\0')) || Buffer.byteLength(JSON.stringify(childEnv)) > 32768) fail();
  const config = (file: string, timeoutMs: number, maxStdoutBytes: number) =>
    ({ executable: file, env: { ...childEnv }, timeoutMs, maxStdoutBytes, maxStderrBytes: 32768 });
  // Existing immutable run IDs are restricted to 80 characters without dots.
  const runId = createHash('sha256').update(job.requestId, 'ascii').digest('hex');
  const result = await (deps.runLive ?? runLiveOrchestration)({ requestId: runId, baseline: job.baseline, task: job.task,
    repoRoot, stateRoot, bundleRoot, copilot: config(copilot, 120000, 262144),
    codex: config(codex, 180000, 131072), antigravity: config(antigravity, 180000, 131072) });
  // Validate immutable metadata and stage order before recognizing bounded recovery.
  await verifyAgentRunManifest(result.runEvidenceDirectory);
  const manifest = JSON.parse(await readFile(join(result.runEvidenceDirectory, 'manifest.json'), 'utf8'));
  if (manifest.runId !== runId) fail();
  const stages: StageRecord[] = [];
  for (const artifact of manifest.stages as ArtifactRecord[]) {
    stages.push(JSON.parse(await readFile(join(result.runEvidenceDirectory, artifact.name), 'utf8')));
  }
  for (const [index, record] of stages.entries()) {
    if (record.transportOutcome === 'OK') continue;
    const recovered = record.stage === 'CODEX' &&
      ['TIMEOUT', 'OUTPUT_LIMIT'].includes(record.transportOutcome) &&
      stages.slice(index + 1).some(later => later.stage === 'ANTIGRAVITY' && later.transportOutcome === 'OK');
    if (!recovered) fail();
  }
  return Object.freeze({ requestId: job.requestId, baseline: job.baseline, finalState: result.session.state,
    finalReason: result.session.reason, runEvidenceDirectory: result.runEvidenceDirectory,
    reviewBundlePath: result.reviewBundlePath, autoCommit: false, autoPush: false, autoMerge: false,
    deploy: false, automaticPromotionAllowed: false, humanApprovalRequired: true });
}
export function operatorSummary(result: Awaited<ReturnType<typeof runOperator>>): string {
  // Allow only bounded single-line metadata; never serialize runtime objects or errors.
  const safe = (value: string) => {
    if (Buffer.byteLength(value) > 4096 || /[\x00-\x1f\x7f]/.test(value)) fail();
    return value;
  };
  return [`REQUEST_ID=${safe(result.requestId)}`, `BASELINE=${safe(result.baseline)}`,
    `FINAL_STATE=${safe(result.finalState)}`, `FINAL_REASON=${safe(result.finalReason ?? 'NONE')}`,
    `RUN_EVIDENCE_DIRECTORY=${safe(result.runEvidenceDirectory)}`,
    `REVIEW_BUNDLE_CREATED=${result.reviewBundlePath ? 'True' : 'False'}`,
    `REVIEW_BUNDLE_PATH=${safe(result.reviewBundlePath ?? 'NONE')}`,
    'AUTO_COMMIT=False', 'AUTO_PUSH=False', 'AUTO_MERGE=False', 'AUTO_DEPLOY=False',
    'AUTOMATIC_PROMOTION=False', 'HUMAN_APPROVAL_REQUIRED=True'].join('\n') + '\n';
}
