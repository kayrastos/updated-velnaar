import { describe, expect, it, vi } from 'vitest';
import { createSqlCandidateBridge } from '../../../worker/intelligence/detection/candidate';
import { analyzeInput, input, replaceSource, ORG } from '../m3/support/inputs';

describe('M4 negative controls: non-propagating methods and taint isolation', () => {
  it.each([1, 3, 4])('baseline negative catalog fixture index %i yields NOT_DETECTED and zero findings', async index => {
    const { result } = await analyzeInput(input(index));
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
  });

  it('helper returning safe constant does not transfer taint to sink', async () => {
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute', 'function sanitize(val: string) { return "safe"; }\nfunction searchRoute')
      .replace('return res.json', 'const safeVar = sanitize(req.query.q); return res.json')
      .replace('" + req.query.q + "', '" + safeVar + "'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
  });

  it('multi-parameter helper returning untainted argument does not transfer taint', async () => {
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute', 'function selectQuery(tainted: string, safe: string) { return safe; }\nfunction searchRoute')
      .replace('return res.json', 'const safeVar = selectQuery(req.query.q, "safe"); return res.json')
      .replace('" + req.query.q + "', '" + safeVar + "'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
  });

  it('helper called for side-effects does not leak taint to subsequent statements', async () => {
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute', 'function audit(val: string) { const copy = val; }\nfunction searchRoute')
      .replace('return res.json', 'audit(req.query.q); const safeVar = "safe"; return res.json')
      .replace('" + req.query.q + "', '" + safeVar + "'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
  });

  it('multiple invocations of an identity helper keep safe calls isolated from tainted calls', async () => {
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute', 'function passthrough(val: string) { return val; }\nfunction searchRoute')
      .replace('return res.json', 'const safeVar = passthrough("safe"); const taintedVar = passthrough(req.query.q); return res.json')
      .replace('" + req.query.q + "', '" + safeVar + "'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
  });

  it('unrelated local exec function does not establish sink authority', async () => {
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute', 'function exec(cmd: string) { return "safe"; }\nfunction searchRoute')
      .replace('return res.json', 'const safeVar = exec(req.query.q); return res.json')
      .replace('" + req.query.q + "', '" + safeVar + "'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
  });

  it('bound query parameters do not propagate taint to SQL construction sink', async () => {
    const { result } = await analyzeInput(input(4));
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
  });

  it('unsupported method call on tainted data fails closed as inconclusive without false findings', async () => {
    const raw = replaceSource(input(), source => source
      .replace('return res.json', 'const x = req.query.q.trim(); return res.json'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('UNSUPPORTED_EXPRESSION');
  });

  it('unbound identifier fails closed as inconclusive without false findings', async () => {
    const raw = replaceSource(input(), source => source
      .replace('return res.json', 'const x = unknownMethod(req.query.q); return res.json'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('UNBOUND_NAME');
  });

  it('candidate bridge creates no hypotheses for negative controls or inconclusive runs', async () => {
    const verify = vi.fn();
    const bridge = createSqlCandidateBridge(verify);

    const safeRaw = replaceSource(input(), source => source
      .replace('function searchRoute', 'function sanitize(val: string) { return "safe"; }\nfunction searchRoute')
      .replace('return res.json', 'const safeVar = sanitize(req.query.q); return res.json')
      .replace('" + req.query.q + "', '" + safeVar + "'));
    const safeRun = await analyzeInput(safeRaw);
    expect(safeRun.result.status).toBe('NOT_DETECTED');
    expect(await bridge(safeRun.result, safeRun.snapshot, safeRun.ingestion, ORG)).toEqual([]);

    const inconclRaw = replaceSource(input(), source => source
      .replace('return res.json', 'const x = req.query.q.trim(); return res.json'));
    const inconclRun = await analyzeInput(inconclRaw);
    expect(inconclRun.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(await bridge(inconclRun.result, inconclRun.snapshot, inconclRun.ingestion, ORG)).toEqual([]);

    expect(verify).not.toHaveBeenCalled();
  });
});
