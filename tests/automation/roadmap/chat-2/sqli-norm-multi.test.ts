import { describe, expect, it } from 'vitest';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { computeCandidateBinding, validateFindingCandidate } from '../../../../worker/intelligence/contracts';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

describe('V1 discovery-intelligence: sqli-detector normalization-boundary multi-stage roadmap', () => {
  it('detects multi-stage variable alias chain flowing to SQL sink', async () => {
    const raw = replaceSource(input(), content =>
      content
        .replace(
          'return res.json',
          'const step1 = req.query.q;\n  const step2 = step1;\n  const step3 = step2;\n  return res.json',
        )
        .replace('" + req.query.q + "', '" + step3 + "'),
    );
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    expect(result.limitations).toEqual([]);

    const finding = result.findings[0];
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.symbol).toBe('db.prepare');
    expect(finding.flow[0].kind).toBe('SOURCE');
    expect(finding.flow.at(-1)!.kind).toBe('SINK');

    const variableSymbols = finding.flow
      .filter(step => step.kind === 'VARIABLE')
      .map(step => step.location.symbol);
    expect(variableSymbols).toEqual(['step1', 'step2', 'step3']);

    const validated = await validateSqlAnalysis(result, snapshot, ingestion, ORG);
    expect(validated.resultFingerprint).toBe(result.resultFingerprint);
  });

  it('detects multi-stage helper function invocation pipeline without executing functions', async () => {
    const raw = replaceSource(input(), content =>
      content
        .replace(
          'function searchRoute',
          'function stageA(val: string) { const a = val; return a; }\n' +
            'function stageB(val: string) { const b = val; return b; }\n' +
            'function searchRoute',
        )
        .replace(
          'return res.json',
          'const mid1 = stageA(req.query.q);\n' +
            'const mid2 = stageB(mid1);\n' +
            'return res.json',
        )
        .replace('" + req.query.q + "', '" + mid2 + "'),
    );
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);

    const finding = result.findings[0];
    const callSymbols = finding.flow
      .filter(step => step.kind === 'CALL')
      .map(step => step.location.symbol);
    expect(callSymbols).toEqual(['stageA', 'stageB']);

    const argCount = finding.flow.filter(step => step.kind === 'ARGUMENT').length;
    expect(argCount).toBe(2);
    expect(finding.flow.some(step => step.kind === 'RETURN')).toBe(true);
  });

  it('fails closed when multi-stage pipeline encounters string normalization methods (.trim / .toLowerCase / .replace)', async () => {
    for (const normalizer of ['step1.trim()', 'step1.toLowerCase()', 'step1.replace("x", "")']) {
      const raw = replaceSource(input(), content =>
        content
          .replace(
            'return res.json',
            `const step1 = req.query.q;\n  const step2 = ${normalizer};\n  return res.json`,
          )
          .replace('" + req.query.q + "', '" + step2 + "'),
      );
      const { result } = await analyzeInput(raw);
      expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
      expect(result.findings).toEqual([]);
      expect(result.limitations).toHaveLength(1);
      expect(result.limitations[0].code).toBe('UNSUPPORTED_EXPRESSION');
    }
  });

  it('fails closed on multi-source join across multi-stage expressions', async () => {
    const raw = replaceSource(input(), content =>
      content
        .replace(
          'return res.json',
          'const step1 = req.query.q;\n  const step2 = req.query.other + step1;\n  return res.json',
        )
        .replace('" + req.query.q + "', '" + step2 + "'),
    );
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('MULTIPLE_SOURCES');
  });

  it('produces NOT_DETECTED for safe multi-stage constant pipeline without tainted provenance', async () => {
    const raw = replaceSource(input(), content =>
      content
        .replace(
          'return res.json',
          'const step1 = "safe_constant_value";\n  const step2 = step1;\n  const step3 = step2;\n  return res.json',
        )
        .replace('" + req.query.q + "', '" + step3 + "'),
    );
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
  });

  it('preserves CANDIDATE verification state and exact binding semantics across candidate bridge', async () => {
    const raw = replaceSource(input(), content =>
      content
        .replace(
          'return res.json',
          'const step1 = req.query.q;\n  const step2 = step1;\n  return res.json',
        )
        .replace('" + req.query.q + "', '" + step2 + "'),
    );
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');

    const checkedCommit = '1111111111111111111111111111111111111111';
    const bridge = createSqlCandidateBridge(async () => checkedCommit);
    const candidateOutputs = await bridge(result, snapshot, ingestion, ORG);

    expect(candidateOutputs).toHaveLength(1);
    const { candidate, candidateBinding } = candidateOutputs[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.snapshot.commitSha).toBe(checkedCommit);
    expect(candidate.source.symbol).toBe('query.q');
    expect(candidate.sink.symbol).toBe('db.prepare');
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);
  });

  it('yields no candidates from candidate bridge for inconclusive multi-stage normalization attempts', async () => {
    const raw = replaceSource(input(), content =>
      content
        .replace(
          'return res.json',
          'const step1 = req.query.q;\n  const step2 = step1.trim();\n  return res.json',
        )
        .replace('" + req.query.q + "', '" + step2 + "'),
    );
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');

    const bridge = createSqlCandidateBridge(async () => '2222222222222222222222222222222222222222');
    const candidateOutputs = await bridge(result, snapshot, ingestion, ORG);
    expect(candidateOutputs).toEqual([]);
  });
});
