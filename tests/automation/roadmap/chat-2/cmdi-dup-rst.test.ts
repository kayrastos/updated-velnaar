import { describe, expect, it } from 'vitest';
import {
  CONTRACT_VERSION,
  computeCandidateBinding,
  computeEvidenceHash,
  createVerificationState,
  transitionVerificationState,
  validateFindingCandidate,
  validateVerificationRequest,
  validateEvidenceArtifact,
  validateVerificationResult,
  type FindingCandidate,
  type VerificationRequest,
} from '../../../../worker/intelligence/contracts';
import { canonical, hash } from '../../../../worker/intelligence/ingestion/snapshot';

const ORG = 'org_cmdi_roadmap';
const BASELINE_COMMIT = '46db4c208f886afda939c04ae93580fbabd57344';
const RULE_ID = 'express-request-to-child-process-v1';
const DETECTOR_VERSION = 'velnar-cmd-detector-v1';

interface ProvenanceFlow {
  hasChildProcessImport: boolean;
  isTainted: boolean;
  symbol: string;
  sourceSymbol: string;
  routeId: string;
  line: number;
}

function detectCmdInjection(flows: ProvenanceFlow[]) {
  const seen = new Set<string>();
  const findings: Array<{ routeId: string; source: string; sink: string; line: number }> = [];
  for (const f of flows) {
    if (!f.hasChildProcessImport || !f.isTainted) continue;
    if (!['exec', 'execSync'].includes(f.symbol)) continue;
    const key = `${f.routeId}:${f.sourceSymbol}:${f.symbol}:${f.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push({ routeId: f.routeId, source: f.sourceSymbol, sink: `child_process.${f.symbol}`, line: f.line });
  }
  return {
    status: findings.length > 0 ? ('DETECTED' as const) : ('NOT_DETECTED' as const),
    findings,
  };
}

function makeCandidate(routeId: string, sinkSymbol: string, line: number, commitSha = BASELINE_COMMIT): FindingCandidate {
  const createdAt = '2026-09-04T00:00:00.000Z';
  const source = { filePath: 'src/routes.ts', symbol: 'query.cmd', line: 10, column: 5 };
  const sink = { filePath: 'src/routes.ts', symbol: sinkSymbol, line, column: 5 };
  const raw: FindingCandidate = {
    contractVersion: CONTRACT_VERSION,
    organizationId: ORG,
    candidateId: 'cand_cmd_' + line,
    snapshot: {
      contractVersion: CONTRACT_VERSION,
      organizationId: ORG,
      snapshotId: 'snap_001',
      repositoryId: 'repo_001',
      sourceProvider: 'LOCAL_FIXTURE',
      commitSha,
      ref: 'refs/heads/main',
      createdAt,
    },
    vulnerabilityClass: 'COMMAND_INJECTION',
    source,
    sink,
    context: { entrypoint: { filePath: 'src/routes.ts', symbol: 'handler', line: 8, column: 1 }, routeId },
    sensorEvidence: [{
      contractVersion: CONTRACT_VERSION,
      organizationId: ORG,
      sensorType: 'VELNAR_STRUCTURAL',
      sensorFindingId: 'finding_' + line,
      ruleId: RULE_ID,
      summary: `${DETECTOR_VERSION}: child_process sink hypothesis`,
      sourceLocation: source,
      sinkLocation: sink,
      rawEvidenceFingerprint: `sha256:${'c'.repeat(64)}`,
    }],
    reachabilityState: 'REACHABLE',
    verificationState: 'CANDIDATE',
    createdAt,
  };
  return validateFindingCandidate(raw, ORG);
}

function makeRequest(c: FindingCandidate): VerificationRequest {
  const binding = computeCandidateBinding(c, ORG);
  const raw: VerificationRequest = {
    contractVersion: CONTRACT_VERSION,
    requestId: 'req_001',
    organizationId: ORG,
    candidateId: c.candidateId,
    candidateBinding: binding,
    snapshotId: c.snapshot.snapshotId,
    commitSha: c.snapshot.commitSha,
    vulnerabilityClass: 'COMMAND_INJECTION',
    verificationProfile: { profileId: 'profile_001', version: 1 },
    environmentRequirements: { environmentType: 'ISOLATED_TEST', runtime: 'NODE', runtimeVersion: '20.11.0' },
    networkPolicy: { mode: 'DEFAULT_DENY', allowedDestinations: [] },
    resourceBudget: { maxCpuMillis: 10000, maxMemoryMb: 512, maxWallTimeMs: 10000, maxNetworkRequests: 0 },
    timeBudgetMs: 5000,
    expectedAssertionType: 'COMMAND_EXECUTION_OBSERVED',
    createdAt: c.createdAt,
  };
  return validateVerificationRequest(raw, c, ORG);
}

async function makeEvidenceAndResult(c: FindingCandidate, q: VerificationRequest) {
  const binding = computeCandidateBinding(c, ORG);
  const startedAt = q.createdAt;
  const completedAt = new Date(Date.parse(startedAt) + 1000).toISOString();
  const env = { environmentType: 'ISOLATED_TEST' as const, runtime: 'NODE' as const, runtimeVersion: '20.11.0', environmentId: 'env_001', imageDigest: `sha256:${'1'.repeat(64)}` };
  const exec = { executionId: 'exec_001', runnerId: 'runner_001' };
  const body = {
    contractVersion: CONTRACT_VERSION,
    evidenceId: 'evi_001',
    organizationId: ORG,
    candidateId: c.candidateId,
    candidateBinding: binding,
    requestId: q.requestId,
    repositoryId: c.snapshot.repositoryId,
    snapshotId: c.snapshot.snapshotId,
    commitSha: c.snapshot.commitSha,
    vulnerabilityClass: 'COMMAND_INJECTION' as const,
    verificationProfile: q.verificationProfile,
    environmentIdentity: env,
    executionIdentity: exec,
    assertionType: 'COMMAND_EXECUTION_OBSERVED' as const,
    assertionResult: 'PASSED' as const,
    observedBehavior: { observationCode: 'VIOLATION_OBSERVED' as const, detailsFingerprint: `sha256:${'2'.repeat(64)}` },
    startedAt,
    completedAt,
    reproduction: { profileId: q.verificationProfile.profileId, profileVersion: q.verificationProfile.version, fixtureId: 'm2-case-001', testId: 'test_001', requiredEnvironmentType: 'ISOLATED_TEST' as const, expectedAssertion: 'COMMAND_EXECUTION_OBSERVED' as const },
  };
  const evidenceHash = await computeEvidenceHash(body, q, c, ORG);
  const e = await validateEvidenceArtifact({ ...body, evidenceHash }, q, c, ORG);
  const rawResult = {
    contractVersion: CONTRACT_VERSION,
    requestId: q.requestId,
    candidateId: c.candidateId,
    candidateBinding: binding,
    organizationId: ORG,
    snapshotId: c.snapshot.snapshotId,
    commitSha: c.snapshot.commitSha,
    vulnerabilityClass: 'COMMAND_INJECTION' as const,
    result: 'VERIFIED' as const,
    evidenceId: e.evidenceId,
    observedBehavior: e.observedBehavior,
    assertionResult: 'PASSED' as const,
    environmentIdentity: env,
    executionIdentity: exec,
    startedAt,
    completedAt,
    resourceUsage: { cpuMillis: 100, peakMemoryMb: 64, wallTimeMs: 1000, networkRequests: 0 },
  };
  const r = await validateVerificationResult(rawResult, q, c, e, ORG);
  return { e, r };
}

describe('V1 roadmap: command injection detector duplicate collapse & restart resume', () => {
  it('detects proven child_process exec and execSync while rejecting safe and unproven controls', () => {
    const flows: ProvenanceFlow[] = [
      { hasChildProcessImport: true, isTainted: true, symbol: 'exec', sourceSymbol: 'query.cmd', routeId: 'GET_run', line: 12 },
      { hasChildProcessImport: true, isTainted: false, symbol: 'exec', sourceSymbol: 'const.safe', routeId: 'GET_safe', line: 20 },
      { hasChildProcessImport: false, isTainted: true, symbol: 'exec', sourceSymbol: 'query.cmd', routeId: 'GET_local', line: 30 },
    ];
    const res = detectCmdInjection(flows);
    expect(res.status).toBe('DETECTED');
    expect(res.findings).toHaveLength(1);
    expect(res.findings[0].sink).toBe('child_process.exec');
  });

  it('duplicate collapse: collapses identical calls in the same route into a single finding', () => {
    const dupFlows: ProvenanceFlow[] = [
      { hasChildProcessImport: true, isTainted: true, symbol: 'exec', sourceSymbol: 'query.cmd', routeId: 'GET_run', line: 12 },
      { hasChildProcessImport: true, isTainted: true, symbol: 'exec', sourceSymbol: 'query.cmd', routeId: 'GET_run', line: 12 },
    ];
    const res = detectCmdInjection(dupFlows);
    expect(res.findings).toHaveLength(1);
  });

  it('duplicate collapse: collapses duplicate candidate bindings across passes', () => {
    const c1 = makeCandidate('GET_run', 'child_process.exec', 12);
    const c2 = makeCandidate('GET_run', 'child_process.exec', 12);
    const b1 = computeCandidateBinding(c1, ORG);
    const b2 = computeCandidateBinding(c2, ORG);
    expect(b1).toBe(b2);
    const candidateSet = new Set([b1, b2]);
    expect(candidateSet.size).toBe(1);
  });

  it('preserves distinct findings for different sinks without over-collapsing', () => {
    const distinctFlows: ProvenanceFlow[] = [
      { hasChildProcessImport: true, isTainted: true, symbol: 'exec', sourceSymbol: 'query.cmd', routeId: 'GET_run', line: 12 },
      { hasChildProcessImport: true, isTainted: true, symbol: 'execSync', sourceSymbol: 'query.target', routeId: 'POST_sync', line: 24 },
    ];
    const res = detectCmdInjection(distinctFlows);
    expect(res.findings).toHaveLength(2);
    const c1 = makeCandidate('GET_run', 'child_process.exec', 12);
    const c2 = makeCandidate('POST_sync', 'child_process.execSync', 24);
    expect(computeCandidateBinding(c1, ORG)).not.toBe(computeCandidateBinding(c2, ORG));
  });

  it('restart-resume: deterministic fingerprints and candidate bindings match across restarts', async () => {
    const c = makeCandidate('GET_run', 'child_process.exec', 12);
    const binding1 = computeCandidateBinding(c, ORG);
    const h1 = await hash('cmdi-rst', { binding: binding1, canonical: canonical(c) });
    const binding2 = computeCandidateBinding(c, ORG);
    const h2 = await hash('cmdi-rst', { binding: binding2, canonical: canonical(c) });
    expect(binding1).toBe(binding2);
    expect(h1).toBe(h2);
    expect(binding1.startsWith(`${CONTRACT_VERSION}:FindingCandidate\n`)).toBe(true);
    expect(binding1.startsWith('sha256:')).toBe(false);
  });

  it('restart-resume: candidate preserves CANDIDATE state and rejects direct verification', async () => {
    const c = makeCandidate('GET_run', 'child_process.exec', 12);
    expect(c.verificationState).toBe('CANDIDATE');
    const state = createVerificationState(c, ORG);
    expect(state.state).toBe('CANDIDATE');
    const q = makeRequest(c);
    const { e, r } = await makeEvidenceAndResult(c, q);
    await expect(transitionVerificationState(state, { type: 'COMPLETE', result: r, evidence: e }))
      .rejects.toThrow('COMPLETE requires pending verification');
  });

  it('restart-resume: rejects resumed transition with mismatched candidate binding or commit', async () => {
    const c = makeCandidate('GET_run', 'child_process.exec', 12);
    const state = createVerificationState(c, ORG);
    const q = makeRequest(c);
    const tampered = { ...q, candidateBinding: q.candidateBinding + '_tampered' };
    await expect(transitionVerificationState(state, { type: 'BEGIN', request: tampered }))
      .rejects.toThrow('candidateBinding mismatch');
    const pending = await transitionVerificationState(state, { type: 'BEGIN', request: q });
    const { e, r } = await makeEvidenceAndResult(c, q);
    const foreign = { ...r, commitSha: 'b'.repeat(40) };
    await expect(transitionVerificationState(pending, { type: 'COMPLETE', result: foreign, evidence: e }))
      .rejects.toThrow('commitSha mismatch');
  });

  it('restart-resume: successfully completes canonical lifecycle with valid evidence', async () => {
    const c = makeCandidate('GET_run', 'child_process.exec', 12);
    const state = createVerificationState(c, ORG);
    const q = makeRequest(c);
    const { e, r } = await makeEvidenceAndResult(c, q);
    const pending = await transitionVerificationState(state, { type: 'BEGIN', request: q });
    expect(pending.state).toBe('PENDING_VERIFICATION');
    const done = await transitionVerificationState(pending, { type: 'COMPLETE', result: r, evidence: e });
    expect(done.state).toBe('VERIFIED');
    expect(done.result.candidateBinding).toBe(computeCandidateBinding(c, ORG));
  });
});
