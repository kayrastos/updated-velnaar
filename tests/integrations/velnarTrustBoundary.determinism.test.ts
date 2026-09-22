// AUTO-RECONCILED CHAT-4 HISTORICAL CONTRACT SUCCESSOR
// Generated only from individually runtime-green historical variants.
// Canonical promotion requires separate human approval.

import { createSqlCandidateBridge } from "../../worker/intelligence/detection/candidate";
import { detectSqlInjection } from "../../worker/intelligence/detection/sqlInjection";
import { validateSqlAnalysis } from "../../worker/intelligence/detection/sqlInjection";
import { ingestExpress } from "../../worker/intelligence/ingestion/express";
import { validateExpressIngestion } from "../../worker/intelligence/ingestion/express";
import { assertTrustedCommitCapability } from "../../worker/intelligence/ingestion/repository";
import { canonical } from "../../worker/intelligence/ingestion/snapshot";
import { captureSnapshot } from "../../worker/intelligence/ingestion/snapshot";
import { validateSnapshot } from "../../worker/intelligence/ingestion/snapshot";
import { describe } from "vitest";
import { expect } from "vitest";
import { it } from "vitest";

{
  // Historical contract source: 20260919-013525-chat4-V1_CHAT4_C8H_014_DETERM_N_SM
  describe('Velnar Trust Boundary Determinism Integration', () => {
    it('produces identical cryptographic identities and analysis across repeated runs while preserving non-authoritative boundary', async () => {
      const org = 'org_velnar_determ';
      const repo = 'repo-determ-benchmark';
      const fixtureId = 'm2-case-001';
  
      const sourceCode = `import express from 'express';
  
  export function createApp(db: any) {
    const app = express();
  
    function handleItems(req: any, res: any) {
      const term = req.query.term;
      const query = "SELECT id, name FROM items WHERE name = '" + term + "'";
      const stmt = db.prepare(query);
      const rows = stmt.all();
      return res.json(rows);
    }
  
    app.get('/items', handleItems);
    return app;
  }
  `;
  
      const input = {
        fixtureId,
        repositoryId: repo,
        organizationId: org,
        files: [
          {
            path: 'src/app.ts',
            content: sourceCode,
          },
        ],
      };
  
      // Run 1
      const snapshot1 = await captureSnapshot(input, org);
      const validatedSnapshot1 = await validateSnapshot(snapshot1, org);
      const express1 = await ingestExpress(validatedSnapshot1, org);
      const validatedExpress1 = await validateExpressIngestion(express1, org);
      const analysis1 = await detectSqlInjection(validatedSnapshot1, validatedExpress1, org);
      const validatedAnalysis1 = await validateSqlAnalysis(analysis1, validatedSnapshot1, validatedExpress1, org);
  
      // Run 2
      const snapshot2 = await captureSnapshot(input, org);
      const validatedSnapshot2 = await validateSnapshot(snapshot2, org);
      const express2 = await ingestExpress(validatedSnapshot2, org);
      const validatedExpress2 = await validateExpressIngestion(express2, org);
      const analysis2 = await detectSqlInjection(validatedSnapshot2, validatedExpress2, org);
      const validatedAnalysis2 = await validateSqlAnalysis(analysis2, validatedSnapshot2, validatedExpress2, org);
  
      // Assert determinism across ingestion runs
      expect(snapshot1.snapshotId).toBe(snapshot2.snapshotId);
      expect(snapshot1.totalBytes).toBe(snapshot2.totalBytes);
      expect(snapshot1.files[0].contentDigest).toBe(snapshot2.files[0].contentDigest);
      expect(snapshot1.files[0].fileIdentity).toBe(snapshot2.files[0].fileIdentity);
      expect(snapshot1).toEqual(snapshot2);
  
      expect(express1.ingestionIdentity).toBe(express2.ingestionIdentity);
      expect(express1.routes).toHaveLength(1);
      expect(express1.routes[0].routeIdentity).toBe(express2.routes[0].routeIdentity);
      expect(express1).toEqual(express2);
  
      // Assert determinism across SQLi analysis runs
      expect(analysis1.status).toBe('DETECTED');
      expect(analysis2.status).toBe('DETECTED');
      expect(analysis1.resultFingerprint).toBe(analysis2.resultFingerprint);
      expect(analysis1.findings).toHaveLength(1);
      expect(analysis1.findings[0].findingId).toBe(analysis2.findings[0].findingId);
      expect(analysis1.findings[0].routeIdentity).toBe(analysis2.findings[0].routeIdentity);
      expect(analysis1.findings[0].flow).toHaveLength(analysis2.findings[0].flow.length);
      expect(analysis1).toEqual(analysis2);
  
      // Assert validation idempotency and integrity confirmation
      expect(validatedSnapshot1.snapshotId).toBe(snapshot1.snapshotId);
      expect(validatedExpress1.ingestionIdentity).toBe(express1.ingestionIdentity);
      expect(validatedAnalysis1.resultFingerprint).toBe(analysis1.resultFingerprint);
      expect(validatedAnalysis2.resultFingerprint).toBe(analysis2.resultFingerprint);
  
      // Candidate bridge execution: candidate findings are hypotheses and never VERIFIED authority
      const dummyCommitSha = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
      const bridge = createSqlCandidateBridge(async () => dummyCommitSha);
  
      const candidates1 = await bridge(analysis1, validatedSnapshot1, validatedExpress1, org);
      const candidates2 = await bridge(analysis2, validatedSnapshot2, validatedExpress2, org);
  
      expect(candidates1).toHaveLength(1);
      expect(candidates2).toHaveLength(1);
      expect(candidates1[0].candidateBinding).toBe(candidates2[0].candidateBinding);
      expect(candidates1[0].candidate.candidateId).toBe(candidates2[0].candidate.candidateId);
      expect(candidates1[0].candidate.verificationState).toBe('CANDIDATE');
      expect(candidates2[0].candidate.verificationState).toBe('CANDIDATE');
      expect(candidates1).toEqual(candidates2);
  
      // Strictly enforce non-authority boundaries
      expect((analysis1 as any).capability).toBeUndefined();
      expect((analysis2 as any).capability).toBeUndefined();
      expect((analysis1 as any).verificationState).toBeUndefined();
      expect((analysis2 as any).verificationState).toBeUndefined();
      expect((analysis1 as any).action).toBeUndefined();
      expect((analysis2 as any).action).toBeUndefined();
      expect((candidates1[0].candidate as any).capability).toBeUndefined();
      expect((candidates2[0].candidate as any).capability).toBeUndefined();
      expect((candidates1[0].candidate as any).action).toBeUndefined();
      expect((candidates2[0].candidate as any).action).toBeUndefined();
    });
  });
}
{
  // Historical contract source: 20260919-022504-chat4-V1_CHAT4_C8H_039_DETERM_N_SM
  const orgId = 'org_velnar_det';
  
  const repoId = 'repo-det-benchmark';
  
  const fixtureId = 'm2-case-001';
  
  
  const vulnerableRouteSource = `import express from 'express';
  
  export function createApp(db) {
    const app = express();
    function getUser(req, res) {
      const id = req.query.id;
      const stmt = db.prepare('SELECT * FROM users WHERE id = ' + id);
      const rows = stmt.all();
      return res.json(rows);
    }
    app.get('/users', getUser);
    return app;
  }
  `;
  
  
  const secondaryModuleSource = `export function getRoutePrefix() {
    return 'users';
  }
  `;
  
  
  describe('Velnar Trust Boundary Determinism Integration Regression', () => {
    it('produces identical snapshot, express ingestion, and SQLi detection across repeated runs', async () => {
      const input = {
        fixtureId,
        repositoryId: repoId,
        organizationId: orgId,
        files: [
          { path: 'src/routes/users.ts', content: vulnerableRouteSource },
        ],
      };
  
      const runCount = 5;
      const runs = [];
  
      for (let i = 0; i < runCount; i++) {
        const snapshot = await captureSnapshot(input, orgId);
        const express = await ingestExpress(snapshot, orgId);
        const analysis = await detectSqlInjection(snapshot, express, orgId);
        runs.push({ snapshot, express, analysis });
      }
  
      const first = runs[0];
      expect(first.analysis.status).toBe('DETECTED');
      expect(first.analysis.findings).toHaveLength(1);
  
      for (let i = 1; i < runCount; i++) {
        const current = runs[i];
  
        expect(current.snapshot.snapshotId).toBe(first.snapshot.snapshotId);
        expect(current.snapshot.totalBytes).toBe(first.snapshot.totalBytes);
        expect(current.snapshot.files[0].contentDigest).toBe(first.snapshot.files[0].contentDigest);
        expect(current.snapshot.files[0].fileIdentity).toBe(first.snapshot.files[0].fileIdentity);
  
        expect(current.express.ingestionIdentity).toBe(first.express.ingestionIdentity);
        expect(current.express.routes[0].routeIdentity).toBe(first.express.routes[0].routeIdentity);
  
        expect(current.analysis.resultFingerprint).toBe(first.analysis.resultFingerprint);
        expect(current.analysis.status).toBe('DETECTED');
        expect(current.analysis.findings[0].findingId).toBe(first.analysis.findings[0].findingId);
        expect(current.analysis.findings[0].flow[0].id).toBe(first.analysis.findings[0].flow[0].id);
  
        expect(canonical(current.analysis)).toBe(canonical(first.analysis));
      }
    });
  
    it('guarantees deterministic snapshot and analysis identity regardless of source file input ordering', async () => {
      const fileA = { path: 'src/modules/prefix.ts', content: secondaryModuleSource };
      const fileB = { path: 'src/routes/users.ts', content: vulnerableRouteSource };
  
      const inputOrderA = {
        fixtureId,
        repositoryId: repoId,
        organizationId: orgId,
        files: [fileA, fileB],
      };
  
      const inputOrderB = {
        fixtureId,
        repositoryId: repoId,
        organizationId: orgId,
        files: [fileB, fileA],
      };
  
      const snapshotA = await captureSnapshot(inputOrderA, orgId);
      const snapshotB = await captureSnapshot(inputOrderB, orgId);
  
      expect(snapshotA.snapshotId).toBe(snapshotB.snapshotId);
      expect(snapshotA.totalBytes).toBe(snapshotB.totalBytes);
  
      const expressA = await ingestExpress(snapshotA, orgId);
      const expressB = await ingestExpress(snapshotB, orgId);
  
      expect(expressA.ingestionIdentity).toBe(expressB.ingestionIdentity);
  
      const analysisA = await detectSqlInjection(snapshotA, expressA, orgId);
      const analysisB = await detectSqlInjection(snapshotB, expressB, orgId);
  
      expect(analysisA.resultFingerprint).toBe(analysisB.resultFingerprint);
      expect(canonical(analysisA)).toBe(canonical(analysisB));
    });
  
    it('preserves non-authoritative boundary and validates analysis recomputation', async () => {
      const input = {
        fixtureId,
        repositoryId: repoId,
        organizationId: orgId,
        files: [
          { path: 'src/routes/users.ts', content: vulnerableRouteSource },
        ],
      };
  
      const snapshot = await captureSnapshot(input, orgId);
      const express = await ingestExpress(snapshot, orgId);
      const analysis = await detectSqlInjection(snapshot, express, orgId);
  
      expect(analysis.status).toBe('DETECTED');
      expect((analysis as any).capability).toBeUndefined();
      expect((analysis as any).verificationState).toBeUndefined();
      expect((analysis as any).authority).toBeUndefined();
  
      const validatedSnapshot = await validateSnapshot(snapshot, orgId);
      expect(validatedSnapshot.snapshotId).toBe(snapshot.snapshotId);
  
      const validatedExpress = await validateExpressIngestion(express, orgId);
      expect(validatedExpress.ingestionIdentity).toBe(express.ingestionIdentity);
  
      const validatedAnalysis = await validateSqlAnalysis(analysis, snapshot, express, orgId);
      expect(validatedAnalysis.resultFingerprint).toBe(analysis.resultFingerprint);
  
      const tamperedAnalysis = {
        ...analysis,
        resultFingerprint: 'sha256:' + '0'.repeat(64),
      };
  
      await expect(
        validateSqlAnalysis(tamperedAnalysis, snapshot, express, orgId),
      ).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
    });
  });
}
{
  // Historical contract source: 20260919-175635-chat4-V1_CHAT4_E1_C8H_100241_DETERMINISM
  const orgId = 'org_velnar_det';
  
  const repoId = 'repo-pipeline-det';
  
  const fixtureId = 'm2-case-001';
  
  const commitSha = 'e4d909c290d0fb1ca068ffaddf22cbd0adddef11';
  
  
  const sampleFiles = [
    {
      path: 'src/app.ts',
      content: `import express from 'express';
  
  export function createApp(db: any) {
    const app = express();
  
    function getUser(req: any, res: any) {
      const id = req.query.id;
      const query = 'SELECT * FROM users WHERE id = ' + id;
      const stmt = db.prepare(query);
      const rows = stmt.all();
      res.json(rows);
    }
  
    app.get('/users', getUser);
    return app;
  }
  `,
    },
  ];
  
  
  describe('Velnar Trust Boundary Pipeline Determinism', () => {
    it('preserves bit-for-bit identity across repeated runs of the complete intelligence pipeline', async () => {
      const runPipeline = async () => {
        const snapshot = await captureSnapshot(
          { fixtureId, repositoryId: repoId, organizationId: orgId, files: sampleFiles },
          orgId,
        );
        const express = await ingestExpress(snapshot, orgId);
        const analysis = await detectSqlInjection(snapshot, express, orgId);
        const bridge = createSqlCandidateBridge(async () => commitSha);
        const hypotheses = await bridge(analysis, snapshot, express, orgId);
        return { snapshot, express, analysis, hypotheses };
      };
  
      const run1 = await runPipeline();
      const run2 = await runPipeline();
  
      expect(run1.snapshot.snapshotId).toBe(run2.snapshot.snapshotId);
      expect(run1.snapshot.totalBytes).toBe(run2.snapshot.totalBytes);
      expect(run1.snapshot.files[0].contentDigest).toBe(run2.snapshot.files[0].contentDigest);
      expect(run1.snapshot.files[0].fileIdentity).toBe(run2.snapshot.files[0].fileIdentity);
  
      expect(run1.express.ingestionIdentity).toBe(run2.express.ingestionIdentity);
      expect(run1.express.routes).toHaveLength(1);
      expect(run2.express.routes).toHaveLength(1);
      expect(run1.express.routes[0].routeIdentity).toBe(run2.express.routes[0].routeIdentity);
  
      expect(run1.analysis.status).toBe('DETECTED');
      expect(run2.analysis.status).toBe('DETECTED');
      expect(run1.analysis.resultFingerprint).toBe(run2.analysis.resultFingerprint);
      expect(run1.analysis.findings).toHaveLength(1);
      expect(run2.analysis.findings).toHaveLength(1);
      expect(run1.analysis.findings[0].findingId).toBe(run2.analysis.findings[0].findingId);
      expect(run1.analysis.findings[0].flow).toEqual(run2.analysis.findings[0].flow);
  
      expect(run1.hypotheses).toHaveLength(1);
      expect(run2.hypotheses).toHaveLength(1);
      expect(run1.hypotheses[0].candidate.candidateId).toBe(run2.hypotheses[0].candidate.candidateId);
      expect(run1.hypotheses[0].candidateBinding).toBe(run2.hypotheses[0].candidateBinding);
      expect(run1.hypotheses[0].candidate.sensorEvidence[0].rawEvidenceFingerprint).toBe(
        run2.hypotheses[0].candidate.sensorEvidence[0].rawEvidenceFingerprint,
      );
    });
  
    it('enforces that analysis output and candidate hypotheses remain strictly non-authoritative across repeated runs', async () => {
      const snapshot = await captureSnapshot(
        { fixtureId, repositoryId: repoId, organizationId: orgId, files: sampleFiles },
        orgId,
      );
      const express = await ingestExpress(snapshot, orgId);
      const analysis = await detectSqlInjection(snapshot, express, orgId);
      const bridge = createSqlCandidateBridge(async () => commitSha);
      const hypotheses = await bridge(analysis, snapshot, express, orgId);
  
      expect((analysis as any).capability).toBeUndefined();
      expect(hypotheses[0].candidate.verificationState).toBe('CANDIDATE');
      expect(hypotheses[0].candidate.reachabilityState).toBe('REACHABLE');
      expect((hypotheses[0] as any).capability).toBeUndefined();
      expect((hypotheses[0].candidate as any).capability).toBeUndefined();
  
      expect(() => assertTrustedCommitCapability(analysis, ({} as any))).toThrow();
    });
  
    it('validates pipeline structural integrity deterministically and rejects tampered artifacts', async () => {
      const snapshot = await captureSnapshot(
        { fixtureId, repositoryId: repoId, organizationId: orgId, files: sampleFiles },
        orgId,
      );
      const express = await ingestExpress(snapshot, orgId);
      const analysis = await detectSqlInjection(snapshot, express, orgId);
  
      const validatedSnapshot = await validateSnapshot(snapshot, orgId);
      expect(validatedSnapshot.snapshotId).toBe(snapshot.snapshotId);
  
      const validatedExpress = await validateExpressIngestion(express, orgId);
      expect(validatedExpress.ingestionIdentity).toBe(express.ingestionIdentity);
  
      const validatedAnalysis = await validateSqlAnalysis(analysis, snapshot, express, orgId);
      expect(validatedAnalysis.resultFingerprint).toBe(analysis.resultFingerprint);
  
      const tamperedStatus = { ...analysis, status: 'NOT_DETECTED' };
      await expect(validateSqlAnalysis(tamperedStatus, snapshot, express, orgId)).rejects.toThrow(
        'M3_ANALYSIS_INTEGRITY_MISMATCH',
      );
  
      const tamperedFingerprint = { ...analysis, resultFingerprint: 'sha256:' + '0'.repeat(64) };
      await expect(validateSqlAnalysis(tamperedFingerprint, snapshot, express, orgId)).rejects.toThrow(
        'M3_ANALYSIS_INTEGRITY_MISMATCH',
      );
    });
  
    it('binds distinct commit provenance to candidate identity while preserving snapshot determinism', async () => {
      const snapshot = await captureSnapshot(
        { fixtureId, repositoryId: repoId, organizationId: orgId, files: sampleFiles },
        orgId,
      );
      const express = await ingestExpress(snapshot, orgId);
      const analysis = await detectSqlInjection(snapshot, express, orgId);
  
      const commitA = '1111111111111111111111111111111111111111';
      const commitB = '2222222222222222222222222222222222222222';
  
      const bridgeA = createSqlCandidateBridge(async () => commitA);
      const bridgeB = createSqlCandidateBridge(async () => commitB);
  
      const resA = await bridgeA(analysis, snapshot, express, orgId);
      const resB = await bridgeB(analysis, snapshot, express, orgId);
  
      expect(resA[0].candidate.snapshot.commitSha).toBe(commitA);
      expect(resB[0].candidate.snapshot.commitSha).toBe(commitB);
      expect(resA[0].candidate.candidateId).not.toBe(resB[0].candidate.candidateId);
      expect(resA[0].candidateBinding).not.toBe(resB[0].candidateBinding);
  
      expect(resA[0].candidate.verificationState).toBe('CANDIDATE');
      expect(resB[0].candidate.verificationState).toBe('CANDIDATE');
  
      const invalidBridge = createSqlCandidateBridge(async () => '0'.repeat(40));
      await expect(invalidBridge(analysis, snapshot, express, orgId)).rejects.toThrow(
        'M3_CHECKED_COMMIT_REQUIRED',
      );
    });
  });
}
