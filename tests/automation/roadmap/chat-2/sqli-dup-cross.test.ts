import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { ANALYSIS_LIMITS, DETECTOR_VERSION } from '../../../../worker/intelligence/detection/types';
import { computeCandidateBinding, createVerificationState, validateFindingCandidate } from '../../../../worker/intelligence/contracts';
import { canonical, type SnapshotInput } from '../../../../worker/intelligence/ingestion/snapshot';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

describe('V1 discovery-intelligence sqli-detector duplicate-collapse cross-file', () => {
  it('baseline cross-file detection preserves multi-file flow across routes, service, and repository', async () => {
    const { result } = await analyzeInput(input(6));
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);

    const finding = result.findings[0];
    expect(finding.source.filePath).toBe('src/routes.ts');
    expect(finding.sink.filePath).toBe('src/repository.ts');
    expect([...new Set(finding.flow.map(s => s.location.filePath))]).toEqual([
      'src/routes.ts',
      'src/service.ts',
      'src/repository.ts',
    ]);
    expect(finding.flow.filter(s => s.kind === 'SOURCE')).toHaveLength(1);
    expect(finding.flow.filter(s => s.kind === 'SINK')).toHaveLength(1);
  });

  it('collapses duplicate flow steps when the same request source is aliased and concatenated across files', async () => {
    const raw = replaceSource(input(6), content => {
      const fnIdx = content.indexOf('function searchRoute');
      const braceIdx = content.indexOf('{', fnIdx);
      return content.slice(0, braceIdx + 1)
        + '\n  const tainted = req.query.q;\n  const alias = tainted;\n  const duplicated = tainted + alias;\n'
        + content.slice(braceIdx + 1).replace('req.query.q', 'duplicated');
    });

    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);

    const finding = result.findings[0];
    expect(finding.source.filePath).toBe('src/routes.ts');
    expect(finding.sink.filePath).toBe('src/repository.ts');
    expect(finding.flow.filter(s => s.kind === 'SOURCE')).toHaveLength(1);
    expect(finding.flow.filter(s => s.kind === 'SINK')).toHaveLength(1);
    expect(new Set(finding.flow.map(s => s.id)).size).toBe(finding.flow.length);
    expect(finding.flow.length).toBeLessThanOrEqual(ANALYSIS_LIMITS.flowLength);
  });

  it('collapses diamond flow steps originating from single request source before cross-file dispatch', async () => {
    const raw = replaceSource(input(6), content => {
      const fnIdx = content.indexOf('function searchRoute');
      const braceIdx = content.indexOf('{', fnIdx);
      return content.slice(0, braceIdx + 1)
        + '\n  const a = req.query.q;\n  const b = a;\n  const c = a;\n  const diamond = b + c;\n'
        + content.slice(braceIdx + 1).replace('req.query.q', 'diamond');
    });

    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);

    const finding = result.findings[0];
    expect(finding.source.filePath).toBe('src/routes.ts');
    expect(finding.sink.filePath).toBe('src/repository.ts');
    expect(finding.flow.filter(s => s.kind === 'SOURCE')).toHaveLength(1);
    expect(finding.flow.filter(s => s.kind === 'VARIABLE' && s.location.symbol === 'a')).toHaveLength(1);
    expect(new Set(finding.flow.map(s => s.id)).size).toBe(finding.flow.length);
  });

  it('collapses duplicate flow steps when parameter is reused in repository query construction', async () => {
    const base = input(6);
    const repoFile = base.files.find(f => f.path === 'src/repository.ts')!;
    const match = repoFile.content.match(/db\.prepare\s*\(\s*([^)]+?)\s*\)/);
    expect(match).not.toBeNull();
    const rawCall = match![0];
    const argName = match![1].trim();

    const modifiedRepo = repoFile.content.replace(
      rawCall,
      `db.prepare(${argName} + ${argName})`,
    );

    const raw: SnapshotInput = {
      ...base,
      files: base.files.map(f => f.path === 'src/repository.ts' ? { ...f, content: modifiedRepo } : f),
    };

    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);

    const finding = result.findings[0];
    expect(finding.source.filePath).toBe('src/routes.ts');
    expect(finding.sink.filePath).toBe('src/repository.ts');
    expect(finding.flow.filter(s => s.kind === 'SOURCE')).toHaveLength(1);
    expect(new Set(finding.flow.map(s => s.id)).size).toBe(finding.flow.length);
  });

  it('repeated cross-file duplicate analysis produces deterministic result and valid fingerprint', async () => {
    const raw = replaceSource(input(6), content => {
      const fnIdx = content.indexOf('function searchRoute');
      const braceIdx = content.indexOf('{', fnIdx);
      return content.slice(0, braceIdx + 1)
        + '\n  const a = req.query.q;\n  const b = a;\n  const merged = a + b;\n'
        + content.slice(braceIdx + 1).replace('req.query.q', 'merged');
    });
    const reversed = { ...raw, files: [...raw.files].reverse() };
    const run1 = await analyzeInput(raw);
    const run2 = await analyzeInput(reversed);

    expect(run1.result).toEqual(run2.result);
    const validated = await validateSqlAnalysis(run1.result, run1.snapshot, run1.ingestion, ORG);
    expect(validated).toEqual(run1.result);

    const { resultFingerprint, ...body } = run1.result;
    const expectedFingerprint = 'sha256:' + createHash('sha256').update(DETECTOR_VERSION + '\n' + canonical(body)).digest('hex');
    expect(resultFingerprint).toBe(expectedFingerprint);
  });

  it('candidate bridge converts collapsed cross-file finding to exact CANDIDATE state', async () => {
    const raw = replaceSource(input(6), content => {
      const fnIdx = content.indexOf('function searchRoute');
      const braceIdx = content.indexOf('{', fnIdx);
      return content.slice(0, braceIdx + 1)
        + '\n  const a = req.query.q;\n  const b = a;\n  const merged = a + b;\n'
        + content.slice(braceIdx + 1).replace('req.query.q', 'merged');
    });
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);

    const checkedCommit = '46db4c208f886afda939c04ae93580fbabd57344';
    const bridge = createSqlCandidateBridge(async () => checkedCommit);
    const hypotheses = await bridge(result, snapshot, ingestion, ORG);

    expect(hypotheses).toHaveLength(1);
    const { candidate, candidateBinding } = hypotheses[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.organizationId).toBe(ORG);
    expect(candidate.snapshot.commitSha).toBe(checkedCommit);
    expect(candidate.source.filePath).toBe('src/routes.ts');
    expect(candidate.sink.filePath).toBe('src/repository.ts');
    expect(candidate.context.routeId).toBe(result.findings[0].routeIdentity);
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);

    const state = createVerificationState(candidate, ORG);
    expect(state.state).toBe('CANDIDATE');
    expect(state.candidate).toEqual(candidate);
  });

  it('negative control: multi-source cross-file join fails closed with MULTIPLE_SOURCES and creates no candidate', async () => {
    const raw = replaceSource(input(6), content => {
      return content.replace('req.query.q', '(req.query.q + req.query.other)');
    });
    const { snapshot, ingestion, result } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('MULTIPLE_SOURCES');

    const bridge = createSqlCandidateBridge(async () => '46db4c208f886afda939c04ae93580fbabd57344');
    const hypotheses = await bridge(result, snapshot, ingestion, ORG);
    expect(hypotheses).toEqual([]);
  });

  it('negative control: clean string concatenation across files does not introduce duplicate steps or taint', async () => {
    const raw = replaceSource(input(6), content => {
      const fnIdx = content.indexOf('function searchRoute');
      const braceIdx = content.indexOf('{', fnIdx);
      return content.slice(0, braceIdx + 1)
        + '\n  const tainted = req.query.q;\n  const clean = "constant_prefix_";\n  const combined = clean + tainted;\n'
        + content.slice(braceIdx + 1).replace('req.query.q', 'combined');
    });
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    const flow = result.findings[0].flow;
    expect(flow.filter(s => s.kind === 'SOURCE')).toHaveLength(1);
    expect(flow.filter(s => s.location.symbol === 'clean')).toHaveLength(0);
  });
});
