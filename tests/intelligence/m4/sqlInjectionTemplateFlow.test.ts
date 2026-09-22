import { describe, expect, it, vi } from 'vitest';
import { createSqlCandidateBridge } from '../../../worker/intelligence/detection/candidate';
import { validateSqlAnalysis } from '../../../worker/intelligence/detection/sqlInjection';
import { computeCandidateBinding, validateFindingCandidate } from '../../../worker/intelligence/contracts';
import { analyzeInput, input, replaceSource, ORG } from '../m3/support/inputs';

describe('M4 SQL injection template literal taint flow', () => {
  it('detects template literal binary concatenation flow from request to prepare sink', async () => {
    const raw = replaceSource(input(), source => source.replace(
      /return res\.json\(db\.prepare\(.+?\)\.all\(\)\);/,
      "const query = `SELECT * FROM items WHERE id = '` + req.query.q + `';`;\n  return res.json(db.prepare(query).all());"
    ));
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('DETECTED');
    expect(run.result.limitations).toEqual([]);
    expect(run.result.findings).toHaveLength(1);
    const finding = run.result.findings[0];
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.symbol).toBe('db.prepare');
    expect(finding.flow[0].kind).toBe('SOURCE');
    expect(finding.flow.at(-1)!.kind).toBe('SINK');
    expect(finding.flow.some(step => step.kind === 'CONCAT')).toBe(true);
    const validated = await validateSqlAnalysis(run.result, run.snapshot, run.ingestion, ORG);
    expect(validated).toEqual(run.result);
  });

  it('evaluates untainted no-substitution template literal query as NOT_DETECTED', async () => {
    const raw = replaceSource(input(), source => source.replace(
      /return res\.json\(db\.prepare\(.+?\)\.all\(\)\);/,
      "const query = `SELECT * FROM items WHERE status = 'active'`;\n  return res.json(db.prepare(query).all());"
    ));
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('NOT_DETECTED');
    expect(run.result.findings).toHaveLength(0);
    expect(run.result.limitations).toHaveLength(0);
  });

  it('evaluates parameterized query with bound parameter in template as NOT_DETECTED', async () => {
    const raw = replaceSource(input(), source => source.replace(
      /return res\.json\(db\.prepare\(.+?\)\.all\(\)\);/,
      "const query = `SELECT * FROM items WHERE id = ?`;\n  return res.json(db.prepare(query).all(req.query.q));"
    ));
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('NOT_DETECTED');
    expect(run.result.findings).toHaveLength(0);
    expect(run.result.limitations).toHaveLength(0);
  });

  it('fails closed as ANALYSIS_INCONCLUSIVE when encountering interpolated template expression', async () => {
    const raw = replaceSource(input(), source => source.replace(
      'return res.json',
      "const query = `SELECT * FROM items WHERE id = '${req.query.q}'`; return res.json"
    ));
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('UNSUPPORTED_EXPRESSION');
  });

  it('fails closed with MULTIPLE_SOURCES when multiple tainted inputs concatenate', async () => {
    const raw = replaceSource(input(), source => source.replace(
      /return res\.json\(db\.prepare\(.+?\)\.all\(\)\);/,
      "const query = `SELECT * FROM items WHERE a = '` + req.query.a + `' AND b = '` + req.query.b + `';`;\n  return res.json(db.prepare(query).all());"
    ));
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('MULTIPLE_SOURCES');
  });

  it('bridges detected template flow to exact-bound FindingCandidate hypothesis with valid commit', async () => {
    const raw = replaceSource(input(), source => source.replace(
      /return res\.json\(db\.prepare\(.+?\)\.all\(\)\);/,
      "const query = `SELECT * FROM items WHERE id = '` + req.query.q + `';`;\n  return res.json(db.prepare(query).all());"
    ));
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('DETECTED');
    const checkedCommit = 'a'.repeat(40);
    const bridge = createSqlCandidateBridge(async () => checkedCommit);
    const output = await bridge(run.result, run.snapshot, run.ingestion, ORG);
    expect(output).toHaveLength(1);
    const { candidate, candidateBinding } = output[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.snapshot.commitSha).toBe(checkedCommit);
    expect(candidate.organizationId).toBe(ORG);
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);
  });

  it('produces no candidate hypothesis on negative or inconclusive template flow', async () => {
    const verify = vi.fn();
    const bridge = createSqlCandidateBridge(verify);
    const safeRaw = replaceSource(input(), source => source.replace(
      /return res\.json\(db\.prepare\(.+?\)\.all\(\)\);/,
      "const query = `SELECT * FROM items WHERE status = 'active'`;\n  return res.json(db.prepare(query).all());"
    ));
    const safeRun = await analyzeInput(safeRaw);
    expect(await bridge(safeRun.result, safeRun.snapshot, safeRun.ingestion, ORG)).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  });
});
