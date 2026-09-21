import { describe, expect, it } from 'vitest';
import { parseUnit } from '../../../worker/intelligence/ingestion/express';
import { analyzeInput, input, replaceSource } from '../m3/support/inputs';

describe('M4 parser optional-chaining coverage', () => {
  it('parses valid optional-chain property, element, and call syntax in TypeScript and JavaScript', () => {
    const tsUnit = parseUnit('src/sample.ts', 'const a = req?.query?.q; const b = obj?.[key]; const c = fn?.();');
    expect(tsUnit.fileName).toBe('src/sample.ts');
    expect((tsUnit as any).parseDiagnostics).toEqual([]);

    const jsUnit = parseUnit('src/sample.js', 'const x = a?.b?.c; const y = f?.(x);');
    expect(jsUnit.fileName).toBe('src/sample.js');
    expect((jsUnit as any).parseDiagnostics).toEqual([]);
  });

  it.each([
    'const a = b?. ;',
    'const a = b?..c;',
    'const a = b?.(;',
    'const a = b?.[;',
  ])('fails closed on malformed optional-chain syntax: %s', syntax => {
    expect(() => parseUnit('src/malformed.ts', syntax)).toThrow('M2_INGESTION_ERROR: malformed source unit');
  });

  it('detects tainted request flow using optional-chain property access', async () => {
    const raw = replaceSource(input(), source => source.replace('req.query.q', 'req?.query?.q'));
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('DETECTED');
    expect(run.result.findings).toHaveLength(1);
    expect(run.result.findings[0].source.symbol).toBe('query.q');
    expect(run.result.findings[0].sink.symbol).toBe('db.prepare');
  });

  it('detects tainted flow when optional chaining is on query property access', async () => {
    const raw = replaceSource(input(), source => source.replace('req.query.q', 'req.query?.q'));
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('DETECTED');
    expect(run.result.findings).toHaveLength(1);
    expect(run.result.findings[0].source.symbol).toBe('query.q');
  });

  it('fails closed as inconclusive when optional-chain element access is used', async () => {
    const raw = replaceSource(input(), source => source.replace('return res.json', 'const x = req?.query?.["q"]; return res.json'));
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('UNSUPPORTED_EXPRESSION');
  });

  it('fails closed as inconclusive when unsupported optional-chain method call is used', async () => {
    const raw = replaceSource(input(), source => source.replace('return res.json', 'const x = req.query.q?.trim(); return res.json'));
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('UNSUPPORTED_EXPRESSION');
  });
});
