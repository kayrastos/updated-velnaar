import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  computeCandidateBinding,
  createVerificationState,
  transitionVerificationState,
  validateFindingCandidate,
} from '../../../../worker/intelligence/contracts';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import {
  validateSqlAnalysis,
} from '../../../../worker/intelligence/detection/sqlInjection';
import {
  ANALYSIS_LIMITS,
  DETECTOR_VERSION,
} from '../../../../worker/intelligence/detection/types';
import { canonical, hash } from '../../../../worker/intelligence/ingestion/snapshot';
import {
  analyzeInput,
  input,
  replaceSource,
  ORG,
} from '../../../intelligence/m3/support/inputs';

describe('discovery-intelligence: SQL injection multi-stage provenance integrity', () => {
  it('traces multi-stage variable and concatenation flows with ordered provenance steps', async () => {
    const raw = replaceSource(input(), content =>
      content
        .replace(
          'return res.json',
          'const stage1 = req.query.q; const stage2 = stage1; const stage3 = "prefix " + stage2; const stage4 = stage3 + " suffix"; return res.json'
        )
        .replace('" + req.query.q + "', '" + stage4 + "')
    );
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);

    const finding = result.findings[0];
    expect(finding.flow[0].kind).toBe('SOURCE');
    expect(finding.flow[0].location.symbol).toBe('query.q');
    expect(finding.flow.at(-1)!.kind).toBe('SINK');
    expect(finding.flow.at(-1)!.location.symbol).toBe('db.prepare');

    const variables = finding.flow
      .filter(step => step.kind === 'VARIABLE')
      .map(step => step.location.symbol);
    expect(variables).toEqual(['stage1', 'stage2', 'stage3', 'stage4']);

    const concats = finding.flow.filter(step => step.kind === 'CONCAT');
    expect(concats.length).toBeGreaterThanOrEqual(2);

    expect(new Set(finding.flow.map(step => step.id)).size).toBe(finding.flow.length);
    for (const step of finding.flow) {
      expect(step.id).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(step.location.filePath).toBe('src/routes.ts');
      expect(step.location.line).toBeGreaterThan(0);
      expect(step.location.column).toBeGreaterThan(0);
    }

    const { resultFingerprint, ...body } = result;
    const expectedFingerprint =
      'sha256:' +
      createHash('sha256')
        .update(DETECTOR_VERSION + '\n' + canonical(body))
        .digest('hex');
    expect(resultFingerprint).toBe(expectedFingerprint);
  });

  it('verifies multi-stage helper call-argument-return pipeline provenance (fixture 5)', async () => {
    const { result } = await analyzeInput(input(5));
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);

    const finding = result.findings[0];
    const kinds = finding.flow.map(step => step.kind);
    expect(kinds[0]).toBe('SOURCE');
    expect(kinds.at(-1)).toBe('SINK');

    const callSymbols = finding.flow
      .filter(step => step.kind === 'CALL')
      .map(step => step.location.symbol);
    expect(callSymbols).toEqual(['lookup', 'buildQuery']);

    const argSteps = finding.flow.filter(step => step.kind === 'ARGUMENT');
    expect(argSteps).toHaveLength(2);

    const returnSteps = finding.flow.filter(step => step.kind === 'RETURN');
    expect(returnSteps.length).toBeGreaterThanOrEqual(1);

    expect(new Set(finding.flow.map(step => step.id)).size).toBe(finding.flow.length);
    expect(finding.flow.length).toBeLessThanOrEqual(ANALYSIS_LIMITS.flowLength);
  });

  it('rejects tampering with any intermediate stage in the multi-stage flow', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(5));
    expect(result.status).toBe('DETECTED');

    const forgedCall: any = structuredClone(result);
    const callStep = forgedCall.findings[0].flow.find((s: any) => s.kind === 'CALL');
    callStep.location.symbol = 'tamperedCall';
    const { resultFingerprint: _f1, ...body1 } = forgedCall;
    forgedCall.resultFingerprint = await hash(DETECTOR_VERSION, body1);
    await expect(validateSqlAnalysis(forgedCall, snapshot, ingestion, ORG)).rejects.toThrow(
      'M3_ANALYSIS_INTEGRITY'
    );

    const forgedOmission: any = structuredClone(result);
    forgedOmission.findings[0].flow.splice(1, 1);
    const { resultFingerprint: _f2, ...body2 } = forgedOmission;
    forgedOmission.resultFingerprint = await hash(DETECTOR_VERSION, body2);
    await expect(validateSqlAnalysis(forgedOmission, snapshot, ingestion, ORG)).rejects.toThrow(
      'M3_ANALYSIS_INTEGRITY'
    );

    const forgedId: any = structuredClone(result);
    forgedId.findings[0].flow[1].id = 'sha256:' + '0'.repeat(64);
    const { resultFingerprint: _f3, ...body3 } = forgedId;
    forgedId.resultFingerprint = await hash(DETECTOR_VERSION, body3);
    await expect(validateSqlAnalysis(forgedId, snapshot, ingestion, ORG)).rejects.toThrow(
      'M3_ANALYSIS_INTEGRITY'
    );
  });

  it('fails closed when multi-stage flow has broken taint, multi-source joins, or budget limits', async () => {
    const safeBreak = replaceSource(input(), content =>
      content
        .replace(
          'return res.json',
          'const stage1 = req.query.q; const stage2 = "safe_constant"; const stage3 = stage2; return res.json'
        )
        .replace('" + req.query.q + "', '" + stage3 + "')
    );
    const runBreak = await analyzeInput(safeBreak);
    expect(runBreak.result.status).toBe('NOT_DETECTED');
    expect(runBreak.result.findings).toHaveLength(0);

    const multiSource = replaceSource(input(), source =>
      source.replace('req.query.q', '(req.query.q + req.query.other)')
    );
    const runMulti = await analyzeInput(multiSource);
    expect(runMulti.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(runMulti.result.limitations).toHaveLength(1);
    expect(runMulti.result.limitations[0].code).toBe('MULTIPLE_SOURCES');

    const declarations = [
      'const x0 = req.query.q',
      ...Array.from(
        { length: ANALYSIS_LIMITS.flowLength + 1 },
        (_, i) => 'const x' + (i + 1) + ' = x' + i
      ),
    ].join('; ');
    const rawBudget = replaceSource(input(), source =>
      source.replace('return res.json', declarations + '; return res.json')
    );
    const runBudget = await analyzeInput(rawBudget);
    expect(runBudget.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(runBudget.result.limitations).toHaveLength(1);
    expect(runBudget.result.limitations[0].code).toBe('FLOW_BUDGET');
  });

  it('binds multi-stage finding into FindingCandidate preserving CANDIDATE state and non-promotability', async () => {
    const run = await analyzeInput(input(5));
    const mockCommit = '46db4c208f886afda939c04ae93580fbabd57344';
    const bridge = createSqlCandidateBridge(async () => mockCommit);
    const output = await bridge(run.result, run.snapshot, run.ingestion, ORG);

    expect(output).toHaveLength(1);
    const { candidate, candidateBinding } = output[0];

    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.snapshot.commitSha).toBe(mockCommit);
    expect(candidate.sensorEvidence[0].rawEvidenceFingerprint).toBe(run.result.resultFingerprint);
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);

    const state = createVerificationState(candidate, ORG);
    expect(state.state).toBe('CANDIDATE');
    await expect(
      transitionVerificationState(state, {
        type: 'COMPLETE',
        result: { result: 'VERIFIED' },
        evidence: run.result,
      })
    ).rejects.toThrow('COMPLETE requires pending');
  });
});
