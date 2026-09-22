import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import {
  computeCandidateBinding,
  validateFindingCandidate,
  CONTRACT_VERSION,
} from '../../../../worker/intelligence/contracts';
import { DETECTOR_VERSION, RULE_ID } from '../../../../worker/intelligence/detection/types';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}';
}

describe('V1 discovery-intelligence: sqli-detector identity stability (nested)', () => {
  const CHECKED_COMMIT = '1111111111111111111111111111111111111111';
  const bridge = createSqlCandidateBridge(async () => CHECKED_COMMIT);

  it('produces deterministic finding identity, route identity, and flow step IDs for nested helper calls', async () => {
    const raw = input(5);
    const runA = await analyzeInput(raw);
    const runB = await analyzeInput(raw);

    expect(runA.result.status).toBe('DETECTED');
    expect(runA.result.findings).toHaveLength(1);
    expect(runB.result).toEqual(runA.result);

    const findingA = runA.result.findings[0];
    const findingB = runB.result.findings[0];

    expect(findingA.findingId).toBe(findingB.findingId);
    expect(findingA.routeIdentity).toBe(runA.ingestion.routes[0].routeIdentity);
    expect(findingA.routeIdentity).toBe(findingB.routeIdentity);
    expect(findingA.vulnerabilityClass).toBe('SQL_INJECTION');

    const callSymbols = findingA.flow.filter(step => step.kind === 'CALL').map(step => step.location.symbol);
    expect(callSymbols).toEqual(['lookup', 'buildQuery']);

    const stepIdsA = findingA.flow.map(s => s.id);
    const stepIdsB = findingB.flow.map(s => s.id);
    expect(stepIdsA).toEqual(stepIdsB);
    expect(new Set(stepIdsA).size).toBe(findingA.flow.length);

    const { resultFingerprint, ...body } = runA.result;
    const expectedFingerprint = 'sha256:' + createHash('sha256').update(DETECTOR_VERSION + '\n' + canonical(body)).digest('hex');
    expect(resultFingerprint).toBe(expectedFingerprint);

    const validated = await validateSqlAnalysis(runA.result, runA.snapshot, runA.ingestion, ORG);
    expect(validated).toEqual(runA.result);
  });

  it('preserves nested finding identity and flow structure across file ordering permutation', async () => {
    const raw = input(5);
    const reversedRaw = { ...raw, files: [...raw.files].reverse() };

    const original = await analyzeInput(raw);
    const permuted = await analyzeInput(reversedRaw);

    expect(permuted.result.status).toBe('DETECTED');
    expect(permuted.result.findings).toHaveLength(1);
    expect(permuted.result.findings[0].findingId).toBe(original.result.findings[0].findingId);
    expect(permuted.result.findings[0].routeIdentity).toBe(original.result.findings[0].routeIdentity);
    expect(permuted.result.findings[0].flow).toEqual(original.result.findings[0].flow);
    expect(permuted.result.resultFingerprint).toBe(original.result.resultFingerprint);
  });

  it('generates deterministic candidate identity and binding for nested flow hypotheses', async () => {
    const run = await analyzeInput(input(5));
    const hypothesesA = await bridge(run.result, run.snapshot, run.ingestion, ORG);
    const hypothesesB = await bridge(run.result, run.snapshot, run.ingestion, ORG);

    expect(hypothesesA).toHaveLength(1);
    expect(hypothesesB).toEqual(hypothesesA);

    const { candidate, candidateBinding } = hypothesesA[0];
    const finding = run.result.findings[0];

    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.organizationId).toBe(ORG);
    expect(candidate.snapshot.commitSha).toBe(CHECKED_COMMIT);
    expect(candidate.context.routeId).toBe(finding.routeIdentity);
    expect(candidate.sensorEvidence[0].sensorFindingId).toBe(finding.findingId);
    expect(candidate.sensorEvidence[0].ruleId).toBe(RULE_ID);
    expect(candidate.sensorEvidence[0].rawEvidenceFingerprint).toBe(run.result.resultFingerprint);

    const expectedBinding = `${CONTRACT_VERSION}:FindingCandidate\n${canonical(candidate)}`;
    expect(candidateBinding).toBe(expectedBinding);
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);
    expect(Object.isFrozen(candidate.sensorEvidence[0])).toBe(true);
  });

  it('differentiates finding and candidate identity under nested helper modification', async () => {
    const originalRun = await analyzeInput(input(5));
    const modifiedRaw = replaceSource(input(5), source => '\n' + source);
    const modifiedRun = await analyzeInput(modifiedRaw);

    expect(modifiedRun.result.status).toBe('DETECTED');
    expect(modifiedRun.result.findings).toHaveLength(1);

    const originalFinding = originalRun.result.findings[0];
    const modifiedFinding = modifiedRun.result.findings[0];

    expect(modifiedFinding.findingId).not.toBe(originalFinding.findingId);
    expect(modifiedRun.result.resultFingerprint).not.toBe(originalRun.result.resultFingerprint);

    const originalCandidates = await bridge(originalRun.result, originalRun.snapshot, originalRun.ingestion, ORG);
    const modifiedCandidates = await bridge(modifiedRun.result, modifiedRun.snapshot, modifiedRun.ingestion, ORG);

    expect(modifiedCandidates[0].candidate.candidateId).not.toBe(originalCandidates[0].candidate.candidateId);
    expect(modifiedCandidates[0].candidateBinding).not.toBe(originalCandidates[0].candidateBinding);
  });

  it('rejects forged finding and flow step identities for nested findings', async () => {
    const run = await analyzeInput(input(5));
    const forgedFindingId: any = structuredClone(run.result);
    forgedFindingId.findings[0].findingId = 'sha256:' + 'e'.repeat(64);
    await expect(validateSqlAnalysis(forgedFindingId, run.snapshot, run.ingestion, ORG))
      .rejects.toThrow('M3_ANALYSIS_INTEGRITY');

    const forgedFlowStep: any = structuredClone(run.result);
    forgedFlowStep.findings[0].flow[0].id = 'sha256:' + 'f'.repeat(64);
    await expect(validateSqlAnalysis(forgedFlowStep, run.snapshot, run.ingestion, ORG))
      .rejects.toThrow('M3_ANALYSIS_INTEGRITY');

    const forgedRoute: any = structuredClone(run.result);
    forgedRoute.findings[0].routeIdentity = 'sha256:' + '0'.repeat(64);
    await expect(validateSqlAnalysis(forgedRoute, run.snapshot, run.ingestion, ORG))
      .rejects.toThrow('M3_ANALYSIS_INTEGRITY');
  });

  it('fails closed to inconclusive when unsupported syntax is introduced into nested helper', async () => {
    const raw = replaceSource(input(5), source => 'while (true) {}\n' + source);
    const run = await analyzeInput(raw);

    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations).toHaveLength(1);

    const candidates = await bridge(run.result, run.snapshot, run.ingestion, ORG);
    expect(candidates).toEqual([]);
  });
});
