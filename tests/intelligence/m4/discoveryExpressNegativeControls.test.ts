import { describe, expect, it, vi } from 'vitest';
import { createSqlCandidateBridge } from '../../../worker/intelligence/detection/candidate';
import { analyzeInput, input, replaceSource, ORG } from '../m3/support/inputs';

describe('M4 Discovery Express negative controls regression', () => {
  it('fails closed with UNBOUND_NAME limitation when route references an unbound identifier', async () => {
    const raw = replaceSource(input(), source => source.replace(
      'return res.json',
      'const query = unboundVariable; return res.json'
    ));
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('UNBOUND_NAME');
    const verify = vi.fn();
    const candidates = await createSqlCandidateBridge(verify)(result, snapshot, ingestion, ORG);
    expect(candidates).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  });

  it('fails closed with UNSUPPORTED_EXPRESSION limitation on unproven Express request property', async () => {
    const raw = replaceSource(input(), source => source.replace(
      'req.query.q',
      'req.params.id'
    ));
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('UNSUPPORTED_EXPRESSION');
    const verify = vi.fn();
    const candidates = await createSqlCandidateBridge(verify)(result, snapshot, ingestion, ORG);
    expect(candidates).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  });

  it('produces NOT_DETECTED and no candidate for safe constant query without request flow', async () => {
    const raw = replaceSource(input(), source => source.replace(
      'req.query.q',
      '"safe-constant"'
    ));
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
    const verify = vi.fn();
    const candidates = await createSqlCandidateBridge(verify)(result, snapshot, ingestion, ORG);
    expect(candidates).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  });

  it('does not create sink authority or finding for unrelated local helper returning a constant', async () => {
    const raw = replaceSource(input(), source => source.replace(
      'function searchRoute',
      'function localExec(cmd: string) { return "SELECT 1"; }\nfunction searchRoute'
    ).replace(
      'req.query.q',
      'localExec(req.query.q)'
    ));
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
    const verify = vi.fn();
    const candidates = await createSqlCandidateBridge(verify)(result, snapshot, ingestion, ORG);
    expect(candidates).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  });
  it('fails closed when an incidental unsupported Express property appears elsewhere in the route', async () => {
    const raw = replaceSource(input(), source =>
      source.replace(
        'return res.json',
        'const unbound = req.headers.authorization; return res.json'
      )
    );

    const { snapshot, ingestion, result } = await analyzeInput(raw);

    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('UNSUPPORTED_EXPRESSION');

    const verify = vi.fn();
    const candidates =
      await createSqlCandidateBridge(verify)(
        result,
        snapshot,
        ingestion,
        ORG
      );

    expect(candidates).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  });

  it('keeps the disconnected-route fixture NOT_DETECTED and non-authoritative', async () => {
    const { snapshot, ingestion, result } =
      await analyzeInput(input(3));

    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);

    const verify = vi.fn();
    const candidates =
      await createSqlCandidateBridge(verify)(
        result,
        snapshot,
        ingestion,
        ORG
      );

    expect(candidates).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  });
});