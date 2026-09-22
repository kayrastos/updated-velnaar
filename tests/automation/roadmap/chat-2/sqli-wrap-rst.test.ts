import { describe, expect, it } from 'vitest';
import {
  CONTRACT_VERSION, computeCandidateBinding, createVerificationState, transitionVerificationState,
  validateFindingCandidate, type VerificationRequest,
} from '../../../../worker/intelligence/contracts';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { canonical } from '../../../../worker/intelligence/ingestion/snapshot';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

const CHECKED_COMMIT = '46db4c208f886afda939c04ae93580fbabd57344';

function buildWrapperFixture(isVulnerable: boolean) {
  return replaceSource(input(), source => {
    const wrapper = [
      'function executeQuery(targetDb: any, queryText: string) {',
      '  return targetDb.prepare(queryText).all();',
      '}',
      'function searchRoute',
    ].join('\n');
    let modified = source
      .replace('function searchRoute', wrapper)
      .replace('db.prepare(', 'executeQuery(db, ')
      .replace(').all()', ')');
    if (!isVulnerable) {
      modified = modified.replace('req.query.q', '"safe-value"');
    }
    return modified;
  });
}

describe('roadmap: sqli detector wrapper-boundary restart-resume', () => {
  it('detects tainted request flow passing across a database wrapper function boundary', async () => {
    const raw = buildWrapperFixture(true);
    const { snapshot, ingestion, result } = await analyzeInput(raw);

    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.symbol).toBe('db.prepare');
    expect(finding.flow.some(s => s.kind === 'CALL' && s.location.symbol === 'executeQuery')).toBe(true);
    expect(finding.flow.some(s => s.kind === 'ARGUMENT' && s.location.symbol === 'queryText')).toBe(true);

    const recomputed = await validateSqlAnalysis(result, snapshot, ingestion, ORG);
    expect(recomputed.resultFingerprint).toBe(result.resultFingerprint);
  });

  it('negative control: safe constant query passed through wrapper yields NOT_DETECTED', async () => {
    const raw = buildWrapperFixture(false);
    const { snapshot, ingestion, result } = await analyzeInput(raw);

    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toHaveLength(0);

    const bridge = createSqlCandidateBridge(async () => CHECKED_COMMIT);
    const candidates = await bridge(result, snapshot, ingestion, ORG);
    expect(candidates).toEqual([]);
  });

  it('preserves deterministic result fingerprints across restart/resume re-analysis', async () => {
    const raw = buildWrapperFixture(true);
    const run1 = await analyzeInput(raw);

    const serializedResult = canonical(run1.result);
    const rehydratedResult = JSON.parse(serializedResult);
    const validated = await validateSqlAnalysis(rehydratedResult, run1.snapshot, run1.ingestion, ORG);
    expect(validated.resultFingerprint).toBe(run1.result.resultFingerprint);

    const run2 = await detectSqlInjection(run1.snapshot, run1.ingestion, ORG);
    expect(canonical(run2)).toBe(serializedResult);
    expect(run2.resultFingerprint).toBe(run1.result.resultFingerprint);
  });

  it('bridges wrapper detection to a verified commit candidate and preserves CANDIDATE state', async () => {
    const raw = buildWrapperFixture(true);
    const { snapshot, ingestion, result } = await analyzeInput(raw);

    const bridge = createSqlCandidateBridge(async () => CHECKED_COMMIT);
    const outputs = await bridge(result, snapshot, ingestion, ORG);
    expect(outputs).toHaveLength(1);

    const { candidate, candidateBinding } = outputs[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.snapshot.commitSha).toBe(CHECKED_COMMIT);
    expect(candidate.organizationId).toBe(ORG);
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);
  });

  it('enforces candidate verification lifecycle transitions and rejects restart replay tampering', async () => {
    const raw = buildWrapperFixture(true);
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    const bridge = createSqlCandidateBridge(async () => CHECKED_COMMIT);
    const [{ candidate, candidateBinding }] = await bridge(result, snapshot, ingestion, ORG);

    const state = createVerificationState(candidate, ORG);
    expect(state.state).toBe('CANDIDATE');

    const request: VerificationRequest = {
      contractVersion: CONTRACT_VERSION,
      organizationId: ORG,
      requestId: 'req-rst-001',
      candidateId: candidate.candidateId,
      candidateBinding,
      snapshotId: candidate.snapshot.snapshotId,
      commitSha: candidate.snapshot.commitSha,
      vulnerabilityClass: 'SQL_INJECTION',
      verificationProfile: { profileId: 'default-profile', version: 1 },
      environmentRequirements: { environmentType: 'ISOLATED_TEST', runtime: 'NODE', runtimeVersion: '20.11.0' },
      networkPolicy: { mode: 'DEFAULT_DENY', allowedDestinations: [] },
      resourceBudget: { maxCpuMillis: 1000, maxMemoryMb: 512, maxWallTimeMs: 1000, maxNetworkRequests: 0 },
      timeBudgetMs: 1000,
      expectedAssertionType: 'SQL_RESULT_SET_VIOLATION',
      createdAt: candidate.createdAt,
    };

    await expect(transitionVerificationState(state, {
      type: 'COMPLETE',
      result: { result: 'VERIFIED' } as any,
      evidence: {} as any,
    })).rejects.toThrow('COMPLETE requires pending verification');

    const pending = await transitionVerificationState(state, { type: 'BEGIN', request });
    expect(pending.state).toBe('PENDING_VERIFICATION');

    const tamperedRequest = { ...request, candidateBinding: candidateBinding + ' ' };
    await expect(transitionVerificationState(state, { type: 'BEGIN', request: tamperedRequest })).rejects.toThrow();

    const mismatchedRequest = { ...request, commitSha: '0'.repeat(39) + '1' };
    await expect(transitionVerificationState(state, { type: 'BEGIN', request: mismatchedRequest })).rejects.toThrow();
  });
});
