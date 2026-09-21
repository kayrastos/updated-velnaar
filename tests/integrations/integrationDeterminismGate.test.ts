import { describe, it, expect } from 'vitest';
import { captureSnapshot, validateSnapshot, canonical } from '../../worker/intelligence/ingestion/snapshot';
import { ingestExpress, validateExpressIngestion } from '../../worker/intelligence/ingestion/express';
import { detectSqlInjection, validateSqlAnalysis } from '../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../worker/intelligence/detection/candidate';
import { isTrustedCommitCapability, assertTrustedCommitCapability } from '../../worker/intelligence/ingestion/repository';

const org = 'org_gate_100217';
const repoId = 'repo_determinism_gate';
const fixtureId = 'm2-case-001';
const commitSha = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

const vulnerableSource = `import express from 'express';

export function createApp(db: any) {
  const app = express();

  function vulnerableHandler(req: any, res: any) {
    const query = req.query.id;
    const stmt = db.prepare('SELECT * FROM users WHERE id = ' + query);
    const rows = stmt.all();
    return res.json(rows);
  }

  app.get('/users/vulnerable', vulnerableHandler);
  return app;
}
`;

const safeSource = `import express from 'express';

export function createApp(db: any) {
  const app = express();

  function safeHandler(req: any, res: any) {
    const query = req.query.id;
    const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
    const rows = stmt.all(query);
    return res.json(rows);
  }

  app.get('/users/safe', safeHandler);
  return app;
}
`;

describe('Multi-Stage Intelligence Pipeline Integration Gate', () => {
  it('evaluates multi-stage pipeline deterministically across repeated runs', async () => {
    const files = [{ path: 'src/app.ts', content: vulnerableSource }];

    const snapA = await captureSnapshot({ fixtureId, repositoryId: repoId, organizationId: org, files }, org);
    const snapB = await captureSnapshot({ fixtureId, repositoryId: repoId, organizationId: org, files }, org);

    expect(snapA.snapshotId).toBe(snapB.snapshotId);
    expect(canonical(snapA)).toBe(canonical(snapB));

    const exprA = await ingestExpress(snapA, org);
    const exprB = await ingestExpress(snapB, org);

    expect(exprA.ingestionIdentity).toBe(exprB.ingestionIdentity);
    expect(canonical(exprA)).toBe(canonical(exprB));
    expect(exprA.routes).toHaveLength(1);
    expect(exprA.routes[0].routeIdentity).toBe(exprB.routes[0].routeIdentity);

    const analA = await detectSqlInjection(snapA, exprA, org);
    const analB = await detectSqlInjection(snapB, exprB, org);

    expect(analA.status).toBe('DETECTED');
    expect(analA.findings).toHaveLength(1);
    expect(analA.resultFingerprint).toBe(analB.resultFingerprint);
    expect(canonical(analA)).toBe(canonical(analB));

    const bridgeA = createSqlCandidateBridge(async () => commitSha);
    const bridgeB = createSqlCandidateBridge(async () => commitSha);

    const candA = await bridgeA(analA, snapA, exprA, org);
    const candB = await bridgeB(analB, snapB, exprB, org);

    expect(candA).toHaveLength(1);
    expect(candB).toHaveLength(1);
    expect(candA[0].candidate.candidateId).toBe(candB[0].candidate.candidateId);
    expect(candA[0].candidateBinding).toBe(candB[0].candidateBinding);
    expect(canonical(candA)).toBe(canonical(candB));
  });

  it('bounds analysis and candidate findings to strictly non-authoritative hypotheses', async () => {
    const files = [{ path: 'src/app.ts', content: vulnerableSource }];
    const snap = await captureSnapshot({ fixtureId, repositoryId: repoId, organizationId: org, files }, org);
    const expr = await ingestExpress(snap, org);
    const anal = await detectSqlInjection(snap, expr, org);
    const bridge = createSqlCandidateBridge(async () => commitSha);
    const candidates = await bridge(anal, snap, expr, org);

    expect(candidates).toHaveLength(1);
    const hypothesis = candidates[0];

    expect(hypothesis.candidate.verificationState).toBe('CANDIDATE');
    expect(hypothesis.candidate.verificationState).not.toBe('VERIFIED');
    expect(hypothesis.candidate.reachabilityState).toBe('REACHABLE');
    expect(hypothesis.candidate.vulnerabilityClass).toBe('SQL_INJECTION');

    expect((hypothesis.candidate as any).isVerified).toBeUndefined();
    expect((hypothesis.candidate as any).action).toBeUndefined();
    expect((hypothesis.candidate as any).capability).toBeUndefined();

    expect((anal as any).capability).toBeUndefined();
    expect((anal as any).authority).toBeUndefined();
    expect((anal as any).isVerified).toBeUndefined();

    expect(isTrustedCommitCapability(anal, null as any)).toBe(false);
    expect(isTrustedCommitCapability(hypothesis.candidate, null as any)).toBe(false);
    expect(() => assertTrustedCommitCapability(anal, null as any)).toThrow();
    expect(() => assertTrustedCommitCapability(hypothesis.candidate, null as any)).toThrow();
  });

  it('produces deterministic NOT_DETECTED status and empty candidate hypotheses for safe code', async () => {
    const files = [{ path: 'src/app.ts', content: safeSource }];

    const snap1 = await captureSnapshot({ fixtureId, repositoryId: repoId, organizationId: org, files }, org);
    const snap2 = await captureSnapshot({ fixtureId, repositoryId: repoId, organizationId: org, files }, org);

    const expr1 = await ingestExpress(snap1, org);
    const expr2 = await ingestExpress(snap2, org);

    const anal1 = await detectSqlInjection(snap1, expr1, org);
    const anal2 = await detectSqlInjection(snap2, expr2, org);

    expect(anal1.status).toBe('NOT_DETECTED');
    expect(anal2.status).toBe('NOT_DETECTED');
    expect(anal1.findings).toHaveLength(0);
    expect(anal2.findings).toHaveLength(0);
    expect(anal1.resultFingerprint).toBe(anal2.resultFingerprint);

    const bridge = createSqlCandidateBridge(async () => commitSha);
    const cand1 = await bridge(anal1, snap1, expr1, org);
    const cand2 = await bridge(anal2, snap2, expr2, org);

    expect(cand1).toHaveLength(0);
    expect(cand2).toHaveLength(0);
  });

  it('validates multi-stage integrity and enforces fail-closed barriers on tampered artifacts', async () => {
    const vulnFiles = [{ path: 'src/app.ts', content: vulnerableSource }];
    const safeFiles = [{ path: 'src/app.ts', content: safeSource }];

    const snap = await captureSnapshot({ fixtureId, repositoryId: repoId, organizationId: org, files: vulnFiles }, org);
    const safeSnap = await captureSnapshot({ fixtureId, repositoryId: repoId, organizationId: org, files: safeFiles }, org);
    const expr = await ingestExpress(snap, org);
    const anal = await detectSqlInjection(snap, expr, org);

    const validSnap = await validateSnapshot(snap, org);
    expect(validSnap.snapshotId).toBe(snap.snapshotId);

    const validExpr = await validateExpressIngestion(expr, org);
    expect(validExpr.ingestionIdentity).toBe(expr.ingestionIdentity);

    const validAnal = await validateSqlAnalysis(anal, snap, expr, org);
    expect(validAnal.resultFingerprint).toBe(anal.resultFingerprint);

    const tamperedSnap = { ...snap, totalBytes: snap.totalBytes + 1 };
    await expect(validateSnapshot(tamperedSnap, org)).rejects.toThrow();

    await expect(detectSqlInjection(safeSnap, expr, org)).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');

    const tamperedAnal = { ...anal, status: 'NOT_DETECTED' as const };
    await expect(validateSqlAnalysis(tamperedAnal, snap, expr, org)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');

    const badBridge = createSqlCandidateBridge(async () => '0'.repeat(40));
    await expect(badBridge(anal, snap, expr, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
  });

  it('strictly rejects foreign tenant identity across all pipeline stages', async () => {
    const files = [{ path: 'src/app.ts', content: vulnerableSource }];
    const snap = await captureSnapshot({ fixtureId, repositoryId: repoId, organizationId: org, files }, org);
    const expr = await ingestExpress(snap, org);
    const anal = await detectSqlInjection(snap, expr, org);
    const bridge = createSqlCandidateBridge(async () => commitSha);

    const foreignOrg = 'foreign_tenant_id';

    await expect(validateSnapshot(snap, foreignOrg)).rejects.toThrow();
    await expect(validateExpressIngestion(expr, foreignOrg)).rejects.toThrow();
    await expect(validateSqlAnalysis(anal, snap, expr, foreignOrg)).rejects.toThrow();
    await expect(bridge(anal, snap, expr, foreignOrg)).rejects.toThrow();
  });
});
