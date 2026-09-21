import { describe, expect, it } from 'vitest';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { computeCandidateBinding, validateFindingCandidate } from '../../../../worker/intelligence/contracts';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

describe('V1 discovery intelligence: SQL injection detector multi-stage alias propagation', () => {
  it('detects a multi-stage sequential variable alias chain across 5 hops', async () => {
    const raw = replaceSource(input(), content => content
      .replace(
        'return res.json',
        'const s1 = req.query.q;\n    const s2 = s1;\n    const s3 = s2;\n    const s4 = s3;\n    const s5 = s4;\n    return res.json',
      )
      .replace('" + req.query.q + "', '" + s5 + "'));
    const { result } = await analyzeInput(raw);

    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.symbol).toBe('db.prepare');

    const variableSteps = finding.flow
      .filter(step => step.kind === 'VARIABLE')
      .map(step => step.location.symbol);
    expect(variableSteps).toEqual(['s1', 's2', 's3', 's4', 's5']);
    expect(finding.flow[0].kind).toBe('SOURCE');
    expect(finding.flow.at(-1)!.kind).toBe('SINK');
  });

  it('detects multi-stage alias propagation interleaved with string concatenation operations', async () => {
    const raw = replaceSource(input(), content => content
      .replace(
        'return res.json',
        'const stage1 = req.query.q;\n    const stage2 = stage1;\n    const stage3 = stage2 + "";\n    const stage4 = stage3;\n    return res.json',
      )
      .replace('" + req.query.q + "', '" + stage4 + "'));
    const { result } = await analyzeInput(raw);

    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    const variables = finding.flow
      .filter(step => step.kind === 'VARIABLE')
      .map(step => step.location.symbol);
    expect(variables).toEqual(['stage1', 'stage2', 'stage3', 'stage4']);
    expect(finding.flow.some(step => step.kind === 'CONCAT')).toBe(true);
  });

  it('detects multi-stage alias propagation traversing nested helper call boundaries', async () => {
    const helpers = [
      'function helperInner(valA: string) {',
      '  const in1 = valA;',
      '  const in2 = in1;',
      '  return in2;',
      '}',
      'function helperOuter(valB: string) {',
      '  const out1 = valB;',
      '  const out2 = helperInner(out1);',
      '  return out2;',
      '}',
    ].join('\n');

    const raw = replaceSource(input(), content => content
      .replace('function searchRoute', `${helpers}\nfunction searchRoute`)
      .replace(
        'return res.json',
        'const hop1 = req.query.q;\n    const hop2 = hop1;\n    const hop3 = helperOuter(hop2);\n    const hop4 = hop3;\n    return res.json',
      )
      .replace('" + req.query.q + "', '" + hop4 + "'));
    const { result } = await analyzeInput(raw);

    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    const kinds = finding.flow.map(step => step.kind);
    expect(kinds).toContain('CALL');
    expect(kinds).toContain('ARGUMENT');
    expect(kinds).toContain('RETURN');
    expect(kinds).toContain('VARIABLE');
    expect(kinds).toContain('CONCAT');
    expect(kinds).toContain('SINK');
  });

  it('produces NOT_DETECTED when a constant literal flows through a multi-stage alias chain', async () => {
    const raw = replaceSource(input(), content => content
      .replace(
        'return res.json',
        'const c1 = "static_filter";\n    const c2 = c1;\n    const c3 = c2;\n    const c4 = c3;\n    return res.json',
      )
      .replace('" + req.query.q + "', '" + c4 + "'));
    const { result } = await analyzeInput(raw);

    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toHaveLength(0);
  });

  it('produces NOT_DETECTED when tainted input is aliased but an independent safe alias chain reaches the sink', async () => {
    const raw = replaceSource(input(), content => content
      .replace(
        'return res.json',
        'const tainted1 = req.query.q;\n    const tainted2 = tainted1;\n    const safe1 = "safe_value";\n    const safe2 = safe1;\n    const safe3 = safe2;\n    return res.json',
      )
      .replace('" + req.query.q + "', '" + safe3 + "'));
    const { result } = await analyzeInput(raw);

    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toHaveLength(0);
  });

  it('creates an exact candidate hypothesis with valid canonical binding for multi-stage findings', async () => {
    const checkedCommit = '1111111111111111111111111111111111111111';
    const raw = replaceSource(input(), content => content
      .replace(
        'return res.json',
        'const a1 = req.query.q;\n    const a2 = a1;\n    const a3 = a2;\n    return res.json',
      )
      .replace('" + req.query.q + "', '" + a3 + "'));
    const { snapshot, ingestion, result } = await analyzeInput(raw);

    expect(result.status).toBe('DETECTED');
    const bridge = createSqlCandidateBridge(async () => checkedCommit);
    const hypotheses = await bridge(result, snapshot, ingestion, ORG);

    expect(hypotheses).toHaveLength(1);
    const { candidate, candidateBinding } = hypotheses[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.snapshot.commitSha).toBe(checkedCommit);
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);
  });
});
