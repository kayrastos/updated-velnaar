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
import type { RepositoryIngestion } from "../../worker/intelligence/ingestion/repository";
import { validateRepositoryIngestion } from "../../worker/intelligence/ingestion/repository";
import { captureSnapshot } from "../../worker/intelligence/ingestion/snapshot";
import { hash } from "../../worker/intelligence/ingestion/snapshot";
import type { SourceInput } from "../../worker/intelligence/ingestion/snapshot";
import type { SourceSnapshot } from "../../worker/intelligence/ingestion/snapshot";
import { validateSnapshot } from "../../worker/intelligence/ingestion/snapshot";
import { describe } from "vitest";
import { expect } from "vitest";
import { it } from "vitest";

{
  // Historical contract source: 20260919-012111-chat4-V1_CHAT4_C8H_007_TENANT_REPO_M_SMATCH
  const expressAppSource = `import express from 'express';
  
  function handler(req: any, res: any) {
  }
  
  export function createApp(db: any) {
    const app = express();
    app.get('/items', handler);
    return app;
  }
  `;
  
  
  describe('Velnar Trust Boundary - Tenant and Repository Mismatch Integration', () => {
    it('enforces organization and repository boundaries across ingestion and analysis APIs', async () => {
      const orgPrimary = 'org-primary';
      const orgForeign = 'org-foreign';
      const repoPrimary = 'repo-primary';
      const repoSecondary = 'repo-secondary';
  
      const snapshotPrimary = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: repoPrimary,
          organizationId: orgPrimary,
          files: [
            {
              path: 'src/app.ts',
              content: expressAppSource,
            },
          ],
        },
        orgPrimary,
      );
  
      const snapshotSecondary = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: repoSecondary,
          organizationId: orgPrimary,
          files: [
            {
              path: 'src/app.ts',
              content: expressAppSource,
            },
          ],
        },
        orgPrimary,
      );
  
      const snapshotForeign = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: repoPrimary,
          organizationId: orgForeign,
          files: [
            {
              path: 'src/app.ts',
              content: expressAppSource,
            },
          ],
        },
        orgForeign,
      );
  
      // 1. Snapshot ingestion rejects tenant mismatch
      await expect(
        captureSnapshot(
          {
            fixtureId: 'm2-case-001',
            repositoryId: repoPrimary,
            organizationId: orgPrimary,
            files: [
              {
                path: 'src/app.ts',
                content: expressAppSource,
              },
            ],
          },
          orgForeign,
        ),
      ).rejects.toThrow('tenant mismatch');
  
      await expect(
        validateSnapshot(snapshotPrimary, orgForeign),
      ).rejects.toThrow('tenant mismatch');
  
      // 2. Express ingestion rejects tenant mismatch
      const expressPrimary = await ingestExpress(snapshotPrimary, orgPrimary);
      expect(expressPrimary.snapshot.snapshotId).toBe(snapshotPrimary.snapshotId);
  
      await expect(
        ingestExpress(snapshotPrimary, orgForeign),
      ).rejects.toThrow('tenant mismatch');
  
      await expect(
        validateExpressIngestion(expressPrimary, orgForeign),
      ).rejects.toThrow('tenant mismatch');
  
      // 3. Repository ingestion validation rejects tenant and repository mismatch
      const commitSha = 'a'.repeat(40);
      const validRepoBody = {
        version: 'velnar-repository-ingestion-v1' as const,
        organizationId: orgPrimary,
        repositoryId: repoPrimary,
        commitSha,
        snapshot: snapshotPrimary,
      };
      const validRepoIdentity = await hash('velnar-repository-ingestion-v1', validRepoBody);
      const validRepoRecord = { ...validRepoBody, ingestionIdentity: validRepoIdentity };
  
      const validatedRecord = await validateRepositoryIngestion(validRepoRecord, orgPrimary);
      expect(validatedRecord.organizationId).toBe(orgPrimary);
      expect(validatedRecord.repositoryId).toBe(repoPrimary);
  
      await expect(
        validateRepositoryIngestion(validRepoRecord, orgForeign),
      ).rejects.toThrow('tenant mismatch');
  
      const mismatchedRepoBody = {
        version: 'velnar-repository-ingestion-v1' as const,
        organizationId: orgPrimary,
        repositoryId: repoSecondary,
        commitSha,
        snapshot: snapshotPrimary,
      };
      const mismatchedRepoIdentity = await hash('velnar-repository-ingestion-v1', mismatchedRepoBody);
      const mismatchedRepoRecord = { ...mismatchedRepoBody, ingestionIdentity: mismatchedRepoIdentity };
  
      await expect(
        validateRepositoryIngestion(mismatchedRepoRecord, orgPrimary),
      ).rejects.toThrow('snapshot binding mismatch');
  
      const crossTenantRepoBody = {
        version: 'velnar-repository-ingestion-v1' as const,
        organizationId: orgPrimary,
        repositoryId: repoPrimary,
        commitSha,
        snapshot: snapshotForeign,
      };
      const crossTenantRepoIdentity = await hash('velnar-repository-ingestion-v1', crossTenantRepoBody);
      const crossTenantRepoRecord = { ...crossTenantRepoBody, ingestionIdentity: crossTenantRepoIdentity };
  
      await expect(
        validateRepositoryIngestion(crossTenantRepoRecord, orgPrimary),
      ).rejects.toThrow('tenant mismatch');
  
      // 4. SQL injection analysis rejects tenant and repository mismatch
      await expect(
        detectSqlInjection(snapshotPrimary, expressPrimary, orgForeign),
      ).rejects.toThrow('tenant mismatch');
  
      await expect(
        detectSqlInjection(snapshotSecondary, expressPrimary, orgPrimary),
      ).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
  
      const analysis = await detectSqlInjection(snapshotPrimary, expressPrimary, orgPrimary);
      expect(analysis.status).toBe('NOT_DETECTED');
      expect(analysis.organizationId).toBe(orgPrimary);
      expect(analysis.repositoryId).toBe(repoPrimary);
  
      await expect(
        validateSqlAnalysis(analysis, snapshotPrimary, expressPrimary, orgForeign),
      ).rejects.toThrow('tenant mismatch');
  
      await expect(
        validateSqlAnalysis(analysis, snapshotSecondary, expressPrimary, orgPrimary),
      ).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
  
      const tamperedAnalysis = {
        ...analysis,
        repositoryId: repoSecondary,
      };
      await expect(
        validateSqlAnalysis(tamperedAnalysis, snapshotPrimary, expressPrimary, orgPrimary),
      ).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
    });
  });
}
{
  // Historical contract source: 20260919-030218-chat4-V1_CHAT4_C8H_057_TENANT_REPO_M_SMATCH
  const sampleFiles: readonly SourceInput[] = [
    {
      path: 'src/app.ts',
      content: [
        "import express from 'express';",
        '',
        'export function createApp(db: any) {',
        '  const app = express();',
        '  function getItems(req: any, res: any) {',
        '    const query = req.query.id;',
        "    const stmt = db.prepare('SELECT * FROM items WHERE id = ' + query);",
        '    const rows = stmt.all();',
        '    res.json(rows);',
        '  }',
        "  app.get('/items', getItems);",
        '  return app;',
        '}',
        '',
      ].join('\n'),
    },
  ];
  
  
  describe('Velnar Trust Boundary: Tenant and Repository Mismatch Regressions', () => {
    const orgA = 'org_velnar_a';
    const orgB = 'org_velnar_b';
    const repoA = 'repo-alpha';
    const repoB = 'repo-beta';
    const fixtureId = 'm2-case-001';
  
    it('rejects organization tenant mismatch during snapshot capture and validation', async () => {
      await expect(
        captureSnapshot(
          {
            fixtureId,
            repositoryId: repoA,
            organizationId: orgA,
            files: sampleFiles,
          },
          orgB,
        ),
      ).rejects.toThrow('tenant mismatch');
  
      const genuineSnapshot = await captureSnapshot(
        {
          fixtureId,
          repositoryId: repoA,
          organizationId: orgA,
          files: sampleFiles,
        },
        orgA,
      );
  
      await expect(validateSnapshot(genuineSnapshot, orgB)).rejects.toThrow('tenant mismatch');
    });
  
    it('rejects foreign tenant during Express ingestion and validation', async () => {
      const genuineSnapshot = await captureSnapshot(
        {
          fixtureId,
          repositoryId: repoA,
          organizationId: orgA,
          files: sampleFiles,
        },
        orgA,
      );
  
      await expect(ingestExpress(genuineSnapshot, orgB)).rejects.toThrow('tenant mismatch');
  
      const genuineIngestion = await ingestExpress(genuineSnapshot, orgA);
      await expect(validateExpressIngestion(genuineIngestion, orgB)).rejects.toThrow('tenant mismatch');
    });
  
    it('rejects organization and repository mismatches in repository ingestion records', async () => {
      const snapshotA = await captureSnapshot(
        {
          fixtureId,
          repositoryId: repoA,
          organizationId: orgA,
          files: sampleFiles,
        },
        orgA,
      );
  
      const snapshotRepoB = await captureSnapshot(
        {
          fixtureId,
          repositoryId: repoB,
          organizationId: orgA,
          files: sampleFiles,
        },
        orgA,
      );
  
      const snapshotOrgB = await captureSnapshot(
        {
          fixtureId,
          repositoryId: repoA,
          organizationId: orgB,
          files: sampleFiles,
        },
        orgB,
      );
  
      const genuineRecordBody = {
        version: 'velnar-repository-ingestion-v1' as const,
        organizationId: orgA,
        repositoryId: repoA,
        commitSha: 'a'.repeat(40),
        snapshot: snapshotA,
      };
      const genuineRecord = {
        ...genuineRecordBody,
        ingestionIdentity: await hash('velnar-repository-ingestion-v1', genuineRecordBody),
      };
  
      const validated = await validateRepositoryIngestion(genuineRecord, orgA);
      expect(validated.organizationId).toBe(orgA);
      expect(validated.repositoryId).toBe(repoA);
  
      await expect(validateRepositoryIngestion(genuineRecord, orgB)).rejects.toThrow('tenant mismatch');
  
      const mismatchedRepoBody = {
        version: 'velnar-repository-ingestion-v1' as const,
        organizationId: orgA,
        repositoryId: repoA,
        commitSha: 'a'.repeat(40),
        snapshot: snapshotRepoB,
      };
      const mismatchedRepoRecord = {
        ...mismatchedRepoBody,
        ingestionIdentity: await hash('velnar-repository-ingestion-v1', mismatchedRepoBody),
      };
      await expect(validateRepositoryIngestion(mismatchedRepoRecord, orgA)).rejects.toThrow(
        'snapshot binding mismatch',
      );
  
      const mismatchedOrgBody = {
        version: 'velnar-repository-ingestion-v1' as const,
        organizationId: orgA,
        repositoryId: repoA,
        commitSha: 'a'.repeat(40),
        snapshot: snapshotOrgB,
      };
      const mismatchedOrgRecord = {
        ...mismatchedOrgBody,
        ingestionIdentity: await hash('velnar-repository-ingestion-v1', mismatchedOrgBody),
      };
      await expect(validateRepositoryIngestion(mismatchedOrgRecord, orgA)).rejects.toThrow('tenant mismatch');
    });
  
    it('enforces tenant and repository matching across SQL analysis and validation', async () => {
      const snapshotA = await captureSnapshot(
        {
          fixtureId,
          repositoryId: repoA,
          organizationId: orgA,
          files: sampleFiles,
        },
        orgA,
      );
  
      const snapshotRepoB = await captureSnapshot(
        {
          fixtureId,
          repositoryId: repoB,
          organizationId: orgA,
          files: sampleFiles,
        },
        orgA,
      );
  
      const expressA = await ingestExpress(snapshotA, orgA);
      const expressRepoB = await ingestExpress(snapshotRepoB, orgA);
  
      await expect(detectSqlInjection(snapshotA, expressA, orgB)).rejects.toThrow('tenant mismatch');
  
      await expect(detectSqlInjection(snapshotA, expressRepoB, orgA)).rejects.toThrow(
        'M3_ANALYSIS_SNAPSHOT_MISMATCH',
      );
  
      const analysisA = await detectSqlInjection(snapshotA, expressA, orgA);
      expect(analysisA.status).toBe('DETECTED');
      expect(analysisA.organizationId).toBe(orgA);
      expect(analysisA.repositoryId).toBe(repoA);
  
      await expect(validateSqlAnalysis(analysisA, snapshotA, expressA, orgB)).rejects.toThrow();
  
      const tamperedAnalysis = {
        ...analysisA,
        repositoryId: repoB,
      };
      await expect(validateSqlAnalysis(tamperedAnalysis, snapshotA, expressA, orgA)).rejects.toThrow(
        'M3_ANALYSIS_INTEGRITY_MISMATCH',
      );
    });
  
    it('preserves tenant boundary and non-authoritative status across candidate bridge', async () => {
      const snapshotA = await captureSnapshot(
        {
          fixtureId,
          repositoryId: repoA,
          organizationId: orgA,
          files: sampleFiles,
        },
        orgA,
      );
  
      const snapshotRepoB = await captureSnapshot(
        {
          fixtureId,
          repositoryId: repoB,
          organizationId: orgA,
          files: sampleFiles,
        },
        orgA,
      );
  
      const expressA = await ingestExpress(snapshotA, orgA);
      const expressRepoB = await ingestExpress(snapshotRepoB, orgA);
      const analysisA = await detectSqlInjection(snapshotA, expressA, orgA);
  
      const bridge = createSqlCandidateBridge(async () => 'b'.repeat(40));
  
      await expect(bridge(analysisA, snapshotA, expressA, orgB)).rejects.toThrow('tenant mismatch');
  
      await expect(bridge(analysisA, snapshotA, expressRepoB, orgA)).rejects.toThrow(
        'M3_ANALYSIS_SNAPSHOT_MISMATCH',
      );
  
      const hypotheses = await bridge(analysisA, snapshotA, expressA, orgA);
      expect(hypotheses.length).toBe(1);
  
      const hypothesis = hypotheses[0];
      expect(hypothesis.candidate.organizationId).toBe(orgA);
      expect(hypothesis.candidate.snapshot.organizationId).toBe(orgA);
      expect(hypothesis.candidate.snapshot.repositoryId).toBe(repoA);
      expect(hypothesis.candidate.verificationState).toBe('CANDIDATE');
      expect((hypothesis.candidate as any).verificationState).not.toBe('VERIFIED');
    });
  });
}
{
  // Historical contract source: 20260919-035131-chat4-V1_CHAT4_C8H_083_TENANT_REPO_M_SMATCH
  const expressFixtureSource = `import express from 'express';
  
  function handleHealth(req: any, res: any) {
    return;
  }
  
  export function createApp(db: any) {
    const app = express();
    app.get('/health', handleHealth);
    return app;
  }
  `;
  
  
  describe('Velnar Trust Boundary: Tenant and Repository Mismatch Regression', () => {
    const orgA = 'org_tenant_alpha';
    const orgB = 'org_tenant_beta';
    const repoA = 'repo-service-alpha';
    const repoB = 'repo-service-beta';
  
    it('rejects foreign tenant during snapshot capture and validation', async () => {
      const inputA = {
        fixtureId: 'm2-case-001',
        repositoryId: repoA,
        organizationId: orgA,
        files: [{ path: 'src/index.ts', content: expressFixtureSource }],
      };
  
      await expect(captureSnapshot(inputA, orgB)).rejects.toThrow('tenant mismatch');
  
      const snapshotA = await captureSnapshot(inputA, orgA);
      expect(snapshotA.organizationId).toBe(orgA);
      expect(snapshotA.repositoryId).toBe(repoA);
  
      await expect(validateSnapshot(snapshotA, orgB)).rejects.toThrow('tenant mismatch');
      const validated = await validateSnapshot(snapshotA, orgA);
      expect(validated.snapshotId).toBe(snapshotA.snapshotId);
    });
  
    it('rejects foreign tenant during Express ingestion and validation', async () => {
      const snapshotA = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: repoA,
          organizationId: orgA,
          files: [{ path: 'src/index.ts', content: expressFixtureSource }],
        },
        orgA,
      );
  
      await expect(ingestExpress(snapshotA, orgB)).rejects.toThrow('tenant mismatch');
  
      const expressIngestionA = await ingestExpress(snapshotA, orgA);
      expect(expressIngestionA.routes).toHaveLength(1);
  
      await expect(validateExpressIngestion(expressIngestionA, orgB)).rejects.toThrow('tenant mismatch');
      const validated = await validateExpressIngestion(expressIngestionA, orgA);
      expect(validated.ingestionIdentity).toBe(expressIngestionA.ingestionIdentity);
    });
  
    it('rejects tenant mismatch and repository binding mismatch during repository ingestion validation', async () => {
      const snapshotA = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: repoA,
          organizationId: orgA,
          files: [{ path: 'src/index.ts', content: expressFixtureSource }],
        },
        orgA,
      );
  
      const rawRecordA = {
        version: 'velnar-repository-ingestion-v1' as const,
        organizationId: orgA,
        repositoryId: repoA,
        commitSha: 'a'.repeat(40),
        snapshot: snapshotA,
      };
      const identityA = await hash('velnar-repository-ingestion-v1', rawRecordA);
      const validRepoIngestionA = {
        ...rawRecordA,
        ingestionIdentity: identityA,
      };
  
      await expect(validateRepositoryIngestion(validRepoIngestionA, orgB)).rejects.toThrow('tenant mismatch');
  
      const validatedA = await validateRepositoryIngestion(validRepoIngestionA, orgA);
      expect(validatedA.ingestionIdentity).toBe(identityA);
  
      const mismatchedRepoRecord = {
        version: 'velnar-repository-ingestion-v1' as const,
        organizationId: orgA,
        repositoryId: repoB,
        commitSha: 'a'.repeat(40),
        snapshot: snapshotA,
      };
      const mismatchedRepoIdentity = await hash('velnar-repository-ingestion-v1', mismatchedRepoRecord);
      await expect(
        validateRepositoryIngestion(
          { ...mismatchedRepoRecord, ingestionIdentity: mismatchedRepoIdentity },
          orgA,
        ),
      ).rejects.toThrow('snapshot binding mismatch');
  
      const mismatchedOrgRecord = {
        version: 'velnar-repository-ingestion-v1' as const,
        organizationId: orgB,
        repositoryId: repoA,
        commitSha: 'a'.repeat(40),
        snapshot: snapshotA,
      };
      const mismatchedOrgIdentity = await hash('velnar-repository-ingestion-v1', mismatchedOrgRecord);
      await expect(
        validateRepositoryIngestion(
          { ...mismatchedOrgRecord, ingestionIdentity: mismatchedOrgIdentity },
          orgB,
        ),
      ).rejects.toThrow('tenant mismatch');
    });
  
    it('rejects tenant and repository mismatches across detection and candidate bridge APIs', async () => {
      const snapshotA = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: repoA,
          organizationId: orgA,
          files: [{ path: 'src/index.ts', content: expressFixtureSource }],
        },
        orgA,
      );
      const snapshotB = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: repoB,
          organizationId: orgA,
          files: [{ path: 'src/index.ts', content: expressFixtureSource }],
        },
        orgA,
      );
  
      const expressIngestionA = await ingestExpress(snapshotA, orgA);
      const expressIngestionB = await ingestExpress(snapshotB, orgA);
  
      await expect(detectSqlInjection(snapshotA, expressIngestionA, orgB)).rejects.toThrow('tenant mismatch');
  
      await expect(detectSqlInjection(snapshotA, expressIngestionB, orgA)).rejects.toThrow(
        'M3_ANALYSIS_SNAPSHOT_MISMATCH',
      );
      await expect(detectSqlInjection(snapshotB, expressIngestionA, orgA)).rejects.toThrow(
        'M3_ANALYSIS_SNAPSHOT_MISMATCH',
      );
  
      const analysisA = await detectSqlInjection(snapshotA, expressIngestionA, orgA);
      expect(analysisA.status).toBe('NOT_DETECTED');
  
      await expect(validateSqlAnalysis(analysisA, snapshotA, expressIngestionA, orgB)).rejects.toThrow(
        'tenant mismatch',
      );
      await expect(validateSqlAnalysis(analysisA, snapshotA, expressIngestionB, orgA)).rejects.toThrow(
        'M3_ANALYSIS_SNAPSHOT_MISMATCH',
      );
  
      const bridge = createSqlCandidateBridge(async () => 'b'.repeat(40));
  
      await expect(bridge(analysisA, snapshotA, expressIngestionA, orgB)).rejects.toThrow('tenant mismatch');
      await expect(bridge(analysisA, snapshotA, expressIngestionB, orgA)).rejects.toThrow(
        'M3_ANALYSIS_SNAPSHOT_MISMATCH',
      );
    });
  
    it('refuses unverified capability assertion and preserves non-authoritative boundary', async () => {
      const snapshotA = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: repoA,
          organizationId: orgA,
          files: [{ path: 'src/index.ts', content: expressFixtureSource }],
        },
        orgA,
      );
      const rawRecordA = {
        version: 'velnar-repository-ingestion-v1' as const,
        organizationId: orgA,
        repositoryId: repoA,
        commitSha: 'c'.repeat(40),
        snapshot: snapshotA,
      };
      const identityA = await hash('velnar-repository-ingestion-v1', rawRecordA);
      const validatedA = await validateRepositoryIngestion(
        { ...rawRecordA, ingestionIdentity: identityA },
        orgA,
      );
  
      expect(isTrustedCommitCapability({}, validatedA)).toBe(false);
      expect(
        isTrustedCommitCapability(
          { [Symbol.toStringTag]: 'TrustedCommitCapability' },
          validatedA,
        ),
      ).toBe(false);
  
      expect(() => assertTrustedCommitCapability({}, validatedA)).toThrow('unauthorized commit capability');
      expect((validatedA as any).capability).toBeUndefined();
    });
  });
}
{
  // Historical contract source: 20260919-062027-chat4-V1_CHAT4_C8H_145_TENANT_REPO_M_SMATCH
  const sampleFiles = [
    {
      path: 'src/app.ts',
      content: `import express from 'express';
  
  export function createApp(db: any) {
    const app = express();
    function getUser(req: any, res: any) {
      const id = req.query.id;
      const stmt = db.prepare('SELECT * FROM users WHERE id = ' + id);
      const rows = stmt.all();
      return res.json(rows);
    }
    app.get('/users', getUser);
    return app;
  }
  `,
    },
  ];
  
  
  describe('Velnar Trust Boundary: Tenant and Repository Mismatch Integration Regression', () => {
    const primaryOrg = 'org_primary';
    const foreignOrg = 'org_foreign';
    const repoA = 'repo-alpha';
    const repoB = 'repo-beta';
  
    it('rejects foreign organization during snapshot capture and validation', async () => {
      const snapshotA = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: repoA,
          organizationId: primaryOrg,
          files: sampleFiles,
        },
        primaryOrg,
      );
  
      expect(snapshotA.organizationId).toBe(primaryOrg);
      expect(snapshotA.repositoryId).toBe(repoA);
  
      await expect(
        captureSnapshot(
          {
            fixtureId: 'm2-case-001',
            repositoryId: repoA,
            organizationId: primaryOrg,
            files: sampleFiles,
          },
          foreignOrg,
        ),
      ).rejects.toThrow('tenant mismatch');
  
      await expect(
        validateSnapshot(snapshotA, foreignOrg),
      ).rejects.toThrow('tenant mismatch');
    });
  
    it('rejects foreign organization during Express ingestion and validation', async () => {
      const snapshotA = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: repoA,
          organizationId: primaryOrg,
          files: sampleFiles,
        },
        primaryOrg,
      );
  
      const ingestionA = await ingestExpress(snapshotA, primaryOrg);
      expect(ingestionA.snapshot.organizationId).toBe(primaryOrg);
      expect(ingestionA.snapshot.repositoryId).toBe(repoA);
  
      await expect(
        ingestExpress(snapshotA, foreignOrg),
      ).rejects.toThrow('tenant mismatch');
  
      await expect(
        validateExpressIngestion(ingestionA, foreignOrg),
      ).rejects.toThrow('tenant mismatch');
    });
  
    it('rejects cross-repository snapshot mismatch and foreign tenant in SQL detection', async () => {
      const snapshotA = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: repoA,
          organizationId: primaryOrg,
          files: sampleFiles,
        },
        primaryOrg,
      );
  
      const snapshotB = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: repoB,
          organizationId: primaryOrg,
          files: sampleFiles,
        },
        primaryOrg,
      );
  
      const ingestionA = await ingestExpress(snapshotA, primaryOrg);
      const analysisA = await detectSqlInjection(snapshotA, ingestionA, primaryOrg);
  
      expect(analysisA.status).toBe('DETECTED');
      expect(analysisA.organizationId).toBe(primaryOrg);
      expect(analysisA.repositoryId).toBe(repoA);
  
      await expect(
        detectSqlInjection(snapshotA, ingestionA, foreignOrg),
      ).rejects.toThrow('tenant mismatch');
  
      await expect(
        detectSqlInjection(snapshotB, ingestionA, primaryOrg),
      ).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
  
      await expect(
        validateSqlAnalysis(analysisA, snapshotA, ingestionA, foreignOrg),
      ).rejects.toThrow('tenant mismatch');
  
      await expect(
        validateSqlAnalysis(analysisA, snapshotB, ingestionA, primaryOrg),
      ).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
    });
  
    it('enforces tenant boundary and non-authoritative candidate state in candidate bridge', async () => {
      const snapshotA = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: repoA,
          organizationId: primaryOrg,
          files: sampleFiles,
        },
        primaryOrg,
      );
  
      const snapshotB = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: repoB,
          organizationId: primaryOrg,
          files: sampleFiles,
        },
        primaryOrg,
      );
  
      const ingestionA = await ingestExpress(snapshotA, primaryOrg);
      const analysisA = await detectSqlInjection(snapshotA, ingestionA, primaryOrg);
  
      const mockCommitSha = 'a'.repeat(40);
      const bridge = createSqlCandidateBridge(async () => mockCommitSha);
  
      await expect(
        bridge(analysisA, snapshotA, ingestionA, foreignOrg),
      ).rejects.toThrow('tenant mismatch');
  
      await expect(
        bridge(analysisA, snapshotB, ingestionA, primaryOrg),
      ).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
  
      const candidates = await bridge(analysisA, snapshotA, ingestionA, primaryOrg);
      expect(candidates.length).toBeGreaterThan(0);
      for (const item of candidates) {
        expect(item.candidate.organizationId).toBe(primaryOrg);
        expect(item.candidate.snapshot.organizationId).toBe(primaryOrg);
        expect(item.candidate.snapshot.repositoryId).toBe(repoA);
        expect(item.candidate.verificationState).toBe('CANDIDATE');
      }
    });
  
    it('rejects organization mismatch and repository binding mismatch in repository ingestion records', async () => {
      const snapshotA = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: repoA,
          organizationId: primaryOrg,
          files: sampleFiles,
        },
        primaryOrg,
      );
  
      const commitSha = 'c'.repeat(40);
      const genuineBody = {
        version: 'velnar-repository-ingestion-v1' as const,
        organizationId: primaryOrg,
        repositoryId: repoA,
        commitSha,
        snapshot: snapshotA,
      };
  
      const genuineIdentity = await hash('velnar-repository-ingestion-v1', genuineBody);
      const genuineRecord = {
        ...genuineBody,
        ingestionIdentity: genuineIdentity,
      };
  
      const validated = await validateRepositoryIngestion(genuineRecord, primaryOrg);
      expect(validated.organizationId).toBe(primaryOrg);
      expect(validated.repositoryId).toBe(repoA);
  
      await expect(
        validateRepositoryIngestion(genuineRecord, foreignOrg),
      ).rejects.toThrow('tenant mismatch');
  
      const mismatchedRepoBody = {
        version: 'velnar-repository-ingestion-v1' as const,
        organizationId: primaryOrg,
        repositoryId: repoB,
        commitSha,
        snapshot: snapshotA,
      };
  
      const mismatchedRepoIdentity = await hash('velnar-repository-ingestion-v1', mismatchedRepoBody);
      const mismatchedRepoRecord = {
        ...mismatchedRepoBody,
        ingestionIdentity: mismatchedRepoIdentity,
      };
  
      await expect(
        validateRepositoryIngestion(mismatchedRepoRecord, primaryOrg),
      ).rejects.toThrow('snapshot binding mismatch');
    });
  });
}
{
  // Historical contract source: 20260919-183345-chat4-V1_CHAT4_E1_C8H_100251_TENANT_REPO_MISMATCH
  const SAMPLE_EXPRESS_SOURCE = `
  import express from 'express';
  
  export function createApp(db: any) {
    const app = express();
    function searchHandler(req: any, res: any) {
      const term = req.query.q;
      const stmt = db.prepare('SELECT * FROM items WHERE name = ' + term);
      const rows = stmt.all();
      res.json(rows);
    }
    app.get('/search', searchHandler);
    return app;
  }
  `;
  
  
  async function buildRepositoryIngestionRecord(
    snapshot: SourceSnapshot,
    organizationId: string,
    repositoryId: string,
    commitSha = 'a'.repeat(40),
  ): Promise<RepositoryIngestion> {
    const body = {
      version: 'velnar-repository-ingestion-v1' as const,
      organizationId,
      repositoryId,
      commitSha,
      snapshot,
    };
    const ingestionIdentity = await hash('velnar-repository-ingestion-v1', body);
    return {
      ...body,
      ingestionIdentity,
    };
  }
  
  
  describe('Velnar Trust Boundary: Tenant and Repository Mismatch Isolation', () => {
    const primaryOrg = 'org_tenant_primary';
    const foreignOrg = 'org_tenant_foreign';
    const primaryRepo = 'repo-primary';
    const foreignRepo = 'repo-foreign';
    const fixtureFiles = [{ path: 'src/app.ts', content: SAMPLE_EXPRESS_SOURCE }];
  
    it('rejects foreign tenant during snapshot capture and enforces identifier boundaries', async () => {
      await expect(
        captureSnapshot(
          {
            fixtureId: 'm2-case-001',
            repositoryId: primaryRepo,
            organizationId: primaryOrg,
            files: fixtureFiles,
          },
          foreignOrg,
        ),
      ).rejects.toThrow('tenant mismatch');
  
      await expect(
        captureSnapshot(
          {
            fixtureId: 'm2-case-001',
            repositoryId: primaryRepo,
            organizationId: '../hostile/traversal',
            files: fixtureFiles,
          },
          primaryOrg,
        ),
      ).rejects.toThrow('identifier');
    });
  
    it('rejects foreign tenant during snapshot validation', async () => {
      const genuineSnapshot = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: primaryRepo,
          organizationId: primaryOrg,
          files: fixtureFiles,
        },
        primaryOrg,
      );
  
      await expect(validateSnapshot(genuineSnapshot, foreignOrg)).rejects.toThrow('tenant mismatch');
      const validated = await validateSnapshot(genuineSnapshot, primaryOrg);
      expect(validated.snapshotId).toBe(genuineSnapshot.snapshotId);
    });
  
    it('rejects foreign tenant across Express ingestion and ingestion validation boundaries', async () => {
      const genuineSnapshot = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: primaryRepo,
          organizationId: primaryOrg,
          files: fixtureFiles,
        },
        primaryOrg,
      );
  
      await expect(ingestExpress(genuineSnapshot, foreignOrg)).rejects.toThrow('tenant mismatch');
  
      const expressIngestion = await ingestExpress(genuineSnapshot, primaryOrg);
      expect(expressIngestion.routes.length).toBe(1);
  
      await expect(validateExpressIngestion(expressIngestion, foreignOrg)).rejects.toThrow('tenant mismatch');
      const validated = await validateExpressIngestion(expressIngestion, primaryOrg);
      expect(validated.ingestionIdentity).toBe(expressIngestion.ingestionIdentity);
    });
  
    it('rejects foreign tenant during repository ingestion validation', async () => {
      const genuineSnapshot = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: primaryRepo,
          organizationId: primaryOrg,
          files: fixtureFiles,
        },
        primaryOrg,
      );
  
      const record = await buildRepositoryIngestionRecord(genuineSnapshot, primaryOrg, primaryRepo);
  
      await expect(validateRepositoryIngestion(record, foreignOrg)).rejects.toThrow('tenant mismatch');
      const validated = await validateRepositoryIngestion(record, primaryOrg);
      expect(validated.organizationId).toBe(primaryOrg);
      expect(validated.repositoryId).toBe(primaryRepo);
    });
  
    it('rejects repository binding mismatches between record header and snapshot payload', async () => {
      const genuineSnapshot = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: primaryRepo,
          organizationId: primaryOrg,
          files: fixtureFiles,
        },
        primaryOrg,
      );
  
      const mismatchedRepoRecord = await buildRepositoryIngestionRecord(
        genuineSnapshot,
        primaryOrg,
        foreignRepo,
      );
  
      await expect(validateRepositoryIngestion(mismatchedRepoRecord, primaryOrg)).rejects.toThrow(
        'snapshot binding mismatch',
      );
    });
  
    it('rejects tampered ingestion identity in repository ingestion record', async () => {
      const genuineSnapshot = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: primaryRepo,
          organizationId: primaryOrg,
          files: fixtureFiles,
        },
        primaryOrg,
      );
  
      const record = await buildRepositoryIngestionRecord(genuineSnapshot, primaryOrg, primaryRepo);
      const tampered = {
        ...record,
        ingestionIdentity: 'sha256:' + 'f'.repeat(64),
      };
  
      await expect(validateRepositoryIngestion(tampered, primaryOrg)).rejects.toThrow(
        'ingestion identity mismatch',
      );
    });
  
    it('fails closed when snapshot and express ingestion have mismatched identities or repositories during detection', async () => {
      const snapshotA = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: primaryRepo,
          organizationId: primaryOrg,
          files: fixtureFiles,
        },
        primaryOrg,
      );
  
      const snapshotB = await captureSnapshot(
        {
          fixtureId: 'm2-case-002',
          repositoryId: foreignRepo,
          organizationId: primaryOrg,
          files: fixtureFiles,
        },
        primaryOrg,
      );
  
      const ingestionB = await ingestExpress(snapshotB, primaryOrg);
  
      await expect(detectSqlInjection(snapshotA, ingestionB, primaryOrg)).rejects.toThrow(
        'M3_ANALYSIS_SNAPSHOT_MISMATCH',
      );
  
      const ingestionA = await ingestExpress(snapshotA, primaryOrg);
      await expect(detectSqlInjection(snapshotA, ingestionA, foreignOrg)).rejects.toThrow('tenant mismatch');
  
      const analysis = await detectSqlInjection(snapshotA, ingestionA, primaryOrg);
      expect(analysis.status).toBe('DETECTED');
      expect(analysis.findings.length).toBe(1);
    });
  
    it('enforces tenant boundary on candidate bridge and maintains non-authoritative candidate state', async () => {
      const snapshot = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: primaryRepo,
          organizationId: primaryOrg,
          files: fixtureFiles,
        },
        primaryOrg,
      );
  
      const ingestion = await ingestExpress(snapshot, primaryOrg);
      const analysis = await detectSqlInjection(snapshot, ingestion, primaryOrg);
      expect(analysis.status).toBe('DETECTED');
  
      const checkedSha = 'c'.repeat(40);
      const bridge = createSqlCandidateBridge(async () => checkedSha);
  
      await expect(bridge(analysis, snapshot, ingestion, foreignOrg)).rejects.toThrow('tenant mismatch');
  
      const hypotheses = await bridge(analysis, snapshot, ingestion, primaryOrg);
      expect(hypotheses.length).toBe(1);
  
      const item = hypotheses[0];
      expect(item.candidate.verificationState).toBe('CANDIDATE');
      expect(item.candidate.reachabilityState).toBe('REACHABLE');
      expect(item.candidate.organizationId).toBe(primaryOrg);
      expect(item.candidate.snapshot.organizationId).toBe(primaryOrg);
      expect(item.candidate.snapshot.repositoryId).toBe(primaryRepo);
      expect(item.candidate.snapshot.commitSha).toBe(checkedSha);
      expect(item.candidateBinding).toBeDefined();
  
      expect((item.candidate as any).verificationState).not.toBe('VERIFIED');
    });
  
    it('refuses unauthorized capability objects and enforces capability binding isolation', async () => {
      const snapshot = await captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: primaryRepo,
          organizationId: primaryOrg,
          files: fixtureFiles,
        },
        primaryOrg,
      );
  
      const record = await buildRepositoryIngestionRecord(snapshot, primaryOrg, primaryRepo);
  
      expect(isTrustedCommitCapability({}, record)).toBe(false);
      expect(
        isTrustedCommitCapability(
          { [Symbol.toStringTag]: 'TrustedCommitCapability' },
          record,
        ),
      ).toBe(false);
  
      expect(() => assertTrustedCommitCapability({}, record)).toThrow('unauthorized commit capability');
      expect(() =>
        assertTrustedCommitCapability(
          { [Symbol.toStringTag]: 'TrustedCommitCapability' },
          record,
        ),
      ).toThrow('unauthorized commit capability');
    });
  });
}
