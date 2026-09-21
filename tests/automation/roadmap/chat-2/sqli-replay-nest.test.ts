import { describe, expect, it } from 'vitest';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import {
  computeCandidateBinding,
  computeEvidenceHash,
  createVerificationState,
  transitionVerificationState,
  type FindingCandidate,
} from '../../../../worker/intelligence/contracts';
import { ANALYSIS_LIMITS } from '../../../../worker/intelligence/detection/types';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';
import { fixture } from '../../../intelligence/fixtures';
import { currentCodeCommit, verifyCommittedFixture } from '../../../intelligence/m2/support/gitCodeState';

async function proof(candidate: FindingCandidate) {
  const f = await fixture(), binding = computeCandidateBinding(candidate, ORG);
  const fields = {
    organizationId: ORG,
    candidateId: candidate.candidateId,
    candidateBinding: binding,
    snapshotId: candidate.snapshot.snapshotId,
    commitSha: candidate.snapshot.commitSha,
  };
  const q = { ...f.q, ...fields };
  const { evidenceHash, ...originalBody } = f.e;
  const body = { ...originalBody, ...fields, repositoryId: candidate.snapshot.repositoryId };
  const e = { ...body, evidenceHash: await computeEvidenceHash(body, q, candidate, ORG) };
  return { q, e, r: { ...f.r, ...fields } };
}

describe('V1 roadmap chat-2: SQL injection detector replay determinism on nested router fixtures', () => {
  it('nested router analysis produces bit-for-bit identical results and fingerprints across repeated runs', async () => {
    const run1 = await analyzeInput(input(7));
    const run2 = await analyzeInput(input(7));
    expect(run1.result.status).toBe('DETECTED');
    expect(run2.result.status).toBe('DETECTED');
    expect(run1.result).toEqual(run2.result);
    expect(run1.result.resultFingerprint).toBe(run2.result.resultFingerprint);
    expect(run1.result.snapshotId).toBe(run2.result.snapshotId);
    expect(run1.result.ingestionIdentity).toBe(run2.result.ingestionIdentity);
    expect(run1.result.findings).toHaveLength(1);
    expect(run1.result.findings[0].findingId).toBe(run2.result.findings[0].findingId);
    expect(run1.result.findings[0].routeIdentity).toBe(run2.result.findings[0].routeIdentity);
    expect(run1.result.findings[0].flow).toEqual(run2.result.findings[0].flow);
  });

  it('reordering files in nested router input preserves snapshot ID, route identity, and detection fingerprint', async () => {
    const raw = input(7);
    const reversed = { ...raw, files: [...raw.files].reverse() };
    const standardRun = await analyzeInput(raw);
    const reversedRun = await analyzeInput(reversed);
    expect(reversedRun.snapshot.snapshotId).toBe(standardRun.snapshot.snapshotId);
    expect(reversedRun.ingestion.ingestionIdentity).toBe(standardRun.ingestion.ingestionIdentity);
    expect(reversedRun.result).toEqual(standardRun.result);
    expect(reversedRun.result.resultFingerprint).toBe(standardRun.result.resultFingerprint);
  });

  it('nested router finding flow maintains deterministic unique step IDs and bounded flow length', async () => {
    const { result, ingestion } = await analyzeInput(input(7));
    const finding = result.findings[0];
    const route = ingestion.routes[0];
    expect(route.path).toBe('/api/search');
    expect(finding.routeIdentity).toBe(route.routeIdentity);
    expect(finding.flow[0].kind).toBe('SOURCE');
    expect(finding.flow.at(-1)!.kind).toBe('SINK');
    expect(new Set(finding.flow.map(step => step.id)).size).toBe(finding.flow.length);
    expect(finding.flow.length).toBeLessThanOrEqual(ANALYSIS_LIMITS.flowLength);
  });

  it('nested router analysis recomputes and validates via validateSqlAnalysis, rejecting tampered routeIdentity on replay', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(7));
    const validated = await validateSqlAnalysis(result, snapshot, ingestion, ORG);
    expect(validated).toEqual(result);

    const tampered = structuredClone(result) as any;
    tampered.findings[0].routeIdentity = 'forged-route-id';
    await expect(validateSqlAnalysis(tampered, snapshot, ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY');
  });

  it('candidate bridge deterministically constructs identical candidate hypotheses with matching bindings on replay', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(7));
    const bridge = createSqlCandidateBridge(verifyCommittedFixture);
    const candidates1 = await bridge(result, snapshot, ingestion, ORG);
    const candidates2 = await bridge(result, snapshot, ingestion, ORG);
    expect(candidates1).toHaveLength(1);
    expect(candidates1).toEqual(candidates2);
    const { candidate, candidateBinding } = candidates1[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.context.routeId).toBe(result.findings[0].routeIdentity);
    expect(candidate.snapshot.commitSha).toBe(currentCodeCommit());
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
  });

  it('nested candidate proof transitions to VERIFIED, but replaying proof with tampered candidate is rejected', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(input(7));
    const bridge = createSqlCandidateBridge(verifyCommittedFixture);
    const [{ candidate }] = await bridge(result, snapshot, ingestion, ORG);
    const { q, e, r } = await proof(candidate);

    const start = createVerificationState(candidate, ORG);
    const pending = await transitionVerificationState(start, { type: 'BEGIN', request: q });
    const completed = await transitionVerificationState(pending, { type: 'COMPLETE', result: r, evidence: e });
    expect(completed.state).toBe('VERIFIED');
    expect(completed.result.candidateBinding).toBe(computeCandidateBinding(candidate, ORG));

    const tamperedCandidate = structuredClone(candidate);
    (tamperedCandidate as any).context.routeId = 'POST.search';
    const tamperedBinding = computeCandidateBinding(tamperedCandidate, ORG);
    const tamperedInitial = createVerificationState(tamperedCandidate, ORG);
    const qb = { ...q, candidateBinding: tamperedBinding, createdAt: tamperedCandidate.createdAt };
    const rb = { ...r, candidateBinding: tamperedBinding };
    const tamperedPending = await transitionVerificationState(tamperedInitial, { type: 'BEGIN', request: qb });
    await expect(transitionVerificationState(tamperedPending, {
      type: 'COMPLETE',
      result: rb,
      evidence: e,
    })).rejects.toThrow('candidateBinding mismatch');
  });

  it('nested router registration order mismatch deterministically yields ANALYSIS_INCONCLUSIVE ROUTE_MISMATCH across replays', async () => {
    const mutated = replaceSource(input(7), source => source.replace(
      "router.get('/search', searchRoute);\n  app.use('/api', router);",
      "app.use('/api', router);\n  router.get('/search', searchRoute);"
    ));
    const run1 = await analyzeInput(mutated);
    const run2 = await analyzeInput(mutated);
    expect(run1.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run2.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run1.result.limitations[0].code).toBe('ROUTE_MISMATCH');
    expect(run1.result).toEqual(run2.result);
    expect(run1.result.resultFingerprint).toBe(run2.result.resultFingerprint);
  });
});
