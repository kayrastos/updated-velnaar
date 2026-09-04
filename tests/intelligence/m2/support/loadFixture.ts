import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURES, validateCatalog } from './catalog';
import { INGESTION_LIMITS, sourcePath, fail, type SnapshotInput } from '../../../../worker/intelligence/ingestion/snapshot';

export const FIXTURE_ROOT = fileURLToPath(new URL('../fixtures/', import.meta.url));
export const MAX_DIRECTORY_ENTRIES = 256;
/** Stream a bounded directory listing; share the budget across the whole fixture. */
export function boundedDirectoryEntries(directory: string, budget: { entries: number }): string[] {
  const handle = fs.opendirSync(directory, { bufferSize: 1 });
  const names: string[] = [];
  try {
    let entry: fs.Dirent | null;
    while ((entry = handle.readSync()) !== null) {
      if (++budget.entries > MAX_DIRECTORY_ENTRIES) fail('filesystem entry count limit');
      names.push(entry.name);
    }
  } finally { handle.closeSync(); }
  return names.sort();
}
/** Fail closed on links/junctions in every existing component, including root ancestry. */
export function refuseLinks(absolute: string): void {
  const full = path.resolve(absolute), root = path.parse(full).root;
  let current = root;
  for (const part of full.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) fail('symlink/junction refused');
  }
}
export function loadFixture(fixtureId: string, organizationId = 'org_m2'): SnapshotInput {
  validateCatalog(FIXTURES);
  const entry = FIXTURES.find(f => f.fixtureId === fixtureId); if (!entry) fail('unknown fixture ID');
  const root = path.resolve(FIXTURE_ROOT, entry.directory); refuseLinks(root);
  const files: { path: string; content: string }[] = []; let total = 0, totalBytes = 0;
  const directoryBudget = { entries: 0 };
  function walk(directory: string) {
    for (const name of boundedDirectoryEntries(directory, directoryBudget)) {
      const absolute = path.join(directory, name); refuseLinks(absolute);
      const stat = fs.lstatSync(absolute);
      if (stat.isDirectory()) { if (path.relative(root, absolute).split(path.sep).length > 8) fail('directory depth'); walk(absolute); continue; }
      if (!stat.isFile() || stat.nlink !== 1) fail('nonregular/linked file refused');
      const relative = path.relative(root, absolute).split(path.sep).join('/'); sourcePath(relative);
      if (++total > INGESTION_LIMITS.maxFiles || stat.size > INGESTION_LIMITS.maxFileBytes) fail('filesystem size limit');
      totalBytes += stat.size; if (totalBytes > INGESTION_LIMITS.maxSnapshotBytes) fail('filesystem total size limit');
      const fd = fs.openSync(absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      try {
        const opened = fs.fstatSync(fd); refuseLinks(absolute);
        if (opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== stat.size || !opened.isFile()) fail('file replaced during capture');
        const buffer = Buffer.alloc(INGESTION_LIMITS.maxFileBytes + 1);
        const count = fs.readSync(fd, buffer, 0, buffer.length, 0);
        const after = fs.fstatSync(fd);
        if (count !== stat.size || count > INGESTION_LIMITS.maxFileBytes || after.size !== stat.size
          || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) fail('file changed during capture');
        const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, count));
        files.push({ path: relative, content });
      } finally { fs.closeSync(fd); }
    }
  }
  walk(root);
  return { fixtureId, organizationId, repositoryId: 'local-express-benchmark', files };
}
