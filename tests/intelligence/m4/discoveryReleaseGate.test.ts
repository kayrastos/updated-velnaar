import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CONTRACT_VERSION,
  computeCandidateBinding,
  createVerificationState,
  transitionVerificationState,
  validateFindingCandidate,
  type FindingCandidate,
} from '../../../worker/intelligence/contracts';
import { createSqlCandidateBridge } from '../../../worker/intelligence/detection/candidate';
import { detectSqlInjection, validateSqlAnalysis } from '../../../worker/intelligence/detection/sqlInjection';
import { DETECTOR_VERSION, RULE_ID } from '../../../worker/intelligence/detection/types';
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

async function build(index = 0) {
  const run = runs[index];
  return bridge(run.result, run.snapshot, run.ingestion, ORG);
}

describe('M4 Discovery Release Gate: candidate determinism & boundary enforcement', () => {
  it('candidate bindings are canonical, deterministic, and free of invented sha256 prefixes', async () => {
    const outputs = await build(0);
    expect(outputs).toHaveLength(1);
    const { candidate, candidateBinding } = outputs[0];
    expect(candidateBinding.startsWith(`${CONTRACT_VERSION}:FindingCandidate\n`)).toBe(true);
    expect(candidateBinding.startsWith('sha256:')).toBe(false);
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    const repeated = await build(0);
    expect(repeated[0].candidateBinding).toBe(candidateBinding);
  });

  it.each([0, 2, 5, 6, 7])('detected fixture %i produces deterministic CANDIDATE with valid git commit', async index => {
    const checkedCommit = currentCodeCommit();
    const output = await build(index);
    expect(output).toHaveLength(1);
    const { candidate, candidateBinding } = output[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.organizationId).toBe(ORG);
    expect(candidate.snapshot.commitSha).toBe(checkedCommit);
    expect(candidate.sensorEvidence[0].sensorType).toBe('VELNAR_STRUCTURAL');
    expect(candidate.sensorEvidence[0].ruleId).toBe(RULE_ID);
    expect(candidate.sensorEvidence[0].rawEvidenceFingerprint).toBe(runs[index].result.resultFingerprint);
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
  });

  it('multi-case candidate generation is deterministic across independent runs and file orders', async () => {
    const raw = input(6);
    const reversed = { ...raw, files: [...raw.files].reverse() };
    const normalRun = await analyzeInput(raw);
    const reversedRun = await analyzeInput(reversed);
    expect(reversedRun.result).toEqual(normalRun.result);
    const bridgeA = await bridge(normalRun.result, normalRun.snapshot, normalRun.ingestion, ORG);
    const bridgeB = await bridge(reversedRun.result, reversedRun.snapshot, reversedRun.ingestion, ORG);
    expect(bridgeB).toEqual(bridgeA);
  });

  it.each([1, 3, 4])('negative control fixture %i yields no findings, no candidates, and no verifier calls', async index => {
    const verify = vi.fn();
    const customBridge = createSqlCandidateBridge(verify);
    const run = runs[index];
    expect(run.result.status).toBe('NOT_DETECTED');
    expect(run.result.findings).toHaveLength(0);
    const candidates = await customBridge(run.result, run.snapshot, run.ingestion, ORG);
    expect(candidates).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  });

  it('unsupported syntax fails closed to inconclusive and yields zero candidates', async () => {
    const limited = await analyzeInput(replaceSource(input(), s => s.replace('return res.json', 'while (true) {} return res.json')));
    expect(limited.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(limited.result.findings).toEqual([]);
    const candidates = await bridge(limited.result, limited.snapshot, limited.ingestion, ORG);
    expect(candidates).toEqual([]);
  });

  it('candidate verificationState remains CANDIDATE and rejects premature completion', async () => {
    const { candidate } = (await build(0))[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    const state = createVerificationState(candidate, ORG);
    expect(state.state).toBe('CANDIDATE');
    await expect(
      transitionVerificationState(state, {
        type: 'COMPLETE',
        result: { result: 'VERIFIED' } as any,
        evidence: runs[0].result as any,
      })
    ).rejects.toThrow('COMPLETE requires pending');
  });

  it('candidate bridge rejects unproven, empty, or all-zero commit SHA identities', async () => {
    for (const badCommit of ['', 'invalid-commit', '0000000000000000000000000000000000000000']) {
      const failingBridge = createSqlCandidateBridge(async () => badCommit);
      await expect(failingBridge(runs[0].result, runs[0].snapshot, runs[0].ingestion, ORG)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
    }
  });

  it('candidate bridge rejects tampered analysis results before candidate generation', async () => {
    const tampered: any = structuredClone(runs[0].result);
    tampered.status = 'DETECTED';
    tampered.findings[0].sink.line += 10;
    const verify = vi.fn();
    await expect(createSqlCandidateBridge(verify)(tampered, runs[0].snapshot, runs[0].ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY');
    expect(verify).not.toHaveBeenCalled();
  });

  it('semantic mutations change candidate binding while preserving contract versioning', async () => {
    const original = (await build(0))[0];
    const mutated: FindingCandidate = {
      ...original.candidate,
      sink: { ...original.candidate.sink, symbol: 'otherSink' },
    };
    const mutatedBinding = computeCandidateBinding(mutated, ORG);
    expect(mutatedBinding).not.toBe(original.candidateBinding);
    expect(mutatedBinding.startsWith(`${CONTRACT_VERSION}:FindingCandidate\n`)).toBe(true);
  });
});
