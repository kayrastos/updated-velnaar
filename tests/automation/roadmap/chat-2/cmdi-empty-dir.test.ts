import { describe, expect, it } from 'vitest';
import { captureSnapshot, type SnapshotInput } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress } from '../../../../worker/intelligence/ingestion/express';
import { detectCommandInjection } from '../../../../worker/intelligence/detection/commandInjection';

const ORG = 'org_cmdi_empty';

async function analyze(content: string) {
  const raw: SnapshotInput = {
    fixtureId: 'm2-case-001',
    repositoryId: 'repo-cmdi-empty',
    organizationId: ORG,
    files: [{ path: 'src/routes.ts', content }],
  };
  const snapshot = await captureSnapshot(raw, ORG);
  const ingestion = await ingestExpress(snapshot, ORG);
  const result = await detectCommandInjection(snapshot, ingestion, ORG);
  return { snapshot, ingestion, result };
}

function makeRoute(body: string, header = "const { exec } = require('child_process');") {
  return `import express from 'express';
${header}

export function createApp() {
  const app = express();
  app.get('/run', runRoute);
  function runRoute(req: any, res: any) {
    ${body}
    return;
  }
  return app;
}
`;
}

describe('command injection detector: null-empty boundary (direct)', () => {
  it('treats empty string constant as safe negative control', async () => {
    const { result } = await analyze(makeRoute("exec('');"));
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toEqual([]);
  });

  it('treats pure whitespace constant as safe negative control', async () => {
    const { result } = await analyze(makeRoute("exec('   ');"));
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toEqual([]);
  });

  it('detects tainted command with empty string prefix concatenation', async () => {
    const { ingestion, result } = await analyze(makeRoute("exec('' + req.query.cmd);"));
    expect(result.status).toBe('DETECTED');
    expect(result.limitations).toEqual([]);
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    expect(finding.vulnerabilityClass).toBe('COMMAND_INJECTION');
    expect(finding.routeIdentity).toBe(ingestion.routes[0].routeIdentity);
    expect(finding.source.filePath).toBe('src/routes.ts');
    expect(finding.sink.filePath).toBe('src/routes.ts');
    expect(finding.flow[0].kind).toBe('SOURCE');
    expect(finding.flow.at(-1)!.kind).toBe('SINK');
  });

  it('detects tainted command with empty string suffix concatenation', async () => {
    const { ingestion, result } = await analyze(makeRoute("exec(req.query.cmd + '');"));
    expect(result.status).toBe('DETECTED');
    expect(result.limitations).toEqual([]);
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    expect(finding.vulnerabilityClass).toBe('COMMAND_INJECTION');
    expect(finding.routeIdentity).toBe(ingestion.routes[0].routeIdentity);
    expect(finding.flow[0].kind).toBe('SOURCE');
    expect(finding.flow.at(-1)!.kind).toBe('SINK');
  });

  it('treats concatenated empty constants as safe negative control', async () => {
    const { result } = await analyze(makeRoute("exec('' + '');"));
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toEqual([]);
  });

  it('treats safe constant alias as negative control', async () => {
    const { result } = await analyze(makeRoute("const cmd = ''; exec(cmd);"));
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toEqual([]);
  });

  it('detects direct unconcatenated tainted command', async () => {
    const { ingestion, result } = await analyze(makeRoute('exec(req.query.cmd);'));
    expect(result.status).toBe('DETECTED');
    expect(result.limitations).toEqual([]);
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    expect(finding.vulnerabilityClass).toBe('COMMAND_INJECTION');
    expect(finding.routeIdentity).toBe(ingestion.routes[0].routeIdentity);
  });

  it('treats unrelated local exec function as negative control without sink authority', async () => {
    const localExec = 'function exec(cmd: string) { return cmd; }';
    const { result } = await analyze(makeRoute('exec(req.query.cmd);', localExec));
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toEqual([]);
  });

  it('detects tainted command flow with execSync and empty boundary', async () => {
    const syncHeader = "const { execSync } = require('child_process');";
    const { ingestion, result } = await analyze(makeRoute("execSync('' + req.query.cmd);", syncHeader));
    expect(result.status).toBe('DETECTED');
    expect(result.limitations).toEqual([]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].vulnerabilityClass).toBe('COMMAND_INJECTION');
    expect(result.findings[0].routeIdentity).toBe(ingestion.routes[0].routeIdentity);
  });
});
