import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { TextDecoder } from 'node:util';
import type { VerifiedWhiteAdmission } from '../cloud/reviewBundleAdmission';

export const MAX_SNAPSHOT_BYTES = 200 * 1024;
export interface ReviewBundleInput {
  packageId: string;
  role: string;
  baseline: string;
  purpose: string;
  createdAt: string;
  candidates: readonly { path: string; status: '??'; kind: 'regular'; snapshot: string | Uint8Array }[];
  trackedPatch: '';
  dataClass: 'WHITE';
  cloudVerificationAllowed: true;
  autoCommit: false;
  autoPush: false;
  autoMerge: false;
  deploy: false;
}
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const exact = (value: object, keys: string[]) => Object.keys(value).sort().join(',') === keys.sort().join(',');
async function absent(destination: string) {
  try { await lstat(destination); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  throw new Error('DESTINATION_EXISTS');
}
/** Requires an existing, privately controlled output root (no concurrent untrusted filesystem writers).
 * Emits claims only; the unchanged feeder independently admits and verifies the bundle.
 */
export async function produceReviewBundle(outputRoot: string, input: ReviewBundleInput): Promise<string> {
  if (!input || !exact(input, ['packageId', 'role', 'baseline', 'purpose', 'createdAt', 'candidates', 'trackedPatch',
    'dataClass', 'cloudVerificationAllowed', 'autoCommit', 'autoPush', 'autoMerge', 'deploy']) ||
    ![input.packageId, input.role, input.purpose].every(s => typeof s === 'string' && s.trim().length > 0 && Buffer.byteLength(s) <= 4096) ||
    !/^[A-Za-z0-9_-]{1,120}$/.test(input.packageId) || input.role.trim().toLowerCase() === 'fulgor-verification' ||
    typeof input.baseline !== 'string' || !/^[a-f0-9]{40}$/i.test(input.baseline) ||
    typeof input.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.createdAt) ||
    !Number.isFinite(Date.parse(input.createdAt)) || new Date(input.createdAt).toISOString() !== input.createdAt ||
    input.dataClass !== 'WHITE' || input.cloudVerificationAllowed !== true || input.trackedPatch !== '' ||
    [input.autoCommit, input.autoPush, input.autoMerge, input.deploy].some(v => v !== false) ||
    !Array.isArray(input.candidates) || input.candidates.length !== 1) throw new Error('INVALID_BUNDLE_INPUT');
  const candidate = input.candidates[0];
  if (!candidate || !exact(candidate, ['path', 'status', 'kind', 'snapshot']) || candidate.status !== '??' || candidate.kind !== 'regular' ||
    typeof candidate.path !== 'string' || candidate.path.length > 240 || !candidate.path.startsWith('tests/') ||
    !/^[A-Za-z0-9._/-]+$/.test(candidate.path) || candidate.path.split('/').some(p => !p || p === '.' || p === '..') ||
    !(typeof candidate.snapshot === 'string' || candidate.snapshot instanceof Uint8Array)) throw new Error('UNSUPPORTED_CANDIDATE');
  const bytes = Buffer.from(candidate.snapshot);
  if (!bytes.length || bytes.length > MAX_SNAPSHOT_BYTES || bytes.includes(0)) throw new Error('INVALID_SNAPSHOT');
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  if (typeof candidate.snapshot === 'string' && text !== candidate.snapshot) throw new Error('INVALID_UTF8');
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (!lines.length || lines.length > 500) throw new Error('INVALID_LINE_COUNT');
  // Reject symlinks in every existing root component, including ancestor aliases.
  const root = path.resolve(outputRoot);
  let current = path.parse(root).root;
  for (const part of root.slice(current.length).split('/').filter(Boolean)) {
    current = path.join(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('UNSAFE_OUTPUT_ROOT');
  }
  if (await realpath(root) !== root) throw new Error('UNSAFE_OUTPUT_ROOT');
  const destination = path.join(root, input.packageId);
  // Exclusive per-package publication lock prevents concurrent producers overwriting each other.
  const lock = path.join(root, `.publish-${input.packageId}`);
  await mkdir(lock, { mode: 0o700 });
  let stage: string | undefined;
  try {
    await absent(destination);
    stage = await mkdtemp(path.join(lock, 'stage-'));
    const manifest = JSON.stringify({ packageId: input.packageId, role: input.role, head: input.baseline.toLowerCase(),
      createdAt: input.createdAt, purpose: input.purpose, paths: [{ status: '??', path: candidate.path }],
      autoCommit: false, autoPush: false, autoMerge: false, deploy: false }, null, 2);
    const admission: VerifiedWhiteAdmission = { schemaVersion: 'VELNAR_FULGOR_CLOUD_ADMISSION_V1', packageId: input.packageId,
      manifestSha256: hash(manifest), snapshotSha256: hash(bytes), dataClass: 'WHITE', cloudVerificationAllowed: true };
    const snapshotPath = path.join(stage, 'files', candidate.path);
    await mkdir(path.dirname(snapshotPath), { recursive: true, mode: 0o700 });
    for (const [relative, content] of [
      ['manifest.json', manifest], ['git-status.txt', `?? ${candidate.path}\n`], ['tracked.patch', ''],
      ['fulgor-admission.json', JSON.stringify(admission, null, 2)], [`files/${candidate.path}`, bytes],
    ] as const) await writeFile(path.join(stage, relative), content, { flag: 'wx', mode: 0o600 });
    await absent(destination);
    await rename(stage, destination);
    stage = undefined;
    return destination;
  } finally {
    if (stage) await rm(stage, { recursive: true, force: true });
    await rm(lock, { recursive: true, force: true });
  }
}
