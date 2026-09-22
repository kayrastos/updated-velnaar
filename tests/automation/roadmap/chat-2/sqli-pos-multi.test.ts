import { describe, expect, it } from 'vitest';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { computeCandidateBinding } from '../../../../worker/intelligence/contracts';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

const BASELINE_COMMIT = '46db4c208f886afda939c04ae93580fbabd57344';

describe('Roadmap chat-2 SQL injection positive control: multi-stage taint flow', () => {
  it('detects multi-stage function call pipeline propagating request query to SQL sink', async () => {
    const helperStages = [
      'function stageOne(raw: string) { const step1 = raw; return step1; }',
      'function stageTwo(val: string) { const step2 = stageOne(val); return step2; }',
      'function stageThree(param: string) { const step3 = stageTwo(param); return step3; }',
    ].join('\n');

    const raw = replaceSource(input(), source => source
      .replace('function searchRoute', `${helperStages}\nfunction searchRoute`)
      .replace('return res.json', 'const queryText = stageThree(req.query.q); return res.json')
      .replace('" + req.query.q + "', '" + queryText + "'));

    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.limitations).toEqual([]);
    expect(result.findings).toHaveLength(1);

    const finding = result.findings[0];
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.symbol).toBe('db.prepare');

    const flowKinds = finding.flow.map(step => step.kind);
    expect(flowKinds[0]).toBe('SOURCE');
    expect(flowKinds.at(-1)).toBe('SINK');
    expect(flowKinds).toContain('CALL');
    expect(flowKinds).toContain('ARGUMENT');
    expect(flowKinds).toContain('VARIABLE');
    expect(flowKinds).toContain('RETURN');
    expect(flowKinds).toContain('CONCAT');

    const callSymbols = finding.flow
      .filter(step => step.kind === 'CALL')
      .map(step => step.location.symbol);
    expect(callSymbols).toEqual(['stageThree', 'stageTwo', 'stageOne']);

    const bridge = createSqlCandidateBridge(async () => BASELINE_COMMIT);
    const hypotheses = await bridge(result, snapshot, ingestion, ORG);
    expect(hypotheses).toHaveLength(1);

    const { candidate, candidateBinding } = hypotheses[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.snapshot.commitSha).toBe(BASELINE_COMMIT);
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
  });

  it('detects multi-stage sequential variable alias chain with intermediate concatenations', async () => {
    const raw = replaceSource(input(), source => source
      .replace('return res.json', [
        'const stageA = req.query.q;',
        'const stageB = stageA;',
        'const stageC = stageB;',
        'const stageD = stageC;',
        'return res.json',
      ].join(' '))
      .replace('" + req.query.q + "', '" + stageD + "'));

    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);

    const variableSymbols = result.findings[0].flow
      .filter(step => step.kind === 'VARIABLE')
      .map(step => step.location.symbol);
    expect(variableSymbols).toEqual(['stageA', 'stageB', 'stageC', 'stageD']);
  });

  it('proves negative control: safe constant passed through multi-stage pipeline yields NOT_DETECTED', async () => {
    const helperStages = [
      'function safeStageOne(raw: string) { const step1 = raw; return step1; }',
      'function safeStageTwo(val: string) { const step2 = safeStageOne(val); return step2; }',
    ].join('\n');

    const raw = replaceSource(input(), source => source
      .replace('function searchRoute', `${helperStages}\nfunction searchRoute`)
      .replace('return res.json', 'const safeVal = safeStageTwo("safe_constant"); return res.json')
      .replace('" + req.query.q + "', '" + safeVal + "'));

    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toEqual([]);

    const bridge = createSqlCandidateBridge(async () => BASELINE_COMMIT);
    const hypotheses = await bridge(result, snapshot, ingestion, ORG);
    expect(hypotheses).toEqual([]);
  });

  it('fails closed to ANALYSIS_INCONCLUSIVE when an intermediate stage contains unsupported syntax', async () => {
    const helperStages = [
      'function brokenStage(val: string) { eval(val); return val; }',
    ].join('\n');

    const raw = replaceSource(input(), source => source
      .replace('function searchRoute', `${helperStages}\nfunction searchRoute`)
      .replace('return res.json', 'const brokenVal = brokenStage(req.query.q); return res.json')
      .replace('" + req.query.q + "', '" + brokenVal + "'));

    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations.length).toBeGreaterThanOrEqual(1);
  });
});
