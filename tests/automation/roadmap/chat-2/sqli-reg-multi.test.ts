import { describe, expect, it } from 'vitest';
import { computeCandidateBinding, validateFindingCandidate } from '../../../../worker/intelligence/contracts';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { ANALYSIS_LIMITS, RULE_ID } from '../../../../worker/intelligence/detection/types';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

describe('V1:discovery-intelligence:sqli-detector:regression-lock:multi-stage', () => {
  it('locks multi-stage helper call pipeline detection and provenance (fixture 5)', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(5));
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    expect(result.limitations).toEqual([]);

    const finding = result.findings[0];
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.symbol).toBe('db.prepare');

    const flowKinds = finding.flow.map(step => step.kind);
    expect(flowKinds[0]).toBe('SOURCE');
    expect(flowKinds.at(-1)).toBe('SINK');
    expect(flowKinds).toContain('CALL');
    expect(flowKinds).toContain('ARGUMENT');
    expect(flowKinds).toContain('RETURN');
    expect(flowKinds).toContain('CONCAT');

    const callSymbols = finding.flow.filter(s => s.kind === 'CALL').map(s => s.location.symbol);
    expect(callSymbols).toEqual(['lookup', 'buildQuery']);

    const validated = await validateSqlAnalysis(result, snapshot, ingestion, ORG);
    expect(validated.resultFingerprint).toBe(result.resultFingerprint);
  });

  it('locks multi-stage variable and concatenation alias chains', async () => {
    const raw = replaceSource(input(), content => content
      .replace('return res.json', 'const stage1 = req.query.q; const stage2 = stage1; const stage3 = stage2; return res.json')
      .replace('" + req.query.q + "', '" + stage3 + "'));

    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);

    const finding = result.findings[0];
    const varSymbols = finding.flow.filter(s => s.kind === 'VARIABLE').map(s => s.location.symbol);
    expect(varSymbols).toEqual(['stage1', 'stage2', 'stage3']);
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.symbol).toBe('db.prepare');

    const repeated = await detectSqlInjection(snapshot, ingestion, ORG);
    expect(repeated.resultFingerprint).toBe(result.resultFingerprint);
  });

  it('locks multi-stage negative control: constant propagation across stages is NOT_DETECTED', async () => {
    const raw = replaceSource(input(), content => content
      .replace('return res.json', 'const stage1 = "constant"; const stage2 = stage1; return res.json')
      .replace('" + req.query.q + "', '" + stage2 + "'));

    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
  });

  it('locks multi-stage fail-closed budget boundary when flow exceeds budget', async () => {
    const declarations = [
      'const s0 = req.query.q',
      ...Array.from({ length: ANALYSIS_LIMITS.flowLength + 1 }, (_, i) => `const s${i + 1} = s${i}`),
    ].join('; ');

    const raw = replaceSource(input(), content => content.replace('return res.json', `${declarations}; return res.json`));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('FLOW_BUDGET');
  });

  it('binds multi-stage finding to candidate hypothesis with verified commit', async () => {
    const run = await analyzeInput(input(5));
    expect(run.result.status).toBe('DETECTED');

    const verifiedCommit = 'e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4';
    const bridge = createSqlCandidateBridge(async () => verifiedCommit);
    const candidateOutput = await bridge(run.result, run.snapshot, run.ingestion, ORG);

    expect(candidateOutput).toHaveLength(1);
    const { candidate, candidateBinding } = candidateOutput[0];

    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.snapshot.commitSha).toBe(verifiedCommit);
    expect(candidate.sensorEvidence[0].ruleId).toBe(RULE_ID);
    expect(candidate.sensorEvidence[0].sensorType).toBe('VELNAR_STRUCTURAL');
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);
  });

  it('rejects tampered flow steps in multi-stage analysis during validation', async () => {
    const run = await analyzeInput(input(5));
    const forged: any = structuredClone(run.result);
    forged.findings[0].flow.push({ ...forged.findings[0].flow[0] });

    await expect(validateSqlAnalysis(forged, run.snapshot, run.ingestion, ORG))
      .rejects.toThrow('M3_ANALYSIS_INTEGRITY');
  });
});
