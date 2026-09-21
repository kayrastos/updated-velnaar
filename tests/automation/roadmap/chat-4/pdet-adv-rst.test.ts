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
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';

const sqliAppCode = `import express from 'express';

export function createApp(db: any) {
  function getUser(req: any, res: any) {
    const q = req.query.id;
    const query = 'SELECT * FROM users WHERE id = ' + q;
    const stmt = db.prepare(query);
    const rows = stmt.all();
    return res.json(rows);
  }

  const app = express();
  app.get('/users', getUser);
  return app;
}
`;

const safeAppCode = `import express from 'express';

export function createApp(db: any) {
  function getUser(req: any, res: any) {
    const query = 'SELECT * FROM users';
    const stmt = db.prepare(query);
    const rows = stmt.all();
    return res.json(rows);
  }

  const app = express();
  app.get('/users', getUser);
  return app;
}
`;

describe('Pipeline Determinism Adversarial Edge Case Restart Resume', () => {
  const org = 'org_platform_pdet';

  it('preserves deterministic pipeline identities across restart-resume serialization cycles', async () => {
    const files = [{ path: 'src/app.ts', content: sqliAppCode }];
    const s1 = await captureSnapshot(
      { fixtureId: 'm2-case-001', repositoryId: 'repo-pdet', organizationId: org, files },
      org,
    );

    const resumedS1 = JSON.parse(JSON.stringify(s1));
    const vS1 = await validateSnapshot(resumedS1, org);
    expect(vS1.snapshotId).toBe(s1.snapshotId);

    const e1 = await ingestExpress(vS1, org);
    const resumedE1 = JSON.parse(JSON.stringify(e1));
    const vE1 = await validateExpressIngestion(resumedE1, org);
    expect(vE1.ingestionIdentity).toBe(e1.ingestionIdentity);

    const a1 = await detectSqlInjection(vS1, vE1, org);
    const resumedA1 = JSON.parse(JSON.stringify(a1));
    const vA1 = await validateSqlAnalysis(resumedA1, vS1, vE1, org);
    expect(vA1.resultFingerprint).toBe(a1.resultFingerprint);
    expect(vA1.status).toBe('DETECTED');

    const validCommitSha = 'a'.repeat(40);
    const bridge = createSqlCandidateBridge(async () => validCommitSha);
    const hypotheses = await bridge(vA1, vS1, vE1, org);
    expect(hypotheses.length).toBeGreaterThan(0);

    const resumedHypotheses = JSON.parse(JSON.stringify(hypotheses));
    expect(hypotheses[0].candidateBinding).toBe(resumedHypotheses[0].candidateBinding);
    expect(hypotheses[0].candidate.verificationState).toBe('CANDIDATE');
    expect((hypotheses[0].candidate as any).verificationState).not.toBe('VERIFIED');
  });

  it('fails closed on adversarial tampering of resumed snapshot across restart', async () => {
    const files = [{ path: 'src/app.ts', content: sqliAppCode }];
    const s1 = await captureSnapshot(
      { fixtureId: 'm2-case-001', repositoryId: 'repo-pdet-snap', organizationId: org, files },
      org,
    );
    const resumedS1 = JSON.parse(JSON.stringify(s1));

    const tamperedId = { ...resumedS1, snapshotId: 'sha256:' + 'b'.repeat(64) };
    await expect(validateSnapshot(tamperedId, org)).rejects.toThrow();

    await expect(validateSnapshot(resumedS1, 'org_foreign_tenant')).rejects.toThrow('tenant mismatch');

    const tamperedFiles = [{ ...resumedS1.files[0], content: 'export const altered = true;' }];
    const tamperedContent = { ...resumedS1, files: tamperedFiles };
    await expect(validateSnapshot(tamperedContent, org)).rejects.toThrow();
  });

  it('fails closed on adversarial tampering of resumed Express ingestion', async () => {
    const files = [{ path: 'src/app.ts', content: sqliAppCode }];
    const s1 = await captureSnapshot(
      { fixtureId: 'm2-case-001', repositoryId: 'repo-pdet-exp', organizationId: org, files },
      org,
    );
    const e1 = await ingestExpress(s1, org);
    const resumedE1 = JSON.parse(JSON.stringify(e1));

    const tamperedRoutes = [{ ...resumedE1.routes[0], path: '/tampered' }];
    const tamperedE1 = { ...resumedE1, routes: tamperedRoutes };
    await expect(validateExpressIngestion(tamperedE1, org)).rejects.toThrow('ingestion metadata mismatch');

    const forgedIdentityE1 = { ...resumedE1, ingestionIdentity: 'sha256:' + 'c'.repeat(64) };
    await expect(validateExpressIngestion(forgedIdentityE1, org)).rejects.toThrow('ingestion metadata mismatch');
  });

  it('fails closed on adversarial tampering or forging of resumed SQL analysis', async () => {
    const files = [{ path: 'src/app.ts', content: sqliAppCode }];
    const s1 = await captureSnapshot(
      { fixtureId: 'm2-case-001', repositoryId: 'repo-pdet-sqli', organizationId: org, files },
      org,
    );
    const e1 = await ingestExpress(s1, org);
    const a1 = await detectSqlInjection(s1, e1, org);
    const resumedA1 = JSON.parse(JSON.stringify(a1));

    const tamperedStatus = { ...resumedA1, status: 'NOT_DETECTED' };
    await expect(validateSqlAnalysis(tamperedStatus, s1, e1, org)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');

    const tamperedFindings = [{ ...resumedA1.findings[0], findingId: 'sha256:' + 'd'.repeat(64) }];
    const tamperedFindingsA1 = { ...resumedA1, findings: tamperedFindings };
    await expect(validateSqlAnalysis(tamperedFindingsA1, s1, e1, org)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');

    const s2 = await captureSnapshot(
      { fixtureId: 'm2-case-002', repositoryId: 'repo-pdet-mismatch', organizationId: org, files: [{ path: 'src/app.ts', content: safeAppCode }] },
      org,
    );
    await expect(detectSqlInjection(s2, e1, org)).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
    await expect(validateSqlAnalysis(resumedA1, s2, e1, org)).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
  });

  it('fails closed on adversarial resume with invalid checked commit SHA in candidate bridge', async () => {
    const files = [{ path: 'src/app.ts', content: sqliAppCode }];
    const s1 = await captureSnapshot(
      { fixtureId: 'm2-case-001', repositoryId: 'repo-pdet-bridge', organizationId: org, files },
      org,
    );
    const e1 = await ingestExpress(s1, org);
    const a1 = await detectSqlInjection(s1, e1, org);

    const zeroBridge = createSqlCandidateBridge(async () => '0'.repeat(40));
    await expect(zeroBridge(a1, s1, e1, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const shortBridge = createSqlCandidateBridge(async () => 'deadbeef');
    await expect(shortBridge(a1, s1, e1, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const emptyBridge = createSqlCandidateBridge(async () => '');
    await expect(emptyBridge(a1, s1, e1, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
  });

  it('resumes clean pipeline to empty candidate hypothesis set without manufacturing authority', async () => {
    const files = [{ path: 'src/app.ts', content: safeAppCode }];
    const cleanS = await captureSnapshot(
      { fixtureId: 'm2-case-003', repositoryId: 'repo-pdet-clean', organizationId: org, files },
      org,
    );
    const cleanE = await ingestExpress(cleanS, org);
    const cleanA = await detectSqlInjection(cleanS, cleanE, org);
    expect(cleanA.status).toBe('NOT_DETECTED');
    expect(cleanA.findings).toHaveLength(0);

    const bridge = createSqlCandidateBridge(async () => 'a'.repeat(40));
    const cleanHypotheses = await bridge(cleanA, cleanS, cleanE, org);
    expect(cleanHypotheses).toEqual([]);
    expect(Object.isFrozen(cleanHypotheses)).toBe(true);
  });
});
