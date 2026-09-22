import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  computeCandidateBinding,
  createVerificationState,
  transitionVerificationState,
  validateFindingCandidate,
  type FindingCandidate,
} from '../../../../worker/intelligence/contracts';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { captureSnapshot, validateSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress } from '../../../../worker/intelligence/ingestion/express';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

const VALID_COMMIT = '1111111111111111111111111111111111111111';
const bridge = createSqlCandidateBridge(async () => VALID_COMMIT);

let runs: Awaited<ReturnType<typeof analyzeInput>>[];
beforeAll(async () => {
  runs = [];
  for (let i = 0; i < 8; i++) {
    runs.push(await analyzeInput(input(i)));
  }
});

describe('SQL injection detector: multi-stage boundary rejection', () => {
  describe('Stage 1 to Stage 2: snapshot to ingestion boundary rejection', () => {
    it('rejects foreign tenant during Express ingestion of a captured snapshot', async () => {
      await expect(ingestExpress(runs[0].snapshot, 'foreign_org')).rejects.toThrow('tenant mismatch');
    });

    it('rejects snapshot with tampered snapshotId during ingestion validation', async () => {
      const snapshot = structuredClone(runs[0].snapshot);
      const forged = { ...snapshot, snapshotId: 'sha256:' + 'f'.repeat(64) };
      await expect(validateSnapshot(forged, ORG)).rejects.toThrow('snapshot integrity mismatch');
      await expect(ingestExpress(forged, ORG)).rejects.toThrow('snapshot integrity mismatch');
    });

    it('rejects snapshot with altered file content during ingestion validation', async () => {
      const raw = input(0);
      const tampered = {
        ...raw,
        files: raw.files.map(f => f.path === 'src/routes.ts' ? { ...f, content: f.content + '\n// untrusted modification' } : f),
      };
      const forgedSnapshot = { ...runs[0].snapshot, files: (await captureSnapshot(tampered, ORG)).files };
      await expect(validateSnapshot(forgedSnapshot, ORG)).rejects.toThrow('snapshot integrity mismatch');
    });
  });

  describe('Stage 2 to Stage 3: ingestion to SQL injection detection boundary rejection', () => {
    it('rejects cross-snapshot mismatch between snapshot and ingestion', async () => {
      await expect(detectSqlInjection(runs[1].snapshot, runs[0].ingestion, ORG))
        .rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
      await expect(detectSqlInjection(runs[0].snapshot, runs[1].ingestion, ORG))
        .rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
    });

    it('rejects foreign tenant at detection boundary', async () => {
      await expect(detectSqlInjection(runs[0].snapshot, runs[0].ingestion, 'foreign_org'))
        .rejects.toThrow('tenant mismatch');
    });

    it('rejects tampered analysis result at analysis validation boundary', async () => {
      const forged: any = structuredClone(runs[0].result);
      forged.status = 'NOT_DETECTED';
      forged.findings = [];
      await expect(validateSqlAnalysis(forged, runs[0].snapshot, runs[0].ingestion, ORG))
        .rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
    });

    it('rejects tampered flow steps in analysis result', async () => {
      const forged: any = structuredClone(runs[0].result);
      forged.findings[0].flow[0].location.symbol = 'tampered';
      await expect(validateSqlAnalysis(forged, runs[0].snapshot, runs[0].ingestion, ORG))
        .rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
    });

    it('fails closed to inconclusive without findings when syntax violates constraints', async () => {
      const loopRaw = replaceSource(input(0), s => s.replace('return res.json', 'while (true) {} return res.json'));
      const loopRun = await analyzeInput(loopRaw);
      expect(loopRun.result.status).toBe('ANALYSIS_INCONCLUSIVE');
      expect(loopRun.result.findings).toHaveLength(0);
      expect(loopRun.result.limitations).toHaveLength(1);

      const multiRaw = replaceSource(input(0), s => s.replace('req.query.q', '(req.query.q + req.query.other)'));
      const multiRun = await analyzeInput(multiRaw);
      expect(multiRun.result.status).toBe('ANALYSIS_INCONCLUSIVE');
      expect(multiRun.result.findings).toHaveLength(0);
      expect(multiRun.result.limitations[0].code).toBe('MULTIPLE_SOURCES');
    });
  });

  describe('Stage 3 to Stage 4: detection to candidate bridge boundary rejection', () => {
    it('returns empty candidates and bypasses commit verifier for safe fixture', async () => {
      const verifier = vi.fn();
      const customBridge = createSqlCandidateBridge(verifier);
      const candidates = await customBridge(runs[1].result, runs[1].snapshot, runs[1].ingestion, ORG);
      expect(candidates).toEqual([]);
      expect(verifier).not.toHaveBeenCalled();
    });

    it('returns empty candidates and bypasses commit verifier for inconclusive analysis', async () => {
      const inconclusive = await analyzeInput(
        replaceSource(input(0), s => s.replace('return res.json', 'while (true) {} return res.json'))
      );
      const verifier = vi.fn();
      const customBridge = createSqlCandidateBridge(verifier);
      const candidates = await customBridge(
        inconclusive.result,
        inconclusive.snapshot,
        inconclusive.ingestion,
        ORG
      );
      expect(candidates).toEqual([]);
      expect(verifier).not.toHaveBeenCalled();
    });

    it('rejects forged detected result on safe snapshot before commit verification', async () => {
      const forged: any = structuredClone(runs[0].result);
      forged.snapshotId = runs[1].snapshot.snapshotId;
      const verifier = vi.fn();
      const customBridge = createSqlCandidateBridge(verifier);
      await expect(customBridge(forged, runs[1].snapshot, runs[1].ingestion, ORG))
        .rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
      expect(verifier).not.toHaveBeenCalled();
    });

    it.each([
      ['empty', ''],
      ['malformed', 'not-a-valid-sha'],
      ['all-zero', '0000000000000000000000000000000000000000'],
      ['short', 'a'.repeat(39)],
      ['long', 'a'.repeat(41)],
    ])('rejects %s commit SHA returned by commit verifier', async (_label, invalidSha) => {
      const customBridge = createSqlCandidateBridge(async () => invalidSha);
      await expect(customBridge(runs[0].result, runs[0].snapshot, runs[0].ingestion, ORG))
        .rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
    });

    it('rejects foreign tenant at candidate bridge boundary', async () => {
      await expect(bridge(runs[0].result, runs[0].snapshot, runs[0].ingestion, 'foreign_org'))
        .rejects.toThrow('tenant mismatch');
    });
  });

  describe('Stage 4 to Stage 5: candidate bridge to verification state machine boundary rejection', () => {
    it('produces hypotheses strictly in CANDIDATE verification state', async () => {
      const output = await bridge(runs[0].result, runs[0].snapshot, runs[0].ingestion, ORG);
      expect(output).toHaveLength(1);
      const { candidate, candidateBinding } = output[0];
      expect(candidate.verificationState).toBe('CANDIDATE');
      expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
      expect(candidate.snapshot.commitSha).toBe(VALID_COMMIT);
      expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
      expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);
    });

    it('rejects direct COMPLETE transition from initial CANDIDATE state', async () => {
      const output = await bridge(runs[0].result, runs[0].snapshot, runs[0].ingestion, ORG);
      const { candidate } = output[0];
      const state = createVerificationState(candidate, ORG);
      expect(state.state).toBe('CANDIDATE');
      await expect(
        transitionVerificationState(state, {
          type: 'COMPLETE',
          result: { result: 'VERIFIED' } as any,
          evidence: {} as any,
        })
      ).rejects.toThrow('COMPLETE requires pending verification');
    });

    it('rejects candidate with tampered semantic property altering canonical binding', async () => {
      const output = await bridge(runs[0].result, runs[0].snapshot, runs[0].ingestion, ORG);
      const { candidate, candidateBinding } = output[0];
      const tampered: FindingCandidate = {
        ...candidate,
        source: { ...candidate.source, symbol: 'tampered.symbol' },
      };
      const tamperedBinding = computeCandidateBinding(tampered, ORG);
      expect(tamperedBinding).not.toBe(candidateBinding);
    });

    it('enforces tenant boundary on candidate validation and binding', async () => {
      const output = await bridge(runs[0].result, runs[0].snapshot, runs[0].ingestion, ORG);
      const { candidate } = output[0];
      expect(() => validateFindingCandidate(candidate, 'foreign_org'))
        .toThrow('organizationId mismatch');
      expect(() => computeCandidateBinding(candidate, 'foreign_org'))
        .toThrow('organizationId mismatch');
    });
  });

  describe('Multi-stage end-to-end fail-closed and deterministic boundaries', () => {
    it('negative control fixture index 1 produces zero findings and zero candidates end-to-end', async () => {
      const verifier = vi.fn();
      const customBridge = createSqlCandidateBridge(verifier);
      const { snapshot, ingestion, result } = runs[1];
      expect(result.status).toBe('NOT_DETECTED');
      expect(result.findings).toHaveLength(0);
      const candidates = await customBridge(result, snapshot, ingestion, ORG);
      expect(candidates).toHaveLength(0);
      expect(verifier).not.toHaveBeenCalled();
    });

    it('end-to-end detection and candidate binding are deterministic across repeated runs', async () => {
      const output1 = await bridge(runs[0].result, runs[0].snapshot, runs[0].ingestion, ORG);
      const output2 = await bridge(runs[0].result, runs[0].snapshot, runs[0].ingestion, ORG);
      expect(output1).toEqual(output2);
      expect(output1[0].candidateBinding).toBe(output2[0].candidateBinding);
    });

    it('cross-file fixture index 6 preserves provenance across all stages', async () => {
      const { snapshot, ingestion, result } = runs[6];
      expect(result.status).toBe('DETECTED');
      expect(result.findings).toHaveLength(1);
      const finding = result.findings[0];
      expect(finding.source.filePath).toBe('src/routes.ts');
      expect(finding.sink.filePath).toBe('src/repository.ts');

      const candidates = await bridge(result, snapshot, ingestion, ORG);
      expect(candidates).toHaveLength(1);
      const { candidate } = candidates[0];
      expect(candidate.source.filePath).toBe('src/routes.ts');
      expect(candidate.sink.filePath).toBe('src/repository.ts');
      expect(candidate.verificationState).toBe('CANDIDATE');
    });

    it('mounted router fixture index 7 binds route identity across all stages', async () => {
      const { snapshot, ingestion, result } = runs[7];
      expect(result.status).toBe('DETECTED');
      const routeIdentity = ingestion.routes[0].routeIdentity;
      expect(result.findings[0].routeIdentity).toBe(routeIdentity);

      const candidates = await bridge(result, snapshot, ingestion, ORG);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].candidate.context.routeId).toBe(routeIdentity);
    });
  });
});
