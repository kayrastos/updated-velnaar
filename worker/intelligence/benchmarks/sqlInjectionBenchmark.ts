import { immutableCopy, protocolError } from '../contracts/validators';
import { BENCHMARK_VERSION, SQLI_SCENARIO_TYPES, type SecurityBenchmarkCase, type SqlInjectionScenario } from './types';

// Reviewed fixture intent, not measured performance. Any semantic change needs a new version.
const definitions: readonly [SqlInjectionScenario, string, string][] = [
  ['OBVIOUS_VULNERABLE', 'obvious-vulnerable', 'A reachable handler concatenates a request parameter into SQL.'],
  ['SAFE_TWIN', 'safe-twin', 'The obvious case uses the same route and data model but binds parameters instead of concatenating SQL.'],
  ['REFACTORED_VULNERABLE', 'refactored-vulnerable', 'Renamed symbols and reorganized statements preserve the reachable unsafe SQL flow.'],
  ['UNREACHABLE_VULNERABLE_CODE', 'unreachable-vulnerable-code', 'Unsafe SQL exists in a disconnected function; no registered route reaches it. SAFE means no exploit from the declared entrypoint, not locally safe SQL.'],
  ['PARAMETERIZED_SAFE', 'parameterized-safe', 'A reachable query uses SQL placeholders with separately bound request values.'],
  ['MULTI_FUNCTION_FLOW', 'multi-function-flow', 'Request data crosses handler, service and query-builder functions before unsafe SQL.'],
  ['MULTI_FILE_FLOW', 'multi-file-flow', 'Request data crosses route, service and repository modules before unsafe SQL.'],
  ['EXPRESS_ROUTE_FLOW', 'express-route-flow', 'A registered Express router forwards a request parameter to reachable unsafe SQL.'],
];
export const SQL_INJECTION_BENCHMARK: readonly SecurityBenchmarkCase[] = immutableCopy(definitions.map(([scenarioType, slug, description]) => {
  const parameterized = scenarioType === 'SAFE_TWIN' || scenarioType === 'PARAMETERIZED_SAFE';
  const unreachable = scenarioType === 'UNREACHABLE_VULNERABLE_CODE';
  const safe = parameterized || unreachable;
  return {
    caseId: `sqli-express-${slug}-001`, benchmarkVersion: BENCHMARK_VERSION,
    language: 'TYPESCRIPT', framework: 'EXPRESS', vulnerabilityClass: 'SQL_INJECTION',
    expectedSecurityState: safe ? 'SAFE' : 'VULNERABLE', scenarioType,
    snapshotFixtureId: `fixture-sqli-express-${slug}-v1`,
    entrypoint: { filePath: 'src/routes.ts', symbol: 'searchRoute', semanticId: 'express.GET.search' },
    sourceExpectation: 'HTTP_REQUEST_PARAMETER',
    sinkExpectation: parameterized ? 'PARAMETERIZED_SQL' : 'SQL_STRING_CONCATENATION',
    reachabilityExpectation: unreachable ? 'UNREACHABLE' : 'REACHABLE',
    verificationExpectation: safe ? 'NOT_VERIFIED' : 'VERIFIED',
    tags: ['metadata-only', 'sqli', 'express', slug], description,
  } as SecurityBenchmarkCase;
}));

/** Closed v1 manifest: exact equality with the reviewed version prevents answer substitution. */
export function validateSqlInjectionBenchmark(raw: unknown): readonly SecurityBenchmarkCase[] {
  if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype || raw.length !== SQLI_SCENARIO_TYPES.length
    || Reflect.ownKeys(raw).length !== raw.length + 1) protocolError('invalid benchmark case array');
  for (let i = 0; i < raw.length; i++) {
    const d = Object.getOwnPropertyDescriptor(raw, String(i));
    if (!d || !('value' in d) || !d.enumerable) protocolError('invalid benchmark array entry');
  }
  const seen = new Set<string>();
  function matches(actual: unknown, expected: unknown): boolean {
    if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length
      && Reflect.ownKeys(actual).length === expected.length + 1
      && expected.every((v, i) => Object.getOwnPropertyDescriptor(actual, String(i))?.value !== undefined && matches(actual[i], v));
    if (expected && typeof expected === 'object') {
      if (!actual || typeof actual !== 'object' || Object.getPrototypeOf(actual) !== Object.prototype) return false;
      const keys = Object.keys(expected);
      return Reflect.ownKeys(actual).length === keys.length && keys.every(k => {
        const d = Object.getOwnPropertyDescriptor(actual, k);
        return d && 'value' in d && d.enumerable && matches(d.value, expected[k]);
      });
    }
    return actual === expected;
  }
  for (const candidate of raw) {
    const caseId = candidate && Object.getOwnPropertyDescriptor(candidate, 'caseId')?.value;
    if (typeof caseId !== 'string' || seen.has(caseId)) protocolError('invalid/duplicate benchmark caseId');
    const expected = SQL_INJECTION_BENCHMARK.find(c => c.caseId === caseId);
    if (!expected || !matches(candidate, expected)) protocolError('benchmark differs from reviewed version');
    seen.add(caseId);
  }
  return SQL_INJECTION_BENCHMARK;
}
