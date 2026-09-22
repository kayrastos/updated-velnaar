import { describe, it, expect } from 'vitest';
import {
  captureSnapshot,
  validateSnapshot,
  canonical,
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

const orgId = 'org_pdet_wrap_rst';
const repoId = 'repo-pdet-wrap-rst';
const fixtureId = 'm2-case-001';
const validCommitSha = 'a'.repeat(40);

const sampleExpressSource = [
  "import express from 'express';",
  '',
  'export function createApp(db: any) {',
  '  const app = express();',
  '  function handler(req: any, res: any) {',
  '    const query = req.query.id;',
  "    const sql = 'SELECT * FROM users WHERE id = ' + query;",
  '    const stmt = db.prepare(sql);',
  '    const rows = stmt.all();',
  '    return res.json(rows);',
  '  }',
  "  app.get('/users', handler);",
  '  return app;',
  '}',
  '',
].join('\n');

async function createDetectedPipeline() {
  const snapshot = await captureSnapshot(
    {
      fixtureId,
      repositoryId: repoId,
      organizationId: orgId,
      files: [{ path: 'src/routes.ts', content: sampleExpressSource }],
    },
    orgId,
  );

  const ingestion = await ingestExpress(snapshot, orgId);
  const analysis = await detectSqlInjection(snapshot, ingestion, orgId);
  return { snapshot, ingestion, analysis };
}

describe('Pipeline Determinism - Wrapper Boundary Restart-Resume (pdet-wrap-rst)', () => {
  it('preserves deterministic candidate bindings and fingerprints across cold restart JSON serialization', async () => {
    const { snapshot, ingestion, analysis } = await createDetectedPipeline();
    expect(analysis.status).toBe('DETECTED');
    expect(analysis.findings.length).toBeGreaterThan(0);

    const initialBridge = createSqlCandidateBridge(async () => validCommitSha);
    const initialCandidates = await initialBridge(analysis, snapshot, ingestion, orgId);
    expect(initialCandidates).toHaveLength(1);

    const restartedAnalysis = JSON.parse(JSON.stringify(analysis));
    const restartedSnapshot = JSON.parse(JSON.stringify(snapshot));
    const restartedIngestion = JSON.parse(JSON.stringify(ingestion));

    const resumedBridge = createSqlCandidateBridge(async () => validCommitSha);
    const resumedCandidates = await resumedBridge(
      restartedAnalysis,
      restartedSnapshot,
      restartedIngestion,
      orgId,
    );

    expect(resumedCandidates).toHaveLength(initialCandidates.length);
    expect(resumedCandidates[0].candidate.candidateId).toBe(initialCandidates[0].candidate.candidateId);
    expect(resumedCandidates[0].candidateBinding).toBe(initialCandidates[0].candidateBinding);
    expect(resumedCandidates[0].candidate.snapshot.snapshotId).toBe(initialCandidates[0].candidate.snapshot.snapshotId);
    expect(resumedCandidates[0].candidate.snapshot.commitSha).toBe(validCommitSha);
    expect(resumedCandidates[0].candidate.sensorEvidence[0].rawEvidenceFingerprint).toBe(
      initialCandidates[0].candidate.sensorEvidence[0].rawEvidenceFingerprint,
    );
    expect(canonical(resumedCandidates)).toBe(canonical(initialCandidates));
  });

  it('maintains strict idempotence across multiple consecutive restart-resume cycles', async () => {
    const { snapshot, ingestion, analysis } = await createDetectedPipeline();
    const initialBridge = createSqlCandidateBridge(async () => validCommitSha);
    const baseline = await initialBridge(analysis, snapshot, ingestion, orgId);

    for (let cycle = 1; cycle <= 3; cycle++) {
      const restartedAnalysis = JSON.parse(JSON.stringify(analysis));
      const restartedSnapshot = JSON.parse(JSON.stringify(snapshot));
      const restartedIngestion = JSON.parse(JSON.stringify(ingestion));

      const resumedBridge = createSqlCandidateBridge(async () => validCommitSha);
      const candidates = await resumedBridge(
        restartedAnalysis,
        restartedSnapshot,
        restartedIngestion,
        orgId,
      );

      expect(canonical(candidates)).toBe(canonical(baseline));
      expect(candidates[0].candidateBinding).toBe(baseline[0].candidateBinding);
      expect(candidates[0].candidate.candidateId).toBe(baseline[0].candidate.candidateId);
    }
  });

  it('fails closed when resumed snapshot state is modified or corrupted', async () => {
    const { snapshot, ingestion, analysis } = await createDetectedPipeline();
    const bridge = createSqlCandidateBridge(async () => validCommitSha);

    const tamperedSnapshot = JSON.parse(JSON.stringify(snapshot));
    tamperedSnapshot.files[0].content = tamperedSnapshot.files[0].content + '\n// tampered';

    await expect(
      bridge(analysis, tamperedSnapshot, ingestion, orgId),
    ).rejects.toThrow();
  });

  it('fails closed when resumed analysis findings or fingerprint are tampered', async () => {
    const { snapshot, ingestion, analysis } = await createDetectedPipeline();
    const bridge = createSqlCandidateBridge(async () => validCommitSha);

    const tamperedAnalysis = JSON.parse(JSON.stringify(analysis));
    tamperedAnalysis.resultFingerprint = 'sha256:' + '0'.repeat(64);

    await expect(
      bridge(tamperedAnalysis, snapshot, ingestion, orgId),
    ).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
  });

  it('fails closed when analysis snapshot identity does not match ingestion snapshot identity', async () => {
    const { snapshot, ingestion, analysis } = await createDetectedPipeline();
    const bridge = createSqlCandidateBridge(async () => validCommitSha);

    const otherSnapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-002',
        repositoryId: repoId,
        organizationId: orgId,
        files: [{ path: 'src/routes.ts', content: sampleExpressSource }],
      },
      orgId,
    );

    await expect(
      bridge(analysis, otherSnapshot, ingestion, orgId),
    ).rejects.toThrow();
  });

  it('fails closed when commit verification callback fails or returns invalid commit SHA on resume', async () => {
    const { snapshot, ingestion, analysis } = await createDetectedPipeline();

    const bridgeZeroSha = createSqlCandidateBridge(async () => '0'.repeat(40));
    await expect(
      bridgeZeroSha(analysis, snapshot, ingestion, orgId),
    ).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const bridgeInvalidSha = createSqlCandidateBridge(async () => 'not-a-valid-sha');
    await expect(
      bridgeInvalidSha(analysis, snapshot, ingestion, orgId),
    ).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const bridgeFailing = createSqlCandidateBridge(async () => {
      throw new Error('M3_HOST_VERIFICATION_FAILED');
    });
    await expect(
      bridgeFailing(analysis, snapshot, ingestion, orgId),
    ).rejects.toThrow('M3_HOST_VERIFICATION_FAILED');
  });

  it('preserves non-authoritative boundary across restart-resume, maintaining CANDIDATE verification state', async () => {
    const { snapshot, ingestion, analysis } = await createDetectedPipeline();
    const bridge = createSqlCandidateBridge(async () => validCommitSha);

    const restartedAnalysis = JSON.parse(JSON.stringify(analysis));
    const restartedSnapshot = JSON.parse(JSON.stringify(snapshot));
    const restartedIngestion = JSON.parse(JSON.stringify(ingestion));

    const candidates = await bridge(
      restartedAnalysis,
      restartedSnapshot,
      restartedIngestion,
      orgId,
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].candidate.verificationState).toBe('CANDIDATE');
    expect(candidates[0].candidate.reachabilityState).toBe('REACHABLE');
    expect(candidates[0].candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidates[0].candidate.snapshot.commitSha).toBe(validCommitSha);
    expect((candidates[0].candidate as any).capability).toBeUndefined();
    expect((candidates[0] as any).capability).toBeUndefined();
  });
});
