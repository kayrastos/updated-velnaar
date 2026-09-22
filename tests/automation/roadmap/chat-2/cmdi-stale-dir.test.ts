import { describe, expect, it } from 'vitest';
import {
  ASSERTION_BY_CLASS,
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

const ORG = 'org-v1-cmdi';
const COMMIT_A = 'a'.repeat(40);
const COMMIT_B = 'b'.repeat(40);

function createDirectCmdiCandidate(): FindingCandidate {
  const snapshot = {
    contractVersion: CONTRACT_VERSION,
    snapshotId: 'snap-cmdi-dir-001',
    organizationId: ORG,
    repositoryId: 'repo-discovery-v1',
    sourceProvider: 'LOCAL_FIXTURE' as const,
    commitSha: COMMIT_A,
    ref: 'refs/heads/main',
    createdAt: '2026-09-04T00:00:00.000Z',
  };
  const source = {
    filePath: 'src/routes.ts',
    symbol: 'req.query.cmd',
    line: 12,
    column: 18,
  };
  const sink = {
    filePath: 'src/routes.ts',
    symbol: 'child_process.exec',
    line: 15,
    column: 5,
  };
  return {
    contractVersion: CONTRACT_VERSION,
    candidateId: 'cand-cmdi-dir-001',
    organizationId: ORG,
    snapshot,
    vulnerabilityClass: 'COMMAND_INJECTION',
    source,
    sink,
    context: {
      entrypoint: { filePath: 'src/routes.ts', symbol: 'execRoute', line: 10, column: 1 },
      routeId: 'route-cmdi-dir-001',
    },
    sensorEvidence: [
      {
        contractVersion: CONTRACT_VERSION,
        organizationId: ORG,
        sensorType: 'VELNAR_STRUCTURAL',
        sensorFindingId: 'sensor-cmdi-001',
        ruleId: 'express-request-to-child-process-exec-v1',
        summary: 'Untrusted request parameter flows directly to child_process exec sink.',
        sourceLocation: source,
        sinkLocation: sink,
        rawEvidenceFingerprint: 'sha256:' + 'a'.repeat(64),
      },
    ],
    reachabilityState: 'REACHABLE',
    verificationState: 'CANDIDATE',
    createdAt: '2026-09-04T00:00:01.000Z',
  };
}

async function createDirectCmdiFixture() {
  const c = createDirectCmdiCandidate();
  const binding = computeCandidateBinding(c, ORG);
  const q: VerificationRequest = {
    contractVersion: CONTRACT_VERSION,
    requestId: 'req-cmdi-dir-001',
    organizationId: ORG,
    candidateId: c.candidateId,
    candidateBinding: binding,
    snapshotId: c.snapshot.snapshotId,
    commitSha: c.snapshot.commitSha,
    vulnerabilityClass: 'COMMAND_INJECTION',
    verificationProfile: { profileId: 'profile-cmdi-v1', version: 1 },
    environmentRequirements: {
      environmentType: 'ISOLATED_TEST',
      runtime: 'NODE',
      runtimeVersion: '20.11.0',
    },
    networkPolicy: { mode: 'DEFAULT_DENY', allowedDestinations: [] },
    resourceBudget: {
      maxCpuMillis: 30000,
      maxMemoryMb: 512,
      maxWallTimeMs: 10000,
      maxNetworkRequests: 0,
    },
    timeBudgetMs: 5000,
    expectedAssertionType: ASSERTION_BY_CLASS[c.vulnerabilityClass],
    createdAt: '2026-09-04T00:00:02.000Z',
  };
  const body = {
    contractVersion: CONTRACT_VERSION,
    evidenceId: 'ev-cmdi-dir-001',
    organizationId: ORG,
    candidateId: c.candidateId,
    candidateBinding: binding,
    requestId: q.requestId,
    repositoryId: c.snapshot.repositoryId,
    snapshotId: c.snapshot.snapshotId,
    commitSha: c.snapshot.commitSha,
    vulnerabilityClass: 'COMMAND_INJECTION' as const,
    verificationProfile: q.verificationProfile,
    environmentIdentity: {
      environmentType: 'ISOLATED_TEST' as const,
      runtime: 'NODE' as const,
      runtimeVersion: '20.11.0',
      environmentId: 'env-node-001',
      imageDigest: 'sha256:' + 'b'.repeat(64),
    },
    executionIdentity: { executionId: 'exec-node-001', runnerId: 'runner-node-001' },
    assertionType: ASSERTION_BY_CLASS[c.vulnerabilityClass],
    assertionResult: 'PASSED' as const,
    observedBehavior: {
      observationCode: 'VIOLATION_OBSERVED' as const,
      detailsFingerprint: 'sha256:' + 'c'.repeat(64),
    },
    startedAt: '2026-09-04T00:00:03.000Z',
    completedAt: '2026-09-04T00:00:04.000Z',
    reproduction: {
      profileId: q.verificationProfile.profileId,
      profileVersion: q.verificationProfile.version,
      fixtureId: 'fixture-cmdi-dir-001',
      testId: 'test-cmdi-exec',
      requiredEnvironmentType: 'ISOLATED_TEST' as const,
      expectedAssertion: ASSERTION_BY_CLASS[c.vulnerabilityClass],
    },
  };
  const evidenceHash = await computeEvidenceHash(body, q, c, ORG);
  const e: EvidenceArtifact = { ...body, evidenceHash };
  const r: VerificationResult = {
    contractVersion: CONTRACT_VERSION,
    requestId: q.requestId,
    candidateId: c.candidateId,
    candidateBinding: binding,
    organizationId: ORG,
    snapshotId: c.snapshot.snapshotId,
    commitSha: c.snapshot.commitSha,
    vulnerabilityClass: 'COMMAND_INJECTION',
    result: 'VERIFIED',
    evidenceId: e.evidenceId,
    observedBehavior: e.observedBehavior,
    assertionResult: 'PASSED',
    environmentIdentity: e.environmentIdentity,
    executionIdentity: e.executionIdentity,
    startedAt: '2026-09-04T00:00:03.000Z',
    completedAt: '2026-09-04T00:00:04.000Z',
    resourceUsage: { cpuMillis: 50, peakMemoryMb: 64, wallTimeMs: 1000, networkRequests: 0 },
  };
  return { c, q, e, r, binding };
}

describe('command injection detector: stale state rejection (direct)', () => {
  it('validates canonical direct COMMAND_INJECTION candidate and exact binding format', async () => {
    const { c, binding } = await createDirectCmdiFixture();
    expect(c.vulnerabilityClass).toBe('COMMAND_INJECTION');
    expect(c.verificationState).toBe('CANDIDATE');
    expect(c.sink.symbol).toBe('child_process.exec');
    expect(c.source.symbol).toBe('req.query.cmd');
    expect(binding.startsWith(`${CONTRACT_VERSION}:FindingCandidate\n`)).toBe(true);
    expect(binding.startsWith('sha256:')).toBe(false);
    expect(validateFindingCandidate(c, ORG)).toEqual(c);
    expect(createVerificationState(c, ORG).state).toBe('CANDIDATE');
  });

  it('rejects stale candidate predating code snapshot creation', async () => {
    const { c } = await createDirectCmdiFixture();
    const staleCandidate = { ...c, createdAt: '2026-09-03T23:59:59.999Z' };
    expect(() => validateFindingCandidate(staleCandidate, ORG)).toThrow('candidate predates snapshot');
    expect(() => computeCandidateBinding(staleCandidate, ORG)).toThrow('candidate predates snapshot');
  });

  it('rejects stale verification request predating candidate creation', async () => {
    const { c, q } = await createDirectCmdiFixture();
    const staleRequest = { ...q, createdAt: '2026-09-04T00:00:00.500Z' };
    expect(() => validateVerificationRequest(staleRequest, c, ORG)).toThrow('request predates candidate');
  });

  it('rejects stale candidate binding on verification state machine BEGIN transition', async () => {
    const { c, q } = await createDirectCmdiFixture();
    const modifiedCandidate = {
      ...c,
      sink: { ...c.sink, symbol: 'child_process.execSync' },
    };
    const staleBinding = computeCandidateBinding(modifiedCandidate, ORG);
    const staleRequest = { ...q, candidateBinding: staleBinding };
    const initial = createVerificationState(c, ORG);
    await expect(
      transitionVerificationState(initial, { type: 'BEGIN', request: staleRequest }),
    ).rejects.toThrow('candidateBinding mismatch');
  });

  it('prohibits direct state completion from CANDIDATE without PENDING_VERIFICATION', async () => {
    const { c, q, e, r } = await createDirectCmdiFixture();
    const initial = createVerificationState(c, ORG);
    await expect(
      transitionVerificationState(initial, { type: 'COMPLETE', result: r, evidence: e }),
    ).rejects.toThrow('COMPLETE requires pending verification');
    const pending = await transitionVerificationState(initial, { type: 'BEGIN', request: q });
    expect(pending.state).toBe('PENDING_VERIFICATION');
    const completed = await transitionVerificationState(pending, { type: 'COMPLETE', result: r, evidence: e });
    expect(completed.state).toBe('VERIFIED');
  });

  it('rejects stale Commit A evidence replay against updated Commit B candidate', async () => {
    const { c, q, e, r } = await createDirectCmdiFixture();
    const candidateB = {
      ...c,
      snapshot: { ...c.snapshot, commitSha: COMMIT_B },
    };
    const bindingB = computeCandidateBinding(candidateB, ORG);
    const requestB = { ...q, commitSha: COMMIT_B, candidateBinding: bindingB };
    const initialB = createVerificationState(candidateB, ORG);
    const pendingB = await transitionVerificationState(initialB, { type: 'BEGIN', request: requestB });
    const resultB = { ...r, commitSha: COMMIT_B, candidateBinding: bindingB };
    await expect(
      transitionVerificationState(pendingB, { type: 'COMPLETE', result: resultB, evidence: e }),
    ).rejects.toThrow('commitSha mismatch');
  });

  it('rejects stale snapshotId mismatch between candidate and verification request', async () => {
    const { c, q } = await createDirectCmdiFixture();
    const staleRequest = { ...q, snapshotId: 'snap-stale-other' };
    expect(() => validateVerificationRequest(staleRequest, c, ORG)).toThrow('snapshotId mismatch');
  });

  it('rejects stale or tampered evidence artifact binding and invalid evidenceHash', async () => {
    const { c, q, e } = await createDirectCmdiFixture();
    const tamperedBinding = {
      ...e,
      candidateBinding: `${CONTRACT_VERSION}:FindingCandidate\n{"stale":true}`,
    };
    await expect(validateEvidenceArtifact(tamperedBinding, q, c, ORG)).rejects.toThrow(
      'candidateBinding mismatch',
    );
    const tamperedHash = { ...e, evidenceHash: 'sha256:' + '0'.repeat(64) };
    await expect(validateEvidenceArtifact(tamperedHash, q, c, ORG)).rejects.toThrow(
      'evidenceHash mismatch',
    );
  });

  it('rejects stale or inverted execution interval in verification result', async () => {
    const { c, q, e, r } = await createDirectCmdiFixture();
    const invertedInterval = {
      ...r,
      startedAt: '2026-09-04T00:00:04.000Z',
      completedAt: '2026-09-04T00:00:03.000Z',
    };
    await expect(
      validateVerificationResult(invertedInterval, q, c, e, ORG),
    ).rejects.toThrow('invalid execution interval');
    const startedBeforeRequest = {
      ...r,
      startedAt: '2026-09-04T00:00:01.000Z',
      completedAt: '2026-09-04T00:00:02.000Z',
      resourceUsage: { ...r.resourceUsage, wallTimeMs: 1000 },
    };
    await expect(
      validateVerificationResult(startedBeforeRequest, q, c, e, ORG),
    ).rejects.toThrow('invalid execution interval');
  });

  it('fails closed on safe negative controls, unproven commit SHAs, and non-CANDIDATE claims', async () => {
    const { c } = await createDirectCmdiFixture();
    const zeroShaCandidate = {
      ...c,
      snapshot: { ...c.snapshot, commitSha: '0'.repeat(40) },
    };
    expect(() => validateFindingCandidate(zeroShaCandidate, ORG)).toThrow('invalid commitSha');
    const nonHexShaCandidate = {
      ...c,
      snapshot: { ...c.snapshot, commitSha: 'not-a-valid-commit-sha-at-all-0000000000' },
    };
    expect(() => validateFindingCandidate(nonHexShaCandidate, ORG)).toThrow('invalid commitSha');
    const prematureVerified = { ...c, verificationState: 'VERIFIED' as any };
    expect(() => validateFindingCandidate(prematureVerified, ORG)).toThrow('invalid verificationState');
    expect(() => validateFindingCandidate(c, 'foreign-org')).toThrow('organizationId mismatch');
  });
});
