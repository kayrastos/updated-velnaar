import { describe, expect, it } from 'vitest';
import { computeCandidateBinding } from '../../../../worker/intelligence/contracts';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

describe('V1 RM_SQLI_ADV_DIR: direct route adversarial edge cases', () => {
  it('detects direct SQL injection through parenthesized and concatenated taint expressions', async () => {
    const raw = replaceSource(input(0), source => source.replace(
      'return res.json',
      'const expr = ("" + ((req.query.q)) + ""); return res.json'
    ).replace(
      '" + req.query.q + "',
      '" + expr + "'
    ));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.limitations).toHaveLength(0);
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.symbol).toBe('db.prepare');
    expect(finding.flow[0].kind).toBe('SOURCE');
    expect(finding.flow.at(-1)!.kind).toBe('SINK');
    expect(finding.flow.some(s => s.kind === 'CONCAT')).toBe(true);
  });

  it('detects direct SQL injection propagated through multiple variable alias hops', async () => {
    const raw = replaceSource(input(0), source => source.replace(
      'return res.json',
      'const a = req.query.q; const b = a; const c = b; const d = c; return res.json'
    ).replace(
      '" + req.query.q + "',
      '" + d + "'
    ));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    const varSymbols = result.findings[0].flow
      .filter(step => step.kind === 'VARIABLE')
      .map(step => step.location.symbol);
    expect(varSymbols).toEqual(['a', 'b', 'c', 'd']);
  });

  it('negative control: bound parameter query fixture produces NOT_DETECTED', async () => {
    const { result } = await analyzeInput(input(1));
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toHaveLength(0);
  });

  it('negative control: taint accessed but not passed to SQL sink produces NOT_DETECTED', async () => {
    const raw = replaceSource(input(0), source => source.replace(
      'return res.json',
      'const unused = req.query.q; return res.json'
    ).replace(
      '" + req.query.q + "',
      '" + "safe_literal" + "'
    ));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toHaveLength(0);
  });

  it('negative control: clean constant string concatenation produces NOT_DETECTED', async () => {
    const raw = replaceSource(input(0), source => source.replace(
      'return res.json',
      'const prefix = "safe_prefix_"; return res.json'
    ).replace(
      '" + req.query.q + "',
      '" + prefix + "'
    ));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toHaveLength(0);
  });

  it('adversarial multi-source concatenation fails closed with MULTIPLE_SOURCES', async () => {
    const raw = replaceSource(input(0), source => source.replace(
      'req.query.q',
      '(req.query.q + req.query.other)'
    ));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('MULTIPLE_SOURCES');
  });

  it('adversarial mutable variable declaration fails closed with UNSUPPORTED_STATEMENT', async () => {
    const raw = replaceSource(input(0), source => source.replace(
      'return res.json',
      'let mutable = req.query.q; return res.json'
    ));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('UNSUPPORTED_STATEMENT');
  });

  it('bridge creates bounded CANDIDATE hypothesis with canonical binding for direct finding', async () => {
    const commitSha = '46db4c208f886afda939c04ae93580fbabd57344';
    const bridge = createSqlCandidateBridge(async () => commitSha);
    const { snapshot, ingestion, result } = await analyzeInput(input(0));
    expect(result.status).toBe('DETECTED');
    const validated = await validateSqlAnalysis(result, snapshot, ingestion, ORG);
    expect(validated.resultFingerprint).toBe(result.resultFingerprint);
    const hypotheses = await bridge(result, snapshot, ingestion, ORG);
    expect(hypotheses).toHaveLength(1);
    const { candidate, candidateBinding } = hypotheses[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.organizationId).toBe(ORG);
    expect(candidate.snapshot.commitSha).toBe(commitSha);
    expect(candidate.source.symbol).toBe('query.q');
    expect(candidate.sink.symbol).toBe('db.prepare');
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
  });
});
