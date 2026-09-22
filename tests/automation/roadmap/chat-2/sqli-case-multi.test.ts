import { describe, expect, it } from 'vitest';
import { CONTRACT_VERSION, computeCandidateBinding } from '../../../../worker/intelligence/contracts';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

describe('V1 discovery-intelligence: sqli case-sensitivity multi-stage roadmap', () => {
  const commitSha = '1'.repeat(40);
  const bridge = createSqlCandidateBridge(async () => commitSha);

  it('detects multi-stage alias chains where identifier casing is consistent', async () => {
    const raw = replaceSource(input(), content => content
      .replace('return res.json',
        'const stageOne = req.query.q; const stageTwo = stageOne; const stageThree = stageTwo; return res.json')
      .replace('" + req.query.q + "', '" + stageThree + "'));
    const { snapshot, ingestion, result } = await analyzeInput(raw);

    expect(result.status).toBe('DETECTED');
    expect(result.limitations).toEqual([]);
    expect(result.findings).toHaveLength(1);

    const finding = result.findings[0];
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.symbol).toBe('db.prepare');
    expect(finding.flow.filter(step => step.kind === 'VARIABLE').map(step => step.location.symbol))
      .toEqual(['stageOne', 'stageTwo', 'stageThree']);

    const hypotheses = await bridge(result, snapshot, ingestion, ORG);
    expect(hypotheses).toHaveLength(1);
    const { candidate, candidateBinding } = hypotheses[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.snapshot.commitSha).toBe(commitSha);
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(candidateBinding.startsWith(`${CONTRACT_VERSION}:FindingCandidate\n`)).toBe(true);
    expect(candidateBinding.startsWith('sha256:')).toBe(false);
  });

  it('proves negative control when a differently-cased identifier carries a safe constant', async () => {
    const raw = replaceSource(input(), content => content
      .replace('return res.json',
        'const stageOne = req.query.q; const StageOne = "safe_constant"; const stageTwo = StageOne; const stageThree = stageTwo; return res.json')
      .replace('" + req.query.q + "', '" + stageThree + "'));
    const { snapshot, ingestion, result } = await analyzeInput(raw);

    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);

    const hypotheses = await bridge(result, snapshot, ingestion, ORG);
    expect(hypotheses).toEqual([]);
  });

  it('tracks multi-stage helper function flow with case-sensitive parameter and return propagation', async () => {
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute',
        'function buildQuery(paramVal: string) { const nextVal = paramVal; return nextVal; }\nfunction searchRoute')
      .replace('return res.json',
        'const seed = req.query.q; const queryVal = buildQuery(seed); return res.json')
      .replace('" + req.query.q + "', '" + queryVal + "'));
    const { result } = await analyzeInput(raw);

    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    const flow = result.findings[0].flow;
    expect(flow.some(step => step.kind === 'CALL' && step.location.symbol === 'buildQuery')).toBe(true);
    expect(flow.some(step => step.kind === 'ARGUMENT' && step.location.symbol === 'paramVal')).toBe(true);
    expect(flow.some(step => step.kind === 'RETURN' && step.location.symbol === 'return')).toBe(true);
  });

  it('proves negative control when helper function returns a safe differently-cased constant', async () => {
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute',
        'function buildSafeQuery(paramVal: string) { const ParamVal = "clean_constant"; return ParamVal; }\nfunction searchRoute')
      .replace('return res.json',
        'const seed = req.query.q; const queryVal = buildSafeQuery(seed); return res.json')
      .replace('" + req.query.q + "', '" + queryVal + "'));
    const { result } = await analyzeInput(raw);

    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
  });

  it('preserves query property name casing in multi-stage source symbols', async () => {
    const raw = replaceSource(input(), content => content
      .replace('return res.json',
        'const itemA = req.query.searchKey; const itemB = itemA; return res.json')
      .replace('" + req.query.q + "', '" + itemB + "'));
    const { result } = await analyzeInput(raw);

    expect(result.status).toBe('DETECTED');
    expect(result.findings[0].source.symbol).toBe('query.searchKey');
    expect(result.findings[0].flow.filter(step => step.kind === 'VARIABLE').map(step => step.location.symbol))
      .toEqual(['itemA', 'itemB']);
  });

  it('fails closed with ANALYSIS_INCONCLUSIVE on unsupported casing method expressions', async () => {
    const raw = replaceSource(input(), content => content
      .replace('return res.json',
        'const lower = req.query.q.toLowerCase(); return res.json')
      .replace('" + req.query.q + "', '" + lower + "'));
    const { result } = await analyzeInput(raw);

    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('UNSUPPORTED_EXPRESSION');
  });
});
