import { describe, expect, it } from 'vitest';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { computeCandidateBinding } from '../../../../worker/intelligence/contracts';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

describe('V1 discovery-intelligence: SQL injection wrapper-boundary nested analysis', () => {
  it('detects taint propagation through two-level nested helper wrappers', async () => {
    const raw = replaceSource(input(), source => {
      const helpers = [
        'function innerWrap(raw: string): string {',
        '  return raw;',
        '}',
        'function outerWrap(raw: string): string {',
        '  return innerWrap(raw);',
        '}',
      ].join('\n');
      return source
        .replace('function searchRoute', helpers + '\nfunction searchRoute')
        .replace('" + req.query.q + "', '" + outerWrap(req.query.q) + "');
    });
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.limitations).toEqual([]);
    expect(result.findings).toHaveLength(1);

    const finding = result.findings[0];
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.symbol).toBe('db.prepare');
    expect(finding.flow[0].kind).toBe('SOURCE');
    expect(finding.flow.at(-1)!.kind).toBe('SINK');

    const callSymbols = finding.flow.filter(s => s.kind === 'CALL').map(s => s.location.symbol);
    expect(callSymbols).toContain('outerWrap');
    expect(callSymbols).toContain('innerWrap');
    expect(finding.flow.some(s => s.kind === 'ARGUMENT')).toBe(true);
    expect(finding.flow.some(s => s.kind === 'RETURN')).toBe(true);
    expect(finding.flow.some(s => s.kind === 'CONCAT')).toBe(true);

    const validated = await validateSqlAnalysis(result, snapshot, ingestion, ORG);
    expect(validated.resultFingerprint).toBe(result.resultFingerprint);
  });

  it('detects taint propagation through three-level deeply nested wrappers', async () => {
    const raw = replaceSource(input(), source => {
      const helpers = [
        'function levelThree(raw: string): string {',
        '  return raw;',
        '}',
        'function levelTwo(raw: string): string {',
        '  return levelThree(raw);',
        '}',
        'function levelOne(raw: string): string {',
        '  return levelTwo(raw);',
        '}',
      ].join('\n');
      return source
        .replace('function searchRoute', helpers + '\nfunction searchRoute')
        .replace('" + req.query.q + "', '" + levelOne(req.query.q) + "');
    });
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);

    const callSymbols = result.findings[0].flow.filter(s => s.kind === 'CALL').map(s => s.location.symbol);
    expect(callSymbols).toEqual(['levelOne', 'levelTwo', 'levelThree']);
  });

  it('negative control: safe constant through nested wrapper yields no findings', async () => {
    const raw = replaceSource(input(), source => {
      const helpers = [
        'function innerWrap(raw: string): string {',
        '  return raw;',
        '}',
        'function outerWrap(raw: string): string {',
        '  return innerWrap(raw);',
        '}',
      ].join('\n');
      return source
        .replace('function searchRoute', helpers + '\nfunction searchRoute')
        .replace('" + req.query.q + "', '" + outerWrap("safe_constant") + "');
    });
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
  });

  it('negative control: tainted nested wrapper call disconnected from query yields no findings', async () => {
    const raw = replaceSource(input(), source => {
      const helpers = [
        'function innerWrap(raw: string): string {',
        '  return raw;',
        '}',
        'function outerWrap(raw: string): string {',
        '  return innerWrap(raw);',
        '}',
      ].join('\n');
      return source
        .replace('function searchRoute', helpers + '\nfunction searchRoute')
        .replace('return res.json', 'const discarded = outerWrap(req.query.q);\n    return res.json')
        .replace('" + req.query.q + "', '" + "constant_filter" + "');
    });
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
  });

  it('fails closed with CALL_CYCLE when nested wrappers contain mutual recursion', async () => {
    const raw = replaceSource(input(), source => {
      const helpers = [
        'function cyclicA(raw: string): string {',
        '  return cyclicB(raw);',
        '}',
        'function cyclicB(raw: string): string {',
        '  return cyclicA(raw);',
        '}',
      ].join('\n');
      return source
        .replace('function searchRoute', helpers + '\nfunction searchRoute')
        .replace('" + req.query.q + "', '" + cyclicA(req.query.q) + "');
    });
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('CALL_CYCLE');
  });

  it('fails closed with CALL_DEPTH when nested wrapper chain exceeds budget', async () => {
    const depth = 20;
    const helpers = Array.from({ length: depth }, (_, i) =>
      `function nest${i}(v: string): string { return ${i === depth - 1 ? 'v' : `nest${i + 1}(v)`}; }`
    ).join('\n');
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute', helpers + '\nfunction searchRoute')
      .replace('return res.json', 'nest0(req.query.q); return res.json'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('CALL_DEPTH');
  });

  it('bridges nested wrapper finding to valid CANDIDATE hypothesis with canonical binding', async () => {
    const raw = replaceSource(input(), source => {
      const helpers = [
        'function innerWrap(raw: string): string {',
        '  return raw;',
        '}',
        'function outerWrap(raw: string): string {',
        '  return innerWrap(raw);',
        '}',
      ].join('\n');
      return source
        .replace('function searchRoute', helpers + '\nfunction searchRoute')
        .replace('" + req.query.q + "', '" + outerWrap(req.query.q) + "');
    });
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');

    const commitSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const bridge = createSqlCandidateBridge(async () => commitSha);
    const candidateHypotheses = await bridge(result, snapshot, ingestion, ORG);

    expect(candidateHypotheses).toHaveLength(1);
    const { candidate, candidateBinding } = candidateHypotheses[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.snapshot.commitSha).toBe(commitSha);
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(candidateBinding).not.toMatch(/^sha256:/);
  });
});
