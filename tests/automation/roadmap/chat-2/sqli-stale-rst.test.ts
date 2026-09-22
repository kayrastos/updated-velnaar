import { describe, expect, it } from 'vitest';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { computeCandidateBinding, createVerificationState, transitionVerificationState } from '../../../../worker/intelligence/contracts';
import { analyzeInput, input, ORG } from '../../../intelligence/m3/support/inputs';

describe('M3 SQL injection detector stale state rejection across restart and resume', () => {
  it('rejects stale cached analysis results when resumed against an altered snapshot', async () => {
    const run0 = await analyzeInput(input(0));
    const run2 = await analyzeInput(input(2));
    await expect(validateSqlAnalysis(run0.result, run2.snapshot, run2.ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY');
  });

  it('rejects restart-resume execution with mismatched snapshot and ingestion identities', async () => {
    const run0 = await analyzeInput(input(0));
    const run2 = await analyzeInput(input(2));
    await expect(detectSqlInjection(run0.snapshot, run2.ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
  });

  it('rejects stale prior commit candidate authority when codebase advances across restart', async () => {
    const run0 = await analyzeInput(input(0));
    const commitA = 'a'.repeat(40);
    const commitB = 'b'.repeat(40);
    const bridgeA = createSqlCandidateBridge(async () => commitA);
    const bridgeB = createSqlCandidateBridge(async () => commitB);
    const hypothesesA = await bridgeA(run0.result, run0.snapshot, run0.ingestion, ORG);
    const hypothesesB = await bridgeB(run0.result, run0.snapshot, run0.ingestion, ORG);
    expect(hypothesesA).toHaveLength(1);
    expect(hypothesesB).toHaveLength(1);
    expect(hypothesesA[0].candidate.snapshot.commitSha).toBe(commitA);
    expect(hypothesesB[0].candidate.snapshot.commitSha).toBe(commitB);
    expect(hypothesesA[0].candidateBinding).not.toBe(hypothesesB[0].candidateBinding);
    expect(hypothesesA[0].candidate.verificationState).toBe('CANDIDATE');
    expect(hypothesesB[0].candidate.verificationState).toBe('CANDIDATE');
  });

  it('fails closed when commit verifier returns an invalid commit identity on restart', async () => {
    const run0 = await analyzeInput(input(0));
    const staleBridge = createSqlCandidateBridge(async () => '0'.repeat(40));
    await expect(staleBridge(run0.result, run0.snapshot, run0.ingestion, ORG)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
  });

  it('prohibits direct verification completion from initial candidate state on resume', async () => {
    const run0 = await analyzeInput(input(0));
    const commitA = 'a'.repeat(40);
    const bridge = createSqlCandidateBridge(async () => commitA);
    const hypotheses = await bridge(run0.result, run0.snapshot, run0.ingestion, ORG);
    expect(hypotheses).toHaveLength(1);
    const state = createVerificationState(hypotheses[0].candidate, ORG);
    expect(state.state).toBe('CANDIDATE');
    await expect(transitionVerificationState(state, {
      type: 'COMPLETE',
      result: { result: 'VERIFIED' } as any,
      evidence: run0.result as any,
    })).rejects.toThrow('COMPLETE requires pending');
  });

  it('produces empty candidate hypotheses without invoking commit verifier on safe code', async () => {
    const runSafe = await analyzeInput(input(1));
    expect(runSafe.result.status).toBe('NOT_DETECTED');
    let verifierCalled = false;
    const bridge = createSqlCandidateBridge(async () => {
      verifierCalled = true;
      return 'a'.repeat(40);
    });
    const hypotheses = await bridge(runSafe.result, runSafe.snapshot, runSafe.ingestion, ORG);
    expect(hypotheses).toEqual([]);
    expect(verifierCalled).toBe(false);
  });

  it('deterministically reproduces analysis fingerprint and candidate binding on clean resume', async () => {
    const runA = await analyzeInput(input(0));
    const runB = await analyzeInput(input(0));
    expect(runA.result.resultFingerprint).toBe(runB.result.resultFingerprint);
    expect(runA.result).toEqual(runB.result);
    const commit = 'a'.repeat(40);
    const bridge = createSqlCandidateBridge(async () => commit);
    const hypothesesA = await bridge(runA.result, runA.snapshot, runA.ingestion, ORG);
    const hypothesesB = await bridge(runB.result, runB.snapshot, runB.ingestion, ORG);
    expect(hypothesesA).toEqual(hypothesesB);
    expect(hypothesesA[0].candidateBinding).toBe(computeCandidateBinding(hypothesesA[0].candidate, ORG));
  });
});
