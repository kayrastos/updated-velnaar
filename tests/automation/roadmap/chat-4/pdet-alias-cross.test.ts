import { describe, it, expect } from 'vitest';
import { captureSnapshot, validateSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress, validateExpressIngestion } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';

const org = 'org_chat4';

const helperContent = `export function buildQuery(userInput: any) {
  const queryAlias = userInput;
  return 'SELECT * FROM users WHERE name = ' + queryAlias;
}
`;

const appContent = `import express from 'express';
import { buildQuery as makeQuery } from './helper';

export function createApp(db: any) {
  const app = express();
  function handleUsers(req: any, res: any) {
    const rawInput = req.query.name;
    const inputAlias = rawInput;
    const sql = makeQuery(inputAlias);
    const sqlAlias = sql;
    const statement = db.prepare(sqlAlias);
    const rows = statement.all();
    return res.json(rows);
  }
  app.get('/users', handleUsers);
  return app;
}
`;

const fixtureInput = {
  fixtureId: 'm2-case-001',
  repositoryId: 'repo-pdet-alias-cross',
  organizationId: org,
  files: [
    { path: 'src/helper.ts', content: helperContent },
    { path: 'src/app.ts', content: appContent },
  ],
};

describe('RM_PDET_ALIAS_CROSS Pipeline Determinism Regression', () => {
  it('deterministically captures snapshot and ingests express routes with cross-file imports', async () => {
    const snapshot1 = await captureSnapshot(fixtureInput, org);
    const snapshot2 = await captureSnapshot(fixtureInput, org);

    expect(snapshot1.snapshotId).toBe(snapshot2.snapshotId);
    expect(snapshot1.totalBytes).toBe(snapshot2.totalBytes);
    expect(snapshot1.files).toHaveLength(2);

    const validatedSnapshot = await validateSnapshot(snapshot1, org);
    expect(validatedSnapshot.snapshotId).toBe(snapshot1.snapshotId);

    const ingestion1 = await ingestExpress(snapshot1, org);
    const ingestion2 = await ingestExpress(snapshot2, org);

    expect(ingestion1.ingestionIdentity).toBe(ingestion2.ingestionIdentity);
    expect(ingestion1.routes).toHaveLength(1);
    expect(ingestion1.routes[0].method).toBe('GET');
    expect(ingestion1.routes[0].path).toBe('/users');

    const validatedIngestion = await validateExpressIngestion(ingestion1, org);
    expect(validatedIngestion.ingestionIdentity).toBe(ingestion1.ingestionIdentity);
  });

  it('deterministically detects SQL injection across cross-file alias propagation', async () => {
    const snapshot1 = await captureSnapshot(fixtureInput, org);
    const snapshot2 = await captureSnapshot(fixtureInput, org);
    const ingestion1 = await ingestExpress(snapshot1, org);
    const ingestion2 = await ingestExpress(snapshot2, org);

    const analysis1 = await detectSqlInjection(snapshot1, ingestion1, org);
    const analysis2 = await detectSqlInjection(snapshot2, ingestion2, org);

    expect(analysis1.status).toBe('DETECTED');
    expect(analysis2.status).toBe('DETECTED');
    expect(analysis1.resultFingerprint).toBe(analysis2.resultFingerprint);
    expect(analysis1.findings).toHaveLength(1);
    expect(analysis2.findings).toHaveLength(1);

    const finding1 = analysis1.findings[0];
    const finding2 = analysis2.findings[0];
    expect(finding1.findingId).toBe(finding2.findingId);
    expect(finding1.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding1.source.filePath).toBe('src/app.ts');
    expect(finding1.source.symbol).toBe('query.name');
    expect(finding1.sink.filePath).toBe('src/app.ts');
    expect(finding1.sink.symbol).toBe('db.prepare');

    const validated = await validateSqlAnalysis(analysis1, snapshot1, ingestion1, org);
    expect(validated.resultFingerprint).toBe(analysis1.resultFingerprint);
  });

  it('tracks cross-file taint flow steps across aliased import and parameter boundaries', async () => {
    const snapshot = await captureSnapshot(fixtureInput, org);
    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);

    expect(analysis.status).toBe('DETECTED');
    const finding = analysis.findings[0];
    const flow = finding.flow;
    expect(flow.length).toBeGreaterThanOrEqual(7);

    const kinds = flow.map((step) => step.kind);
    expect(kinds).toContain('SOURCE');
    expect(kinds).toContain('VARIABLE');
    expect(kinds).toContain('CALL');
    expect(kinds).toContain('ARGUMENT');
    expect(kinds).toContain('CONCAT');
    expect(kinds).toContain('RETURN');
    expect(kinds).toContain('SINK');

    const appSteps = flow.filter((step) => step.location.filePath === 'src/app.ts');
    const helperSteps = flow.filter((step) => step.location.filePath === 'src/helper.ts');
    expect(appSteps.length).toBeGreaterThan(0);
    expect(helperSteps.length).toBeGreaterThan(0);

    expect(appSteps.some((step) => step.location.symbol === 'inputAlias')).toBe(true);
    expect(helperSteps.some((step) => step.location.symbol === 'queryAlias')).toBe(true);
    expect(appSteps.some((step) => step.location.symbol === 'sqlAlias')).toBe(true);
  });

  it('preserves non-authoritative boundary on analysis without inventing capabilities', async () => {
    const snapshot = await captureSnapshot(fixtureInput, org);
    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);

    expect((analysis as any).capability).toBeUndefined();
    expect((analysis as any).verificationState).toBeUndefined();
    expect((analysis as any).verified).toBeUndefined();
    expect((analysis as any).action).toBeUndefined();

    await expect(validateSnapshot(snapshot, 'foreign_org')).rejects.toThrow();

    const otherSnapshot = await captureSnapshot(
      { ...fixtureInput, repositoryId: 'repo-other' },
      org,
    );
    await expect(
      detectSqlInjection(otherSnapshot, ingestion, org),
    ).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');

    const forgedAnalysis = {
      ...analysis,
      resultFingerprint: 'sha256:' + '0'.repeat(64),
    };
    await expect(
      validateSqlAnalysis(forgedAnalysis, snapshot, ingestion, org),
    ).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
  });
});
