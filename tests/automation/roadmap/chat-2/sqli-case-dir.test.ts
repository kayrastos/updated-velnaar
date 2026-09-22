import { describe, expect, it } from 'vitest';
import { validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { computeCandidateBinding } from '../../../../worker/intelligence/contracts';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

describe('V1 discovery intelligence: SQL injection detector case sensitivity (direct)', () => {
  it('detects direct SQL injection regardless of SQL keyword casing in query concatenation', async () => {
    const base = await analyzeInput(input(0));
    expect(base.result.status).toBe('DETECTED');
    expect(base.result.findings).toHaveLength(1);
    expect(base.result.findings[0].source.symbol).toBe('query.q');
    expect(base.result.findings[0].sink.symbol).toBe('db.prepare');

    const lowerSql = await analyzeInput(replaceSource(input(0), s =>
      s.replace(/SELECT/g, 'select').replace(/FROM/g, 'from').replace(/WHERE/g, 'where')
    ));
    expect(lowerSql.result.status).toBe('DETECTED');
    expect(lowerSql.result.findings).toHaveLength(1);
    expect(lowerSql.result.findings[0].source.symbol).toBe('query.q');
    expect(lowerSql.result.findings[0].sink.symbol).toBe('db.prepare');

    const mixedSql = await analyzeInput(replaceSource(input(0), s =>
      s.replace(/SELECT/g, 'Select').replace(/FROM/g, 'From').replace(/WHERE/g, 'Where')
    ));
    expect(mixedSql.result.status).toBe('DETECTED');
    expect(mixedSql.result.findings).toHaveLength(1);
    expect(mixedSql.result.findings[0].source.symbol).toBe('query.q');
    expect(mixedSql.result.findings[0].sink.symbol).toBe('db.prepare');

    await expect(validateSqlAnalysis(lowerSql.result, lowerSql.snapshot, lowerSql.ingestion, ORG))
      .resolves.toEqual(lowerSql.result);
  });

  it('preserves exact query parameter casing in source symbols for direct SQL injection', async () => {
    const upperParam = await analyzeInput(replaceSource(input(0), s => s.replace(/req\.query\.q/g, 'req.query.Q')));
    expect(upperParam.result.status).toBe('DETECTED');
    expect(upperParam.result.findings).toHaveLength(1);
    expect(upperParam.result.findings[0].source.symbol).toBe('query.Q');
    expect(upperParam.result.findings[0].sink.symbol).toBe('db.prepare');

    const camelParam = await analyzeInput(replaceSource(input(0), s => s.replace(/req\.query\.q/g, 'req.query.searchTerm')));
    expect(camelParam.result.status).toBe('DETECTED');
    expect(camelParam.result.findings).toHaveLength(1);
    expect(camelParam.result.findings[0].source.symbol).toBe('query.searchTerm');
    expect(camelParam.result.findings[0].sink.symbol).toBe('db.prepare');

    await expect(validateSqlAnalysis(upperParam.result, upperParam.snapshot, upperParam.ingestion, ORG))
      .resolves.toEqual(upperParam.result);
  });

  it('fails closed when API property access or sink casing is mismatched', async () => {
    const badQueryReceiver = await analyzeInput(replaceSource(input(0), s => s.replace('req.query.q', 'req.Query.q')));
    expect(badQueryReceiver.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(badQueryReceiver.result.findings).toHaveLength(0);
    expect(badQueryReceiver.result.limitations[0].code).toBe('UNSUPPORTED_EXPRESSION');

    const badSinkMethod = await analyzeInput(replaceSource(input(0), s => s.replace('db.prepare', 'db.Prepare')));
    expect(badSinkMethod.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(badSinkMethod.result.findings).toHaveLength(0);
    expect(badSinkMethod.result.limitations[0].code).toBe('UNSUPPORTED_EXPRESSION');

    const badAllMethod = await analyzeInput(replaceSource(input(0), s => s.replace('.all()', '.ALL()')));
    expect(badAllMethod.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(badAllMethod.result.findings).toHaveLength(0);
    expect(badAllMethod.result.limitations[0].code).toBe('UNSUPPORTED_EXPRESSION');

    const badJsonMethod = await analyzeInput(replaceSource(input(0), s => s.replace('res.json', 'res.Json')));
    expect(badJsonMethod.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(badJsonMethod.result.findings).toHaveLength(0);
    expect(badJsonMethod.result.limitations[0].code).toBe('UNSUPPORTED_EXPRESSION');
  });

  it('bridges direct SQL injection findings with modified casing into CANDIDATE hypothesis', async () => {
    const run = await analyzeInput(replaceSource(input(0), s => s.replace(/req\.query\.q/g, 'req.query.Q')));
    const checkedCommit = '46db4c208f886afda939c04ae93580fbabd57344';
    const bridge = createSqlCandidateBridge(async () => checkedCommit);
    const hypotheses = await bridge(run.result, run.snapshot, run.ingestion, ORG);

    expect(hypotheses).toHaveLength(1);
    const { candidate, candidateBinding } = hypotheses[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.source.symbol).toBe('query.Q');
    expect(candidate.sink.symbol).toBe('db.prepare');
    expect(candidate.snapshot.commitSha).toBe(checkedCommit);
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
  });
});
