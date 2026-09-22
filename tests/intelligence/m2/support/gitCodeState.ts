// Trusted post-commit HOST profile. Never imported by ingestion/execution SUT.
// No shell, source-selected command, Git write, remote operation or lazy fetch.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURES } from './catalog';
import { loadFixture } from './loadFixture';
import { captureSnapshot, validateSnapshot, fail, INGESTION_LIMITS, type SourceSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';

const WORKSPACE = fileURLToPath(new URL('../../../../', import.meta.url));
function gitRead(args: string[]): Uint8Array {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: 'NUL', GIT_NO_REPLACE_OBJECTS: '1',
    GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_ALLOW_PROTOCOL: '' });
  try {
    return execFileSync('git', ['--no-pager', '--no-replace-objects', '-c', 'core.fsmonitor=false', ...args], {
      cwd: WORKSPACE, env, shell: false, windowsHide: true, timeout: 5000,
      maxBuffer: INGESTION_LIMITS.maxSnapshotBytes + 8192, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch { return fail('local Git read failed; commit seal unavailable'); }
}
export function currentCodeCommit(): string {
  const root = new TextDecoder('utf-8', { fatal: true }).decode(gitRead(['rev-parse', '--show-toplevel'])).trim();
  if (path.resolve(root).toLowerCase() !== path.resolve(WORKSPACE).toLowerCase()) fail('Git worktree mismatch');
  const sha = new TextDecoder('utf-8', { fatal: true }).decode(gitRead(['rev-parse', '--verify', 'HEAD^{commit}'])).trim();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sha) || /^0+$/.test(sha)) fail('Git commit identity');
  return sha;
}
export async function verifyCommittedFixture(raw: SourceSnapshot): Promise<string> {
  const snapshot = await validateSnapshot(raw, raw.organizationId);
  if (snapshot.repositoryId !== 'local-express-benchmark') fail('Git repository identity');
  const fixture = FIXTURES.find(f => f.fixtureId === snapshot.fixtureId);
  if (!fixture) fail('Git fixture identity');
  const captured = await captureSnapshot(loadFixture(fixture.fixtureId, snapshot.organizationId), snapshot.organizationId);
  if (captured.snapshotId !== snapshot.snapshotId) fail('working fixture changed before commit seal');
  const sha = currentCodeCommit();
  const prefix = `tests/intelligence/m2/fixtures/${fixture.directory}/`;
  const listing = gitRead(['ls-tree', '-r', '-z', '--full-tree', sha, '--', prefix]);
  const rows = new TextDecoder('utf-8', { fatal: true }).decode(listing).split('\0');
  if (rows.pop() !== '' || rows.length !== snapshot.files.length) fail('committed fixture manifest mismatch');
  const seen = new Set<string>();
  for (const row of rows) {
    const match = /^(100644|100755) blob ([a-f0-9]{40}|[a-f0-9]{64})\t(.+)$/.exec(row);
    if (!match || !match[3].startsWith(prefix)) fail('committed fixture mode/path');
    const relative = match[3].slice(prefix.length), source = snapshot.files.find(f => f.path === relative);
    if (!source || seen.has(relative)) fail('committed fixture manifest mismatch');
    seen.add(relative);
    const bytes = gitRead(['cat-file', 'blob', match[2]]);
    const expected = new TextEncoder().encode(source.content);
    if (bytes.length !== source.byteLength || !bytes.every((byte, index) => byte === expected[index])) fail('committed fixture bytes mismatch');
  }
  if (currentCodeCommit() !== sha) fail('Git HEAD changed during commit seal');
  return sha;
}
