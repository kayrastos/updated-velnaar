// AUTO-RECONCILED CHAT-4 HISTORICAL CONTRACT SUCCESSOR
// Generated only from individually runtime-green historical variants.
// Canonical promotion requires separate human approval.

import { createSqlCandidateBridge } from "../../worker/intelligence/detection/candidate";
import { detectSqlInjection } from "../../worker/intelligence/detection/sqlInjection";
import { validateSqlAnalysis } from "../../worker/intelligence/detection/sqlInjection";
import { ingestExpress } from "../../worker/intelligence/ingestion/express";
import { validateExpressIngestion } from "../../worker/intelligence/ingestion/express";
import { assertTrustedCommitCapability } from "../../worker/intelligence/ingestion/repository";
import { isTrustedCommitCapability } from "../../worker/intelligence/ingestion/repository";
import { captureSnapshot } from "../../worker/intelligence/ingestion/snapshot";
import { validateSnapshot } from "../../worker/intelligence/ingestion/snapshot";
import { describe } from "vitest";
import { expect } from "vitest";
import { it } from "vitest";

{
  // Historical contract source: 20260919-012302-chat4-V1_CHAT4_C8H_008_SNAPSHOT_EXPRESS__DENT_TY
  const org = 'org_trust_boundary';
  
  
  const sampleVulnerableSource = [
    "import express from 'express';",
    '',
    'export function createApp(db: any) {',
    '  const app = express();',
    '  function handleQuery(req: any, res: any) {',
    '    const input = req.query.id;',
    "    const stmt = db.prepare('SELECT * FROM users WHERE id = ' + input);",
    '    const rows = stmt.all();',
    '    return res.json(rows);',
    '  }',
    "  app.get('/users', handleQuery);",
    '  return app;',
    '}',
    '',
  ].join('\n');
  
  
  const sampleSafeSource = [
    "import express from 'express';",
    '',
    'export function createApp(db: any) {',
    '  const app = express();',
    '  function handleQuery(req: any, res: any) {',
    '    const input = req.query.id;',
    "    const stmt = db.prepare('SELECT * FROM users WHERE id = ?');",
    '    const rows = stmt.all(input);',
    '    return res.json(rows);',
    '  }',
    "  app.get('/users', handleQuery);",
    '  return app;',
    '}',
    '',
  ].join('\n');
  
  
  describe('Velnar Trust Boundary: Snapshot and Express Analysis Identity Binding', () => {
    it('consistently binds snapshot, Express route identity, and SQLi detection across ingestion and analysis', async () => {
      const snapshot = await captureSnapshot({
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-snapshot-express-binding',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: sampleVulnerableSource }],
      }, org);
  
      const expressIngestion = await ingestExpress(snapshot, org);
      expect(expressIngestion.snapshot.snapshotId).toBe(snapshot.snapshotId);
      expect(expressIngestion.routes).toHaveLength(1);
      expect(expressIngestion.routes[0].method).toBe('GET');
      expect(expressIngestion.routes[0].path).toBe('/users');
  
      const validatedIngestion = await validateExpressIngestion(expressIngestion, org);
      expect(validatedIngestion.ingestionIdentity).toBe(expressIngestion.ingestionIdentity);
  
      const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
      expect(analysis.status).toBe('DETECTED');
      expect(analysis.snapshotId).toBe(snapshot.snapshotId);
      expect(analysis.ingestionIdentity).toBe(expressIngestion.ingestionIdentity);
      expect(analysis.routeIdentities).toEqual([expressIngestion.routes[0].routeIdentity]);
      expect(analysis.findings).toHaveLength(1);
      expect(analysis.findings[0].vulnerabilityClass).toBe('SQL_INJECTION');
  
      const validatedAnalysis = await validateSqlAnalysis(analysis, snapshot, expressIngestion, org);
      expect(validatedAnalysis.resultFingerprint).toBe(analysis.resultFingerprint);
    });
  
    it('enforces identity binding by rejecting mismatched or cross-snapshot ingestion and analysis', async () => {
      const snapshotA = await captureSnapshot({
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-snapshot-a',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: sampleVulnerableSource }],
      }, org);
  
      const snapshotB = await captureSnapshot({
        fixtureId: 'm2-case-002',
        repositoryId: 'repo-snapshot-b',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: sampleVulnerableSource }],
      }, org);
  
      expect(snapshotA.snapshotId).not.toBe(snapshotB.snapshotId);
  
      const expressIngestionA = await ingestExpress(snapshotA, org);
  
      await expect(detectSqlInjection(snapshotB, expressIngestionA, org)).rejects.toThrow(
        'M3_ANALYSIS_SNAPSHOT_MISMATCH',
      );
  
      const analysisA = await detectSqlInjection(snapshotA, expressIngestionA, org);
      await expect(validateSqlAnalysis(analysisA, snapshotB, expressIngestionA, org)).rejects.toThrow(
        'M3_ANALYSIS_SNAPSHOT_MISMATCH',
      );
    });
  
    it('rejects tampered analysis result fingerprints and ingestion identities', async () => {
      const snapshot = await captureSnapshot({
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-tamper-boundary',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: sampleVulnerableSource }],
      }, org);
  
      const expressIngestion = await ingestExpress(snapshot, org);
      const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
  
      const tamperedAnalysis = {
        ...analysis,
        resultFingerprint: `sha256:${'0'.repeat(64)}`,
      };
  
      await expect(validateSqlAnalysis(tamperedAnalysis, snapshot, expressIngestion, org)).rejects.toThrow(
        'M3_ANALYSIS_INTEGRITY_MISMATCH',
      );
  
      const tamperedIngestion = {
        ...expressIngestion,
        ingestionIdentity: `sha256:${'0'.repeat(64)}`,
      };
  
      await expect(validateExpressIngestion(tamperedIngestion, org)).rejects.toThrow(
        'ingestion metadata mismatch',
      );
    });
  
    it('enforces strict tenant isolation across snapshot, ingestion, and analysis APIs', async () => {
      const snapshot = await captureSnapshot({
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-tenant-isolation',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: sampleVulnerableSource }],
      }, org);
  
      const expressIngestion = await ingestExpress(snapshot, org);
      const foreignOrg = 'org_foreign_tenant';
  
      await expect(validateSnapshot(snapshot, foreignOrg)).rejects.toThrow('tenant mismatch');
      await expect(validateExpressIngestion(expressIngestion, foreignOrg)).rejects.toThrow('tenant mismatch');
      await expect(detectSqlInjection(snapshot, expressIngestion, foreignOrg)).rejects.toThrow('tenant mismatch');
    });
  
    it('binds candidate hypothesis to snapshot and route identity without manufacturing verification authority or capabilities', async () => {
      const snapshot = await captureSnapshot({
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-candidate-authority-boundary',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: sampleVulnerableSource }],
      }, org);
  
      const expressIngestion = await ingestExpress(snapshot, org);
      const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
  
      const validCommitSha = 'a'.repeat(40);
      const bridge = createSqlCandidateBridge(async (snap) => {
        expect(snap.snapshotId).toBe(snapshot.snapshotId);
        return validCommitSha;
      });
  
      const candidates = await bridge(analysis, snapshot, expressIngestion, org);
      expect(candidates).toHaveLength(1);
  
      const hypothesis = candidates[0];
      expect(hypothesis.candidate.verificationState).toBe('CANDIDATE');
      expect((hypothesis.candidate as any).verificationState).not.toBe('VERIFIED');
      expect(hypothesis.candidate.reachabilityState).toBe('REACHABLE');
      expect(hypothesis.candidate.snapshot.snapshotId).toBe(snapshot.snapshotId);
      expect(hypothesis.candidate.snapshot.commitSha).toBe(validCommitSha);
      expect(hypothesis.candidate.context.routeId).toBe(expressIngestion.routes[0].routeIdentity);
      expect(hypothesis.candidate.sensorEvidence[0].rawEvidenceFingerprint).toBe(analysis.resultFingerprint);
      expect(typeof hypothesis.candidateBinding).toBe('string');
      expect(hypothesis.candidateBinding.length).toBeGreaterThan(0);
  
      expect(isTrustedCommitCapability(hypothesis, {} as any)).toBe(false);
      expect(isTrustedCommitCapability(hypothesis.candidate, {} as any)).toBe(false);
      expect(isTrustedCommitCapability(analysis, {} as any)).toBe(false);
      expect(isTrustedCommitCapability(expressIngestion, {} as any)).toBe(false);
      expect(isTrustedCommitCapability(snapshot, {} as any)).toBe(false);
  
      expect((hypothesis as any).capability).toBeUndefined();
      expect((hypothesis.candidate as any).capability).toBeUndefined();
      expect((analysis as any).capability).toBeUndefined();
  
      expect(() => assertTrustedCommitCapability(hypothesis, {} as any)).toThrow(
        'unauthorized commit capability',
      );
      expect(() => assertTrustedCommitCapability(analysis, {} as any)).toThrow(
        'unauthorized commit capability',
      );
  
      const zeroShaBridge = createSqlCandidateBridge(async () => '0'.repeat(40));
      await expect(zeroShaBridge(analysis, snapshot, expressIngestion, org)).rejects.toThrow(
        'M3_CHECKED_COMMIT_REQUIRED',
      );
  
      const malformedShaBridge = createSqlCandidateBridge(async () => 'not-a-valid-sha');
      await expect(malformedShaBridge(analysis, snapshot, expressIngestion, org)).rejects.toThrow(
        'M3_CHECKED_COMMIT_REQUIRED',
      );
    });
  
    it('yields NOT_DETECTED status and empty candidates for safe applications without manufacturing findings', async () => {
      const safeSnapshot = await captureSnapshot({
        fixtureId: 'm2-case-003',
        repositoryId: 'repo-safe-app',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: sampleSafeSource }],
      }, org);
  
      const safeIngestion = await ingestExpress(safeSnapshot, org);
      const safeAnalysis = await detectSqlInjection(safeSnapshot, safeIngestion, org);
  
      expect(safeAnalysis.status).toBe('NOT_DETECTED');
      expect(safeAnalysis.findings).toHaveLength(0);
  
      const validCommitSha = 'b'.repeat(40);
      const bridge = createSqlCandidateBridge(async () => validCommitSha);
      const safeCandidates = await bridge(safeAnalysis, safeSnapshot, safeIngestion, org);
  
      expect(safeCandidates).toHaveLength(0);
    });
  });
}
{
  // Historical contract source: 20260919-030358-chat4-V1_CHAT4_C8H_058_SNAPSHOT_EXPRESS__DENT_TY
  describe('Velnar Trust Boundary: Snapshot and Express Analysis Identity', () => {
    const org = 'org_velnar_test';
    const fixtureSource = `import express from 'express';
  
  export function createApp(db: any) {
    function handleQuery(req: any, res: any) {
      const query = req.query.id;
      const stmt = db.prepare('SELECT * FROM users WHERE id = ' + query);
      const rows = stmt.all();
      res.json(rows);
    }
    const app = express();
    app.get('/users', handleQuery);
    return app;
  }
  `;
  
    it('binds snapshot identity to express ingestion and SQL injection analysis', async () => {
      const snapshot = await captureSnapshot({
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-snapshot-express',
        organizationId: org,
        files: [{ path: 'src/routes.ts', content: fixtureSource }],
      }, org);
  
      const expressIngestion = await ingestExpress(snapshot, org);
      expect(expressIngestion.snapshot.snapshotId).toBe(snapshot.snapshotId);
      expect(expressIngestion.routes).toHaveLength(1);
      expect(expressIngestion.routes[0].routeIdentity).toBeDefined();
  
      const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
      expect(analysis.status).toBe('DETECTED');
      expect(analysis.snapshotId).toBe(snapshot.snapshotId);
      expect(analysis.ingestionIdentity).toBe(expressIngestion.ingestionIdentity);
      expect(analysis.routeIdentities).toEqual([expressIngestion.routes[0].routeIdentity]);
      expect(analysis.findings).toHaveLength(1);
      expect(analysis.findings[0].routeIdentity).toBe(expressIngestion.routes[0].routeIdentity);
  
      const verifiedAnalysis = await validateSqlAnalysis(analysis, snapshot, expressIngestion, org);
      expect(verifiedAnalysis.resultFingerprint).toBe(analysis.resultFingerprint);
    });
  
    it('refuses cross-snapshot pairing between snapshot and express ingestion', async () => {
      const snapshotA = await captureSnapshot({
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-a',
        organizationId: org,
        files: [{ path: 'src/routes.ts', content: fixtureSource }],
      }, org);
  
      const snapshotB = await captureSnapshot({
        fixtureId: 'm2-case-002',
        repositoryId: 'repo-b',
        organizationId: org,
        files: [{ path: 'src/routes.ts', content: fixtureSource }],
      }, org);
  
      expect(snapshotA.snapshotId).not.toBe(snapshotB.snapshotId);
  
      const ingestionA = await ingestExpress(snapshotA, org);
      const ingestionB = await ingestExpress(snapshotB, org);
  
      await expect(detectSqlInjection(snapshotA, ingestionB, org)).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
      await expect(detectSqlInjection(snapshotB, ingestionA, org)).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
    });
  
    it('refuses tampered express ingestion identity and tampered analysis fingerprints', async () => {
      const snapshot = await captureSnapshot({
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-integrity',
        organizationId: org,
        files: [{ path: 'src/routes.ts', content: fixtureSource }],
      }, org);
  
      const expressIngestion = await ingestExpress(snapshot, org);
      const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
  
      const forgedIngestion = {
        ...expressIngestion,
        ingestionIdentity: 'sha256:' + '0'.repeat(64),
      };
      await expect(validateExpressIngestion(forgedIngestion, org)).rejects.toThrow('ingestion metadata mismatch');
  
      const forgedAnalysis = {
        ...analysis,
        status: 'NOT_DETECTED' as const,
      };
      await expect(validateSqlAnalysis(forgedAnalysis, snapshot, expressIngestion, org)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
    });
  
    it('preserves candidate non-authority boundary and forbids manufacturing verified authority', async () => {
      const snapshot = await captureSnapshot({
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-candidate-bound',
        organizationId: org,
        files: [{ path: 'src/routes.ts', content: fixtureSource }],
      }, org);
  
      const expressIngestion = await ingestExpress(snapshot, org);
      const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
  
      const validCommitSha = 'a'.repeat(40);
      const candidateBridge = createSqlCandidateBridge(async (snap) => {
        expect(snap.snapshotId).toBe(snapshot.snapshotId);
        return validCommitSha;
      });
  
      const hypotheses = await candidateBridge(analysis, snapshot, expressIngestion, org);
      expect(hypotheses).toHaveLength(1);
  
      const { candidate, candidateBinding } = hypotheses[0];
      expect(candidate.verificationState).toBe('CANDIDATE');
      expect((candidate as any).verificationState).not.toBe('VERIFIED');
      expect(candidate.reachabilityState).toBe('REACHABLE');
      expect(candidate.snapshot.snapshotId).toBe(snapshot.snapshotId);
      expect(candidate.snapshot.commitSha).toBe(validCommitSha);
      expect(candidate.context.routeId).toBe(expressIngestion.routes[0].routeIdentity);
      expect(typeof candidateBinding).toBe('string');
  
      expect(isTrustedCommitCapability(candidate, {} as any)).toBe(false);
      expect(isTrustedCommitCapability(hypotheses[0], {} as any)).toBe(false);
      expect(() => assertTrustedCommitCapability(candidate, {} as any)).toThrow();
  
      const badBridge = createSqlCandidateBridge(async () => '0'.repeat(40));
      await expect(badBridge(analysis, snapshot, expressIngestion, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
    });
  
    it('enforces tenant isolation across snapshot, ingestion, analysis, and candidate bridge', async () => {
      const snapshot = await captureSnapshot({
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-tenant-bound',
        organizationId: org,
        files: [{ path: 'src/routes.ts', content: fixtureSource }],
      }, org);
  
      const expressIngestion = await ingestExpress(snapshot, org);
      const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
  
      await expect(validateSnapshot(snapshot, 'foreign_org')).rejects.toThrow('tenant mismatch');
      await expect(validateExpressIngestion(expressIngestion, 'foreign_org')).rejects.toThrow('tenant mismatch');
      await expect(detectSqlInjection(snapshot, expressIngestion, 'foreign_org')).rejects.toThrow('tenant mismatch');
  
      const candidateBridge = createSqlCandidateBridge(async () => 'b'.repeat(40));
      await expect(candidateBridge(analysis, snapshot, expressIngestion, 'foreign_org')).rejects.toThrow('tenant mismatch');
    });
  });
}
{
  // Historical contract source: 20260919-035259-chat4-V1_CHAT4_C8H_084_SNAPSHOT_EXPRESS__DENT_TY
  const org = 'org_velnar_test';
  
  
  const appSource = `import express from 'express';
  
  export function createApp(db: any) {
    const app = express();
  
    function handler(req: any, res: any) {
      const userId = req.query.id;
      const stmt = db.prepare('SELECT * FROM users WHERE id = ' + userId);
      res.json(stmt.all());
    }
  
    app.get('/users', handler);
    return app;
  }
  `;
  
  
  describe('Velnar Trust Boundary: Snapshot and Express Identity Binding', () => {
    it('consistently binds snapshot and Express identity across analysis APIs', async () => {
      const snapshot = await captureSnapshot({
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-snap-express',
        organizationId: org,
        files: [
          {
            path: 'src/routes.ts',
            content: appSource,
          },
        ],
      }, org);
  
      const expressIngestion = await ingestExpress(snapshot, org);
      expect(expressIngestion.snapshot.snapshotId).toBe(snapshot.snapshotId);
      expect(expressIngestion.routes).toHaveLength(1);
  
      const validatedIngestion = await validateExpressIngestion(expressIngestion, org);
      expect(validatedIngestion.ingestionIdentity).toBe(expressIngestion.ingestionIdentity);
  
      const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
      expect(analysis.status).toBe('DETECTED');
      expect(analysis.snapshotId).toBe(snapshot.snapshotId);
      expect(analysis.ingestionIdentity).toBe(expressIngestion.ingestionIdentity);
      expect(analysis.routeIdentities).toEqual([expressIngestion.routes[0].routeIdentity]);
      expect(analysis.findings).toHaveLength(1);
  
      const validatedAnalysis = await validateSqlAnalysis(analysis, snapshot, expressIngestion, org);
      expect(validatedAnalysis.resultFingerprint).toBe(analysis.resultFingerprint);
    });
  
    it('rejects analysis when snapshot and Express ingestion identities are mismatched', async () => {
      const snapshotA = await captureSnapshot({
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-snap-a',
        organizationId: org,
        files: [
          {
            path: 'src/routes.ts',
            content: appSource,
          },
        ],
      }, org);
  
      const snapshotB = await captureSnapshot({
        fixtureId: 'm2-case-002',
        repositoryId: 'repo-snap-b',
        organizationId: org,
        files: [
          {
            path: 'src/routes.ts',
            content: appSource,
          },
        ],
      }, org);
  
      expect(snapshotA.snapshotId).not.toBe(snapshotB.snapshotId);
  
      const expressA = await ingestExpress(snapshotA, org);
      const expressB = await ingestExpress(snapshotB, org);
  
      await expect(detectSqlInjection(snapshotA, expressB, org)).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
      await expect(detectSqlInjection(snapshotB, expressA, org)).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
    });
  
    it('fails closed on forged or tampered analysis and ingestion identities', async () => {
      const snapshot = await captureSnapshot({
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-tamper-check',
        organizationId: org,
        files: [
          {
            path: 'src/routes.ts',
            content: appSource,
          },
        ],
      }, org);
  
      const expressIngestion = await ingestExpress(snapshot, org);
      const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
  
      const tamperedAnalysis = {
        ...analysis,
        resultFingerprint: 'sha256:' + 'f'.repeat(64),
      };
      await expect(validateSqlAnalysis(tamperedAnalysis, snapshot, expressIngestion, org)).rejects.toThrow(
        'M3_ANALYSIS_INTEGRITY_MISMATCH',
      );
  
      const tamperedIngestion = {
        ...expressIngestion,
        ingestionIdentity: 'sha256:' + 'e'.repeat(64),
      };
      await expect(validateExpressIngestion(tamperedIngestion, org)).rejects.toThrow(
        'ingestion metadata mismatch',
      );
    });
  
    it('preserves candidate non-authority boundary without manufacturing verification authority', async () => {
      const snapshot = await captureSnapshot({
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-candidate-authority',
        organizationId: org,
        files: [
          {
            path: 'src/routes.ts',
            content: appSource,
          },
        ],
      }, org);
  
      const expressIngestion = await ingestExpress(snapshot, org);
      const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
  
      const commitSha = 'c'.repeat(40);
      const bridge = createSqlCandidateBridge(async (snap) => {
        expect(snap.snapshotId).toBe(snapshot.snapshotId);
        return commitSha;
      });
  
      const candidates = await bridge(analysis, snapshot, expressIngestion, org);
      expect(candidates).toHaveLength(1);
  
      const { candidate, candidateBinding } = candidates[0];
      expect(candidate.verificationState).toBe('CANDIDATE');
      expect(candidate.reachabilityState).toBe('REACHABLE');
      expect(candidate.snapshot.snapshotId).toBe(snapshot.snapshotId);
      expect(candidate.snapshot.commitSha).toBe(commitSha);
      expect(candidateBinding).toBeDefined();
  
      expect((candidate as any).capability).toBeUndefined();
      expect((analysis as any).capability).toBeUndefined();
      expect((expressIngestion as any).capability).toBeUndefined();
  
      const dummyIngestion: any = {
        version: 'velnar-repository-ingestion-v1',
        organizationId: org,
        repositoryId: 'repo-candidate-authority',
        commitSha,
        snapshot,
        ingestionIdentity: 'sha256:' + '1'.repeat(64),
      };
  
      expect(isTrustedCommitCapability(candidate, dummyIngestion)).toBe(false);
      expect(isTrustedCommitCapability(analysis, dummyIngestion)).toBe(false);
      expect(() => assertTrustedCommitCapability(candidate, dummyIngestion)).toThrow(
        'unauthorized commit capability',
      );
      expect(() => assertTrustedCommitCapability(analysis, dummyIngestion)).toThrow(
        'unauthorized commit capability',
      );
  
      const invalidCommitBridge = createSqlCandidateBridge(async () => '0'.repeat(40));
      await expect(invalidCommitBridge(analysis, snapshot, expressIngestion, org)).rejects.toThrow(
        'M3_CHECKED_COMMIT_REQUIRED',
      );
    });
  
    it('rejects foreign tenant identity across snapshot and analysis validation', async () => {
      const snapshot = await captureSnapshot({
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-tenant-check',
        organizationId: org,
        files: [
          {
            path: 'src/routes.ts',
            content: appSource,
          },
        ],
      }, org);
  
      const expressIngestion = await ingestExpress(snapshot, org);
  
      await expect(validateSnapshot(snapshot, 'foreign_org')).rejects.toThrow('tenant mismatch');
      await expect(ingestExpress(snapshot, 'foreign_org')).rejects.toThrow('tenant mismatch');
      await expect(detectSqlInjection(snapshot, expressIngestion, 'foreign_org')).rejects.toThrow('tenant mismatch');
    });
  });
}
{
  // Historical contract source: 20260919-062143-chat4-V1_CHAT4_C8H_146_SNAPSHOT_EXPRESS__DENT_TY
  const org = 'org_snapshot_express';
  
  
  const VALID_EXPRESS_SOURCE = `import express from 'express';
  
  export function createApp(db: any) {
    const app = express();
    function searchUsers(req: any, res: any) {
      const q = req.query.q;
      const stmt = db.prepare('SELECT * FROM users WHERE id = ' + q);
      return stmt.all();
    }
    app.get('/users', searchUsers);
    return app;
  }
  `;
  
  
  const ALTERNATIVE_EXPRESS_SOURCE = `import express from 'express';
  
  export function createApp(db: any) {
    const app = express();
    function searchItems(req: any, res: any) {
      const q = req.query.q;
      const stmt = db.prepare('SELECT * FROM items WHERE id = ' + q);
      return stmt.all();
    }
    app.get('/items', searchItems);
    return app;
  }
  `;
  
  
  describe('Snapshot and Express analysis identity boundary regression', () => {
    it('binds snapshot and Express ingestion identity across detection and candidate generation', async () => {
      const snapshotA = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: 'repo-express',
          organizationId: org,
          files: [{ path: 'src/routes.ts', content: VALID_EXPRESS_SOURCE }],
        },
        org,
      );
  
      const expressA = await ingestExpress(snapshotA, org);
      expect(expressA.snapshot.snapshotId).toBe(snapshotA.snapshotId);
  
      const analysisA = await detectSqlInjection(snapshotA, expressA, org);
      expect(analysisA.status).toBe('DETECTED');
      expect(analysisA.snapshotId).toBe(snapshotA.snapshotId);
      expect(analysisA.ingestionIdentity).toBe(expressA.ingestionIdentity);
      expect(analysisA.findings.length).toBe(1);
      expect(analysisA.findings[0].vulnerabilityClass).toBe('SQL_INJECTION');
  
      const validatedAnalysis = await validateSqlAnalysis(analysisA, snapshotA, expressA, org);
      expect(validatedAnalysis.resultFingerprint).toBe(analysisA.resultFingerprint);
  
      const commitSha = '1'.repeat(40);
      const bridge = createSqlCandidateBridge(async () => commitSha);
      const hypotheses = await bridge(analysisA, snapshotA, expressA, org);
      expect(hypotheses.length).toBe(1);
  
      const { candidate, candidateBinding } = hypotheses[0];
      expect(typeof candidateBinding).toBe('string');
      expect(candidate.snapshot.snapshotId).toBe(snapshotA.snapshotId);
      expect(candidate.snapshot.commitSha).toBe(commitSha);
      expect(candidate.verificationState).toBe('CANDIDATE');
      expect(candidate.reachabilityState).toBe('REACHABLE');
      expect((candidate as any).verificationState).not.toBe('VERIFIED');
      expect((hypotheses[0] as any).capability).toBeUndefined();
      expect((candidate as any).capability).toBeUndefined();
      expect((analysisA as any).capability).toBeUndefined();
    });
  
    it('fails closed on snapshot and Express ingestion identity mismatch', async () => {
      const snapshotA = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: 'repo-express',
          organizationId: org,
          files: [{ path: 'src/routes.ts', content: VALID_EXPRESS_SOURCE }],
        },
        org,
      );
  
      const snapshotB = await captureSnapshot(
        {
          fixtureId: 'm2-case-002',
          repositoryId: 'repo-express',
          organizationId: org,
          files: [{ path: 'src/routes.ts', content: ALTERNATIVE_EXPRESS_SOURCE }],
        },
        org,
      );
  
      expect(snapshotA.snapshotId).not.toBe(snapshotB.snapshotId);
  
      const expressA = await ingestExpress(snapshotA, org);
      const expressB = await ingestExpress(snapshotB, org);
      expect(expressA.ingestionIdentity).not.toBe(expressB.ingestionIdentity);
  
      await expect(detectSqlInjection(snapshotB, expressA, org)).rejects.toThrow(
        'M3_ANALYSIS_SNAPSHOT_MISMATCH',
      );
      await expect(detectSqlInjection(snapshotA, expressB, org)).rejects.toThrow(
        'M3_ANALYSIS_SNAPSHOT_MISMATCH',
      );
  
      const analysisA = await detectSqlInjection(snapshotA, expressA, org);
      await expect(validateSqlAnalysis(analysisA, snapshotB, expressA, org)).rejects.toThrow(
        'M3_ANALYSIS_SNAPSHOT_MISMATCH',
      );
  
      const commitSha = '2'.repeat(40);
      const bridge = createSqlCandidateBridge(async () => commitSha);
      await expect(bridge(analysisA, snapshotB, expressA, org)).rejects.toThrow(
        'M3_ANALYSIS_SNAPSHOT_MISMATCH',
      );
    });
  
    it('refuses forged analysis and unverified commit capabilities', async () => {
      const snapshot = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: 'repo-express',
          organizationId: org,
          files: [{ path: 'src/routes.ts', content: VALID_EXPRESS_SOURCE }],
        },
        org,
      );
  
      const express = await ingestExpress(snapshot, org);
      const genuineAnalysis = await detectSqlInjection(snapshot, express, org);
  
      const forgedAnalysis = {
        ...genuineAnalysis,
        status: 'NOT_DETECTED' as const,
        findings: [],
      };
  
      await expect(validateSqlAnalysis(forgedAnalysis, snapshot, express, org)).rejects.toThrow(
        'M3_ANALYSIS_INTEGRITY_MISMATCH',
      );
  
      const commitSha = '3'.repeat(40);
      const bridge = createSqlCandidateBridge(async () => commitSha);
      await expect(bridge(forgedAnalysis, snapshot, express, org)).rejects.toThrow(
        'M3_ANALYSIS_INTEGRITY_MISMATCH',
      );
  
      const zeroShaBridge = createSqlCandidateBridge(async () => '0'.repeat(40));
      await expect(zeroShaBridge(genuineAnalysis, snapshot, express, org)).rejects.toThrow(
        'M3_CHECKED_COMMIT_REQUIRED',
      );
  
      const nonShaBridge = createSqlCandidateBridge(async () => 'invalid-sha');
      await expect(nonShaBridge(genuineAnalysis, snapshot, express, org)).rejects.toThrow(
        'M3_CHECKED_COMMIT_REQUIRED',
      );
    });
  
    it('rejects foreign tenant identity during snapshot and Express validation', async () => {
      const snapshot = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: 'repo-express',
          organizationId: org,
          files: [{ path: 'src/routes.ts', content: VALID_EXPRESS_SOURCE }],
        },
        org,
      );
  
      const express = await ingestExpress(snapshot, org);
  
      await expect(validateSnapshot(snapshot, 'foreign_org')).rejects.toThrow('tenant mismatch');
      await expect(validateExpressIngestion(express, 'foreign_org')).rejects.toThrow('tenant mismatch');
      await expect(detectSqlInjection(snapshot, express, 'foreign_org')).rejects.toThrow('tenant mismatch');
    });
  });
}
{
  // Historical contract source: 20260919-151130-chat4-V1_CHAT4_E1_C8H_100221_SNAPSHOT_EXPRESS_IDENTITY
  const org = 'org_velnar_snapshot_express';
  
  
  const validExpressSourceA = `import express from 'express';
  
  export function createApp(db: any) {
    const app = express();
  
    function handleUsers(req: any, res: any) {
      const q = req.query.id;
      const stmt = db.prepare('SELECT * FROM users WHERE id = ' + q);
      const rows = stmt.all();
      return res.json(rows);
    }
  
    app.get('/users', handleUsers);
    return app;
  }
  `;
  
  
  const validExpressSourceB = `import express from 'express';
  
  export function createApp(db: any) {
    const app = express();
  
    function handleItems(req: any, res: any) {
      const q = req.query.term;
      const stmt = db.prepare('SELECT * FROM items WHERE name = ' + q);
      const rows = stmt.all();
      return res.json(rows);
    }
  
    app.get('/items', handleItems);
    return app;
  }
  `;
  
  
  describe('V1 Platform Integration: Snapshot-Express Identity and Trust Boundary', () => {
    it('preserves snapshot identity and route identity binding across trusted pipeline', async () => {
      const snapshotA = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: 'repo-snapshot-express-a',
          organizationId: org,
          files: [{ path: 'src/app.ts', content: validExpressSourceA }],
        },
        org,
      );
  
      const expressA = await ingestExpress(snapshotA, org);
  
      expect(expressA.snapshot.snapshotId).toBe(snapshotA.snapshotId);
      expect(expressA.routes).toHaveLength(1);
      expect(expressA.routes[0].path).toBe('/users');
      expect(expressA.routes[0].method).toBe('GET');
      expect(expressA.routes[0].routeIdentity).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(expressA.ingestionIdentity).toMatch(/^sha256:[a-f0-9]{64}$/);
  
      const validated = await validateExpressIngestion(expressA, org);
      expect(validated.ingestionIdentity).toBe(expressA.ingestionIdentity);
      expect(validated.snapshot.snapshotId).toBe(snapshotA.snapshotId);
  
      const analysis = await detectSqlInjection(snapshotA, expressA, org);
      expect(analysis.status).toBe('DETECTED');
      expect(analysis.snapshotId).toBe(snapshotA.snapshotId);
      expect(analysis.ingestionIdentity).toBe(expressA.ingestionIdentity);
      expect(analysis.routeIdentities).toEqual([expressA.routes[0].routeIdentity]);
      expect(analysis.findings).toHaveLength(1);
      expect(analysis.resultFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
  
      expect((analysis as any).capability).toBeUndefined();
      expect((expressA as any).capability).toBeUndefined();
    });
  
    it('rejects analysis when snapshot does not match express ingestion snapshot', async () => {
      const snapshotA = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: 'repo-snapshot-express-a',
          organizationId: org,
          files: [{ path: 'src/app.ts', content: validExpressSourceA }],
        },
        org,
      );
  
      const snapshotB = await captureSnapshot(
        {
          fixtureId: 'm2-case-002',
          repositoryId: 'repo-snapshot-express-b',
          organizationId: org,
          files: [{ path: 'src/app.ts', content: validExpressSourceB }],
        },
        org,
      );
  
      const expressA = await ingestExpress(snapshotA, org);
      const expressB = await ingestExpress(snapshotB, org);
  
      expect(snapshotA.snapshotId).not.toBe(snapshotB.snapshotId);
      expect(expressA.ingestionIdentity).not.toBe(expressB.ingestionIdentity);
  
      await expect(detectSqlInjection(snapshotA, expressB, org)).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
      await expect(detectSqlInjection(snapshotB, expressA, org)).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
    });
  
    it('fails closed on tampered snapshot identity or content inside express ingestion', async () => {
      const snapshot = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: 'repo-snapshot-express-a',
          organizationId: org,
          files: [{ path: 'src/app.ts', content: validExpressSourceA }],
        },
        org,
      );
  
      const express = await ingestExpress(snapshot, org);
  
      const tamperedSnapshotId = {
        ...express,
        snapshot: {
          ...express.snapshot,
          snapshotId: 'sha256:' + '0'.repeat(64),
        },
      };
      await expect(validateExpressIngestion(tamperedSnapshotId as any, org)).rejects.toThrow();
  
      const tamperedFileContent = {
        ...express,
        snapshot: {
          ...express.snapshot,
          files: [
            {
              ...express.snapshot.files[0],
              content: 'export const altered = true;\n',
            },
          ],
        },
      };
      await expect(validateExpressIngestion(tamperedFileContent as any, org)).rejects.toThrow();
    });
  
    it('fails closed on tampered route identity or modified route list', async () => {
      const snapshot = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: 'repo-snapshot-express-a',
          organizationId: org,
          files: [{ path: 'src/app.ts', content: validExpressSourceA }],
        },
        org,
      );
  
      const express = await ingestExpress(snapshot, org);
  
      const tamperedRouteIdentity = {
        ...express,
        routes: [
          {
            ...express.routes[0],
            routeIdentity: 'sha256:' + 'f'.repeat(64),
          },
        ],
      };
      await expect(validateExpressIngestion(tamperedRouteIdentity as any, org)).rejects.toThrow('ingestion metadata mismatch');
  
      const tamperedRoutePath = {
        ...express,
        routes: [
          {
            ...express.routes[0],
            path: '/tampered',
          },
        ],
      };
      await expect(validateExpressIngestion(tamperedRoutePath as any, org)).rejects.toThrow('ingestion metadata mismatch');
  
      const tamperedIngestionIdentity = {
        ...express,
        ingestionIdentity: 'sha256:' + 'e'.repeat(64),
      };
      await expect(validateExpressIngestion(tamperedIngestionIdentity as any, org)).rejects.toThrow('ingestion metadata mismatch');
    });
  
    it('enforces strict tenant isolation across snapshot and express ingestion boundaries', async () => {
      const tenantA = 'org_velnar_alpha';
      const tenantB = 'org_velnar_beta';
  
      const snapshotA = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: 'repo-snapshot-express-tenant',
          organizationId: tenantA,
          files: [{ path: 'src/app.ts', content: validExpressSourceA }],
        },
        tenantA,
      );
  
      const expressA = await ingestExpress(snapshotA, tenantA);
  
      await expect(validateSnapshot(snapshotA, tenantB)).rejects.toThrow('tenant mismatch');
      await expect(validateExpressIngestion(expressA, tenantB)).rejects.toThrow('tenant mismatch');
      await expect(detectSqlInjection(snapshotA, expressA, tenantB)).rejects.toThrow('tenant mismatch');
    });
  
    it('fails closed when analysis result is tampered against verified snapshot and express ingestion', async () => {
      const snapshot = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: 'repo-snapshot-express-tamper',
          organizationId: org,
          files: [{ path: 'src/app.ts', content: validExpressSourceA }],
        },
        org,
      );
  
      const express = await ingestExpress(snapshot, org);
      const genuineAnalysis = await detectSqlInjection(snapshot, express, org);
  
      const verified = await validateSqlAnalysis(genuineAnalysis, snapshot, express, org);
      expect(verified.resultFingerprint).toBe(genuineAnalysis.resultFingerprint);
  
      const forgedStatus = {
        ...genuineAnalysis,
        status: 'NOT_DETECTED',
        findings: [],
      };
      await expect(validateSqlAnalysis(forgedStatus as any, snapshot, express, org)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
  
      const forgedFingerprint = {
        ...genuineAnalysis,
        resultFingerprint: 'sha256:' + '1'.repeat(64),
      };
      await expect(validateSqlAnalysis(forgedFingerprint as any, snapshot, express, org)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
    });
  });
}
