import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { captureSnapshot, canonical, type SnapshotInput } from '../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress } from '../../../worker/intelligence/ingestion/express';
import { validateFindingCandidate, computeCandidateBinding } from '../../../worker/intelligence/contracts';
import {
  detectPathTraversal,
  validatePathTraversalAnalysis,
  createPathTraversalCandidateBridge,
  PATH_TRAVERSAL_DETECTOR_VERSION,
  PATH_TRAVERSAL_RULE_ID,
  DETECTOR_VERSION,
  RULE_ID,
} from '../../../worker/intelligence/detection/pathTraversal';

const ORG = 'org_m4_pt';
const VALID_COMMIT = 'a'.repeat(40);

function makeInput(sourceContent: string, fixtureId = 'm2-case-001', orgId = ORG): SnapshotInput {
  return {
    fixtureId,
    repositoryId: 'repo_pt',
    organizationId: orgId,
    files: [{ path: 'src/routes.ts', content: sourceContent }],
  };
}

async function analyze(sourceContent: string, fixtureId = 'm2-case-001', orgId = ORG) {
  const input = makeInput(sourceContent, fixtureId, orgId);
  const snapshot = await captureSnapshot(input, orgId);
  const ingestion = await ingestExpress(snapshot, orgId);
  const result = await detectPathTraversal(snapshot, ingestion, orgId);
  return { snapshot, ingestion, result };
}

describe('M4 PATH_TRAVERSAL discovery foundation', () => {
  it('exposes canonical constants and compatibility aliases', () => {
    expect(PATH_TRAVERSAL_DETECTOR_VERSION).toBe('velnar-m4-path-traversal-source-v1');
    expect(PATH_TRAVERSAL_RULE_ID).toBe('express-request-to-path-traversal-v1');
    expect(DETECTOR_VERSION).toBe(PATH_TRAVERSAL_DETECTOR_VERSION);
    expect(RULE_ID).toBe(PATH_TRAVERSAL_RULE_ID);
  });

  it('1. detects direct request query flow to res.sendFile sink', async () => {
    const code = `import express from 'express';
function sendFileRoute(req: any, res: any) {
  const filePath = req.query.file;
  res.sendFile(filePath);
}
export function createApp() {
  const app = express();
  app.get('/file', sendFileRoute);
  return app;
}
`;
    const { snapshot, ingestion, result } = await analyze(code);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    expect(finding.vulnerabilityClass).toBe('PATH_TRAVERSAL');
    expect(finding.source.symbol).toBe('query.file');
    expect(finding.sink.symbol).toBe('res.sendFile');
    expect(finding.flow[0].kind).toBe('SOURCE');
    expect(finding.flow.at(-1)!.kind).toBe('SINK');
    expect(finding.flow.some(s => s.kind === 'VARIABLE')).toBe(true);
    expect(result.version).toBe(PATH_TRAVERSAL_DETECTOR_VERSION);
    expect(result.ruleId).toBe(PATH_TRAVERSAL_RULE_ID);
    expect(result.snapshotId).toBe(snapshot.snapshotId);
    expect(result.ingestionIdentity).toBe(ingestion.ingestionIdentity);
  });

  it('2. secondary positive form: req.params source and concatenation flow into fs.readFileSync', async () => {
    const code = `import express from 'express';
const fs = require('fs');
function readRoute(req: any, res: any) {
  const filePath = '/var/data/' + req.params.fileName;
  fs.readFileSync(filePath);
  res.end();
}
export function createApp() {
  const app = express();
  app.get('/read', readRoute);
  return app;
}
`;
    const { result } = await analyze(code);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    expect(finding.source.symbol).toBe('params.fileName');
    expect(finding.sink.symbol).toBe('fs.readFileSync');
    expect(finding.flow.some(s => s.kind === 'CONCAT')).toBe(true);
  });

  it('3. helper propagation, alias chains, and path.join', async () => {
    const code = `import express from 'express';
const path = require('path');
const fs = require('fs');
function resolveUserPath(p: any) {
  const alias = p;
  return path.join('/base', alias);
}
function readRoute(req: any, res: any) {
  const userPath = req.query.path;
  const full = resolveUserPath(userPath);
  fs.readFileSync(full);
  res.end();
}
export function createApp() {
  const app = express();
  app.get('/read', readRoute);
  return app;
}
`;
    const { result } = await analyze(code);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    const kinds = result.findings[0].flow.map(s => s.kind);
    expect(kinds).toContain('CALL');
    expect(kinds).toContain('ARGUMENT');
    expect(kinds).toContain('VARIABLE');
  });

  it('4. negative control: safe constant path produces NOT_DETECTED', async () => {
    const code = `import express from 'express';
function safeRoute(req: any, res: any) {
  const fixed = 'safe.txt';
  res.sendFile(fixed);
}
export function createApp() {
  const app = express();
  app.get('/safe', safeRoute);
  return app;
}
`;
    const { result } = await analyze(code);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
  });

  it('5. sink/provenance negative control: disconnected taint does not reach sink', async () => {
    const code = `import express from 'express';
function handler(req: any, res: any) {
  const tainted = req.query.file;
  const safe = 'constants/index.html';
  res.sendFile(safe);
}
export function createApp() {
  const app = express();
  app.get('/page', handler);
  return app;
}
`;
    const { result } = await analyze(code);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
  });

  it('6. negative control: unsupported syntax fails closed with ANALYSIS_INCONCLUSIVE', async () => {
    const code = `import express from 'express';
function badRoute(req: any, res: any) {
  while (true) {}
  res.sendFile(req.query.file);
}
export function createApp() {
  const app = express();
  app.get('/bad', badRoute);
  return app;
}
`;
    const { result } = await analyze(code);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('UNSUPPORTED_STATEMENT');
  });

  it('bounds recursive CALL_CYCLE with fail-closed limitation', async () => {
    const code = `import express from 'express';
function recurse(x: any): any {
  return recurse(x);
}
function loopRoute(req: any, res: any) {
  recurse(req.query.x);
  res.end();
}
export function createApp() {
  const app = express();
  app.get('/loop', loopRoute);
  return app;
}
`;
    const { result } = await analyze(code);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('CALL_CYCLE');
  });

  it('7. tenant boundary: rejects foreign tenant at analysis and bridge boundaries', async () => {
    const code = `import express from 'express';
function sendFileRoute(req: any, res: any) {
  res.sendFile(req.query.file);
}
export function createApp() {
  const app = express();
  app.get('/file', sendFileRoute);
  return app;
}
`;
    const { snapshot, ingestion, result } = await analyze(code, 'm2-case-001', ORG);
    await expect(detectPathTraversal(snapshot, ingestion, 'foreign_org')).rejects.toThrow();
    const bridge = createPathTraversalCandidateBridge(async () => VALID_COMMIT);
    await expect(bridge(result, snapshot, ingestion, 'foreign_org')).rejects.toThrow();
  });

  it('8. snapshot boundary: rejects snapshot mismatch', async () => {
    const code = `import express from 'express';
function sendFileRoute(req: any, res: any) {
  res.sendFile(req.query.file);
}
export function createApp() {
  const app = express();
  app.get('/file', sendFileRoute);
  return app;
}
`;
    const run1 = await analyze(code, 'm2-case-001');
    const run2 = await analyze(code, 'm2-case-002');
    await expect(detectPathTraversal(run1.snapshot, run2.ingestion, ORG)).rejects.toThrow('M4_ANALYSIS_SNAPSHOT_MISMATCH');
  });

  it('9. repeated analysis is deterministic and produces identical fingerprint', async () => {
    const code = `import express from 'express';
function sendFileRoute(req: any, res: any) {
  res.sendFile(req.query.file);
}
export function createApp() {
  const app = express();
  app.get('/file', sendFileRoute);
  return app;
}
`;
    const run1 = await analyze(code);
    const run2 = await analyze(code);
    expect(run1.result).toEqual(run2.result);
    expect(run1.result.resultFingerprint).toBe(run2.result.resultFingerprint);

    const { resultFingerprint, ...body } = run1.result;
    const expected = 'sha256:' + createHash('sha256').update(PATH_TRAVERSAL_DETECTOR_VERSION + '\n' + canonical(body)).digest('hex');
    expect(resultFingerprint).toBe(expected);
  });

  it('10. validatePathTraversalAnalysis rejects tampered result fingerprint', async () => {
    const code = `import express from 'express';
function sendFileRoute(req: any, res: any) {
  res.sendFile(req.query.file);
}
export function createApp() {
  const app = express();
  app.get('/file', sendFileRoute);
  return app;
}
`;
    const { snapshot, ingestion, result } = await analyze(code);
    const forged = { ...result, resultFingerprint: 'sha256:' + '0'.repeat(64) };
    await expect(validatePathTraversalAnalysis(forged, snapshot, ingestion, ORG)).rejects.toThrow('M4_ANALYSIS_INTEGRITY_MISMATCH');
  });

  it('11 & 12. createPathTraversalCandidateBridge binds FindingCandidate and retains CANDIDATE state', async () => {
    const code = `import express from 'express';
function sendFileRoute(req: any, res: any) {
  res.sendFile(req.query.file);
}
export function createApp() {
  const app = express();
  app.get('/file', sendFileRoute);
  return app;
}
`;
    const { snapshot, ingestion, result } = await analyze(code);
    const bridge = createPathTraversalCandidateBridge(async () => VALID_COMMIT);
    const hypotheses = await bridge(result, snapshot, ingestion, ORG);

    expect(hypotheses).toHaveLength(1);
    const { candidate, candidateBinding } = hypotheses[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.vulnerabilityClass).toBe('PATH_TRAVERSAL');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.organizationId).toBe(ORG);
    expect(candidate.snapshot.commitSha).toBe(VALID_COMMIT);
    expect(candidate.source.symbol).toBe('query.file');
    expect(candidate.sink.symbol).toBe('res.sendFile');
    expect(candidate.sensorEvidence[0].sensorType).toBe('VELNAR_STRUCTURAL');
    expect(candidate.sensorEvidence[0].ruleId).toBe(PATH_TRAVERSAL_RULE_ID);
    expect(candidate.sensorEvidence[0].rawEvidenceFingerprint).toBe(result.resultFingerprint);
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);
  });

  it('13. bridge does not invoke commit verifier when analysis is NOT_DETECTED or ANALYSIS_INCONCLUSIVE', async () => {
    const safeCode = `import express from 'express';
function safeRoute(req: any, res: any) {
  res.sendFile('safe.txt');
}
export function createApp() {
  const app = express();
  app.get('/safe', safeRoute);
  return app;
}
`;
    const { snapshot, ingestion, result } = await analyze(safeCode);
    expect(result.status).toBe('NOT_DETECTED');
    const verifierMock = vi.fn().mockResolvedValue(VALID_COMMIT);
    const bridge = createPathTraversalCandidateBridge(verifierMock);
    const output = await bridge(result, snapshot, ingestion, ORG);
    expect(output).toEqual([]);
    expect(verifierMock).not.toHaveBeenCalled();
  });

  it('14. createPathTraversalCandidateBridge rejects invalid or all-zero commitSha from verifier', async () => {
    const code = `import express from 'express';
function sendFileRoute(req: any, res: any) {
  res.sendFile(req.query.file);
}
export function createApp() {
  const app = express();
  app.get('/file', sendFileRoute);
  return app;
}
`;
    const { snapshot, ingestion, result } = await analyze(code);
    for (const bad of ['', 'invalid-commit', '0'.repeat(40), '0'.repeat(64)]) {
      const bridge = createPathTraversalCandidateBridge(async () => bad);
      await expect(bridge(result, snapshot, ingestion, ORG)).rejects.toThrow('M4_CHECKED_COMMIT_REQUIRED');
    }
  });
});
