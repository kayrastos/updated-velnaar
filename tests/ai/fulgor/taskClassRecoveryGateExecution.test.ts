import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeSealedRecoveryEffectGate } from '../../../scripts/fulgor/orchestration/taskClassRecoveryEffectGateHostExecutor';
import { SEALED_RECOVERY_CALL_GATE_V3_SHA256, type RecoveryEffectGateExecutionRequest } from '../../../scripts/fulgor/orchestration/taskClassRecoveryEffectGateBridge';
import { SEALED_RECOVERY_AUTHORITY_COMMON_V3_SHA256 } from '../../../scripts/fulgor/orchestration/taskClassRecoveryAuthorityCheckBridge';
import { TASK_CLASS_RECOVERY_TRANSACTION_SCHEMA } from '../../../scripts/fulgor/orchestration/taskClassRecoveryTransaction';

const fake = vi.hoisted(() => ({ readFile: vi.fn(), lstat: vi.fn(), spawn: vi.fn(), state: vi.fn(), events: [] as string[] }));
vi.mock('node:fs/promises', () => ({ readFile: fake.readFile, lstat: fake.lstat }));
vi.mock('node:child_process', () => ({ spawn: fake.spawn }));
vi.mock('../../../scripts/fulgor/orchestration/taskClassRecoveryGateState', () => ({ verifyV3RecoveryGateState: fake.state }));
function request(): RecoveryEffectGateExecutionRequest {
  const baseline = 'a'.repeat(40);
  return { expectedGateSha256: SEALED_RECOVERY_CALL_GATE_V3_SHA256, expectedCommonSha256: SEALED_RECOVERY_AUTHORITY_COMMON_V3_SHA256,
    args: ['--consume-call', 'integrated', '1'], call: { jobId: 'first', jobDescriptorSha256: 'b'.repeat(64) },
    transaction: { schemaVersion: TASK_CLASS_RECOVERY_TRANSACTION_SCHEMA, baseline, foundationCommit: baseline,
      batchId: 'integrated', authorizationId: 'integrated', intentSha256: 'c'.repeat(64), provider: 'antigravity',
      taskClass: 'GENERAL', phase: 'PROBATION_BOOTSTRAP', requestedModel: 'gemini-3.8-flash-high', totalProviderCalls: 1, maxConcurrency: 1 } };
}
beforeEach(() => {
  fake.events.length = 0;
  fake.state.mockImplementation(async (_request, stage) => { fake.events.push(stage); });
  fake.readFile.mockImplementation(async path => readFileSync(join(homedir(), '.local/libexec', basename(path))));
  fake.lstat.mockResolvedValue({ isFile: () => true, isSymbolicLink: () => false, uid: process.getuid?.(), mode: 0o100700 });
  fake.spawn.mockImplementation(() => {
    fake.events.push('SPAWN_FAKE');
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
    queueMicrotask(() => { child.stdout.write('OFFLINE=YES\n'); child.emit('close', 0, null); });
    return child;
  });
});
afterEach(() => vi.resetAllMocks());

describe('V3 gate process effect requires exact context before and after consumption', () => {
  it('checks durable context, reauthorizes sealed files, consumes once, and checks context again', async () => {
    const input = request(); const result = await executeSealedRecoveryEffectGate(input);
    expect(fake.events).toEqual(['BEFORE', 'SPAWN_FAKE', 'AFTER']);
    expect(result.transaction).toEqual(input.transaction); expect(Object.isFrozen(result.transaction)).toBe(true);
    expect(fake.readFile).toHaveBeenCalledTimes(2);
    expect(fake.spawn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('velnar-task-class-recovery-call-gate.py'),
      ['--consume-call', 'integrated', '1'], expect.objectContaining({ shell: false }));
  });
  it.each(['BEFORE', 'AFTER'])('context failure at %s cannot return authority or retry', async stage => {
    fake.state.mockImplementation(async (_request, current) => { if (current === stage) throw new Error('stale context'); });
    await expect(executeSealedRecoveryEffectGate(request())).rejects.toThrow('stale context');
    expect(fake.spawn).toHaveBeenCalledTimes(stage === 'BEFORE' ? 0 : 1);
  });
  it('rejects the unbound legacy process request before IO', async () => {
    const input = request(); delete (input as any).transaction; delete (input as any).call;
    await expect(executeSealedRecoveryEffectGate(input)).rejects.toThrow('V3_BINDING_REQUIRED');
    expect(fake.spawn).not.toHaveBeenCalled(); expect(fake.readFile).not.toHaveBeenCalled();
  });
  it('rejects a changed sealed common identity before consumption', async () => {
    fake.readFile.mockResolvedValue(Buffer.from('changed sealed file'));
    await expect(executeSealedRecoveryEffectGate(request())).rejects.toThrow('SHA256_INVALID');
    expect(fake.spawn).not.toHaveBeenCalled();
  });
  it('snapshots the transaction before asynchronous host callbacks', async () => {
    const input = request();
    fake.state.mockImplementation(async () => { (input.transaction as any).intentSha256 = 'f'.repeat(64); });
    const result = await executeSealedRecoveryEffectGate(input);
    expect(result.transaction?.intentSha256).toBe('c'.repeat(64));
  });
});
