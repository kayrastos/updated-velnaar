import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { assertDetectorIsolation } from './support/oracleGuard';
import { analyzeInput, ORG } from './support/inputs';

function sources() {
  const files = new Map<string, string>();
  function walk(directory: string) {
    for (const name of fs.readdirSync(directory)) {
      const file = path.posix.join(directory, name);
      if (fs.statSync(file).isDirectory()) walk(file);
      else if (file.endsWith('.ts')) files.set(file, fs.readFileSync(file, 'utf8'));
    }
  }
  walk('worker/intelligence'); walk('tests/intelligence/m2/support');
  const roots = [...files.keys()].filter(file => file.startsWith('worker/intelligence/detection/'));
  return { files, roots };
}
describe('M3 extends sealed oracle isolation without execution authority', () => {
  it('audits every detector root and complete local dependency closure with both guards', () => {
    const { files, roots } = sources(); expect(roots).toHaveLength(3);
    expect(() => assertDetectorIsolation(files, roots)).not.toThrow();
  });
  it.each([
    "import '../benchmarks/sqlInjectionBenchmark';",
    "import '../../../tests/intelligence/m2/support/evaluate';",
    "import '../../../tests/intelligence/m2/support/execute';",
    "const id = 'fixture-sqli-express-safe-twin-v1';",
    "const answer = { expectedSecurityState: 'SAFE' };",
    "const answer = { verificationExpectation: 'VERIFIED' };",
    "const answer = { reachabilityExpectation: 'REACHABLE' };",
    "const answer = { sinkExpectation: 'PARAMETERIZED_SQL' };",
    "const value = record.violationObserved;",
    "const value: RecordedExecution = record;",
    "const value = record.attack.queries;",
    "const value = record.benign.returnedIds;",
    "const value = { expectedState: 'VERIFIED' };",
    "import { DatabaseSync } from 'node:sqlite';",
    "const result = { state: 'VERIFIED' };",
    "const result: EvidenceArtifact = raw;",
    "const result: VerificationResult = raw;",
    "const label = 'VIOLATION_OBSERVED';",
  ])('negative control rejects oracle/proof access: %s', code => {
    const { files, roots } = sources(); files.set(roots[0], files.get(roots[0]) + '\n' + code);
    expect(() => assertDetectorIsolation(files, roots)).toThrow();
  });
  it.each(['OBVIOUS_VULNERABLE', 'SAFE_TWIN', 'REFACTORED_VULNERABLE', 'UNREACHABLE_VULNERABLE_CODE',
    'PARAMETERIZED_SAFE', 'MULTI_FUNCTION_FLOW', 'MULTI_FILE_FLOW', 'EXPRESS_ROUTE_FLOW'])(
    'rejects embedded scenario label %s', label => {
      const { files, roots } = sources(); files.set(roots[0], files.get(roots[0]) + `\nconst scenario = '${label}';`);
      expect(() => assertDetectorIsolation(files, roots)).toThrow('M3_SCENARIO_ORACLE');
    });
  it('rejects transitive execution-answer access through an otherwise neutral helper', () => {
    const { files, roots } = sources();
    files.set(roots[0], files.get(roots[0]) + "\nimport '../neutral/helper';");
    files.set('worker/intelligence/neutral/helper.ts', 'export const value = input.violationObserved;');
    expect(() => assertDetectorIsolation(files, roots)).toThrow('M3_EXECUTION_ORACLE');
  });
  it('downstream oracle relabeling cannot change the detector output or cause oracle loading', async () => {
    const original = await analyzeInput(); let oracleLoaded = false;
    vi.resetModules();
    vi.doMock('../../../worker/intelligence/benchmarks/sqlInjectionBenchmark', () => {
      oracleLoaded = true; return { SQL_INJECTION_BENCHMARK: [{ expectedSecurityState: 'SAFE' }] };
    });
    vi.doMock('../m2/support/evaluate', () => {
      oracleLoaded = true; return { evaluateRecorded: () => [{ actual: 'SAFE', expected: 'VULNERABLE' }] };
    });
    try {
      const { detectSqlInjection } = await import('../../../worker/intelligence/detection/sqlInjection');
      expect(await detectSqlInjection(original.snapshot, original.ingestion, ORG)).toEqual(original.result);
      expect(oracleLoaded).toBe(false);
    } finally {
      vi.doUnmock('../../../worker/intelligence/benchmarks/sqlInjectionBenchmark'); vi.doUnmock('../m2/support/evaluate'); vi.resetModules();
    }
  });
});
