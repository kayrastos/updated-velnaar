import { describe, expect, it, vi } from 'vitest';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import type { SnapshotInput } from '../../../../worker/intelligence/ingestion/snapshot';
import { analyzeInput, input, ORG } from '../../../intelligence/m3/support/inputs';

function replaceFile(raw: SnapshotInput, targetPath: string, change: (content: string) => string): SnapshotInput {
  return {
    ...raw,
    files: raw.files.map(file => (file.path === targetPath ? { ...file, content: change(file.content) } : file)),
  };
}

describe('roadmap chat-2: cross-file SQL injection negative controls', () => {
  it('demonstrates baseline cross-file fixture detects tainted SQL flow before controls', async () => {
    const { result } = await analyzeInput(input(6));
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].source.filePath).toBe('src/routes.ts');
    expect(result.findings[0].sink.filePath).toBe('src/repository.ts');
  });

  it('cross-file flow with safe route constant yields NOT_DETECTED and no candidates', async () => {
    const raw = replaceFile(input(6), 'src/routes.ts', content =>
      content.replace('req.query.q', '"safe_constant_value"')
    );
    const { result, snapshot, ingestion } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toHaveLength(0);

    const verify = vi.fn(async () => 'a'.repeat(40));
    const bridge = createSqlCandidateBridge(verify);
    const candidates = await bridge(result, snapshot, ingestion, ORG);
    expect(candidates).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  });

  it('cross-file flow with static query in repository yields NOT_DETECTED and no candidates', async () => {
    const raw = replaceFile(input(6), 'src/repository.ts', content =>
      content.replace(/db\.prepare\([^)]+\)/, 'db.prepare("SELECT id, name FROM items")')
    );
    const { result, snapshot, ingestion } = await analyzeInput(raw);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toHaveLength(0);

    const verify = vi.fn(async () => 'a'.repeat(40));
    const bridge = createSqlCandidateBridge(verify);
    const candidates = await bridge(result, snapshot, ingestion, ORG);
    expect(candidates).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  });
});
