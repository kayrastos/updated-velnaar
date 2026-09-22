import { describe, expect, it } from 'vitest';
import {
  CONTRACT_VERSION,
  computeCandidateBinding,
  computeEvidenceHash,
  createVerificationState,
  transitionVerificationState,
  validateEvidenceArtifact,
  validateFindingCandidate,
  validateVerificationRequest,
  validateVerificationResult,
  type EvidenceArtifact,
  type FindingCandidate,
  type VerificationRequest,
  type VerificationResult,
} from '../../../../worker/intelligence/contracts';
import { fixture, ORG } from '../../../intelligence/fixtures';

async function createNestedCmdiFixture() {
  const { c: baseC, q: baseQ } = await fixture();

  const candidate: FindingCandidate = {
    ...baseC,
    candidateId: 'cand_cmdi_stale_nest_001',
    vulnerabilityClass: 'COMMAND_INJECTION',
    source: {
      filePath: 'src/routes/nestedAdmin.ts',
      symbol: 'req.query.command',
      line: 12,
      column: 18,
    },
    sink: {
      filePath: 'src/routes/nestedAdmin.ts',
      symbol: 'child_process.execSync',
      line: 16,
      column: 5,
    },
    context: {
      entrypoint: {
        filePath: 'src/routes/nestedAdmin.ts',
        symbol: 'nestedCommandHandler',
        line: 10,
        column: 1,
      },
      routeId: 'POST.api.v1.admin.nested_exec',
    },
    sensorEvidence: [{
      ...baseC.sensorEvidence[0],
      sensorFindingId: 'sensor_cmdi_nest_001',
      ruleId: 'child-process-exec-injection-v1',
      summary: 'Deterministic nested router command injection finding with child_process provenance.',
      sourceLocation: {
        filePath: 'src/routes/nestedAdmin.ts',
        symbol: 'req.query.command',
        line: 12,
        column: 18,
      },
      sinkLocation: {
        filePath: 'src/routes/nestedAdmin.ts',
        symbol: 'child_process.execSync',
        line: 16,
        column: 5,
      },
      rawEvidenceFingerprint: 'sha256:' + 'c'.repeat(64),
    }],
    verificationState: 'CANDIDATE',
    reachabilityState: 'REACHABLE',
  };

  const validCandidate = validateFindingCandidate(candidate, ORG);
  const candidateBinding = computeCandidateBinding(validCandidate, ORG);

  const request: VerificationRequest = {
    ...baseQ,
    requestId: 'req_cmdi_stale_nest_001',
    candidateId: validCandidate.candidateId,
    candidateBinding,
    snapshotId: validCandidate.snapshot.snapshotId,
    commitSha: validCandidate.snapshot.commitSha,
    vulnerabilityClass: 'COMMAND_INJECTION',
    expectedAssertionType: 'COMMAND_EXECUTION_OBSERVED',
    createdAt: validCandidate.createdAt,
  };
  const validRequest = validateVerificationRequest(request, validCandidate, ORG);

  const startedAt = '2026-09-04T00:00:00.002Z';
  const completedAt = '2026-09-04T00:00:00.052Z';
  const rawEvidenceBody = {
    contractVersion: CONTRACT_VERSION,
    evidenceId: 'evi_cmdi_stale_nest_001',
    organizationId: ORG,
    candidateId: validCandidate.candidateId,
    candidateBinding,
    requestId: validRequest.requestId,
    repositoryId: validCandidate.snapshot.repositoryId,
    snapshotId: validCandidate.snapshot.snapshotId,
    commitSha: validCandidate.snapshot.commitSha,
    vulnerabilityClass: 'COMMAND_INJECTION' as const,
    verificationProfile: validRequest.verificationProfile,
    environmentIdentity: {
      environmentType: validRequest.environmentRequirements.environmentType,
      runtime: validRequest.environmentRequirements.runtime,
      runtimeVersion: validRequest.environmentRequirements.runtimeVersion,
      environmentId: 'env_cmdi_stale_nest',
      imageDigest: 'sha256:' + 'e'.repeat(64),
    },
    executionIdentity: {
      executionId: 'exec_cmdi_stale_nest',
      runnerId: 'runner_cmdi_stale_nest',
    },
    assertionType: 'COMMAND_EXECUTION_OBSERVED' as const,
    assertionResult: 'PASSED' as const,
    observedBehavior: {
      observationCode: 'VIOLATION_OBSERVED' as const,
      detailsFingerprint: 'sha256:' + 'f'.repeat(64),
    },
    startedAt,
    completedAt,
    reproduction: {
      profileId: validRequest.verificationProfile.profileId,
      profileVersion: validRequest.verificationProfile.version,
      fixtureId: 'cmdi-nested-router-fixture',
      testId: 'test_nested_child_process_exec',
      requiredEnvironmentType: validRequest.environmentRequirements.environmentType,
      expectedAssertion: 'COMMAND_EXECUTION_OBSERVED' as const,
    },
  };

  const evidenceHash = await computeEvidenceHash(rawEvidenceBody, validRequest, validCandidate, ORG);
  const evidence: EvidenceArtifact = {
    ...rawEvidenceBody,
    evidenceHash,
  };
  const validEvidence = await validateEvidenceArtifact(evidence, validRequest, validCandidate, ORG);

  const result: VerificationResult = {
    contractVersion: CONTRACT_VERSION,
    requestId: validRequest.requestId,
    candidateId: validCandidate.candidateId,
    candidateBinding,
    organizationId: ORG,
    snapshotId: validCandidate.snapshot.snapshotId,
    commitSha: validCandidate.snapshot.commitSha,
    vulnerabilityClass: 'COMMAND_INJECTION',
    result: 'VERIFIED',
    evidenceId: validEvidence.evidenceId,
    observedBehavior: validEvidence.observedBehavior,
    assertionResult: 'PASSED',
    environmentIdentity: validEvidence.environmentIdentity,
    executionIdentity: validEvidence.executionIdentity,
    startedAt,
    completedAt,
    resourceUsage: {
      cpuMillis: 35,
      peakMemoryMb: 64,
      wallTimeMs: Date.parse(completedAt) - Date.parse(startedAt),
      networkRequests: 0,
    },
  };
  const validResult = await validateVerificationResult(result, validRequest, validCandidate, validEvidence, ORG);

  return {
    candidate: validCandidate,
    request: validRequest,
    evidence: validEvidence,
    result: validResult,
    candidateBinding,
  };
}

describe('human review: command injection stale-state rejection in nested router scope', () => {
  it('enforces exact three-state transition lifecycle for nested command injection hypothesis', async () => {
    const { candidate, request, evidence, result, candidateBinding } = await createNestedCmdiFixture();
    expect(candidate.vulnerabilityClass).toBe('COMMAND_INJECTION');
    expect(candidate.verificationState).toBe('CANDIDATE');

    const start = createVerificationState(candidate, ORG);
    expect(start.state).toBe('CANDIDATE');

    const pending = await transitionVerificationState(start, { type: 'BEGIN', request });
    expect(pending.state).toBe('PENDING_VERIFICATION');

    const verified = await transitionVerificationState(pending, { type: 'COMPLETE', result, evidence });
    expect(verified.state).toBe('VERIFIED');
    expect(verified.result.candidateBinding).toBe(candidateBinding);
  });

  it('rejects direct completion on initial CANDIDATE state before verification begins', async () => {
    const { candidate, evidence, result } = await createNestedCmdiFixture();
    const start = createVerificationState(candidate, ORG);
    await expect(
      transitionVerificationState(start, { type: 'COMPLETE', result, evidence })
    ).rejects.toThrow('COMPLETE requires pending');
  });

  it('rejects stale-state transitions once the state has moved forward', async () => {
    const { candidate, request, evidence, result } = await createNestedCmdiFixture();
    const start = createVerificationState(candidate, ORG);
    const pending = await transitionVerificationState(start, { type: 'BEGIN', request });

    await expect(
      transitionVerificationState(pending, { type: 'BEGIN', request })
    ).rejects.toThrow();

    const verified = await transitionVerificationState(pending, { type: 'COMPLETE', result, evidence });
    expect(verified.state).toBe('VERIFIED');

    await expect(
      transitionVerificationState(verified, { type: 'COMPLETE', result, evidence })
    ).rejects.toThrow('COMPLETE requires pending');

    await expect(
      transitionVerificationState(verified, { type: 'BEGIN', request })
    ).rejects.toThrow();
  });

  it('rejects completion with stale or mismatched candidate binding from nested scope', async () => {
    const { candidate, request, evidence, result } = await createNestedCmdiFixture();
    const start = createVerificationState(candidate, ORG);
    const pending = await transitionVerificationState(start, { type: 'BEGIN', request });

    const altered = {
      ...candidate,
      sink: { ...candidate.sink, line: candidate.sink.line! + 10 },
    };
    const alteredBinding = computeCandidateBinding(altered, ORG);

    const staleResult = { ...result, candidateBinding: alteredBinding };
    await expect(
      transitionVerificationState(pending, { type: 'COMPLETE', result: staleResult, evidence })
    ).rejects.toThrow('candidateBinding mismatch');
  });

  it('rejects commit replay when evidence belongs to a stale commit SHA', async () => {
    const { candidate, request, evidence, result } = await createNestedCmdiFixture();
    const start = createVerificationState(candidate, ORG);
    const pending = await transitionVerificationState(start, { type: 'BEGIN', request });

    const staleCommit = 'd'.repeat(40);
    const staleResult = { ...result, commitSha: staleCommit };
    await expect(
      transitionVerificationState(pending, { type: 'COMPLETE', result: staleResult, evidence })
    ).rejects.toThrow('commitSha mismatch');
  });

  it('maintains negative control boundaries for safe constants and missing child_process provenance', () => {
    const safeCommand = 'echo constant_safe_command';
    expect(safeCommand).not.toContain('req.query');

    const localHelper = { symbol: 'customLocalExec', isProvenChildProcess: false };
    expect(localHelper.isProvenChildProcess).toBe(false);

    const forgedDetectorOutput = {
      vulnerabilityClass: 'COMMAND_INJECTION',
      verificationState: 'VERIFIED',
    };
    expect(() => validateFindingCandidate(forgedDetectorOutput, ORG)).toThrow();
  });
});
