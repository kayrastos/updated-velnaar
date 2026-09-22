import { describe, expect, it } from 'vitest';
import { computeCandidateBinding, validateFindingCandidate } from '../../../../worker/intelligence/contracts';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { ANALYSIS_LIMITS } from '../../../../worker/intelligence/detection/types';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

describe('M3 SQL injection adversarial edge cases: nested calls and structures', () => {
  it('detects taint propagation across nested helper call chains', async () => {
    const helpers = [
      'function nestA(v: string) { return nestB(v); }',
      'function nestB(v: string) { return nestC(v); }',
      'function nestC(v: string) { return v; }',
    ].join('\n');
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute', helpers + '\nfunction searchRoute')
      .replace('" + req.query.q + "', '" + nestA(req.query.q) + "'));
    const { result, snapshot, ingestion } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.symbol).toBe('db.prepare');
    const callSteps = finding.flow.filter(s => s.kind === 'CALL');
    expect(callSteps.map(s => s.location.symbol)).toEqual(['nestA', 'nestB', 'nestC']);
    const argSteps = finding.flow.filter(s => s.kind === 'ARGUMENT');
    expect(argSteps.map(s => s.location.symbol)).toEqual(['v', 'v', 'v']);
    expect(finding.flow.filter(s => s.kind === 'RETURN')).toHaveLength(3);
    const bridge = createSqlCandidateBridge(async () => 'a'.repeat(40));
    const hypotheses = await bridge(result, snapshot, ingestion, ORG);
    expect(hypotheses).toHaveLength(1);
    expect(hypotheses[0].candidate.verificationState).toBe('CANDIDATE');
    expect(hypotheses[0].candidate.reachabilityState).toBe('REACHABLE');
    expect(hypotheses[0].candidateBinding).toBe(computeCandidateBinding(hypotheses[0].candidate, ORG));
    expect(validateFindingCandidate(hypotheses[0].candidate, ORG)).toEqual(hypotheses[0].candidate);
  });

  it('detects nested parenthesized concatenation trees with a single tainted operand', async () => {
    const raw = replaceSource(input(), source => source.replace(
      '" + req.query.q + "',
      '" + ((((("prefix_" + ((((req.query.q)))))) + "_suffix"))) + "'
    ));
    const { result, snapshot, ingestion } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].vulnerabilityClass).toBe('SQL_INJECTION');
    expect(result.findings[0].source.symbol).toBe('query.q');
    expect(result.findings[0].sink.symbol).toBe('db.prepare');
    expect(result.findings[0].flow.filter(s => s.kind === 'CONCAT').length).toBeGreaterThanOrEqual(2);
    const validated = await validateSqlAnalysis(result, snapshot, ingestion, ORG);
    expect(validated.resultFingerprint).toBe(result.resultFingerprint);
  });

  it('negative control: nested helper returning clean constant creates no finding or candidate', async () => {
    const helpers = [
      'function safeLeaf(untrusted: string) { return "constant_value"; }',
      'function safeMid(v: string) { return safeLeaf(v); }',
      'function safeTop(v: string) { return safeMid(v); }',
    ].join('\n');
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute', helpers + '\nfunction searchRoute')
      .replace('" + req.query.q + "', '" + safeTop(req.query.q) + "'));
    const { result, snapshot, ingestion } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toHaveLength(0);
    const bridge = createSqlCandidateBridge(async () => 'a'.repeat(40));
    expect(await bridge(result, snapshot, ingestion, ORG)).toEqual([]);
  });

  it('adversarial nested helper mutual recursion fails closed with CALL_CYCLE', async () => {
    const helpers = [
      'function cycleOne(v: string) { return cycleTwo(v); }',
      'function cycleTwo(v: string) { return cycleThree(v); }',
      'function cycleThree(v: string) { return cycleOne(v); }',
    ].join('\n');
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute', helpers + '\nfunction searchRoute')
      .replace('" + req.query.q + "', '" + cycleOne(req.query.q) + "'));
    const { result, snapshot, ingestion } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('CALL_CYCLE');
    const bridge = createSqlCandidateBridge(async () => 'a'.repeat(40));
    expect(await bridge(result, snapshot, ingestion, ORG)).toEqual([]);
  });

  it('adversarial nested call chain exceeding depth budget fails closed with CALL_DEPTH', async () => {
    const helpers = Array.from({ length: ANALYSIS_LIMITS.callDepth + 4 }, (_, i) =>
      `function f${i}(v: string) { return ${i === ANALYSIS_LIMITS.callDepth + 3 ? 'v' : `f${i + 1}(v)`}; }`
    ).join('\n');
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute', helpers + '\nfunction searchRoute')
      .replace('" + req.query.q + "', '" + f0(req.query.q) + "'));
    const { result, snapshot, ingestion } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('CALL_DEPTH');
    const bridge = createSqlCandidateBridge(async () => 'a'.repeat(40));
    expect(await bridge(result, snapshot, ingestion, ORG)).toEqual([]);
  });

  it('adversarial nested join combining multiple request sources fails closed with MULTIPLE_SOURCES', async () => {
    const helpers = [
      'function getBranchA(req: any) { return req.query.q; }',
      'function getBranchB(req: any) { return req.query.other; }',
      'function combine(req: any) { return getBranchA(req) + getBranchB(req); }',
    ].join('\n');
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute', helpers + '\nfunction searchRoute')
      .replace('" + req.query.q + "', '" + combine(req) + "'));
    const { result, snapshot, ingestion } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('MULTIPLE_SOURCES');
    const bridge = createSqlCandidateBridge(async () => 'a'.repeat(40));
    expect(await bridge(result, snapshot, ingestion, ORG)).toEqual([]);
  });

  it('candidate bridge preserves CANDIDATE state and canonical binding for detected nested flows', async () => {
    const helpers = 'function passThrough(v: string) { return v; }';
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute', helpers + '\nfunction searchRoute')
      .replace('" + req.query.q + "', '" + passThrough(req.query.q) + "'));
    const { result, snapshot, ingestion } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    const bridge = createSqlCandidateBridge(async () => 'b'.repeat(40));
    const outputs = await bridge(result, snapshot, ingestion, ORG);
    expect(outputs).toHaveLength(1);
    const { candidate, candidateBinding } = outputs[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(() => computeCandidateBinding({ ...candidate, verificationState: 'VERIFIED' } as any, ORG)).toThrow();
  });
});
