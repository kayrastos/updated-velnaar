import { describe, expect, it } from 'vitest';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { computeCandidateBinding, validateFindingCandidate } from '../../../../worker/intelligence/contracts';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

describe('Roadmap Chat-2 SQL injection direct wrapper boundary verification', () => {
  it('detects SQL injection through a direct database execution wrapper in the route factory', async () => {
    const raw = replaceSource(input(), source =>
      source
        .replace('function searchRoute', `function execQuery(q: string) {
  return db.prepare(q).all();
}
function searchRoute`)
        .replace('return res.json', 'const query = "SELECT * FROM users WHERE name = \'" + req.query.q + "\'"; return res.json(execQuery(query)); //')
    );
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.symbol).toBe('db.prepare');
    expect(finding.flow.some(step => step.kind === 'SOURCE')).toBe(true);
    expect(finding.flow.some(step => step.kind === 'CALL' && step.location.symbol === 'execQuery')).toBe(true);
    expect(finding.flow.some(step => step.kind === 'ARGUMENT' && step.location.symbol === 'q')).toBe(true);
    expect(finding.flow.some(step => step.kind === 'CONCAT')).toBe(true);
    expect(finding.flow.at(-1)?.kind).toBe('SINK');
  });

  it('detects SQL injection through a wrapper passing database handle as argument', async () => {
    const raw = replaceSource(input(), source =>
      source
        .replace('function searchRoute', `function queryWithDb(database: any, q: string) {
  return database.prepare(q).all();
}
function searchRoute`)
        .replace('return res.json', 'const query = "SELECT * FROM items WHERE category = \'" + req.query.q + "\'"; return res.json(queryWithDb(db, query)); //')
    );
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.symbol).toBe('db.prepare');
    expect(finding.flow.some(step => step.kind === 'CALL' && step.location.symbol === 'queryWithDb')).toBe(true);
    expect(finding.flow.some(step => step.kind === 'ARGUMENT' && step.location.symbol === 'q')).toBe(true);
  });

  it('detects SQL injection through a wrapper returning a prepared statement', async () => {
    const raw = replaceSource(input(), source =>
      source
        .replace('function searchRoute', `function prepareWrapper(q: string) {
  return db.prepare(q);
}
function searchRoute`)
        .replace('return res.json', 'const query = "SELECT * FROM records WHERE id = \'" + req.query.q + "\'"; return res.json(prepareWrapper(query).all()); //')
    );
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].sink.symbol).toBe('db.prepare');
  });

  it('safe control: constant query through direct wrapper yields NOT_DETECTED', async () => {
    const raw = replaceSource(input(), source =>
      source
        .replace('function searchRoute', `function execQuery(q: string) {
  return db.prepare(q).all();
}
function searchRoute`)
        .replace('return res.json', 'const query = "SELECT * FROM users WHERE name = \'constant_safe\'"; return res.json(execQuery(query)); //')
    );
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
  });

  it('safe control: parameterized query through direct wrapper yields NOT_DETECTED', async () => {
    const raw = replaceSource(input(), source =>
      source
        .replace('function searchRoute', `function execParam(q: string, value: string) {
  return db.prepare(q).all(value);
}
function searchRoute`)
        .replace('return res.json', 'const param = req.query.q; return res.json(execParam("SELECT * FROM users WHERE name = ?", param)); //')
    );
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
  });

  it('creates bounded CANDIDATE hypothesis preserving canonical candidate binding', async () => {
    const raw = replaceSource(input(), source =>
      source
        .replace('function searchRoute', `function execQuery(q: string) {
  return db.prepare(q).all();
}
function searchRoute`)
        .replace('return res.json', 'const query = "SELECT * FROM users WHERE name = \'" + req.query.q + "\'"; return res.json(execQuery(query)); //')
    );
    const { result, snapshot, ingestion } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    const checkedCommit = '1111111111111111111111111111111111111111';
    const bridge = createSqlCandidateBridge(async () => checkedCommit);
    const hypotheses = await bridge(result, snapshot, ingestion, ORG);
    expect(hypotheses).toHaveLength(1);
    const { candidate, candidateBinding } = hypotheses[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.organizationId).toBe(ORG);
    expect(candidate.snapshot.commitSha).toBe(checkedCommit);
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);
  });

  it('safe control produces no candidate hypotheses from bridge', async () => {
    const raw = replaceSource(input(), source =>
      source
        .replace('function searchRoute', `function execQuery(q: string) {
  return db.prepare(q).all();
}
function searchRoute`)
        .replace('return res.json', 'const query = "SELECT * FROM users WHERE name = \'safe\'"; return res.json(execQuery(query)); //')
    );
    const { result, snapshot, ingestion } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    const bridge = createSqlCandidateBridge(async () => '1111111111111111111111111111111111111111');
    const hypotheses = await bridge(result, snapshot, ingestion, ORG);
    expect(hypotheses).toEqual([]);
  });
});
