import { describe, it, expect } from 'vitest';
import {
  captureSnapshot,
  validateSnapshot,
  canonical,
  detachJson,
} from '../../../../worker/intelligence/ingestion/snapshot';
import {
  ingestExpress,
  validateExpressIngestion,
} from '../../../../worker/intelligence/ingestion/express';
import {
  detectSqlInjection,
  validateSqlAnalysis,
} from '../../../../worker/intelligence/detection/sqlInjection';

const org = 'org_pdet_rst';
const repoId = 'repo-pdet-id-rst';
const fixtureId = 'm2-case-001';

const sampleAppSource = `import express from 'express';

export function createApp(db: any) {
  const app = express();
  function searchHandler(req: any, res: any) {
    const term = req.query.q;
    const query = "SELECT * FROM items WHERE name = '" + term;
    const statement = db.prepare(query);
    const rows = statement.all();
    return res.json(rows);
  }
  app.get('/search', searchHandler);
  return app;
}
`;

function createPipelineInput() {
  return {
    fixtureId,
    repositoryId: repoId,
    organizationId: org,
    files: [
      {
        path: 'src/app.ts',
        content: sampleAppSource,
      },
    ],
  };
}

describe('Pipeline Determinism - Identity Stability across Restart and Resume', () => {
  it('preserves complete identity chain across JSON serialization restart and resume', async () => {
    const input = createPipelineInput();
    const initialSnapshot = await captureSnapshot(input, org);
    const initialIngestion = await ingestExpress(initialSnapshot, org);
    const initialAnalysis = await detectSqlInjection(initialSnapshot, initialIngestion, org);

    expect(initialAnalysis.status).toBe('DETECTED');
    expect(initialAnalysis.findings.length).toBe(1);

    const resumedSnapshotRaw = JSON.parse(JSON.stringify(initialSnapshot));
    const resumedIngestionRaw = JSON.parse(JSON.stringify(initialIngestion));
    const resumedAnalysisRaw = JSON.parse(JSON.stringify(initialAnalysis));

    const resumedSnapshot = await validateSnapshot(resumedSnapshotRaw, org);
    expect(resumedSnapshot.snapshotId).toBe(initialSnapshot.snapshotId);
    expect(resumedSnapshot.totalBytes).toBe(initialSnapshot.totalBytes);
    expect(resumedSnapshot.files[0].fileIdentity).toBe(initialSnapshot.files[0].fileIdentity);
    expect(resumedSnapshot.files[0].contentDigest).toBe(initialSnapshot.files[0].contentDigest);

    const resumedIngestion = await validateExpressIngestion(resumedIngestionRaw, org);
    expect(resumedIngestion.ingestionIdentity).toBe(initialIngestion.ingestionIdentity);
    expect(resumedIngestion.routes[0].routeIdentity).toBe(initialIngestion.routes[0].routeIdentity);

    const resumedAnalysis = await validateSqlAnalysis(
      resumedAnalysisRaw,
      resumedSnapshot,
      resumedIngestion,
      org,
    );

    expect(resumedAnalysis.resultFingerprint).toBe(initialAnalysis.resultFingerprint);
    expect(resumedAnalysis.findings[0].findingId).toBe(initialAnalysis.findings[0].findingId);
    expect(resumedAnalysis.findings[0].flow[0].id).toBe(initialAnalysis.findings[0].flow[0].id);
    expect(canonical(resumedAnalysis)).toBe(canonical(initialAnalysis));
  });

  it('yields byte-for-byte and identity-identical pipeline outputs on re-execution restart', async () => {
    const input1 = createPipelineInput();
    const snapshot1 = await captureSnapshot(input1, org);
    const ingestion1 = await ingestExpress(snapshot1, org);
    const analysis1 = await detectSqlInjection(snapshot1, ingestion1, org);

    const input2 = createPipelineInput();
    const snapshot2 = await captureSnapshot(input2, org);
    const ingestion2 = await ingestExpress(snapshot2, org);
    const analysis2 = await detectSqlInjection(snapshot2, ingestion2, org);

    expect(snapshot2.snapshotId).toBe(snapshot1.snapshotId);
    expect(ingestion2.ingestionIdentity).toBe(ingestion1.ingestionIdentity);
    expect(ingestion2.routes[0].routeIdentity).toBe(ingestion1.routes[0].routeIdentity);
    expect(analysis2.resultFingerprint).toBe(analysis1.resultFingerprint);
    expect(analysis2.findings[0].findingId).toBe(analysis1.findings[0].findingId);
    expect(canonical(analysis2)).toBe(canonical(analysis1));
  });

  it('re-computes identical analysis when resuming from persisted snapshot and ingestion', async () => {
    const input = createPipelineInput();
    const initialSnapshot = await captureSnapshot(input, org);
    const initialIngestion = await ingestExpress(initialSnapshot, org);
    const initialAnalysis = await detectSqlInjection(initialSnapshot, initialIngestion, org);

    const detachedSnapshot = detachJson(initialSnapshot);
    const detachedIngestion = detachJson(initialIngestion);

    const resumedAnalysis = await detectSqlInjection(detachedSnapshot, detachedIngestion, org);

    expect(resumedAnalysis.resultFingerprint).toBe(initialAnalysis.resultFingerprint);
    expect(resumedAnalysis.findings[0].findingId).toBe(initialAnalysis.findings[0].findingId);
    expect(canonical(resumedAnalysis)).toBe(canonical(initialAnalysis));
  });

  it('fails closed when resumed snapshot identity is tampered', async () => {
    const input = createPipelineInput();
    const snapshot = await captureSnapshot(input, org);
    const tampered = {
      ...snapshot,
      snapshotId: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    };

    await expect(validateSnapshot(tampered, org)).rejects.toThrow();
  });

  it('fails closed when resumed analysis fingerprint does not match computed analysis', async () => {
    const input = createPipelineInput();
    const snapshot = await captureSnapshot(input, org);
    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);

    const tampered = {
      ...analysis,
      resultFingerprint: 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    };

    await expect(validateSqlAnalysis(tampered, snapshot, ingestion, org)).rejects.toThrow(
      'M3_ANALYSIS_INTEGRITY_MISMATCH',
    );
  });

  it('fails closed when resumed analysis is paired with a mismatched snapshot', async () => {
    const input1 = createPipelineInput();
    const snapshot1 = await captureSnapshot(input1, org);
    const ingestion1 = await ingestExpress(snapshot1, org);
    const analysis1 = await detectSqlInjection(snapshot1, ingestion1, org);

    const differentInput = {
      ...createPipelineInput(),
      fixtureId: 'm2-case-002',
    };
    const snapshot2 = await captureSnapshot(differentInput, org);

    await expect(detectSqlInjection(snapshot2, ingestion1, org)).rejects.toThrow(
      'M3_ANALYSIS_SNAPSHOT_MISMATCH',
    );

    await expect(validateSqlAnalysis(analysis1, snapshot2, ingestion1, org)).rejects.toThrow(
      'M3_ANALYSIS_SNAPSHOT_MISMATCH',
    );
  });
});
