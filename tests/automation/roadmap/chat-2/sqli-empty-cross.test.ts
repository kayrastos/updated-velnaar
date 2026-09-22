import { describe, expect, it } from 'vitest';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { computeCandidateBinding, validateFindingCandidate } from '../../../../worker/intelligence/contracts';
import { captureSnapshot, type SnapshotInput } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress } from '../../../../worker/intelligence/ingestion/express';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

function modifyFile(raw: SnapshotInput, targetPath: string, updater: (content: string) => string): SnapshotInput {
  return {
    ...raw,
    files: raw.files.map(file => file.path === targetPath ? { ...file, content: updater(file.content) } : file),
  };
}

const mockCommit = '1111111111111111111111111111111111111111';
const bridge = createSqlCandidateBridge(async () => mockCommit);

describe('RM_SQLI_EMPTY_CROSS: cross-file null and empty string boundaries', () => {
  it('verifies baseline cross-file fixture detection across routes, service and repository', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(6));
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    expect(finding.source.filePath).toBe('src/routes.ts');
    expect(finding.sink.filePath).toBe('src/repository.ts');
    expect([...new Set(finding.flow.map(step => step.location.filePath))]).toEqual([
      'src/routes.ts',
      'src/service.ts',
      'src/repository.ts',
    ]);
    const candidates = await bridge(result, snapshot, ingestion, ORG);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].candidate.verificationState).toBe('CANDIDATE');
    expect(candidates[0].candidate.reachabilityState).toBe('REACHABLE');
  });

  it('detects cross-file flow when empty string prefix is concatenated at the route source', async () => {
    const raw = replaceSource(input(6), source => source.replace('req.query.q', '("" + req.query.q)'));
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    expect(finding.source.filePath).toBe('src/routes.ts');
    expect(finding.sink.filePath).toBe('src/repository.ts');
    expect(finding.flow.some(step => step.kind === 'CONCAT')).toBe(true);
    const validated = await validateSqlAnalysis(result, snapshot, ingestion, ORG);
    expect(validated.resultFingerprint).toBe(result.resultFingerprint);
  });

  it('detects cross-file flow when empty string suffix is concatenated at the repository sink', async () => {
    const raw = modifyFile(input(6), 'src/repository.ts', content => content.replace('db.prepare(', 'db.prepare("" + '));
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    expect(finding.source.filePath).toBe('src/routes.ts');
    expect(finding.sink.filePath).toBe('src/repository.ts');
    expect(finding.flow.some(step => step.kind === 'CONCAT')).toBe(true);
  });

  it('detects cross-file flow with multiple empty string concatenations across module boundaries', async () => {
    const withRouteEmpty = replaceSource(input(6), source => source.replace('req.query.q', '("" + req.query.q + "")'));
    const withBoth = modifyFile(withRouteEmpty, 'src/repository.ts', content => content.replace('db.prepare(', 'db.prepare("" + '));
    const { snapshot, ingestion, result } = await analyzeInput(withBoth);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    const candidates = await bridge(result, snapshot, ingestion, ORG);
    expect(candidates).toHaveLength(1);
    const { candidate, candidateBinding } = candidates[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.snapshot.commitSha).toBe(mockCommit);
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);
  });

  it('yields NOT_DETECTED when request query is replaced with an empty string constant across files', async () => {
    const raw = replaceSource(input(6), source => source.replace('req.query.q', '""'));
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
    const candidates = await bridge(result, snapshot, ingestion, ORG);
    expect(candidates).toEqual([]);
  });

  it('yields NOT_DETECTED when pure empty string concatenation is passed across files', async () => {
    const raw = replaceSource(input(6), source => source.replace('req.query.q', '("" + "")'));
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
    const candidates = await bridge(result, snapshot, ingestion, ORG);
    expect(candidates).toEqual([]);
  });

  it('rejects forged analysis attempting to claim DETECTED status on safe empty cross-file input', async () => {
    const raw = replaceSource(input(6), source => source.replace('req.query.q', '""'));
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    const forged: any = structuredClone(result);
    forged.status = 'DETECTED';
    await expect(validateSqlAnalysis(forged, snapshot, ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY');
  });
});
