import { describe, expect, it, vi } from 'vitest';
import { detectSqlInjection, validateSqlAnalysis } from '../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../worker/intelligence/detection/candidate';
import { analyzeInput, input, replaceSource, ORG } from '../m3/support/inputs';

describe('M4 false positive control: safe literal rejection', () => {
  it('rejects direct safe string literal as a candidate finding', async () => {
    const raw = replaceSource(input(), source => source.replace('req.query.q', '"safe-literal-constant"'));
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
    const validated = await validateSqlAnalysis(result, snapshot, ingestion, ORG);
    expect(validated.status).toBe('NOT_DETECTED');
    expect(validated.findings).toHaveLength(0);
  });

  it('rejects concatenation of safe string literals without taint flow', async () => {
    const raw = replaceSource(input(), source => source.replace('req.query.q', '"prefix_" + "safe_suffix"'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
  });

  it('rejects multi-step literal concatenation', async () => {
    const raw = replaceSource(input(), source => source.replace('req.query.q', '"a" + "b" + "c"'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
  });

  it('rejects alias chain of constant safe literals', async () => {
    const raw = replaceSource(input(), source => source.replace('return res.json',
      'const a = "safe_val"; const b = a; const c = b; return res.json')
      .replace('req.query.q', 'c'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
  });

  it('safe literal analysis produces no candidate and never invokes commit verification', async () => {
    const raw = replaceSource(input(), source => source.replace('req.query.q', '"safe_literal"'));
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    const verify = vi.fn();
    const bridge = createSqlCandidateBridge(verify);
    const candidates = await bridge(result, snapshot, ingestion, ORG);
    expect(candidates).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  });

  it.each([1, 3, 4])('built-in safe negative control fixture index %i produces NOT_DETECTED and no candidate', async index => {
    const run = await analyzeInput(input(index));
    expect(run.result.status).toBe('NOT_DETECTED');
    expect(run.result.findings).toHaveLength(0);
    const verify = vi.fn();
    const candidates = await createSqlCandidateBridge(verify)(run.result, run.snapshot, run.ingestion, ORG);
    expect(candidates).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  });
});
