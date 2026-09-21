import { describe, it, expect } from 'vitest';
import {
  captureSnapshot,
  validateSnapshot,
  type SnapshotInput,
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

const org = 'org_pdet_rst';
const repo = 'repo_pdet_rst';
const commitSha = '1234567890abcdef1234567890abcdef12345678';

const vulnerableSource = `import express from 'express';

export function createApp(db: any) {
  const app = express();
  function handleSearch(req: any, res: any) {
    const term = req.query.search;
    const stmt = db.prepare('SELECT * FROM items WHERE name = ' + term);
    const rows = stmt.all();
    return res.json(rows);
  }
  app.get('/search', handleSearch);
  return app;
}
`;

const sampleInput: SnapshotInput = {
  fixtureId: 'm2-case-001',
  repositoryId: repo,
  organizationId: org,
  files: [
    {
      path: 'src/app.ts',
      content: vulnerableSource,
    },
  ],
};

describe('Pipeline Determinism Replay and Restart-Resume', () => {
  it('yields identical fingerprints and candidate hypotheses across end-to-end replays', async () => {
    const snap1 = await captureSnapshot(sampleInput, org);
    const ing1 = await ingestExpress(snap1, org);
    const det1 = await detectSqlInjection(snap1, ing1, org);
    const bridge1 = createSqlCandidateBridge(async () => commitSha);
    const hyp1 = await bridge1(det1, snap1, ing1, org);

    const snap2 = await captureSnapshot(sampleInput, org);
    const ing2 = await ingestExpress(snap2, org);
    const det2 = await detectSqlInjection(snap2, ing2, org);
    const bridge2 = createSqlCandidateBridge(async () => commitSha);
    const hyp2 = await bridge2(det2, snap2, ing2, org);

    expect(det1.status).toBe('DETECTED');
    expect(det1.findings.length).toBe(1);
    expect(hyp1.length).toBe(1);

    expect(snap2.snapshotId).toBe(snap1.snapshotId);
    expect(ing2.ingestionIdentity).toBe(ing1.ingestionIdentity);
    expect(det2.resultFingerprint).toBe(det1.resultFingerprint);
    expect(det2.findings[0].findingId).toBe(det1.findings[0].findingId);
    expect(hyp2[0].candidate.candidateId).toBe(hyp1[0].candidate.candidateId);
    expect(hyp2[0].candidateBinding).toBe(hyp1[0].candidateBinding);

    expect(hyp1[0].candidate.verificationState).toBe('CANDIDATE');
    expect((hyp1[0].candidate as any).verificationState).not.toBe('VERIFIED');
  });

  it('preserves determinism across simulated restart-resume from snapshot checkpoint', async () => {
    const originalSnap = await captureSnapshot(sampleInput, org);
    const originalIng = await ingestExpress(originalSnap, org);
    const originalDet = await detectSqlInjection(originalSnap, originalIng, org);
    const bridge = createSqlCandidateBridge(async () => commitSha);
    const originalHyp = await bridge(originalDet, originalSnap, originalIng, org);

    const serializedSnap = JSON.stringify(originalSnap);
    const restoredSnapRaw = JSON.parse(serializedSnap);
    const restoredSnap = await validateSnapshot(restoredSnapRaw, org);

    expect(restoredSnap.snapshotId).toBe(originalSnap.snapshotId);

    const resumedIng = await ingestExpress(restoredSnap, org);
    expect(resumedIng.ingestionIdentity).toBe(originalIng.ingestionIdentity);

    const resumedDet = await detectSqlInjection(restoredSnap, resumedIng, org);
    expect(resumedDet.resultFingerprint).toBe(originalDet.resultFingerprint);

    const resumedHyp = await bridge(resumedDet, restoredSnap, resumedIng, org);
    expect(resumedHyp[0].candidate.candidateId).toBe(originalHyp[0].candidate.candidateId);
    expect(resumedHyp[0].candidateBinding).toBe(originalHyp[0].candidateBinding);
  });

  it('preserves determinism across simulated restart-resume from express ingestion checkpoint', async () => {
    const snap = await captureSnapshot(sampleInput, org);
    const originalIng = await ingestExpress(snap, org);
    const originalDet = await detectSqlInjection(snap, originalIng, org);
    const bridge = createSqlCandidateBridge(async () => commitSha);
    const originalHyp = await bridge(originalDet, snap, originalIng, org);

    const serializedIng = JSON.stringify(originalIng);
    const restoredIngRaw = JSON.parse(serializedIng);
    const restoredIng = await validateExpressIngestion(restoredIngRaw, org);

    expect(restoredIng.ingestionIdentity).toBe(originalIng.ingestionIdentity);

    const resumedDet = await detectSqlInjection(restoredIng.snapshot, restoredIng, org);
    expect(resumedDet.resultFingerprint).toBe(originalDet.resultFingerprint);

    const resumedHyp = await bridge(resumedDet, restoredIng.snapshot, restoredIng, org);
    expect(resumedHyp[0].candidate.candidateId).toBe(originalHyp[0].candidate.candidateId);
    expect(resumedHyp[0].candidateBinding).toBe(originalHyp[0].candidateBinding);
  });

  it('preserves determinism across simulated restart-resume from analysis checkpoint', async () => {
    const snap = await captureSnapshot(sampleInput, org);
    const ing = await ingestExpress(snap, org);
    const originalDet = await detectSqlInjection(snap, ing, org);
    const bridge = createSqlCandidateBridge(async () => commitSha);
    const originalHyp = await bridge(originalDet, snap, ing, org);

    const serializedDet = JSON.stringify(originalDet);
    const restoredDetRaw = JSON.parse(serializedDet);
    const restoredDet = await validateSqlAnalysis(restoredDetRaw, snap, ing, org);

    expect(restoredDet.resultFingerprint).toBe(originalDet.resultFingerprint);

    const resumedHyp = await bridge(restoredDet, snap, ing, org);
    expect(resumedHyp[0].candidate.candidateId).toBe(originalHyp[0].candidate.candidateId);
    expect(resumedHyp[0].candidateBinding).toBe(originalHyp[0].candidateBinding);
  });

  it('fails closed when restart checkpoint data is mutated or forged', async () => {
    const snap = await captureSnapshot(sampleInput, org);
    const ing = await ingestExpress(snap, org);
    const det = await detectSqlInjection(snap, ing, org);

    const corruptedSnap = JSON.parse(JSON.stringify(snap));
    corruptedSnap.snapshotId = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
    await expect(validateSnapshot(corruptedSnap, org)).rejects.toThrow();

    const corruptedIng = JSON.parse(JSON.stringify(ing));
    corruptedIng.routes[0].path = '/forged';
    await expect(validateExpressIngestion(corruptedIng, org)).rejects.toThrow();

    const corruptedDet = JSON.parse(JSON.stringify(det));
    corruptedDet.status = 'NOT_DETECTED';
    await expect(validateSqlAnalysis(corruptedDet, snap, ing, org)).rejects.toThrow();
  });
});
