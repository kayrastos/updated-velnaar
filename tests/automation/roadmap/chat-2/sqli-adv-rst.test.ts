import { describe, expect, it } from 'vitest';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { computeCandidateBinding, createVerificationState, transitionVerificationState } from '../../../../worker/intelligence/contracts';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

describe('V1 discovery intelligence: SQLi detector adversarial restart-resume roadmap tests', () => {
  it('recovers cleanly to DETECTED after an adversarial inconclusive cycle run', async () => {
    const adversarialInput = replaceSource(input(), source => source.replace(
      'function searchRoute',
      'function fA(v: string): string { return fB(v); } function fB(v: string): string { return fA(v); } function searchRoute',
    ).replace('return res.json', 'fA(req.query.q); return res.json'));

    const runFail = await analyzeInput(adversarialInput);
    expect(runFail.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(runFail.result.findings).toHaveLength(0);
    expect(runFail.result.limitations).toHaveLength(1);
    expect(runFail.result.limitations[0].code).toBe('CALL_CYCLE');

    const runResume = await analyzeInput(input(0));
    expect(runResume.result.status).toBe('DETECTED');
    expect(runResume.result.limitations).toHaveLength(0);
    expect(runResume.result.findings).toHaveLength(1);
    expect(runResume.result.findings[0].source.symbol).toBe('query.q');
    expect(runResume.result.findings[0].sink.symbol).toBe('db.prepare');
  });

  it('maintains strict determinism and identical fingerprints across restarted adversarial analyses', async () => {
    const advInput = replaceSource(input(), source => source.replace(
      'return res.json',
      'const a1 = req.query.q; const a2 = a1; const a3 = a2; return res.json',
    ).replace('" + req.query.q + "', '" + a3 + "'));

    const firstRun = await analyzeInput(advInput);
    expect(firstRun.result.status).toBe('DETECTED');
    expect(firstRun.result.findings).toHaveLength(1);

    const secondRun = await analyzeInput(advInput);
    const thirdRun = await analyzeInput(advInput);

    expect(secondRun.result.resultFingerprint).toBe(firstRun.result.resultFingerprint);
    expect(thirdRun.result.resultFingerprint).toBe(firstRun.result.resultFingerprint);
    expect(secondRun.result).toEqual(firstRun.result);
    expect(thirdRun.result).toEqual(firstRun.result);

    const validated = await validateSqlAnalysis(secondRun.result, secondRun.snapshot, secondRun.ingestion, ORG);
    expect(validated.resultFingerprint).toBe(firstRun.result.resultFingerprint);
  });

  it('negative control remains NOT_DETECTED across restart cycles without false positives', async () => {
    const run1 = await analyzeInput(input(1));
    expect(run1.result.status).toBe('NOT_DETECTED');
    expect(run1.result.findings).toHaveLength(0);

    const run2 = await analyzeInput(input(3));
    expect(run2.result.status).toBe('NOT_DETECTED');
    expect(run2.result.findings).toHaveLength(0);

    const run3 = await analyzeInput(input(1));
    expect(run3.result.status).toBe('NOT_DETECTED');
    expect(run3.result.resultFingerprint).toBe(run1.result.resultFingerprint);
  });

  it('candidate bridge preserves CANDIDATE verification state and canonical binding on restart', async () => {
    const validCommit = '1234567890123456789012345678901234567890';
    const bridge = createSqlCandidateBridge(async () => validCommit);

    const run = await analyzeInput(input(0));
    const hypotheses1 = await bridge(run.result, run.snapshot, run.ingestion, ORG);
    expect(hypotheses1).toHaveLength(1);

    const { candidate, candidateBinding } = hypotheses1[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.snapshot.commitSha).toBe(validCommit);
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));

    const hypotheses2 = await bridge(run.result, run.snapshot, run.ingestion, ORG);
    expect(hypotheses2).toHaveLength(1);
    expect(hypotheses2[0].candidate.candidateId).toBe(candidate.candidateId);
    expect(hypotheses2[0].candidateBinding).toBe(candidateBinding);

    const state = createVerificationState(candidate, ORG);
    expect(state.state).toBe('CANDIDATE');
    await expect(transitionVerificationState(state, {
      type: 'COMPLETE',
      result: { result: 'VERIFIED' } as any,
      evidence: run.result as any,
    })).rejects.toThrow('COMPLETE requires pending');
  });
});
