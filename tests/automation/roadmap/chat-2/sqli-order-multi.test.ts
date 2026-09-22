import { describe, expect, it } from 'vitest';
import { detectSqlInjection } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { ANALYSIS_LIMITS } from '../../../../worker/intelligence/detection/types';
import { computeCandidateBinding, validateFindingCandidate } from '../../../../worker/intelligence/contracts';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

describe('RM_SQLI_ORDER_MULTI: multi-stage SQL injection detector order stability', () => {
  it('preserves bitwise identical analysis across all file permutations for cross-file multi-stage flow', async () => {
    const raw = input(6);
    const baseline = await analyzeInput(raw);
    expect(baseline.result.status).toBe('DETECTED');
    expect(baseline.result.findings).toHaveLength(1);

    const reversed = { ...raw, files: [...raw.files].reverse() };
    const permuted = { ...raw, files: [raw.files[1], raw.files[2], raw.files[0]] };

    const runReversed = await analyzeInput(reversed);
    const runPermuted = await analyzeInput(permuted);

    expect(runReversed.result).toEqual(baseline.result);
    expect(runPermuted.result).toEqual(baseline.result);
    expect(runReversed.result.resultFingerprint).toBe(baseline.result.resultFingerprint);
    expect(runPermuted.result.resultFingerprint).toBe(baseline.result.resultFingerprint);
    expect(runReversed.snapshot.snapshotId).toBe(baseline.snapshot.snapshotId);
    expect(runPermuted.snapshot.snapshotId).toBe(baseline.snapshot.snapshotId);
  });

  it('maintains deterministic flow and fingerprint for multi-stage helper invocations', async () => {
    const raw = input(5);
    const run1 = await analyzeInput(raw);
    const run2 = await analyzeInput(raw);

    expect(run1.result.status).toBe('DETECTED');
    expect(run1.result).toEqual(run2.result);
    expect(run1.result.resultFingerprint).toBe(run2.result.resultFingerprint);

    const finding = run1.result.findings[0];
    const callSymbols = finding.flow.filter(s => s.kind === 'CALL').map(s => s.location.symbol);
    expect(callSymbols).toEqual(['lookup', 'buildQuery']);

    const stepIds = new Set(finding.flow.map(s => s.id));
    expect(stepIds.size).toBe(finding.flow.length);
    expect(finding.flow.length).toBeLessThanOrEqual(ANALYSIS_LIMITS.flowLength);
  });

  it('preserves ordered taint propagation across intermediate variable alias stages', async () => {
    const raw = replaceSource(input(0), content => content.replace(
      'return res.json',
      'const s1 = req.query.q; const s2 = s1; const s3 = s2; const s4 = s3; return res.json',
    ).replace(
      '" + req.query.q + "',
      '" + s4 + "',
    ));

    const run1 = await analyzeInput(raw);
    const run2 = await analyzeInput(raw);

    expect(run1.result.status).toBe('DETECTED');
    expect(run1.result).toEqual(run2.result);

    const varSteps = run1.result.findings[0].flow
      .filter(step => step.kind === 'VARIABLE')
      .map(step => step.location.symbol);
    expect(varSteps).toEqual(['s1', 's2', 's3', 's4']);
  });

  it('produces identical FindingCandidate hypotheses and candidateBindings for multi-stage flows', async () => {
    const raw = input(5);
    const run = await analyzeInput(raw);
    const validCommit = '46db4c208f886afda939c04ae93580fbabd57344';
    const bridge = createSqlCandidateBridge(async () => validCommit);

    const candidates1 = await bridge(run.result, run.snapshot, run.ingestion, ORG);
    const candidates2 = await bridge(run.result, run.snapshot, run.ingestion, ORG);

    expect(candidates1).toHaveLength(1);
    expect(candidates1).toEqual(candidates2);

    const { candidate, candidateBinding } = candidates1[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.snapshot.commitSha).toBe(validCommit);
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);
  });

  it('does not produce findings when intermediate multi-stage variable chain disconnects from source', async () => {
    const raw = replaceSource(input(0), content => content.replace(
      'return res.json',
      'const s1 = req.query.q; const s2 = "safe_constant"; const s3 = s2; return res.json',
    ).replace(
      '" + req.query.q + "',
      '" + s3 + "',
    ));

    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('NOT_DETECTED');
    expect(run.result.findings).toHaveLength(0);
    expect(run.result.limitations).toHaveLength(0);
  });

  it('fails closed to ANALYSIS_INCONCLUSIVE when multi-stage variable chain exceeds flow budget', async () => {
    const chain = ['const v0 = req.query.q', ...Array.from({ length: ANALYSIS_LIMITS.flowLength + 1 }, (_, i) => `const v${i + 1} = v${i}`)].join('; ');
    const raw = replaceSource(input(0), content => content.replace(
      'return res.json',
      `${chain}; return res.json`,
    ).replace(
      '" + req.query.q + "',
      `" + v${ANALYSIS_LIMITS.flowLength + 1} + "`,
    ));

    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toHaveLength(0);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('FLOW_BUDGET');
  });
});
