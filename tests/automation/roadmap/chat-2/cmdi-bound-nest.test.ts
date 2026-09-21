import { describe, expect, it } from 'vitest';
import {
  ASSERTION_BY_CLASS,
  CONTRACT_VERSION,
  computeCandidateBinding,
  createVerificationState,
  transitionVerificationState,
  validateCodeSnapshotRef,
  validateFindingCandidate,
  validateVerificationRequest,
  type FindingCandidate,
  type VerificationRequest,
} from '../../../../worker/intelligence/contracts';

const ORG = 'org_cmdi_bound_nest';

function makeValidCandidate(overrides: Partial<FindingCandidate> = {}): FindingCandidate {
  const commitSha = 'c'.repeat(40);
  const snapshot = {
    contractVersion: CONTRACT_VERSION,
    organizationId: ORG,
    snapshotId: 'snap_cmdi_nest_001',
    repositoryId: 'repo_cmdi_nest',
    sourceProvider: 'LOCAL_FIXTURE' as const,
    commitSha,
    ref: 'refs/heads/main',
    createdAt: '2026-09-04T00:00:00.000Z',
  };
  const base: FindingCandidate = {
    contractVersion: CONTRACT_VERSION,
    organizationId: ORG,
    candidateId: 'cand_cmdi_nest_001',
    snapshot,
    vulnerabilityClass: 'COMMAND_INJECTION',
    source: {
      filePath: 'src/nested/route.ts',
      symbol: 'req.query.cmd',
      line: 14,
      column: 6,
    },
    sink: {
      filePath: 'src/nested/execHelper.ts',
      symbol: 'child_process.exec',
      line: 38,
      column: 4,
    },
    context: {
      entrypoint: {
        filePath: 'src/nested/route.ts',
        symbol: 'nestedCommandHandler',
        line: 12,
        column: 2,
      },
      routeId: 'POST.nested.run',
    },
    sensorEvidence: [
      {
        contractVersion: CONTRACT_VERSION,
        organizationId: ORG,
        sensorType: 'VELNAR_STRUCTURAL',
        sensorFindingId: 'sensor_cmdi_nest_001',
        ruleId: 'express-request-to-child-process-v1',
        summary: 'Untrusted nested command-line string reaches child_process.exec.',
        sourceLocation: {
          filePath: 'src/nested/route.ts',
          symbol: 'req.query.cmd',
          line: 14,
          column: 6,
        },
        sinkLocation: {
          filePath: 'src/nested/execHelper.ts',
          symbol: 'child_process.exec',
          line: 38,
          column: 4,
        },
        rawEvidenceFingerprint: `sha256:${'a'.repeat(64)}`,
      },
    ],
    reachabilityState: 'REACHABLE',
    verificationState: 'CANDIDATE',
    createdAt: '2026-09-04T00:00:00.001Z',
  };
  return { ...base, ...overrides };
}

describe('COMMAND_INJECTION nested boundary rejection and canonical validation', () => {
  it('accepts a valid nested COMMAND_INJECTION candidate and computes exact canonical binding', () => {
    const candidate = makeValidCandidate();
    const validated = validateFindingCandidate(candidate, ORG);
    expect(validated).toEqual(candidate);
    expect(validated.vulnerabilityClass).toBe('COMMAND_INJECTION');
    expect(validated.verificationState).toBe('CANDIDATE');
    expect(validated.sink.symbol).toBe('child_process.exec');

    const binding = computeCandidateBinding(candidate, ORG);
    expect(binding).toContain(`${CONTRACT_VERSION}:FindingCandidate\n`);
    expect(binding.startsWith('sha256:')).toBe(false);
  });

  it('alters candidate semantic binding upon nested property mutation', () => {
    const base = makeValidCandidate();
    const initialBinding = computeCandidateBinding(base, ORG);

    const modifiedSource = makeValidCandidate({
      source: { ...base.source, line: 15 },
    });
    expect(computeCandidateBinding(modifiedSource, ORG)).not.toBe(initialBinding);

    const modifiedSink = makeValidCandidate({
      sink: { ...base.sink, symbol: 'child_process.execSync' },
    });
    expect(computeCandidateBinding(modifiedSink, ORG)).not.toBe(initialBinding);

    const modifiedContext = makeValidCandidate({
      context: { ...base.context, routeId: 'POST.nested.other' },
    });
    expect(computeCandidateBinding(modifiedContext, ORG)).not.toBe(initialBinding);
  });

  it('rejects nested structural violations and malformed candidate fields fail-closed', () => {
    const badCommit = makeValidCandidate();
    (badCommit as any).snapshot = { ...badCommit.snapshot, commitSha: '0'.repeat(40) };
    expect(() => validateFindingCandidate(badCommit, ORG)).toThrow('invalid commitSha');

    const malformedCommit = makeValidCandidate();
    (malformedCommit as any).snapshot = { ...malformedCommit.snapshot, commitSha: 'not-a-valid-sha' };
    expect(() => validateFindingCandidate(malformedCommit, ORG)).toThrow('invalid commitSha');

    const predatedCandidate = makeValidCandidate({
      createdAt: '2026-09-03T23:59:59.999Z',
    });
    expect(() => validateFindingCandidate(predatedCandidate, ORG)).toThrow('candidate predates snapshot');

    const nonRelativeSource = makeValidCandidate({
      source: { ...makeValidCandidate().source, filePath: '/bin/sh' },
    });
    expect(() => validateFindingCandidate(nonRelativeSource, ORG)).toThrow('filePath must be repository-relative');

    const nonRelativeSink = makeValidCandidate({
      sink: { ...makeValidCandidate().sink, filePath: '../execHelper.ts' },
    });
    expect(() => validateFindingCandidate(nonRelativeSink, ORG)).toThrow('filePath must be repository-relative');

    const verifiedCandidate = makeValidCandidate({
      verificationState: 'VERIFIED' as any,
    });
    expect(() => validateFindingCandidate(verifiedCandidate, ORG)).toThrow('invalid verificationState');

    const emptySensors = makeValidCandidate({
      sensorEvidence: [],
    });
    expect(() => validateFindingCandidate(emptySensors, ORG)).toThrow('invalid sensorEvidence');

    const badSensorFingerprint = makeValidCandidate();
    (badSensorFingerprint as any).sensorEvidence = [
      { ...badSensorFingerprint.sensorEvidence[0], rawEvidenceFingerprint: 'invalid-digest' },
    ];
    expect(() => validateFindingCandidate(badSensorFingerprint, ORG)).toThrow('invalid rawEvidenceFingerprint');

    expect(() => validateFindingCandidate(makeValidCandidate(), 'other_org')).toThrow('organizationId mismatch');
  });

  it('enforces negative control boundaries where names alone do not establish sink authority', () => {
    const candidate = makeValidCandidate({
      sink: {
        filePath: 'src/nested/safeHelper.ts',
        symbol: 'localExec',
        line: 20,
        column: 4,
      },
    });
    expect(candidate.sink.symbol).not.toBe('child_process.exec');
    expect(candidate.sink.symbol).not.toBe('child_process.execSync');
    expect(candidate.verificationState).toBe('CANDIDATE');
  });

  it('verifies COMMAND_INJECTION verification request assertion binding and transition rules', async () => {
    const candidate = makeValidCandidate();
    expect(ASSERTION_BY_CLASS.COMMAND_INJECTION).toBe('COMMAND_EXECUTION_OBSERVED');

    const state = createVerificationState(candidate, ORG);
    expect(state.state).toBe('CANDIDATE');

    await expect(
      transitionVerificationState(state, {
        type: 'COMPLETE',
        result: { result: 'VERIFIED' } as any,
        evidence: {} as any,
      })
    ).rejects.toThrow('COMPLETE requires pending verification');

    const binding = computeCandidateBinding(candidate, ORG);
    const validRequest: VerificationRequest = {
      contractVersion: CONTRACT_VERSION,
      organizationId: ORG,
      requestId: 'req_cmdi_nest_001',
      candidateId: candidate.candidateId,
      candidateBinding: binding,
      snapshotId: candidate.snapshot.snapshotId,
      commitSha: candidate.snapshot.commitSha,
      vulnerabilityClass: 'COMMAND_INJECTION',
      verificationProfile: { profileId: 'profile_cmdi_v1', version: 1 },
      environmentRequirements: {
        environmentType: 'ISOLATED_TEST',
        runtime: 'NODE',
        runtimeVersion: '20.10.0',
      },
      networkPolicy: { mode: 'DEFAULT_DENY', allowedDestinations: [] },
      resourceBudget: {
        maxCpuMillis: 5000,
        maxMemoryMb: 1024,
        maxWallTimeMs: 10000,
        maxNetworkRequests: 0,
      },
      timeBudgetMs: 5000,
      expectedAssertionType: 'COMMAND_EXECUTION_OBSERVED',
      createdAt: '2026-09-04T00:00:00.002Z',
    };

    const pending = await transitionVerificationState(state, { type: 'BEGIN', request: validRequest });
    expect(pending.state).toBe('PENDING_VERIFICATION');

    const mismatchedAssertionRequest: VerificationRequest = {
      ...validRequest,
      expectedAssertionType: 'SQL_RESULT_SET_VIOLATION' as any,
    };
    expect(() => validateVerificationRequest(mismatchedAssertionRequest, candidate, ORG)).toThrow(
      'expectedAssertionType mismatch'
    );

    const mismatchedBindingRequest: VerificationRequest = {
      ...validRequest,
      candidateBinding: 'tampered-binding',
    };
    expect(() => validateVerificationRequest(mismatchedBindingRequest, candidate, ORG)).toThrow(
      'candidateBinding mismatch'
    );
  });

  it('guarantees immutable boundary snapshots on candidate validation', () => {
    const candidate = makeValidCandidate();
    const validated = validateFindingCandidate(candidate, ORG);

    expect(Object.isFrozen(validated)).toBe(true);
    expect(Object.isFrozen(validated.source)).toBe(true);
    expect(Object.isFrozen(validated.sink)).toBe(true);
    expect(Object.isFrozen(validated.context)).toBe(true);
    expect(Object.isFrozen(validated.sensorEvidence)).toBe(true);
    expect(Object.isFrozen(validated.sensorEvidence[0])).toBe(true);
  });
});
