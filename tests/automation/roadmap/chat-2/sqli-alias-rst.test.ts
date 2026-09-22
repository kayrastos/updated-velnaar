import { describe, expect, it } from 'vitest';
import { computeCandidateBinding } from '../../../../worker/intelligence/contracts';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

const COMMITTED_SHA = '46db4c208f886afda939c04ae93580fbabd57344';

function taintedAliasInput(vars: string[]): ReturnType<typeof input> {
  const declarations = vars.map((name, i) =>
    i === 0 ? `const ${name} = req.query.q;` : `const ${name} = ${vars[i - 1]};`
  ).join(' ');
  const sinkVar = vars[vars.length - 1];
  return replaceSource(input(), content =>
    content
      .replace('return res.json', `${declarations} return res.json`)
      .replace('" + req.query.q + "', `" + ${sinkVar} + "`)
  );
}

function safeAliasInput(vars: string[]): ReturnType<typeof input> {
  const declarations = vars.map((name, i) =>
    i === 0 ? `const ${name} = "safe_constant";` : `const ${name} = ${vars[i - 1]};`
  ).join(' ');
  const sinkVar = vars[vars.length - 1];
  return replaceSource(input(), content =>
    content
      .replace('return res.json', `${declarations} return res.json`)
      .replace('" + req.query.q + "', `" + ${sinkVar} + "`)
  );
}

function inconclusiveAliasInput(): ReturnType<typeof input> {
  return replaceSource(input(), content =>
    content.replace('return res.json', 'const x = req.query.q; while (true) {} return res.json')
  );
}

describe('M3 SQL injection alias propagation restart-resume', () => {
  it('repeated restart-resume executions on the same alias chain produce deterministic identical analysis', async () => {
    const raw = taintedAliasInput(['x', 'y', 'z']);
    const run1 = await analyzeInput(raw);
    const run2 = await analyzeInput(raw);
    const run3 = await analyzeInput(raw);

    expect(run1.result.status).toBe('DETECTED');
    expect(run1.result.findings).toHaveLength(1);
    expect(run1.result.resultFingerprint).toBe(run2.result.resultFingerprint);
    expect(run2.result.resultFingerprint).toBe(run3.result.resultFingerprint);
    expect(run1.result).toEqual(run2.result);
    expect(run2.result).toEqual(run3.result);

    const varSteps = run1.result.findings[0].flow
      .filter(step => step.kind === 'VARIABLE')
      .map(step => step.location.symbol);
    expect(varSteps).toEqual(['x', 'y', 'z']);
  });

  it('interleaved restart-resume with negative controls preserves clean taint isolation', async () => {
    const tainted = taintedAliasInput(['a', 'b', 'c']);
    const safe = safeAliasInput(['s1', 's2', 's3']);

    const initialTainted = await analyzeInput(tainted);
    expect(initialTainted.result.status).toBe('DETECTED');
    expect(initialTainted.result.findings).toHaveLength(1);

    const safeRun = await analyzeInput(safe);
    expect(safeRun.result.status).toBe('NOT_DETECTED');
    expect(safeRun.result.findings).toHaveLength(0);
    expect(safeRun.result.limitations).toHaveLength(0);

    const resumedTainted = await analyzeInput(tainted);
    expect(resumedTainted.result.status).toBe('DETECTED');
    expect(resumedTainted.result.findings).toHaveLength(1);
    expect(resumedTainted.result).toEqual(initialTainted.result);
    expect(resumedTainted.result.resultFingerprint).toBe(initialTainted.result.resultFingerprint);

    const resumedSafe = await analyzeInput(safe);
    expect(resumedSafe.result.status).toBe('NOT_DETECTED');
    expect(resumedSafe.result.findings).toHaveLength(0);
    expect(resumedSafe.result).toEqual(safeRun.result);
  });

  it('resumes cleanly after encountering fail-closed syntax limitations in an alias chain', async () => {
    const tainted = taintedAliasInput(['p', 'q', 'r']);
    const limited = inconclusiveAliasInput();

    const limitedRun = await analyzeInput(limited);
    expect(limitedRun.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(limitedRun.result.findings).toHaveLength(0);
    expect(limitedRun.result.limitations).toHaveLength(1);

    const resumed = await analyzeInput(tainted);
    expect(resumed.result.status).toBe('DETECTED');
    expect(resumed.result.findings).toHaveLength(1);
    expect(resumed.result.limitations).toHaveLength(0);

    const varSteps = resumed.result.findings[0].flow
      .filter(step => step.kind === 'VARIABLE')
      .map(step => step.location.symbol);
    expect(varSteps).toEqual(['p', 'q', 'r']);

    const repeated = await analyzeInput(tainted);
    expect(repeated.result).toEqual(resumed.result);
  });

  it('preserves distinct alias topology isolation across sequential restart-resume cycles', async () => {
    const chain1 = taintedAliasInput(['x1', 'x2']);
    const chain2 = taintedAliasInput(['m1', 'm2', 'm3', 'm4']);

    const run1 = await analyzeInput(chain1);
    const run2 = await analyzeInput(chain2);

    expect(run1.result.status).toBe('DETECTED');
    expect(run2.result.status).toBe('DETECTED');
    expect(run1.result.resultFingerprint).not.toBe(run2.result.resultFingerprint);

    const steps1 = run1.result.findings[0].flow
      .filter(step => step.kind === 'VARIABLE')
      .map(step => step.location.symbol);
    const steps2 = run2.result.findings[0].flow
      .filter(step => step.kind === 'VARIABLE')
      .map(step => step.location.symbol);

    expect(steps1).toEqual(['x1', 'x2']);
    expect(steps2).toEqual(['m1', 'm2', 'm3', 'm4']);

    const resume1 = await analyzeInput(chain1);
    const resume2 = await analyzeInput(chain2);

    expect(resume1.result).toEqual(run1.result);
    expect(resume2.result).toEqual(run2.result);
  });

  it('candidate bridge generates identical candidates and bindings across restarted alias analyses', async () => {
    const bridge = createSqlCandidateBridge(async () => COMMITTED_SHA);
    const tainted = taintedAliasInput(['c1', 'c2', 'c3']);
    const safe = safeAliasInput(['s1', 's2']);

    const runA = await analyzeInput(tainted);
    const candidatesA = await bridge(runA.result, runA.snapshot, runA.ingestion, ORG);
    expect(candidatesA).toHaveLength(1);
    expect(candidatesA[0].candidate.verificationState).toBe('CANDIDATE');
    expect(candidatesA[0].candidateBinding).toBe(computeCandidateBinding(candidatesA[0].candidate, ORG));

    const runSafe = await analyzeInput(safe);
    const candidatesSafe = await bridge(runSafe.result, runSafe.snapshot, runSafe.ingestion, ORG);
    expect(candidatesSafe).toEqual([]);

    const runB = await analyzeInput(tainted);
    const candidatesB = await bridge(runB.result, runB.snapshot, runB.ingestion, ORG);
    expect(candidatesB).toEqual(candidatesA);
    expect(candidatesB[0].candidateBinding).toBe(candidatesA[0].candidateBinding);
  });

  it('validateSqlAnalysis confirms integrity across restarted alias runs', async () => {
    const raw = taintedAliasInput(['v1', 'v2']);
    const run = await analyzeInput(raw);
    const validated1 = await validateSqlAnalysis(run.result, run.snapshot, run.ingestion, ORG);
    const validated2 = await validateSqlAnalysis(run.result, run.snapshot, run.ingestion, ORG);
    expect(validated1).toEqual(run.result);
    expect(validated2).toEqual(run.result);
  });
});
