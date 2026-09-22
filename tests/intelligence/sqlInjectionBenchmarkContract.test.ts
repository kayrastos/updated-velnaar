import { describe, it, expect } from 'vitest';
import { BENCHMARK_VERSION, SQLI_SCENARIO_TYPES, SQL_INJECTION_BENCHMARK, validateSqlInjectionBenchmark } from '../../worker/intelligence/benchmarks';

describe('versioned metadata-only SQLi benchmark', () => {
  it('has exactly eight unique cases and all eight closed scenario categories', () => {
    expect(SQL_INJECTION_BENCHMARK).toHaveLength(8);
    expect(new Set(SQL_INJECTION_BENCHMARK.map(c => c.caseId)).size).toBe(8);
    expect(SQL_INJECTION_BENCHMARK.map(c => c.scenarioType)).toEqual(SQLI_SCENARIO_TYPES);
  });
  it('uses the versioned TypeScript/Express SQL_INJECTION profile with deterministic ground truth', () => {
    for (const c of SQL_INJECTION_BENCHMARK) {
      expect(c.benchmarkVersion).toBe(BENCHMARK_VERSION); expect(c.language).toBe('TYPESCRIPT');
      expect(c.framework).toBe('EXPRESS'); expect(c.vulnerabilityClass).toBe('SQL_INJECTION');
      expect(['VULNERABLE', 'SAFE']).toContain(c.expectedSecurityState);
      expect(c.verificationExpectation).toBe(c.expectedSecurityState === 'SAFE' ? 'NOT_VERIFIED' : 'VERIFIED');
      expect(c.snapshotFixtureId.length).toBeGreaterThan(0); expect(c.tags).toContain('metadata-only');
    }
    expect(validateSqlInjectionBenchmark(JSON.parse(JSON.stringify(SQL_INJECTION_BENCHMARK)))).toBe(SQL_INJECTION_BENCHMARK);
  });
  it('pins independent expected answers; unreachable code is safe only from the declared entrypoint', () => {
    expect(SQL_INJECTION_BENCHMARK.map(c => [c.scenarioType, c.expectedSecurityState, c.reachabilityExpectation, c.sinkExpectation])).toEqual([
      ['OBVIOUS_VULNERABLE', 'VULNERABLE', 'REACHABLE', 'SQL_STRING_CONCATENATION'],
      ['SAFE_TWIN', 'SAFE', 'REACHABLE', 'PARAMETERIZED_SQL'],
      ['REFACTORED_VULNERABLE', 'VULNERABLE', 'REACHABLE', 'SQL_STRING_CONCATENATION'],
      ['UNREACHABLE_VULNERABLE_CODE', 'SAFE', 'UNREACHABLE', 'SQL_STRING_CONCATENATION'],
      ['PARAMETERIZED_SAFE', 'SAFE', 'REACHABLE', 'PARAMETERIZED_SQL'],
      ['MULTI_FUNCTION_FLOW', 'VULNERABLE', 'REACHABLE', 'SQL_STRING_CONCATENATION'],
      ['MULTI_FILE_FLOW', 'VULNERABLE', 'REACHABLE', 'SQL_STRING_CONCATENATION'],
      ['EXPRESS_ROUTE_FLOW', 'VULNERABLE', 'REACHABLE', 'SQL_STRING_CONCATENATION'],
    ]);
  });
  it('freezes nested ground truth and metadata against runtime rewriting', () => {
    expect(Object.isFrozen(SQL_INJECTION_BENCHMARK)).toBe(true);
    expect(Object.isFrozen(SQL_INJECTION_BENCHMARK[0].entrypoint)).toBe(true);
    expect(() => { (SQL_INJECTION_BENCHMARK[0] as any).expectedSecurityState = 'SAFE'; }).toThrow();
    expect(() => { (SQL_INJECTION_BENCHMARK[0].tags as any).push('new'); }).toThrow();
  });
  it.each(['benchmarkVersion', 'language', 'framework', 'vulnerabilityClass', 'expectedSecurityState', 'scenarioType', 'description'])('rejects silent manifest drift in %s', field => {
    const cases = JSON.parse(JSON.stringify(SQL_INJECTION_BENCHMARK)); cases[0][field] = 'edited';
    expect(() => validateSqlInjectionBenchmark(cases)).toThrow('INTELLIGENCE_PROTOCOL_ERROR:');
  });
  it('rejects missing/duplicate cases and unknown authority fields', () => {
    expect(() => validateSqlInjectionBenchmark(SQL_INJECTION_BENCHMARK.slice(1))).toThrow('INTELLIGENCE_PROTOCOL_ERROR:');
    const duplicate = [...SQL_INJECTION_BENCHMARK]; duplicate[1] = duplicate[0];
    expect(() => validateSqlInjectionBenchmark(duplicate)).toThrow('INTELLIGENCE_PROTOCOL_ERROR:');
    const cases = JSON.parse(JSON.stringify(SQL_INJECTION_BENCHMARK)); cases[0].verified = true;
    expect(() => validateSqlInjectionBenchmark(cases)).toThrow('INTELLIGENCE_PROTOCOL_ERROR:');
  });
  it('rejects decorated arrays and accessors without invoking them', () => {
    const cases = [...SQL_INJECTION_BENCHMARK]; cases['verified'] = true;
    expect(() => validateSqlInjectionBenchmark(cases)).toThrow('INTELLIGENCE_PROTOCOL_ERROR:');
    const accessor = [...SQL_INJECTION_BENCHMARK]; let called = false;
    Object.defineProperty(accessor, '0', { get() { called = true; return cases[0]; }, enumerable: true });
    expect(() => validateSqlInjectionBenchmark(accessor)).toThrow('INTELLIGENCE_PROTOCOL_ERROR:'); expect(called).toBe(false);
  });
});
