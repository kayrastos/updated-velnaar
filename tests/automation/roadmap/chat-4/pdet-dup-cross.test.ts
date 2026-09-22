import { describe, it, expect } from 'vitest';
import { captureSnapshot, validateSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress, validateExpressIngestion } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';

const org = 'org_pdet_dup_cross';

const helperFile = {
  path: 'src/helper.ts',
  content: `export function collapseDuplicateParam(db: any, query: any) {
  const combined = query + query;
  return db.prepare('SELECT * FROM users WHERE id = ' + combined).all();
}
`,
};

const appFile = {
  path: 'src/app.ts',
  content: `import express from 'express';
import { collapseDuplicateParam } from './helper';

export function createApp(db: any) {
  const app = express();
  function searchHandler(req: any, res: any) {
    const q = req.query.id;
    const rows = collapseDuplicateParam(db, q);
    return res.json(rows);
  }
  app.get('/search', searchHandler);
  return app;
}
`,
};

describe('Pipeline Determinism: Cross-File Duplicate Collapse', () => {
  it('collapses duplicate cross-file dataflow steps without triggering MULTIPLE_SOURCES', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-cross-dup',
        organizationId: org,
        files: [appFile, helperFile],
      },
      org,
    );

    expect(snapshot.files).toHaveLength(2);
    expect(snapshot.files[0].path).toBe('src/app.ts');
    expect(snapshot.files[1].path).toBe('src/helper.ts');

    const expressIngestion = await ingestExpress(snapshot, org);
    expect(expressIngestion.routes).toHaveLength(1);
    expect(expressIngestion.routes[0].path).toBe('/search');

    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
    expect(analysis.status).toBe('DETECTED');
    expect(analysis.findings).toHaveLength(1);

    const finding = analysis.findings[0];
    expect(finding.source.filePath).toBe('src/app.ts');
    expect(finding.sink.filePath).toBe('src/helper.ts');

    const sourceSteps = finding.flow.filter((step) => step.kind === 'SOURCE');
    expect(sourceSteps).toHaveLength(1);
    expect(sourceSteps[0].location.filePath).toBe('src/app.ts');

    const validated = await validateSqlAnalysis(analysis, snapshot, expressIngestion, org);
    expect(validated.resultFingerprint).toBe(analysis.resultFingerprint);
  });

  it('preserves determinism regardless of cross-file snapshot input order', async () => {
    const snapshotOrderA = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-cross-order',
        organizationId: org,
        files: [appFile, helperFile],
      },
      org,
    );

    const snapshotOrderB = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-cross-order',
        organizationId: org,
        files: [helperFile, appFile],
      },
      org,
    );

    expect(snapshotOrderA.snapshotId).toBe(snapshotOrderB.snapshotId);
    expect(snapshotOrderA.files[0].path).toBe('src/app.ts');
    expect(snapshotOrderB.files[0].path).toBe('src/app.ts');

    const ingestionA = await ingestExpress(snapshotOrderA, org);
    const ingestionB = await ingestExpress(snapshotOrderB, org);
    expect(ingestionA.ingestionIdentity).toBe(ingestionB.ingestionIdentity);

    const analysisA = await detectSqlInjection(snapshotOrderA, ingestionA, org);
    const analysisB = await detectSqlInjection(snapshotOrderB, ingestionB, org);
    expect(analysisA.resultFingerprint).toBe(analysisB.resultFingerprint);
    expect(analysisA.status).toBe('DETECTED');
    expect(analysisB.status).toBe('DETECTED');
  });

  it('rejects duplicate cross-file paths and case collisions during snapshot capture', async () => {
    await expect(
      captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: 'repo-dup-paths',
          organizationId: org,
          files: [appFile, helperFile, helperFile],
        },
        org,
      ),
    ).rejects.toThrow('duplicate canonical path');

    await expect(
      captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: 'repo-dup-case',
          organizationId: org,
          files: [
            appFile,
            helperFile,
            {
              path: 'src/Helper.ts',
              content: 'export const duplicateCase = true;\n',
            },
          ],
        },
        org,
      ),
    ).rejects.toThrow('duplicate canonical path');
  });

  it('collapses candidate hypotheses across cross-file findings and preserves non-authoritative boundary', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-cross-candidate',
        organizationId: org,
        files: [appFile, helperFile],
      },
      org,
    );

    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);
    expect(analysis.status).toBe('DETECTED');

    const commitSha = 'a'.repeat(40);
    const bridge = createSqlCandidateBridge(async () => commitSha);

    const hypothesesA = await bridge(analysis, snapshot, ingestion, org);
    const hypothesesB = await bridge(analysis, snapshot, ingestion, org);

    expect(hypothesesA).toHaveLength(1);
    expect(hypothesesB).toHaveLength(1);

    const candidateA = hypothesesA[0].candidate;
    const candidateB = hypothesesB[0].candidate;

    expect(candidateA.candidateId).toBe(candidateB.candidateId);
    expect(hypothesesA[0].candidateBinding).toBe(hypothesesB[0].candidateBinding);

    expect(candidateA.verificationState).toBe('CANDIDATE');
    expect(candidateA.verificationState).not.toBe('VERIFIED');
    expect(candidateA.reachabilityState).toBe('REACHABLE');
    expect(candidateA.vulnerabilityClass).toBe('SQL_INJECTION');

    expect(candidateA.source.filePath).toBe('src/app.ts');
    expect(candidateA.sink.filePath).toBe('src/helper.ts');
    expect(candidateA.snapshot.commitSha).toBe(commitSha);

    const invalidBridge = createSqlCandidateBridge(async () => '0'.repeat(40));
    await expect(invalidBridge(analysis, snapshot, ingestion, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
  });

  it('validates snapshot and ingestion integrity across async boundaries', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-integrity',
        organizationId: org,
        files: [appFile, helperFile],
      },
      org,
    );

    const validatedSnapshot = await validateSnapshot(snapshot, org);
    expect(validatedSnapshot.snapshotId).toBe(snapshot.snapshotId);

    const ingestion = await ingestExpress(validatedSnapshot, org);
    const validatedIngestion = await validateExpressIngestion(ingestion, org);
    expect(validatedIngestion.ingestionIdentity).toBe(ingestion.ingestionIdentity);

    await expect(validateSnapshot(snapshot, 'foreign_org')).rejects.toThrow('tenant mismatch');
    await expect(validateExpressIngestion(ingestion, 'foreign_org')).rejects.toThrow('tenant mismatch');
  });
});
