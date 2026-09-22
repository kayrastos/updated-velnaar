import { describe, expect, it, vi } from 'vitest';
import { detectSqlInjection, validateSqlAnalysis } from '../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../worker/intelligence/detection/candidate';
import { analyzeInput, input, replaceSource, ORG } from '../m3/support/inputs';

describe('M4 SQL injection query builder negative controls', () => {
  it('identifies baseline parameterized query negative control as NOT_DETECTED', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(1));
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
    const validated = await validateSqlAnalysis(result, snapshot, ingestion, ORG);
    expect(validated.resultFingerprint).toBe(result.resultFingerprint);
  });

  it('verifies bound query parameter negative control without SQL string taint yields NOT_DETECTED', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(4));
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
    const validated = await validateSqlAnalysis(result, snapshot, ingestion, ORG);
    expect(validated.resultFingerprint).toBe(result.resultFingerprint);
  });

  it('evaluates static query builder returning parameterized SQL as NOT_DETECTED', async () => {
    const raw = replaceSource(input(1), source =>
      source.replace('function searchRoute',
        'function buildStaticQuery() { return "SELECT id, name FROM items WHERE category = ?"; }\nfunction searchRoute')
    );
    const { result, snapshot, ingestion } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
    const validated = await validateSqlAnalysis(result, snapshot, ingestion, ORG);
    expect(validated.status).toBe('NOT_DETECTED');
  });

  it('treats query builder concatenating safe string literals as NOT_DETECTED', async () => {
    const raw = replaceSource(input(1), source =>
      source.replace('function searchRoute',
        'function buildClause(col: string) { return "SELECT " + col + " FROM items WHERE id = ?"; }\nfunction searchRoute')
    );
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
  });

  it('confirms disconnected query builder does not create findings on registered routes', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(3));
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toHaveLength(0);
    expect(ingestion.sourceUnits[0].functions.some(f => f.symbol === 'disconnectedRoute')).toBe(true);
    const validated = await validateSqlAnalysis(result, snapshot, ingestion, ORG);
    expect(validated.findings).toEqual([]);
  });

  it('ensures query builder negative controls produce zero candidate hypotheses without verifier calls', async () => {
    const runs = await Promise.all([analyzeInput(input(1)), analyzeInput(input(4))]);
    for (const { snapshot, ingestion, result } of runs) {
      const verify = vi.fn();
      const bridge = createSqlCandidateBridge(verify);
      const candidates = await bridge(result, snapshot, ingestion, ORG);
      expect(candidates).toEqual([]);
      expect(verify).not.toHaveBeenCalled();
    }
  });

  it('maintains strict candidate boundary refusing verification claims on negative control results', async () => {
    const { result } = await analyzeInput(input(1));
    expect(result).not.toHaveProperty('verificationState');
    expect(result).not.toHaveProperty('VerificationResult');
    expect(result).not.toHaveProperty('evidenceHash');
    expect(result.status).toBe('NOT_DETECTED');
  });
});
