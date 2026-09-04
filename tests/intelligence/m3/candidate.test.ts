import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createSqlCandidateBridge } from '../../../worker/intelligence/detection/candidate';
import { computeCandidateBinding, computeEvidenceHash, createVerificationState, transitionVerificationState,
  validateFindingCandidate, type FindingCandidate } from '../../../worker/intelligence/contracts';
import { currentCodeCommit, verifyCommittedFixture } from '../m2/support/gitCodeState';
import { fixture } from '../fixtures';
import { analyzeInput, input, replaceSource, ORG } from './support/inputs';

const bridge = createSqlCandidateBridge(verifyCommittedFixture);
let runs: Awaited<ReturnType<typeof analyzeInput>>[];
beforeAll(async () => { runs = []; for (let i = 0; i < 8; i++) runs.push(await analyzeInput(input(i))); });
async function build(index = 0) { const run = runs[index]; return bridge(run.result, run.snapshot, run.ingestion, ORG); }
// Test-only synthetic protocol transcript. The detector/bridge never creates this evidence.
async function proof(candidate: FindingCandidate) {
  const f = await fixture(), binding = computeCandidateBinding(candidate, ORG);
  const fields = { organizationId: ORG, candidateId: candidate.candidateId, candidateBinding: binding,
    snapshotId: candidate.snapshot.snapshotId, commitSha: candidate.snapshot.commitSha };
  const q = { ...f.q, ...fields };
  const { evidenceHash, ...originalBody } = f.e;
  const body = { ...originalBody, ...fields, repositoryId: candidate.snapshot.repositoryId };
  const e = { ...body, evidenceHash: await computeEvidenceHash(body, q, candidate, ORG) };
  return { q, e, r: { ...f.r, ...fields } };
}
describe('M3 FindingCandidate hypothesis bridge', () => {
  it.each([0, 2, 5, 6, 7])('detected fixture index %i produces only an exact-bound CANDIDATE using real local Git byte checks', async index => {
    const checkedCommit = currentCodeCommit();
    const output = await build(index); expect(output).toHaveLength(1);
    const { candidate, candidateBinding } = output[0], finding = runs[index].result.findings[0];
    expect(Object.keys(output[0]).sort()).toEqual(['candidate', 'candidateBinding']);
    expect(candidate.verificationState).toBe('CANDIDATE'); expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.organizationId).toBe(ORG); expect(candidate.snapshot.repositoryId).toBe(runs[index].snapshot.repositoryId);
    expect(candidate.snapshot.snapshotId).toBe(runs[index].snapshot.snapshotId); expect(candidate.snapshot.commitSha).toBe(checkedCommit);
    for (const side of ['source', 'sink'] as const) {
      const { offset, ...expected } = finding[side]; expect(candidate[side]).toEqual(expected);
    }
    expect(candidate.context.routeId).toBe(finding.routeIdentity);
    expect(candidate.sensorEvidence[0].sensorType).toBe('VELNAR_STRUCTURAL');
    expect(candidate.sensorEvidence[0].rawEvidenceFingerprint).toBe(runs[index].result.resultFingerprint);
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(currentCodeCommit()).toBe(checkedCommit);
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);
    expect(Object.isFrozen(candidate.sensorEvidence[0])).toBe(true);
    expect(createVerificationState(candidate, ORG).state).toBe('CANDIDATE');
  });
  it('binds every real-Git candidate in one run to the same current verified commit', async () => {
    const checkedCommit = currentCodeCommit();
    const outputs = await Promise.all([0, 2, 5, 6, 7].map(index => build(index)));
    const candidates = outputs.flatMap(output => output.map(({ candidate }) => candidate));
    expect(candidates).toHaveLength(5);
    expect(new Set(candidates.map(candidate => candidate.snapshot.commitSha))).toEqual(new Set([checkedCommit]));
    for (const output of outputs) for (const { candidate, candidateBinding } of output) {
      expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    }
    expect(currentCodeCommit()).toBe(checkedCommit);
  });
  it('propagates an arbitrary valid commit returned by the trusted verifier', async () => {
    const checkedCommit = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const modeledBridge = createSqlCandidateBridge(async () => checkedCommit);
    const output = await modeledBridge(runs[0].result, runs[0].snapshot, runs[0].ingestion, ORG);
    expect(output).toHaveLength(1);
    expect(output[0].candidate.snapshot.commitSha).toBe(checkedCommit);
    expect(output[0].candidate.verificationState).toBe('CANDIDATE');
    expect(output[0].candidateBinding).toBe(computeCandidateBinding(output[0].candidate, ORG));
  });
  it.each([
    ['empty', ''],
    ['malformed', 'not-a-commit'],
    ['all-zero', '0000000000000000000000000000000000000000'],
  ])('rejects a %s trusted verifier commit identity', async (_label, checkedCommit) => {
    const modeledBridge = createSqlCandidateBridge(async () => checkedCommit);
    await expect(modeledBridge(runs[0].result, runs[0].snapshot, runs[0].ingestion, ORG)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
  });
  it.each([1, 3, 4])('not-detected fixture index %i creates no vulnerability candidate or commit-verifier call', async index => {
    const verify = vi.fn(), run = runs[index];
    expect(await createSqlCandidateBridge(verify)(run.result, run.snapshot, run.ingestion, ORG)).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  });
  it('inconclusive analysis creates no candidate', async () => {
    const run = await analyzeInput(replaceSource(input(), source => source.replace('return res.json', 'while (true) {} return res.json')));
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(await bridge(run.result, run.snapshot, run.ingestion, ORG)).toEqual([]);
  });
  it.each(['state', 'source', 'sink', 'flow', 'snapshot', 'authority'])('rejects forged %s result before candidate construction or commit verification', async field => {
    const forged: any = structuredClone(runs[0].result);
    if (field === 'state') { forged.status = 'DETECTED'; forged.findings = []; }
    if (field === 'source') forged.findings[0].source.symbol = 'other';
    if (field === 'sink') forged.findings[0].sink.line++;
    if (field === 'flow') forged.findings[0].flow.reverse();
    if (field === 'snapshot') forged.snapshotId = runs[1].snapshot.snapshotId;
    if (field === 'authority') forged.verificationState = 'VERIFIED';
    const verify = vi.fn();
    await expect(createSqlCandidateBridge(verify)(forged, runs[0].snapshot, runs[0].ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY');
    expect(verify).not.toHaveBeenCalled();
  });
  it('foreign tenants cannot obtain a candidate', async () => {
    const run = runs[0]; await expect(bridge(run.result, run.snapshot, run.ingestion, 'foreign')).rejects.toThrow('tenant mismatch');
  });
  it('uncommitted source mutation cannot be mislabeled as committed candidate code', async () => {
    const run = await analyzeInput(replaceSource(input(), source => source + '\n// not committed'));
    expect(run.result.status).toBe('DETECTED');
    await expect(bridge(run.result, run.snapshot, run.ingestion, ORG)).rejects.toThrow('working fixture changed before commit seal');
  });
  it('detector output and candidate cannot supply verification evidence or a direct completion', async () => {
    const { candidate } = (await build())[0], result = runs[0].result;
    for (const field of ['VerificationResult', 'EvidenceArtifact', 'evidenceHash', 'assertionResult', 'result', 'completed']) {
      expect(result).not.toHaveProperty(field); expect(candidate).not.toHaveProperty(field);
    }
    await expect(transitionVerificationState(createVerificationState(candidate, ORG),
      { type: 'COMPLETE', result: { result: 'VERIFIED' }, evidence: result })).rejects.toThrow('COMPLETE requires pending');
  });
  it('same-ID semantic replay is rejected by the unchanged M1 evidence gate', async () => {
    const c = (await build())[0].candidate, { q, e, r } = await proof(c);
    const changed = { ...c, source: { ...c.source, symbol: 'different' } }, binding = computeCandidateBinding(changed, ORG);
    expect(changed.candidateId).toBe(c.candidateId); expect(binding).not.toBe(q.candidateBinding);
    const pending = await transitionVerificationState(createVerificationState(changed, ORG), { type: 'BEGIN', request: { ...q, candidateBinding: binding } });
    await expect(transitionVerificationState(pending, { type: 'COMPLETE', result: { ...r, candidateBinding: binding }, evidence: e })).rejects.toThrow('candidateBinding mismatch');
  });
  it('Commit A proof cannot be replayed against Commit B after rebinding candidate and request', async () => {
    const c = (await build())[0].candidate, { q, e, r } = await proof(c);
    const changed = { ...c, snapshot: { ...c.snapshot, commitSha: 'b'.repeat(40) } }, binding = computeCandidateBinding(changed, ORG);
    const fields = { candidateBinding: binding, commitSha: changed.snapshot.commitSha };
    const pending = await transitionVerificationState(createVerificationState(changed, ORG), { type: 'BEGIN', request: { ...q, ...fields } });
    await expect(transitionVerificationState(pending, { type: 'COMPLETE', result: { ...r, ...fields }, evidence: e })).rejects.toThrow('commitSha mismatch');
  });
  it('candidate generation is deterministic and its binding changes when source semantics change', async () => {
    const a = (await build())[0]; expect(await build()).toEqual([a]);
    const b = { ...a.candidate, sink: { ...a.candidate.sink, symbol: 'other-sink' } };
    expect(computeCandidateBinding(b, ORG)).not.toBe(a.candidateBinding);
  });
});
