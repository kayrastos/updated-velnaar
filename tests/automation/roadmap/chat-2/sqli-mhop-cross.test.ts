import { describe, expect, it } from 'vitest';
import { computeCandidateBinding, createVerificationState, validateFindingCandidate } from '../../../../worker/intelligence/contracts';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

describe('RM_SQLI_MHOP_CROSS: multi-hop cross-file SQL injection detection', () => {
  it('detects cross-file multi-hop SQL injection flow across routes, service, and repository', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(6));
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    expect(result.limitations).toEqual([]);

    const finding = result.findings[0];
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.source.filePath).toBe('src/routes.ts');
    expect(finding.sink.filePath).toBe('src/repository.ts');
    expect(finding.sink.symbol).toBe('db.prepare');

    const filePaths = [...new Set(finding.flow.map(step => step.location.filePath))];
    expect(filePaths).toEqual(['src/routes.ts', 'src/service.ts', 'src/repository.ts']);

    expect(finding.flow[0].kind).toBe('SOURCE');
    expect(finding.flow.at(-1)!.kind).toBe('SINK');

    const callSteps = finding.flow.filter(step => step.kind === 'CALL');
    const argSteps = finding.flow.filter(step => step.kind === 'ARGUMENT');
    expect(callSteps.length).toBeGreaterThanOrEqual(2);
    expect(argSteps.length).toBeGreaterThanOrEqual(2);
    expect(callSteps.some(step => step.location.filePath === 'src/routes.ts')).toBe(true);
    expect(argSteps.some(step => step.location.filePath === 'src/service.ts')).toBe(true);
    expect(callSteps.some(step => step.location.filePath === 'src/service.ts')).toBe(true);
    expect(argSteps.some(step => step.location.filePath === 'src/repository.ts')).toBe(true);

    expect(new Set(finding.flow.map(step => step.id)).size).toBe(finding.flow.length);
    for (const step of finding.flow) {
      expect(step.id).toMatch(/^sha256:[0-9a-f]{64}$/);
    }

    const validated = await validateSqlAnalysis(result, snapshot, ingestion, ORG);
    expect(validated).toEqual(result);
  });

  it('produces an exact-bound CANDIDATE hypothesis preserving verification boundaries', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(6));
    const checkedCommit = '46db4c208f886afda939c04ae93580fbabd57344';
    const bridge = createSqlCandidateBridge(async () => checkedCommit);
    const candidates = await bridge(result, snapshot, ingestion, ORG);

    expect(candidates).toHaveLength(1);
    const { candidate, candidateBinding } = candidates[0];

    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.snapshot.commitSha).toBe(checkedCommit);
    expect(candidate.source.filePath).toBe('src/routes.ts');
    expect(candidate.sink.filePath).toBe('src/repository.ts');

    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);
    expect(createVerificationState(candidate, ORG).state).toBe('CANDIDATE');
  });

  it('negative control: untainted safe input produces no finding or candidate', async () => {
    const safeRaw = replaceSource(input(6), content => content.replace(/req\.query\.[A-Za-z0-9_]+/, '"safe_literal"'));
    const safeRun = await analyzeInput(safeRaw);
    expect(safeRun.result.status).toBe('NOT_DETECTED');
    expect(safeRun.result.findings).toHaveLength(0);

    const bridge = createSqlCandidateBridge(async () => '46db4c208f886afda939c04ae93580fbabd57344');
    const candidates = await bridge(safeRun.result, safeRun.snapshot, safeRun.ingestion, ORG);
    expect(candidates).toEqual([]);
  });

  it('fail-closed: cross-file import cycle results in inconclusive analysis without findings', async () => {
    const raw = input(6);
    const cycledFiles = raw.files.map(file => file.path === 'src/repository.ts'
      ? { ...file, content: "import { lookup } from './service';\n" + file.content } : file);
    const cycleRun = await analyzeInput({ ...raw, files: cycledFiles });
    expect(cycleRun.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(cycleRun.result.findings).toHaveLength(0);
    expect(cycleRun.result.limitations).toHaveLength(1);
    expect(cycleRun.result.limitations[0].code).toBe('IMPORT_CYCLE');
  });

  it('enforces verifier commit requirements and tenant isolation boundaries', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(6));
    const invalidBridge = createSqlCandidateBridge(async () => 'invalid-commit');
    await expect(invalidBridge(result, snapshot, ingestion, ORG)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const validBridge = createSqlCandidateBridge(async () => '46db4c208f886afda939c04ae93580fbabd57344');
    await expect(validBridge(result, snapshot, ingestion, 'foreign_org')).rejects.toThrow('tenant mismatch');
  });
});
