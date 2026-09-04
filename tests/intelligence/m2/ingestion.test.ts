import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { captureSnapshot, validateSnapshot, INGESTION_LIMITS, canonical } from '../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress, validateExpressIngestion } from '../../../worker/intelligence/ingestion/express';
import { loadFixture, refuseLinks, FIXTURE_ROOT, boundedDirectoryEntries, MAX_DIRECTORY_ENTRIES } from './support/loadFixture';
import { FIXTURES } from './support/catalog';
import { executeFixture } from './support/execute';
const org = 'org_m2', error = 'M2_INGESTION_ERROR';
const input = (): any => structuredClone(loadFixture(FIXTURES[0].fixtureId));

describe('M2 canonical source ingestion and hostile boundaries', () => {
  it('loads exactly eight fixture directories with complete relative source manifests', () => {
    expect(fs.readdirSync(FIXTURE_ROOT).sort()).toEqual(FIXTURES.map(f => f.directory).sort());
    for (const fixture of FIXTURES) {
      const raw = loadFixture(fixture.fixtureId); expect(raw.files.some(f => f.path === 'src/routes.ts')).toBe(true);
      expect(raw.files.every(f => f.path.startsWith('src/'))).toBe(true);
    }
    expect(loadFixture(FIXTURES[6].fixtureId).files).toHaveLength(3);
    expect(() => loadFixture('silent-ninth')).toThrow(error);
  });
  it.each(['modify', 'add', 'delete'])('%s of any participating file changes snapshot identity', async kind => {
    const raw: any = structuredClone(loadFixture(FIXTURES[6].fixtureId));
    const before = await captureSnapshot(raw, org);
    if (kind === 'modify') raw.files[0].content += '\n// changed bytes';
    if (kind === 'add') raw.files.push({ path: 'src/extra.ts', content: 'export function extra() { return "x"; }' });
    if (kind === 'delete') raw.files.pop();
    expect((await captureSnapshot(raw, org)).snapshotId).not.toBe(before.snapshotId);
  });
  it('enumeration order is irrelevant and hashes cross-check against independent Node SHA256', async () => {
    const raw: any = structuredClone(loadFixture(FIXTURES[6].fixtureId));
    const first = await captureSnapshot(raw, org); raw.files.reverse();
    expect(await captureSnapshot(raw, org)).toEqual(first);
    for (const file of first.files) expect(file.contentDigest).toBe('sha256:' + createHash('sha256').update(file.content, 'utf8').digest('hex'));
    const manifest = { version: first.version, fixtureId: first.fixtureId, repositoryId: first.repositoryId,
      organizationId: first.organizationId,
      files: first.files.map(({ content: _content, ...f }) => f) };
    expect(first.snapshotId).toBe('sha256:' + createHash('sha256').update(first.version + '\n' + canonical(manifest)).digest('hex'));
    expect(canonical(manifest)).not.toContain('createdAt'); expect(canonical(manifest)).not.toContain(process.cwd());
  });
  it.each(['../escape.ts', '/absolute.ts', 'C:/escape.ts', 'C:\\escape.ts', '\\\\host\\share.ts', 'src/../a.ts', 'src//a.ts', 'src/CON.ts', 'src/a.ts.', './src/a.ts'])('rejects hostile path %s', async name => {
    const raw = input(); raw.files[0].path = name; await expect(captureSnapshot(raw, org)).rejects.toThrow(error);
  });
  it.each(['src/file.json', 'src/file.tsx', 'src/file.py', 'src/file.d.ts', 'src/file.TS'])('rejects unsupported extension %s', async name => {
    const raw = input(); raw.files[0].path = name; await expect(captureSnapshot(raw, org)).rejects.toThrow('unsupported extension');
  });
  it.each(['src/routes.ts', 'src/ROUTES.ts'])('rejects duplicate canonical file identity %s', async name => {
    const raw = input(); raw.files.push({ ...raw.files[0], path: name }); await expect(captureSnapshot(raw, org)).rejects.toThrow('duplicate canonical path');
  });
  it.each(['file', 'total', 'count'])('rejects oversized %s input', async kind => {
    const raw = input();
    if (kind === 'file') raw.files[0].content = 'x'.repeat(INGESTION_LIMITS.maxFileBytes + 1);
    if (kind === 'total') raw.files = Array.from({ length: 5 }, (_, i) => ({ path: `src/f${i}.ts`, content: ' '.repeat(INGESTION_LIMITS.maxFileBytes) }));
    if (kind === 'count') raw.files = Array.from({ length: 33 }, (_, i) => ({ path: `src/f${i}.ts`, content: '' }));
    await expect(captureSnapshot(raw, org)).rejects.toThrow(error);
  });
  it('refuses an actual symlink/junction escape before opening target source', () => {
    const temporary = fs.mkdtempSync(path.resolve('node_modules/.cache/m2-link-'));
    const target = path.join(temporary, 'outside'), link = path.join(temporary, 'link'); fs.mkdirSync(target);
    try {
      fs.symlinkSync(target, link, 'junction');
      expect(() => refuseLinks(link)).toThrow('symlink/junction refused');
    } finally {
      if (fs.existsSync(link)) fs.unlinkSync(link);
      fs.rmdirSync(target); fs.rmdirSync(temporary);
    }
  });
  it.each([1, 2])('bounds empty directory entries across %i listing(s) and closes rejected handles', listings => {
    const temporary = fs.mkdtempSync(path.resolve('node_modules/.cache/m2-entries-'));
    const parents = Array.from({ length: listings }, (_, i) => path.join(temporary, `parent${i}`));
    const children: string[] = [];
    try {
      for (const parent of parents) fs.mkdirSync(parent);
      for (let i = 0; i <= MAX_DIRECTORY_ENTRIES; i++) {
        const child = path.join(parents[i % listings], `empty${i}`);
        fs.mkdirSync(child); children.push(child);
      }
      const budget = { entries: 0 };
      if (listings === 2) expect(boundedDirectoryEntries(parents[0], budget)).toHaveLength(129);
      expect(() => boundedDirectoryEntries(parents[listings - 1], budget)).toThrow('filesystem entry count limit');
      expect(budget.entries).toBe(MAX_DIRECTORY_ENTRIES + 1);
    } finally {
      // Exact owned empty paths only; successful removal also checks handle closure on Windows.
      for (const child of children) fs.rmdirSync(child);
      for (const parent of parents) fs.rmdirSync(parent);
      fs.rmdirSync(temporary);
    }
  });
  it('rejects unknown metadata, source config authority, invalid tenant and invalid encoding', async () => {
    for (const extra of ['expectedSecurityState', 'networkPolicy', 'shellCommand', 'symlinkTarget']) {
      const raw = input(); raw[extra] = 'allow'; await expect(captureSnapshot(raw, org)).rejects.toThrow(error);
    }
    const raw = input(); raw.files[0].content = '\ud800'; await expect(captureSnapshot(raw, org)).rejects.toThrow(error);
    await expect(captureSnapshot(input(), 'foreign')).rejects.toThrow('tenant mismatch');
    await expect(captureSnapshot(input(), undefined as any)).rejects.toThrow(error);
  });
  it('rejects accessors without invoking them and detaches before asynchronous hashing', async () => {
    const bad = input(); let invoked = false;
    Object.defineProperty(bad.files[0], 'content', { get() { invoked = true; return ''; }, enumerable: true });
    await expect(captureSnapshot(bad, org)).rejects.toThrow(error); expect(invoked).toBe(false);
    const raw = input(), content = raw.files[0].content, promise = captureSnapshot(raw, org);
    raw.files[0].content = 'altered'; const safe = await promise;
    expect(safe.files[0].content).toBe(content); expect(Object.isFrozen(safe.files[0])).toBe(true);
  });
  it.each(['snapshotId', 'fileIdentity', 'contentDigest', 'content'])('rejects tampered %s snapshot metadata', async key => {
    const raw: any = structuredClone(await captureSnapshot(input(), org));
    if (key === 'snapshotId') raw[key] = 'sha256:' + '0'.repeat(64); else raw.files[0][key] += 'x';
    await expect(validateSnapshot(raw, org)).rejects.toThrow(error);
  });
  it('includes BOM/newline bytes in the identity instead of silently normalizing them', async () => {
    const raw = input(), first = await captureSnapshot(raw, org);
    raw.files[0].content = '\ufeff' + raw.files[0].content;
    expect((await captureSnapshot(raw, org)).snapshotId).not.toBe(first.snapshotId);
    raw.files[0].content = raw.files[0].content.slice(1).replace(/\n/g, '\r\n');
    expect((await captureSnapshot(raw, org)).snapshotId).not.toBe(first.snapshotId);
  });
  it.each(["app.get(routeName, searchRoute)", "app.get('/search', missing)", "app.get('/search', searchRoute, searchRoute)",
    "app['get']('/search', searchRoute)", "app.get('/search', searchRoute); app.get('/search', searchRoute)",
    "app.listen(3000)", "app.get('/../search', searchRoute)"])('rejects malformed/unsupported registration %s', async replacement => {
    const raw = input(); raw.files[0].content = raw.files[0].content.replace("app.get('/search', searchRoute)", replacement);
    await expect(ingestExpress(await captureSnapshot(raw, org), org)).rejects.toThrow(error);
  });
  it('preserves route registration order and rejects forged output route metadata', async () => {
    const raw = input(); raw.files[0].content = raw.files[0].content.replace("app.get('/search', searchRoute);", "app.get('/a', searchRoute); app.get('/b', searchRoute);");
    const a = await ingestExpress(await captureSnapshot(raw, org), org);
    expect(a.routes.map(r => r.path)).toEqual(['/a', '/b']);
    raw.files[0].content = raw.files[0].content.replace("app.get('/a', searchRoute); app.get('/b', searchRoute);", "app.get('/b', searchRoute); app.get('/a', searchRoute);");
    const b = await ingestExpress(await captureSnapshot(raw, org), org);
    expect(b.routes.map(r => r.path)).toEqual(['/b', '/a']); expect(b.ingestionIdentity).not.toBe(a.ingestionIdentity);
    const forged: any = structuredClone(a); forged.routes[0].method = 'TRACE';
    await expect(validateExpressIngestion(forged, org)).rejects.toThrow('ingestion metadata mismatch');
  });
  it.each(["if (true) app.get('/search', searchRoute)", "while (false) { app.get('/search', searchRoute); }"])(
    'refuses conditional registration rather than inventing reachability: %s', async replacement => {
      const raw = input(); raw.files[0].content = raw.files[0].content.replace("app.get('/search', searchRoute)", replacement);
      await expect(ingestExpress(await captureSnapshot(raw, org), org)).rejects.toThrow(error);
    });
  it('derived ingestion metadata rejects getters without execution and is detached before awaiting', async () => {
    const original = await ingestExpress(await captureSnapshot(input(), org), org);
    const bad: any = structuredClone(original); let invoked = false;
    Object.defineProperty(bad.routes[0], 'path', { get() { invoked = true; return '/search'; }, enumerable: true });
    await expect(validateExpressIngestion(bad, org)).rejects.toThrow(error); expect(invoked).toBe(false);
    const raw: any = structuredClone(original), pending = validateExpressIngestion(raw, org);
    raw.routes[0].path = '/changed'; expect(await pending).toEqual(original);
  });
  it.each(["fetch('https://example.invalid')", "require('node:child_process').exec(req.query.q)",
    "process.exit()", "db.constructor('return process')()", "while (true) {}", "eval(req.query.q)"])('fixture cannot grant executable capability: %s', async injection => {
    const raw = input(); raw.files[0].content = raw.files[0].content.replace('return res.json', injection + '; return res.json');
    await expect(executeFixture(await captureSnapshot(raw, org), org)).rejects.toThrow(error);
  });
  it('bounds recursive calls and rejects external module/config imports', async () => {
    const raw = input(); raw.files[0].content = raw.files[0].content.replace('return res.json', 'return searchRoute(req, res); return res.json');
    await expect(executeFixture(await captureSnapshot(raw, org), org)).rejects.toThrow('execution call depth');
    const other = input(); other.files[0].content = "import fs from 'node:fs';\n" + other.files[0].content;
    await expect(executeFixture(await captureSnapshot(other, org), org)).rejects.toThrow('unsupported source import');
  });
});
