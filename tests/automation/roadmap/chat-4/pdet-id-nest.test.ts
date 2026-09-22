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

describe('Pipeline Determinism - Identity Stability: Nested Router', () => {
  const org = 'org_pdet_nest';
  const repo = 'repo_pdet_nest';
  const fixtureId = 'm2-case-001';
  const mockCommitSha = 'a'.repeat(40);

  const nestedRouteFile = `import express from 'express';

export function createApp(db: any) {
  function handleNested(req: any, res: any) {
    const id = req.query.id;
    const stmt = db.prepare('SELECT * FROM items WHERE id = ' + id);
    res.json(stmt.all());
  }

  const app = express();
  const router = express.Router();
  router.get('/items', handleNested);
  app.use('/nested', router);
  return app;
}
`;

  function createInput() {
    return {
      fixtureId,
      repositoryId: repo,
      organizationId: org,
      files: [
        {
          path: 'src/nested/routes.ts',
          content: nestedRouteFile,
        },
      ],
    };
  }

  it('preserves deterministic identity stability for nested router pipeline execution', async () => {
    const snap1 = await captureSnapshot(createInput(), org);
    const snap2 = await captureSnapshot(createInput(), org);

    expect(snap1.snapshotId).toBe(snap2.snapshotId);
    expect(snap1.files[0].fileIdentity).toBe(snap2.files[0].fileIdentity);
    expect(snap1.files[0].contentDigest).toBe(snap2.files[0].contentDigest);

    const express1 = await ingestExpress(snap1, org);
    const express2 = await ingestExpress(snap2, org);

    expect(express1.ingestionIdentity).toBe(express2.ingestionIdentity);
    expect(express1.routes).toHaveLength(1);
    expect(express2.routes).toHaveLength(1);

    const route1 = express1.routes[0];
    const route2 = express2.routes[0];

    expect(route1.ownerKind).toBe('ROUTER');
    expect(route1.method).toBe('GET');
    expect(route1.path).toBe('/nested/items');
    expect(route1.declaredPath).toBe('/items');
    expect(route1.mount).not.toBeNull();
    expect(route1.mount?.prefix).toBe('/nested');
    expect(route1.mount?.app).toBe('app');
    expect(route1.routeIdentity).toBe(route2.routeIdentity);

    const analysis1 = await detectSqlInjection(snap1, express1, org);
    const analysis2 = await detectSqlInjection(snap2, express2, org);

    expect(analysis1.status).toBe('DETECTED');
    expect(analysis2.status).toBe('DETECTED');
    expect(analysis1.resultFingerprint).toBe(analysis2.resultFingerprint);
    expect(analysis1.findings).toHaveLength(1);
    expect(analysis2.findings).toHaveLength(1);

    const finding1 = analysis1.findings[0];
    const finding2 = analysis2.findings[0];

    expect(finding1.findingId).toBe(finding2.findingId);
    expect(finding1.routeIdentity).toBe(route1.routeIdentity);
    expect(finding1.flow.length).toBeGreaterThan(0);
    expect(finding1.flow.map((s) => s.id)).toEqual(finding2.flow.map((s) => s.id));

    const bridge1 = createSqlCandidateBridge(async () => mockCommitSha);
    const bridge2 = createSqlCandidateBridge(async () => mockCommitSha);

    const candidates1 = await bridge1(analysis1, snap1, express1, org);
    const candidates2 = await bridge2(analysis2, snap2, express2, org);

    expect(candidates1).toHaveLength(1);

    expect(candidates2).toHaveLength(1);
    expect(candidates1[0].candidate.candidateId).toBe(candidates2[0].candidate.candidateId);
    expect(candidates1[0].candidateBinding).toBe(candidates2[0].candidateBinding);
    expect(candidates1[0].candidate.context.routeId).toBe(route1.routeIdentity);
  });

  it('verifies structural re-validation maintains identical canonical identities for nested pipeline artifacts', async () => {
    const snap = await captureSnapshot(createInput(), org);
    const validatedSnap = await validateSnapshot(snap, org);
    expect(validatedSnap.snapshotId).toBe(snap.snapshotId);

    const express = await ingestExpress(snap, org);
    const validatedExpress = await validateExpressIngestion(express, org);
    expect(validatedExpress.ingestionIdentity).toBe(express.ingestionIdentity);

    const analysis = await detectSqlInjection(snap, express, org);
    const validatedAnalysis = await validateSqlAnalysis(analysis, snap, express, org);
    expect(validatedAnalysis.resultFingerprint).toBe(analysis.resultFingerprint);
  });

  it('preserves candidate non-authoritative boundary under nested pipeline determinism', async () => {
    const snap = await captureSnapshot(createInput(), org);
    const express = await ingestExpress(snap, org);
    const analysis = await detectSqlInjection(snap, express, org);

    const bridge = createSqlCandidateBridge(async () => mockCommitSha);
    const hypotheses = await bridge(analysis, snap, express, org);

    expect(hypotheses).toHaveLength(1);
    const { candidate } = hypotheses[0];

    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect((candidate as any).authority).toBeUndefined();

    const badBridge = createSqlCandidateBridge(async () => '0'.repeat(40));
    await expect(badBridge(analysis, snap, express, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
  });
});
