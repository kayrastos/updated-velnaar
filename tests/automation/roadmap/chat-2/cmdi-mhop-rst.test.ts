import { describe, expect, it } from 'vitest';
import {
  ASSERTION_BY_CLASS,
  CONTRACT_VERSION,
  computeCandidateBinding,
  createVerificationState,
  transitionVerificationState,
  validateFindingCandidate,
  validateVerificationRequest,
  type FindingCandidate,
  type VerificationRequest,
} from '../../../../worker/intelligence/contracts';

const ORG = 'org_v1_discovery';
const COMMIT = 'a'.repeat(40);

function createCmdiCandidate(overrides: Partial<FindingCandidate> = {}): FindingCandidate {
  const candidate: FindingCandidate = {
    contractVersion: CONTRACT_VERSION,
    organizationId: ORG,
    candidateId: 'cand_cmdi_mhop_001',
    snapshot: {
      contractVersion: CONTRACT_VERSION,
      organizationId: ORG,
      snapshotId: 'snap_cmdi_001',
      repositoryId: 'repo_v1',
      sourceProvider: 'LOCAL_FIXTURE',
      commitSha: COMMIT,
      ref: 'refs/heads/main',
      createdAt: '2026-09-04T00:00:00.000Z',
    },
    vulnerabilityClass: 'COMMAND_INJECTION',
    source: {
      filePath: 'src/routes.ts',
      symbol: 'req.query.cmd',
      line: 12,
      column: 14,
    },
    sink: {
      filePath: 'src/execService.ts',
      symbol: 'child_process.exec',
      line: 45,
      column: 3,
    },
    context: {
      entrypoint: {
        filePath: 'src/routes.ts',
        symbol: 'handleExecRoute',
        line: 10,
        column: 1,
      },
      routeId: 'POST.exec',
    },
    sensorEvidence: [
      {
        contractVersion: CONTRACT_VERSION,
        organizationId: ORG,
        sensorType: 'VELNAR_STRUCTURAL',
        sensorFindingId: 'sensor_cmdi_mhop_001',
        ruleId: 'express-request-to-child-process-exec-v1',
        summary: 'Multi-hop shell-string taint flow into child_process.exec',
        sourceLocation: {
          filePath: 'src/routes.ts',
          symbol: 'req.query.cmd',
          line: 12,
          column: 14,
        },
        sinkLocation: {
          filePath: 'src/execService.ts',
          symbol: 'child_process.exec',
          line: 45,
          column: 3,
        },
        rawEvidenceFingerprint: `sha256:${'c'.repeat(64)}`,
      },
    ],
    reachabilityState: 'REACHABLE',
    verificationState: 'CANDIDATE',
    createdAt: '2026-09-04T00:00:00.000Z',
  };
  return { ...candidate, ...overrides };
}

function createCmdiRequest(candidate: FindingCandidate, overrides: Partial<VerificationRequest> = {}): VerificationRequest {
  const binding = computeCandidateBinding(candidate, ORG);
  const request: VerificationRequest = {
    contractVersion: CONTRACT_VERSION,
    requestId: 'req_cmdi_mhop_001',
    organizationId: ORG,
    candidateId: candidate.candidateId,
    candidateBinding: binding,
    snapshotId: candidate.snapshot.snapshotId,
    commitSha: candidate.snapshot.commitSha,
    vulnerabilityClass: candidate.vulnerabilityClass,
    verificationProfile: {
      profileId: 'profile_cmdi_isolated_node_v1',
      version: 1,
    },
    environmentRequirements: {
      environmentType: 'ISOLATED_TEST',
      runtime: 'NODE',
      runtimeVersion: '20.10.0',
    },
    networkPolicy: {
      mode: 'DEFAULT_DENY',
      allowedDestinations: [],
    },
    resourceBudget: {
      maxCpuMillis: 10000,
      maxMemoryMb: 512,
      maxWallTimeMs: 10000,
      maxNetworkRequests: 0,
    },
    timeBudgetMs: 10000,
    expectedAssertionType: ASSERTION_BY_CLASS[candidate.vulnerabilityClass],
    createdAt: candidate.createdAt,
  };
  return { ...request, ...overrides };
}

describe('V1:discovery-intelligence:command-injection-detector:multi-hop-flow:restart-resume', () => {
  it('validates multi-hop COMMAND_INJECTION candidate hypothesis and computes canonical binding without sha256 prefix', () => {
    const candidate = createCmdiCandidate();
    const validated = validateFindingCandidate(candidate, ORG);
    expect(validated.vulnerabilityClass).toBe('COMMAND_INJECTION');
    expect(validated.verificationState).toBe('CANDIDATE');
    expect(validated.sink.symbol).toBe('child_process.exec');

    const binding = computeCandidateBinding(candidate, ORG);
    expect(binding.startsWith(`${CONTRACT_VERSION}:FindingCandidate\n`)).toBe(true);
    expect(binding.startsWith('sha256:')).toBe(false);
  });

  it('preserves candidate semantic identity across multi-hop step variations', () => {
    const candidateA = createCmdiCandidate();
    const candidateB = createCmdiCandidate({
      sink: {
        filePath: 'src/execService.ts',
        symbol: 'child_process.execSync',
        line: 50,
        column: 3,
      },
    });

    const bindingA = computeCandidateBinding(candidateA, ORG);
    const bindingB = computeCandidateBinding(candidateB, ORG);
    expect(bindingA).not.toBe(bindingB);
  });

  it('resumes and transitions verification state cleanly from initial CANDIDATE through PENDING_VERIFICATION', async () => {
    const candidate = createCmdiCandidate();
    const initial = createVerificationState(candidate, ORG);
    expect(initial.state).toBe('CANDIDATE');

    const request = createCmdiRequest(candidate);
    const validatedRequest = validateVerificationRequest(request, candidate, ORG);
    expect(validatedRequest.expectedAssertionType).toBe('COMMAND_EXECUTION_OBSERVED');

    const pending = await transitionVerificationState(initial, { type: 'BEGIN', request: validatedRequest });
    expect(pending.state).toBe('PENDING_VERIFICATION');

    const restartedInitial = createVerificationState(candidate, ORG);
    expect(restartedInitial.state).toBe('CANDIDATE');
    const restartedPending = await transitionVerificationState(restartedInitial, { type: 'BEGIN', request: validatedRequest });
    expect(restartedPending.state).toBe('PENDING_VERIFICATION');
  });

  it('fails closed when restarting with mismatched candidate binding or modified commit', async () => {
    const candidate = createCmdiCandidate();
    const request = createCmdiRequest(candidate);
    const modifiedCandidate = createCmdiCandidate({
      source: {
        filePath: 'src/routes.ts',
        symbol: 'req.query.subcmd',
        line: 15,
        column: 14,
      },
    });

    const initialModified = createVerificationState(modifiedCandidate, ORG);
    await expect(transitionVerificationState(initialModified, { type: 'BEGIN', request })).rejects.toThrow('candidateBinding mismatch');

    const tamperedCommit = createCmdiRequest(candidate, { commitSha: 'b'.repeat(40) });
    const initial = createVerificationState(candidate, ORG);
    await expect(transitionVerificationState(initial, { type: 'BEGIN', request: tamperedCommit })).rejects.toThrow();
  });

  it('enforces fail-closed negative controls for unproven execution or invalid commit provenance', () => {
    for (const badCommit of ['', 'invalid-sha', '0'.repeat(40)]) {
      const badCandidate = createCmdiCandidate({
        snapshot: {
          contractVersion: CONTRACT_VERSION,
          organizationId: ORG,
          snapshotId: 'snap_cmdi_001',
          repositoryId: 'repo_v1',
          sourceProvider: 'LOCAL_FIXTURE',
          commitSha: badCommit,
          ref: 'refs/heads/main',
          createdAt: '2026-09-04T00:00:00.000Z',
        },
      });
      expect(() => validateFindingCandidate(badCandidate, ORG)).toThrow('INTELLIGENCE_PROTOCOL_ERROR: invalid commitSha');
    }

    const verifiedCandidate: any = createCmdiCandidate({ verificationState: 'VERIFIED' as any });
    expect(() => validateFindingCandidate(verifiedCandidate, ORG)).toThrow('INTELLIGENCE_PROTOCOL_ERROR: invalid verificationState');
  });
});
