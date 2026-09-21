import { describe, expect, it, vi } from 'vitest';
import { validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

function limitedInput(insertion: string) {
  return replaceSource(input(), source => source.replace('return res.json', insertion + '; return res.json'));
}

describe('M3 SQL injection boundary rejection restart and resume determinism', () => {
  it('restarting on clean input after boundary rejection produces complete detection without state bleed', async () => {
    const limitedRun = await analyzeInput(limitedInput('while (true) {}'));
    expect(limitedRun.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(limitedRun.result.findings).toEqual([]);
    expect(limitedRun.result.limitations).toHaveLength(1);

    const cleanRun = await analyzeInput(input(0));
    expect(cleanRun.result.status).toBe('DETECTED');
    expect(cleanRun.result.findings).toHaveLength(1);
    expect(cleanRun.result.limitations).toEqual([]);
  });

  it('restarting on boundary-rejected input after successful detection fails closed immediately', async () => {
    const cleanRun = await analyzeInput(input(0));
    expect(cleanRun.result.status).toBe('DETECTED');
    expect(cleanRun.result.findings).toHaveLength(1);

    const limitedRun = await analyzeInput(limitedInput('while (true) {}'));
    expect(limitedRun.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(limitedRun.result.findings).toEqual([]);
    expect(limitedRun.result.limitations).toHaveLength(1);
  });

  it('repeated analysis restart on boundary-limited input is strictly deterministic', async () => {
    const raw = limitedInput('return searchRoute(req, res)');
    const run1 = await analyzeInput(raw);
    const run2 = await analyzeInput(raw);

    expect(run1.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run1.result.limitations[0].code).toBe('CALL_CYCLE');
    expect(run1.result).toEqual(run2.result);
    expect(run1.result.resultFingerprint).toBe(run2.result.resultFingerprint);
  });

  it('alternating different boundary limitation kinds resets limitation state on each restart', async () => {
    const cycleRun = await analyzeInput(limitedInput('return searchRoute(req, res)'));
    expect(cycleRun.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(cycleRun.result.limitations).toHaveLength(1);
    expect(cycleRun.result.limitations[0].code).toBe('CALL_CYCLE');

    const multiSourceRaw = replaceSource(input(), source => source.replace('req.query.q', '(req.query.q + req.query.other)'));
    const multiRun = await analyzeInput(multiSourceRaw);
    expect(multiRun.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(multiRun.result.limitations).toHaveLength(1);
    expect(multiRun.result.limitations[0].code).toBe('MULTIPLE_SOURCES');

    const syntaxRun = await analyzeInput(limitedInput('while (true) {}'));
    expect(syntaxRun.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(syntaxRun.result.limitations).toHaveLength(1);
    expect(syntaxRun.result.limitations[0].code).toBe('UNSUPPORTED_STATEMENT');

    const cleanRun = await analyzeInput(input(0));
    expect(cleanRun.result.status).toBe('DETECTED');
    expect(cleanRun.result.findings).toHaveLength(1);
    expect(cleanRun.result.limitations).toEqual([]);
  });

  it('validateSqlAnalysis on restarted inconclusive run verifies integrity and rejects forged status', async () => {
    const run = await analyzeInput(limitedInput('while (true) {}'));
    const validated = await validateSqlAnalysis(run.result, run.snapshot, run.ingestion, ORG);
    expect(validated).toEqual(run.result);

    const forged: any = structuredClone(run.result);
    forged.status = 'DETECTED';
    await expect(validateSqlAnalysis(forged, run.snapshot, run.ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
  });

  it('candidate bridge restart with inconclusive analysis yields no candidate hypotheses', async () => {
    const verify = vi.fn();
    const bridge = createSqlCandidateBridge(verify);
    const inconclusiveRun = await analyzeInput(limitedInput('while (true) {}'));
    const cleanRun = await analyzeInput(input(0));

    expect(await bridge(inconclusiveRun.result, inconclusiveRun.snapshot, inconclusiveRun.ingestion, ORG)).toEqual([]);
    expect(verify).not.toHaveBeenCalled();

    verify.mockResolvedValue('a'.repeat(40));
    const cleanCandidates = await bridge(cleanRun.result, cleanRun.snapshot, cleanRun.ingestion, ORG);
    expect(cleanCandidates).toHaveLength(1);
    expect(cleanCandidates[0].candidate.verificationState).toBe('CANDIDATE');
    expect(verify).toHaveBeenCalledTimes(1);

    expect(await bridge(inconclusiveRun.result, inconclusiveRun.snapshot, inconclusiveRun.ingestion, ORG)).toEqual([]);
    expect(verify).toHaveBeenCalledTimes(1);
  });
});
