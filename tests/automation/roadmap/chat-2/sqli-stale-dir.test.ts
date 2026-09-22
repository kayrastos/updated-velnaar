import { describe, expect, it, vi } from 'vitest';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { computeCandidateBinding } from '../../../../worker/intelligence/contracts';
import { captureSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress } from '../../../../worker/intelligence/ingestion/express';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

describe('V1 discovery-intelligence sqli-detector stale-state rejection (direct)', () => {
  it('direct analysis rejects stale snapshot when paired with updated ingestion', async () => {
    const runA = await analyzeInput(input(0));
    const modifiedInput = replaceSource(input(0), content => '\n' + content);
    const snapshotB = await captureSnapshot(modifiedInput, ORG);
    const ingestionB = await ingestExpress(snapshotB, ORG);

    expect(snapshotB.snapshotId).not.toBe(runA.snapshot.snapshotId);
    await expect(detectSqlInjection(runA.snapshot, ingestionB, ORG)).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
    await expect(detectSqlInjection(snapshotB, runA.ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
  });

  it('direct analysis rejects stale analysis result against modified direct code', async () => {
    const runA = await analyzeInput(input(0));
    const modifiedInput = replaceSource(input(0), content => '\n' + content);
    const snapshotB = await captureSnapshot(modifiedInput, ORG);
    const ingestionB = await ingestExpress(snapshotB, ORG);

    await expect(validateSqlAnalysis(runA.result, snapshotB, ingestionB, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
  });

  it('candidate bridge rejects stale direct analysis result before invoking commit verifier', async () => {
    const runA = await analyzeInput(input(0));
    const modifiedInput = replaceSource(input(0), content => '\n' + content);
    const snapshotB = await captureSnapshot(modifiedInput, ORG);
    const ingestionB = await ingestExpress(snapshotB, ORG);

    const verify = vi.fn().mockResolvedValue('a'.repeat(40));
    const bridge = createSqlCandidateBridge(verify);

    await expect(bridge(runA.result, snapshotB, ingestionB, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY');
    expect(verify).not.toHaveBeenCalled();
  });

  it('candidate bridge rejects uncommitted working fixture change before commit seal', async () => {
    const runA = await analyzeInput(input(0));
    const verifyStale = vi.fn().mockRejectedValue(new Error('working fixture changed before commit seal'));
    const bridge = createSqlCandidateBridge(verifyStale);

    await expect(bridge(runA.result, runA.snapshot, runA.ingestion, ORG)).rejects.toThrow('working fixture changed before commit seal');
    expect(verifyStale).toHaveBeenCalledTimes(1);
  });

  it('candidate bridge rejects invalid or empty commit identity from verifier', async () => {
    const runA = await analyzeInput(input(0));
    const verifyEmpty = vi.fn().mockResolvedValue('');
    const bridge = createSqlCandidateBridge(verifyEmpty);

    await expect(bridge(runA.result, runA.snapshot, runA.ingestion, ORG)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
  });

  it('detector preserves no stale state across consecutive direct route evaluations', async () => {
    const runA = await analyzeInput(input(0));
    expect(runA.result.status).toBe('DETECTED');
    expect(runA.result.findings).toHaveLength(1);

    const runSafe = await analyzeInput(input(1));
    expect(runSafe.result.status).toBe('NOT_DETECTED');
    expect(runSafe.result.findings).toHaveLength(0);

    const runAgain = await analyzeInput(input(0));
    expect(runAgain.result).toEqual(runA.result);
    expect(runAgain.result.resultFingerprint).toBe(runA.result.resultFingerprint);
  });

  it('direct candidate binding rejects stale snapshot replay', async () => {
    const runA = await analyzeInput(input(0));
    const commitSha = 'a'.repeat(40);
    const bridge = createSqlCandidateBridge(async () => commitSha);
    const candidates = await bridge(runA.result, runA.snapshot, runA.ingestion, ORG);

    expect(candidates).toHaveLength(1);
    const { candidate, candidateBinding } = candidates[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));

    const staleCandidate = { ...candidate, snapshot: { ...candidate.snapshot, commitSha: 'b'.repeat(40) } };
    expect(computeCandidateBinding(staleCandidate, ORG)).not.toBe(candidateBinding);
  });

  it('direct analysis rejects forged result with stale snapshot identifier', async () => {
    const runA = await analyzeInput(input(0));
    const staleResult = structuredClone(runA.result) as any;
    staleResult.snapshotId = 'sha256:' + '0'.repeat(64);

    await expect(validateSqlAnalysis(staleResult, runA.snapshot, runA.ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
  });
});
