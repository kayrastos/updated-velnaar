import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyV3RecoveryGateState } from '../../../scripts/fulgor/orchestration/taskClassRecoveryGateState';
import { taskClassRecoveryJobDescriptorSha256 } from '../../../scripts/fulgor/orchestration/taskClassRecoveryRunner';
import { TASK_CLASS_RECOVERY_TRANSACTION_SCHEMA } from '../../../scripts/fulgor/orchestration/taskClassRecoveryTransaction';
import { SEALED_RECOVERY_CALL_GATE_V3_SHA256 } from '../../../scripts/fulgor/orchestration/taskClassRecoveryEffectGateBridge';
import { SEALED_RECOVERY_AUTHORITY_COMMON_V3_SHA256 } from '../../../scripts/fulgor/orchestration/taskClassRecoveryAuthorityCheckBridge';

const host = vi.hoisted(() => ({ root: '', git: vi.fn() }));
vi.mock('node:os', async importOriginal => ({ ...await importOriginal<typeof import('node:os')>(), homedir: () => host.root }));
vi.mock('../../../scripts/fulgor/orchestration/agentProcess', () => ({ runAgentProcess: host.git }));
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const baseline = '0123456789abcdef0123456789abcdef01234567';
let receipt: any, intent: any, request: any, batch: string, trustPath: string, runtimePath: string;
async function put(path: string, data: string | Buffer) {
  await mkdir(join(path, '..'), { recursive: true, mode: 0o700 });
  await writeFile(path, data, { mode: 0o600 });
}
async function saveReceipt() { await put(join(batch, 'receipt.json'), JSON.stringify(Object.fromEntries(Object.entries(receipt).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))) + '\n'); }

beforeEach(async () => {
  host.root = await mkdtemp(join(tmpdir(), 'recovery-state-'));
  const realOS = await vi.importActual<typeof import('node:os')>('node:os');
  const actualHome = realOS.homedir();
  const runtime: Record<string, string> = {};
  for (const [field, relative, source] of [
    ['commonAuthoritySha256', '.local/libexec/velnar_recovery_authority_common.py', 'velnar_recovery_authority_common.py'],
    ['effectGateSha256', '.local/libexec/velnar-task-class-recovery-call-gate.py', 'velnar-task-class-recovery-call-gate.py'],
    ['antigravityExecutableSha256', '.local/bin/agy', ''],
    ['codexExecutableSha256', '.nvm/versions/node/v24.18.0/lib/node_modules/@openai/codex/bin/codex.js', ''],
    ['nodeExecutableSha256', '.nvm/versions/node/v24.18.0/bin/node', ''],
    ['tsxCliSha256', 'updated-velnaar/node_modules/tsx/dist/cli.mjs', ''],
    ['liveEnvSha256', '.config/velnar/live-8x8.env', ''],
    ['liveUnitSha256', '.config/systemd/user/velnar-live-8x8.service', ''],
  ]) {
    // Only sealed SOURCE is read from the host, never real env, ledger, or state.
    const bytes = source ? await readFile(join(actualHome, '.local/libexec', source)) : Buffer.from('fixture-' + field);
    await put(join(host.root, relative), bytes); runtime[field] = hash(bytes);
    if (field === 'antigravityExecutableSha256') runtimePath = join(host.root, relative);
  }
  expect(runtime.commonAuthoritySha256).toBe(SEALED_RECOVERY_AUTHORITY_COMMON_V3_SHA256);
  expect(runtime.effectGateSha256).toBe(SEALED_RECOVERY_CALL_GATE_V3_SHA256);
  const policy = 'fixture committed policy'; const foundationHashes = { 'scripts/fulgor/scheduler/providerTaskClassRecoveryPolicy.ts': hash(policy) };
  await put(join(host.root, 'updated-velnaar/scripts/fulgor/scheduler/providerTaskClassRecoveryPolicy.ts'), policy);
  trustPath = join(host.root, '.local/libexec/velnar-recovery-foundation-v3.json');
  await put(trustPath, JSON.stringify({ schemaVersion: 'VELNAR_RECOVERY_COMMITTED_FOUNDATION_V3', commit: baseline, foundationHashes }));
  const job = { jobId: 'state-job', provider: 'antigravity', taskClass: 'GENERAL', task: 'Offline state fixture',
    evidence: [{ id: 'one', path: 'src/one.ts', sha256: 'a'.repeat(64) }, { id: 'two', path: 'src/two.ts', sha256: 'b'.repeat(64) }] };
  const { commonAuthoritySha256, effectGateSha256, ...intentRuntime } = runtime;
  intent = { schemaVersion: 'VELNAR_TASK_CLASS_RECOVERY_INTENT_V3', baseline, batchId: 'state-batch',
    provider: 'antigravity', taskClass: 'GENERAL', phase: 'PROBATION_BOOTSTRAP', requestedModel: 'gemini-3.8-flash-high',
    requestedProviderCalls: 1, requestedConcurrency: 1, latestTransportFailureObservedAtMs: 1000,
    ...intentRuntime, foundationHashes, jobs: [job] };
  const raw = JSON.stringify(intent); const digest = hash(raw);
  receipt = { schemaVersion: 'VELNAR_TASK_CLASS_RECOVERY_AUTHORIZATION_V3', source: 'HOST_EXPLICIT_TASK_CLASS_RECOVERY_V3',
    intentSchemaVersion: intent.schemaVersion, baseline, batchId: intent.batchId, provider: intent.provider,
    taskClass: intent.taskClass, phase: intent.phase, requestedModel: intent.requestedModel, intentSha256: digest,
    ...runtime, policySha256: hash(policy), ledgerSha256AtAuthorization: 'b'.repeat(64), postFailureAttemptsAtAuthorization: 0,
    latestTransportFailureObservedAtMs: 1000, authorizedProviderCalls: 1, consumedProviderCalls: 0,
    remainingProviderCalls: 1, maxConcurrency: 1, issuedAtMs: Date.now(), expiresAtMs: Date.now() + 600000 };
  receipt.expiresAtMs = receipt.issuedAtMs + 600000;
  batch = join(host.root, '.local/state/velnar/provider-canary/recovery-authority/pending/state-batch');
  await put(join(batch, 'intent.json'), raw); await saveReceipt();
  const transaction = { schemaVersion: TASK_CLASS_RECOVERY_TRANSACTION_SCHEMA, baseline, foundationCommit: baseline,
    batchId: intent.batchId, authorizationId: intent.batchId, intentSha256: digest, provider: intent.provider,
    taskClass: intent.taskClass, phase: intent.phase, requestedModel: intent.requestedModel,
    totalProviderCalls: 1, maxConcurrency: 1 };
  request = { args: ['--consume-call', intent.batchId, '1'], transaction,
    call: { jobId: job.jobId, jobDescriptorSha256: taskClassRecoveryJobDescriptorSha256(job as any) } };
  host.git.mockImplementation(async input => ({ ok: true, stdout: Buffer.from(
    input.args[0] === 'rev-parse' ? baseline + '\n' : input.args[0] === 'status' ? '' : policy), stderr: Buffer.alloc(0) }));
});
afterEach(async () => { vi.resetAllMocks(); await rm(host.root, { recursive: true, force: true }); });

describe('read-only V3 durable gate and runtime continuity on isolated host files', () => {
  it('validates exact before/after state and preserves a fully consumed identity', async () => {
    await expect(verifyV3RecoveryGateState(request, 'BEFORE')).resolves.toBeUndefined();
    receipt.consumedProviderCalls = 1; receipt.remainingProviderCalls = 0; await saveReceipt();
    const consumed = join(host.root, '.local/state/velnar/provider-canary/recovery-authority/consumed');
    await mkdir(consumed, { recursive: true, mode: 0o700 });
    const spent = join(consumed, 'state-batch'); await rename(batch, spent); batch = spent;
    await expect(verifyV3RecoveryGateState(request, 'AFTER')).resolves.toBeUndefined();
    await expect(verifyV3RecoveryGateState(request, 'BEFORE')).rejects.toThrow();
  });

  it.each(['0', '2', '8'])('rejects ordinal %s without any process effect', async ordinal => {
    request.args[2] = ordinal; await expect(verifyV3RecoveryGateState(request, 'BEFORE')).rejects.toThrow('ORDINAL');
    expect(host.git).not.toHaveBeenCalled();
  });

  it.each(['batchId', 'baseline', 'provider', 'taskClass', 'phase', 'requestedModel', 'intentSha256'])
  ('rejects durable identity mismatch %s', async key => {
    receipt[key] = 'invalid'; await saveReceipt();
    await expect(verifyV3RecoveryGateState(request, 'BEFORE')).rejects.toThrow();
  });

  it.each(['authorizedProviderCalls', 'consumedProviderCalls', 'remainingProviderCalls', 'maxConcurrency'])
  ('rejects changed %s', async key => {
    receipt[key] = 8; await saveReceipt();
    await expect(verifyV3RecoveryGateState(request, 'BEFORE')).rejects.toThrow('BUDGET');
  });

  it.each(['revoked', 'runtime', 'future-commit', 'dirty', 'trust', 'intent', 'job-descriptor', 'expired'])
  ('rejects stale/invalid %s context', async kind => {
    if (kind === 'revoked') await put(join(host.root, '.local/state/velnar/provider-canary/recovery-authority/revoked/state-batch/receipt.json'), '{}');
    if (kind === 'runtime') await put(runtimePath, 'changed runtime');
    if (kind === 'future-commit') host.git.mockResolvedValue({ ok: true, stdout: Buffer.from('b'.repeat(40) + '\n') });
    if (kind === 'dirty') host.git.mockImplementation(async input => ({ ok: true, stdout: Buffer.from(input.args[0] === 'rev-parse' ? baseline + '\n' : ' M tracked.ts\n') }));
    if (kind === 'trust') await put(trustPath, '{"schemaVersion":"wrong"}');
    if (kind === 'intent') await put(join(batch, 'intent.json'), JSON.stringify({ ...intent, batchId: 'mutated' }));
    if (kind === 'job-descriptor') request.call.jobDescriptorSha256 = 'f'.repeat(64);
    if (kind === 'expired') { receipt.issuedAtMs = 0; receipt.expiresAtMs = 600000; await saveReceipt(); }
    await expect(verifyV3RecoveryGateState(request, 'BEFORE')).rejects.toThrow();
  });

  it('detects runtime replacement during asynchronous foundation checks', async () => {
    const original = host.git.getMockImplementation()!;
    host.git.mockImplementation(async input => {
      const result = await original(input);
      if (input.args[0] === 'show') await put(runtimePath, 'replaced after hashing');
      return result;
    });
    await expect(verifyV3RecoveryGateState(request, 'BEFORE')).rejects.toThrow('CHANGED_AFTER_RECHECK');
  });

  it('detects revocation occurring during asynchronous foundation checks', async () => {
    const original = host.git.getMockImplementation()!;
    host.git.mockImplementation(async input => {
      const result = await original(input);
      if (input.args[0] === 'show') await put(join(host.root, '.local/state/velnar/provider-canary/recovery-authority/revoked/state-batch/receipt.json'), '{}');
      return result;
    });
    await expect(verifyV3RecoveryGateState(request, 'BEFORE')).rejects.toThrow('REVOKED');
  });
});
