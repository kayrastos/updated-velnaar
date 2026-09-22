import { describe, it, expect } from 'vitest';
import {
  captureSnapshot,
  validateSnapshot,
  canonical,
  type SourceSnapshot,
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

const SAMPLE_SOURCE = `import express from 'express';

function stageTwo(val: string): string {
  const s2 = val;
  return s2;
}

function stageOne(raw: string): string {
  const s1 = stageTwo(raw);
  return s1;
}

export function createApp(db: any) {
  const app = express();

  function handleSearch(req: any, res: any) {
    const rawInput = req.query.id;
    const processed = stageOne(rawInput);
    const query = "SELECT * FROM items WHERE id = '" + processed + "'";
    const stmt = db.prepare(query);
    const rows = stmt.all();
    return res.json(rows);
  }

  app.get('/items', handleSearch);
  return app;
}
`;

describe('Pipeline Determinism - Nested Flow Multi-Stage Integration', () => {
  const org = 'org_pdet_multi';
  const repo = 'repo_pdet_multi';
  const fixture = 'm2-case-001';
  const validCommitSha = 'a1b2c3d4e5f6789012345678901234567890abcd';

  async function runFullPipeline() {
    const snapshot = await captureSnapshot(
      {
        fixtureId: fixture,
        repositoryId: repo,
        organizationId: org,
        files: [{ path: 'src/routes.ts', content: SAMPLE_SOURCE }],
      },
      org,
    );

    const expressIngestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);

    const bridge = createSqlCandidateBridge(async (snap: SourceSnapshot) => {
      expect(snap.snapshotId).toBe(snapshot.snapshotId);
      return validCommitSha;
    });

    const candidates = await bridge(analysis, snapshot, expressIngestion, org);

    return { snapshot, expressIngestion, analysis, candidates };
  }

  it('produces identical bit-for-bit artifacts across repeated multi-stage pipeline runs', async () => {
    const run1 = await runFullPipeline();
    const run2 = await runFullPipeline();

    expect(run1.snapshot.snapshotId).toBe(run2.snapshot.snapshotId);
    expect(run1.snapshot.totalBytes).toBe(run2.snapshot.totalBytes);
    expect(canonical(run1.snapshot)).toBe(canonical(run2.snapshot));

    expect(run1.expressIngestion.ingestionIdentity).toBe(run2.expressIngestion.ingestionIdentity);
    expect(run1.expressIngestion.routes.length).toBe(1);
    expect(run1.expressIngestion.routes[0].routeIdentity).toBe(run2.expressIngestion.routes[0].routeIdentity);
    expect(canonical(run1.expressIngestion)).toBe(canonical(run2.expressIngestion));

    expect(run1.analysis.status).toBe('DETECTED');
    expect(run2.analysis.status).toBe('DETECTED');
    expect(run1.analysis.resultFingerprint).toBe(run2.analysis.resultFingerprint);
    expect(run1.analysis.findings.length).toBe(1);
    expect(run2.analysis.findings.length).toBe(1);
    expect(run1.analysis.findings[0].findingId).toBe(run2.analysis.findings[0].findingId);
    expect(canonical(run1.analysis)).toBe(canonical(run2.analysis));

    expect(run1.candidates.length).toBe(1);
    expect(run2.candidates.length).toBe(1);
    expect(run1.candidates[0].candidate.candidateId).toBe(run2.candidates[0].candidate.candidateId);
    expect(run1.candidates[0].candidateBinding).toBe(run2.candidates[0].candidateBinding);
    expect(canonical(run1.candidates)).toBe(canonical(run2.candidates));
  });

  it('accurately captures deterministic nested call steps through stage transformations', async () => {
    const { analysis } = await runFullPipeline();

    expect(analysis.status).toBe('DETECTED');
    const finding = analysis.findings[0];
    const flowKinds = finding.flow.map(step => step.kind);

    expect(flowKinds[0]).toBe('SOURCE');
    expect(flowKinds).toContain('CALL');
    expect(flowKinds).toContain('ARGUMENT');
    expect(flowKinds).toContain('VARIABLE');
    expect(flowKinds).toContain('RETURN');
    expect(flowKinds).toContain('CONCAT');
    expect(flowKinds[flowKinds.length - 1]).toBe('SINK');

    for (const step of finding.flow) {
      expect(step.id).toMatch(/^sha256:[a-f0-9]{64}$/);
    }
  });

  it('validates integrity across all pipeline stages and rejects tampered artifacts', async () => {
    const { snapshot, expressIngestion, analysis } = await runFullPipeline();

    const validatedSnapshot = await validateSnapshot(snapshot, org);
    expect(validatedSnapshot.snapshotId).toBe(snapshot.snapshotId);

    const validatedExpress = await validateExpressIngestion(expressIngestion, org);
    expect(validatedExpress.ingestionIdentity).toBe(expressIngestion.ingestionIdentity);

    const validatedAnalysis = await validateSqlAnalysis(analysis, snapshot, expressIngestion, org);
    expect(validatedAnalysis.resultFingerprint).toBe(analysis.resultFingerprint);

    const forgedAnalysis = {
      ...analysis,
      status: 'NOT_DETECTED' as const,
      findings: [],
    };
    await expect(validateSqlAnalysis(forgedAnalysis, snapshot, expressIngestion, org)).rejects.toThrow(
      'M3_ANALYSIS_INTEGRITY_MISMATCH',
    );

    await expect(validateSnapshot(snapshot, 'org_other')).rejects.toThrow();
  });

  it('preserves non-authoritative boundary on candidate state', async () => {
    const { candidates } = await runFullPipeline();

    expect(candidates.length).toBe(1);
    const item = candidates[0];

    expect(item.candidate.verificationState).toBe('CANDIDATE');
    expect(item.candidate.verificationState).not.toBe('VERIFIED');
    expect(item.candidate.reachabilityState).toBe('REACHABLE');
    expect(item.candidate.vulnerabilityClass).toBe('SQL_INJECTION');

    const rejectBridge = createSqlCandidateBridge(async () => '0'.repeat(40));
    const { analysis, snapshot, expressIngestion } = await runFullPipeline();
    await expect(rejectBridge(analysis, snapshot, expressIngestion, org)).rejects.toThrow(
      'M3_CHECKED_COMMIT_REQUIRED',
    );
  });
});
