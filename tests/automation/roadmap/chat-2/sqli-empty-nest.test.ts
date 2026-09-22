import { describe, expect, it } from 'vitest';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { computeCandidateBinding } from '../../../../worker/intelligence/contracts';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

const VALID_COMMIT = '1111111111111111111111111111111111111111';

describe('Roadmap Chat-2: SQL injection detector null-empty-boundary nested helper tests', () => {
  it('detects SQL injection when untrusted input flows through nested helpers with empty string boundary', async () => {
    const raw = replaceSource(input(), source => source.replace(
      'function searchRoute',
      'function innerNest(prefix: string, value: string) {\n  return prefix + value;\n}\n' +
      'function outerNest(emptyBoundary: string, value: string) {\n  return innerNest(emptyBoundary, value);\n}\n' +
      'function searchRoute'
    ).replace(
      'return res.json',
      'const query = outerNest("", req.query.q);\n    return res.json'
    ).replace(
      '" + req.query.q + "',
      '" + query + "'
    ));

    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.symbol).toBe('db.prepare');
    expect(finding.flow.some(step => step.kind === 'CALL')).toBe(true);
    expect(finding.flow.some(step => step.kind === 'ARGUMENT')).toBe(true);
    expect(finding.flow.some(step => step.kind === 'RETURN')).toBe(true);
    expect(finding.flow.some(step => step.kind === 'CONCAT')).toBe(true);
  });

  it('proves negative control: clean constant passed through nested helpers yields NOT_DETECTED', async () => {
    const raw = replaceSource(input(), source => source.replace(
      'function searchRoute',
      'function innerNest(prefix: string, value: string) {\n  return prefix + value;\n}\n' +
      'function outerNest(emptyBoundary: string, value: string) {\n  return innerNest(emptyBoundary, value);\n}\n' +
      'function searchRoute'
    ).replace(
      'return res.json',
      'const query = outerNest("", "safe_constant");\n    return res.json'
    ).replace(
      '" + req.query.q + "',
      '" + query + "'
    ));

    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
  });

  it('proves negative control: empty string passed as query through nested helpers yields NOT_DETECTED', async () => {
    const raw = replaceSource(input(), source => source.replace(
      'function searchRoute',
      'function innerNest(prefix: string, value: string) {\n  return prefix + value;\n}\n' +
      'function outerNest(emptyBoundary: string, value: string) {\n  return innerNest(emptyBoundary, value);\n}\n' +
      'function searchRoute'
    ).replace(
      'return res.json',
      'const emptyQuery = outerNest("", "");\n    return res.json'
    ).replace(
      '" + req.query.q + "',
      '" + emptyQuery + "'
    ));

    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
  });

  it('detects tainted flow when nested helper concatenates empty string suffix to input', async () => {
    const raw = replaceSource(input(), source => source.replace(
      'function searchRoute',
      'function appendEmpty(val: string) {\n  const empty = "";\n  return val + empty;\n}\n' +
      'function nestWrap(val: string) {\n  return appendEmpty(val);\n}\n' +
      'function searchRoute'
    ).replace(
      'return res.json',
      'const query = nestWrap(req.query.q);\n    return res.json'
    ).replace(
      '" + req.query.q + "',
      '" + query + "'
    ));

    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].source.symbol).toBe('query.q');
    expect(result.findings[0].sink.symbol).toBe('db.prepare');
  });

  it('fails closed with ANALYSIS_INCONCLUSIVE on null boundary in nested helper call', async () => {
    const raw = replaceSource(input(), source => source.replace(
      'function searchRoute',
      'function nest(val: string) {\n  return val;\n}\n' +
      'function searchRoute'
    ).replace(
      'return res.json',
      'nest(null);\n    return res.json'
    ));

    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('UNSUPPORTED_EXPRESSION');
  });

  it('preserves CANDIDATE verification state and canonical binding via candidate bridge for detected nested case', async () => {
    const raw = replaceSource(input(), source => source.replace(
      'function searchRoute',
      'function innerNest(prefix: string, value: string) {\n  return prefix + value;\n}\n' +
      'function outerNest(emptyBoundary: string, value: string) {\n  return innerNest(emptyBoundary, value);\n}\n' +
      'function searchRoute'
    ).replace(
      'return res.json',
      'const query = outerNest("", req.query.q);\n    return res.json'
    ).replace(
      '" + req.query.q + "',
      '" + query + "'
    ));

    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');

    const bridge = createSqlCandidateBridge(async () => VALID_COMMIT);
    const hypotheses = await bridge(result, snapshot, ingestion, ORG);

    expect(hypotheses).toHaveLength(1);
    const { candidate, candidateBinding } = hypotheses[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.snapshot.commitSha).toBe(VALID_COMMIT);
    expect(candidate.organizationId).toBe(ORG);
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
  });
});
