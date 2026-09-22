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

const org = 'org_pdet_mal_multi';
const repo = 'repo-pdet-mal-multi';
const fixtureId = 'm2-case-001';

const validSqliSource = `import express from 'express';

export function createApp(db: any) {
  const app = express();
  function handler(req: any, res: any) {
    const id = req.query.id;
    const stmt = db.prepare('SELECT * FROM users WHERE id = ' + id);
    res.json(stmt.all());
  }
  app.get('/users', handler);
  return app;
}
`;

const validSafeSource = `import express from 'express';

export function createApp(db: any) {
  const app = express();
  function safeHandler(req: any, res: any) {
    const stmt = db.prepare('SELECT id, name FROM users');
    res.json(stmt.all());
  }
  app.get('/users', safeHandler);
  return app;
}
`;

describe('Multi-Stage Pipeline Determinism under Malformed Input', () => {
  it('fails deterministically on malformed Stage 1 snapshot inputs across repeated invocations', async () => {
    const validFiles = [{ path: 'src/app.ts', content: validSqliSource }];

    await expect(
      captureSnapshot({ fixtureId, repositoryId: repo, organizationId: 'wrong_org', files: validFiles }, org),
    ).rejects.toThrow('tenant mismatch');

    await expect(
      captureSnapshot({ fixtureId, repositoryId: repo, organizationId: 'wrong_org', files: validFiles }, org),
    ).rejects.toThrow('tenant mismatch');

    await expect(
      captureSnapshot({ fixtureId: 'invalid-case-id', repositoryId: repo, organizationId: org, files: validFiles }, org),
    ).rejects.toThrow('opaque case identity required');

    await expect(
      captureSnapshot({ fixtureId, repositoryId: repo, organizationId: org, files: [{ path: '../escape.ts', content: 'export const x = 1;' }] }, org),
    ).rejects.toThrow();

    await expect(
      captureSnapshot({ fixtureId, repositoryId: repo, organizationId: org, files: [{ path: 'src/app.ts', content: 'const x = 1;\0' }] }, org),
    ).rejects.toThrow('source content');
  });

  it('fails deterministically at Stage 2 Express ingestion on malformed source structure', async () => {
    const malformedSyntax = `import express from 'express';
export function createApp(db: any) {
  const app = ;
  return app;
}
`;
    const syntaxSnapshot = await captureSnapshot(
      { fixtureId, repositoryId: repo, organizationId: org, files: [{ path: 'src/app.ts', content: malformedSyntax }] },
      org,
    );

    await expect(ingestExpress(syntaxSnapshot, org)).rejects.toThrow('malformed source unit');
    await expect(ingestExpress(syntaxSnapshot, org)).rejects.toThrow('malformed source unit');

    const missingRouteSnapshot = await captureSnapshot(
      { fixtureId, repositoryId: repo, organizationId: org, files: [{ path: 'src/app.ts', content: 'export const val = 1;' }] },
      org,
    );

    await expect(ingestExpress(missingRouteSnapshot, org)).rejects.toThrow('no supported Express route');
    await expect(ingestExpress(missingRouteSnapshot, org)).rejects.toThrow('no supported Express route');
  });

  it('fails deterministically at Stage 3 when snapshot identity is mismatched across stage boundaries', async () => {
    const snapshotA = await captureSnapshot(
      { fixtureId, repositoryId: repo, organizationId: org, files: [{ path: 'src/app.ts', content: validSqliSource }] },
      org,
    );
    const snapshotB = await captureSnapshot(
      { fixtureId, repositoryId: repo, organizationId: org, files: [{ path: 'src/app.ts', content: validSafeSource }] },
      org,
    );

    const ingestionB = await ingestExpress(snapshotB, org);

    expect(snapshotA.snapshotId).not.toBe(snapshotB.snapshotId);

    await expect(detectSqlInjection(snapshotA, ingestionB, org)).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
    await expect(detectSqlInjection(snapshotA, ingestionB, org)).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
  });

  it('fails deterministically at Stage 3 analysis validation on tampered analysis results', async () => {
    const snapshot = await captureSnapshot(
      { fixtureId, repositoryId: repo, organizationId: org, files: [{ path: 'src/app.ts', content: validSqliSource }] },
      org,
    );
    const ingestion = await ingestExpress(snapshot, org);
    const genuineAnalysis = await detectSqlInjection(snapshot, ingestion, org);

    expect(genuineAnalysis.status).toBe('DETECTED');
    expect(genuineAnalysis.findings.length).toBeGreaterThan(0);

    const validated = await validateSqlAnalysis(genuineAnalysis, snapshot, ingestion, org);
    expect(validated.resultFingerprint).toBe(genuineAnalysis.resultFingerprint);

    const tamperedAnalysis = {
      ...genuineAnalysis,
      status: 'NOT_DETECTED',
      findings: [],
    };

    await expect(validateSqlAnalysis(tamperedAnalysis, snapshot, ingestion, org)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
    await expect(validateSqlAnalysis(tamperedAnalysis, snapshot, ingestion, org)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
  });

  it('fails deterministically at Stage 4 on malformed commit provenance while preserving candidate boundary', async () => {
    const snapshot = await captureSnapshot(
      { fixtureId, repositoryId: repo, organizationId: org, files: [{ path: 'src/app.ts', content: validSqliSource }] },
      org,
    );
    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);

    const zeroShaBridge = createSqlCandidateBridge(async () => '0'.repeat(40));
    await expect(zeroShaBridge(analysis, snapshot, ingestion, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
    await expect(zeroShaBridge(analysis, snapshot, ingestion, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const invalidShaBridge = createSqlCandidateBridge(async () => 'not-a-valid-sha');
    await expect(invalidShaBridge(analysis, snapshot, ingestion, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const validCommit = 'c'.repeat(40);
    const validBridge = createSqlCandidateBridge(async () => validCommit);
    const hypotheses1 = await validBridge(analysis, snapshot, ingestion, org);
    const hypotheses2 = await validBridge(analysis, snapshot, ingestion, org);

    expect(hypotheses1.length).toBeGreaterThan(0);
    expect(hypotheses1.length).toBe(hypotheses2.length);
    expect(hypotheses1[0].candidateBinding).toBe(hypotheses2[0].candidateBinding);
    expect(hypotheses1[0].candidate.candidateId).toBe(hypotheses2[0].candidate.candidateId);

    for (const item of hypotheses1) {
      expect(item.candidate.verificationState).toBe('CANDIDATE');
      expect(item.candidate.verificationState).not.toBe('VERIFIED');
    }
  });

  it('preserves multi-stage determinism across clean end-to-end pipelines', async () => {
    const run = async () => {
      const snapshot = await captureSnapshot(
        { fixtureId, repositoryId: repo, organizationId: org, files: [{ path: 'src/app.ts', content: validSqliSource }] },
        org,
      );
      await validateSnapshot(snapshot, org);
      const ingestion = await ingestExpress(snapshot, org);
      await validateExpressIngestion(ingestion, org);
      const analysis = await detectSqlInjection(snapshot, ingestion, org);
      await validateSqlAnalysis(analysis, snapshot, ingestion, org);
      const bridge = createSqlCandidateBridge(async () => 'e'.repeat(40));
      const candidates = await bridge(analysis, snapshot, ingestion, org);
      return {
        snapshotId: snapshot.snapshotId,
        ingestionIdentity: ingestion.ingestionIdentity,
        resultFingerprint: analysis.resultFingerprint,
        candidateBinding: candidates[0]?.candidateBinding,
      };
    };

    const resultA = await run();
    const resultB = await run();

    expect(resultA.snapshotId).toBe(resultB.snapshotId);
    expect(resultA.ingestionIdentity).toBe(resultB.ingestionIdentity);
    expect(resultA.resultFingerprint).toBe(resultB.resultFingerprint);
    expect(resultA.candidateBinding).toBe(resultB.candidateBinding);
  });
});
