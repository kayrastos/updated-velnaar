import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';

export interface AgentProcessConfig {
  command: string;
  args: readonly string[];
  cwd: string;
  env: Readonly<Record<string, string>>;
  timeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
}
export type ProcessFailure = 'INVALID_CONFIG' | 'SPAWN_FAILURE' | 'NON_ZERO_EXIT' | 'TIMEOUT' | 'OUTPUT_LIMIT';
export interface AgentProcessResult {
  ok: boolean;
  failure: ProcessFailure | null;
  stdout: Buffer;
  stderr: Buffer;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}
/** Transport evidence only. No retries, agent protocol, authority, or live adapter. */
export async function runAgentProcess(config: AgentProcessConfig): Promise<AgentProcessResult> {
  const result = (failure: ProcessFailure | null, stdout = Buffer.alloc(0), stderr = Buffer.alloc(0),
    exitCode: number | null = null, signal: NodeJS.Signals | null = null): AgentProcessResult =>
    ({ ok: failure === null, failure, stdout, stderr, exitCode, signal });
  if (!config || typeof config.command !== 'string' || !config.command.trim() || config.command.includes('\0') ||
    !isAbsolute(config.command) || typeof config.cwd !== 'string' || !isAbsolute(config.cwd) || config.cwd.includes('\0') ||
    !Array.isArray(config.args) || config.args.some(arg => typeof arg !== 'string' || arg.includes('\0')) ||
    ![config.timeoutMs, config.maxStdoutBytes, config.maxStderrBytes].every(n => Number.isSafeInteger(n) && n > 0 && n <= 2147483647) ||
    !config.env || typeof config.env !== 'object' || Array.isArray(config.env) ||
    Object.entries(config.env).some(([key, value]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== 'string' || value.includes('\0')) ||
    Buffer.byteLength(JSON.stringify(config.env)) > 32768) return result('INVALID_CONFIG');
  return new Promise(resolve => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(config.command, [...config.args], {
        cwd: config.cwd, env: { ...config.env }, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32', windowsHide: true,
      });
    } catch { resolve(result('SPAWN_FAILURE')); return; }
    const out: Buffer[] = [], err: Buffer[] = [];
    let outBytes = 0, errBytes = 0;
    let failure: ProcessFailure | null = null;
    let settled = false;
    const kill = () => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch { child.kill('SIGKILL'); }
    };
    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(reapTimer);
      resolve(result(failure ?? (code === 0 ? null : 'NON_ZERO_EXIT'), Buffer.concat(out), Buffer.concat(err), code, signal));
    };
    let reapTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = (reason: ProcessFailure) => {
      if (failure) return;
      failure = reason;
      kill();
      // A descendant may retain inherited pipes; never wait indefinitely for close.
      reapTimer = setTimeout(() => { child.stdout?.destroy(); child.stderr?.destroy(); finish(null, 'SIGKILL'); }, 250);
    };
    const timer = setTimeout(() => stop('TIMEOUT'), config.timeoutMs);
    child.stdout?.on('data', (chunk: Buffer) => {
      const remaining = config.maxStdoutBytes - outBytes;
      if (remaining > 0) out.push(Buffer.from(chunk.subarray(0, remaining))); outBytes += Math.min(chunk.length, remaining);
      if (chunk.length > remaining) stop('OUTPUT_LIMIT');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      const remaining = config.maxStderrBytes - errBytes;
      if (remaining > 0) err.push(Buffer.from(chunk.subarray(0, remaining))); errBytes += Math.min(chunk.length, remaining);
      if (chunk.length > remaining) stop('OUTPUT_LIMIT');
    });
    child.once('error', () => { failure ??= 'SPAWN_FAILURE'; finish(null, null); });
    child.once('close', finish);
  });
}
