// Test-only bridge from actual local execution records to SEALED M1 contracts.
import { CONTRACT_VERSION, computeCandidateBinding, computeEvidenceHash, createVerificationState, transitionVerificationState, validateEvidenceArtifact,
  type FindingCandidate, type VerificationRequest, type EvidenceArtifact, type VerificationResult } from '../../../../worker/intelligence/contracts';
import { validateExpressIngestion, type ExpressIngestion } from '../../../../worker/intelligence/ingestion/express';
import { fail, hash, type SourceSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { assertSingleQueryObservations, isRecordedExecution, type RecordedExecution } from './execute';

async function boundIngestion(raw: ExpressIngestion, record: RecordedExecution, organizationId: string) {
  if (!isRecordedExecution(record)) fail('unrecognized local execution record');
  const ingestion = await validateExpressIngestion(raw, organizationId), snapshot = ingestion.snapshot;
  if (record.snapshotId !== snapshot.snapshotId || record.ingestionIdentity !== ingestion.ingestionIdentity
    || record.organizationId !== organizationId
    || record.repositoryId !== snapshot.repositoryId || record.fixtureId !== snapshot.fixtureId
    || record.routeIdentity !== ingestion.routes[0].routeIdentity) fail('execution/snapshot binding');
  assertSingleQueryObservations(record);
  return ingestion;
}
/** Default pre-commit path: no M1 candidate/request/evidence/result is minted. */
export async function integrateExecution(raw: ExpressIngestion, record: RecordedExecution, organizationId: string) {
  const ingestion = await boundIngestion(raw, record, organizationId);
  return Object.freeze({ status: 'PRE_SEAL' as const, analyzedCodeCommitSha: null,
    snapshotId: ingestion.snapshot.snapshotId, recordDigest: record.recordDigest,
    reason: 'Captured bytes only; committed code identity has not been checked.' });
}
/** Trusted HOST configuration, never a source/snapshot field or fixture capability.
 * The post-commit command supplies the fixed local Git verifier. A custom verifier
 * is trusted host code; protocol tests model it but cannot claim a real Git seal.
 */
export function createSealedIntegrator(verifyCommittedCode: (snapshot: SourceSnapshot) => Promise<string>) {
  return async (raw: ExpressIngestion, record: RecordedExecution, organizationId: string) => {
    const ingestion = await boundIngestion(raw, record, organizationId);
    const analyzedCodeCommitSha = await verifyCommittedCode(ingestion.snapshot);
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(analyzedCodeCommitSha) || /^0+$/.test(analyzedCodeCommitSha)) fail('checked commit identity required');
    return integrateCommitBound(ingestion, record, organizationId, analyzedCodeCommitSha);
  };
}
async function integrateCommitBound(ingestion: ExpressIngestion, record: RecordedExecution, organizationId: string, analyzedCodeCommitSha: string) {
  const snapshot = ingestion.snapshot, route = ingestion.routes[0];
  assertSingleQueryObservations(record);
  const [sql] = record.attack.queries;
  const createdAt = '2026-09-04T00:00:00.000Z'; // Logical synthetic clock, not performance measurement.
  const source = { filePath: route.handler.filePath, symbol: route.handler.symbol, line: route.handler.line, column: route.handler.column };
  const sink = { filePath: sql.location.filePath, symbol: 'sqlite.prepare', line: sql.location.line, column: sql.location.column };
  const candidate: FindingCandidate = {
    contractVersion: CONTRACT_VERSION, organizationId, candidateId: await hash('m2-local-candidate-v1', { snapshotId: snapshot.snapshotId, routeIdentity: route.routeIdentity }),
    snapshot: { contractVersion: CONTRACT_VERSION, organizationId, snapshotId: snapshot.snapshotId, repositoryId: snapshot.repositoryId,
      sourceProvider: 'LOCAL_FIXTURE', commitSha: analyzedCodeCommitSha, ref: 'local/m2-committed-fixtures', createdAt },
    vulnerabilityClass: 'SQL_INJECTION', source, sink, context: { entrypoint: source, routeId: route.routeIdentity },
    sensorEvidence: [{ contractVersion: CONTRACT_VERSION, organizationId, sensorType: 'TEST_FIXTURE',
      sensorFindingId: record.routeIdentity, ruleId: 'm2-local-sqli-probe-v1',
      summary: 'Synthetic local benchmark hypothesis; not authenticated Fulgor production evidence.',
      sourceLocation: source, sinkLocation: sink, rawEvidenceFingerprint: record.recordDigest }],
    reachabilityState: 'UNKNOWN', verificationState: 'CANDIDATE', createdAt,
  };
  const binding = computeCandidateBinding(candidate, organizationId);
  const request: VerificationRequest = {
    contractVersion: CONTRACT_VERSION, organizationId, requestId: record.recordDigest, candidateId: candidate.candidateId, candidateBinding: binding,
    snapshotId: snapshot.snapshotId, commitSha: analyzedCodeCommitSha, vulnerabilityClass: 'SQL_INJECTION',
    verificationProfile: { profileId: record.profile, version: 1 },
    environmentRequirements: { environmentType: 'ISOLATED_TEST', runtime: 'NODE', runtimeVersion: '24.18.0' },
    networkPolicy: { mode: 'DEFAULT_DENY', allowedDestinations: [] },
    resourceBudget: { maxCpuMillis: 1000, maxMemoryMb: 256, maxWallTimeMs: 1000, maxNetworkRequests: 0 },
    timeBudgetMs: 1000, expectedAssertionType: 'SQL_RESULT_SET_VIOLATION', createdAt,
  };
  const outcome = record.violationObserved ? 'VERIFIED' : 'NOT_VERIFIED';
  const assertionResult = record.violationObserved ? 'PASSED' : 'FAILED';
  const observedBehavior = { observationCode: record.violationObserved ? 'VIOLATION_OBSERVED' as const : 'NO_VIOLATION_OBSERVED' as const,
    detailsFingerprint: record.recordDigest };
  const environmentIdentity = { ...request.environmentRequirements, environmentId: 'm2-local-synthetic',
    imageDigest: await hash('m2-synthetic-environment-v1', { profile: record.profile, snapshot: snapshot.snapshotId }) };
  const executionIdentity = { executionId: record.recordDigest, runnerId: 'm2-test-only-bounded-interpreter' };
  const body: Omit<EvidenceArtifact, 'evidenceHash'> = {
    contractVersion: CONTRACT_VERSION, organizationId, evidenceId: record.recordDigest, candidateId: candidate.candidateId,
    candidateBinding: binding, requestId: request.requestId, repositoryId: snapshot.repositoryId, snapshotId: snapshot.snapshotId,
    commitSha: analyzedCodeCommitSha, vulnerabilityClass: 'SQL_INJECTION', verificationProfile: request.verificationProfile,
    environmentIdentity, executionIdentity, assertionType: request.expectedAssertionType, assertionResult,
    observedBehavior, startedAt: createdAt, completedAt: createdAt,
    reproduction: { profileId: record.profile, profileVersion: 1, fixtureId: snapshot.fixtureId, testId: 'local-quote-or-probe-v1',
      requiredEnvironmentType: 'ISOLATED_TEST', expectedAssertion: request.expectedAssertionType },
  };
  const evidence: EvidenceArtifact = await validateEvidenceArtifact(
    { ...body, evidenceHash: await computeEvidenceHash(body, request, candidate, organizationId) }, request, candidate, organizationId);
  const result: VerificationResult = { contractVersion: CONTRACT_VERSION, organizationId, requestId: request.requestId,
    candidateId: candidate.candidateId, candidateBinding: binding, snapshotId: snapshot.snapshotId, commitSha: analyzedCodeCommitSha,
    vulnerabilityClass: 'SQL_INJECTION', result: outcome, evidenceId: evidence.evidenceId, observedBehavior, assertionResult,
    environmentIdentity, executionIdentity, startedAt: createdAt, completedAt: createdAt,
    resourceUsage: { cpuMillis: 0, peakMemoryMb: 0, wallTimeMs: 0, networkRequests: 0 } }; // Synthetic placeholders, not measured resource claims.
  const initial = createVerificationState(candidate, organizationId);
  const pending = await transitionVerificationState(initial, { type: 'BEGIN', request });
  const completed = await transitionVerificationState(pending, { type: 'COMPLETE', result, evidence });
  return Object.freeze({ status: 'COMMIT_BOUND_LOCAL' as const, analyzedCodeCommitSha,
    candidate: initial.candidate, request: pending.request!, evidence, result: completed.result!, initial, pending, completed });
}
