import { describe, expect, it } from 'vitest';
import {
  computeCandidateBinding,
  createVerificationState,
  validateFindingCandidate,
} from '../../../../worker/intelligence/contracts';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { detectSqlInjection } from '../../../../worker/intelligence/detection/sqlInjection';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

describe('V1 discovery-intelligence: SQLi detector multi-stage identity stability', () => {
  const commitSha = '1111111111111111111111111111111111111111';
  const bridge = createSqlCandidateBridge(async () => commitSha);

  it('links identities across snapshot, ingestion, detection, and candidate bridge stages', async () => {
    const run = await analyzeInput(input(0));
    expect(run.result.status).toBe('DETECTED');
    const finding = run.result.findings[0];
    if (!finding) throw new Error('Expected finding');
    const route = run.ingestion.routes[0];
    if (!route) throw new Error('Expected route');

    expect(run.result.snapshotId).toBe(run.snapshot.snapshotId);
    expect(run.result.ingestionIdentity).toBe(run.ingestion.ingestionIdentity);
    expect(run.result.routeIdentities).toContain(route.routeIdentity);
    expect(finding.routeIdentity).toBe(route.routeIdentity);

    const hypotheses = await bridge(run.result, run.snapshot, run.ingestion, ORG);
    expect(hypotheses).toHaveLength(1);
    const first = hypotheses[0];
    if (!first) throw new Error('Expected candidate hypothesis');
    const { candidate, candidateBinding } = first;

    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.snapshot.snapshotId).toBe(run.snapshot.snapshotId);
    expect(candidate.snapshot.commitSha).toBe(commitSha);
    expect(candidate.context.routeId).toBe(finding.routeIdentity);

    const sensor = candidate.sensorEvidence[0];
    if (!sensor) throw new Error('Expected sensor evidence');
    expect(sensor.sensorFindingId).toBe(finding.findingId);
    expect(sensor.rawEvidenceFingerprint).toBe(run.result.resultFingerprint);

    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);
    expect(createVerificationState(candidate, ORG).state).toBe('CANDIDATE');
  });

  it('maintains deterministic identity across multi-stage re-execution', async () => {
    const runA = await analyzeInput(input(0));
    const runB = await analyzeInput(input(0));

    expect(runA.snapshot.snapshotId).toBe(runB.snapshot.snapshotId);
    expect(runA.ingestion.ingestionIdentity).toBe(runB.ingestion.ingestionIdentity);
    expect(runA.result.resultFingerprint).toBe(runB.result.resultFingerprint);

    const hypothesesA = await bridge(runA.result, runA.snapshot, runA.ingestion, ORG);
    const hypothesesB = await bridge(runB.result, runB.snapshot, runB.ingestion, ORG);
    expect(hypothesesA).toEqual(hypothesesB);
  });

  it('cascades identity mutation across all stages when source changes', async () => {
    const originalRun = await analyzeInput(input(0));
    const modifiedInput = replaceSource(input(0), source => '\n' + source);
    const modifiedRun = await analyzeInput(modifiedInput);

    expect(modifiedRun.snapshot.snapshotId).not.toBe(originalRun.snapshot.snapshotId);
    expect(modifiedRun.result.resultFingerprint).not.toBe(originalRun.result.resultFingerprint);

    const originalHypotheses = await bridge(originalRun.result, originalRun.snapshot, originalRun.ingestion, ORG);
    const modifiedHypotheses = await bridge(modifiedRun.result, modifiedRun.snapshot, modifiedRun.ingestion, ORG);

    const origFirst = originalHypotheses[0];
    const modFirst = modifiedHypotheses[0];
    if (!origFirst || !modFirst) throw new Error('Expected candidate hypotheses');

    expect(modFirst.candidate.candidateId).not.toBe(origFirst.candidate.candidateId);
    expect(modFirst.candidateBinding).not.toBe(origFirst.candidateBinding);
  });

  it('isolates commit verification identity to the candidate bridge stage', async () => {
    const run = await analyzeInput(input(0));
    const commitA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const commitB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const bridgeA = createSqlCandidateBridge(async () => commitA);
    const bridgeB = createSqlCandidateBridge(async () => commitB);

    const outA = await bridgeA(run.result, run.snapshot, run.ingestion, ORG);
    const outB = await bridgeB(run.result, run.snapshot, run.ingestion, ORG);

    const firstA = outA[0];
    const firstB = outB[0];
    if (!firstA || !firstB) throw new Error('Expected candidate hypotheses');

    expect(firstA.candidate.snapshot.commitSha).toBe(commitA);
    expect(firstB.candidate.snapshot.commitSha).toBe(commitB);
    expect(firstA.candidate.candidateId).not.toBe(firstB.candidate.candidateId);
    expect(firstA.candidateBinding).not.toBe(firstB.candidateBinding);
    expect(run.result.resultFingerprint).toBe(run.result.resultFingerprint);
  });

  it('preserves multi-stage identity stability for cross-file imports', async () => {
    const run = await analyzeInput(input(6));
    expect(run.result.status).toBe('DETECTED');
    const finding = run.result.findings[0];
    if (!finding) throw new Error('Expected finding');
    expect(finding.source.filePath).toBe('src/routes.ts');
    expect(finding.sink.filePath).toBe('src/repository.ts');

    const hypotheses = await bridge(run.result, run.snapshot, run.ingestion, ORG);
    expect(hypotheses).toHaveLength(1);
    const first = hypotheses[0];
    if (!first) throw new Error('Expected candidate');
    expect(first.candidate.source.filePath).toBe('src/routes.ts');
    expect(first.candidate.sink.filePath).toBe('src/repository.ts');
    expect(first.candidateBinding).toBe(computeCandidateBinding(first.candidate, ORG));
  });

  it('preserves multi-stage identity stability for mounted routers', async () => {
    const run = await analyzeInput(input(7));
    expect(run.result.status).toBe('DETECTED');
    const route = run.ingestion.routes[0];
    if (!route) throw new Error('Expected route');
    expect(route.path).toBe('/api/search');

    const finding = run.result.findings[0];
    if (!finding) throw new Error('Expected finding');
    expect(finding.routeIdentity).toBe(route.routeIdentity);

    const hypotheses = await bridge(run.result, run.snapshot, run.ingestion, ORG);
    expect(hypotheses).toHaveLength(1);
    const first = hypotheses[0];
    if (!first) throw new Error('Expected candidate');
    expect(first.candidate.context.routeId).toBe(route.routeIdentity);
  });

  it('yields no findings or candidate bridge hypotheses for safe controls', async () => {
    const run = await analyzeInput(input(1));
    expect(run.result.status).toBe('NOT_DETECTED');
    expect(run.result.findings).toHaveLength(0);

    const hypotheses = await bridge(run.result, run.snapshot, run.ingestion, ORG);
    expect(hypotheses).toEqual([]);
  });

  it('fails closed when snapshot and ingestion identities mismatch across stage boundaries', async () => {
    const run0 = await analyzeInput(input(0));
    const run1 = await analyzeInput(input(1));
    await expect(detectSqlInjection(run1.snapshot, run0.ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
  });
});
