import { beforeAll, describe, expect, it } from 'vitest';
import { CONTRACT_VERSION, computeCandidateBinding, validateFindingCandidate } from '../../../worker/intelligence/contracts';
import { createSqlCandidateBridge } from '../../../worker/intelligence/detection/candidate';
import { detectSqlInjection, validateSqlAnalysis } from '../../../worker/intelligence/detection/sqlInjection';
import { DETECTOR_VERSION, RULE_ID } from '../../../worker/intelligence/detection/types';
import { canonical, hash } from '../../../worker/intelligence/ingestion/snapshot';
import { currentCodeCommit, verifyCommittedFixture } from '../m2/support/gitCodeState';
import { analyzeInput, input, replaceSource, ORG } from '../m3/support/inputs';

const bridge = createSqlCandidateBridge(verifyCommittedFixture);
let runs: Awaited<ReturnType<typeof analyzeInput>>[];

beforeAll(async () => {
  runs = [];
  for (let i = 0; i < 8; i++) {
    runs.push(await analyzeInput(input(i)));
  }
});

describe('M4 Discovery Determinism: deterministic finding fingerprint', () => {
  it('produces byte-identical findings and stable fingerprints across repeated analysis runs', async () => {
    const run0 = runs[0];
    const repeated = await detectSqlInjection(run0.snapshot, run0.ingestion, ORG);

    expect(repeated).toEqual(run0.result);
    expect(repeated.resultFingerprint).toBe(run0.result.resultFingerprint);
    expect(repeated.resultFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);

    expect(repeated.findings).toHaveLength(1);
    const finding = repeated.findings[0];
    expect(finding.findingId).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');

    for (const step of finding.flow) {
      expect(step.id).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
  });

  it('produces identical finding fingerprints regardless of input file ordering in the snapshot', async () => {
    const rawReversed = { ...input(6), files: [...input(6).files].reverse() };
    const analyzedReversed = await analyzeInput(rawReversed);

    expect(analyzedReversed.result).toEqual(runs[6].result);
    expect(analyzedReversed.result.findings[0].findingId).toBe(runs[6].result.findings[0].findingId);
    expect(analyzedReversed.result.resultFingerprint).toBe(runs[6].result.resultFingerprint);
  });

  it('independently computes and verifies the canonical flow step and finding fingerprint hashes', async () => {
    const run = runs[0];
    const finding = run.result.findings[0];

    for (const step of finding.flow) {
      const stepBody = {
        snapshotId: run.snapshot.snapshotId,
        routeIdentity: finding.routeIdentity,
        kind: step.kind,
        location: step.location,
      };
      const expectedStepId = await hash('m3-flow-node-v1', stepBody);
      expect(step.id).toBe(expectedStepId);
    }

    const findingBody = {
      snapshotId: run.snapshot.snapshotId,
      routeIdentity: finding.routeIdentity,
      vulnerabilityClass: finding.vulnerabilityClass,
      source: finding.source,
      sink: finding.sink,
      flow: finding.flow,
    };
    const expectedFindingId = await hash('m3-sqli-finding-v1', findingBody);
    expect(finding.findingId).toBe(expectedFindingId);
  });

  it('changes finding and result fingerprints when source locations change', async () => {
    const modified = await analyzeInput(replaceSource(input(0), content => '\n' + content));

    expect(modified.result.status).toBe('DETECTED');
    expect(modified.result.resultFingerprint).not.toBe(runs[0].result.resultFingerprint);
    expect(modified.result.findings[0].findingId).not.toBe(runs[0].result.findings[0].findingId);
    expect(modified.result.findings[0].source.line).toBe(runs[0].result.findings[0].source.line + 1);
  });

  it('generates distinct deterministic finding fingerprints across distinct vulnerability flows', () => {
    const detectedIndices = [0, 2, 5, 6, 7];
    const findingIds = detectedIndices.flatMap(i => runs[i].result.findings.map(f => f.findingId));

    expect(findingIds).toHaveLength(5);
    expect(new Set(findingIds).size).toBe(5);
  });

  it('bridges detected findings to FindingCandidate with deterministic candidateId and canonical binding', async () => {
    const checkedCommit = currentCodeCommit();
    const hypotheses = await bridge(runs[0].result, runs[0].snapshot, runs[0].ingestion, ORG);

    expect(hypotheses).toHaveLength(1);
    const { candidate, candidateBinding } = hypotheses[0];
    const finding = runs[0].result.findings[0];

    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.snapshot.commitSha).toBe(checkedCommit);
    expect(candidate.sensorEvidence[0].rawEvidenceFingerprint).toBe(runs[0].result.resultFingerprint);
    expect(candidate.sensorEvidence[0].sensorFindingId).toBe(finding.findingId);

    const expectedCandidateId = await hash('m3-sqli-candidate-v1', {
      resultFingerprint: runs[0].result.resultFingerprint,
      findingId: finding.findingId,
      commitSha: checkedCommit,
    });
    expect(candidate.candidateId).toBe(expectedCandidateId);

    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(candidateBinding.startsWith(`${CONTRACT_VERSION}:FindingCandidate\n`)).toBe(true);
    expect(candidateBinding.startsWith('sha256:')).toBe(false);
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);
  });

  it('negative controls produce zero findings, empty findings fingerprint set, and no candidate', async () => {
    for (const index of [1, 3, 4]) {
      const run = runs[index];
      expect(run.result.status).toBe('NOT_DETECTED');
      expect(run.result.findings).toEqual([]);
      const output = await bridge(run.result, run.snapshot, run.ingestion, ORG);
      expect(output).toEqual([]);
    }

    const inconclusive = await analyzeInput(
      replaceSource(input(0), src => src.replace('return res.json', 'while (true) {} return res.json')),
    );
    expect(inconclusive.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(inconclusive.result.findings).toEqual([]);
    const inconclusiveOutput = await bridge(inconclusive.result, inconclusive.snapshot, inconclusive.ingestion, ORG);
    expect(inconclusiveOutput).toEqual([]);
  });

  it('rejects tampered finding fingerprints or forged analysis bodies', async () => {
    const forgedFindingId: any = structuredClone(runs[0].result);
    forgedFindingId.findings[0].findingId = 'sha256:' + 'f'.repeat(64);
    await expect(validateSqlAnalysis(forgedFindingId, runs[0].snapshot, runs[0].ingestion, ORG))
      .rejects.toThrow('M3_ANALYSIS_INTEGRITY');

    const forgedFingerprint: any = structuredClone(runs[0].result);
    forgedFingerprint.resultFingerprint = 'sha256:' + '0'.repeat(64);
    await expect(validateSqlAnalysis(forgedFingerprint, runs[0].snapshot, runs[0].ingestion, ORG))
      .rejects.toThrow('M3_ANALYSIS_INTEGRITY');

    const forgedStepId: any = structuredClone(runs[0].result);
    forgedStepId.findings[0].flow[0].id = 'sha256:' + '1'.repeat(64);
    await expect(validateSqlAnalysis(forgedStepId, runs[0].snapshot, runs[0].ingestion, ORG))
      .rejects.toThrow('M3_ANALYSIS_INTEGRITY');
  });
});
