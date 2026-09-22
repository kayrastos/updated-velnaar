import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CONTRACT_VERSION, computeCandidateBinding, computeEvidenceHash, createVerificationState,
  transitionVerificationState, validateEvidenceArtifact, validateVerificationRequest, validateVerificationResult,
  type FindingCandidate } from '../../worker/intelligence/contracts';
import { candidate, fixture, ORG, type Mutable } from './fixtures';

const error = 'INTELLIGENCE_PROTOCOL_ERROR:';
// Independent test encoder (does not use the production canonicalization helper).
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}';
}
function reverseKeys(value: any): any {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reverseKeys(v)]));
  return value;
}

const changes: [string, (c: Mutable<FindingCandidate>) => void][] = [
  ['source path', c => { c.source.filePath = 'src/other.ts'; }],
  ['source symbol', c => { c.source.symbol = 'other'; }],
  ['source line', c => { c.source.line = 3; }],
  ['source column', c => { c.source.column = 2; }],
  ['source semantic ID', c => { c.source.semanticId = 'other.source'; }],
  ['sink path', c => { c.sink.filePath = 'src/other-store.ts'; }],
  ['sink symbol', c => { c.sink.symbol = 'other'; }],
  ['sink semantic ID', c => { c.sink.semanticId = 'other.sink'; }],
  ['entrypoint', c => { c.context.entrypoint.symbol = 'other'; }],
  ['route context', c => { c.context.routeId = 'POST.search'; }],
  ['sensor identity', c => { c.sensorEvidence[0].sensorFindingId = 'sensor_b'; }],
  ['sensor type', c => { c.sensorEvidence[0].sensorType = 'SEMGREP'; }],
  ['sensor rule', c => { c.sensorEvidence[0].ruleId = 'sqli-v2'; }],
  ['sensor summary', c => { c.sensorEvidence[0].summary = 'Different untrusted hypothesis.'; }],
  ['sensor source', c => { c.sensorEvidence[0].sourceLocation.symbol = 'other'; }],
  ['sensor sink', c => { c.sensorEvidence[0].sinkLocation = { ...c.sink }; }],
  ['sensor evidence fingerprint', c => { c.sensorEvidence[0].rawEvidenceFingerprint = `sha256:${'b'.repeat(64)}`; }],
  ['sensor array content', c => { c.sensorEvidence.push({ ...c.sensorEvidence[0], sensorFindingId: 'sensor_b' }); }],
  ['reachability', c => { c.reachabilityState = 'UNKNOWN'; }],
  ['candidate timestamp', c => { c.createdAt = '2026-09-04T00:00:00.001Z'; }],
  ['snapshot ref', c => { c.snapshot.ref = 'refs/heads/other'; }],
  ['snapshot provider', c => { c.snapshot.sourceProvider = 'GITHUB'; }],
  ['snapshot timestamp', c => { c.snapshot.createdAt = '2026-09-03T00:00:00.000Z'; }],
];

describe('human review: complete candidate semantic identity', () => {
  it.each(changes)('Candidate A proof cannot verify Candidate B with same IDs/commit but different %s', async (_name, change) => {
    const { c, q, e, r } = await fixture();
    const b = structuredClone(c); change(b);
    expect(b.candidateId).toBe(c.candidateId); expect(b.snapshot.commitSha).toBe(c.snapshot.commitSha);
    expect(b.organizationId).toBe(c.organizationId); expect(b.snapshot.repositoryId).toBe(c.snapshot.repositoryId);
    expect(b.snapshot.snapshotId).toBe(c.snapshot.snapshotId); expect(b.vulnerabilityClass).toBe(c.vulnerabilityClass);
    const bindingB = computeCandidateBinding(b, ORG);
    expect(bindingB).not.toBe(q.candidateBinding);
    const initialB = createVerificationState(b, ORG);
    await expect(transitionVerificationState(initialB, { type: 'BEGIN', request: q })).rejects.toThrow('candidateBinding mismatch');
    // Legitimately request B; rewriting request/result labels still cannot reuse A's artifact.
    const qb = { ...q, candidateBinding: bindingB, createdAt: b.createdAt };
    const rb = { ...r, candidateBinding: bindingB };
    const pendingB = await transitionVerificationState(initialB, { type: 'BEGIN', request: qb });
    await expect(validateEvidenceArtifact(e, qb, b, ORG)).rejects.toThrow('candidateBinding mismatch');
    await expect(transitionVerificationState(pendingB, { type: 'COMPLETE', result: rb, evidence: e })).rejects.toThrow('candidateBinding mismatch');
    // Rewriting the artifact's binding requires a NEW integrity hash, not A's proof hash.
    await expect(transitionVerificationState(pendingB, { type: 'COMPLETE', result: rb,
      evidence: { ...e, candidateBinding: bindingB } })).rejects.toThrow('evidenceHash mismatch');
    expect(pendingB.state).toBe('PENDING_VERIFICATION');
  });

  it.each(['request', 'evidence', 'result'] as const)('rejects missing, malformed or tampered %s binding', async target => {
    for (const value of [undefined, null, 1, '', 'model says VERIFIED', `sha256:${'a'.repeat(64)}`, computeCandidateBinding(candidate(), ORG) + ' ']) {
      const { c, q, e, r } = await fixture();
      const wire = target === 'request' ? q : target === 'evidence' ? e : r;
      if (value === undefined) delete (wire as any).candidateBinding;
      else (wire as any).candidateBinding = value;
      await expect(validateVerificationResult(r, q, c, e, ORG)).rejects.toThrow(error);
    }
  });

  it('matches independent canonical encoding and ignores recursive object key insertion order', async () => {
    const { c, q, e, r } = await fixture();
    const expected = `${CONTRACT_VERSION}:FindingCandidate\n${canonical(c)}`;
    expect(computeCandidateBinding(c, ORG)).toBe(expected);
    expect(computeCandidateBinding(reverseKeys(c), ORG)).toBe(expected);
    expect([q.candidateBinding, e.candidateBinding, r.candidateBinding]).toEqual([expected, expected, expected]);
    expect(validateVerificationRequest(q, reverseKeys(c), ORG)).toEqual(q);
    const { evidenceHash, ...body } = e;
    const expectedHash = createHash('sha256').update(`${CONTRACT_VERSION}:EvidenceArtifact\n${canonical(body)}`, 'utf8').digest('hex');
    expect(evidenceHash).toBe(`sha256:${expectedHash}`);
  });

  it('binds sensor ordering and optional field presence without normalization', () => {
    const c = candidate(); c.sensorEvidence.push({ ...c.sensorEvidence[0], sensorFindingId: 'sensor_b' });
    const bound = computeCandidateBinding(c, ORG);
    c.sensorEvidence.reverse(); expect(computeCandidateBinding(c, ORG)).not.toBe(bound);
    const before = computeCandidateBinding(c, ORG); delete c.context.routeId;
    expect(computeCandidateBinding(c, ORG)).not.toBe(before);
  });

  it('validates the candidate and required expected tenant before computing its binding', () => {
    for (const expected of ['', undefined, null, 'org_b']) {
      expect(() => computeCandidateBinding(candidate(), expected as string)).toThrow(error);
    }
    const c = candidate(); let invoked = false;
    Object.defineProperty(c.source, 'symbol', { get() { invoked = true; return 'other'; }, enumerable: true });
    expect(() => computeCandidateBinding(c, ORG)).toThrow(error); expect(invoked).toBe(false);
    expect(() => computeCandidateBinding({ ...candidate(), verificationState: 'VERIFIED' }, ORG)).toThrow(error);
  });

  it('preserves the exact-candidate three-state path and prohibits direct completion', async () => {
    const { c, q, e, r } = await fixture(); const start = createVerificationState(c, ORG);
    await expect(transitionVerificationState(start, { type: 'COMPLETE', result: r, evidence: e })).rejects.toThrow('COMPLETE requires pending verification');
    const pending = await transitionVerificationState(start, { type: 'BEGIN', request: q });
    const done = await transitionVerificationState(pending, { type: 'COMPLETE', result: r, evidence: e });
    expect([start.state, pending.state, done.state]).toEqual(['CANDIDATE', 'PENDING_VERIFICATION', 'VERIFIED']);
    expect(done.result.candidateBinding).toBe(computeCandidateBinding(done.candidate, ORG));
  });

  it('retains Commit A to Commit B replay protection after rebinding the new request/result', async () => {
    const { c, q, e, r } = await fixture(); c.snapshot.commitSha = q.commitSha = r.commitSha = 'b'.repeat(40);
    q.candidateBinding = r.candidateBinding = computeCandidateBinding(c, ORG);
    const pending = await transitionVerificationState(createVerificationState(c, ORG), { type: 'BEGIN', request: q });
    await expect(transitionVerificationState(pending, { type: 'COMPLETE', result: r, evidence: e })).rejects.toThrow('commitSha mismatch');
  });

  it('retains tenant isolation even for an internally consistent newly bound foreign chain', async () => {
    const { c, q, e, r } = await fixture();
    c.organizationId = c.snapshot.organizationId = c.sensorEvidence[0].organizationId = q.organizationId = e.organizationId = r.organizationId = 'org_b';
    q.candidateBinding = e.candidateBinding = r.candidateBinding = computeCandidateBinding(c, 'org_b');
    const { evidenceHash: _old, ...body } = e; e.evidenceHash = await computeEvidenceHash(body, q, c, 'org_b');
    await expect(validateVerificationResult(r, q, c, e, ORG)).rejects.toThrow('organizationId mismatch');
  });

  it('detaches and deeply freezes candidate-bound outputs before the async evidence hash boundary', async () => {
    const { c, q, e, r } = await fixture(); const original = q.candidateBinding;
    const safeRequest = validateVerificationRequest(q, c, ORG);
    const validatingEvidence = validateEvidenceArtifact(e, q, c, ORG);
    const validatingResult = validateVerificationResult(r, q, c, e, ORG);
    c.source.symbol = 'mutated'; c.context.entrypoint.symbol = 'mutated'; c.sensorEvidence[0].summary = 'mutated';
    q.candidateBinding = e.candidateBinding = r.candidateBinding = 'mutated';
    const safeEvidence = await validatingEvidence; const safeResult = await validatingResult;
    for (const safe of [safeRequest, safeEvidence, safeResult]) {
      expect(safe.candidateBinding).toBe(original); expect(Object.isFrozen(safe)).toBe(true);
      expect(() => { (safe as any).candidateBinding = 'mutated'; }).toThrow();
    }
    expect(Object.isFrozen(safeRequest.networkPolicy.allowedDestinations)).toBe(true);
    expect(Object.isFrozen(safeEvidence.reproduction)).toBe(true);
    expect(Object.isFrozen(safeResult.environmentIdentity)).toBe(true);
  });

  it('rejects hash creation against a different candidate instead of laundering an old artifact', async () => {
    const { c, q, e } = await fixture(); c.source.symbol = 'other';
    q.candidateBinding = computeCandidateBinding(c, ORG);
    const { evidenceHash: _old, ...body } = e;
    await expect(computeEvidenceHash(body, q, c, ORG)).rejects.toThrow('candidateBinding mismatch');
  });
});
