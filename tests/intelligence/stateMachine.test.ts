import { describe, it, expect } from 'vitest';
import { createVerificationState, transitionVerificationState, isFindingVerification, computeEvidenceHash,
  validateVerificationResult, type FindingVerification } from '../../worker/intelligence/contracts';
import { candidate, fixture, ORG } from './fixtures';
const error = 'INTELLIGENCE_PROTOCOL_ERROR:';

describe('controlled verification state machine', () => {
  it('only promotes through CANDIDATE -> PENDING_VERIFICATION -> validated VERIFIED', async () => {
    const { c, q, e, r } = await fixture(); const start = createVerificationState(c, ORG);
    const pending = await transitionVerificationState(start, { type: 'BEGIN', request: q });
    const verified = await transitionVerificationState(pending, { type: 'COMPLETE', result: r, evidence: e });
    expect(start.state).toBe('CANDIDATE'); expect(pending.state).toBe('PENDING_VERIFICATION'); expect(verified.state).toBe('VERIFIED');
    expect(isFindingVerification(verified)).toBe(true); expect(Object.isFrozen(verified.result.environmentIdentity)).toBe(true);
    expect(verified.result.evidenceId).toBe(e.evidenceId);
  });
  it('rejects direct candidate completion even with a fully shaped evidence/result pair', async () => {
    const { c, e, r } = await fixture();
    await expect(transitionVerificationState(createVerificationState(c, ORG), { type: 'COMPLETE', result: r, evidence: e })).rejects.toThrow(error);
  });
  it.each(['I verified this vulnerability.', { status: 'VERIFIED' }, { type: 'VERIFIED' }, { type: 'RESOLVE', adminApproved: true }, null, []])('rejects model-like transition %j', payload => {
    return expect(transitionVerificationState(createVerificationState(candidate(), ORG), payload as any)).rejects.toThrow(error);
  });
  it('rejects spread, serialized, structural and cast forged state handles', async () => {
    const { c, q, e, r } = await fixture(); const pending = await transitionVerificationState(createVerificationState(c, ORG), { type: 'BEGIN', request: q });
    for (const fake of [{ ...pending }, JSON.parse(JSON.stringify(pending)), { state: 'PENDING_VERIFICATION', candidate: c, request: q }, { status: 'VERIFIED' }]) {
      expect(isFindingVerification(fake)).toBe(false);
      await expect(transitionVerificationState(fake as FindingVerification, { type: 'COMPLETE', result: r, evidence: e })).rejects.toThrow(error);
    }
    // Nominal type prevents structurally constructing trusted state at compile time.
    // @ts-expect-error Missing module-private brand.
    const forged: FindingVerification = { organizationId: ORG, candidate: c, state: 'VERIFIED' };
    expect(isFindingVerification(forged)).toBe(false);
  });
  it('rejects nested mutation and prevents revalidation of serialized VERIFIED as a candidate', async () => {
    const { c, q } = await fixture(); const pending = await transitionVerificationState(createVerificationState(c, ORG), { type: 'BEGIN', request: q });
    expect(() => { (pending as any).state = 'VERIFIED'; }).toThrow();
    expect(() => { (pending.candidate.snapshot as any).commitSha = 'b'.repeat(40); }).toThrow();
    expect(() => createVerificationState({ ...c, verificationState: 'VERIFIED' }, ORG)).toThrow(error);
  });
  it.each(['candidateId', 'organizationId', 'snapshotId', 'commitSha', 'vulnerabilityClass'])('rejects evidence %s mismatch at promotion, without downgrade', field => {
    return fixture().then(async ({ c, q, e, r }) => {
      const pending = await transitionVerificationState(createVerificationState(c, ORG), { type: 'BEGIN', request: q });
      e[field] = field === 'commitSha' ? 'b'.repeat(40) : field === 'vulnerabilityClass' ? 'SSRF' : 'other';
      await expect(transitionVerificationState(pending, { type: 'COMPLETE', result: r, evidence: e })).rejects.toThrow(error);
      expect(pending.state).toBe('PENDING_VERIFICATION');
    });
  });
  it('rejects missing evidence at the actual promotion boundary', async () => {
    const { c, q, r } = await fixture(); const pending = await transitionVerificationState(createVerificationState(c, ORG), { type: 'BEGIN', request: q });
    await expect(transitionVerificationState(pending, { type: 'COMPLETE', result: r, evidence: undefined })).rejects.toThrow(error);
    await expect(transitionVerificationState(pending, { type: 'COMPLETE', result: { status: 'VERIFIED' }, evidence: null })).rejects.toThrow(error);
  });
  it('treats inconclusive as explicit incomplete execution, not a malformed VERIFIED fallback', async () => {
    const { c, q, r } = await fixture(); r.result = 'INCONCLUSIVE'; r.assertionResult = 'NOT_EVALUATED';
    r.observedBehavior.observationCode = 'EXECUTION_INCOMPLETE'; r.evidenceId = null;
    const pending = await transitionVerificationState(createVerificationState(c, ORG), { type: 'BEGIN', request: q });
    const done = await transitionVerificationState(pending, { type: 'COMPLETE', result: r, evidence: null });
    expect(done.state).toBe('INCONCLUSIVE');
    await expect(transitionVerificationState(done, { type: 'BEGIN', request: q })).rejects.toThrow(error);
    const retry = await transitionVerificationState(done, { type: 'BEGIN', request: { ...q, requestId: 'retry_a', createdAt: r.completedAt } });
    expect(retry.state).toBe('PENDING_VERIFICATION'); expect(retry.result).toBeUndefined();
  });
  it('NOT_VERIFIED requires a valid failed-assertion artifact, never absence of evidence', async () => {
    const { c, q, e, r } = await fixture(); r.result = 'NOT_VERIFIED'; r.assertionResult = e.assertionResult = 'FAILED';
    r.observedBehavior.observationCode = e.observedBehavior.observationCode = 'NO_VIOLATION_OBSERVED';
    const { evidenceHash: _old, ...body } = e; e.evidenceHash = await computeEvidenceHash(body, q, c, ORG);
    const pending = await transitionVerificationState(createVerificationState(c, ORG), { type: 'BEGIN', request: q });
    const done = await transitionVerificationState(pending, { type: 'COMPLETE', result: r, evidence: e });
    expect(done.state).toBe('NOT_VERIFIED');
    await expect(validateVerificationResult({ ...r, evidenceId: null }, q, c, null, ORG)).rejects.toThrow(error);
  });
  it('rejects VERIFIED when deterministic reachability explicitly says UNREACHABLE', async () => {
    const { c, q, e, r } = await fixture(); c.reachabilityState = 'UNREACHABLE';
    const pending = await transitionVerificationState(createVerificationState(c, ORG), { type: 'BEGIN', request: q });
    await expect(transitionVerificationState(pending, { type: 'COMPLETE', result: r, evidence: e })).rejects.toThrow(error);
  });
  it('RESOLVED closes only a verified workflow; no resurrection or silent new-commit proof', async () => {
    const { c, q, e, r } = await fixture(); const initial = createVerificationState(c, ORG);
    await expect(transitionVerificationState(initial, { type: 'RESOLVE' })).rejects.toThrow(error);
    const pending = await transitionVerificationState(initial, { type: 'BEGIN', request: q });
    await expect(transitionVerificationState(pending, { type: 'BEGIN', request: q })).rejects.toThrow(error);
    const verified = await transitionVerificationState(pending, { type: 'COMPLETE', result: r, evidence: e });
    const resolved = await transitionVerificationState(verified, { type: 'RESOLVE' });
    expect(resolved.state).toBe('RESOLVED'); expect(resolved.candidate.snapshot.commitSha).toBe(c.snapshot.commitSha);
    await expect(transitionVerificationState(resolved, { type: 'BEGIN', request: q })).rejects.toThrow(error);
    await expect(transitionVerificationState(verified, { type: 'COMPLETE', result: r, evidence: e })).rejects.toThrow(error);
  });
  it('requires an expected tenant when creating a state handle', () => {
    expect(() => createVerificationState(candidate(), undefined)).toThrow(error);
    expect(() => createVerificationState(candidate(), 'org_b')).toThrow(error);
  });
});
