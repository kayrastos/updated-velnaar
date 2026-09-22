import { describe, expect, it } from 'vitest';
import { computeCandidateBinding } from '../../../../worker/intelligence/contracts';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

describe('Roadmap Chat-2: SQL injection positive control for nested calls', () => {
  it('detects SQL injection through nested catalog helper functions (fixture 5)', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(5));

    expect(result.status).toBe('DETECTED');
    expect(result.limitations).toEqual([]);
    expect(result.findings).toHaveLength(1);

    const finding = result.findings[0];
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.sink.symbol).toBe('db.prepare');

    const callSymbols = finding.flow.filter(step => step.kind === 'CALL').map(step => step.location.symbol);
    expect(callSymbols).toEqual(['lookup', 'buildQuery']);
    expect(finding.flow.filter(step => step.kind === 'ARGUMENT')).toHaveLength(2);
    expect(finding.flow.some(step => step.kind === 'RETURN')).toBe(true);

    const bridge = createSqlCandidateBridge(async () => '46db4c208f886afda939c04ae93580fbabd57344');
    const hypotheses = await bridge(result, snapshot, ingestion, ORG);

    expect(hypotheses).toHaveLength(1);
    expect(hypotheses[0].candidate.verificationState).toBe('CANDIDATE');
    expect(hypotheses[0].candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(hypotheses[0].candidateBinding).toBe(computeCandidateBinding(hypotheses[0].candidate, ORG));
  });

  it('detects tainted flow propagating through multi-level nested helper chain', async () => {
    const raw = replaceSource(input(), source => {
      const helpers = [
        'function innerHelper(value: string) {',
        '  return value;',
        '}',
        'function middleHelper(mid: string) {',
        '  return innerHelper(mid);',
        '}',
        'function outerHelper(start: string) {',
        '  return middleHelper(start);',
        '}',
      ].join('\n');

      return source
        .replace('function searchRoute', `${helpers}\nfunction searchRoute`)
        .replace(
          'return res.json',
          'const tainted = outerHelper(req.query.q); return res.json'
        )
        .replace('" + req.query.q + "', '" + tainted + "');
    });

    const { snapshot, ingestion, result } = await analyzeInput(raw);

    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);

    const finding = result.findings[0];
    const callSymbols = finding.flow.filter(step => step.kind === 'CALL').map(step => step.location.symbol);
    expect(callSymbols).toEqual(['outerHelper', 'middleHelper', 'innerHelper']);

    const argSymbols = finding.flow.filter(step => step.kind === 'ARGUMENT').map(step => step.location.symbol);
    expect(argSymbols).toEqual(['start', 'mid', 'value']);

    expect(finding.flow.some(step => step.kind === 'CONCAT')).toBe(true);
    expect(finding.flow.filter(step => step.kind === 'RETURN')).toHaveLength(3);
    expect(finding.sink.symbol).toBe('db.prepare');

    const bridge = createSqlCandidateBridge(async () => '46db4c208f886afda939c04ae93580fbabd57344');
    const hypotheses = await bridge(result, snapshot, ingestion, ORG);
    expect(hypotheses).toHaveLength(1);
    expect(hypotheses[0].candidate.verificationState).toBe('CANDIDATE');
    expect(hypotheses[0].candidateBinding).toBe(computeCandidateBinding(hypotheses[0].candidate, ORG));
  });

  it('proves negative control when nested helpers return safe untainted values', async () => {
    const raw = replaceSource(input(), source => {
      const helpers = [
        'function innerSafe(value: string) {',
        '  return "safe";',
        '}',
        'function outerSafe(start: string) {',
        '  return innerSafe(start);',
        '}',
      ].join('\n');

      return source
        .replace('function searchRoute', `${helpers}\nfunction searchRoute`)
        .replace(
          'return res.json',
          'const cleanValue = outerSafe(req.query.q); return res.json'
        )
        .replace('" + req.query.q + "', '" + cleanValue + "');
    });

    const { snapshot, ingestion, result } = await analyzeInput(raw);

    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toEqual([]);

    const bridge = createSqlCandidateBridge(async () => '46db4c208f886afda939c04ae93580fbabd57344');
    const hypotheses = await bridge(result, snapshot, ingestion, ORG);
    expect(hypotheses).toEqual([]);
  });
});
