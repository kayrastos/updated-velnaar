import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, readdir } from 'node:fs/promises';
import * as path from 'node:path';

export interface ArtifactRecord { readonly name: string; readonly sha256: string; readonly bytes: number }
const stages = ['SCOUT', 'CODEX', 'ANTIGRAVITY', 'REVIEWER'] as const;
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const schemaVersion = 'VELNAR_AUDIT_V1';
export interface StageRecord {
  schemaVersion: 'VELNAR_AUDIT_V1'; runId: string; stage: typeof stages[number];
  rawStdoutSha256: string; rawStdoutBytes: number; rawStderrSha256: string; rawStderrBytes: number;
  transportOutcome: string; parsedOutcome: string;
  candidatePath: string | null; candidateContentSha256: string | null;
  failure: string | null; reviewerVerdict: 'PASS' | 'FINDINGS' | null;
}
function validRecord(v: StageRecord, runId: string): boolean {
  return v && Object.keys(v).sort().join(',') === [
    'schemaVersion', 'runId', 'stage', 'rawStdoutSha256', 'rawStdoutBytes', 'rawStderrSha256', 'rawStderrBytes',
    'transportOutcome', 'parsedOutcome', 'candidatePath', 'candidateContentSha256', 'failure', 'reviewerVerdict'].sort().join(',') &&
    v.schemaVersion === schemaVersion && v.runId === runId && stages.includes(v.stage) &&
    [v.rawStdoutSha256, v.rawStderrSha256].every(x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x)) &&
    [v.rawStdoutBytes, v.rawStderrBytes].every(x => Number.isSafeInteger(x) && x >= 0 && x <= MAX_RECORDED_PROCESS_STREAM_BYTES) &&
    ['OK', 'INVALID_CONFIG', 'SPAWN_FAILURE', 'NON_ZERO_EXIT', 'TIMEOUT', 'OUTPUT_LIMIT'].includes(v.transportOutcome) &&
    ['FINDINGS', 'BLOCKED', 'CANDIDATE', 'FAILED', 'PASS'].includes(v.parsedOutcome) &&
    (v.candidatePath === null || (typeof v.candidatePath === 'string' && v.candidatePath.length <= 240 &&
      /^tests\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)+$/.test(v.candidatePath))) &&
    (v.candidateContentSha256 === null || (typeof v.candidateContentSha256 === 'string' && /^[a-f0-9]{64}$/.test(v.candidateContentSha256))) &&
    (v.failure === null || ['TIMEOUT', 'PROCESS_FAILURE', 'MALFORMED_RESPONSE', 'AUTHORIZATION_FAILURE',
      'SECURITY_POLICY_FAILURE', 'FORBIDDEN_SCOPE', 'REFUSAL', 'PRODUCTION_BOUNDARY'].includes(v.failure)) &&
    [null, 'PASS', 'FINDINGS'].includes(v.reviewerVerdict);
}
async function readBounded(directory: string, name: string): Promise<Buffer> {
  await assertSafeDirectory(directory);
  const handle = await open(path.join(directory, name), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_ARTIFACT_BYTES) throw new Error('INVALID_ARTIFACT');
    const bytes = Buffer.alloc(MAX_ARTIFACT_BYTES + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > MAX_ARTIFACT_BYTES) throw new Error('INVALID_ARTIFACT');
    return bytes.subarray(0, bytesRead);
  } finally { await handle.close(); }
}
async function exclusive(directory: string, name: string, bytes: Buffer) {
  await assertSafeDirectory(directory);
  const handle = await open(path.join(directory, name), 'wx', 0o600);
  try { await handle.writeFile(bytes); } finally { await handle.close(); }
}
async function checkArtifacts(directory: string, runId: string, records: ArtifactRecord[], extra: string[]) {
  if (!Array.isArray(records) || records.length < 1 || records.length > 4) throw new Error('INVALID_MANIFEST');
  const seen = new Set<string>();
  let previous = -1;
  for (const record of records) {
    if (!record || Object.keys(record).sort().join(',') !== 'bytes,name,sha256' ||
      !/^(SCOUT|CODEX|ANTIGRAVITY|REVIEWER)\.json$/.test(record.name) || seen.has(record.name)) throw new Error('INVALID_MANIFEST');
    const index = stages.findIndex(stage => record.name === stage + '.json');
    if (index <= previous || (previous === -1 && index !== 0)) throw new Error('INVALID_STAGE_ORDER');
    previous = index;
    seen.add(record.name);
    const bytes = await readBounded(directory, record.name);
    if (bytes.length !== record.bytes || digest(bytes) !== record.sha256) throw new Error('ARTIFACT_CHANGED');
    const value = JSON.parse(Buffer.from(bytes).toString('utf8'));
    if (!validRecord(value, runId) || record.name !== value.stage + '.json') throw new Error('INVALID_ARTIFACT');
  }
  const actual = (await readdir(directory)).sort();
  if (actual.join(',') !== [...seen, ...extra].sort().join(',')) throw new Error('UNEXPECTED_ARTIFACT');
}
export async function verifyAgentRunManifest(directory: string) {
  const bytes = await readBounded(directory, 'manifest.json');
  const manifestSha256 = digest(bytes);
  if (Buffer.from(await readBounded(directory, 'manifest.sha256')).toString('utf8') !== manifestSha256 + '\n') throw new Error('MANIFEST_HASH_MISMATCH');
  const manifest = JSON.parse(Buffer.from(bytes).toString('utf8'));
  if (!manifest || Object.keys(manifest).sort().join(',') !== 'runId,schemaVersion,stages' ||
    manifest.schemaVersion !== schemaVersion || !/^[A-Za-z0-9_-]{1,80}$/.test(manifest.runId) ||
    path.basename(directory) !== manifest.runId) throw new Error('INVALID_MANIFEST');
  await checkArtifacts(directory, manifest.runId, manifest.stages, ['manifest.json', 'manifest.sha256']);
  return Object.freeze({ manifestPath: path.join(directory, 'manifest.json'), manifestSha256 });
}
export const MAX_ARTIFACT_BYTES = 131072;
export const MAX_RECORDED_PROCESS_STREAM_BYTES = 262_144;
/** Roots must be privately controlled: Node cannot exclude hostile concurrent ancestor replacement. */
export async function assertSafeDirectory(root: string): Promise<void> {
  if (!path.isAbsolute(root) || root !== path.resolve(root)) throw new Error('UNSAFE_ROOT');
  let current = path.parse(root).root;
  for (const part of root.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('UNSAFE_ROOT');
  }
  if (await realpath(root) !== root) throw new Error('UNSAFE_ROOT');
}
export async function createAgentRunStore(stateRoot: string, runId: string) {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(runId)) throw new Error('INVALID_RUN_ID');
  await assertSafeDirectory(stateRoot);
  const directory = path.join(stateRoot, runId);
  await mkdir(directory, { mode: 0o700 });
  const records: ArtifactRecord[] = [];
  let finalized = false;
  return Object.freeze({ directory,
    get artifacts(): readonly ArtifactRecord[] { return Object.freeze([...records]); },
    async writeStage(value: StageRecord): Promise<ArtifactRecord> {
      if (finalized || !validRecord(value, runId)) throw new Error('INVALID_ARTIFACT');
      // Serialize a validated snapshot only; never accept arbitrary text/bytes.
      const serialized = JSON.stringify(value);
      const snapshot = JSON.parse(serialized);
      if (!validRecord(snapshot, runId) || Buffer.byteLength(serialized) > MAX_ARTIFACT_BYTES) throw new Error('INVALID_ARTIFACT');
      const bytes = Buffer.from(serialized);
      const name = snapshot.stage + '.json';
      await exclusive(directory, name, bytes);
      const record = Object.freeze({ name, sha256: digest(bytes), bytes: bytes.length });
      records.push(record);
      return record;
    },
    async finalize() {
      if (finalized) throw new Error('ALREADY_FINALIZED');
      finalized = true;
      await checkArtifacts(directory, runId, records, []);
      const bytes = Buffer.from(JSON.stringify({ schemaVersion, runId, stages: records }));
      await exclusive(directory, 'manifest.json', bytes);
      await exclusive(directory, 'manifest.sha256', Buffer.from(digest(bytes) + '\n'));
      return { manifestPath: path.join(directory, 'manifest.json'), manifestSha256: digest(bytes) };
    },
  });
}
