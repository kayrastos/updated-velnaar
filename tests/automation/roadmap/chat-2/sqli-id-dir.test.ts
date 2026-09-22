import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { ANALYSIS_LIMITS, DETECTOR_VERSION } from '../../../../worker/intelligence/detection/types';
import { canonical } from '../../../../worker/intelligence/ingestion/snapshot';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

describe('roadmap chat-2: sqli-detector direct identity stability', () => {
  it('detects direct SQL injection with deterministic finding and result fingerprints', async () => {
    const direct1 = await analyzeInput(input(0));
    const direct2 = await analyzeInput(input(0));

    expect(direct1.result.status).toBe('DETECTED');
    expect(direct1.result.findings).toHaveLength(1);
    expect(direct1.result.limitations).toEqual([]);
    expect(direct1.result.resultFingerprint).toBe(direct2.result.resultFingerprint);
    expect(direct1.result.findings[0]!.findingId).toBe(direct2.result.findings[0]!.findingId);
    expect(direct1.result).toEqual(direct2.result);

    const finding = direct1.result.findings[0]!;
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.symbol).toBe('db.prepare');
    expect(finding.flow[0]!.kind).toBe('SOURCE');
    expect(finding.flow.at(-1)!.kind).toBe('SINK');
    expect(finding.flow.some(step => step.kind === 'CONCAT')).toBe(true);
    expect(finding.flow.length).toBeLessThanOrEqual(ANALYSIS_LIMITS.flowLength);

    const { resultFingerprint, ...body } = direct1.result;
    const expectedFingerprint = 'sha256:' + createHash('sha256').update(DETECTOR_VERSION + '\n' + canonical(body)).digest('hex');
    expect(resultFingerprint).toBe(expectedFingerprint);
  });

  it('preserves identity and findings under file enumeration order reversal', async () => {
    const raw = input(0);
    const reversed = { ...raw, files: [...raw.files].reverse() };
    const direct = await analyzeInput(raw);
    const fromReversed = await analyzeInput(reversed);

    expect(fromReversed.result).toEqual(direct.result);
    expect(fromReversed.result.resultFingerprint).toBe(direct.result.resultFingerprint);

    const repeated = await detectSqlInjection(direct.snapshot, direct.ingestion, ORG);
    expect(repeated).toEqual(direct.result);
  });

  it('preserves analysis decision and flow structure across opaque fixture identities', async () => {
    const direct = await analyzeInput(input(0));
    const renamed = await analyzeInput({ ...input(0), fixtureId: 'm2-case-008' });

    expect(renamed.result.status).toBe(direct.result.status);
    expect(renamed.result.findings).toHaveLength(1);

    const directFlow = direct.result.findings[0]!.flow.map(step => ({ kind: step.kind, location: step.location }));
    const renamedFlow = renamed.result.findings[0]!.flow.map(step => ({ kind: step.kind, location: step.location }));
    expect(renamedFlow).toEqual(directFlow);
  });

  it('differentiates mutated source with a distinct fingerprint', async () => {
    const direct = await analyzeInput(input(0));
    const mutated = await analyzeInput(replaceSource(input(0), content => '\n' + content));

    expect(mutated.result.status).toBe('DETECTED');
    expect(mutated.result.snapshotId).not.toBe(direct.result.snapshotId);
    expect(mutated.result.resultFingerprint).not.toBe(direct.result.resultFingerprint);
  });

  it('validates genuine direct analysis and rejects forged findings', async () => {
    const direct = await analyzeInput(input(0));
    const validated = await validateSqlAnalysis(direct.result, direct.snapshot, direct.ingestion, ORG);
    expect(validated).toEqual(direct.result);

    const tampered = {
      ...direct.result,
      status: 'NOT_DETECTED' as const,
    };
    await expect(validateSqlAnalysis(tampered, direct.snapshot, direct.ingestion, ORG))
      .rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
  });
});
