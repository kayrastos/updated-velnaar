import { describe, it, expect } from 'vitest';
import { captureSnapshot, validateSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress, validateExpressIngestion } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';

describe('V1 Pipeline Determinism: Direct Case-Sensitivity Enforcement', () => {
  it('fails closed when snapshot input contains direct case collisions in the same directory', async () => {
    const org = 'org_pdet_case';
    await expect(
      captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: 'repo-pdet-case-dir',
          organizationId: org,
          files: [
            { path: 'src/routes.ts', content: 'export const a = 1;\n' },
            { path: 'src/ROUTES.ts', content: 'export const b = 2;\n' },
          ],
        },
        org,
      ),
    ).rejects.toThrow('duplicate canonical path');
  });

  it('rejects direct path case tampering during snapshot validation', async () => {
    const org = 'org_pdet_case';
    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-pdet-case-dir',
        organizationId: org,
        files: [
          { path: 'src/app.ts', content: 'export const app = true;\n' },
        ],
      },
      org,
    );

    const tampered = {
      ...snapshot,
      files: [
        {
          ...snapshot.files[0],
          path: 'src/APP.ts',
        },
      ],
    };

    await expect(validateSnapshot(tampered, org)).rejects.toThrow('snapshot integrity mismatch');
  });

  it('produces identical snapshot identity regardless of input file ordering with direct mixed-case paths', async () => {
    const org = 'org_pdet_case';
    const fileA = { path: 'src/Beta.ts', content: 'export const beta = 2;\n' };
    const fileB = { path: 'src/alpha.ts', content: 'export const alpha = 1;\n' };

    const snapshot1 = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-pdet-case-dir',
        organizationId: org,
        files: [fileA, fileB],
      },
      org,
    );

    const snapshot2 = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-pdet-case-dir',
        organizationId: org,
        files: [fileB, fileA],
      },
      org,
    );

    expect(snapshot1.snapshotId).toBe(snapshot2.snapshotId);
    expect(snapshot1.totalBytes).toBe(snapshot2.totalBytes);
    expect(snapshot1.files.map(f => f.path)).toEqual(['src/Beta.ts', 'src/alpha.ts']);
    expect(snapshot2.files.map(f => f.path)).toEqual(['src/Beta.ts', 'src/alpha.ts']);
  });

  it('fails closed on direct import case mismatch during Express ingestion', async () => {
    const org = 'org_pdet_case';
    const appContent = `import express from 'express';
import { formatOutput } from './Helpers';

export function createApp(db: any) {
  const app = express();
  app.get('/items', handleItems);
  return app;
}

export function handleItems(req: any, res: any) {
}
`;
    const helperContent = `export function formatOutput() {
  return 'ok';
}
`;

    const snapshotWithMismatch = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-pdet-case-dir',
        organizationId: org,
        files: [
          { path: 'src/app.ts', content: appContent },
          { path: 'src/helpers.ts', content: helperContent },
        ],
      },
      org,
    );

    await expect(ingestExpress(snapshotWithMismatch, org)).rejects.toThrow('missing or ambiguous source import');
  });

  it('succeeds when direct import casing matches exactly and produces deterministic route identity', async () => {
    const org = 'org_pdet_case';
    const appContent = `import express from 'express';
import { formatOutput } from './helpers';

export function createApp(db: any) {
  const app = express();
  app.get('/items', handleItems);
  return app;
}

export function handleItems(req: any, res: any) {
}
`;
    const helperContent = `export function formatOutput() {
  return 'ok';
}
`;

    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-pdet-case-dir',
        organizationId: org,
        files: [
          { path: 'src/app.ts', content: appContent },
          { path: 'src/helpers.ts', content: helperContent },
        ],
      },
      org,
    );

    const ingestion = await ingestExpress(snapshot, org);
    expect(ingestion.routes).toHaveLength(1);
    expect(ingestion.routes[0].method).toBe('GET');
    expect(ingestion.routes[0].path).toBe('/items');
    expect(ingestion.routes[0].routeIdentity).toMatch(/^sha256:[a-f0-9]{64}$/);

    const validated = await validateExpressIngestion(ingestion, org);
    expect(validated.ingestionIdentity).toBe(ingestion.ingestionIdentity);
  });

  it('executes analysis deterministically and confirms non-authoritative candidate boundary', async () => {
    const org = 'org_pdet_case';
    const appContent = `import express from 'express';
import { formatOutput } from './helpers';

export function createApp(db: any) {
  const app = express();
  app.get('/items', handleItems);
  return app;
}

export function handleItems(req: any, res: any) {
}
`;
    const helperContent = `export function formatOutput() {
  return 'ok';
}
`;

    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-pdet-case-dir',
        organizationId: org,
        files: [
          { path: 'src/app.ts', content: appContent },
          { path: 'src/helpers.ts', content: helperContent },
        ],
      },
      org,
    );

    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);

    expect(analysis.status).toBe('NOT_DETECTED');
    expect(analysis.findings).toHaveLength(0);
    expect(analysis.limitations).toHaveLength(0);

    const validated = await validateSqlAnalysis(analysis, snapshot, ingestion, org);
    expect(validated.resultFingerprint).toBe(analysis.resultFingerprint);

    const bridge = createSqlCandidateBridge(async () => 'a'.repeat(40));
    const hypotheses = await bridge(analysis, snapshot, ingestion, org);
    expect(hypotheses).toEqual([]);
  });
});
