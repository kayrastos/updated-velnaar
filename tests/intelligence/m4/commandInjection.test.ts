import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { captureSnapshot, canonical, type SnapshotInput } from '../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress } from '../../../worker/intelligence/ingestion/express';
import {
  computeCandidateBinding,
  validateFindingCandidate,
} from '../../../worker/intelligence/contracts';
import {
  detectCommandInjection,
  validateCommandInjectionAnalysis,
  createCommandInjectionCandidateBridge,
  createCommandCandidateBridge,
  COMMAND_DETECTOR_VERSION,
  COMMAND_RULE_ID,
  COMMAND_INJECTION_DETECTOR_VERSION,
  COMMAND_INJECTION_RULE_ID,
  DETECTOR_VERSION,
  RULE_ID,
} from '../../../worker/intelligence/detection/commandInjection';

const ORG = 'org_m4_cmdi';
const VALID_COMMIT = '1234567890abcdef1234567890abcdef12345678';

function makeSnapshotInput(source: string, fixtureId = 'm2-case-001', orgId = ORG): SnapshotInput {
  return {
    fixtureId,
    repositoryId: 'repo_m4_cmdi',
    organizationId: orgId,
    files: [
      {
        path: 'src/routes.ts',
        content: source,
      },
    ],
  };
}

async function analyze(source: string, fixtureId = 'm2-case-001', orgId = ORG) {
  const input = makeSnapshotInput(source, fixtureId, orgId);
  const snapshot = await captureSnapshot(input, orgId);
  const ingestion = await ingestExpress(snapshot, orgId);
  const result = await detectCommandInjection(snapshot, ingestion, orgId);
  return { snapshot, ingestion, result };
}

describe('M4 deterministic COMMAND_INJECTION detection', () => {
  it('exposes canonical constants and compatibility aliases', () => {
    expect(COMMAND_DETECTOR_VERSION).toBe('velnar-m4-cmdi-source-v1');
    expect(COMMAND_RULE_ID).toBe('express-request-to-child-process-v1');
    expect(DETECTOR_VERSION).toBe(COMMAND_DETECTOR_VERSION);
    expect(RULE_ID).toBe(COMMAND_RULE_ID);
    expect(COMMAND_INJECTION_DETECTOR_VERSION).toBe(COMMAND_DETECTOR_VERSION);
    expect(COMMAND_INJECTION_RULE_ID).toBe(COMMAND_RULE_ID);
    expect(createCommandCandidateBridge).toBe(createCommandInjectionCandidateBridge);
  });

  it('1. detects direct child_process.exec with request query flow', async () => {
    const source = `import express from 'express';
const { exec } = require('child_process');
function route(req: any, res: any) {
  exec(req.query.cmd);
  return res.json({ ok: true });
}
export function createApp() {
  const app = express();
  app.get('/run', route);
  return app;
}`;
    const { snapshot, ingestion, result } = await analyze(source);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    expect(finding.vulnerabilityClass).toBe('COMMAND_INJECTION');
    expect(finding.source.symbol).toBe('query.cmd');
    expect(finding.sink.symbol).toBe('child_process.exec');
    expect(finding.flow[0].kind).toBe('SOURCE');
    expect(finding.flow.at(-1)!.kind).toBe('SINK');
    expect(result.version).toBe(COMMAND_DETECTOR_VERSION);
    expect(result.ruleId).toBe(COMMAND_RULE_ID);
    expect(result.snapshotId).toBe(snapshot.snapshotId);
    expect(result.ingestionIdentity).toBe(ingestion.ingestionIdentity);
  });

  it('2. detects child_process.execSync with concatenation and node:child_process provenance', async () => {
    const source = `import express from 'express';
const cp = require('node:child_process');
function route(req: any, res: any) {
  cp.execSync("sh -c " + req.query.cmd);
  return res.json({ ok: true });
}
export function createApp() {
  const app = express();
  app.get('/run', route);
  return app;
}`;
    const { result } = await analyze(source);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].sink.symbol).toBe('child_process.execSync');
    expect(result.findings[0].flow.some(s => s.kind === 'CONCAT')).toBe(true);
  });

  it('3a. propagates flow through local helper function call and argument', async () => {
    const source = `import express from 'express';
const { exec } = require('child_process');
function runCmd(c: any) {
  exec(c);
}
function route(req: any, res: any) {
  runCmd(req.query.cmd);
  return res.json({ ok: true });
}
export function createApp() {
  const app = express();
  app.get('/run', route);
  return app;
}`;
    const { result } = await analyze(source);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    const kinds = result.findings[0].flow.map(s => s.kind);
    expect(kinds).toContain('CALL');
    expect(kinds).toContain('ARGUMENT');
  });

  it('3b. propagates flow across multiple files through imported helper', async () => {
    const input: SnapshotInput = {
      fixtureId: 'm2-case-003',
      repositoryId: 'repo_m4_cmdi',
      organizationId: ORG,
      files: [
        {
          path: 'src/executor.ts',
          content: `const { exec } = require('child_process');
export function runHelper(c: string) {
  exec(c);
}
export function noopHelper(c: string) {
  return c;
}
`,
        },
        {
          path: 'src/routes.ts',
          content: `import express from 'express';
import { runHelper, noopHelper } from './executor';

function routeA(req: any, res: any) {
  const cmd = 'echo ' + req.query.cmd;
  runHelper(cmd);
  return res.json({ ok: true });
}

function routeB(req: any, res: any) {
  const cmd = 'echo ' + req.query.cmd;
  noopHelper(cmd);
  return res.json({ ok: true });
}

export function createApp() {
  const app = express();
  app.get('/a', routeA);
  app.get('/b', routeB);
  return app;
}
`,
        },
      ],
    };
    const snapshot = await captureSnapshot(input, ORG);
    const ingestion = await ingestExpress(snapshot, ORG);
    const result = await detectCommandInjection(snapshot, ingestion, ORG);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].routeIdentity).toBe(ingestion.routes[0].routeIdentity);
    const files = new Set(result.findings[0].flow.map(s => s.location.filePath));
    expect(files).toContain('src/routes.ts');
    expect(files).toContain('src/executor.ts');
  });

  it('4. negative control: safe constant command produces NOT_DETECTED', async () => {
    const source = `import express from 'express';
const { exec } = require('child_process');
function route(req: any, res: any) {
  exec('echo safe');
  return res.json({ ok: true });
}
export function createApp() {
  const app = express();
  app.get('/run', route);
  return app;
}`;
    const { result } = await analyze(source);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
  });

  it('5. sink/provenance negative control: unrelated local exec function is not a sink', async () => {
    const source = `import express from 'express';
function exec(c: any) {
  return c;
}
function route(req: any, res: any) {
  exec(req.query.cmd);
  return res.json({ ok: true });
}
export function createApp() {
  const app = express();
  app.get('/run', route);
  return app;
}`;
    const { result } = await analyze(source);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
  });

  it('6. negative control: unsupported syntax fails closed with ANALYSIS_INCONCLUSIVE', async () => {
    const source = `import express from 'express';
const { exec } = require('child_process');
function badRoute(req: any, res: any) {
  while (true) {}
  exec(req.query.cmd);
  return res.json({ ok: true });
}
export function createApp() {
  const app = express();
  app.get('/bad', badRoute);
  return app;
}`;
    const { result } = await analyze(source);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('UNSUPPORTED_STATEMENT');
  });

  it('7. tenant boundary: rejects foreign tenant at analysis and bridge boundaries', async () => {
    const source = `import express from 'express';
const { exec } = require('child_process');
function route(req: any, res: any) {
  exec(req.query.cmd);
  return res.json({ ok: true });
}
export function createApp() {
  const app = express();
  app.get('/run', route);
  return app;
}`;
    const { snapshot, ingestion, result } = await analyze(source, 'm2-case-001', ORG);
    await expect(detectCommandInjection(snapshot, ingestion, 'foreign_org')).rejects.toThrow();
    const bridge = createCommandInjectionCandidateBridge(async () => VALID_COMMIT);
    await expect(bridge(result, snapshot, ingestion, 'foreign_org')).rejects.toThrow();
  });

  it('8. snapshot boundary: rejects snapshot mismatch', async () => {
    const source = `import express from 'express';
const { exec } = require('child_process');
function route(req: any, res: any) {
  exec(req.query.cmd);
  return res.json({ ok: true });
}
export function createApp() {
  const app = express();
  app.get('/run', route);
  return app;
}`;
    const run1 = await analyze(source, 'm2-case-001');
    const run2 = await analyze(source, 'm2-case-002');
    await expect(detectCommandInjection(run1.snapshot, run2.ingestion, ORG)).rejects.toThrow('M4_ANALYSIS_SNAPSHOT_MISMATCH');
  });

  it('9. repeated analysis is deterministic and produces identical fingerprint', async () => {
    const source = `import express from 'express';
const { exec } = require('child_process');
function route(req: any, res: any) {
  exec(req.query.cmd);
  return res.json({ ok: true });
}
export function createApp() {
  const app = express();
  app.get('/run', route);
  return app;
}`;
    const run1 = await analyze(source);
    const run2 = await analyze(source);
    expect(run1.result).toEqual(run2.result);
    expect(run1.result.resultFingerprint).toBe(run2.result.resultFingerprint);

    const { resultFingerprint, ...body } = run1.result;
    const expected = 'sha256:' + createHash('sha256').update(COMMAND_DETECTOR_VERSION + '\n' + canonical(body)).digest('hex');
    expect(resultFingerprint).toBe(expected);
  });

  it('10. validateCommandInjectionAnalysis rejects tampered result fingerprint', async () => {
    const source = `import express from 'express';
const { exec } = require('child_process');
function route(req: any, res: any) {
  exec(req.query.cmd);
  return res.json({ ok: true });
}
export function createApp() {
  const app = express();
  app.get('/run', route);
  return app;
}`;
    const { snapshot, ingestion, result } = await analyze(source);
    const forged = { ...result, resultFingerprint: 'sha256:' + '0'.repeat(64) };
    await expect(validateCommandInjectionAnalysis(forged, snapshot, ingestion, ORG)).rejects.toThrow('M4_ANALYSIS_INTEGRITY_MISMATCH');
  });

  it('11 & 12. createCommandInjectionCandidateBridge binds FindingCandidate and retains CANDIDATE state', async () => {
    const source = `import express from 'express';
const { exec } = require('child_process');
function route(req: any, res: any) {
  exec(req.query.cmd);
  return res.json({ ok: true });
}
export function createApp() {
  const app = express();
  app.get('/run', route);
  return app;
}`;
    const { snapshot, ingestion, result } = await analyze(source);
    const bridge = createCommandInjectionCandidateBridge(async () => VALID_COMMIT);
    const hypotheses = await bridge(result, snapshot, ingestion, ORG);

    expect(hypotheses).toHaveLength(1);
    const { candidate, candidateBinding } = hypotheses[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.vulnerabilityClass).toBe('COMMAND_INJECTION');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.organizationId).toBe(ORG);
    expect(candidate.snapshot.commitSha).toBe(VALID_COMMIT);
    expect(candidate.source.symbol).toBe('query.cmd');
    expect(candidate.sink.symbol).toBe('child_process.exec');
    expect(candidate.sensorEvidence[0].sensorType).toBe('VELNAR_STRUCTURAL');
    expect(candidate.sensorEvidence[0].ruleId).toBe(COMMAND_RULE_ID);
    expect(candidate.sensorEvidence[0].rawEvidenceFingerprint).toBe(result.resultFingerprint);
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);
  });

  it('13. bridge does not invoke commit verifier when analysis is NOT_DETECTED or ANALYSIS_INCONCLUSIVE', async () => {
    const safeSource = `import express from 'express';
const { exec } = require('child_process');
function route(req: any, res: any) {
  exec('echo safe');
  return res.json({ ok: true });
}
export function createApp() {
  const app = express();
  app.get('/run', route);
  return app;
}`;
    const { snapshot, ingestion, result } = await analyze(safeSource);
    expect(result.status).toBe('NOT_DETECTED');
    const verifierMock = vi.fn().mockResolvedValue(VALID_COMMIT);
    const bridge = createCommandInjectionCandidateBridge(verifierMock);
    const output = await bridge(result, snapshot, ingestion, ORG);
    expect(output).toEqual([]);
    expect(verifierMock).not.toHaveBeenCalled();
  });

  it('14. createCommandInjectionCandidateBridge rejects invalid or all-zero commitSha from verifier', async () => {
    const source = `import express from 'express';
const { exec } = require('child_process');
function route(req: any, res: any) {
  exec(req.query.cmd);
  return res.json({ ok: true });
}
export function createApp() {
  const app = express();
  app.get('/run', route);
  return app;
}`;
    const { snapshot, ingestion, result } = await analyze(source);
    for (const bad of ['', 'not-a-commit', '0'.repeat(40), '0'.repeat(64)]) {
      const bridge = createCommandInjectionCandidateBridge(async () => bad);
      await expect(bridge(result, snapshot, ingestion, ORG)).rejects.toThrow('M4_CHECKED_COMMIT_REQUIRED');
    }
  });
});
