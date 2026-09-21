import { describe, expect, it } from 'vitest';
import {
  CONTRACT_VERSION,
  computeCandidateBinding,
  createVerificationState,
  transitionVerificationState,
  validateFindingCandidate,
  validateVerificationRequest,
  type FindingCandidate,
  type VerificationRequest,
} from '../../../../worker/intelligence/contracts';
import {
  analyzeInput,
  input,
  replaceSource,
  ORG,
} from '../../../intelligence/m3/support/inputs';

describe('command-injection-detector:negative-control:nested', () => {
  it('unrelated local exec function with safe constant in nested scope produces NOT_DETECTED', async () => {
    const raw = replaceSource(input(), source =>
      source
        .replace('" + req.query.q + "', 'safe')
        .replace('return res.json',
          'function exec(c: string) { return c; }\n' +
          'function run(p: string) { return exec(p); }\n' +
          'const r = run("echo safe");\n' +
          'return res.json')
    );
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
  });

  it('unrelated local exec function with tainted input produces no command finding', async () => {
    const raw = replaceSource(input(), source =>
      source
        .replace('" + req.query.q + "', 'safe')
        .replace('return res.json',
          'function exec(c: string) { return c; }\n' +
          'function run(p: string) { return exec(p); }\n' +
          'const r = run(req.query.q);\n' +
          'return res.json')
    );
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
  });

  it('unbound identifier in nested scope fails closed with UNBOUND_NAME', async () => {
    const raw = replaceSource(input(), source =>
      source
        .replace('" + req.query.q + "', 'safe')
        .replace('return res.json',
          'function run(p: string) { return unboundExec(p); }\n' +
          'const r = run(req.query.q);\n' +
          'return res.json')
    );
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations[0].code).toBe('UNBOUND_NAME');
  });

  it('nested helper call cycle fails closed with CALL_CYCLE', async () => {
    const raw = replaceSource(input(), source =>
      source
        .replace('" + req.query.q + "', 'safe')
        .replace('function searchRoute',
          'function a(v: string): any { return b(v); }\n' +
          'function b(v: string): any { return a(v); }\n' +
          'function searchRoute')
        .replace('return res.json', 'const r = a(req.query.q);\nreturn res.json')
    );
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.limitations[0].code).toBe('CALL_CYCLE');
  });

  it('preserves canonical COMMAND_INJECTION candidate binding and CANDIDATE state boundaries', async () => {
    const createdAt = '2026-09-04T00:00:00.000Z';
    const c: FindingCandidate = {
      contractVersion: CONTRACT_VERSION,
      organizationId: ORG,
      candidateId: 'cand_cmdi_001',
      snapshot: {
        contractVersion: CONTRACT_VERSION,
        organizationId: ORG,
        snapshotId: 'snap_001',
        repositoryId: 'repo_001',
        sourceProvider: 'LOCAL_FIXTURE',
        commitSha: 'a'.repeat(40),
        ref: 'refs/heads/main',
        createdAt,
      },
      vulnerabilityClass: 'COMMAND_INJECTION',
      source: { filePath: 'src/routes.ts', symbol: 'query.q', line: 5, column: 10 },
      sink: { filePath: 'src/routes.ts', symbol: 'child_process.exec', line: 12, column: 5 },
      context: { entrypoint: { filePath: 'src/routes.ts', symbol: 'searchRoute', line: 3, column: 1 } },
      sensorEvidence: [{
        contractVersion: CONTRACT_VERSION,
        organizationId: ORG,
        sensorType: 'VELNAR_STRUCTURAL',
        sensorFindingId: 'sensor_001',
        ruleId: 'express-request-to-command-exec-v1',
        summary: 'hypothesis',
        sourceLocation: { filePath: 'src/routes.ts', symbol: 'query.q', line: 5, column: 10 },
        sinkLocation: { filePath: 'src/routes.ts', symbol: 'child_process.exec', line: 12, column: 5 },
        rawEvidenceFingerprint: 'sha256:' + '0'.repeat(64),
      }],
      reachabilityState: 'REACHABLE',
      verificationState: 'CANDIDATE',
      createdAt,
    };
    const validated = validateFindingCandidate(c, ORG);
    const binding = computeCandidateBinding(validated, ORG);
    expect(binding.startsWith(`${CONTRACT_VERSION}:FindingCandidate\n`)).toBe(true);
    expect(binding.startsWith('sha256:')).toBe(false);
    expect(() => validateFindingCandidate({ ...c, verificationState: 'VERIFIED' as any }, ORG)).toThrow('INTELLIGENCE_PROTOCOL_ERROR');

    const state = createVerificationState(validated, ORG);
    expect(state.state).toBe('CANDIDATE');
    await expect(transitionVerificationState(state, { type: 'COMPLETE', result: {} as any, evidence: {} as any })).rejects.toThrow('COMPLETE requires pending verification');

    const req: VerificationRequest = {
      contractVersion: CONTRACT_VERSION,
      organizationId: ORG,
      requestId: 'req_001',
      candidateId: validated.candidateId,
      candidateBinding: binding,
      snapshotId: validated.snapshot.snapshotId,
      commitSha: validated.snapshot.commitSha,
      vulnerabilityClass: 'COMMAND_INJECTION',
      verificationProfile: { profileId: 'prof_001', version: 1 },
      environmentRequirements: { environmentType: 'ISOLATED_TEST', runtime: 'NODE', runtimeVersion: '20.0.0' },
      networkPolicy: { mode: 'DEFAULT_DENY', allowedDestinations: [] },
      resourceBudget: { maxCpuMillis: 1000, maxMemoryMb: 512, maxWallTimeMs: 5000, maxNetworkRequests: 0 },
      timeBudgetMs: 5000,
      expectedAssertionType: 'COMMAND_EXECUTION_OBSERVED',
      createdAt,
    };
    expect(validateVerificationRequest(req, validated, ORG).expectedAssertionType).toBe('COMMAND_EXECUTION_OBSERVED');
    expect(() => validateVerificationRequest({ ...req, expectedAssertionType: 'SQL_RESULT_SET_VIOLATION' as any }, validated, ORG)).toThrow('expectedAssertionType mismatch');
  });
});
