import { beforeAll, describe, expect, it, vi } from 'vitest';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { DETECTOR_VERSION, RULE_ID } from '../../../../worker/intelligence/detection/types';
import {
  computeCandidateBinding,
  createVerificationState,
  transitionVerificationState,
  validateFindingCandidate,
} from '../../../../worker/intelligence/contracts';
import { hash } from '../../../../worker/intelligence/ingestion/snapshot';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

const VALID_COMMIT = '1111111111111111111111111111111111111111';

describe('Roadmap chat-2: SQL injection detector direct provenance integrity', () => {
  let directRun: Awaited<ReturnType<typeof analyzeInput>>;

  beforeAll(async () => {
    directRun = await analyzeInput(input(0));
  });

  it('proves direct request-to-sink flow carries exact source, concat, and sink provenance', async () => {
    const { snapshot, ingestion, result } = directRun;
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    expect(result.limitations).toEqual([]);
    expect(result.organizationId).toBe(ORG);
    expect(result.repositoryId).toBe(snapshot.repositoryId);
    expect(result.snapshotId).toBe(snapshot.snapshotId);
    expect(result.ingestionIdentity).toBe(ingestion.ingestionIdentity);

    const finding = result.findings[0];
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.symbol).toBe('db.prepare');
    expect(finding.routeIdentity).toBe(ingestion.routes[0].routeIdentity);

    expect(finding.flow[0].kind).toBe('SOURCE');
    expect(finding.flow[0].location.symbol).toBe('query.q');
    expect(finding.flow.at(-1)!.kind).toBe('SINK');
    expect(finding.flow.at(-1)!.location.symbol).toBe('db.prepare');
    expect(finding.flow.some(step => step.kind === 'CONCAT')).toBe(true);

    const stepIds = new Set<string>();
    for (const step of finding.flow) {
      expect(stepIds.has(step.id)).toBe(false);
      stepIds.add(step.id);
      const expectedId = await hash('m3-flow-node-v1', {
        snapshotId: snapshot.snapshotId,
        routeIdentity: finding.routeIdentity,
        kind: step.kind,
        location: step.location,
      });
      expect(step.id).toBe(expectedId);
    }

    const sourceFile = snapshot.files.find(f => f.path === finding.source.filePath)!;
    expect(sourceFile).toBeDefined();
    for (const point of [finding.source, finding.sink]) {
      const content = snapshot.files.find(f => f.path === point.filePath)!.content;
      expect(content.slice(0, point.offset).split('\n').length).toBe(point.line);
      expect(point.offset - content.lastIndexOf('\n', point.offset - 1)).toBe(point.column);
    }

    const { resultFingerprint, ...body } = result;
    const expectedFingerprint = await hash(DETECTOR_VERSION, body);
    expect(resultFingerprint).toBe(expectedFingerprint);
  });

  it('validates direct flow integrity and rejects tampered source, sink, or flow ordering', async () => {
    const { snapshot, ingestion, result } = directRun;
    const validated = await validateSqlAnalysis(result, snapshot, ingestion, ORG);
    expect(validated).toEqual(result);

    const tamperedFlowOrder: any = structuredClone(result);
    tamperedFlowOrder.findings[0].flow.reverse();
    await expect(validateSqlAnalysis(tamperedFlowOrder, snapshot, ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY');

    const tamperedSource: any = structuredClone(result);
    tamperedSource.findings[0].source.column++;
    await expect(validateSqlAnalysis(tamperedSource, snapshot, ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY');

    const tamperedSink: any = structuredClone(result);
    tamperedSink.findings[0].sink.filePath = 'src/decoy.ts';
    await expect(validateSqlAnalysis(tamperedSink, snapshot, ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY');

    const tamperedStepId: any = structuredClone(result);
    tamperedStepId.findings[0].flow[0].id = 'sha256:' + '0'.repeat(64);
    await expect(validateSqlAnalysis(tamperedStepId, snapshot, ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY');

    const tamperedDuplicateStep: any = structuredClone(result);
    tamperedDuplicateStep.findings[0].flow.push(tamperedDuplicateStep.findings[0].flow[0]);
    await expect(validateSqlAnalysis(tamperedDuplicateStep, snapshot, ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY');

    const tamperedStatus: any = structuredClone(result);
    tamperedStatus.status = 'NOT_DETECTED';
    await expect(validateSqlAnalysis(tamperedStatus, snapshot, ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY');
  });

  it('bridges direct detection into a strictly CANDIDATE FindingCandidate with exact semantic binding', async () => {
    const { snapshot, ingestion, result } = directRun;
    const verifier = vi.fn(async () => VALID_COMMIT);
    const bridge = createSqlCandidateBridge(verifier);

    const candidates = await bridge(result, snapshot, ingestion, ORG);
    expect(verifier).toHaveBeenCalledTimes(1);
    expect(candidates).toHaveLength(1);

    const { candidate, candidateBinding } = candidates[0];
    const finding = result.findings[0];

    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.organizationId).toBe(ORG);
    expect(candidate.snapshot.commitSha).toBe(VALID_COMMIT);
    expect(candidate.snapshot.snapshotId).toBe(snapshot.snapshotId);
    expect(candidate.snapshot.repositoryId).toBe(snapshot.repositoryId);
    expect(candidate.source).toEqual({
      filePath: finding.source.filePath,
      symbol: finding.source.symbol,
      line: finding.source.line,
      column: finding.source.column,
    });
    expect(candidate.sink).toEqual({
      filePath: finding.sink.filePath,
      symbol: finding.sink.symbol,
      line: finding.sink.line,
      column: finding.sink.column,
    });
    expect(candidate.context.routeId).toBe(finding.routeIdentity);
    expect(candidate.sensorEvidence).toHaveLength(1);
    expect(candidate.sensorEvidence[0].sensorType).toBe('VELNAR_STRUCTURAL');
    expect(candidate.sensorEvidence[0].ruleId).toBe(RULE_ID);
    expect(candidate.sensorEvidence[0].rawEvidenceFingerprint).toBe(result.resultFingerprint);

    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);

    const initial = createVerificationState(candidate, ORG);
    expect(initial.state).toBe('CANDIDATE');
    await expect(
      transitionVerificationState(initial, { type: 'COMPLETE', result: {} as any, evidence: {} as any })
    ).rejects.toThrow('COMPLETE requires pending verification');
  });

  it('rejects candidate bridging on tampered analysis or invalid verified commit identities', async () => {
    const { snapshot, ingestion, result } = directRun;
    const tampered: any = structuredClone(result);
    tampered.findings[0].source.symbol = 'other';
    const verifier = vi.fn(async () => VALID_COMMIT);
    await expect(createSqlCandidateBridge(verifier)(tampered, snapshot, ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY');
    expect(verifier).not.toHaveBeenCalled();

    for (const badCommit of ['', 'not-a-valid-sha', '0000000000000000000000000000000000000000']) {
      const badBridge = createSqlCandidateBridge(async () => badCommit);
      await expect(badBridge(result, snapshot, ingestion, ORG)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
    }
  });

  it('enforces negative controls: safe parameterization and constant concatenation yield no findings', async () => {
    const safeRun = await analyzeInput(input(1));
    expect(safeRun.result.status).toBe('NOT_DETECTED');
    expect(safeRun.result.findings).toEqual([]);

    const verifier = vi.fn(async () => VALID_COMMIT);
    const bridge = createSqlCandidateBridge(verifier);
    const safeCandidates = await bridge(safeRun.result, safeRun.snapshot, safeRun.ingestion, ORG);
    expect(safeCandidates).toEqual([]);
    expect(verifier).not.toHaveBeenCalled();

    const constantInput = replaceSource(input(0), src =>
      src.replace('req.query.q', '"static-clean-id"')
    );
    const constantRun = await analyzeInput(constantInput);
    expect(constantRun.result.status).toBe('NOT_DETECTED');
    expect(constantRun.result.findings).toEqual([]);
    const constantCandidates = await bridge(constantRun.result, constantRun.snapshot, constantRun.ingestion, ORG);
    expect(constantCandidates).toEqual([]);
    expect(verifier).not.toHaveBeenCalled();
  });

  it('enforces tenant isolation and fail-closed bounds on direct flow analysis', async () => {
    const { snapshot, ingestion, result } = directRun;
    await expect(detectSqlInjection(snapshot, ingestion, 'foreign_org')).rejects.toThrow('tenant mismatch');
    await expect(validateSqlAnalysis(result, snapshot, ingestion, 'foreign_org')).rejects.toThrow('tenant mismatch');

    const bridge = createSqlCandidateBridge(async () => VALID_COMMIT);
    await expect(bridge(result, snapshot, ingestion, 'foreign_org')).rejects.toThrow('tenant mismatch');

    const unsupportedInput = replaceSource(input(0), src =>
      src.replace('req.query.q', '(req.query.q as string)')
    );
    const unsupportedRun = await analyzeInput(unsupportedInput);
    expect(unsupportedRun.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(unsupportedRun.result.findings).toEqual([]);
    expect(unsupportedRun.result.limitations).toHaveLength(1);
    expect(unsupportedRun.result.limitations[0].code).toBe('UNSUPPORTED_EXPRESSION');

    const inconclusiveCandidates = await bridge(
      unsupportedRun.result,
      unsupportedRun.snapshot,
      unsupportedRun.ingestion,
      ORG
    );
    expect(inconclusiveCandidates).toEqual([]);
  });
});
