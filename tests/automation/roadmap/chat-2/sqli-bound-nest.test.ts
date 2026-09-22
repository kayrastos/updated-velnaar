import { describe, expect, it } from 'vitest';
import { ANALYSIS_LIMITS } from '../../../../worker/intelligence/detection/types';
import { analyzeInput, input, replaceSource } from '../../../intelligence/m3/support/inputs';

describe('M3 SQL injection nested boundary rejection', () => {
  it('rejects acyclic call depth exceeding the configured nested boundary', async () => {
    const depth = ANALYSIS_LIMITS.callDepth + 2;
    const helpers = Array.from(
      { length: depth },
      (_, i) => `function f${i}(v: string) { return ${i === depth - 1 ? 'v' : `f${i + 1}(v)`}; }`
    ).join('\n');
    const raw = replaceSource(input(), source =>
      source
        .replace('function searchRoute', helpers + '\nfunction searchRoute')
        .replace('return res.json', 'f0(req.query.q); return res.json')
    );
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('CALL_DEPTH');
  });

  it('rejects nested cyclic helper calls returning to an ancestor call frame', async () => {
    const helpers = [
      'function nestA(v: string) { return nestB(v); }',
      'function nestB(v: string) { return nestC(v); }',
      'function nestC(v: string) { return nestA(v); }',
    ].join('\n');
    const raw = replaceSource(input(), source =>
      source
        .replace('function searchRoute', helpers + '\nfunction searchRoute')
        .replace('return res.json', 'nestA(req.query.q); return res.json')
    );
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('CALL_CYCLE');
  });

  it('permits nested helper calls within call depth boundary to detect taint flow', async () => {
    const helpers = [
      'function f0(v: string) { return f1(v); }',
      'function f1(v: string) { return f2(v); }',
      'function f2(v: string) { return v; }',
    ].join('\n');
    const raw = replaceSource(input(), source =>
      source
        .replace('function searchRoute', helpers + '\nfunction searchRoute')
        .replace('" + req.query.q + "', '" + f0(req.query.q) + "')
    );
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('DETECTED');
    expect(run.result.findings).toHaveLength(1);
    expect(run.result.limitations).toEqual([]);
  });

  it('fails closed when cumulative calls in nested helper chains exceed call budget', async () => {
    const helpers = 'function leaf() {} function mid() { leaf(); leaf(); }';
    const calls = Array.from({ length: 65 }, () => 'mid();').join(' ');
    const raw = replaceSource(input(), source =>
      source
        .replace('function searchRoute', helpers + '\nfunction searchRoute')
        .replace('return res.json', `${calls} return res.json`)
    );
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('CALL_BUDGET');
  });

  it('rejects unsupported statements encountered within nested helper execution', async () => {
    const helpers = 'function helper(v: string) { while (true) {} return v; }';
    const raw = replaceSource(input(), source =>
      source
        .replace('function searchRoute', helpers + '\nfunction searchRoute')
        .replace('return res.json', 'helper(req.query.q); return res.json')
    );
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('UNSUPPORTED_STATEMENT');
  });

  it('rejects unbound identifiers inside nested helper scopes', async () => {
    const helpers = 'function helper(v: string) { return unresolvableSymbol; }';
    const raw = replaceSource(input(), source =>
      source
        .replace('function searchRoute', helpers + '\nfunction searchRoute')
        .replace('return res.json', 'helper(req.query.q); return res.json')
    );
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('UNBOUND_NAME');
  });

  it('rejects nested flow sequences exceeding the maximum flow length budget', async () => {
    const declarations = Array.from(
      { length: ANALYSIS_LIMITS.flowLength + 1 },
      (_, i) => `const v${i + 1} = v${i};`
    ).join('\n');
    const helpers = `function nestedFlow(v0: string) {\n${declarations}\nreturn v${ANALYSIS_LIMITS.flowLength + 1};\n}`;
    const raw = replaceSource(input(), source =>
      source
        .replace('function searchRoute', helpers + '\nfunction searchRoute')
        .replace('return res.json', 'nestedFlow(req.query.q); return res.json')
    );
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('FLOW_BUDGET');
  });
});
