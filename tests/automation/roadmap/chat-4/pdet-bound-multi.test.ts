import { describe, it, expect } from 'vitest';
import {
  captureSnapshot,
  validateSnapshot,
  type SourceSnapshot,
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
import {
  isTrustedCommitCapability,
  assertTrustedCommitCapability,
} from '../../../../worker/intelligence/ingestion/repository';

const org = 'org_pdet_multi';
const repoId = 'repo-pdet-multi';

const vulnSource = `import express from 'express';

export function createApp(db: any) {
  const app = express();
  function handleUsers(req: any, res: any) {
    const id = req.query.id;
    const q = 'SELECT * FROM users WHERE id = ' + id;
    const stmt = db.prepare(q);
    const rows = stmt.all();
    return res.json(rows);
  }
  app.get('/users', handleUsers);
  return app;
}
`;

const safeSource = `import express from 'express';

export function createApp(db: any) {
  const app = express();
  function handleSafe(req: any, res: any) {
    const stmt = db.prepare('SELECT 1');
    const rows = stmt.all();
    return res.json(rows);
  }
  app.get('/safe', handleSafe);
  return app;
}
`;

async function buildSnapshot(fixtureId: string, content: string, organizationId = org): Promise<SourceSnapshot> {
  return captureSnapshot(
    {
      fixtureId,
      repositoryId: repoId,
      organizationId,
      files: [
        {
          path: 'src/app.ts',
          content,
        },
      ],
    },
    organizationId,
  );
}

describe('V1 Pipeline Determinism Multi-Stage Boundary Rejection', () => {
  it('deterministically propagates through all stages while keeping findings strictly non-authoritative', async () => {
    const snapshot1 = await buildSnapshot('m2-case-001', vulnSource);
    const expressIngestion1 = await ingestExpress(snapshot1, org);
    const analysis1 = await detectSqlInjection(snapshot1, expressIngestion1, org);

    expect(analysis1.status).toBe('DETECTED');
    expect(analysis1.findings).toHaveLength(1);

    const validCommitSha = 'a'.repeat(40);
    const bridge = createSqlCandidateBridge(async () => validCommitSha);
    const candidates1 = await bridge(analysis1, snapshot1, expressIngestion1, org);

    expect(candidates1).toHaveLength(1);
    const hypothesis1 = candidates1[0];
    expect(hypothesis1.candidate.verificationState).toBe('CANDIDATE');
    expect(hypothesis1.candidate.reachabilityState).toBe('REACHABLE');
    expect(hypothesis1.candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(hypothesis1.candidate.snapshot.commitSha).toBe(validCommitSha);
    expect(typeof hypothesis1.candidateBinding).toBe('string');

    // Authority boundary: candidate finding does NOT possess runtime commit capability
    expect(isTrustedCommitCapability(hypothesis1.candidate, {} as any)).toBe(false);
    expect(() => assertTrustedCommitCapability(hypothesis1.candidate, {} as any)).toThrow('unauthorized commit capability');

    // Determinism: rerun pipeline from identical inputs produces identical results
    const snapshot2 = await buildSnapshot('m2-case-001', vulnSource);
    const expressIngestion2 = await ingestExpress(snapshot2, org);
    const analysis2 = await detectSqlInjection(snapshot2, expressIngestion2, org);
    const candidates2 = await bridge(analysis2, snapshot2, expressIngestion2, org);

    expect(snapshot1.snapshotId).toBe(snapshot2.snapshotId);
    expect(expressIngestion1.ingestionIdentity).toBe(expressIngestion2.ingestionIdentity);
    expect(analysis1.resultFingerprint).toBe(analysis2.resultFingerprint);
    expect(candidates1[0].candidateBinding).toBe(candidates2[0].candidateBinding);

    // Safe app produces NOT_DETECTED and empty candidate list
    const safeSnapshot = await buildSnapshot('m2-case-002', safeSource);
    const safeIngestion = await ingestExpress(safeSnapshot, org);
    const safeAnalysis = await detectSqlInjection(safeSnapshot, safeIngestion, org);
    expect(safeAnalysis.status).toBe('NOT_DETECTED');
    expect(safeAnalysis.findings).toHaveLength(0);

    const safeCandidates = await bridge(safeAnalysis, safeSnapshot, safeIngestion, org);
    expect(safeCandidates).toHaveLength(0);
    expect(Object.isFrozen(safeCandidates)).toBe(true);
  });

  it('rejects cross-stage snapshot mismatch between snapshot and express ingestion (M3_ANALYSIS_SNAPSHOT_MISMATCH)', async () => {
    const snapshotA = await buildSnapshot('m2-case-001', vulnSource);
    const snapshotB = await buildSnapshot('m2-case-002', safeSource);
    const ingestionB = await ingestExpress(snapshotB, org);

    // Stage 3 detector rejects mismatched snapshot input
    await expect(detectSqlInjection(snapshotA, ingestionB, org)).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');

    // Stage 4 candidate bridge also rejects mismatched snapshot input
    const analysisB = await detectSqlInjection(snapshotB, ingestionB, org);
    const bridge = createSqlCandidateBridge(async () => 'a'.repeat(40));
    await expect(bridge(analysisB, snapshotA, ingestionB, org)).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
  });

  it('rejects tampered analysis at Stage 3 and Stage 4 boundary (M3_ANALYSIS_INTEGRITY_MISMATCH)', async () => {
    const snapshot = await buildSnapshot('m2-case-001', vulnSource);
    const ingestion = await ingestExpress(snapshot, org);
    const genuineAnalysis = await detectSqlInjection(snapshot, ingestion, org);

    // Forged status
    const forgedAnalysis = {
      ...genuineAnalysis,
      status: 'NOT_DETECTED',
    };

    await expect(validateSqlAnalysis(forgedAnalysis, snapshot, ingestion, org)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');

    const bridge = createSqlCandidateBridge(async () => 'a'.repeat(40));
    await expect(bridge(forgedAnalysis, snapshot, ingestion, org)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
  });

  it('rejects invalid or unverified commit provenance at candidate bridge boundary (M3_CHECKED_COMMIT_REQUIRED)', async () => {
    const snapshot = await buildSnapshot('m2-case-001', vulnSource);
    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);

    // Zero-filled commit SHA refused
    const zeroShaBridge = createSqlCandidateBridge(async () => '0'.repeat(40));
    await expect(zeroShaBridge(analysis, snapshot, ingestion, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    // Malformed commit SHA refused
    const invalidShaBridge = createSqlCandidateBridge(async () => 'not-a-valid-sha');
    await expect(invalidShaBridge(analysis, snapshot, ingestion, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    // Non-string commit refused
    const nonStringBridge = createSqlCandidateBridge(async () => null as unknown as string);
    await expect(nonStringBridge(analysis, snapshot, ingestion, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
  });

  it('enforces tenant boundary isolation across all pipeline stages', async () => {
    const snapshot = await buildSnapshot('m2-case-001', vulnSource);
    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);
    const bridge = createSqlCandidateBridge(async () => 'a'.repeat(40));
    const foreignTenant = 'org_foreign_attacker';

    await expect(validateSnapshot(snapshot, foreignTenant)).rejects.toThrow('tenant mismatch');
    await expect(ingestExpress(snapshot, foreignTenant)).rejects.toThrow('tenant mismatch');
    await expect(validateExpressIngestion(ingestion, foreignTenant)).rejects.toThrow('tenant mismatch');
    await expect(detectSqlInjection(snapshot, ingestion, foreignTenant)).rejects.toThrow('tenant mismatch');
    await expect(validateSqlAnalysis(analysis, snapshot, ingestion, foreignTenant)).rejects.toThrow('tenant mismatch');
    await expect(bridge(analysis, snapshot, ingestion, foreignTenant)).rejects.toThrow('tenant mismatch');
  });
});
