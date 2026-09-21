import { describe, expect, it } from 'vitest';
import { createSqlCandidateBridge } from '../../../worker/intelligence/detection/candidate';
import { computeCandidateBinding } from '../../../worker/intelligence/contracts';
import { analyzeInput, input, replaceSource, ORG } from '../m3/support/inputs';

describe('M4 SQL injection nested expression taint flow', () => {
  it('detects taint flow through deeply parenthesized source expression', async () => {
    const raw = replaceSource(input(), content => content.replace('req.query.q', '((((req.query.q))))'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.symbol).toBe('db.prepare');
    expect(finding.flow[0].kind).toBe('SOURCE');
    expect(finding.flow.at(-1)!.kind).toBe('SINK');
  });

  it('detects taint flow across nested binary concatenation with parenthesized operands', async () => {
    const raw = replaceSource(input(), content => content.replace('" + req.query.q + "',
      '" + (("prefix_" + (req.query.q + "_mid")) + "_suffix") + "'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    const concatSteps = finding.flow.filter(step => step.kind === 'CONCAT');
    expect(concatSteps.length).toBeGreaterThanOrEqual(3);
    expect(finding.flow[0].kind).toBe('SOURCE');
    expect(finding.flow.at(-1)!.kind).toBe('SINK');
  });

  it('preserves single-source taint flow when combined with nested safe literal subtrees', async () => {
    const raw = replaceSource(input(), content => content.replace('" + req.query.q + "',
      '" + ((("safe_" + "prefix_") + req.query.q) + ("_suffix" + "_safe")) + "'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    expect(finding.flow.filter(step => step.kind === 'SOURCE')).toHaveLength(1);
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.symbol).toBe('db.prepare');
  });

  it('tracks nested expression taint through variable bindings and parenthesized usage', async () => {
    const raw = replaceSource(input(), content => content.replace('return res.json',
      'const nested = ("tag_" + (req.query.q + "_val")); return res.json')
      .replace('" + req.query.q + "', '" + (("prefix_" + nested) + "_suffix") + "'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    expect(finding.flow.some(step => step.kind === 'VARIABLE' && step.location.symbol === 'nested')).toBe(true);
    expect(finding.flow[0].kind).toBe('SOURCE');
    expect(finding.flow.at(-1)!.kind).toBe('SINK');
  });

  it('yields NOT_DETECTED for clean nested binary expressions without request input', async () => {
    const raw = replaceSource(input(), content => content.replace('" + req.query.q + "',
      '" + (("safe_" + ("literal_" + "value")) + "_safe") + "'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
  });

  it('fails closed with MULTIPLE_SOURCES when nested expressions join multiple sources', async () => {
    const raw = replaceSource(input(), content => content.replace('req.query.q',
      '((req.query.q + ("_" + req.query.q)))'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('MULTIPLE_SOURCES');
  });

  it('fails closed with UNSUPPORTED_EXPRESSION for unsupported expressions inside parentheses', async () => {
    const raw = replaceSource(input(), content => content.replace('req.query.q',
      '((req.query.q ? "a" : "b"))'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('UNSUPPORTED_EXPRESSION');
  });

  it('bridges nested expression finding into an exact-bound CANDIDATE hypothesis', async () => {
    const raw = replaceSource(input(), content => content.replace('req.query.q', '((((req.query.q))))'));
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    const checkedCommit = 'b'.repeat(40);
    const bridge = createSqlCandidateBridge(async () => checkedCommit);
    const hypotheses = await bridge(result, snapshot, ingestion, ORG);
    expect(hypotheses).toHaveLength(1);
    const { candidate, candidateBinding } = hypotheses[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.snapshot.commitSha).toBe(checkedCommit);
    expect(candidate.source.symbol).toBe('query.q');
    expect(candidate.sink.symbol).toBe('db.prepare');
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
  });
});
