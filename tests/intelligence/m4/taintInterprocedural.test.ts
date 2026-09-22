import { describe, expect, it } from 'vitest';
import { createSqlCandidateBridge } from '../../../worker/intelligence/detection/candidate';
import { computeCandidateBinding, validateFindingCandidate } from '../../../worker/intelligence/contracts';
import { analyzeInput, input, replaceSource, ORG } from '../m3/support/inputs';

describe('M4 interprocedural taint transfer analysis', () => {
  it('propagates taint across multi-hop helper call chains to sink', async () => {
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute',
        'function stepA(v: string) { return stepB(v); }\nfunction stepB(v: string) { return stepC(v); }\nfunction stepC(v: string) { return v; }\nfunction searchRoute')
      .replace('req.query.q', 'stepA(req.query.q)'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.symbol).toBe('db.prepare');
    const calls = finding.flow.filter(s => s.kind === 'CALL').map(s => s.location.symbol);
    expect(calls).toEqual(['stepA', 'stepB', 'stepC']);
    expect(finding.flow.filter(s => s.kind === 'ARGUMENT')).toHaveLength(3);
    expect(finding.flow.filter(s => s.kind === 'RETURN')).toHaveLength(3);
  });

  it('records helper arguments and query-builder returns without executing functions in fixture 5', async () => {
    const { result } = await analyzeInput(input(5));
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    const flow = result.findings[0].flow;
    expect(flow[0].kind).toBe('SOURCE');
    expect(flow.at(-1)!.kind).toBe('SINK');
    expect(flow.filter(s => s.kind === 'CALL').map(s => s.location.symbol)).toEqual(['lookup', 'buildQuery']);
    expect(flow.filter(s => s.kind === 'ARGUMENT')).toHaveLength(2);
    expect(flow.some(s => s.kind === 'RETURN')).toBe(true);
  });

  it('preserves provenance across cross-file named import procedure boundaries in fixture 6', async () => {
    const { result } = await analyzeInput(input(6));
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    const files = [...new Set(finding.flow.map(step => step.location.filePath))];
    expect(files).toEqual(['src/routes.ts', 'src/service.ts', 'src/repository.ts']);
    expect(finding.source.filePath).toBe('src/routes.ts');
    expect(finding.sink.filePath).toBe('src/repository.ts');
  });

  it('negative control: clean argument returned by helper does not transfer taint', async () => {
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute',
        'function choose(tainted: string, cleanVal: string) { return cleanVal; }\nfunction searchRoute')
      .replace('req.query.q', 'choose(req.query.q, "safe")'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toHaveLength(0);
  });

  it('negative control: disconnected helper functions do not generate findings', async () => {
    const { result, ingestion } = await analyzeInput(input(3));
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toHaveLength(0);
    expect(ingestion.sourceUnits[0].functions.some(f => f.symbol === 'disconnectedRoute')).toBe(true);
  });

  it('bridges interprocedural detected finding to canonical CANDIDATE hypothesis', async () => {
    const { result, snapshot, ingestion } = await analyzeInput(input(5));
    expect(result.status).toBe('DETECTED');
    const checkedCommit = 'a'.repeat(40);
    const bridge = createSqlCandidateBridge(async () => checkedCommit);
    const hypotheses = await bridge(result, snapshot, ingestion, ORG);
    expect(hypotheses).toHaveLength(1);
    const { candidate, candidateBinding } = hypotheses[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.snapshot.commitSha).toBe(checkedCommit);
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);
  });
});
