import { describe, it, expect } from 'vitest';
import { captureSnapshot, validateSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress, validateExpressIngestion } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';

describe('RM_PDET_EMPTY_CROSS: pipeline determinism null-empty cross-file integration', () => {
  const organizationId = 'org_chat4';
  const input = {
    fixtureId: 'm2-case-001',
    repositoryId: 'repo-pdet-empty-cross',
    organizationId,
    files: [
      {
        path: 'src/helper.ts',
        content: 'export function getSafeQuery(req) {\n  const query = "SELECT id, title FROM records WHERE active = 1";\n  return query;\n}\n',
      },
      {
        path: 'src/app.ts',
        content: 'import express from "express";\nimport { getSafeQuery } from "./helper";\n\nexport function createApp(db) {\n  const app = express();\n  function handler(req, res) {\n    const q = getSafeQuery(req);\n    const stmt = db.prepare(q);\n    const rows = stmt.all();\n    res.json(rows);\n  }\n  app.get("/records", handler);\n  return app;\n}\n',
      },
    ],
  };

  it('preserves determinism and null finding boundary across multiple files without taint flow', async () => {
    const run1Snapshot = await captureSnapshot(input, organizationId);
    const run1Ingestion = await ingestExpress(run1Snapshot, organizationId);
    const run1Analysis = await detectSqlInjection(run1Snapshot, run1Ingestion, organizationId);

    const run2Snapshot = await captureSnapshot(input, organizationId);
    const run2Ingestion = await ingestExpress(run2Snapshot, organizationId);
    const run2Analysis = await detectSqlInjection(run2Snapshot, run2Ingestion, organizationId);

    expect(run1Snapshot.snapshotId).toBe(run2Snapshot.snapshotId);
    expect(run1Ingestion.ingestionIdentity).toBe(run2Ingestion.ingestionIdentity);
    expect(run1Analysis.resultFingerprint).toBe(run2Analysis.resultFingerprint);

    expect(run1Analysis.status).toBe('NOT_DETECTED');
    expect(run1Analysis.findings).toHaveLength(0);
    expect(run1Analysis.limitations).toHaveLength(0);

    const validatedSnapshot = await validateSnapshot(run1Snapshot, organizationId);
    expect(validatedSnapshot.snapshotId).toBe(run1Snapshot.snapshotId);

    const validatedIngestion = await validateExpressIngestion(run1Ingestion, organizationId);
    expect(validatedIngestion.ingestionIdentity).toBe(run1Ingestion.ingestionIdentity);

    const validatedAnalysis = await validateSqlAnalysis(run1Analysis, run1Snapshot, run1Ingestion, organizationId);
    expect(validatedAnalysis.resultFingerprint).toBe(run1Analysis.resultFingerprint);
  });

  it('enforces null candidate boundary and prevents commit verification when analysis is clean', async () => {
    const snapshot = await captureSnapshot(input, organizationId);
    const ingestion = await ingestExpress(snapshot, organizationId);
    const analysis = await detectSqlInjection(snapshot, ingestion, organizationId);

    expect(analysis.status).toBe('NOT_DETECTED');

    let commitVerificationAttempted = false;
    const bridge = createSqlCandidateBridge(async (): Promise<string> => {
      commitVerificationAttempted = true;
      return '1111111111111111111111111111111111111111';
    });

    const candidates = await bridge(analysis, snapshot, ingestion, organizationId);
    expect(candidates).toHaveLength(0);
    expect(Object.isFrozen(candidates)).toBe(true);
    expect(commitVerificationAttempted).toBe(false);
  });

  it('guarantees deterministic snapshot identity regardless of input file declaration ordering', async () => {
    const permutedInput = {
      ...input,
      files: [input.files[1], input.files[0]],
    };

    const snapshotCanonical = await captureSnapshot(input, organizationId);
    const snapshotPermuted = await captureSnapshot(permutedInput, organizationId);

    expect(snapshotCanonical.snapshotId).toBe(snapshotPermuted.snapshotId);
    expect(snapshotCanonical.totalBytes).toBe(snapshotPermuted.totalBytes);
  });
});
