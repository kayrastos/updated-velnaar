import { describe, it, expect } from 'vitest';
import { captureSnapshot, canonical } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';

describe('Chat-4 Pipeline Determinism Replay Direct', () => {
  const org = 'org_chat4_pdet';

  const vulnerableSource =
    "import express from 'express';\n" +
    "export function createApp(db: any) {\n" +
    "  const app = express();\n" +
    "  function searchHandler(req: any, res: any) {\n" +
    "    const term = req.query.term;\n" +
    "    const query = 'SELECT * FROM users WHERE name = ' + term;\n" +
    "    const stmt = db.prepare(query);\n" +
    "    const rows = stmt.all();\n" +
    "    res.json(rows);\n" +
    "  }\n" +
    "  app.get('/search', searchHandler);\n" +
    "  return app;\n" +
    "}\n";

  const safeSource =
    "import express from 'express';\n" +
    "export function createApp(db: any) {\n" +
    "  const app = express();\n" +
    "  function safeHandler(req: any, res: any) {\n" +
    "    const stmt = db.prepare('SELECT id, name FROM users');\n" +
    "    const rows = stmt.all();\n" +
    "    res.json(rows);\n" +
    "  }\n" +
    "  app.get('/users', safeHandler);\n" +
    "  return app;\n" +
    "}\n";

  it('replays direct pipeline execution deterministically on identical input', async () => {
    const input1 = {
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-replay-dir',
      organizationId: org,
      files: [{ path: 'src/app.ts', content: vulnerableSource }],
    };
    const input2 = {
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-replay-dir',
      organizationId: org,
      files: [{ path: 'src/app.ts', content: vulnerableSource }],
    };

    const snap1 = await captureSnapshot(input1, org);
    const snap2 = await captureSnapshot(input2, org);

    expect(snap1.snapshotId).toBe(snap2.snapshotId);
    expect(snap1.files[0].fileIdentity).toBe(snap2.files[0].fileIdentity);
    expect(snap1.files[0].contentDigest).toBe(snap2.files[0].contentDigest);
    expect(canonical(snap1)).toBe(canonical(snap2));

    const exp1 = await ingestExpress(snap1, org);
    const exp2 = await ingestExpress(snap2, org);

    expect(exp1.ingestionIdentity).toBe(exp2.ingestionIdentity);
    expect(exp1.routes[0].routeIdentity).toBe(exp2.routes[0].routeIdentity);
    expect(canonical(exp1)).toBe(canonical(exp2));

    const analysis1 = await detectSqlInjection(snap1, exp1, org);
    const analysis2 = await detectSqlInjection(snap2, exp2, org);
    const analysisReplay = await detectSqlInjection(snap1, exp1, org);

    expect(analysis1.status).toBe('DETECTED');
    expect(analysis2.status).toBe('DETECTED');
    expect(analysis1.resultFingerprint).toBe(analysis2.resultFingerprint);
    expect(analysis1.resultFingerprint).toBe(analysisReplay.resultFingerprint);
    expect(analysis1.findings).toHaveLength(1);
    expect(analysis2.findings).toHaveLength(1);
    expect(analysis1.findings[0].findingId).toBe(analysis2.findings[0].findingId);
    expect(analysis1.findings[0].flow[0].id).toBe(analysis2.findings[0].flow[0].id);
    expect(canonical(analysis1)).toBe(canonical(analysis2));
  });

  it('replays and validates analysis integrity via validateSqlAnalysis', async () => {
    const snap = await captureSnapshot({
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-replay-dir',
      organizationId: org,
      files: [{ path: 'src/app.ts', content: vulnerableSource }],
    }, org);
    const exp = await ingestExpress(snap, org);
    const analysis = await detectSqlInjection(snap, exp, org);

    const validated1 = await validateSqlAnalysis(analysis, snap, exp, org);
    const validated2 = await validateSqlAnalysis(analysis, snap, exp, org);

    expect(validated1.resultFingerprint).toBe(analysis.resultFingerprint);
    expect(validated2.resultFingerprint).toBe(analysis.resultFingerprint);
    expect(canonical(validated1)).toBe(canonical(validated2));

    const forged = { ...analysis, resultFingerprint: 'sha256:0000000000000000000000000000000000000000000000000000000000000000' };
    await expect(validateSqlAnalysis(forged, snap, exp, org)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
  });

  it('replays candidate bridge deterministically preserving non-authoritative state', async () => {
    const snap = await captureSnapshot({
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-replay-dir',
      organizationId: org,
      files: [{ path: 'src/app.ts', content: vulnerableSource }],
    }, org);
    const exp = await ingestExpress(snap, org);
    const analysis = await detectSqlInjection(snap, exp, org);

    const checkedCommit = '1'.repeat(40);
    const bridge = createSqlCandidateBridge(async () => checkedCommit);

    const candidates1 = await bridge(analysis, snap, exp, org);
    const candidates2 = await bridge(analysis, snap, exp, org);

    expect(candidates1).toHaveLength(1);
    expect(candidates2).toHaveLength(1);
    expect(candidates1[0].candidate.candidateId).toBe(candidates2[0].candidate.candidateId);
    expect(candidates1[0].candidateBinding).toBe(candidates2[0].candidateBinding);
    expect(canonical(candidates1)).toBe(canonical(candidates2));

    expect(candidates1[0].candidate.verificationState).toBe('CANDIDATE');
    expect((candidates1[0].candidate as any).capability).toBeUndefined();
  });

  it('replays safe clean route deterministically yielding NOT_DETECTED status', async () => {
    const snap = await captureSnapshot({
      fixtureId: 'm2-case-002',
      repositoryId: 'repo-replay-clean',
      organizationId: org,
      files: [{ path: 'src/app.ts', content: safeSource }],
    }, org);
    const exp = await ingestExpress(snap, org);

    const analysis1 = await detectSqlInjection(snap, exp, org);
    const analysis2 = await detectSqlInjection(snap, exp, org);

    expect(analysis1.status).toBe('NOT_DETECTED');
    expect(analysis2.status).toBe('NOT_DETECTED');
    expect(analysis1.findings).toHaveLength(0);
    expect(analysis2.findings).toHaveLength(0);
    expect(analysis1.resultFingerprint).toBe(analysis2.resultFingerprint);
    expect(canonical(analysis1)).toBe(canonical(analysis2));

    const checkedCommit = '2'.repeat(40);
    const bridge = createSqlCandidateBridge(async () => checkedCommit);
    const candidates = await bridge(analysis1, snap, exp, org);
    expect(candidates).toHaveLength(0);
  });
});
