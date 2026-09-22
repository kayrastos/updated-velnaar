import { describe, expect, it, vi } from 'vitest';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

describe('RM_SQLI_PART_DIR: SQL injection detector partial-input fail-closed on direct routes', () => {
  it('baseline direct request concatenation produces a verified single finding', async () => {
    const run = await analyzeInput(input(0));
    expect(run.result.status).toBe('DETECTED');
    expect(run.result.findings).toHaveLength(1);
    expect(run.result.limitations).toEqual([]);
    const finding = run.result.findings[0];
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.symbol).toBe('db.prepare');
    expect(finding.flow[0].kind).toBe('SOURCE');
    expect(finding.flow.at(-1)!.kind).toBe('SINK');
    const validated = await validateSqlAnalysis(run.result, run.snapshot, run.ingestion, ORG);
    expect(validated.status).toBe('DETECTED');
  });

  it.each([
    ['body property', 'req.body.q', 'UNSUPPORTED_EXPRESSION'],
    ['params property', 'req.params.q', 'UNSUPPORTED_EXPRESSION'],
    ['headers property', 'req.headers.q', 'UNSUPPORTED_EXPRESSION'],
    ['bracket access', 'req.query["q"]', 'UNSUPPORTED_EXPRESSION'],
    ['nested property access', 'req.query.q.nested', 'UNSUPPORTED_EXPRESSION'],
    ['method invocation', 'req.query.q.trim()', 'UNSUPPORTED_EXPRESSION'],
    ['slice method invocation', 'req.query.q.slice(1)', 'UNSUPPORTED_EXPRESSION'],
  ])('fails closed as inconclusive when direct input uses %s (%s)', async (_name, snippet, code) => {
    const raw = replaceSource(input(0), source => source.replace('req.query.q', snippet));
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe(code);
    const validated = await validateSqlAnalysis(run.result, run.snapshot, run.ingestion, ORG);
    expect(validated.status).toBe('ANALYSIS_INCONCLUSIVE');
  });

  it('fails closed when direct input is joined with multiple sources', async () => {
    const raw = replaceSource(input(0), source => source.replace('req.query.q', '(req.query.q + req.query.filter)'));
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('MULTIPLE_SOURCES');
  });

  it('discards partial detections when subsequent direct route syntax is unsupported', async () => {
    const raw = replaceSource(input(0), source => source.replace('return res.json', 'const rows = res.json')
      .replace(').all());', ').all()); while (true) {} return rows;'));
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('UNSUPPORTED_STATEMENT');
  });

  it('inconclusive partial input creates no candidate hypotheses and invokes no commit verification', async () => {
    const raw = replaceSource(input(0), source => source.replace('req.query.q', 'req.body.q'));
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    const verifyCommit = vi.fn();
    const bridge = createSqlCandidateBridge(verifyCommit);
    const candidates = await bridge(run.result, run.snapshot, run.ingestion, ORG);
    expect(candidates).toEqual([]);
    expect(verifyCommit).not.toHaveBeenCalled();
  });
});
