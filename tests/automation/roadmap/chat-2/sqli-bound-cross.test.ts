import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { ANALYSIS_LIMITS } from '../../../../worker/intelligence/detection/types';
import { captureSnapshot, type SnapshotInput } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress } from '../../../../worker/intelligence/ingestion/express';
import { analyzeInput, input, ORG } from '../../../intelligence/m3/support/inputs';

function modifyFile(raw: SnapshotInput, targetPath: string, transform: (content: string) => string): SnapshotInput {
  return {
    ...raw,
    files: raw.files.map(file => (file.path === targetPath ? { ...file, content: transform(file.content) } : file)),
  };
}

describe('M3 SQL injection detector cross-file boundary rejection', () => {
  let baselineRun: Awaited<ReturnType<typeof analyzeInput>>;

  beforeAll(async () => {
    baselineRun = await analyzeInput(input(6));
  });

  it('proves baseline cross-file fixture index 6 detects multi-file taint flow', () => {
    expect(baselineRun.result.status).toBe('DETECTED');
    expect(baselineRun.result.findings).toHaveLength(1);
    expect(baselineRun.result.limitations).toEqual([]);
    const finding = baselineRun.result.findings[0];
    const filePaths = [...new Set(finding.flow.map(step => step.location.filePath))];
    expect(filePaths).toEqual(['src/routes.ts', 'src/service.ts', 'src/repository.ts']);
    expect(finding.source.filePath).toBe('src/routes.ts');
    expect(finding.sink.filePath).toBe('src/repository.ts');
  });

  it('rejects cross-file cyclic local named imports with IMPORT_CYCLE limitation', async () => {
    const raw = modifyFile(input(6), 'src/repository.ts', content => "import { lookup } from './service';\n" + content);
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('IMPORT_CYCLE');
  });

  it('rejects cross-file import of unexported identifier with UNSUPPORTED_IMPORT limitation', async () => {
    const raw = modifyFile(input(6), 'src/routes.ts', content =>
      content.replace("import { lookup } from './service';", "import { lookup, nonexistentHelper } from './service';")
    );
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('UNSUPPORTED_IMPORT');
  });

  it('rejects cross-file import of non-closure export with UNSUPPORTED_IMPORT limitation', async () => {
    const rawWithExport = modifyFile(input(6), 'src/service.ts', content => "export const TABLE_CONFIG = 'items';\n" + content);
    const raw = modifyFile(rawWithExport, 'src/routes.ts', content =>
      content.replace("import { lookup } from './service';", "import { lookup, TABLE_CONFIG } from './service';")
    );
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('UNSUPPORTED_IMPORT');
  });

  it('rejects cross-file unsupported statement in helper service with UNSUPPORTED_STATEMENT limitation', async () => {
    const raw = modifyFile(input(6), 'src/service.ts', content => 'let mutableCounter = 0;\n' + content);
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('UNSUPPORTED_STATEMENT');
  });

  it('rejects cross-file call chains exceeding call depth with CALL_DEPTH limitation', async () => {
    const helperChain = Array.from(
      { length: 20 },
      (_, i) => `function f${i}(v: string) { return ${i === 19 ? 'v' : `f${i + 1}(v)`}; }`
    ).join('\n');
    const raw = modifyFile(input(6), 'src/routes.ts', source =>
      source
        .replace('function searchRoute', helperChain + '\nfunction searchRoute')
        .replace('req.query.q', 'f0(req.query.q)')
    );
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('CALL_DEPTH');
  });

  it('rejects multi-source joins across files with MULTIPLE_SOURCES limitation', async () => {
    const raw = modifyFile(input(6), 'src/routes.ts', content =>
      content.replace('req.query.q', '(req.query.q + req.query.other)')
    );
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('MULTIPLE_SOURCES');
  });

  it('returns NOT_DETECTED when cross-file helper receives safe constant argument', async () => {
    const raw = modifyFile(input(6), 'src/routes.ts', content =>
      content.replace('req.query.q', '"constant-safe-param"')
    );
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('NOT_DETECTED');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations).toEqual([]);
  });

  it('candidate bridge returns empty hypotheses and skips commit verification on inconclusive or negative cross-file results', async () => {
    const inconclusiveRaw = modifyFile(input(6), 'src/repository.ts', content => "import { lookup } from './service';\n" + content);
    const inconclusiveRun = await analyzeInput(inconclusiveRaw);
    const verify = vi.fn();
    const bridge = createSqlCandidateBridge(verify);

    const inconclusiveCandidates = await bridge(
      inconclusiveRun.result,
      inconclusiveRun.snapshot,
      inconclusiveRun.ingestion,
      ORG
    );
    expect(inconclusiveCandidates).toEqual([]);
    expect(verify).not.toHaveBeenCalled();

    const safeRaw = modifyFile(input(6), 'src/routes.ts', content =>
      content.replace('req.query.q', '"constant-safe-param"')
    );
    const safeRun = await analyzeInput(safeRaw);
    const safeCandidates = await bridge(
      safeRun.result,
      safeRun.snapshot,
      safeRun.ingestion,
      ORG
    );
    expect(safeCandidates).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  });

  it('rejects tampered cross-file findings during analysis integrity verification', async () => {
    const forged: any = structuredClone(baselineRun.result);
    forged.findings[0].source.filePath = 'src/service.ts';
    await expect(
      validateSqlAnalysis(forged, baselineRun.snapshot, baselineRun.ingestion, ORG)
    ).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
  });
});
