import {
  createHash,
} from 'node:crypto';

import {
  FULGOR_CORPUS_DRAFT_VERSION,
  FULGOR_HARD_NEGATIVE_REQUEST_VERSION,
} from './corpusDraft';

import {
  FULGOR_REVIEW_CANDIDATE_VERSION,
} from '../review/reviewCandidate';

import type {
  CorpusDraftBundle,
  FulgorCorpusDraft,
  FulgorHardNegativeRequest,
} from './corpusDraft';

import type {
  CorpusReviewCandidate,
} from '../review/reviewCandidate';

const SHA =
  /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

const SHA256 =
  /^[a-f0-9]{64}$/;

const REPOSITORY =
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function digest(
  value: unknown,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify(value),
      'utf8',
    )
    .digest('hex');
}

function assertCandidate(
  candidate:
    CorpusReviewCandidate,
): void {
  if (
    candidate.schemaVersion !==
      FULGOR_REVIEW_CANDIDATE_VERSION ||
    candidate.trustState !==
      'CORPUS_REVIEW_CANDIDATE'
  ) {
    throw new Error(
      'DRAFT_INVALID_REVIEW_CANDIDATE',
    );
  }

  if (
    (
      candidate as unknown as {
        trainingAdmission:
          boolean;
      }
    ).trainingAdmission !==
      false ||
    (
      candidate as unknown as {
        vulnerabilityTruthAuthority:
          boolean;
      }
    ).vulnerabilityTruthAuthority !==
      false
  ) {
    throw new Error(
      'DRAFT_AUTHORITY_ESCAPE',
    );
  }

  if (
    !candidate.evidence
      .exactIdentityAccepted ||
    !candidate.evidence
      .pairEvidenceAccepted ||
    !candidate.evidence
      .licenseReviewEligible ||
    !candidate.evidence
      .directParent ||
    candidate.evidence
      .licenseContinuity !==
      'MATCH'
  ) {
    throw new Error(
      'DRAFT_EVIDENCE_INCOMPLETE',
    );
  }

  if (
    !REPOSITORY.test(
      candidate.repository,
    )
  ) {
    throw new Error(
      'DRAFT_INVALID_REPOSITORY',
    );
  }

  if (
    !SHA.test(
      candidate
        .vulnerableCommitSha,
    ) ||
    !SHA.test(
      candidate
        .fixedCommitSha,
    ) ||
    candidate
      .vulnerableCommitSha ===
      candidate.fixedCommitSha
  ) {
    throw new Error(
      'DRAFT_INVALID_COMMIT_PAIR',
    );
  }

  if (
    !SHA256.test(
      candidate.diffSha256,
    ) ||
    !SHA256.test(
      candidate
        .candidateSha256,
    ) ||
    !SHA256.test(
      candidate.license
        .contentSha256,
    )
  ) {
    throw new Error(
      'DRAFT_INVALID_DIGEST',
    );
  }

  if (
    candidate.changedFiles
      .length === 0
  ) {
    throw new Error(
      'DRAFT_EMPTY_CHANGED_FILES',
    );
  }
}

function corpusGroupKey(
  candidate:
    CorpusReviewCandidate,
): string {
  return digest({
    provider:
      candidate.provider,

    advisoryId:
      candidate.advisoryId,

    repository:
      candidate.repository
        .toLowerCase(),

    vulnerableCommitSha:
      candidate
        .vulnerableCommitSha,

    fixedCommitSha:
      candidate
        .fixedCommitSha,
  });
}

function buildDraft(
  candidate:
    CorpusReviewCandidate,

  groupKey:
    string,

  role:
    'VULNERABLE' | 'FIXED',
): FulgorCorpusDraft {
  const vulnerable =
    role === 'VULNERABLE';

  const base = {
    schemaVersion:
      FULGOR_CORPUS_DRAFT_VERSION,

    trustState:
      'CORPUS_DRAFT_REQUIRES_VERIFICATION' as const,

    trainingAdmission:
      false as const,

    vulnerabilityTruthAuthority:
      false as const,

    sourceCandidateSha256:
      candidate
        .candidateSha256,

    corpusGroupKey:
      groupKey,

    provider:
      candidate.provider,

    advisoryId:
      candidate.advisoryId,

    family:
      candidate.family,

    repository:
      candidate.repository,

    role,

    expectedVerdict:
      vulnerable
        ? 'CONFIRMED_RISK' as const
        : 'REJECT_CANDIDATE' as const,

    materializedCommitSha:
      vulnerable
        ? candidate
            .vulnerableCommitSha
        : candidate
            .fixedCommitSha,

    counterpartCommitSha:
      vulnerable
        ? candidate
            .fixedCommitSha
        : candidate
            .vulnerableCommitSha,

    diffSha256:
      candidate.diffSha256,

    changedFiles:
      [...candidate.changedFiles]
        .sort(),

    license: {
      spdxId:
        candidate.license.spdxId,

      path:
        candidate.license.path,

      contentSha256:
        candidate.license
          .contentSha256,
    },

    verificationRequirements:
      vulnerable
        ? [
            'SOURCE_CONTENT_EXTRACTED_FROM_EXACT_COMMIT',
            'VULNERABLE_BEHAVIOR_INDEPENDENTLY_VERIFIED',
            'EXPECTED_EVIDENCE_AUTHORED',
            'EXPECTED_REMEDIATION_AUTHORED',
          ]
        : [
            'SOURCE_CONTENT_EXTRACTED_FROM_EXACT_COMMIT',
            'FIX_BEHAVIOR_INDEPENDENTLY_VERIFIED',
            'EXPECTED_EVIDENCE_AUTHORED',
            'EXPECTED_REMEDIATION_AUTHORED',
          ],
  };

  return {
    ...base,

    draftSha256:
      digest(base),
  };
}

function buildHardNegativeRequest(
  candidate:
    CorpusReviewCandidate,

  groupKey:
    string,
): FulgorHardNegativeRequest {
  const base = {
    schemaVersion:
      FULGOR_HARD_NEGATIVE_REQUEST_VERSION,

    trustState:
      'HARD_NEGATIVE_GENERATION_REQUEST' as const,

    trainingAdmission:
      false as const,

    generationAuthority:
      false as const,

    vulnerabilityTruthAuthority:
      false as const,

    requiresIndependentVerification:
      true as const,

    sourceCandidateSha256:
      candidate
        .candidateSha256,

    corpusGroupKey:
      groupKey,

    provider:
      candidate.provider,

    advisoryId:
      candidate.advisoryId,

    family:
      candidate.family,

    repository:
      candidate.repository,

    vulnerableCommitSha:
      candidate
        .vulnerableCommitSha,

    fixedCommitSha:
      candidate
        .fixedCommitSha,

    changedFiles:
      [...candidate.changedFiles]
        .sort(),

    permittedTargets:
      [
        'SEMANTICALLY_NEAR_SAFE_VARIANT',
        'INSUFFICIENT_EVIDENCE_VARIANT',
      ] as const,
  };

  return {
    ...base,

    requestSha256:
      digest(base),
  };
}

export function buildCorpusDraftBundle(
  candidate:
    CorpusReviewCandidate,
): CorpusDraftBundle {
  assertCandidate(
    candidate,
  );

  const groupKey =
    corpusGroupKey(
      candidate,
    );

  return {
    corpusGroupKey:
      groupKey,

    vulnerableDraft:
      buildDraft(
        candidate,
        groupKey,
        'VULNERABLE',
      ),

    fixedDraft:
      buildDraft(
        candidate,
        groupKey,
        'FIXED',
      ),

    hardNegativeRequest:
      buildHardNegativeRequest(
        candidate,
        groupKey,
      ),
  };
}