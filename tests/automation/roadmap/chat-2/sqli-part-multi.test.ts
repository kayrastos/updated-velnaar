import { describe, expect, it } from 'vitest';
import { validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

describe('V1 roadmap: SQL injection detector multi-stage partial input fail-closed', () => {
  it('detects SQL injection across valid multi-stage helper pipeline when all stages are supported', async () => {
    const helpers = [
      'function stageOne(val: string) { return val; }',
      'function stageTwo(val: string) { return stageOne(val); }',
      'function stageThree(val: string) { return stageTwo(val); }',
    ].join('\n');
    const raw = replaceSource(input(), source =>
      source
        .replace('function searchRoute', helpers + '\nfunction searchRoute')
        .replace('req.query.q', 'stageThree(req.query.q)')
    );
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('DETECTED');
    expect(run.result.findings).toHaveLength(1);
    expect(run.result.limitations).toEqual([]);
    expect(run.result.findings[0].vulnerabilityClass).toBe('SQL_INJECTION');
  });

  it('fails closed when an early stage in a multi-stage pipeline contains unsupported statement syntax', async () => {
    const helpers = [
      'function stageOne(val: string) { while (true) {} return val; }',
      'function stageTwo(val: string) { return stageOne(val); }',
      'function stageThree(val: string) { return stageTwo(val); }',
    ].join('\n');
    const raw = replaceSource(input(), source =>
      source
        .replace('function searchRoute', helpers + '\nfunction searchRoute')
        .replace('req.query.q', 'stageThree(req.query.q)')
    );
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('UNSUPPORTED_STATEMENT');
  });

  it('fails closed when an intermediate stage in a multi-stage pipeline uses unsupported expression syntax', async () => {
    const helpers = [
      'function stageOne(val: string) { return val; }',
      'function stageTwo(val: string) { const wrapped = `${val}`; return stageOne(wrapped); }',
      'function stageThree(val: string) { return stageTwo(val); }',
    ].join('\n');
    const raw = replaceSource(input(), source =>
      source
        .replace('function searchRoute', helpers + '\nfunction searchRoute')
        .replace('req.query.q', 'stageThree(req.query.q)')
    );
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('UNSUPPORTED_EXPRESSION');
  });

  it('purges earlier partial findings if a subsequent stage in multi-stage execution fails', async () => {
    const helpers = 'function stageFail(val: string) { while (true) {} return val; }';
    const raw = replaceSource(input(), source =>
      source
        .replace('function searchRoute', helpers + '\nfunction searchRoute')
        .replace('return res.json', 'const rows = res.json')
        .replace(').all());', ').all()); stageFail(req.query.q); return rows;')
    );
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('UNSUPPORTED_STATEMENT');
  });

  it('fails closed with MULTIPLE_SOURCES when multi-stage helper joins separate taint sources', async () => {
    const helpers = 'function stageJoin(a: string, b: string) { return a + b; }';
    const raw = replaceSource(input(), source =>
      source
        .replace('function searchRoute', helpers + '\nfunction searchRoute')
        .replace('req.query.q', 'stageJoin(req.query.q, req.query.other)')
    );
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('MULTIPLE_SOURCES');
  });

  it('fails closed when multi-stage helper call depth exceeds analysis budget', async () => {
    const helpers = Array.from(
      { length: 20 },
      (_, i) => 'function stage' + i + '(v: string) { return ' + (i === 19 ? 'v' : 'stage' + (i + 1) + '(v)') + '; }'
    ).join('\n');
    const raw = replaceSource(input(), source =>
      source
        .replace('function searchRoute', helpers + '\nfunction searchRoute')
        .replace('req.query.q', 'stage0(req.query.q)')
    );
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('CALL_DEPTH');
  });

  it('produces no candidate hypotheses through the candidate bridge when multi-stage analysis is inconclusive', async () => {
    const helpers = 'function stageOne(val: string) { while (true) {} return val; }';
    const raw = replaceSource(input(), source =>
      source
        .replace('function searchRoute', helpers + '\nfunction searchRoute')
        .replace('req.query.q', 'stageOne(req.query.q)')
    );
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');

    const dummyCommitVerifier = async () => '46db4c208f886afda939c04ae93580fbabd57344';
    const bridge = createSqlCandidateBridge(dummyCommitVerifier);
    const candidates = await bridge(run.result, run.snapshot, run.ingestion, ORG);
    expect(candidates).toEqual([]);
  });

  it('rejects forged analysis status attempting to bypass multi-stage fail-closed limitation', async () => {
    const helpers = 'function stageOne(val: string) { while (true) {} return val; }';
    const raw = replaceSource(input(), source =>
      source
        .replace('function searchRoute', helpers + '\nfunction searchRoute')
        .replace('req.query.q', 'stageOne(req.query.q)')
    );
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');

    const forged: any = structuredClone(run.result);
    forged.status = 'NOT_DETECTED';
    forged.limitations = [];
    await expect(validateSqlAnalysis(forged, run.snapshot, run.ingestion, ORG)).rejects.toThrow(
      'M3_ANALYSIS_INTEGRITY_MISMATCH'
    );
  });
});
