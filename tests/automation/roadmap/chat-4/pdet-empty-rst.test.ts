import { describe, it, expect } from 'vitest';
import {
  captureSnapshot,
  validateSnapshot,
} from '../../../../worker/intelligence/ingestion/snapshot';
import {
  ingestExpress,
  validateExpressIngestion,
} from '../../../../worker/intelligence/ingestion/express';
import {
  detectSqlInjection,
  validateSqlAnalysis,
} from '../../../../worker/intelligence/detection/sqlInjection';
import {
  createSqlCandidateBridge,
} from '../../../../worker/intelligence/detection/candidate';

describe('RM_PDET_EMPTY_RST: Pipeline Determinism Null-Empty Boundary Restart-Resume', () => {
  const organizationId = 'org_pdet_empty_rst';
  const repositoryId = 'repo-pdet-empty-rst';
  const fixtureId = 'm2-case-001';

  const cleanAppCode = `import express from 'express';

export function createApp(db: any) {
  const app = express();
  app.get('/api/empty', emptyHandler);
  return app;
}

export function emptyHandler(req: any, res: any) {
  return;
}
`;

  it('preserves deterministic pipeline identities across clean restart and serialization boundaries', async () => {
    const input = {
      fixtureId,
      repositoryId,
      organizationId,
      files: [{ path: 'src/app.ts', content: cleanAppCode }],
    };

    const snapshot1 = await captureSnapshot(input, organizationId);
    const ingestion1 = await ingestExpress(snapshot1, organizationId);
    const analysis1 = await detectSqlInjection(snapshot1, ingestion1, organizationId);

    expect(analysis1.status).toBe('NOT_DETECTED');
    expect(analysis1.findings).toHaveLength(0);
    expect(analysis1.limitations).toHaveLength(0);

    const serializedSnapshot = JSON.parse(JSON.stringify(snapshot1));
    const resumedSnapshot = await validateSnapshot(serializedSnapshot, organizationId);
    expect(resumedSnapshot.snapshotId).toBe(snapshot1.snapshotId);

    const serializedIngestion = JSON.parse(JSON.stringify(ingestion1));
    const resumedIngestion = await validateExpressIngestion(serializedIngestion, organizationId);
    expect(resumedIngestion.ingestionIdentity).toBe(ingestion1.ingestionIdentity);

    const serializedAnalysis = JSON.parse(JSON.stringify(analysis1));
    const resumedAnalysis = await validateSqlAnalysis(
      serializedAnalysis,
      resumedSnapshot,
      resumedIngestion,
      organizationId,
    );
    expect(resumedAnalysis.resultFingerprint).toBe(analysis1.resultFingerprint);
    expect(resumedAnalysis.status).toBe('NOT_DETECTED');
    expect(resumedAnalysis.findings).toEqual([]);

    const snapshot2 = await captureSnapshot(input, organizationId);
    const ingestion2 = await ingestExpress(snapshot2, organizationId);
    const analysis2 = await detectSqlInjection(snapshot2, ingestion2, organizationId);

    expect(snapshot2.snapshotId).toBe(snapshot1.snapshotId);
    expect(ingestion2.ingestionIdentity).toBe(ingestion1.ingestionIdentity);
    expect(analysis2.resultFingerprint).toBe(analysis1.resultFingerprint);
  });

  it('fails closed deterministically on empty snapshot files across restart attempts', async () => {
    const emptyFilesInput = {
      fixtureId,
      repositoryId,
      organizationId,
      files: [],
    };

    await expect(captureSnapshot(emptyFilesInput, organizationId)).rejects.toThrow();
  });

  it('fails closed deterministically when snapshot contains no supported Express routes', async () => {
    const noRouteInput = {
      fixtureId,
      repositoryId,
      organizationId,
      files: [{ path: 'src/noop.ts', content: 'export const idle = true;\n' }],
    };

    const emptySnapshot = await captureSnapshot(noRouteInput, organizationId);
    await expect(ingestExpress(emptySnapshot, organizationId)).rejects.toThrow('no supported Express route');
  });

  it('returns empty non-authoritative hypotheses on null/empty finding boundary without invoking commit check', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId,
        repositoryId,
        organizationId,
        files: [{ path: 'src/app.ts', content: cleanAppCode }],
      },
      organizationId,
    );
    const ingestion = await ingestExpress(snapshot, organizationId);
    const analysis = await detectSqlInjection(snapshot, ingestion, organizationId);

    expect(analysis.status).toBe('NOT_DETECTED');
    expect(analysis.findings).toHaveLength(0);

    let verifyCommittedCodeCalled = false;
    const bridge = createSqlCandidateBridge(async () => {
      verifyCommittedCodeCalled = true;
      return '1111111111111111111111111111111111111111';
    });

    const candidates = await bridge(analysis, snapshot, ingestion, organizationId);

    expect(candidates).toEqual([]);
    expect(Object.isFrozen(candidates)).toBe(true);
    expect(verifyCommittedCodeCalled).toBe(false);
  });

  it('enforces tenant boundary isolation across restart-resume validation', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId,
        repositoryId,
        organizationId,
        files: [{ path: 'src/app.ts', content: cleanAppCode }],
      },
      organizationId,
    );
    const ingestion = await ingestExpress(snapshot, organizationId);

    const serializedSnapshot = JSON.parse(JSON.stringify(snapshot));
    await expect(validateSnapshot(serializedSnapshot, 'foreign_org')).rejects.toThrow('tenant mismatch');

    const serializedIngestion = JSON.parse(JSON.stringify(ingestion));
    await expect(validateExpressIngestion(serializedIngestion, 'foreign_org')).rejects.toThrow('tenant mismatch');
  });
});
