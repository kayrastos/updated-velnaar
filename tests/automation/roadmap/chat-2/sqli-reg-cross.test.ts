import { describe, expect, it } from 'vitest';
import {
  computeCandidateBinding,
  createVerificationState,
  transitionVerificationState,
  validateFindingCandidate,
} from '../../../../worker/intelligence/contracts';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

describe('V1 discovery intelligence: SQL injection cross-file regression lock', () => {
  it('traces complete cross-file taint provenance from route source to repository sink', async () => {
    const run = await analyzeInput(input(6));

    expect(run.result.status).toBe('DETECTED');
    expect(run.result.limitations).toEqual([]);
    expect(run.result.findings).toHaveLength(1);

    const finding = run.result.findings[0];
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(finding.source.filePath).toBe('src/routes.ts');
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.filePath).toBe('src/repository.ts');
    expect(finding.sink.symbol).toBe('db.prepare');

    const visitedFiles = [...new Set(finding.flow.map(step => step.location.filePath))];
    expect(visitedFiles).toEqual(['src/routes.ts', 'src/service.ts', 'src/repository.ts']);

    expect(finding.flow[0].kind).toBe('SOURCE');
    expect(finding.flow.at(-1)!.kind).toBe('SINK');
  });

  it('preserves deterministic cross-file detection regardless of file enumeration order', async () => {
    const raw = input(6);
    const reversed = { ...raw, files: [...raw.files].reverse() };
    const normalRun = await analyzeInput(raw);
    const reversedRun = await analyzeInput(reversed);

    expect(normalRun.result.status).toBe('DETECTED');
    expect(reversedRun.result.status).toBe('DETECTED');
    expect(normalRun.result.resultFingerprint).toBe(reversedRun.result.resultFingerprint);
    expect(normalRun.result.findings).toEqual(reversedRun.result.findings);

    const validated = await validateSqlAnalysis(normalRun.result, normalRun.snapshot, normalRun.ingestion, ORG);
    expect(validated).toEqual(normalRun.result);
  });

  it('rejects tampered cross-file analysis in validateSqlAnalysis', async () => {
    const run = await analyzeInput(input(6));
    const forged = structuredClone(run.result);
    (forged.findings as any)[0].sink.filePath = 'src/service.ts';

    await expect(validateSqlAnalysis(forged, run.snapshot, run.ingestion, ORG)).rejects.toThrow(
      'M3_ANALYSIS_INTEGRITY_MISMATCH',
    );
  });

  it('negative control: safe untainted input produces NOT_DETECTED in cross-file topology', async () => {
    const safeInput = replaceSource(input(6), content => content.replace('req.query.q', '"safe_literal"'));
    const run = await analyzeInput(safeInput);

    expect(run.result.status).toBe('NOT_DETECTED');
    expect(run.result.findings).toHaveLength(0);
    expect(run.result.limitations).toHaveLength(0);
  });

  it('fails closed with IMPORT_CYCLE limitation on cyclic cross-file dependencies', async () => {
    const raw = input(6);
    const files = raw.files.map(file =>
      file.path === 'src/repository.ts'
        ? { ...file, content: "import { lookup } from './service';\n" + file.content }
        : file,
    );
    const run = await analyzeInput({ ...raw, files });

    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toHaveLength(0);
    expect(run.result.limitations).toHaveLength(1);
    expect(run.result.limitations[0].code).toBe('IMPORT_CYCLE');
  });

  it('bridges detected cross-file findings to CandidateHypothesis bound to verified commit', async () => {
    const run = await analyzeInput(input(6));
    expect(run.result.status).toBe('DETECTED');

    const commitSha = '46db4c208f886afda939c04ae93580fbabd57344';
    const bridge = createSqlCandidateBridge(async () => commitSha);
    const hypotheses = await bridge(run.result, run.snapshot, run.ingestion, ORG);

    expect(hypotheses).toHaveLength(1);
    const { candidate, candidateBinding } = hypotheses[0];

    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.organizationId).toBe(ORG);
    expect(candidate.snapshot.commitSha).toBe(commitSha);
    expect(candidate.snapshot.snapshotId).toBe(run.snapshot.snapshotId);
    expect(candidate.source.filePath).toBe('src/routes.ts');
    expect(candidate.sink.filePath).toBe('src/repository.ts');
    expect(candidate.context.routeId).toBe(run.result.findings[0].routeIdentity);

    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
  });

  it('rejects candidate bridge construction with invalid commit SHA', async () => {
    const run = await analyzeInput(input(6));
    const bridge = createSqlCandidateBridge(async () => 'invalid-commit-sha');
    await expect(bridge(run.result, run.snapshot, run.ingestion, ORG)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
  });

  it('candidate hypothesis remains strictly in CANDIDATE state and cannot be directly verified', async () => {
    const run = await analyzeInput(input(6));
    const commitSha = '46db4c208f886afda939c04ae93580fbabd57344';
    const bridge = createSqlCandidateBridge(async () => commitSha);
    const [{ candidate }] = await bridge(run.result, run.snapshot, run.ingestion, ORG);

    const verificationState = createVerificationState(candidate, ORG);
    expect(verificationState.state).toBe('CANDIDATE');

    await expect(
      transitionVerificationState(verificationState, {
        type: 'COMPLETE',
        result: { result: 'VERIFIED' } as any,
        evidence: run.result as any,
      }),
    ).rejects.toThrow('COMPLETE requires pending verification');
  });
});
