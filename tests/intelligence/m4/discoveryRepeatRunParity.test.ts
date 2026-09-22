import { describe, expect, it } from 'vitest';
import { computeCandidateBinding } from '../../../worker/intelligence/contracts';
import { createSqlCandidateBridge } from '../../../worker/intelligence/detection/candidate';
import { validateSqlAnalysis } from '../../../worker/intelligence/detection/sqlInjection';
import { canonical } from '../../../worker/intelligence/ingestion/snapshot';
import { verifyCommittedFixture } from '../m2/support/gitCodeState';
import { analyzeInput, input, replaceSource, ORG } from '../m3/support/inputs';

const bridge = createSqlCandidateBridge(verifyCommittedFixture);

describe('M4 discovery repeated-run parity and determinism', () => {
  it('produces identical snapshot, ingestion, detection, and candidate hypotheses over sequential runs', async () => {
    const fixture = input(0);
    const runs = [];
    for (let i = 0; i < 5; i++) {
      runs.push(await analyzeInput(fixture));
    }
    const baseline = runs[0];
    for (let i = 1; i < runs.length; i++) {
      expect(runs[i].snapshot.snapshotId).toBe(baseline.snapshot.snapshotId);
      expect(runs[i].ingestion.ingestionIdentity).toBe(baseline.ingestion.ingestionIdentity);
      expect(runs[i].result.resultFingerprint).toBe(baseline.result.resultFingerprint);
      expect(runs[i].result.status).toBe('DETECTED');
      expect(canonical(runs[i].result)).toBe(canonical(baseline.result));
    }
    const candidateOutputs = await Promise.all(
      runs.map(run => bridge(run.result, run.snapshot, run.ingestion, ORG))
    );
    expect(candidateOutputs[0]).toHaveLength(1);
    const baselineHypothesis = candidateOutputs[0][0];
    for (let i = 1; i < candidateOutputs.length; i++) {
      expect(canonical(candidateOutputs[i])).toBe(canonical(candidateOutputs[0]));
      expect(candidateOutputs[i][0].candidate.candidateId).toBe(baselineHypothesis.candidate.candidateId);
      expect(candidateOutputs[i][0].candidateBinding).toBe(baselineHypothesis.candidateBinding);
    }
  });

  it('preserves complete result parity across concurrent executions without state leakage', async () => {
    const fixture = input(6);
    const parallelRuns = await Promise.all([
      analyzeInput(fixture),
      analyzeInput(fixture),
      analyzeInput(fixture),
      analyzeInput(fixture),
    ]);
    const canonicalBaseline = canonical(parallelRuns[0].result);
    for (const run of parallelRuns) {
      expect(canonical(run.result)).toBe(canonicalBaseline);
      expect(run.result.resultFingerprint).toBe(parallelRuns[0].result.resultFingerprint);
    }
  });

  it('guarantees file permutation invariance across repeated discovery runs', async () => {
    const raw = input(6);
    const reversed = { ...raw, files: [...raw.files].reverse() };
    const runA = await analyzeInput(raw);
    const runB = await analyzeInput(reversed);
    expect(runB.snapshot.snapshotId).toBe(runA.snapshot.snapshotId);
    expect(runB.ingestion.ingestionIdentity).toBe(runA.ingestion.ingestionIdentity);
    expect(runB.result.resultFingerprint).toBe(runA.result.resultFingerprint);
    expect(canonical(runB.result)).toBe(canonical(runA.result));
  });

  it('preserves repeated-run parity for clean negative controls with zero candidate bridge emissions', async () => {
    const fixture = input(1);
    const runs = await Promise.all([
      analyzeInput(fixture),
      analyzeInput(fixture),
      analyzeInput(fixture),
    ]);
    for (const run of runs) {
      expect(run.result.status).toBe('NOT_DETECTED');
      expect(run.result.findings).toEqual([]);
      expect(run.result.resultFingerprint).toBe(runs[0].result.resultFingerprint);
      const candidates = await bridge(run.result, run.snapshot, run.ingestion, ORG);
      expect(candidates).toEqual([]);
    }
  });

  it('preserves repeated-run parity for fail-closed inconclusive limitations', async () => {
    const inconclusiveInput = replaceSource(input(), source =>
      source.replace('return res.json', 'while (true) {} return res.json')
    );
    const runs = [
      await analyzeInput(inconclusiveInput),
      await analyzeInput(inconclusiveInput),
    ];
    expect(runs[0].result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(runs[1].result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(runs[0].result.limitations).toEqual(runs[1].result.limitations);
    expect(runs[0].result.resultFingerprint).toBe(runs[1].result.resultFingerprint);
    expect(canonical(runs[0].result)).toBe(canonical(runs[1].result));
  });

  it('retains deterministic candidate semantic binding identity across repeated evaluations', async () => {
    const run = await analyzeInput(input(0));
    const [hypothesis] = await bridge(run.result, run.snapshot, run.ingestion, ORG);
    const initialBinding = hypothesis.candidateBinding;
    for (let i = 0; i < 5; i++) {
      expect(computeCandidateBinding(hypothesis.candidate, ORG)).toBe(initialBinding);
    }
  });

  it('repeatedly validates analysis integrity against snapshot and rejects tampering', async () => {
    const run = await analyzeInput(input(0));
    for (let i = 0; i < 3; i++) {
      const validated = await validateSqlAnalysis(run.result, run.snapshot, run.ingestion, ORG);
      expect(canonical(validated)).toBe(canonical(run.result));
    }
    const tampered = { ...run.result, resultFingerprint: 'sha256:' + 'f'.repeat(64) };
    await expect(validateSqlAnalysis(tampered, run.snapshot, run.ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY');
  });
});
