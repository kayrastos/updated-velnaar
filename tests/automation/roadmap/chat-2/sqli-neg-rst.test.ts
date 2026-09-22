import { describe, expect, it, vi } from 'vitest';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { captureSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress } from '../../../../worker/intelligence/ingestion/express';
import { analyzeInput, input, ORG } from '../../../intelligence/m3/support/inputs';

describe('SQL injection detector: negative-control restart-resume', () => {
  it.each([1, 3, 4])('negative fixture index %i preserves NOT_DETECTED status across restart and resume cycles', async index => {
    const raw = input(index);

    const initial = await analyzeInput(raw);
    expect(initial.result.status).toBe('NOT_DETECTED');
    expect(initial.result.findings).toEqual([]);
    expect(initial.result.limitations).toEqual([]);

    const resumed = await detectSqlInjection(initial.snapshot, initial.ingestion, ORG);
    expect(resumed).toEqual(initial.result);
    expect(resumed.resultFingerprint).toBe(initial.result.resultFingerprint);

    const freshSnapshot = await captureSnapshot(raw, ORG);
    const freshIngestion = await ingestExpress(freshSnapshot, ORG);
    const restarted = await detectSqlInjection(freshSnapshot, freshIngestion, ORG);
    expect(restarted.status).toBe('NOT_DETECTED');
    expect(restarted.findings).toEqual([]);
    expect(restarted.limitations).toEqual([]);
    expect(restarted.resultFingerprint).toBe(initial.result.resultFingerprint);

    const validated = await validateSqlAnalysis(restarted, freshSnapshot, freshIngestion, ORG);
    expect(validated).toEqual(restarted);
  });

  it.each([1, 3, 4])('negative fixture index %i yields no candidates and skips commit verification across resume', async index => {
    const { snapshot, ingestion, result } = await analyzeInput(input(index));
    const verifier = vi.fn();
    const bridge = createSqlCandidateBridge(verifier);

    const firstRun = await bridge(result, snapshot, ingestion, ORG);
    expect(firstRun).toEqual([]);
    expect(verifier).not.toHaveBeenCalled();

    const resumedResult = await detectSqlInjection(snapshot, ingestion, ORG);
    const secondRun = await bridge(resumedResult, snapshot, ingestion, ORG);
    expect(secondRun).toEqual([]);
    expect(verifier).not.toHaveBeenCalled();
  });

  it.each([1, 3, 4])('rejects tampered negative-control result on resumed validation for index %i', async index => {
    const { snapshot, ingestion, result } = await analyzeInput(input(index));
    const tampered = structuredClone(result) as any;
    tampered.status = 'DETECTED';

    await expect(validateSqlAnalysis(tampered, snapshot, ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
  });
});
