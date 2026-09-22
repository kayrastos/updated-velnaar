import { describe, expect, it } from 'vitest';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { computeCandidateBinding } from '../../../../worker/intelligence/contracts';
import { canonical } from '../../../../worker/intelligence/ingestion/snapshot';
import { analyzeInput, input, ORG } from '../../../intelligence/m3/support/inputs';

describe('V1 discovery-intelligence sqli-detector direct replay determinism', () => {
  it('produces identical detection results and fingerprints across multiple independent runs of direct SQL injection', async () => {
    const raw = input(0);
    const run1 = await analyzeInput(raw);
    const run2 = await analyzeInput(raw);
    const run3 = await analyzeInput(raw);

    expect(run1.result.status).toBe('DETECTED');
    expect(run1.result.findings).toHaveLength(1);
    expect(run1.result.resultFingerprint).toBe(run2.result.resultFingerprint);
    expect(run2.result.resultFingerprint).toBe(run3.result.resultFingerprint);
    expect(canonical(run1.result)).toBe(canonical(run2.result));
    expect(canonical(run2.result)).toBe(canonical(run3.result));

    const finding = run1.result.findings[0];
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.symbol).toBe('db.prepare');
    expect(finding.flow[0].kind).toBe('SOURCE');
    expect(finding.flow.at(-1)!.kind).toBe('SINK');
  });

  it('preserves exact snapshot, ingestion, and detection fingerprints regardless of input file order', async () => {
    const forward = input(0);
    const reversed = { ...forward, files: [...forward.files].reverse() };

    const runForward = await analyzeInput(forward);
    const runReversed = await analyzeInput(reversed);

    expect(runForward.snapshot.snapshotId).toBe(runReversed.snapshot.snapshotId);
    expect(runForward.ingestion.ingestionIdentity).toBe(runReversed.ingestion.ingestionIdentity);
    expect(runForward.result.resultFingerprint).toBe(runReversed.result.resultFingerprint);
    expect(canonical(runForward.result)).toBe(canonical(runReversed.result));
  });

  it('validates direct detection replay against fresh source analysis and verifies deep freeze', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(0));
    const validated1 = await validateSqlAnalysis(result, snapshot, ingestion, ORG);
    const validated2 = await validateSqlAnalysis(result, snapshot, ingestion, ORG);

    expect(canonical(validated1)).toBe(canonical(result));
    expect(canonical(validated2)).toBe(canonical(result));
    expect(Object.isFrozen(validated1)).toBe(true);
    expect(Object.isFrozen(validated1.findings[0])).toBe(true);
  });

  it('rejects tampered direct detection results during replay validation', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(0));

    const tamperedFindingId: any = structuredClone(result);
    tamperedFindingId.findings[0].findingId = 'sha256:' + '0'.repeat(64);
    await expect(validateSqlAnalysis(tamperedFindingId, snapshot, ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY');

    const tamperedFlow: any = structuredClone(result);
    tamperedFlow.findings[0].flow = [...tamperedFlow.findings[0].flow].reverse();
    await expect(validateSqlAnalysis(tamperedFlow, snapshot, ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY');

    const tamperedStatus: any = structuredClone(result);
    tamperedStatus.status = 'NOT_DETECTED';
    await expect(validateSqlAnalysis(tamperedStatus, snapshot, ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY');

    await expect(validateSqlAnalysis(result, snapshot, ingestion, 'other_org')).rejects.toThrow('tenant mismatch');
  });

  it('deterministically reports NOT_DETECTED with identical fingerprints for direct parameterized query', async () => {
    const raw = input(1);
    const run1 = await analyzeInput(raw);
    const run2 = await analyzeInput(raw);

    expect(run1.result.status).toBe('NOT_DETECTED');
    expect(run1.result.findings).toHaveLength(0);
    expect(run1.result.limitations).toHaveLength(0);
    expect(run1.result.resultFingerprint).toBe(run2.result.resultFingerprint);
    expect(canonical(run1.result)).toBe(canonical(run2.result));

    const validated = await validateSqlAnalysis(run1.result, run1.snapshot, run1.ingestion, ORG);
    expect(validated.status).toBe('NOT_DETECTED');
  });

  it('deterministically generates candidates with identical candidateBinding and CANDIDATE verificationState', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(0));
    const mockSha = 'a'.repeat(40);
    const bridge = createSqlCandidateBridge(async () => mockSha);

    const candidates1 = await bridge(result, snapshot, ingestion, ORG);
    const candidates2 = await bridge(result, snapshot, ingestion, ORG);

    expect(candidates1).toHaveLength(1);
    expect(candidates2).toHaveLength(1);

    const c1 = candidates1[0];
    const c2 = candidates2[0];

    expect(c1.candidate.verificationState).toBe('CANDIDATE');
    expect(c2.candidate.verificationState).toBe('CANDIDATE');
    expect(c1.candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(c1.candidate.snapshot.commitSha).toBe(mockSha);
    expect(c1.candidate.candidateId).toBe(c2.candidate.candidateId);
    expect(c1.candidateBinding).toBe(c2.candidateBinding);
    expect(c1.candidateBinding).toBe(computeCandidateBinding(c1.candidate, ORG));
  });

  it('produces no candidate hypotheses for direct safe control', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(1));
    const bridge = createSqlCandidateBridge(async () => 'a'.repeat(40));
    const candidates = await bridge(result, snapshot, ingestion, ORG);
    expect(candidates).toEqual([]);
  });
});
