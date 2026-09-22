import { describe, expect, it } from 'vitest';
import { computeCandidateBinding } from '../../../../worker/intelligence/contracts';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

describe('roadmap: sqli detector nested flow restart-resume verification', () => {
  it('detects nested helper SQL injection flow with call and return provenance', async () => {
    const run = await analyzeInput(input(5));
    expect(run.result.status).toBe('DETECTED');
    expect(run.result.findings).toHaveLength(1);
    const flow = run.result.findings[0].flow;
    expect(flow.some(step => step.kind === 'CALL')).toBe(true);
    expect(flow.some(step => step.kind === 'RETURN')).toBe(true);
    expect(flow.at(-1)!.kind).toBe('SINK');
    expect(run.result.findings[0].sink.symbol).toBe('db.prepare');
  });

  it('preserves determinism across repeated restart-resume analysis runs', async () => {
    const run1 = await analyzeInput(input(5));
    const run2 = await analyzeInput(input(5));
    expect(run2.result).toEqual(run1.result);
    expect(run2.result.resultFingerprint).toBe(run1.result.resultFingerprint);
    const validated = await validateSqlAnalysis(run1.result, run1.snapshot, run1.ingestion, ORG);
    expect(validated).toEqual(run1.result);
  });

  it('guarantees state isolation across interleaved negative control and resumed nested flow', async () => {
    const initial = await analyzeInput(input(5));
    const negative = await analyzeInput(input(1));
    expect(negative.result.status).toBe('NOT_DETECTED');
    expect(negative.result.findings).toHaveLength(0);

    const resumed = await analyzeInput(input(5));
    expect(resumed.result).toEqual(initial.result);
    expect(resumed.result.resultFingerprint).toBe(initial.result.resultFingerprint);
  });

  it('updates result fingerprint deterministically when nested helper flow is modified', async () => {
    const baseline = await analyzeInput(input(5));
    const modifiedInput = replaceSource(input(5), source => '\n// restart-resume comment\n' + source);
    const modifiedRun = await analyzeInput(modifiedInput);
    expect(modifiedRun.result.status).toBe('DETECTED');
    expect(modifiedRun.result.resultFingerprint).not.toBe(baseline.result.resultFingerprint);
    expect(modifiedRun.result.snapshotId).not.toBe(baseline.result.snapshotId);
  });

  it('produces verified CANDIDATE bridge hypotheses with stable bindings on resumed runs', async () => {
    const run = await analyzeInput(input(5));
    const checkedCommit = '1'.repeat(40);
    const bridge = createSqlCandidateBridge(async () => checkedCommit);

    const initial = await bridge(run.result, run.snapshot, run.ingestion, ORG);
    expect(initial).toHaveLength(1);
    const { candidate, candidateBinding } = initial[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.snapshot.commitSha).toBe(checkedCommit);
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));

    const resumedRun = await analyzeInput(input(5));
    const resumed = await bridge(resumedRun.result, resumedRun.snapshot, resumedRun.ingestion, ORG);
    expect(resumed).toEqual(initial);
  });

  it('produces no candidate hypotheses for negative control runs', async () => {
    const negativeRun = await analyzeInput(input(1));
    const bridge = createSqlCandidateBridge(async () => '1'.repeat(40));
    const candidates = await bridge(negativeRun.result, negativeRun.snapshot, negativeRun.ingestion, ORG);
    expect(candidates).toEqual([]);
  });
});
