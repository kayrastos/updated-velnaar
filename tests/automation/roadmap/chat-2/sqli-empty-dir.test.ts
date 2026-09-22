import { beforeAll, describe, expect, it } from 'vitest';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { captureSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

let detectedRun: Awaited<ReturnType<typeof analyzeInput>>;
let safeRun: Awaited<ReturnType<typeof analyzeInput>>;

beforeAll(async () => {
  detectedRun = await analyzeInput(input(0));
  safeRun = await analyzeInput(input(1));
});

describe('RM_SQLI_EMPTY_DIR: null and empty boundary verification for direct routes', () => {
  it('detects SQL injection when request query is concatenated with an empty string prefix', async () => {
    const raw = replaceSource(input(0), source => source.replace('req.query.q', '("" + req.query.q)'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].source.symbol).toBe('query.q');
    expect(result.findings[0].sink.symbol).toBe('db.prepare');
    expect(result.findings[0].flow.some(step => step.kind === 'CONCAT')).toBe(true);
  });

  it('detects SQL injection when request query is concatenated with an empty string suffix', async () => {
    const raw = replaceSource(input(0), source => source.replace('req.query.q', '(req.query.q + "")'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].source.symbol).toBe('query.q');
    expect(result.findings[0].sink.symbol).toBe('db.prepare');
  });

  it('yields NOT_DETECTED when request query is replaced by an empty string literal', async () => {
    const raw = replaceSource(input(0), source => source.replace('req.query.q', '""'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
  });

  it('rejects route registration with empty path literal', async () => {
    const raw = replaceSource(input(0), source => source.replace("'/search'", "''"));
    await expect(analyzeInput(raw)).rejects.toThrow('literal bounded route path required');
  });

  it('fails closed on null or undefined input to detectSqlInjection', async () => {
    await expect(detectSqlInjection(null as any, detectedRun.ingestion, ORG)).rejects.toThrow();
    await expect(detectSqlInjection(undefined as any, detectedRun.ingestion, ORG)).rejects.toThrow();
    await expect(detectSqlInjection(detectedRun.snapshot, null as any, ORG)).rejects.toThrow();
    await expect(detectSqlInjection(detectedRun.snapshot, undefined as any, ORG)).rejects.toThrow();
  });

  it('fails closed on empty or invalid organization in detectSqlInjection', async () => {
    await expect(detectSqlInjection(detectedRun.snapshot, detectedRun.ingestion, '')).rejects.toThrow();
    await expect(detectSqlInjection(detectedRun.snapshot, detectedRun.ingestion, null as any)).rejects.toThrow();
    await expect(detectSqlInjection(detectedRun.snapshot, detectedRun.ingestion, 'foreign-org')).rejects.toThrow('tenant mismatch');
  });

  it('fails closed on snapshot mismatch between snapshot and ingestion', async () => {
    await expect(detectSqlInjection(detectedRun.snapshot, safeRun.ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
  });

  it('fails closed on null, undefined, or empty payload in validateSqlAnalysis', async () => {
    await expect(validateSqlAnalysis(null, detectedRun.snapshot, detectedRun.ingestion, ORG)).rejects.toThrow();
    await expect(validateSqlAnalysis(undefined, detectedRun.snapshot, detectedRun.ingestion, ORG)).rejects.toThrow();
    await expect(validateSqlAnalysis({}, detectedRun.snapshot, detectedRun.ingestion, ORG)).rejects.toThrow();
    await expect(validateSqlAnalysis({ ...detectedRun.result, resultFingerprint: '' }, detectedRun.snapshot, detectedRun.ingestion, ORG)).rejects.toThrow();
  });

  it('rejects captureSnapshot when file array is empty', async () => {
    await expect(captureSnapshot({
      fixtureId: 'm2-case-001',
      repositoryId: 'test-repo',
      organizationId: ORG,
      files: [],
    }, ORG)).rejects.toThrow('array bounds or shape');
  });

  it('rejects captureSnapshot with empty file path', async () => {
    await expect(captureSnapshot({
      fixtureId: 'm2-case-001',
      repositoryId: 'test-repo',
      organizationId: ORG,
      files: [{ path: '', content: 'export const x = 1;' }],
    }, ORG)).rejects.toThrow('repository-relative path');
  });

  it('candidate bridge rejects empty commit sha and produces empty candidates for safe run', async () => {
    const emptyCommitBridge = createSqlCandidateBridge(async () => '');
    await expect(emptyCommitBridge(detectedRun.result, detectedRun.snapshot, detectedRun.ingestion, ORG)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const zeroCommitBridge = createSqlCandidateBridge(async () => '0'.repeat(40));
    await expect(zeroCommitBridge(detectedRun.result, detectedRun.snapshot, detectedRun.ingestion, ORG)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const validCommitBridge = createSqlCandidateBridge(async () => 'a'.repeat(40));
    const safeCandidates = await validCommitBridge(safeRun.result, safeRun.snapshot, safeRun.ingestion, ORG);
    expect(safeCandidates).toEqual([]);
  });
});
