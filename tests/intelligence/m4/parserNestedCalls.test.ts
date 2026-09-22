import { describe, expect, it } from 'vitest';
import { createSqlCandidateBridge } from '../../../worker/intelligence/detection/candidate';
import { computeCandidateBinding } from '../../../worker/intelligence/contracts';
import { analyzeInput, input, replaceSource, ORG } from '../m3/support/inputs';

describe('M4 parser nested call syntax coverage', () => {
  it('detects taint propagation through interprocedural nested helper calls', async () => {
    const helpers =
      'function stepOne(val: string) { return val; }\n' +
      'function stepTwo(val: string) { return stepOne(val); }';
    const raw = replaceSource(input(), source =>
      source.replace('function searchRoute', helpers + '\nfunction searchRoute')
        .replace('req.query.q', 'stepTwo(req.query.q)')
    );
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.symbol).toBe('db.prepare');
    const callSymbols = finding.flow.filter(s => s.kind === 'CALL').map(s => s.location.symbol);
    expect(callSymbols).toContain('stepTwo');
    expect(callSymbols).toContain('stepOne');
  });

  it('detects direct call expression nesting inside query construction argument', async () => {
    const helpers =
      'function innerWrap(val: string) { return val; }\n' +
      'function outerWrap(val: string) { return val; }';
    const raw = replaceSource(input(), source =>
      source.replace('function searchRoute', helpers + '\nfunction searchRoute')
        .replace('req.query.q', 'outerWrap(innerWrap(req.query.q))')
    );
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    const callSymbols = result.findings[0].flow.filter(s => s.kind === 'CALL').map(s => s.location.symbol);
    expect(callSymbols).toEqual(expect.arrayContaining(['innerWrap', 'outerWrap']));
  });

  it('detects deep three-level nested call expressions', async () => {
    const helpers =
      'function f1(v: string) { return v; }\n' +
      'function f2(v: string) { return v; }\n' +
      'function f3(v: string) { return v; }';
    const raw = replaceSource(input(), source =>
      source.replace('function searchRoute', helpers + '\nfunction searchRoute')
        .replace('req.query.q', 'f3(f2(f1(req.query.q)))')
    );
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    const callSymbols = result.findings[0].flow.filter(s => s.kind === 'CALL').map(s => s.location.symbol);
    expect(callSymbols).toEqual(expect.arrayContaining(['f1', 'f2', 'f3']));
  });

  it('safe constant argument passed to nested calls produces no finding', async () => {
    const helpers =
      'function innerSafe(val: string) { return val; }\n' +
      'function outerSafe(val: string) { return innerSafe(val); }';
    const raw = replaceSource(input(), source =>
      source.replace('function searchRoute', helpers + '\nfunction searchRoute')
        .replace('req.query.q', 'outerSafe("safe-constant")')
    );
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
  });

  it('nested call returning un-tainted argument is a negative control', async () => {
    const helpers = 'function pickFirst(a: string, b: string) { return a; }';
    const raw = replaceSource(input(), source =>
      source.replace('function searchRoute', helpers + '\nfunction searchRoute')
        .replace('req.query.q', 'pickFirst("safe-value", req.query.q)')
    );
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
  });

  it('unbound nested function call fails closed as inconclusive', async () => {
    const raw = replaceSource(input(), source =>
      source.replace('req.query.q', 'unboundNested(req.query.q)')
    );
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('UNBOUND_NAME');
  });

  it('cyclic nested calls fail closed as inconclusive under call cycle budget', async () => {
    const helpers =
      'function loopA(v: string): string { return loopB(v); }\n' +
      'function loopB(v: string): string { return loopA(v); }';
    const raw = replaceSource(input(), source =>
      source.replace('function searchRoute', helpers + '\nfunction searchRoute')
        .replace('req.query.q', 'loopA(req.query.q)')
    );
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('CALL_CYCLE');
  });

  it('unsupported nested member call fails closed as inconclusive', async () => {
    const raw = replaceSource(input(), source =>
      source.replace('req.query.q', 'req.query.q.trim()')
    );
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('UNSUPPORTED_EXPRESSION');
  });

  it('multi-source join in nested call fails closed as inconclusive', async () => {
    const helpers = 'function joinValues(a: string, b: string) { return a + b; }';
    const raw = replaceSource(input(), source =>
      source.replace('function searchRoute', helpers + '\nfunction searchRoute')
        .replace('req.query.q', 'joinValues(req.query.q, req.query.other)')
    );
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('MULTIPLE_SOURCES');
  });

  it('candidate hypothesis bridge preserves CANDIDATE state and canonical binding for detected nested calls', async () => {
    const helpers = 'function passThrough(v: string) { return v; }';
    const raw = replaceSource(input(), source =>
      source.replace('function searchRoute', helpers + '\nfunction searchRoute')
        .replace('req.query.q', 'passThrough(req.query.q)')
    );
    const { result, snapshot, ingestion } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    const checkedCommit = '46db4c208f886afda939c04ae93580fbabd57344';
    const bridge = createSqlCandidateBridge(async () => checkedCommit);
    const candidates = await bridge(result, snapshot, ingestion, ORG);
    expect(candidates).toHaveLength(1);
    const { candidate, candidateBinding } = candidates[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.snapshot.commitSha).toBe(checkedCommit);
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
  });
});
