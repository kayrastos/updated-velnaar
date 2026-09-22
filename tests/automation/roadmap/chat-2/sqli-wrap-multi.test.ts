import { describe, expect, it } from 'vitest';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { computeCandidateBinding, createVerificationState, validateFindingCandidate } from '../../../../worker/intelligence/contracts';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

const multiStageHelpers = `
function wrapStageOne(untrusted: string) {
  return wrapStageTwo(untrusted);
}
function wrapStageTwo(param: string) {
  return wrapStageThree(param);
}
function wrapStageThree(value: string) {
  return value;
}
`;

describe('RM_SQLI_WRAP_MULTI: multi-stage wrapper boundary detection and candidate bridging', () => {
  it('detects SQL injection through a three-stage helper wrapper pipeline with full flow provenance', async () => {
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute', multiStageHelpers + '\nfunction searchRoute')
      .replace('return res.json', 'const stageResult = wrapStageOne(req.query.q); return res.json')
      .replace('" + req.query.q + "', '" + stageResult + "'));
    const run = await analyzeInput(raw);

    expect(run.result.status).toBe('DETECTED');
    expect(run.result.limitations).toEqual([]);
    expect(run.result.findings).toHaveLength(1);

    const finding = run.result.findings[0];
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.symbol).toBe('db.prepare');

    expect(finding.flow[0].kind).toBe('SOURCE');
    expect(finding.flow.at(-1)!.kind).toBe('SINK');

    const callSymbols = finding.flow.filter(s => s.kind === 'CALL').map(s => s.location.symbol);
    expect(callSymbols).toEqual(['wrapStageOne', 'wrapStageTwo', 'wrapStageThree']);

    const argumentSteps = finding.flow.filter(s => s.kind === 'ARGUMENT');
    expect(argumentSteps).toHaveLength(3);

    const returnSteps = finding.flow.filter(s => s.kind === 'RETURN');
    expect(returnSteps).toHaveLength(3);

    const variableSteps = finding.flow.filter(s => s.kind === 'VARIABLE');
    expect(variableSteps.some(s => s.location.symbol === 'stageResult')).toBe(true);

    const validated = await validateSqlAnalysis(run.result, run.snapshot, run.ingestion, ORG);
    expect(validated).toEqual(run.result);
  });

  it('bridges multi-stage wrapper findings into canonical FindingCandidate preserving CANDIDATE state', async () => {
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute', multiStageHelpers + '\nfunction searchRoute')
      .replace('return res.json', 'const stageResult = wrapStageOne(req.query.q); return res.json')
      .replace('" + req.query.q + "', '" + stageResult + "'));
    const run = await analyzeInput(raw);

    const checkedCommit = '46db4c208f886afda939c04ae93580fbabd57344';
    const bridge = createSqlCandidateBridge(async () => checkedCommit);
    const candidates = await bridge(run.result, run.snapshot, run.ingestion, ORG);

    expect(candidates).toHaveLength(1);
    const { candidate, candidateBinding } = candidates[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.snapshot.commitSha).toBe(checkedCommit);
    expect(candidate.source.symbol).toBe('query.q');
    expect(candidate.sink.symbol).toBe('db.prepare');
    expect(candidate.sensorEvidence[0].sensorType).toBe('VELNAR_STRUCTURAL');
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);
    expect(createVerificationState(candidate, ORG).state).toBe('CANDIDATE');
  });

  it('negative control: safe constant input through multi-stage wrapper yields NOT_DETECTED and no candidate', async () => {
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute', multiStageHelpers + '\nfunction searchRoute')
      .replace('return res.json', 'const stageResult = wrapStageOne("safe-constant"); return res.json')
      .replace('" + req.query.q + "', '" + stageResult + "'));
    const run = await analyzeInput(raw);

    expect(run.result.status).toBe('NOT_DETECTED');
    expect(run.result.findings).toEqual([]);

    const bridge = createSqlCandidateBridge(async () => '46db4c208f886afda939c04ae93580fbabd57344');
    expect(await bridge(run.result, run.snapshot, run.ingestion, ORG)).toEqual([]);
  });

  it('negative control: intermediate wrapper stage resetting flow to constant yields NOT_DETECTED', async () => {
    const resetHelpers = `
function wrapStageOne(untrusted: string) {
  return wrapStageTwo(untrusted);
}
function wrapStageTwo(param: string) {
  const sanitized = "safe-default";
  return wrapStageThree(sanitized);
}
function wrapStageThree(value: string) {
  return value;
}
`;
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute', resetHelpers + '\nfunction searchRoute')
      .replace('return res.json', 'const stageResult = wrapStageOne(req.query.q); return res.json')
      .replace('" + req.query.q + "', '" + stageResult + "'));
    const run = await analyzeInput(raw);

    expect(run.result.status).toBe('NOT_DETECTED');
    expect(run.result.findings).toEqual([]);
  });

  it('fail-closed limitation: mutual recursion in multi-stage wrapper results in CALL_CYCLE and ANALYSIS_INCONCLUSIVE', async () => {
    const cycleHelpers = `
function wrapStageOne(v: string) {
  return wrapStageTwo(v);
}
function wrapStageTwo(v: string) {
  return wrapStageOne(v);
}
`;
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute', cycleHelpers + '\nfunction searchRoute')
      .replace('return res.json', 'const stageResult = wrapStageOne(req.query.q); return res.json')
      .replace('" + req.query.q + "', '" + stageResult + "'));
    const run = await analyzeInput(raw);

    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('CALL_CYCLE');
  });
});
