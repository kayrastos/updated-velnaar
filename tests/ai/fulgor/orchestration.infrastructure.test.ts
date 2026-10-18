import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, symlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgentProcess, type AgentProcessConfig } from '../../../scripts/fulgor/orchestration/agentProcess';
import { produceReviewBundle, MAX_SNAPSHOT_BYTES, type ReviewBundleInput } from '../../../scripts/fulgor/orchestration/reviewBundleProducer';
import { scanReviewBundlesOnce } from '../../../scripts/fulgor/cloud/reviewBundleFeeder';
const roots: string[] = [];
async function root() { const p = await mkdtemp(join(tmpdir(), 'orchestration-')); roots.push(p); return p; }
afterEach(async () => { await Promise.all(roots.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
const config = (code: string, extra: Partial<AgentProcessConfig> = {}): AgentProcessConfig => ({
  command: process.execPath, args: ['-e', code], cwd: process.cwd(), env: {}, timeoutMs: 2000,
  maxStdoutBytes: 1024, maxStderrBytes: 1024, ...extra,
});
describe('safe agent process transport', () => {
  it('captures bounded success and isolated stdin EOF', async () => {
    const result = await runAgentProcess(config("const fs=require('fs');const b=Buffer.alloc(1);fs.writeSync(1,fs.readSync(0,b,0,1,null)===0?'EOF':'INHERITED')"));
    expect(result.ok).toBe(true); expect(result.stdout.toString()).toBe('EOF');
  });
  it('enforces timeout and terminates the child', async () => {
    const result = await runAgentProcess(config('setInterval(()=>{},1000)', { timeoutMs: 100 }));
    expect(result.failure).toBe('TIMEOUT'); expect(result.signal).toBe('SIGKILL');
  });
  it.each(['stdout', 'stderr'])('bounds %s and terminates on overflow', async stream => {
    const result = await runAgentProcess(config(`require('fs').writeSync(${stream === 'stdout' ? 1 : 2},'x'.repeat(10000));setInterval(()=>{},1000)`));
    expect(result.failure).toBe('OUTPUT_LIMIT'); expect(result[stream].length).toBe(1024);
  });
  it('classifies exit failure with no retry', async () => {
    const p = join(await root(), 'attempts');
    const result = await runAgentProcess(config(`require('fs').appendFileSync(${JSON.stringify(p)},'once\\n');process.exit(7)`));
    expect(result.failure).toBe('NON_ZERO_EXIT'); expect(result.exitCode).toBe(7);
    expect(await readFile(p, 'utf8')).toBe('once\n');
  });
  it('passes metacharacters literally without shell execution', async () => {
    const marker = join(await root(), 'escaped');
    const arg = `; touch ${marker} $(touch ${marker})`;
    const result = await runAgentProcess(config("require('fs').writeSync(1,process.argv[1])", { args: ['-e', "require('fs').writeSync(1,process.argv[1])", arg] }));
    expect(result.stdout.toString()).toBe(arg); expect(await readdir(roots.at(-1)!)).toEqual([]);
  });
  it('does not forward an unrelated parent secret', async () => {
    process.env.ORCHESTRATION_TEST_SECRET = 'secret';
    try {
      expect((await runAgentProcess(config("require('fs').writeSync(1,String(process.env.ORCHESTRATION_TEST_SECRET))"))).stdout.toString()).toBe('undefined');
    } finally { delete process.env.ORCHESTRATION_TEST_SECRET; }
  });
  it.each([{ command: '' }, { timeoutMs: 0 }, { timeoutMs: Infinity }, { maxStdoutBytes: -1 },
    { maxStderrBytes: 1.5 }, { cwd: '' }, { env: undefined }])('fails closed on invalid config %j', async extra => {
    expect((await runAgentProcess(config('throw Error()', extra))).failure).toBe('INVALID_CONFIG');
  });
  it('fails closed on spawn error', async () => {
    expect((await runAgentProcess(config('', { command: '/nonexistent/agent' }))).failure).toBe('SPAWN_FAILURE');
  });
});
const input = (): ReviewBundleInput => ({ packageId: 'PKG-test', role: 'builder', baseline: 'a'.repeat(40),
  purpose: 'Synthetic test evidence', createdAt: '2026-10-18T00:00:00.000Z',
  candidates: [{ path: 'tests/new.test.ts', status: '??', kind: 'regular', snapshot: 'export const evidence = true;\n' }],
  trackedPatch: '', dataClass: 'WHITE', cloudVerificationAllowed: true,
  autoCommit: false, autoPush: false, autoMerge: false, deploy: false });
describe('bounded review bundle producer', () => {
  it('publishes the exact surface accepted by the unchanged feeder', async () => {
    const p = await root(); const bundle = await produceReviewBundle(p, input());
    expect(await readdir(p)).toEqual(['PKG-test']);
    expect(await readFile(join(bundle, 'tracked.patch'), 'utf8')).toBe('');
    const jobs: unknown[] = [];
    const result = await scanReviewBundlesOnce({ bundleRoot: p, repoRoot: p, notBeforeMs: 0, stabilityWindowMs: 0 },
      { snapshot: async () => ({ jobs: [] }), enqueue: async job => { jobs.push(job); } },
      { now: () => Date.now() + 10000, commitExists: async () => true,
        pathExistsAtCommit: async () => false, dryRunApply: async () => true });
    expect(result.enqueued).toBe(1); expect(result.refused).toBe(0); expect(jobs).toHaveLength(1);
  });
  it.each([
    { path: 'src/production.ts' }, { status: 'M' }, { kind: 'symlink' }, { path: 'tests/../escape.ts' },
    { snapshot: 'x\0' }, { snapshot: 'x\n'.repeat(501) }, { snapshot: 'x'.repeat(MAX_SNAPSHOT_BYTES + 1) },
    { snapshot: new Uint8Array([0xff]) }, { snapshot: '\ud800' },
  ])('rejects unsupported snapshot %j', async change => {
    const value = input(); value.candidates = [{ ...value.candidates[0], ...change }] as any;
    const p = await root(); await expect(produceReviewBundle(p, value)).rejects.toThrow(); expect(await readdir(p)).toEqual([]);
  });
  it.each([{ baseline: 'HEAD' }, { role: 'fulgor-verification' }, { trackedPatch: 'diff' },
    { candidates: [] }, { autoCommit: true }, { dataClass: 'GRAY' }, { cloudVerificationAllowed: false },
    { purpose: '' }, { createdAt: '2026-02-30T00:00:00.000Z' }])('rejects invalid metadata %j', async change => {
    await expect(produceReviewBundle(await root(), { ...input(), ...change } as any)).rejects.toThrow();
  });
  it('rejects multiple candidates', async () => {
    const value = input(); value.candidates = [...value.candidates, ...value.candidates];
    await expect(produceReviewBundle(await root(), value)).rejects.toThrow();
  });
  it('refuses existing destinations and preserves their bytes', async () => {
    const p = await root(); const dest = await produceReviewBundle(p, input());
    const before = await readFile(join(dest, 'manifest.json'));
    await expect(produceReviewBundle(p, input())).rejects.toThrow('DESTINATION_EXISTS');
    expect(await readFile(join(dest, 'manifest.json'))).toEqual(before); expect(await readdir(p)).toEqual(['PKG-test']);
  });
  it('allows only one concurrent publisher', async () => {
    const p = await root(); const results = await Promise.allSettled([produceReviewBundle(p, input()), produceReviewBundle(p, input())]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1); expect(await readdir(p)).toEqual(['PKG-test']);
  });
  it('rejects symlink root, ancestor and destination escapes', async () => {
    const p = await root(); const outside = await root();
    await symlink(outside, join(p, 'alias'));
    await mkdir(join(outside, 'nested'));
    for (const target of [join(p, 'alias'), join(p, 'alias', 'nested')])
      await expect(produceReviewBundle(target, input())).rejects.toThrow('UNSAFE_OUTPUT_ROOT');
    await symlink(outside, join(p, 'PKG-test'));
    await expect(produceReviewBundle(p, input())).rejects.toThrow('DESTINATION_EXISTS');
    expect(await readdir(outside)).toEqual(['nested']);
  });
});
