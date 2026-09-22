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

describe('Pipeline Determinism - Multi-Hop Flow Cross-File (RM_PDET_MHOP_CROSS)', () => {
  const org = 'org_pdet_cross';

  const routesContent = `import express from 'express';
import { composeQuery } from './query';

export function createApp(db: any) {
  const app = express();
  function searchHandler(req: any, res: any) {
    const term = req.query.term;
    const sql = composeQuery(term);
    const rows = db.prepare(sql).all();
    res.json(rows);
  }
  app.get('/search', searchHandler);
  return app;
}
`;

  const queryContent = `import { formatFilter } from './filter';

export function composeQuery(term: any) {
  const filter = formatFilter(term);
  const query = 'SELECT * FROM items WHERE ' + filter;
  return query;
}
`;

  const filterContent = `export function formatFilter(input: any) {
  const clause = 'category = ' + input;
  return clause;
}
`;

  const safeRoutesContent = `import express from 'express';
import { composeSafeQuery } from './safeQuery';

export function createApp(db: any) {
  const app = express();
  function safeHandler(req: any, res: any) {
    const term = req.query.term;
    const sql = composeSafeQuery(term);
    const rows = db.prepare(sql).all(term);
    res.json(rows);
  }
  app.get('/safe', safeHandler);
  return app;
}
`;

  const safeQueryContent = `export function composeSafeQuery(term: any) {
  const query = 'SELECT * FROM items WHERE category = ?';
  return query;
}
`;

  it('deterministically captures, ingests, and analyzes multi-hop cross-file taint flows', async () => {
    const files = [
      { path: 'src/routes.ts', content: routesContent },
      { path: 'src/query.ts', content: queryContent },
      { path: 'src/filter.ts', content: filterContent },
    ];

    const snapshotA = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-mhop-cross',
        organizationId: org,
        files,
      },
      org,
    );

    const snapshotB = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-mhop-cross',
        organizationId: org,
        files,
      },
      org,
    );

    expect(snapshotA.snapshotId).toBe(snapshotB.snapshotId);
    expect(snapshotA.files.length).toBe(3);

    const expressA = await ingestExpress(snapshotA, org);
    const expressB = await ingestExpress(snapshotB, org);

    expect(expressA.ingestionIdentity).toBe(expressB.ingestionIdentity);
    expect(expressA.routes.length).toBe(1);
    expect(expressA.routes[0].path).toBe('/search');
    expect(expressA.routes[0].method).toBe('GET');

    const analysisA = await detectSqlInjection(snapshotA, expressA, org);
    const analysisB = await detectSqlInjection(snapshotB, expressB, org);

    expect(analysisA.status).toBe('DETECTED');
    expect(analysisA.resultFingerprint).toBe(analysisB.resultFingerprint);
    expect(analysisA.findings.length).toBe(1);
    expect(analysisB.findings.length).toBe(1);

    const finding = analysisA.findings[0];
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.source.symbol).toBe('query.term');
    expect(finding.source.filePath).toBe('src/routes.ts');
    expect(finding.sink.symbol).toBe('db.prepare');
    expect(finding.sink.filePath).toBe('src/routes.ts');

    const spannedFiles = Array.from(
      new Set(finding.flow.map((step) => step.location.filePath)),
    ).sort();
    expect(spannedFiles).toEqual([
      'src/filter.ts',
      'src/query.ts',
      'src/routes.ts',
    ]);

    const flowKinds = finding.flow.map((step) => step.kind);
    expect(flowKinds).toContain('SOURCE');
    expect(flowKinds).toContain('CALL');
    expect(flowKinds).toContain('ARGUMENT');
    expect(flowKinds).toContain('CONCAT');
    expect(flowKinds).toContain('RETURN');
    expect(flowKinds).toContain('SINK');

    expect(analysisA.findings).toEqual(analysisB.findings);

    const validatedAnalysis = await validateSqlAnalysis(
      analysisA,
      snapshotA,
      expressA,
      org,
    );
    expect(validatedAnalysis.resultFingerprint).toBe(analysisA.resultFingerprint);

    const bridge = createSqlCandidateBridge(async (snap) => {
      expect(snap.snapshotId).toBe(snapshotA.snapshotId);
      return '1234567890abcdef1234567890abcdef12345678';
    });

    const candidatesA = await bridge(analysisA, snapshotA, expressA, org);
    const candidatesB = await bridge(analysisB, snapshotB, expressB, org);

    expect(candidatesA.length).toBe(1);
    expect(candidatesA[0].candidate.verificationState).toBe('CANDIDATE');
    expect(candidatesA[0].candidate.reachabilityState).toBe('REACHABLE');
    expect(candidatesA[0].candidate.snapshot.commitSha).toBe(
      '1234567890abcdef1234567890abcdef12345678',
    );
    expect(candidatesA[0].candidate.candidateId).toBe(
      candidatesB[0].candidate.candidateId,
    );
    expect(candidatesA[0].candidateBinding).toBe(
      candidatesB[0].candidateBinding,
    );
  });

  it('verifies safe parameterized multi-hop flow yields NOT_DETECTED deterministically', async () => {
    const files = [
      { path: 'src/routes.ts', content: safeRoutesContent },
      { path: 'src/safeQuery.ts', content: safeQueryContent },
    ];

    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-mhop-safe',
        organizationId: org,
        files,
      },
      org,
    );

    const expressIngestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);

    expect(analysis.status).toBe('NOT_DETECTED');
    expect(analysis.findings.length).toBe(0);
    expect(analysis.limitations.length).toBe(0);

    const bridge = createSqlCandidateBridge(async () => {
      return '1234567890abcdef1234567890abcdef12345678';
    });
    const candidates = await bridge(analysis, snapshot, expressIngestion, org);
    expect(candidates).toEqual([]);
  });

  it('fails closed on forged analysis and cross-tenant boundary validation', async () => {
    const files = [
      { path: 'src/routes.ts', content: routesContent },
      { path: 'src/query.ts', content: queryContent },
      { path: 'src/filter.ts', content: filterContent },
    ];

    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-mhop-cross',
        organizationId: org,
        files,
      },
      org,
    );

    const expressIngestion = await ingestExpress(snapshot, org);
    const genuineAnalysis = await detectSqlInjection(snapshot, expressIngestion, org);

    await expect(validateSnapshot(snapshot, 'foreign_org')).rejects.toThrow();
    await expect(validateExpressIngestion(expressIngestion, 'foreign_org')).rejects.toThrow();

    const forgedAnalysis = {
      ...genuineAnalysis,
      resultFingerprint: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    };

    await expect(
      validateSqlAnalysis(forgedAnalysis, snapshot, expressIngestion, org),
    ).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
  });
});
