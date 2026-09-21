import { describe, expect, it } from 'vitest';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { computeCandidateBinding, createVerificationState, transitionVerificationState } from '../../../../worker/intelligence/contracts';
import { canonical } from '../../../../worker/intelligence/ingestion/snapshot';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

describe('V1 discovery-intelligence: SQL injection duplicate-collapse restart-resume roadmap', () => {
  it('restart-resume produces deterministic duplicate-collapsed findings and identical fingerprints', async () => {
    const { snapshot, ingestion, result: run1 } = await analyzeInput(input(0));
    expect(run1.status).toBe('DETECTED');
    expect(run1.findings).toHaveLength(1);

    const run2 = await detectSqlInjection(snapshot, ingestion, ORG);
    expect(run2.status).toBe('DETECTED');
    expect(run2.findings).toHaveLength(1);
    expect(run2.resultFingerprint).toBe(run1.resultFingerprint);
    expect(canonical(run1)).toBe(canonical(run2));

    const flow1 = run1.findings[0].flow;
    const flow2 = run2.findings[0].flow;
    expect(flow1).toHaveLength(flow2.length);
    expect(new Set(flow1.map(s => s.id)).size).toBe(flow1.length);
    expect(new Set(flow2.map(s => s.id)).size).toBe(flow2.length);
  });

  it('collapses alias chains and retains duplicate step suppression across restart', async () => {
    const raw = replaceSource(input(), content => content.replace('return res.json',
      'const x = req.query.q; const y = x; const z = y; return res.json')
      .replace('" + req.query.q + "', '" + z + "'));
    const { snapshot, ingestion, result: initial } = await analyzeInput(raw);
    expect(initial.status).toBe('DETECTED');
    expect(initial.findings).toHaveLength(1);

    const restarted = await detectSqlInjection(snapshot, ingestion, ORG);
    expect(restarted).toEqual(initial);
    expect(restarted.findings).toHaveLength(1);
    const flow = restarted.findings[0].flow;
    expect(flow.filter(s => s.kind === 'VARIABLE').map(s => s.location.symbol)).toEqual(['x', 'y', 'z']);
    expect(new Set(flow.map(s => s.id)).size).toBe(flow.length);
  });

  it('authoritative restart validation validateSqlAnalysis passes on duplicate-collapsed result', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(0));
    const validated = await validateSqlAnalysis(result, snapshot, ingestion, ORG);
    expect(validated).toEqual(result);
    expect(Object.isFrozen(validated)).toBe(true);
  });

  it('restart validation rejects tampered results containing duplicate findings', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(0));
    const forged = structuredClone(result);
    (forged as any).findings.push(forged.findings[0]);
    await expect(validateSqlAnalysis(forged, snapshot, ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY');
  });

  it('restart validation rejects tampered findings containing duplicate flow steps', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(0));
    const forged = structuredClone(result);
    (forged as any).findings[0].flow.push(forged.findings[0].flow[0]);
    await expect(validateSqlAnalysis(forged, snapshot, ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY');
  });

  it('resets analysis state cleanly across restart following inconclusive evaluation', async () => {
    const limitedRaw = replaceSource(input(), s => s.replace('return res.json', 'while (true) {} return res.json'));
    const limited = await analyzeInput(limitedRaw);
    expect(limited.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(limited.result.findings).toHaveLength(0);
    expect(limited.result.limitations).toHaveLength(1);

    const restarted = await analyzeInput(input(0));
    expect(restarted.result.status).toBe('DETECTED');
    expect(restarted.result.limitations).toHaveLength(0);
    expect(restarted.result.findings).toHaveLength(1);
  });

  it('candidate bridge generates exactly one hypothesis per collapsed finding across restarts', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(0));
    const checkedCommit = '46db4c208f886afda939c04ae93580fbabd57344';
    const bridge = createSqlCandidateBridge(async () => checkedCommit);

    const candidates1 = await bridge(result, snapshot, ingestion, ORG);
    const candidates2 = await bridge(result, snapshot, ingestion, ORG);
    expect(candidates1).toHaveLength(1);
    expect(candidates2).toHaveLength(1);
    expect(candidates1).toEqual(candidates2);

    const { candidate, candidateBinding } = candidates1[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.snapshot.commitSha).toBe(checkedCommit);
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
  });

  it('candidate verification state preserves CANDIDATE boundary and prevents direct completion', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(0));
    const bridge = createSqlCandidateBridge(async () => '46db4c208f886afda939c04ae93580fbabd57344');
    const [hypothesis] = await bridge(result, snapshot, ingestion, ORG);
    const state = createVerificationState(hypothesis.candidate, ORG);
    expect(state.state).toBe('CANDIDATE');

    await expect(transitionVerificationState(state, {
      type: 'COMPLETE',
      result: { result: 'VERIFIED' } as any,
      evidence: result as any,
    })).rejects.toThrow('COMPLETE requires pending');
  });
});
