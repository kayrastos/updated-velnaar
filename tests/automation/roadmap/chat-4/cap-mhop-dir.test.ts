import { describe, it, expect } from 'vitest';
import { captureSnapshot, validateSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress, validateExpressIngestion } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import {
  isTrustedCommitCapability,
  assertTrustedCommitCapability,
} from '../../../../worker/intelligence/ingestion/repository';

describe('Roadmap Chat-4 Capability Enforcement: Direct Multi-Hop Flow', () => {
  const org = 'org_apex_holding';
  const validCommitSha = 'a'.repeat(40);

  const vulnerableSource = `import express from 'express';

export function createApp(db: any) {
  const app = express();

  function stepTwo(val: any) {
    const hop2 = val;
    return hop2;
  }

  function stepOne(val: any) {
    const hop1 = stepTwo(val);
    return hop1;
  }

  function searchHandler(req: any, res: any) {
    const raw = req.query.id;
    const tainted = stepOne(raw);
    const sql = 'SELECT * FROM items WHERE id = ' + tainted;
    const stmt = db.prepare(sql);
    const rows = stmt.all();
    res.json(rows);
  }

  app.get('/search', searchHandler);
  return app;
}
`;

  const cleanSource = `import express from 'express';

export function createApp(db: any) {
  const app = express();

  function stepTwo(val: any) {
    const hop2 = val;
    return hop2;
  }

  function stepOne(val: any) {
    const hop1 = stepTwo(val);
    return hop1;
  }

  function safeHandler(req: any, res: any) {
    const raw = req.query.id;
    const safeVal = stepOne(raw);
    const stmt = db.prepare('SELECT * FROM items WHERE id = ?');
    const rows = stmt.all(safeVal);
    res.json(rows);
  }

  app.get('/search', safeHandler);
  return app;
}
`;

  it('detects SQL injection through direct multi-hop dataflow', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-cap-mhop-dir',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: vulnerableSource }],
      },
      org,
    );

    const validSnapshot = await validateSnapshot(snapshot, org);
    expect(validSnapshot.snapshotId).toBe(snapshot.snapshotId);

    const expressIngestion = await ingestExpress(snapshot, org);
    const validExpress = await validateExpressIngestion(expressIngestion, org);
    expect(validExpress.ingestionIdentity).toBe(expressIngestion.ingestionIdentity);
    expect(expressIngestion.routes).toHaveLength(1);
    expect(expressIngestion.routes[0].path).toBe('/search');

    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
    const validatedAnalysis = await validateSqlAnalysis(analysis, snapshot, expressIngestion, org);
    expect(validatedAnalysis.resultFingerprint).toBe(analysis.resultFingerprint);

    expect(analysis.status).toBe('DETECTED');
    expect(analysis.findings).toHaveLength(1);

    const finding = analysis.findings[0];
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.routeIdentity).toBe(expressIngestion.routes[0].routeIdentity);
    expect(finding.source.symbol).toBe('query.id');
    expect(finding.sink.symbol).toBe('db.prepare');
    expect(finding.flow.length).toBeGreaterThan(2);

    const sourceStep = finding.flow.find((s) => s.kind === 'SOURCE');
    const sinkStep = finding.flow.find((s) => s.kind === 'SINK');
    expect(sourceStep).toBeDefined();
    expect(sinkStep).toBeDefined();
  });

  it('enforces that analysis and candidate findings remain non-authoritative without commit capability', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-cap-mhop-dir',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: vulnerableSource }],
      },
      org,
    );

    const expressIngestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);

    const candidateBridge = createSqlCandidateBridge(async (snap) => {
      expect(snap.snapshotId).toBe(snapshot.snapshotId);
      return validCommitSha;
    });

    const candidateResults = await candidateBridge(analysis, snapshot, expressIngestion, org);
    expect(candidateResults).toHaveLength(1);

    const hypothesis = candidateResults[0];
    expect(hypothesis.candidate.verificationState).toBe('CANDIDATE');
    expect(hypothesis.candidate.reachabilityState).toBe('REACHABLE');
    expect(hypothesis.candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(hypothesis.candidate.snapshot.commitSha).toBe(validCommitSha);
    expect(typeof hypothesis.candidateBinding).toBe('string');

    expect(isTrustedCommitCapability((analysis as any).capability, null as any)).toBe(false);
    expect(isTrustedCommitCapability((hypothesis as any).capability, null as any)).toBe(false);
    expect(isTrustedCommitCapability(hypothesis.candidate, null as any)).toBe(false);
    expect(() => assertTrustedCommitCapability(hypothesis.candidate, null as any)).toThrow('unauthorized commit capability');
  });

  it('enforces checked commit requirements in candidate bridge', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-cap-mhop-dir',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: vulnerableSource }],
      },
      org,
    );

    const expressIngestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);

    const zeroCommitBridge = createSqlCandidateBridge(async () => '0'.repeat(40));
    await expect(zeroCommitBridge(analysis, snapshot, expressIngestion, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const emptyCommitBridge = createSqlCandidateBridge(async () => '');
    await expect(emptyCommitBridge(analysis, snapshot, expressIngestion, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
  });

  it('yields NOT_DETECTED and mints no candidate hypotheses when multi-hop flow is clean', async () => {
    const cleanSnapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-cap-mhop-dir',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: cleanSource }],
      },
      org,
    );

    const cleanExpress = await ingestExpress(cleanSnapshot, org);
    const cleanAnalysis = await detectSqlInjection(cleanSnapshot, cleanExpress, org);

    expect(cleanAnalysis.status).toBe('NOT_DETECTED');
    expect(cleanAnalysis.findings).toHaveLength(0);

    const bridge = createSqlCandidateBridge(async () => validCommitSha);
    const candidates = await bridge(cleanAnalysis, cleanSnapshot, cleanExpress, org);
    expect(candidates).toEqual([]);
  });
});
