import { describe, expect, it } from 'vitest';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { computeCandidateBinding, createVerificationState, validateFindingCandidate } from '../../../../worker/intelligence/contracts';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

describe('M3 SQL injection detector case-sensitivity: nested helper calls', () => {
  it('detects SQL injection through nested helpers with UPPERCASE SQL keywords', async () => {
    const helpers = [
      'function formatClauseUpper(val: string) {',
      '  return " WHERE ID = \'" + val + "\'";',
      '}',
      'function buildQueryUpper(clause: string) {',
      '  return "SELECT * FROM ITEMS" + clause;',
      '}',
    ].join('\n');
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute', helpers + '\nfunction searchRoute')
      .replace('req.query.q', 'buildQueryUpper(formatClauseUpper(req.query.q))'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.symbol).toBe('db.prepare');
    const callSymbols = finding.flow.filter(s => s.kind === 'CALL').map(s => s.location.symbol);
    expect(callSymbols).toContain('buildQueryUpper');
    expect(callSymbols).toContain('formatClauseUpper');
  });

  it('detects SQL injection through nested helpers with lowercase SQL keywords', async () => {
    const helpers = [
      'function formatClauseLower(val: string) {',
      '  return " where id = \'" + val + "\'";',
      '}',
      'function buildQueryLower(clause: string) {',
      '  return "select * from items" + clause;',
      '}',
    ].join('\n');
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute', helpers + '\nfunction searchRoute')
      .replace('req.query.q', 'buildQueryLower(formatClauseLower(req.query.q))'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].source.symbol).toBe('query.q');
    expect(result.findings[0].sink.symbol).toBe('db.prepare');
  });

  it('detects SQL injection through nested helpers with mixed-case SQL keywords', async () => {
    const helpers = [
      'function formatClauseMixed(val: string) {',
      '  return " WhErE iD = \'" + val + "\'";',
      '}',
      'function buildQueryMixed(clause: string) {',
      '  return "sElEcT * fRoM iTeMs" + clause;',
      '}',
    ].join('\n');
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute', helpers + '\nfunction searchRoute')
      .replace('req.query.q', 'buildQueryMixed(formatClauseMixed(req.query.q))'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].source.symbol).toBe('query.q');
  });

  it('detects SQL injection across a three-level nested helper chain', async () => {
    const helpers = [
      'function levelOne(rawVal: string) {',
      '  return rawVal;',
      '}',
      'function levelTwo(midVal: string) {',
      '  return " WHERE name = \'" + levelOne(midVal);',
      '}',
      'function levelThree(topVal: string) {',
      '  return levelTwo(topVal) + "\'";',
      '}',
    ].join('\n');
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute', helpers + '\nfunction searchRoute')
      .replace('req.query.q', 'levelThree(req.query.q)'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    const callSymbols = result.findings[0].flow.filter(s => s.kind === 'CALL').map(s => s.location.symbol);
    expect(callSymbols).toEqual(expect.arrayContaining(['levelThree', 'levelTwo', 'levelOne']));
  });

  it('negative control: nested helper using safe parameter differing only in case yields NOT_DETECTED', async () => {
    const helpers = [
      'function pickParameter(targetParam: string, TARGETPARAM: string) {',
      '  return TARGETPARAM;',
      '}',
    ].join('\n');
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute', helpers + '\nfunction searchRoute')
      .replace('req.query.q', 'pickParameter(req.query.q, "safe_constant")'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toHaveLength(0);
  });

  it('positive control: nested helper using tainted parameter differing only in case yields DETECTED', async () => {
    const helpers = [
      'function pickParameter(targetParam: string, TARGETPARAM: string) {',
      '  return targetParam;',
      '}',
    ].join('\n');
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute', helpers + '\nfunction searchRoute')
      .replace('req.query.q', 'pickParameter(req.query.q, "safe_constant")'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].source.symbol).toBe('query.q');
  });

  it('fails closed when nested helper identifier casing does not match declared function', async () => {
    const helpers = [
      'function formatValue(v: string) {',
      '  return v;',
      '}',
      'function dispatchHelper(v: string) {',
      '  return FORMATVALUE(v);',
      '}',
    ].join('\n');
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute', helpers + '\nfunction searchRoute')
      .replace('req.query.q', 'dispatchHelper(req.query.q)'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('UNBOUND_NAME');
  });

  it('bridges nested case-sensitive detection to a valid FindingCandidate preserving CANDIDATE state', async () => {
    const helpers = [
      'function innerNest(term: string) {',
      '  return " WHERE title = \'" + term + "\'";',
      '}',
      'function outerNest(queryTerm: string) {',
      '  return "SELECT * FROM items" + innerNest(queryTerm);',
      '}',
    ].join('\n');
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute', helpers + '\nfunction searchRoute')
      .replace('req.query.q', 'outerNest(req.query.q)'));
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');

    const commitSha = '46db4c208f886afda939c04ae93580fbabd57344';
    const bridge = createSqlCandidateBridge(async () => commitSha);
    const candidates = await bridge(result, snapshot, ingestion, ORG);

    expect(candidates).toHaveLength(1);
    const { candidate, candidateBinding } = candidates[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.snapshot.commitSha).toBe(commitSha);
    expect(candidate.organizationId).toBe(ORG);
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);
    expect(createVerificationState(candidate, ORG).state).toBe('CANDIDATE');
  });

  it('candidate bridge returns empty hypotheses array for safe nested negative control', async () => {
    const helpers = [
      'function safeNest(_tainted: string) {',
      '  return "constant_literal";',
      '}',
    ].join('\n');
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute', helpers + '\nfunction searchRoute')
      .replace('req.query.q', 'safeNest(req.query.q)'));
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');

    const bridge = createSqlCandidateBridge(async () => '46db4c208f886afda939c04ae93580fbabd57344');
    const candidates = await bridge(result, snapshot, ingestion, ORG);
    expect(candidates).toEqual([]);
  });
});
