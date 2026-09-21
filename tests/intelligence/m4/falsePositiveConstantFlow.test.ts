import { describe, expect, it, vi } from 'vitest';
import { createSqlCandidateBridge } from '../../../worker/intelligence/detection/candidate';
import { validateSqlAnalysis } from '../../../worker/intelligence/detection/sqlInjection';
import { analyzeInput, input, replaceSource, ORG } from '../m3/support/inputs';

describe('M4 false positive control: constant flow rejection', () => {
  it('rejects direct string literal query as a finding', async () => {
    const raw = replaceSource(input(), source =>
      source.replace('" + req.query.q + "', '" + "safe_constant_literal" + "')
    );
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);

    const validated = await validateSqlAnalysis(result, snapshot, ingestion, ORG);
    expect(validated).toEqual(result);

    const verify = vi.fn();
    const bridge = createSqlCandidateBridge(verify);
    const candidates = await bridge(result, snapshot, ingestion, ORG);
    expect(candidates).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  });

  it('rejects constant concatenation across binary plus operations', async () => {
    const raw = replaceSource(input(), source =>
      source.replace('return res.json',
        'const prefix = "SELECT * "; const mid = "FROM items "; const suffix = "WHERE active = 1"; const query = prefix + mid + suffix; return res.json')
        .replace('" + req.query.q + "', '" + query + "')
    );
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);

    const verify = vi.fn();
    const bridge = createSqlCandidateBridge(verify);
    expect(await bridge(result, snapshot, ingestion, ORG)).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  });

  it('rejects constant alias chains when no taint is introduced', async () => {
    const raw = replaceSource(input(), source =>
      source.replace('return res.json',
        'const c1 = "constant_value"; const c2 = c1; const c3 = c2; return res.json')
        .replace('" + req.query.q + "', '" + c3 + "')
    );
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);

    const verify = vi.fn();
    const bridge = createSqlCandidateBridge(verify);
    expect(await bridge(result, snapshot, ingestion, ORG)).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  });

  it('rejects constant flows returned from local helper functions', async () => {
    const raw = replaceSource(input(), source =>
      source.replace('function searchRoute',
        'function buildSafeQuery() { const s = "SELECT * FROM items"; return s; } function searchRoute')
        .replace('return res.json',
          'const q = buildSafeQuery(); return res.json')
        .replace('" + req.query.q + "', '" + q + "')
    );
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);

    const verify = vi.fn();
    const bridge = createSqlCandidateBridge(verify);
    expect(await bridge(result, snapshot, ingestion, ORG)).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  });

  it('does not flag constant queries when untrusted request fields are read but unreferenced', async () => {
    const raw = replaceSource(input(), source =>
      source.replace('return res.json',
        'const unused = req.query.q; return res.json')
        .replace('" + req.query.q + "', '" + "fixed_literal" + "')
    );
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);

    const verify = vi.fn();
    const bridge = createSqlCandidateBridge(verify);
    expect(await bridge(result, snapshot, ingestion, ORG)).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  });

  it('treats unrelated local functions named exec as safe negative controls', async () => {
    const raw = replaceSource(input(), source =>
      source.replace('function searchRoute',
        'function exec(statement: string) { return statement; } function searchRoute')
        .replace('return res.json',
          'const safeCmd = exec("SELECT 1"); return res.json')
        .replace('" + req.query.q + "', '" + safeCmd + "')
    );
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);

    const verify = vi.fn();
    const bridge = createSqlCandidateBridge(verify);
    expect(await bridge(result, snapshot, ingestion, ORG)).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  });

  it('produces deterministic fingerprints across repeated constant-flow analyses', async () => {
    const raw = replaceSource(input(), source =>
      source.replace('" + req.query.q + "', '" + "deterministic_constant" + "')
    );
    const runA = await analyzeInput(raw);
    const runB = await analyzeInput(raw);
    expect(runA.result.status).toBe('NOT_DETECTED');
    expect(runA.result.findings).toEqual([]);
    expect(runA.result.resultFingerprint).toBe(runB.result.resultFingerprint);
    expect(runA.result).toEqual(runB.result);
  });

  it('rejects forged finding injection into a constant flow analysis result', async () => {
    const raw = replaceSource(input(), source =>
      source.replace('" + req.query.q + "', '" + "constant_base" + "')
    );
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    const forged = structuredClone(result) as any;
    forged.status = 'DETECTED';
    await expect(validateSqlAnalysis(forged, snapshot, ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY');
  });
});
