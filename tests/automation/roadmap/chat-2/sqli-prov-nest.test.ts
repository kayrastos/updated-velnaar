import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { computeCandidateBinding, validateFindingCandidate } from '../../../../worker/intelligence/contracts';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { ANALYSIS_LIMITS, DETECTOR_VERSION, RULE_ID } from '../../../../worker/intelligence/detection/types';
import { canonical, hash } from '../../../../worker/intelligence/ingestion/snapshot';
import { verifyCommittedFixture } from '../../../intelligence/m2/support/gitCodeState';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

describe('Chat-2 roadmap: SQL injection nested call provenance integrity', () => {
  it('detects SQL injection through nested helper calls with complete flow provenance', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(5));
    expect(result.status).toBe('DETECTED');
    expect(result.limitations).toEqual([]);
    expect(result.findings).toHaveLength(1);

    const finding = result.findings[0];
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.routeIdentity).toBe(ingestion.routes[0].routeIdentity);
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.symbol).toBe('db.prepare');

    const flow = finding.flow;
    expect(flow[0].kind).toBe('SOURCE');
    expect(flow.at(-1)!.kind).toBe('SINK');

    const callSteps = flow.filter(s => s.kind === 'CALL');
    expect(callSteps.map(s => s.location.symbol)).toEqual(['lookup', 'buildQuery']);

    const argSteps = flow.filter(s => s.kind === 'ARGUMENT');
    expect(argSteps).toHaveLength(2);

    expect(flow.some(s => s.kind === 'CONCAT')).toBe(true);
    expect(flow.some(s => s.kind === 'RETURN')).toBe(true);

    for (const step of flow) {
      const expectedId = await hash('m3-flow-node-v1', {
        snapshotId: snapshot.snapshotId,
        routeIdentity: finding.routeIdentity,
        kind: step.kind,
        location: step.location,
      });
      expect(step.id).toBe(expectedId);
    }
    expect(new Set(flow.map(s => s.id)).size).toBe(flow.length);

    const findingBody = {
      routeIdentity: finding.routeIdentity,
      vulnerabilityClass: 'SQL_INJECTION' as const,
      source: finding.source,
      sink: finding.sink,
      flow: finding.flow,
    };
    const expectedFindingId = await hash('m3-sqli-finding-v1', {
      snapshotId: snapshot.snapshotId,
      ...findingBody,
    });
    expect(finding.findingId).toBe(expectedFindingId);

    const { resultFingerprint, ...body } = result;
    const expectedFingerprint = 'sha256:' + createHash('sha256').update(DETECTOR_VERSION + '\n' + canonical(body)).digest('hex');
    expect(resultFingerprint).toBe(expectedFingerprint);
  });

  it('preserves nested provenance flow across repeated runs and file permutations', async () => {
    const run1 = await analyzeInput(input(5));
    const run2 = await analyzeInput(input(5));
    expect(run1.result).toEqual(run2.result);

    const reversed = { ...input(5), files: [...input(5).files].reverse() };
    const runReversed = await analyzeInput(reversed);
    expect(runReversed.result).toEqual(run1.result);

    const direct = await detectSqlInjection(run1.snapshot, run1.ingestion, ORG);
    expect(direct).toEqual(run1.result);
  });

  it('tracks multi-level nested helper call provenance', async () => {
    const raw = replaceSource(input(), source => source.replace(
      'function searchRoute',
      'function stepThree(v: string) { return v; }\nfunction stepTwo(v: string) { return stepThree(v); }\nfunction stepOne(v: string) { return stepTwo(v); }\nfunction searchRoute'
    ).replace(
      'req.query.q',
      'stepOne(req.query.q)'
    ));

    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);

    const flow = result.findings[0].flow;
    const calls = flow.filter(s => s.kind === 'CALL').map(s => s.location.symbol);
    expect(calls).toEqual(['stepOne', 'stepTwo', 'stepThree']);

    const args = flow.filter(s => s.kind === 'ARGUMENT');
    expect(args).toHaveLength(3);

    const returns = flow.filter(s => s.kind === 'RETURN');
    expect(returns.length).toBeGreaterThanOrEqual(2);
  });

  it('does not detect finding when nested helper returns an untainted constant', async () => {
    const raw = replaceSource(input(), source => source.replace(
      'function searchRoute',
      'function safeHelper(v: string) { return "constant"; }\nfunction searchRoute'
    ).replace(
      'req.query.q',
      'safeHelper(req.query.q)'
    ));

    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
  });

  it('fails closed with CALL_CYCLE when nested helpers contain mutual recursion', async () => {
    const raw = replaceSource(input(), source => source.replace(
      'function searchRoute',
      'function helperA(val: string): string { return helperB(val); }\n' +
      'function helperB(val: string): string { return helperA(val); }\n' +
      'function searchRoute'
    ).replace(
      'return res.json',
      'helperA(req.query.q); return res.json'
    ));

    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('CALL_CYCLE');
  });

  it('fails closed with CALL_DEPTH when nested helper chain exceeds limit', async () => {
    const depth = ANALYSIS_LIMITS.callDepth + 1;
    const helpers = Array.from({ length: depth }, (_, i) =>
      'function nest' + i + '(v: string) { return ' + (i === depth - 1 ? 'v' : 'nest' + (i + 1) + '(v)') + '; }'
    ).join('\n');

    const raw = replaceSource(input(), source => source.replace(
      'function searchRoute',
      helpers + '\nfunction searchRoute'
    ).replace(
      'return res.json',
      'nest0(req.query.q); return res.json'
    ));

    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.limitations[0].code).toBe('CALL_DEPTH');
  });

  it.each([
    'reorder-flow',
    'mutate-symbol',
    'corrupt-flow-id',
    'omit-return',
    'duplicate-call',
  ] as const)('rejects tampered nested provenance (%s) in validateSqlAnalysis', async tamperType => {
    const { snapshot, ingestion, result } = await analyzeInput(input(5));
    const forged: any = structuredClone(result);

    if (tamperType === 'reorder-flow') {
      forged.findings[0].flow.reverse();
    } else if (tamperType === 'mutate-symbol') {
      const callStep = forged.findings[0].flow.find((s: any) => s.kind === 'CALL');
      callStep.location.symbol = 'forgedHelper';
    } else if (tamperType === 'corrupt-flow-id') {
      forged.findings[0].flow[0].id = 'sha256:' + '0'.repeat(64);
    } else if (tamperType === 'omit-return') {
      forged.findings[0].flow = forged.findings[0].flow.filter((s: any) => s.kind !== 'RETURN');
    } else if (tamperType === 'duplicate-call') {
      const callStep = forged.findings[0].flow.find((s: any) => s.kind === 'CALL');
      forged.findings[0].flow.splice(2, 0, callStep);
    }

    const { resultFingerprint: _old, ...body } = forged;
    forged.resultFingerprint = await hash(DETECTOR_VERSION, body);

    await expect(validateSqlAnalysis(forged, snapshot, ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY');
  });

  it('creates an exact-bound CANDIDATE hypothesis preserving verification boundaries', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(5));
    const bridge = createSqlCandidateBridge(verifyCommittedFixture);
    const hypotheses = await bridge(result, snapshot, ingestion, ORG);

    expect(hypotheses).toHaveLength(1);
    const { candidate, candidateBinding } = hypotheses[0];

    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.organizationId).toBe(ORG);
    expect(candidate.snapshot.snapshotId).toBe(snapshot.snapshotId);
    expect(candidate.snapshot.commitSha).toMatch(/^[a-f0-9]{40}$/);

    expect(candidate.sensorEvidence).toHaveLength(1);
    expect(candidate.sensorEvidence[0].sensorType).toBe('VELNAR_STRUCTURAL');
    expect(candidate.sensorEvidence[0].ruleId).toBe(RULE_ID);
    expect(candidate.sensorEvidence[0].rawEvidenceFingerprint).toBe(result.resultFingerprint);

    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);
    expect((candidate as any).assertionResult).toBeUndefined();
    expect((candidate as any).verificationOutcome).toBeUndefined();
  });

  it('candidate bridge rejects tampered nested analysis before commit verification', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(5));
    const forged: any = structuredClone(result);
    forged.findings[0].flow[1].location.line++;
    const { resultFingerprint: _old, ...body } = forged;
    forged.resultFingerprint = await hash(DETECTOR_VERSION, body);

    const bridge = createSqlCandidateBridge(verifyCommittedFixture);
    await expect(bridge(forged, snapshot, ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY');
  });
});
