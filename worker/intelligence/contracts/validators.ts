import {
  ASSERTION_BY_CLASS, CONTRACT_VERSION, RESOURCE_LIMITS, VULNERABILITY_CLASSES,
  type CodeSnapshotRef, type FindingCandidate, type VerificationRequest,
  type EvidenceArtifact, type VerificationResult, type DeepReadonly,
} from './types';

type RecordValue = Record<string, unknown>;
export function protocolError(reason: string): never {
  // Never echo untrusted payloads (which may contain secrets) into logs/errors.
  throw new Error(`INTELLIGENCE_PROTOCOL_ERROR: ${reason}`);
}
function object(raw: unknown, required: readonly string[], optional: readonly string[] = []): RecordValue {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) protocolError('expected plain object');
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  for (const key of Reflect.ownKeys(raw)) {
    if (typeof key !== 'string' || !required.includes(key) && !optional.includes(key)) protocolError('unknown field');
    if (!('value' in descriptors[key]) || !descriptors[key].enumerable) protocolError('non-data field');
  }
  for (const key of required) if (!Object.hasOwn(raw, key)) protocolError(`missing ${key}`);
  return raw as RecordValue;
}
function text(value: unknown, field: string, max = 256): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || value.trim() !== value
    || /[\u0000-\u001f\u007f]/.test(value)) protocolError(`invalid ${field}`);
}
function id(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) protocolError(`invalid ${field}`);
}
function choice(value: unknown, values: readonly unknown[], field: string): void {
  if (!values.includes(value)) protocolError(`invalid ${field}`);
}
function array(value: unknown, min: number, max: number, field: string): asserts value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length < min || value.length > max
    || Reflect.ownKeys(value).length !== value.length + 1) protocolError(`invalid ${field}`);
  for (let i = 0; i < value.length; i++) {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !('value' in d) || !d.enumerable) protocolError(`invalid ${field} entry`);
  }
}
function integer(value: unknown, min: number, max: number, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max || Object.is(value, -0)) {
    protocolError(`invalid ${field}`);
  }
}
function timestamp(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) protocolError(`invalid ${field}`);
}
function digest(value: unknown, field: string): void {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value)) protocolError(`invalid ${field}`);
}
function commit(value: unknown): void {
  // Full Git SHA-1 or SHA-256 object IDs; no abbreviations or case normalization.
  if (typeof value !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value) || /^0+$/.test(value)) {
    protocolError('invalid commitSha');
  }
}
function tenant(r: RecordValue, expected?: string): void {
  choice(r.contractVersion, [CONTRACT_VERSION], 'contractVersion');
  id(r.organizationId, 'organizationId');
  if (expected !== undefined) { id(expected, 'expectedOrganizationId'); equal(r.organizationId, expected, 'organizationId'); }
}
function equal(a: unknown, b: unknown, field: string): void {
  if (a !== b) protocolError(`${field} mismatch`);
}
// Detached immutable output prevents mutation of nested caller-owned objects after validation.
export function immutableCopy<T>(value: T): DeepReadonly<T> {
  if (Array.isArray(value)) return Object.freeze(value.map(v => immutableCopy(v))) as DeepReadonly<T>;
  if (value && typeof value === 'object') {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([k, v]) => [k, immutableCopy(v)]))) as DeepReadonly<T>;
  }
  return value as DeepReadonly<T>;
}
function location(raw: unknown): void {
  const r = object(raw, ['filePath', 'symbol'], ['semanticId', 'line', 'column']);
  text(r.filePath, 'filePath', 512);
  if (r.filePath.startsWith('/') || /[\\:]/.test(r.filePath)
    || r.filePath.split('/').some(p => !p || p === '.' || p === '..')) protocolError('filePath must be repository-relative');
  text(r.symbol, 'symbol');
  if (Object.hasOwn(r, 'semanticId')) id(r.semanticId, 'semanticId');
  if (Object.hasOwn(r, 'line')) integer(r.line, 1, 10_000_000, 'line');
  if (Object.hasOwn(r, 'column')) {
    integer(r.column, 1, 1_000_000, 'column');
    if (!Object.hasOwn(r, 'line')) protocolError('column requires line');
  }
}
export function validateCodeSnapshotRef(raw: unknown, expectedOrganizationId?: string): CodeSnapshotRef {
  const r = object(raw, ['contractVersion', 'snapshotId', 'organizationId', 'repositoryId', 'sourceProvider', 'commitSha', 'ref', 'createdAt']);
  tenant(r, expectedOrganizationId);
  for (const k of ['snapshotId', 'repositoryId']) id(r[k], k);
  choice(r.sourceProvider, ['GITHUB', 'GITLAB', 'LOCAL_FIXTURE', 'OTHER'], 'sourceProvider');
  commit(r.commitSha); text(r.ref, 'ref'); timestamp(r.createdAt, 'createdAt');
  return immutableCopy(r) as unknown as CodeSnapshotRef;
}
export function validateFindingCandidate(raw: unknown, expectedOrganizationId?: string): FindingCandidate {
  const r = object(raw, ['contractVersion', 'candidateId', 'organizationId', 'snapshot', 'vulnerabilityClass', 'source', 'sink',
    'context', 'sensorEvidence', 'reachabilityState', 'verificationState', 'createdAt']);
  tenant(r, expectedOrganizationId); id(r.candidateId, 'candidateId');
  const snapshot = validateCodeSnapshotRef(r.snapshot, r.organizationId as string);
  choice(r.vulnerabilityClass, VULNERABILITY_CLASSES, 'vulnerabilityClass');
  location(r.source); location(r.sink);
  const context = object(r.context, ['entrypoint'], ['routeId']); location(context.entrypoint);
  if (Object.hasOwn(context, 'routeId')) id(context.routeId, 'routeId');
  array(r.sensorEvidence, 1, 32, 'sensorEvidence');
  for (const rawSensor of r.sensorEvidence as unknown[]) {
    const s = object(rawSensor, ['contractVersion', 'organizationId', 'sensorType', 'sensorFindingId', 'ruleId', 'summary',
      'sourceLocation', 'rawEvidenceFingerprint'], ['sinkLocation']);
    tenant(s, r.organizationId as string);
    choice(s.sensorType, ['VELNAR_STRUCTURAL', 'SEMGREP', 'CODEQL', 'OSV', 'TEST_FIXTURE'], 'sensorType');
    id(s.sensorFindingId, 'sensorFindingId'); id(s.ruleId, 'ruleId'); text(s.summary, 'summary', 1000);
    location(s.sourceLocation); if (Object.hasOwn(s, 'sinkLocation')) location(s.sinkLocation);
    digest(s.rawEvidenceFingerprint, 'rawEvidenceFingerprint');
  }
  choice(r.reachabilityState, ['UNKNOWN', 'REACHABLE', 'UNREACHABLE', 'INCONCLUSIVE'], 'reachabilityState');
  choice(r.verificationState, ['CANDIDATE'], 'verificationState');
  timestamp(r.createdAt, 'createdAt');
  if (r.createdAt < snapshot.createdAt) protocolError('candidate predates snapshot');
  return immutableCopy(r) as unknown as FindingCandidate;
}
function profile(raw: unknown): RecordValue {
  const r = object(raw, ['profileId', 'version']); id(r.profileId, 'profileId'); integer(r.version, 1, 1_000_000, 'profile version'); return r;
}
function environment(raw: unknown, identity = false): RecordValue {
  const r = object(raw, ['environmentType', 'runtime', 'runtimeVersion', ...(identity ? ['environmentId', 'imageDigest'] : [])]);
  choice(r.environmentType, ['ISOLATED_TEST'], 'environmentType'); choice(r.runtime, ['NODE', 'PYTHON'], 'runtime');
  if (typeof r.runtimeVersion !== 'string' || !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(r.runtimeVersion)) protocolError('invalid runtimeVersion');
  if (identity) { id(r.environmentId, 'environmentId'); digest(r.imageDigest, 'imageDigest'); }
  return r;
}
function execution(raw: unknown): void {
  const r = object(raw, ['executionId', 'runnerId']); id(r.executionId, 'executionId'); id(r.runnerId, 'runnerId');
}
function binding(r: RecordValue, c: FindingCandidate): void {
  equal(r.organizationId, c.organizationId, 'organizationId'); equal(r.candidateId, c.candidateId, 'candidateId');
  equal(r.snapshotId, c.snapshot.snapshotId, 'snapshotId'); equal(r.commitSha, c.snapshot.commitSha, 'commitSha');
  equal(r.vulnerabilityClass, c.vulnerabilityClass, 'vulnerabilityClass');
}
export function validateVerificationRequest(raw: unknown, candidate: unknown, expectedOrganizationId: string): VerificationRequest {
  id(expectedOrganizationId, 'expectedOrganizationId');
  const c = validateFindingCandidate(candidate, expectedOrganizationId);
  const r = object(raw, ['contractVersion', 'requestId', 'organizationId', 'candidateId', 'snapshotId', 'commitSha', 'vulnerabilityClass',
    'verificationProfile', 'environmentRequirements', 'networkPolicy', 'resourceBudget', 'timeBudgetMs', 'expectedAssertionType', 'createdAt']);
  tenant(r, expectedOrganizationId); id(r.requestId, 'requestId'); binding(r, c);
  profile(r.verificationProfile); environment(r.environmentRequirements);
  const network = object(r.networkPolicy, ['mode', 'allowedDestinations']); choice(network.mode, ['DEFAULT_DENY'], 'network mode');
  array(network.allowedDestinations, 0, 8, 'allowedDestinations');
  const seen = new Set<string>();
  for (const rawDestination of network.allowedDestinations as unknown[]) {
    const d = object(rawDestination, ['hostname', 'port', 'protocol']); text(d.hostname, 'hostname', 253);
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(d.hostname)) protocolError('invalid exact hostname');
    choice(d.protocol, ['HTTPS'], 'network protocol'); equal(d.port, 443, 'HTTPS port');
    if (seen.has(d.hostname)) protocolError('duplicate destination'); seen.add(d.hostname);
  }
  const budget = object(r.resourceBudget, Object.keys(RESOURCE_LIMITS));
  for (const [key, max] of Object.entries(RESOURCE_LIMITS)) integer(budget[key], key === 'maxNetworkRequests' ? 0 : 1, max, key);
  if (seen.size === 0) equal(budget.maxNetworkRequests, 0, 'default-deny network budget');
  else if (budget.maxNetworkRequests === 0) protocolError('allowlist requires bounded positive network budget');
  integer(r.timeBudgetMs, 1, budget.maxWallTimeMs as number, 'timeBudgetMs');
  equal(r.expectedAssertionType, ASSERTION_BY_CLASS[c.vulnerabilityClass], 'expectedAssertionType');
  timestamp(r.createdAt, 'createdAt'); if (r.createdAt < c.createdAt) protocolError('request predates candidate');
  return immutableCopy(r) as unknown as VerificationRequest;
}
function observation(raw: unknown, assertion: unknown): void {
  choice(assertion, ['PASSED', 'FAILED', 'NOT_EVALUATED'], 'assertionResult');
  const o = object(raw, ['observationCode', 'detailsFingerprint']); digest(o.detailsFingerprint, 'detailsFingerprint');
  equal(o.observationCode, { PASSED: 'VIOLATION_OBSERVED', FAILED: 'NO_VIOLATION_OBSERVED', NOT_EVALUATED: 'EXECUTION_INCOMPLETE' }[assertion as string], 'observationCode');
}
function interval(r: RecordValue, request: VerificationRequest): void {
  timestamp(r.startedAt, 'startedAt'); timestamp(r.completedAt, 'completedAt');
  if (r.startedAt < request.createdAt || r.completedAt < r.startedAt
    || Date.parse(r.completedAt) - Date.parse(r.startedAt) > request.timeBudgetMs) protocolError('invalid execution interval');
}
function executionBinding(r: RecordValue, request: VerificationRequest): void {
  equal(r.requestId, request.requestId, 'requestId');
  const e = environment(r.environmentIdentity, true); execution(r.executionIdentity);
  for (const key of ['environmentType', 'runtime', 'runtimeVersion']) equal(e[key], request.environmentRequirements[key], key);
  observation(r.observedBehavior, r.assertionResult); interval(r, request);
}
const evidenceFields = ['contractVersion', 'evidenceId', 'organizationId', 'candidateId', 'requestId', 'repositoryId', 'snapshotId',
  'commitSha', 'vulnerabilityClass', 'verificationProfile', 'environmentIdentity', 'executionIdentity', 'assertionType',
  'assertionResult', 'observedBehavior', 'startedAt', 'completedAt', 'reproduction'] as const;
function evidenceBody(raw: unknown, request: VerificationRequest, c: FindingCandidate): RecordValue {
  const r = object(raw, evidenceFields); tenant(r, c.organizationId); id(r.evidenceId, 'evidenceId'); binding(r, c);
  equal(r.repositoryId, c.snapshot.repositoryId, 'repositoryId'); executionBinding(r, request);
  const p = profile(r.verificationProfile);
  equal(p.profileId, request.verificationProfile.profileId, 'profileId'); equal(p.version, request.verificationProfile.version, 'profile version');
  equal(r.assertionType, request.expectedAssertionType, 'assertionType');
  const reproduction = object(r.reproduction, ['profileId', 'profileVersion', 'fixtureId', 'testId', 'requiredEnvironmentType', 'expectedAssertion']);
  equal(reproduction.profileId, p.profileId, 'reproduction profileId'); equal(reproduction.profileVersion, p.version, 'reproduction profileVersion');
  id(reproduction.fixtureId, 'fixtureId'); id(reproduction.testId, 'testId');
  equal(reproduction.requiredEnvironmentType, request.environmentRequirements.environmentType, 'reproduction environment');
  equal(reproduction.expectedAssertion, r.assertionType, 'reproduction assertion');
  return r;
}
// Closed schema permits only finite integers, strings, arrays and plain data objects.
// Keys sort by UTF-16 code units; JSON string escaping is ECMAScript JSON.stringify.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
async function hashBody(body: RecordValue): Promise<string> {
  const bytes = new TextEncoder().encode(`${CONTRACT_VERSION}:EvidenceArtifact\n${canonical(body)}`);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('')}`;
}
export async function computeEvidenceHash(body: unknown, rawRequest: unknown, candidate: unknown, expectedOrganizationId: string): Promise<string> {
  const request = validateVerificationRequest(rawRequest, candidate, expectedOrganizationId);
  const c = validateFindingCandidate(candidate, expectedOrganizationId);
  return hashBody(immutableCopy(evidenceBody(body, request, c)));
}
export async function validateEvidenceArtifact(raw: unknown, rawRequest: unknown, candidate: unknown, expectedOrganizationId: string): Promise<EvidenceArtifact> {
  const request = validateVerificationRequest(rawRequest, candidate, expectedOrganizationId);
  const c = validateFindingCandidate(candidate, expectedOrganizationId);
  const r = object(raw, [...evidenceFields, 'evidenceHash']); digest(r.evidenceHash, 'evidenceHash');
  const { evidenceHash, ...body } = r;
  const safe = immutableCopy(evidenceBody(body, request, c));
  equal(evidenceHash, await hashBody(safe), 'evidenceHash');
  return immutableCopy({ ...safe, evidenceHash }) as unknown as EvidenceArtifact;
}
export async function validateVerificationResult(raw: unknown, rawRequest: unknown, candidate: unknown, rawEvidence: unknown,
  expectedOrganizationId: string): Promise<VerificationResult> {
  const request = validateVerificationRequest(rawRequest, candidate, expectedOrganizationId);
  const c = validateFindingCandidate(candidate, expectedOrganizationId);
  const r = object(raw, ['contractVersion', 'requestId', 'candidateId', 'organizationId', 'snapshotId', 'commitSha', 'vulnerabilityClass',
    'result', 'evidenceId', 'observedBehavior', 'assertionResult', 'environmentIdentity', 'executionIdentity', 'startedAt', 'completedAt', 'resourceUsage']);
  tenant(r, expectedOrganizationId); binding(r, c); executionBinding(r, request);
  choice(r.result, ['VERIFIED', 'NOT_VERIFIED', 'INCONCLUSIVE'], 'result');
  equal(r.assertionResult, { VERIFIED: 'PASSED', NOT_VERIFIED: 'FAILED', INCONCLUSIVE: 'NOT_EVALUATED' }[r.result as string], 'result assertion');
  if (r.result === 'VERIFIED' && c.reachabilityState === 'UNREACHABLE') protocolError('unreachable candidate cannot be verified');
  const usage = object(r.resourceUsage, ['cpuMillis', 'peakMemoryMb', 'wallTimeMs', 'networkRequests']);
  for (const [field, budgetKey] of [['cpuMillis', 'maxCpuMillis'], ['peakMemoryMb', 'maxMemoryMb'], ['wallTimeMs', 'maxWallTimeMs'], ['networkRequests', 'maxNetworkRequests']]) {
    integer(usage[field], 0, request.resourceBudget[budgetKey], field);
  }
  equal(usage.wallTimeMs, Date.parse(r.completedAt as string) - Date.parse(r.startedAt as string), 'wallTimeMs');
  // Snapshot the result before the async digest check (no caller mutation race).
  const safe = immutableCopy(r);
  if (r.evidenceId === null) {
    if (r.result === 'VERIFIED' || r.result === 'NOT_VERIFIED' || rawEvidence !== undefined && rawEvidence !== null) protocolError('evidence required or unexpected evidence');
  } else {
    id(r.evidenceId, 'evidenceId');
    const e = await validateEvidenceArtifact(rawEvidence, request, c, expectedOrganizationId);
    equal(safe.evidenceId, e.evidenceId, 'evidenceId');
    for (const field of ['observedBehavior', 'assertionResult', 'environmentIdentity', 'executionIdentity', 'startedAt', 'completedAt']) {
      equal(canonical(safe[field]), canonical(e[field]), `result/evidence ${field}`);
    }
  }
  return safe as unknown as VerificationResult;
}
