import { describe, expect, it, vi } from 'vitest';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { captureSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress } from '../../../../worker/intelligence/ingestion/express';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

describe('Roadmap Chat-2 SQLi detector: malformed direct input handling', () => {
  it('rejects direct route source containing syntax errors during ingestion parsing', async () => {
    const raw = replaceSource(input(0), source => source.replace('return res.json', 'const query = {; return res.json'));
    const snapshot = await captureSnapshot(raw, ORG);
    await expect(ingestExpress(snapshot, ORG)).rejects.toThrow('malformed source unit');
  });

  it('rejects direct route source containing null bytes during snapshot capture', async () => {
    const raw = replaceSource(input(0), source => source + '\0');
    await expect(captureSnapshot(raw, ORG)).rejects.toThrow('source content');
  });

  it('fails closed to ANALYSIS_INCONCLUSIVE when direct route references an unbound identifier', async () => {
    const raw = replaceSource(input(0), source => source.replace('return res.json', 'const x = unboundVar; return res.json'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('UNBOUND_NAME');
  });

  it('fails closed to ANALYSIS_INCONCLUSIVE when direct route declares duplicate variable bindings', async () => {
    const raw = replaceSource(input(0), source => source.replace('return res.json', 'const q = req.query.q; const q = "dup"; return res.json'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('DUPLICATE_BINDING');
  });

  it('fails closed to ANALYSIS_INCONCLUSIVE when direct route uses non-const variable statements', async () => {
    const raw = replaceSource(input(0), source => source.replace('return res.json', 'let q = req.query.q; return res.json'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('UNSUPPORTED_STATEMENT');
  });

  it('fails closed to ANALYSIS_INCONCLUSIVE when direct route contains unsupported binary operators', async () => {
    const raw = replaceSource(input(0), source => source.replace('return res.json', 'const q = req.query.q - 1; return res.json'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('UNSUPPORTED_EXPRESSION');
  });

  it('fails closed to ANALYSIS_INCONCLUSIVE when db.prepare is called with zero arguments', async () => {
    const raw = replaceSource(input(0), source => source.replace('return res.json', 'db.prepare(); return res.json'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('UNSUPPORTED_CALL');
  });

  it('fails closed to ANALYSIS_INCONCLUSIVE when db.prepare is called with multiple arguments', async () => {
    const raw = replaceSource(input(0), source => source.replace('return res.json', 'db.prepare(req.query.q, "extra"); return res.json'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('UNSUPPORTED_CALL');
  });

  it('inconclusive direct analysis produces zero candidate hypotheses and avoids commit verification', async () => {
    const raw = replaceSource(input(0), source => source.replace('return res.json', 'let q = req.query.q; return res.json'));
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    const verify = vi.fn();
    const bridge = createSqlCandidateBridge(verify);
    const candidates = await bridge(result, snapshot, ingestion, ORG);
    expect(candidates).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  });

  it('rejects direct analysis with tenant mismatch', async () => {
    const { snapshot, ingestion } = await analyzeInput(input(0));
    await expect(detectSqlInjection(snapshot, ingestion, 'foreign_tenant')).rejects.toThrow('tenant mismatch');
  });

  it('rejects direct analysis when snapshot and ingestion snapshot IDs mismatch', async () => {
    const run0 = await analyzeInput(input(0));
    const run1 = await analyzeInput(input(1));
    await expect(detectSqlInjection(run0.snapshot, run1.ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
  });

  it('rejects validation of tampered direct analysis results', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(0));
    expect(result.status).toBe('DETECTED');
    const tampered = { ...result, status: 'NOT_DETECTED' as const };
    await expect(validateSqlAnalysis(tampered, snapshot, ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
  });
});
