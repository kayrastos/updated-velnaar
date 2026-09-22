import { describe, it, expect } from 'vitest';
import {
  captureSnapshot,
  validateSnapshot,
  hash,
} from '../../../../worker/intelligence/ingestion/snapshot';
import {
  ingestExpress,
  validateExpressIngestion,
} from '../../../../worker/intelligence/ingestion/express';
import {
  detectSqlInjection,
} from '../../../../worker/intelligence/detection/sqlInjection';
import {
  createSqlCandidateBridge,
} from '../../../../worker/intelligence/detection/candidate';
import {
  validateRepositoryIngestion,
  assertTrustedCommitCapability,
  isTrustedCommitCapability,
} from '../../../../worker/intelligence/ingestion/repository';

const org = 'org_chat4_multi';
const repoId = 'repo-cap-mal-multi';
const validCommitSha = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';

const validSource = `import express from 'express';

export function createApp(db: any) {
  const app = express();
  function queryHandler(req: any, res: any) {
    const userInput = req.query.id;
    const stmt = db.prepare('SELECT * FROM items WHERE id = ' + userInput);
    const rows = stmt.all();
    res.json(rows);
  }
  app.get('/items', queryHandler);
  return app;
}
`;

describe('Multi-Stage Capability Enforcement on Malformed Inputs', () => {
  it('valid multi-stage pipeline produces candidate hypotheses while preserving non-authoritative boundary', async () => {
    const snapshot = await captureSnapshot({
      fixtureId: 'm2-case-001',
      repositoryId: repoId,
      organizationId: org,
      files: [{ path: 'src/app.ts', content: validSource }],
    }, org);

    const expressIngestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
    expect(analysis.status).toBe('DETECTED');
    expect(analysis.findings.length).toBe(1);

    const bridge = createSqlCandidateBridge(async (snap) => {
      expect(snap.snapshotId).toBe(snapshot.snapshotId);
      return validCommitSha;
    });

    const candidates = await bridge(analysis, snapshot, expressIngestion, org);
    expect(candidates.length).toBe(1);
    expect(candidates[0].candidate.verificationState).toBe('CANDIDATE');
    expect(candidates[0].candidate.reachabilityState).toBe('REACHABLE');
    expect(candidates[0].candidate.vulnerabilityClass).toBe('SQL_INJECTION');

    expect(isTrustedCommitCapability(candidates[0].candidate, null as any)).toBe(false);
    expect(() => assertTrustedCommitCapability(candidates[0].candidate, null as any)).toThrow('unauthorized commit capability');
  });

  it('refuses forged or tampered commit capability objects across pipeline boundaries', async () => {
    const snapshot = await captureSnapshot({
      fixtureId: 'm2-case-001',
      repositoryId: repoId,
      organizationId: org,
      files: [{ path: 'src/app.ts', content: validSource }],
    }, org);

    const ingestionBody = {
      version: 'velnar-repository-ingestion-v1' as const,
      organizationId: org,
      repositoryId: repoId,
      commitSha: validCommitSha,
      snapshot,
    };
    const ingestionIdentity = await hash('velnar-repository-ingestion-v1', ingestionBody);
    const repositoryIngestion = {
      ...ingestionBody,
      ingestionIdentity,
    };

    const validated = await validateRepositoryIngestion(repositoryIngestion, org);
    expect((validated as any).capability).toBeUndefined();

    const forgedCapability = Object.freeze({
      [Symbol.toStringTag]: 'TrustedCommitCapability' as const,
    });

    expect(isTrustedCommitCapability(forgedCapability, validated)).toBe(false);
    expect(() => assertTrustedCommitCapability(forgedCapability, validated)).toThrow('unauthorized commit capability');

    expect(isTrustedCommitCapability(null, validated)).toBe(false);
    expect(isTrustedCommitCapability(undefined, validated)).toBe(false);
    expect(isTrustedCommitCapability('capability-string', validated)).toBe(false);
    expect(() => assertTrustedCommitCapability(null, validated)).toThrow('unauthorized commit capability');
  });

  it('rejects malformed commit SHA in repository validation and candidate bridge stages', async () => {
    const snapshot = await captureSnapshot({
      fixtureId: 'm2-case-001',
      repositoryId: repoId,
      organizationId: org,
      files: [{ path: 'src/app.ts', content: validSource }],
    }, org);

    const expressIngestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);

    const allZerosBridge = createSqlCandidateBridge(async () => '0'.repeat(40));
    await expect(allZerosBridge(analysis, snapshot, expressIngestion, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const shortShaBridge = createSqlCandidateBridge(async () => 'deadbeef');
    await expect(shortShaBridge(analysis, snapshot, expressIngestion, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const nonHexBridge = createSqlCandidateBridge(async () => 'z'.repeat(40));
    await expect(nonHexBridge(analysis, snapshot, expressIngestion, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const malformedRepoIngestion = {
      version: 'velnar-repository-ingestion-v1',
      organizationId: org,
      repositoryId: repoId,
      commitSha: '0'.repeat(40),
      snapshot,
      ingestionIdentity: 'sha256:placeholder',
    };
    await expect(validateRepositoryIngestion(malformedRepoIngestion, org)).rejects.toThrow();
  });

  it('fails closed when malformed or mismatched snapshot propagates through multi-stage analysis', async () => {
    const snapshotA = await captureSnapshot({
      fixtureId: 'm2-case-001',
      repositoryId: repoId,
      organizationId: org,
      files: [{ path: 'src/app.ts', content: validSource }],
    }, org);

    const snapshotB = await captureSnapshot({
      fixtureId: 'm2-case-002',
      repositoryId: repoId,
      organizationId: org,
      files: [{ path: 'src/app.ts', content: validSource }],
    }, org);

    const expressIngestionA = await ingestExpress(snapshotA, org);

    await expect(detectSqlInjection(snapshotB, expressIngestionA, org)).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');

    const forgedSnapshot = {
      ...snapshotA,
      snapshotId: 'sha256:forged_snapshot_id_000000000000000000000000000000000000000000000',
    };
    await expect(validateSnapshot(forgedSnapshot, org)).rejects.toThrow('snapshot integrity mismatch');

    await expect(captureSnapshot({
      fixtureId: 'm2-case-001',
      repositoryId: repoId,
      organizationId: org,
      files: [{ path: '../outside.ts', content: 'export const x = 1;\n' }],
    }, org)).rejects.toThrow();
  });

  it('rejects tampered analysis fingerprints and malformed express ingestion metadata in candidate bridge', async () => {
    const snapshot = await captureSnapshot({
      fixtureId: 'm2-case-001',
      repositoryId: repoId,
      organizationId: org,
      files: [{ path: 'src/app.ts', content: validSource }],
    }, org);

    const expressIngestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);

    const bridge = createSqlCandidateBridge(async () => validCommitSha);

    const tamperedAnalysis = {
      ...analysis,
      resultFingerprint: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    };
    await expect(bridge(tamperedAnalysis, snapshot, expressIngestion, org)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');

    const tamperedExpressIngestion = {
      ...expressIngestion,
      ingestionIdentity: 'sha256:forged_express_identity_0000000000000000000000000000000000000000',
    };
    await expect(validateExpressIngestion(tamperedExpressIngestion as any, org)).rejects.toThrow('ingestion metadata mismatch');
    await expect(bridge(analysis, snapshot, tamperedExpressIngestion as any, org)).rejects.toThrow('ingestion metadata mismatch');
  });
});
