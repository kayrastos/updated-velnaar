import { describe, expect, it } from 'vitest';
import { captureSnapshot, type SnapshotInput } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress } from '../../../../worker/intelligence/ingestion/express';
import { detectCommandInjection } from '../../../../worker/intelligence/detection/commandInjection';

const ORG = 'org_cmdi_mal_dir';

function createDirectInput(handlerBody: string): SnapshotInput {
  return {
    fixtureId: 'm2-case-001',
    repositoryId: 'repo_cmdi_mal_dir',
    organizationId: ORG,
    files: [
      {
        path: 'src/routes.ts',
        content: `import express from 'express';

function cmdRoute(req: any, res: any) {
  ${handlerBody}
}

export function createApp() {
  const app = express();
  app.get('/run', cmdRoute);
  return app;
}
`,
      },
    ],
  };
}

async function analyzeDirect(handlerBody: string) {
  const raw = createDirectInput(handlerBody);
  const snapshot = await captureSnapshot(raw, ORG);
  const ingestion = await ingestExpress(snapshot, ORG);
  const result = await detectCommandInjection(snapshot, ingestion, ORG);
  return { snapshot, ingestion, result };
}

describe('command-injection-detector: malformed input direct', () => {
  it.each([
    ['while loop', 'while (true) {}'],
    ['non-const declaration', 'let cmd = req.query.cmd;'],
    ['computed property access', 'const cmd = req.query["cmd"];'],
    ['template literal with substitution', 'const cmd = `${req.query.cmd}`;'],
  ])('unsupported direct syntax fails closed to ANALYSIS_INCONCLUSIVE: %s', async (_label, body) => {
    const { result } = await analyzeDirect(body);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations.length).toBeGreaterThanOrEqual(1);
  });

  it('fails closed on multiple tainted sources join in direct flow', async () => {
    const { result } = await analyzeDirect('const cmd = req.query.a + req.query.b;');
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations.some(l => l.code === 'MULTIPLE_SOURCES')).toBe(true);
  });

  it('bounds direct recursive call cycles with CALL_CYCLE', async () => {
    const { result } = await analyzeDirect('return cmdRoute(req, res);');
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations.some(l => l.code === 'CALL_CYCLE')).toBe(true);
  });

  it('safe direct flow without command sink produces NOT_DETECTED', async () => {
    const { result, snapshot } = await analyzeDirect('const cmd = req.query.cmd;');
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
    expect(result.snapshotId).toBe(snapshot.snapshotId);
    expect(result.organizationId).toBe(ORG);
  });

  it('rejects foreign tenant at the detector boundary', async () => {
    const { snapshot, ingestion } = await analyzeDirect('const cmd = req.query.cmd;');
    await expect(detectCommandInjection(snapshot, ingestion, 'foreign_tenant')).rejects.toThrow();
  });

  it('rejects mismatched snapshot and ingestion identities', async () => {
    const { ingestion } = await analyzeDirect('const cmd = req.query.cmd;');
    const otherRaw = { ...createDirectInput('const cmd = req.query.cmd;'), fixtureId: 'm2-case-002' };
    const otherSnapshot = await captureSnapshot(otherRaw, ORG);
    await expect(detectCommandInjection(otherSnapshot, ingestion, ORG)).rejects.toThrow();
  });

  it('rejects execution/oracle metadata on snapshot at detector boundary', async () => {
    const { snapshot, ingestion } = await analyzeDirect('const cmd = req.query.cmd;');
    await expect(detectCommandInjection({ ...snapshot, violationObserved: true } as any, ingestion, ORG)).rejects.toThrow();
  });
});
