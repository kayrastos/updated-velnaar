import { describe, expect, it } from 'vitest';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { computeCandidateBinding, validateFindingCandidate } from '../../../../worker/intelligence/contracts';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

function directAliasInput(aliasCode: string, sinkVar: string) {
  return replaceSource(input(), source => {
    const start = source.indexOf('return res.json(');
    const end = source.indexOf(').all());', start);
    if (start === -1 || end === -1) throw new Error('anchor not found');
    const original = source.slice(start, end + ').all());'.length);
    return source.replace(original, `${aliasCode}\n  return res.json(db.prepare(${sinkVar}).all());`);
  });
}

describe('roadmap: sqli detector direct alias propagation', () => {
  it('detects single-variable direct alias flow without string concatenation', async () => {
    const raw = directAliasInput('const directSql = req.query.q;', 'directSql');
    const { result } = await analyzeInput(raw);

    expect(result.status).toBe('DETECTED');
    expect(result.limitations).toEqual([]);
    expect(result.findings).toHaveLength(1);

    const finding = result.findings[0];
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.symbol).toBe('db.prepare');
    expect(finding.flow[0].kind).toBe('SOURCE');
    expect(finding.flow.at(-1)!.kind).toBe('SINK');
    expect(finding.flow.some(step => step.kind === 'CONCAT')).toBe(false);

    const variableSteps = finding.flow.filter(step => step.kind === 'VARIABLE');
    expect(variableSteps).toHaveLength(1);
    expect(variableSteps[0].location.symbol).toBe('directSql');
  });

  it('detects multi-hop direct alias propagation in chain order', async () => {
    const raw = directAliasInput(
      'const aliasA = req.query.q;\n  const aliasB = aliasA;\n  const aliasC = aliasB;',
      'aliasC'
    );
    const { result } = await analyzeInput(raw);

    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);

    const finding = result.findings[0];
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.symbol).toBe('db.prepare');
    expect(finding.flow.some(step => step.kind === 'CONCAT')).toBe(false);

    const variableSymbols = finding.flow
      .filter(step => step.kind === 'VARIABLE')
      .map(step => step.location.symbol);
    expect(variableSymbols).toEqual(['aliasA', 'aliasB', 'aliasC']);
  });

  it('negative control: safe constant direct alias does not trigger finding', async () => {
    const raw = directAliasInput('const safeQuery = "SELECT id FROM items WHERE id = 1";', 'safeQuery');
    const { result } = await analyzeInput(raw);

    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toEqual([]);
  });

  it('negative control: multi-hop safe constant alias does not trigger finding', async () => {
    const raw = directAliasInput(
      'const c1 = "SELECT 1";\n  const c2 = c1;\n  const c3 = c2;',
      'c3'
    );
    const { result } = await analyzeInput(raw);

    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toEqual([]);
  });

  it('preserves candidate bridge invariants and verificationState CANDIDATE for direct alias findings', async () => {
    const raw = directAliasInput('const target = req.query.q;', 'target');
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');

    const testCommit = '46db4c208f886afda939c04ae93580fbabd57344';
    const bridge = createSqlCandidateBridge(async () => testCommit);
    const hypotheses = await bridge(result, snapshot, ingestion, ORG);

    expect(hypotheses).toHaveLength(1);
    const { candidate, candidateBinding } = hypotheses[0];

    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.organizationId).toBe(ORG);
    expect(candidate.snapshot.commitSha).toBe(testCommit);
    expect(candidate.source.symbol).toBe('query.q');
    expect(candidate.sink.symbol).toBe('db.prepare');
    expect(candidate.sensorEvidence[0].sensorType).toBe('VELNAR_STRUCTURAL');
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);
  });

  it('analysis integrity validation confirms deterministic direct alias result', async () => {
    const raw = directAliasInput('const queryParam = req.query.q;', 'queryParam');
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    const validated = await validateSqlAnalysis(result, snapshot, ingestion, ORG);
    expect(validated).toEqual(result);
  });
});
