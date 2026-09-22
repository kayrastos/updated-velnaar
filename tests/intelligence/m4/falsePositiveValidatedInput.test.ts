import { describe, expect, it, vi } from 'vitest';
import { createSqlCandidateBridge } from '../../../worker/intelligence/detection/candidate';
import { validateSqlAnalysis } from '../../../worker/intelligence/detection/sqlInjection';
import { analyzeInput, input, replaceSource, ORG } from '../m3/support/inputs';

describe('M4 false-positive control: validated input rejection', () => {
  it('rejects conditional input validation branching as inconclusive fail-closed analysis', async () => {
    const raw = replaceSource(input(), source =>
      source.replace('return res.json', 'if (req.query.q === "safe") return res.json(db.prepare(req.query.q).all()); return res.json')
    );
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('UNSUPPORTED_STATEMENT');
  });

  it('fails closed when validation uses an unbound validator identifier', async () => {
    const raw = replaceSource(input(), source =>
      source.replace('return res.json', 'validateInput(req.query.q); return res.json')
    );
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('UNBOUND_NAME');
  });

  it('fails closed when validation logic uses unsupported control flow', async () => {
    const raw = replaceSource(input(), source =>
      source.replace(
        'function searchRoute',
        'function sanitize(val: string) { if (val) return val; return ""; }\nfunction searchRoute'
      ).replace('return res.json', 'sanitize(req.query.q); return res.json')
    );
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('UNSUPPORTED_STATEMENT');
  });

  it('negative control: safe bound parameter input produces NOT_DETECTED with zero findings', async () => {
    const run = await analyzeInput(input(4));
    expect(run.result.status).toBe('NOT_DETECTED');
    expect(run.result.findings).toHaveLength(0);
    expect(run.result.limitations).toEqual([]);
    const validated = await validateSqlAnalysis(run.result, run.snapshot, run.ingestion, ORG);
    expect(validated.status).toBe('NOT_DETECTED');
  });

  it('inconclusive validated input analysis produces no candidates and bypasses commit verifier', async () => {
    const raw = replaceSource(input(), source =>
      source.replace('return res.json', 'if (req.query.q) return res.json; return res.json')
    );
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    const verify = vi.fn();
    const bridge = createSqlCandidateBridge(verify);
    const candidates = await bridge(run.result, run.snapshot, run.ingestion, ORG);
    expect(candidates).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  });

  it('not-detected safe control creates no candidate hypothesis or verification authority', async () => {
    const run = await analyzeInput(input(1));
    expect(run.result.status).toBe('NOT_DETECTED');
    const verify = vi.fn();
    const bridge = createSqlCandidateBridge(verify);
    const candidates = await bridge(run.result, run.snapshot, run.ingestion, ORG);
    expect(candidates).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  });
});
