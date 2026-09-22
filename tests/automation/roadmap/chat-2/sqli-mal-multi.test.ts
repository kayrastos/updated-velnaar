import { describe, expect, it, vi } from 'vitest';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { ANALYSIS_LIMITS } from '../../../../worker/intelligence/detection/types';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

describe('Roadmap chat-2 SQL injection detector malformed-input multi-stage handling', () => {
  it('refuses multi-source joins in multi-stage taint flow and yields MULTIPLE_SOURCES', async () => {
    const raw = replaceSource(input(), source => source.replace('return res.json',
      'const s1 = req.query.q; const s2 = req.query.filter; const combined = s1 + s2; return res.json')
      .replace('" + req.query.q + "', '" + combined + "'));
    const { result, snapshot, ingestion } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('MULTIPLE_SOURCES');

    const verify = vi.fn();
    const candidates = await createSqlCandidateBridge(verify)(result, snapshot, ingestion, ORG);
    expect(candidates).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  });

  it('fails closed when intermediate stage uses unsupported method invocation', async () => {
    const raw = replaceSource(input(), source => source.replace('return res.json',
      'const s1 = req.query.q; const s2 = s1.trim(); return res.json')
      .replace('" + req.query.q + "', '" + s2 + "'));
    const { result, snapshot, ingestion } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('UNSUPPORTED_EXPRESSION');

    const verify = vi.fn();
    expect(await createSqlCandidateBridge(verify)(result, snapshot, ingestion, ORG)).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  });

  it('fails closed when multi-stage flow uses template literal interpolation', async () => {
    const raw = replaceSource(input(), source => source.replace('return res.json',
      'const s1 = req.query.q; const s2 = `${s1}`; return res.json')
      .replace('" + req.query.q + "', '" + s2 + "'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('UNSUPPORTED_EXPRESSION');
  });

  it('fails closed when intermediate stage uses mutable variable declaration', async () => {
    const raw = replaceSource(input(), source => source.replace('return res.json',
      'let s1 = req.query.q; const s2 = s1; return res.json')
      .replace('" + req.query.q + "', '" + s2 + "'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('UNSUPPORTED_STATEMENT');
  });

  it('fails closed when intermediate stage introduces duplicate variable binding', async () => {
    const raw = replaceSource(input(), source => source.replace('return res.json',
      'const s1 = req.query.q; const s1 = "other"; return res.json'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('DUPLICATE_BINDING');
  });

  it('fails closed when intermediate stage references an unbound identifier', async () => {
    const raw = replaceSource(input(), source => source.replace('return res.json',
      'const s1 = req.query.q; const s2 = unboundIdentifier; return res.json')
      .replace('" + req.query.q + "', '" + s2 + "'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('UNBOUND_NAME');
  });

  it('bounds multi-stage taint flow length to FLOW_BUDGET', async () => {
    const declarations = ['const x0 = req.query.q',
      ...Array.from({ length: ANALYSIS_LIMITS.flowLength + 1 }, (_, i) => `const x${i + 1} = x${i}`)].join('; ');
    const raw = replaceSource(input(), source => source.replace('return res.json',
      `${declarations}; return res.json`).replace('" + req.query.q + "', `" + x${ANALYSIS_LIMITS.flowLength + 1} + "`));
    const { result, snapshot, ingestion } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('FLOW_BUDGET');

    const verify = vi.fn();
    expect(await createSqlCandidateBridge(verify)(result, snapshot, ingestion, ORG)).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  });

  it('detects call cycles across multi-stage transformation helpers', async () => {
    const helpers = 'function stageOne(val: string) { return stageTwo(val); } function stageTwo(val: string) { return stageOne(val); }';
    const raw = replaceSource(input(), source => source.replace('function searchRoute', `${helpers} function searchRoute`)
      .replace('return res.json', 'const s = stageOne(req.query.q); return res.json')
      .replace('" + req.query.q + "', '" + s + "'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('CALL_CYCLE');
  });

  it('bounds multi-stage call chain depth independently of cycle detection', async () => {
    const helpers = Array.from({ length: 20 }, (_, i) => `function f${i}(v: string) { return ${i === 19 ? 'v' : `f${i + 1}(v)`}; }`).join('\n');
    const raw = replaceSource(input(), source => source.replace('function searchRoute', `${helpers}\nfunction searchRoute`)
      .replace('return res.json', 'const s = f0(req.query.q); return res.json')
      .replace('" + req.query.q + "', '" + s + "'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('CALL_DEPTH');
  });

  it('discards intermediate findings if subsequent reachable statement is unsupported', async () => {
    const raw = replaceSource(input(), source => source.replace('return res.json', 'const rows = res.json')
      .replace(').all());', ').all()); while (true) {} return rows;'));
    const { result, snapshot, ingestion } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);

    const verify = vi.fn();
    expect(await createSqlCandidateBridge(verify)(result, snapshot, ingestion, ORG)).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  });
});
