import { beforeAll, describe, expect, it } from 'vitest';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { captureSnapshot, detachJson, validateSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { validateExpressIngestion } from '../../../../worker/intelligence/ingestion/express';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { createVerificationState, transitionVerificationState, validateFindingCandidate } from '../../../../worker/intelligence/contracts';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

describe('sqli-detector: regression-lock restart-resume', () => {
  let runs: Awaited<ReturnType<typeof analyzeInput>>[];

  beforeAll(async () => {
    runs = [];
    for (const idx of [0, 1, 5, 6]) {
      runs.push(await analyzeInput(input(idx)));
    }
  });

  it('preserves exact determinism and fingerprints across restarted detector invocations', async () => {
    const run0 = runs[0];
    const restarted = await detectSqlInjection(run0.snapshot, run0.ingestion, ORG);
    expect(restarted).toEqual(run0.result);
    expect(restarted.resultFingerprint).toBe(run0.result.resultFingerprint);
    expect(restarted.findings).toHaveLength(1);
    expect(restarted.findings[0].findingId).toBe(run0.result.findings[0].findingId);
  });

  it('prevents cross-run state leakage when executions are interleaved and restarted', async () => {
    const run0Initial = runs[0].result;
    await detectSqlInjection(runs[1].snapshot, runs[1].ingestion, ORG);
    await detectSqlInjection(runs[2].snapshot, runs[2].ingestion, ORG);
    await detectSqlInjection(runs[3].snapshot, runs[3].ingestion, ORG);
    const run0Restarted = await detectSqlInjection(runs[0].snapshot, runs[0].ingestion, ORG);
    expect(run0Restarted).toEqual(run0Initial);
  });

  it('supports checkpoint serialization, deserialization, and integrity validation upon resume', async () => {
    const run = runs[0];
    const serializedSnapshot = JSON.stringify(run.snapshot);
    const serializedIngestion = JSON.stringify(run.ingestion);
    const serializedResult = JSON.stringify(run.result);

    const reloadedSnapshot = await validateSnapshot(JSON.parse(serializedSnapshot), ORG);
    const reloadedIngestion = await validateExpressIngestion(JSON.parse(serializedIngestion), ORG);
    const reloadedResult = JSON.parse(serializedResult);

    const validated = await validateSqlAnalysis(reloadedResult, reloadedSnapshot, reloadedIngestion, ORG);
    expect(validated.resultFingerprint).toBe(run.result.resultFingerprint);
    expect(validated.status).toBe('DETECTED');
  });

  it('rejects tampered reloaded analysis upon resume from persisted state', async () => {
    const run = runs[0];
    const tampered = detachJson(run.result);
    tampered.status = 'NOT_DETECTED';
    tampered.findings = [];

    await expect(
      validateSqlAnalysis(tampered, run.snapshot, run.ingestion, ORG),
    ).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
  });

  it('resumes cleanly to detected status after an inconclusive budget exhaustion run', async () => {
    const limitedRaw = replaceSource(input(), source =>
      source.replace('return res.json', Array.from({ length: 500 }, (_, i) => `const x${i} = ""`).join(';') + '; return res.json'),
    );
    const limitedRun = await analyzeInput(limitedRaw);
    expect(limitedRun.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(limitedRun.result.limitations).toHaveLength(1);
    expect(limitedRun.result.limitations[0].code).toBe('NODE_BUDGET');
    expect(limitedRun.result.findings).toEqual([]);

    const resumedRun = await analyzeInput(input(0));
    expect(resumedRun.result.status).toBe('DETECTED');
    expect(resumedRun.result.findings).toHaveLength(1);
    expect(resumedRun.result.limitations).toEqual([]);
    expect(resumedRun.result.resultFingerprint).toBe(runs[0].result.resultFingerprint);
  });

  it('produces identical candidate hypotheses and bindings across bridge restarts', async () => {
    const run = runs[0];
    const mockVerifier = async () => '46db4c208f886afda939c04ae93580fbabd57344';
    const bridge = createSqlCandidateBridge(mockVerifier);

    const firstCandidates = await bridge(run.result, run.snapshot, run.ingestion, ORG);
    const restartedCandidates = await bridge(run.result, run.snapshot, run.ingestion, ORG);

    expect(firstCandidates).toHaveLength(1);
    expect(restartedCandidates).toHaveLength(1);
    expect(firstCandidates[0].candidateBinding).toBe(restartedCandidates[0].candidateBinding);
    expect(firstCandidates[0].candidate.candidateId).toBe(restartedCandidates[0].candidate.candidateId);
    expect(firstCandidates[0].candidate.verificationState).toBe('CANDIDATE');
    expect(validateFindingCandidate(firstCandidates[0].candidate, ORG)).toEqual(firstCandidates[0].candidate);
  });

  it('enforces verification state lifecycle and rejects out-of-order completion across restarts', async () => {
    const run = runs[0];
    const mockVerifier = async () => '46db4c208f886afda939c04ae93580fbabd57344';
    const bridge = createSqlCandidateBridge(mockVerifier);
    const [hypothesis] = await bridge(run.result, run.snapshot, run.ingestion, ORG);

    const state = createVerificationState(hypothesis.candidate, ORG);
    expect(state.state).toBe('CANDIDATE');

    await expect(
      transitionVerificationState(state, {
        type: 'COMPLETE',
        result: { result: 'VERIFIED' } as any,
        evidence: {} as any,
      }),
    ).rejects.toThrow('COMPLETE requires pending');
  });

  it('rejects foreign tenant or mismatched snapshot identity on resume', async () => {
    const run = runs[0];
    await expect(
      detectSqlInjection(run.snapshot, run.ingestion, 'foreign_org'),
    ).rejects.toThrow('tenant mismatch');

    await expect(
      detectSqlInjection(runs[1].snapshot, run.ingestion, ORG),
    ).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
  });
});
