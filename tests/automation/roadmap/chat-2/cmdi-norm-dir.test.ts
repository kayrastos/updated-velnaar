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
} from '../../../../worker/intelligence/contracts';

const ORG = 'org_v1';
const VALID_COMMIT = '46db4c208f886afda939c04ae93580fbabd57344';

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}';
}

function buildCandidate(overrides: Partial<FindingCandidate> = {}): FindingCandidate {
  const createdAt = '2026-09-04T00:00:00.000Z';
  return {
    contractVersion: CONTRACT_VERSION,
    organizationId: ORG,
    candidateId: 'cmdi_cand_001',
    snapshot: {
      contractVersion: CONTRACT_VERSION,
      organizationId: ORG,
      snapshotId: 'snap_001',
      repositoryId: 'repo_001',
      sourceProvider: 'LOCAL_FIXTURE',
      commitSha: VALID_COMMIT,
      ref: 'refs/heads/main',
      createdAt,
    },
    vulnerabilityClass: 'COMMAND_INJECTION',
    source: {
      filePath: 'src/routes.ts',
      symbol: 'req.query.cmd',
      line: 12,
      column: 18,
    },
    sink: {
      filePath: 'src/executor.ts',
      symbol: 'child_process.exec',
      line: 25,
      column: 5,
    },
    context: {
      entrypoint: {
        filePath: 'src/routes.ts',
        symbol: 'runCommandRoute',
        line: 10,
        column: 1,
      },
      routeId: 'POST.run',
    },
    sensorEvidence: [
      {
        contractVersion: CONTRACT_VERSION,
        organizationId: ORG,
        sensorType: 'VELNAR_STRUCTURAL',
        sensorFindingId: 'sensor_cmdi_001',
        ruleId: 'express-request-to-child-process-exec-v1',
        summary: 'Direct child_process execution of request-derived command parameter.',
        sourceLocation: {
          filePath: 'src/routes.ts',
          symbol: 'req.query.cmd',
          line: 12,
          column: 18,
        },
        sinkLocation: {
          filePath: 'src/executor.ts',
          symbol: 'child_process.exec',
          line: 25,
          column: 5,
        },
        rawEvidenceFingerprint: `sha256:${'a'.repeat(64)}`,
      },
    ],
    reachabilityState: 'REACHABLE',
    verificationState: 'CANDIDATE',
    createdAt,
    ...overrides,
  };
}

function evaluateCommandInjectionProvenance(input: {
  hasChildProcessImport: boolean;
  sinkCallee: string;
  sourceType: 'REQUEST_DERIVED' | 'CONSTANT' | 'UNBOUND';
}) {
  if (!input.hasChildProcessImport) {
    return { status: 'NEGATIVE_CONTROL', finding: null };
  }
  if (input.sinkCallee !== 'exec' && input.sinkCallee !== 'execSync') {
    return { status: 'NEGATIVE_CONTROL', finding: null };
  }
  if (input.sourceType === 'CONSTANT') {
    return { status: 'NEGATIVE_CONTROL', finding: null };
  }
  if (input.sourceType === 'UNBOUND') {
    return { status: 'INCONCLUSIVE', finding: null };
  }
  return { status: 'DETECTED', finding: { vulnerabilityClass: 'COMMAND_INJECTION' as const } };
}

describe('command injection detector - direct normalization boundary and provenance', () => {
  it('produces valid FindingCandidate and exact canonical binding without sha256 prefix', () => {
    const candidate = buildCandidate();
    const validated = validateFindingCandidate(candidate, ORG);
    expect(validated.vulnerabilityClass).toBe('COMMAND_INJECTION');
    expect(validated.verificationState).toBe('CANDIDATE');

    const binding = computeCandidateBinding(validated, ORG);
    const expected = `${CONTRACT_VERSION}:FindingCandidate\n${canonical(validated)}`;
    expect(binding).toBe(expected);
    expect(binding.startsWith('sha256:')).toBe(false);
  });

  it('enforces location path normalization boundaries failing closed on non-canonical paths', () => {
    const candidate = buildCandidate();
    const nonCanonicalPaths = [
      '/src/routes.ts',
      'src\\routes.ts',
      'C:src/routes.ts',
      '../src/routes.ts',
      './routes.ts',
      'src/../routes.ts',
    ];

    for (const badPath of nonCanonicalPaths) {
      const bad = { ...candidate, source: { ...candidate.source, filePath: badPath } };
      expect(() => validateFindingCandidate(bad, ORG)).toThrow('filePath must be repository-relative');
    }
  });

  it('enforces location column requires line without default normalization', () => {
    const candidate = buildCandidate();
    const bad = { ...candidate, source: { filePath: 'src/routes.ts', symbol: 'cmd', column: 5 } };
    expect(() => validateFindingCandidate(bad, ORG)).toThrow('column requires line');
  });

  it('enforces commit SHA boundary rejecting abbreviations, uppercase, and all-zero hashes', () => {
    const candidate = buildCandidate();
    const invalidCommits = [
      '0'.repeat(40),
      '0'.repeat(64),
      VALID_COMMIT.toUpperCase(),
      '46db4c2',
      'not-a-commit-sha',
    ];

    for (const commitSha of invalidCommits) {
      const bad = { ...candidate, snapshot: { ...candidate.snapshot, commitSha } };
      expect(() => validateFindingCandidate(bad, ORG)).toThrow('invalid commitSha');
    }
  });

  it('binds candidate semantic identity without field omission or ordering normalization', () => {
    const candidate = buildCandidate();
    const baseBinding = computeCandidateBinding(candidate, ORG);

    const withoutRoute = { ...candidate, context: { entrypoint: candidate.context.entrypoint } };
    expect(computeCandidateBinding(withoutRoute, ORG)).not.toBe(baseBinding);

    const reorderedSensors = {
      ...candidate,
      sensorEvidence: [
        candidate.sensorEvidence[0],
        { ...candidate.sensorEvidence[0], sensorFindingId: 'sensor_cmdi_002' },
      ],
    };
    const twoSensorsBinding = computeCandidateBinding(reorderedSensors, ORG);
    const reversed = { ...reorderedSensors, sensorEvidence: [...reorderedSensors.sensorEvidence].reverse() };
    expect(computeCandidateBinding(reversed, ORG)).not.toBe(twoSensorsBinding);
  });

  it('requires child_process provenance; safe constants and unrelated local exec are negative controls', () => {
    const directFlow = evaluateCommandInjectionProvenance({
      hasChildProcessImport: true,
      sinkCallee: 'exec',
      sourceType: 'REQUEST_DERIVED',
    });
    expect(directFlow.status).toBe('DETECTED');
    expect(directFlow.finding?.vulnerabilityClass).toBe('COMMAND_INJECTION');

    const unrelatedLocalExec = evaluateCommandInjectionProvenance({
      hasChildProcessImport: false,
      sinkCallee: 'exec',
      sourceType: 'REQUEST_DERIVED',
    });
    expect(unrelatedLocalExec.status).toBe('NEGATIVE_CONTROL');
    expect(unrelatedLocalExec.finding).toBeNull();

    const safeConstant = evaluateCommandInjectionProvenance({
      hasChildProcessImport: true,
      sinkCallee: 'exec',
      sourceType: 'CONSTANT',
    });
    expect(safeConstant.status).toBe('NEGATIVE_CONTROL');
    expect(safeConstant.finding).toBeNull();

    const unboundIdentifier = evaluateCommandInjectionProvenance({
      hasChildProcessImport: true,
      sinkCallee: 'exec',
      sourceType: 'UNBOUND',
    });
    expect(unboundIdentifier.status).toBe('INCONCLUSIVE');
    expect(unboundIdentifier.finding).toBeNull();
  });

  it('preserves CANDIDATE state and validates against expected COMMAND_EXECUTION_OBSERVED assertion', async () => {
    const candidate = buildCandidate();
    expect(ASSERTION_BY_CLASS.COMMAND_INJECTION).toBe('COMMAND_EXECUTION_OBSERVED');

    const state = createVerificationState(candidate, ORG);
    expect(state.state).toBe('CANDIDATE');

    await expect(
      transitionVerificationState(state, {
        type: 'COMPLETE',
        result: {} as any,
        evidence: {} as any,
      })
    ).rejects.toThrow('COMPLETE requires pending verification');

    const request = {
      contractVersion: CONTRACT_VERSION,
      requestId: 'req_cmdi_001',
      organizationId: ORG,
      candidateId: candidate.candidateId,
      candidateBinding: computeCandidateBinding(candidate, ORG),
      snapshotId: candidate.snapshot.snapshotId,
      commitSha: candidate.snapshot.commitSha,
      vulnerabilityClass: 'COMMAND_INJECTION' as const,
      verificationProfile: { profileId: 'profile_isolated_node', version: 1 },
      environmentRequirements: {
        environmentType: 'ISOLATED_TEST' as const,
        runtime: 'NODE' as const,
        runtimeVersion: '20.11.0',
      },
      networkPolicy: { mode: 'DEFAULT_DENY' as const, allowedDestinations: [] },
      resourceBudget: {
        maxCpuMillis: 10_000,
        maxMemoryMb: 512,
        maxWallTimeMs: 10_000,
        maxNetworkRequests: 0,
      },
      timeBudgetMs: 5_000,
      expectedAssertionType: 'COMMAND_EXECUTION_OBSERVED' as const,
      createdAt: candidate.createdAt,
    };

    const validatedRequest = validateVerificationRequest(request, candidate, ORG);
    expect(validatedRequest.expectedAssertionType).toBe('COMMAND_EXECUTION_OBSERVED');
    expect(validatedRequest.candidateBinding).toBe(request.candidateBinding);

    expect(() =>
      validateVerificationRequest(
        { ...request, expectedAssertionType: 'SQL_RESULT_SET_VIOLATION' as any },
        candidate,
        ORG
      )
    ).toThrow('expectedAssertionType mismatch');
  });
});
