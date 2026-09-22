import { describe, expect, it } from 'vitest';
import { computeCandidateBinding, validateFindingCandidate } from '../../../../worker/intelligence/contracts';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { ANALYSIS_LIMITS, DETECTOR_VERSION } from '../../../../worker/intelligence/detection/types';
import { hash } from '../../../../worker/intelligence/ingestion/snapshot';
import { analyzeInput, input, ORG } from '../../../intelligence/m3/support/inputs';

describe('V1 discovery-intelligence: SQL injection detector cross-file replay determinism', () => {
  it('repeated cross-file analysis invocations produce strictly identical findings and fingerprints', async () => {
    const raw = input(6);
    const run1 = await analyzeInput(raw);
    const run2 = await analyzeInput(raw);
    const repeated = await detectSqlInjection(run1.snapshot, run1.ingestion, ORG);

    expect(run1.result.status).toBe('DETECTED');
    expect(run1.result.limitations).toEqual([]);
    expect(run1.result.findings).toHaveLength(1);
    expect(run1.result).toEqual(run2.result);
    expect(run1.result).toEqual(repeated);
    expect(run1.result.resultFingerprint).toBe(run2.result.resultFingerprint);
    expect(run1.result.resultFingerprint).toBe(repeated.resultFingerprint);

    const finding = run1.result.findings[0];
    const filePaths = [...new Set(finding.flow.map(step => step.location.filePath))];
    expect(filePaths).toEqual(['src/routes.ts', 'src/service.ts', 'src/repository.ts']);
    expect(finding.source.filePath).toBe('src/routes.ts');
    expect(finding.sink.filePath).toBe('src/repository.ts');
    expect(finding.flow[0].kind).toBe('SOURCE');
    expect(finding.flow.at(-1)!.kind).toBe('SINK');
  });

  it('all permutations of cross-file source ordering produce deterministic snapshots and analysis results', async () => {
    const base = input(6);
    const baseRun = await analyzeInput(base);

    const permutations = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ].map(indices => indices.map(i => base.files[i]));

    for (const files of permutations) {
      const permutedRun = await analyzeInput({ ...base, files });
      expect(permutedRun.snapshot.snapshotId).toBe(baseRun.snapshot.snapshotId);
      expect(permutedRun.ingestion.ingestionIdentity).toBe(baseRun.ingestion.ingestionIdentity);
      expect(permutedRun.result).toEqual(baseRun.result);
      expect(permutedRun.result.resultFingerprint).toBe(baseRun.result.resultFingerprint);
      expect(permutedRun.result.findings[0].findingId).toBe(baseRun.result.findings[0].findingId);
    }
  });

  it('recomputed flow node hashes and finding identifiers match canonical deterministic formulas', async () => {
    const { snapshot, result } = await analyzeInput(input(6));
    const finding = result.findings[0];

    expect(new Set(finding.flow.map(step => step.id)).size).toBe(finding.flow.length);
    expect(finding.flow.length).toBeLessThanOrEqual(ANALYSIS_LIMITS.flowLength);

    for (const step of finding.flow) {
      const { id, ...stepBody } = step;
      const expectedId = await hash('m3-flow-node-v1', {
        snapshotId: snapshot.snapshotId,
        routeIdentity: finding.routeIdentity,
        ...stepBody,
      });
      expect(id).toBe(expectedId);
    }

    const { findingId, ...findingBody } = finding;
    const expectedFindingId = await hash('m3-sqli-finding-v1', {
        snapshotId: snapshot.snapshotId,
        ...findingBody,
    });
    expect(findingId).toBe(expectedFindingId);

    const { resultFingerprint, ...resultBody } = result;
    const expectedFingerprint = await hash(DETECTOR_VERSION, resultBody);
    expect(resultFingerprint).toBe(expectedFingerprint);
  });

  it('re-validation accepts unchanged cross-file analysis and rejects tampered flows or fingerprints', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(6));
    const validated = await validateSqlAnalysis(result, snapshot, ingestion, ORG);
    expect(validated).toEqual(result);

    const tamperedFlow: any = structuredClone(result);
    tamperedFlow.findings[0].flow.reverse();
    await expect(validateSqlAnalysis(tamperedFlow, snapshot, ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');

    const tamperedFingerprint = {
      ...result,
      resultFingerprint: 'sha256:' + '0'.repeat(64),
    };
    await expect(validateSqlAnalysis(tamperedFingerprint, snapshot, ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');

    const tamperedFile: any = structuredClone(result);
    tamperedFile.findings[0].sink.filePath = 'src/service.ts';
    await expect(validateSqlAnalysis(tamperedFile, snapshot, ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
  });

  it('candidate bridge deterministically binds cross-file finding to verified commit while keeping CANDIDATE state', async () => {
    const run = await analyzeInput(input(6));
    const verifiedCommit = '46db4c208f886afda939c04ae93580fbabd57344';
    const bridge = createSqlCandidateBridge(async () => verifiedCommit);

    const output1 = await bridge(run.result, run.snapshot, run.ingestion, ORG);
    const output2 = await bridge(run.result, run.snapshot, run.ingestion, ORG);

    expect(output1).toHaveLength(1);
    expect(output1).toEqual(output2);

    const { candidate, candidateBinding } = output1[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.snapshot.commitSha).toBe(verifiedCommit);
    expect(candidate.source.filePath).toBe('src/routes.ts');
    expect(candidate.sink.filePath).toBe('src/repository.ts');
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);

    const replayedDifferentCommit = {
      ...candidate,
      snapshot: { ...candidate.snapshot, commitSha: 'b'.repeat(40) },
    };
    expect(computeCandidateBinding(replayedDifferentCommit, ORG)).not.toBe(candidateBinding);
  });

  it('negative controls and cross-file cycle limitations replay deterministically', async () => {
    const raw = input(6);
    const cyclicFiles = raw.files.map(file => file.path === 'src/repository.ts'
      ? { ...file, content: "import { lookup } from './service';\n" + file.content }
      : file);

    const cycle1 = await analyzeInput({ ...raw, files: cyclicFiles });
    const cycle2 = await analyzeInput({ ...raw, files: cyclicFiles });

    expect(cycle1.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(cycle1.result.findings).toEqual([]);
    expect(cycle1.result.limitations).toHaveLength(1);
    expect(cycle1.result.limitations[0].code).toBe('IMPORT_CYCLE');
    expect(cycle1.result).toEqual(cycle2.result);
    expect(cycle1.result.resultFingerprint).toBe(cycle2.result.resultFingerprint);

    const safe1 = await analyzeInput(input(3));
    const safe2 = await analyzeInput(input(3));

    expect(safe1.result.status).toBe('NOT_DETECTED');
    expect(safe1.result.findings).toEqual([]);
    expect(safe1.result).toEqual(safe2.result);
    expect(safe1.result.resultFingerprint).toBe(safe2.result.resultFingerprint);
  });
});
