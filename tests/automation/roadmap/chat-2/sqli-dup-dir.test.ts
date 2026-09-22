import { describe, expect, it } from 'vitest';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { computeCandidateBinding, validateFindingCandidate } from '../../../../worker/intelligence/contracts';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

describe('V1 discovery intelligence: SQL injection detector duplicate collapse (direct)', () => {
  it('collapses duplicate flow steps when the same request query parameter is reused in concatenation', async () => {
    const raw = replaceSource(input(), content => content
      .replace('return res.json', 'const q = req.query.q; return res.json')
      .replace('" + req.query.q + "', '" + q + "\' OR fallback = \'" + q + "')
    );
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.limitations).toEqual([]);
    expect(result.findings).toHaveLength(1);

    const finding = result.findings[0];
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.symbol).toBe('db.prepare');

    const sourceSteps = finding.flow.filter(step => step.kind === 'SOURCE');
    expect(sourceSteps).toHaveLength(1);

    const varSteps = finding.flow.filter(step => step.kind === 'VARIABLE' && step.location.symbol === 'q');
    expect(varSteps).toHaveLength(1);

    const flowIds = finding.flow.map(step => step.id);
    expect(new Set(flowIds).size).toBe(finding.flow.length);

    const validated = await validateSqlAnalysis(result, snapshot, ingestion, ORG);
    expect(validated.resultFingerprint).toBe(result.resultFingerprint);

    const bridge = createSqlCandidateBridge(async () => 'a'.repeat(40));
    const candidates = await bridge(result, snapshot, ingestion, ORG);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].candidate.verificationState).toBe('CANDIDATE');
    expect(candidates[0].candidateBinding).toBe(computeCandidateBinding(candidates[0].candidate, ORG));
  });

  it('collapses common source provenance across converging alias branches', async () => {
    const raw = replaceSource(input(), content => content
      .replace('return res.json', 'const q = req.query.q; const a = q; const b = q; return res.json')
      .replace('" + req.query.q + "', '" + a + "\' AND secondary = \'" + b + "')
    );
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.limitations).toEqual([]);
    expect(result.findings).toHaveLength(1);

    const finding = result.findings[0];
    expect(finding.flow.filter(s => s.kind === 'SOURCE')).toHaveLength(1);

    const varSymbols = finding.flow.filter(s => s.kind === 'VARIABLE').map(s => s.location.symbol);
    expect(varSymbols).toContain('q');
    expect(varSymbols).toContain('a');
    expect(varSymbols).toContain('b');
    expect(varSymbols.filter(sym => sym === 'q')).toHaveLength(1);
  });

  it('collapses duplicate findings when the same sink location is reached multiple times with identical flow', async () => {
    const raw = replaceSource(input(), content => {
      const start = content.indexOf('return res.json');
      const end = content.indexOf(').all());', start) + ').all());'.length;
      const replacement =
        'function runQuery() { return db.prepare("SELECT * FROM users WHERE id = \'" + req.query.q + "\'").all(); }\n' +
        '    runQuery(); runQuery(); runQuery(); runQuery(); runQuery();\n' +
        '    runQuery(); runQuery(); runQuery(); runQuery();\n' +
        '    return res.json(runQuery());';
      return content.slice(0, start) + replacement + content.slice(end);
    });
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.limitations).toEqual([]);
    expect(result.findings).toHaveLength(1);

    const bridge = createSqlCandidateBridge(async () => 'a'.repeat(40));
    const candidates = await bridge(result, snapshot, ingestion, ORG);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].candidate.verificationState).toBe('CANDIDATE');
    expect(candidates[0].candidateBinding).toBe(computeCandidateBinding(candidates[0].candidate, ORG));
  });

  it('bounds flow length by deduplicating steps during repeated self-concatenation', async () => {
    const raw = replaceSource(input(), content => content
      .replace('return res.json',
        'const q = req.query.q;\n' +
        '    const x1 = q + q;\n' +
        '    const x2 = x1 + x1;\n' +
        '    const x3 = x2 + x2;\n' +
        '    const x4 = x3 + x3;\n' +
        '    const x5 = x4 + x4;\n' +
        '    return res.json'
      )
      .replace('" + req.query.q + "', '" + x5 + "')
    );
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.limitations).toEqual([]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].flow.length).toBeLessThanOrEqual(64);
  });

  it('does not collapse distinct source inputs and fails closed with MULTIPLE_SOURCES', async () => {
    const raw = replaceSource(input(), source =>
      source.replace('req.query.q', '(req.query.q + req.query.other)')
    );
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('MULTIPLE_SOURCES');

    const bridge = createSqlCandidateBridge(async () => 'a'.repeat(40));
    expect(await bridge(result, snapshot, ingestion, ORG)).toEqual([]);
  });

  it('produces deterministic findings and canonical candidate binding across repeated runs', async () => {
    const raw = replaceSource(input(), content => content
      .replace('return res.json', 'const q = req.query.q; return res.json')
      .replace('" + req.query.q + "', '" + q + "\' OR fallback = \'" + q + "')
    );
    const run1 = await analyzeInput(raw);
    const run2 = await analyzeInput(raw);

    expect(run1.result.resultFingerprint).toBe(run2.result.resultFingerprint);
    expect(run1.result.findings).toEqual(run2.result.findings);

    const checkedCommit = 'b'.repeat(40);
    const bridge = createSqlCandidateBridge(async () => checkedCommit);

    const [cand1] = await bridge(run1.result, run1.snapshot, run1.ingestion, ORG);
    const [cand2] = await bridge(run2.result, run2.snapshot, run2.ingestion, ORG);

    expect(cand1.candidateBinding).toBe(cand2.candidateBinding);
    expect(cand1.candidate.candidateId).toBe(cand2.candidate.candidateId);
    expect(cand1.candidate.verificationState).toBe('CANDIDATE');
    expect(validateFindingCandidate(cand1.candidate, ORG)).toEqual(cand1.candidate);
  });
});
