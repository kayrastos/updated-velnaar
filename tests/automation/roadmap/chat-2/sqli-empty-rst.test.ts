import { describe, expect, it } from 'vitest';
import { CONTRACT_VERSION, computeCandidateBinding, createVerificationState } from '../../../../worker/intelligence/contracts';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { captureSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress } from '../../../../worker/intelligence/ingestion/express';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

const VALID_COMMIT = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

describe('V1 discovery-intelligence SQLi detector: null-empty boundary restart-resume', () => {
  it('detects tainted query flow with empty string concatenation', async () => {
    const raw = replaceSource(input(), content => content.replace('return res.json',
      'const empty = ""; const tainted = empty + req.query.q; return res.json')
      .replace('" + req.query.q + "', '" + tainted + "'));
    const { snapshot, ingestion, result } = await analyzeInput(raw);

    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    expect(result.limitations).toEqual([]);

    const finding = result.findings[0];
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.symbol).toBe('db.prepare');
    expect(finding.flow.some(step => step.kind === 'CONCAT')).toBe(true);

    const validated = await validateSqlAnalysis(result, snapshot, ingestion, ORG);
    expect(validated.resultFingerprint).toBe(result.resultFingerprint);
  });

  it('treats empty constant query string and bound parameters as negative controls', async () => {
    const rawEmptyQuery = replaceSource(input(), content => content.replace('return res.json',
      'return res.json(db.prepare("").all()); return res.json'));
    const runEmpty = await analyzeInput(rawEmptyQuery);
    expect(runEmpty.result.status).toBe('NOT_DETECTED');
    expect(runEmpty.result.findings).toEqual([]);
    expect(runEmpty.result.limitations).toEqual([]);

    const rawBoundParam = replaceSource(input(), content => content.replace('return res.json',
      'return res.json(db.prepare("SELECT * FROM users WHERE name = ?").all("")); return res.json'));
    const runParam = await analyzeInput(rawBoundParam);
    expect(runParam.result.status).toBe('NOT_DETECTED');
    expect(runParam.result.findings).toEqual([]);
    expect(runParam.result.limitations).toEqual([]);
  });

  it('fails closed to inconclusive when encountering unsupported null expressions', async () => {
    const raw = replaceSource(input(), content => content.replace('return res.json',
      'return res.json(db.prepare(null).all()); return res.json'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('UNSUPPORTED_EXPRESSION');
  });

  it('preserves determinism across repeated restart-resume analysis cycles', async () => {
    const rawTainted = replaceSource(input(), content => content.replace('return res.json',
      'const prefix = ""; const q = prefix + req.query.q; return res.json')
      .replace('" + req.query.q + "', '" + q + "'));
    const snapshot = await captureSnapshot(rawTainted, ORG);
    const ingestion = await ingestExpress(snapshot, ORG);

    const firstRun = await detectSqlInjection(snapshot, ingestion, ORG);
    expect(firstRun.status).toBe('DETECTED');

    for (let cycle = 0; cycle < 3; cycle++) {
      const resumedRun = await detectSqlInjection(snapshot, ingestion, ORG);
      expect(resumedRun.status).toBe('DETECTED');
      expect(resumedRun.resultFingerprint).toBe(firstRun.resultFingerprint);
      expect(resumedRun.findings).toHaveLength(1);
      expect(resumedRun.findings[0].findingId).toBe(firstRun.findings[0].findingId);
      expect(resumedRun.findings[0].flow.map(s => s.id)).toEqual(firstRun.findings[0].flow.map(s => s.id));
      await expect(validateSqlAnalysis(resumedRun, snapshot, ingestion, ORG)).resolves.toEqual(firstRun);
    }
  });

  it('isolates state across interleaved restart runs without cross-boundary contamination', async () => {
    const rawTainted = replaceSource(input(), content => content.replace('return res.json',
      'const emptyStr = ""; const taintedQuery = emptyStr + req.query.q; return res.json')
      .replace('" + req.query.q + "', '" + taintedQuery + "'));
    const rawSafe = replaceSource(input(), content => content.replace('return res.json',
      'return res.json(db.prepare("").all()); return res.json'));
    const rawNull = replaceSource(input(), content => content.replace('return res.json',
      'return res.json(db.prepare(null).all()); return res.json'));

    const taintedRun1 = await analyzeInput(rawTainted);
    expect(taintedRun1.result.status).toBe('DETECTED');

    const safeRun = await analyzeInput(rawSafe);
    expect(safeRun.result.status).toBe('NOT_DETECTED');

    const nullRun = await analyzeInput(rawNull);
    expect(nullRun.result.status).toBe('ANALYSIS_INCONCLUSIVE');

    const taintedRun2 = await analyzeInput(rawTainted);
    expect(taintedRun2.result.status).toBe('DETECTED');
    expect(taintedRun2.result.resultFingerprint).toBe(taintedRun1.result.resultFingerprint);
  });

  it('produces valid candidate hypotheses and bindings for empty-boundary detections', async () => {
    const rawTainted = replaceSource(input(), content => content.replace('return res.json',
      'const emptyPrefix = ""; const queryText = emptyPrefix + req.query.q; return res.json')
      .replace('" + req.query.q + "', '" + queryText + "'));
    const { snapshot, ingestion, result } = await analyzeInput(rawTainted);
    expect(result.status).toBe('DETECTED');

    const bridge = createSqlCandidateBridge(async () => VALID_COMMIT);
    const hypotheses = await bridge(result, snapshot, ingestion, ORG);

    expect(hypotheses).toHaveLength(1);
    const { candidate, candidateBinding } = hypotheses[0];

    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.snapshot.commitSha).toBe(VALID_COMMIT);

    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(candidateBinding.startsWith(`${CONTRACT_VERSION}:FindingCandidate\n`)).toBe(true);
    expect(candidateBinding.startsWith('sha256:')).toBe(false);

    const verification = createVerificationState(candidate, ORG);
    expect(verification.state).toBe('CANDIDATE');

    const rawSafe = replaceSource(input(), content => content.replace('return res.json',
      'return res.json(db.prepare("").all()); return res.json'));
    const safeRun = await analyzeInput(rawSafe);
    const safeHypotheses = await bridge(safeRun.result, safeRun.snapshot, safeRun.ingestion, ORG);
    expect(safeHypotheses).toEqual([]);
  });
});
