import { describe, expect, it, vi } from 'vitest';
import { createSqlCandidateBridge } from '../../../worker/intelligence/detection/candidate';
import { validateSqlAnalysis } from '../../../worker/intelligence/detection/sqlInjection';
import { computeCandidateBinding, validateFindingCandidate } from '../../../worker/intelligence/contracts';
import { analyzeInput, input, replaceSource, ORG } from '../m3/support/inputs';

describe('M4 SQL injection negative controls and false-positive hardening', () => {
  it.each([1, 3, 4])('catalog negative fixture %i yields NOT_DETECTED with zero findings and zero limitations', async index => {
    const { result } = await analyzeInput(input(index));
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
  });

  it('reads req.query into scope but executes a constant query (negative control)', async () => {
    const raw = replaceSource(input(), content => content
      .replace('return res.json', 'const ignored = req.query.q; return res.json')
      .replace('" + req.query.q + "', '" + "safe_literal" + "'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toHaveLength(0);
  });

  it('concatenates constant string literals without producing taint (negative control)', async () => {
    const raw = replaceSource(input(), content => content
      .replace('return res.json', 'const partA = "SELECT "; const partB = "1"; const query = partA + partB; return res.json')
      .replace('" + req.query.q + "', '" + query + "'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toHaveLength(0);
  });

  it('helper returning constant query does not inherit taint from arguments', async () => {
    const helper = 'function buildSafeQuery(param: string) { return "SELECT id FROM items"; }\n';
    const raw = replaceSource(input(), content => helper + content
      .replace('return res.json', 'const query = buildSafeQuery(req.query.q); return res.json')
      .replace('" + req.query.q + "', '" + query + "'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toHaveLength(0);
  });

  it('helper returning safe parameter ignores unused tainted parameter', async () => {
    const helper = 'function chooseQuery(untrusted: string, safe: string) { return safe; }\n';
    const raw = replaceSource(input(), content => helper + content
      .replace('return res.json', 'const query = chooseQuery(req.query.q, "SELECT 1"); return res.json')
      .replace('" + req.query.q + "', '" + query + "'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toHaveLength(0);
  });

  it('negative controls produce no candidate hypotheses and do not invoke commit verifier', async () => {
    const raw = replaceSource(input(), content => content
      .replace('" + req.query.q + "', '" + "safe_id" + "'));
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    const verifier = vi.fn();
    const bridge = createSqlCandidateBridge(verifier);
    const candidates = await bridge(result, snapshot, ingestion, ORG);
    expect(candidates).toEqual([]);
    expect(verifier).not.toHaveBeenCalled();
  });

  it('preserves detection and candidate generation for true positives (positive control non-regression)', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(0));
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].vulnerabilityClass).toBe('SQL_INJECTION');
    expect(result.findings[0].source.symbol).toBe('query.q');
    expect(result.findings[0].sink.symbol).toBe('db.prepare');
    expect(result.findings[0].flow[0].kind).toBe('SOURCE');
    expect(result.findings[0].flow.at(-1)!.kind).toBe('SINK');

    const commitSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const verifier = vi.fn().mockResolvedValue(commitSha);
    const bridge = createSqlCandidateBridge(verifier);
    const candidates = await bridge(result, snapshot, ingestion, ORG);
    expect(candidates).toHaveLength(1);

    const { candidate, candidateBinding } = candidates[0];

    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.snapshot.commitSha).toBe(commitSha);
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);
    expect(verifier).toHaveBeenCalledOnce();
  });

  it('validates negative control analysis deterministically via validateSqlAnalysis', async () => {
    const raw = replaceSource(input(), content => content
      .replace('" + req.query.q + "', '" + "deterministic_constant" + "'));
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    const validated = await validateSqlAnalysis(result, snapshot, ingestion, ORG);
    expect(validated).toEqual(result);
    expect(validated.status).toBe('NOT_DETECTED');
  });
  it('provenance precision: source location identifies only the parameter flowing to sink', async () => {
    const raw = replaceSource(input(0), source => source
      .replace(
        'return res.json',
        'const other = req.query.other; const queryParam = req.query.filter; return res.json'
      )
      .replace('" + req.query.q + "', '" + queryParam + "'));

    const { result } = await analyzeInput(raw);

    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].source.symbol).toBe('query.filter');
    expect(
      result.findings[0].flow.some(
        s => s.location.symbol === 'other'
      )
    ).toBe(false);
    expect(
      result.findings[0].flow.some(
        s => s.location.symbol === 'queryParam'
      )
    ).toBe(true);
  });
  it('recognizes safe single-parameter query with tainted argument as NOT_DETECTED', async () => {
    const raw = replaceSource(input(), source => source.replace(
      /db\.prepare\([^)]+\)\.all\(\)/,
      'db.prepare("SELECT * FROM items WHERE id = ?").all(req.query.q)'
    ));

    const { result } = await analyzeInput(raw);

    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toHaveLength(0);
  });

  it('does not produce candidate hypotheses when parameterized queries are safely bound', async () => {
    const raw = replaceSource(input(), source => source.replace(
      /db\.prepare\([^)]+\)\.all\(\)/,
      'db.prepare("SELECT * FROM users WHERE id = ?").all(req.query.q)'
    ));

    const { result, snapshot, ingestion } = await analyzeInput(raw);

    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toHaveLength(0);

    const verify = vi.fn();
    const bridge = createSqlCandidateBridge(verify);
    const candidates =
      await bridge(result, snapshot, ingestion, ORG);

    expect(candidates).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  });

  it('still detects SQL injection when prepared SQL text itself concatenates untrusted input', async () => {
    const raw = replaceSource(input(), source => source.replace(
      /db\.prepare\([^)]+\)\.all\(\)/,
      'db.prepare("SELECT * FROM users WHERE role = \'" + req.query.q + "\' AND id = ?").all("fixed-id")'
    ));

    const { result, snapshot, ingestion } =
      await analyzeInput(raw);

    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].source.symbol).toBe('query.q');
    expect(result.findings[0].sink.symbol).toBe('db.prepare');

    const commitSha =
      '1111111111111111111111111111111111111111';

    const bridge =
      createSqlCandidateBridge(async () => commitSha);

    const candidates =
      await bridge(result, snapshot, ingestion, ORG);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].candidate.verificationState)
      .toBe('CANDIDATE');
    expect(candidates[0].candidate.vulnerabilityClass)
      .toBe('SQL_INJECTION');
    expect(candidates[0].candidate.snapshot.commitSha)
      .toBe(commitSha);
    expect(candidates[0].candidateBinding)
      .toBe(
        computeCandidateBinding(
          candidates[0].candidate,
          ORG
        )
      );
  });

  it('fails closed when parameter count does not match placeholder count', async () => {
    const missingArg =
      replaceSource(input(), source => source.replace(
        /db\.prepare\([^)]+\)\.all\(\)/,
        'db.prepare("SELECT * FROM users WHERE id = ?").all()'
      ));

    const missingRun =
      await analyzeInput(missingArg);

    expect(missingRun.result.status)
      .toBe('ANALYSIS_INCONCLUSIVE');

    expect(missingRun.result.limitations)
      .toHaveLength(1);

    expect(missingRun.result.limitations[0].code)
      .toBe('UNSUPPORTED_CALL');

    const unexpectedArg =
      replaceSource(input(), source => source.replace(
        /db\.prepare\([^)]+\)\.all\(\)/,
        'db.prepare("SELECT * FROM users").all(req.query.q)'
      ));

    const unexpectedRun =
      await analyzeInput(unexpectedArg);

    expect(unexpectedRun.result.status)
      .toBe('ANALYSIS_INCONCLUSIVE');

    expect(unexpectedRun.result.limitations)
      .toHaveLength(1);

    expect(unexpectedRun.result.limitations[0].code)
      .toBe('UNSUPPORTED_CALL');
  });

  it('fails closed when parameter count exceeds supported single-argument budget', async () => {
    const multiArg =
      replaceSource(input(), source => source.replace(
        /db\.prepare\([^)]+\)\.all\(\)/,
        'db.prepare("SELECT * FROM users WHERE a = ? AND b = ?").all("1", "2")'
      ));

    const run =
      await analyzeInput(multiArg);

    expect(run.result.status)
      .toBe('ANALYSIS_INCONCLUSIVE');

    expect(run.result.limitations)
      .toHaveLength(1);

    expect(run.result.limitations[0].code)
      .toBe('UNSUPPORTED_CALL');
  });

  it('permits zero-parameter prepared queries with zero arguments as NOT_DETECTED', async () => {
    const zeroArg =
      replaceSource(input(), source => source.replace(
        /db\.prepare\([^)]+\)\.all\(\)/,
        'db.prepare("SELECT * FROM users").all()'
      ));

    const run =
      await analyzeInput(zeroArg);

    expect(run.result.status)
      .toBe('NOT_DETECTED');

    expect(run.result.findings)
      .toHaveLength(0);

    expect(run.result.limitations)
      .toHaveLength(0);
  });
});