import { describe, expect, it, vi } from 'vitest';
import { createSqlCandidateBridge } from '../../../worker/intelligence/detection/candidate';
import { computeCandidateBinding } from '../../../worker/intelligence/contracts';
import { validateSqlAnalysis } from '../../../worker/intelligence/detection/sqlInjection';
import { ANALYSIS_LIMITS } from '../../../worker/intelligence/detection/types';
import { verifyCommittedFixture } from '../m2/support/gitCodeState';
import { analyzeInput, input, replaceSource, ORG } from '../m3/support/inputs';

describe('M4 duplicate evidence collapse', () => {
  it('collapses duplicate flow steps when a tainted variable is self-concatenated', async () => {
    const raw = replaceSource(input(), content => content.replace('return res.json',
      'const x = req.query.q; const y = x + x; return res.json')
      .replace('" + req.query.q + "', '" + y + "'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    expect(finding.flow.filter(step => step.kind === 'SOURCE')).toHaveLength(1);
    expect(finding.flow.filter(step => step.kind === 'VARIABLE' && step.location.symbol === 'x')).toHaveLength(1);
    expect(new Set(finding.flow.map(step => step.id)).size).toBe(finding.flow.length);
  });

  it('does not collapse distinct sources and fails closed with MULTIPLE_SOURCES', async () => {
    const raw = replaceSource(input(), content => content.replace('req.query.q', '(req.query.q + req.query.other)'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('MULTIPLE_SOURCES');
  });

  it('collapses shared ancestor taint steps in diamond alias joins', async () => {
    const raw = replaceSource(input(), content => content.replace('return res.json',
      'const a = req.query.q; const b = a; const c = a; const d = b + c; return res.json')
      .replace('" + req.query.q + "', '" + d + "'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    const flow = result.findings[0].flow;
    expect(flow.filter(step => step.kind === 'SOURCE')).toHaveLength(1);
    expect(flow.filter(step => step.kind === 'VARIABLE' && step.location.symbol === 'a')).toHaveLength(1);
    expect(flow.filter(step => step.kind === 'VARIABLE' && step.location.symbol === 'b')).toHaveLength(1);
    expect(flow.filter(step => step.kind === 'VARIABLE' && step.location.symbol === 'c')).toHaveLength(1);
    expect(new Set(flow.map(step => step.id)).size).toBe(flow.length);
  });

  it.each([0, 2, 5, 6, 7])('fixture index %i produces strictly collapsed unique flow step identities', async index => {
    const { result } = await analyzeInput(input(index));
    expect(result.status).toBe('DETECTED');
    for (const finding of result.findings) {
      expect(new Set(finding.flow.map(step => step.id)).size).toBe(finding.flow.length);
      expect(finding.flow.length).toBeLessThanOrEqual(ANALYSIS_LIMITS.flowLength);
    }
  });

  it('rejects tampered duplicate flow steps under integrity validation', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(0));
    const forged: any = structuredClone(result);
    forged.findings[0].flow.push(forged.findings[0].flow[0]);
    await expect(validateSqlAnalysis(forged, snapshot, ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY');
  });

  it('rejects tampered duplicate findings under integrity validation', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(0));
    const forged: any = structuredClone(result);
    forged.findings.push(forged.findings[0]);
    await expect(validateSqlAnalysis(forged, snapshot, ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY');
  });

  it('bridge creates exactly one candidate hypothesis per collapsed finding with canonical binding', async () => {
    const bridge = createSqlCandidateBridge(verifyCommittedFixture);
    const { snapshot, ingestion, result } = await analyzeInput(input(0));
    const hypotheses = await bridge(result, snapshot, ingestion, ORG);
    expect(hypotheses).toHaveLength(1);
    const { candidate, candidateBinding } = hypotheses[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.sensorEvidence).toHaveLength(1);
    expect(candidate.sensorEvidence[0].sensorType).toBe('VELNAR_STRUCTURAL');
    expect(candidate.sensorEvidence[0].rawEvidenceFingerprint).toBe(result.resultFingerprint);
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(candidateBinding.startsWith('velnar-intelligence-contract-v1:FindingCandidate\n')).toBe(true);
    expect(candidateBinding.startsWith('sha256:')).toBe(false);
  });

  it('bridge rejects uncollapsed duplicate findings before candidate creation', async () => {
    const verify = vi.fn();
    const bridge = createSqlCandidateBridge(verify);
    const { snapshot, ingestion, result } = await analyzeInput(input(0));
    const forged: any = structuredClone(result);
    forged.findings.push(forged.findings[0]);
    await expect(bridge(forged, snapshot, ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY');
    expect(verify).not.toHaveBeenCalled();
  });
});
