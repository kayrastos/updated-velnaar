import { describe, expect, it } from 'vitest';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { computeCandidateBinding, validateFindingCandidate } from '../../../../worker/intelligence/contracts';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

describe('RM_SQLI_NEST_MULTI: nested multi-stage SQL injection flows', () => {
  it('detects request taint propagated across a 3-stage nested helper pipeline', async () => {
    const raw = replaceSource(input(), source => source.replace('function searchRoute',
      `function stageThree(term: string) {
  const transformed = term;
  return transformed;
}
function stageTwo(mid: string) {
  const next = stageThree(mid);
  return next;
}
function stageOne(start: string) {
  const stepped = stageTwo(start);
  return stepped;
}
function searchRoute`)
      .replace('return res.json',
        'const staged = stageOne(req.query.q); return res.json')
      .replace('" + req.query.q + "', '" + staged + "'));

    const { result, snapshot, ingestion } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.limitations).toEqual([]);
    expect(result.findings).toHaveLength(1);

    const finding = result.findings[0];
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.symbol).toBe('db.prepare');
    expect(finding.routeIdentity).toBe(ingestion.routes[0].routeIdentity);

    const calls = finding.flow.filter(s => s.kind === 'CALL').map(s => s.location.symbol);
    expect(calls).toEqual(['stageOne', 'stageTwo', 'stageThree']);

    const args = finding.flow.filter(s => s.kind === 'ARGUMENT').map(s => s.location.symbol);
    expect(args).toEqual(['start', 'mid', 'term']);

    const vars = finding.flow.filter(s => s.kind === 'VARIABLE').map(s => s.location.symbol);
    expect(vars).toEqual(['transformed', 'next', 'stepped', 'staged']);

    expect(finding.flow.filter(s => s.kind === 'RETURN')).toHaveLength(3);
    expect(finding.flow[0].kind).toBe('SOURCE');
    expect(finding.flow.at(-1)!.kind).toBe('SINK');

    const bridge = createSqlCandidateBridge(async () => '46db4c208f886afda939c04ae93580fbabd57344');
    const hypotheses = await bridge(result, snapshot, ingestion, ORG);
    expect(hypotheses).toHaveLength(1);
    const { candidate, candidateBinding } = hypotheses[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);
  });

  it('negative control: safe constant passed through multi-stage pipeline yields no finding', async () => {
    const raw = replaceSource(input(), source => source.replace('function searchRoute',
      `function stageThree(term: string) {
  return term;
}
function stageTwo(mid: string) {
  return stageThree(mid);
}
function stageOne(start: string) {
  return stageTwo(start);
}
function searchRoute`)
      .replace('return res.json',
        'const safeStaged = stageOne("safe-constant"); return res.json')
      .replace('" + req.query.q + "', '" + safeStaged + "'));

    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toEqual([]);
  });

  it('negative control: disconnected multi-stage invocation leaves sink untainted', async () => {
    const raw = replaceSource(input(), source => source.replace('function searchRoute',
      `function stageThree(term: string) {
  return term;
}
function stageTwo(mid: string) {
  return stageThree(mid);
}
function stageOne(start: string) {
  return stageTwo(start);
}
function searchRoute`)
      .replace('return res.json',
        'const unused = stageOne(req.query.q); const cleanVal = "safe"; return res.json')
      .replace('" + req.query.q + "', '" + cleanVal + "'));

    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toHaveLength(0);
  });

  it('fails closed when multi-stage pipeline contains mutual call cycles', async () => {
    const raw = replaceSource(input(), source => source.replace('function searchRoute',
      `function stageB(b: string): string {
  return stageA(b);
}
function stageA(a: string): string {
  return stageB(a);
}
function searchRoute`)
      .replace('return res.json',
        'const cyclic = stageA(req.query.q); return res.json')
      .replace('" + req.query.q + "', '" + cyclic + "'));

    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('CALL_CYCLE');
  });

  it('multi-stage nested analysis is deterministic across repeated runs', async () => {
    const raw = replaceSource(input(), source => source.replace('function searchRoute',
      `function stageThree(term: string) {
  return term;
}
function stageTwo(mid: string) {
  return stageThree(mid);
}
function stageOne(start: string) {
  return stageTwo(start);
}
function searchRoute`)
      .replace('return res.json',
        'const staged = stageOne(req.query.q); return res.json')
      .replace('" + req.query.q + "', '" + staged + "'));

    const first = await analyzeInput(raw);
    const second = await analyzeInput(raw);
    expect(first.result.resultFingerprint).toBe(second.result.resultFingerprint);
    expect(first.result.findings[0].findingId).toBe(second.result.findings[0].findingId);
    expect(first.result.findings[0].flow).toEqual(second.result.findings[0].flow);
  });
});
