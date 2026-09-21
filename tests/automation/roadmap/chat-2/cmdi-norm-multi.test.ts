import { describe, expect, it } from 'vitest';
import {
  ASSERTION_BY_CLASS,
  CONTRACT_VERSION,
  computeCandidateBinding,
  computeEvidenceHash,
  createVerificationState,
  transitionVerificationState,
  validateCodeSnapshotRef,
  validateEvidenceArtifact,
  validateFindingCandidate,
  validateVerificationRequest,
  validateVerificationResult,
  type CodeLocation,
  type CodeSnapshotRef,
  type EvidenceArtifact,
  type FindingCandidate,
  type SensorEvidence,
  type VerificationRequest,
  type VerificationResult,
} from '../../../../worker/intelligence/contracts';

const ORG = 'org_v1_discovery';
const COMMIT_SHA = 'a'.repeat(40);

function createMultiStageFixture() {
  const createdAt = '2026-09-20T00:00:00.000Z';
  const snapshot: CodeSnapshotRef = {
    contractVersion: CONTRACT_VERSION,
    organizationId: ORG,
    snapshotId: 'snap_cmdi_multi_001',
    repositoryId: 'repo_discovery_001',
    sourceProvider: 'LOCAL_FIXTURE',
    commitSha: COMMIT_SHA,
    ref: 'refs/heads/main',
    createdAt,
  };
  const source: CodeLocation = {
    filePath: 'src/controllers/execRoute.ts',
    symbol: 'req.query.cmd',
    line: 12,
    column: 18,
  };
  const sink: CodeLocation = {
    filePath: 'src/controllers/execRoute.ts',
    symbol: 'child_process.exec',
    line: 18,
    column: 5,
  };
  const entrypoint: CodeLocation = {
    filePath: 'src/controllers/execRoute.ts',
    symbol: 'handleExecRoute',
    line: 10,
    column: 1,
  };
  const sensorEvidence: SensorEvidence = {
    contractVersion: CONTRACT_VERSION,
    organizationId: ORG,
    sensorType: 'VELNAR_STRUCTURAL',
    sensorFindingId: 'sensor_cmdi_stage1',
    ruleId: 'express-request-to-child-process-exec-v1',
    summary: 'Request-derived command injection hypothesis targeting child_process.exec',
    sourceLocation: source,
    sinkLocation: sink,
    rawEvidenceFingerprint: 'sha256:' + 'c'.repeat(64),
  };
  const candidate: FindingCandidate = {
    contractVersion: CONTRACT_VERSION,
    candidateId: 'cand_cmdi_multi_001',
    organizationId: ORG,
    snapshot,
    vulnerabilityClass: 'COMMAND_INJECTION',
    source,
    sink,
    context: {
      entrypoint,
      routeId: 'GET.api.v1.exec',
    },
    sensorEvidence: [sensorEvidence],
    reachabilityState: 'REACHABLE',
    verificationState: 'CANDIDATE',
    createdAt,
  };
  return { candidate, snapshot, source, sink, entrypoint, sensorEvidence };
}

async function createMultiStageProof(candidate: FindingCandidate) {
  const binding = computeCandidateBinding(candidate, ORG);
  const requestCreatedAt = '2026-09-20T00:00:00.001Z';
  const rawRequest: VerificationRequest = {
    contractVersion: CONTRACT_VERSION,
    requestId: 'req_cmdi_multi_001',
    organizationId: ORG,
    candidateId: candidate.candidateId,
    candidateBinding: binding,
    snapshotId: candidate.snapshot.snapshotId,
    commitSha: candidate.snapshot.commitSha,
    vulnerabilityClass: 'COMMAND_INJECTION',
    verificationProfile: { profileId: 'profile_cmdi_strict', version: 1 },
    environmentRequirements: { environmentType: 'ISOLATED_TEST', runtime: 'NODE', runtimeVersion: '20.11.0' },
    networkPolicy: { mode: 'DEFAULT_DENY', allowedDestinations: [] },
    resourceBudget: { maxCpuMillis: 10000, maxMemoryMb: 512, maxWallTimeMs: 10000, maxNetworkRequests: 0 },
    timeBudgetMs: 10000,
    expectedAssertionType: ASSERTION_BY_CLASS.COMMAND_INJECTION,
    createdAt: requestCreatedAt,
  };
  const request = validateVerificationRequest(rawRequest, candidate, ORG);

  const evidenceBody = {
    contractVersion: CONTRACT_VERSION,
    evidenceId: 'ev_cmdi_multi_001',
    organizationId: ORG,
    candidateId: candidate.candidateId,
    candidateBinding: binding,
    requestId: request.requestId,
    repositoryId: candidate.snapshot.repositoryId,
    snapshotId: candidate.snapshot.snapshotId,
    commitSha: candidate.snapshot.commitSha,
    vulnerabilityClass: 'COMMAND_INJECTION' as const,
    verificationProfile: request.verificationProfile,
    environmentIdentity: {
      environmentType: 'ISOLATED_TEST' as const,
      runtime: 'NODE' as const,
      runtimeVersion: '20.11.0',
      environmentId: 'env_cmdi_multi_001',
      imageDigest: 'sha256:' + 'd'.repeat(64),
    },
    executionIdentity: { executionId: 'exec_cmdi_001', runnerId: 'runner_cmdi_001' },
    assertionType: ASSERTION_BY_CLASS.COMMAND_INJECTION,
    assertionResult: 'PASSED' as const,
    observedBehavior: {
      observationCode: 'VIOLATION_OBSERVED' as const,
      detailsFingerprint: 'sha256:' + 'e'.repeat(64),
    },
    startedAt: '2026-09-20T00:00:00.002Z',
    completedAt: '2026-09-20T00:00:00.003Z',
    reproduction: {
      profileId: request.verificationProfile.profileId,
      profileVersion: request.verificationProfile.version,
      fixtureId: 'cmdi_fixture_multi_01',
      testId: 'test_cmdi_exec_multi',
      requiredEnvironmentType: 'ISOLATED_TEST' as const,
      expectedAssertion: ASSERTION_BY_CLASS.COMMAND_INJECTION,
    },
  };
  const evidenceHash = await computeEvidenceHash(evidenceBody, request, candidate, ORG);
  const evidence = await validateEvidenceArtifact({ ...evidenceBody, evidenceHash }, request, candidate, ORG);

  const rawResult: VerificationResult = {
    contractVersion: CONTRACT_VERSION,
    requestId: request.requestId,
    candidateId: candidate.candidateId,
    candidateBinding: binding,
    organizationId: ORG,
    snapshotId: candidate.snapshot.snapshotId,
    commitSha: candidate.snapshot.commitSha,
    vulnerabilityClass: 'COMMAND_INJECTION',
    result: 'VERIFIED',
    evidenceId: evidence.evidenceId,
    observedBehavior: evidence.observedBehavior,
    assertionResult: 'PASSED',
    environmentIdentity: evidence.environmentIdentity,
    executionIdentity: evidence.executionIdentity,
    startedAt: evidence.startedAt,
    completedAt: evidence.completedAt,
    resourceUsage: { cpuMillis: 100, peakMemoryMb: 64, wallTimeMs: 1, networkRequests: 0 },
  };
  const result = await validateVerificationResult(rawResult, request, candidate, evidence, ORG);

  return { request, evidence, result };
}

describe('V1 RM_CMDI_NORM_MULTI: command injection normalization boundary and multi-stage lifecycle', () => {
  it('produces an exact bound COMMAND_INJECTION candidate without sha256 prefix in binding representation', () => {
    const { candidate } = createMultiStageFixture();
    const validated = validateFindingCandidate(candidate, ORG);
    expect(validated.vulnerabilityClass).toBe('COMMAND_INJECTION');
    expect(validated.verificationState).toBe('CANDIDATE');

    const binding = computeCandidateBinding(validated, ORG);
    expect(binding.startsWith(`${CONTRACT_VERSION}:FindingCandidate\n`)).toBe(true);
    expect(binding.startsWith('sha256:')).toBe(false);
  });

  it('binds sensor ordering and optional routeId without lossy normalization', () => {
    const { candidate } = createMultiStageFixture();
    const secondSensor: SensorEvidence = {
      ...candidate.sensorEvidence[0],
      sensorFindingId: 'sensor_cmdi_stage2',
      ruleId: 'express-concat-to-exec-v1',
    };
    const multiSensorCandidate: FindingCandidate = {
      ...candidate,
      sensorEvidence: [candidate.sensorEvidence[0], secondSensor],
    };
    const originalBinding = computeCandidateBinding(multiSensorCandidate, ORG);

    const reversedSensorCandidate: FindingCandidate = {
      ...multiSensorCandidate,
      sensorEvidence: [secondSensor, candidate.sensorEvidence[0]],
    };
    expect(computeCandidateBinding(reversedSensorCandidate, ORG)).not.toBe(originalBinding);

    const strippedRouteCandidate: FindingCandidate = {
      ...candidate,
      context: { entrypoint: candidate.context.entrypoint },
    };
    expect(computeCandidateBinding(strippedRouteCandidate, ORG)).not.toBe(computeCandidateBinding(candidate, ORG));
  });

  it('rejects fake, empty, and all-zero commit SHA without performing case normalization', () => {
    const { snapshot } = createMultiStageFixture();
    expect(() => validateCodeSnapshotRef({ ...snapshot, commitSha: '' }, ORG)).toThrow('INTELLIGENCE_PROTOCOL_ERROR:');
    expect(() => validateCodeSnapshotRef({ ...snapshot, commitSha: '0'.repeat(40) }, ORG)).toThrow('INTELLIGENCE_PROTOCOL_ERROR:');
    expect(() => validateCodeSnapshotRef({ ...snapshot, commitSha: 'not-a-valid-sha' }, ORG)).toThrow('INTELLIGENCE_PROTOCOL_ERROR:');
  });

  it('differentiates proven child_process sink provenance from unproven local helper controls', () => {
    const { candidate, sink } = createMultiStageFixture();
    expect(sink.symbol).toBe('child_process.exec');

    const localControlCandidate: FindingCandidate = {
      ...candidate,
      sink: { ...sink, symbol: 'localHelper.exec' },
    };
    expect(computeCandidateBinding(localControlCandidate, ORG)).not.toBe(computeCandidateBinding(candidate, ORG));
  });

  it('prohibits direct completion from CANDIDATE state and enforces multi-stage progression', async () => {
    const { candidate } = createMultiStageFixture();
    const initial = createVerificationState(candidate, ORG);
    expect(initial.state).toBe('CANDIDATE');

    const { request, evidence, result } = await createMultiStageProof(candidate);
    await expect(transitionVerificationState(initial, { type: 'COMPLETE', result, evidence })).rejects.toThrow('COMPLETE requires pending verification');

    const pending = await transitionVerificationState(initial, { type: 'BEGIN', request });
    expect(pending.state).toBe('PENDING_VERIFICATION');

    const completed = await transitionVerificationState(pending, { type: 'COMPLETE', result, evidence });
    expect(completed.state).toBe('VERIFIED');
    expect(completed.candidate.verificationState).toBe('CANDIDATE');
  });

  it('rejects stage replaying with altered commitSha across multi-stage boundary', async () => {
    const { candidate } = createMultiStageFixture();
    const initial = createVerificationState(candidate, ORG);
    const { request, evidence, result } = await createMultiStageProof(candidate);
    const pending = await transitionVerificationState(initial, { type: 'BEGIN', request });

    const tamperedResult: VerificationResult = { ...result, commitSha: 'b'.repeat(40) };
    await expect(transitionVerificationState(pending, { type: 'COMPLETE', result: tamperedResult, evidence })).rejects.toThrow('commitSha mismatch');
  });

  it('preserves strict tenant isolation across multi-stage boundary', async () => {
    const { candidate } = createMultiStageFixture();
    expect(() => createVerificationState(candidate, 'org_foreign')).toThrow('INTELLIGENCE_PROTOCOL_ERROR:');
  });
});
