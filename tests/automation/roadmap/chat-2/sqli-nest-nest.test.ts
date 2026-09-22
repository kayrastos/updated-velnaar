import { describe, expect, it } from 'vitest';
import { computeCandidateBinding, validateFindingCandidate } from '../../../../worker/intelligence/contracts';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

describe('Chat-2 roadmap: nested-flow nested helper calls (RM_SQLI_NEST_NEST)', () => {
  it('detects nested helper calls in baseline fixture 5', async () => {
    const run = await analyzeInput(input(5));
    expect(run.result.status).toBe('DETECTED');
    expect(run.result.findings).toHaveLength(1);
    const flow = run.result.findings[0].flow;
    expect(flow.filter(step => step.kind === 'CALL').map(step => step.location.symbol)).toEqual(['lookup', 'buildQuery']);
    expect(flow.filter(step => step.kind === 'ARGUMENT')).toHaveLength(2);
    expect(flow.some(step => step.kind === 'RETURN')).toBe(true);
  });

  it('detects SQL injection through a multi-level nested helper chain (outer -> middle -> leaf)', async () => {
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute',
        'function stepThree(v: string) { return v; }\n' +
        'function stepTwo(v: string) { return stepThree(v); }\n' +
        'function stepOne(v: string) { return stepTwo(v); }\n' +
        'function searchRoute')
      .replace('return res.json',
        'const taintedVal = stepOne(req.query.q); return res.json')
      .replace('" + req.query.q + "', '" + taintedVal + "')
    );
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('DETECTED');
    expect(run.result.findings).toHaveLength(1);
    const finding = run.result.findings[0];
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.symbol).toBe('db.prepare');
    const calls = finding.flow.filter(step => step.kind === 'CALL').map(step => step.location.symbol);
    expect(calls).toEqual(['stepOne', 'stepTwo', 'stepThree']);
    const args = finding.flow.filter(step => step.kind === 'ARGUMENT');
    expect(args).toHaveLength(3);
    const returns = finding.flow.filter(step => step.kind === 'RETURN');
    expect(returns).toHaveLength(3);
    expect(finding.flow[0].kind).toBe('SOURCE');
    expect(finding.flow.at(-1)!.kind).toBe('SINK');
  });

  it('negative control: nested helper returning clean constant does not taint query', async () => {
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute',
        'function innerSafe(v: string) { return "constant_filter"; }\n' +
        'function outerSafe(v: string) { return innerSafe(v); }\n' +
        'function searchRoute')
      .replace('return res.json',
        'const safeVal = outerSafe(req.query.q); return res.json')
      .replace('" + req.query.q + "', '" + safeVal + "')
    );
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('NOT_DETECTED');
    expect(run.result.findings).toHaveLength(0);
    expect(run.result.limitations).toHaveLength(0);
  });

  it('negative control: disconnected nested helper does not produce a finding', async () => {
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute',
        'function innerLeaf(v: string) { return v; }\n' +
        'function outerWrapper(v: string) { return innerLeaf(v); }\n' +
        'function searchRoute')
      .replace('return res.json',
        'outerWrapper("constant_value"); return res.json')
      .replace('" + req.query.q + "', 'safe')
    );
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('NOT_DETECTED');
    expect(run.result.findings).toHaveLength(0);
  });

  it('bounds mutually recursive nested helper calls via CALL_CYCLE limitation', async () => {
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute',
        'function cycleA(v: string) { return cycleB(v); }\n' +
        'function cycleB(v: string) { return cycleA(v); }\n' +
        'function searchRoute')
      .replace('return res.json',
        'cycleA(req.query.q); return res.json')
    );
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toHaveLength(0);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('CALL_CYCLE');
  });

  it('bounds excessive call depth in nested chains via CALL_DEPTH limitation', async () => {
    const helpers = Array.from({ length: 18 }, (_, i) =>
      `function deep${i}(v: string) { return ${i === 17 ? 'v' : `deep${i + 1}(v)`}; }`
    ).join('\n');
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute', helpers + '\nfunction searchRoute')
      .replace('return res.json', 'deep0(req.query.q); return res.json')
    );
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toHaveLength(0);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('CALL_DEPTH');
  });

  it('bridges nested-flow finding to valid FindingCandidate in CANDIDATE state', async () => {
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute',
        'function leafHelper(v: string) { return v; }\n' +
        'function midHelper(v: string) { return leafHelper(v); }\n' +
        'function topHelper(v: string) { return midHelper(v); }\n' +
        'function searchRoute')
      .replace('return res.json',
        'const tainted = topHelper(req.query.q); return res.json')
      .replace('" + req.query.q + "', '" + tainted + "')
    );
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('DETECTED');
    const dummyCommit = 'c'.repeat(40);
    const bridge = createSqlCandidateBridge(async () => dummyCommit);
    const hypotheses = await bridge(run.result, run.snapshot, run.ingestion, ORG);
    expect(hypotheses).toHaveLength(1);
    const { candidate, candidateBinding } = hypotheses[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.organizationId).toBe(ORG);
    expect(candidate.snapshot.commitSha).toBe(dummyCommit);
    expect(candidate.source.symbol).toBe('query.q');
    expect(candidate.sink.symbol).toBe('db.prepare');
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);
  });
});
