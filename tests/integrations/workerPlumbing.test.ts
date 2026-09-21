import { describe, it, expect } from 'vitest';
import {
  captureSnapshot,
  validateSnapshot,
  detachJson,
  hash,
  type SourceSnapshot,
  type SourceInput,
} from '../../worker/intelligence/ingestion/snapshot';
import {
  ingestExpress,
  validateExpressIngestion,
  type ExpressIngestion,
} from '../../worker/intelligence/ingestion/express';
import {
  detectSqlInjection,
  validateSqlAnalysis,
} from '../../worker/intelligence/detection/sqlInjection';
import {
  validateRepositoryIngestion,
  isTrustedCommitCapability,
} from '../../worker/intelligence/ingestion/repository';
import {
  createSqlCandidateBridge,
  type CandidateHypothesis,
} from '../../worker/intelligence/detection/candidate';

describe('Worker Plumbing IPC Payload Verification', () => {
  const org = 'org_worker_plumbing';
  const repo = 'repo_worker_plumbing';
  const fixtureId = 'm2-case-001';

  const sampleFiles: readonly SourceInput[] = Object.freeze([
    {
      path: 'src/routes.ts',
      content: [
        "import express from 'express';",
        '',
        'export function createApp(db: any) {',
        '  const app = express();',
        '  function getItems(req: any, res: any) {',
        '    const query = req.query.id;',
        "    const stmt = db.prepare('SELECT * FROM items WHERE id = ' + query);",
        '    const rows = stmt.all();',
        '    return res.json(rows);',
        '  }',
        "  app.get('/items', getItems);",
        '  return app;',
        '}',
        '',
      ].join('\n'),
    },
  ]);

  async function buildBaselineIngestions(): Promise<{
    snapshot: SourceSnapshot;
    expressIngestion: ExpressIngestion;
  }> {
    const snapshot = await captureSnapshot(
      { fixtureId, repositoryId: repo, organizationId: org, files: sampleFiles },
      org,
    );
    const expressIngestion = await ingestExpress(snapshot, org);
    return { snapshot, expressIngestion };
  }

  describe('Untrusted IPC Object Hygiene and Boundary Defense', () => {
    it('fails closed when IPC payload exceeds maximum recursion depth', () => {
      let nested: any = { value: 1 };
      for (let i = 0; i < 20; i++) {
        nested = { next: nested };
      }
      expect(() => detachJson(nested)).toThrow('metadata complexity');
    });

    it('rejects accessor getters and non-data descriptors on IPC payloads', () => {
      const trapPayload = {
        get malicious() {
          return 'injected';
        },
        regularField: 42,
      };
      expect(() => detachJson(trapPayload)).toThrow('data fields required');
    });

    it('rejects non-JSON primitive types at the IPC boundary', () => {
      expect(() => detachJson(() => {})).toThrow('non-JSON metadata');
      expect(() => detachJson(Symbol('ipc_trap'))).toThrow('non-JSON metadata');
      expect(() => detachJson(undefined)).toThrow('non-JSON metadata');
      expect(() => detachJson(Number.NaN)).toThrow('non-JSON metadata');
    });
  });

  describe('Snapshot and Express Ingestion IPC Payload Verification', () => {
    it('accepts and verifies valid source snapshot payloads', async () => {
      const { snapshot } = await buildBaselineIngestions();
      const verified = await validateSnapshot(snapshot, org);
      expect(verified.snapshotId).toBe(snapshot.snapshotId);
      expect(verified.organizationId).toBe(org);
      expect(verified.repositoryId).toBe(repo);
    });

    it('rejects snapshot payload when snapshot identity is tampered', async () => {
      const { snapshot } = await buildBaselineIngestions();
      const tampered = {
        ...snapshot,
        snapshotId: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      };
      await expect(validateSnapshot(tampered, org)).rejects.toThrow('snapshot integrity mismatch');
    });

    it('rejects snapshot payload on foreign tenant organization mismatch', async () => {
      const { snapshot } = await buildBaselineIngestions();
      await expect(validateSnapshot(snapshot, 'foreign_org')).rejects.toThrow('tenant mismatch');
    });

    it('accepts valid Express ingestion payloads and catches tampered route identities', async () => {
      const { expressIngestion } = await buildBaselineIngestions();
      const verified = await validateExpressIngestion(expressIngestion, org);
      expect(verified.ingestionIdentity).toBe(expressIngestion.ingestionIdentity);
      expect(verified.routes.length).toBe(1);

      const tampered = {
        ...expressIngestion,
        ingestionIdentity: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      };
      await expect(validateExpressIngestion(tampered, org)).rejects.toThrow('ingestion metadata mismatch');
    });
  });

  describe('Repository Ingestion IPC Payload Verification', () => {
    it('validates structural repository ingestion without minting runtime capabilities', async () => {
      const { snapshot } = await buildBaselineIngestions();
      const commitSha = 'a'.repeat(40);
      const rawPayload = {
        version: 'velnar-repository-ingestion-v1' as const,
        organizationId: org,
        repositoryId: repo,
        commitSha,
        snapshot,
      };
      const ingestionIdentity = await hash('velnar-repository-ingestion-v1', rawPayload);
      const repositoryRecord = {
        ...rawPayload,
        ingestionIdentity,
      };

      const verified = await validateRepositoryIngestion(repositoryRecord, org);
      expect(verified.commitSha).toBe(commitSha);
      expect(verified.organizationId).toBe(org);
      expect((verified as any).capability).toBeUndefined();
      expect(isTrustedCommitCapability((verified as any).capability, verified)).toBe(false);
    });

    it('rejects repository ingestion with non-hex or all-zero commit SHA', async () => {
      const { snapshot } = await buildBaselineIngestions();
      const basePayload = {
        version: 'velnar-repository-ingestion-v1' as const,
        organizationId: org,
        repositoryId: repo,
        snapshot,
      };

      const invalidSha = {
        ...basePayload,
        commitSha: 'not-a-valid-sha',
        ingestionIdentity: 'sha256:dummy',
      };
      await expect(validateRepositoryIngestion(invalidSha, org)).rejects.toThrow('Git commit identity');

      const zeroSha = {
        ...basePayload,
        commitSha: '0'.repeat(40),
        ingestionIdentity: 'sha256:dummy',
      };
      await expect(validateRepositoryIngestion(zeroSha, org)).rejects.toThrow('Git commit identity');
    });

    it('rejects repository ingestion on tenant organization mismatch', async () => {
      const { snapshot } = await buildBaselineIngestions();
      const commitSha = 'b'.repeat(40);
      const rawPayload = {
        version: 'velnar-repository-ingestion-v1' as const,
        organizationId: org,
        repositoryId: repo,
        commitSha,
        snapshot,
      };
      const ingestionIdentity = await hash('velnar-repository-ingestion-v1', rawPayload);
      const repositoryRecord = {
        ...rawPayload,
        ingestionIdentity,
      };

      await expect(validateRepositoryIngestion(repositoryRecord, 'foreign_org')).rejects.toThrow('tenant mismatch');
    });
  });

  describe('Detector and Candidate IPC Payload Verification', () => {
    it('verifies SQL analysis results against snapshot and catches tampered findings', async () => {
      const { snapshot, expressIngestion } = await buildBaselineIngestions();
      const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
      expect(analysis.status).toBe('DETECTED');
      expect(analysis.findings.length).toBe(1);

      const verified = await validateSqlAnalysis(analysis, snapshot, expressIngestion, org);
      expect(verified.resultFingerprint).toBe(analysis.resultFingerprint);

      const tampered = {
        ...analysis,
        status: 'NOT_DETECTED',
        findings: [],
      };
      await expect(
        validateSqlAnalysis(tampered, snapshot, expressIngestion, org),
      ).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
    });

    it('requires checked commit verification and emits non-authoritative candidate hypotheses', async () => {
      const { snapshot, expressIngestion } = await buildBaselineIngestions();
      const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
      const commitSha = 'c'.repeat(40);

      const bridge = createSqlCandidateBridge(async (snap) => {
        expect(snap.snapshotId).toBe(snapshot.snapshotId);
        return commitSha;
      });

      const hypotheses: readonly CandidateHypothesis[] = await bridge(
        analysis,
        snapshot,
        expressIngestion,
        org,
      );

      expect(hypotheses.length).toBe(1);
      const hypothesis = hypotheses[0];
      expect(hypothesis.candidate.verificationState).toBe('CANDIDATE');
      expect(hypothesis.candidate.reachabilityState).toBe('REACHABLE');
      expect(hypothesis.candidate.vulnerabilityClass).toBe('SQL_INJECTION');
      expect(hypothesis.candidate.snapshot.commitSha).toBe(commitSha);
      expect(typeof hypothesis.candidateBinding).toBe('string');
      expect(hypothesis.candidateBinding.length).toBeGreaterThan(0);

      // Boundary enforcement: candidate hypothesis never carries VERIFIED authority
      expect((hypothesis.candidate as any).verificationState).not.toBe('VERIFIED');
      expect((hypothesis as any).capability).toBeUndefined();
    });

    it('refuses candidate bridge synthesis if commit callback returns zero or malformed SHA', async () => {
      const { snapshot, expressIngestion } = await buildBaselineIngestions();
      const analysis = await detectSqlInjection(snapshot, expressIngestion, org);

      const zeroBridge = createSqlCandidateBridge(async () => '0'.repeat(40));
      await expect(
        zeroBridge(analysis, snapshot, expressIngestion, org),
      ).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

      const malformedBridge = createSqlCandidateBridge(async () => 'malformed');
      await expect(
        malformedBridge(analysis, snapshot, expressIngestion, org),
      ).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
    });
  });

  describe('IPC Payload Tamper-Resistance and Immutability', () => {
    it('enforces deep immutability on verified IPC payloads', async () => {
      const { snapshot, expressIngestion } = await buildBaselineIngestions();
      const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
      const commitSha = 'd'.repeat(40);
      const bridge = createSqlCandidateBridge(async () => commitSha);
      const hypotheses = await bridge(analysis, snapshot, expressIngestion, org);

      expect(Object.isFrozen(snapshot)).toBe(true);
      expect(Object.isFrozen(snapshot.files)).toBe(true);
      expect(Object.isFrozen(expressIngestion)).toBe(true);
      expect(Object.isFrozen(expressIngestion.routes)).toBe(true);
      expect(Object.isFrozen(analysis)).toBe(true);
      expect(Object.isFrozen(analysis.findings)).toBe(true);
      expect(Object.isFrozen(hypotheses)).toBe(true);
      expect(Object.isFrozen(hypotheses[0])).toBe(true);
    });
  });
});
