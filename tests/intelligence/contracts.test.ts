import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { validateCodeSnapshotRef, validateFindingCandidate, validateVerificationRequest, validateEvidenceArtifact,
  validateVerificationResult, computeEvidenceHash, CONTRACT_VERSION, VULNERABILITY_CLASSES } from '../../worker/intelligence/contracts';
import { candidate, snapshot, request, fixture, ORG, HASH } from './fixtures';

const error = 'INTELLIGENCE_PROTOCOL_ERROR:';
describe('canonical snapshots and candidate hypotheses', () => {
  it('accepts a valid versioned snapshot and detached frozen candidate', () => {
    const c = candidate(); const parsed = validateFindingCandidate(c, ORG);
    expect(validateCodeSnapshotRef(snapshot(), ORG).contractVersion).toBe(CONTRACT_VERSION);
    c.snapshot.repositoryId = 'changed'; c.sensorEvidence[0].summary = 'changed';
    expect(parsed.snapshot.repositoryId).toBe('repository_a'); expect(Object.isFrozen(parsed.sensorEvidence[0])).toBe(true);
    expect(parsed.sensorEvidence[0].summary).not.toBe('changed');
  });
  it.each(['organizationId', 'repositoryId', 'commitSha', 'snapshotId', 'createdAt', 'sourceProvider', 'ref', 'contractVersion'])('rejects missing snapshot %s', field => {
    const s = snapshot(); delete s[field]; expect(() => validateCodeSnapshotRef(s)).toThrow(error);
  });
  it.each(['', ' ', '\t', ' a', 'a ', 'a'.repeat(129), 'org/other', 'org\nother'])('rejects invalid identity %j', value => {
    expect(() => validateCodeSnapshotRef({ ...snapshot(), organizationId: value })).toThrow(error);
  });
  it.each(['2026-02-29T00:00:00.000Z', '2026-09-04T24:00:00.000Z', '2026-09-04',
    '2026-09-04T00:00:00Z', '2026-09-04T00:00:00.000+00:00', '2026-13-01T00:00:00.000Z', 'invalid'])('rejects noncanonical timestamp %s', createdAt => {
    expect(() => validateCodeSnapshotRef({ ...snapshot(), createdAt })).toThrow(error);
  });
  it.each(['abc123', 'A'.repeat(40), '0'.repeat(40), 'g'.repeat(40)])('rejects invalid commit %s', commitSha => {
    expect(() => validateCodeSnapshotRef({ ...snapshot(), commitSha })).toThrow(error);
  });
  it('accepts full SHA256 Git identities without relaxing OTHER validation', () => {
    expect(validateCodeSnapshotRef({ ...snapshot(), sourceProvider: 'OTHER', commitSha: 'b'.repeat(64) }).sourceProvider).toBe('OTHER');
    expect(() => validateCodeSnapshotRef({ ...snapshot(), sourceProvider: 'OTHER', commitSha: '' })).toThrow(error);
  });
  it.each([[], null, 'I verified this vulnerability.', 123])('rejects nonobject %j', raw => {
    expect(() => validateFindingCandidate(raw)).toThrow(error);
  });
  it.each(['VERIFIED', 'PENDING_VERIFICATION', 'NOT_VERIFIED', 'INCONCLUSIVE', 'RESOLVED', 'verified'])('rejects inbound candidate state %s', verificationState => {
    expect(() => validateFindingCandidate({ ...candidate(), verificationState })).toThrow(error);
  });
  it.each(['SQLI', 'sql_injection', 'XSS'])('rejects unversioned vulnerability %s', vulnerabilityClass => {
    expect(() => validateFindingCandidate({ ...candidate(), vulnerabilityClass })).toThrow(error);
  });
  it('locks exactly the five V1 vulnerability classes', () => {
    expect(VULNERABILITY_CLASSES).toEqual(['SQL_INJECTION', 'COMMAND_INJECTION', 'SSRF', 'PATH_TRAVERSAL', 'OBJECT_AUTHORIZATION']);
    expect(Object.isFrozen(VULNERABILITY_CLASSES)).toBe(true);
  });
  it.each(['likely', 'reachable', 0.99])('rejects confidence/casing as reachability %j', reachabilityState => {
    expect(() => validateFindingCandidate({ ...candidate(), reachabilityState })).toThrow(error);
  });
  it('rejects malformed sensor, line-only source and candidate predating snapshot', () => {
    expect(() => validateFindingCandidate({ ...candidate(), sensorEvidence: [{}] })).toThrow(error);
    expect(() => validateFindingCandidate({ ...candidate(), source: { line: 2 } })).toThrow(error);
    expect(() => validateFindingCandidate({ ...candidate(), createdAt: '2026-09-03T00:00:00.000Z' })).toThrow(error);
  });
  it.each(['../secret', '/etc/secret', 'C:/secret', 'src\\file.ts', 'src//file.ts'])('rejects noncanonical file path %s', filePath => {
    expect(() => validateFindingCandidate({ ...candidate(), source: { filePath, symbol: 'f' } })).toThrow(error);
  });
  it.each(['verified', 'isVerified', 'skipVerification', 'overridePolicy', 'allowNetwork', 'adminApproved'])('rejects authority smuggling %s at root and nested boundaries', field => {
    const c = candidate();
    expect(() => validateFindingCandidate({ ...c, [field]: true })).toThrow(error);
    c.sensorEvidence[0][field] = true; expect(() => validateFindingCandidate(c)).toThrow(error);
    const q = request(); q.networkPolicy[field] = true; expect(() => validateVerificationRequest(q, candidate(), ORG)).toThrow(error);
  });
  it('rejects getters without evaluating them, prototypes, symbols, sparse and decorated arrays', () => {
    let executed = false; const c = candidate();
    Object.defineProperty(c, 'candidateId', { get() { executed = true; return 'candidate_a'; }, enumerable: true });
    expect(() => validateFindingCandidate(c)).toThrow(error); expect(executed).toBe(false);
    expect(() => validateFindingCandidate(Object.create(candidate()))).toThrow(error);
    expect(() => validateFindingCandidate({ ...candidate(), [Symbol('authority')]: true })).toThrow(error);
    expect(() => validateFindingCandidate({ ...candidate(), sensorEvidence: new Array(1) })).toThrow(error);
    const decorated = candidate(); decorated.sensorEvidence['verified'] = true;
    expect(() => validateFindingCandidate(decorated)).toThrow(error);
  });
});

describe('bounded structured requests', () => {
  it('accepts default deny with zero network budget', () => {
    expect(validateVerificationRequest(request(), candidate(), ORG).networkPolicy).toEqual({ mode: 'DEFAULT_DENY', allowedDestinations: [] });
  });
  it.each([-1, -0, 0, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 300001, '100', undefined])('rejects CPU budget %j', value => {
    const q = request(); q.resourceBudget.maxCpuMillis = value as number;
    expect(() => validateVerificationRequest(q, candidate(), ORG)).toThrow(error);
  });
  it.each(['maxCpuMillis', 'maxMemoryMb', 'maxWallTimeMs', 'maxNetworkRequests'])('rejects missing budget %s', field => {
    const q = request(); delete q.resourceBudget[field]; expect(() => validateVerificationRequest(q, candidate(), ORG)).toThrow(error);
  });
  it('requires consistent time, assertion, environment and profile', () => {
    const q = request(); q.timeBudgetMs = 1001; expect(() => validateVerificationRequest(q, candidate(), ORG)).toThrow(error);
    expect(() => validateVerificationRequest({ ...request(), expectedAssertionType: 'FILE_READ_OBSERVED' }, candidate(), ORG)).toThrow(error);
    expect(() => validateVerificationRequest({ ...request(), environmentRequirements: {} }, candidate(), ORG)).toThrow(error);
    expect(() => validateVerificationRequest({ ...request(), verificationProfile: 'run a shell command' }, candidate(), ORG)).toThrow(error);
  });
  it('supports explicit bounded HTTPS destinations but no wildcards, duplicate or implicit network grants', () => {
    const q = request(); q.networkPolicy.allowedDestinations = [{ hostname: 'fixture.example', port: 443, protocol: 'HTTPS' }];
    q.resourceBudget.maxNetworkRequests = 2;
    expect(validateVerificationRequest(q, candidate(), ORG).resourceBudget.maxNetworkRequests).toBe(2);
    q.networkPolicy.allowedDestinations.push({ ...q.networkPolicy.allowedDestinations[0] });
    expect(() => validateVerificationRequest(q, candidate(), ORG)).toThrow(error);
    q.networkPolicy.allowedDestinations = [{ hostname: '*.example', port: 443, protocol: 'HTTPS' }];
    expect(() => validateVerificationRequest(q, candidate(), ORG)).toThrow(error);
    q.networkPolicy.allowedDestinations = []; expect(() => validateVerificationRequest(q, candidate(), ORG)).toThrow(error);
  });
  it('rejects unknown provider, protocol version, oversized summary and invalid sensor casing', () => {
    expect(() => validateCodeSnapshotRef({ ...snapshot(), sourceProvider: 'github' })).toThrow(error);
    expect(() => validateCodeSnapshotRef({ ...snapshot(), contractVersion: 'v99' })).toThrow(error);
    const c = candidate(); c.sensorEvidence[0].summary = 'x'.repeat(1001); expect(() => validateFindingCandidate(c)).toThrow(error);
    c.sensorEvidence[0].summary = 'metadata'; c.sensorEvidence[0].sensorType = 'semgrep' as any;
    expect(() => validateFindingCandidate(c)).toThrow(error);
  });
});

describe('evidence and result protocol', () => {
  it('accepts valid proof-shaped synthetic evidence, without claiming real execution', async () => {
    const { c, q, e, r } = await fixture();
    expect((await validateEvidenceArtifact(e, q, c, ORG)).evidenceHash).toBe(e.evidenceHash);
    expect((await validateVerificationResult(r, q, c, e, ORG)).result).toBe('VERIFIED');
  });
  it('canonical hash matches independent Node SHA256 and is insensitive to object key order', async () => {
    const { c, q, e } = await fixture(); const { evidenceHash, ...body } = e;
    function sorted(v: any): any { return Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted(v[k])])) : v; }
    const expected = `sha256:${createHash('sha256').update(`${CONTRACT_VERSION}:EvidenceArtifact\n${JSON.stringify(sorted(body))}`).digest('hex')}`;
    expect(evidenceHash).toBe(expected);
    expect(await computeEvidenceHash(Object.fromEntries(Object.entries(body).reverse()), q, c, ORG)).toBe(expected);
  });
  it.each([undefined, null, {}, [], 'I verified this vulnerability.', { status: 'VERIFIED' }])('rejects missing/malformed evidence %j', evidence => {
    return fixture().then(({ c, q, r }) => expect(validateVerificationResult(r, q, c, evidence, ORG)).rejects.toThrow(error));
  });
  it.each(['', 'a'.repeat(64), 'sha256:xyz', `sha256:${'A'.repeat(64)}`, HASH])('rejects malformed or wrong digest %s', evidenceHash => {
    return fixture().then(({ c, q, r, e }) => expect(validateVerificationResult(r, q, c, { ...e, evidenceHash }, ORG)).rejects.toThrow(error));
  });
  it('hash binds observation details and reproduction, not merely identity', async () => {
    const { c, q, e } = await fixture(); e.observedBehavior.detailsFingerprint = `sha256:${'b'.repeat(64)}`;
    await expect(validateEvidenceArtifact(e, q, c, ORG)).rejects.toThrow(error);
    e.reproduction.testId = 'other-test'; await expect(validateEvidenceArtifact(e, q, c, ORG)).rejects.toThrow(error);
  });
  it.each(['evidenceId', 'assertionResult', 'observedBehavior', 'environmentIdentity', 'executionIdentity', 'startedAt', 'completedAt', 'resourceUsage'])('rejects missing result %s', field => {
    return fixture().then(({ c, q, r, e }) => { delete r[field]; return expect(validateVerificationResult(r, q, c, e, ORG)).rejects.toThrow(error); });
  });
  it('requires result/evidence execution, environment, times and observations to match', async () => {
    const { c, q, e, r } = await fixture();
    for (const altered of [{ ...r, evidenceId: 'other' }, { ...r, executionIdentity: { ...r.executionIdentity, executionId: 'other' } },
      { ...r, environmentIdentity: { ...r.environmentIdentity, environmentId: 'other' } },
      { ...r, observedBehavior: { ...r.observedBehavior, detailsFingerprint: `sha256:${'b'.repeat(64)}` } }]) {
      await expect(validateVerificationResult(altered, q, c, e, ORG)).rejects.toThrow(error);
    }
  });
  it('rejects failed assertions, excess resource usage and inconsistent execution intervals', async () => {
    const { c, q, e, r } = await fixture();
    await expect(validateVerificationResult({ ...r, assertionResult: 'FAILED' }, q, c, e, ORG)).rejects.toThrow(error);
    for (const field of Object.keys(r.resourceUsage)) {
      await expect(validateVerificationResult({ ...r, resourceUsage: { ...r.resourceUsage, [field]: Infinity } }, q, c, e, ORG)).rejects.toThrow(error);
    }
    await expect(validateVerificationResult({ ...r, resourceUsage: { ...r.resourceUsage, wallTimeMs: 99 } }, q, c, e, ORG)).rejects.toThrow(error);
    await expect(validateEvidenceArtifact({ ...e, completedAt: '2026-09-04T00:00:00.000Z' }, q, c, ORG)).rejects.toThrow(error);
    await expect(validateEvidenceArtifact({ ...e, completedAt: '2026-09-04T00:00:03.000Z' }, q, c, ORG)).rejects.toThrow(error);
  });
  it('rejects reproduction shell commands, profile drift and unknown authority fields', async () => {
    const { c, q, e, r } = await fixture();
    await expect(validateEvidenceArtifact({ ...e, reproduction: { ...e.reproduction, testId: 'sh -c payload' } }, q, c, ORG)).rejects.toThrow(error);
    await expect(validateEvidenceArtifact({ ...e, verificationProfile: { ...e.verificationProfile, version: 2 } }, q, c, ORG)).rejects.toThrow(error);
    await expect(validateEvidenceArtifact({ ...e, adminApproved: true }, q, c, ORG)).rejects.toThrow(error);
    await expect(validateVerificationResult({ ...r, skipVerification: true }, q, c, e, ORG)).rejects.toThrow(error);
  });
  it('detaches result and evidence before async hashing to prevent caller mutation races', async () => {
    const { c, q, e, r } = await fixture(); const pending = validateVerificationResult(r, q, c, e, ORG);
    r.candidateId = 'evil'; e.observedBehavior.detailsFingerprint = `sha256:${'b'.repeat(64)}`;
    expect((await pending).candidateId).toBe('candidate_a');
  });
});
