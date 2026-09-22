import { describe, expect, it } from 'vitest';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { computeCandidateBinding } from '../../../../worker/intelligence/contracts';
import { ANALYSIS_LIMITS } from '../../../../worker/intelligence/detection/types';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

describe('V1 discovery-intelligence SQLi detector adversarial multi-stage edge cases', () => {
  it('detects multi-stage variable alias chaining preserving full flow provenance', async () => {
    const raw = replaceSource(input(), content => content.replace('return res.json',
      'const s1 = req.query.q; const s2 = s1; const s3 = s2; const s4 = s3; return res.json')
      .replace('" + req.query.q + "', '" + s4 + "'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    const flow = result.findings[0].flow;
    expect(flow[0].kind).toBe('SOURCE');
    expect(flow.at(-1)!.kind).toBe('SINK');
    const variables = flow.filter(step => step.kind === 'VARIABLE').map(step => step.location.symbol);
    expect(variables).toEqual(['s1', 's2', 's3', 's4']);
  });

  it('detects multi-stage helper function invocation and argument return flow', async () => {
    const helpers = [
      'function stageOne(val1: string) { const step1 = val1; return step1; }',
      'function stageTwo(val2: string) { return stageOne(val2); }',
    ].join('\n');
    const raw = replaceSource(input(), content => content.replace('function searchRoute',
      helpers + '\nfunction searchRoute')
      .replace('return res.json', 'const sanitized = stageTwo(req.query.q); return res.json')
      .replace('" + req.query.q + "', '" + sanitized + "'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    const flow = result.findings[0].flow;
    const calls = flow.filter(step => step.kind === 'CALL').map(step => step.location.symbol);
    expect(calls).toEqual(['stageTwo', 'stageOne']);
    const returns = flow.filter(step => step.kind === 'RETURN');
    expect(returns).toHaveLength(2);
  });

  it('detects multi-stage query string concatenation and records all concat steps', async () => {
    const raw = replaceSource(input(), content => content.replace('return res.json',
      'const p1 = "prefix_" + req.query.q; const p2 = p1 + "_middle"; const p3 = p2 + "_suffix"; return res.json')
      .replace('" + req.query.q + "', '" + p3 + "'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    const concats = result.findings[0].flow.filter(step => step.kind === 'CONCAT');
    expect(concats.length).toBeGreaterThanOrEqual(3);
  });

  it('fails closed when multi-stage concatenation joins multiple tainted sources', async () => {
    const raw = replaceSource(input(), content => content.replace('return res.json',
      'const src1 = req.query.q; const src2 = req.query.other; const combined = src1 + src2; return res.json')
      .replace('" + req.query.q + "', '" + combined + "'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('MULTIPLE_SOURCES');
  });

  it('proves safe compile-time literal substitution across stages yields NOT_DETECTED', async () => {
    const raw = replaceSource(input(), content => content.replace('return res.json',
      'const tainted = req.query.q; const safeLiteral = "safe_constant"; return res.json')
      .replace('" + req.query.q + "', '" + safeLiteral + "'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
  });

  it('bounds multi-stage call depth within configured limits failing closed on exhaustion', async () => {
    const helpers = Array.from({ length: 20 }, (_, i) =>
      `function deep${i}(v: string) { return ${i === 19 ? 'v' : `deep${i + 1}(v)`}; }`
    ).join('\n');
    const raw = replaceSource(input(), content => content.replace('function searchRoute',
      helpers + '\nfunction searchRoute')
      .replace('return res.json', 'deep0(req.query.q); return res.json'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('CALL_DEPTH');
  });

  it('bounds multi-stage variable flow length within configured limits failing closed on exhaustion', async () => {
    const chain = ['const x0 = req.query.q', ...Array.from({ length: ANALYSIS_LIMITS.flowLength + 2 }, (_, i) => `const x${i + 1} = x${i}`)].join('; ');
    const raw = replaceSource(input(), content => content.replace('return res.json',
      chain + '; return res.json'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('FLOW_BUDGET');
  });

  it('preserves CANDIDATE verification state and exact canonical binding for multi-stage detection', async () => {
    const raw = replaceSource(input(), content => content.replace('return res.json',
      'const a = req.query.q; const b = a; return res.json')
      .replace('" + req.query.q + "', '" + b + "'));
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');

    const validSha = '1234567890abcdef1234567890abcdef12345678';
    const bridge = createSqlCandidateBridge(async () => validSha);
    const hypotheses = await bridge(result, snapshot, ingestion, ORG);

    expect(hypotheses).toHaveLength(1);
    const { candidate, candidateBinding } = hypotheses[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.snapshot.commitSha).toBe(validSha);
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(candidate.sensorEvidence[0].rawEvidenceFingerprint).toBe(result.resultFingerprint);
  });
});
