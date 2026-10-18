import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, resolve, relative, sep } from 'node:path';
import { runAgentProcess } from './agentProcess';
import { advanceOrchestration, startOrchestration, sha256, BOUNDS, type Session, type Stage } from './orchestrator';
import { createHash } from 'node:crypto';
import { createAgentRunStore, verifyAgentRunManifest } from './agentRunStore';
import { produceReviewBundle } from './reviewBundleProducer';
import { boundedText, parseExact, parseCopilotScoutText, parseCopilotReviewer, runAntigravityFallback, runCodexBuilder, runCopilotReviewer, runCopilotScout,
  transportFailure, type LiveAgentConfig, type LiveOutput } from './liveAgentAdapters';

export interface LiveRuntimeInput {
  requestId: string; baseline: string; task: string; repoRoot: string; stateRoot: string;
  copilot: LiveAgentConfig; codex: LiveAgentConfig; antigravity?: LiveAgentConfig; bundleRoot?: string;
}
const explicitFailures = ['AUTHORIZATION_FAILURE', 'SECURITY_POLICY_FAILURE', 'FORBIDDEN_SCOPE', 'REFUSAL', 'PRODUCTION_BOUNDARY'];
/** Read-only local proof. Git failure is never evidence that a path is absent. */
async function proveNewCandidate(repoRoot: string, baseline: string, path: string): Promise<boolean> {
  try {
    if (!/^[a-fA-F0-9]{40}$/.test(baseline) || !isAbsolute(repoRoot) || path.length > 240 ||
      !/^tests\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)+$/.test(path)) return false;
    const root = resolve(repoRoot);
    if (await realpath(root) !== root) return false;
    const destination = resolve(root, path);
    const local = relative(root, destination);
    if (!local || local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) return false;
    const git = (args: string[]) => runAgentProcess({ command: '/usr/bin/git', args, cwd: root,
      env: { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1' },
      timeoutMs: 5000, maxStdoutBytes: 131072, maxStderrBytes: 8192 });
    if (!(await git(['cat-file', '-e', `${baseline}^{commit}`])).ok) return false;
    const tree = await git(['ls-tree', '-z', '--full-tree', baseline, '--', `:(literal)${path}`]);
    if (!tree.ok || tree.stdout.length !== 0) return false;
    const components = local.split(sep);
    let parent = root;
    for (const component of components.slice(0, -1)) {
      parent = resolve(parent, component);
      try {
        const stat = await lstat(parent);
        if (stat.isSymbolicLink() || !stat.isDirectory()) return false;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return false;
      }
    }
    try { await lstat(destination); return false; }
    catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT'; }
  } catch { return false; }
}
export async function runLiveOrchestration(input: LiveRuntimeInput) {
  if (!boundedText(input.task)) throw new Error('INVALID_TASK');
  // Invalid baseline syntax receives a non-authoritative audit identity only;
  // proveNewCandidate always checks the original input before any candidate claim.
  let session = startOrchestration(input.requestId, /^[a-fA-F0-9]{40}$/.test(input.baseline) ? input.baseline.toLowerCase() : '0'.repeat(40));
  const store = await createAgentRunStore(input.stateRoot, input.requestId);
  let findings = '';
  let parsedOutcome = 'BLOCKED';
  let failureCode: string | null = null;
  const executed = new Set<Stage>();
  const advance = (stage: Stage, disposition: string, failure: string | null = null, candidate: unknown = null) => {
    parsedOutcome = disposition; failureCode = failure;
    session = advanceOrchestration(session, JSON.stringify({ schemaVersion: session.schemaVersion, requestId: session.requestId,
      stage, artifactSha256: sha256(session.candidate ? JSON.stringify(session.candidate) : session.baseline), disposition, failure, candidate }));
  };
  const persist = async (stage: Stage, output: LiveOutput) => {
    if (executed.has(stage)) throw new Error('DUPLICATE_STAGE');
    executed.add(stage);
    const hash = (raw: Buffer) => createHash('sha256').update(raw).digest('hex');
    await store.writeStage({
      schemaVersion: 'VELNAR_AUDIT_V1', runId: input.requestId, stage,
      rawStdoutSha256: hash(output.process.stdout), rawStdoutBytes: output.process.stdout.length,
      rawStderrSha256: hash(output.process.stderr), rawStderrBytes: output.process.stderr.length,
      transportOutcome: output.process.failure ?? 'OK', parsedOutcome,
      // V1 audit failure enum is frozen. Exact transport enums remain in transportOutcome;
      // session.reason retains the explicit BuilderFailure used for fallback decisions.
      failure: ['OUTPUT_LIMIT', 'NON_ZERO_EXIT', 'SPAWN_FAILURE', 'INVALID_CONFIG'].includes(failureCode ?? '') ? null : failureCode, candidatePath: session.candidate?.path ?? null,
      candidateContentSha256: session.candidate?.contentSha256 ?? null,
      reviewerVerdict: stage === 'REVIEWER' && (parsedOutcome === 'PASS' || parsedOutcome === 'FINDINGS')
        ? parsedOutcome : null,
    });
  };
  const builder = async (stage: 'CODEX' | 'ANTIGRAVITY', output: LiveOutput) => {
    const failure = transportFailure(output);
    if (failure) { advance(stage, 'FAILED', failure); return; }
    const failed = parseExact(output.raw, ['status', 'failure']);
    if (failed?.status === 'FAILED' && typeof failed.failure === 'string' && explicitFailures.includes(String(failed.failure))) {
      advance(stage, 'FAILED', String(failed.failure)); return;
    }
    const value = parseExact(output.raw, ['status', 'path', 'content']);
    if (value?.status !== 'CANDIDATE' || typeof value.path !== 'string' || typeof value.content !== 'string' ||
      Buffer.byteLength(value.content) > BOUNDS.maxContentBytes) { advance(stage, 'FAILED', 'MALFORMED_RESPONSE'); return; }
    if (!await proveNewCandidate(input.repoRoot, input.baseline, value.path)) {
      advance(stage, 'BLOCKED'); return;
    }
    advance(stage, 'CANDIDATE', null, { baseline: session.baseline, path: value.path, content: value.content,
      contentSha256: sha256(value.content), status: '??', kind: 'regular', trackedPatch: '', admission: 'WHITE' });
  };
  const scout = await runCopilotScout(input.copilot, input.repoRoot, input.task);
  const scoutValue = parseCopilotScoutText(scout.raw);
  if (!scout.process.ok || scoutValue === null) advance('SCOUT', 'BLOCKED');
  else { findings = scoutValue; advance('SCOUT', 'FINDINGS'); }
  await persist('SCOUT', scout);
  if (session.state === 'AWAITING_CODEX') {
    const output = await runCodexBuilder(input.codex, input.repoRoot, input.task, findings);
    await builder('CODEX', output); await persist('CODEX', output);
  }
  if (session.state === 'FALLBACK_ELIGIBLE' && input.antigravity) {
    const output = await runAntigravityFallback(input.antigravity, input.repoRoot, session, input.task, findings);
    await builder('ANTIGRAVITY', output); await persist('ANTIGRAVITY', output);
  }
  if (session.state === 'AWAITING_REVIEWER') {
    const output = await runCopilotReviewer(input.copilot, input.repoRoot, input.task, findings, session.candidate);
    const failure = transportFailure(output);
    const value = failure ? null : parseCopilotReviewer(output.raw);
    if (failure) advance('REVIEWER', 'FAILED', failure);
    else if (value === null) advance('REVIEWER', 'FAILED', 'MALFORMED_RESPONSE');
    else advance('REVIEWER', value);
    await persist('REVIEWER', output);
  }
  await store.finalize();
  const manifest = await verifyAgentRunManifest(store.directory);
  let reviewBundlePath: string | undefined;
  if (session.state === 'FULGOR_HANDOFF_ELIGIBLE' && input.bundleRoot && session.candidate) {
    reviewBundlePath = await produceReviewBundle(input.bundleRoot, { packageId: input.requestId, role: 'live-builder',
      baseline: session.baseline, purpose: 'Live adapter candidate evidence; independent verification and human approval required',
      createdAt: new Date().toISOString(), candidates: [{ path: session.candidate.path, status: '??', kind: 'regular', snapshot: session.candidate.content }],
      trackedPatch: '', dataClass: 'WHITE', cloudVerificationAllowed: true, autoCommit: false, autoPush: false, autoMerge: false, deploy: false });
  }
  return Object.freeze({ ...manifest, session, runEvidenceDirectory: store.directory, reviewBundlePath, artifacts: store.artifacts });
}
