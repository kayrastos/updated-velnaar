import { describe, it, expect } from 'vitest';
import { validateCodeSnapshotRef, validateFindingCandidate, validateVerificationRequest,
  validateEvidenceArtifact, validateVerificationResult } from '../../worker/intelligence/contracts';
import { fixture, candidate, snapshot, request, ORG } from './fixtures';
const error = 'INTELLIGENCE_PROTOCOL_ERROR:';

describe('tenant and exact code-state bindings', () => {
  it.each(['organizationId', 'candidateId', 'snapshotId', 'commitSha', 'vulnerabilityClass'])('rejects candidate/request %s mismatch', field => {
    const q = request(); q[field] = field === 'commitSha' ? 'b'.repeat(40) : field === 'vulnerabilityClass' ? 'SSRF' : 'other';
    expect(() => validateVerificationRequest(q, candidate(), ORG)).toThrow(error);
  });
  it.each(['organizationId', 'candidateId', 'snapshotId', 'commitSha', 'vulnerabilityClass', 'requestId', 'repositoryId'])('rejects request/evidence %s mismatch', field => {
    return fixture().then(({ c, q, e }) => {
      e[field] = field === 'commitSha' ? 'b'.repeat(40) : field === 'vulnerabilityClass' ? 'SSRF' : 'other';
      return expect(validateEvidenceArtifact(e, q, c, ORG)).rejects.toThrow(error);
    });
  });
  it.each(['organizationId', 'candidateId', 'snapshotId', 'commitSha', 'vulnerabilityClass', 'requestId'])('rejects result %s mismatch against request and evidence', field => {
    return fixture().then(({ c, q, r, e }) => {
      r[field] = field === 'commitSha' ? 'b'.repeat(40) : field === 'vulnerabilityClass' ? 'SSRF' : 'other';
      return expect(validateVerificationResult(r, q, c, e, ORG)).rejects.toThrow(error);
    });
  });
  it('rejects foreign snapshot and foreign nested sensor tenant', () => {
    const c = candidate(); c.snapshot.organizationId = 'org_b'; expect(() => validateFindingCandidate(c, ORG)).toThrow(error);
    c.snapshot.organizationId = ORG; c.sensorEvidence[0].organizationId = 'org_b';
    expect(() => validateFindingCandidate(c, ORG)).toThrow(error);
  });
  it('rejects a complete internally consistent foreign-tenant payload at the caller boundary', async () => {
    const { c, q, e, r } = await fixture();
    expect(() => validateCodeSnapshotRef(snapshot(), 'org_b')).toThrow(error);
    expect(() => validateFindingCandidate(c, 'org_b')).toThrow(error);
    expect(() => validateVerificationRequest(q, c, 'org_b')).toThrow(error);
    await expect(validateEvidenceArtifact(e, q, c, 'org_b')).rejects.toThrow(error);
    await expect(validateVerificationResult(r, q, c, e, 'org_b')).rejects.toThrow(error);
  });
  it.each(['', ' ', undefined, null])('does not let invalid expected tenant %j disable checks', expected => {
    expect(() => validateVerificationRequest(request(), candidate(), expected as string)).toThrow(error);
  });
  it('a valid Commit A proof cannot verify a consistent candidate/request/result for Commit B', async () => {
    const { c, q, e, r } = await fixture();
    c.snapshot.commitSha = q.commitSha = r.commitSha = 'b'.repeat(40);
    await expect(validateVerificationResult(r, q, c, e, ORG)).rejects.toThrow(error);
  });
});
