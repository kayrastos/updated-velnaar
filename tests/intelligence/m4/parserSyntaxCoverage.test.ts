import { describe, expect, it, vi } from 'vitest';
import { parseUnit, ingestExpress } from '../../../worker/intelligence/ingestion/express';
import { captureSnapshot } from '../../../worker/intelligence/ingestion/snapshot';
import { createSqlCandidateBridge } from '../../../worker/intelligence/detection/candidate';
import { analyzeInput, input, replaceSource, ORG } from '../m3/support/inputs';

describe('M4 parser syntax coverage: async and arrow handler traversal', () => {
  it('parses valid async arrow function syntax into AST without parse diagnostics', () => {
    const sf = parseUnit('src/routes.ts', 'export const handler = async (x: string) => x;');
    expect(sf).toBeDefined();
    expect((sf as any).parseDiagnostics).toHaveLength(0);
  });

  it('fails closed when parsing malformed arrow syntax', () => {
    expect(() => parseUnit('src/routes.ts', 'export const handler = async ( => x;')).toThrow('M2_INGESTION_ERROR: malformed source unit');
  });

  it('rejects inline async arrow route handler at ingestion boundary', async () => {
    const raw = replaceSource(input(), source => source.replace(', searchRoute', ', async (req: any, res: any) => { return res.json(); }'));
    const snapshot = await captureSnapshot(raw, ORG);
    await expect(ingestExpress(snapshot, ORG)).rejects.toThrow('named handler required');
  });

  it('rejects const-bound async arrow route handler as unknown handler', async () => {
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute', 'const searchHandler = async (req: any, res: any) => { return res.json(); }; function searchRoute')
      .replace(', searchRoute', ', searchHandler'));
    const snapshot = await captureSnapshot(raw, ORG);
    await expect(ingestExpress(snapshot, ORG)).rejects.toThrow('unknown route handler');
  });

  it('rejects const-bound synchronous arrow route handler as unknown handler', async () => {
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute', 'const syncHandler = (req: any, res: any) => { return res.json(); }; function searchRoute')
      .replace(', searchRoute', ', syncHandler'));
    const snapshot = await captureSnapshot(raw, ORG);
    await expect(ingestExpress(snapshot, ORG)).rejects.toThrow('unknown route handler');
  });

  it('marks async function declaration route handler as inconclusive with UNSUPPORTED_FUNCTION', async () => {
    const raw = replaceSource(input(), source => source.replace('function searchRoute', 'async function searchRoute'));
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('UNSUPPORTED_FUNCTION');
    expect(run.result.limitations[0].location?.symbol).toBe('searchRoute');
  });

  it('marks async arrow expression within handler body as inconclusive with UNSUPPORTED_EXPRESSION', async () => {
    const raw = replaceSource(input(), source => source.replace('return res.json', 'const helper = async () => req.query.q; return res.json'));
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('UNSUPPORTED_EXPRESSION');
  });

  it('marks synchronous arrow expression within handler body as inconclusive with UNSUPPORTED_EXPRESSION', async () => {
    const raw = replaceSource(input(), source => source.replace('return res.json', 'const helper = () => req.query.q; return res.json'));
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('UNSUPPORTED_EXPRESSION');
  });

  it('creates no candidate findings and avoids commit verification for inconclusive async handler analysis', async () => {
    const raw = replaceSource(input(), source => source.replace('function searchRoute', 'async function searchRoute'));
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    const verify = vi.fn();
    const bridge = createSqlCandidateBridge(verify);
    const candidates = await bridge(run.result, run.snapshot, run.ingestion, ORG);
    expect(candidates).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  });
});
