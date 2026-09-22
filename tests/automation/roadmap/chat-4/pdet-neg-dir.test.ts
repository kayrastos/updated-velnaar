import { describe, it, expect } from 'vitest';
import { captureSnapshot, validateSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress, validateExpressIngestion } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';

const directParameterizedSource = `import express from 'express';

export function createApp(db: any) {
  const app = express();

  function handleUsers(req: any, res: any) {
    const rows = db.prepare('SELECT id, name FROM users WHERE id = ?').all(req.query.id);
    return res.json(rows);
  }

  app.get('/users', handleUsers);
  return app;
}
`;

const directStaticSource = `import express from 'express';

export function createApp(db: any) {
  const app = express();

  function handleHealth(req: any, res: any) {
    const rows = db.prepare('SELECT id, status FROM system_health').all();
    return res.json(rows);
  }

  app.get('/health', handleHealth);
  return app;
}
`;

describe('Pipeline Determinism Negative Control Direct (RM_PDET_NEG_DIR)', () => {
  const org = 'org_chat4_neg_dir';

  it('evaluates direct parameterized query as NOT_DETECTED with deterministic fingerprint across multiple runs', async () => {
    const input = {
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-pdet-neg-dir',
      organizationId: org,
      files: [{ path: 'src/app.ts', content: directParameterizedSource }],
    };

    const snapshot1 = await captureSnapshot(input, org);
    const snapshot2 = await captureSnapshot(input, org);

    expect(snapshot1.snapshotId).toBe(snapshot2.snapshotId);
    expect(snapshot1.totalBytes).toBe(snapshot2.totalBytes);
    expect(snapshot1.files[0].contentDigest).toBe(snapshot2.files[0].contentDigest);
    expect(snapshot1.files[0].fileIdentity).toBe(snapshot2.files[0].fileIdentity);

    const validatedSnapshot = await validateSnapshot(snapshot1, org);
    expect(validatedSnapshot.snapshotId).toBe(snapshot1.snapshotId);

    const express1 = await ingestExpress(snapshot1, org);
    const express2 = await ingestExpress(snapshot2, org);

    expect(express1.ingestionIdentity).toBe(express2.ingestionIdentity);
    expect(express1.routes).toHaveLength(1);
    expect(express1.routes[0].routeIdentity).toBe(express2.routes[0].routeIdentity);
    expect(express1.routes[0].method).toBe('GET');
    expect(express1.routes[0].path).toBe('/users');

    const validatedExpress = await validateExpressIngestion(express1, org);
    expect(validatedExpress.ingestionIdentity).toBe(express1.ingestionIdentity);

    const analysis1 = await detectSqlInjection(snapshot1, express1, org);
    const analysis2 = await detectSqlInjection(snapshot2, express2, org);

    expect(analysis1.status).toBe('NOT_DETECTED');
    expect(analysis1.findings).toHaveLength(0);
    expect(analysis1.limitations).toHaveLength(0);
    expect(analysis1.resultFingerprint).toBe(analysis2.resultFingerprint);
    expect(analysis1.snapshotId).toBe(snapshot1.snapshotId);
    expect(analysis1.ingestionIdentity).toBe(express1.ingestionIdentity);

    const validatedAnalysis = await validateSqlAnalysis(analysis1, snapshot1, express1, org);
    expect(validatedAnalysis.resultFingerprint).toBe(analysis1.resultFingerprint);
    expect(validatedAnalysis.status).toBe('NOT_DETECTED');
  });

  it('evaluates direct static query as NOT_DETECTED with deterministic fingerprint', async () => {
    const input = {
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-pdet-neg-dir-static',
      organizationId: org,
      files: [{ path: 'src/app.ts', content: directStaticSource }],
    };

    const snapshot = await captureSnapshot(input, org);
    const express = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, express, org);

    expect(analysis.status).toBe('NOT_DETECTED');
    expect(analysis.findings).toHaveLength(0);
    expect(analysis.limitations).toHaveLength(0);

    const validatedAnalysis = await validateSqlAnalysis(analysis, snapshot, express, org);
    expect(validatedAnalysis.resultFingerprint).toBe(analysis.resultFingerprint);
    expect(validatedAnalysis.status).toBe('NOT_DETECTED');
  });

  it('guarantees candidate bridge yields zero findings and never mints authority for negative controls', async () => {
    const input = {
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-pdet-neg-dir',
      organizationId: org,
      files: [{ path: 'src/app.ts', content: directParameterizedSource }],
    };

    const snapshot = await captureSnapshot(input, org);
    const express = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, express, org);

    expect(analysis.status).toBe('NOT_DETECTED');

    const verifyCommittedCode = async () => {
      throw new Error('verifyCommittedCode must not be called when analysis is NOT_DETECTED');
    };

    const bridge = createSqlCandidateBridge(verifyCommittedCode);
    const candidates = await bridge(analysis, snapshot, express, org);

    expect(candidates).toEqual([]);
    expect(candidates).toHaveLength(0);
    expect(Object.isFrozen(candidates)).toBe(true);
  });

  it('rejects tampered analysis status or mismatched snapshot binding', async () => {
    const input = {
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-pdet-neg-dir',
      organizationId: org,
      files: [{ path: 'src/app.ts', content: directParameterizedSource }],
    };

    const snapshot = await captureSnapshot(input, org);
    const express = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, express, org);

    const forgedAnalysis = {
      ...analysis,
      status: 'DETECTED',
    };

    await expect(validateSqlAnalysis(forgedAnalysis, snapshot, express, org)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');

    const foreignSnapshot = await captureSnapshot({
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-pdet-neg-dir-foreign',
      organizationId: org,
      files: [{ path: 'src/app.ts', content: directStaticSource }],
    }, org);

    await expect(detectSqlInjection(foreignSnapshot, express, org)).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
  });

  it('enforces tenant boundary on snapshot, express ingestion, and analysis', async () => {
    const input = {
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-pdet-neg-dir',
      organizationId: org,
      files: [{ path: 'src/app.ts', content: directParameterizedSource }],
    };

    const snapshot = await captureSnapshot(input, org);
    const express = await ingestExpress(snapshot, org);

    await expect(validateSnapshot(snapshot, 'foreign_org')).rejects.toThrow('tenant mismatch');
    await expect(validateExpressIngestion(express, 'foreign_org')).rejects.toThrow('tenant mismatch');
    await expect(detectSqlInjection(snapshot, express, 'foreign_org')).rejects.toThrow('tenant mismatch');
  });
});
