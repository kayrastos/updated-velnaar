import { describe, expect, it } from 'vitest';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { computeCandidateBinding, validateFindingCandidate } from '../../../../worker/intelligence/contracts';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

describe('V1 discovery intelligence: SQL injection detector normalization boundary direct (chat-2)', () => {
  it('detects direct sql injection across query keyword case variations without normalization dependency', async () => {
    const rawUpper = replaceSource(input(0), s => s.replace('" + req.query.q + "', '" + req.query.q + " /* UPPER */'));
    const rawLower = replaceSource(input(0), s => s.replace('" + req.query.q + "', '" + req.query.q + " /* lower */'));
    const resUpper = await analyzeInput(rawUpper);
    const resLower = await analyzeInput(rawLower);
    expect(resUpper.result.status).toBe('DETECTED');
    expect(resLower.result.status).toBe('DETECTED');
    expect(resUpper.result.findings[0].source.symbol).toBe('query.q');
    expect(resUpper.result.findings[0].sink.symbol).toBe('db.prepare');
    expect(resLower.result.findings[0].source.symbol).toBe('query.q');
    expect(resLower.result.findings[0].sink.symbol).toBe('db.prepare');
  });

  it('preserves direct tainted flow across parenthesized expression boundaries', async () => {
    const raw = replaceSource(input(0), s => s.replace('" + req.query.q + "', '" + ((req.query.q)) + "'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].flow.some(step => step.kind === 'CONCAT')).toBe(true);
    expect(result.findings[0].source.symbol).toBe('query.q');
    expect(result.findings[0].sink.symbol).toBe('db.prepare');
  });

  it('tracks taint through identity and empty string concatenation boundaries', async () => {
    const raw = replaceSource(input(0), s => s.replace('" + req.query.q + "', '" + ("" + req.query.q) + "'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].flow.some(step => step.kind === 'CONCAT')).toBe(true);
  });

  it('fails closed when unsupported normalization functions or string methods are attempted', async () => {
    const rawMethod = replaceSource(input(0), s => s.replace('req.query.q', 'req.query.q.trim()'));
    const resMethod = await analyzeInput(rawMethod);
    expect(resMethod.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(resMethod.result.findings).toEqual([]);
    expect(resMethod.result.limitations).toHaveLength(1);
    expect(resMethod.result.limitations[0].code).toBe('UNSUPPORTED_EXPRESSION');

    const rawCast = replaceSource(input(0), s => s.replace('req.query.q', 'req.query.q as string'));
    const resCast = await analyzeInput(rawCast);
    expect(resCast.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(resCast.result.findings).toEqual([]);
  });

  it('negative control: safe fixture with bound parameters produces NOT_DETECTED', async () => {
    const { result } = await analyzeInput(input(1));
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
  });

  it('produces candidate hypothesis preserving CANDIDATE state and canonical binding semantics', async () => {
    const checkedCommit = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const bridge = createSqlCandidateBridge(async () => checkedCommit);
    const { snapshot, ingestion, result } = await analyzeInput(input(0));
    expect(result.status).toBe('DETECTED');
    const hypotheses = await bridge(result, snapshot, ingestion, ORG);
    expect(hypotheses).toHaveLength(1);
    const { candidate, candidateBinding } = hypotheses[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.snapshot.commitSha).toBe(checkedCommit);
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);
  });
});
