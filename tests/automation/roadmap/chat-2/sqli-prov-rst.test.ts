import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { DETECTOR_VERSION } from '../../../../worker/intelligence/detection/types';
import { canonical, hash } from '../../../../worker/intelligence/ingestion/snapshot';
import { computeCandidateBinding, computeEvidenceHash, createVerificationState, transitionVerificationState,
  validateFindingCandidate, type FindingCandidate } from '../../../../worker/intelligence/contracts';
import { currentCodeCommit, verifyCommittedFixture } from '../../../intelligence/m2/support/gitCodeState';
import { fixture } from '../../../intelligence/fixtures';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

const bridge = createSqlCandidateBridge(verifyCommittedFixture);
let runs: Awaited<ReturnType<typeof analyzeInput>>[];
beforeAll(async () => {
  runs = [];
  for (let i = 0; i < 8; i++) runs.push(await analyzeInput(input(i)));
});

function cycle<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

async function proof(c: FindingCandidate) {
  const f = await fixture();
  const binding = computeCandidateBinding(c, ORG);
  const fields = {
    organizationId: ORG,
    candidateId: c.candidateId,
    candidateBinding: binding,
    snapshotId: c.snapshot.snapshotId,
    commitSha: c.snapshot.commitSha,
  };
  const q = { ...f.q, ...fields };
  const { evidenceHash: _hash, ...originalBody } = f.e;
  const body = { ...originalBody, ...fields, repositoryId: c.snapshot.repositoryId };
  const e = { ...body, evidenceHash: await computeEvidenceHash(body, q, c, ORG) };
  return { q, e, r: { ...f.r, ...fields } };
}

describe('SQL injection detector provenance integrity under restart and resume', () => {
  it.each([0, 5, 6, 7])('cold restart from serialized analysis preserves exact flow provenance and detector fingerprint for fixture %i', async index => {
    const run = runs[index];
    const resumedResult = cycle(run.result);
    const resumedSnapshot = cycle(run.snapshot);
    const resumedIngestion = cycle(run.ingestion);

    const validated = await validateSqlAnalysis(resumedResult, resumedSnapshot, resumedIngestion, ORG);
    expect(canonical(validated)).toBe(canonical(run.result));
    expect(validated.resultFingerprint).toBe(run.result.resultFingerprint);
    expect(validated.status).toBe('DETECTED');
    expect(validated.findings).toHaveLength(1);

    const originalFinding = run.result.findings[0];
    const resumedFinding = validated.findings[0];
    expect(resumedFinding.findingId).toBe(originalFinding.findingId);
    expect(resumedFinding.routeIdentity).toBe(originalFinding.routeIdentity);
    expect(resumedFinding.source).toEqual(originalFinding.source);
    expect(resumedFinding.sink).toEqual(originalFinding.sink);
    expect(resumedFinding.flow).toEqual(originalFinding.flow);
  });

  it('resumed analysis produces identical candidate hypothesis and binding through candidate bridge', async () => {
    const checkedCommit = currentCodeCommit();
    const run = runs[0];
    const originalOutput = await bridge(run.result, run.snapshot, run.ingestion, ORG);
    expect(originalOutput).toHaveLength(1);

    const resumedOutput = await bridge(cycle(run.result), cycle(run.snapshot), cycle(run.ingestion), ORG);
    expect(resumedOutput).toHaveLength(1);

    const { candidate, candidateBinding } = resumedOutput[0];
    expect(candidate).toEqual(originalOutput[0].candidate);
    expect(candidateBinding).toBe(originalOutput[0].candidateBinding);
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.snapshot.commitSha).toBe(checkedCommit);
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);
  });

  it('restart-resume across nested router mount retains route identity and context entrypoint', async () => {
    const run = runs[7];
    const resumedResult = cycle(run.result);
    const resumedSnapshot = cycle(run.snapshot);
    const resumedIngestion = cycle(run.ingestion);

    const validated = await validateSqlAnalysis(resumedResult, resumedSnapshot, resumedIngestion, ORG);
    expect(validated.findings[0].routeIdentity).toBe(run.ingestion.routes[0].routeIdentity);

    const output = await bridge(validated, resumedSnapshot, resumedIngestion, ORG);
    expect(output).toHaveLength(1);
    expect(output[0].candidate.context.routeId).toBe(run.ingestion.routes[0].routeIdentity);
    expect(output[0].candidate.context.entrypoint).toEqual({
      filePath: run.ingestion.routes[0].handler.filePath,
      symbol: run.ingestion.routes[0].handler.symbol,
      line: run.ingestion.routes[0].handler.line,
      column: run.ingestion.routes[0].handler.column,
    });
  });

  it.each([
    ['reverse-flow', (f: any) => { f.findings[0].flow.reverse(); }],
    ['tamper-source', (f: any) => { f.findings[0].source.symbol = 'other.source'; }],
    ['tamper-sink', (f: any) => { f.findings[0].sink.line += 5; }],
    ['tamper-flow-id', (f: any) => { f.findings[0].flow[0].id = 'sha256:' + 'a'.repeat(64); }],
    ['tamper-step-kind', (f: any) => { f.findings[0].flow[0].kind = 'SINK'; }],
    ['duplicate-flow-node', (f: any) => { f.findings[0].flow.push(f.findings[0].flow[0]); }],
  ])('rejects tampered flow provenance across restart-resume boundary: %s', async (_label, tamper) => {
    const forged: any = cycle(runs[0].result);
    tamper(forged);
    await expect(validateSqlAnalysis(forged, runs[0].snapshot, runs[0].ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY');
  });

  it('rejects recalculated fingerprint over forged findings during restart-resume', async () => {
    const forged: any = cycle(runs[0].result);
    forged.findings[0].source.column += 1;
    const { resultFingerprint: _old, ...body } = forged;
    forged.resultFingerprint = await hash(DETECTOR_VERSION, body);
    await expect(validateSqlAnalysis(forged, runs[0].snapshot, runs[0].ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY');
  });

  it('rejects resume when snapshot or tenant mismatches during restart', async () => {
    await expect(validateSqlAnalysis(runs[0].result, runs[1].snapshot, runs[1].ingestion, ORG)).rejects.toThrow();
    await expect(validateSqlAnalysis(runs[0].result, runs[0].snapshot, runs[0].ingestion, 'foreign_tenant')).rejects.toThrow();
  });

  it('resumed candidate cannot bypass verification state machine or reuse stale pre-restart proofs', async () => {
    const output = await bridge(cycle(runs[0].result), cycle(runs[0].snapshot), cycle(runs[0].ingestion), ORG);
    const candidate = output[0].candidate;
    const start = createVerificationState(candidate, ORG);
    expect(start.state).toBe('CANDIDATE');

    await expect(transitionVerificationState(start, {
      type: 'COMPLETE',
      result: { result: 'VERIFIED' } as any,
      evidence: runs[0].result as any,
    })).rejects.toThrow('COMPLETE requires pending');

    const { q, e, r } = await proof(candidate);
    const pending = await transitionVerificationState(start, { type: 'BEGIN', request: q });
    expect(pending.state).toBe('PENDING_VERIFICATION');

    const tamperedCommitResult = { ...r, commitSha: 'b'.repeat(40) };
    await expect(transitionVerificationState(pending, {
      type: 'COMPLETE',
      result: tamperedCommitResult,
      evidence: e,
    })).rejects.toThrow('commitSha mismatch');

    const tamperedBindingResult = { ...r, candidateBinding: 'tampered-binding' };
    await expect(transitionVerificationState(pending, {
      type: 'COMPLETE',
      result: tamperedBindingResult,
      evidence: e,
    })).rejects.toThrow();

    const verified = await transitionVerificationState(pending, { type: 'COMPLETE', result: r, evidence: e });
    expect(verified.state).toBe('VERIFIED');
    expect(verified.result.candidateBinding).toBe(output[0].candidateBinding);
  });

  it('non-detected and inconclusive fixtures resume cleanly without generating candidates', async () => {
    const runSafe = runs[1];
    const resumedSafe = cycle(runSafe.result);
    expect(resumedSafe.status).toBe('NOT_DETECTED');
    expect(resumedSafe.findings).toEqual([]);

    const validatedSafe = await validateSqlAnalysis(resumedSafe, cycle(runSafe.snapshot), cycle(runSafe.ingestion), ORG);
    expect(validatedSafe).toEqual(runSafe.result);

    const verifyMock = vi.fn();
    const mockBridge = createSqlCandidateBridge(verifyMock);
    const candidatesSafe = await mockBridge(validatedSafe, runSafe.snapshot, runSafe.ingestion, ORG);
    expect(candidatesSafe).toEqual([]);
    expect(verifyMock).not.toHaveBeenCalled();

    const rawInconclusive = replaceSource(input(), source => source.replace('return res.json', 'while (true) {} return res.json'));
    const runInconclusive = await analyzeInput(rawInconclusive);
    expect(runInconclusive.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(runInconclusive.result.findings).toEqual([]);
    expect(runInconclusive.result.limitations).toHaveLength(1);

    const resumedInconclusive = cycle(runInconclusive.result);
    const validatedInconclusive = await validateSqlAnalysis(resumedInconclusive, runInconclusive.snapshot, runInconclusive.ingestion, ORG);
    expect(validatedInconclusive).toEqual(runInconclusive.result);

    const candidatesInconclusive = await mockBridge(validatedInconclusive, runInconclusive.snapshot, runInconclusive.ingestion, ORG);
    expect(candidatesInconclusive).toEqual([]);
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('cold execution from raw inputs matches resumed warm execution deterministically', async () => {
    const raw = input(6);
    const runA = await analyzeInput(raw);
    const runB = await analyzeInput(raw);

    expect(canonical(runA.result)).toBe(canonical(runB.result));
    expect(runA.result.resultFingerprint).toBe(runB.result.resultFingerprint);

    const outputA = await bridge(runA.result, runA.snapshot, runA.ingestion, ORG);
    const outputB = await bridge(runB.result, runB.snapshot, runB.ingestion, ORG);

    expect(outputA).toHaveLength(1);
    expect(outputB).toHaveLength(1);
    expect(outputA[0].candidateBinding).toBe(outputB[0].candidateBinding);
    expect(outputA[0].candidate.candidateId).toBe(outputB[0].candidate.candidateId);
  });
});
