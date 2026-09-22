import { describe, expect, it } from 'vitest';
import { computeCandidateBinding } from '../../../../worker/intelligence/contracts';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

describe('V1 discovery-intelligence: SQLi detector null-empty-boundary multi-stage', () => {
  it('detects multi-stage empty-string alias concatenation around tainted query parameter', async () => {
    const raw = replaceSource(input(), content => content.replace(
      'return res.json',
      'const s1 = req.query.q; const s2 = "" + s1; const s3 = s2 + ""; return res.json',
    ).replace('" + req.query.q + "', '" + s3 + "'));
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.limitations).toEqual([]);
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.symbol).toBe('db.prepare');
    expect(finding.routeIdentity).toBe(ingestion.routes[0].routeIdentity);
    const varSymbols = finding.flow
      .filter(step => step.kind === 'VARIABLE')
      .map(step => step.location.symbol);
    expect(varSymbols).toEqual(['s1', 's2', 's3']);
    const concatSteps = finding.flow.filter(step => step.kind === 'CONCAT');
    expect(concatSteps.length).toBeGreaterThanOrEqual(2);
    const validated = await validateSqlAnalysis(result, snapshot, ingestion, ORG);
    expect(validated).toEqual(result);
  });

  it('detects multi-stage helper pipeline with empty string boundaries and binds candidate', async () => {
    const helpers = [
      'function stageA(prefix: string, value: string) { return prefix + value; }',
      'function stageB(value: string, suffix: string) { return value + suffix; }',
    ].join('\n');
    const raw = replaceSource(input(), content => content.replace(
      'function searchRoute',
      helpers + '\nfunction searchRoute',
    ).replace(
      'return res.json',
      'const empty = ""; const s1 = stageA(empty, req.query.q); const s2 = stageB(s1, empty); return res.json',
    ).replace('" + req.query.q + "', '" + s2 + "'));
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    const flowKinds = result.findings[0].flow.map(step => step.kind);
    expect(flowKinds).toContain('SOURCE');
    expect(flowKinds).toContain('CALL');
    expect(flowKinds).toContain('ARGUMENT');
    expect(flowKinds).toContain('CONCAT');
    expect(flowKinds).toContain('RETURN');
    expect(flowKinds).toContain('SINK');
    const bridge = createSqlCandidateBridge(async () => 'a'.repeat(40));
    const hypotheses = await bridge(result, snapshot, ingestion, ORG);
    expect(hypotheses).toHaveLength(1);
    const { candidate, candidateBinding } = hypotheses[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.organizationId).toBe(ORG);
    expect(candidate.snapshot.commitSha).toBe('a'.repeat(40));
    expect(candidate.context.routeId).toBe(ingestion.routes[0].routeIdentity);
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
  });

  it('negative control: multi-stage clean empty-string concatenation produces NOT_DETECTED', async () => {
    const raw = replaceSource(input(), content => content.replace(
      'return res.json',
      'const e1 = ""; const e2 = "" + e1; const e3 = e2 + ""; return res.json',
    ).replace('" + req.query.q + "', '" + e3 + "'));
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
    const bridge = createSqlCandidateBridge(async () => 'a'.repeat(40));
    expect(await bridge(result, snapshot, ingestion, ORG)).toEqual([]);
  });

  it('negative control: multi-stage clean helpers without tainted input produce NOT_DETECTED', async () => {
    const helpers = [
      'function cleanStageA(a: string, b: string) { return a + b; }',
      'function cleanStageB(a: string, b: string) { return a + b; }',
    ].join('\n');
    const raw = replaceSource(input(), content => content.replace(
      'function searchRoute',
      helpers + '\nfunction searchRoute',
    ).replace(
      'return res.json',
      'const e = ""; const s1 = cleanStageA(e, "safe"); const s2 = cleanStageB(s1, e); return res.json',
    ).replace('" + req.query.q + "', '" + s2 + "'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
  });

  it('fail-closed: unsupported literal null expression in multi-stage flow yields ANALYSIS_INCONCLUSIVE', async () => {
    const raw = replaceSource(input(), content => content.replace(
      'return res.json',
      'const n = null; return res.json',
    ));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('UNSUPPORTED_EXPRESSION');
  });

  it('rejects tampered multi-stage result at analysis integrity boundary', async () => {
    const raw = replaceSource(input(), content => content.replace(
      'return res.json',
      'const s1 = req.query.q; const s2 = "" + s1; return res.json',
    ).replace('" + req.query.q + "', '" + s2 + "'));
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    const tampered: any = structuredClone(result);
    tampered.findings[0].source.column++;
    await expect(validateSqlAnalysis(tampered, snapshot, ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY');
  });
});
