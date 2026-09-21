import { describe, expect, it } from 'vitest';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { computeCandidateBinding, validateFindingCandidate } from '../../../../worker/intelligence/contracts';
import { validateSnapshot, canonical } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress, validateExpressIngestion } from '../../../../worker/intelligence/ingestion/express';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

const DUMMY_COMMIT = '46db4c208f886afda939c04ae93580fbabd57344';
const bridge = createSqlCandidateBridge(async () => DUMMY_COMMIT);

describe('SQLI detector: case-sensitivity and restart-resume', () => {
  it('detects tainted query parameter when parameter name has uppercase or mixed casing', async () => {
    const raw = replaceSource(input(), content => content
      .replace('req.query.q', 'req.query.SearchTerm')
      .replace('req.query.q', 'req.query.SearchTerm'));
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].source.symbol).toBe('query.SearchTerm');
    expect(result.findings[0].sink.symbol).toBe('db.prepare');
    const validated = await validateSqlAnalysis(result, snapshot, ingestion, ORG);
    expect(validated.resultFingerprint).toBe(result.resultFingerprint);
  });

  it('negative control: case-mismatched identifier does not propagate taint to sink', async () => {
    const raw = replaceSource(input(), content => content
      .replace('return res.json', 'const queryParam = req.query.q; const QueryParam = "safe-constant"; return res.json')
      .replace('" + req.query.q + "', '" + QueryParam + "'));
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toHaveLength(0);
    const candidates = await bridge(result, snapshot, ingestion, ORG);
    expect(candidates).toHaveLength(0);
  });

  it('detects SQL injection regardless of SQL keyword casing (lowercase / mixed-case SQL text)', async () => {
    const raw = replaceSource(input(), content => content
      .replace('SELECT ', 'select ')
      .replace(' FROM ', ' from ')
      .replace(' WHERE ', ' where '));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].sink.symbol).toBe('db.prepare');
  });

  it('preserves route identity and detection when route path contains uppercase or mixed-case components', async () => {
    const raw = replaceSource(input(), content => content
      .replace("app.get('/search'", "app.get('/ApiSearch'"));
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    const route = ingestion.routes.find(r => r.path === '/ApiSearch');
    expect(route).toBeDefined();
    expect(result.findings[0].routeIdentity).toBe(route!.routeIdentity);
  });

  it('restart-resume: re-analysis across simulated restart produces identical findings and result fingerprint', async () => {
    const raw = replaceSource(input(), content => content
      .replace('return res.json', 'const TaintedValue = req.query.SearchQuery; return res.json')
      .replace('" + req.query.q + "', '" + TaintedValue + "'));

    const initial = await analyzeInput(raw);
    expect(initial.result.status).toBe('DETECTED');

    const serializedSnapshot = JSON.parse(JSON.stringify(initial.snapshot));
    const resumedSnapshot = await validateSnapshot(serializedSnapshot, ORG);
    const resumedIngestion = await ingestExpress(resumedSnapshot, ORG);
    const resumedResult = await detectSqlInjection(resumedSnapshot, resumedIngestion, ORG);

    expect(resumedResult.status).toBe(initial.result.status);
    expect(resumedResult.resultFingerprint).toBe(initial.result.resultFingerprint);
    expect(resumedResult.findings).toHaveLength(initial.result.findings.length);
    expect(canonical(resumedResult)).toBe(canonical(initial.result));

    const initialCandidates = await bridge(initial.result, initial.snapshot, initial.ingestion, ORG);
    const resumedCandidates = await bridge(resumedResult, resumedSnapshot, resumedIngestion, ORG);
    expect(initialCandidates).toHaveLength(1);
    expect(resumedCandidates).toHaveLength(1);
    expect(resumedCandidates[0].candidateBinding).toBe(initialCandidates[0].candidateBinding);
    expect(resumedCandidates[0].candidate.candidateId).toBe(initialCandidates[0].candidate.candidateId);
    expect(validateFindingCandidate(resumedCandidates[0].candidate, ORG)).toEqual(resumedCandidates[0].candidate);
  });

  it('restart-resume: negative control persists as NOT_DETECTED with zero candidates across restart', async () => {
    const raw = replaceSource(input(), content => content
      .replace('return res.json', 'const inputData = req.query.q; const InputData = "safe-literal"; return res.json')
      .replace('" + req.query.q + "', '" + InputData + "'));

    const initial = await analyzeInput(raw);
    expect(initial.result.status).toBe('NOT_DETECTED');

    const snapshotCopy = JSON.parse(JSON.stringify(initial.snapshot));
    const resumedSnapshot = await validateSnapshot(snapshotCopy, ORG);
    const resumedIngestion = await validateExpressIngestion(initial.ingestion, ORG);
    const resumedResult = await detectSqlInjection(resumedSnapshot, resumedIngestion, ORG);

    expect(resumedResult.status).toBe('NOT_DETECTED');
    expect(resumedResult.findings).toEqual([]);
    expect(resumedResult.resultFingerprint).toBe(initial.result.resultFingerprint);

    const candidates = await bridge(resumedResult, resumedSnapshot, resumedIngestion, ORG);
    expect(candidates).toEqual([]);
  });

  it('rejects tampered case-sensitive analysis results on resumption validation', async () => {
    const raw = replaceSource(input(), content => content
      .replace('req.query.q', 'req.query.SearchVal')
      .replace('req.query.q', 'req.query.SearchVal'));
    const { snapshot, ingestion, result } = await analyzeInput(raw);

    const tampered = structuredClone(result);
    (tampered.findings[0] as any).source.symbol = 'query.searchval';
    await expect(validateSqlAnalysis(tampered, snapshot, ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
  });
});
