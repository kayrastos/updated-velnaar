import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { ANALYSIS_LIMITS, DETECTOR_VERSION } from '../../../../worker/intelligence/detection/types';
import { canonical } from '../../../../worker/intelligence/ingestion/snapshot';
import { analyzeInput, input, ORG } from '../../../intelligence/m3/support/inputs';

describe('M3 SQL injection detector order stability - direct flow', () => {
  it('detects direct request concatenation with deterministic source-to-sink flow', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(0));
    expect(result.status).toBe('DETECTED');
    expect(result.limitations).toEqual([]);
    expect(result.findings).toHaveLength(1);

    const finding = result.findings[0];
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.symbol).toBe('db.prepare');
    expect(finding.flow[0].kind).toBe('SOURCE');
    expect(finding.flow.at(-1)!.kind).toBe('SINK');
    expect(finding.flow.some(step => step.kind === 'CONCAT')).toBe(true);

    const validated = await validateSqlAnalysis(result, snapshot, ingestion, ORG);
    expect(validated).toEqual(result);
  });

  it('maintains strict result and fingerprint stability across repeated evaluations', async () => {
    const { snapshot, ingestion, result: initial } = await analyzeInput(input(0));
    const repeat1 = await detectSqlInjection(snapshot, ingestion, ORG);
    const repeat2 = await detectSqlInjection(snapshot, ingestion, ORG);

    expect(repeat1).toEqual(initial);
    expect(repeat2).toEqual(initial);
    expect(repeat1.resultFingerprint).toBe(initial.resultFingerprint);
    expect(repeat2.resultFingerprint).toBe(initial.resultFingerprint);

    const { resultFingerprint, ...body } = repeat1;
    const expectedDigest = createHash('sha256').update(DETECTOR_VERSION + '\n' + canonical(body)).digest('hex');
    expect(resultFingerprint).toBe('sha256:' + expectedDigest);
  });

  it('is invariant under file enumeration ordering permutations', async () => {
    const normalInput = input(0);
    const reversedInput = { ...normalInput, files: [...normalInput.files].reverse() };

    const normalRun = await analyzeInput(normalInput);
    const reversedRun = await analyzeInput(reversedInput);

    expect(reversedRun.result).toEqual(normalRun.result);
    expect(reversedRun.result.resultFingerprint).toBe(normalRun.result.resultFingerprint);
    expect(reversedRun.result.findings[0].findingId).toBe(normalRun.result.findings[0].findingId);
    expect(reversedRun.result.findings[0].flow).toEqual(normalRun.result.findings[0].flow);
  });

  it('produces unique, bounded, and ordered flow step identifiers', async () => {
    const { result } = await analyzeInput(input(0));
    const finding = result.findings[0];

    const stepIds = finding.flow.map(step => step.id);
    expect(new Set(stepIds).size).toBe(stepIds.length);
    expect(finding.flow.length).toBeLessThanOrEqual(ANALYSIS_LIMITS.flowLength);

    const kinds = finding.flow.map(step => step.kind);
    expect(kinds[0]).toBe('SOURCE');
    expect(kinds[kinds.length - 1]).toBe('SINK');
    expect(kinds.filter(k => k === 'SOURCE')).toHaveLength(1);
  });
});
