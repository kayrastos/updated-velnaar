import { beforeAll, describe, expect, it } from 'vitest';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { DETECTOR_VERSION } from '../../../../worker/intelligence/detection/types';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { CONTRACT_VERSION, computeCandidateBinding, createVerificationState, transitionVerificationState } from '../../../../worker/intelligence/contracts';
import { hash } from '../../../../worker/intelligence/ingestion/snapshot';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

describe('RM_SQLI_BOUND_DIR: direct SQL injection detector boundary rejection', () => {
  let directRun: Awaited<ReturnType<typeof analyzeInput>>;

  beforeAll(async () => {
    directRun = await analyzeInput(input(0));
  });

  it('confirms the baseline direct SQL injection fixture is detected with expected provenance', () => {
    const { snapshot, ingestion, result } = directRun;
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    expect(result.limitations).toEqual([]);
    expect(result.snapshotId).toBe(snapshot.snapshotId);
    expect(result.ingestionIdentity).toBe(ingestion.ingestionIdentity);
    expect(result.organizationId).toBe(ORG);
    const finding = result.findings[0];
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.symbol).toBe('db.prepare');
    expect(finding.vulnerabilityClass).toBe('SQL_INJECTION');
  });

  it('rejects foreign tenants at the direct detector and validator boundaries', async () => {
    const { snapshot, ingestion, result } = directRun;
    await expect(detectSqlInjection(snapshot, ingestion, 'foreign-org')).rejects.toThrow('tenant mismatch');
    await expect(validateSqlAnalysis(result, snapshot, ingestion, 'foreign-org')).rejects.toThrow('tenant mismatch');
    const bridge = createSqlCandidateBridge(async () => 'a'.repeat(40));
    await expect(bridge(result, snapshot, ingestion, 'foreign-org')).rejects.toThrow('tenant mismatch');
  });

  it('rejects snapshot-ingestion identity mismatch at the direct detector boundary', async () => {
    const otherSnapshot = (await analyzeInput(input(1))).snapshot;
    await expect(detectSqlInjection(otherSnapshot, directRun.ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
  });

  it('rejects non-opaque fixture identities and oracle metadata at the detector boundary', async () => {
    const { snapshot, ingestion } = directRun;
    await expect(detectSqlInjection({ ...snapshot, fixtureId: 'fixture-sqli-express-safe-twin-v1' }, ingestion, ORG))
      .rejects.toThrow('opaque case identity');
    for (const field of ['violationObserved', 'expectedSecurityState', 'attack', 'RecordedExecution']) {
      await expect(detectSqlInjection({ ...snapshot, [field]: true } as any, ingestion, ORG))
        .rejects.toThrow('unknown or missing metadata');
    }
  });

  it.each([
    'duplicate-flow',
    'flow-id',
    'source',
    'sink',
    'rule',
    'route',
    'fingerprint',
    'state',
    'vulnerability-class',
    'empty-findings',
  ])('rejects tampered direct result (%s) even with recalculated result fingerprint', async change => {
    const forged: any = structuredClone(directRun.result);
    if (change === 'duplicate-flow') forged.findings[0].flow.push(forged.findings[0].flow[0]);
    if (change === 'flow-id') forged.findings[0].flow[0].id = 'sha256:' + '0'.repeat(64);
    if (change === 'source') forged.findings[0].source.column++;
    if (change === 'sink') forged.findings[0].sink.filePath = 'src/decoy.ts';
    if (change === 'rule') forged.ruleId = 'other-rule';
    if (change === 'route') forged.findings[0].routeIdentity = 'forged-route-identity';
    if (change === 'state') forged.status = 'NOT_DETECTED';
    if (change === 'vulnerability-class') forged.findings[0].vulnerabilityClass = 'COMMAND_INJECTION';
    if (change === 'empty-findings') forged.findings = [];
    const { resultFingerprint, ...body } = forged;
    forged.resultFingerprint = change === 'fingerprint' ? resultFingerprint + 'x' : await hash(DETECTOR_VERSION, body);
    await expect(validateSqlAnalysis(forged, directRun.snapshot, directRun.ingestion, ORG))
      .rejects.toThrow('M3_ANALYSIS_INTEGRITY');
  });

  it('rejects getter accessors on direct result without invocation', async () => {
    const bad: any = structuredClone(directRun.result);
    let invoked = false;
    Object.defineProperty(bad.findings[0], 'source', {
      enumerable: true,
      get() {
        invoked = true;
        return {};
      },
    });
    await expect(validateSqlAnalysis(bad, directRun.snapshot, directRun.ingestion, ORG)).rejects.toThrow('data fields required');
    expect(invoked).toBe(false);
  });

  it('enforces candidate bridge integrity and verified commit boundary for direct detection', async () => {
    const { snapshot, ingestion, result } = directRun;
    const bridge = createSqlCandidateBridge(async () => 'a'.repeat(40));
    const hypotheses = await bridge(result, snapshot, ingestion, ORG);
    expect(hypotheses).toHaveLength(1);
    const { candidate, candidateBinding } = hypotheses[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(candidateBinding.startsWith(`${CONTRACT_VERSION}:FindingCandidate\n`)).toBe(true);
    expect(candidateBinding.startsWith('sha256:')).toBe(false);

    const state = createVerificationState(candidate, ORG);
    expect(state.state).toBe('CANDIDATE');
    await expect(transitionVerificationState(state, { type: 'COMPLETE', result: {} as any, evidence: {} as any }))
      .rejects.toThrow('COMPLETE requires pending');

    for (const invalidCommit of ['', 'invalid-sha', '0'.repeat(40)]) {
      const badBridge = createSqlCandidateBridge(async () => invalidCommit);
      await expect(badBridge(result, snapshot, ingestion, ORG)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
    }

    const forged: any = structuredClone(result);
    forged.findings[0].sink.symbol = 'other.sink';
    await expect(bridge(forged, snapshot, ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY');
  });

  it('fails closed to ANALYSIS_INCONCLUSIVE when direct route introduces unsupported syntax', async () => {
    const raw = replaceSource(input(0), source => source.replace('return res.json', 'while (true) {} return res.json'));
    const { result, snapshot, ingestion } = await analyzeInput(raw);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    const bridge = createSqlCandidateBridge(async () => 'a'.repeat(40));
    expect(await bridge(result, snapshot, ingestion, ORG)).toEqual([]);
  });
});
