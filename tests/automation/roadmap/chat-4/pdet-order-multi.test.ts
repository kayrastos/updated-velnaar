import { describe, it, expect } from 'vitest';
import { captureSnapshot, validateSnapshot, canonical } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress, validateExpressIngestion } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';

const org = 'org_test_pdet_multi';
const fixtureId = 'm2-case-001';
const repoId = 'repo-pdet-order-multi';
const mockCommitSha = '1234567890abcdef1234567890abcdef12345678';

const helperCode = [
  'export function buildQuery(term: string) {',
  "  return \"SELECT * FROM items WHERE category = '\" + term + \"'\";",
  '}',
  '',
].join('\n');

const appCode = [
  "import express from 'express';",
  "import { buildQuery } from './helper';",
  '',
  'export function createApp(db: any) {',
  '  const app = express();',
  '',
  '  function searchHandler(req: any, res: any) {',
  '    const term = req.query.q;',
  '    const sql = buildQuery(term);',
  '    const stmt = db.prepare(sql);',
  '    const rows = stmt.all();',
  '    res.json(rows);',
  '  }',
  '',
  '  function directHandler(req: any, res: any) {',
  '    const id = req.query.id;',
  "    const sql = \"SELECT * FROM items WHERE id = '\" + id + \"'\";",
  '    const stmt = db.prepare(sql);',
  '    const rows = stmt.all();',
  '    res.json(rows);',
  '  }',
  '',
  "  app.get('/search', searchHandler);",
  "  app.get('/direct', directHandler);",
  '  return app;',
  '}',
  '',
].join('\n');

describe('Multi-Stage Pipeline Determinism & Order Stability (PDET_ORDER_MULTI)', () => {
  it('preserves multi-stage pipeline determinism and identical identities regardless of input file ordering', async () => {
    const filesForward = [
      { path: 'src/app.ts', content: appCode },
      { path: 'src/helper.ts', content: helperCode },
    ];
    const filesReversed = [
      { path: 'src/helper.ts', content: helperCode },
      { path: 'src/app.ts', content: appCode },
    ];

    // Stage 1: Snapshot Ingestion
    const snapForward = await captureSnapshot(
      { fixtureId, repositoryId: repoId, organizationId: org, files: filesForward },
      org,
    );
    const snapReversed = await captureSnapshot(
      { fixtureId, repositoryId: repoId, organizationId: org, files: filesReversed },
      org,
    );

    expect(snapForward.snapshotId).toBe(snapReversed.snapshotId);
    expect(snapForward.totalBytes).toBe(snapReversed.totalBytes);
    expect(snapForward.files.map((f) => f.path)).toEqual(['src/app.ts', 'src/helper.ts']);
    expect(snapReversed.files.map((f) => f.path)).toEqual(['src/app.ts', 'src/helper.ts']);
    expect(canonical(snapForward)).toBe(canonical(snapReversed));

    // Stage 2: Express Route Ingestion
    const ingestForward = await ingestExpress(snapForward, org);
    const ingestReversed = await ingestExpress(snapReversed, org);

    expect(ingestForward.ingestionIdentity).toBe(ingestReversed.ingestionIdentity);
    expect(canonical(ingestForward)).toBe(canonical(ingestReversed));
    expect(ingestForward.routes.length).toBe(2);
    expect(ingestForward.routes.map((r) => r.path)).toEqual(['/search', '/direct']);
    expect(ingestReversed.routes.map((r) => r.path)).toEqual(['/search', '/direct']);

    // Stage 3: SQL Injection Detection Analysis
    const analysisForward = await detectSqlInjection(snapForward, ingestForward, org);
    const analysisReversed = await detectSqlInjection(snapReversed, ingestReversed, org);

    expect(analysisForward.status).toBe('DETECTED');
    expect(analysisReversed.status).toBe('DETECTED');
    expect(analysisForward.resultFingerprint).toBe(analysisReversed.resultFingerprint);
    expect(analysisForward.findings.length).toBe(2);
    expect(analysisReversed.findings.length).toBe(2);
    expect(canonical(analysisForward)).toBe(canonical(analysisReversed));

    // Stage 4: Candidate Hypothesis Generation Bridge
    const bridge = createSqlCandidateBridge(async () => mockCommitSha);
    const candForward = await bridge(analysisForward, snapForward, ingestForward, org);
    const candReversed = await bridge(analysisReversed, snapReversed, ingestReversed, org);

    expect(candForward.length).toBe(2);
    expect(candReversed.length).toBe(2);
    expect(canonical(candForward)).toBe(canonical(candReversed));

    for (let i = 0; i < candForward.length; i++) {
      expect(candForward[i].candidate.candidateId).toBe(candReversed[i].candidate.candidateId);
      expect(candForward[i].candidateBinding).toBe(candReversed[i].candidateBinding);
      expect(candForward[i].candidate.verificationState).toBe('CANDIDATE');
      expect(candForward[i].candidate.reachabilityState).toBe('REACHABLE');
      expect(candForward[i].candidate.snapshot.commitSha).toBe(mockCommitSha);
    }
  });

  it('preserves strict route and finding order stability across repeated multi-stage pipeline evaluations', async () => {
    const files = [
      { path: 'src/app.ts', content: appCode },
      { path: 'src/helper.ts', content: helperCode },
    ];

    const bridge = createSqlCandidateBridge(async () => mockCommitSha);

    const run1Snap = await captureSnapshot({ fixtureId, repositoryId: repoId, organizationId: org, files }, org);
    const run1Ingest = await ingestExpress(run1Snap, org);
    const run1Analysis = await detectSqlInjection(run1Snap, run1Ingest, org);
    const run1Candidates = await bridge(run1Analysis, run1Snap, run1Ingest, org);

    const run2Snap = await captureSnapshot({ fixtureId, repositoryId: repoId, organizationId: org, files }, org);
    const run2Ingest = await ingestExpress(run2Snap, org);
    const run2Analysis = await detectSqlInjection(run2Snap, run2Ingest, org);
    const run2Candidates = await bridge(run2Analysis, run2Snap, run2Ingest, org);

    expect(run1Snap.snapshotId).toBe(run2Snap.snapshotId);
    expect(run1Ingest.ingestionIdentity).toBe(run2Ingest.ingestionIdentity);
    expect(run1Analysis.resultFingerprint).toBe(run2Analysis.resultFingerprint);
    expect(run1Candidates.length).toBe(run2Candidates.length);

    // Route order stability
    expect(run1Ingest.routes.map((r) => r.routeIdentity)).toEqual(run2Ingest.routes.map((r) => r.routeIdentity));

    // Finding order and flow step stability
    expect(run1Analysis.findings.map((f) => f.findingId)).toEqual(run2Analysis.findings.map((f) => f.findingId));
    for (let f = 0; f < run1Analysis.findings.length; f++) {
      const flow1 = run1Analysis.findings[f].flow;
      const flow2 = run2Analysis.findings[f].flow;
      expect(flow1.length).toBe(flow2.length);
      expect(flow1.map((s) => s.id)).toEqual(flow2.map((s) => s.id));
      expect(flow1.map((s) => s.kind)).toEqual(flow2.map((s) => s.kind));
    }

    // Candidate order and binding stability
    expect(run1Candidates.map((c) => c.candidate.candidateId)).toEqual(run2Candidates.map((c) => c.candidate.candidateId));
    expect(run1Candidates.map((c) => c.candidateBinding)).toEqual(run2Candidates.map((c) => c.candidateBinding));
  });

  it('validates intermediate pipeline stages idempotently without perturbing stage identities or order', async () => {
    const files = [
      { path: 'src/app.ts', content: appCode },
      { path: 'src/helper.ts', content: helperCode },
    ];

    const snap = await captureSnapshot({ fixtureId, repositoryId: repoId, organizationId: org, files }, org);
    const validatedSnap = await validateSnapshot(snap, org);
    expect(validatedSnap.snapshotId).toBe(snap.snapshotId);
    expect(canonical(validatedSnap)).toBe(canonical(snap));

    const ingest = await ingestExpress(validatedSnap, org);
    const validatedIngest = await validateExpressIngestion(ingest, org);
    expect(validatedIngest.ingestionIdentity).toBe(ingest.ingestionIdentity);
    expect(canonical(validatedIngest)).toBe(canonical(ingest));

    const analysis = await detectSqlInjection(validatedSnap, validatedIngest, org);
    const validatedAnalysis = await validateSqlAnalysis(analysis, validatedSnap, validatedIngest, org);
    expect(validatedAnalysis.resultFingerprint).toBe(analysis.resultFingerprint);
    expect(canonical(validatedAnalysis)).toBe(canonical(analysis));
  });

  it('enforces non-authoritative candidate boundary across multi-stage execution', async () => {
    const files = [
      { path: 'src/app.ts', content: appCode },
      { path: 'src/helper.ts', content: helperCode },
    ];

    const snap = await captureSnapshot({ fixtureId, repositoryId: repoId, organizationId: org, files }, org);
    const ingest = await ingestExpress(snap, org);
    const analysis = await detectSqlInjection(snap, ingest, org);

    const bridge = createSqlCandidateBridge(async () => mockCommitSha);
    const hypotheses = await bridge(analysis, snap, ingest, org);

    for (const item of hypotheses) {
      expect(item.candidate.verificationState).toBe('CANDIDATE');
      expect((item.candidate as any).verificationState).not.toBe('VERIFIED');
      expect((item as any).capability).toBeUndefined();
      expect(item.candidate.organizationId).toBe(org);
      expect(item.candidate.snapshot.commitSha).toBe(mockCommitSha);
    }
  });
});
