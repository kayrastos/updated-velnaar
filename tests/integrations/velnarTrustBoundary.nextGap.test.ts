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
import { captureSnapshot } from "../../worker/intelligence/ingestion/snapshot";
import type { SourceSnapshot } from "../../worker/intelligence/ingestion/snapshot";
import { describe } from "vitest";
import { expect } from "vitest";
import { it } from "vitest";

{
  // Historical contract source: 20260919-014957-chat4-V1_CHAT4_C8H_021_NEXT__NTEGRAT_ON_GAP
  const org = 'org_velnar_gate';
  
  const repoId = 'repo-gate';
  
  
  const vulnerableSource = [
    "import express from 'express';",
    '',
    'export function createApp(db: any) {',
    '  const app = express();',
    '  function handleQuery(req: any, res: any) {',
    '    const userId = req.query.id;',
    "    const stmt = db.prepare('SELECT * FROM users WHERE id = ' + userId);",
    '    const rows = stmt.all();',
    '    res.json(rows);',
    '  }',
    "  app.get('/users', handleQuery);",
    '  return app;',
    '}',
    '',
  ].join('\n');
  
  
  const cleanSource = [
    "import express from 'express';",
    '',
    'export function createApp(db: any) {',
    '  const app = express();',
    '  function handleQuery(req: any, res: any) {',
    "    const stmt = db.prepare('SELECT * FROM users WHERE id = ?');",
    '    const rows = stmt.all(req.query.id);',
    '    res.json(rows);',
    '  }',
    "  app.get('/users', handleQuery);",
    '  return app;',
    '}',
    '',
  ].join('\n');
  
  
  describe('Velnar Platform Integration Trust Boundary & Candidate Bridge', () => {
    it('enforces end-to-end trust boundary: candidate hypotheses remain non-authoritative and bound to verified commit', async () => {
      const snapshot = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: repoId,
          organizationId: org,
          files: [{ path: 'src/app.ts', content: vulnerableSource }],
        },
        org,
      );
  
      const expressIngestion = await ingestExpress(snapshot, org);
      const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
  
      expect(analysis.status).toBe('DETECTED');
      expect(analysis.findings.length).toBe(1);
  
      const validCommitSha = 'a'.repeat(40);
      const bridge = createSqlCandidateBridge(async (snap) => {
        expect(snap.snapshotId).toBe(snapshot.snapshotId);
        return validCommitSha;
      });
  
      const hypotheses = await bridge(analysis, snapshot, expressIngestion, org);
  
      expect(hypotheses.length).toBe(1);
      const hypothesis = hypotheses[0];
  
      expect(hypothesis.candidate.verificationState).toBe('CANDIDATE');
      expect(hypothesis.candidate.reachabilityState).toBe('REACHABLE');
      expect(hypothesis.candidate.vulnerabilityClass).toBe('SQL_INJECTION');
      expect(hypothesis.candidate.snapshot.commitSha).toBe(validCommitSha);
      expect(hypothesis.candidate.organizationId).toBe(org);
      expect(hypothesis.candidate.sensorEvidence[0].sensorType).toBe('VELNAR_STRUCTURAL');
      expect(typeof hypothesis.candidateBinding).toBe('string');
      expect(hypothesis.candidateBinding.length).toBeGreaterThan(0);
    });
  
    it('fails closed when verifyCommittedCode returns invalid commit SHA or zero SHA', async () => {
      const snapshot = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: repoId,
          organizationId: org,
          files: [{ path: 'src/app.ts', content: vulnerableSource }],
        },
        org,
      );
  
      const expressIngestion = await ingestExpress(snapshot, org);
      const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
  
      const bridgeZero = createSqlCandidateBridge(async () => '0'.repeat(40));
      await expect(bridgeZero(analysis, snapshot, expressIngestion, org)).rejects.toThrow(
        'M3_CHECKED_COMMIT_REQUIRED',
      );
  
      const bridgeMalformed = createSqlCandidateBridge(async () => 'not-a-sha');
      await expect(bridgeMalformed(analysis, snapshot, expressIngestion, org)).rejects.toThrow(
        'M3_CHECKED_COMMIT_REQUIRED',
      );
    });
  
    it('rejects cross-tenant boundary crossings between snapshot and candidate bridge', async () => {
      const snapshot = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: repoId,
          organizationId: org,
          files: [{ path: 'src/app.ts', content: vulnerableSource }],
        },
        org,
      );
  
      const expressIngestion = await ingestExpress(snapshot, org);
      const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
      const bridge = createSqlCandidateBridge(async () => 'a'.repeat(40));
  
      await expect(bridge(analysis, snapshot, expressIngestion, 'foreign_org')).rejects.toThrow(
        'tenant mismatch',
      );
    });
  
    it('rejects tampered analysis result fingerprint or forged status before commit check', async () => {
      const snapshot = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: repoId,
          organizationId: org,
          files: [{ path: 'src/app.ts', content: vulnerableSource }],
        },
        org,
      );
  
      const expressIngestion = await ingestExpress(snapshot, org);
      const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
  
      const tamperedAnalysis = {
        ...analysis,
        status: 'NOT_DETECTED',
      };
  
      const bridge = createSqlCandidateBridge(async () => 'a'.repeat(40));
      await expect(bridge(tamperedAnalysis, snapshot, expressIngestion, org)).rejects.toThrow(
        'M3_ANALYSIS_INTEGRITY_MISMATCH',
      );
    });
  
    it('short-circuits commit verification on clean code without SQL injection', async () => {
      const snapshot = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: repoId,
          organizationId: org,
          files: [{ path: 'src/app.ts', content: cleanSource }],
        },
        org,
      );
  
      const expressIngestion = await ingestExpress(snapshot, org);
      const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
  
      expect(analysis.status).toBe('NOT_DETECTED');
      expect(analysis.findings).toHaveLength(0);
  
      let verifyCommittedCalls = 0;
      const bridge = createSqlCandidateBridge(async () => {
        verifyCommittedCalls++;
        return 'a'.repeat(40);
      });
  
      const hypotheses = await bridge(analysis, snapshot, expressIngestion, org);
      expect(hypotheses).toHaveLength(0);
      expect(verifyCommittedCalls).toBe(0);
    });
  
    it('rejects unauthenticated commit capabilities using WeakMap isolation', async () => {
      const snapshot = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: repoId,
          organizationId: org,
          files: [{ path: 'src/app.ts', content: cleanSource }],
        },
        org,
      );
  
      const fakeCapability = Object.freeze({
        [Symbol.toStringTag]: 'TrustedCommitCapability' as const,
      });
  
      const mockIngestion: any = {
        version: 'velnar-repository-ingestion-v1',
        organizationId: org,
        repositoryId: repoId,
        commitSha: 'a'.repeat(40),
        snapshot,
        ingestionIdentity: 'test-identity',
      };
  
      expect(isTrustedCommitCapability(fakeCapability, mockIngestion)).toBe(false);
      expect(() => assertTrustedCommitCapability(fakeCapability, mockIngestion)).toThrow(
        'unauthorized commit capability',
      );
    });
  
    it('verifies Fulgor Ray telemetry adapter fail-safe boundary remains disabled by default', async () => {
      expect(fulgorRayAdapter.isEnabled).toBe(false);
      expect(fulgorRayAdapter.status).toBe('DISABLED');
  
      const res = await fulgorRayAdapter.emitTelemetry({
        organizationId: org,
        businessId: 'biz_apex',
        eventType: 'lead.decay',
        timestamp: new Date().toISOString(),
        metrics: { latency: 120 },
      });
  
      expect(res.delivered).toBe(false);
      expect(res.reason).toContain('disabled');
  
      const report = await fulgorRayAdapter.checkAnomalies('biz_apex');
      expect(report.anomalyDetected).toBe(false);
      expect(report.confidenceScore).toBe(0);
      expect(report.category).toBe('none');
    });
  });
}
{
  // Historical contract source: 20260919-024116-chat4-V1_CHAT4_C8H_046_NEXT__NTEGRAT_ON_GAP
  const vulnerableSource = `import express from 'express';
  
  export function createApp(db: any) {
    const app = express();
  
    function handler(req: any, res: any) {
      const q = req.query.id;
      const query = "SELECT * FROM users WHERE id = '" + q + "'";
      const stmt = db.prepare(query);
      const rows = stmt.all();
      return res.json(rows);
    }
  
    app.get('/users', handler);
    return app;
  }
  `;
  
  
  const cleanSource = `import express from 'express';
  
  export function createApp(db: any) {
    const app = express();
  
    function safeHandler(req: any, res: any) {
      const stmt = db.prepare('SELECT * FROM users');
      const rows = stmt.all();
      return res.json(rows);
    }
  
    app.get('/users', safeHandler);
    return app;
  }
  `;
  
  
  describe('Velnar Platform Trust Boundary & Integration Regressions', () => {
    const org = 'org_v1';
    const repo = 'repo_v1';
    const commitSha = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
  
    async function buildVulnerablePipeline() {
      const snapshot = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: repo,
          organizationId: org,
          files: [{ path: 'src/app.ts', content: vulnerableSource }],
        },
        org,
      );
      const ingestion = await ingestExpress(snapshot, org);
      const analysis = await detectSqlInjection(snapshot, ingestion, org);
      return { snapshot, ingestion, analysis };
    }
  
    it('promotes detected SQLi to CandidateHypothesis while strictly preserving CANDIDATE non-authority', async () => {
      const { snapshot, ingestion, analysis } = await buildVulnerablePipeline();
      expect(analysis.status).toBe('DETECTED');
      expect(analysis.findings.length).toBe(1);
  
      let verifiedSnapshot: SourceSnapshot | null = null;
      const bridge = createSqlCandidateBridge(async (snap) => {
        verifiedSnapshot = snap;
        return commitSha;
      });
  
      const hypotheses = await bridge(analysis, snapshot, ingestion, org);
      expect(verifiedSnapshot).toBeDefined();
      expect(hypotheses).toHaveLength(1);
  
      const { candidate, candidateBinding } = hypotheses[0];
      expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
      expect(candidate.verificationState).toBe('CANDIDATE');
      expect(candidate.reachabilityState).toBe('REACHABLE');
      expect(candidate.snapshot.commitSha).toBe(commitSha);
      expect(candidate.snapshot.sourceProvider).toBe('LOCAL_FIXTURE');
      expect(candidate.organizationId).toBe(org);
      expect(typeof candidateBinding).toBe('string');
      expect(candidateBinding.length).toBeGreaterThan(0);
    });
  
    it('fails closed when commit verification returns invalid or all-zero commit SHA', async () => {
      const { snapshot, ingestion, analysis } = await buildVulnerablePipeline();
  
      const allZeroBridge = createSqlCandidateBridge(async () => '0'.repeat(40));
      await expect(allZeroBridge(analysis, snapshot, ingestion, org)).rejects.toThrow(
        'M3_CHECKED_COMMIT_REQUIRED',
      );
  
      const invalidShaBridge = createSqlCandidateBridge(async () => 'not-a-valid-sha');
      await expect(invalidShaBridge(analysis, snapshot, ingestion, org)).rejects.toThrow(
        'M3_CHECKED_COMMIT_REQUIRED',
      );
    });
  
    it('short-circuits and refuses commit verification on NOT_DETECTED analysis', async () => {
      const cleanSnapshot = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: repo,
          organizationId: org,
          files: [{ path: 'src/app.ts', content: cleanSource }],
        },
        org,
      );
      const cleanIngestion = await ingestExpress(cleanSnapshot, org);
      const cleanAnalysis = await detectSqlInjection(cleanSnapshot, cleanIngestion, org);
      expect(cleanAnalysis.status).toBe('NOT_DETECTED');
  
      let verifyCalled = false;
      const bridge = createSqlCandidateBridge(async () => {
        verifyCalled = true;
        return commitSha;
      });
  
      const hypotheses = await bridge(cleanAnalysis, cleanSnapshot, cleanIngestion, org);
      expect(hypotheses).toEqual([]);
      expect(verifyCalled).toBe(false);
    });
  
    it('enforces tenant isolation across the snapshot, ingestion, and candidate boundary', async () => {
      const { snapshot, ingestion, analysis } = await buildVulnerablePipeline();
      const bridge = createSqlCandidateBridge(async () => commitSha);
  
      await expect(bridge(analysis, snapshot, ingestion, 'foreign_org')).rejects.toThrow(
        'tenant mismatch',
      );
    });
  
    it('detects and rejects tampered analysis findings across the boundary', async () => {
      const { snapshot, ingestion, analysis } = await buildVulnerablePipeline();
      const bridge = createSqlCandidateBridge(async () => commitSha);
  
      const tamperedAnalysis = {
        ...analysis,
        status: 'NOT_DETECTED' as const,
      };
  
      await expect(bridge(tamperedAnalysis, snapshot, ingestion, org)).rejects.toThrow(
        'M3_ANALYSIS_INTEGRITY_MISMATCH',
      );
    });
  
    it('confirms TrustedCommitCapability cannot be claimed by candidate hypotheses', () => {
      expect(isTrustedCommitCapability(null, {} as any)).toBe(false);
      expect(isTrustedCommitCapability({}, {} as any)).toBe(false);
      expect(
        isTrustedCommitCapability(
          {
            contractVersion: 'velnar-finding-candidate-v1',
            organizationId: org,
          },
          {} as any,
        ),
      ).toBe(false);
    });
  
    it('verifies Fulgor Ray adapter remains disabled and fail-closed at the integration edge', async () => {
      expect(fulgorRayAdapter.isEnabled).toBe(false);
      expect(fulgorRayAdapter.status).toBe('DISABLED');
  
      const telemetry = await fulgorRayAdapter.emitTelemetry({
        organizationId: org,
        businessId: 'biz_v1',
        eventType: 'lead.decay',
        timestamp: new Date().toISOString(),
        metrics: { latency: 100 },
      });
      expect(telemetry.delivered).toBe(false);
      expect(telemetry.reason).toContain('disabled');
  
      const report = await fulgorRayAdapter.checkAnomalies('biz_v1');
      expect(report.anomalyDetected).toBe(false);
      expect(report.confidenceScore).toBe(0);
      expect(report.category).toBe('none');
    });
  });
}
{
  // Historical contract source: 20260919-033131-chat4-V1_CHAT4_C8H_072_NEXT__NTEGRAT_ON_GAP
  const org = 'org_platform_int';
  
  const repo = 'repo-trust-boundary';
  
  const genuineCommitSha = '1234567890abcdef1234567890abcdef12345678';
  
  
  const vulnerableSource = `import express from 'express';
  
  export function createApp(db: any) {
    const app = express();
  
    function handleQuery(req: any, res: any) {
      const id = req.query.id;
      const query = 'SELECT * FROM users WHERE id = ' + id;
      const stmt = db.prepare(query);
      const rows = stmt.all();
      return res.json(rows);
    }
  
    app.get('/search', handleQuery);
    return app;
  }
  `;
  
  
  const cleanSource = `import express from 'express';
  
  export function createApp(db: any) {
    const app = express();
  
    function handleSafe(req: any, res: any) {
      const id = req.query.id;
      const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
      const rows = stmt.all(id);
      return res.json(rows);
    }
  
    app.get('/safe', handleSafe);
    return app;
  }
  `;
  
  
  describe('V1 Platform Integration Trust Boundary: Candidate Bridge and Provenance', () => {
    it('composes snapshot, express ingestion, SQLi detection, and candidate bridge to yield CANDIDATE non-authoritative findings', async () => {
      const snapshot = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: repo,
          organizationId: org,
          files: [{ path: 'src/app.ts', content: vulnerableSource }],
        },
        org,
      );
  
      const expressIngestion = await ingestExpress(snapshot, org);
      const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
      expect(analysis.status).toBe('DETECTED');
      expect(analysis.findings.length).toBeGreaterThan(0);
  
      let verifyCalled = 0;
      const bridge = createSqlCandidateBridge(async (sn) => {
        verifyCalled++;
        expect(sn.snapshotId).toBe(snapshot.snapshotId);
        return genuineCommitSha;
      });
  
      const candidates = await bridge(analysis, snapshot, expressIngestion, org);
      expect(verifyCalled).toBe(1);
      expect(candidates.length).toBe(1);
  
      const { candidate, candidateBinding } = candidates[0];
      expect(candidate.verificationState).toBe('CANDIDATE');
      expect((candidate as any).verificationState).not.toBe('VERIFIED');
      expect(candidate.reachabilityState).toBe('REACHABLE');
      expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
      expect(candidate.snapshot.commitSha).toBe(genuineCommitSha);
      expect(candidate.organizationId).toBe(org);
      expect(typeof candidateBinding).toBe('string');
      expect(candidateBinding.length).toBeGreaterThan(0);
  
      expect((candidate as any).capability).toBeUndefined();
      expect(isTrustedCommitCapability(candidate, null as any)).toBe(false);
    });
  
    it('enforces verified commit requirement and rejects malformed or zero commit SHAs', async () => {
      const snapshot = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: repo,
          organizationId: org,
          files: [{ path: 'src/app.ts', content: vulnerableSource }],
        },
        org,
      );
  
      const expressIngestion = await ingestExpress(snapshot, org);
      const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
  
      const zeroBridge = createSqlCandidateBridge(async () => '0'.repeat(40));
      await expect(zeroBridge(analysis, snapshot, expressIngestion, org)).rejects.toThrow(
        'M3_CHECKED_COMMIT_REQUIRED',
      );
  
      const nonHexBridge = createSqlCandidateBridge(async () => 'invalid-commit-sha-hex-value');
      await expect(nonHexBridge(analysis, snapshot, expressIngestion, org)).rejects.toThrow(
        'M3_CHECKED_COMMIT_REQUIRED',
      );
  
      const failingBridge = createSqlCandidateBridge(async () => {
        throw new Error('COMMIT_NOT_FOUND');
      });
      await expect(failingBridge(analysis, snapshot, expressIngestion, org)).rejects.toThrow(
        'COMMIT_NOT_FOUND',
      );
    });
  
    it('short-circuits and refuses candidate generation on clean code without invoking commit verification', async () => {
      const cleanSnapshot = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: repo,
          organizationId: org,
          files: [{ path: 'src/app.ts', content: cleanSource }],
        },
        org,
      );
  
      const cleanExpress = await ingestExpress(cleanSnapshot, org);
      const cleanAnalysis = await detectSqlInjection(cleanSnapshot, cleanExpress, org);
      expect(cleanAnalysis.status).toBe('NOT_DETECTED');
  
      let cleanVerifyCalled = 0;
      const cleanBridge = createSqlCandidateBridge(async () => {
        cleanVerifyCalled++;
        return genuineCommitSha;
      });
  
      const cleanCandidates = await cleanBridge(cleanAnalysis, cleanSnapshot, cleanExpress, org);
      expect(cleanCandidates).toEqual([]);
      expect(Object.isFrozen(cleanCandidates)).toBe(true);
      expect(cleanVerifyCalled).toBe(0);
    });
  
    it('fails closed on cross-tenant and mismatched snapshot inputs across trust boundary', async () => {
      const snapshot = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: repo,
          organizationId: org,
          files: [{ path: 'src/app.ts', content: vulnerableSource }],
        },
        org,
      );
  
      const cleanSnapshot = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: repo,
          organizationId: org,
          files: [{ path: 'src/app.ts', content: cleanSource }],
        },
        org,
      );
  
      const expressIngestion = await ingestExpress(snapshot, org);
      const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
  
      const bridge = createSqlCandidateBridge(async () => genuineCommitSha);
  
      await expect(bridge(analysis, snapshot, expressIngestion, 'foreign_org')).rejects.toThrow();
      await expect(bridge(analysis, cleanSnapshot, expressIngestion, org)).rejects.toThrow();
    });
  
    it('confirms candidate hypotheses never satisfy runtime commit capability assertions', () => {
      expect(isTrustedCommitCapability({}, null as any)).toBe(false);
      expect(() => assertTrustedCommitCapability({}, null as any)).toThrow(
        'unauthorized commit capability',
      );
      expect(() =>
        assertTrustedCommitCapability({ verificationState: 'CANDIDATE' }, null as any),
      ).toThrow('unauthorized commit capability');
    });
  
    it('verifies Fulgor Ray anomaly detector remains disabled and fail-safe at the integration edge', async () => {
      expect(fulgorRayAdapter.isEnabled).toBe(false);
      expect(fulgorRayAdapter.status).toBe('DISABLED');
  
      const telemetryRes = await fulgorRayAdapter.emitTelemetry({
        organizationId: org,
        businessId: 'biz_apex_beauty',
        eventType: 'candidate.hypothesis',
        timestamp: new Date().toISOString(),
        metrics: { latency: 120 },
      });
      expect(telemetryRes.delivered).toBe(false);
      expect(telemetryRes.reason).toContain('disabled');
  
      const report = await fulgorRayAdapter.checkAnomalies('biz_apex_beauty');
      expect(report.anomalyDetected).toBe(false);
      expect(report.confidenceScore).toBe(0);
      expect(report.category).toBe('none');
    });
  });
}
{
  // Historical contract source: 20260919-060037-chat4-V1_CHAT4_C8H_134_NEXT__NTEGRAT_ON_GAP
  const org = 'org_platform';
  
  
  const vulnerableContent = `import express from 'express';
  
  export function createApp(db: any) {
    const app = express();
  
    function handler(req: any, res: any) {
      const query = req.query.id;
      const sql = 'SELECT * FROM users WHERE id = ' + query;
      const stmt = db.prepare(sql);
      const rows = stmt.all();
      return res.json(rows);
    }
  
    app.get('/users', handler);
    return app;
  }
  `;
  
  
  const safeContent = `import express from 'express';
  
  export function createApp(db: any) {
    const app = express();
  
    function handler(req: any, res: any) {
      const query = req.query.id;
      const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
      const rows = stmt.all(query);
      return res.json(rows);
    }
  
    app.get('/users', handler);
    return app;
  }
  `;
  
  
  describe('Velnar Trust Boundary - Next Integration Gap', () => {
    it('bridges verified committed snapshot to candidate hypothesis without granting verified authority', async () => {
      const snapshot = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: 'repo-next-gap',
          organizationId: org,
          files: [{ path: 'src/app.ts', content: vulnerableContent }],
        },
        org,
      );
  
      const ingestion = await ingestExpress(snapshot, org);
      const analysis = await detectSqlInjection(snapshot, ingestion, org);
      expect(analysis.status).toBe('DETECTED');
      expect(analysis.findings.length).toBeGreaterThan(0);
  
      const validCommitSha = 'a'.repeat(40);
      let verifyCalled = false;
      const bridge = createSqlCandidateBridge(async (snap) => {
        verifyCalled = true;
        expect(snap.snapshotId).toBe(snapshot.snapshotId);
        return validCommitSha;
      });
  
      const candidates = await bridge(analysis, snapshot, ingestion, org);
      expect(verifyCalled).toBe(true);
      expect(candidates.length).toBe(1);
  
      const hypothesis = candidates[0];
      expect(hypothesis.candidate.verificationState).toBe('CANDIDATE');
      expect(hypothesis.candidate.verificationState).not.toBe('VERIFIED');
      expect(hypothesis.candidate.reachabilityState).toBe('REACHABLE');
      expect(hypothesis.candidate.vulnerabilityClass).toBe('SQL_INJECTION');
      expect(hypothesis.candidate.snapshot.commitSha).toBe(validCommitSha);
      expect(hypothesis.candidate.snapshot.snapshotId).toBe(snapshot.snapshotId);
      expect(hypothesis.candidate.sensorEvidence[0].sensorType).toBe('VELNAR_STRUCTURAL');
      expect(typeof hypothesis.candidateBinding).toBe('string');
      expect(hypothesis.candidateBinding.length).toBeGreaterThan(0);
      expect(Object.isFrozen(candidates)).toBe(true);
    });
  
    it('proves candidate hypotheses do not carry trusted commit capability authority', async () => {
      const snapshot = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: 'repo-next-gap',
          organizationId: org,
          files: [{ path: 'src/app.ts', content: vulnerableContent }],
        },
        org,
      );
  
      const ingestion = await ingestExpress(snapshot, org);
      const analysis = await detectSqlInjection(snapshot, ingestion, org);
  
      const validCommitSha = 'b'.repeat(40);
      const bridge = createSqlCandidateBridge(async () => validCommitSha);
      const candidates = await bridge(analysis, snapshot, ingestion, org);
      const candidate = candidates[0].candidate;
  
      expect(isTrustedCommitCapability(candidate, {} as any)).toBe(false);
      expect(() => assertTrustedCommitCapability(candidate, {} as any)).toThrow(
        'unauthorized commit capability',
      );
    });
  
    it('proves external anomaly telemetry adapter refuses candidate emission in disabled gate', async () => {
      expect(fulgorRayAdapter.isEnabled).toBe(false);
      expect(fulgorRayAdapter.status).toBe('DISABLED');
  
      const telemetryResult = await fulgorRayAdapter.emitTelemetry({
        organizationId: org,
        businessId: 'biz_platform',
        eventType: 'candidate.hypothesis.emission',
        timestamp: new Date().toISOString(),
        metrics: { candidateCount: 1 },
      });
  
      expect(telemetryResult.delivered).toBe(false);
      expect(telemetryResult.reason).toContain('disabled');
    });
  
    it('fails closed when commit verification returns invalid or all-zero commit SHA', async () => {
      const snapshot = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: 'repo-next-gap',
          organizationId: org,
          files: [{ path: 'src/app.ts', content: vulnerableContent }],
        },
        org,
      );
  
      const ingestion = await ingestExpress(snapshot, org);
      const analysis = await detectSqlInjection(snapshot, ingestion, org);
  
      const zeroShaBridge = createSqlCandidateBridge(async () => '0'.repeat(40));
      await expect(
        zeroShaBridge(analysis, snapshot, ingestion, org),
      ).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
  
      const invalidShaBridge = createSqlCandidateBridge(async () => 'not-a-valid-commit-sha');
      await expect(
        invalidShaBridge(analysis, snapshot, ingestion, org),
      ).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
    });
  
    it('short-circuits to empty frozen candidate list on clean parameterized SQL analysis', async () => {
      const safeSnapshot = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: 'repo-next-gap',
          organizationId: org,
          files: [{ path: 'src/app.ts', content: safeContent }],
        },
        org,
      );
  
      const safeIngestion = await ingestExpress(safeSnapshot, org);
      const safeAnalysis = await detectSqlInjection(safeSnapshot, safeIngestion, org);
      expect(safeAnalysis.status).toBe('NOT_DETECTED');
      expect(safeAnalysis.findings).toHaveLength(0);
  
      let verifyCalled = false;
      const bridge = createSqlCandidateBridge(async () => {
        verifyCalled = true;
        return 'c'.repeat(40);
      });
  
      const candidates = await bridge(safeAnalysis, safeSnapshot, safeIngestion, org);
      expect(verifyCalled).toBe(false);
      expect(candidates).toHaveLength(0);
      expect(Object.isFrozen(candidates)).toBe(true);
    });
  
    it('refuses tampered analysis result and tenant boundary mismatch', async () => {
      const snapshot = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: 'repo-next-gap',
          organizationId: org,
          files: [{ path: 'src/app.ts', content: vulnerableContent }],
        },
        org,
      );
  
      const ingestion = await ingestExpress(snapshot, org);
      const analysis = await detectSqlInjection(snapshot, ingestion, org);
  
      const tamperedAnalysis = {
        ...analysis,
        status: 'NOT_DETECTED' as const,
      };
  
      const bridge = createSqlCandidateBridge(async () => 'd'.repeat(40));
      await expect(
        bridge(tamperedAnalysis, snapshot, ingestion, org),
      ).rejects.toThrow();
  
      await expect(
        bridge(analysis, snapshot, ingestion, 'foreign_org'),
      ).rejects.toThrow('tenant mismatch');
    });
  });
}
{
  // Historical contract source: 20260919-121606-chat4-V1_CHAT4_E1_C8H_100021_NEXT_INTEGRATION_GAP
  const org = 'org_platform';
  
  const repoId = 'repo-next-gap';
  
  const fixtureId = 'm2-case-001';
  
  const commitSha = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
  
  
  const vulnerableSource = [
    "import express from 'express';",
    '',
    'export function createApp(db: any) {',
    '  function handleQuery(req: any, res: any) {',
    '    const q = req.query.id;',
    "    const stmt = db.prepare('SELECT * FROM users WHERE id = ' + q);",
    '    const rows = stmt.all();',
    '    return res.json(rows);',
    '  }',
    '  const app = express();',
    "  app.get('/users', handleQuery);",
    '  return app;',
    '}',
    '',
  ].join('\n');
  
  
  const cleanSource = [
    "import express from 'express';",
    '',
    'export function createApp(db: any) {',
    '  function handleQuery(req: any, res: any) {',
    "    const stmt = db.prepare('SELECT * FROM users WHERE id = ?');",
    '    const rows = stmt.all(req.query.id);',
    '    return res.json(rows);',
    '  }',
    '  const app = express();',
    "  app.get('/users', handleQuery);",
    '  return app;',
    '}',
    '',
  ].join('\n');
  
  
  describe('Velnar Trust Boundary Integration Next Gap', () => {
    it('enforces non-authority boundary for candidates across ingestion and detection', async () => {
      const snapshot = await captureSnapshot(
        {
          fixtureId,
          repositoryId: repoId,
          organizationId: org,
          files: [{ path: 'src/app.ts', content: vulnerableSource }],
        },
        org,
      );
      const expressIngestion = await ingestExpress(snapshot, org);
      const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
  
      expect(analysis.status).toBe('DETECTED');
      expect(analysis.findings.length).toBeGreaterThan(0);
  
      let verifyCalled = false;
      const bridge = createSqlCandidateBridge(async (snap) => {
        verifyCalled = true;
        expect(snap.snapshotId).toBe(snapshot.snapshotId);
        return commitSha;
      });
  
      const hypotheses = await bridge(analysis, snapshot, expressIngestion, org);
      expect(verifyCalled).toBe(true);
      expect(hypotheses).toHaveLength(1);
  
      const { candidate, candidateBinding } = hypotheses[0];
      expect(candidate.verificationState).toBe('CANDIDATE');
      expect((candidate as { verificationState: string }).verificationState).not.toBe('VERIFIED');
      expect(candidate.reachabilityState).toBe('REACHABLE');
      expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
      expect(candidate.snapshot.commitSha).toBe(commitSha);
      expect(candidate.snapshot.organizationId).toBe(org);
      expect(typeof candidateBinding).toBe('string');
      expect(candidateBinding.length).toBeGreaterThan(0);
  
      expect(isTrustedCommitCapability(candidate, null as any)).toBe(false);
      expect(() => assertTrustedCommitCapability(candidate, null as any)).toThrow();
    });
  
    it('fails closed and refuses candidates when commit verification fails or is invalid', async () => {
      const snapshot = await captureSnapshot(
        {
          fixtureId,
          repositoryId: repoId,
          organizationId: org,
          files: [{ path: 'src/app.ts', content: vulnerableSource }],
        },
        org,
      );
      const expressIngestion = await ingestExpress(snapshot, org);
      const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
  
      const bridgeRejecting = createSqlCandidateBridge(async () => {
        throw new Error('VERIFICATION_FAILED');
      });
      await expect(bridgeRejecting(analysis, snapshot, expressIngestion, org)).rejects.toThrow('VERIFICATION_FAILED');
  
      const bridgeZeroSha = createSqlCandidateBridge(async () => {
        return '0'.repeat(40);
      });
      await expect(bridgeZeroSha(analysis, snapshot, expressIngestion, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
  
      const bridgeInvalidSha = createSqlCandidateBridge(async () => {
        return 'not-a-valid-sha';
      });
      await expect(bridgeInvalidSha(analysis, snapshot, expressIngestion, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
    });
  
    it('returns empty candidate hypotheses without invoking commit verifier on clean source', async () => {
      const snapshot = await captureSnapshot(
        {
          fixtureId,
          repositoryId: repoId,
          organizationId: org,
          files: [{ path: 'src/app.ts', content: cleanSource }],
        },
        org,
      );
      const expressIngestion = await ingestExpress(snapshot, org);
      const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
  
      expect(analysis.status).toBe('NOT_DETECTED');
      expect(analysis.findings).toHaveLength(0);
  
      let verifyCalled = false;
      const bridge = createSqlCandidateBridge(async () => {
        verifyCalled = true;
        return commitSha;
      });
  
      const hypotheses = await bridge(analysis, snapshot, expressIngestion, org);
      expect(verifyCalled).toBe(false);
      expect(hypotheses).toEqual([]);
    });
  
    it('preserves tenant boundaries and detects analysis tampering across pipeline stages', async () => {
      await expect(
        captureSnapshot(
          {
            fixtureId,
            repositoryId: repoId,
            organizationId: org,
            files: [{ path: 'src/app.ts', content: vulnerableSource }],
          },
          'foreign_org',
        ),
      ).rejects.toThrow('tenant mismatch');
  
      const snapshot = await captureSnapshot(
        {
          fixtureId,
          repositoryId: repoId,
          organizationId: org,
          files: [{ path: 'src/app.ts', content: vulnerableSource }],
        },
        org,
      );
      const expressIngestion = await ingestExpress(snapshot, org);
      const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
  
      const bridge = createSqlCandidateBridge(async () => commitSha);
      await expect(bridge(analysis, snapshot, expressIngestion, 'foreign_org')).rejects.toThrow('tenant mismatch');
  
      const tamperedAnalysis = { ...analysis, status: 'NOT_DETECTED' as const };
      await expect(validateSqlAnalysis(tamperedAnalysis, snapshot, expressIngestion, org)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
    });
  
    it('maintains disabled fail-safe behavior for Fulgor Ray telemetry and anomaly detection', async () => {
      expect(fulgorRayAdapter.isEnabled).toBe(false);
      expect(fulgorRayAdapter.status).toBe('DISABLED');
  
      const telemetryResult = await fulgorRayAdapter.emitTelemetry({
        organizationId: org,
        businessId: 'biz_platform_integration',
        eventType: 'candidate.pipeline.test',
        timestamp: new Date().toISOString(),
        metrics: { executionSteps: 4 },
      });
      expect(telemetryResult.delivered).toBe(false);
      expect(telemetryResult.reason).toContain('disabled');
  
      const anomalyReport = await fulgorRayAdapter.checkAnomalies('biz_platform_integration');
      expect(anomalyReport.anomalyDetected).toBe(false);
      expect(anomalyReport.confidenceScore).toBe(0);
      expect(anomalyReport.category).toBe('none');
    });
  });
}
