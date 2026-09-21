import { describe, it, expect } from 'vitest';
import { captureSnapshot, validateSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress, validateExpressIngestion } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';

const org = 'org_pdet_multi';
const repo = 'repo_pdet_multi';
const fixtureId = 'm2-case-001';
const mockCommitSha = 'a'.repeat(40);

const vulnerableAppSource = `import express from 'express';

export function createApp(db: any) {
  const app = express();

  function handleVuln(req: any, res: any) {
    const query = req.query.search;
    const part = " WHERE id = '" + query;
    const duplicateFlow = part + part;
    const sql = "SELECT * FROM items" + duplicateFlow;
    const stmt = db.prepare(sql);
    const rows = stmt.all();
    return res.json(rows);
  }

  function handleSafe(req: any, res: any) {
    const stmt = db.prepare('SELECT * FROM items');
    const rows = stmt.all();
    return res.json(rows);
  }

  app.get('/search', handleVuln);
  app.get('/status', handleSafe);
  return app;
}
`;

const duplicateRouteAppSource = `import express from 'express';

export function createApp(db: any) {
  const app = express();

  function handleFirst(req: any, res: any) {
    const stmt = db.prepare('SELECT * FROM items');
    const rows = stmt.all();
    return res.json(rows);
  }

  function handleSecond(req: any, res: any) {
    const stmt = db.prepare('SELECT * FROM items');
    const rows = stmt.all();
    return res.json(rows);
  }

  app.get('/items', handleFirst);
  app.get('/items', handleSecond);
  return app;
}
`;

describe('Multi-Stage Pipeline Determinism and Duplicate Collapse', () => {
  it('preserves deterministic identities and collapses duplicate flow nodes across all stages', async () => {
    const files = [{ path: 'src/app.ts', content: vulnerableAppSource }];

    // Stage 1: Snapshot Ingestion
    const snapshot1 = await captureSnapshot({ fixtureId, repositoryId: repo, organizationId: org, files }, org);
    const snapshot2 = await captureSnapshot({ fixtureId, repositoryId: repo, organizationId: org, files }, org);
    expect(snapshot1.snapshotId).toBe(snapshot2.snapshotId);
    expect(snapshot1.totalBytes).toBe(snapshot2.totalBytes);

    const validatedSnapshot = await validateSnapshot(snapshot1, org);
    expect(validatedSnapshot.snapshotId).toBe(snapshot1.snapshotId);

    // Stage 2: Express Route Ingestion
    const express1 = await ingestExpress(snapshot1, org);
    const express2 = await ingestExpress(snapshot2, org);
    expect(express1.ingestionIdentity).toBe(express2.ingestionIdentity);
    expect(express1.routes).toHaveLength(2);
    expect(express1.routes[0].routeIdentity).toBe(express2.routes[0].routeIdentity);
    expect(express1.routes[1].routeIdentity).toBe(express2.routes[1].routeIdentity);

    const validatedExpress = await validateExpressIngestion(express1, org);
    expect(validatedExpress.ingestionIdentity).toBe(express1.ingestionIdentity);

    // Stage 3: Vulnerability Detection & Duplicate Flow Collapse
    const analysis1 = await detectSqlInjection(snapshot1, express1, org);
    const analysis2 = await detectSqlInjection(snapshot2, express2, org);
    expect(analysis1.status).toBe('DETECTED');
    expect(analysis2.status).toBe('DETECTED');
    expect(analysis1.resultFingerprint).toBe(analysis2.resultFingerprint);
    expect(analysis1.findings).toHaveLength(1);
    expect(analysis2.findings).toHaveLength(1);
    expect(analysis1.findings[0].findingId).toBe(analysis2.findings[0].findingId);

    // Verify duplicate flow step collapse within Stage 3
    const flow1 = analysis1.findings[0].flow;
    const sourceSteps = flow1.filter((step) => step.kind === 'SOURCE');
    expect(sourceSteps).toHaveLength(1);
    const flowNodeIds = flow1.map((step) => step.id);
    expect(new Set(flowNodeIds).size).toBe(flow1.length);

    const validatedAnalysis = await validateSqlAnalysis(analysis1, snapshot1, express1, org);
    expect(validatedAnalysis.resultFingerprint).toBe(analysis1.resultFingerprint);

    // Stage 4: Candidate Bridge
    const bridge = createSqlCandidateBridge(async () => mockCommitSha);
    const candidates1 = await bridge(analysis1, snapshot1, express1, org);
    const candidates2 = await bridge(analysis2, snapshot2, express2, org);

    expect(candidates1).toHaveLength(1);
    expect(candidates2).toHaveLength(1);
    expect(candidates1[0].candidate.candidateId).toBe(candidates2[0].candidate.candidateId);
    expect(candidates1[0].candidateBinding).toBe(candidates2[0].candidateBinding);
    expect(candidates1[0].candidate.verificationState).toBe('CANDIDATE');
    expect(candidates1[0].candidate.reachabilityState).toBe('REACHABLE');
  });

  it('rejects duplicate canonical file paths at Stage 1', async () => {
    const duplicateFiles = [
      { path: 'src/app.ts', content: vulnerableAppSource },
      { path: 'src/app.ts', content: vulnerableAppSource },
    ];

    await expect(
      captureSnapshot({ fixtureId, repositoryId: repo, organizationId: org, files: duplicateFiles }, org),
    ).rejects.toThrow('duplicate canonical path');
  });

  it('rejects duplicate route registrations at Stage 2', async () => {
    const files = [{ path: 'src/app.ts', content: duplicateRouteAppSource }];
    const snapshot = await captureSnapshot({ fixtureId, repositoryId: repo, organizationId: org, files }, org);

    await expect(ingestExpress(snapshot, org)).rejects.toThrow('ambiguous duplicate route');
  });

  it('maintains non-authoritative boundary across detached serialized inputs', async () => {
    const files = [{ path: 'src/app.ts', content: vulnerableAppSource }];
    const snapshot = await captureSnapshot({ fixtureId, repositoryId: repo, organizationId: org, files }, org);
    const express = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, express, org);

    const detachedSnapshot = JSON.parse(JSON.stringify(snapshot));
    const detachedExpress = JSON.parse(JSON.stringify(express));
    const detachedAnalysis = JSON.parse(JSON.stringify(analysis));

    const bridge = createSqlCandidateBridge(async () => mockCommitSha);
    const candidates = await bridge(detachedAnalysis, detachedSnapshot, detachedExpress, org);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].candidate.verificationState).toBe('CANDIDATE');
    expect(candidates[0].candidateBinding).toBeDefined();
  });
});
