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

const orgId = 'org_velnar_pdet';
const repoId = 'repo-pdet-wrap-cross';
const fixtureId = 'm2-case-001';

const wrapperSource = [
  'export function wrapQuery(input: string): string {',
  "  const prefix = \"SELECT * FROM records WHERE name = '\";",
  '  const query = prefix + input;',
  '  return query;',
  '}',
  '',
  'export function cleanWrap(input: string): string {',
  "  const query = 'SELECT * FROM records WHERE id = 1';",
  '  return query;',
  '}',
  '',
].join('\n');

const appSource = [
  "import express from 'express';",
  "import { wrapQuery, cleanWrap } from './wrapper';",
  '',
  'export function createApp(db: any) {',
  '  const app = express();',
  '',
  '  function vulnHandler(req: any, res: any) {',
  '    const term = req.query.term;',
  '    const sql = wrapQuery(term);',
  '    const stmt = db.prepare(sql);',
  '    const rows = stmt.all();',
  '    return res.json(rows);',
  '  }',
  '',
  '  function safeHandler(req: any, res: any) {',
  '    const term = req.query.term;',
  '    const sql = cleanWrap(term);',
  '    const stmt = db.prepare(sql);',
  '    const rows = stmt.all();',
  '    return res.json(rows);',
  '  }',
  '',
  "  app.get('/vuln', vulnHandler);",
  "  app.get('/safe', safeHandler);",
  '  return app;',
  '}',
  '',
].join('\n');

describe('Pipeline Determinism: Wrapper Boundary Cross-File', () => {
  it('deterministically captures snapshots and ingests cross-file express routes', async () => {
    const files = [
      { path: 'src/app.ts', content: appSource },
      { path: 'src/wrapper.ts', content: wrapperSource },
    ];

    const snapshotA = await captureSnapshot(
      { fixtureId, repositoryId: repoId, organizationId: orgId, files },
      orgId,
    );
    const snapshotB = await captureSnapshot(
      { fixtureId, repositoryId: repoId, organizationId: orgId, files },
      orgId,
    );

    expect(snapshotA.snapshotId).toBe(snapshotB.snapshotId);
    expect(snapshotA.files.length).toBe(2);

    const validatedSnapshot = await validateSnapshot(snapshotA, orgId);
    expect(validatedSnapshot.snapshotId).toBe(snapshotA.snapshotId);

    const ingestionA = await ingestExpress(snapshotA, orgId);
    const ingestionB = await ingestExpress(snapshotB, orgId);

    expect(ingestionA.ingestionIdentity).toBe(ingestionB.ingestionIdentity);
    expect(ingestionA.routes.length).toBe(2);
    expect(ingestionA.sourceUnits.length).toBe(2);

    const validatedIngestion = await validateExpressIngestion(ingestionA, orgId);
    expect(validatedIngestion.ingestionIdentity).toBe(ingestionA.ingestionIdentity);
  });

  it('deterministically detects SQL injection across cross-file wrapper boundary', async () => {
    const files = [
      { path: 'src/app.ts', content: appSource },
      { path: 'src/wrapper.ts', content: wrapperSource },
    ];

    const snapshot = await captureSnapshot(
      { fixtureId, repositoryId: repoId, organizationId: orgId, files },
      orgId,
    );
    const ingestion = await ingestExpress(snapshot, orgId);

    const analysisA = await detectSqlInjection(snapshot, ingestion, orgId);
    const analysisB = await detectSqlInjection(snapshot, ingestion, orgId);

    expect(analysisA.resultFingerprint).toBe(analysisB.resultFingerprint);
    expect(analysisA.status).toBe('DETECTED');
    expect(analysisA.limitations.length).toBe(0);
    expect(analysisA.findings.length).toBe(1);

    const finding = analysisA.findings[0];
    expect(finding.findingId).toBe(analysisB.findings[0].findingId);
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');

    const flowPaths = finding.flow.map((step) => step.location.filePath);
    expect(flowPaths).toContain('src/app.ts');
    expect(flowPaths).toContain('src/wrapper.ts');

    expect(finding.source.filePath).toBe('src/app.ts');
    expect(finding.source.symbol).toBe('query.term');
    expect(finding.sink.filePath).toBe('src/app.ts');
    expect(finding.sink.symbol).toBe('db.prepare');

    const vulnRoute = ingestion.routes.find((r) => r.path === '/vuln');
    const safeRoute = ingestion.routes.find((r) => r.path === '/safe');
    expect(vulnRoute).toBeDefined();
    expect(safeRoute).toBeDefined();
    expect(finding.routeIdentity).toBe(vulnRoute!.routeIdentity);
    expect(finding.routeIdentity).not.toBe(safeRoute!.routeIdentity);

    const verifiedAnalysis = await validateSqlAnalysis(analysisA, snapshot, ingestion, orgId);
    expect(verifiedAnalysis.resultFingerprint).toBe(analysisA.resultFingerprint);

    expect((analysisA as any).capability).toBeUndefined();
    expect((analysisA as any).verificationState).toBeUndefined();
  });

  it('fails closed when analysis fingerprint or tenant is tampered with', async () => {
    const files = [
      { path: 'src/app.ts', content: appSource },
      { path: 'src/wrapper.ts', content: wrapperSource },
    ];

    const snapshot = await captureSnapshot(
      { fixtureId, repositoryId: repoId, organizationId: orgId, files },
      orgId,
    );
    const ingestion = await ingestExpress(snapshot, orgId);
    const genuine = await detectSqlInjection(snapshot, ingestion, orgId);

    const tampered = {
      ...genuine,
      resultFingerprint: 'sha256:' + '0'.repeat(64),
    };

    await expect(validateSqlAnalysis(tampered, snapshot, ingestion, orgId)).rejects.toThrow(
      'M3_ANALYSIS_INTEGRITY_MISMATCH',
    );

    await expect(validateSnapshot(snapshot, 'foreign_org')).rejects.toThrow('tenant mismatch');
    await expect(validateExpressIngestion(ingestion, 'foreign_org')).rejects.toThrow(
      'tenant mismatch',
    );
  });

  it('deterministically reports NOT_DETECTED when wrapper isolates query from input', async () => {
    const cleanAppSource = [
      "import express from 'express';",
      "import { cleanWrap } from './wrapper';",
      '',
      'export function createApp(db: any) {',
      '  const app = express();',
      '',
      '  function isolatedHandler(req: any, res: any) {',
      '    const term = req.query.term;',
      '    const sql = cleanWrap(term);',
      '    const stmt = db.prepare(sql);',
      '    const rows = stmt.all();',
      '    return res.json(rows);',
      '  }',
      '',
      "  app.get('/isolated', isolatedHandler);",
      '  return app;',
      '}',
      '',
    ].join('\n');

    const files = [
      { path: 'src/app.ts', content: cleanAppSource },
      { path: 'src/wrapper.ts', content: wrapperSource },
    ];

    const snapshot = await captureSnapshot(
      { fixtureId, repositoryId: repoId, organizationId: orgId, files },
      orgId,
    );
    const ingestion = await ingestExpress(snapshot, orgId);

    const analysisA = await detectSqlInjection(snapshot, ingestion, orgId);
    const analysisB = await detectSqlInjection(snapshot, ingestion, orgId);

    expect(analysisA.status).toBe('NOT_DETECTED');
    expect(analysisA.findings.length).toBe(0);
    expect(analysisA.limitations.length).toBe(0);
    expect(analysisA.resultFingerprint).toBe(analysisB.resultFingerprint);

    const verified = await validateSqlAnalysis(analysisA, snapshot, ingestion, orgId);
    expect(verified.resultFingerprint).toBe(analysisA.resultFingerprint);
  });
});
