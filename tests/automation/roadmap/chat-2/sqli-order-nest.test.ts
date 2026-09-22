import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { computeCandidateBinding, validateFindingCandidate } from '../../../../worker/intelligence/contracts';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { ANALYSIS_LIMITS, DETECTOR_VERSION } from '../../../../worker/intelligence/detection/types';
import { canonical } from '../../../../worker/intelligence/ingestion/snapshot';
import { analyzeInput, input, ORG } from '../../../intelligence/m3/support/inputs';

describe('V1 discovery-intelligence sqli-detector order-stability nested', () => {
  it('repeated nested analysis and source enumeration order produce identical results and ordered unique flows', async () => {
    const raw = input(5);
    const reversed = { ...raw, files: [...raw.files].reverse() };
    const base = await analyzeInput(raw);
    const repeated = await detectSqlInjection(base.snapshot, base.ingestion, ORG);
    const reversedRun = await analyzeInput(reversed);

    expect(base.result.status).toBe('DETECTED');
    expect(base.result.findings).toHaveLength(1);
    expect(base.result.limitations).toEqual([]);
    expect(repeated).toEqual(base.result);
    expect(reversedRun.result).toEqual(base.result);
    expect(repeated.resultFingerprint).toBe(base.result.resultFingerprint);
    expect(reversedRun.result.resultFingerprint).toBe(base.result.resultFingerprint);

    const finding = base.result.findings[0];
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.flow[0].kind).toBe('SOURCE');
    expect(finding.flow.at(-1)!.kind).toBe('SINK');

    const callSymbols = finding.flow.filter(step => step.kind === 'CALL').map(step => step.location.symbol);
    expect(callSymbols).toEqual(['lookup', 'buildQuery']);
    expect(finding.flow.filter(step => step.kind === 'ARGUMENT')).toHaveLength(2);
    expect(finding.flow.some(step => step.kind === 'RETURN')).toBe(true);

    expect(new Set(finding.flow.map(step => step.id)).size).toBe(finding.flow.length);
    expect(finding.flow.length).toBeLessThanOrEqual(ANALYSIS_LIMITS.flowLength);

    const { resultFingerprint, ...body } = repeated;
    expect(resultFingerprint).toBe('sha256:' + createHash('sha256').update(DETECTOR_VERSION + '\n' + canonical(body)).digest('hex'));
    expect(Object.isFrozen(repeated.findings[0].flow[0].location)).toBe(true);
  });

  it('rejects flow step order tampering in nested finding under integrity validation', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(5));
    await expect(validateSqlAnalysis(result, snapshot, ingestion, ORG)).resolves.toEqual(result);

    const tampered = structuredClone(result);
    (tampered.findings as any)[0].flow = [...tampered.findings[0].flow].reverse();
    await expect(validateSqlAnalysis(tampered, snapshot, ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY');
  });

  it('binds nested candidate hypothesis deterministically with stable candidate binding', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(5));
    const commitSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const bridge = createSqlCandidateBridge(async () => commitSha);

    const candidates = await bridge(result, snapshot, ingestion, ORG);
    expect(candidates).toHaveLength(1);

    const { candidate, candidateBinding } = candidates[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.snapshot.commitSha).toBe(commitSha);
    expect(candidate.context.routeId).toBe(result.findings[0].routeIdentity);
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);

    const repeated = await bridge(result, snapshot, ingestion, ORG);
    expect(repeated).toEqual(candidates);
  });
});
