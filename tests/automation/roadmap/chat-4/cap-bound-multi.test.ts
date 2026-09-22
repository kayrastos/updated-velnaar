import { describe, it, expect } from 'vitest';
import {
  captureSnapshot,
  validateSnapshot,
  hash,
} from '../../../../worker/intelligence/ingestion/snapshot';
import {
  ingestExpress,
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
  type RepositoryIngestion,
} from '../../../../worker/intelligence/ingestion/repository';

const org = 'org_bound_multi';
const repoId = 'repo-bound-multi';
const fixtureId = 'm2-case-001';
const validCommitSha = '1111111111222222222233333333334444444444';

const canonicalSource = `import express from 'express';

export function createApp(db: any) {
  const app = express();

  function handleSearch(req: any, res: any) {
    const q = req.query.q;
    const query = "SELECT * FROM items WHERE id = '" + q + "'";
    const stmt = db.prepare(query);
    const rows = stmt.all();
    return res.json(rows);
  }

  app.get('/search', handleSearch);
  return app;
}
`;

describe('Multi-Stage Capability Enforcement and Boundary Rejection', () => {
  it('enforces boundary rejection across all pipeline stages without minting unverified capability', async () => {
    // Stage 1: Snapshot Ingestion & Validation
    const snapshot = await captureSnapshot(
      {
        fixtureId,
        repositoryId: repoId,
        organizationId: org,
        files: [
          {
            path: 'src/app.ts',
            content: canonicalSource,
          },
        ],
      },
      org,
    );

    expect(snapshot.snapshotId).toBeDefined();
    expect(snapshot.files).toHaveLength(1);

    // Stage 2: Express Framework Ingestion
    const expressIngestion = await ingestExpress(snapshot, org);
    expect(expressIngestion.routes).toHaveLength(1);
    expect(expressIngestion.routes[0].path).toBe('/search');
    expect(expressIngestion.routes[0].method).toBe('GET');

    // Stage 3: Vulnerability Detection (SQL Injection)
    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
    expect(analysis.status).toBe('DETECTED');
    expect(analysis.findings).toHaveLength(1);

    // Stage 4: Candidate Generation (Non-authoritative hypothesis)
    const bridge = createSqlCandidateBridge(async () => validCommitSha);
    const hypotheses = await bridge(analysis, snapshot, expressIngestion, org);
    expect(hypotheses).toHaveLength(1);

    const hypothesis = hypotheses[0];
    expect(hypothesis.candidate.verificationState).toBe('CANDIDATE');
    expect(hypothesis.candidate.reachabilityState).toBe('REACHABLE');
    expect(hypothesis.candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect((hypothesis.candidate as any).verificationState).not.toBe('VERIFIED');
    expect((hypothesis.candidate as any).capability).toBeUndefined();

    // Stage 5: Capability Enforcement & Boundary Rejection
    const repoBody = {
      version: 'velnar-repository-ingestion-v1' as const,
      organizationId: org,
      repositoryId: repoId,
      commitSha: validCommitSha,
      snapshot,
    };
    const ingestionIdentity = await hash('velnar-repository-ingestion-v1', repoBody);
    const repoRecord: RepositoryIngestion = {
      ...repoBody,
      ingestionIdentity,
    };

    const validatedRepo = await validateRepositoryIngestion(repoRecord, org);
    expect((validatedRepo as any).capability).toBeUndefined();

    // 1. Candidate hypotheses, analysis outputs, snapshots, and Express ingestions reject capability
    expect(isTrustedCommitCapability(hypothesis.candidate, validatedRepo)).toBe(false);
    expect(isTrustedCommitCapability(hypothesis, validatedRepo)).toBe(false);
    expect(isTrustedCommitCapability(analysis, validatedRepo)).toBe(false);
    expect(isTrustedCommitCapability(expressIngestion, validatedRepo)).toBe(false);
    expect(isTrustedCommitCapability(snapshot, validatedRepo)).toBe(false);

    expect(() => assertTrustedCommitCapability(hypothesis.candidate, validatedRepo)).toThrow('unauthorized commit capability');
    expect(() => assertTrustedCommitCapability(analysis, validatedRepo)).toThrow('unauthorized commit capability');
    expect(() => assertTrustedCommitCapability(expressIngestion, validatedRepo)).toThrow('unauthorized commit capability');
    expect(() => assertTrustedCommitCapability(snapshot, validatedRepo)).toThrow('unauthorized commit capability');

    // 2. Forged capability objects fail capability assertion
    const forgedCapability = { [Symbol.toStringTag]: 'TrustedCommitCapability' };
    expect(isTrustedCommitCapability(forgedCapability, validatedRepo)).toBe(false);
    expect(() => assertTrustedCommitCapability(forgedCapability, validatedRepo)).toThrow('unauthorized commit capability');

    // 3. Multi-stage tenant boundary rejection
    await expect(validateSnapshot(snapshot, 'foreign_org')).rejects.toThrow('tenant mismatch');
    await expect(ingestExpress(snapshot, 'foreign_org')).rejects.toThrow('tenant mismatch');
    await expect(detectSqlInjection(snapshot, expressIngestion, 'foreign_org')).rejects.toThrow('tenant mismatch');
    await expect(validateRepositoryIngestion(repoRecord, 'foreign_org')).rejects.toThrow('tenant mismatch');

    // 4. Multi-stage snapshot binding rejection (mismatched snapshot between stages)
    const snapshotMismatch = await captureSnapshot(
      {
        fixtureId,
        repositoryId: 'repo-other',
        organizationId: org,
        files: [
          {
            path: 'src/app.ts',
            content: canonicalSource,
          },
        ],
      },
      org,
    );
    await expect(detectSqlInjection(snapshotMismatch, expressIngestion, org)).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');

    // 5. Analysis integrity and candidate commit boundary rejection
    const forgedAnalysis = {
      ...analysis,
      resultFingerprint: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    };
    await expect(validateSqlAnalysis(forgedAnalysis, snapshot, expressIngestion, org)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
    await expect(bridge(forgedAnalysis, snapshot, expressIngestion, org)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');

    const zeroShaBridge = createSqlCandidateBridge(async () => '0000000000000000000000000000000000000000');
    await expect(zeroShaBridge(analysis, snapshot, expressIngestion, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const malformedShaBridge = createSqlCandidateBridge(async () => 'invalid-commit-sha');
    await expect(malformedShaBridge(analysis, snapshot, expressIngestion, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
  });
});
