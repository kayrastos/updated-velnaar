import { describe, expect, it } from 'vitest';
import { analyzeInput, input, ORG } from '../../../intelligence/m3/support/inputs';
import { type SnapshotInput } from '../../../../worker/intelligence/ingestion/snapshot';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { computeCandidateBinding } from '../../../../worker/intelligence/contracts';

function replaceFile(raw: SnapshotInput, filePath: string, update: (content: string) => string): SnapshotInput {
  return {
    ...raw,
    files: raw.files.map(file => file.path === filePath ? { ...file, content: update(file.content) } : file),
  };
}

describe('V1 discovery intelligence: SQL injection detector case sensitivity cross-file', () => {
  it('detects cross-file SQL injection across routes, service, and repository layers', async () => {
    const run = await analyzeInput(input(6));
    expect(run.result.status).toBe('DETECTED');
    expect(run.result.limitations).toEqual([]);
    expect(run.result.findings).toHaveLength(1);
    const finding = run.result.findings[0];
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.source.filePath).toBe('src/routes.ts');
    expect(finding.sink.filePath).toBe('src/repository.ts');
    expect(finding.sink.symbol).toBe('db.prepare');
    expect([...new Set(finding.flow.map(step => step.location.filePath))]).toEqual([
      'src/routes.ts',
      'src/service.ts',
      'src/repository.ts',
    ]);
  });

  it('detects cross-file SQL injection regardless of SQL keyword casing in repository query', async () => {
    const base = input(6);
    for (const transform of [
      (s: string) => s.replace(/SELECT/gi, 'select').replace(/FROM/gi, 'from').replace(/WHERE/gi, 'where'),
      (s: string) => s.replace(/SELECT/gi, 'SELECT').replace(/FROM/gi, 'FROM').replace(/WHERE/gi, 'WHERE'),
      (s: string) => s.replace(/SELECT/gi, 'SeLeCt').replace(/FROM/gi, 'FrOm').replace(/WHERE/gi, 'WhErE'),
    ]) {
      const raw = replaceFile(base, 'src/repository.ts', transform);
      const run = await analyzeInput(raw);
      expect(run.result.status).toBe('DETECTED');
      expect(run.result.findings).toHaveLength(1);
      const finding = run.result.findings[0];
      expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
      expect(finding.source.filePath).toBe('src/routes.ts');
      expect(finding.sink.filePath).toBe('src/repository.ts');
      expect(finding.sink.symbol).toBe('db.prepare');
    }
  });

  it('preserves request query parameter case sensitivity in source symbol across files', async () => {
    const base = input(6);
    const raw = replaceFile(base, 'src/routes.ts', content => content.replace('req.query.q', 'req.query.Q'));
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('DETECTED');
    expect(run.result.findings).toHaveLength(1);
    const finding = run.result.findings[0];
    expect(finding.source.symbol).toBe('query.Q');
    expect(finding.source.filePath).toBe('src/routes.ts');
    expect(finding.sink.filePath).toBe('src/repository.ts');
    expect(finding.sink.symbol).toBe('db.prepare');
  });

  it('fails closed when cross-file imported helper symbol casing is mismatched', async () => {
    const base = input(6);
    const raw = replaceFile(base, 'src/routes.ts', content => content.replace('import { lookup }', 'import { Lookup }'));
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('UNSUPPORTED_IMPORT');
  });

  it('fails closed when cross-file helper call symbol casing is unbound', async () => {
    const base = input(6);
    const raw = replaceFile(base, 'src/routes.ts', content => content.replace(/lookup\s*\(/g, 'Lookup('));
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('UNBOUND_NAME');
  });

  it('rejects cross-file import specifier case mismatch at ingestion boundary', async () => {
    const base = input(6);
    const raw = replaceFile(base, 'src/routes.ts', content => content.replace("from './service'", "from './Service'"));
    await expect(analyzeInput(raw)).rejects.toThrow('missing or ambiguous source import');
  });

  it('bridges verified cross-file candidate maintaining CANDIDATE verification state and binding', async () => {
    const run = await analyzeInput(input(6));
    const commitSha = '46db4c208f886afda939c04ae93580fbabd57344';
    const bridge = createSqlCandidateBridge(async () => commitSha);
    const hypotheses = await bridge(run.result, run.snapshot, run.ingestion, ORG);
    expect(hypotheses).toHaveLength(1);
    const { candidate, candidateBinding } = hypotheses[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.snapshot.commitSha).toBe(commitSha);
    expect(candidate.organizationId).toBe(ORG);
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
  });
});
