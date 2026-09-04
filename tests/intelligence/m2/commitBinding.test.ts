// Modeled Git responses test the verifier; no Git object or commit is created.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { FIXTURES } from './support/catalog';
import { loadFixture } from './support/loadFixture';
import { verifyCommittedFixture } from './support/gitCodeState';
import { createSealedIntegrator } from './support/integrate';
import { executeFixture } from './support/execute';
import { captureSnapshot, type SourceSnapshot } from '../../../worker/intelligence/ingestion/snapshot';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
const modeledCommit = 'a'.repeat(40);
let snapshots: SourceSnapshot[];
let defect: string, heads: number;
beforeAll(async () => {
  snapshots = [];
  for (const fixture of FIXTURES) snapshots.push(await captureSnapshot(loadFixture(fixture.fixtureId), 'org_m2'));
});
beforeEach(() => {
  defect = ''; heads = 0;
  const blobs = new Map<string, Buffer>();
  vi.mocked(execFileSync).mockReset();
  vi.mocked(execFileSync).mockImplementation(((executable: string, args: string[], options: any) => {
    expect(executable).toBe('git'); expect(options.shell).toBe(false); expect(options.windowsHide).toBe(true);
    expect(options.timeout).toBe(5000); expect(options.maxBuffer).toBe(73728);
    expect(options.env.GIT_NO_LAZY_FETCH).toBe('1'); expect(options.env.GIT_ALLOW_PROTOCOL).toBe('');
    expect(options.env.GIT_TERMINAL_PROMPT).toBe('0');
    expect(args.slice(0, 4)).toEqual(['--no-pager', '--no-replace-objects', '-c', 'core.fsmonitor=false']);
    const command = args.slice(4);
    if (defect === 'read-error') throw new Error('modeled Git failure');
    if (command.join(' ') === 'rev-parse --show-toplevel') return Buffer.from(options.cwd);
    if (command.join(' ') === 'rev-parse --verify HEAD^{commit}') {
      heads++;
      return Buffer.from(defect === 'moving-head' && heads > 1 ? 'b'.repeat(40) : modeledCommit);
    }
    if (command[0] === 'ls-tree') {
      expect(command.slice(0, 6)).toEqual(['ls-tree', '-r', '-z', '--full-tree', modeledCommit, '--']);
      const prefix = command[6];
      const index = FIXTURES.findIndex(f => prefix === `tests/intelligence/m2/fixtures/${f.directory}/`);
      expect(index).toBeGreaterThanOrEqual(0);
      let rows = snapshots[index].files.map(source => {
        const bytes = Buffer.from(source.content, 'utf8');
        const oid = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
        blobs.set(oid, bytes);
        return `100644 blob ${oid}\t${prefix}${source.path}\0`;
      });
      if (defect === 'missing-file') rows.pop();
      if (defect === 'extra-file') rows.push(`100644 blob ${'c'.repeat(40)}\t${prefix}src/extra.ts\0`);
      if (defect === 'link') rows[0] = rows[0].replace('100644', '120000');
      if (defect === 'wrong-path') rows[0] = rows[0].replace('src/', 'other/');
      if (defect === 'duplicate-path') rows[1] = rows[0];
      return Buffer.from(rows.join(''));
    }
    expect(command.slice(0, 2)).toEqual(['cat-file', 'blob']);
    expect(command[2]).toMatch(/^[a-f0-9]{40}$/);
    const bytes = blobs.get(command[2])!;
    return defect === 'changed-bytes' ? Buffer.concat([bytes, Buffer.from('\n')]) : bytes;
  }) as any);
});

describe('M2 fixed local Git profile with modeled Git responses (not seal evidence)', () => {
  it.each(FIXTURES.map((f, index) => [f.fixtureId, index] as const))('checks exact committed bytes for %s before M1 integration', async (_id, index) => {
    const run = await executeFixture(snapshots[index], 'org_m2');
    const out = await createSealedIntegrator(verifyCommittedFixture)(run.ingestion, run.record, 'org_m2');
    expect(out.analyzedCodeCommitSha).toBe(modeledCommit);
    expect([out.candidate.snapshot.commitSha, out.request.commitSha, out.evidence.commitSha, out.result.commitSha]).toEqual(Array(4).fill(modeledCommit));
    expect(out.completed.state).toBe(run.record.violationObserved ? 'VERIFIED' : 'NOT_VERIFIED');
    expect(vi.mocked(execFileSync).mock.calls.filter(call => (call[1] as string[])[4] === 'cat-file')).toHaveLength(snapshots[index].files.length);
  });
  it.each(['missing-file', 'extra-file', 'link', 'wrong-path', 'duplicate-path', 'changed-bytes', 'moving-head', 'read-error'])(
    'refuses commit binding when the Git profile reports %s', async failure => {
      defect = failure;
      const run = await executeFixture(snapshots[6], 'org_m2');
      await expect(createSealedIntegrator(verifyCommittedFixture)(run.ingestion, run.record, 'org_m2')).rejects.toThrow('M2_INGESTION_ERROR');
    });
  it('refuses stale captured bytes before executing Git', async () => {
    const raw = structuredClone(loadFixture(FIXTURES[0].fixtureId));
    (raw.files[0] as any).content += '\n// uncaptured edit';
    const changed = await captureSnapshot(raw, 'org_m2');
    await expect(verifyCommittedFixture(changed)).rejects.toThrow('working fixture changed before commit seal');
    expect(execFileSync).not.toHaveBeenCalled();
  });
});
