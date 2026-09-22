import { describe, it, expect } from 'vitest';
import { captureSnapshot, validateSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress, validateExpressIngestion } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';

const EXPRESS_APP_SOURCE = `import express from 'express';

export function createApp(db: any) {
  const app = express();
  function userHandler(req: any, res: any) {
    const userId = req.query.id;
    const query = 'SELECT * FROM users WHERE id = ' + userId;
    const stmt = db.prepare(query);
    const rows = stmt.all();
    res.json(rows);
  }
  app.get('/users', userHandler);
  return app;
}
`;

const ORG_ID = 'org_apex';
const REPO_ID = 'repo-pdet-dup-rst';
const FIXTURE_ID = 'm2-case-001';
const TRUSTED_COMMIT_SHA = '1234567890abcdef1234567890abcdef12345678';

describe('V1 Pipeline Determinism: Duplicate Collapse on Restart-Resume', () => {
  it('preserves determinism and collapses duplicate candidates across restart-resume cycle', async () => {
    const snapshot = await captureSnapshot({
      fixtureId: FIXTURE_ID,
      repositoryId: REPO_ID,
      organizationId: ORG_ID,
      files: [{ path: 'src/routes.ts', content: EXPRESS_APP_SOURCE }],
    }, ORG_ID);

    const ingestion = await ingestExpress(snapshot, ORG_ID);
    const analysis = await detectSqlInjection(snapshot, ingestion, ORG_ID);

    expect(analysis.status).toBe('DETECTED');
    expect(analysis.findings).toHaveLength(1);

    const bridge = createSqlCandidateBridge(async () => TRUSTED_COMMIT_SHA);
    const initialHypotheses = await bridge(analysis, snapshot, ingestion, ORG_ID);

    expect(initialHypotheses).toHaveLength(1);
    const initialCandidate = initialHypotheses[0];

    // Checkpoint pipeline state as serialized JSON (simulating persistence before process restart)
    const checkpoint = JSON.stringify({
      snapshot,
      ingestion,
      analysis,
      initialHypotheses,
    });

    // Simulate restart: restore from checkpoint JSON
    const restored = JSON.parse(checkpoint);

    // Validate restored states on resume
    const resumedSnapshot = await validateSnapshot(restored.snapshot, ORG_ID);
    const resumedIngestion = await validateExpressIngestion(restored.ingestion, ORG_ID);
    const resumedAnalysis = await validateSqlAnalysis(
      restored.analysis,
      resumedSnapshot,
      resumedIngestion,
      ORG_ID,
    );

    // Verify determinism across the restart boundary
    expect(resumedSnapshot.snapshotId).toBe(snapshot.snapshotId);
    expect(resumedIngestion.ingestionIdentity).toBe(ingestion.ingestionIdentity);
    expect(resumedAnalysis.resultFingerprint).toBe(analysis.resultFingerprint);

    // Re-execute candidate bridge on resumed state
    const resumedHypotheses = await bridge(
      resumedAnalysis,
      resumedSnapshot,
      resumedIngestion,
      ORG_ID,
    );

    expect(resumedHypotheses).toHaveLength(1);
    const resumedCandidate = resumedHypotheses[0];

    // Identities and candidate bindings must match exactly across restart
    expect(resumedCandidate.candidate.candidateId).toBe(initialCandidate.candidate.candidateId);
    expect(resumedCandidate.candidateBinding).toBe(initialCandidate.candidateBinding);

    // Duplicate collapse: merging candidates from pre-restart and post-restart runs collapses to single candidate
    const combinedHypotheses = [...initialHypotheses, ...resumedHypotheses];
    expect(combinedHypotheses).toHaveLength(2);

    const collapsedByBinding = Array.from(
      new Map(combinedHypotheses.map(h => [h.candidateBinding, h])).values(),
    );
    expect(collapsedByBinding).toHaveLength(1);
    expect(collapsedByBinding[0].candidateBinding).toBe(initialCandidate.candidateBinding);

    const collapsedById = Array.from(
      new Map(combinedHypotheses.map(h => [h.candidate.candidateId, h])).values(),
    );
    expect(collapsedById).toHaveLength(1);
    expect(collapsedById[0].candidate.candidateId).toBe(initialCandidate.candidate.candidateId);

    // Repeated bridge execution on resumed state remains idempotent
    const duplicateRun = await bridge(resumedAnalysis, resumedSnapshot, resumedIngestion, ORG_ID);
    expect(duplicateRun).toHaveLength(1);
    expect(duplicateRun[0].candidateBinding).toBe(initialCandidate.candidateBinding);
  });

  it('collapses duplicate detection findings and enforces candidate non-authoritative boundary on resume', async () => {
    const snapshot = await captureSnapshot({
      fixtureId: FIXTURE_ID,
      repositoryId: REPO_ID,
      organizationId: ORG_ID,
      files: [{ path: 'src/routes.ts', content: EXPRESS_APP_SOURCE }],
    }, ORG_ID);

    const ingestion = await ingestExpress(snapshot, ORG_ID);

    // Checkpoint ingestion and snapshot before detection
    const checkpoint = JSON.stringify({ snapshot, ingestion });
    const restored = JSON.parse(checkpoint);

    const resumedSnapshot = await validateSnapshot(restored.snapshot, ORG_ID);
    const resumedIngestion = await validateExpressIngestion(restored.ingestion, ORG_ID);

    // Run detection multiple times on resumed state; findings must remain collapsed and deterministic
    const analysisA = await detectSqlInjection(resumedSnapshot, resumedIngestion, ORG_ID);
    const analysisB = await detectSqlInjection(resumedSnapshot, resumedIngestion, ORG_ID);

    expect(analysisA.status).toBe('DETECTED');
    expect(analysisA.findings).toHaveLength(1);
    expect(analysisA.resultFingerprint).toBe(analysisB.resultFingerprint);
    expect(analysisA.findings[0].findingId).toBe(analysisB.findings[0].findingId);

    const bridge = createSqlCandidateBridge(async () => TRUSTED_COMMIT_SHA);
    const hypotheses = await bridge(analysisA, resumedSnapshot, resumedIngestion, ORG_ID);

    expect(hypotheses).toHaveLength(1);
    const hypothesis = hypotheses[0];

    // Preserves non-authoritative boundaries
    expect(hypothesis.candidate.verificationState).toBe('CANDIDATE');
    expect(hypothesis.candidate.verificationState).not.toBe('VERIFIED');
    expect(hypothesis.candidate.reachabilityState).toBe('REACHABLE');
    expect(hypothesis.candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(hypothesis.candidate.createdAt).toBe('2026-09-04T00:00:00.000Z');
    expect(hypothesis.candidate.snapshot.commitSha).toBe(TRUSTED_COMMIT_SHA);
  });

  it('fails closed when resuming from corrupted, forged, or tenant-mismatched checkpoints', async () => {
    const snapshot = await captureSnapshot({
      fixtureId: FIXTURE_ID,
      repositoryId: REPO_ID,
      organizationId: ORG_ID,
      files: [{ path: 'src/routes.ts', content: EXPRESS_APP_SOURCE }],
    }, ORG_ID);

    const ingestion = await ingestExpress(snapshot, ORG_ID);
    const analysis = await detectSqlInjection(snapshot, ingestion, ORG_ID);

    // Corrupted snapshot content on resume must fail closed
    const corruptedSnapshot = {
      ...snapshot,
      files: [{ ...snapshot.files[0], content: 'corrupted content\n' }],
    };
    await expect(validateSnapshot(corruptedSnapshot, ORG_ID)).rejects.toThrow();

    // Foreign tenant / organization mismatch on resume must fail closed
    await expect(validateSnapshot(snapshot, 'foreign_org')).rejects.toThrow('tenant mismatch');
    await expect(validateExpressIngestion(ingestion, 'foreign_org')).rejects.toThrow('tenant mismatch');

    // Mismatched analysis snapshot binding on resume must fail closed
    const mismatchedAnalysis = {
      ...analysis,
      snapshotId: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    };
    await expect(
      validateSqlAnalysis(mismatchedAnalysis, snapshot, ingestion, ORG_ID),
    ).rejects.toThrow();

    // Invalid or zero commit SHA in candidate bridge on resume must fail closed
    const zeroCommitBridge = createSqlCandidateBridge(async () => '0'.repeat(40));
    await expect(
      zeroCommitBridge(analysis, snapshot, ingestion, ORG_ID),
    ).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
  });
});
