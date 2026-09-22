import { describe, expect, it } from 'vitest';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { computeCandidateBinding, validateFindingCandidate } from '../../../../worker/intelligence/contracts';
import { ANALYSIS_LIMITS } from '../../../../worker/intelligence/detection/types';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

describe('Roadmap Chat-2 SQL injection nested alias propagation', () => {
  it('tracks alias propagation through a two-level nested helper chain to sink', async () => {
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute',
        'function innerHelper(innerParam: string) { const innerAlias = innerParam; return innerAlias; }\n' +
        'function outerHelper(outerParam: string) { const outerAlias = outerParam; return innerHelper(outerAlias); }\n' +
        'function searchRoute')
      .replace('return res.json',
        'const routeAlias = req.query.q; const resolved = outerHelper(routeAlias); return res.json')
      .replace('" + req.query.q + "', '" + resolved + "'));

    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);

    const finding = result.findings[0];
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.symbol).toBe('db.prepare');
    expect(finding.flow.some(step => step.kind === 'CONCAT')).toBe(true);
    expect(finding.flow.filter(step => step.kind === 'CALL').map(step => step.location.symbol)).toEqual(['outerHelper', 'innerHelper']);
    expect(finding.flow.filter(step => step.kind === 'ARGUMENT').map(step => step.location.symbol)).toEqual(['outerParam', 'innerParam']);
    expect(finding.flow.filter(step => step.kind === 'VARIABLE').map(step => step.location.symbol)).toEqual(['routeAlias', 'outerAlias', 'innerAlias', 'resolved']);
    expect(finding.flow.filter(step => step.kind === 'RETURN')).toHaveLength(2);
  });

  it('tracks alias propagation through a three-level nested helper chain', async () => {
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute',
        'function levelThree(p3: string) { const a3 = p3; return a3; }\n' +
        'function levelTwo(p2: string) { const a2 = p2; return levelThree(a2); }\n' +
        'function levelOne(p1: string) { const a1 = p1; return levelTwo(a1); }\n' +
        'function searchRoute')
      .replace('return res.json',
        'const startAlias = req.query.q; const endAlias = levelOne(startAlias); return res.json')
      .replace('" + req.query.q + "', '" + endAlias + "'));

    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);

    const finding = result.findings[0];
    expect(finding.flow.filter(step => step.kind === 'CALL').map(step => step.location.symbol)).toEqual(['levelOne', 'levelTwo', 'levelThree']);
    expect(finding.flow.filter(step => step.kind === 'VARIABLE').map(step => step.location.symbol)).toEqual(['startAlias', 'a1', 'a2', 'a3', 'endAlias']);
    expect(finding.flow.filter(step => step.kind === 'RETURN')).toHaveLength(3);
  });

  it('negative control: safe constant routed through nested alias chain produces no finding', async () => {
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute',
        'function innerHelper(innerParam: string) { const innerAlias = innerParam; return innerAlias; }\n' +
        'function outerHelper(outerParam: string) { const outerAlias = outerParam; return innerHelper(outerAlias); }\n' +
        'function searchRoute')
      .replace('return res.json',
        'const safeSeed = "safe-constant"; const safeResolved = outerHelper(safeSeed); return res.json')
      .replace('" + req.query.q + "', '" + safeResolved + "'));

    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
  });

  it('negative control: disconnected tainted alias with safe operand at sink produces no finding', async () => {
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute',
        'function innerHelper(innerParam: string) { const innerAlias = innerParam; return innerAlias; }\n' +
        'function outerHelper(outerParam: string) { const outerAlias = outerParam; return innerHelper(outerAlias); }\n' +
        'function searchRoute')
      .replace('return res.json',
        'const tainted = req.query.q; const unused = outerHelper(tainted); const clean = outerHelper("safe"); return res.json')
      .replace('" + req.query.q + "', '" + clean + "'));

    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
  });

  it('bridges nested alias finding into a canonical CANDIDATE hypothesis with exact binding', async () => {
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute',
        'function innerHelper(innerParam: string) { const innerAlias = innerParam; return innerAlias; }\n' +
        'function outerHelper(outerParam: string) { const outerAlias = outerParam; return innerHelper(outerAlias); }\n' +
        'function searchRoute')
      .replace('return res.json',
        'const routeAlias = req.query.q; const resolved = outerHelper(routeAlias); return res.json')
      .replace('" + req.query.q + "', '" + resolved + "'));

    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');

    const commitSha = '1111111111111111111111111111111111111111';
    const bridge = createSqlCandidateBridge(async () => commitSha);
    const candidates = await bridge(result, snapshot, ingestion, ORG);

    expect(candidates).toHaveLength(1);
    const { candidate, candidateBinding } = candidates[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.snapshot.commitSha).toBe(commitSha);
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);
  });

  it('fails closed with CALL_DEPTH when nested alias helpers exceed call depth budget', async () => {
    const helpers = Array.from({ length: ANALYSIS_LIMITS.callDepth + 1 }, (_, i) =>
      `function f${i}(v: string) { const a${i} = v; return ${i === ANALYSIS_LIMITS.callDepth ? `a${i}` : `f${i + 1}(a${i})`}; }`
    ).join('\n');

    const raw = replaceSource(input(), source => source
      .replace('function searchRoute', helpers + '\nfunction searchRoute')
      .replace('return res.json', 'const seed = req.query.q; const overflow = f0(seed); return res.json')
      .replace('" + req.query.q + "', '" + overflow + "'));

    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('CALL_DEPTH');
  });

  it('fails closed with CALL_CYCLE when nested alias propagation encounters recursion', async () => {
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute',
        'function stepA(v: string): string { const a = v; return stepB(a); }\n' +
        'function stepB(v: string): string { const b = v; return stepA(b); }\n' +
        'function searchRoute')
      .replace('return res.json', 'const cycleVal = stepA(req.query.q); return res.json')
      .replace('" + req.query.q + "', '" + cycleVal + "'));

    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('CALL_CYCLE');
  });
});
