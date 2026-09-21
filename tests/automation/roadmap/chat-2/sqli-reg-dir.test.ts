import { describe, expect, it } from 'vitest';
import { computeCandidateBinding } from '../../../../worker/intelligence/contracts';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

describe('V1 discovery-intelligence SQL injection direct detector regression lock', () => {
  it('detects direct request query concatenation into database query sink', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(0));

    expect(result.status).toBe('DETECTED');
    expect(result.limitations).toEqual([]);
    expect(result.findings).toHaveLength(1);

    const finding = result.findings[0];
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.symbol).toBe('db.prepare');
    expect(finding.routeIdentity).toBe(ingestion.routes[0].routeIdentity);

    expect(finding.flow[0].kind).toBe('SOURCE');
    expect(finding.flow.at(-1)!.kind).toBe('SINK');
    expect(finding.flow.some(step => step.kind === 'CONCAT')).toBe(true);

    const flowIds = new Set(finding.flow.map(step => step.id));
    expect(flowIds.size).toBe(finding.flow.length);

    const validated = await validateSqlAnalysis(result, snapshot, ingestion, ORG);
    expect(validated).toEqual(result);
  });

  it('tracks direct flow provenance through local variable aliases', async () => {
    const raw = replaceSource(input(0), content => content.replace(
      'return res.json',
      'const directTaint = req.query.q; const aliasTaint = directTaint; return res.json',
    ).replace(
      '" + req.query.q + "',
      '" + aliasTaint + "',
    ));

    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);

    const variableSteps = result.findings[0].flow
      .filter(step => step.kind === 'VARIABLE')
      .map(step => step.location.symbol);
    expect(variableSteps).toEqual(['directTaint', 'aliasTaint']);
  });

  it('locks negative controls: safe twin and static queries yield NOT_DETECTED', async () => {
    const safeTwin = await analyzeInput(input(1));
    expect(safeTwin.result.status).toBe('NOT_DETECTED');
    expect(safeTwin.result.findings).toEqual([]);
    expect(safeTwin.result.limitations).toEqual([]);

    const staticRaw = replaceSource(input(0), content => content.replace('req.query.q', '"safe-static"'));
    const staticRun = await analyzeInput(staticRaw);
    expect(staticRun.result.status).toBe('NOT_DETECTED');
    expect(staticRun.result.findings).toEqual([]);
  });

  it('fails closed with ANALYSIS_INCONCLUSIVE on multi-source joins', async () => {
    const multiRaw = replaceSource(input(0), source => source.replace(
      'req.query.q',
      '(req.query.q + req.query.other)',
    ));
    const run = await analyzeInput(multiRaw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations[0].code).toBe('MULTIPLE_SOURCES');
  });

  it('rejects tampered analysis result at the validation boundary', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(0));
    const forged: any = structuredClone(result);
    forged.findings[0].sink.symbol = 'db.exec';

    await expect(validateSqlAnalysis(forged, snapshot, ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
  });

  it('bridges direct detection finding into candidate maintaining CANDIDATE state', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(0));
    const mockCommitSha = 'b'.repeat(40);
    const bridge = createSqlCandidateBridge(async () => mockCommitSha);

    const candidates = await bridge(result, snapshot, ingestion, ORG);
    expect(candidates).toHaveLength(1);

    const { candidate, candidateBinding } = candidates[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.snapshot.commitSha).toBe(mockCommitSha);
    expect(candidate.organizationId).toBe(ORG);
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
  });

  it('bridges no candidates for negative control runs', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(1));
    const bridge = createSqlCandidateBridge(async () => 'c'.repeat(40));

    const candidates = await bridge(result, snapshot, ingestion, ORG);
    expect(candidates).toEqual([]);
  });
});
