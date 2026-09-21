import { describe, expect, it } from 'vitest';
import {
  computeCandidateBinding,
  createVerificationState,
  transitionVerificationState,
  type VerificationRequest,
} from '../../../../worker/intelligence/contracts';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { captureSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

const VALID_COMMIT = '1111111111111111111111111111111111111111';

describe('nested router SQL injection stale state rejection', () => {
  it('rejects stale snapshot paired with nested express ingestion', async () => {
    const nestedRun = await analyzeInput(input(7));
    const drRun = await analyzeInput(input(0));

    await expect(detectSqlInjection(drRun.snapshot, nestedRun.ingestion, ORG))
      .rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');

    const mutatedSnapshot = await captureSnapshot(
      replaceSource(input(7), content => content + '\n// snapshot mutation'),
      ORG
    );
    await expect(detectSqlInjection(mutatedSnapshot, nestedRun.ingestion, ORG))
      .rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
  });

  it('rejects stale analysis results and tampered findings in validateSqlAnalysis', async () => {
    const nestedRun = await analyzeInput(input(7));
    const drRun = await analyzeInput(input(0));

    await expect(validateSqlAnalysis(drRun.result, nestedRun.snapshot, nestedRun.ingestion, ORG))
      .rejects.toThrow('M3_ANALYSIS_INTEGRITY');

    const tamperedRouteResult = structuredClone(nestedRun.result);
    (tamperedRouteResult as any).findings[0].routeIdentity = 'stale-nested-route-id';
    await expect(validateSqlAnalysis(tamperedRouteResult, nestedRun.snapshot, nestedRun.ingestion, ORG))
      .rejects.toThrow('M3_ANALYSIS_INTEGRITY');

    const tamperedFlowResult = structuredClone(nestedRun.result);
    (tamperedFlowResult as any).findings[0].flow.reverse();
    await expect(validateSqlAnalysis(tamperedFlowResult, nestedRun.snapshot, nestedRun.ingestion, ORG))
      .rejects.toThrow('M3_ANALYSIS_INTEGRITY');
  });

  it('rejects stale analysis results or invalid commit SHA in candidate bridge', async () => {
    const nestedRun = await analyzeInput(input(7));
    const drRun = await analyzeInput(input(0));

    const bridge = createSqlCandidateBridge(async () => VALID_COMMIT);

    await expect(bridge(drRun.result, nestedRun.snapshot, nestedRun.ingestion, ORG))
      .rejects.toThrow('M3_ANALYSIS_INTEGRITY');

    const invalidCommitBridge = createSqlCandidateBridge(async () => 'not-a-commit');
    await expect(invalidCommitBridge(nestedRun.result, nestedRun.snapshot, nestedRun.ingestion, ORG))
      .rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const zeroCommitBridge = createSqlCandidateBridge(async () => '0000000000000000000000000000000000000000');
    await expect(zeroCommitBridge(nestedRun.result, nestedRun.snapshot, nestedRun.ingestion, ORG))
      .rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const candidates = await bridge(nestedRun.result, nestedRun.snapshot, nestedRun.ingestion, ORG);
    expect(candidates).toHaveLength(1);
    const { candidate, candidateBinding } = candidates[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.context.routeId).toBe(nestedRun.ingestion.routes[0].routeIdentity);
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
  });

  it('rejects stale verification state transitions and replayed bindings', async () => {
    const nestedRun = await analyzeInput(input(7));
    const bridge = createSqlCandidateBridge(async () => VALID_COMMIT);
    const [{ candidate, candidateBinding }] = await bridge(
      nestedRun.result,
      nestedRun.snapshot,
      nestedRun.ingestion,
      ORG
    );

    const state = createVerificationState(candidate, ORG);
    expect(state.state).toBe('CANDIDATE');

    await expect(
      transitionVerificationState(state, {
        type: 'COMPLETE',
        result: { result: 'VERIFIED' } as any,
        evidence: nestedRun.result as any,
      })
    ).rejects.toThrow('COMPLETE requires pending verification');

    const request: VerificationRequest = {
      contractVersion: candidate.contractVersion,
      requestId: 'req-sqli-stale-nest-1',
      organizationId: candidate.organizationId,
      candidateId: candidate.candidateId,
      candidateBinding,
      snapshotId: candidate.snapshot.snapshotId,
      commitSha: candidate.snapshot.commitSha,
      vulnerabilityClass: candidate.vulnerabilityClass,
      verificationProfile: { profileId: 'profile-v1', version: 1 },
      environmentRequirements: {
        environmentType: 'ISOLATED_TEST',
        runtime: 'NODE',
        runtimeVersion: '20.0.0',
      },
      networkPolicy: { mode: 'DEFAULT_DENY', allowedDestinations: [] },
      resourceBudget: {
        maxCpuMillis: 10000,
        maxMemoryMb: 512,
        maxWallTimeMs: 10000,
        maxNetworkRequests: 0,
      },
      timeBudgetMs: 10000,
      expectedAssertionType: 'SQL_RESULT_SET_VIOLATION',
      createdAt: candidate.createdAt,
    };

    const staleCandidate = {
      ...candidate,
      context: { ...candidate.context, routeId: 'stale-route-id' },
    };
    const staleState = createVerificationState(staleCandidate, ORG);
    await expect(
      transitionVerificationState(staleState, { type: 'BEGIN', request })
    ).rejects.toThrow('candidateBinding mismatch');

    const staleCommitRequest: VerificationRequest = {
      ...request,
      commitSha: '2222222222222222222222222222222222222222',
    };
    await expect(
      transitionVerificationState(state, { type: 'BEGIN', request: staleCommitRequest })
    ).rejects.toThrow('commitSha mismatch');

    const pending = await transitionVerificationState(state, { type: 'BEGIN', request });
    expect(pending.state).toBe('PENDING_VERIFICATION');

    await expect(
      transitionVerificationState(pending, { type: 'BEGIN', request })
    ).rejects.toThrow();
  });
});
