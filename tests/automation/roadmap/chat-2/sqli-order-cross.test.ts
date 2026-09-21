import { describe, expect, it } from 'vitest';
import { detectSqlInjection } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { computeCandidateBinding } from '../../../../worker/intelligence/contracts';
import { type SnapshotInput } from '../../../../worker/intelligence/ingestion/snapshot';
import { analyzeInput, input, ORG } from '../../../intelligence/m3/support/inputs';

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  const result: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    const current = items[i];
    const remaining = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of permutations(remaining)) {
      result.push([current, ...p]);
    }
  }
  return result;
}

describe('cross-file SQL injection detector order stability', () => {
  it('produces identical snapshot, ingestion, and detection results across all 6 cross-file permutations', async () => {
    const base = input(6);
    const perms = permutations(base.files);
    expect(perms).toHaveLength(6);

    const baseline = await analyzeInput(base);
    expect(baseline.result.status).toBe('DETECTED');
    expect(baseline.result.findings).toHaveLength(1);
    expect([...new Set(baseline.result.findings[0].flow.map(step => step.location.filePath))])
      .toEqual(['src/routes.ts', 'src/service.ts', 'src/repository.ts']);

    for (const perm of perms) {
      const permInput: SnapshotInput = { ...base, files: perm };
      const run = await analyzeInput(permInput);
      expect(run.snapshot.snapshotId).toBe(baseline.snapshot.snapshotId);
      expect(run.ingestion.ingestionIdentity).toBe(baseline.ingestion.ingestionIdentity);
      expect(run.result.resultFingerprint).toBe(baseline.result.resultFingerprint);
      expect(run.result).toEqual(baseline.result);
    }
  });

  it('candidate bridge yields identical hypotheses and bindings across all cross-file permutations', async () => {
    const base = input(6);
    const checkedCommit = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const bridge = createSqlCandidateBridge(async () => checkedCommit);

    const baseline = await analyzeInput(base);
    const baselineCandidates = await bridge(baseline.result, baseline.snapshot, baseline.ingestion, ORG);
    expect(baselineCandidates).toHaveLength(1);
    expect(baselineCandidates[0].candidate.verificationState).toBe('CANDIDATE');
    expect(baselineCandidates[0].candidate.snapshot.commitSha).toBe(checkedCommit);
    expect(baselineCandidates[0].candidateBinding).toBe(computeCandidateBinding(baselineCandidates[0].candidate, ORG));

    for (const perm of permutations(base.files)) {
      const run = await analyzeInput({ ...base, files: perm });
      const candidates = await bridge(run.result, run.snapshot, run.ingestion, ORG);
      expect(candidates).toEqual(baselineCandidates);
      expect(candidates[0].candidateBinding).toBe(baselineCandidates[0].candidateBinding);
    }
  });

  it('retains exact flow step order, uniqueness, and cross-file provenance regardless of file input ordering', async () => {
    const base = input(6);
    const reversed: SnapshotInput = { ...base, files: [...base.files].reverse() };
    const forwardRun = await analyzeInput(base);
    const reversedRun = await analyzeInput(reversed);

    const finding = forwardRun.result.findings[0];
    expect(finding.source.filePath).toBe('src/routes.ts');
    expect(finding.sink.filePath).toBe('src/repository.ts');
    expect(finding.flow.some(step => step.location.filePath === 'src/service.ts')).toBe(true);

    const stepIds = finding.flow.map(step => step.id);
    expect(new Set(stepIds).size).toBe(finding.flow.length);
    expect(reversedRun.result.findings[0].flow.map(step => step.id)).toEqual(stepIds);
  });
});
