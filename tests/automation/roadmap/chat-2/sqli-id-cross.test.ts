import { describe, expect, it } from 'vitest';
import { computeCandidateBinding, validateFindingCandidate, type FindingCandidate } from '../../../../worker/intelligence/contracts';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { analyzeInput, input, ORG } from '../../../intelligence/m3/support/inputs';

describe('cross-file SQL injection detector identity stability (RM_SQLI_ID_CROSS)', () => {
  it('determines cross-file SQL injection findings with stable fingerprint and unique flow node IDs', async () => {
    const run = await analyzeInput(input(6));
    expect(run.result.status).toBe('DETECTED');
    expect(run.result.findings).toHaveLength(1);

    const finding = run.result.findings[0];
    if (!finding) throw new Error('expected finding');

    expect(finding.source.filePath).toBe('src/routes.ts');
    expect(finding.sink.filePath).toBe('src/repository.ts');

    const filesInFlow = [...new Set(finding.flow.map(step => step.location.filePath))].sort();
    expect(filesInFlow).toEqual(['src/repository.ts', 'src/routes.ts', 'src/service.ts']);

    const flowIds = finding.flow.map(step => step.id);
    expect(new Set(flowIds).size).toBe(flowIds.length);
    expect(flowIds.length).toBeGreaterThan(0);
  });

  it('preserves detection results, fingerprints, and flow IDs across repeated analysis and file reordering', async () => {
    const run = await analyzeInput(input(6));

    const repeated = await detectSqlInjection(run.snapshot, run.ingestion, ORG);
    expect(repeated).toEqual(run.result);

    const raw = input(6);
    const reversed = { ...raw, files: [...raw.files].reverse() };
    const runReversed = await analyzeInput(reversed);
    expect(runReversed.result).toEqual(run.result);
    expect(runReversed.result.resultFingerprint).toBe(run.result.resultFingerprint);

    const validated = await validateSqlAnalysis(run.result, run.snapshot, run.ingestion, ORG);
    expect(validated).toEqual(run.result);
  });

  it('generates stable candidate identity and binding for cross-file detection', async () => {
    const run = await analyzeInput(input(6));
    const commitSha = '46db4c208f886afda939c04ae93580fbabd57344';
    const bridge = createSqlCandidateBridge(async (snapshot) => {
      expect(snapshot.snapshotId).toBe(run.snapshot.snapshotId);
      return commitSha;
    });

    const hypotheses1 = await bridge(run.result, run.snapshot, run.ingestion, ORG);
    const hypotheses2 = await bridge(run.result, run.snapshot, run.ingestion, ORG);
    expect(hypotheses1).toHaveLength(1);

    const h1 = hypotheses1[0];
    if (!h1) throw new Error('expected hypothesis');
    const h2 = hypotheses2[0];
    if (!h2) throw new Error('expected hypothesis');

    expect(h1).toEqual(h2);
    expect(h1.candidate.candidateId).toBe(h2.candidate.candidateId);
    expect(h1.candidateBinding).toBe(h2.candidateBinding);
    expect(h1.candidate.verificationState).toBe('CANDIDATE');
    expect(h1.candidate.reachabilityState).toBe('REACHABLE');
    expect(h1.candidate.source.filePath).toBe('src/routes.ts');
    expect(h1.candidate.sink.filePath).toBe('src/repository.ts');
    expect(h1.candidateBinding).toBe(computeCandidateBinding(h1.candidate, ORG));
    expect(validateFindingCandidate(h1.candidate, ORG)).toEqual(h1.candidate);
  });

  it('enforces tenant isolation and rejects tampered candidate identity', async () => {
    const run = await analyzeInput(input(6));
    const commitSha = '46db4c208f886afda939c04ae93580fbabd57344';
    const bridge = createSqlCandidateBridge(async () => commitSha);

    await expect(detectSqlInjection(run.snapshot, run.ingestion, 'foreign_org')).rejects.toThrow('tenant mismatch');
    await expect(bridge(run.result, run.snapshot, run.ingestion, 'foreign_org')).rejects.toThrow('tenant mismatch');

    const hypotheses = await bridge(run.result, run.snapshot, run.ingestion, ORG);
    const h1 = hypotheses[0];
    if (!h1) throw new Error('expected hypothesis');

    const altered: FindingCandidate = { ...h1.candidate, sink: { ...h1.candidate.sink, symbol: 'other-sink' } };
    expect(computeCandidateBinding(altered, ORG)).not.toBe(h1.candidateBinding);
  });
});
