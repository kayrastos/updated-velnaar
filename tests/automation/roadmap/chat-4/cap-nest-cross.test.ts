import { describe, it, expect } from 'vitest';
import { captureSnapshot, hash } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import {
  assertTrustedCommitCapability,
  isTrustedCommitCapability,
  validateRepositoryIngestion,
} from '../../../../worker/intelligence/ingestion/repository';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';

describe('V1 Capability Enforcement: Nested Cross-File Dataflow', () => {
  const org = 'org_velnar_chat4';
  const repo = 'repo_cap_nest_cross';
  const fixture = 'm2-case-001';

  it('enforces that analysis of cross-file nested flows remains non-authoritative candidate findings without capability', async () => {
    const helperCode = [
      'export function executeSearch(db: any, term: any) {',
      '  return innerSearch(db, term);',
      '}',
      '',
      'function innerSearch(db: any, term: any) {',
      '  const query = "SELECT * FROM items WHERE id = " + term;',
      '  const stmt = db.prepare(query);',
      '  return stmt.all();',
      '}',
      '',
    ].join('\n');

    const routesCode = [
      'import express from "express";',
      'import { executeSearch } from "./helper";',
      '',
      'export function createApp(db: any) {',
      '  const app = express();',
      '  app.get("/search", handleSearch);',
      '  function handleSearch(req: any, res: any) {',
      '    const term = req.query.term;',
      '    const rows = executeSearch(db, term);',
      '    return res.json(rows);',
      '  }',
      '  return app;',
      '}',
      '',
    ].join('\n');

    const snapshot = await captureSnapshot(
      {
        fixtureId: fixture,
        repositoryId: repo,
        organizationId: org,
        files: [
          { path: 'src/helper.ts', content: helperCode },
          { path: 'src/routes.ts', content: routesCode },
        ],
      },
      org,
    );

    expect(snapshot.files).toHaveLength(2);
    expect((snapshot as any).capability).toBeUndefined();
    expect(isTrustedCommitCapability((snapshot as any).capability, snapshot as any)).toBe(false);
    expect(() => assertTrustedCommitCapability((snapshot as any).capability, snapshot as any)).toThrow();

    const expressIngestion = await ingestExpress(snapshot, org);
    expect(expressIngestion.routes).toHaveLength(1);
    expect(expressIngestion.routes[0].path).toBe('/search');
    expect(expressIngestion.routes[0].method).toBe('GET');
    expect((expressIngestion as any).capability).toBeUndefined();
    expect(isTrustedCommitCapability((expressIngestion as any).capability, expressIngestion as any)).toBe(false);
    expect(() => assertTrustedCommitCapability((expressIngestion as any).capability, expressIngestion as any)).toThrow();

    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
    expect(analysis.status).toBe('DETECTED');
    expect(analysis.findings).toHaveLength(1);
    expect(analysis.limitations).toHaveLength(0);

    const finding = analysis.findings[0];
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.source.symbol).toBe('query.term');
    expect(finding.sink.symbol).toBe('db.prepare');
    expect(finding.source.filePath).toBe('src/routes.ts');
    expect(finding.sink.filePath).toBe('src/helper.ts');

    const validated = await validateSqlAnalysis(analysis, snapshot, expressIngestion, org);
    expect(validated.resultFingerprint).toBe(analysis.resultFingerprint);

    expect((analysis as any).capability).toBeUndefined();
    expect(isTrustedCommitCapability((analysis as any).capability, analysis as any)).toBe(false);
    expect(() => assertTrustedCommitCapability((analysis as any).capability, analysis as any)).toThrow();
    expect(isTrustedCommitCapability(analysis, analysis as any)).toBe(false);
    expect(() => assertTrustedCommitCapability(analysis, analysis as any)).toThrow();

    const forgedCapability = Object.freeze({
      [Symbol.toStringTag]: 'TrustedCommitCapability' as const,
    });
    expect(isTrustedCommitCapability(forgedCapability, analysis as any)).toBe(false);
    expect(() => assertTrustedCommitCapability(forgedCapability, analysis as any)).toThrow();

    const bridge = createSqlCandidateBridge(async () => 'a'.repeat(40));
    const hypotheses = await bridge(analysis, snapshot, expressIngestion, org);
    expect(hypotheses).toHaveLength(1);
    expect(hypotheses[0].candidate.verificationState).toBe('CANDIDATE');
    expect(hypotheses[0].candidate.reachabilityState).toBe('REACHABLE');
    expect((hypotheses[0] as any).capability).toBeUndefined();
    expect((hypotheses[0].candidate as any).capability).toBeUndefined();
    expect(isTrustedCommitCapability((hypotheses[0] as any).capability, undefined as any)).toBe(false);
    expect(() => assertTrustedCommitCapability((hypotheses[0] as any).capability, undefined as any)).toThrow();

    const commitSha = 'b'.repeat(40);
    const ingestionBody = {
      version: 'velnar-repository-ingestion-v1' as const,
      organizationId: org,
      repositoryId: repo,
      commitSha,
      snapshot,
    };
    const ingestionIdentity = await hash('velnar-repository-ingestion-v1', ingestionBody);
    const ingestionRecord = { ...ingestionBody, ingestionIdentity };
    const validatedIngestion = await validateRepositoryIngestion(ingestionRecord, org);
    expect(validatedIngestion.ingestionIdentity).toBe(ingestionIdentity);
    expect((validatedIngestion as any).capability).toBeUndefined();
    expect(isTrustedCommitCapability((validatedIngestion as any).capability, validatedIngestion)).toBe(false);
    expect(() => assertTrustedCommitCapability((validatedIngestion as any).capability, validatedIngestion)).toThrow();
  });
});
