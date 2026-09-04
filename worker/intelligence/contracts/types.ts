export const CONTRACT_VERSION = 'velnar-intelligence-contract-v1' as const;
export const VULNERABILITY_CLASSES = Object.freeze([
  'SQL_INJECTION', 'COMMAND_INJECTION', 'SSRF', 'PATH_TRAVERSAL', 'OBJECT_AUTHORIZATION',
] as const);
export type VulnerabilityClass = typeof VULNERABILITY_CLASSES[number];
export type SourceProvider = 'GITHUB' | 'GITLAB' | 'LOCAL_FIXTURE' | 'OTHER';
export type ReachabilityState = 'UNKNOWN' | 'REACHABLE' | 'UNREACHABLE' | 'INCONCLUSIVE';
export type VerificationState = 'CANDIDATE' | 'PENDING_VERIFICATION' | 'VERIFIED'
  | 'NOT_VERIFIED' | 'INCONCLUSIVE' | 'RESOLVED';
export type VerificationOutcome = 'VERIFIED' | 'NOT_VERIFIED' | 'INCONCLUSIVE';
export type AssertionResult = 'PASSED' | 'FAILED' | 'NOT_EVALUATED';
export const ASSERTION_BY_CLASS = Object.freeze({
  SQL_INJECTION: 'SQL_RESULT_SET_VIOLATION',
  COMMAND_INJECTION: 'COMMAND_EXECUTION_OBSERVED',
  SSRF: 'OUTBOUND_REQUEST_OBSERVED',
  PATH_TRAVERSAL: 'FILE_READ_OBSERVED',
  OBJECT_AUTHORIZATION: 'OBJECT_ACCESS_OBSERVED',
} as const);
export type AssertionType = typeof ASSERTION_BY_CLASS[VulnerabilityClass];
export type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

// Every root message is versioned and tenant-bound. Nested values inherit its tenant.
interface TenantContract {
  readonly contractVersion: typeof CONTRACT_VERSION;
  readonly organizationId: string;
}
export interface CodeSnapshotRef extends TenantContract {
  readonly snapshotId: string;
  readonly repositoryId: string;
  readonly sourceProvider: SourceProvider;
  readonly commitSha: string;
  readonly ref: string;
  readonly createdAt: string;
}
export interface CodeLocation {
  readonly filePath: string;
  readonly symbol: string;
  readonly semanticId?: string;
  readonly line?: number;
  readonly column?: number;
}
export interface SensorEvidence extends TenantContract {
  readonly sensorType: 'VELNAR_STRUCTURAL' | 'SEMGREP' | 'CODEQL' | 'OSV' | 'TEST_FIXTURE';
  readonly sensorFindingId: string;
  readonly ruleId: string;
  readonly summary: string; // Untrusted, redacted metadata; never execution/verification authority.
  readonly sourceLocation: CodeLocation;
  readonly sinkLocation?: CodeLocation;
  readonly rawEvidenceFingerprint: string;
}
// Inbound findings are hypotheses only. Transition state is a separate opaque handle.
export interface FindingCandidate extends TenantContract {
  readonly candidateId: string;
  readonly snapshot: CodeSnapshotRef;
  readonly vulnerabilityClass: VulnerabilityClass;
  readonly source: CodeLocation;
  readonly sink: CodeLocation;
  readonly context: { readonly entrypoint: CodeLocation; readonly routeId?: string };
  readonly sensorEvidence: readonly SensorEvidence[];
  readonly reachabilityState: ReachabilityState;
  readonly verificationState: 'CANDIDATE';
  readonly createdAt: string;
}
export interface VerificationProfile { readonly profileId: string; readonly version: number }
export interface EnvironmentRequirements {
  readonly environmentType: 'ISOLATED_TEST';
  readonly runtime: 'NODE' | 'PYTHON';
  readonly runtimeVersion: string;
}
export interface EnvironmentIdentity extends EnvironmentRequirements {
  readonly environmentId: string;
  readonly imageDigest: string;
}
export interface ExecutionIdentity { readonly executionId: string; readonly runnerId: string }
export interface NetworkDestination {
  readonly hostname: string;
  readonly port: number;
  readonly protocol: 'HTTPS';
}
export interface NetworkPolicy {
  readonly mode: 'DEFAULT_DENY';
  readonly allowedDestinations: readonly NetworkDestination[];
}
// Schema ceilings, not a promise of production capacity or execution permission.
export const RESOURCE_LIMITS = Object.freeze({
  maxCpuMillis: 300_000, maxMemoryMb: 4096, maxWallTimeMs: 300_000, maxNetworkRequests: 100,
});
export interface ResourceBudget {
  readonly maxCpuMillis: number;
  readonly maxMemoryMb: number;
  readonly maxWallTimeMs: number;
  readonly maxNetworkRequests: number;
}
export interface VerificationRequest extends TenantContract {
  readonly requestId: string;
  readonly candidateId: string;
  readonly snapshotId: string;
  readonly commitSha: string;
  readonly vulnerabilityClass: VulnerabilityClass;
  readonly verificationProfile: VerificationProfile;
  readonly environmentRequirements: EnvironmentRequirements;
  readonly networkPolicy: NetworkPolicy;
  readonly resourceBudget: ResourceBudget;
  readonly timeBudgetMs: number;
  readonly expectedAssertionType: AssertionType;
  readonly createdAt: string;
}
export interface ObservedBehavior {
  readonly observationCode: 'VIOLATION_OBSERVED' | 'NO_VIOLATION_OBSERVED' | 'EXECUTION_INCOMPLETE';
  readonly detailsFingerprint: string; // Redacted machine output digest, not prose or raw secrets.
}
export interface ReproductionMetadata {
  readonly profileId: string;
  readonly profileVersion: number;
  readonly fixtureId: string;
  readonly testId: string; // Identifier, never a shell command.
  readonly requiredEnvironmentType: 'ISOLATED_TEST';
  readonly expectedAssertion: AssertionType;
}
export interface EvidenceArtifact extends TenantContract {
  readonly evidenceId: string;
  readonly candidateId: string;
  readonly requestId: string;
  readonly repositoryId: string;
  readonly snapshotId: string;
  readonly commitSha: string;
  readonly vulnerabilityClass: VulnerabilityClass;
  readonly verificationProfile: VerificationProfile;
  readonly environmentIdentity: EnvironmentIdentity;
  readonly executionIdentity: ExecutionIdentity;
  readonly assertionType: AssertionType;
  readonly assertionResult: AssertionResult;
  readonly observedBehavior: ObservedBehavior;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly evidenceHash: string;
  readonly reproduction: ReproductionMetadata;
}
export interface ResourceUsage {
  readonly cpuMillis: number;
  readonly peakMemoryMb: number;
  readonly wallTimeMs: number;
  readonly networkRequests: number;
}
// Wire data is NOT an authoritative verified finding. Always validate at the boundary.
export interface VerificationResult extends TenantContract {
  readonly requestId: string;
  readonly candidateId: string;
  readonly snapshotId: string;
  readonly commitSha: string;
  readonly vulnerabilityClass: VulnerabilityClass;
  readonly result: VerificationOutcome;
  readonly evidenceId: string | null;
  readonly observedBehavior: ObservedBehavior;
  readonly assertionResult: AssertionResult;
  readonly environmentIdentity: EnvironmentIdentity;
  readonly executionIdentity: ExecutionIdentity;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly resourceUsage: ResourceUsage;
}
