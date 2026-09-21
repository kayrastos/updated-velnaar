import { describe, expect, it, vi } from 'vitest';
import { createSqlCandidateBridge } from '../../../worker/intelligence/detection/candidate';
import { validateSqlAnalysis } from '../../../worker/intelligence/detection/sqlInjection';
import { captureSnapshot } from '../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress } from '../../../worker/intelligence/ingestion/express';
import { analyzeInput, input, replaceSource, ORG } from '../m3/support/inputs';

async function verifyUnsupported(insertion: string, expectedCode?: string) {
  const raw = replaceSource(input(), source => source.replace('return res.json', insertion + '; return res.json'));
  const run = await analyzeInput(raw);
  expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
  expect(run.result.findings).toEqual([]);
  expect(run.result.limitations).toHaveLength(1);
  if (expectedCode) {
    expect(run.result.limitations[0].code).toBe(expectedCode);
  }
  return run;
}

describe('M4 fail-closed behavior for unsupported AST nodes and syntax', () => {
  it.each([
    ['let variable', 'let val = req.query.q', 'UNSUPPORTED_STATEMENT'],
    ['var variable', 'var val = req.query.q', 'UNSUPPORTED_STATEMENT'],
    ['destructuring', 'const { q } = req.query', 'UNSUPPORTED_STATEMENT'],
    ['if statement', 'if (req.query.q) {}', 'UNSUPPORTED_STATEMENT'],
    ['while loop', 'while (false) {}', 'UNSUPPORTED_STATEMENT'],
    ['for loop', 'for (let i = 0; i < 1; i++) {}', 'UNSUPPORTED_STATEMENT'],
    ['switch statement', 'switch (req.query.q) { default: break; }', 'UNSUPPORTED_STATEMENT'],
    ['try catch', 'try {} catch (e) {}', 'UNSUPPORTED_STATEMENT'],
    ['throw statement', 'throw new Error("stop")', 'UNSUPPORTED_STATEMENT'],
  ])('unsupported statement fails closed with limitation: %s', async (_label, snippet, code) => {
    await verifyUnsupported(snippet, code);
  });

  it.each([
    ['element access', 'const val = req.query["q"]', 'UNSUPPORTED_EXPRESSION'],
    ['template literal substitution', 'const val = `user: ${req.query.q}`', 'UNSUPPORTED_EXPRESSION'],
    ['as type assertion', 'const val = req.query.q as string', 'UNSUPPORTED_EXPRESSION'],
    ['conditional ternary', 'const val = req.query.q ? "a" : "b"', 'UNSUPPORTED_EXPRESSION'],
    ['unary negation', 'const val = !req.query.q', 'UNSUPPORTED_EXPRESSION'],
    ['arrow function expression', 'const fn = () => req.query.q', 'UNSUPPORTED_EXPRESSION'],
    ['object literal', 'const val = { query: req.query.q }', 'UNSUPPORTED_EXPRESSION'],
    ['array literal', 'const val = [req.query.q]', 'UNSUPPORTED_EXPRESSION'],
    ['equality comparison', 'const val = req.query.q === "admin"', 'UNSUPPORTED_EXPRESSION'],
    ['unsupported method call', 'const val = req.query.q.trim()', 'UNSUPPORTED_EXPRESSION'],
  ])('unsupported expression fails closed with limitation: %s', async (_label, snippet, code) => {
    await verifyUnsupported(snippet, code);
  });

  it.each([
    ['eval identifier', 'eval("1")', 'UNBOUND_NAME'],
    ['fetch identifier', 'fetch("http://localhost")', 'UNBOUND_NAME'],
    ['process identifier', 'process.exit(0)', 'UNBOUND_NAME'],
  ])('unbound identifier fails closed: %s', async (_label, snippet, code) => {
    await verifyUnsupported(snippet, code);
  });

  it('fails closed when helper function has unsupported default parameter', async () => {
    const raw = replaceSource(input(), source => source.replace('function searchRoute',
      'function helper(param = "default") { return param; }\nfunction searchRoute')
      .replace('return res.json', 'helper(req.query.q); return res.json'));
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('UNSUPPORTED_FUNCTION');
  });

  it('purges partial taint findings when later reachable syntax is unsupported', async () => {
    const raw = replaceSource(input(), source => source.replace('return res.json', 'const rows = res.json')
      .replace(').all());', ').all()); while (false) {} return rows;'));
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('UNSUPPORTED_STATEMENT');
  });

  it('inconclusive analysis passes independent validation without alteration', async () => {
    const run = await verifyUnsupported('while (false) {}', 'UNSUPPORTED_STATEMENT');
    const validated = await validateSqlAnalysis(run.result, run.snapshot, run.ingestion, ORG);
    expect(validated).toEqual(run.result);
    expect(validated.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(validated.findings).toEqual([]);
  });

  it('inconclusive analysis produces no candidate hypothesis and skips commit verifier', async () => {
    const run = await verifyUnsupported('while (false) {}', 'UNSUPPORTED_STATEMENT');
    const verifyCommitted = vi.fn();
    const bridge = createSqlCandidateBridge(verifyCommitted);
    const hypotheses = await bridge(run.result, run.snapshot, run.ingestion, ORG);
    expect(hypotheses).toEqual([]);
    expect(verifyCommitted).not.toHaveBeenCalled();
  });

  it('ingestion-level unsupported syntax fails closed before detector execution', async () => {
    const rawClass = replaceSource(input(), source => 'class DisallowedClass {}\n' + source);
    const snapshotClass = await captureSnapshot(rawClass, ORG);
    await expect(ingestExpress(snapshotClass, ORG)).rejects.toThrow('unsupported module structure');

    const rawImport = replaceSource(input(), source => 'import { exec } from "child_process";\n' + source);
    const snapshotImport = await captureSnapshot(rawImport, ORG);
    await expect(ingestExpress(snapshotImport, ORG)).rejects.toThrow('unsupported source import');

    const rawMalformed = replaceSource(input(), source => 'const = ;;\n' + source);
    const snapshotMalformed = await captureSnapshot(rawMalformed, ORG);
    await expect(ingestExpress(snapshotMalformed, ORG)).rejects.toThrow('malformed source unit');
  });
});
