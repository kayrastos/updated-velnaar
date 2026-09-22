import { describe, expect, it } from 'vitest';
import {
  computeCandidateBinding,
  createVerificationState,
  transitionVerificationState,
  validateFindingCandidate,
} from '../../../../worker/intelligence/contracts';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import {
  detectSqlInjection,
  validateSqlAnalysis,
} from '../../../../worker/intelligence/detection/sqlInjection';
import {
  captureSnapshot,
  validateSnapshot,
} from '../../../../worker/intelligence/ingestion/snapshot';
import {
  ingestExpress,
  validateExpressIngestion,
} from '../../../../worker/intelligence/ingestion/express';
import {
  analyzeInput,
  input,
  replaceSource,
  ORG,
} from '../../../intelligence/m3/support/inputs';

describe('SQL injection detector identity stability across restart and resume', () => {
  it('preserves exact snapshot, ingestion, finding, and flow identities across fresh independent analysis restarts', async () => {
    const raw = input(0);
    const run1 = await analyzeInput(raw);
    const run2 = await analyzeInput(structuredClone(raw));

    expect(run1.snapshot.snapshotId).toBe(run2.snapshot.snapshotId);
    expect(run1.ingestion.ingestionIdentity).toBe(run2.ingestion.ingestionIdentity);
    expect(run1.result.resultFingerprint).toBe(run2.result.resultFingerprint);
    expect(run1.result.findings).toHaveLength(1);
    expect(run2.result.findings).toHaveLength(1);

    const f1 = run1.result.findings[0];
    const f2 = run2.result.findings[0];
    expect(f1.findingId).toBe(f2.findingId);
    expect(f1.routeIdentity).toBe(f2.routeIdentity);
    expect(f1.flow.map(s => s.id)).toEqual(f2.flow.map(s => s.id));
  });

  it('resumes from serialized checkpoint data and passes re-validation without identity drift', async () => {
    const run = await analyzeInput(input(0));
    const serializedSnapshot = JSON.stringify(run.snapshot);
    const serializedIngestion = JSON.stringify(run.ingestion);
    const serializedResult = JSON.stringify(run.result);

    const resumedSnapshot = await validateSnapshot(JSON.parse(serializedSnapshot), ORG);
    const resumedIngestion = await validateExpressIngestion(JSON.parse(serializedIngestion), ORG);
    const resumedResult = await validateSqlAnalysis(JSON.parse(serializedResult), resumedSnapshot, resumedIngestion, ORG);

    expect(resumedSnapshot.snapshotId).toBe(run.snapshot.snapshotId);
    expect(resumedIngestion.ingestionIdentity).toBe(run.ingestion.ingestionIdentity);
    expect(resumedResult.resultFingerprint).toBe(run.result.resultFingerprint);
    expect(resumedResult.findings[0].findingId).toBe(run.result.findings[0].findingId);
  });

  it('maintains candidate hypothesis identity and candidateBinding stability across restart-resume cycles', async () => {
    const verifiedCommit = '46db4c208f886afda939c04ae93580fbabd57344';
    const bridge = createSqlCandidateBridge(async () => verifiedCommit);

    const run = await analyzeInput(input(0));
    const initialCandidates = await bridge(run.result, run.snapshot, run.ingestion, ORG);
    expect(initialCandidates).toHaveLength(1);

    const restoredSnapshot = await validateSnapshot(JSON.parse(JSON.stringify(run.snapshot)), ORG);
    const restoredIngestion = await validateExpressIngestion(JSON.parse(JSON.stringify(run.ingestion)), ORG);
    const restoredResult = await validateSqlAnalysis(JSON.parse(JSON.stringify(run.result)), restoredSnapshot, restoredIngestion, ORG);

    const resumedBridge = createSqlCandidateBridge(async () => verifiedCommit);
    const resumedCandidates = await resumedBridge(restoredResult, restoredSnapshot, restoredIngestion, ORG);

    expect(resumedCandidates).toHaveLength(1);
    expect(resumedCandidates[0].candidate.candidateId).toBe(initialCandidates[0].candidate.candidateId);
    expect(resumedCandidates[0].candidateBinding).toBe(initialCandidates[0].candidateBinding);
    expect(resumedCandidates[0].candidate.verificationState).toBe('CANDIDATE');
    expect(validateFindingCandidate(resumedCandidates[0].candidate, ORG)).toEqual(resumedCandidates[0].candidate);
  });

  it('preserves negative control stability across restarts without creating findings or candidates', async () => {
    const verifiedCommit = '46db4c208f886afda939c04ae93580fbabd57344';
    const bridge = createSqlCandidateBridge(async () => verifiedCommit);

    for (const index of [1, 3, 4]) {
      const initial = await analyzeInput(input(index));
      expect(initial.result.status).toBe('NOT_DETECTED');
      expect(initial.result.findings).toEqual([]);

      const initialHypotheses = await bridge(initial.result, initial.snapshot, initial.ingestion, ORG);
      expect(initialHypotheses).toEqual([]);

      const restarted = await analyzeInput(input(index));
      expect(restarted.result.status).toBe('NOT_DETECTED');
      expect(restarted.result.resultFingerprint).toBe(initial.result.resultFingerprint);

      const restartedHypotheses = await bridge(restarted.result, restarted.snapshot, restarted.ingestion, ORG);
      expect(restartedHypotheses).toEqual([]);
    }
  });

  it('preserves fail-closed inconclusive state and limitation identity across restart cycles', async () => {
    const limitedInput = replaceSource(input(), source => source.replace('return res.json', 'while (true) {} return res.json'));
    const initial = await analyzeInput(limitedInput);
    expect(initial.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(initial.result.findings).toEqual([]);
    expect(initial.result.limitations).toHaveLength(1);

    const restarted = await analyzeInput(limitedInput);
    expect(restarted.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(restarted.result.resultFingerprint).toBe(initial.result.resultFingerprint);
    expect(restarted.result.limitations[0].code).toBe(initial.result.limitations[0].code);

    const verifiedCommit = '46db4c208f886afda939c04ae93580fbabd57344';
    const bridge = createSqlCandidateBridge(async () => verifiedCommit);
    expect(await bridge(restarted.result, restarted.snapshot, restarted.ingestion, ORG)).toEqual([]);
  });

  it('rejects tampered identities or state elevation upon resume', async () => {
    const run = await analyzeInput(input(0));
    const serialized = JSON.parse(JSON.stringify(run.result));

    const tamperedFinding = structuredClone(serialized);
    tamperedFinding.findings[0].findingId = 'forged-finding-id';
    await expect(validateSqlAnalysis(tamperedFinding, run.snapshot, run.ingestion, ORG)).rejects.toThrow();

    const tamperedFingerprint = structuredClone(serialized);
    tamperedFingerprint.resultFingerprint = 'sha256:' + '0'.repeat(64);
    await expect(validateSqlAnalysis(tamperedFingerprint, run.snapshot, run.ingestion, ORG)).rejects.toThrow();

    const verifiedCommit = '46db4c208f886afda939c04ae93580fbabd57344';
    const bridge = createSqlCandidateBridge(async () => verifiedCommit);
    const hypotheses = await bridge(run.result, run.snapshot, run.ingestion, ORG);
    const candidate = hypotheses[0].candidate;

    const state = createVerificationState(candidate, ORG);
    expect(state.state).toBe('CANDIDATE');
    await expect(transitionVerificationState(state, {
      type: 'COMPLETE',
      result: { result: 'VERIFIED' } as any,
      evidence: {} as any,
    })).rejects.toThrow();
  });
});
