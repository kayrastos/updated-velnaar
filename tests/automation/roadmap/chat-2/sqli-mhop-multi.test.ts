import { describe, expect, it } from 'vitest';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { ANALYSIS_LIMITS } from '../../../../worker/intelligence/detection/types';
import { computeCandidateBinding, validateFindingCandidate } from '../../../../worker/intelligence/contracts';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

describe('V1 discovery-intelligence sqli multi-hop multi-stage flow detection', () => {
  it('detects request taint propagated across a 3-stage helper function pipeline', async () => {
    const helpers = `
function stageOne(a: string) {
  const v1 = a;
  return stageTwo(v1);
}
function stageTwo(b: string) {
  const v2 = b;
  return stageThree(v2);
}
function stageThree(c: string) {
  const v3 = c;
  return v3;
}
`;
    const raw = replaceSource(input(), content =>
      content.replace('function searchRoute', helpers + '\nfunction searchRoute')
        .replace('return res.json', 'const staged = stageOne(req.query.q);\n    return res.json')
        .replace('" + req.query.q + "', '" + staged + "')
    );
    const { result, snapshot, ingestion } = await analyzeInput(raw);

    expect(result.status).toBe('DETECTED');
    expect(result.limitations).toEqual([]);
    expect(result.findings).toHaveLength(1);

    const finding = result.findings[0];
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.symbol).toBe('db.prepare');
    expect(finding.flow[0].kind).toBe('SOURCE');
    expect(finding.flow.at(-1)?.kind).toBe('SINK');

    expect(finding.flow.filter(s => s.kind === 'CALL').map(s => s.location.symbol)).toEqual(['stageOne', 'stageTwo', 'stageThree']);
    expect(finding.flow.filter(s => s.kind === 'ARGUMENT').map(s => s.location.symbol)).toEqual(['a', 'b', 'c']);
    expect(finding.flow.filter(s => s.kind === 'VARIABLE').map(s => s.location.symbol)).toEqual(['v1', 'v2', 'v3', 'staged']);
    expect(finding.flow.filter(s => s.kind === 'RETURN')).toHaveLength(3);
    expect(finding.flow.some(s => s.kind === 'CONCAT')).toBe(true);

    const bridge = createSqlCandidateBridge(async () => 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    const candidates = await bridge(result, snapshot, ingestion, ORG);
    expect(candidates).toHaveLength(1);
    const { candidate, candidateBinding } = candidates[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.source.symbol).toBe('query.q');
    expect(candidate.sink.symbol).toBe('db.prepare');
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);
  });

  it('negative control: safe constant through multi-stage helper pipeline does not trigger finding', async () => {
    const helpers = `
function stageOne(a: string) {
  const v1 = a;
  return stageTwo(v1);
}
function stageTwo(b: string) {
  const v2 = b;
  return stageThree(v2);
}
function stageThree(c: string) {
  const v3 = c;
  return v3;
}
`;
    const raw = replaceSource(input(), content =>
      content.replace('function searchRoute', helpers + '\nfunction searchRoute')
        .replace('return res.json', 'const safeStaged = stageOne("safe-constant");\n    return res.json')
        .replace('" + req.query.q + "', '" + safeStaged + "')
    );
    const { result } = await analyzeInput(raw);

    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
  });

  it('negative control: disconnected multi-stage helper chain produces no authoritative finding', async () => {
    const helpers = `
function unusedStageOne(a: string) {
  return unusedStageTwo(a);
}
function unusedStageTwo(b: string) {
  return b;
}
`;
    const raw = replaceSource(input(), content =>
      content.replace('function searchRoute', helpers + '\nfunction searchRoute')
    );
    const { result } = await analyzeInput(raw);

    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].flow.some(s => s.location.symbol === 'unusedStageOne')).toBe(false);
  });

  it('fails closed when multi-stage acyclic call depth exceeds limit', async () => {
    const depth = ANALYSIS_LIMITS.callDepth + 2;
    const helpers = Array.from({ length: depth }, (_, i) =>
      `function stageHop${i}(v: string) { return ${i === depth - 1 ? 'v' : `stageHop${i + 1}(v)`}; }`
    ).join('\n');
    const raw = replaceSource(input(), content =>
      content.replace('function searchRoute', helpers + '\nfunction searchRoute')
        .replace('return res.json', 'const deep = stageHop0(req.query.q);\n    return res.json')
        .replace('" + req.query.q + "', '" + deep + "')
    );
    const { result } = await analyzeInput(raw);

    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('CALL_DEPTH');
  });
});
