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

describe('V1 Pipeline Replay Determinism: Cross-File Analysis Integration', () => {
  const org = 'org_pdet_cross';
  const repoId = 'repo-pdet-cross';
  const fixtureId = 'm2-case-001';
  const commitSha = '1234567890abcdef1234567890abcdef12345678';

  const helperContent = [
    'export function buildQuery(id: string): string {',
    '  const prefix = "SELECT * FROM users WHERE id = ";',
    '  const query = prefix + id;',
    '  return query;',
    '}',
  ].join('\n') + '\n';

  const routesContent = [
    'import express from "express";',
    'import { buildQuery } from "./helper";',
    '',
    'export function createApp(db: any) {',
    '  const app = express();',
    '  function handleGetUser(req: any, res: any) {',
    '    const id = req.query.id;',
    '    const sql = buildQuery(id);',
    '    const stmt = db.prepare(sql);',
    '    const rows = stmt.all();',
    '    res.json(rows);',
    '  }',
    '  app.get("/user", handleGetUser);',
    '  return app;',
    '}',
  ].join('\n') + '\n';

  const fileA = { path: 'src/helper.ts', content: helperContent };
  const fileB = { path: 'src/routes.ts', content: routesContent };

  const bridge = createSqlCandidateBridge(async () => commitSha);

  const runPipeline = async (files: readonly { path: string; content: string }[]) => {
    const snapshot = await captureSnapshot(
      {
        fixtureId,
        repositoryId: repoId,
        organizationId: org,
        files,
      },
      org,
    );
    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);
    const candidates = await bridge(analysis, snapshot, ingestion, org);
    return { snapshot, ingestion, analysis, candidates };
  };

  it('produces bit-for-bit identical snapshot, ingestion, analysis, and candidate identities on replay', async () => {
    const replay1 = await runPipeline([fileA, fileB]);
    const replay2 = await runPipeline([fileA, fileB]);
    const replay3 = await runPipeline([fileB, fileA]);

    expect(replay1.analysis.status).toBe('DETECTED');
    expect(replay1.analysis.findings).toHaveLength(1);
    expect(replay1.candidates).toHaveLength(1);

    expect(replay1.snapshot.snapshotId).toBe(replay2.snapshot.snapshotId);
    expect(replay1.snapshot.snapshotId).toBe(replay3.snapshot.snapshotId);
    expect(replay1.snapshot.totalBytes).toBe(replay2.snapshot.totalBytes);
    expect(replay1.snapshot.totalBytes).toBe(replay3.snapshot.totalBytes);

    expect(replay1.ingestion.ingestionIdentity).toBe(replay2.ingestion.ingestionIdentity);
    expect(replay1.ingestion.ingestionIdentity).toBe(replay3.ingestion.ingestionIdentity);

    expect(replay1.analysis.resultFingerprint).toBe(replay2.analysis.resultFingerprint);
    expect(replay1.analysis.resultFingerprint).toBe(replay3.analysis.resultFingerprint);
    expect(replay1.analysis.findings[0].findingId).toBe(replay2.analysis.findings[0].findingId);
    expect(replay1.analysis.findings[0].findingId).toBe(replay3.analysis.findings[0].findingId);

    expect(replay1.candidates[0].candidate.candidateId).toBe(replay2.candidates[0].candidate.candidateId);
    expect(replay1.candidates[0].candidate.candidateId).toBe(replay3.candidates[0].candidate.candidateId);
    expect(replay1.candidates[0].candidateBinding).toBe(replay2.candidates[0].candidateBinding);
    expect(replay1.candidates[0].candidateBinding).toBe(replay3.candidates[0].candidateBinding);
  });

  it('preserves multi-file flow steps and provenance deterministically across replays', async () => {
    const replay1 = await runPipeline([fileA, fileB]);
    const replay2 = await runPipeline([fileA, fileB]);

    const flow1 = replay1.analysis.findings[0].flow;
    const flow2 = replay2.analysis.findings[0].flow;

    expect(flow1.length).toBeGreaterThan(0);
    expect(flow1.length).toBe(flow2.length);

    for (let i = 0; i < flow1.length; i++) {
      expect(flow1[i].id).toBe(flow2[i].id);
      expect(flow1[i].kind).toBe(flow2[i].kind);
      expect(flow1[i].location.filePath).toBe(flow2[i].location.filePath);
      expect(flow1[i].location.line).toBe(flow2[i].location.line);
      expect(flow1[i].location.column).toBe(flow2[i].location.column);
    }

    const filePaths = new Set(flow1.map((step) => step.location.filePath));
    expect(filePaths.has('src/routes.ts')).toBe(true);
    expect(filePaths.has('src/helper.ts')).toBe(true);
  });

  it('validates canonical structural integrity across replay artifacts and enforces non-authoritative boundary', async () => {
    const { snapshot, ingestion, analysis, candidates } = await runPipeline([fileA, fileB]);

    const validatedSnapshot = await validateSnapshot(snapshot, org);
    expect(validatedSnapshot.snapshotId).toBe(snapshot.snapshotId);

    const validatedIngestion = await validateExpressIngestion(ingestion, org);
    expect(validatedIngestion.ingestionIdentity).toBe(ingestion.ingestionIdentity);

    const validatedAnalysis = await validateSqlAnalysis(analysis, snapshot, ingestion, org);
    expect(validatedAnalysis.resultFingerprint).toBe(analysis.resultFingerprint);

    const hypothesis = candidates[0];
    expect(hypothesis.candidate.verificationState).toBe('CANDIDATE');
    expect(hypothesis.candidate.reachabilityState).toBe('REACHABLE');
    expect(hypothesis.candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(hypothesis.candidate.snapshot.commitSha).toBe(commitSha);

    await expect(validateSnapshot(snapshot, 'foreign_org')).rejects.toThrow();
    await expect(validateExpressIngestion(ingestion, 'foreign_org')).rejects.toThrow();
    await expect(validateSqlAnalysis(analysis, snapshot, ingestion, 'foreign_org')).rejects.toThrow();
  });
});
