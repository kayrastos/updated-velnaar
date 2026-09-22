import { describe, it, expect } from 'vitest';
import { captureSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';

const org = 'org_velnar_pdet';
const repo = 'repo-pdet-mhop-dir';
const fixtureId = 'm2-case-001';

const multiHopDirectSource = `import express from 'express';

function sanitize(val: string): string {
  return val;
}

function buildQuery(input: string): string {
  const intermediate = sanitize(input);
  return 'SELECT * FROM accounts WHERE id = ' + intermediate;
}

export function createApp(db: any) {
  const app = express();

  function handleAccount(req: any, res: any) {
    const rawId = req.query.id;
    const sql = buildQuery(rawId);
    const stmt = db.prepare(sql);
    const rows = stmt.all();
    return res.json(rows);
  }

  app.get('/account', handleAccount);
  return app;
}
`;

describe('Pipeline Determinism - Multi-Hop Flow Direct (tests/automation/roadmap/chat-4/pdet-mhop-dir.test.ts)', () => {
  it('deterministically captures snapshot, ingests routes, and detects multi-hop SQL injection', async () => {
    const files = [{ path: 'src/app.ts', content: multiHopDirectSource }];

    const snapshotA = await captureSnapshot({ fixtureId, repositoryId: repo, organizationId: org, files }, org);
    const snapshotB = await captureSnapshot({ fixtureId, repositoryId: repo, organizationId: org, files }, org);

    expect(snapshotA.snapshotId).toBe(snapshotB.snapshotId);
    expect(snapshotA.totalBytes).toBe(snapshotB.totalBytes);

    const expressA = await ingestExpress(snapshotA, org);
    const expressB = await ingestExpress(snapshotB, org);

    expect(expressA.ingestionIdentity).toBe(expressB.ingestionIdentity);
    expect(expressA.routes.length).toBe(1);
    expect(expressA.routes[0].path).toBe('/account');

    const analysisA = await detectSqlInjection(snapshotA, expressA, org);
    const analysisB = await detectSqlInjection(snapshotB, expressB, org);

    expect(analysisA.resultFingerprint).toBe(analysisB.resultFingerprint);
    expect(analysisA.status).toBe('DETECTED');
    expect(analysisA.findings.length).toBe(1);

    const finding = analysisA.findings[0];
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.routeIdentity).toBe(expressA.routes[0].routeIdentity);
    expect(finding.findingId).toBe(analysisB.findings[0].findingId);

    const flowKinds = finding.flow.map(step => step.kind);
    expect(flowKinds).toContain('SOURCE');
    expect(flowKinds).toContain('CALL');
    expect(flowKinds).toContain('ARGUMENT');
    expect(flowKinds).toContain('RETURN');
    expect(flowKinds).toContain('VARIABLE');
    expect(flowKinds).toContain('CONCAT');
    expect(flowKinds).toContain('SINK');

    expect(finding.source.symbol).toBe('query.id');
    expect(finding.sink.symbol).toBe('db.prepare');

    const validated = await validateSqlAnalysis(analysisA, snapshotA, expressA, org);
    expect(validated.resultFingerprint).toBe(analysisA.resultFingerprint);

    const tampered = { ...analysisA, status: 'NOT_DETECTED' as const };
    await expect(validateSqlAnalysis(tampered, snapshotA, expressA, org)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
  });

  it('preserves non-authoritative boundary without minting verified or action capability', async () => {
    const files = [{ path: 'src/app.ts', content: multiHopDirectSource }];
    const snapshot = await captureSnapshot({ fixtureId, repositoryId: repo, organizationId: org, files }, org);
    const express = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, express, org);

    expect((analysis as any).capability).toBeUndefined();
    expect((analysis as any).verificationState).toBeUndefined();
    expect((analysis as any).verified).toBeUndefined();
    expect(analysis.status).toBe('DETECTED');
  });
});
