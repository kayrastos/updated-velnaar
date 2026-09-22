import { describe, expect, it } from 'vitest';
import {
  CONTRACT_VERSION,
  computeCandidateBinding,
  createVerificationState,
  transitionVerificationState,
  validateFindingCandidate,
} from '../../../../worker/intelligence/contracts';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import {
  detectSqlInjection,
  validateSqlAnalysis,
} from '../../../../worker/intelligence/detection/sqlInjection';
import { detachJson } from '../../../../worker/intelligence/ingestion/snapshot';
import { analyzeInput, input, ORG } from '../../../intelligence/m3/support/inputs';

describe('RM_SQLI_NORM_RST: normalization boundary and restart-resume determinism', () => {
  it('preserves exact SQL injection detection output across cold restart-resume cycles', async () => {
    const { snapshot, ingestion, result: initialResult } = await analyzeInput(input(0));
    expect(initialResult.status).toBe('DETECTED');
    expect(initialResult.findings.length).toBeGreaterThanOrEqual(1);

    const resumedResult = await detectSqlInjection(snapshot, ingestion, ORG);
    expect(resumedResult).toEqual(initialResult);
    expect(resumedResult.resultFingerprint).toBe(initialResult.resultFingerprint);

    const coldPayload = detachJson(resumedResult);
    const validated = await validateSqlAnalysis(coldPayload, snapshot, ingestion, ORG);
    expect(validated.resultFingerprint).toBe(initialResult.resultFingerprint);
  });

  it('rejects normalized or modified analysis payloads on restart validation', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(0));
    const tampered = detachJson(result);
    tampered.findings[0].source.column += 1;
    await expect(validateSqlAnalysis(tampered, snapshot, ingestion, ORG)).rejects.toThrow(
      'M3_ANALYSIS_INTEGRITY_MISMATCH',
    );
  });

  it('candidate bridge enforces exact-bound CANDIDATE state and canonical binding without sha256 prefix', async () => {
    const validSha = 'a'.repeat(40);
    const bridge = createSqlCandidateBridge(async () => validSha);
    const { snapshot, ingestion, result } = await analyzeInput(input(0));

    const candidates = await bridge(result, snapshot, ingestion, ORG);
    expect(candidates).toHaveLength(1);

    const { candidate, candidateBinding } = candidates[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.snapshot.commitSha).toBe(validSha);

    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(candidateBinding.startsWith(`${CONTRACT_VERSION}:FindingCandidate\n`)).toBe(true);
    expect(candidateBinding.startsWith('sha256:')).toBe(false);
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);
  });

  it('rejects uppercase or non-normalized commit SHA on candidate bridge restart', async () => {
    const uppercaseCommit = 'A'.repeat(40);
    const bridge = createSqlCandidateBridge(async () => uppercaseCommit);
    const { snapshot, ingestion, result } = await analyzeInput(input(0));

    await expect(bridge(result, snapshot, ingestion, ORG)).rejects.toThrow(
      'M3_CHECKED_COMMIT_REQUIRED',
    );
  });

  it('verification state machine prohibits direct resume to COMPLETE from CANDIDATE', async () => {
    const validSha = 'b'.repeat(40);
    const bridge = createSqlCandidateBridge(async () => validSha);
    const { snapshot, ingestion, result } = await analyzeInput(input(0));
    const [{ candidate }] = await bridge(result, snapshot, ingestion, ORG);

    const state = createVerificationState(candidate, ORG);
    expect(state.state).toBe('CANDIDATE');

    await expect(
      transitionVerificationState(state, {
        type: 'COMPLETE',
        result: { result: 'VERIFIED' } as any,
        evidence: {} as any,
      }),
    ).rejects.toThrow('COMPLETE requires pending verification');
  });

  it('negative control: non-detected fixture creates no candidate across restart', async () => {
    const bridge = createSqlCandidateBridge(async () => 'c'.repeat(40));
    const { snapshot, ingestion, result } = await analyzeInput(input(1));
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);

    const candidates = await bridge(result, snapshot, ingestion, ORG);
    expect(candidates).toEqual([]);
  });
});
