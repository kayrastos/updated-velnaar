import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  executeSealedRecoveryAuthorizationCreate,
  executeSealedRecoveryAuthorizerCheckOnly,
  validateRecoveryAuthorizationCreateRequest,
  validateRecoveryAuthorizerCheckOnlyRequest,
} from '../../../scripts/fulgor/orchestration/taskClassRecoveryAuthorityHostExecutor';
import {
  SEALED_RECOVERY_AUTHORIZER_V3_SHA256,
  SEALED_RECOVERY_AUTHORITY_COMMON_V3_SHA256,
  type RecoveryAuthorityCheckExecutionRequest,
} from '../../../scripts/fulgor/orchestration/taskClassRecoveryAuthorityCheckBridge';
import type { RecoveryAuthorizationCreateExecutionRequest } from '../../../scripts/fulgor/orchestration/taskClassRecoveryAuthorizationBridge';

// The only process API used by the production executor is replaced before import.
const effects = vi.hoisted(() => ({ readFile: vi.fn(), lstat: vi.fn(), spawn: vi.fn() }));
vi.mock('node:fs/promises', () => ({ readFile: effects.readFile, lstat: effects.lstat }));
vi.mock('node:child_process', () => ({ spawn: effects.spawn }));

function request(): RecoveryAuthorizationCreateExecutionRequest {
  return { expectedAuthorizerSha256: SEALED_RECOVERY_AUTHORIZER_V3_SHA256,
    expectedCommonSha256: SEALED_RECOVERY_AUTHORITY_COMMON_V3_SHA256,
    args: ['--approve-recovery', '/tmp/offline-v3.json', 'a'.repeat(64)] };
}
function child() {
  return Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
}

beforeEach(() => {
  effects.readFile.mockImplementation(async (path: string) => readFileSync(join(
    process.env.VELNAR_RECOVERY_V3_TEST_SOURCE ?? join(homedir(), '.local/libexec'), basename(path))));
  effects.lstat.mockResolvedValue({ isFile: () => true, isSymbolicLink: () => false,
    uid: process.getuid?.(), mode: 0o100700 });
  effects.spawn.mockImplementation(() => {
    const fake = child();
    queueMicrotask(() => { fake.stdout.write('OFFLINE=YES\n'); fake.emit('close', 0, null); });
    return fake;
  });
});
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

describe('closed V3 creation host executor', () => {
  it('reauthorizes both sealed files on every spawn and preserves exact argv without shell', async () => {
    const first = await executeSealedRecoveryAuthorizationCreate(request());
    expect(first).toMatchObject({ exitCode: 0, stderr: '', stdout: 'OFFLINE=YES\n' });
    expect(effects.readFile).toHaveBeenCalledTimes(2);
    await executeSealedRecoveryAuthorizationCreate(request());
    expect(effects.readFile).toHaveBeenCalledTimes(4);
    expect(effects.spawn).toHaveBeenCalledTimes(2);
    expect(effects.spawn).toHaveBeenCalledWith(expect.stringContaining('velnar-task-class-recovery-authorize.py'),
      ['--approve-recovery', '/tmp/offline-v3.json', 'a'.repeat(64)], expect.objectContaining({ shell: false }));
  });

  it.each([
    ['--check-only', '/tmp/offline.json'],
    ['--approve-recovery', '/tmp/offline.json'],
    ['arbitrary', '/tmp/offline.json', 'a'.repeat(64)],
    ['--approve-recovery', '/tmp/offline.json', 'a'.repeat(64), 'extra'],
    ['--approve-recovery', 'relative.json', 'a'.repeat(64)],
    ['--approve-recovery', '/tmp/bad\0.json', 'a'.repeat(64)],
    ['--approve-recovery', '/tmp/offline.json', 'A'.repeat(64)],
    ['--approve-recovery', '/tmp/offline.json', 'x'],
    ['--approve-recovery', '/tmp/offline.json', 'a'.repeat(64) + '\n'],
  ])('rejects non-exact creation argv %j before any IO', async (...args) => {
    const bad = { ...request(), args } as unknown as RecoveryAuthorizationCreateExecutionRequest;
    expect(() => validateRecoveryAuthorizationCreateRequest(bad)).toThrow();
    await expect(executeSealedRecoveryAuthorizationCreate(bad)).rejects.toThrow();
    expect(effects.readFile).not.toHaveBeenCalled(); expect(effects.spawn).not.toHaveBeenCalled();
  });

  it('check-only still rejects both old and V3 live creation shapes', async () => {
    for (const args of [['--approve-recovery', '/tmp/offline.json'], request().args]) {
      const bad = { ...request(), args } as unknown as RecoveryAuthorityCheckExecutionRequest;
      expect(() => validateRecoveryAuthorizerCheckOnlyRequest(bad)).toThrow();
      await expect(executeSealedRecoveryAuthorizerCheckOnly(bad)).rejects.toThrow();
    }
    expect(effects.spawn).not.toHaveBeenCalled();
  });

  it.each(['expectedAuthorizerSha256', 'expectedCommonSha256'])('rejects caller hash mismatch: %s', async key => {
    const bad = { ...request(), [key]: 'f'.repeat(64) } as RecoveryAuthorizationCreateExecutionRequest;
    await expect(executeSealedRecoveryAuthorizationCreate(bad)).rejects.toThrow();
    expect(effects.spawn).not.toHaveBeenCalled();
  });

  it.each(['common', 'authorize'])('rejects changed sealed %s bytes immediately before spawn', async target => {
    const original = effects.readFile.getMockImplementation()!;
    effects.readFile.mockImplementation(async (path: string) => path.includes(target) ? Buffer.from('tampered') : original(path));
    await expect(executeSealedRecoveryAuthorizationCreate(request())).rejects.toThrow('SHA256_INVALID');
    expect(effects.spawn).not.toHaveBeenCalled();
  });

  it.each(['symlink', 'owner', 'mode'])('rejects unsafe sealed metadata: %s', async kind => {
    effects.lstat.mockResolvedValue({ isFile: () => true, isSymbolicLink: () => kind === 'symlink',
      uid: kind === 'owner' ? -1 : process.getuid?.(), mode: kind === 'mode' ? 0o100777 : 0o100700 });
    await expect(executeSealedRecoveryAuthorizationCreate(request())).rejects.toThrow();
    expect(effects.spawn).not.toHaveBeenCalled();
  });

  it.each(['stdout', 'stderr'])('bounds %s and kills the fake process', async stream => {
    const fake = child();
    effects.spawn.mockImplementation(() => {
      queueMicrotask(() => fake[stream].write('x'.repeat(65537)));
      return fake;
    });
    await expect(executeSealedRecoveryAuthorizationCreate(request())).rejects.toThrow('_LIMIT');
    expect(fake.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('bounds time and never retries the fake process', async () => {
    vi.useFakeTimers();
    const fake = child(); effects.spawn.mockReturnValue(fake);
    const pending = executeSealedRecoveryAuthorizationCreate(request());
    const rejected = expect(pending).rejects.toThrow('TIMEOUT');
    await vi.advanceTimersByTimeAsync(30001);
    await rejected;
    expect(fake.kill).toHaveBeenCalledWith('SIGKILL'); expect(effects.spawn).toHaveBeenCalledTimes(1);
  });
});
