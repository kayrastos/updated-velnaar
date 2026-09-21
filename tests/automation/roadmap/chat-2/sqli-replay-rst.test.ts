import { describe, expect, it } from 'vitest';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { captureSnapshot, validateSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress, validateExpressIngestion } from '../../../../worker/intelligence/ingestion/express';
import { computeCandidateBinding, createVerificationState, transitionVerificationState } from '../../../../worker/intelligence/contracts';
import { input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

describe('discovery-intelligence: sqli detector replay-determinism restart-resume', () => {
  it('cold capture and restart-resume restore produce identical SQL injection detections and fingerprints', async () => {
    const raw = input(0);
    const snap1 = await captureSnapshot(raw, ORG);
    const ing1 = await ingestExpress(snap1, ORG);
    const res1 = await detectSqlInjection(snap1, ing1, ORG);
    expect(res1.status).toBe('DETECTED');
    expect(res1.findings).toHaveLength(1);

    const serializedSnapshot = JSON.stringify(snap1);
    const serializedIngestion = JSON.stringify(ing1);
    const restoredSnap = await validateSnapshot(JSON.parse(serializedSnapshot), ORG);
    const restoredIng = await validateExpressIngestion(JSON.parse(serializedIngestion), ORG);
    const res2 = await detectSqlInjection(restoredSnap, restoredIng, ORG);

    expect(res2.status).toBe('DETECTED');
    expect(res2.resultFingerprint).toBe(res1.resultFingerprint);
    expect(res2).toEqual(res1);
    expect(res2.findings[0].findingId).toBe(res1.findings[0].findingId);
    expect(res2.findings[0].flow.map(s => s.id)).toEqual(res1.findings[0].flow.map(s => s.id));
  });

  it('candidate bridge produces identical CandidateHypothesis and candidateBinding after restart-resume', async () => {
    const raw = input(0);
    const snap = await captureSnapshot(raw, ORG);
    const ing = await ingestExpress(snap, ORG);
    const res = await detectSqlInjection(snap, ing, ORG);

    const testCommit = 'a'.repeat(40);
    const bridge = createSqlCandidateBridge(async () => testCommit);
    const initialCandidates = await bridge(res, snap, ing, ORG);
    expect(initialCandidates).toHaveLength(1);

    const restoredSnap = await validateSnapshot(JSON.parse(JSON.stringify(snap)), ORG);
    const restoredIng = await validateExpressIngestion(JSON.parse(JSON.stringify(ing)), ORG);
    const resumedResult = await validateSqlAnalysis(JSON.parse(JSON.stringify(res)), restoredSnap, restoredIng, ORG);
    const resumedCandidates = await bridge(resumedResult, restoredSnap, restoredIng, ORG);

    expect(resumedCandidates).toHaveLength(1);
    expect(resumedCandidates).toEqual(initialCandidates);
    expect(resumedCandidates[0].candidate.candidateId).toBe(initialCandidates[0].candidate.candidateId);
    expect(resumedCandidates[0].candidateBinding).toBe(initialCandidates[0].candidateBinding);
    expect(resumedCandidates[0].candidateBinding).toBe(computeCandidateBinding(resumedCandidates[0].candidate, ORG));
    expect(resumedCandidates[0].candidate.verificationState).toBe('CANDIDATE');
  });

  it('multi-file cross-module route retains identical flow provenance and IDs after restart-resume', async () => {
    const raw = input(6);
    const snap = await captureSnapshot(raw, ORG);
    const ing = await ingestExpress(snap, ORG);
    const res1 = await detectSqlInjection(snap, ing, ORG);
    expect(res1.status).toBe('DETECTED');
    expect(res1.findings[0].flow.some(step => step.location.filePath === 'src/repository.ts')).toBe(true);

    const restoredSnap = await validateSnapshot(JSON.parse(JSON.stringify(snap)), ORG);
    const restoredIng = await validateExpressIngestion(JSON.parse(JSON.stringify(ing)), ORG);
    const res2 = await detectSqlInjection(restoredSnap, restoredIng, ORG);

    expect(res2).toEqual(res1);
    expect(res2.resultFingerprint).toBe(res1.resultFingerprint);
    expect(res2.findings[0].flow).toEqual(res1.findings[0].flow);
  });

  it('inconclusive analysis deterministically preserves limitations and creates no candidate after restart', async () => {
    const raw = replaceSource(input(), s => s.replace('return res.json', 'while (true) {} return res.json'));
    const snap = await captureSnapshot(raw, ORG);
    const ing = await ingestExpress(snap, ORG);
    const res1 = await detectSqlInjection(snap, ing, ORG);
    expect(res1.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(res1.limitations).toHaveLength(1);

    const restoredSnap = await validateSnapshot(JSON.parse(JSON.stringify(snap)), ORG);
    const restoredIng = await validateExpressIngestion(JSON.parse(JSON.stringify(ing)), ORG);
    const res2 = await detectSqlInjection(restoredSnap, restoredIng, ORG);

    expect(res2).toEqual(res1);
    expect(res2.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(res2.resultFingerprint).toBe(res1.resultFingerprint);

    const bridge = createSqlCandidateBridge(async () => 'b'.repeat(40));
    expect(await bridge(res1, snap, ing, ORG)).toEqual([]);
    expect(await bridge(res2, restoredSnap, restoredIng, ORG)).toEqual([]);
  });

  it('clean fixture replay produces NOT_DETECTED and zero candidates before and after restart', async () => {
    const raw = input(1);
    const snap = await captureSnapshot(raw, ORG);
    const ing = await ingestExpress(snap, ORG);
    const res1 = await detectSqlInjection(snap, ing, ORG);
    expect(res1.status).toBe('NOT_DETECTED');
    expect(res1.findings).toHaveLength(0);

    const restoredSnap = await validateSnapshot(JSON.parse(JSON.stringify(snap)), ORG);
    const restoredIng = await validateExpressIngestion(JSON.parse(JSON.stringify(ing)), ORG);
    const res2 = await detectSqlInjection(restoredSnap, restoredIng, ORG);

    expect(res2).toEqual(res1);
    expect(res2.resultFingerprint).toBe(res1.resultFingerprint);

    const bridge = createSqlCandidateBridge(async () => 'c'.repeat(40));
    expect(await bridge(res1, snap, ing, ORG)).toEqual([]);
    expect(await bridge(res2, restoredSnap, restoredIng, ORG)).toEqual([]);
  });

  it('rejects tampered analysis result at the restart-resume validation boundary', async () => {
    const snap = await captureSnapshot(input(0), ORG);
    const ing = await ingestExpress(snap, ORG);
    const res = await detectSqlInjection(snap, ing, ORG);

    const tamperedFlow = JSON.parse(JSON.stringify(res));
    tamperedFlow.findings[0].flow.reverse();
    await expect(validateSqlAnalysis(tamperedFlow, snap, ing, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');

    const tamperedStatus = JSON.parse(JSON.stringify(res));
    tamperedStatus.status = 'NOT_DETECTED';
    await expect(validateSqlAnalysis(tamperedStatus, snap, ing, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');

    const tamperedRoute = JSON.parse(JSON.stringify(res));
    tamperedRoute.findings[0].routeIdentity = 'forged-route-id';
    await expect(validateSqlAnalysis(tamperedRoute, snap, ing, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
  });

  it('rejects snapshot or tenant mismatch when resuming analysis', async () => {
    const snap0 = await captureSnapshot(input(0), ORG);
    const snap1 = await captureSnapshot(input(1), ORG);
    const ing0 = await ingestExpress(snap0, ORG);
    const res0 = await detectSqlInjection(snap0, ing0, ORG);

    await expect(detectSqlInjection(snap1, ing0, ORG)).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
    await expect(validateSqlAnalysis(res0, snap1, ing0, ORG)).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
    await expect(detectSqlInjection(snap0, ing0, 'foreign_org')).rejects.toThrow('tenant mismatch');
  });

  it('restored candidate remains in CANDIDATE state and cannot directly transition to COMPLETE', async () => {
    const snap = await captureSnapshot(input(0), ORG);
    const ing = await ingestExpress(snap, ORG);
    const res = await detectSqlInjection(snap, ing, ORG);
    const bridge = createSqlCandidateBridge(async () => 'd'.repeat(40));
    const [hypothesis] = await bridge(res, snap, ing, ORG);

    const state = createVerificationState(hypothesis.candidate, ORG);
    expect(state.state).toBe('CANDIDATE');

    await expect(transitionVerificationState(state, {
      type: 'COMPLETE',
      result: { result: 'VERIFIED' } as any,
      evidence: res as any,
    })).rejects.toThrow('COMPLETE requires pending verification');
  });
});
