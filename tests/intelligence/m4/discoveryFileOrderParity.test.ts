import { describe, expect, it } from 'vitest';
import { createSqlCandidateBridge } from '../../../worker/intelligence/detection/candidate';
import { computeCandidateBinding } from '../../../worker/intelligence/contracts';
import { analyzeInput, input, ORG } from '../m3/support/inputs';

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  const result: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    const head = items[i];
    const tail = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const perm of permutations(tail)) {
      result.push([head, ...perm]);
    }
  }
  return result;
}

const mockCommit = '1111111111111111111111111111111111111111';
const bridge = createSqlCandidateBridge(async () => mockCommit);

describe('M4 discovery file order parity and determinism', () => {
  it('ensures multi-file input permutations yield identical snapshots, ingestion, and detection results', async () => {
    const raw = input(6);
    const baseline = await analyzeInput(raw);
    expect(baseline.result.status).toBe('DETECTED');
    expect(baseline.result.findings).toHaveLength(1);
    expect(baseline.snapshot.files.length).toBeGreaterThan(1);

    const allPermutations = permutations(raw.files);
    expect(allPermutations.length).toBeGreaterThanOrEqual(6);

    const baselineCandidates = await bridge(baseline.result, baseline.snapshot, baseline.ingestion, ORG);
    expect(baselineCandidates).toHaveLength(1);
    expect(baselineCandidates[0].candidate.verificationState).toBe('CANDIDATE');

    for (const filesOrder of allPermutations) {
      const run = await analyzeInput({ ...raw, files: filesOrder });
      expect(run.snapshot.snapshotId).toBe(baseline.snapshot.snapshotId);
      expect(run.snapshot.files).toEqual(baseline.snapshot.files);
      expect(run.snapshot).toEqual(baseline.snapshot);
      expect(run.ingestion.ingestionIdentity).toBe(baseline.ingestion.ingestionIdentity);
      expect(run.ingestion).toEqual(baseline.ingestion);
      expect(run.result.resultFingerprint).toBe(baseline.result.resultFingerprint);
      expect(run.result).toEqual(baseline.result);

      const candidates = await bridge(run.result, run.snapshot, run.ingestion, ORG);
      expect(candidates).toEqual(baselineCandidates);
      expect(candidates[0].candidateBinding).toBe(computeCandidateBinding(candidates[0].candidate, ORG));
      expect(candidates[0].candidate.verificationState).toBe('CANDIDATE');
    }
  });

  it('guarantees snapshot files are sorted lexicographically regardless of arrival order', async () => {
    const raw = input(6);
    const reversed = await analyzeInput({ ...raw, files: [...raw.files].reverse() });
    const paths = reversed.snapshot.files.map(f => f.path);
    const sortedPaths = [...paths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(paths).toEqual(sortedPaths);
  });

  it('preserves deterministic NOT_DETECTED status and empty findings across file order permutations', async () => {
    const raw = input(1);
    const baseline = await analyzeInput(raw);
    expect(baseline.result.status).toBe('NOT_DETECTED');
    expect(baseline.result.findings).toEqual([]);

    const reversed = await analyzeInput({ ...raw, files: [...raw.files].reverse() });
    expect(reversed.snapshot.snapshotId).toBe(baseline.snapshot.snapshotId);
    expect(reversed.ingestion.ingestionIdentity).toBe(baseline.ingestion.ingestionIdentity);
    expect(reversed.result.resultFingerprint).toBe(baseline.result.resultFingerprint);
    expect(reversed.result).toEqual(baseline.result);

    const candidates = await bridge(reversed.result, reversed.snapshot, reversed.ingestion, ORG);
    expect(candidates).toEqual([]);
  });

  it('candidate hypothesis retains bound CANDIDATE identity invariant under file order changes', async () => {
    const raw = input(6);
    const baseline = await analyzeInput(raw);
    const reversed = await analyzeInput({ ...raw, files: [...raw.files].reverse() });

    const [c1] = await bridge(baseline.result, baseline.snapshot, baseline.ingestion, ORG);
    const [c2] = await bridge(reversed.result, reversed.snapshot, reversed.ingestion, ORG);

    expect(c1.candidate.candidateId).toBe(c2.candidate.candidateId);
    expect(c1.candidateBinding).toBe(c2.candidateBinding);
    expect(c1.candidate.verificationState).toBe('CANDIDATE');
    expect(c2.candidate.verificationState).toBe('CANDIDATE');
    expect(c1.candidateBinding).toBe(computeCandidateBinding(c1.candidate, ORG));
  });
});
