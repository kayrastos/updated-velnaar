import { describe, expect, it, vi } from 'vitest';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { ANALYSIS_LIMITS } from '../../../../worker/intelligence/detection/types';
import { computeCandidateBinding, validateFindingCandidate } from '../../../../worker/intelligence/contracts';
import { analyzeInput, input, ORG } from '../../../intelligence/m3/support/inputs';

describe('V1 discovery intelligence: SQL injection detector multi-stage duplicate collapse', () => {
  it('detects multi-stage SQL injection with ordered unique flow steps', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(5));
    expect(result.status).toBe('DETECTED');
    expect(result.limitations).toEqual([]);
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.sink.symbol).toBe('db.prepare');
    expect(finding.flow[0].kind).toBe('SOURCE');
    expect(finding.flow.at(-1)!.kind).toBe('SINK');
    const callSymbols = finding.flow.filter(step => step.kind === 'CALL').map(step => step.location.symbol);
    expect(callSymbols).toEqual(['lookup', 'buildQuery']);
    expect(finding.flow.filter(step => step.kind === 'ARGUMENT')).toHaveLength(2);
    expect(finding.flow.some(step => step.kind === 'RETURN')).toBe(true);
    const flowIds = finding.flow.map(step => step.id);
    expect(new Set(flowIds).size).toBe(finding.flow.length);
    expect(finding.flow.length).toBeLessThanOrEqual(ANALYSIS_LIMITS.flowLength);
  });

  it('collapses duplicate flow steps and preserves uniqueness under repeated analysis', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(5));
    const repeated = await detectSqlInjection(snapshot, ingestion, ORG);
    expect(repeated).toEqual(result);
    expect(repeated.resultFingerprint).toBe(result.resultFingerprint);
    for (const finding of result.findings) {
      const stepIds = finding.flow.map(step => step.id);
      expect(new Set(stepIds).size).toBe(finding.flow.length);
    }
  });

  it('collapses duplicate paths across file ordering permutations', async () => {
    const original = await analyzeInput(input(5));
    const reversedInput = { ...input(5), files: [...input(5).files].reverse() };
    const reversed = await analyzeInput(reversedInput);
    expect(reversed.result).toEqual(original.result);
  });

  it('rejects tampered duplicate flow step and duplicate finding injection', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(5));
    const duplicateStepForged: any = structuredClone(result);
    duplicateStepForged.findings[0].flow.push(duplicateStepForged.findings[0].flow[0]);
    await expect(validateSqlAnalysis(duplicateStepForged, snapshot, ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY');

    const duplicateFindingForged: any = structuredClone(result);
    duplicateFindingForged.findings.push(duplicateFindingForged.findings[0]);
    await expect(validateSqlAnalysis(duplicateFindingForged, snapshot, ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY');
  });

  it('bridges multi-stage finding to candidate hypothesis without duplicate collapse regression', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(5));
    const checkedCommit = 'a'.repeat(40);
    const bridge = createSqlCandidateBridge(async () => checkedCommit);
    const candidates = await bridge(result, snapshot, ingestion, ORG);
    expect(candidates).toHaveLength(1);
    const { candidate, candidateBinding } = candidates[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.organizationId).toBe(ORG);
    expect(candidate.snapshot.commitSha).toBe(checkedCommit);
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);
  });

  it('bridge rejects forged duplicate flow or duplicate finding before candidate construction', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(5));
    const checkedCommit = 'a'.repeat(40);
    const verify = vi.fn().mockResolvedValue(checkedCommit);
    const bridge = createSqlCandidateBridge(verify);

    const forgedFinding: any = structuredClone(result);
    forgedFinding.findings.push(forgedFinding.findings[0]);
    await expect(bridge(forgedFinding, snapshot, ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY');

    const forgedFlow: any = structuredClone(result);
    forgedFlow.findings[0].flow.push(forgedFlow.findings[0].flow[0]);
    await expect(bridge(forgedFlow, snapshot, ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY');

    expect(verify).not.toHaveBeenCalled();
  });
});
