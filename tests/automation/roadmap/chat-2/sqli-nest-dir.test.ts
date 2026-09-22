import { describe, expect, it } from 'vitest';
import { computeCandidateBinding, validateFindingCandidate } from '../../../../worker/intelligence/contracts';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

describe('roadmap: sqli detector nested-flow direct', () => {
  it('detects SQL injection across nested helper function calls in direct route', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(5));
    expect(result.status).toBe('DETECTED');
    expect(result.limitations).toEqual([]);
    expect(result.findings).toHaveLength(1);

    const finding = result.findings[0];
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.symbol).toBe('db.prepare');
    expect(finding.flow[0].kind).toBe('SOURCE');
    expect(finding.flow.at(-1)!.kind).toBe('SINK');

    const callSymbols = finding.flow.filter(step => step.kind === 'CALL').map(step => step.location.symbol);
    expect(callSymbols).toEqual(['lookup', 'buildQuery']);
    expect(finding.flow.filter(step => step.kind === 'ARGUMENT')).toHaveLength(2);
    expect(finding.flow.some(step => step.kind === 'RETURN')).toBe(true);
    expect(finding.flow.some(step => step.kind === 'CONCAT')).toBe(true);

    const validated = await validateSqlAnalysis(result, snapshot, ingestion, ORG);
    expect(validated).toEqual(result);
  });

  it('binds nested-flow direct detection to FindingCandidate with CANDIDATE state', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(5));
    const validCommit = 'a'.repeat(40);
    const bridge = createSqlCandidateBridge(async () => validCommit);
    const hypotheses = await bridge(result, snapshot, ingestion, ORG);

    expect(hypotheses).toHaveLength(1);
    const { candidate, candidateBinding } = hypotheses[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.snapshot.commitSha).toBe(validCommit);
    expect(candidate.snapshot.repositoryId).toBe(snapshot.repositoryId);
    expect(candidate.snapshot.snapshotId).toBe(snapshot.snapshotId);
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);
  });

  it('does not detect finding when safe constant is passed to nested helper', async () => {
    const raw = replaceSource(input(5), source => source.replace('req.query.q', '"safe-literal"'));
    const { result, snapshot, ingestion } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toEqual([]);

    const bridge = createSqlCandidateBridge(async () => 'a'.repeat(40));
    expect(await bridge(result, snapshot, ingestion, ORG)).toEqual([]);
  });

  it('fails closed to ANALYSIS_INCONCLUSIVE when nested helper contains unsupported syntax', async () => {
    const raw = replaceSource(input(5), source => source.replace('return res.json', 'while (true) {} return res.json'));
    const { result, snapshot, ingestion } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('UNSUPPORTED_STATEMENT');

    const bridge = createSqlCandidateBridge(async () => 'a'.repeat(40));
    expect(await bridge(result, snapshot, ingestion, ORG)).toEqual([]);
  });
});
