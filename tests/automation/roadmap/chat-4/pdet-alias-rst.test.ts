import { describe, it, expect } from 'vitest';
import { captureSnapshot, validateSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress, validateExpressIngestion } from '../../../../worker/intelligence/ingestion/express';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';

describe('Pipeline Determinism - Alias Propagation Restart/Resume', () => {
  const org = 'org_chat4_pdet';
  const repoId = 'repo_alias_rst';
  const commitSha = 'a'.repeat(40);

  const appSource = [
    "import express from 'express';",
    '',
    'export function createApp(db: any) {',
    '  const app = express();',
    '  function handleUsers(req: any, res: any) {',
    '    const rawId = req.query.id;',
    '    const aliasId = rawId;',
    "    const query = 'SELECT * FROM users WHERE id = ' + aliasId;",
    '    const stmt = db.prepare(query);',
    '    const rows = stmt.all();',
    '    return res.json(rows);',
    '  }',
    "  app.get('/users', handleUsers);",
    '  return app;',
    '}',
    '',
  ].join('\n');

  it('preserves deterministic pipeline identities across restart and resume with alias propagation', async () => {
    const files = [{ path: 'src/app.ts', content: appSource }];

    const initialSnapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: repoId,
        organizationId: org,
        files,
      },
      org,
    );

    const initialIngestion = await ingestExpress(initialSnapshot, org);
    const initialAnalysis = await detectSqlInjection(initialSnapshot, initialIngestion, org);

    expect(initialAnalysis.status).toBe('DETECTED');
    expect(initialAnalysis.findings.length).toBe(1);

    const finding = initialAnalysis.findings[0];
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.flow.some((step) => step.kind === 'SOURCE' && step.location.symbol === 'query.id')).toBe(true);
    expect(finding.flow.some((step) => step.kind === 'VARIABLE' && step.location.symbol === 'rawId')).toBe(true);
    expect(finding.flow.some((step) => step.kind === 'VARIABLE' && step.location.symbol === 'aliasId')).toBe(true);
    expect(finding.flow.some((step) => step.kind === 'CONCAT' && step.location.symbol === '+')).toBe(true);
    expect(finding.flow.some((step) => step.kind === 'SINK' && step.location.symbol === 'db.prepare')).toBe(true);

    const bridge = createSqlCandidateBridge(async () => commitSha);
    const initialCandidates = await bridge(initialAnalysis, initialSnapshot, initialIngestion, org);

    expect(initialCandidates.length).toBe(1);
    expect(initialCandidates[0].candidate.verificationState).toBe('CANDIDATE');
    expect(initialCandidates[0].candidate.reachabilityState).toBe('REACHABLE');

    const serializedSnapshot = JSON.parse(JSON.stringify(initialSnapshot));
    const resumedSnapshot = await validateSnapshot(serializedSnapshot, org);

    const serializedIngestion = JSON.parse(JSON.stringify(initialIngestion));
    const resumedIngestion = await validateExpressIngestion(serializedIngestion, org);

    const serializedAnalysis = JSON.parse(JSON.stringify(initialAnalysis));
    const resumedAnalysis = await validateSqlAnalysis(serializedAnalysis, resumedSnapshot, resumedIngestion, org);

    const resumedCandidates = await bridge(resumedAnalysis, resumedSnapshot, resumedIngestion, org);

    expect(resumedSnapshot.snapshotId).toBe(initialSnapshot.snapshotId);
    expect(resumedSnapshot.totalBytes).toBe(initialSnapshot.totalBytes);

    expect(resumedIngestion.ingestionIdentity).toBe(initialIngestion.ingestionIdentity);
    expect(resumedIngestion.routes[0].routeIdentity).toBe(initialIngestion.routes[0].routeIdentity);

    expect(resumedAnalysis.resultFingerprint).toBe(initialAnalysis.resultFingerprint);
    expect(resumedAnalysis.findings[0].findingId).toBe(initialAnalysis.findings[0].findingId);

    expect(resumedCandidates.length).toBe(initialCandidates.length);
    expect(resumedCandidates[0].candidateBinding).toBe(initialCandidates[0].candidateBinding);
    expect(resumedCandidates[0].candidate.candidateId).toBe(initialCandidates[0].candidate.candidateId);
    expect(resumedCandidates[0].candidate.verificationState).toBe('CANDIDATE');

    const rerunSnapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: repoId,
        organizationId: org,
        files,
      },
      org,
    );
    const rerunIngestion = await ingestExpress(rerunSnapshot, org);
    const rerunAnalysis = await detectSqlInjection(rerunSnapshot, rerunIngestion, org);
    const rerunCandidates = await bridge(rerunAnalysis, rerunSnapshot, rerunIngestion, org);

    expect(rerunSnapshot.snapshotId).toBe(initialSnapshot.snapshotId);
    expect(rerunIngestion.ingestionIdentity).toBe(initialIngestion.ingestionIdentity);
    expect(rerunAnalysis.resultFingerprint).toBe(initialAnalysis.resultFingerprint);
    expect(rerunCandidates[0].candidateBinding).toBe(initialCandidates[0].candidateBinding);

    await expect(validateSnapshot(serializedSnapshot, 'foreign_org')).rejects.toThrow();
    await expect(validateExpressIngestion(serializedIngestion, 'foreign_org')).rejects.toThrow();
  });
});
