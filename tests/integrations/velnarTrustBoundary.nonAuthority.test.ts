// AUTO-RECONCILED CHAT-4 HISTORICAL CONTRACT SUCCESSOR
// Generated only from individually runtime-green historical variants.
// Canonical promotion requires separate human approval.

import { fulgorRayAdapter } from "../../src/integrations/fulgorRay/adapter";
import { createSqlCandidateBridge } from "../../worker/intelligence/detection/candidate";
import { detectSqlInjection } from "../../worker/intelligence/detection/sqlInjection";
import { validateSqlAnalysis } from "../../worker/intelligence/detection/sqlInjection";
import { ingestExpress } from "../../worker/intelligence/ingestion/express";
import { assertTrustedCommitCapability } from "../../worker/intelligence/ingestion/repository";
import { isTrustedCommitCapability } from "../../worker/intelligence/ingestion/repository";
import type { RepositoryIngestion } from "../../worker/intelligence/ingestion/repository";
import { validateRepositoryIngestion } from "../../worker/intelligence/ingestion/repository";
import { captureSnapshot } from "../../worker/intelligence/ingestion/snapshot";
import { hash } from "../../worker/intelligence/ingestion/snapshot";
import type { SourceSnapshot } from "../../worker/intelligence/ingestion/snapshot";
import { describe } from "vitest";
import { expect } from "vitest";
import { it } from "vitest";

{
  // Historical contract source: 20260919-012441-chat4-V1_CHAT4_C8H_009_NONAUTHOR_TY_SURFACE
  const sampleSource = `import express from 'express';
  
  export function createApp(db: any) {
    const app = express();
    function handleQuery(req: any, res: any) {
      const queryId = req.query.id;
      const stmt = db.prepare('SELECT * FROM users WHERE id = ' + queryId);
      const rows = stmt.all();
      return res.json(rows);
    }
    app.get('/users', handleQuery);
    return app;
  }
  `;
  
  
  describe('Velnar Trust Boundary: Non-Authority of Analysis and Integration Outputs', () => {
    it('guarantees structural SQL injection analysis does not expose action or verification authority', async () => {
      const org = 'org_nonauthority';
      const snapshot = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: 'repo-sample',
          organizationId: org,
          files: [{ path: 'src/routes.ts', content: sampleSource }],
        },
        org,
      );
  
      const ingestion = await ingestExpress(snapshot, org);
      const analysis = await detectSqlInjection(snapshot, ingestion, org);
  
      expect(analysis.status).toBe('DETECTED');
      expect(analysis.findings.length).toBeGreaterThan(0);
  
      expect((analysis as any).verificationState).toBeUndefined();
      expect((analysis as any).verified).toBeUndefined();
      expect((analysis as any).capability).toBeUndefined();
      expect((analysis as any).authority).toBeUndefined();
      expect((analysis as any).action).toBeUndefined();
      expect((analysis as any).actionAuthority).toBeUndefined();
      expect((analysis as any).executionAuthority).toBeUndefined();
  
      for (const finding of analysis.findings) {
        expect((finding as any).verificationState).toBeUndefined();
        expect((finding as any).verified).toBeUndefined();
        expect((finding as any).capability).toBeUndefined();
        expect((finding as any).actionAuthority).toBeUndefined();
        expect((finding as any).execute).toBeUndefined();
      }
  
      const fakeIngestion = {} as RepositoryIngestion;
      expect(isTrustedCommitCapability(analysis, fakeIngestion)).toBe(false);
      expect(isTrustedCommitCapability(snapshot, fakeIngestion)).toBe(false);
      expect(isTrustedCommitCapability(ingestion, fakeIngestion)).toBe(false);
  
      expect(() => assertTrustedCommitCapability(analysis, fakeIngestion)).toThrow('unauthorized commit capability');
    });
  
    it('ensures candidate hypotheses remain bounded to CANDIDATE state without minting action authority', async () => {
      const org = 'org_nonauthority';
      const snapshot = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: 'repo-sample',
          organizationId: org,
          files: [{ path: 'src/routes.ts', content: sampleSource }],
        },
        org,
      );
  
      const ingestion = await ingestExpress(snapshot, org);
      const analysis = await detectSqlInjection(snapshot, ingestion, org);
  
      const dummyCommitSha = '1'.repeat(40);
      const bridge = createSqlCandidateBridge(async () => dummyCommitSha);
      const candidates = await bridge(analysis, snapshot, ingestion, org);
  
      expect(candidates.length).toBeGreaterThan(0);
      const fakeIngestion = {} as RepositoryIngestion;
  
      for (const item of candidates) {
        expect(item.candidate.verificationState).toBe('CANDIDATE');
        expect(item.candidate.verificationState).not.toBe('VERIFIED');
  
        expect((item as any).capability).toBeUndefined();
        expect((item as any).authority).toBeUndefined();
        expect((item as any).action).toBeUndefined();
        expect((item.candidate as any).capability).toBeUndefined();
        expect((item.candidate as any).authority).toBeUndefined();
        expect((item.candidate as any).action).toBeUndefined();
        expect((item.candidate as any).actionAuthority).toBeUndefined();
        expect((item.candidate as any).remediationAuthority).toBeUndefined();
        expect((item.candidate as any).executionAuthority).toBeUndefined();
  
        expect(isTrustedCommitCapability(item, fakeIngestion)).toBe(false);
        expect(isTrustedCommitCapability(item.candidate, fakeIngestion)).toBe(false);
        expect(() => assertTrustedCommitCapability(item.candidate, fakeIngestion)).toThrow('unauthorized commit capability');
      }
    });
  
    it('ensures Fulgor Ray integration adapter maintains disabled non-authoritative boundary', async () => {
      expect(fulgorRayAdapter.isEnabled).toBe(false);
      expect(fulgorRayAdapter.status).toBe('DISABLED');
  
      const telemetryResult = await fulgorRayAdapter.emitTelemetry({
        organizationId: 'org_nonauthority',
        businessId: 'biz_test',
        eventType: 'lead.decay',
        timestamp: new Date().toISOString(),
        metrics: { latency: 100 },
      });
  
      expect(telemetryResult.delivered).toBe(false);
      expect((telemetryResult as any).capability).toBeUndefined();
      expect((telemetryResult as any).authority).toBeUndefined();
      expect((telemetryResult as any).action).toBeUndefined();
  
      const anomalyReport = await fulgorRayAdapter.checkAnomalies('biz_test');
      expect(anomalyReport.anomalyDetected).toBe(false);
      expect(anomalyReport.confidenceScore).toBe(0);
      expect((anomalyReport as any).capability).toBeUndefined();
      expect((anomalyReport as any).authority).toBeUndefined();
      expect((anomalyReport as any).action).toBeUndefined();
      expect((anomalyReport as any).verified).toBeUndefined();
  
      const fakeIngestion = {} as RepositoryIngestion;
      expect(isTrustedCommitCapability(telemetryResult, fakeIngestion)).toBe(false);
      expect(isTrustedCommitCapability(anomalyReport, fakeIngestion)).toBe(false);
    });
  });
}
{
  // Historical contract source: 20260919-022323-chat4-V1_CHAT4_C8H_038_NONAUTHOR_TY_SURFACE
  describe('Velnar Trust Boundary Non-Authority Surface Integration Regression', () => {
    const org = 'org_non_authority';
    const repoId = 'repo-non-authority';
    const fixtureId = 'm2-case-001';
    const commitSha = 'a'.repeat(40);
  
    const appContent = [
      "import express from 'express';",
      '',
      'export function createApp(db: any) {',
      '  function searchHandler(req: any, res: any) {',
      '    const term = req.query.q;',
      "    const statement = db.prepare('SELECT * FROM products WHERE name = ' + term);",
      '    const rows = statement.all();',
      '    res.json(rows);',
      '  }',
      '  const app = express();',
      "  app.get('/search', searchHandler);",
      '  return app;',
      '}',
      '',
    ].join('\n');
  
    it('ensures analysis outputs remain strictly non-authoritative and do not expose VERIFIED state or capabilities', async () => {
      const snapshot = await captureSnapshot(
        {
          fixtureId,
          repositoryId: repoId,
          organizationId: org,
          files: [{ path: 'src/app.ts', content: appContent }],
        },
        org,
      );
  
      const expressIngestion = await ingestExpress(snapshot, org);
      const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
  
      expect(analysis.status).toBe('DETECTED');
      expect((analysis as any).status).not.toBe('VERIFIED');
      expect((analysis as any).verificationState).toBeUndefined();
      expect((analysis as any).capability).toBeUndefined();
      expect((analysis as any).action).toBeUndefined();
      expect((analysis as any).actionAuthority).toBeUndefined();
      expect((analysis as any).verified).toBeUndefined();
      expect((analysis as any).remediation).toBeUndefined();
  
      expect(analysis.findings.length).toBeGreaterThan(0);
      for (const finding of analysis.findings) {
        expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
        expect((finding as any).verificationState).toBeUndefined();
        expect((finding as any).verified).toBeUndefined();
        expect((finding as any).capability).toBeUndefined();
        expect((finding as any).action).toBeUndefined();
        expect((finding as any).executionAuthority).toBeUndefined();
      }
  
      const validatedAnalysis = await validateSqlAnalysis(analysis, snapshot, expressIngestion, org);
      expect(validatedAnalysis.status).toBe('DETECTED');
      expect((validatedAnalysis as any).verificationState).toBeUndefined();
      expect((validatedAnalysis as any).capability).toBeUndefined();
    });
  
    it('ensures candidate hypotheses preserve CANDIDATE verificationState and cannot mint action authority', async () => {
      const snapshot = await captureSnapshot(
        {
          fixtureId,
          repositoryId: repoId,
          organizationId: org,
          files: [{ path: 'src/app.ts', content: appContent }],
        },
        org,
      );
  
      const expressIngestion = await ingestExpress(snapshot, org);
      const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
  
      const bridge = createSqlCandidateBridge(async (snap) => {
        expect(snap.snapshotId).toBe(snapshot.snapshotId);
        return commitSha;
      });
  
      const hypotheses = await bridge(analysis, snapshot, expressIngestion, org);
      expect(hypotheses.length).toBe(analysis.findings.length);
      expect(hypotheses.length).toBeGreaterThan(0);
  
      for (const hypothesis of hypotheses) {
        expect(hypothesis.candidate.verificationState).toBe('CANDIDATE');
        expect((hypothesis.candidate as any).verificationState).not.toBe('VERIFIED');
        expect(hypothesis.candidate.reachabilityState).toBe('REACHABLE');
  
        expect((hypothesis.candidate as any).capability).toBeUndefined();
        expect((hypothesis.candidate as any).action).toBeUndefined();
        expect((hypothesis.candidate as any).actionAuthority).toBeUndefined();
        expect((hypothesis.candidate as any).remediationAuthority).toBeUndefined();
        expect((hypothesis.candidate as any).dispatchAction).toBeUndefined();
      }
    });
  
    it('verifies structural repository ingestion does not mint runtime capability or transfer authority to analysis', async () => {
      const snapshot = await captureSnapshot(
        {
          fixtureId,
          repositoryId: repoId,
          organizationId: org,
          files: [{ path: 'src/app.ts', content: appContent }],
        },
        org,
      );
  
      const expressIngestion = await ingestExpress(snapshot, org);
      const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
  
      const repoBody = {
        version: 'velnar-repository-ingestion-v1' as const,
        organizationId: org,
        repositoryId: repoId,
        commitSha,
        snapshot,
      };
      const ingestionIdentity = await hash('velnar-repository-ingestion-v1', repoBody);
      const structural = await validateRepositoryIngestion(
        { ...repoBody, ingestionIdentity },
        org,
      );
  
      expect((structural as any).capability).toBeUndefined();
      expect(isTrustedCommitCapability((structural as any).capability, structural)).toBe(false);
      expect(isTrustedCommitCapability({}, structural)).toBe(false);
      expect(isTrustedCommitCapability(analysis, structural)).toBe(false);
  
      expect(() => assertTrustedCommitCapability((structural as any).capability, structural)).toThrow(
        'unauthorized commit capability',
      );
      expect(() => assertTrustedCommitCapability(analysis, structural)).toThrow(
        'unauthorized commit capability',
      );
  
      const bridge = createSqlCandidateBridge(async () => commitSha);
      const hypotheses = await bridge(analysis, snapshot, expressIngestion, org);
      expect(isTrustedCommitCapability(hypotheses[0].candidate, structural)).toBe(false);
      expect(() => assertTrustedCommitCapability(hypotheses[0].candidate, structural)).toThrow(
        'unauthorized commit capability',
      );
    });
  });
}
{
  // Historical contract source: 20260919-030653-chat4-V1_CHAT4_C8H_060_NONAUTHOR_TY_SURFACE
  describe('Velnar Trust Boundary Non-Authority Surface Integration', () => {
    it('bounds provenance to trusted ingestion while analysis output remains strictly non-authoritative', async () => {
      const org = 'org_boundary';
      const repoId = 'repo-boundary';
      const commitSha = '1234567890abcdef1234567890abcdef12345678';
  
      const sourceContent = [
        "import express from 'express';",
        '',
        'export function createApp(db: any) {',
        '  const app = express();',
        '  function handler(req: any, res: any) {',
        '    const q = req.query.id;',
        "    const stmt = db.prepare('SELECT * FROM users WHERE id = ' + q);",
        '    const rows = stmt.all();',
        '    return res.json(rows);',
        '  }',
        "  app.get('/users', handler);",
        '  return app;',
        '}',
        '',
      ].join('\n');
  
      const snapshot = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: repoId,
          organizationId: org,
          files: [
            {
              path: 'src/index.ts',
              content: sourceContent,
            },
          ],
        },
        org,
      );
  
      expect(snapshot.snapshotId).toBeDefined();
      expect(snapshot.files).toHaveLength(1);
  
      const fakeIngestion = {
        version: 'velnar-repository-ingestion-v1' as const,
        organizationId: org,
        repositoryId: repoId,
        commitSha,
        snapshot,
      };
      const ingestionIdentity = await hash('velnar-repository-ingestion-v1', fakeIngestion);
      const validatedIngestion = await validateRepositoryIngestion(
        {
          ...fakeIngestion,
          ingestionIdentity,
        },
        org,
      );
  
      expect(validatedIngestion.ingestionIdentity).toBe(ingestionIdentity);
      expect((validatedIngestion as any).capability).toBeUndefined();
      expect((validatedIngestion as any).action).toBeUndefined();
      expect((validatedIngestion as any).authority).toBeUndefined();
      expect(isTrustedCommitCapability((validatedIngestion as any).capability, validatedIngestion)).toBe(false);
      expect(() => assertTrustedCommitCapability((validatedIngestion as any).capability, validatedIngestion)).toThrow();
  
      const expressIngestion = await ingestExpress(snapshot, org);
      const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
  
      expect(analysis.status).toBe('DETECTED');
      expect((analysis as any).status).not.toBe('VERIFIED');
      expect((analysis as any).capability).toBeUndefined();
      expect((analysis as any).action).toBeUndefined();
      expect((analysis as any).authority).toBeUndefined();
      expect((analysis as any).verified).toBeUndefined();
      expect((analysis as any).isVerified).toBeUndefined();
      expect(analysis.findings.length).toBeGreaterThan(0);
  
      const finding = analysis.findings[0];
      expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
      expect((finding as any).verificationState).toBeUndefined();
      expect((finding as any).verified).toBeUndefined();
      expect((finding as any).authority).toBeUndefined();
      expect((finding as any).capability).toBeUndefined();
      expect((finding as any).action).toBeUndefined();
  
      const bridge = createSqlCandidateBridge(async () => commitSha);
      const candidateList = await bridge(analysis, snapshot, expressIngestion, org);
  
      expect(candidateList.length).toBeGreaterThan(0);
      for (const item of candidateList) {
        expect(item.candidate.verificationState).toBe('CANDIDATE');
        expect((item.candidate as any).verificationState).not.toBe('VERIFIED');
        expect((item.candidate as any).authority).toBeUndefined();
        expect((item.candidate as any).capability).toBeUndefined();
        expect((item.candidate as any).action).toBeUndefined();
        expect((item.candidate as any).actionAuthority).toBeUndefined();
        expect(item.candidate.sensorEvidence[0].summary).toContain('hypothesis');
        expect(typeof item.candidateBinding).toBe('string');
      }
    });
  });
}
{
  // Historical contract source: 20260919-035427-chat4-V1_CHAT4_C8H_085_NONAUTHOR_TY_SURFACE
  describe('Velnar Trust Boundary Non-Authority Surface', () => {
    it('ensures detection candidate output remains an unverified hypothesis without action authority', async () => {
      const org = 'org_non_authority';
      const sourceCode = `import express from 'express';
  
  export function createApp(db: any) {
    const app = express();
  
    function routeHandler(req: any, res: any) {
      const queryParam = req.query.input;
      const stmt = db.prepare('SELECT ' + queryParam);
      return stmt.all();
    }
  
    app.get('/query', routeHandler);
    return app;
  }
  `;
  
      const snapshot = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: 'repo-non-auth',
          organizationId: org,
          files: [{ path: 'src/app.ts', content: sourceCode }],
        },
        org,
      );
  
      const expressIngestion = await ingestExpress(snapshot, org);
      const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
  
      expect(analysis.status).toBe('DETECTED');
      expect((analysis as any).verificationState).toBeUndefined();
      expect((analysis as any).authority).toBeUndefined();
      expect((analysis as any).action).toBeUndefined();
      expect((analysis as any).actionAuthority).toBeUndefined();
  
      const checkedCommitSha = '1'.repeat(40);
      const bridge = createSqlCandidateBridge(async () => checkedCommitSha);
      const candidateHypotheses = await bridge(analysis, snapshot, expressIngestion, org);
  
      expect(candidateHypotheses.length).toBe(1);
      const { candidate } = candidateHypotheses[0];
  
      // Verification state must strictly remain CANDIDATE, never VERIFIED
      expect(candidate.verificationState).toBe('CANDIDATE');
      expect(candidate.verificationState).not.toBe('VERIFIED');
  
      // Summary must assert hypothesis within the closed registered-route subset
      expect(candidate.sensorEvidence[0].summary).toContain('hypothesis');
      expect(candidate.sensorEvidence[0].summary).not.toContain('VERIFIED');
  
      // Candidate must not contain action, remediation, or execution authority
      expect((candidate as any).actionAuthority).toBeUndefined();
      expect((candidate as any).action).toBeUndefined();
      expect((candidate as any).actions).toBeUndefined();
      expect((candidate as any).remediation).toBeUndefined();
      expect((candidate as any).executionAuthority).toBeUndefined();
      expect((candidate as any).capability).toBeUndefined();
    });
  
    it('confirms structural repository ingestion does not expose capability or action authority', async () => {
      const org = 'org_non_authority';
      const commitSha = '2'.repeat(40);
      const snapshot = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: 'repo-structural',
          organizationId: org,
          files: [{ path: 'src/index.ts', content: 'export const active = true;\n' }],
        },
        org,
      );
  
      const body = {
        version: 'velnar-repository-ingestion-v1' as const,
        organizationId: org,
        repositoryId: 'repo-structural',
        commitSha,
        snapshot,
      };
      const ingestionIdentity = await hash('velnar-repository-ingestion-v1', body);
      const validRecord = { ...body, ingestionIdentity };
  
      const validated = await validateRepositoryIngestion(validRecord, org);
  
      // Ingestion record must contain data provenance only; no authority capability
      expect((validated as any).capability).toBeUndefined();
      expect((validated as any).authority).toBeUndefined();
      expect((validated as any).actionAuthority).toBeUndefined();
      expect((validated as any).actions).toBeUndefined();
      expect(validated.commitSha).toBe(commitSha);
      expect(validated.organizationId).toBe(org);
    });
  
    it('confirms integration adapters remain fail-safe and do not expose action authority', async () => {
      expect(fulgorRayAdapter.isEnabled).toBe(false);
      expect(fulgorRayAdapter.status).toBe('DISABLED');
      expect((fulgorRayAdapter as any).actionAuthority).toBeUndefined();
      expect((fulgorRayAdapter as any).executeRemediation).toBeUndefined();
  
      const report = await fulgorRayAdapter.checkAnomalies('biz_apex_beauty');
      expect(report.anomalyDetected).toBe(false);
      expect(report.confidenceScore).toBe(0);
      expect(report.category).toBe('none');
      expect((report as any).actionAuthority).toBeUndefined();
      expect((report as any).verificationState).toBeUndefined();
  
      const telemetryResult = await fulgorRayAdapter.emitTelemetry({
        organizationId: 'org_non_authority',
        businessId: 'biz_apex_beauty',
        eventType: 'lead.decay',
        timestamp: new Date().toISOString(),
        metrics: { latency: 100 },
      });
      expect(telemetryResult.delivered).toBe(false);
      expect((telemetryResult as any).actionAuthority).toBeUndefined();
    });
  });
}
{
  // Historical contract source: 20260919-053859-chat4-V1_CHAT4_C8H_123_NONAUTHOR_TY_SURFACE
  describe('Velnar Non-Authority Surface Regressions', () => {
    const org = 'org_non_authority_test';
  
    async function buildCanonicalAnalysisContext() {
      const appSource = [
        "import express from 'express';",
        '',
        'export function createApp(db: any) {',
        '  const app = express();',
        '  function handleUsers(req: any, res: any) {',
        '    const q = req.query.id;',
        '    const sql = "SELECT * FROM users WHERE id = " + q;',
        '    const stmt = db.prepare(sql);',
        '    const rows = stmt.all();',
        '    res.json(rows);',
        '  }',
        "  app.get('/users', handleUsers);",
        '  return app;',
        '}',
        '',
      ].join('\n');
  
      const snapshot = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: 'repo-non-authority',
          organizationId: org,
          files: [{ path: 'src/app.ts', content: appSource }],
        },
        org,
      );
  
      const expressIngestion = await ingestExpress(snapshot, org);
      const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
      return { snapshot, expressIngestion, analysis };
    }
  
    it('ensures source analysis outputs remain strictly non-authoritative findings without action or verified capability', async () => {
      const { snapshot, expressIngestion, analysis } = await buildCanonicalAnalysisContext();
  
      expect(snapshot.snapshotId).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(expressIngestion.routes).toHaveLength(1);
      expect(analysis.status).toBe('DETECTED');
      expect(analysis.findings.length).toBeGreaterThan(0);
  
      expect((analysis as any).capability).toBeUndefined();
      expect((analysis as any).actionAuthority).toBeUndefined();
      expect((analysis as any).isVerified).toBeUndefined();
      expect((analysis as any).verificationState).toBeUndefined();
      expect('capability' in analysis).toBe(false);
      expect('actionAuthority' in analysis).toBe(false);
      expect('isVerified' in analysis).toBe(false);
      expect('verificationState' in analysis).toBe(false);
  
      for (const finding of analysis.findings) {
        expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
        expect((finding as any).capability).toBeUndefined();
        expect((finding as any).actionAuthority).toBeUndefined();
        expect((finding as any).verificationState).toBeUndefined();
        expect('capability' in finding).toBe(false);
        expect('actionAuthority' in finding).toBe(false);
        expect('verificationState' in finding).toBe(false);
      }
    });
  
    it('verifies candidate hypothesis bridge explicitly emits CANDIDATE state and refuses action capability', async () => {
      const { snapshot, expressIngestion, analysis } = await buildCanonicalAnalysisContext();
      const verifiedCommitSha = 'a'.repeat(40);
  
      const bridge = createSqlCandidateBridge(async () => verifiedCommitSha);
      const hypotheses = await bridge(analysis, snapshot, expressIngestion, org);
  
      expect(hypotheses).toHaveLength(1);
      const hypothesis = hypotheses[0];
  
      expect(hypothesis.candidate.verificationState).toBe('CANDIDATE');
      expect(hypothesis.candidate.verificationState).not.toBe('VERIFIED');
      expect(hypothesis.candidate.reachabilityState).toBe('REACHABLE');
  
      expect((hypothesis as any).capability).toBeUndefined();
      expect((hypothesis.candidate as any).capability).toBeUndefined();
      expect((hypothesis.candidate as any).actionAuthority).toBeUndefined();
      expect('capability' in hypothesis).toBe(false);
      expect('capability' in hypothesis.candidate).toBe(false);
      expect('actionAuthority' in hypothesis.candidate).toBe(false);
  
      const recordBody = {
        version: 'velnar-repository-ingestion-v1' as const,
        organizationId: org,
        repositoryId: 'repo-non-authority',
        commitSha: verifiedCommitSha,
        snapshot,
      };
      const ingestionIdentity = await hash('velnar-repository-ingestion-v1', recordBody);
      const validated = await validateRepositoryIngestion(
        {
          ...recordBody,
          ingestionIdentity,
        },
        org,
      );
  
      expect(isTrustedCommitCapability(hypothesis, validated)).toBe(false);
      expect(isTrustedCommitCapability(hypothesis.candidate, validated)).toBe(false);
      expect(() => assertTrustedCommitCapability((hypothesis as any).capability, validated)).toThrow(
        'unauthorized commit capability',
      );
    });
  
    it('confirms structural repository validation does not mint runtime commit authority', async () => {
      const { snapshot } = await buildCanonicalAnalysisContext();
      const commitSha = 'b'.repeat(40);
  
      const recordBody = {
        version: 'velnar-repository-ingestion-v1' as const,
        organizationId: org,
        repositoryId: 'repo-non-authority',
        commitSha,
        snapshot,
      };
  
      const ingestionIdentity = await hash('velnar-repository-ingestion-v1', recordBody);
      const rawRecord = {
        ...recordBody,
        ingestionIdentity,
      };
  
      const validated = await validateRepositoryIngestion(rawRecord, org);
      expect(validated.commitSha).toBe(commitSha);
      expect(validated.ingestionIdentity).toBe(ingestionIdentity);
  
      expect((validated as any).capability).toBeUndefined();
      expect('capability' in validated).toBe(false);
  
      expect(isTrustedCommitCapability((validated as any).capability, validated)).toBe(false);
      expect(() => assertTrustedCommitCapability((validated as any).capability, validated)).toThrow(
        'unauthorized commit capability',
      );
    });
  
    it('confirms integration adapters fail safe and do not expose active anomaly or telemetry authority', async () => {
      expect(fulgorRayAdapter.isEnabled).toBe(false);
      expect(fulgorRayAdapter.status).toBe('DISABLED');
  
      const telemetryResult = await fulgorRayAdapter.emitTelemetry({
        organizationId: org,
        businessId: 'biz_non_authority',
        eventType: 'lead.decay',
        timestamp: new Date().toISOString(),
        metrics: { latency: 100 },
      });
  
      expect(telemetryResult.delivered).toBe(false);
      expect(telemetryResult.reason).toContain('disabled');
  
      const anomalyReport = await fulgorRayAdapter.checkAnomalies('biz_non_authority');
      expect(anomalyReport.anomalyDetected).toBe(false);
      expect(anomalyReport.confidenceScore).toBe(0);
      expect(anomalyReport.category).toBe('none');
      expect((anomalyReport as any).actionAuthority).toBeUndefined();
      expect((anomalyReport as any).verified).toBeUndefined();
    });
  });
}
{
  // Historical contract source: 20260919-062324-chat4-V1_CHAT4_C8H_147_NONAUTHOR_TY_SURFACE
  describe('Velnar Trust Boundary: Non-Authority Surface Verification', () => {
    const org = 'org_nonauthority_boundary';
    const repoId = 'repo_nonauthority_boundary';
    const commitSha = '1234567890123456789012345678901234567890';
  
    const sampleSource = [
      "import express from 'express';",
      '',
      'export function createApp(db: any) {',
      '  const app = express();',
      '',
      '  function handler(req: any, res: any) {',
      '    const q = req.query.id;',
      "    const sql = 'SELECT * FROM users WHERE id = ' + q;",
      '    const stmt = db.prepare(sql);',
      '    const rows = stmt.all();',
      '    res.json(rows);',
      '  }',
      '',
      "  app.get('/users', handler);",
      '  return app;',
      '}',
      '',
    ].join('\n');
  
    async function createFixtureSnapshot(): Promise<SourceSnapshot> {
      return captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: repoId,
          organizationId: org,
          files: [{ path: 'src/app.ts', content: sampleSource }],
        },
        org,
      );
    }
  
    it('ensures static SQL analysis output does not claim or expose VERIFIED or action authority', async () => {
      const snapshot = await createFixtureSnapshot();
      const expressIngestion = await ingestExpress(snapshot, org);
      const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
  
      expect(analysis.status).toBe('DETECTED');
      expect((analysis as any).status).not.toBe('VERIFIED');
      expect((analysis as any).verificationState).toBeUndefined();
      expect((analysis as any).capability).toBeUndefined();
      expect((analysis as any).actionAuthority).toBeUndefined();
      expect((analysis as any).remediationAuthority).toBeUndefined();
      expect((analysis as any).executionAuthority).toBeUndefined();
  
      expect(analysis.findings.length).toBeGreaterThan(0);
      for (const finding of analysis.findings) {
        expect((finding as any).verificationState).toBeUndefined();
        expect((finding as any).actionAuthority).toBeUndefined();
        expect((finding as any).isVerified).toBeUndefined();
        expect((finding as any).capability).toBeUndefined();
      }
    });
  
    it('ensures candidate hypothesis bridge strictly yields CANDIDATE verificationState without execution capability', async () => {
      const snapshot = await createFixtureSnapshot();
      const expressIngestion = await ingestExpress(snapshot, org);
      const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
  
      const bridge = createSqlCandidateBridge(async () => commitSha);
      const candidates = await bridge(analysis, snapshot, expressIngestion, org);
  
      expect(candidates.length).toBeGreaterThan(0);
      for (const hypothesis of candidates) {
        expect(hypothesis.candidate.verificationState).toBe('CANDIDATE');
        expect((hypothesis.candidate.verificationState as string)).not.toBe('VERIFIED');
        expect((hypothesis.candidate as any).actionAuthority).toBeUndefined();
        expect((hypothesis.candidate as any).executionAuthority).toBeUndefined();
        expect((hypothesis.candidate as any).capability).toBeUndefined();
        expect((hypothesis as any).capability).toBeUndefined();
        expect(hypothesis.candidate.sensorEvidence.length).toBeGreaterThan(0);
        for (const sensor of hypothesis.candidate.sensorEvidence) {
          expect(sensor.summary).toContain('hypothesis');
          expect((sensor as any).verificationState).toBeUndefined();
          expect((sensor as any).authority).toBeUndefined();
        }
      }
    });
  
    it('ensures structural repository ingestion validation does not mint or leak commit capability', async () => {
      const snapshot = await createFixtureSnapshot();
      const body = {
        version: 'velnar-repository-ingestion-v1' as const,
        organizationId: org,
        repositoryId: repoId,
        commitSha,
        snapshot,
      };
      const ingestionIdentity = await hash('velnar-repository-ingestion-v1', body);
      const record: RepositoryIngestion = {
        ...body,
        ingestionIdentity,
      };
  
      const validated = await validateRepositoryIngestion(record, org);
      expect(validated.organizationId).toBe(org);
      expect(validated.repositoryId).toBe(repoId);
      expect(validated.commitSha).toBe(commitSha);
      expect((validated as any).capability).toBeUndefined();
      expect(isTrustedCommitCapability((validated as any).capability, validated)).toBe(false);
      expect(() => assertTrustedCommitCapability((validated as any).capability, validated)).toThrow();
    });
  
    it('ensures external integration adapter remains disabled and exposes no active runtime authority', async () => {
      expect(fulgorRayAdapter.isEnabled).toBe(false);
      expect(fulgorRayAdapter.status).toBe('DISABLED');
      expect((fulgorRayAdapter as any).actionAuthority).toBeUndefined();
      expect((fulgorRayAdapter as any).executionAuthority).toBeUndefined();
  
      const res = await fulgorRayAdapter.emitTelemetry({
        organizationId: org,
        businessId: 'biz_test_boundary',
        eventType: 'lead.decay',
        timestamp: new Date().toISOString(),
        metrics: { latency: 120 },
      });
  
      expect(res.delivered).toBe(false);
      expect(res.reason).toContain('disabled');
  
      const report = await fulgorRayAdapter.checkAnomalies('biz_test_boundary');
      expect(report.anomalyDetected).toBe(false);
      expect(report.confidenceScore).toBe(0);
      expect(report.category).toBe('none');
    });
  });
}
{
  // Historical contract source: 20260919-133405-chat4-V1_CHAT4_E1_C8H_100151_NONAUTHORITY_SURFACE
  const org = 'org_velnar_test';
  
  const repoId = 'repo-nonauthority-check';
  
  
  const appCode = [
    "import express from 'express';",
    '',
    'export function createApp(db: any) {',
    '  const app = express();',
    '  function queryHandler(req: any, res: any) {',
    '    const q = req.query.id;',
    "    const stmt = db.prepare('SELECT * FROM users WHERE id = ' + q);",
    '    return res.json(stmt.all());',
    '  }',
    "  app.get('/users', queryHandler);",
    '  return app;',
    '}',
    '',
  ].join('\n');
  
  
  async function createDetectedAnalysisFixture() {
    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: repoId,
        organizationId: org,
        files: [{ path: 'src/app.ts', content: appCode }],
      },
      org,
    );
    const expressIngestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
    return { snapshot, expressIngestion, analysis };
  }
  
  
  describe('V1 Platform Integration Non-Authority Surface Assertions', () => {
    describe('Candidate findings remain non-authoritative hypotheses (verificationState !== VERIFIED)', () => {
      it('produces CANDIDATE findings without VERIFIED or action authority', async () => {
        const { snapshot, expressIngestion, analysis } = await createDetectedAnalysisFixture();
        expect(analysis.status).toBe('DETECTED');
        expect(analysis.findings.length).toBeGreaterThan(0);
  
        const validSha = 'a'.repeat(40);
        const bridge = createSqlCandidateBridge(async (snap) => {
          expect(snap.snapshotId).toBe(snapshot.snapshotId);
          return validSha;
        });
  
        const hypotheses = await bridge(analysis, snapshot, expressIngestion, org);
        expect(hypotheses.length).toBe(1);
  
        const { candidate, candidateBinding } = hypotheses[0];
        expect(candidate.verificationState).toBe('CANDIDATE');
        expect((candidate as any).verificationState).not.toBe('VERIFIED');
        expect((candidate as any).capability).toBeUndefined();
        expect((candidate as any).action).toBeUndefined();
        expect((candidate as any).authority).toBeUndefined();
        expect(candidate.sensorEvidence).toHaveLength(1);
        expect(candidate.sensorEvidence[0].sensorType).toBe('VELNAR_STRUCTURAL');
        expect(candidate.sensorEvidence[0].summary).toContain('hypothesis');
        expect(typeof candidateBinding).toBe('string');
        expect(candidateBinding.length).toBeGreaterThan(0);
      });
  
      it('fails closed when commit provenance verification fails or returns an invalid SHA', async () => {
        const { snapshot, expressIngestion, analysis } = await createDetectedAnalysisFixture();
  
        const zeroShaBridge = createSqlCandidateBridge(async () => '0'.repeat(40));
        await expect(
          zeroShaBridge(analysis, snapshot, expressIngestion, org),
        ).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
  
        const invalidShaBridge = createSqlCandidateBridge(async () => 'not-a-valid-sha');
        await expect(
          invalidShaBridge(analysis, snapshot, expressIngestion, org),
        ).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
      });
  
      it('rejects tampered analysis results during candidate bridge validation', async () => {
        const { snapshot, expressIngestion, analysis } = await createDetectedAnalysisFixture();
        const bridge = createSqlCandidateBridge(async () => 'a'.repeat(40));
  
        const tamperedAnalysis = {
          ...analysis,
          resultFingerprint: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        };
  
        await expect(
          bridge(tamperedAnalysis, snapshot, expressIngestion, org),
        ).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
      });
    });
  
    describe('Repository ingestion structural validation yields no runtime capability or authority', () => {
      it('validates structural ingestion identity without minting runtime commit capability', async () => {
        const { snapshot } = await createDetectedAnalysisFixture();
        const body = {
          version: 'velnar-repository-ingestion-v1' as const,
          organizationId: org,
          repositoryId: repoId,
          commitSha: 'b'.repeat(40),
          snapshot,
        };
        const ingestionIdentity = await hash('velnar-repository-ingestion-v1', body);
        const record = { ...body, ingestionIdentity };
  
        const validated = await validateRepositoryIngestion(record, org);
        expect(validated.ingestionIdentity).toBe(ingestionIdentity);
        expect((validated as any).capability).toBeUndefined();
  
        const fabricatedCapability = Object.freeze({
          [Symbol.toStringTag]: 'TrustedCommitCapability' as const,
        });
  
        expect(isTrustedCommitCapability(fabricatedCapability, validated)).toBe(false);
        expect(isTrustedCommitCapability(null, validated)).toBe(false);
        expect(isTrustedCommitCapability({}, validated)).toBe(false);
  
        expect(() =>
          assertTrustedCommitCapability(fabricatedCapability, validated),
        ).toThrow('unauthorized commit capability');
      });
  
      it('rejects tampered tenant or invalid commit SHA during structural validation', async () => {
        const { snapshot } = await createDetectedAnalysisFixture();
        const body = {
          version: 'velnar-repository-ingestion-v1' as const,
          organizationId: org,
          repositoryId: repoId,
          commitSha: 'c'.repeat(40),
          snapshot,
        };
        const ingestionIdentity = await hash('velnar-repository-ingestion-v1', body);
        const record = { ...body, ingestionIdentity };
  
        await expect(
          validateRepositoryIngestion(record, 'foreign_tenant_org'),
        ).rejects.toThrow('tenant mismatch');
  
        const zeroCommitBody = { ...body, commitSha: '0'.repeat(40) };
        const zeroCommitIdentity = await hash('velnar-repository-ingestion-v1', zeroCommitBody);
        await expect(
          validateRepositoryIngestion({ ...zeroCommitBody, ingestionIdentity: zeroCommitIdentity }, org),
        ).rejects.toThrow('Git commit identity');
      });
    });
  
    describe('External Fulgor Ray anomaly detector has no telemetry or finding authority in release gate', () => {
      it('remains disabled and refuses telemetry emission in this release gate', async () => {
        expect(fulgorRayAdapter.isEnabled).toBe(false);
        expect(fulgorRayAdapter.status).toBe('DISABLED');
  
        const emission = await fulgorRayAdapter.emitTelemetry({
          organizationId: org,
          businessId: 'biz_integration_trust',
          eventType: 'lead.decay',
          timestamp: new Date().toISOString(),
          metrics: { latency: 250 },
        });
        expect(emission.delivered).toBe(false);
        expect(emission.reason).toContain('disabled');
      });
  
      it('returns non-authoritative zero reports in offline receiver mode', async () => {
        const report = await fulgorRayAdapter.checkAnomalies('biz_integration_trust');
        expect(report.anomalyDetected).toBe(false);
        expect(report.confidenceScore).toBe(0);
        expect(report.category).toBe('none');
      });
    });
  });
}
