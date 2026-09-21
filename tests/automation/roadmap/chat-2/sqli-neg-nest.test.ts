import { describe, expect, it, vi } from 'vitest';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

describe('V1 discovery-intelligence sqli-detector: negative-control nested', () => {
  it('canonical nested negative fixture index 4 yields NOT_DETECTED with zero findings and zero limitations', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(4));
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
    expect(result.snapshotId).toBe(snapshot.snapshotId);
    expect(result.ingestionIdentity).toBe(ingestion.ingestionIdentity);
    expect(result.organizationId).toBe(ORG);
    expect(result.repositoryId).toBe(snapshot.repositoryId);
    expect(snapshot.fixtureId).toBe('m2-case-005');

    const verify = vi.fn();
    const bridge = createSqlCandidateBridge(verify);
    const candidates = await bridge(result, snapshot, ingestion, ORG);
    expect(candidates).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  });

  it('nested helper returning constant operand to query concatenation produces NOT_DETECTED', async () => {
    const raw = replaceSource(input(), content => content
      .replace('function searchRoute', 'function buildSafeFragment() { return "safe"; }\nfunction searchRoute')
      .replace('" + req.query.q + "', '" + buildSafeFragment() + "'));

    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);

    const verify = vi.fn();
    const bridge = createSqlCandidateBridge(verify);
    const candidates = await bridge(result, snapshot, ingestion, ORG);
    expect(candidates).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  });

  it('nested helper receiving request query but returning clean SQL produces NOT_DETECTED', async () => {
    const raw = replaceSource(input(), content => content
      .replace('function searchRoute', 'function passThrough(val: string) { return "constant"; }\nfunction searchRoute')
      .replace('" + req.query.q + "', '" + passThrough(req.query.q) + "'));

    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);

    const verify = vi.fn();
    const bridge = createSqlCandidateBridge(verify);
    const candidates = await bridge(result, snapshot, ingestion, ORG);
    expect(candidates).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  });

  it('multi-level nested helper chain returning safe SQL yields NOT_DETECTED and passes analysis validation', async () => {
    const raw = replaceSource(input(), content => content
      .replace('function searchRoute',
        'function innerSafe() { return "constant"; }\n' +
        'function outerSafe(val: string) { return innerSafe(); }\n' +
        'function searchRoute')
      .replace('" + req.query.q + "', '" + outerSafe(req.query.q) + "'));

    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);

    const repeated = await detectSqlInjection(snapshot, ingestion, ORG);
    expect(repeated).toEqual(result);

    const validated = await validateSqlAnalysis(result, snapshot, ingestion, ORG);
    expect(validated).toEqual(result);

    const verify = vi.fn();
    const bridge = createSqlCandidateBridge(verify);
    const candidates = await bridge(result, snapshot, ingestion, ORG);
    expect(candidates).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  });

  it('ensures negative controls fail closed without candidate generation or commit verification', async () => {
    for (const index of [1, 4]) {
      const { snapshot, ingestion, result } = await analyzeInput(input(index));
      expect(result.status).toBe('NOT_DETECTED');
      expect(result.findings).toEqual([]);
      expect(result.limitations).toEqual([]);

      const verify = vi.fn();
      const bridge = createSqlCandidateBridge(verify);
      const candidates = await bridge(result, snapshot, ingestion, ORG);
      expect(candidates).toEqual([]);
      expect(verify).not.toHaveBeenCalled();
    }
  });
});
