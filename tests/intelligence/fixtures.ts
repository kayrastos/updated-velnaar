import { CONTRACT_VERSION, computeEvidenceHash, type CodeSnapshotRef, type FindingCandidate,
  type VerificationRequest, type EvidenceArtifact, type VerificationResult } from '../../worker/intelligence/contracts';

export type Mutable<T> = { -readonly [K in keyof T]: T[K] extends object ? Mutable<T[K]> : T[K] };
export const ORG = 'org_a';
export const HASH = `sha256:${'a'.repeat(64)}`;
export const NOW = '2026-09-04T00:00:00.000Z';
export function snapshot(): Mutable<CodeSnapshotRef> {
  return { contractVersion: CONTRACT_VERSION, snapshotId: 'snapshot_a', organizationId: ORG, repositoryId: 'repository_a',
    sourceProvider: 'LOCAL_FIXTURE', commitSha: 'a'.repeat(40), ref: 'refs/heads/fixture', createdAt: NOW };
}
export function candidate(): Mutable<FindingCandidate> {
  return { contractVersion: CONTRACT_VERSION, candidateId: 'candidate_a', organizationId: ORG, snapshot: snapshot(),
    vulnerabilityClass: 'SQL_INJECTION', source: { filePath: 'src/routes.ts', symbol: 'search', line: 2, column: 1 },
    sink: { filePath: 'src/store.ts', symbol: 'lookup', semanticId: 'store.lookup' },
    context: { entrypoint: { filePath: 'src/routes.ts', symbol: 'search' }, routeId: 'GET.search' },
    sensorEvidence: [{ contractVersion: CONTRACT_VERSION, organizationId: ORG, sensorType: 'TEST_FIXTURE',
      sensorFindingId: 'sensor_a', ruleId: 'sqli-v1', summary: 'Synthetic SQL flow hypothesis; no execution.',
      sourceLocation: { filePath: 'src/routes.ts', symbol: 'search' }, rawEvidenceFingerprint: HASH }],
    reachabilityState: 'REACHABLE', verificationState: 'CANDIDATE', createdAt: NOW };
}
export function request(): Mutable<VerificationRequest> {
  return { contractVersion: CONTRACT_VERSION, requestId: 'request_a', organizationId: ORG, candidateId: 'candidate_a',
    snapshotId: 'snapshot_a', commitSha: 'a'.repeat(40), vulnerabilityClass: 'SQL_INJECTION',
    verificationProfile: { profileId: 'sqli-fixture', version: 1 },
    environmentRequirements: { environmentType: 'ISOLATED_TEST', runtime: 'NODE', runtimeVersion: '24.18.0' },
    networkPolicy: { mode: 'DEFAULT_DENY', allowedDestinations: [] },
    resourceBudget: { maxCpuMillis: 1000, maxMemoryMb: 256, maxWallTimeMs: 1000, maxNetworkRequests: 0 },
    timeBudgetMs: 1000, expectedAssertionType: 'SQL_RESULT_SET_VIOLATION', createdAt: NOW };
}
export async function fixture() {
  const c = candidate(); const q = request();
  const body: Mutable<Omit<EvidenceArtifact, 'evidenceHash'>> = {
    contractVersion: CONTRACT_VERSION, evidenceId: 'evidence_a', organizationId: ORG, candidateId: c.candidateId, requestId: q.requestId,
    repositoryId: c.snapshot.repositoryId, snapshotId: c.snapshot.snapshotId, commitSha: c.snapshot.commitSha,
    vulnerabilityClass: c.vulnerabilityClass, verificationProfile: { ...q.verificationProfile },
    environmentIdentity: { ...q.environmentRequirements, environmentId: 'environment_a', imageDigest: HASH },
    executionIdentity: { executionId: 'execution_a', runnerId: 'offline-fixture' }, assertionType: q.expectedAssertionType,
    assertionResult: 'PASSED', observedBehavior: { observationCode: 'VIOLATION_OBSERVED', detailsFingerprint: HASH },
    startedAt: '2026-09-04T00:00:01.000Z', completedAt: '2026-09-04T00:00:01.100Z',
    reproduction: { profileId: q.verificationProfile.profileId, profileVersion: 1, fixtureId: 'fixture_a', testId: 'sqli-assertion-v1',
      requiredEnvironmentType: 'ISOLATED_TEST', expectedAssertion: q.expectedAssertionType },
  };
  const e: Mutable<EvidenceArtifact> = { ...body, evidenceHash: await computeEvidenceHash(body, q, c, ORG) };
  const r: Mutable<VerificationResult> = {
    contractVersion: CONTRACT_VERSION, requestId: q.requestId, candidateId: c.candidateId, organizationId: ORG,
    snapshotId: c.snapshot.snapshotId, commitSha: c.snapshot.commitSha, vulnerabilityClass: c.vulnerabilityClass,
    result: 'VERIFIED', evidenceId: e.evidenceId, observedBehavior: { ...e.observedBehavior }, assertionResult: 'PASSED',
    environmentIdentity: { ...e.environmentIdentity }, executionIdentity: { ...e.executionIdentity },
    startedAt: e.startedAt, completedAt: e.completedAt,
    resourceUsage: { cpuMillis: 50, peakMemoryMb: 64, wallTimeMs: 100, networkRequests: 0 },
  };
  return { c, q, e, r };
}
