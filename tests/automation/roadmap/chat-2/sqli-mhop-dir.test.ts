import { describe, expect, it } from 'vitest';
import { computeCandidateBinding, validateFindingCandidate } from '../../../../worker/intelligence/contracts';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { ANALYSIS_LIMITS } from '../../../../worker/intelligence/detection/types';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

const MOCK_COMMIT = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const bridge = createSqlCandidateBridge(async () => MOCK_COMMIT);

describe('RM_SQLI_MHOP_DIR: multi-hop direct dataflow propagation', () => {
  it('detects linear multi-hop direct variable propagation to SQL sink', async () => {
    const raw = replaceSource(input(), content => content.replace('return res.json',
      'const hop1 = req.query.q; const hop2 = hop1; const hop3 = hop2; const hop4 = hop3; const hop5 = hop4; return res.json')
      .replace('" + req.query.q + "', '" + hop5 + "'));
    const { result, snapshot, ingestion } = await analyzeInput(raw);

    expect(result.status).toBe('DETECTED');
    expect(result.limitations).toEqual([]);
    expect(result.findings).toHaveLength(1);

    const finding = result.findings[0];
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.symbol).toBe('db.prepare');

    const varSymbols = finding.flow
      .filter(step => step.kind === 'VARIABLE')
      .map(step => step.location.symbol);
    expect(varSymbols).toEqual(['hop1', 'hop2', 'hop3', 'hop4', 'hop5']);

    const kinds = finding.flow.map(step => step.kind);
    expect(kinds[0]).toBe('SOURCE');
    expect(kinds[kinds.length - 1]).toBe('SINK');
    expect(kinds.includes('CONCAT')).toBe(true);

    const hypotheses = await bridge(result, snapshot, ingestion, ORG);
    expect(hypotheses).toHaveLength(1);
    const { candidate, candidateBinding } = hypotheses[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.snapshot.commitSha).toBe(MOCK_COMMIT);
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);
  });

  it('detects direct multi-hop with intermediate string concatenation operands', async () => {
    const raw = replaceSource(input(), content => content.replace('return res.json',
      'const h1 = req.query.q; const h2 = h1; const t1 = "prefix_" + h2; const t2 = t1; return res.json')
      .replace('" + req.query.q + "', '" + t2 + "'));
    const { result } = await analyzeInput(raw);

    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    const varSymbols = finding.flow
      .filter(step => step.kind === 'VARIABLE')
      .map(step => step.location.symbol);
    expect(varSymbols).toEqual(['h1', 'h2', 't1', 't2']);
    expect(finding.flow.filter(step => step.kind === 'CONCAT').length).toBeGreaterThanOrEqual(2);
  });

  it.each(['prefix', 'suffix'] as const)('preserves direct multi-hop ordering on %s concatenation', async operand => {
    const raw = replaceSource(input(), content => content.replace('return res.json',
      'const a = req.query.q; const b = a; const c = b; return res.json')
      .replace('" + req.query.q + "', operand === 'prefix' ? '" + c + "' : '" + (c + "") + "'));
    const { result } = await analyzeInput(raw);

    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    const varSymbols = result.findings[0].flow
      .filter(step => step.kind === 'VARIABLE')
      .map(step => step.location.symbol);
    expect(varSymbols).toEqual(['a', 'b', 'c']);
  });

  it('negative control: clean constant multi-hop does not produce findings', async () => {
    const raw = replaceSource(input(), content => content.replace('return res.json',
      'const c1 = "static_filter"; const c2 = c1; const c3 = c2; const c4 = c3; return res.json')
      .replace('" + req.query.q + "', '" + c4 + "'));
    const { result, snapshot, ingestion } = await analyzeInput(raw);

    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toEqual([]);

    const hypotheses = await bridge(result, snapshot, ingestion, ORG);
    expect(hypotheses).toEqual([]);
  });

  it('negative control: disconnected multi-hop alias chain leaves sink untainted', async () => {
    const raw = replaceSource(input(), content => content.replace('return res.json',
      'const tainted1 = req.query.q; const tainted2 = tainted1; const tainted3 = tainted2; const clean = "safe"; return res.json')
      .replace('" + req.query.q + "', '" + clean + "'));
    const { result } = await analyzeInput(raw);

    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toEqual([]);
  });

  it('enforces flow budget limitation when multi-hop chain exceeds maximum depth', async () => {
    const depth = ANALYSIS_LIMITS.flowLength + 2;
    const decls = ['const step0 = req.query.q'];
    for (let i = 1; i <= depth; i++) {
      decls.push(`const step${i} = step${i - 1}`);
    }
    const raw = replaceSource(input(), content => content.replace('return res.json',
      `${decls.join('; ')}; return res.json`)
      .replace('" + req.query.q + "', `" + step${depth} + "`));
    const { result } = await analyzeInput(raw);

    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('FLOW_BUDGET');
  });
});
