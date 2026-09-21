import { describe, expect, it } from 'vitest';
import { computeCandidateBinding, validateFindingCandidate } from '../../../../worker/intelligence/contracts';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { ANALYSIS_LIMITS, DETECTOR_VERSION, RULE_ID } from '../../../../worker/intelligence/detection/types';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

describe('V1 discovery-intelligence SQL injection direct positive control', () => {
  it('detects direct request parameter concatenation into SQL query', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(0));
    expect(result.status).toBe('DETECTED');
    expect(result.ruleId).toBe(RULE_ID);
    expect(result.version).toBe(DETECTOR_VERSION);
    expect(result.findings).toHaveLength(1);
    expect(result.limitations).toEqual([]);

    const finding = result.findings[0];
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.symbol).toBe('db.prepare');
    expect(finding.flow[0].kind).toBe('SOURCE');
    expect(finding.flow.at(-1)!.kind).toBe('SINK');
    expect(finding.flow.some(step => step.kind === 'CONCAT')).toBe(true);
    expect(finding.flow.length).toBeLessThanOrEqual(ANALYSIS_LIMITS.flowLength);

    const revalidated = await validateSqlAnalysis(result, snapshot, ingestion, ORG);
    expect(revalidated.resultFingerprint).toBe(result.resultFingerprint);
  });

  it('preserves provenance across direct concatenation variants', async () => {
    const raw = replaceSource(input(0), source =>
      source.replace(
        'return res.json',
        'const directParam = req.query.q; return res.json',
      ).replace(
        '" + req.query.q + "',
        '" + directParam + "',
      ),
    );
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.symbol).toBe('db.prepare');
    expect(finding.flow.some(s => s.kind === 'VARIABLE' && s.location.symbol === 'directParam')).toBe(true);
  });

  it('bridges direct detection to canonical CANDIDATE hypothesis', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(0));
    const mockSha = 'a'.repeat(40);
    const bridge = createSqlCandidateBridge(async () => mockSha);
    const hypotheses = await bridge(result, snapshot, ingestion, ORG);

    expect(hypotheses).toHaveLength(1);
    const { candidate, candidateBinding } = hypotheses[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.snapshot.commitSha).toBe(mockSha);
    expect(candidate.snapshot.snapshotId).toBe(snapshot.snapshotId);
    expect(candidate.organizationId).toBe(ORG);
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);
  });
});
