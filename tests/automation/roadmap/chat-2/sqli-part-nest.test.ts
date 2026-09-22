import { describe, expect, it, vi } from 'vitest';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

describe('roadmap chat-2: SQL injection partial-input fail-closed on nested routes', () => {
  it('baseline nested router fixture detects injection under registered mount path', async () => {
    const { result, ingestion } = await analyzeInput(input(7));
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    expect(result.limitations).toEqual([]);
    expect(result.findings[0].routeIdentity).toBe(ingestion.routes[0].routeIdentity);
    expect(ingestion.routes[0].path).toBe('/api/search');
  });

  it('drops partial nested-route detection when later reachable syntax is unsupported', async () => {
    const raw = replaceSource(input(7), source => source
      .replace('return res.json', 'const rows = res.json')
      .replace(').all());', ').all()); while (true) {} return rows;'));
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('UNSUPPORTED_STATEMENT');
  });

  it('candidate bridge produces no candidate hypothesis for inconclusive nested route analysis', async () => {
    const raw = replaceSource(input(7), source => source
      .replace('return res.json', 'const rows = res.json')
      .replace(').all());', ').all()); while (true) {} return rows;'));
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');

    const verify = vi.fn();
    const bridge = createSqlCandidateBridge(verify);
    const hypotheses = await bridge(run.result, run.snapshot, run.ingestion, ORG);
    expect(hypotheses).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  });

  it('fails closed when nested route contains unsupported syntax before sink', async () => {
    const raw = replaceSource(input(7), source => source
      .replace('return res.json', 'while (true) {} return res.json'));
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('UNSUPPORTED_STATEMENT');
  });

  it('fails closed when nested route contains conditional branches', async () => {
    const raw = replaceSource(input(7), source => source
      .replace('return res.json', 'if (req.query.q) return res.json'));
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('UNSUPPORTED_STATEMENT');
  });
});
