import { describe, expect, it } from 'vitest';
import { validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { computeCandidateBinding, validateFindingCandidate } from '../../../../worker/intelligence/contracts';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

describe('M3 SQL injection detection - nested cross-file flow', () => {
  it('detects SQL injection through nested cross-file call flow across routes, service, and repository', async () => {
    const run = await analyzeInput(input(6));
    expect(run.result.status).toBe('DETECTED');
    expect(run.result.limitations).toEqual([]);
    expect(run.result.findings).toHaveLength(1);

    const finding = run.result.findings[0];
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.source.filePath).toBe('src/routes.ts');
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.filePath).toBe('src/repository.ts');
    expect(finding.sink.symbol).toBe('db.prepare');

    const filePaths = [...new Set(finding.flow.map(step => step.location.filePath))];
    expect(filePaths).toEqual(['src/routes.ts', 'src/service.ts', 'src/repository.ts']);

    expect(finding.flow[0].kind).toBe('SOURCE');
    expect(finding.flow.at(-1)!.kind).toBe('SINK');

    const calls = finding.flow.filter(step => step.kind === 'CALL');
    const args = finding.flow.filter(step => step.kind === 'ARGUMENT');
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(args.length).toBeGreaterThanOrEqual(2);
  });

  it('validates analysis integrity against independent re-computation', async () => {
    const run = await analyzeInput(input(6));
    const validated = await validateSqlAnalysis(run.result, run.snapshot, run.ingestion, ORG);
    expect(validated.resultFingerprint).toBe(run.result.resultFingerprint);
  });

  it('does not detect finding when a safe constant replaces user input in cross-file flow', async () => {
    const raw = replaceSource(input(6), content => content.replace('req.query.q', '"safe_literal"'));
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('NOT_DETECTED');
    expect(run.result.findings).toHaveLength(0);
  });

  it('fails closed with IMPORT_CYCLE when cross-file dependencies become cyclic', async () => {
    const raw = input(6);
    const files = raw.files.map(file => file.path === 'src/repository.ts'
      ? { ...file, content: "import { lookup } from './service';\n" + file.content } : file);
    const run = await analyzeInput({ ...raw, files });
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toHaveLength(0);
    expect(run.result.limitations[0].code).toBe('IMPORT_CYCLE');
  });

  it('bridges detected nested cross-file finding into FindingCandidate preserving CANDIDATE state', async () => {
    const run = await analyzeInput(input(6));
    const checkedCommit = '46db4c208f886afda939c04ae93580fbabd57344';
    const bridge = createSqlCandidateBridge(async () => checkedCommit);
    const hypotheses = await bridge(run.result, run.snapshot, run.ingestion, ORG);

    expect(hypotheses).toHaveLength(1);
    const { candidate, candidateBinding } = hypotheses[0];

    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.snapshot.commitSha).toBe(checkedCommit);
    expect(candidate.source.filePath).toBe('src/routes.ts');
    expect(candidate.sink.filePath).toBe('src/repository.ts');
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);
  });
});
