import { describe, expect, it, vi } from 'vitest';
import { createSqlCandidateBridge } from '../../../worker/intelligence/detection/candidate';
import { detectSqlInjection } from '../../../worker/intelligence/detection/sqlInjection';
import { analyzeInput, input, replaceSource, ORG } from '../m3/support/inputs';

describe('M4 SQL injection detector ORM false positive rejection', () => {
  it('rejects false positives when ORM repository helper uses parameterized queries', async () => {
    const raw = replaceSource(input(), source => source.replace(
      'function searchRoute',
      'function ormFindById(db: any, id: string) {\n  return db.prepare("SELECT * FROM users WHERE id = ?").all(id);\n}\nfunction searchRoute'
    ).replace(
      'return res.json(',
      'return res.json(ormFindById(db, req.query.q));\n  return res.json('
    ));
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('NOT_DETECTED');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations).toEqual([]);

    const verify = vi.fn();
    const bridge = createSqlCandidateBridge(verify);
    const candidates = await bridge(run.result, run.snapshot, run.ingestion, ORG);
    expect(candidates).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  });

  it('rejects false positives when ORM query helper uses constant SQL without parameter binding', async () => {
    const raw = replaceSource(input(), source => source.replace(
      'function searchRoute',
      'function ormFindAll(db: any) {\n  return db.prepare("SELECT * FROM users").all();\n}\nfunction searchRoute'
    ).replace(
      'return res.json(',
      'const unused = req.query.q;\n  return res.json(ormFindAll(db));\n  return res.json('
    ));
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('NOT_DETECTED');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations).toEqual([]);

    const verify = vi.fn();
    const candidates = await createSqlCandidateBridge(verify)(run.result, run.snapshot, run.ingestion, ORG);
    expect(candidates).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  });

  it('rejects false positives when repository pattern returns a parameterized query closure', async () => {
    const raw = replaceSource(input(), source => source.replace(
      'function searchRoute',
      'function ormRepository(db: any) {\n  function query(id: string) {\n    return db.prepare("SELECT * FROM accounts WHERE owner_id = ?").all(id);\n  }\n  return query;\n}\nfunction searchRoute'
    ).replace(
      'return res.json(',
      'const repo = ormRepository(db);\n  return res.json(repo(req.query.q));\n  return res.json('
    ));
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('NOT_DETECTED');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations).toEqual([]);

    const verify = vi.fn();
    const candidates = await createSqlCandidateBridge(verify)(run.result, run.snapshot, run.ingestion, ORG);
    expect(candidates).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  });

  it('fails closed to inconclusive without false positive findings on unsupported ORM method access', async () => {
    const raw = replaceSource(input(), source => source.replace(
      'return res.json(',
      'const user = (db as any).findUnique(req.query.q);\n  return res.json();\n  return res.json('
    ));
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('UNSUPPORTED_EXPRESSION');

    const verify = vi.fn();
    const candidates = await createSqlCandidateBridge(verify)(run.result, run.snapshot, run.ingestion, ORG);
    expect(candidates).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  });

  it('fails closed to inconclusive without false positive findings on unbound ORM client identifier', async () => {
    const raw = replaceSource(input(), source => source.replace(
      'return res.json(',
      'const user = ormClient.find(req.query.q);\n  return res.json();\n  return res.json('
    ));
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('UNBOUND_NAME');

    const verify = vi.fn();
    const candidates = await createSqlCandidateBridge(verify)(run.result, run.snapshot, run.ingestion, ORG);
    expect(candidates).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  });

  it('confirms positive control: genuine raw dynamic SQL concatenation in helper is detected', async () => {
    const raw = replaceSource(input(), source => source.replace(
      'function searchRoute',
      'function ormUnsafeRaw(db: any, id: string) {\n  return db.prepare("SELECT * FROM users WHERE id = " + id).all();\n}\nfunction searchRoute'
    ).replace(
      'return res.json(',
      'return res.json(ormUnsafeRaw(db, req.query.q));\n  return res.json('
    ));
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('DETECTED');
    expect(run.result.findings).toHaveLength(1);
    expect(run.result.findings[0].vulnerabilityClass).toBe('SQL_INJECTION');

    const fakeSha = 'a'.repeat(40);
    const verify = vi.fn(async () => fakeSha);
    const candidates = await createSqlCandidateBridge(verify)(run.result, run.snapshot, run.ingestion, ORG);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].candidate.verificationState).toBe('CANDIDATE');
    expect(candidates[0].candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(verify).toHaveBeenCalledTimes(1);
  });
});
