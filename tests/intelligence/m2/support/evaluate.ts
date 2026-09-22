// Oracle is intentionally a downstream evaluator, never a dependency of the SUT.
import { isRecordedExecution, type RecordedExecution } from './execute';
// The sole opaque-to-reviewed identity mapping. This module is downstream only.
const reviewedIdentity = Object.freeze({
  'm2-case-001': 'fixture-sqli-express-obvious-vulnerable-v1',
  'm2-case-002': 'fixture-sqli-express-safe-twin-v1',
  'm2-case-003': 'fixture-sqli-express-refactored-vulnerable-v1',
  'm2-case-004': 'fixture-sqli-express-unreachable-vulnerable-code-v1',
  'm2-case-005': 'fixture-sqli-express-parameterized-safe-v1',
  'm2-case-006': 'fixture-sqli-express-multi-function-flow-v1',
  'm2-case-007': 'fixture-sqli-express-multi-file-flow-v1',
  'm2-case-008': 'fixture-sqli-express-express-route-flow-v1',
});
export async function evaluateRecorded(records: readonly RecordedExecution[]) {
  // Ground truth is loaded only AFTER the caller has produced the frozen records.
  if (records.some(r => !isRecordedExecution(r) || !Object.isFrozen(r))) throw new Error('EVALUATION_REQUIRES_RECORDED_RESULTS');
  const { SQL_INJECTION_BENCHMARK } = await import('../../../../worker/intelligence/benchmarks/sqlInjectionBenchmark');
  if (records.length !== SQL_INJECTION_BENCHMARK.length || new Set(records.map(r => r.fixtureId)).size !== records.length) throw new Error('EVALUATION_CASE_SET');
  return records.map(record => {
    const snapshotFixtureId = reviewedIdentity[record.fixtureId as keyof typeof reviewedIdentity];
    const oracle = SQL_INJECTION_BENCHMARK.find(c => c.snapshotFixtureId === snapshotFixtureId);
    if (!oracle) throw new Error('EVALUATION_UNKNOWN_CASE');
    return { fixtureId: record.fixtureId, snapshotFixtureId, actual: record.violationObserved ? 'VULNERABLE' : 'SAFE',
      expected: oracle.expectedSecurityState, matches: record.violationObserved === (oracle.expectedSecurityState === 'VULNERABLE') };
  });
}
