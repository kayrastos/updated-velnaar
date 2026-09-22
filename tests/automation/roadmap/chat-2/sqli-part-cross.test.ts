import { describe, expect, it } from 'vitest';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { type SnapshotInput } from '../../../../worker/intelligence/ingestion/snapshot';
import { analyzeInput, input, ORG } from '../../../intelligence/m3/support/inputs';

const dummyCommit = 'a'.repeat(40);
const bridge = createSqlCandidateBridge(async () => dummyCommit);

function mutateFile(raw: SnapshotInput, targetPath: string, transform: (content: string) => string): SnapshotInput {
  return { ...raw, files: raw.files.map(file => file.path === targetPath ? { ...file, content: transform(file.content) } : file) };
}

function removeFile(raw: SnapshotInput, targetPath: string): SnapshotInput {
  return { ...raw, files: raw.files.filter(file => file.path !== targetPath) };
}

describe('V1 roadmap chat-2: SQL injection partial-input fail-closed cross-file detection', () => {
  it('baseline cross-file fixture input(6) is cleanly DETECTED across all module layers', async () => {
    const run = await analyzeInput(input(6));
    expect(run.result.status).toBe('DETECTED');
    expect(run.result.limitations).toEqual([]);
    expect(run.result.findings).toHaveLength(1);

    const finding = run.result.findings[0];
    const touchedFiles = [...new Set(finding.flow.map(step => step.location.filePath))];
    expect(touchedFiles).toEqual(['src/routes.ts', 'src/service.ts', 'src/repository.ts']);
    expect(finding.source.filePath).toBe('src/routes.ts');
    expect(finding.sink.filePath).toBe('src/repository.ts');

    const hypotheses = await bridge(run.result, run.snapshot, run.ingestion, ORG);
    expect(hypotheses).toHaveLength(1);
    expect(hypotheses[0].candidate.verificationState).toBe('CANDIDATE');
  });

  it('fails closed when an imported cross-file dependency is missing from the snapshot', async () => {
    const partialRaw = removeFile(input(6), 'src/repository.ts');
    await expect(analyzeInput(partialRaw)).rejects.toThrow('missing or ambiguous source import');
  });

  it('fails closed with inconclusive analysis when imported service contains unsupported syntax', async () => {
    const partialRaw = mutateFile(input(6), 'src/service.ts', content => content + '\nwhile (true) {}\n');
    const run = await analyzeInput(partialRaw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations.some(lim => lim.code === 'UNSUPPORTED_STATEMENT')).toBe(true);

    const hypotheses = await bridge(run.result, run.snapshot, run.ingestion, ORG);
    expect(hypotheses).toEqual([]);
  });

  it('fails closed with inconclusive analysis when repository sink module contains unsupported syntax', async () => {
    const partialRaw = mutateFile(input(6), 'src/repository.ts', content => content + '\nwhile (true) {}\n');
    const run = await analyzeInput(partialRaw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations.some(lim => lim.code === 'UNSUPPORTED_STATEMENT')).toBe(true);

    const hypotheses = await bridge(run.result, run.snapshot, run.ingestion, ORG);
    expect(hypotheses).toEqual([]);
  });

  it('fails closed when cross-file module has cyclic imports', async () => {
    const partialRaw = mutateFile(input(6), 'src/repository.ts', content => "import { lookup } from './service';\n" + content);
    const run = await analyzeInput(partialRaw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations[0].code).toBe('IMPORT_CYCLE');

    const hypotheses = await bridge(run.result, run.snapshot, run.ingestion, ORG);
    expect(hypotheses).toEqual([]);
  });

  it('fails closed when imported symbol cannot be resolved from dependency exports', async () => {
    const partialRaw = mutateFile(input(6), 'src/service.ts', content => "import { nonexistent } from './repository';\n" + content);
    const run = await analyzeInput(partialRaw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations[0].code).toBe('UNSUPPORTED_IMPORT');

    const hypotheses = await bridge(run.result, run.snapshot, run.ingestion, ORG);
    expect(hypotheses).toEqual([]);
  });

  it('does not retain partial findings when later reachable cross-file syntax fails closed', async () => {
    const partialRaw = mutateFile(input(6), 'src/repository.ts', content =>
      content.replace('return db.prepare', 'const res = db.prepare')
        .replace(".all();", ".all(); while (true) {} return res;"));
    const run = await analyzeInput(partialRaw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);

    const hypotheses = await bridge(run.result, run.snapshot, run.ingestion, ORG);
    expect(hypotheses).toEqual([]);
  });
});
