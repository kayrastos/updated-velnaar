import type { CodeLocation, ReachabilityState, VerificationOutcome, VulnerabilityClass } from '../contracts';

export const BENCHMARK_VERSION = 'velnar-sqli-express-benchmark-v1' as const;
export const SQLI_SCENARIO_TYPES = Object.freeze([
  'OBVIOUS_VULNERABLE', 'SAFE_TWIN', 'REFACTORED_VULNERABLE', 'UNREACHABLE_VULNERABLE_CODE',
  'PARAMETERIZED_SAFE', 'MULTI_FUNCTION_FLOW', 'MULTI_FILE_FLOW', 'EXPRESS_ROUTE_FLOW',
] as const);
export type SqlInjectionScenario = typeof SQLI_SCENARIO_TYPES[number];
// Public fixture ground truth has no tenant/evidence authority. It is not a customer finding.
export interface SecurityBenchmarkCase {
  readonly caseId: string;
  readonly benchmarkVersion: typeof BENCHMARK_VERSION;
  readonly language: 'TYPESCRIPT' | 'JAVASCRIPT';
  readonly framework: 'EXPRESS';
  readonly vulnerabilityClass: VulnerabilityClass;
  readonly expectedSecurityState: 'VULNERABLE' | 'SAFE';
  readonly scenarioType: SqlInjectionScenario;
  readonly snapshotFixtureId: string;
  readonly entrypoint: CodeLocation;
  readonly sourceExpectation: 'HTTP_REQUEST_PARAMETER';
  readonly sinkExpectation: 'SQL_STRING_CONCATENATION' | 'PARAMETERIZED_SQL';
  readonly reachabilityExpectation: ReachabilityState;
  readonly verificationExpectation: VerificationOutcome;
  readonly tags: readonly string[];
  readonly description: string;
}
