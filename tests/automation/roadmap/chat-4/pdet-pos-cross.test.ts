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

describe('Pipeline Determinism Positive Control Cross-File', () => {
  const org = 'org_chat4_pdet';

  const queryFile = {
    path: 'src/query.ts',
    content: [
      'export function buildQuery(userInput: string) {',
      "  const query = 'SELECT * FROM records WHERE id = ' + userInput;",
      '  return query;',
      '}',
      '',
    ].join('\n'),
  };

  const appFile = {
    path: 'src/app.ts',
    content: [
      "import express from 'express';",
      "import { buildQuery } from './query';",
      '',
      'export function createApp(db: any) {',
      '  const app = express();',
      '',
      '  function handleRecord(req: any, res: any) {',
      '    const id = req.query.id;',
      '    const sql = buildQuery(id);',
      '    const rows = db.prepare(sql).all();',
      '    res.json(rows);',
      '  }',
      '',
      "  app.get('/record', handleRecord);",
      '  return app;',
      '}',
      '',
    ].join('\n'),
  };

  it('deterministically detects cross-file SQL injection and preserves pipeline identities', async () => {
    const input1 = {
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-pos-cross',
      organizationId: org,
      files: [queryFile, appFile],
    };

    const input2 = {
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-pos-cross',
      organizationId: org,
      files: [queryFile, appFile],
    };

    const snapshot1 = await captureSnapshot(input1, org);
    const snapshot2 = await captureSnapshot(input2, org);

    expect(snapshot1.snapshotId).toBe(snapshot2.snapshotId);
    expect(snapshot1.totalBytes).toBe(snapshot2.totalBytes);

    const ingestion1 = await ingestExpress(snapshot1, org);
    const ingestion2 = await ingestExpress(snapshot2, org);

    expect(ingestion1.ingestionIdentity).toBe(ingestion2.ingestionIdentity);
    expect(ingestion1.routes.length).toBe(1);

    const analysis1 = await detectSqlInjection(snapshot1, ingestion1, org);
    const analysis2 = await detectSqlInjection(snapshot2, ingestion2, org);

    expect(analysis1.resultFingerprint).toBe(analysis2.resultFingerprint);
    expect(analysis1.status).toBe('DETECTED');
    expect(analysis2.status).toBe('DETECTED');
    expect(analysis1.findings.length).toBe(1);
    expect(analysis1.limitations.length).toBe(0);

    const finding1 = analysis1.findings[0];
    const finding2 = analysis2.findings[0];
    expect(finding1).toBeDefined();
    expect(finding2).toBeDefined();

    if (!finding1 || !finding2) {
      throw new Error('Expected findings to be present');
    }

    expect(finding1.findingId).toBe(finding2.findingId);
    expect(finding1.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding1.source.filePath).toBe('src/app.ts');
    expect(finding1.source.symbol).toBe('query.id');
    expect(finding1.sink.filePath).toBe('src/app.ts');
    expect(finding1.sink.symbol).toBe('db.prepare');

    const flowPaths = finding1.flow.map((step) => step.location.filePath);
    expect(flowPaths).toContain('src/app.ts');
    expect(flowPaths).toContain('src/query.ts');

    const validatedSnapshot = await validateSnapshot(snapshot1, org);
    expect(validatedSnapshot.snapshotId).toBe(snapshot1.snapshotId);

    const validatedIngestion = await validateExpressIngestion(ingestion1, org);
    expect(validatedIngestion.ingestionIdentity).toBe(ingestion1.ingestionIdentity);

    const validatedAnalysis = await validateSqlAnalysis(analysis1, snapshot1, ingestion1, org);
    expect(validatedAnalysis.resultFingerprint).toBe(analysis1.resultFingerprint);

    expect('capability' in analysis1).toBe(false);
    expect('verificationState' in analysis1).toBe(false);
  });

  it('preserves determinism across file input order', async () => {
    const forward = {
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-pos-cross',
      organizationId: org,
      files: [queryFile, appFile],
    };

    const reversed = {
      fixtureId: 'm2-case-001',
      repositoryId: 'repo-pos-cross',
      organizationId: org,
      files: [appFile, queryFile],
    };

    const snapForward = await captureSnapshot(forward, org);
    const snapReversed = await captureSnapshot(reversed, org);
    expect(snapForward.snapshotId).toBe(snapReversed.snapshotId);

    const ingForward = await ingestExpress(snapForward, org);
    const ingReversed = await ingestExpress(snapReversed, org);
    expect(ingForward.ingestionIdentity).toBe(ingReversed.ingestionIdentity);

    const anaForward = await detectSqlInjection(snapForward, ingForward, org);
    const anaReversed = await detectSqlInjection(snapReversed, ingReversed, org);
    expect(anaForward.resultFingerprint).toBe(anaReversed.resultFingerprint);
    expect(anaForward.status).toBe('DETECTED');
  });
});
