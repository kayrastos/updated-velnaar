import { beforeAll, describe, expect, it } from 'vitest';
import { createSqlCandidateBridge } from '../../../worker/intelligence/detection/candidate';
import { computeCandidateBinding, validateFindingCandidate } from '../../../worker/intelligence/contracts';
import { detectSqlInjection } from '../../../worker/intelligence/detection/sqlInjection';
import { analyzeInput, input, replaceSource, ORG } from '../m3/support/inputs';

let runs: Awaited<ReturnType<typeof analyzeInput>>[];
const detectedIndexes = [0, 2, 5, 6, 7] as const;

beforeAll(async () => {
  runs = [];
  for (let i = 0; i < 8; i++) runs.push(await analyzeInput(input(i)));
});

describe('M4 Discovery Finding Identity Stability', () => {
  it('produces identical finding IDs and flow step IDs across repeated discovery runs', async () => {
    for (const index of detectedIndexes) {
      const repeated = await detectSqlInjection(runs[index].snapshot, runs[index].ingestion, ORG);
      expect(repeated.findings).toHaveLength(1);
      const originalFinding = runs[index].result.findings[0];
      const repeatedFinding = repeated.findings[0];
      expect(repeatedFinding.findingId).toBe(originalFinding.findingId);
      expect(repeatedFinding.flow.map(step => step.id)).toEqual(originalFinding.flow.map(step => step.id));
      expect(repeatedFinding).toEqual(originalFinding);
    }
  });

  it('preserves finding IDs regardless of snapshot input file ordering', async () => {
    const raw = input(6);
    const reversed = { ...raw, files: [...raw.files].reverse() };
    const analyzed = await analyzeInput(reversed);
    expect(analyzed.result.status).toBe('DETECTED');
    expect(analyzed.result.findings[0].findingId).toBe(runs[6].result.findings[0].findingId);
    expect(analyzed.result.findings[0].flow.map(step => step.id)).toEqual(
      runs[6].result.findings[0].flow.map(step => step.id)
    );
  });

  it('ensures finding IDs and flow node IDs conform to canonical sha256 format and are unique per flow', () => {
    const sha256Pattern = /^sha256:[0-9a-f]{64}$/;
    for (const index of detectedIndexes) {
      const finding = runs[index].result.findings[0];
      expect(finding.findingId).toMatch(sha256Pattern);
      const flowIds = finding.flow.map(step => step.id);
      for (const id of flowIds) {
        expect(id).toMatch(sha256Pattern);
      }
      expect(new Set(flowIds).size).toBe(flowIds.length);
    }
  });

  it('assigns mutually distinct finding IDs across different vulnerability scenarios', () => {
    const findingIds = detectedIndexes.map(index => runs[index].result.findings[0].findingId);
    expect(new Set(findingIds).size).toBe(detectedIndexes.length);
  });

  it('changes finding ID when source code location or line structure shifts', async () => {
    const originalId = runs[0].result.findings[0].findingId;
    const shifted = await analyzeInput(replaceSource(input(0), content => '\n' + content));
    expect(shifted.result.status).toBe('DETECTED');
    expect(shifted.result.findings[0].findingId).not.toBe(originalId);
  });

  it('changes finding ID when intermediate flow steps change', async () => {
    const originalId = runs[0].result.findings[0].findingId;
    const aliased = await analyzeInput(replaceSource(input(0), content =>
      content.replace('return res.json', 'const alias = req.query.q; return res.json')
        .replace('" + req.query.q + "', '" + alias + "')
    ));
    expect(aliased.result.status).toBe('DETECTED');
    expect(aliased.result.findings[0].findingId).not.toBe(originalId);
    expect(aliased.result.findings[0].flow.length).toBeGreaterThan(runs[0].result.findings[0].flow.length);
  });

  it('changes finding ID when snapshot context changes even if source semantics match', async () => {
    const originalFinding = runs[0].result.findings[0];
    const diffSnapshot = await analyzeInput({ ...input(0), fixtureId: 'm2-case-008' });
    expect(diffSnapshot.result.status).toBe('DETECTED');
    expect(diffSnapshot.result.findings[0].findingId).not.toBe(originalFinding.findingId);
    expect(diffSnapshot.result.findings[0].flow[0].id).not.toBe(originalFinding.flow[0].id);
  });

  it('derives stable candidate IDs that deterministically bind to the underlying finding ID', async () => {
    const commitSha = 'b'.repeat(40);
    const bridge = createSqlCandidateBridge(async () => commitSha);
    for (const index of detectedIndexes) {
      const run = runs[index];
      const candidates1 = await bridge(run.result, run.snapshot, run.ingestion, ORG);
      const candidates2 = await bridge(run.result, run.snapshot, run.ingestion, ORG);
      expect(candidates1).toHaveLength(1);
      expect(candidates2).toHaveLength(1);
      const c1 = candidates1[0];
      const c2 = candidates2[0];
      expect(c1.candidate.candidateId).toBe(c2.candidate.candidateId);
      expect(c1.candidateBinding).toBe(c2.candidateBinding);
      expect(c1.candidate.sensorEvidence[0].sensorFindingId).toBe(run.result.findings[0].findingId);
      expect(c1.candidate.verificationState).toBe('CANDIDATE');
      expect(validateFindingCandidate(c1.candidate, ORG)).toEqual(c1.candidate);
      expect(computeCandidateBinding(c1.candidate, ORG)).toBe(c1.candidateBinding);
    }
  });
});
