import { describe, expect, it } from 'vitest';
import { parseUnit, ingestExpress } from '../../../worker/intelligence/ingestion/express';
import { captureSnapshot } from '../../../worker/intelligence/ingestion/snapshot';
import { createSqlCandidateBridge } from '../../../worker/intelligence/detection/candidate';
import { analyzeInput, input, replaceSource, ORG } from '../m3/support/inputs';

describe('M4 discovery partial parse fail-closed behavior', () => {
  it.each([
    ['unclosed function block', 'function incomplete(q: string) { return q;'],
    ['unclosed brace in handler', 'export function searchRoute(req: any, res: any) {\n  const q = req.query.q;'],
    ['unterminated string literal', 'const badString = "unterminated;'],
    ['unterminated template literal', 'const badTpl = `SELECT * FROM users WHERE id = ;'],
    ['dangling binary operator', 'const incompleteExpr = "prefix" + ;'],
    ['dangling property access', 'const partialAccess = req.query.;'],
    ['missing closing parenthesis', 'const grouped = ("hello" + "world";'],
    ['unexpected token / malformed declaration', 'const = 123;'],
  ])('rejects %s with malformed source unit error in parseUnit', (_label, syntax) => {
    expect(() => parseUnit('src/partial.ts', syntax)).toThrow('M2_INGESTION_ERROR: malformed source unit');
  });

  it.each([
    ['unclosed block in routes', (source: string) => source + '\nfunction unclosed() {'],
    ['unterminated string literal', (source: string) => source + '\nconst badString = "unterminated;'],
    ['incomplete statement', (source: string) => source.replace('return res.json', 'const x = ; return res.json')],
    ['dangling parameter declaration', (source: string) => source + '\nexport function dangling('],
  ])('fails closed during ingestion when source has %s', async (_label, mutation) => {
    const raw = replaceSource(input(), mutation);
    const snapshot = await captureSnapshot(raw, ORG);
    expect(snapshot.files.length).toBeGreaterThan(0);
    await expect(ingestExpress(snapshot, ORG)).rejects.toThrow('M2_INGESTION_ERROR: malformed source unit');
  });

  it('fails closed at the discovery pipeline boundary and produces no findings', async () => {
    const broken = replaceSource(input(), source => source + '\nfunction broken( {');
    await expect(analyzeInput(broken)).rejects.toThrow('M2_INGESTION_ERROR: malformed source unit');
  });

  it('captures raw snapshot bytes without executing or parsing invalid syntax', async () => {
    const raw = replaceSource(input(), source => source + '\nconst syntaxError = ;');
    const snapshot = await captureSnapshot(raw, ORG);
    expect(snapshot.snapshotId).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(snapshot.files.find(f => f.path === 'src/routes.ts')?.content).toContain('const syntaxError = ;');
    await expect(ingestExpress(snapshot, ORG)).rejects.toThrow('malformed source unit');
  });

  it('candidate bridge rejects forged ingestion with partial parse snapshot', async () => {
    const raw = replaceSource(input(), source => source + '\nfunction incomplete() {');
    const snapshot = await captureSnapshot(raw, ORG);
    const fakeIngestion = {
      version: 'velnar-express-ingestion-v1',
      snapshot,
      sourceUnits: [],
      routes: [],
      ingestionIdentity: 'sha256:' + '0'.repeat(64),
    };
    const bridge = createSqlCandidateBridge(async () => 'a'.repeat(40));
    await expect(bridge({} as any, snapshot, fakeIngestion as any, ORG)).rejects.toThrow('malformed source unit');
  });
});
