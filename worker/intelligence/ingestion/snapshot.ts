import { immutableCopy } from '../contracts/validators';

export const SNAPSHOT_VERSION = 'velnar-local-source-snapshot-v2' as const;
export const INGESTION_LIMITS = Object.freeze({ maxFiles: 32, maxFileBytes: 16_384, maxSnapshotBytes: 65_536, maxAstNodes: 12_000, maxRoutes: 32 });
export interface SourceInput { readonly path: string; readonly content: string }
export interface SnapshotInput {
  readonly fixtureId: string; readonly repositoryId: string; readonly organizationId: string;
  readonly files: readonly SourceInput[];
}
export interface SourceFile extends SourceInput { readonly byteLength: number; readonly contentDigest: string; readonly fileIdentity: string }
export interface SourceSnapshot extends Omit<SnapshotInput, 'files'> {
  readonly version: typeof SNAPSHOT_VERSION; readonly snapshotId: string; readonly totalBytes: number;
  readonly files: readonly SourceFile[];
}
export function fail(reason: string): never { throw new Error(`M2_INGESTION_ERROR: ${reason}`); }
export function dataObject(value: unknown, keys: readonly string[]): Record<string, any> {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) fail('plain object required');
  if (Reflect.ownKeys(value).length !== keys.length) fail('unknown or missing metadata');
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d || !d.enumerable || !('value' in d)) fail('data fields required');
  }
  return value as Record<string, any>;
}
export function dataArray(value: unknown, min: number, max: number): asserts value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length < min || value.length > max
    || Reflect.ownKeys(value).length !== value.length + 1) fail('array bounds or shape');
  for (let i = 0; i < value.length; i++) {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !d.enumerable || !('value' in d)) fail('array data required');
  }
}
export function identifier(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) fail('identifier');
}
export function opaqueCaseId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^m2-case-00[1-8]$/.test(value)) fail('opaque case identity required');
}
export function sourcePath(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length > 512 || !/^[A-Za-z0-9_./-]+$/.test(value)) fail('repository-relative path');
  if (value.split('/').some(p => !p || p === '.' || p === '..' || p.endsWith('.')
    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) fail('path component');
  if (!/\.(?:ts|js)$/.test(value) || value.endsWith('.d.ts')) fail('unsupported extension');
}
export function canonical(value: any): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
/** Bounded, accessor-free copy for untrusted derived JSON before any await. */
export function detachJson(value: unknown, depth = 0, budget = { nodes: 0, characters: 0 }): any {
  if (depth > 16 || ++budget.nodes > 16_000) fail('metadata complexity');
  if (typeof value === 'string') {
    budget.characters += value.length; if (budget.characters > 1_048_576) fail('metadata size'); return value;
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && !Object.is(value, -0)) return value;
  if (Array.isArray(value)) {
    dataArray(value, 0, 12_000); return value.map(v => detachJson(v, depth + 1, budget));
  }
  if (value && typeof value === 'object') {
    const r = dataObject(value, Object.keys(value));
    return Object.fromEntries(Object.keys(r).map(k => [k, detachJson(r[k], depth + 1, budget)]));
  }
  return fail('non-JSON metadata');
}
export async function hash(domain: string, value: unknown): Promise<string> {
  return rawHash(new TextEncoder().encode(domain + '\n' + canonical(value)));
}
export async function rawHash(bytes: Uint8Array): Promise<string> {
  const result = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return 'sha256:' + [...new Uint8Array(result)].map(b => b.toString(16).padStart(2, '0')).join('');
}
/** Memory-only hostile-data boundary. No paths are opened, imports executed or config loaded. */
export async function captureSnapshot(raw: unknown, expectedOrganizationId: string): Promise<SourceSnapshot> {
  identifier(expectedOrganizationId);
  const input = dataObject(raw, ['fixtureId', 'repositoryId', 'organizationId', 'files']);
  opaqueCaseId(input.fixtureId);
  for (const key of ['repositoryId', 'organizationId']) identifier(input[key]);
  if (input.organizationId !== expectedOrganizationId) fail('tenant mismatch');
  dataArray(input.files, 1, INGESTION_LIMITS.maxFiles);
  let totalBytes = 0; const paths = new Set<string>();
  const captured = input.files.map(value => {
    const file = dataObject(value, ['path', 'content']); sourcePath(file.path);
    if (paths.has(file.path.toLowerCase())) fail('duplicate canonical path'); paths.add(file.path.toLowerCase());
    if (typeof file.content !== 'string' || file.content.length > INGESTION_LIMITS.maxFileBytes || file.content.includes('\0')) fail('source content');
    const bytes = new TextEncoder().encode(file.content);
    if (new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) !== file.content) fail('invalid source encoding');
    if (bytes.length > INGESTION_LIMITS.maxFileBytes) fail('file size');
    totalBytes += bytes.length; if (totalBytes > INGESTION_LIMITS.maxSnapshotBytes) fail('snapshot size');
    return { path: file.path as string, content: file.content as string, bytes };
  }).sort((a, b) => a.path < b.path ? -1 : 1);
  // All caller-owned data is detached before the first asynchronous digest.
  const identity = { fixtureId: input.fixtureId as string, repositoryId: input.repositoryId as string,
    organizationId: input.organizationId as string };
  const files: SourceFile[] = [];
  for (const file of captured) {
    const contentDigest = await rawHash(file.bytes);
    const descriptor = { path: file.path, byteLength: file.bytes.length, contentDigest };
    files.push({ ...descriptor, content: file.content, fileIdentity: await hash('velnar-source-file-v1', descriptor) });
  }
  const manifest = { version: SNAPSHOT_VERSION, ...identity, files: files.map(({ content: _content, ...f }) => f) };
  const snapshotId = await hash(SNAPSHOT_VERSION, manifest);
  return immutableCopy({ version: SNAPSHOT_VERSION, ...identity, snapshotId, totalBytes, files });
}
export async function validateSnapshot(raw: unknown, expectedOrganizationId: string): Promise<SourceSnapshot> {
  const r = dataObject(raw, ['version', 'fixtureId', 'repositoryId', 'organizationId', 'snapshotId', 'totalBytes', 'files']);
  dataArray(r.files, 1, INGESTION_LIMITS.maxFiles);
  const files = r.files.map(value => {
    const f = dataObject(value, ['path', 'content', 'byteLength', 'contentDigest', 'fileIdentity']);
    sourcePath(f.path);
    if (typeof f.content !== 'string' || !Number.isSafeInteger(f.byteLength) || typeof f.contentDigest !== 'string' || typeof f.fileIdentity !== 'string') fail('file descriptor');
    return { path: f.path, content: f.content };
  });
  if (typeof r.version !== 'string' || typeof r.snapshotId !== 'string' || !Number.isSafeInteger(r.totalBytes)) fail('snapshot descriptor');
  for (const key of ['fixtureId', 'repositoryId', 'organizationId']) identifier(r[key]);
  const copy = immutableCopy(r);
  const computed = await captureSnapshot({ fixtureId: r.fixtureId, repositoryId: r.repositoryId, organizationId: r.organizationId,
    files }, expectedOrganizationId);
  if (canonical(copy) !== canonical(computed)) fail('snapshot integrity mismatch');
  return computed;
}
