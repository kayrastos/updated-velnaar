import { describe, expect, it } from 'vitest';
import { validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { computeCandidateBinding, validateFindingCandidate } from '../../../../worker/intelligence/contracts';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

describe('cross-file SQL injection normalization boundaries', () => {
  const commitSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

  it('detects cross-file flow and preserves exact unnormalized file provenance across units', async () => {
    const run = await analyzeInput(input(6));
    expect(run.result.status).toBe('DETECTED');
    expect(run.result.findings).toHaveLength(1);
    const finding = run.result.findings[0];
    expect(finding.source.filePath).toBe('src/routes.ts');
    expect(finding.sink.filePath).toBe('src/repository.ts');
    expect([...new Set(finding.flow.map(s => s.location.filePath))]).toEqual([
      'src/routes.ts',
      'src/service.ts',
      'src/repository.ts',
    ]);
    expect(finding.flow[0].kind).toBe('SOURCE');
    expect(finding.flow.at(-1)!.kind).toBe('SINK');

    const bridge = createSqlCandidateBridge(async () => commitSha);
    const candidates = await bridge(run.result, run.snapshot, run.ingestion, ORG);
    expect(candidates).toHaveLength(1);
    const { candidate, candidateBinding } = candidates[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.source.filePath).toBe('src/routes.ts');
    expect(candidate.sink.filePath).toBe('src/repository.ts');
    expect(candidate.snapshot.commitSha).toBe(commitSha);
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(candidateBinding.startsWith('velnar-intelligence-contract-v1:FindingCandidate\n')).toBe(true);
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);
  });

  it('negative control: safe constant passed across file boundaries produces no candidate or finding', async () => {
    const safeRaw = replaceSource(input(6), content =>
      content.replace(/req\.query(\.[A-Za-z0-9_]+)?/g, '"safe_constant"'),
    );
    const safeRun = await analyzeInput(safeRaw);
    expect(safeRun.result.status).toBe('NOT_DETECTED');
    expect(safeRun.result.findings).toEqual([]);

    const bridge = createSqlCandidateBridge(async () => commitSha);
    const candidates = await bridge(safeRun.result, safeRun.snapshot, safeRun.ingestion, ORG);
    expect(candidates).toEqual([]);
  });

  it('rejects cross-file import normalization attempts including traversal, redundant slashes, and backslashes', async () => {
    const raw = input(6);

    const traversalFiles = raw.files.map(f =>
      f.path === 'src/routes.ts'
        ? { ...f, content: f.content.replace('./service', './../src/service') }
        : f,
    );
    await expect(analyzeInput({ ...raw, files: traversalFiles })).rejects.toThrow('unsupported source import');

    const slashFiles = raw.files.map(f =>
      f.path === 'src/routes.ts'
        ? { ...f, content: f.content.replace('./service', './/service') }
        : f,
    );
    await expect(analyzeInput({ ...raw, files: slashFiles })).rejects.toThrow('missing or ambiguous source import');

    const backslashFiles = raw.files.map(f =>
      f.path === 'src/routes.ts'
        ? { ...f, content: f.content.replace('./service', '.\\service') }
        : f,
    );
    await expect(analyzeInput({ ...raw, files: backslashFiles })).rejects.toThrow('unsupported source import');

    const extFiles = raw.files.map(f =>
      f.path === 'src/routes.ts'
        ? { ...f, content: f.content.replace('./service', './service.ts') }
        : f,
    );
    await expect(analyzeInput({ ...raw, files: extFiles })).rejects.toThrow('unsupported source import');
  });

  it('rejects unnormalized or non-canonical file paths in cross-file snapshot', async () => {
    const raw = input(6);

    const dotFiles = raw.files.map(f =>
      f.path === 'src/repository.ts'
        ? { ...f, path: 'src/./repository.ts' }
        : f,
    );
    await expect(analyzeInput({ ...raw, files: dotFiles })).rejects.toThrow('path component');

    const traversalFiles = raw.files.map(f =>
      f.path === 'src/repository.ts'
        ? { ...f, path: 'src/../src/repository.ts' }
        : f,
    );
    await expect(analyzeInput({ ...raw, files: traversalFiles })).rejects.toThrow('path component');

    const backslashFiles = raw.files.map(f =>
      f.path === 'src/repository.ts'
        ? { ...f, path: 'src\\repository.ts' }
        : f,
    );
    await expect(analyzeInput({ ...raw, files: backslashFiles })).rejects.toThrow('repository-relative path');
  });

  it('enforces snapshot canonicalization: file reordering produces identical snapshot ID and detection result', async () => {
    const raw = input(6);
    const reversed = { ...raw, files: [...raw.files].reverse() };
    const originalRun = await analyzeInput(raw);
    const reversedRun = await analyzeInput(reversed);
    expect(reversedRun.snapshot.snapshotId).toBe(originalRun.snapshot.snapshotId);
    expect(reversedRun.result).toEqual(originalRun.result);
  });

  it('rejects tampered or non-canonical cross-file paths at candidate binding and analysis validation boundaries', async () => {
    const run = await analyzeInput(input(6));
    const bridge = createSqlCandidateBridge(async () => commitSha);
    const [hypothesis] = await bridge(run.result, run.snapshot, run.ingestion, ORG);
    const { candidate, candidateBinding } = hypothesis;

    const tampered = { ...candidate, sink: { ...candidate.sink, filePath: 'src/decoy.ts' } };
    expect(computeCandidateBinding(tampered, ORG)).not.toBe(candidateBinding);

    for (const badPath of ['/src/repository.ts', 'src/../repository.ts', 'src\\repository.ts']) {
      const nonCanonical = { ...candidate, sink: { ...candidate.sink, filePath: badPath } };
      expect(() => computeCandidateBinding(nonCanonical, ORG)).toThrow('filePath must be repository-relative');
    }

    await expect(validateSqlAnalysis(run.result, run.snapshot, run.ingestion, ORG)).resolves.toEqual(run.result);

    const forged: any = structuredClone(run.result);
    forged.findings[0].sink.filePath = 'src/routes.ts';
    await expect(validateSqlAnalysis(forged, run.snapshot, run.ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY');
  });
});
