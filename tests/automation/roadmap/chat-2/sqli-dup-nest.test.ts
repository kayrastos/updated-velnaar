import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { ANALYSIS_LIMITS, DETECTOR_VERSION } from '../../../../worker/intelligence/detection/types';
import {
  computeCandidateBinding,
  createVerificationState,
  validateFindingCandidate,
} from '../../../../worker/intelligence/contracts';
import { canonical } from '../../../../worker/intelligence/ingestion/snapshot';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

const CHECKED_COMMIT = '46db4c208f886afda939c04ae93580fbabd57344';

describe('V1 discovery intelligence: SQL injection detector duplicate collapse (nested)', () => {
  it('detects baseline nested SQL injection with unique flow nodes and helper call provenance', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(5));
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    expect(result.limitations).toEqual([]);
    expect(result.organizationId).toBe(ORG);
    expect(result.snapshotId).toBe(snapshot.snapshotId);
    expect(result.ingestionIdentity).toBe(ingestion.ingestionIdentity);

    const finding = result.findings[0];
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.symbol).toBe('db.prepare');

    const callSymbols = finding.flow.filter(step => step.kind === 'CALL').map(step => step.location.symbol);
    expect(callSymbols).toEqual(['lookup', 'buildQuery']);
    expect(finding.flow.filter(step => step.kind === 'ARGUMENT')).toHaveLength(2);
    expect(finding.flow.some(step => step.kind === 'RETURN')).toBe(true);

    const nodeIds = finding.flow.map(step => step.id);
    expect(new Set(nodeIds).size).toBe(finding.flow.length);
    expect(finding.flow.length).toBeLessThanOrEqual(ANALYSIS_LIMITS.flowLength);
  });

  it('collapses duplicate flow steps when nested helper references the same tainted parameter multiple times', async () => {
    const raw = input(5);
    const originalFile = raw.files.find(f => f.path === 'src/routes.ts');
    expect(originalFile).toBeDefined();

    const match = originalFile!.content.match(/function\s+buildQuery\s*\(([^:)]+)[^)]*\)\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    const param = match![1].trim();
    const body = match![2];
    const newBody = body.replace(new RegExp('\\b' + param + '\\b'), param + ' + " " + ' + param);
    const duplicatedInput = replaceSource(raw, source => source.replace(body, newBody));

    const { result } = await analyzeInput(duplicatedInput);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    expect(result.limitations).toEqual([]);

    const finding = result.findings[0];
    const nodeIds = finding.flow.map(step => step.id);
    expect(new Set(nodeIds).size).toBe(finding.flow.length);
    expect(finding.flow.filter(step => step.kind === 'SOURCE')).toHaveLength(1);
    expect(finding.flow.length).toBeLessThanOrEqual(ANALYSIS_LIMITS.flowLength);
  });

  it('collapses common provenance and preserves unique flow through nested alias chain', async () => {
    const raw = input(5);
    const originalFile = raw.files.find(f => f.path === 'src/routes.ts');
    expect(originalFile).toBeDefined();

    const match = originalFile!.content.match(/function\s+lookup\s*\(([^:)]+)[^)]*\)\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    const param = match![1].trim();
    const body = match![2];
    const newBody = 'const alias1 = ' + param + '; const alias2 = alias1; ' + body.replace(new RegExp('\\b' + param + '\\b'), 'alias2');
    const aliasedInput = replaceSource(raw, source => source.replace(body, newBody));

    const { result } = await analyzeInput(aliasedInput);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    expect(result.limitations).toEqual([]);

    const finding = result.findings[0];
    const variableSymbols = finding.flow.filter(step => step.kind === 'VARIABLE').map(step => step.location.symbol);
    expect(variableSymbols).toContain('alias1');
    expect(variableSymbols).toContain('alias2');

    const nodeIds = finding.flow.map(step => step.id);
    expect(new Set(nodeIds).size).toBe(finding.flow.length);
  });

  it('produces deterministic results and identical fingerprint on repeated analysis', async () => {
    const raw = input(5);
    const { snapshot, ingestion, result: run1 } = await analyzeInput(raw);
    const run2 = await detectSqlInjection(snapshot, ingestion, ORG);

    expect(canonical(run1)).toBe(canonical(run2));
    expect(run1.resultFingerprint).toBe(run2.resultFingerprint);

    const { resultFingerprint, ...body } = run1;
    const expected = 'sha256:' + createHash('sha256').update(DETECTOR_VERSION + '\n' + canonical(body)).digest('hex');
    expect(resultFingerprint).toBe(expected);
  });

  it('rejects forged analysis with duplicate flow steps or duplicate findings during validation', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(5));

    const forgedFlow: any = structuredClone(result);
    forgedFlow.findings[0].flow.push(forgedFlow.findings[0].flow[0]);
    const { resultFingerprint: _f1, ...bodyFlow } = forgedFlow;
    forgedFlow.resultFingerprint = 'sha256:' + createHash('sha256').update(DETECTOR_VERSION + '\n' + canonical(bodyFlow)).digest('hex');
    await expect(validateSqlAnalysis(forgedFlow, snapshot, ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY');

    const forgedFinding: any = structuredClone(result);
    forgedFinding.findings.push(forgedFinding.findings[0]);
    const { resultFingerprint: _f2, ...bodyFinding } = forgedFinding;
    forgedFinding.resultFingerprint = 'sha256:' + createHash('sha256').update(DETECTOR_VERSION + '\n' + canonical(bodyFinding)).digest('hex');
    await expect(validateSqlAnalysis(forgedFinding, snapshot, ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY');
  });

  it('maps collapsed nested finding to exactly one CANDIDATE hypothesis with matching canonical binding', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(5));
    const bridge = createSqlCandidateBridge(async () => CHECKED_COMMIT);
    const hypotheses = await bridge(result, snapshot, ingestion, ORG);

    expect(hypotheses).toHaveLength(1);
    const { candidate, candidateBinding } = hypotheses[0];

    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.snapshot.commitSha).toBe(CHECKED_COMMIT);
    expect(candidate.snapshot.snapshotId).toBe(snapshot.snapshotId);
    expect(candidate.organizationId).toBe(ORG);
    expect(candidate.sensorEvidence[0].sensorType).toBe('VELNAR_STRUCTURAL');
    expect(candidate.sensorEvidence[0].rawEvidenceFingerprint).toBe(result.resultFingerprint);

    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);
    expect(createVerificationState(candidate, ORG).state).toBe('CANDIDATE');
  });

  it('creates no candidates when nested analysis is inconclusive', async () => {
    const raw = replaceSource(input(5), source => source.replace('return res.json', 'while (true) {} return res.json'));
    const { snapshot, ingestion, result } = await analyzeInput(raw);

    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);

    const bridge = createSqlCandidateBridge(async () => CHECKED_COMMIT);
    const hypotheses = await bridge(result, snapshot, ingestion, ORG);
    expect(hypotheses).toEqual([]);
  });
});
