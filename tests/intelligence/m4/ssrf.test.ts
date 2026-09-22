import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  detectSsrf,
  validateSsrfAnalysis,
  createSsrfCandidateBridge,
  SSRF_DETECTOR_VERSION,
  SSRF_RULE_ID,
  DETECTOR_VERSION,
  RULE_ID,
} from '../../../worker/intelligence/detection/ssrf';
import {
  captureSnapshot,
  canonical,
  type SnapshotInput,
} from '../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress } from '../../../worker/intelligence/ingestion/express';
import {
  computeCandidateBinding,
  validateFindingCandidate,
} from '../../../worker/intelligence/contracts';

const ORG = 'org_m4_test';

function makeInput(source: string, fixtureId = 'm2-case-001', orgId = ORG): SnapshotInput {
  return {
    fixtureId,
    repositoryId: 'repo_m4',
    organizationId: orgId,
    files: [{ path: 'src/routes.ts', content: source }],
  };
}

async function analyze(source: string, fixtureId = 'm2-case-001', orgId = ORG) {
  const raw = makeInput(source, fixtureId, orgId);
  const snapshot = await captureSnapshot(raw, orgId);
  const ingestion = await ingestExpress(snapshot, orgId);
  const result = await detectSsrf(snapshot, ingestion, orgId);
  return { snapshot, ingestion, result };
}

describe('M4 deterministic SSRF detection', () => {
  it('exposes canonical constants and compatibility aliases', () => {
    expect(SSRF_DETECTOR_VERSION).toBe('velnar-m4-ssrf-source-v1');
    expect(SSRF_RULE_ID).toBe('express-request-to-url-sink-v1');
    expect(DETECTOR_VERSION).toBe(SSRF_DETECTOR_VERSION);
    expect(RULE_ID).toBe(SSRF_RULE_ID);
  });

  it('1. detects direct request query URL to fetch sink with full flow provenance', async () => {
    const source = [
      "import express from 'express';",
      "function proxyRoute(req: any, res: any) {",
      "  const target = req.query.url;",
      "  fetch(target);",
      "  return res.json({ ok: true });",
      "}",
      "export function createApp() {",
      "  const app = express();",
      "  app.get('/api/proxy', proxyRoute);",
      "  return app;",
      "}",
    ].join('\n');

    const { snapshot, ingestion, result } = await analyze(source);
    expect(result.status).toBe('DETECTED');
    expect(result.limitations).toEqual([]);
    expect(result.findings).toHaveLength(1);
    expect(result.snapshotId).toBe(snapshot.snapshotId);
    expect(result.ingestionIdentity).toBe(ingestion.ingestionIdentity);

    const finding = result.findings[0];
    expect(finding.vulnerabilityClass).toBe('SSRF');
    expect(finding.source.symbol).toBe('query.url');
    expect(finding.sink.symbol).toBe('fetch');
    expect(finding.routeIdentity).toBe(ingestion.routes[0].routeIdentity);
    expect(finding.flow[0].kind).toBe('SOURCE');
    expect(finding.flow[finding.flow.length - 1].kind).toBe('SINK');
    expect(finding.flow.some(step => step.kind === 'VARIABLE')).toBe(true);
  });

  it('2. detects concatenation into fetch sink with CONCAT flow step', async () => {
    const source = [
      "import express from 'express';",
      "function proxyRoute(req: any, res: any) {",
      "  const target = 'https://' + req.query.host;",
      "  fetch(target);",
      "  return res.json({ ok: true });",
      "}",
      "export function createApp() {",
      "  const app = express();",
      "  app.get('/api/proxy', proxyRoute);",
      "  return app;",
      "}",
    ].join('\n');

    const { result } = await analyze(source);
    expect(result.status).toBe('DETECTED');
    expect(result.findings[0].flow.some(step => step.kind === 'CONCAT')).toBe(true);
  });

  it('3. detects helper call delegation without executing the function', async () => {
    const source = [
      "import express from 'express';",
      "function sendOut(url: any) {",
      "  return fetch(url);",
      "}",
      "function proxyRoute(req: any, res: any) {",
      "  sendOut(req.query.target);",
      "  return res.json({ ok: true });",
      "}",
      "export function createApp() {",
      "  const app = express();",
      "  app.get('/api/proxy', proxyRoute);",
      "  return app;",
      "}",
    ].join('\n');

    const { result } = await analyze(source);
    expect(result.status).toBe('DETECTED');
    const kinds = result.findings[0].flow.map(s => s.kind);
    expect(kinds).toContain('CALL');
    expect(kinds).toContain('ARGUMENT');
  });

  it('4. negative control: safe constant URL creates no finding', async () => {
    const source = [
      "import express from 'express';",
      "function proxyRoute(req: any, res: any) {",
      "  const param = req.query.url;",
      "  fetch('https://api.internal.org/health');",
      "  return res.json({ param });",
      "}",
      "export function createApp() {",
      "  const app = express();",
      "  app.get('/api/proxy', proxyRoute);",
      "  return app;",
      "}",
    ].join('\n');

    const { result } = await analyze(source);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
  });

  it('5. negative control: local function shadowing fetch is not a network sink', async () => {
    const source = [
      "import express from 'express';",
      "function fetch(dest: any) {",
      "  return dest;",
      "}",
      "function proxyRoute(req: any, res: any) {",
      "  fetch(req.query.url);",
      "  return res.json({ ok: true });",
      "}",
      "export function createApp() {",
      "  const app = express();",
      "  app.get('/api/proxy', proxyRoute);",
      "  return app;",
      "}",
    ].join('\n');

    const { result } = await analyze(source);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
  });

  it('6. negative control: unsupported syntax fails closed as ANALYSIS_INCONCLUSIVE', async () => {
    const source = [
      "import express from 'express';",
      "function proxyRoute(req: any, res: any) {",
      "  while (true) {}",
      "  return res.json({ ok: true });",
      "}",
      "export function createApp() {",
      "  const app = express();",
      "  app.get('/api/proxy', proxyRoute);",
      "  return app;",
      "}",
    ].join('\n');

    const { result } = await analyze(source);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('UNSUPPORTED_STATEMENT');
  });

  it('7. tenant boundary: rejects foreign tenant at analysis and bridge boundaries', async () => {
    const source = [
      "import express from 'express';",
      "function proxyRoute(req: any, res: any) {",
      "  fetch(req.query.url);",
      "  return res.json({ ok: true });",
      "}",
      "export function createApp() {",
      "  const app = express();",
      "  app.get('/api/proxy', proxyRoute);",
      "  return app;",
      "}",
    ].join('\n');

    const { snapshot, ingestion, result } = await analyze(source, 'm2-case-001', ORG);
    await expect(detectSsrf(snapshot, ingestion, 'foreign_org')).rejects.toThrow();
    const bridge = createSsrfCandidateBridge(async () => 'b'.repeat(40));
    await expect(bridge(result, snapshot, ingestion, 'foreign_org')).rejects.toThrow();
  });

  it('8. snapshot boundary: rejects snapshot mismatch', async () => {
    const source = [
      "import express from 'express';",
      "function proxyRoute(req: any, res: any) {",
      "  fetch(req.query.url);",
      "  return res.json({ ok: true });",
      "}",
      "export function createApp() {",
      "  const app = express();",
      "  app.get('/api/proxy', proxyRoute);",
      "  return app;",
      "}",
    ].join('\n');

    const run1 = await analyze(source, 'm2-case-001');
    const run2 = await analyze(source, 'm2-case-002');
    await expect(detectSsrf(run1.snapshot, run2.ingestion, ORG)).rejects.toThrow('M4_ANALYSIS_SNAPSHOT_MISMATCH');
  });

  it('9. repeated analysis is deterministic and fingerprint matches canonical body hash', async () => {
    const source = [
      "import express from 'express';",
      "function proxyRoute(req: any, res: any) {",
      "  fetch(req.query.url);",
      "  return res.json({ ok: true });",
      "}",
      "export function createApp() {",
      "  const app = express();",
      "  app.get('/api/proxy', proxyRoute);",
      "  return app;",
      "}",
    ].join('\n');

    const run1 = await analyze(source);
    const run2 = await analyze(source);
    expect(run1.result).toEqual(run2.result);

    const { resultFingerprint, ...body } = run1.result;
    const expected = 'sha256:' + createHash('sha256').update(SSRF_DETECTOR_VERSION + '\n' + canonical(body)).digest('hex');
    expect(resultFingerprint).toBe(expected);
  });

  it('10. validateSsrfAnalysis rejects tampered result fingerprint', async () => {
    const source = [
      "import express from 'express';",
      "function proxyRoute(req: any, res: any) {",
      "  fetch(req.query.url);",
      "  return res.json({ ok: true });",
      "}",
      "export function createApp() {",
      "  const app = express();",
      "  app.get('/api/proxy', proxyRoute);",
      "  return app;",
      "}",
    ].join('\n');

    const { snapshot, ingestion, result } = await analyze(source);
    const forged = { ...result, resultFingerprint: 'sha256:' + 'f'.repeat(64) };
    await expect(validateSsrfAnalysis(forged, snapshot, ingestion, ORG)).rejects.toThrow('M4_ANALYSIS_INTEGRITY_MISMATCH');
  });

  it('11 & 12. createSsrfCandidateBridge binds FindingCandidate with verified commit and retains CANDIDATE state', async () => {
    const source = [
      "import express from 'express';",
      "function proxyRoute(req: any, res: any) {",
      "  fetch(req.query.url);",
      "  return res.json({ ok: true });",
      "}",
      "export function createApp() {",
      "  const app = express();",
      "  app.get('/api/proxy', proxyRoute);",
      "  return app;",
      "}",
    ].join('\n');

    const { snapshot, ingestion, result } = await analyze(source);
    const commitSha = 'b'.repeat(40);
    const bridge = createSsrfCandidateBridge(async () => commitSha);
    const output = await bridge(result, snapshot, ingestion, ORG);

    expect(output).toHaveLength(1);
    const { candidate, candidateBinding } = output[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.vulnerabilityClass).toBe('SSRF');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.organizationId).toBe(ORG);
    expect(candidate.snapshot.commitSha).toBe(commitSha);
    expect(candidate.source.symbol).toBe('query.url');
    expect(candidate.sink.symbol).toBe('fetch');
    expect(candidate.sensorEvidence[0].sensorType).toBe('VELNAR_STRUCTURAL');
    expect(candidate.sensorEvidence[0].ruleId).toBe(SSRF_RULE_ID);
    expect(candidate.sensorEvidence[0].rawEvidenceFingerprint).toBe(result.resultFingerprint);
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);
  });

  it('13. bridge does not invoke commit verifier when analysis is NOT_DETECTED or ANALYSIS_INCONCLUSIVE', async () => {
    const safeSource = [
      "import express from 'express';",
      "function proxyRoute(req: any, res: any) {",
      "  fetch('https://api.internal.org/health');",
      "  return res.json({ ok: true });",
      "}",
      "export function createApp() {",
      "  const app = express();",
      "  app.get('/api/proxy', proxyRoute);",
      "  return app;",
      "}",
    ].join('\n');

    const { snapshot, ingestion, result } = await analyze(safeSource);
    expect(result.status).toBe('NOT_DETECTED');
    const verifierMock = vi.fn().mockResolvedValue('a'.repeat(40));
    const bridge = createSsrfCandidateBridge(verifierMock);
    const output = await bridge(result, snapshot, ingestion, ORG);
    expect(output).toEqual([]);
    expect(verifierMock).not.toHaveBeenCalled();
  });

  it('14. createSsrfCandidateBridge rejects invalid or all-zero commitSha from verifier', async () => {
    const source = [
      "import express from 'express';",
      "function proxyRoute(req: any, res: any) {",
      "  fetch(req.query.url);",
      "  return res.json({ ok: true });",
      "}",
      "export function createApp() {",
      "  const app = express();",
      "  app.get('/api/proxy', proxyRoute);",
      "  return app;",
      "}",
    ].join('\n');

    const { snapshot, ingestion, result } = await analyze(source);
    for (const bad of ['', 'not-a-commit', '0'.repeat(40), '0'.repeat(64), 'xyz']) {
      const bridge = createSsrfCandidateBridge(async () => bad);
      await expect(bridge(result, snapshot, ingestion, ORG)).rejects.toThrow('M4_CHECKED_COMMIT_REQUIRED');
    }
  });
});
