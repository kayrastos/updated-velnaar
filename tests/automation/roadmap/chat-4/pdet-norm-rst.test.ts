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

describe('V1 Pipeline Determinism: Normalization Boundary Restart-Resume', () => {
  const org = 'org_pdet_norm_rst';
  const repoId = 'repo-norm-rst';
  const fixtureId = 'm2-case-001';
  const validCommitSha = 'a'.repeat(40);

  const canonicalSource = [
    "import express from 'express';",
    '',
    'export function createApp(db: any) {',
    '  const app = express();',
    '  function searchHandler(req: any, res: any) {',
    '    const term = req.query.q;',
    "    const sql = 'SELECT * FROM items WHERE name = ' + term;",
    '    const stmt = db.prepare(sql);',
    '    const rows = stmt.all();',
    '    res.json(rows);',
    '  }',
    "  app.get('/search', searchHandler);",
    '  return app;',
    '}',
  ].join('\n');

  const canonicalInput = {
    fixtureId,
    repositoryId: repoId,
    organizationId: org,
    files: [
      {
        path: 'src/app.ts',
        content: canonicalSource,
      },
    ],
  };

  it('preserves bit-for-bit determinism when resuming from serialized artifacts across normalization boundaries', async () => {
    const initialSnapshot = await captureSnapshot(canonicalInput, org);
    const initialIngestion = await ingestExpress(initialSnapshot, org);
    const initialAnalysis = await detectSqlInjection(initialSnapshot, initialIngestion, org);
    const bridge = createSqlCandidateBridge(async () => validCommitSha);
    const initialCandidates = await bridge(initialAnalysis, initialSnapshot, initialIngestion, org);

    expect(initialAnalysis.status).toBe('DETECTED');
    expect(initialAnalysis.findings.length).toBe(1);
    expect(initialCandidates.length).toBe(1);
    expect(initialCandidates[0].candidate.verificationState).toBe('CANDIDATE');

    // Boundary 1: Snapshot restart-resume serialization
    const serializedSnapshot = JSON.parse(JSON.stringify(initialSnapshot));
    const resumedSnapshot = await validateSnapshot(serializedSnapshot, org);
    expect(resumedSnapshot.snapshotId).toBe(initialSnapshot.snapshotId);
    expect(canonical(resumedSnapshot)).toBe(canonical(initialSnapshot));

    // Boundary 2: Express ingestion restart-resume serialization
    const serializedIngestion = JSON.parse(JSON.stringify(initialIngestion));
    const resumedIngestion = await validateExpressIngestion(serializedIngestion, org);
    expect(resumedIngestion.ingestionIdentity).toBe(initialIngestion.ingestionIdentity);
    expect(canonical(resumedIngestion)).toBe(canonical(initialIngestion));

    // Boundary 3: SQL analysis restart-resume serialization
    const serializedAnalysis = JSON.parse(JSON.stringify(initialAnalysis));
    const resumedAnalysis = await validateSqlAnalysis(serializedAnalysis, resumedSnapshot, resumedIngestion, org);
    expect(resumedAnalysis.resultFingerprint).toBe(initialAnalysis.resultFingerprint);
    expect(canonical(resumedAnalysis)).toBe(canonical(initialAnalysis));

    // Boundary 4: Candidate bridge resumption
    const resumedCandidates = await bridge(resumedAnalysis, resumedSnapshot, resumedIngestion, org);
    expect(resumedCandidates.length).toBe(1);
    expect(resumedCandidates[0].candidate.candidateId).toBe(initialCandidates[0].candidate.candidateId);
    expect(resumedCandidates[0].candidateBinding).toBe(initialCandidates[0].candidateBinding);
    expect(canonical(resumedCandidates)).toBe(canonical(initialCandidates));
  });

  it('produces identical identities and fingerprints between a fresh run and a resumed pipeline', async () => {
    const freshSnapshot = await captureSnapshot(canonicalInput, org);
    const freshIngestion = await ingestExpress(freshSnapshot, org);
    const freshAnalysis = await detectSqlInjection(freshSnapshot, freshIngestion, org);
    const bridge = createSqlCandidateBridge(async () => validCommitSha);
    const freshCandidates = await bridge(freshAnalysis, freshSnapshot, freshIngestion, org);

    const resumedAnalysis = await detectSqlInjection(freshSnapshot, freshIngestion, org);
    const resumedCandidates = await bridge(resumedAnalysis, freshSnapshot, freshIngestion, org);

    expect(freshSnapshot.snapshotId).toBe(resumedAnalysis.snapshotId);
    expect(freshIngestion.ingestionIdentity).toBe(resumedAnalysis.ingestionIdentity);
    expect(resumedAnalysis.resultFingerprint).toBe(freshAnalysis.resultFingerprint);
    expect(resumedCandidates[0].candidate.candidateId).toBe(freshCandidates[0].candidate.candidateId);
    expect(resumedCandidates[0].candidateBinding).toBe(freshCandidates[0].candidateBinding);
  });

  it('fails closed when resumed snapshot, ingestion, or analysis metadata is tampered or mismatched', async () => {
    const snapshot = await captureSnapshot(canonicalInput, org);
    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);

    // 1. Resumed snapshot with tenant mismatch
    const serializedSnapshot = JSON.parse(JSON.stringify(snapshot));
    await expect(validateSnapshot(serializedSnapshot, 'foreign_org')).rejects.toThrow();

    // 2. Resumed snapshot with modified file content
    const tamperedSnapshot = JSON.parse(JSON.stringify(snapshot));
    tamperedSnapshot.files[0].content = 'export const tampered = true;\n';
    await expect(validateSnapshot(tamperedSnapshot, org)).rejects.toThrow();

    // 3. Resumed ingestion with tenant mismatch
    const serializedIngestion = JSON.parse(JSON.stringify(ingestion));
    await expect(validateExpressIngestion(serializedIngestion, 'foreign_org')).rejects.toThrow();

    // 4. Resumed ingestion with tampered route path
    const tamperedIngestion = JSON.parse(JSON.stringify(ingestion));
    tamperedIngestion.routes[0].path = '/tampered';
    await expect(validateExpressIngestion(tamperedIngestion, org)).rejects.toThrow();

    // 5. Resumed analysis with forged result fingerprint
    const tamperedAnalysis = JSON.parse(JSON.stringify(analysis));
    tamperedAnalysis.resultFingerprint = 'sha256:' + '0'.repeat(64);
    await expect(validateSqlAnalysis(tamperedAnalysis, snapshot, ingestion, org)).rejects.toThrow();

    // 6. Resumed analysis paired with mismatched snapshot
    const otherInput = {
      ...canonicalInput,
      files: [
        {
          path: 'src/app.ts',
          content: canonicalSource.replace('/search', '/lookup'),
        },
      ],
    };
    const otherSnapshot = await captureSnapshot(otherInput, org);
    await expect(detectSqlInjection(otherSnapshot, ingestion, org)).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
  });

  it('enforces non-authoritative boundary on candidate state across restart-resume without claiming verified authority', async () => {
    const snapshot = await captureSnapshot(canonicalInput, org);
    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);
    const bridge = createSqlCandidateBridge(async () => validCommitSha);

    const serializedAnalysis = JSON.parse(JSON.stringify(analysis));
    const candidates = await bridge(serializedAnalysis, snapshot, ingestion, org);

    expect(candidates.length).toBe(1);
    const hypothesis = candidates[0];

    expect(hypothesis.candidate.verificationState).toBe('CANDIDATE');
    expect(hypothesis.candidate.reachabilityState).toBe('REACHABLE');
    expect((hypothesis.candidate as any).status).toBeUndefined();
    expect((hypothesis as any).capability).toBeUndefined();
    expect((hypothesis.candidate as any).capability).toBeUndefined();
  });
});
