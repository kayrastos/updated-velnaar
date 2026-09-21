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
  validateSqlAnalysis,
} from '../../../../worker/intelligence/detection/sqlInjection';
import {
  createSqlCandidateBridge,
} from '../../../../worker/intelligence/detection/candidate';
import {
  validateRepositoryIngestion,
  isTrustedCommitCapability,
  assertTrustedCommitCapability,
} from '../../../../worker/intelligence/ingestion/repository';

const org = 'org_pdet';
const validVulnerableSource = `import express from 'express';

export function createApp(db: any) {
  const app = express();
  function getUser(req: any, res: any) {
    const id = req.query.id;
    const query = "SELECT * FROM users WHERE id = " + id;
    const statement = db.prepare(query);
    const rows = statement.all();
    return res.json(rows);
  }
  app.get('/users', getUser);
  return app;
}
`;

describe('Chat-4 Multi-Stage Pipeline Determinism & Adversarial Edge Cases', () => {
  it('executes the full multi-stage intelligence pipeline deterministically across repeated runs', async () => {
    const runPipeline = async () => {
      const snapshot = await captureSnapshot({
        fixtureId: 'm2-case-001',
        repositoryId: 'repo_pdet_multi',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: validVulnerableSource }],
      }, org);

      const expressIngestion = await ingestExpress(snapshot, org);
      const analysis = await detectSqlInjection(snapshot, expressIngestion, org);

      const bridge = createSqlCandidateBridge(async () => 'a'.repeat(40));
      const candidates = await bridge(analysis, snapshot, expressIngestion, org);

      return { snapshot, expressIngestion, analysis, candidates };
    };

    const run1 = await runPipeline();
    const run2 = await runPipeline();

    expect(run1.snapshot.snapshotId).toBe(run2.snapshot.snapshotId);
    expect(run1.expressIngestion.ingestionIdentity).toBe(run2.expressIngestion.ingestionIdentity);
    expect(run1.analysis.resultFingerprint).toBe(run2.analysis.resultFingerprint);
    expect(run1.candidates).toHaveLength(1);
    expect(run2.candidates).toHaveLength(1);
    expect(run1.candidates[0].candidateBinding).toBe(run2.candidates[0].candidateBinding);
    expect(run1.candidates[0].candidate.candidateId).toBe(run2.candidates[0].candidate.candidateId);

    expect(run1.candidates[0].candidate.verificationState).toBe('CANDIDATE');
    expect(run1.candidates[0].candidate.reachabilityState).toBe('REACHABLE');
    expect(run1.candidates[0].candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect((run1.candidates[0].candidate as any).verified).toBeUndefined();
    expect((run1.candidates[0].candidate as any).capability).toBeUndefined();
  });

  it('fails closed when snapshot mismatch occurs between express ingestion and detection stages', async () => {
    const snapshotA = await captureSnapshot({
      fixtureId: 'm2-case-001',
      repositoryId: 'repo_pdet_a',
      organizationId: org,
      files: [{ path: 'src/app.ts', content: validVulnerableSource }],
    }, org);

    const snapshotB = await captureSnapshot({
      fixtureId: 'm2-case-002',
      repositoryId: 'repo_pdet_b',
      organizationId: org,
      files: [{ path: 'src/app.ts', content: validVulnerableSource }],
    }, org);

    const ingestionA = await ingestExpress(snapshotA, org);

    await expect(
      detectSqlInjection(snapshotB, ingestionA, org),
    ).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');

    const analysisA = await detectSqlInjection(snapshotA, ingestionA, org);
    const bridge = createSqlCandidateBridge(async () => 'a'.repeat(40));

    await expect(
      bridge(analysisA, snapshotB, ingestionA, org),
    ).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
  });

  it('rejects tampered intermediate artifacts across all verification boundaries', async () => {
    const snapshot = await captureSnapshot({
      fixtureId: 'm2-case-001',
      repositoryId: 'repo_pdet_tamper',
      organizationId: org,
      files: [{ path: 'src/app.ts', content: validVulnerableSource }],
    }, org);

    const expressIngestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);

    const tamperedSnapshot = { ...snapshot, snapshotId: 'sha256:' + '0'.repeat(64) };
    await expect(validateSnapshot(tamperedSnapshot, org)).rejects.toThrow('snapshot integrity mismatch');

    const tamperedIngestion = { ...expressIngestion, ingestionIdentity: 'sha256:' + '0'.repeat(64) };
    await expect(validateExpressIngestion(tamperedIngestion, org)).rejects.toThrow('ingestion metadata mismatch');

    const tamperedAnalysis = { ...analysis, resultFingerprint: 'sha256:' + '0'.repeat(64) };
    await expect(validateSqlAnalysis(tamperedAnalysis, snapshot, expressIngestion, org)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
  });

  it('enforces host commit verification boundaries in the candidate bridge', async () => {
    const snapshot = await captureSnapshot({
      fixtureId: 'm2-case-001',
      repositoryId: 'repo_pdet_commit',
      organizationId: org,
      files: [{ path: 'src/app.ts', content: validVulnerableSource }],
    }, org);

    const expressIngestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);

    const invalidShaBridge = createSqlCandidateBridge(async () => 'invalid-sha');
    await expect(invalidShaBridge(analysis, snapshot, expressIngestion, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const allZerosShaBridge = createSqlCandidateBridge(async () => '0'.repeat(40));
    await expect(allZerosShaBridge(analysis, snapshot, expressIngestion, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const failingShaBridge = createSqlCandidateBridge(async () => {
      throw new Error('Host commit verification failed closed');
    });
    await expect(failingShaBridge(analysis, snapshot, expressIngestion, org)).rejects.toThrow('Host commit verification failed closed');
  });

  it('maintains strict tenant isolation across all multi-stage boundaries', async () => {
    const snapshot = await captureSnapshot({
      fixtureId: 'm2-case-001',
      repositoryId: 'repo_pdet_tenant',
      organizationId: org,
      files: [{ path: 'src/app.ts', content: validVulnerableSource }],
    }, org);

    const expressIngestion = await ingestExpress(snapshot, org);

    await expect(captureSnapshot({
      fixtureId: 'm2-case-001',
      repositoryId: 'repo_pdet_tenant',
      organizationId: 'other_org',
      files: [{ path: 'src/app.ts', content: validVulnerableSource }],
    }, org)).rejects.toThrow('tenant mismatch');

    await expect(validateSnapshot(snapshot, 'foreign_org')).rejects.toThrow('tenant mismatch');
    await expect(validateExpressIngestion(expressIngestion, 'foreign_org')).rejects.toThrow('tenant mismatch');
    await expect(detectSqlInjection(snapshot, expressIngestion, 'foreign_org')).rejects.toThrow('tenant mismatch');
  });

  it('handles adversarial unsupported constructs by failing safely to ANALYSIS_INCONCLUSIVE without candidate emission', async () => {
    const inconclusiveSource = `import express from 'express';

export function createApp(db: any) {
  const app = express();
  function handler(req: any, res: any) {
    let id = req.query.id;
    const stmt = db.prepare("SELECT * FROM users WHERE id = " + id);
    const rows = stmt.all();
    return res.json(rows);
  }
  app.get('/users', handler);
  return app;
}
`;

    const incSnapshot = await captureSnapshot({
      fixtureId: 'm2-case-003',
      repositoryId: 'repo_pdet_inc',
      organizationId: org,
      files: [{ path: 'src/app.ts', content: inconclusiveSource }],
    }, org);

    const incIngestion = await ingestExpress(incSnapshot, org);
    const incAnalysis = await detectSqlInjection(incSnapshot, incIngestion, org);

    expect(incAnalysis.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(incAnalysis.findings).toHaveLength(0);
    expect(incAnalysis.limitations.length).toBeGreaterThan(0);
    expect(incAnalysis.limitations[0].code).toBe('UNSUPPORTED_STATEMENT');

    const bridge = createSqlCandidateBridge(async () => 'a'.repeat(40));
    const incCandidates = await bridge(incAnalysis, incSnapshot, incIngestion, org);
    expect(incCandidates).toEqual([]);
  });

  it('preserves non-authoritative boundaries for repository ingestion validation', async () => {
    const snapshot = await captureSnapshot({
      fixtureId: 'm2-case-001',
      repositoryId: 'repo_pdet_prov',
      organizationId: org,
      files: [{ path: 'src/app.ts', content: validVulnerableSource }],
    }, org);

    const repoBody = {
      version: 'velnar-repository-ingestion-v1' as const,
      organizationId: org,
      repositoryId: 'repo_pdet_prov',
      commitSha: 'b'.repeat(40),
      snapshot,
    };
    const ingestionIdentity = await hash('velnar-repository-ingestion-v1', repoBody);
    const repoIngestion = { ...repoBody, ingestionIdentity };

    const validatedRepo = await validateRepositoryIngestion(repoIngestion, org);
    expect(validatedRepo.ingestionIdentity).toBe(ingestionIdentity);
    expect(validatedRepo.commitSha).toBe('b'.repeat(40));

    expect(isTrustedCommitCapability({}, validatedRepo)).toBe(false);
    expect(() => assertTrustedCommitCapability({}, validatedRepo)).toThrow('unauthorized commit capability');

    await expect(
      validateRepositoryIngestion({ ...repoIngestion, commitSha: '0'.repeat(40) }, org),
    ).rejects.toThrow('Git commit identity');

    await expect(
      validateRepositoryIngestion({ ...repoIngestion, ingestionIdentity: 'sha256:' + 'e'.repeat(64) }, org),
    ).rejects.toThrow('ingestion identity mismatch');
  });
});
