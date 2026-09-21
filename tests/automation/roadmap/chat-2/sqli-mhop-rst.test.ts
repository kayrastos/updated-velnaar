import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { DETECTOR_VERSION } from '../../../../worker/intelligence/detection/types';
import { canonical, validateSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { validateExpressIngestion } from '../../../../worker/intelligence/ingestion/express';
import { computeCandidateBinding } from '../../../../worker/intelligence/contracts';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

describe('V1 discovery intelligence: SQLi multi-hop restart-resume roadmap', () => {
  it('intra-file multi-hop flow produces identical findings and fingerprints after serialized restart-resume', async () => {
    const original = await analyzeInput(input(5));
    expect(original.result.status).toBe('DETECTED');
    expect(original.result.findings).toHaveLength(1);

    const serializedSnapshot = JSON.parse(JSON.stringify(original.snapshot));
    const serializedIngestion = JSON.parse(JSON.stringify(original.ingestion));
    const resumedSnapshot = await validateSnapshot(serializedSnapshot, ORG);
    const resumedIngestion = await validateExpressIngestion(serializedIngestion, ORG);

    const resumedResult = await detectSqlInjection(resumedSnapshot, resumedIngestion, ORG);
    expect(resumedResult).toEqual(original.result);
    expect(resumedResult.resultFingerprint).toBe(original.result.resultFingerprint);

    const validated = await validateSqlAnalysis(resumedResult, resumedSnapshot, resumedIngestion, ORG);
    expect(validated).toEqual(original.result);
  });

  it('cross-file multi-hop flow retains exact call provenance and fingerprint across restart-resume', async () => {
    const original = await analyzeInput(input(6));
    expect(original.result.status).toBe('DETECTED');
    const flow = original.result.findings[0].flow;
    const filePaths = [...new Set(flow.map(step => step.location.filePath))];
    expect(filePaths).toEqual(['src/routes.ts', 'src/service.ts', 'src/repository.ts']);

    const resumed = await analyzeInput(input(6));
    expect(resumed.result).toEqual(original.result);
    expect(resumed.result.resultFingerprint).toBe(original.result.resultFingerprint);
    expect(resumed.result.findings[0].flow.map(s => s.id)).toEqual(flow.map(s => s.id));
  });

  it('reversing module loading order during restart yields identical multi-hop flow ordering', async () => {
    const raw = input(6);
    const reversed = { ...raw, files: [...raw.files].reverse() };
    const original = await analyzeInput(raw);
    const resumedReversed = await analyzeInput(reversed);

    expect(resumedReversed.result).toEqual(original.result);
    expect(resumedReversed.result.resultFingerprint).toBe(original.result.resultFingerprint);
    expect(resumedReversed.result.findings[0].flow).toEqual(original.result.findings[0].flow);
  });

  it('candidate hypothesis bridge preserves exact binding across multi-hop restart-resume', async () => {
    const run = await analyzeInput(input(5));
    const testCommit = 'a'.repeat(40);
    const bridge = createSqlCandidateBridge(async () => testCommit);

    const originalCandidates = await bridge(run.result, run.snapshot, run.ingestion, ORG);
    expect(originalCandidates).toHaveLength(1);
    const { candidate, candidateBinding } = originalCandidates[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));

    const serializedResult = JSON.parse(JSON.stringify(run.result));
    const resumedCandidates = await bridge(serializedResult, run.snapshot, run.ingestion, ORG);
    expect(resumedCandidates).toEqual(originalCandidates);
    expect(resumedCandidates[0].candidateBinding).toBe(candidateBinding);
  });

  it('tampering with multi-hop intermediate step in resumed result fails closed on validation', async () => {
    const run = await analyzeInput(input(5));
    const forged: any = structuredClone(run.result);
    forged.findings[0].flow[1].location.symbol = 'tamperedHelper';
    const { resultFingerprint: _fp, ...body } = forged;
    const tamperedHash = createHash('sha256').update(DETECTOR_VERSION + '\n' + canonical(body)).digest('hex');
    forged.resultFingerprint = `sha256:${tamperedHash}`;

    await expect(validateSqlAnalysis(forged, run.snapshot, run.ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY');
  });

  it('unsupported syntax in multi-hop chain fails closed with ANALYSIS_INCONCLUSIVE upon resume', async () => {
    const raw = replaceSource(input(5), source => source.replace('return res.json', 'while (true) {} return res.json'));
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations.length).toBeGreaterThan(0);
  });

  it('negative control multi-hop without tainted query construction produces NOT_DETECTED upon restart', async () => {
    const raw = input(1);
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('NOT_DETECTED');
    expect(run.result.findings).toEqual([]);

    const serializedResult = JSON.parse(JSON.stringify(run.result));
    const validated = await validateSqlAnalysis(serializedResult, run.snapshot, run.ingestion, ORG);
    expect(validated.status).toBe('NOT_DETECTED');
    expect(validated.findings).toEqual([]);
  });
});
