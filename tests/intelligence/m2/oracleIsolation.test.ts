import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { assertOracleIsolation } from './support/oracleGuard';

const roots = ['worker/intelligence/ingestion/snapshot.ts', 'worker/intelligence/ingestion/express.ts',
  'tests/intelligence/m2/support/execute.ts', 'tests/intelligence/m2/support/integrate.ts'];
function sources(): Map<string, string> {
  const files = new Map<string, string>();
  function walk(dir: string) {
    for (const name of fs.readdirSync(dir)) {
      const file = path.posix.join(dir, name);
      if (fs.statSync(file).isDirectory()) walk(file);
      else if (file.endsWith('.ts')) files.set(file, fs.readFileSync(file, 'utf8'));
    }
  }
  walk('worker/intelligence'); walk('tests/intelligence/m2/support'); return files;
}
describe('M2 oracle isolation architecture guard', () => {
  it('production ingestion and test-only SUT dependency closures cannot read benchmark answers', () => {
    expect(() => assertOracleIsolation(sources(), roots)).not.toThrow();
  });
  it('negative control catches an intentional direct ground-truth import', () => {
    const files = sources(); files.set(roots[0], files.get(roots[0]) + "\nimport { SQL_INJECTION_BENCHMARK } from '../benchmarks/sqlInjectionBenchmark';");
    expect(() => assertOracleIsolation(files, roots)).toThrow('ORACLE_LEAKAGE');
  });
  it('negative control catches transitive ground-truth leakage through an innocent helper', () => {
    const files = sources(); files.set(roots[0], files.get(roots[0]) + "\nimport './helper';");
    files.set('worker/intelligence/ingestion/helper.ts', "import '../benchmarks/sqlInjectionBenchmark';");
    expect(() => assertOracleIsolation(files, roots)).toThrow('ORACLE_LEAKAGE');
  });
  it.each(["import('./' + 'answers')", "require('./answers')", "eval('answer')", "globalThis.answers", "const x = { expectedSecurityState: 'SAFE' }",
    "import fs from 'node:fs';", "new Function('return 1')", "const indirect = require; indirect('./answers')", "global.answers",
    "const label = 'fixture-sqli-express-safe-twin-v1'"])(
    'negative control catches indirect/ambient leakage %s', code => {
    const files = sources(); files.set(roots[0], files.get(roots[0]) + '\n' + code);
    expect(() => assertOracleIsolation(files, roots)).toThrow('ORACLE_');
  });
});
