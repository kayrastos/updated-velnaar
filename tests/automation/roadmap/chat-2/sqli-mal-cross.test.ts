import { describe, expect, it, vi } from 'vitest';
import { captureSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { input, ORG } from '../../../intelligence/m3/support/inputs';

describe('cross-file malformed input defensive handling', () => {
  it('rejects malformed syntax in an imported secondary file during ingestion', async () => {
    const raw = input(6);
    const files = raw.files.map(f => f.path === 'src/repository.ts'
      ? { ...f, content: 'export function query( { broken syntax' }
      : f);
    const snapshot = await captureSnapshot({ ...raw, files }, ORG);
    await expect(ingestExpress(snapshot, ORG)).rejects.toThrow('M2_INGESTION_ERROR: malformed source unit');
  });

  it('rejects cross-file import path traversing out of root scope', async () => {
    const raw = input(6);
    const files = raw.files.map(f => f.path === 'src/routes.ts'
      ? { ...f, content: f.content.replace("'./service'", "'../service'") }
      : f);
    const snapshot = await captureSnapshot({ ...raw, files }, ORG);
    await expect(ingestExpress(snapshot, ORG)).rejects.toThrow('M2_INGESTION_ERROR: unsupported source import');
  });

  it('rejects cross-file import pointing to non-existent module file', async () => {
    const raw = input(6);
    const files = raw.files.map(f => f.path === 'src/routes.ts'
      ? { ...f, content: f.content.replace("'./service'", "'./missing_service'") }
      : f);
    const snapshot = await captureSnapshot({ ...raw, files }, ORG);
    await expect(ingestExpress(snapshot, ORG)).rejects.toThrow('M2_INGESTION_ERROR: missing or ambiguous source import');
  });

  it('rejects ambiguous import targets when both .ts and .js modules exist', async () => {
    const raw = input(6);
    const serviceTs = raw.files.find(f => f.path === 'src/service.ts')!;
    const files = [...raw.files, { path: 'src/service.js', content: serviceTs.content }];
    const snapshot = await captureSnapshot({ ...raw, files }, ORG);
    await expect(ingestExpress(snapshot, ORG)).rejects.toThrow('M2_INGESTION_ERROR: missing or ambiguous source import');
  });

  it('rejects unsupported module structure such as wildcard re-export in imported file', async () => {
    const raw = input(6);
    const files = raw.files.map(f => f.path === 'src/service.ts'
      ? { ...f, content: "export * from './repository';\n" + f.content }
      : f);
    const snapshot = await captureSnapshot({ ...raw, files }, ORG);
    await expect(ingestExpress(snapshot, ORG)).rejects.toThrow('M2_INGESTION_ERROR: unsupported module structure');
  });

  it('fails closed with IMPORT_CYCLE when cross-file modules import each other', async () => {
    const raw = input(6);
    const files = raw.files.map(f => f.path === 'src/repository.ts'
      ? { ...f, content: "import { lookup } from './service';\n" + f.content }
      : f);
    const snapshot = await captureSnapshot({ ...raw, files }, ORG);
    const ingestion = await ingestExpress(snapshot, ORG);
    const result = await detectSqlInjection(snapshot, ingestion, ORG);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('IMPORT_CYCLE');
  });

  it('fails closed with UNSUPPORTED_IMPORT for cross-file type-only import declaration', async () => {
    const raw = input(6);
    const files = raw.files.map(f => f.path === 'src/routes.ts'
      ? { ...f, content: f.content.replace("import { lookup } from './service';", "import type { lookup } from './service';") }
      : f);
    const snapshot = await captureSnapshot({ ...raw, files }, ORG);
    const ingestion = await ingestExpress(snapshot, ORG);
    const result = await detectSqlInjection(snapshot, ingestion, ORG);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('UNSUPPORTED_IMPORT');
  });

  it('fails closed with UNSUPPORTED_IMPORT when importing unexported identifier from module', async () => {
    const raw = input(6);
    const files = raw.files.map(f => f.path === 'src/routes.ts'
      ? { ...f, content: f.content.replace("import { lookup } from './service';", "import { nonExistent } from './service';") }
      : f);
    const snapshot = await captureSnapshot({ ...raw, files }, ORG);
    const ingestion = await ingestExpress(snapshot, ORG);
    const result = await detectSqlInjection(snapshot, ingestion, ORG);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('UNSUPPORTED_IMPORT');
  });

  it('fails closed with UNSUPPORTED_IMPORT when import element has type modifier', async () => {
    const raw = input(6);
    const files = raw.files.map(f => f.path === 'src/routes.ts'
      ? { ...f, content: f.content.replace("import { lookup } from './service';", "import { type lookup } from './service';") }
      : f);
    const snapshot = await captureSnapshot({ ...raw, files }, ORG);
    const ingestion = await ingestExpress(snapshot, ORG);
    const result = await detectSqlInjection(snapshot, ingestion, ORG);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('UNSUPPORTED_IMPORT');
  });

  it('fails closed with UNSUPPORTED_FUNCTION when imported module uses default export', async () => {
    const raw = input(6);
    const files = raw.files.map(f => f.path === 'src/service.ts'
      ? { ...f, content: f.content.replace('export function lookup', 'export default function lookup') }
      : f);
    const snapshot = await captureSnapshot({ ...raw, files }, ORG);
    const ingestion = await ingestExpress(snapshot, ORG);
    const result = await detectSqlInjection(snapshot, ingestion, ORG);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('UNSUPPORTED_FUNCTION');
  });

  it('fails closed with UNSUPPORTED_STATEMENT for unhandled statement forms in imported module', async () => {
    const raw = input(6);
    const files = raw.files.map(f => f.path === 'src/service.ts'
      ? { ...f, content: 'let mutableState = 1;\n' + f.content }
      : f);
    const snapshot = await captureSnapshot({ ...raw, files }, ORG);
    const ingestion = await ingestExpress(snapshot, ORG);
    const result = await detectSqlInjection(snapshot, ingestion, ORG);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('UNSUPPORTED_STATEMENT');
  });

  it('creates zero candidate hypotheses when cross-file analysis is inconclusive', async () => {
    const raw = input(6);
    const files = raw.files.map(f => f.path === 'src/repository.ts'
      ? { ...f, content: "import { lookup } from './service';\n" + f.content }
      : f);
    const snapshot = await captureSnapshot({ ...raw, files }, ORG);
    const ingestion = await ingestExpress(snapshot, ORG);
    const result = await detectSqlInjection(snapshot, ingestion, ORG);
    const verifyCommit = vi.fn();
    const bridge = createSqlCandidateBridge(verifyCommit);
    const candidates = await bridge(result, snapshot, ingestion, ORG);
    expect(candidates).toEqual([]);
    expect(verifyCommit).not.toHaveBeenCalled();
  });
});
