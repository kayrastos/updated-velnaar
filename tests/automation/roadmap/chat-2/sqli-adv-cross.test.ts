import { describe, expect, it } from 'vitest';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { computeCandidateBinding, validateFindingCandidate } from '../../../../worker/intelligence/contracts';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

const DUMMY_COMMIT = '1111111111111111111111111111111111111111';

describe('V1 discovery intelligence: SQL injection detector cross-file adversarial edge cases', () => {
  it('retains source, service, and repository provenance across files for detected SQL injection', async () => {
    const run = await analyzeInput(input(6));
    expect(run.result.status).toBe('DETECTED');
    expect(run.result.findings).toHaveLength(1);
    expect(run.result.limitations).toHaveLength(0);

    const finding = run.result.findings[0];
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.source.filePath).toBe('src/routes.ts');
    expect(finding.sink.filePath).toBe('src/repository.ts');
    expect(finding.sink.symbol).toBe('db.prepare');

    const filePaths = [...new Set(finding.flow.map(step => step.location.filePath))];
    expect(filePaths).toEqual(['src/routes.ts', 'src/service.ts', 'src/repository.ts']);
    expect(finding.flow[0].kind).toBe('SOURCE');
    expect(finding.flow.at(-1)!.kind).toBe('SINK');
  });

  it('safe negative control: replacing request source with safe constant produces NOT_DETECTED with no findings', async () => {
    const safeRaw = replaceSource(input(6), content => content.replace(/req\.query\.q/g, '"safe_literal"'));
    const run = await analyzeInput(safeRaw);
    expect(run.result.status).toBe('NOT_DETECTED');
    expect(run.result.findings).toHaveLength(0);
    expect(run.result.limitations).toHaveLength(0);
  });

  it('fails closed with IMPORT_CYCLE limitation on cyclic cross-file module dependencies', async () => {
    const raw = input(6);
    const files = raw.files.map(file => file.path === 'src/repository.ts'
      ? { ...file, content: "import { lookup } from './service';\n" + file.content }
      : file);
    const run = await analyzeInput({ ...raw, files });
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toHaveLength(0);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('IMPORT_CYCLE');
  });

  it('fails closed with UNSUPPORTED_IMPORT limitation when importing unexported symbol across files', async () => {
    const raw = input(6);
    const files = raw.files.map(file => file.path === 'src/service.ts'
      ? { ...file, content: file.content.replace('function lookup', 'function unexportedLookup') }
      : file);
    const run = await analyzeInput({ ...raw, files });
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toHaveLength(0);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('UNSUPPORTED_IMPORT');
  });

  it('fails closed with MULTIPLE_SOURCES limitation when joining multiple sources across files', async () => {
    const raw = replaceSource(input(6), content => content.replace('req.query.q', '(req.query.q + req.query.other)'));
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toHaveLength(0);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('MULTIPLE_SOURCES');
  });

  it('candidate bridge creates valid CANDIDATE hypothesis preserving tenant and commit binding for cross-file flow', async () => {
    const baseline = await analyzeInput(input(6));
    const bridge = createSqlCandidateBridge(async () => DUMMY_COMMIT);
    const hypotheses = await bridge(baseline.result, baseline.snapshot, baseline.ingestion, ORG);

    expect(hypotheses).toHaveLength(1);
    const { candidate, candidateBinding } = hypotheses[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.organizationId).toBe(ORG);
    expect(candidate.snapshot.commitSha).toBe(DUMMY_COMMIT);
    expect(candidate.source.filePath).toBe('src/routes.ts');
    expect(candidate.sink.filePath).toBe('src/repository.ts');
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);

    const safeRaw = replaceSource(input(6), content => content.replace(/req\.query\.q/g, '"safe"'));
    const safeRun = await analyzeInput(safeRaw);
    const safeHypotheses = await bridge(safeRun.result, safeRun.snapshot, safeRun.ingestion, ORG);
    expect(safeHypotheses).toEqual([]);
  });

  it('validateSqlAnalysis rejects tampering of cross-file finding paths', async () => {
    const baseline = await analyzeInput(input(6));
    const forged = structuredClone(baseline.result) as any;
    forged.findings[0].sink.filePath = 'src/service.ts';
    await expect(validateSqlAnalysis(forged, baseline.snapshot, baseline.ingestion, ORG))
      .rejects.toThrow('M3_ANALYSIS_INTEGRITY');
  });

  it('rejects foreign tenant requests at detector boundary', async () => {
    const baseline = await analyzeInput(input(6));
    await expect(detectSqlInjection(baseline.snapshot, baseline.ingestion, 'foreign_org'))
      .rejects.toThrow('tenant mismatch');
  });
});
