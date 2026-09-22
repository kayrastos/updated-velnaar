import { describe, expect, it, vi } from 'vitest';
import {
  computeCandidateBinding,
  createVerificationState,
} from '../../../../worker/intelligence/contracts';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import {
  detectSqlInjection,
  validateSqlAnalysis,
} from '../../../../worker/intelligence/detection/sqlInjection';
import { captureSnapshot, type SourceSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress } from '../../../../worker/intelligence/ingestion/express';
import {
  analyzeInput,
  input,
  replaceSource,
  ORG,
} from '../../../intelligence/m3/support/inputs';

describe('Chat-2 roadmap: SQL injection detector malformed-input restart-resume resilience', () => {
  it('resumes clean detection after malformed snapshot ingestion errors', async () => {
    const baseline = await analyzeInput(input(0));
    expect(baseline.result.status).toBe('DETECTED');

    const nullByte = replaceSource(input(0), src => src + '\0');
    await expect(captureSnapshot(nullByte, ORG)).rejects.toThrow('source content');

    const badPath = { ...input(0), files: [{ path: '../escape.ts', content: 'const x = 1;' }] };
    await expect(captureSnapshot(badPath, ORG)).rejects.toThrow();

    const badCase = { ...input(0), fixtureId: 'invalid-case-id' };
    await expect(captureSnapshot(badCase, ORG)).rejects.toThrow('opaque case identity required');

    await expect(captureSnapshot(input(0), 'unauthorized_tenant')).rejects.toThrow('tenant mismatch');

    const resumed = await analyzeInput(input(0));
    expect(resumed.result.status).toBe('DETECTED');
    expect(resumed.result.resultFingerprint).toBe(baseline.result.resultFingerprint);
    expect(resumed.result.findings).toEqual(baseline.result.findings);
  });

  it('resumes clean detection after malformed Express source ingestion failures', async () => {
    const baseline = await analyzeInput(input(0));

    const syntaxErr = replaceSource(input(0), () => 'const broken = ;');
    const snapSyntax = await captureSnapshot(syntaxErr, ORG);
    await expect(ingestExpress(snapSyntax, ORG)).rejects.toThrow('malformed source unit');

    const noFactory = replaceSource(input(0), src => src.replace('function createApp', 'function buildApp'));
    const snapNoFactory = await captureSnapshot(noFactory, ORG);
    await expect(ingestExpress(snapNoFactory, ORG)).rejects.toThrow('unsupported Express factory scope');

    const noRoutes = replaceSource(input(0), src => src.replace("app.get('/search', searchRoute);", '// no routes'));
    const snapNoRoutes = await captureSnapshot(noRoutes, ORG);
    await expect(ingestExpress(snapNoRoutes, ORG)).rejects.toThrow('no supported Express route');

    const resumed = await analyzeInput(input(0));
    expect(resumed.result.status).toBe('DETECTED');
    expect(resumed.result.resultFingerprint).toBe(baseline.result.resultFingerprint);
  });

  it('interleaves malformed fail-closed inputs with valid inputs across restart-resume cycles', async () => {
    const runDetected1 = await analyzeInput(input(0));
    expect(runDetected1.result.status).toBe('DETECTED');

    const loopInput = replaceSource(input(0), src => src.replace('return res.json', 'while (true) {} return res.json'));
    const runLoop = await analyzeInput(loopInput);
    expect(runLoop.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(runLoop.result.findings).toEqual([]);

    const runSafe = await analyzeInput(input(1));
    expect(runSafe.result.status).toBe('NOT_DETECTED');
    expect(runSafe.result.findings).toEqual([]);

    const multiSource = replaceSource(input(0), src => src.replace('req.query.q', '(req.query.q + req.query.other)'));
    const runMulti = await analyzeInput(multiSource);
    expect(runMulti.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(runMulti.result.findings).toEqual([]);

    const runDetected2 = await analyzeInput(input(0));
    expect(runDetected2.result.status).toBe('DETECTED');
    expect(runDetected2.result.resultFingerprint).toBe(runDetected1.result.resultFingerprint);
  });

  it('recovers cleanly after analysis snapshot mismatches and validation tampering', async () => {
    const run0 = await analyzeInput(input(0));
    const run1 = await analyzeInput(input(1));

    await expect(detectSqlInjection(run0.snapshot, run1.ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
    await expect(validateSqlAnalysis(run0.result, run1.snapshot, run1.ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');

    const validated = await validateSqlAnalysis(run0.result, run0.snapshot, run0.ingestion, ORG);
    expect(validated.resultFingerprint).toBe(run0.result.resultFingerprint);
  });

  it('candidate bridge maintains candidate-only authority across resume after rejected verifier commits', async () => {
    const run = await analyzeInput(input(0));
    const validCommit = '1111111111111111111111111111111111111111';
    const verifyOk = vi.fn(async (_snapshot: SourceSnapshot) => validCommit);
    const verifyFail = vi.fn(async (_snapshot: SourceSnapshot) => 'bad-commit');

    const bridgeFail = createSqlCandidateBridge(verifyFail);
    await expect(bridgeFail(run.result, run.snapshot, run.ingestion, ORG)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const bridgeZero = createSqlCandidateBridge(async () => '0000000000000000000000000000000000000000');
    await expect(bridgeZero(run.result, run.snapshot, run.ingestion, ORG)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const bridgeOk = createSqlCandidateBridge(verifyOk);
    const candidates = await bridgeOk(run.result, run.snapshot, run.ingestion, ORG);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].candidate.verificationState).toBe('CANDIDATE');
    expect(candidates[0].candidate.snapshot.commitSha).toBe(validCommit);
    expect(candidates[0].candidateBinding).toBe(computeCandidateBinding(candidates[0].candidate, ORG));
    expect(createVerificationState(candidates[0].candidate, ORG).state).toBe('CANDIDATE');
  });

  it('inconclusive analysis produces no candidate hypotheses upon restart-resume', async () => {
    const incInput = replaceSource(input(0), src => src.replace('return res.json', 'eval(req.query.q); return res.json'));
    const incRun = await analyzeInput(incInput);
    expect(incRun.result.status).toBe('ANALYSIS_INCONCLUSIVE');

    const verify = vi.fn(async () => '2222222222222222222222222222222222222222');
    const bridge = createSqlCandidateBridge(verify);
    const incCandidates = await bridge(incRun.result, incRun.snapshot, incRun.ingestion, ORG);
    expect(incCandidates).toEqual([]);
    expect(verify).not.toHaveBeenCalled();

    const validRun = await analyzeInput(input(0));
    const validCandidates = await bridge(validRun.result, validRun.snapshot, validRun.ingestion, ORG);
    expect(validCandidates).toHaveLength(1);
    expect(validCandidates[0].candidate.verificationState).toBe('CANDIDATE');
    expect(verify).toHaveBeenCalledTimes(1);
  });
});
