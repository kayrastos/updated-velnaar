import { describe, expect, it } from 'vitest';
import {
  computeCandidateBinding,
  computeEvidenceHash,
  createVerificationState,
  transitionVerificationState,
  validateEvidenceArtifact,
  validateFindingCandidate,
  validateVerificationRequest,
  type FindingCandidate,
  type SensorEvidence,
} from '../../../worker/intelligence/contracts';
import { createSqlCandidateBridge } from '../../../worker/intelligence/detection/candidate';
import { validateSqlAnalysis } from '../../../worker/intelligence/detection/sqlInjection';
import { fixture, ORG } from '../fixtures';
import { analyzeInput, input, ORG as M3_ORG } from '../m3/support/inputs';

describe('M4 evidence order stability', () => {
  it('sensor evidence permutation alters candidate binding and preserves canonical identity', async () => {
    const { c } = await fixture();
    const sensorA = c.sensorEvidence[0];
    const sensorB: SensorEvidence = {
      ...sensorA,
      sensorFindingId: 'sensor_b',
      summary: 'Secondary sensor evidence finding.',
    };
    const candidateAB: FindingCandidate = {
      ...c,
      sensorEvidence: [sensorA, sensorB],
    };
    const candidateBA: FindingCandidate = {
      ...c,
      sensorEvidence: [sensorB, sensorA],
    };

    const bindingAB = computeCandidateBinding(candidateAB, ORG);
    const bindingBA = computeCandidateBinding(candidateBA, ORG);

    expect(bindingAB).not.toBe(bindingBA);
    expect(validateFindingCandidate(candidateAB, ORG)).toEqual(candidateAB);
    expect(validateFindingCandidate(candidateBA, ORG)).toEqual(candidateBA);
  });

  it('verification request bound to evidence order AB rejects reordered candidate BA', async () => {
    const { c, q } = await fixture();
    const sensorA = c.sensorEvidence[0];
    const sensorB: SensorEvidence = {
      ...sensorA,
      sensorFindingId: 'sensor_b',
      summary: 'Secondary sensor evidence finding.',
    };
    const candidateAB: FindingCandidate = {
      ...c,
      sensorEvidence: [sensorA, sensorB],
    };
    const candidateBA: FindingCandidate = {
      ...c,
      sensorEvidence: [sensorB, sensorA],
    };

    const bindingAB = computeCandidateBinding(candidateAB, ORG);
    const requestAB = {
      ...q,
      candidateId: candidateAB.candidateId,
      candidateBinding: bindingAB,
    };

    expect(validateVerificationRequest(requestAB, candidateAB, ORG).candidateBinding).toBe(bindingAB);
    expect(() => validateVerificationRequest(requestAB, candidateBA, ORG)).toThrow('candidateBinding mismatch');
  });

  it('evidence artifact integrity hash is order-sensitive for candidate bindings', async () => {
    const { c, q, e } = await fixture();
    const sensorA = c.sensorEvidence[0];
    const sensorB: SensorEvidence = {
      ...sensorA,
      sensorFindingId: 'sensor_b',
      summary: 'Secondary sensor evidence finding.',
    };
    const candidateAB: FindingCandidate = {
      ...c,
      sensorEvidence: [sensorA, sensorB],
    };
    const candidateBA: FindingCandidate = {
      ...c,
      sensorEvidence: [sensorB, sensorA],
    };

    const bindingAB = computeCandidateBinding(candidateAB, ORG);
    const requestAB = {
      ...q,
      candidateId: candidateAB.candidateId,
      candidateBinding: bindingAB,
    };

    const bodyAB: Record<string, unknown> = {
      ...e,
      candidateId: candidateAB.candidateId,
      candidateBinding: bindingAB,
    };
    delete (bodyAB as { evidenceHash?: string }).evidenceHash;

    const hashAB = await computeEvidenceHash(bodyAB, requestAB, candidateAB, ORG);
    const artifactAB = {
      ...bodyAB,
      evidenceHash: hashAB,
    };

    const validated = await validateEvidenceArtifact(artifactAB, requestAB, candidateAB, ORG);
    expect(validated.evidenceHash).toBe(hashAB);
    await expect(validateEvidenceArtifact(artifactAB, requestAB, candidateBA, ORG)).rejects.toThrow('candidateBinding mismatch');
  });

  it('state transition to COMPLETE fails when candidate sensor evidence is permuted', async () => {
    const { c, q, e, r } = await fixture();
    const sensorA = c.sensorEvidence[0];
    const sensorB: SensorEvidence = {
      ...sensorA,
      sensorFindingId: 'sensor_b',
      summary: 'Secondary sensor evidence finding.',
    };
    const candidateAB: FindingCandidate = {
      ...c,
      sensorEvidence: [sensorA, sensorB],
    };
    const candidateBA: FindingCandidate = {
      ...c,
      sensorEvidence: [sensorB, sensorA],
    };

    const bindingAB = computeCandidateBinding(candidateAB, ORG);
    const bindingBA = computeCandidateBinding(candidateBA, ORG);
    const requestAB = {
      ...q,
      candidateId: candidateAB.candidateId,
      candidateBinding: bindingAB,
    };

    const bodyAB: Record<string, unknown> = {
      ...e,
      candidateId: candidateAB.candidateId,
      candidateBinding: bindingAB,
    };
    delete (bodyAB as { evidenceHash?: string }).evidenceHash;

    const hashAB = await computeEvidenceHash(bodyAB, requestAB, candidateAB, ORG);
    const artifactAB = {
      ...bodyAB,
      evidenceHash: hashAB,
    };

    const startAB = createVerificationState(candidateAB, ORG);
    const pendingAB = await transitionVerificationState(startAB, { type: 'BEGIN', request: requestAB });
    expect(pendingAB.state).toBe('PENDING_VERIFICATION');

    const resultBA = {
      ...r,
      candidateId: candidateBA.candidateId,
      candidateBinding: bindingBA,
    };

    await expect(
      transitionVerificationState(pendingAB, { type: 'COMPLETE', result: resultBA, evidence: artifactAB }),
    ).rejects.toThrow('candidateBinding mismatch');
  });

  it('candidate bridge produces deterministically ordered sensor evidence across runs', async () => {
    const run = await analyzeInput(input(0));
    const bridge = createSqlCandidateBridge(async () => '1111111111111111111111111111111111111111');
    const first = await bridge(run.result, run.snapshot, run.ingestion, M3_ORG);
    const second = await bridge(run.result, run.snapshot, run.ingestion, M3_ORG);

    expect(first).toEqual(second);
    expect(first[0].candidateBinding).toBe(second[0].candidateBinding);
    expect(first[0].candidate.sensorEvidence).toHaveLength(1);
    expect(Object.isFrozen(first[0].candidate.sensorEvidence[0])).toBe(true);
  });

  it('flow step order tampering in detector finding is rejected by integrity validation', async () => {
    const run = await analyzeInput(input(0));
    const finding = run.result.findings[0];
    expect(finding.flow.length).toBeGreaterThan(1);

    const reversedFlowFinding = { ...finding, flow: [...finding.flow].reverse() };
    const tamperedResult = { ...run.result, findings: [reversedFlowFinding] };

    await expect(validateSqlAnalysis(tamperedResult, run.snapshot, run.ingestion, M3_ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY');
  });

  it('input file enumeration order does not alter flow step order or finding evidence', async () => {
    const raw = input(0);
    const reversed = { ...raw, files: [...raw.files].reverse() };
    const normalRun = await analyzeInput(raw);
    const reversedRun = await analyzeInput(reversed);

    expect(reversedRun.result.findings).toEqual(normalRun.result.findings);
    expect(reversedRun.result.resultFingerprint).toBe(normalRun.result.resultFingerprint);
    for (let i = 0; i < normalRun.result.findings.length; i++) {
      expect(reversedRun.result.findings[i].flow).toEqual(normalRun.result.findings[i].flow);
    }
  });
});
