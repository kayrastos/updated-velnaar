import { describe, expect, it, vi } from 'vitest';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { DETECTOR_VERSION, RULE_ID } from '../../../../worker/intelligence/detection/types';
import {
  computeCandidateBinding,
  createVerificationState,
  transitionVerificationState,
  validateFindingCandidate,
} from '../../../../worker/intelligence/contracts';
import { analyzeInput, input, ORG } from '../../../intelligence/m3/support/inputs';

describe('V1 discovery-intelligence: sqli-detector cross-file provenance integrity', () => {
  it('detects SQL injection and preserves multi-module provenance across route, service, and repository', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(6));

    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    expect(result.limitations).toEqual([]);

    const finding = result.findings[0];
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.source.filePath).toBe('src/routes.ts');
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.filePath).toBe('src/repository.ts');
    expect(finding.sink.symbol).toBe('db.prepare');

    const filePaths = finding.flow.map(step => step.location.filePath);
    expect([...new Set(filePaths)]).toEqual(['src/routes.ts', 'src/service.ts', 'src/repository.ts']);

    expect(finding.flow[0].kind).toBe('SOURCE');
    expect(finding.flow[0].location.filePath).toBe('src/routes.ts');
    expect(finding.flow.at(-1)!.kind).toBe('SINK');
    expect(finding.flow.at(-1)!.location.filePath).toBe('src/repository.ts');

    expect(finding.flow.some(step => step.kind === 'CALL')).toBe(true);
    expect(finding.flow.some(step => step.kind === 'ARGUMENT')).toBe(true);

    const stepIds = new Set(finding.flow.map(step => step.id));
    expect(stepIds.size).toBe(finding.flow.length);
    for (const step of finding.flow) {
      expect(step.id).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(Object.isFrozen(step.location)).toBe(true);
    }

    const valid = await validateSqlAnalysis(result, snapshot, ingestion, ORG);
    expect(valid).toEqual(result);
  });

  it('rejects cross-file flow tampering across intermediate modules during validation', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(6));

    const forgedPath: any = structuredClone(result);
    const serviceStep = forgedPath.findings[0].flow.find((s: any) => s.location.filePath === 'src/service.ts');
    expect(serviceStep).toBeDefined();
    serviceStep.location.filePath = 'src/routes.ts';
    await expect(validateSqlAnalysis(forgedPath, snapshot, ingestion, ORG))
      .rejects.toThrow('M3_ANALYSIS_INTEGRITY');

    const forgedOrder: any = structuredClone(result);
    forgedOrder.findings[0].flow.reverse();
    await expect(validateSqlAnalysis(forgedOrder, snapshot, ingestion, ORG))
      .rejects.toThrow('M3_ANALYSIS_INTEGRITY');

    const forgedId: any = structuredClone(result);
    forgedId.findings[0].flow[0].id = 'sha256:' + 'e'.repeat(64);
    await expect(validateSqlAnalysis(forgedId, snapshot, ingestion, ORG))
      .rejects.toThrow('M3_ANALYSIS_INTEGRITY');

    const forgedSink: any = structuredClone(result);
    forgedSink.findings[0].sink.filePath = 'src/service.ts';
    await expect(validateSqlAnalysis(forgedSink, snapshot, ingestion, ORG))
      .rejects.toThrow('M3_ANALYSIS_INTEGRITY');
  });

  it('bridges cross-file finding to canonical FindingCandidate preserving CANDIDATE state and bindings', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(6));
    const mockCommitSha = 'b'.repeat(40);
    const verifier = vi.fn(async () => mockCommitSha);
    const bridge = createSqlCandidateBridge(verifier);

    const hypotheses = await bridge(result, snapshot, ingestion, ORG);
    expect(verifier).toHaveBeenCalledTimes(1);
    expect(hypotheses).toHaveLength(1);

    const { candidate, candidateBinding } = hypotheses[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.organizationId).toBe(ORG);
    expect(candidate.snapshot.commitSha).toBe(mockCommitSha);
    expect(candidate.snapshot.sourceProvider).toBe('LOCAL_FIXTURE');

    expect(candidate.source.filePath).toBe('src/routes.ts');
    expect(candidate.source.symbol).toBe('query.q');
    expect(candidate.sink.filePath).toBe('src/repository.ts');
    expect(candidate.sink.symbol).toBe('db.prepare');
    expect(candidate.context.entrypoint.filePath).toBe('src/routes.ts');

    expect(candidate.sensorEvidence).toHaveLength(1);
    expect(candidate.sensorEvidence[0].sensorType).toBe('VELNAR_STRUCTURAL');
    expect(candidate.sensorEvidence[0].ruleId).toBe(RULE_ID);
    expect(candidate.sensorEvidence[0].sourceLocation.filePath).toBe('src/routes.ts');
    expect(candidate.sensorEvidence[0].sinkLocation?.filePath).toBe('src/repository.ts');

    const expectedBinding = computeCandidateBinding(candidate, ORG);
    expect(candidateBinding).toBe(expectedBinding);
    expect(candidateBinding.startsWith('velnar-intelligence-contract-v1:FindingCandidate\n')).toBe(true);
    expect(candidateBinding.startsWith('sha256:')).toBe(false);
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);

    const state = createVerificationState(candidate, ORG);
    expect(state.state).toBe('CANDIDATE');
    await expect(transitionVerificationState(state, {
      type: 'COMPLETE',
      result: { result: 'VERIFIED' } as any,
      evidence: result as any,
    })).rejects.toThrow('COMPLETE requires pending');
  });

  it('candidate bridge rejects tampered cross-file findings without invoking commit verifier', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(6));
    const verifier = vi.fn(async () => 'c'.repeat(40));
    const bridge = createSqlCandidateBridge(verifier);

    const forged: any = structuredClone(result);
    forged.findings[0].source.filePath = 'src/service.ts';

    await expect(bridge(forged, snapshot, ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY');
    expect(verifier).not.toHaveBeenCalled();
  });

  it('fails closed when cross-file dependencies contain cycles or unresolvable imports', async () => {
    const raw = input(6);

    const cyclicFiles = raw.files.map(file => file.path === 'src/repository.ts'
      ? { ...file, content: "import { lookup } from './service';\n" + file.content }
      : file);
    const cyclicRun = await analyzeInput({ ...raw, files: cyclicFiles });
    expect(cyclicRun.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(cyclicRun.result.findings).toEqual([]);
    expect(cyclicRun.result.limitations).toHaveLength(1);
    expect(cyclicRun.result.limitations[0].code).toBe('IMPORT_CYCLE');

    const unresolvedFiles = raw.files.map(file => file.path === 'src/routes.ts'
      ? { ...file, content: "import { missingHelper } from './service';\n" + file.content }
      : file);
    const unresolvedRun = await analyzeInput({ ...raw, files: unresolvedFiles });
    expect(unresolvedRun.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(unresolvedRun.result.findings).toEqual([]);
    expect(unresolvedRun.result.limitations).toHaveLength(1);
    expect(unresolvedRun.result.limitations[0].code).toBe('UNSUPPORTED_IMPORT');
  });
});
