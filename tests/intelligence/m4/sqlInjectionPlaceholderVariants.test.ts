import { describe, expect, it } from 'vitest';
import { createSqlCandidateBridge } from '../../../worker/intelligence/detection/candidate';
import { computeCandidateBinding } from '../../../worker/intelligence/contracts';
import { analyzeInput, input, replaceSource, ORG } from '../m3/support/inputs';

async function runWithQuery(queryExpr: string) {
  const raw = replaceSource(input(), source =>
    source.replace('return res.json', `return res.json(${queryExpr}); return res.json`)
  );
  return analyzeInput(raw);
}

const DUMMY_COMMIT = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const bridge = createSqlCandidateBridge(async () => DUMMY_COMMIT);

describe('M4 SQL injection placeholder variant matrix', () => {
  describe('canonical positional placeholder (?) semantics', () => {
    it('treats single positional placeholder with untainted literal argument as safe', async () => {
      const { result, snapshot, ingestion } = await runWithQuery('db.prepare("SELECT * FROM items WHERE id = ?").all("safe-id")');
      expect(result.status).toBe('NOT_DETECTED');
      expect(result.findings).toHaveLength(0);
      expect(result.limitations).toHaveLength(0);
      expect(await bridge(result, snapshot, ingestion, ORG)).toEqual([]);
    });

    it('treats single positional placeholder with tainted request argument as safe bound parameter', async () => {
      const { result, snapshot, ingestion } = await runWithQuery('db.prepare("SELECT * FROM items WHERE id = ?").all(req.query.q)');
      expect(result.status).toBe('NOT_DETECTED');
      expect(result.findings).toHaveLength(0);
      expect(result.limitations).toHaveLength(0);
      expect(await bridge(result, snapshot, ingestion, ORG)).toEqual([]);
    });

    it('fails closed when positional placeholder is missing required argument', async () => {
      const { result, snapshot, ingestion } = await runWithQuery('db.prepare("SELECT * FROM items WHERE id = ?").all()');
      expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
      expect(result.findings).toHaveLength(0);
      expect(result.limitations).toHaveLength(1);
      expect(result.limitations[0].code).toBe('UNSUPPORTED_CALL');
      expect(await bridge(result, snapshot, ingestion, ORG)).toEqual([]);
    });

    it('fails closed when argument is provided to a parameterless query', async () => {
      const { result, snapshot, ingestion } = await runWithQuery('db.prepare("SELECT * FROM items WHERE id = 1").all(req.query.q)');
      expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
      expect(result.findings).toHaveLength(0);
      expect(result.limitations).toHaveLength(1);
      expect(result.limitations[0].code).toBe('UNSUPPORTED_CALL');
      expect(await bridge(result, snapshot, ingestion, ORG)).toEqual([]);
    });

    it('fails closed when multiple positional arguments exceed bounded single-argument budget', async () => {
      const { result, snapshot, ingestion } = await runWithQuery('db.prepare("SELECT * FROM items WHERE a = ? AND b = ?").all("1", "2")');
      expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
      expect(result.findings).toHaveLength(0);
      expect(result.limitations).toHaveLength(1);
      expect(result.limitations[0].code).toBe('UNSUPPORTED_CALL');
      expect(await bridge(result, snapshot, ingestion, ORG)).toEqual([]);
    });
  });

  describe('alternative placeholder variants and fail-closed syntax boundaries', () => {
    it('fails closed on PostgreSQL-style dollar positional placeholder ($1)', async () => {
      const { result, snapshot, ingestion } = await runWithQuery('db.prepare("SELECT * FROM items WHERE id = $1").all(req.query.q)');
      expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
      expect(result.findings).toHaveLength(0);
      expect(result.limitations).toHaveLength(1);
      expect(result.limitations[0].code).toBe('UNSUPPORTED_CALL');
      expect(await bridge(result, snapshot, ingestion, ORG)).toEqual([]);
    });

    it('fails closed on colon-prefixed named placeholder (:id)', async () => {
      const { result, snapshot, ingestion } = await runWithQuery('db.prepare("SELECT * FROM items WHERE id = :id").all(req.query.q)');
      expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
      expect(result.findings).toHaveLength(0);
      expect(result.limitations).toHaveLength(1);
      expect(result.limitations[0].code).toBe('UNSUPPORTED_CALL');
      expect(await bridge(result, snapshot, ingestion, ORG)).toEqual([]);
    });

    it('fails closed on at-prefixed named placeholder (@id)', async () => {
      const { result, snapshot, ingestion } = await runWithQuery('db.prepare("SELECT * FROM items WHERE id = @id").all(req.query.q)');
      expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
      expect(result.findings).toHaveLength(0);
      expect(result.limitations).toHaveLength(1);
      expect(result.limitations[0].code).toBe('UNSUPPORTED_CALL');
      expect(await bridge(result, snapshot, ingestion, ORG)).toEqual([]);
    });

    it('accepts SQLite indexed question-mark placeholder (?1) matching single argument count', async () => {
      const { result, snapshot, ingestion } = await runWithQuery('db.prepare("SELECT * FROM items WHERE id = ?1").all(req.query.q)');
      expect(result.status).toBe('NOT_DETECTED');
      expect(result.findings).toHaveLength(0);
      expect(result.limitations).toHaveLength(0);
      expect(await bridge(result, snapshot, ingestion, ORG)).toEqual([]);
    });
  });

  describe('mixed placeholder and tainted string concatenation', () => {
    it('detects SQL injection when taint is concatenated into query text despite presence of valid placeholder', async () => {
      const { result, snapshot, ingestion } = await runWithQuery(
        'db.prepare("SELECT * FROM items WHERE id = ? AND category = \'" + req.query.q + "\'").all("safe-id")'
      );
      expect(result.status).toBe('DETECTED');
      expect(result.limitations).toHaveLength(0);
      expect(result.findings).toHaveLength(1);
      const finding = result.findings[0];
      expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
      expect(finding.source.symbol).toBe('query.q');
      expect(finding.sink.symbol).toBe('db.prepare');
      expect(finding.flow.some(step => step.kind === 'CONCAT')).toBe(true);

      const candidates = await bridge(result, snapshot, ingestion, ORG);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].candidate.verificationState).toBe('CANDIDATE');
      expect(candidates[0].candidate.reachabilityState).toBe('REACHABLE');
      expect(candidates[0].candidate.vulnerabilityClass).toBe('SQL_INJECTION');
      expect(candidates[0].candidateBinding).toBe(computeCandidateBinding(candidates[0].candidate, ORG));
    });

    it('resolves safe constant concatenation alongside placeholder', async () => {
      const { result, snapshot, ingestion } = await runWithQuery(
        'db.prepare("SELECT * FROM items WHERE id = ?" + " AND active = 1").all(req.query.q)'
      );
      expect(result.status).toBe('NOT_DETECTED');
      expect(result.findings).toHaveLength(0);
      expect(result.limitations).toHaveLength(0);
      expect(await bridge(result, snapshot, ingestion, ORG)).toEqual([]);
    });

    it('supports no-substitution template literal query with placeholder', async () => {
      const { result, snapshot, ingestion } = await runWithQuery(
        'db.prepare(`SELECT * FROM items WHERE id = ?`).all(req.query.q)'
      );
      expect(result.status).toBe('NOT_DETECTED');
      expect(result.findings).toHaveLength(0);
      expect(result.limitations).toHaveLength(0);
      expect(await bridge(result, snapshot, ingestion, ORG)).toEqual([]);
    });
  });
});
