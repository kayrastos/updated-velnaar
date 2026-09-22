import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { SnapshotInput } from '../../../../worker/intelligence/ingestion/snapshot';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { createVerificationState, transitionVerificationState } from '../../../../worker/intelligence/contracts';
import { analyzeInput, input, ORG } from '../../../intelligence/m3/support/inputs';

function modifyFile(raw: SnapshotInput, targetPath: string, change: (content: string) => string): SnapshotInput {
  return {
    ...raw,
    files: raw.files.map(file => file.path === targetPath ? { ...file, content: change(file.content) } : file),
  };
}

describe('cross-file SQL injection stale state rejection', () => {
  let base: Awaited<ReturnType<typeof analyzeInput>>;

  beforeAll(async () => {
    base = await analyzeInput(input(6));
  });

  it('rejects stale analysis when downstream repository file changes', async () => {
    const modRepo = modifyFile(input(6), 'src/repository.ts', c => c + '\n// modified repository');
    const fresh = await analyzeInput(modRepo);

    expect(base.snapshot.snapshotId).not.toBe(fresh.snapshot.snapshotId);
    expect(base.result.resultFingerprint).not.toBe(fresh.result.resultFingerprint);

    await expect(validateSqlAnalysis(base.result, fresh.snapshot, fresh.ingestion, ORG))
      .rejects.toThrow('M3_ANALYSIS_INTEGRITY');
  });

  it('rejects stale analysis when intermediate service file changes', async () => {
    const modService = modifyFile(input(6), 'src/service.ts', c => c + '\n// modified service');
    const fresh = await analyzeInput(modService);

    expect(base.snapshot.snapshotId).not.toBe(fresh.snapshot.snapshotId);
    expect(base.result.resultFingerprint).not.toBe(fresh.result.resultFingerprint);

    await expect(validateSqlAnalysis(base.result, fresh.snapshot, fresh.ingestion, ORG))
      .rejects.toThrow('M3_ANALYSIS_INTEGRITY');
  });

  it('rejects stale analysis when entrypoint routes file changes', async () => {
    const modRoutes = modifyFile(input(6), 'src/routes.ts', c => c + '\n// modified routes');
    const fresh = await analyzeInput(modRoutes);

    expect(base.snapshot.snapshotId).not.toBe(fresh.snapshot.snapshotId);
    expect(base.result.resultFingerprint).not.toBe(fresh.result.resultFingerprint);

    await expect(validateSqlAnalysis(base.result, fresh.snapshot, fresh.ingestion, ORG))
      .rejects.toThrow('M3_ANALYSIS_INTEGRITY');
  });

  it('rejects forged analysis attempting to reuse stale findings with updated snapshotId', async () => {
    const modRepo = modifyFile(input(6), 'src/repository.ts', c => c + '\n// repo change for forgery');
    const fresh = await analyzeInput(modRepo);

    const forged = { ...base.result, snapshotId: fresh.snapshot.snapshotId };
    await expect(validateSqlAnalysis(forged, fresh.snapshot, fresh.ingestion, ORG))
      .rejects.toThrow('M3_ANALYSIS_INTEGRITY');
  });

  it('rejects cross-file snapshot and ingestion mismatch from desynchronized captures', async () => {
    const modRepo = modifyFile(input(6), 'src/repository.ts', c => c + '\n// desync check');
    const fresh = await analyzeInput(modRepo);

    await expect(detectSqlInjection(fresh.snapshot, base.ingestion, ORG))
      .rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
    await expect(detectSqlInjection(base.snapshot, fresh.ingestion, ORG))
      .rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
  });

  it('candidate bridge fails closed on stale cross-file analysis without invoking verifier', async () => {
    const modRepo = modifyFile(input(6), 'src/repository.ts', c => c + '\n// verifier bypass attempt');
    const fresh = await analyzeInput(modRepo);

    const verify = vi.fn(async () => '1'.repeat(40));
    const bridge = createSqlCandidateBridge(verify);

    await expect(bridge(base.result, fresh.snapshot, fresh.ingestion, ORG))
      .rejects.toThrow('M3_ANALYSIS_INTEGRITY');
    expect(verify).not.toHaveBeenCalled();
  });

  it('candidate bridge fails closed on stale cross-file ingestion without invoking verifier', async () => {
    const modRepo = modifyFile(input(6), 'src/repository.ts', c => c + '\n// ingestion desync');
    const fresh = await analyzeInput(modRepo);

    const verify = vi.fn(async () => '1'.repeat(40));
    const bridge = createSqlCandidateBridge(verify);

    await expect(bridge(fresh.result, fresh.snapshot, base.ingestion, ORG))
      .rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
    expect(verify).not.toHaveBeenCalled();
  });

  it('candidate semantic binding prevents replaying stale cross-file candidate across snapshot revisions', async () => {
    const commitSha = '1'.repeat(40);
    const verify = vi.fn(async () => commitSha);
    const bridge = createSqlCandidateBridge(verify);

    const modRepo = modifyFile(input(6), 'src/repository.ts', c => c + '\n// candidate revision');
    const fresh = await analyzeInput(modRepo);

    const [hypoBase] = await bridge(base.result, base.snapshot, base.ingestion, ORG);
    const [hypoFresh] = await bridge(fresh.result, fresh.snapshot, fresh.ingestion, ORG);

    expect(hypoBase.candidateBinding).not.toBe(hypoFresh.candidateBinding);
    expect(hypoBase.candidate.snapshot.snapshotId).not.toBe(hypoFresh.candidate.snapshot.snapshotId);
    expect(hypoBase.candidate.candidateId).not.toBe(hypoFresh.candidate.candidateId);

    const stateFresh = createVerificationState(hypoFresh.candidate, ORG);
    const staleRequest = {
      contractVersion: hypoBase.candidate.contractVersion,
      requestId: 'req-stale-001',
      organizationId: ORG,
      candidateId: hypoBase.candidate.candidateId,
      candidateBinding: hypoBase.candidateBinding,
      snapshotId: hypoBase.candidate.snapshot.snapshotId,
      commitSha,
      vulnerabilityClass: hypoBase.candidate.vulnerabilityClass,
      verificationProfile: { profileId: 'profile-v1', version: 1 },
      environmentRequirements: { environmentType: 'ISOLATED_TEST' as const, runtime: 'NODE' as const, runtimeVersion: '20.0.0' },
      networkPolicy: { mode: 'DEFAULT_DENY' as const, allowedDestinations: [] },
      resourceBudget: { maxCpuMillis: 10000, maxMemoryMb: 512, maxWallTimeMs: 10000, maxNetworkRequests: 0 },
      timeBudgetMs: 5000,
      expectedAssertionType: 'SQL_RESULT_SET_VIOLATION' as const,
      createdAt: hypoFresh.candidate.createdAt,
    };

    await expect(transitionVerificationState(stateFresh, { type: 'BEGIN', request: staleRequest }))
      .rejects.toThrow('candidateId mismatch');

    const staleBindingRequest = {
      ...staleRequest,
      candidateId: hypoFresh.candidate.candidateId,
      snapshotId: hypoFresh.candidate.snapshot.snapshotId,
    };
    await expect(transitionVerificationState(stateFresh, { type: 'BEGIN', request: staleBindingRequest }))
      .rejects.toThrow('candidateBinding mismatch');
  });

  it('preserves snapshot identity and analysis equivalence under file ordering permutation', async () => {
    const raw = input(6);
    const reversed = { ...raw, files: [...raw.files].reverse() };

    const [runNormal, runReversed] = await Promise.all([
      analyzeInput(raw),
      analyzeInput(reversed),
    ]);

    expect(runNormal.snapshot.snapshotId).toBe(runReversed.snapshot.snapshotId);
    expect(runNormal.ingestion.ingestionIdentity).toBe(runReversed.ingestion.ingestionIdentity);
    expect(runNormal.result.resultFingerprint).toBe(runReversed.result.resultFingerprint);

    const validated = await validateSqlAnalysis(runNormal.result, runReversed.snapshot, runReversed.ingestion, ORG);
    expect(validated.resultFingerprint).toBe(runNormal.result.resultFingerprint);
  });
});
