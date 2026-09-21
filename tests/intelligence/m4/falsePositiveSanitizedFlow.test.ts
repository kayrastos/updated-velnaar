import { describe, expect, it, vi } from 'vitest';
import { createSqlCandidateBridge } from '../../../worker/intelligence/detection/candidate';
import { validateSqlAnalysis } from '../../../worker/intelligence/detection/sqlInjection';
import { analyzeInput, input, replaceSource, ORG } from '../m3/support/inputs';

describe('M4 false positive control: sanitized flow rejection', () => {
  it('rejects finding when flow is neutralized by a safe sanitization helper returning a constant', async () => {
    const sanitized = replaceSource(input(), source => source.replace(
      'function searchRoute',
      'function sanitize(val: string) { return "safe_value"; }\nfunction searchRoute',
    ).replace(
      '" + req.query.q + "',
      '" + sanitize(req.query.q) + "',
    ));
    const { snapshot, ingestion, result } = await analyzeInput(sanitized);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);

    const verify = vi.fn();
    const bridge = createSqlCandidateBridge(verify);
    const candidates = await bridge(result, snapshot, ingestion, ORG);
    expect(candidates).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  });

  it('rejects finding when flow is sanitized through an intermediate variable in a helper', async () => {
    const sanitized = replaceSource(input(), source => source.replace(
      'function searchRoute',
      'function sanitize(val: string) { const clean = "clean_literal"; return clean; }\nfunction searchRoute',
    ).replace(
      '" + req.query.q + "',
      '" + sanitize(req.query.q) + "',
    ));
    const { snapshot, ingestion, result } = await analyzeInput(sanitized);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);

    const verify = vi.fn();
    const bridge = createSqlCandidateBridge(verify);
    const candidates = await bridge(result, snapshot, ingestion, ORG);
    expect(candidates).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  });

  it('contrasts sanitized flow against an unsanitized passthrough helper that preserves taint', async () => {
    const unsanitized = replaceSource(input(), source => source.replace(
      'function searchRoute',
      'function passthrough(val: string) { return val; }\nfunction searchRoute',
    ).replace(
      '" + req.query.q + "',
      '" + passthrough(req.query.q) + "',
    ));
    const { result } = await analyzeInput(unsanitized);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].flow.some(step => step.kind === 'CALL' && step.location.symbol === 'passthrough')).toBe(true);
  });

  it('fails closed with inconclusive analysis when sanitization uses unsupported method calls', async () => {
    const raw = replaceSource(input(), source => source.replace(
      'return res.json',
      'const sanitized = req.query.q.replace("x", ""); return res.json',
    ));
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('UNSUPPORTED_EXPRESSION');

    const verify = vi.fn();
    const bridge = createSqlCandidateBridge(verify);
    const candidates = await bridge(result, snapshot, ingestion, ORG);
    expect(candidates).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  });

  it('fails closed with inconclusive analysis when sanitization references an unbound identifier', async () => {
    const raw = replaceSource(input(), source => source.replace(
      'return res.json',
      'const sanitized = escapeSql(req.query.q); return res.json',
    ));
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('UNBOUND_NAME');

    const verify = vi.fn();
    const bridge = createSqlCandidateBridge(verify);
    const candidates = await bridge(result, snapshot, ingestion, ORG);
    expect(candidates).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  });

  it('rejects forged detected status on sanitized snapshot during validation', async () => {
    const sanitized = replaceSource(input(), source => source.replace(
      'function searchRoute',
      'function sanitize(val: string) { return "safe_value"; }\nfunction searchRoute',
    ).replace(
      '" + req.query.q + "',
      '" + sanitize(req.query.q) + "',
    ));
    const { snapshot, ingestion, result } = await analyzeInput(sanitized);
    const forged: any = structuredClone(result);
    forged.status = 'DETECTED';
    await expect(validateSqlAnalysis(forged, snapshot, ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY');
  });
});
