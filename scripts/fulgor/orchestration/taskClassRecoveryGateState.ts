import { Buffer } from 'node:buffer';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { runAgentProcess } from './agentProcess';
import { taskClassRecoveryJobDescriptorSha256 } from './taskClassRecoveryRunner';
import { validateRecoveryTransaction } from './taskClassRecoveryTransaction';
import type { RecoveryEffectGateExecutionRequest } from './taskClassRecoveryEffectGateBridge';
import { SEALED_RECOVERY_AUTHORITY_COMMON_V3_SHA256 } from './taskClassRecoveryAuthorityCheckBridge';
import { SEALED_RECOVERY_CALL_GATE_V3_SHA256 } from './taskClassRecoveryEffectGateBridge';

function digest(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
function decode(bytes: Uint8Array): string { return new TextDecoder('utf8', { fatal: true }).decode(bytes); }
function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

// Read-only host context. There is no authorization, gate, provider, or ledger
// effect in this module. Paths are fixed by the host contract, never argv.
async function readPrivate(path: string, maximum = 262144, identityFile = false, observed?: Map<string, readonly string[]>): Promise<Uint8Array> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.uid !== BigInt(process.getuid?.() ?? -1) || (before.mode & BigInt(identityFile ? 0o002 : 0o022)) !== 0n ||
        before.size < 2n || before.size > BigInt(maximum)) throw new Error('RECOVERY_STATE_FILE_INVALID');
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const next = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (next.bytesRead === 0) break;
      bytesRead += next.bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (bytesRead > maximum || before.size !== after.size || before.mtimeNs !== after.mtimeNs ||
        before.ctimeNs !== after.ctimeNs) throw new Error('RECOVERY_STATE_CHANGED_DURING_READ');
    observed?.set(path, [after.dev, after.ino, after.size, after.mode, after.uid, after.mtimeNs, after.ctimeNs].map(String));
    return buffer.subarray(0, bytesRead);
  } finally { await handle.close(); }
}

async function git(repo: string, args: readonly string[]): Promise<Uint8Array> {
  const result = await runAgentProcess({ command: '/usr/bin/git', args: [...args], cwd: repo,
    env: { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1', GIT_OPTIONAL_LOCKS: '0' },
    timeoutMs: 20000, maxStdoutBytes: 8 * 1024 * 1024, maxStderrBytes: 8192 });
  if (!result.ok) throw new Error('RECOVERY_STATE_GIT_FAILED');
  return Buffer.from(result.stdout);
}

export async function verifyV3RecoveryGateState(
  request: RecoveryEffectGateExecutionRequest,
  stage: 'BEFORE' | 'AFTER',
): Promise<void> {
  const tx = request.transaction;
  if (!tx || !request.call) throw new Error('RECOVERY_STATE_BINDING_MISSING');
  validateRecoveryTransaction(tx);
  const ordinal = Number(request.args[2]);
  if (request.args[1] !== tx.batchId || !Number.isSafeInteger(ordinal) || ordinal < 1 ||
      ordinal > tx.totalProviderCalls) throw new Error('RECOVERY_STATE_ORDINAL_INVALID');
  const observed = new Map<string, readonly string[]>();
  const home = homedir();
  const authority = join(home, '.local/state/velnar/provider-canary/recovery-authority');
  const status = stage === 'AFTER' && ordinal === tx.totalProviderCalls ? 'consumed' : 'pending';
  const batch = join(authority, status, tx.batchId);
  for (const path of [authority, join(authority, status), batch]) {
    const metadata = await lstat(path);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== process.getuid?.() ||
        (metadata.mode & 0o077) !== 0) throw new Error('RECOVERY_STATE_DIRECTORY_INVALID');
  }
  try { await lstat(join(authority, 'revoked', tx.batchId)); throw new Error('RECOVERY_STATE_REVOKED'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (status === 'pending') {
    try { await lstat(join(authority, 'consumed', tx.batchId)); throw new Error('RECOVERY_STATE_SPENT'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const raw = await readPrivate(join(batch, 'intent.json'));
  const intent = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(raw));
  const receiptRaw = await readPrivate(join(batch, 'receipt.json'));
  const receipt = JSON.parse(decode(receiptRaw));
  const receiptKeys = ['schemaVersion', 'source', 'intentSchemaVersion', 'batchId', 'baseline', 'provider', 'taskClass',
    'phase', 'requestedModel', 'intentSha256', 'policySha256', 'ledgerSha256AtAuthorization',
    'latestTransportFailureObservedAtMs', 'authorizedProviderCalls', 'consumedProviderCalls', 'remainingProviderCalls',
    'maxConcurrency', 'postFailureAttemptsAtAuthorization', 'antigravityExecutableSha256', 'codexExecutableSha256',
    'nodeExecutableSha256', 'tsxCliSha256', 'liveEnvSha256', 'liveUnitSha256', 'commonAuthoritySha256',
    'effectGateSha256', 'issuedAtMs', 'expiresAtMs'];
  const canonicalReceipt = JSON.stringify(Object.fromEntries(Object.entries(receipt).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))) + '\n';
  if (Object.keys(receipt).length !== receiptKeys.length || Object.keys(receipt).some(key => !receiptKeys.includes(key)) ||
      canonicalReceipt !== decode(receiptRaw)) throw new Error('RECOVERY_STATE_RECEIPT_FORMAT_INVALID');
  if (digest(raw) !== tx.intentSha256 || receipt.intentSha256 !== tx.intentSha256 ||
      intent.schemaVersion !== 'VELNAR_TASK_CLASS_RECOVERY_INTENT_V3' ||
      receipt.schemaVersion !== 'VELNAR_TASK_CLASS_RECOVERY_AUTHORIZATION_V3' ||
      receipt.intentSchemaVersion !== intent.schemaVersion || receipt.source !== 'HOST_EXPLICIT_TASK_CLASS_RECOVERY_V3') {
    throw new Error('RECOVERY_STATE_INTENT_CONTINUITY_INVALID');
  }
  for (const key of ['baseline', 'batchId', 'provider', 'taskClass', 'phase', 'requestedModel'] as const) {
    if (intent[key] !== tx[key] || receipt[key] !== tx[key]) throw new Error('RECOVERY_STATE_IDENTITY_INVALID');
  }
  for (const key of ['latestTransportFailureObservedAtMs', 'antigravityExecutableSha256', 'codexExecutableSha256',
    'nodeExecutableSha256', 'tsxCliSha256', 'liveEnvSha256', 'liveUnitSha256']) {
    if (receipt[key] !== intent[key]) throw new Error('RECOVERY_STATE_RUNTIME_BINDING_INVALID');
  }
  const consumed = stage === 'BEFORE' ? ordinal - 1 : ordinal;
  if (intent.requestedProviderCalls !== tx.totalProviderCalls || intent.requestedConcurrency !== 1 ||
      receipt.authorizedProviderCalls !== tx.totalProviderCalls || receipt.maxConcurrency !== 1 ||
      receipt.consumedProviderCalls !== consumed || receipt.remainingProviderCalls !== tx.totalProviderCalls - consumed ||
      !Number.isSafeInteger(receipt.issuedAtMs) || !Number.isSafeInteger(receipt.expiresAtMs) ||
      receipt.expiresAtMs - receipt.issuedAtMs !== 600000 || Date.now() > receipt.expiresAtMs ||
      Date.now() < receipt.issuedAtMs - 5000 ||
      receipt.commonAuthoritySha256 !== SEALED_RECOVERY_AUTHORITY_COMMON_V3_SHA256 ||
      receipt.effectGateSha256 !== SEALED_RECOVERY_CALL_GATE_V3_SHA256 ||
      intent.jobs?.[ordinal - 1]?.jobId !== request.call.jobId ||
      taskClassRecoveryJobDescriptorSha256(intent.jobs[ordinal - 1]) !== request.call.jobDescriptorSha256) {
    throw new Error('RECOVERY_STATE_BUDGET_OR_CALL_INVALID');
  }
  // The sealed gate checks runtime context during consumption; repeat identities
  // and exact committed foundation afterward so a changed context cannot reach
  // the provider through a previously valid gate response.
  for (const [field, path] of [
    ['commonAuthoritySha256', join(home, '.local/libexec/velnar_recovery_authority_common.py')],
    ['effectGateSha256', join(home, '.local/libexec/velnar-task-class-recovery-call-gate.py')],
    ['antigravityExecutableSha256', join(home, '.local/bin/agy')],
    ['codexExecutableSha256', join(home, '.nvm/versions/node/v24.18.0/lib/node_modules/@openai/codex/bin/codex.js')],
    ['nodeExecutableSha256', join(home, '.nvm/versions/node/v24.18.0/bin/node')],
    ['tsxCliSha256', join(home, 'updated-velnaar/node_modules/tsx/dist/cli.mjs')],
    ['liveEnvSha256', join(home, '.config/velnar/live-8x8.env')],
    ['liveUnitSha256', join(home, '.config/systemd/user/velnar-live-8x8.service')],
  ]) {
    if (digest(await readPrivate(path, 512 * 1024 * 1024, field !== 'liveEnvSha256', observed)) !== receipt[field]) throw new Error('RECOVERY_STATE_RUNTIME_CHANGED');
  }
  const trustPath = join(home, '.local/libexec/velnar-recovery-foundation-v3.json');
  const trustRaw = await readPrivate(trustPath);
  const trust = JSON.parse(decode(trustRaw));
  if (trust.schemaVersion !== 'VELNAR_RECOVERY_COMMITTED_FOUNDATION_V3' || trust.commit !== tx.foundationCommit ||
      Object.keys(trust).sort().join(',') !== 'commit,foundationHashes,schemaVersion' ||
      Object.keys(trust.foundationHashes).sort().join(',') !== Object.keys(intent.foundationHashes).sort().join(',') ||
      receipt.policySha256 !== intent.foundationHashes['scripts/fulgor/scheduler/providerTaskClassRecoveryPolicy.ts']) {
    throw new Error('RECOVERY_STATE_FOUNDATION_UNTRUSTED');
  }
  const repo = join(home, 'updated-velnaar');
  if (decode(await git(repo, ['rev-parse', 'HEAD'])) !== tx.foundationCommit + '\n' ||
      (await git(repo, ['status', '--porcelain=v1', '--untracked-files=all', '--ignore-submodules=none'])).length !== 0) {
    throw new Error('RECOVERY_STATE_FOUNDATION_CHANGED');
  }
  for (const [path, expected] of Object.entries(trust.foundationHashes)) {
    if (typeof expected !== 'string' || expected.length !== 64 || !/^[0-9a-f]{64}$/.test(expected) ||
        path.trim() !== path || !/^(scripts|tests)\/[A-Za-z0-9._/-]+$/.test(path) || path.split('/').some(part => part === '..' || part === '') ||
        expected !== intent.foundationHashes[path] ||
        digest(await git(repo, ['show', tx.foundationCommit + ':' + path])) !== expected ||
        digest(await readPrivate(join(repo, path), 8 * 1024 * 1024, true, observed)) !== expected) {
      throw new Error('RECOVERY_STATE_FOUNDATION_HASH_CHANGED');
    }
  }
  if (decode(await git(repo, ['rev-parse', 'HEAD'])) !== tx.foundationCommit + '\n' ||
      (await git(repo, ['status', '--porcelain=v1', '--untracked-files=all', '--ignore-submodules=none'])).length !== 0) {
    throw new Error('RECOVERY_STATE_FOUNDATION_CHANGED');
  }
  if (!equalBytes(await readPrivate(join(batch, 'receipt.json')), receiptRaw) ||
      digest(await readPrivate(join(batch, 'intent.json'))) !== tx.intentSha256 ||
      !equalBytes(await readPrivate(trustPath), trustRaw)) throw new Error('RECOVERY_STATE_CHANGED_AFTER_RECHECK');
  try { await lstat(join(authority, 'revoked', tx.batchId)); throw new Error('RECOVERY_STATE_REVOKED'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  for (const [path, expected] of observed) {
    const current = await lstat(path, { bigint: true });
    const actual = [current.dev, current.ino, current.size, current.mode, current.uid, current.mtimeNs, current.ctimeNs].map(String);
    if (!current.isFile() || current.isSymbolicLink() || actual.some((value, index) => value !== expected[index])) {
      throw new Error('RECOVERY_STATE_CHANGED_AFTER_RECHECK');
    }
  }
}

export async function readV3RecoveryIntent(path: string): Promise<string> {
  if (!path.startsWith('/') || path.includes('\0')) throw new Error('RECOVERY_INTENT_PATH_INVALID');
  return new TextDecoder('utf8', { fatal: true }).decode(await readPrivate(path));
}
