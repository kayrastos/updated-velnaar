import { createHash } from 'node:crypto';
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
  ANALYSIS_LIMITS,
  DETECTOR_VERSION,
  RULE_ID,
} from '../../../../worker/intelligence/detection/types';
import { canonical } from '../../../../worker/intelligence/ingestion/snapshot';
import {
  analyzeInput,
  input,
  replaceSource,
  ORG,
} from '../../../intelligence/m3/support/inputs';

const CHECKED_COMMIT = '46db4c208f886afda939c04ae93580fbabd57344';

describe('Chat-2 roadmap: SQL injection replay determinism for multi-stage flows', () => {
  it('multi-stage fixture 2 produces deterministic detection across repeated analysis runs', async () => {
    const raw = input(2);
    const run1 = await analyzeInput(raw);
    expect(run1.result.status).toBe('DETECTED');
    expect(run1.result.findings).toHaveLength(1);
    expect(run1.result.limitations).toEqual([]);

    const run2 = await analyzeInput(raw);
    expect(run2.result).toEqual(run1.result);
    expect(run2.result.resultFingerprint).toBe(run1.result.resultFingerprint);

    const directRepeated = await detectSqlInjection(run1.snapshot, run1.ingestion, ORG);
    expect(directRepeated).toEqual(run1.result);
    expect(directRepeated.resultFingerprint).toBe(run1.result.resultFingerprint);

    const { resultFingerprint, ...body } = run1.result;
    const expectedDigest = 'sha256:' + createHash('sha256')
      .update(DETECTOR_VERSION + '\n' + canonical(body))
      .digest('hex');
    expect(resultFingerprint).toBe(expectedDigest);
  });

  it('multi-stage detection is order-independent and deterministic under file permutation', async () => {
    const raw = input(2);
    const run = await analyzeInput(raw);
    const reversedInput = { ...raw, files: [...raw.files].reverse() };
    const reversedRun = await analyzeInput(reversedInput);

    expect(reversedRun.result).toEqual(run.result);
    expect(reversedRun.result.resultFingerprint).toBe(run.result.resultFingerprint);
    expect(reversedRun.result.findings[0].flow).toEqual(run.result.findings[0].flow);
  });

  it('multi-stage flow steps are strictly ordered, unique, bounded, and immutable', async () => {
    const { result } = await analyzeInput(input(2));
    const finding = result.findings[0];

    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.flow[0].kind).toBe('SOURCE');
    expect(finding.flow.at(-1)!.kind).toBe('SINK');
    expect(finding.flow.length).toBeLessThanOrEqual(ANALYSIS_LIMITS.flowLength);

    const stepIds = finding.flow.map(step => step.id);
    expect(new Set(stepIds).size).toBe(stepIds.length);

    for (const step of finding.flow) {
      expect(step.id).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(Object.isFrozen(step.location)).toBe(true);
    }
  });

  it('synthetic multi-stage alias chain flows exhibit deterministic replay and tracking', async () => {
    const rawAlias = replaceSource(input(0), content =>
      content.replace(
        'return res.json',
        'const a = req.query.q; const b = a; const c = b; return res.json'
      ).replace('" + req.query.q + "', '" + c + "')
    );

    const run1 = await analyzeInput(rawAlias);
    expect(run1.result.status).toBe('DETECTED');
    expect(run1.result.findings).toHaveLength(1);

    const variableSymbols = run1.result.findings[0].flow
      .filter(step => step.kind === 'VARIABLE')
      .map(step => step.location.symbol);
    expect(variableSymbols).toEqual(['a', 'b', 'c']);

    const run2 = await analyzeInput(rawAlias);
    expect(run2.result).toEqual(run1.result);
    expect(run2.result.resultFingerprint).toBe(run1.result.resultFingerprint);
  });

  it('validates multi-stage analysis integrity and rejects tampered flow replay', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(2));
    const validated = await validateSqlAnalysis(result, snapshot, ingestion, ORG);
    expect(validated).toEqual(result);

    const tamperedFlow: any = structuredClone(result);
    tamperedFlow.findings[0].flow.reverse();
    await expect(validateSqlAnalysis(tamperedFlow, snapshot, ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY');

    const tamperedSource: any = structuredClone(result);
    tamperedSource.findings[0].source.column += 1;
    await expect(validateSqlAnalysis(tamperedSource, snapshot, ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY');

    const tamperedSink: any = structuredClone(result);
    tamperedSink.findings[0].sink.filePath = 'src/decoy.ts';
    await expect(validateSqlAnalysis(tamperedSink, snapshot, ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY');

    const forgedFingerprint: any = structuredClone(result);
    forgedFingerprint.resultFingerprint = 'sha256:' + 'f'.repeat(64);
    await expect(validateSqlAnalysis(forgedFingerprint, snapshot, ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY');
  });

  it('rejects multi-stage replay under tenant mismatch or mismatched snapshot', async () => {
    const run0 = await analyzeInput(input(0));
    const run2 = await analyzeInput(input(2));

    await expect(detectSqlInjection(run2.snapshot, run2.ingestion, 'foreign')).rejects.toThrow('tenant mismatch');
    await expect(detectSqlInjection(run2.snapshot, run0.ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
    await expect(validateSqlAnalysis(run2.result, run0.snapshot, run0.ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY');
  });

  it('candidate bridge deterministically binds multi-stage findings with proven commit', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(2));
    const bridge = createSqlCandidateBridge(async () => CHECKED_COMMIT);

    const hypotheses1 = await bridge(result, snapshot, ingestion, ORG);
    expect(hypotheses1).toHaveLength(1);
    const { candidate, candidateBinding } = hypotheses1[0];

    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.organizationId).toBe(ORG);
    expect(candidate.snapshot.commitSha).toBe(CHECKED_COMMIT);
    expect(candidate.sensorEvidence[0].ruleId).toBe(RULE_ID);
    expect(candidate.sensorEvidence[0].sensorType).toBe('VELNAR_STRUCTURAL');
    expect(candidate.sensorEvidence[0].rawEvidenceFingerprint).toBe(result.resultFingerprint);

    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);

    const hypotheses2 = await bridge(result, snapshot, ingestion, ORG);
    expect(hypotheses2).toEqual(hypotheses1);
    expect(hypotheses2[0].candidateBinding).toBe(candidateBinding);
  });

  it('preserves multi-stage candidate semantic replay protection and prohibits direct completion', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(2));
    const bridge = createSqlCandidateBridge(async () => CHECKED_COMMIT);
    const [{ candidate, candidateBinding }] = await bridge(result, snapshot, ingestion, ORG);

    const changedSource = { ...candidate, source: { ...candidate.source, symbol: 'mutatedSource' } };
    expect(computeCandidateBinding(changedSource, ORG)).not.toBe(candidateBinding);

    const changedSink = { ...candidate, sink: { ...candidate.sink, symbol: 'mutatedSink' } };
    expect(computeCandidateBinding(changedSink, ORG)).not.toBe(candidateBinding);

    const changedCommit = { ...candidate, snapshot: { ...candidate.snapshot, commitSha: 'b'.repeat(40) } };
    expect(computeCandidateBinding(changedCommit, ORG)).not.toBe(candidateBinding);

    const state = createVerificationState(candidate, ORG);
    expect(state.state).toBe('CANDIDATE');
    await expect(
      transitionVerificationState(state, {
        type: 'COMPLETE',
        result: { result: 'VERIFIED' } as any,
        evidence: result as any,
      })
    ).rejects.toThrow('COMPLETE requires pending verification');

    expect(() => computeCandidateBinding({ ...candidate, verificationState: 'VERIFIED' as any }, ORG)).toThrow(
      'INTELLIGENCE_PROTOCOL_ERROR:'
    );
  });

  it('fails closed when multi-stage syntax exceeds budgets or introduces inconclusive constructs', async () => {
    const inconclusiveRaw = replaceSource(input(2), content =>
      content.replace('return res.json', 'while (true) {} return res.json')
    );
    const inconclusiveRun = await analyzeInput(inconclusiveRaw);
    expect(inconclusiveRun.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(inconclusiveRun.result.findings).toEqual([]);
    expect(inconclusiveRun.result.limitations).toHaveLength(1);

    const bridge = createSqlCandidateBridge(async () => CHECKED_COMMIT);
    const candidates = await bridge(
      inconclusiveRun.result,
      inconclusiveRun.snapshot,
      inconclusiveRun.ingestion,
      ORG
    );
    expect(candidates).toEqual([]);
  });
});
