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
import { detachJson } from '../../../../worker/intelligence/ingestion/snapshot';
import { parseUnit } from '../../../../worker/intelligence/ingestion/express';

const ORG = 'org_cmd_nest_test';
const COMMIT = 'a'.repeat(40);
const FINGERPRINT = `sha256:${'b'.repeat(64)}`;
const CREATED_AT = '2026-09-04T00:00:00.000Z';

function reverseKeys(value: any): any {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reverseKeys(v)]));
  }
  return value;
}

function createCmdCandidate(): FindingCandidate {
  return {
    contractVersion: CONTRACT_VERSION,
    organizationId: ORG,
    candidateId: 'cmd-candidate-001',
    snapshot: {
      contractVersion: CONTRACT_VERSION,
      organizationId: ORG,
      snapshotId: 'snap-001',
      repositoryId: 'repo-001',
      sourceProvider: 'LOCAL_FIXTURE',
      commitSha: COMMIT,
      ref: 'refs/heads/main',
      createdAt: CREATED_AT,
    },
    vulnerabilityClass: 'COMMAND_INJECTION',
    source: {
      filePath: 'src/routes.ts',
      symbol: 'req.query.cmd',
      line: 10,
      column: 15,
    },
    sink: {
      filePath: 'src/routes.ts',
      symbol: 'child_process.exec',
      line: 12,
      column: 5,
    },
    context: {
      entrypoint: {
        filePath: 'src/routes.ts',
        symbol: 'execRoute',
        line: 8,
        column: 1,
      },
      routeId: 'GET.exec',
    },
    sensorEvidence: [
      {
        contractVersion: CONTRACT_VERSION,
        organizationId: ORG,
        sensorType: 'VELNAR_STRUCTURAL',
        sensorFindingId: 'sensor-cmd-001',
        ruleId: 'express-request-to-child-process-exec-v1',
        summary: 'Untrusted request input flowing to child_process.exec',
        sourceLocation: {
          filePath: 'src/routes.ts',
          symbol: 'req.query.cmd',
          line: 10,
          column: 15,
        },
        sinkLocation: {
          filePath: 'src/routes.ts',
          symbol: 'child_process.exec',
          line: 12,
          column: 5,
        },
        rawEvidenceFingerprint: FINGERPRINT,
      },
    ],
    reachabilityState: 'REACHABLE',
    verificationState: 'CANDIDATE',
    createdAt: CREATED_AT,
  };
}

describe('command injection detector: malformed-input nested roadmap tests', () => {
  it('validates canonical COMMAND_INJECTION candidate and enforces CANDIDATE verificationState', () => {
    const candidate = createCmdCandidate();
    const validated = validateFindingCandidate(candidate, ORG);
    expect(validated.vulnerabilityClass).toBe('COMMAND_INJECTION');
    expect(validated.verificationState).toBe('CANDIDATE');
    expect(validated.reachabilityState).toBe('REACHABLE');
    expect(Object.isFrozen(validated)).toBe(true);
  });

  it('computes exact canonical candidate binding without sha256 prefix and ignores nested key order', () => {
    const candidate = createCmdCandidate();
    const binding = computeCandidateBinding(candidate, ORG);
    expect(binding.startsWith(`${CONTRACT_VERSION}:FindingCandidate\n`)).toBe(true);
    expect(binding.startsWith('sha256:')).toBe(false);
    expect(computeCandidateBinding(reverseKeys(candidate), ORG)).toBe(binding);
  });

  it('changes candidate binding on nested semantic mutation in source, sink, route context, or evidence', () => {
    const candidate = createCmdCandidate();
    const baseline = computeCandidateBinding(candidate, ORG);

    const alteredSource = { ...candidate, source: { ...candidate.source, symbol: 'req.query.other' } };
    expect(computeCandidateBinding(alteredSource, ORG)).not.toBe(baseline);

    const alteredSink = { ...candidate, sink: { ...candidate.sink, symbol: 'child_process.execSync' } };
    expect(computeCandidateBinding(alteredSink, ORG)).not.toBe(baseline);

    const alteredRoute = { ...candidate, context: { ...candidate.context, routeId: 'POST.exec' } };
    expect(computeCandidateBinding(alteredRoute, ORG)).not.toBe(baseline);

    const alteredEvidence = {
      ...candidate,
      sensorEvidence: [{ ...candidate.sensorEvidence[0], ruleId: 'other-cmd-rule' }],
    };
    expect(computeCandidateBinding(alteredEvidence, ORG)).not.toBe(baseline);
  });

  it('rejects nested malformed filePath with traversal in command injection location', () => {
    const bad = structuredClone(createCmdCandidate());
    (bad.source as any).filePath = '../etc/passwd';
    expect(() => validateFindingCandidate(bad, ORG)).toThrow('INTELLIGENCE_PROTOCOL_ERROR: filePath must be repository-relative');
  });

  it('rejects nested malformed filePath with absolute root path in command injection sink', () => {
    const bad = structuredClone(createCmdCandidate());
    (bad.sink as any).filePath = '/src/routes.ts';
    expect(() => validateFindingCandidate(bad, ORG)).toThrow('INTELLIGENCE_PROTOCOL_ERROR: filePath must be repository-relative');
  });

  it('rejects column without line in nested candidate location', () => {
    const bad = structuredClone(createCmdCandidate());
    delete (bad.source as any).line;
    expect(() => validateFindingCandidate(bad, ORG)).toThrow('INTELLIGENCE_PROTOCOL_ERROR: column requires line');
  });

  it('rejects non-data accessor properties in nested sensor evidence', () => {
    const bad = structuredClone(createCmdCandidate());
    let invoked = false;
    Object.defineProperty(bad.sensorEvidence[0].sourceLocation, 'symbol', {
      get() { invoked = true; return 'tainted'; },
      enumerable: true,
    });
    expect(() => validateFindingCandidate(bad, ORG)).toThrow('INTELLIGENCE_PROTOCOL_ERROR: non-data field');
    expect(invoked).toBe(false);
  });

  it('rejects non-CANDIDATE verificationState and prevents direct transition to VERIFIED', async () => {
    const bad = { ...createCmdCandidate(), verificationState: 'VERIFIED' as any };
    expect(() => validateFindingCandidate(bad, ORG)).toThrow('INTELLIGENCE_PROTOCOL_ERROR: invalid verificationState');

    const candidate = createCmdCandidate();
    const state = createVerificationState(candidate, ORG);
    expect(state.state).toBe('CANDIDATE');
    await expect(transitionVerificationState(state, { type: 'COMPLETE', result: {} as any, evidence: {} as any }))
      .rejects.toThrow('COMPLETE requires pending verification');
  });

  it('rejects all-zero commit SHA in snapshot provenance', () => {
    const bad = structuredClone(createCmdCandidate());
    (bad.snapshot as any).commitSha = '0'.repeat(40);
    expect(() => validateFindingCandidate(bad, ORG)).toThrow('INTELLIGENCE_PROTOCOL_ERROR: invalid commitSha');
  });

  it('fails closed when nested metadata depth exceeds structural limit in detachJson', () => {
    let nested: any = 'leaf';
    for (let i = 0; i < 20; i++) {
      nested = { next: nested };
    }
    expect(() => detachJson(nested)).toThrow('M2_INGESTION_ERROR: metadata complexity');
  });

  it('fails closed when nested Express route source has parser diagnostics', () => {
    const malformed = 'function createApp() { const app = express(); app.get("/run", (req, res => { exec(req.query.cmd); }); }';
    expect(() => parseUnit('src/routes.ts', malformed)).toThrow('M2_INGESTION_ERROR: malformed source unit');
  });

  it('validates COMMAND_INJECTION verification request with exact assertion type and rejects mismatches', () => {
    const candidate = createCmdCandidate();
    const binding = computeCandidateBinding(candidate, ORG);
    const req: VerificationRequest = {
      contractVersion: CONTRACT_VERSION,
      requestId: 'req-cmd-001',
      organizationId: ORG,
      candidateId: candidate.candidateId,
      candidateBinding: binding,
      snapshotId: candidate.snapshot.snapshotId,
      commitSha: candidate.snapshot.commitSha,
      vulnerabilityClass: 'COMMAND_INJECTION',
      verificationProfile: { profileId: 'profile-cmd-v1', version: 1 },
      environmentRequirements: {
        environmentType: 'ISOLATED_TEST',
        runtime: 'NODE',
        runtimeVersion: '20.11.0',
      },
      networkPolicy: {
        mode: 'DEFAULT_DENY',
        allowedDestinations: [],
      },
      resourceBudget: {
        maxCpuMillis: 10_000,
        maxMemoryMb: 512,
        maxWallTimeMs: 10_000,
        maxNetworkRequests: 0,
      },
      timeBudgetMs: 5_000,
      expectedAssertionType: ASSERTION_BY_CLASS.COMMAND_INJECTION,
      createdAt: CREATED_AT,
    };

    const validated = validateVerificationRequest(req, candidate, ORG);
    expect(validated.expectedAssertionType).toBe('COMMAND_EXECUTION_OBSERVED');
    expect(validated.candidateBinding).toBe(binding);

    const badAssertion = { ...req, expectedAssertionType: 'SQL_RESULT_SET_VIOLATION' as any };
    expect(() => validateVerificationRequest(badAssertion, candidate, ORG))
      .toThrow('INTELLIGENCE_PROTOCOL_ERROR: expectedAssertionType mismatch');

    const badBinding = { ...req, candidateBinding: binding + 'altered' };
    expect(() => validateVerificationRequest(badBinding, candidate, ORG))
      .toThrow('INTELLIGENCE_PROTOCOL_ERROR: candidateBinding mismatch');
  });
});
