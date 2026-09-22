import { describe, it, expect } from 'vitest';
import { captureSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress } from '../../../../worker/intelligence/ingestion/express';
import {
  detectSqlInjection,
  validateSqlAnalysis,
} from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';

const org = 'org_pdet_cross';
const fixtureId = 'm2-case-001';

const COMPLETE_APP_TS = `import express from 'express';
import { buildQuery } from './query';

export function createApp(db: any) {
  const app = express();
  function getItems(req: any, res: any) {
    const q = req.query.id;
    const sql = buildQuery(q);
    const stmt = db.prepare(sql);
    return res.json(stmt.all());
  }
  app.get('/items', getItems);
  return app;
}
`;

const COMPLETE_QUERY_TS = `export function buildQuery(val: any) {
  const prefix = "SELECT * FROM items WHERE id = '";
  return prefix + val + "'";
}
`;

describe('V1 Pipeline Determinism: Partial Input Fail-Closed Cross-File Regressions', () => {
  it('fails closed at Express ingestion when a cross-file import target is missing from snapshot', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId,
        repositoryId: 'repo-part-missing-target',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: COMPLETE_APP_TS }],
      },
      org,
    );

    await expect(ingestExpress(snapshot, org)).rejects.toThrow(
      'missing or ambiguous source import',
    );
  });

  it('fails closed at Express ingestion when a transitive cross-file dependency is missing', async () => {
    const queryWithTransitive = `import { formatTable } from './util';

export function buildQuery(val: any) {
  return "SELECT * FROM " + formatTable() + " WHERE id = '" + val + "'";
}
`;

    const snapshot = await captureSnapshot(
      {
        fixtureId,
        repositoryId: 'repo-part-transitive-missing',
        organizationId: org,
        files: [
          { path: 'src/app.ts', content: COMPLETE_APP_TS },
          { path: 'src/query.ts', content: queryWithTransitive },
        ],
      },
      org,
    );

    await expect(ingestExpress(snapshot, org)).rejects.toThrow(
      'missing or ambiguous source import',
    );
  });

  it('fails closed to ANALYSIS_INCONCLUSIVE with UNSUPPORTED_IMPORT when cross-file export is omitted', async () => {
    const incompleteQueryTs = `export function unusedHelper(val: any) {
  return "SELECT 1";
}
`;

    const snapshot = await captureSnapshot(
      {
        fixtureId,
        repositoryId: 'repo-part-missing-export',
        organizationId: org,
        files: [
          { path: 'src/app.ts', content: COMPLETE_APP_TS },
          { path: 'src/query.ts', content: incompleteQueryTs },
        ],
      },
      org,
    );

    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);

    expect(analysis.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(analysis.findings).toEqual([]);
    expect(analysis.limitations.length).toBeGreaterThan(0);
    expect(analysis.limitations[0].code).toBe('UNSUPPORTED_IMPORT');
  });

  it('fails closed to ANALYSIS_INCONCLUSIVE with UNBOUND_NAME when cross-file helper has unbound identifier', async () => {
    const unboundQueryTs = `export function buildQuery(val: any) {
  const prefix = "SELECT * FROM items WHERE id = '";
  return prefix + missingIdentifier;
}
`;

    const snapshot = await captureSnapshot(
      {
        fixtureId,
        repositoryId: 'repo-part-unbound-ident',
        organizationId: org,
        files: [
          { path: 'src/app.ts', content: COMPLETE_APP_TS },
          { path: 'src/query.ts', content: unboundQueryTs },
        ],
      },
      org,
    );

    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);

    expect(analysis.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(analysis.findings).toEqual([]);
    expect(analysis.limitations.length).toBeGreaterThan(0);
    expect(analysis.limitations[0].code).toBe('UNBOUND_NAME');
  });

  it('fails closed to ANALYSIS_INCONCLUSIVE with UNSUPPORTED_FUNCTION on cross-file parameter arity mismatch', async () => {
    const binaryParamQueryTs = `export function buildQuery(table: any, val: any) {
  return "SELECT * FROM " + table + " WHERE id = '" + val + "'";
}
`;

    const snapshot = await captureSnapshot(
      {
        fixtureId,
        repositoryId: 'repo-part-param-mismatch',
        organizationId: org,
        files: [
          { path: 'src/app.ts', content: COMPLETE_APP_TS },
          { path: 'src/query.ts', content: binaryParamQueryTs },
        ],
      },
      org,
    );

    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);

    expect(analysis.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(analysis.findings).toEqual([]);
    expect(analysis.limitations.length).toBeGreaterThan(0);
    expect(analysis.limitations[0].code).toBe('UNSUPPORTED_FUNCTION');
  });

  it('fails closed to ANALYSIS_INCONCLUSIVE with IMPORT_CYCLE on circular cross-file imports', async () => {
    const cycleAppTs = `import express from 'express';
import { helperA } from './cycleB';

export function createApp(db: any) {
  const app = express();
  function getCycle(req: any, res: any) {
    const q = req.query.id;
    const stmt = db.prepare(helperA(q));
    return res.json(stmt.all());
  }
  app.get('/cycle', getCycle);
  return app;
}
`;

    const cycleBTs = `import { createApp } from './app';

export function helperA(val: any) {
  return "SELECT * FROM t WHERE id = '" + val + "'";
}
`;

    const snapshot = await captureSnapshot(
      {
        fixtureId,
        repositoryId: 'repo-part-import-cycle',
        organizationId: org,
        files: [
          { path: 'src/app.ts', content: cycleAppTs },
          { path: 'src/cycleB.ts', content: cycleBTs },
        ],
      },
      org,
    );

    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);

    expect(analysis.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(analysis.findings).toEqual([]);
    expect(analysis.limitations.length).toBeGreaterThan(0);
    expect(analysis.limitations[0].code).toBe('IMPORT_CYCLE');
  });

  it('refuses to mint candidate hypotheses from partial cross-file inconclusive analyses', async () => {
    const incompleteQueryTs = `export function unused(val: any) {
  return "SELECT 1";
}
`;

    const snapshot = await captureSnapshot(
      {
        fixtureId,
        repositoryId: 'repo-part-bridge-refusal',
        organizationId: org,
        files: [
          { path: 'src/app.ts', content: COMPLETE_APP_TS },
          { path: 'src/query.ts', content: incompleteQueryTs },
        ],
      },
      org,
    );

    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);
    expect(analysis.status).toBe('ANALYSIS_INCONCLUSIVE');

    const commitSha = '1'.repeat(40);
    const bridge = createSqlCandidateBridge(async () => commitSha);
    const candidates = await bridge(analysis, snapshot, ingestion, org);

    expect(candidates).toEqual([]);
    expect(Object.isFrozen(candidates)).toBe(true);
  });

  it('enforces snapshot binding and analysis integrity on cross-snapshot manipulation', async () => {
    const snapshotA = await captureSnapshot(
      {
        fixtureId,
        repositoryId: 'repo-part-binding-a',
        organizationId: org,
        files: [
          { path: 'src/app.ts', content: COMPLETE_APP_TS },
          { path: 'src/query.ts', content: COMPLETE_QUERY_TS },
        ],
      },
      org,
    );

    const snapshotB = await captureSnapshot(
      {
        fixtureId,
        repositoryId: 'repo-part-binding-b',
        organizationId: org,
        files: [
          { path: 'src/app.ts', content: COMPLETE_APP_TS },
          { path: 'src/query.ts', content: COMPLETE_QUERY_TS },
        ],
      },
      org,
    );

    const ingestionA = await ingestExpress(snapshotA, org);
    const ingestionB = await ingestExpress(snapshotB, org);

    await expect(
      detectSqlInjection(snapshotA, ingestionB, org),
    ).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');

    const analysisA = await detectSqlInjection(snapshotA, ingestionA, org);
    const forgedAnalysis = {
      ...analysisA,
      status: 'NOT_DETECTED',
    };

    await expect(
      validateSqlAnalysis(forgedAnalysis, snapshotA, ingestionA, org),
    ).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
  });

  it('refuses candidate minting when commit verification yields zero or malformed SHA', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId,
        repositoryId: 'repo-part-sha-refusal',
        organizationId: org,
        files: [
          { path: 'src/app.ts', content: COMPLETE_APP_TS },
          { path: 'src/query.ts', content: COMPLETE_QUERY_TS },
        ],
      },
      org,
    );

    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);
    expect(analysis.status).toBe('DETECTED');

    const zeroBridge = createSqlCandidateBridge(async () => '0'.repeat(40));
    await expect(
      zeroBridge(analysis, snapshot, ingestion, org),
    ).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const malformedBridge = createSqlCandidateBridge(async () => 'malformed-sha');
    await expect(
      malformedBridge(analysis, snapshot, ingestion, org),
    ).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
  });

  it('maintains strict deterministic replay on partial cross-file input across repeated runs', async () => {
    const incompleteQueryTs = `export function other(val: any) {
  return "SELECT 1";
}
`;

    const snapshot = await captureSnapshot(
      {
        fixtureId,
        repositoryId: 'repo-part-replay-det',
        organizationId: org,
        files: [
          { path: 'src/app.ts', content: COMPLETE_APP_TS },
          { path: 'src/query.ts', content: incompleteQueryTs },
        ],
      },
      org,
    );

    const ingestion = await ingestExpress(snapshot, org);
    const run1 = await detectSqlInjection(snapshot, ingestion, org);
    const run2 = await detectSqlInjection(snapshot, ingestion, org);

    expect(run1.resultFingerprint).toBe(run2.resultFingerprint);
    expect(run1.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run2.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run1.findings).toEqual([]);
    expect(run2.findings).toEqual([]);
    expect(run1.limitations).toEqual(run2.limitations);
    expect(Object.isFrozen(run1)).toBe(true);
    expect(Object.isFrozen(run2)).toBe(true);
  });

  it('demonstrates positive contrast: complete cross-file input succeeds while keeping candidates non-authoritative', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId,
        repositoryId: 'repo-part-contrast-pos',
        organizationId: org,
        files: [
          { path: 'src/app.ts', content: COMPLETE_APP_TS },
          { path: 'src/query.ts', content: COMPLETE_QUERY_TS },
        ],
      },
      org,
    );

    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);

    expect(analysis.status).toBe('DETECTED');
    expect(analysis.findings).toHaveLength(1);
    expect(analysis.limitations).toHaveLength(0);

    const genuineCommitSha = 'a'.repeat(40);
    const bridge = createSqlCandidateBridge(async () => genuineCommitSha);
    const hypotheses = await bridge(analysis, snapshot, ingestion, org);

    expect(hypotheses).toHaveLength(1);
    const item = hypotheses[0];
    expect(item.candidate.verificationState).toBe('CANDIDATE');
    expect((item.candidate as any).verificationState).not.toBe('VERIFIED');
    expect(item.candidate.reachabilityState).toBe('REACHABLE');
    expect(item.candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(item.candidateBinding).toBeDefined();
    expect(typeof item.candidateBinding).toBe('string');
  });
});
