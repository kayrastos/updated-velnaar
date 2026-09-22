import { describe, it, expect } from 'vitest';
import { captureSnapshot, validateSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress, validateExpressIngestion } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';

const orgId = 'org_pdet_multi';
const repoId = 'repo-pdet-multi';

const vulnerableSource = [
  "import express from 'express';",
  '',
  'export function createApp(db: any) {',
  '  const app = express();',
  '  function getItems(req: any, res: any) {',
  '    const q = req.query.id;',
  '    const query = "SELECT * FROM items WHERE id = \'" + q + "\'";',
  '    const stmt = db.prepare(query);',
  '    const rows = stmt.all();',
  '    res.json(rows);',
  '  }',
  "  app.get('/items', getItems);",
  '  return app;',
  '}',
  '',
].join('\n');

const safeSource = [
  "import express from 'express';",
  '',
  'export function createApp(db: any) {',
  '  const app = express();',
  '  function getItems(req: any, res: any) {',
  '    const q = req.query.id;',
  '    const stmt = db.prepare("SELECT * FROM items WHERE id = ?");',
  '    const rows = stmt.all(q);',
  '    res.json(rows);',
  '  }',
  "  app.get('/items', getItems);",
  '  return app;',
  '}',
  '',
].join('\n');

const perturbedSource = [
  "import express from 'express';",
  '',
  'export function createApp(db: any) {',
  '  const app = express();',
  '  function getItems(req: any, res: any) {',
  '    const category = req.query.category;',
  '    const query = "SELECT * FROM items WHERE category = \'" + category + "\'";',
  '    const stmt = db.prepare(query);',
  '    const rows = stmt.all();',
  '    res.json(rows);',
  '  }',
  "  app.get('/items', getItems);",
  '  return app;',
  '}',
  '',
].join('\n');

describe('Multi-Stage Pipeline Determinism and Identity Stability', () => {
  it('preserves deterministic stage identities across multiple full pipeline executions', async () => {
    const commitSha = 'a'.repeat(40);
    const mockVerifyCommittedCode = async () => commitSha;
    const bridge = createSqlCandidateBridge(mockVerifyCommittedCode);

    const snapshotInput = {
      fixtureId: 'm2-case-001',
      repositoryId: repoId,
      organizationId: orgId,
      files: [{ path: 'src/app.ts', content: vulnerableSource }],
    };

    const snapshot1 = await captureSnapshot(snapshotInput, orgId);
    const snapshot2 = await captureSnapshot(snapshotInput, orgId);
    expect(snapshot1.snapshotId).toBe(snapshot2.snapshotId);
    expect(snapshot1.files[0].fileIdentity).toBe(snapshot2.files[0].fileIdentity);
    expect(snapshot1.files[0].contentDigest).toBe(snapshot2.files[0].contentDigest);

    const validatedSnapshot1 = await validateSnapshot(snapshot1, orgId);
    expect(validatedSnapshot1.snapshotId).toBe(snapshot1.snapshotId);

    const ingestion1 = await ingestExpress(snapshot1, orgId);
    const ingestion2 = await ingestExpress(snapshot2, orgId);
    expect(ingestion1.ingestionIdentity).toBe(ingestion2.ingestionIdentity);
    expect(ingestion1.routes[0].routeIdentity).toBe(ingestion2.routes[0].routeIdentity);

    const validatedIngestion1 = await validateExpressIngestion(ingestion1, orgId);
    expect(validatedIngestion1.ingestionIdentity).toBe(ingestion1.ingestionIdentity);

    const analysis1 = await detectSqlInjection(snapshot1, ingestion1, orgId);
    const analysis2 = await detectSqlInjection(snapshot2, ingestion2, orgId);
    expect(analysis1.status).toBe('DETECTED');
    expect(analysis2.status).toBe('DETECTED');
    expect(analysis1.resultFingerprint).toBe(analysis2.resultFingerprint);
    expect(analysis1.findings.length).toBe(1);
    expect(analysis1.findings[0].findingId).toBe(analysis2.findings[0].findingId);
    expect(analysis1.findings[0].flow.length).toBeGreaterThan(0);
    expect(analysis1.findings[0].flow[0].id).toBe(analysis2.findings[0].flow[0].id);

    const validatedAnalysis1 = await validateSqlAnalysis(analysis1, snapshot1, ingestion1, orgId);
    expect(validatedAnalysis1.resultFingerprint).toBe(analysis1.resultFingerprint);

    const candidates1 = await bridge(analysis1, snapshot1, ingestion1, orgId);
    const candidates2 = await bridge(analysis2, snapshot2, ingestion2, orgId);
    expect(candidates1.length).toBe(1);
    expect(candidates2.length).toBe(1);
    expect(candidates1[0].candidate.candidateId).toBe(candidates2[0].candidate.candidateId);
    expect(candidates1[0].candidateBinding).toBe(candidates2[0].candidateBinding);

    const c1 = candidates1[0].candidate;
    expect(c1.snapshot.snapshotId).toBe(snapshot1.snapshotId);
    expect(c1.context.routeId).toBe(ingestion1.routes[0].routeIdentity);
    expect(c1.sensorEvidence[0].sensorFindingId).toBe(analysis1.findings[0].findingId);
    expect(c1.sensorEvidence[0].rawEvidenceFingerprint).toBe(analysis1.resultFingerprint);
    expect(c1.verificationState).toBe('CANDIDATE');
    expect(c1.reachabilityState).toBe('REACHABLE');
  });

  it('cascades upstream stage identity changes to downstream stages without collision', async () => {
    const commitSha = 'b'.repeat(40);
    const mockVerifyCommittedCode = async () => commitSha;
    const bridge = createSqlCandidateBridge(mockVerifyCommittedCode);

    const snapshotInputA = {
      fixtureId: 'm2-case-001',
      repositoryId: repoId,
      organizationId: orgId,
      files: [{ path: 'src/app.ts', content: vulnerableSource }],
    };

    const snapshotInputB = {
      fixtureId: 'm2-case-001',
      repositoryId: repoId,
      organizationId: orgId,
      files: [{ path: 'src/app.ts', content: perturbedSource }],
    };

    const snapshotA = await captureSnapshot(snapshotInputA, orgId);
    const snapshotB = await captureSnapshot(snapshotInputB, orgId);
    expect(snapshotA.snapshotId).not.toBe(snapshotB.snapshotId);

    const ingestionA = await ingestExpress(snapshotA, orgId);
    const ingestionB = await ingestExpress(snapshotB, orgId);
    expect(ingestionA.ingestionIdentity).not.toBe(ingestionB.ingestionIdentity);

    const analysisA = await detectSqlInjection(snapshotA, ingestionA, orgId);
    const analysisB = await detectSqlInjection(snapshotB, ingestionB, orgId);
    expect(analysisA.status).toBe('DETECTED');
    expect(analysisB.status).toBe('DETECTED');
    expect(analysisA.resultFingerprint).not.toBe(analysisB.resultFingerprint);
    expect(analysisA.findings[0].findingId).not.toBe(analysisB.findings[0].findingId);

    const candidatesA = await bridge(analysisA, snapshotA, ingestionA, orgId);
    const candidatesB = await bridge(analysisB, snapshotB, ingestionB, orgId);
    expect(candidatesA[0].candidate.candidateId).not.toBe(candidatesB[0].candidate.candidateId);
    expect(candidatesA[0].candidateBinding).not.toBe(candidatesB[0].candidateBinding);
  });

  it('isolates candidate identity by commit SHA while preserving upstream analysis identity', async () => {
    const commitSha1 = '1'.repeat(40);
    const commitSha2 = '2'.repeat(40);

    const bridge1 = createSqlCandidateBridge(async () => commitSha1);
    const bridge2 = createSqlCandidateBridge(async () => commitSha2);

    const snapshot = await captureSnapshot({
      fixtureId: 'm2-case-001',
      repositoryId: repoId,
      organizationId: orgId,
      files: [{ path: 'src/app.ts', content: vulnerableSource }],
    }, orgId);

    const ingestion = await ingestExpress(snapshot, orgId);
    const analysis = await detectSqlInjection(snapshot, ingestion, orgId);

    const candidates1 = await bridge1(analysis, snapshot, ingestion, orgId);
    const candidates2 = await bridge2(analysis, snapshot, ingestion, orgId);

    expect(candidates1[0].candidate.snapshot.commitSha).toBe(commitSha1);
    expect(candidates2[0].candidate.snapshot.commitSha).toBe(commitSha2);
    expect(candidates1[0].candidate.candidateId).not.toBe(candidates2[0].candidate.candidateId);
    expect(candidates1[0].candidateBinding).not.toBe(candidates2[0].candidateBinding);

    expect(candidates1[0].candidate.snapshot.snapshotId).toBe(candidates2[0].candidate.snapshot.snapshotId);
    expect(candidates1[0].candidate.sensorEvidence[0].rawEvidenceFingerprint)
      .toBe(candidates2[0].candidate.sensorEvidence[0].rawEvidenceFingerprint);
  });

  it('maintains non-authoritative boundary and empty candidates for safe pipeline flow', async () => {
    const commitSha = 'c'.repeat(40);
    const bridge = createSqlCandidateBridge(async () => commitSha);

    const snapshot = await captureSnapshot({
      fixtureId: 'm2-case-001',
      repositoryId: repoId,
      organizationId: orgId,
      files: [{ path: 'src/app.ts', content: safeSource }],
    }, orgId);

    const ingestion = await ingestExpress(snapshot, orgId);
    const analysis = await detectSqlInjection(snapshot, ingestion, orgId);

    expect(analysis.status).toBe('NOT_DETECTED');
    expect(analysis.findings.length).toBe(0);

    const candidates = await bridge(analysis, snapshot, ingestion, orgId);
    expect(candidates.length).toBe(0);
    expect(Object.isFrozen(candidates)).toBe(true);
  });
});
