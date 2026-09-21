import { describe, expect, it } from 'vitest';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { computeCandidateBinding, createVerificationState, validateFindingCandidate } from '../../../../worker/intelligence/contracts';
import { captureSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress } from '../../../../worker/intelligence/ingestion/express';
import { analyzeInput, input, ORG } from '../../../intelligence/m3/support/inputs';

describe('roadmap chat-2: SQL injection detector order stability across restart-resume', () => {
  it('preserves deterministic findings, flow ordering, and fingerprints across clean restart-resume cycles', async () => {
    const runInitial = await analyzeInput(input(0));
    expect(runInitial.result.status).toBe('DETECTED');
    expect(runInitial.result.findings).toHaveLength(1);

    // Simulate interleaved analyses of different fixtures before resume
    await analyzeInput(input(1));
    await analyzeInput(input(6));

    // Resume / re-analyze input(0)
    const runResumed = await analyzeInput(input(0));
    expect(runResumed.result).toEqual(runInitial.result);
    expect(runResumed.result.resultFingerprint).toBe(runInitial.result.resultFingerprint);
    expect(runResumed.result.findings[0].findingId).toBe(runInitial.result.findings[0].findingId);

    const initialFlowIds = runInitial.result.findings[0].flow.map(step => step.id);
    const resumedFlowIds = runResumed.result.findings[0].flow.map(step => step.id);
    expect(resumedFlowIds).toEqual(initialFlowIds);

    const revalidated = await validateSqlAnalysis(runResumed.result, runResumed.snapshot, runResumed.ingestion, ORG);
    expect(revalidated).toEqual(runInitial.result);
  });

  it('maintains order stability under source file enumeration permutation across restart', async () => {
    const initialRun = await analyzeInput(input(6));
    expect(initialRun.result.status).toBe('DETECTED');

    const reversedFilesInput = { ...input(6), files: [...input(6).files].reverse() };
    const resumedRun = await analyzeInput(reversedFilesInput);

    expect(resumedRun.result).toEqual(initialRun.result);
    expect(resumedRun.result.resultFingerprint).toBe(initialRun.result.resultFingerprint);
    expect(resumedRun.result.findings[0].flow.map(s => s.id)).toEqual(initialRun.result.findings[0].flow.map(s => s.id));
  });

  it('preserves candidate bridge hypothesis identity and canonical binding across restart-resume', async () => {
    const checkedCommit = 'a'.repeat(40);
    const bridge = createSqlCandidateBridge(async () => checkedCommit);

    const run1 = await analyzeInput(input(0));
    const hypotheses1 = await bridge(run1.result, run1.snapshot, run1.ingestion, ORG);
    expect(hypotheses1).toHaveLength(1);

    // Interleaved bridge operation on another fixture
    const runOther = await analyzeInput(input(6));
    await bridge(runOther.result, runOther.snapshot, runOther.ingestion, ORG);

    // Resumed bridge operation on re-analyzed fixture
    const run2 = await analyzeInput(input(0));
    const hypotheses2 = await bridge(run2.result, run2.snapshot, run2.ingestion, ORG);

    expect(hypotheses2).toEqual(hypotheses1);
    const { candidate, candidateBinding } = hypotheses2[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.snapshot.commitSha).toBe(checkedCommit);
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);
    expect(createVerificationState(candidate, ORG).state).toBe('CANDIDATE');
    expect(Object.isFrozen(candidate)).toBe(true);
  });

  it('preserves effective route identity and ordering across restart for mounted routers', async () => {
    const runMounted1 = await analyzeInput(input(7));
    expect(runMounted1.result.status).toBe('DETECTED');

    const snapshotFresh = await captureSnapshot(input(7), ORG);
    const ingestionFresh = await ingestExpress(snapshotFresh, ORG);
    const resultFresh = await detectSqlInjection(snapshotFresh, ingestionFresh, ORG);

    expect(resultFresh).toEqual(runMounted1.result);
    expect(resultFresh.findings[0].routeIdentity).toBe(runMounted1.ingestion.routes[0].routeIdentity);
  });

  it('rejects cross-snapshot verification or foreign tenant tampering upon resumed analysis', async () => {
    const runA = await analyzeInput(input(0));
    const runB = await analyzeInput(input(6));

    await expect(validateSqlAnalysis(runA.result, runB.snapshot, runB.ingestion, ORG)).rejects.toThrow();

    const bridge = createSqlCandidateBridge(async () => 'c'.repeat(40));
    await expect(bridge(runA.result, runA.snapshot, runA.ingestion, 'foreign_org')).rejects.toThrow('tenant mismatch');
  });
});
