import { describe, expect, it } from 'vitest';
import { validateSqlAnalysis } from '../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../worker/intelligence/detection/candidate';
import { analyzeInput, input, replaceSource, ORG } from '../m3/support/inputs';

describe('M4 parser destructuring fail-closed coverage', () => {
  it.each([
    ['object destructuring pattern', 'const { q } = req.query; const query = q'],
    ['aliased object destructuring', 'const { q: alias } = req.query; const query = alias'],
    ['default value destructuring', 'const { q = "" } = req.query; const query = q'],
    ['array destructuring pattern', 'const [query] = [req.query.q]'],
    ['nested object destructuring', 'const { data: { q } } = { data: req.query }; const query = q'],
  ])('variable %s is inconclusive with UNSUPPORTED_STATEMENT', async (_label, statement) => {
    const raw = replaceSource(input(), source => source.replace('return res.json', `${statement}; return res.json`));
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('UNSUPPORTED_STATEMENT');

    const validated = await validateSqlAnalysis(run.result, run.snapshot, run.ingestion, ORG);
    expect(validated.status).toBe('ANALYSIS_INCONCLUSIVE');

    const bridge = createSqlCandidateBridge(async () => 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    const candidates = await bridge(run.result, run.snapshot, run.ingestion, ORG);
    expect(candidates).toEqual([]);
  });

  it('parameter object destructuring in handler is inconclusive with UNSUPPORTED_FUNCTION', async () => {
    const raw = replaceSource(input(), source => source.replace(
      'function searchRoute(req: any, res: any)',
      'function searchRoute({ query }: any, res: any)',
    ));
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('UNSUPPORTED_FUNCTION');

    const validated = await validateSqlAnalysis(run.result, run.snapshot, run.ingestion, ORG);
    expect(validated.status).toBe('ANALYSIS_INCONCLUSIVE');
  });

  it('unsupported destructuring suppresses downstream sink findings', async () => {
    const raw = replaceSource(input(), source => source.replace(
      'return res.json',
      'const { q } = req.query; db.prepare(req.query.q).all(); return res.json',
    ));
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('UNSUPPORTED_STATEMENT');
  });
});
