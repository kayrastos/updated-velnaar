import { describe, it, expect } from 'vitest';
import { hash, captureSnapshot, validateSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress, validateExpressIngestion } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import {
  validateRepositoryIngestion,
  isTrustedCommitCapability,
  assertTrustedCommitCapability,
} from '../../../../worker/intelligence/ingestion/repository';

describe('Roadmap Chat-4 Cap Order Cross: Capability Enforcement and Order Stability Across Files', () => {
  const org = 'org_chat4_order_cross';
  const repo = 'repo-cap-order-cross';
  const fixture = 'm2-case-001';
  const commitSha = 'a'.repeat(40);

  const helperSource = `export function buildQuery(tableName: string): string {
  return 'SELECT id FROM ' + tableName;
}
`;

  const routesSource = `import express from 'express';
import { buildQuery } from './helper';

export function createApp(db: any) {
  const app = express();
  function handleData(req: any, res: any) {
    const table = req.query.table;
    const q = buildQuery(table);
    const stmt = db.prepare(q);
    const rows = stmt.all();
    return res.json(rows);
  }
  app.get('/data', handleData);
  return app;
}
`;

  it('enforces snapshot and express ingestion order stability across cross-file permutation', async () => {
    const fileA = { path: 'src/helper.ts', content: helperSource };
    const fileB = { path: 'src/routes.ts', content: routesSource };

    const snapshotAB = await captureSnapshot(
      { fixtureId: fixture, repositoryId: repo, organizationId: org, files: [fileA, fileB] },
      org,
    );
    const snapshotBA = await captureSnapshot(
      { fixtureId: fixture, repositoryId: repo, organizationId: org, files: [fileB, fileA] },
      org,
    );

    expect(snapshotAB.snapshotId).toBe(snapshotBA.snapshotId);
    expect(snapshotAB.totalBytes).toBe(snapshotBA.totalBytes);
    expect(snapshotAB.files.map((f) => f.path)).toEqual(['src/helper.ts', 'src/routes.ts']);
    expect(snapshotBA.files.map((f) => f.path)).toEqual(['src/helper.ts', 'src/routes.ts']);

    const validatedSnapshot = await validateSnapshot(snapshotBA, org);
    expect(validatedSnapshot.snapshotId).toBe(snapshotAB.snapshotId);

    const expressAB = await ingestExpress(snapshotAB, org);
    const expressBA = await ingestExpress(snapshotBA, org);

    expect(expressAB.ingestionIdentity).toBe(expressBA.ingestionIdentity);
    expect(expressAB.routes.length).toBe(1);
    expect(expressAB.routes[0].routeIdentity).toBe(expressBA.routes[0].routeIdentity);
    expect(expressAB.routes[0].path).toBe('/data');
    expect(expressAB.routes[0].method).toBe('GET');

    const validatedExpress = await validateExpressIngestion(expressBA, org);
    expect(validatedExpress.ingestionIdentity).toBe(expressAB.ingestionIdentity);
  });

  it('preserves SQL injection detection determinism across cross-file snapshot ordering', async () => {
    const fileA = { path: 'src/helper.ts', content: helperSource };
    const fileB = { path: 'src/routes.ts', content: routesSource };

    const snapshotAB = await captureSnapshot(
      { fixtureId: fixture, repositoryId: repo, organizationId: org, files: [fileA, fileB] },
      org,
    );
    const snapshotBA = await captureSnapshot(
      { fixtureId: fixture, repositoryId: repo, organizationId: org, files: [fileB, fileA] },
      org,
    );

    const expressAB = await ingestExpress(snapshotAB, org);
    const expressBA = await ingestExpress(snapshotBA, org);

    const analysisAB = await detectSqlInjection(snapshotAB, expressAB, org);
    const analysisBA = await detectSqlInjection(snapshotBA, expressBA, org);

    expect(analysisAB.status).toBe('DETECTED');
    expect(analysisBA.status).toBe('DETECTED');
    expect(analysisAB.resultFingerprint).toBe(analysisBA.resultFingerprint);
    expect(analysisAB.findings.length).toBe(1);
    expect(analysisBA.findings.length).toBe(1);
    expect(analysisAB.findings[0].findingId).toBe(analysisBA.findings[0].findingId);

    const validatedAnalysis = await validateSqlAnalysis(analysisBA, snapshotAB, expressAB, org);
    expect(validatedAnalysis.resultFingerprint).toBe(analysisAB.resultFingerprint);
  });

  it('enforces non-authoritative boundary: snapshots, analyses, and records cannot mint or forge commit capability', async () => {
    const fileA = { path: 'src/helper.ts', content: helperSource };
    const fileB = { path: 'src/routes.ts', content: routesSource };

    const snapshot = await captureSnapshot(
      { fixtureId: fixture, repositoryId: repo, organizationId: org, files: [fileA, fileB] },
      org,
    );
    const express = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, express, org);

    expect(isTrustedCommitCapability(snapshot, null as any)).toBe(false);
    expect(isTrustedCommitCapability(express, null as any)).toBe(false);
    expect(isTrustedCommitCapability(analysis, null as any)).toBe(false);

    expect(() => assertTrustedCommitCapability(snapshot, null as any)).toThrow();
    expect(() => assertTrustedCommitCapability(express, null as any)).toThrow();
    expect(() => assertTrustedCommitCapability(analysis, null as any)).toThrow();

    const syntheticCapability = Object.freeze({
      [Symbol.toStringTag]: 'TrustedCommitCapability' as const,
    });
    expect(isTrustedCommitCapability(syntheticCapability, null as any)).toBe(false);
    expect(() => assertTrustedCommitCapability(syntheticCapability, null as any)).toThrow();

    const repoRecordBody = {
      version: 'velnar-repository-ingestion-v1' as const,
      organizationId: org,
      repositoryId: repo,
      commitSha,
      snapshot,
    };
    const ingestionIdentity = await hash('velnar-repository-ingestion-v1', repoRecordBody);
    const repoRecord = {
      ...repoRecordBody,
      ingestionIdentity,
    };

    const validatedRepo = await validateRepositoryIngestion(repoRecord, org);
    expect((validatedRepo as any).capability).toBeUndefined();
    expect(isTrustedCommitCapability((validatedRepo as any).capability, validatedRepo)).toBe(false);
    expect(() => assertTrustedCommitCapability((validatedRepo as any).capability, validatedRepo)).toThrow();
    expect(isTrustedCommitCapability(syntheticCapability, validatedRepo)).toBe(false);
    expect(() => assertTrustedCommitCapability(syntheticCapability, validatedRepo)).toThrow();
  });
});
