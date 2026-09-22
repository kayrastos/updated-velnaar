import { describe, expect, it } from 'vitest';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { validateSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { validateExpressIngestion } from '../../../../worker/intelligence/ingestion/express';
import { computeCandidateBinding, createVerificationState, validateFindingCandidate } from '../../../../worker/intelligence/contracts';
import { analyzeInput, input, ORG } from '../../../intelligence/m3/support/inputs';

const MOCK_COMMIT = '1111111111111111111111111111111111111111';
const bridge = createSqlCandidateBridge(async () => MOCK_COMMIT);

describe('SQL injection positive control restart and resume parity', () => {
  it.each([0, 2, 5, 6, 7])('positive control index %i preserves findings and candidate binding across serialization restart', async index => {
    const original = await analyzeInput(input(index));
    expect(original.result.status).toBe('DETECTED');
    expect(original.result.findings.length).toBeGreaterThan(0);

    const originalCandidates = await bridge(original.result, original.snapshot, original.ingestion, ORG);
    expect(originalCandidates.length).toBe(original.result.findings.length);
    expect(originalCandidates[0].candidate.verificationState).toBe('CANDIDATE');

    const serializedSnapshot = JSON.stringify(original.snapshot);
    const serializedIngestion = JSON.stringify(original.ingestion);
    const serializedResult = JSON.stringify(original.result);

    const restoredSnapshot = await validateSnapshot(JSON.parse(serializedSnapshot), ORG);
    const restoredIngestion = await validateExpressIngestion(JSON.parse(serializedIngestion), ORG);
    const restoredResult = await validateSqlAnalysis(JSON.parse(serializedResult), restoredSnapshot, restoredIngestion, ORG);

    expect(restoredResult.resultFingerprint).toBe(original.result.resultFingerprint);
    expect(restoredResult.findings).toEqual(original.result.findings);

    const recomputed = await detectSqlInjection(restoredSnapshot, restoredIngestion, ORG);
    expect(recomputed).toEqual(original.result);

    const resumedCandidates = await bridge(restoredResult, restoredSnapshot, restoredIngestion, ORG);
    expect(resumedCandidates).toEqual(originalCandidates);
    expect(resumedCandidates[0].candidateBinding).toBe(originalCandidates[0].candidateBinding);

    const state = createVerificationState(resumedCandidates[0].candidate, ORG);
    expect(state.state).toBe('CANDIDATE');
  });

  it('rejects tampered analysis result across restart-resume boundary', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(0));
    expect(result.status).toBe('DETECTED');

    const serialized = JSON.stringify(result);
    const tampered = JSON.parse(serialized);
    tampered.findings[0].source.symbol = 'tampered.symbol';

    await expect(validateSqlAnalysis(tampered, snapshot, ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY');
  });

  it('multi-cycle restart preserves deterministic stability without drift', async () => {
    const initial = await analyzeInput(input(6));
    expect(initial.result.status).toBe('DETECTED');

    let currentSnapshot = initial.snapshot;
    let currentIngestion = initial.ingestion;
    let currentResult = initial.result;

    for (let cycle = 0; cycle < 3; cycle++) {
      const snapJson = JSON.stringify(currentSnapshot);
      const ingJson = JSON.stringify(currentIngestion);
      const resJson = JSON.stringify(currentResult);

      currentSnapshot = await validateSnapshot(JSON.parse(snapJson), ORG);
      currentIngestion = await validateExpressIngestion(JSON.parse(ingJson), ORG);
      currentResult = await validateSqlAnalysis(JSON.parse(resJson), currentSnapshot, currentIngestion, ORG);
    }

    expect(currentResult).toEqual(initial.result);
    const candidates = await bridge(currentResult, currentSnapshot, currentIngestion, ORG);
    expect(candidates[0].candidate.verificationState).toBe('CANDIDATE');
    expect(validateFindingCandidate(candidates[0].candidate, ORG)).toEqual(candidates[0].candidate);
    expect(computeCandidateBinding(candidates[0].candidate, ORG)).toBe(candidates[0].candidateBinding);
  });
});
