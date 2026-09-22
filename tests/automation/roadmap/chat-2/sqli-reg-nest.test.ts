import { describe, expect, it } from 'vitest';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { computeCandidateBinding, createVerificationState, transitionVerificationState } from '../../../../worker/intelligence/contracts';
import { RULE_ID } from '../../../../worker/intelligence/detection/types';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

describe('regression lock: nested SQL injection detection', () => {
  it('detects SQL injection through nested helper and query builder functions in catalog fixture', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(5));
    expect(result.status).toBe('DETECTED');
    expect(result.limitations).toEqual([]);
    expect(result.findings).toHaveLength(1);

    const finding = result.findings[0];
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.symbol).toBe('db.prepare');
    expect(finding.routeIdentity).toBe(ingestion.routes[0].routeIdentity);

    const callSteps = finding.flow.filter(step => step.kind === 'CALL');
    expect(callSteps.map(step => step.location.symbol)).toEqual(['lookup', 'buildQuery']);

    const argSteps = finding.flow.filter(step => step.kind === 'ARGUMENT');
    expect(argSteps).toHaveLength(2);
    expect(finding.flow.some(step => step.kind === 'RETURN')).toBe(true);
    expect(finding.flow.some(step => step.kind === 'CONCAT')).toBe(true);
    expect(finding.flow[0].kind).toBe('SOURCE');
    expect(finding.flow.at(-1)!.kind).toBe('SINK');
  });

  it('detects taint flow across multi-level synthesized nested helper functions', async () => {
    const raw = replaceSource(input(), source => source
      .replace(
        'function searchRoute',
        'function helperInner(q: string) { return q; }\n' +
        'function helperOuter(q: string) { return helperInner(q); }\n' +
        'function searchRoute',
      )
      .replace('req.query.q', 'helperOuter(req.query.q)'));

    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);

    const finding = result.findings[0];
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.symbol).toBe('db.prepare');

    const callSymbols = finding.flow.filter(s => s.kind === 'CALL').map(s => s.location.symbol);
    expect(callSymbols).toEqual(['helperOuter', 'helperInner']);
  });

  it('negative control: safe constant returned from nested helper produces no finding', async () => {
    const raw = replaceSource(input(), source => source
      .replace(
        'function searchRoute',
        'function sanitizeToConstant(q: string) { return "constant_safe_val"; }\n' +
        'function searchRoute',
      )
      .replace('req.query.q', 'sanitizeToConstant(req.query.q)'));

    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
  });

  it('negative control: uncalled nested helper with unsafe SQL does not create finding', async () => {
    const raw = replaceSource(input(1), source => source
      .replace(
        'function searchRoute',
        'function uncalledNestedHelper(db: any, q: string) { return db.prepare("SELECT * FROM items WHERE name = \'" + q + "\'").all(); }\n' +
        'function searchRoute',
      ));

    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
  });

  it('limitation: recursive nested helper call cycle fails closed with CALL_CYCLE', async () => {
    const raw = replaceSource(input(), source => source
      .replace(
        'function searchRoute',
        'function ping(v: string) { return pong(v); }\n' +
        'function pong(v: string) { return ping(v); }\n' +
        'function searchRoute',
      )
      .replace('return res.json', 'ping(req.query.q); return res.json'));

    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('CALL_CYCLE');
  });

  it('limitation: call depth exceeding analysis budget fails closed with CALL_DEPTH', async () => {
    const depthHelpers = Array.from({ length: 18 }, (_, i) =>
      `function nest${i}(v: string) { return ${i === 17 ? 'v' : `nest${i + 1}(v)`}; }`,
    ).join('\n');
    const raw = replaceSource(input(), source => source
      .replace('function searchRoute', depthHelpers + '\nfunction searchRoute')
      .replace('return res.json', 'nest0(req.query.q); return res.json'));

    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('CALL_DEPTH');
  });

  it('bridges nested detection finding to FindingCandidate in CANDIDATE state with canonical binding', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(5));
    const testCommit = 'a'.repeat(40);
    const bridge = createSqlCandidateBridge(async () => testCommit);

    const hypotheses = await bridge(result, snapshot, ingestion, ORG);
    expect(hypotheses).toHaveLength(1);

    const { candidate, candidateBinding } = hypotheses[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.snapshot.commitSha).toBe(testCommit);
    expect(candidate.source.symbol).toBe('query.q');
    expect(candidate.sink.symbol).toBe('db.prepare');
    expect(candidate.sensorEvidence[0].ruleId).toBe(RULE_ID);
    expect(candidate.sensorEvidence[0].rawEvidenceFingerprint).toBe(result.resultFingerprint);
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));

    const state = createVerificationState(candidate, ORG);
    expect(state.state).toBe('CANDIDATE');
    await expect(
      transitionVerificationState(state, {
        type: 'COMPLETE',
        result: { result: 'VERIFIED' } as any,
        evidence: result as any,
      }),
    ).rejects.toThrow('COMPLETE requires pending');
  });
});
