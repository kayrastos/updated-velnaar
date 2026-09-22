import { describe, expect, it } from 'vitest';
import { CONTRACT_VERSION, computeCandidateBinding } from '../../../../worker/intelligence/contracts';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { DETECTOR_VERSION, RULE_ID } from '../../../../worker/intelligence/detection/types';
import { analyzeInput, input, ORG } from '../../../intelligence/m3/support/inputs';

describe('positive control: cross-file SQL injection detection', () => {
  it('detects cross-file SQL injection preserving source, service, and repository provenance', async () => {
    const raw = input(6);
    const { snapshot, ingestion, result } = await analyzeInput(raw);

    expect(result.status).toBe('DETECTED');
    expect(result.ruleId).toBe(RULE_ID);
    expect(result.version).toBe(DETECTOR_VERSION);
    expect(result.organizationId).toBe(ORG);
    expect(result.limitations).toEqual([]);
    expect(result.findings).toHaveLength(1);

    const finding = result.findings[0];
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.source.filePath).toBe('src/routes.ts');
    expect(finding.sink.filePath).toBe('src/repository.ts');
    expect(finding.sink.symbol).toBe('db.prepare');

    const uniqueFiles = [...new Set(finding.flow.map(step => step.location.filePath))];
    expect(uniqueFiles).toEqual(['src/routes.ts', 'src/service.ts', 'src/repository.ts']);

    expect(finding.flow[0].kind).toBe('SOURCE');
    expect(finding.flow.at(-1)?.kind).toBe('SINK');
    expect(new Set(finding.flow.map(step => step.id)).size).toBe(finding.flow.length);
  });

  it('preserves analysis result under reversed file input ordering', async () => {
    const raw = input(6);
    const forward = await analyzeInput(raw);
    const reversed = { ...raw, files: [...raw.files].reverse() };
    const backward = await analyzeInput(reversed);

    expect(backward.result).toEqual(forward.result);
    const recomputed = await detectSqlInjection(forward.snapshot, forward.ingestion, ORG);
    expect(recomputed).toEqual(forward.result);

    const validated = await validateSqlAnalysis(forward.result, forward.snapshot, forward.ingestion, ORG);
    expect(validated).toEqual(forward.result);
  });

  it('bridges cross-file detection to a canonical CANDIDATE finding with valid binding', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(6));
    const mockCommit = 'c'.repeat(40);
    const bridge = createSqlCandidateBridge(async () => mockCommit);

    const hypotheses = await bridge(result, snapshot, ingestion, ORG);
    expect(hypotheses).toHaveLength(1);

    const { candidate, candidateBinding } = hypotheses[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.snapshot.commitSha).toBe(mockCommit);
    expect(candidate.source.filePath).toBe('src/routes.ts');
    expect(candidate.sink.filePath).toBe('src/repository.ts');
    expect(candidate.sensorEvidence[0].ruleId).toBe(RULE_ID);
    expect(candidate.sensorEvidence[0].sensorType).toBe('VELNAR_STRUCTURAL');

    const expectedBinding = computeCandidateBinding(candidate, ORG);
    expect(candidateBinding).toBe(expectedBinding);
    expect(candidateBinding.startsWith(`${CONTRACT_VERSION}:FindingCandidate\n`)).toBe(true);
  });

  it('fails closed on cyclic cross-file imports without reporting findings', async () => {
    const raw = input(6);
    const files = raw.files.map(file => file.path === 'src/repository.ts'
      ? { ...file, content: "import { lookup } from './service';\n" + file.content } : file);
    const run = await analyzeInput({ ...raw, files });

    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toEqual([]);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('IMPORT_CYCLE');

    const bridge = createSqlCandidateBridge(async () => 'c'.repeat(40));
    expect(await bridge(run.result, run.snapshot, run.ingestion, ORG)).toEqual([]);
  });
});
