// AUTO-RECONCILED CHAT-4 HISTORICAL CONTRACT SUCCESSOR
// Generated only from individually runtime-green historical variants.
// Canonical promotion requires separate human approval.

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
import { beforeAll } from "vitest";
import { describe } from "vitest";
import { expect } from "vitest";
import { it } from "vitest";

{
  // Historical contract source: 20260919-013717-chat4-V1_CHAT4_C8H_015_FA_LCLOSED
  async function createDetectedFixture(organizationId: string) {
    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-fail-closed',
        organizationId,
        files: [
          {
            path: 'src/app.ts',
            content: [
              "import express from 'express';",
              '',
              'export function createApp(db: any) {',
              '  const app = express();',
              '  function handler(req: any, res: any) {',
              '    const q = req.query.id;',
              "    const stmt = db.prepare('SELECT * FROM items WHERE id = ' + q);",
              '    res.json(stmt.all());',
              '  }',
              "  app.get('/items', handler);",
              '  return app;',
              '}',
              '',
            ].join('\n'),
          },
        ],
      },
      organizationId,
    );
  
    const ingestion = await ingestExpress(snapshot, organizationId);
    const analysis = await detectSqlInjection(snapshot, ingestion, organizationId);
    return { snapshot, ingestion, analysis };
  }
  
  
  describe('Velnar Trust Boundary Fail-Closed Regressions', () => {
    const org = 'org_fail_closed';
    let fixture: Awaited<ReturnType<typeof createDetectedFixture>>;
  
    beforeAll(async () => {
      fixture = await createDetectedFixture(org);
    });
  
    it('fails closed when commit verification callback returns an all-zero commit SHA', async () => {
      const bridge = createSqlCandidateBridge(async () => '0'.repeat(40));
      await expect(
        bridge(fixture.analysis, fixture.snapshot, fixture.ingestion, org),
      ).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
    });
  
    it('fails closed when commit verification callback returns a malformed commit SHA', async () => {
      const bridge = createSqlCandidateBridge(async () => 'invalid-commit-sha');
      await expect(
        bridge(fixture.analysis, fixture.snapshot, fixture.ingestion, org),
      ).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
    });
  
    it('fails closed when candidate bridge receives tampered or forged analysis metadata', async () => {
      const bridge = createSqlCandidateBridge(async () => 'a'.repeat(40));
      const tamperedAnalysis = {
        ...fixture.analysis,
        resultFingerprint: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      };
      await expect(
        bridge(tamperedAnalysis, fixture.snapshot, fixture.ingestion, org),
      ).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
    });
  
    it('fails closed when candidate bridge receives mismatched snapshot and ingestion identities', async () => {
      const bridge = createSqlCandidateBridge(async () => 'a'.repeat(40));
      const otherSnapshot = await captureSnapshot(
        {
          fixtureId: 'm2-case-002',
          repositoryId: 'repo-fail-closed',
          organizationId: org,
          files: [
            {
              path: 'src/app.ts',
              content: [
                "import express from 'express';",
                '',
                'export function createApp(db: any) {',
                '  const app = express();',
                '  function handler(req: any, res: any) {',
                '    const q = req.query.alt;',
                "    const stmt = db.prepare('SELECT * FROM items WHERE id = ' + q);",
                '    res.json(stmt.all());',
                '  }',
                "  app.get('/items', handler);",
                '  return app;',
                '}',
                '',
              ].join('\n'),
            },
          ],
        },
        org,
      );
  
      await expect(
        bridge(fixture.analysis, otherSnapshot, fixture.ingestion, org),
      ).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
    });
  
    it('fails closed when repository ingestion contains an all-zero or malformed commit SHA', async () => {
      const zeroShaRecord = {
        version: 'velnar-repository-ingestion-v1',
        organizationId: org,
        repositoryId: 'repo-fail-closed',
        commitSha: '0'.repeat(40),
        snapshot: fixture.snapshot,
        ingestionIdentity: 'sha256:placeholder',
      };
      await expect(
        validateRepositoryIngestion(zeroShaRecord, org),
      ).rejects.toThrow('Git commit identity');
  
      const malformedShaRecord = {
        ...zeroShaRecord,
        commitSha: 'not-a-valid-sha',
      };
      await expect(
        validateRepositoryIngestion(malformedShaRecord, org),
      ).rejects.toThrow('Git commit identity');
    });
  
    it('fails closed when repository ingestion identity does not match hashed content', async () => {
      const forgedRecord = {
        version: 'velnar-repository-ingestion-v1',
        organizationId: org,
        repositoryId: 'repo-fail-closed',
        commitSha: 'a'.repeat(40),
        snapshot: fixture.snapshot,
        ingestionIdentity: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      };
      await expect(
        validateRepositoryIngestion(forgedRecord, org),
      ).rejects.toThrow('ingestion identity mismatch');
    });
  
    it('successfully mints candidate hypotheses with non-authoritative CANDIDATE state when all boundary checks pass', async () => {
      const validSha = 'a'.repeat(40);
      const bridge = createSqlCandidateBridge(async () => validSha);
      const results = await bridge(fixture.analysis, fixture.snapshot, fixture.ingestion, org);
      expect(results.length).toBe(1);
      expect(results[0].candidate.verificationState).toBe('CANDIDATE');
      expect(results[0].candidate.reachabilityState).toBe('REACHABLE');
      expect(results[0].candidateBinding).toBeTruthy();
    });
  });
}
{
  // Historical contract source: 20260919-022734-chat4-V1_CHAT4_C8H_040_FA_LCLOSED
  const org = 'org_velnar_test';
  
  
  const vulnerableAppSource = `import express from 'express';
  
  export function createApp(db: any) {
    const app = express();
  
    function handleQuery(req: any, res: any) {
      const search = req.query.search;
      const stmt = db.prepare('SELECT * FROM items WHERE name = ' + search);
      return res.json(stmt.all());
    }
  
    app.get('/search', handleQuery);
    return app;
  }
  `;
  
  
  const cleanAppSource = `import express from 'express';
  
  export function createApp(db: any) {
    const app = express();
  
    function handleHealth(req: any, res: any) {
      const stmt = db.prepare('SELECT 1');
      return res.json(stmt.all());
    }
  
    app.get('/health', handleHealth);
    return app;
  }
  `;
  
  
  describe('Velnar Trust Boundary Fail-Closed Integration Regressions', () => {
    it('fails closed on snapshot mismatch between detection source snapshot and express ingestion', async () => {
      const snapshotA = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: 'repo-failclosed-a',
          organizationId: org,
          files: [{ path: 'src/routes.ts', content: vulnerableAppSource }],
        },
        org,
      );
  
      const snapshotB = await captureSnapshot(
        {
          fixtureId: 'm2-case-002',
          repositoryId: 'repo-failclosed-b',
          organizationId: org,
          files: [{ path: 'src/routes.ts', content: cleanAppSource }],
        },
        org,
      );
  
      const ingestionA = await ingestExpress(snapshotA, org);
      const ingestionB = await ingestExpress(snapshotB, org);
  
      expect(snapshotA.snapshotId).not.toBe(snapshotB.snapshotId);
      expect(ingestionA.snapshot.snapshotId).not.toBe(ingestionB.snapshot.snapshotId);
  
      await expect(
        detectSqlInjection(snapshotA, ingestionB, org),
      ).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
  
      const analysisA = await detectSqlInjection(snapshotA, ingestionA, org);
      await expect(
        validateSqlAnalysis(analysisA, snapshotB, ingestionA, org),
      ).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
    });
  
    it('fails closed on forged or tampered analysis result across candidate bridge', async () => {
      const snapshot = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: 'repo-tamper-test',
          organizationId: org,
          files: [{ path: 'src/routes.ts', content: vulnerableAppSource }],
        },
        org,
      );
      const ingestion = await ingestExpress(snapshot, org);
      const genuineAnalysis = await detectSqlInjection(snapshot, ingestion, org);
      expect(genuineAnalysis.status).toBe('DETECTED');
  
      const forgedAnalysis = {
        ...genuineAnalysis,
        resultFingerprint: 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      };
  
      const bridge = createSqlCandidateBridge(async () => 'a'.repeat(40));
  
      await expect(
        bridge(forgedAnalysis, snapshot, ingestion, org),
      ).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
    });
  
    it('fails closed and refuses candidate minting when commit verification yields all-zero or malformed SHA', async () => {
      const snapshot = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: 'repo-commit-test',
          organizationId: org,
          files: [{ path: 'src/routes.ts', content: vulnerableAppSource }],
        },
        org,
      );
      const ingestion = await ingestExpress(snapshot, org);
      const analysis = await detectSqlInjection(snapshot, ingestion, org);
      expect(analysis.status).toBe('DETECTED');
  
      const zeroShaBridge = createSqlCandidateBridge(async () => '0'.repeat(40));
      await expect(
        zeroShaBridge(analysis, snapshot, ingestion, org),
      ).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
  
      const malformedShaBridge = createSqlCandidateBridge(async () => 'not-a-valid-sha');
      await expect(
        malformedShaBridge(analysis, snapshot, ingestion, org),
      ).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
    });
  
    it('fails closed on tenant mismatch across the ingestion-detection trust boundary', async () => {
      const snapshot = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: 'repo-tenant-test',
          organizationId: org,
          files: [{ path: 'src/routes.ts', content: vulnerableAppSource }],
        },
        org,
      );
      const ingestion = await ingestExpress(snapshot, org);
  
      await expect(
        detectSqlInjection(snapshot, ingestion, 'org_foreign_tenant'),
      ).rejects.toThrow('tenant mismatch');
    });
  
    it('fails closed on repository-snapshot binding mismatch during repository ingestion validation', async () => {
      const snapshot = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: 'repo-genuine',
          organizationId: org,
          files: [{ path: 'src/routes.ts', content: vulnerableAppSource }],
        },
        org,
      );
  
      const foreignSnapshot = await captureSnapshot(
        {
          fixtureId: 'm2-case-002',
          repositoryId: 'repo-foreign',
          organizationId: org,
          files: [{ path: 'src/routes.ts', content: cleanAppSource }],
        },
        org,
      );
  
      const validBody = {
        version: 'velnar-repository-ingestion-v1' as const,
        organizationId: org,
        repositoryId: 'repo-genuine',
        commitSha: 'b'.repeat(40),
        snapshot,
      };
      const validIdentity = await hash('velnar-repository-ingestion-v1', validBody);
      const validRecord = { ...validBody, ingestionIdentity: validIdentity };
  
      const validated = await validateRepositoryIngestion(validRecord, org);
      expect(validated.ingestionIdentity).toBe(validIdentity);
  
      const mismatchedBindingRecord = {
        ...validBody,
        snapshot: foreignSnapshot,
        ingestionIdentity: validIdentity,
      };
  
      await expect(
        validateRepositoryIngestion(mismatchedBindingRecord, org),
      ).rejects.toThrow('snapshot binding mismatch');
    });
  
    it('preserves non-authoritative boundary by producing CANDIDATE verificationState and no VERIFIED authority', async () => {
      const snapshot = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: 'repo-candidate-test',
          organizationId: org,
          files: [{ path: 'src/routes.ts', content: vulnerableAppSource }],
        },
        org,
      );
      const ingestion = await ingestExpress(snapshot, org);
      const analysis = await detectSqlInjection(snapshot, ingestion, org);
  
      const validBridge = createSqlCandidateBridge(async () => 'c'.repeat(40));
      const hypotheses = await validBridge(analysis, snapshot, ingestion, org);
  
      expect(hypotheses.length).toBe(1);
      expect(hypotheses[0].candidate.verificationState).toBe('CANDIDATE');
      expect((hypotheses[0].candidate as any).verificationState).not.toBe('VERIFIED');
      expect((hypotheses[0] as any).capability).toBeUndefined();
    });
  });
}
{
  // Historical contract source: 20260919-031757-chat4-V1_CHAT4_C8H_066_FA_LCLOSED
  describe('Velnar Trust Boundary Fail-Closed Regressions', () => {
    const org = 'org_velnar_test';
    const repoId = 'repo_trusted';
    const fixtureId = 'm2-case-001';
    const commitSha = 'a'.repeat(40);
  
    it('fails closed when an ingestion record contains a mismatched repository binding', async () => {
      const files = [
        {
          path: 'src/index.ts',
          content: 'export const active = true;\n',
        },
      ];
  
      const snapshot = await captureSnapshot(
        {
          fixtureId,
          repositoryId: repoId,
          organizationId: org,
          files,
        },
        org,
      );
  
      const mismatchedRepoBody = {
        version: 'velnar-repository-ingestion-v1' as const,
        organizationId: org,
        repositoryId: 'repo_mismatched',
        commitSha,
        snapshot,
      };
  
      const mismatchedRecord = {
        ...mismatchedRepoBody,
        ingestionIdentity: await hash(
          'velnar-repository-ingestion-v1',
          mismatchedRepoBody,
        ),
      };
  
      await expect(
        validateRepositoryIngestion(mismatchedRecord, org),
      ).rejects.toThrow('snapshot binding mismatch');
    });
  
    it('fails closed when commit identity is malformed or all zeros', async () => {
      const files = [
        {
          path: 'src/index.ts',
          content: 'export const active = true;\n',
        },
      ];
  
      const snapshot = await captureSnapshot(
        {
          fixtureId,
          repositoryId: repoId,
          organizationId: org,
          files,
        },
        org,
      );
  
      const zeroShaBody = {
        version: 'velnar-repository-ingestion-v1' as const,
        organizationId: org,
        repositoryId: repoId,
        commitSha: '0'.repeat(40),
        snapshot,
      };
  
      const zeroShaRecord = {
        ...zeroShaBody,
        ingestionIdentity: await hash(
          'velnar-repository-ingestion-v1',
          zeroShaBody,
        ),
      };
  
      await expect(
        validateRepositoryIngestion(zeroShaRecord, org),
      ).rejects.toThrow('Git commit identity');
    });
  
    it('fails closed when tenant does not match expected organization boundary', async () => {
      const files = [
        {
          path: 'src/index.ts',
          content: 'export const active = true;\n',
        },
      ];
  
      const snapshot = await captureSnapshot(
        {
          fixtureId,
          repositoryId: repoId,
          organizationId: org,
          files,
        },
        org,
      );
  
      const validBody = {
        version: 'velnar-repository-ingestion-v1' as const,
        organizationId: org,
        repositoryId: repoId,
        commitSha,
        snapshot,
      };
  
      const validRecord = {
        ...validBody,
        ingestionIdentity: await hash(
          'velnar-repository-ingestion-v1',
          validBody,
        ),
      };
  
      await expect(
        validateRepositoryIngestion(validRecord, 'org_foreign'),
      ).rejects.toThrow('tenant mismatch');
    });
  
    it('fails closed on forged commit capabilities without runtime mint authority', async () => {
      const files = [
        {
          path: 'src/index.ts',
          content: 'export const active = true;\n',
        },
      ];
  
      const snapshot = await captureSnapshot(
        {
          fixtureId,
          repositoryId: repoId,
          organizationId: org,
          files,
        },
        org,
      );
  
      const validBody = {
        version: 'velnar-repository-ingestion-v1' as const,
        organizationId: org,
        repositoryId: repoId,
        commitSha,
        snapshot,
      };
  
      const validRecord = {
        ...validBody,
        ingestionIdentity: await hash(
          'velnar-repository-ingestion-v1',
          validBody,
        ),
      };
  
      const verified = await validateRepositoryIngestion(validRecord, org);
      expect((verified as any).capability).toBeUndefined();
  
      const syntheticCapability = Object.freeze({
        [Symbol.toStringTag]: 'TrustedCommitCapability' as const,
      });
  
      expect(isTrustedCommitCapability(syntheticCapability, verified)).toBe(false);
      expect(isTrustedCommitCapability({}, verified)).toBe(false);
      expect(() =>
        assertTrustedCommitCapability(syntheticCapability, verified),
      ).toThrow('unauthorized commit capability');
    });
  });
}
{
  // Historical contract source: 20260919-040630-chat4-V1_CHAT4_C8H_091_FA_LCLOSED
  const org = 'org_velnar_trust';
  
  
  const validAppSource = [
    "import express from 'express';",
    '',
    'function handleHealth(req: any, res: any) {',
    '}',
    '',
    'export function createApp(db: any) {',
    '  const app = express();',
    "  app.get('/status', handleHealth);",
    '  return app;',
    '}',
  ].join('\n') + '\n';
  
  
  describe('Velnar Trust Boundary Fail-Closed Regressions', () => {
    it('fails closed across candidate bridge when snapshot and express ingestion identities mismatch', async () => {
      const snapshotA = await captureSnapshot({
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-alpha',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: validAppSource }],
      }, org);
  
      const snapshotB = await captureSnapshot({
        fixtureId: 'm2-case-002',
        repositoryId: 'repo-beta',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: validAppSource }],
      }, org);
  
      const ingestionA = await ingestExpress(snapshotA, org);
      const analysisA = await detectSqlInjection(snapshotA, ingestionA, org);
  
      const bridge = createSqlCandidateBridge(async () => '1'.repeat(40));
  
      await expect(bridge(analysisA, snapshotB, ingestionA, org)).rejects.toThrow(
        'M3_ANALYSIS_SNAPSHOT_MISMATCH',
      );
    });
  
    it('fails closed across candidate bridge when raw analysis payload has forged integrity', async () => {
      const snapshot = await captureSnapshot({
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-alpha',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: validAppSource }],
      }, org);
  
      const ingestion = await ingestExpress(snapshot, org);
      const genuineAnalysis = await detectSqlInjection(snapshot, ingestion, org);
  
      const forgedAnalysis = {
        ...genuineAnalysis,
        resultFingerprint: 'sha256:' + 'f'.repeat(64),
      };
  
      const bridge = createSqlCandidateBridge(async () => '1'.repeat(40));
  
      await expect(bridge(forgedAnalysis, snapshot, ingestion, org)).rejects.toThrow(
        'M3_ANALYSIS_INTEGRITY_MISMATCH',
      );
    });
  
    it('fails closed across candidate bridge when called with mismatched tenant', async () => {
      const snapshot = await captureSnapshot({
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-alpha',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: validAppSource }],
      }, org);
  
      const ingestion = await ingestExpress(snapshot, org);
      const analysis = await detectSqlInjection(snapshot, ingestion, org);
  
      const bridge = createSqlCandidateBridge(async () => '1'.repeat(40));
  
      await expect(bridge(analysis, snapshot, ingestion, 'foreign_org')).rejects.toThrow(
        'tenant mismatch',
      );
    });
  
    it('fails closed during structural repository ingestion validation on snapshot repositoryId mismatch', async () => {
      const snapshot = await captureSnapshot({
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-alpha',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: validAppSource }],
      }, org);
  
      const mismatchedRepoRecord = {
        version: 'velnar-repository-ingestion-v1' as const,
        organizationId: org,
        repositoryId: 'repo-foreign',
        commitSha: 'a'.repeat(40),
        snapshot,
      };
  
      const mismatchedIdentity = await hash('velnar-repository-ingestion-v1', mismatchedRepoRecord);
      const record = {
        ...mismatchedRepoRecord,
        ingestionIdentity: mismatchedIdentity,
      };
  
      await expect(validateRepositoryIngestion(record, org)).rejects.toThrow(
        'snapshot binding mismatch',
      );
    });
  
    it('fails closed during repository ingestion validation when commitSha is all zeros', async () => {
      const snapshot = await captureSnapshot({
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-alpha',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: validAppSource }],
      }, org);
  
      const zeroShaRecord = {
        version: 'velnar-repository-ingestion-v1' as const,
        organizationId: org,
        repositoryId: 'repo-alpha',
        commitSha: '0'.repeat(40),
        snapshot,
      };
  
      const zeroShaIdentity = await hash('velnar-repository-ingestion-v1', zeroShaRecord);
      const record = {
        ...zeroShaRecord,
        ingestionIdentity: zeroShaIdentity,
      };
  
      await expect(validateRepositoryIngestion(record, org)).rejects.toThrow(
        'Git commit identity',
      );
    });
  
    it('fails closed during repository ingestion validation when ingestionIdentity is tampered', async () => {
      const snapshot = await captureSnapshot({
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-alpha',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: validAppSource }],
      }, org);
  
      const forgedRecord = {
        version: 'velnar-repository-ingestion-v1' as const,
        organizationId: org,
        repositoryId: 'repo-alpha',
        commitSha: 'b'.repeat(40),
        snapshot,
        ingestionIdentity: 'sha256:' + '0'.repeat(64),
      };
  
      await expect(validateRepositoryIngestion(forgedRecord, org)).rejects.toThrow(
        'ingestion identity mismatch',
      );
    });
  });
}
{
  // Historical contract source: 20260919-055024-chat4-V1_CHAT4_C8H_129_FA_LCLOSED
  const org = 'org_trust_boundary';
  
  
  const appSource = `import express from 'express';
  
  export function createApp(db: any) {
    function getUser(req: any, res: any) {
      const id = req.query.id;
      const stmt = db.prepare('SELECT * FROM users WHERE id = ' + id);
      const rows = stmt.all();
      res.json(rows);
    }
  
    const app = express();
    app.get('/users', getUser);
    return app;
  }
  `;
  
  
  async function createValidFixture(repoId = 'repo-fail-closed', fixtureId = 'm2-case-001') {
    const snapshot = await captureSnapshot(
      {
        fixtureId,
        repositoryId: repoId,
        organizationId: org,
        files: [
          {
            path: 'src/routes.ts',
            content: appSource,
          },
        ],
      },
      org,
    );
  
    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);
  
    return { snapshot, ingestion, analysis };
  }
  
  
  describe('Velnar Trust Boundary Fail-Closed Regressions', () => {
    it('fails closed when snapshot and express ingestion identities mismatch across analysis boundary', async () => {
      const fixtureA = await createValidFixture('repo-boundary-a', 'm2-case-001');
      const fixtureB = await createValidFixture('repo-boundary-b', 'm2-case-002');
  
      expect(fixtureA.snapshot.snapshotId).not.toBe(fixtureB.snapshot.snapshotId);
  
      await expect(
        detectSqlInjection(fixtureA.snapshot, fixtureB.ingestion, org),
      ).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
    });
  
    it('fails closed when forged or tampered analysis payload crosses validation boundary', async () => {
      const { snapshot, ingestion, analysis } = await createValidFixture();
  
      const tamperedAnalysis: Awaited<ReturnType<typeof detectSqlInjection>> = {
        ...analysis,
        status: 'NOT_DETECTED',
        findings: [],
      };
  
      await expect(
        validateSqlAnalysis(tamperedAnalysis, snapshot, ingestion, org),
      ).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
    });
  
    it('fails closed in candidate bridge when host verification produces malformed or zero commit sha', async () => {
      const { snapshot, ingestion, analysis } = await createValidFixture();
  
      const zeroShaBridge = createSqlCandidateBridge(async () => '0'.repeat(40));
      await expect(
        zeroShaBridge(analysis, snapshot, ingestion, org),
      ).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
  
      const invalidShaBridge = createSqlCandidateBridge(async () => 'not-a-valid-sha');
      await expect(
        invalidShaBridge(analysis, snapshot, ingestion, org),
      ).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
    });
  
    it('preserves non-authority invariant: candidate bridge yields candidate status, never verified authority', async () => {
      const { snapshot, ingestion, analysis } = await createValidFixture();
      const validSha = 'a'.repeat(40);
  
      const validBridge = createSqlCandidateBridge(async () => validSha);
      const hypotheses = await validBridge(analysis, snapshot, ingestion, org);
  
      expect(hypotheses.length).toBeGreaterThan(0);
      for (const hypothesis of hypotheses) {
        expect(hypothesis.candidate.verificationState).toBe('CANDIDATE');
        expect(hypothesis.candidate.verificationState).not.toBe('VERIFIED');
        expect(hypothesis.candidateBinding).toBeDefined();
        expect(typeof hypothesis.candidateBinding).toBe('string');
        expect(hypothesis.candidateBinding.length).toBeGreaterThan(0);
      }
    });
  
    it('fails closed on tenant and repository binding mismatches during repository ingestion validation', async () => {
      const { snapshot } = await createValidFixture();
      const commitSha = 'b'.repeat(40);
  
      const genuineRecord: RepositoryIngestion = {
        version: 'velnar-repository-ingestion-v1',
        organizationId: org,
        repositoryId: snapshot.repositoryId,
        commitSha,
        snapshot,
        ingestionIdentity: await hash('velnar-repository-ingestion-v1', {
          version: 'velnar-repository-ingestion-v1',
          organizationId: org,
          repositoryId: snapshot.repositoryId,
          commitSha,
          snapshot,
        }),
      };
  
      const validated = await validateRepositoryIngestion(genuineRecord, org);
      expect(validated.ingestionIdentity).toBe(genuineRecord.ingestionIdentity);
  
      await expect(
        validateRepositoryIngestion(genuineRecord, 'org_foreign_tenant'),
      ).rejects.toThrow('tenant mismatch');
  
      const mismatchedRepoRecord: RepositoryIngestion = {
        ...genuineRecord,
        repositoryId: 'repo-foreign-binding',
        ingestionIdentity: await hash('velnar-repository-ingestion-v1', {
          version: 'velnar-repository-ingestion-v1',
          organizationId: org,
          repositoryId: 'repo-foreign-binding',
          commitSha,
          snapshot,
        }),
      };
  
      await expect(
        validateRepositoryIngestion(mismatchedRepoRecord, org),
      ).rejects.toThrow('snapshot binding mismatch');
    });
  
    it('fails closed when unauthenticated capability object is presented for commit capability assertion', async () => {
      const { snapshot } = await createValidFixture();
      const genuineRecord: RepositoryIngestion = {
        version: 'velnar-repository-ingestion-v1',
        organizationId: org,
        repositoryId: snapshot.repositoryId,
        commitSha: 'c'.repeat(40),
        snapshot,
        ingestionIdentity: await hash('velnar-repository-ingestion-v1', {
          version: 'velnar-repository-ingestion-v1',
          organizationId: org,
          repositoryId: snapshot.repositoryId,
          commitSha: 'c'.repeat(40),
          snapshot,
        }),
      };
  
      const fakeCapability = Object.freeze({
        [Symbol.toStringTag]: 'TrustedCommitCapability' as const,
      });
  
      expect(isTrustedCommitCapability(fakeCapability, genuineRecord)).toBe(false);
      expect(() =>
        assertTrustedCommitCapability(fakeCapability, genuineRecord),
      ).toThrow('unauthorized commit capability');
    });
  });
}
{
  // Historical contract source: 20260919-063715-chat4-V1_CHAT4_C8H_154_FA_LCLOSED
  const org = 'org_failclosed';
  
  
  const expressSourceA = `import express from 'express';
  
  export function createApp(db: any) {
    const app = express();
    function handleQuery(req: any, res: any) {
      const query = req.query;
      const stmt = db.prepare('SELECT * FROM items WHERE id = ' + query.id);
      const rows = stmt.all();
      res.json(rows);
    }
    app.get('/items', handleQuery);
    return app;
  }
  `;
  
  
  const expressSourceB = `import express from 'express';
  
  export function createApp(db: any) {
    const app = express();
    function handleOther(req: any, res: any) {
      const query = req.query;
      const stmt = db.prepare('SELECT * FROM other WHERE id = ' + query.id);
      const rows = stmt.all();
      res.json(rows);
    }
    app.get('/other', handleOther);
    return app;
  }
  `;
  
  
  describe('Velnar trust boundary fail-closed regression', () => {
    it('fails closed when snapshot identity does not match Express ingestion snapshot identity', async () => {
      const snapshotA = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: 'repo-failclosed',
          organizationId: org,
          files: [{ path: 'src/app.ts', content: expressSourceA }],
        },
        org,
      );
  
      const snapshotB = await captureSnapshot(
        {
          fixtureId: 'm2-case-002',
          repositoryId: 'repo-failclosed',
          organizationId: org,
          files: [{ path: 'src/app.ts', content: expressSourceB }],
        },
        org,
      );
  
      const ingestionA = await ingestExpress(snapshotA, org);
      const ingestionB = await ingestExpress(snapshotB, org);
  
      expect(snapshotA.snapshotId).not.toBe(snapshotB.snapshotId);
  
      await expect(
        detectSqlInjection(snapshotA, ingestionB, org),
      ).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
  
      await expect(
        detectSqlInjection(snapshotA, ingestionA, 'foreign_org'),
      ).rejects.toThrow('tenant mismatch');
    });
  
    it('fails closed on forged analysis and invalid commit SHA at the candidate boundary', async () => {
      const snapshot = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: 'repo-failclosed',
          organizationId: org,
          files: [{ path: 'src/app.ts', content: expressSourceA }],
        },
        org,
      );
  
      const ingestion = await ingestExpress(snapshot, org);
      const analysis = await detectSqlInjection(snapshot, ingestion, org);
      expect(analysis.status).toBe('DETECTED');
      expect(analysis.findings.length).toBe(1);
  
      const forgedAnalysis = {
        ...analysis,
        status: 'NOT_DETECTED',
        findings: [],
      };
  
      await expect(
        validateSqlAnalysis(forgedAnalysis, snapshot, ingestion, org),
      ).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
  
      const zeroShaBridge = createSqlCandidateBridge(
        async () => '0000000000000000000000000000000000000000',
      );
      await expect(
        zeroShaBridge(analysis, snapshot, ingestion, org),
      ).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
  
      const validSha = 'a'.repeat(40);
      const validBridge = createSqlCandidateBridge(async () => validSha);
      const candidates = await validBridge(analysis, snapshot, ingestion, org);
      expect(candidates.length).toBe(1);
      expect(candidates[0].candidate.verificationState).toBe('CANDIDATE');
      expect(candidates[0].candidate.reachabilityState).toBe('REACHABLE');
    });
  
    it('fails closed on tenant mismatch, forged identity, and forged capability at the repository boundary', async () => {
      const snapshot = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: 'repo-failclosed',
          organizationId: org,
          files: [{ path: 'src/app.ts', content: expressSourceA }],
        },
        org,
      );
  
      const commitSha = 'b'.repeat(40);
      const body = {
        version: 'velnar-repository-ingestion-v1' as const,
        organizationId: org,
        repositoryId: 'repo-failclosed',
        commitSha,
        snapshot,
      };
      const ingestionIdentity = await hash('velnar-repository-ingestion-v1', body);
      const ingestion: RepositoryIngestion = {
        ...body,
        ingestionIdentity,
      };
  
      const validated = await validateRepositoryIngestion(ingestion, org);
      expect(validated.ingestionIdentity).toBe(ingestionIdentity);
  
      await expect(
        validateRepositoryIngestion(ingestion, 'foreign_org'),
      ).rejects.toThrow('tenant mismatch');
  
      const forgedIdentity = {
        ...ingestion,
        ingestionIdentity: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      };
      await expect(
        validateRepositoryIngestion(forgedIdentity, org),
      ).rejects.toThrow('ingestion identity mismatch');
  
      const forgedCapability = {
        [Symbol.toStringTag]: 'TrustedCommitCapability' as const,
      };
      expect(isTrustedCommitCapability(forgedCapability, validated)).toBe(false);
      expect(() =>
        assertTrustedCommitCapability(forgedCapability, validated),
      ).toThrow('unauthorized commit capability');
    });
  });
}
