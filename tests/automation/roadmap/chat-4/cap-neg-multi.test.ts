import { describe, it, expect } from 'vitest';
import {
  captureSnapshot,
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
} from '../../../../worker/intelligence/ingestion/repository';

describe('Multi-stage capability enforcement negative controls', () => {
  const org = 'org_platform';
  const sampleContent = `import express from 'express';

export function createApp(db: any) {
  const app = express();
  function queryHandler(req: any, res: any) {
    const id = req.query.id;
    const stmt = db.prepare('SELECT * FROM items WHERE id = ' + id);
    return res.json(stmt.all());
  }
  app.get('/items', queryHandler);
  return app;
}
`;

  it('enforces negative control boundaries across all pipeline stages', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-cap-neg',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: sampleContent }],
      },
      org,
    );

    expect(isTrustedCommitCapability(snapshot, snapshot as any)).toBe(false);
    expect(() => assertTrustedCommitCapability(snapshot, snapshot as any)).toThrow();

    const expressIngestion = await ingestExpress(snapshot, org);
    expect(isTrustedCommitCapability(expressIngestion, expressIngestion as any)).toBe(false);
    expect(() => assertTrustedCommitCapability(expressIngestion, expressIngestion as any)).toThrow();

    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
    expect(analysis.status).toBe('DETECTED');
    expect(isTrustedCommitCapability(analysis, analysis as any)).toBe(false);
    expect(() => assertTrustedCommitCapability(analysis, analysis as any)).toThrow();

    const forgedAnalysis = {
      ...analysis,
      status: 'NOT_DETECTED',
      findings: [],
    };
    await expect(
      validateSqlAnalysis(forgedAnalysis, snapshot, expressIngestion, org),
    ).rejects.toThrow();

    const emptyShaBridge = createSqlCandidateBridge(async () => '');
    await expect(
      emptyShaBridge(analysis, snapshot, expressIngestion, org),
    ).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const zeroShaBridge = createSqlCandidateBridge(async () => '0'.repeat(40));
    await expect(
      zeroShaBridge(analysis, snapshot, expressIngestion, org),
    ).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const malformedShaBridge = createSqlCandidateBridge(async () => 'not-a-valid-sha');
    await expect(
      malformedShaBridge(analysis, snapshot, expressIngestion, org),
    ).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const validSha = 'a'.repeat(40);
    const candidateBridge = createSqlCandidateBridge(async () => validSha);
    const hypotheses = await candidateBridge(analysis, snapshot, expressIngestion, org);
    expect(hypotheses.length).toBeGreaterThan(0);

    for (const item of hypotheses) {
      expect(item.candidate.verificationState).toBe('CANDIDATE');
      expect((item.candidate as any).capability).toBeUndefined();
      expect(isTrustedCommitCapability(item.candidate, item.candidate as any)).toBe(false);
      expect(isTrustedCommitCapability(item, item as any)).toBe(false);
      expect(() => assertTrustedCommitCapability(item.candidate, item.candidate as any)).toThrow();
      expect(() => assertTrustedCommitCapability(item.candidateBinding, item as any)).toThrow();
    }

    const repoBody = {
      version: 'velnar-repository-ingestion-v1' as const,
      organizationId: org,
      repositoryId: 'repo-cap-neg',
      commitSha: validSha,
      snapshot,
    };
    const ingestionIdentity = await hash('velnar-repository-ingestion-v1', repoBody);
    const structural = await validateRepositoryIngestion(
      { ...repoBody, ingestionIdentity },
      org,
    );

    expect((structural as any).capability).toBeUndefined();
    expect(isTrustedCommitCapability((structural as any).capability, structural)).toBe(false);
    expect(() => assertTrustedCommitCapability((structural as any).capability, structural)).toThrow();

    const forgedCapability = Object.freeze({
      [Symbol.toStringTag]: 'TrustedCommitCapability' as const,
    });
    expect(isTrustedCommitCapability(forgedCapability, structural)).toBe(false);
    expect(() => assertTrustedCommitCapability(forgedCapability, structural)).toThrow();
  });
});
