import { describe, expect, it } from 'vitest';
import { captureSnapshot, type SnapshotInput } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress } from '../../../../worker/intelligence/ingestion/express';
import { detectCommandInjection } from '../../../../worker/intelligence/detection/commandInjection';

const ORG = 'org_cmdi_neg_multi';

async function analyze(files: { path: string; content: string }[], fixtureId = 'm2-case-001') {
  const raw: SnapshotInput = {
    fixtureId,
    repositoryId: 'repo-cmdi-multi',
    organizationId: ORG,
    files,
  };
  const snapshot = await captureSnapshot(raw, ORG);
  const ingestion = await ingestExpress(snapshot, ORG);
  return detectCommandInjection(snapshot, ingestion, ORG);
}

function singleRoute(body: string, helper = '') {
  return `import express from 'express';
${helper}
function searchRoute(req: any, res: any) {
${body}
}

export function createApp() {
  const app = express();
  app.get('/api/search', searchRoute);
  return app;
}
`;
}

describe('command injection detector: multi-stage negative controls', () => {
  it('multi-stage constant concatenation produces NOT_DETECTED with zero findings', async () => {
    const helper = `function exec(cmd: string) {
  return cmd;
}`;
    const body = `  const stage1 = 'echo';
  const stage2 = stage1 + ' stage2';
  const stage3 = stage2 + ' stage3';
  exec(stage3);`;
    const result = await analyze([{ path: 'src/routes.ts', content: singleRoute(body, helper) }]);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toHaveLength(0);
  });

  it('multi-stage pipeline with decoupled request query produces NOT_DETECTED', async () => {
    const helper = `function exec(cmd: string) {
  return cmd;
}`;
    const body = `  const untrusted = req.query.command;
  const stage1 = 'date';
  const stage2 = stage1 + ' -u';
  const stage3 = stage2 + ' --utc';
  exec(stage3);`;
    const result = await analyze([{ path: 'src/routes.ts', content: singleRoute(body, helper) }]);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toHaveLength(0);
  });

  it('multi-stage helper function chain with safe literals produces NOT_DETECTED', async () => {
    const helper = `function exec(cmd: string) {
  return cmd;
}
function stageOne(prefix: string) {
  return prefix + ' step1';
}
function stageTwo(base: string) {
  return stageOne(base) + ' step2';
}`;
    const body = `  const command = stageTwo('init');
  exec(command);`;
    const result = await analyze([{ path: 'src/routes.ts', content: singleRoute(body, helper) }]);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toHaveLength(0);
  });

  it('multi-stage tainted flow to unrelated local exec function does not create sink authority', async () => {
    const helper = `function exec(cmd: string) {
  return cmd;
}`;
    const body = `  const stage1 = req.query.arg;
  const stage2 = 'run ' + stage1;
  const stage3 = stage2 + ' --verbose';
  exec(stage3);`;
    const result = await analyze([{ path: 'src/routes.ts', content: singleRoute(body, helper) }]);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toHaveLength(0);
  });

  it('multi-stage tainted flow to unrelated local execSync function does not create sink authority', async () => {
    const helper = `function execSync(cmd: string) {
  return cmd;
}`;
    const body = `  const p1 = req.query.input;
  const p2 = 'process ' + p1;
  const p3 = p2 + ' --flag';
  execSync(p3);`;
    const result = await analyze([{ path: 'src/routes.ts', content: singleRoute(body, helper) }]);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toHaveLength(0);
  });

  it('multi-stage cross-file helper pipeline with safe constants produces NOT_DETECTED', async () => {
    const serviceContent = `export function buildCommand(action: string) {
  return 'bin/' + action;
}
export function formatFlags(base: string) {
  return base + ' --quiet';
}
`;
    const routesContent = `import express from 'express';
import { buildCommand, formatFlags } from './service';

function exec(cmd: string) {
  return cmd;
}

function searchRoute(req: any, res: any) {
  const stage1 = buildCommand('check');
  const stage2 = formatFlags(stage1);
  exec(stage2);
}

export function createApp() {
  const app = express();
  app.get('/api/search', searchRoute);
  return app;
}
`;
    const result = await analyze([
      { path: 'src/service.ts', content: serviceContent },
      { path: 'src/routes.ts', content: routesContent },
    ]);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toHaveLength(0);
  });
});
