import { describe, expect, it } from 'vitest';
import { createSqlCandidateBridge } from '../../../worker/intelligence/detection/candidate';
import { computeCandidateBinding, validateFindingCandidate } from '../../../worker/intelligence/contracts';
import { analyzeInput, input, replaceSource, ORG } from '../m3/support/inputs';

describe('M4 SQL injection detector alias propagation', () => {
  it('tracks multi-step linear const alias propagation from source to sink', async () => {
    const raw = replaceSource(input(), content => content
      .replace('return res.json', 'const a = req.query.q; const b = a; const c = b; const d = c; return res.json')
      .replace('" + req.query.q + "', '" + d + "'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.symbol).toBe('db.prepare');
    const varSteps = finding.flow.filter(step => step.kind === 'VARIABLE').map(step => step.location.symbol);
    expect(varSteps).toEqual(['a', 'b', 'c', 'd']);
  });

  it('does not leak unreferenced alias branches into the taint flow', async () => {
    const raw = replaceSource(input(), content => content
      .replace('return res.json', 'const src = req.query.q; const unusedAlias = src; const activeAlias = src; return res.json')
      .replace('" + req.query.q + "', '" + activeAlias + "'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    const varSteps = result.findings[0].flow.filter(step => step.kind === 'VARIABLE').map(step => step.location.symbol);
    expect(varSteps).toEqual(['src', 'activeAlias']);
    expect(result.findings[0].flow.some(step => step.location.symbol === 'unusedAlias')).toBe(false);
  });

  it('propagates aliases through parenthesized expressions', async () => {
    const raw = replaceSource(input(), content => content
      .replace('return res.json', 'const initial = (req.query.q); const wrapped = ((initial)); return res.json')
      .replace('" + req.query.q + "', '" + wrapped + "'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    const varSteps = result.findings[0].flow.filter(step => step.kind === 'VARIABLE').map(step => step.location.symbol);
    expect(varSteps).toEqual(['initial', 'wrapped']);
  });

  it('tracks alias propagation across a multi-declarator const statement', async () => {
    const raw = replaceSource(input(), content => content
      .replace('return res.json', 'const first = req.query.q, second = first, third = second; return res.json')
      .replace('" + req.query.q + "', '" + third + "'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    const varSteps = result.findings[0].flow.filter(step => step.kind === 'VARIABLE').map(step => step.location.symbol);
    expect(varSteps).toEqual(['first', 'second', 'third']);
  });

  it('safe untainted constant alias chains yield NOT_DETECTED as negative controls', async () => {
    const raw = replaceSource(input(), content => content
      .replace('return res.json', 'const safeConst = "safe-literal"; const safeAlias1 = safeConst; const safeAlias2 = safeAlias1; return res.json')
      .replace('req.query.q', 'safeAlias2'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
  });

  it('fails closed when an alias is declared with non-const let binding', async () => {
    const raw = replaceSource(input(), content => content
      .replace('return res.json', 'let mutableAlias = req.query.q; return res.json')
      .replace('" + req.query.q + "', '" + mutableAlias + "'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('UNSUPPORTED_STATEMENT');
  });

  it('fails closed when referencing an unbound alias identifier', async () => {
    const raw = replaceSource(input(), content => content
      .replace('return res.json', 'const bound = unboundIdentifier; return res.json')
      .replace('" + req.query.q + "', '" + bound + "'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('UNBOUND_NAME');
  });

  it('fails closed on duplicate alias binding in the same scope', async () => {
    const raw = replaceSource(input(), content => content
      .replace('return res.json', 'const shadow = req.query.q; const shadow = "duplicate"; return res.json'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('DUPLICATE_BINDING');
  });

  it('generates canonical CANDIDATE hypothesis from alias-propagated SQL injection finding', async () => {
    const raw = replaceSource(input(), content => content
      .replace('return res.json', 'const alias1 = req.query.q; const alias2 = alias1; return res.json')
      .replace('" + req.query.q + "', '" + alias2 + "'));
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    const mockCommit = '1111111111111111111111111111111111111111';
    const bridge = createSqlCandidateBridge(async () => mockCommit);
    const candidateHypotheses = await bridge(result, snapshot, ingestion, ORG);
    expect(candidateHypotheses).toHaveLength(1);
    const { candidate, candidateBinding } = candidateHypotheses[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.snapshot.commitSha).toBe(mockCommit);
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);
  });
});
