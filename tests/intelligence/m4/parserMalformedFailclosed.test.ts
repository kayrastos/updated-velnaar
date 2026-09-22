import { describe, expect, it } from 'vitest';
import { parseUnit, ingestExpress } from '../../../worker/intelligence/ingestion/express';
import { captureSnapshot } from '../../../worker/intelligence/ingestion/snapshot';
import { analyzeInput, input, replaceSource, ORG } from '../m3/support/inputs';

describe('M4 parser malformed syntax fail-closed', () => {
  it.each([
    ['incomplete assignment', 'const x = ;'],
    ['unclosed block', 'function searchRoute() { const a = 1;'],
    ['malformed import', "import { from './service';"],
    ['unexpected keyword token', 'const const = 1;'],
    ['unterminated string literal', 'const msg = "unterminated;'],
    ['unclosed parameter list', 'function broken(req: any, res: any { return; }'],
    ['incomplete property access', 'const q = req.query.;'],
  ])('parseUnit fails closed on malformed TypeScript syntax: %s', (_label, brokenSnippet) => {
    expect(() => parseUnit('src/routes.ts', brokenSnippet)).toThrow('M2_INGESTION_ERROR: malformed source unit');
  });

  it.each([
    ['malformed function expression', 'function ( { return 1; }'],
    ['incomplete variable declaration', 'var = 123;'],
    ['unclosed parenthesis', 'if (true { console.log(1); }'],
  ])('parseUnit fails closed on malformed JavaScript syntax: %s', (_label, brokenSnippet) => {
    expect(() => parseUnit('src/routes.js', brokenSnippet)).toThrow('M2_INGESTION_ERROR: malformed source unit');
  });

  it('ingestExpress fails closed when a snapshot file contains malformed syntax', async () => {
    const raw = replaceSource(input(), () => 'const x = ; function searchRoute(');
    const snapshot = await captureSnapshot(raw, ORG);
    await expect(ingestExpress(snapshot, ORG)).rejects.toThrow('M2_INGESTION_ERROR: malformed source unit');
  });

  it('analyzeInput pipeline fails closed without producing findings or candidates on malformed syntax', async () => {
    const raw = replaceSource(input(), () => 'function malformed( { return res.json();');
    await expect(analyzeInput(raw)).rejects.toThrow('M2_INGESTION_ERROR: malformed source unit');
  });

  it('valid TypeScript and JavaScript source files parse successfully without diagnostics', () => {
    const tsUnit = parseUnit('src/valid.ts', 'export function ok(): void {}');
    expect(tsUnit).toBeDefined();
    expect(tsUnit.fileName).toBe('src/valid.ts');

    const jsUnit = parseUnit('src/valid.js', 'function ok() { return 1; }');
    expect(jsUnit).toBeDefined();
    expect(jsUnit.fileName).toBe('src/valid.js');
  });
});
