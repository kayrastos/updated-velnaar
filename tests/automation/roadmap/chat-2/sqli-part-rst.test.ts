import { describe, expect, it, vi } from 'vitest';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { computeCandidateBinding, createVerificationState, transitionVerificationState } from '../../../../worker/intelligence/contracts';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

describe('roadmap: SQL injection detector partial-input fail-closed restart and resume', () => {
  it('fails closed on partial input with unsupported syntax before leaking partial findings', async () => {
    const partialRun = await analyzeInput(
      replaceSource(input(0), source =>
        source.replace('return res.json', 'const tainted = req.query.q; while (true) {} return res.json')
      )
    );
    expect(partialRun.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(partialRun.result.findings).toEqual([]);
    expect(partialRun.result.limitations).toHaveLength(1);
    expect(partialRun.result.limitations[0].code).toBe('UNSUPPORTED_STATEMENT');
  });

  it('fails closed on partial input containing unbound identifiers without partial flow retention', async () => {
    const partialRun = await analyzeInput(
      replaceSource(input(0), source =>
        source.replace('req.query.q', 'unboundPartialValue')
      )
    );
    expect(partialRun.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(partialRun.result.findings).toEqual([]);
    expect(partialRun.result.limitations).toHaveLength(1);
    expect(partialRun.result.limitations[0].code).toBe('UNBOUND_NAME');
  });

  it('restarts cleanly after partial-input failure and resumes deterministic detection on valid input', async () => {
    const validBaseline = await analyzeInput(input(0));
    expect(validBaseline.result.status).toBe('DETECTED');
    expect(validBaseline.result.findings).toHaveLength(1);

    const partialRun = await analyzeInput(
      replaceSource(input(0), source =>
        source.replace('return res.json', 'const x = req.query.q; if (x) { return res.json(); } return res.json')
      )
    );
    expect(partialRun.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(partialRun.result.findings).toEqual([]);

    const resumedRun = await analyzeInput(input(0));
    expect(resumedRun.result.status).toBe('DETECTED');
    expect(resumedRun.result.resultFingerprint).toBe(validBaseline.result.resultFingerprint);
    expect(resumedRun.result.findings).toEqual(validBaseline.result.findings);
  });

  it('interleaves partial-input fail-closed runs and complete runs without state leakage or drift', async () => {
    const validRun1 = await analyzeInput(input(0));
    const partialRun1 = await analyzeInput(
      replaceSource(input(0), source => source.replace('return res.json', 'while (true) {} return res.json'))
    );
    const validRun2 = await analyzeInput(input(0));
    const partialRun2 = await analyzeInput(
      replaceSource(input(0), source => source.replace('req.query.q', 'missingVar'))
    );
    const validRun3 = await analyzeInput(input(0));

    expect(partialRun1.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(partialRun1.result.findings).toEqual([]);
    expect(partialRun2.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(partialRun2.result.findings).toEqual([]);

    expect(validRun1.result.resultFingerprint).toBe(validRun2.result.resultFingerprint);
    expect(validRun2.result.resultFingerprint).toBe(validRun3.result.resultFingerprint);
    expect(validRun1.result.findings).toEqual(validRun3.result.findings);
  });

  it('candidate bridge fails closed on partial input and resumes cleanly on subsequent valid runs', async () => {
    const verifiedCommit = '2'.repeat(40);
    const verifyCommittedCode = vi.fn().mockResolvedValue(verifiedCommit);
    const bridge = createSqlCandidateBridge(verifyCommittedCode);

    const partialRun = await analyzeInput(
      replaceSource(input(0), source => source.replace('return res.json', 'while (true) {} return res.json'))
    );
    const partialCandidates = await bridge(partialRun.result, partialRun.snapshot, partialRun.ingestion, ORG);
    expect(partialCandidates).toEqual([]);
    expect(verifyCommittedCode).not.toHaveBeenCalled();

    const validRun = await analyzeInput(input(0));
    const validCandidates = await bridge(validRun.result, validRun.snapshot, validRun.ingestion, ORG);
    expect(validCandidates).toHaveLength(1);
    expect(verifyCommittedCode).toHaveBeenCalledTimes(1);

    const { candidate, candidateBinding } = validCandidates[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.snapshot.commitSha).toBe(verifiedCommit);
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));

    const recheckPartial = await bridge(partialRun.result, partialRun.snapshot, partialRun.ingestion, ORG);
    expect(recheckPartial).toEqual([]);
    expect(verifyCommittedCode).toHaveBeenCalledTimes(1);

    const state = createVerificationState(candidate, ORG);
    expect(state.state).toBe('CANDIDATE');
    await expect(
      transitionVerificationState(state, { type: 'COMPLETE', result: { result: 'VERIFIED' } as any, evidence: validRun.result as any })
    ).rejects.toThrow('COMPLETE requires pending verification');
  });
});
