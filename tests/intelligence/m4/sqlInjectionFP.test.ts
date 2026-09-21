import { describe, expect, it, vi } from 'vitest';
import { validateSqlAnalysis } from '../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../worker/intelligence/detection/candidate';
import { analyzeInput, input, replaceSource, ORG } from '../m3/support/inputs';

describe('M4 SQL injection false-positive rejection for constant strings', () => {
  it('rejects constant SQL string literal as false positive', async () => {
    const raw = replaceSource(input(), content => content.replace('" + req.query.q + "', 'static-query'));
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
    expect(await validateSqlAnalysis(result, snapshot, ingestion, ORG)).toEqual(result);
  });

  it('rejects concatenation of multiple constant string literals', async () => {
    const raw = replaceSource(input(), content => content.replace('" + req.query.q + "', '" + "static" + "'));
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
    expect(await validateSqlAnalysis(result, snapshot, ingestion, ORG)).toEqual(result);
  });

  it('rejects constant string variable alias chains', async () => {
    const raw = replaceSource(input(), content => content.replace('return res.json',
      'const a = "constant-val"; const b = a; const c = b; return res.json')
      .replace('" + req.query.q + "', '" + c + "'));
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
    expect(await validateSqlAnalysis(result, snapshot, ingestion, ORG)).toEqual(result);
  });

  it('rejects constant query when untrusted request query is read into an unused variable', async () => {
    const raw = replaceSource(input(), content => content.replace('return res.json',
      'const unused = req.query.q; return res.json')
      .replace('" + req.query.q + "', 'static-query'));
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
    expect(await validateSqlAnalysis(result, snapshot, ingestion, ORG)).toEqual(result);
  });

  it('creates no candidate hypotheses and invokes no commit verifier when SQL is a constant string', async () => {
    const raw = replaceSource(input(), content => content.replace('" + req.query.q + "', 'static-query'));
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    const verify = vi.fn();
    const candidates = await createSqlCandidateBridge(verify)(result, snapshot, ingestion, ORG);
    expect(candidates).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  });
});
