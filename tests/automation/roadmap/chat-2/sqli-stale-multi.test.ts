import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  computeCandidateBinding,
  computeEvidenceHash,
  createVerificationState,
  transitionVerificationState,
  validateFindingCandidate,
  type FindingCandidate,
} from '../../../../worker/intelligence/contracts';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import {
  detectSqlInjection,
  validateSqlAnalysis,
} from '../../../../worker/intelligence/detection/sqlInjection';
import { currentCodeCommit, verifyCommittedFixture } from '../../../intelligence/m2/support/gitCodeState';
import { fixture } from '../../../intelligence/fixtures';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

const bridge = createSqlCandidateBridge(verifyCommittedFixture);
let runs: Awaited<ReturnType<typeof analyzeInput>>[];

beforeAll(async () => {
  runs = [];
  for (let i = 0; i < 3; i++) {
    runs.push(await analyzeInput(input(i)));
  }
});

async function proof(candidate: FindingCandidate) {
  const f = await fixture();
  const binding = computeCandidateBinding(candidate, ORG);
  const fields = {
    organizationId: ORG,
    candidateId: candidate.candidateId,
    candidateBinding: binding,
    snapshotId: candidate.snapshot.snapshotId,
    commitSha: candidate.snapshot.commitSha,
  };
  const q = { ...f.q, ...fields };
  const { evidenceHash: _old, ...originalBody } = f.e;
  const body = { ...originalBody, ...fields, repositoryId: candidate.snapshot.repositoryId };
  const e = { ...body, evidenceHash: await computeEvidenceHash(body, q, candidate, ORG) };
  return { q, e, r: { ...f.r, ...fields } };
}

describe('roadmap chat-2: SQLi detector multi-stage stale-state rejection', () => {
  it('rejects stale ingestion coupled with an advanced snapshot', async () => {
    await expect(
      detectSqlInjection(runs[1].snapshot, runs[0].ingestion, ORG),
    ).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
  });

  it('rejects stale analysis result from prior stage when validated against a different snapshot', async () => {
    await expect(
      validateSqlAnalysis(runs[0].result, runs[1].snapshot, runs[1].ingestion, ORG),
    ).rejects.toThrow('M3_ANALYSIS_INTEGRITY');
  });

  it('rejects forged stale result whose snapshotId was altered to match a newer snapshot', async () => {
    const forged = structuredClone(runs[0].result);
    (forged as any).snapshotId = runs[1].snapshot.snapshotId;
    await expect(
      validateSqlAnalysis(forged, runs[1].snapshot, runs[1].ingestion, ORG),
    ).rejects.toThrow('M3_ANALYSIS_INTEGRITY');
  });

  it('candidate bridge rejects stale analysis result before invoking commit verification', async () => {
    const verify = vi.fn();
    const staleBridge = createSqlCandidateBridge(verify);
    await expect(
      staleBridge(runs[0].result, runs[1].snapshot, runs[1].ingestion, ORG),
    ).rejects.toThrow('M3_ANALYSIS_INTEGRITY');
    expect(verify).not.toHaveBeenCalled();
  });

  it('candidate bridge rejects uncommitted working fixture mutations as stale code', async () => {
    const mutated = await analyzeInput(
      replaceSource(input(0), source => source + '\n// stale working modification'),
    );
    expect(mutated.result.status).toBe('DETECTED');
    await expect(
      bridge(mutated.result, mutated.snapshot, mutated.ingestion, ORG),
    ).rejects.toThrow('working fixture changed before commit seal');
  });

  it.each([
    ['empty', ''],
    ['malformed', 'not-a-sha'],
    ['all-zero', '0000000000000000000000000000000000000000'],
  ])('candidate bridge rejects %s verifier commit identity as stale or invalid', async (_label, commitSha) => {
    const modeledBridge = createSqlCandidateBridge(async () => commitSha);
    await expect(
      modeledBridge(runs[0].result, runs[0].snapshot, runs[0].ingestion, ORG),
    ).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
  });

  it('verification state machine rejects direct completion from stale pre-transition CANDIDATE state', async () => {
    const hypotheses = await bridge(runs[0].result, runs[0].snapshot, runs[0].ingestion, ORG);
    expect(hypotheses).toHaveLength(1);
    const { candidate } = hypotheses[0];
    const { r, e } = await proof(candidate);
    const start = createVerificationState(candidate, ORG);
    await expect(
      transitionVerificationState(start, { type: 'COMPLETE', result: r, evidence: e }),
    ).rejects.toThrow('COMPLETE requires pending verification');
  });

  it('verification state machine rejects stale request binding on newer candidate', async () => {
    const hypotheses = await bridge(runs[0].result, runs[0].snapshot, runs[0].ingestion, ORG);
    const { candidate } = hypotheses[0];
    const { q } = await proof(candidate);
    const advancedCandidate: FindingCandidate = {
      ...candidate,
      source: { ...candidate.source, symbol: 'query.other' },
    };
    const nextStart = createVerificationState(advancedCandidate, ORG);
    await expect(
      transitionVerificationState(nextStart, { type: 'BEGIN', request: q }),
    ).rejects.toThrow('candidateBinding mismatch');
  });

  it('verification state machine rejects stale evidence artifact from earlier candidate stage', async () => {
    const hypotheses = await bridge(runs[0].result, runs[0].snapshot, runs[0].ingestion, ORG);
    const { candidate } = hypotheses[0];
    const { e } = await proof(candidate);
    const advancedCandidate: FindingCandidate = {
      ...candidate,
      sink: { ...candidate.sink, symbol: 'db.other' },
    };
    const nextBinding = computeCandidateBinding(advancedCandidate, ORG);
    const nextStart = createVerificationState(advancedCandidate, ORG);
    const nextProof = await proof(advancedCandidate);
    const pending = await transitionVerificationState(nextStart, {
      type: 'BEGIN',
      request: nextProof.q,
    });
    await expect(
      transitionVerificationState(pending, {
        type: 'COMPLETE',
        result: nextProof.r,
        evidence: e,
      }),
    ).rejects.toThrow('candidateBinding mismatch');
    await expect(
      transitionVerificationState(pending, {
        type: 'COMPLETE',
        result: nextProof.r,
        evidence: { ...e, candidateBinding: nextBinding },
      }),
    ).rejects.toThrow('evidenceHash mismatch');
  });

  it('verification state machine rejects stale commit proof replayed against a new commit candidate', async () => {
    const hypotheses = await bridge(runs[0].result, runs[0].snapshot, runs[0].ingestion, ORG);
    const { candidate } = hypotheses[0];
    const { e } = await proof(candidate);
    const newCommitCandidate: FindingCandidate = {
      ...candidate,
      snapshot: { ...candidate.snapshot, commitSha: 'c'.repeat(40) },
    };
    const newBinding = computeCandidateBinding(newCommitCandidate, ORG);
    const newFields = {
      candidateBinding: newBinding,
      commitSha: newCommitCandidate.snapshot.commitSha,
    };
    const pending = await transitionVerificationState(
      createVerificationState(newCommitCandidate, ORG),
      { type: 'BEGIN', request: { ...(await proof(newCommitCandidate)).q, ...newFields } },
    );
    await expect(
      transitionVerificationState(pending, {
        type: 'COMPLETE',
        result: { ...(await proof(newCommitCandidate)).r, ...newFields },
        evidence: e,
      }),
    ).rejects.toThrow('commitSha mismatch');
  });
});
