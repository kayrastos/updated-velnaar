import { describe, expect, it, vi } from 'vitest';
import { captureSnapshot } from '../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress } from '../../../worker/intelligence/ingestion/express';
import { detectSqlInjection } from '../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../worker/intelligence/detection/candidate';
import { computeCandidateBinding, CONTRACT_VERSION } from '../../../worker/intelligence/contracts';
import { analyzeInput, input, replaceSource, ORG } from '../m3/support/inputs';

describe('M4 discovery empty input fail-closed behavior', () => {
  it('rejects empty input object at snapshot capture', async () => {
    await expect(captureSnapshot({} as any, ORG)).rejects.toThrow(/M2_INGESTION_ERROR/);
  });

  it('rejects empty files array at snapshot capture', async () => {
    const raw = { ...input(), files: [] };
    await expect(captureSnapshot(raw as any, ORG)).rejects.toThrow(/M2_INGESTION_ERROR: array bounds or shape/);
  });

  it('rejects empty organization identity at snapshot capture', async () => {
    await expect(captureSnapshot(input(), '')).rejects.toThrow(/M2_INGESTION_ERROR: identifier/);
    await expect(captureSnapshot({ ...input(), organizationId: '' }, ORG)).rejects.toThrow(/M2_INGESTION_ERROR: identifier/);
  });

  it('rejects empty repository and fixture identifiers', async () => {
    await expect(captureSnapshot({ ...input(), repositoryId: '' }, ORG)).rejects.toThrow(/M2_INGESTION_ERROR: identifier/);
    await expect(captureSnapshot({ ...input(), fixtureId: '' }, ORG)).rejects.toThrow(/M2_INGESTION_ERROR: opaque case identity required/);
  });

  it('rejects empty file path', async () => {
    const raw = { ...input(), files: [{ path: '', content: 'export const value = 1;' }] };
    await expect(captureSnapshot(raw, ORG)).rejects.toThrow(/M2_INGESTION_ERROR: repository-relative path/);
  });

  it('captures empty file content but fails closed during Express ingestion with no routes', async () => {
    const raw = { ...input(), files: [{ path: 'src/routes.ts', content: '' }] };
    const snapshot = await captureSnapshot(raw, ORG);
    expect(snapshot.files[0].byteLength).toBe(0);
    await expect(ingestExpress(snapshot, ORG)).rejects.toThrow(/M2_INGESTION_ERROR: no supported Express route/);
  });

  it('fails closed when route definition file contains only whitespace or comments', async () => {
    const raw = replaceSource(input(), () => '   \n // empty route definition\n /* comment */ \n');
    const snapshot = await captureSnapshot(raw, ORG);
    await expect(ingestExpress(snapshot, ORG)).rejects.toThrow(/M2_INGESTION_ERROR: no supported Express route/);
  });

  it('rejects Express ingestion with empty organization ID', async () => {
    const snapshot = await captureSnapshot(input(), ORG);
    await expect(ingestExpress(snapshot, '')).rejects.toThrow(/M2_INGESTION_ERROR: identifier/);
  });

  it('produces empty findings and NOT_DETECTED status for non-vulnerable inputs', async () => {
    const { result } = await analyzeInput(input(1));
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
  });

  it('produces empty findings and ANALYSIS_INCONCLUSIVE status under bounded budget violations', async () => {
    const raw = replaceSource(input(), source => source.replace('return res.json', 'while (true) {} return res.json'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
  });

  it('rejects detector invocation with empty organization ID', async () => {
    const { snapshot, ingestion } = await analyzeInput(input());
    await expect(detectSqlInjection(snapshot, ingestion, '')).rejects.toThrow(/M2_INGESTION_ERROR: identifier/);
  });

  it('returns empty candidate list and avoids commit verifier when findings are empty', async () => {
    const verify = vi.fn();
    const bridge = createSqlCandidateBridge(verify);
    const { snapshot, ingestion, result } = await analyzeInput(input(1));
    expect(result.findings).toEqual([]);
    const candidates = await bridge(result, snapshot, ingestion, ORG);
    expect(candidates).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  });

  it('returns empty candidate list when analysis status is inconclusive', async () => {
    const verify = vi.fn();
    const bridge = createSqlCandidateBridge(verify);
    const raw = replaceSource(input(), source => source.replace('return res.json', 'while (true) {} return res.json'));
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    const candidates = await bridge(result, snapshot, ingestion, ORG);
    expect(candidates).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  });

  it('rejects empty commit identity returned by trusted verifier', async () => {
    const verify = vi.fn().mockResolvedValue('');
    const bridge = createSqlCandidateBridge(verify);
    const { snapshot, ingestion, result } = await analyzeInput(input(0));
    expect(result.status).toBe('DETECTED');
    await expect(bridge(result, snapshot, ingestion, ORG)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('rejects candidate bridge invocation with empty organization ID', async () => {
    const bridge = createSqlCandidateBridge(vi.fn());
    const { snapshot, ingestion, result } = await analyzeInput(input(0));
    await expect(bridge(result, snapshot, ingestion, '')).rejects.toThrow(/M2_INGESTION_ERROR: identifier/);
  });

  it('rejects empty expected organization ID in computeCandidateBinding', async () => {
    const verify = vi.fn().mockResolvedValue('a'.repeat(40));
    const bridge = createSqlCandidateBridge(verify);
    const { snapshot, ingestion, result } = await analyzeInput(input(0));
    const hypotheses = await bridge(result, snapshot, ingestion, ORG);
    expect(hypotheses).toHaveLength(1);
    expect(() => computeCandidateBinding(hypotheses[0].candidate, '')).toThrow(/INTELLIGENCE_PROTOCOL_ERROR: invalid expectedOrganizationId/);
  });

  it('proves canonical candidate binding format starts with contract version and has no sha256 prefix', async () => {
    const verify = vi.fn().mockResolvedValue('a'.repeat(40));
    const bridge = createSqlCandidateBridge(verify);
    const { snapshot, ingestion, result } = await analyzeInput(input(0));
    const [{ candidate, candidateBinding }] = await bridge(result, snapshot, ingestion, ORG);
    expect(candidateBinding.startsWith(`${CONTRACT_VERSION}:FindingCandidate\n`)).toBe(true);
    expect(candidateBinding.startsWith('sha256:')).toBe(false);
    expect(candidate.verificationState).toBe('CANDIDATE');
  });
});
