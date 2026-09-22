import { describe, expect, it } from 'vitest';
import { computeCandidateBinding } from '../../../../worker/intelligence/contracts';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

const NESTED_HELPERS = `
function innerBuild(val: string) {
  const unwrapped = val;
  return unwrapped;
}
function middleHop(param: string) {
  const intermediate = param;
  return innerBuild(intermediate);
}
function outerHop(raw: string) {
  const stepOne = raw;
  return middleHop(stepOne);
}
`;

describe('roadmap automation: SQL injection detector nested multi-hop flows', () => {
  it('detects SQL injection through a nested multi-hop helper call hierarchy', async () => {
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute', NESTED_HELPERS + '\nfunction searchRoute')
      .replace('" + req.query.q + "', '" + outerHop(req.query.q) + "'));
    const { result } = await analyzeInput(raw);

    expect(result.status).toBe('DETECTED');
    expect(result.limitations).toEqual([]);
    expect(result.findings).toHaveLength(1);

    const finding = result.findings[0];
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.symbol).toBe('db.prepare');

    const kinds = finding.flow.map(step => step.kind);
    expect(kinds[0]).toBe('SOURCE');
    expect(kinds.at(-1)).toBe('SINK');

    expect(finding.flow.filter(s => s.kind === 'CALL').map(s => s.location.symbol)).toEqual([
      'outerHop', 'middleHop', 'innerBuild',
    ]);
    expect(finding.flow.filter(s => s.kind === 'ARGUMENT').map(s => s.location.symbol)).toEqual([
      'raw', 'param', 'val',
    ]);
    expect(finding.flow.filter(s => s.kind === 'VARIABLE').map(s => s.location.symbol)).toEqual([
      'stepOne', 'intermediate', 'unwrapped',
    ]);
    expect(finding.flow.filter(s => s.kind === 'RETURN')).toHaveLength(3);
    expect(finding.flow.some(s => s.kind === 'CONCAT')).toBe(true);

    const stepIds = finding.flow.map(s => s.id);
    expect(new Set(stepIds).size).toBe(finding.flow.length);
  });

  it('does not detect finding when nested helper returns an untainted constant', async () => {
    const safeHelpers = `
function innerBuild(val: string) {
  return "safe_constant";
}
function middleHop(param: string) {
  const intermediate = param;
  return innerBuild(intermediate);
}
function outerHop(raw: string) {
  const stepOne = raw;
  return middleHop(stepOne);
}
`;
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute', safeHelpers + '\nfunction searchRoute')
      .replace('" + req.query.q + "', '" + outerHop(req.query.q) + "'));
    const { result } = await analyzeInput(raw);

    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toHaveLength(0);
  });

  it('does not detect finding when tainted nested helper result is disconnected from sink', async () => {
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute', NESTED_HELPERS + '\nfunction searchRoute')
      .replace('return res.json', 'const unused = outerHop(req.query.q); return res.json')
      .replace('" + req.query.q + "', 'static_query_value'));
    const { result } = await analyzeInput(raw);

    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toHaveLength(0);
  });

  it('fails closed with CALL_CYCLE when nested helper calls are mutually recursive', async () => {
    const cycleHelpers = `
function cycleA(x: string): string { return cycleB(x); }
function cycleB(x: string): string { return cycleA(x);
}
`;
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute', cycleHelpers + '\nfunction searchRoute')
      .replace('" + req.query.q + "', '" + cycleA(req.query.q) + "'));
    const { result } = await analyzeInput(raw);

    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('CALL_CYCLE');
  });

  it('fails closed with CALL_DEPTH when nested helper call depth exceeds budget', async () => {
    const helpers = Array.from({ length: 20 }, (_, i) =>
      `function deep${i}(v: string): string { return ${i === 19 ? 'v' : `deep${i + 1}(v)`}; }`
    ).join('\n');
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute', helpers + '\nfunction searchRoute')
      .replace('" + req.query.q + "', '" + deep0(req.query.q) + "'));
    const { result } = await analyzeInput(raw);

    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('CALL_DEPTH');
  });

  it('produces an exact-bound CANDIDATE hypothesis preserving non-authoritative verificationState', async () => {
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute', NEED_HELPERS_PLACEHOLDER => NESTED_HELPERS + '\nfunction searchRoute')
      .replace('" + req.query.q + "', '" + outerHop(req.query.q) + "'));
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');

    const commitSha = 'b'.repeat(40);
    const bridge = createSqlCandidateBridge(async () => commitSha);
    const candidates = await bridge(result, snapshot, ingestion, ORG);

    expect(candidates).toHaveLength(1);
    const { candidate, candidateBinding } = candidates[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.snapshot.commitSha).toBe(commitSha);
    expect(candidate.source.symbol).toBe('query.q');
    expect(candidate.sink.symbol).toBe('db.prepare');
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));

    await expect(bridge(result, snapshot, ingestion, 'foreign_org')).rejects.toThrow('tenant mismatch');
  });

  it('produces deterministic finding fingerprints across repeated analyses', async () => {
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute', NESTED_HELPERS + '\nfunction searchRoute')
      .replace('" + req.query.q + "', '" + outerHop(req.query.q) + "'));
    const first = await analyzeInput(raw);
    const second = await analyzeInput(raw);

    expect(first.result.resultFingerprint).toBe(second.result.resultFingerprint);
    expect(first.result.findings[0].findingId).toBe(second.result.findings[0].findingId);
  });
});
