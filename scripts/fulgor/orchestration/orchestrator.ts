import { createHash } from 'node:crypto';

/** No stage can grant capabilities. FULGOR and its signed human gate remain external. */
export const NO_AUTO_ACTION = Object.freeze({
  autoCommit: false, autoPush: false, autoMerge: false, deploy: false,
  productionExecutorEnabled: false, automaticPromotionAllowed: false,
  humanApprovalRequired: true,
} as const);
export const BOUNDS = Object.freeze({ maxResponseBytes: 131072, maxContentBytes: 32768, maxStages: 4 });
export const BUILDER_FAILURES = [
  'TIMEOUT', 'OUTPUT_LIMIT', 'NON_ZERO_EXIT', 'SPAWN_FAILURE', 'INVALID_CONFIG', 'MALFORMED_RESPONSE', 'AUTHORIZATION_FAILURE',
  'SECURITY_POLICY_FAILURE', 'FORBIDDEN_SCOPE', 'REFUSAL', 'PRODUCTION_BOUNDARY',
] as const;
export type BuilderFailure = typeof BUILDER_FAILURES[number];
export function fallbackEligible(failure: unknown): boolean {
  return failure === 'TIMEOUT' || failure === 'OUTPUT_LIMIT' || failure === 'MALFORMED_RESPONSE';
}
export type Stage = 'SCOUT' | 'CODEX' | 'ANTIGRAVITY' | 'REVIEWER';
export type State = 'AWAITING_SCOUT' | 'AWAITING_CODEX' | 'FALLBACK_ELIGIBLE' |
  'AWAITING_REVIEWER' | 'FULGOR_HANDOFF_ELIGIBLE' | 'UNSUPPORTED_HANDOFF' | 'NEEDS_REVIEW';
export interface Candidate {
  baseline: string;
  path: string;
  status: '??';
  kind: 'regular';
  content: string;
  contentSha256: string;
  trackedPatch: '';
  admission: 'WHITE';
}
export interface Evidence {
  readonly stage: Stage;
  readonly responseSha256: string;
}
export interface Session {
  readonly schemaVersion: 'VELNAR_ORCHESTRATION_V1';
  readonly requestId: string;
  readonly baseline: string;
  readonly state: State;
  readonly candidate: Readonly<Candidate> | null;
  readonly evidence: readonly Readonly<Evidence>[];
  readonly reason: string | null;
  readonly policy: typeof NO_AUTO_ACTION;
}
export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  return record(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}
function snapshot(session: Session): Session {
  return Object.freeze({ ...session, policy: NO_AUTO_ACTION,
    candidate: session.candidate && Object.freeze({ ...session.candidate }),
    evidence: Object.freeze(session.evidence.map(item => Object.freeze({ ...item }))),
  });
}
// Only locally issued immutable sessions may be advanced; JSON state cannot grant authority.
const issued = new WeakSet<object>();
function issue(session: Session): Session {
  const result = snapshot(session);
  issued.add(result);
  return result;
}
export function startOrchestration(requestId: string, baseline: string): Session {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(requestId) || !/^[a-f0-9]{40}$/.test(baseline)) {
    throw new Error('INVALID_ORCHESTRATION_IDENTITY');
  }
  return issue({ schemaVersion: 'VELNAR_ORCHESTRATION_V1', requestId, baseline,
    state: 'AWAITING_SCOUT', candidate: null, evidence: [], reason: null, policy: NO_AUTO_ACTION });
}
function supportedCandidate(value: unknown, baseline: string): value is Candidate {
  if (!exact(value, ['baseline', 'path', 'status', 'kind', 'content', 'contentSha256', 'trackedPatch', 'admission'])) return false;
  return value.baseline === baseline && value.status === '??' && value.kind === 'regular' &&
    value.trackedPatch === '' && value.admission === 'WHITE' &&
    typeof value.path === 'string' && /^tests\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)+$/.test(value.path) &&
    value.path.length <= 240 && typeof value.content === 'string' && !value.content.includes('\0') &&
    Buffer.byteLength(value.content, 'utf8') <= BOUNDS.maxContentBytes && value.contentSha256 === sha256(value.content);
}
/** Exact JSON evidence envelope; never an authoritative verifier verdict. */
export function advanceOrchestration(input: unknown, response: unknown): Session {
  if (!record(input) || !issued.has(input)) throw new Error('INVALID_ORCHESTRATION_STATE');
  const session = input as unknown as Session;
  const halt = (reason: string, state: State = 'NEEDS_REVIEW') => issue({ ...session, state, reason });
  const expected: Partial<Record<State, Stage>> = {
    AWAITING_SCOUT: 'SCOUT', AWAITING_CODEX: 'CODEX', FALLBACK_ELIGIBLE: 'ANTIGRAVITY', AWAITING_REVIEWER: 'REVIEWER',
  };
  const stage = expected[session.state];
  if (!stage) return halt('TERMINAL_STATE');
  if (typeof response !== 'string' || Buffer.byteLength(response, 'utf8') > BOUNDS.maxResponseBytes) return halt('MALFORMED_OUTPUT');
  let value: unknown;
  try { value = JSON.parse(response); } catch { return halt('MALFORMED_OUTPUT'); }
  if (!exact(value, ['schemaVersion', 'requestId', 'stage', 'artifactSha256', 'disposition', 'failure', 'candidate'])) return halt('MALFORMED_OUTPUT');
  if (value.schemaVersion !== session.schemaVersion || value.requestId !== session.requestId || value.stage !== stage ||
    value.artifactSha256 !== (session.candidate ? sha256(JSON.stringify(session.candidate)) : sha256(session.baseline))) return halt('BINDING_MISMATCH');
  // Persist only immutable digest evidence; no output can alter policy or limits.
  const next = { ...session, evidence: [...session.evidence, { stage, responseSha256: sha256(response) }] };
  const end = (state: State, reason: string | null = null, candidate = session.candidate) => issue({ ...next, state, reason, candidate });
  if (value.disposition === 'BLOCKED' && value.failure === null && value.candidate === null) return end('NEEDS_REVIEW', 'BLOCKER');
  if (stage === 'CODEX' || stage === 'ANTIGRAVITY') {
    if (value.disposition === 'FAILED' && value.candidate === null && BUILDER_FAILURES.includes(value.failure as BuilderFailure)) {
      return end(stage === 'CODEX' && fallbackEligible(value.failure) ? 'FALLBACK_ELIGIBLE' : 'NEEDS_REVIEW', String(value.failure));
    }
    if (value.disposition !== 'CANDIDATE' || value.failure !== null) return end('NEEDS_REVIEW', 'MALFORMED_BUILDER_OUTPUT');
    if (!supportedCandidate(value.candidate, session.baseline)) return end('UNSUPPORTED_HANDOFF', 'UNSUPPORTED_CANDIDATE');
    return end('AWAITING_REVIEWER', null, value.candidate);
  }
  if (value.failure !== null || value.candidate !== null) return end('NEEDS_REVIEW', 'MALFORMED_OUTPUT');
  if (stage === 'SCOUT') return value.disposition === 'FINDINGS' ? end('AWAITING_CODEX') : end('NEEDS_REVIEW', 'SCOUT_BLOCKED');
  // Valid reviewer verdicts are advisory evidence only, including FINDINGS.
  // Eligibility only permits a bounded bundle for independent FULGOR verification;
  // it cannot verify, sign, or promote, and human approval remains required.
  return value.disposition === 'PASS' || value.disposition === 'FINDINGS' || value.disposition === 'NO_BLOCKERS'
    ? end('FULGOR_HANDOFF_ELIGIBLE') : end('NEEDS_REVIEW', 'MALFORMED_OUTPUT');
}

/** DI boundary accepts evidence only. No live CLI or FULGOR implementation is provided. */
export interface EvidenceAdapters {
  scout: (session: Session) => string;
  codex: (session: Session) => string;
  antigravity?: (session: Session) => string;
  reviewer: (session: Session) => string;
}
export function runOrchestration(requestId: string, baseline: string, adapters: EvidenceAdapters): Session {
  let session = startOrchestration(requestId, baseline);
  for (let count = 0; count < BOUNDS.maxStages; count++) {
    const adapter = session.state === 'AWAITING_SCOUT' ? adapters.scout :
      session.state === 'AWAITING_CODEX' ? adapters.codex :
      session.state === 'FALLBACK_ELIGIBLE' ? adapters.antigravity :
      session.state === 'AWAITING_REVIEWER' ? adapters.reviewer : undefined;
    if (!adapter) return session;
    try { session = advanceOrchestration(session, adapter(session)); }
    catch { return issue({ ...session, state: 'NEEDS_REVIEW', reason: 'ADAPTER_FAILURE' }); }
  }
  return session;
}
