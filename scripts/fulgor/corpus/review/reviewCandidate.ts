import {
  createHash,
} from 'node:crypto';

import {
  resolveFamilyFromCwes,
} from './familyResolver';

import type {
  FulgorAdvisoryCandidate,
} from '../sources/advisoryCandidate';

import type {
  FulgorCorpusFamily,
} from '../corpusRecord';

import type {
  ExactIdentityResult,
} from '../validation/exactRepositoryIdentity';

import type {
  LicenseGateResult,
} from '../validation/licenseGate';

import type {
  RepositoryPairEvidence,
} from '../materialization/repositoryPairEvidence';

export const FULGOR_REVIEW_CANDIDATE_VERSION =
  'FULGOR_CORPUS_REVIEW_CANDIDATE_V1' as const;

export type ReviewCandidateFailureCode =
  | 'WITHDRAWN_ADVISORY'
  | 'FAMILY_UNRESOLVED'
  | 'FAMILY_AMBIGUOUS'
  | 'EXACT_IDENTITY_REJECTED'
  | 'PAIR_EVIDENCE_REJECTED'
  | 'LICENSE_REJECTED'
  | 'COMMIT_PAIR_MISMATCH'
  | 'INVALID_LICENSE_EVIDENCE';

export interface CorpusReviewCandidate {
  schemaVersion:
    typeof FULGOR_REVIEW_CANDIDATE_VERSION;

  trustState:
    'CORPUS_REVIEW_CANDIDATE';

  trainingAdmission:
    false;

  vulnerabilityTruthAuthority:
    false;

  provider:
    FulgorAdvisoryCandidate['provider'];

  advisoryId: string;

  sourceUrl: string;

  family:
    FulgorCorpusFamily;

  matchedCwes:
    readonly string[];

  repository: string;

  vulnerableCommitSha:
    string;

  fixedCommitSha:
    string;

  diffSha256:
    string;

  diffByteLength:
    number;

  changedFiles:
    readonly string[];

  license: {
    spdxId: string;
    path: string;
    contentSha256: string;
  };

  evidence: {
    exactIdentityAccepted:
      true;

    pairEvidenceAccepted:
      true;

    licenseReviewEligible:
      true;

    directParent:
      true;

    licenseContinuity:
      'MATCH';
  };

  createdAtUtc: string;

  candidateSha256: string;
}

export interface BuildReviewCandidateInput {
  advisory:
    FulgorAdvisoryCandidate;

  repository: string;

  vulnerableCommitSha:
    string;

  fixedCommitSha:
    string;

  exactIdentity:
    ExactIdentityResult;

  pairEvidence:
    RepositoryPairEvidence;

  licenseGate:
    LicenseGateResult;

  licenseSpdxId:
    string | null;

  createdAtUtc: string;
}

export interface BuildReviewCandidateResult {
  accepted: boolean;

  failureCodes:
    readonly ReviewCandidateFailureCode[];

  candidate:
    CorpusReviewCandidate | null;
}

function digestCandidate(
  input: {
    provider: string;
    advisoryId: string;
    sourceUrl: string;
    family: string;
    matchedCwes:
      readonly string[];
    repository: string;
    vulnerableCommitSha: string;
    fixedCommitSha: string;
    diffSha256: string;
    diffByteLength: number;
    changedFiles:
      readonly string[];
    licenseSpdxId: string;
    licensePath: string;
    licenseContentSha256: string;
  },
): string {
  const canonical =
    JSON.stringify({
      provider:
        input.provider,

      advisoryId:
        input.advisoryId,

      sourceUrl:
        input.sourceUrl,

      family:
        input.family,

      matchedCwes:
        [...input.matchedCwes]
          .sort(),

      repository:
        input.repository
          .toLowerCase(),

      vulnerableCommitSha:
        input.vulnerableCommitSha,

      fixedCommitSha:
        input.fixedCommitSha,

      diffSha256:
        input.diffSha256,

      diffByteLength:
        input.diffByteLength,

      changedFiles:
        [...input.changedFiles]
          .sort(),

      licenseSpdxId:
        input.licenseSpdxId,

      licensePath:
        input.licensePath,

      licenseContentSha256:
        input.licenseContentSha256,
    });

  return createHash('sha256')
    .update(
      canonical,
      'utf8',
    )
    .digest('hex');
}

export function buildCorpusReviewCandidate(
  input:
    BuildReviewCandidateInput,
): BuildReviewCandidateResult {
  const failures:
    ReviewCandidateFailureCode[] = [];

  if (
    input.advisory.withdrawnAtUtc !==
      null
  ) {
    failures.push(
      'WITHDRAWN_ADVISORY',
    );
  }

  const family =
    resolveFamilyFromCwes(
      input.advisory.cwes,
    );

  if (
    family.decision ===
      'UNRESOLVED'
  ) {
    failures.push(
      'FAMILY_UNRESOLVED',
    );
  }

  if (
    family.decision ===
      'AMBIGUOUS'
  ) {
    failures.push(
      'FAMILY_AMBIGUOUS',
    );
  }

  if (
    !input.exactIdentity
      .accepted
  ) {
    failures.push(
      'EXACT_IDENTITY_REJECTED',
    );
  }

  if (
    !input.pairEvidence
      .eligibleForCorpusReview
  ) {
    failures.push(
      'PAIR_EVIDENCE_REJECTED',
    );
  }

  if (
    input.licenseGate
      .decision !==
      'ELIGIBLE_FOR_CORPUS_REVIEW'
  ) {
    failures.push(
      'LICENSE_REJECTED',
    );
  }

  if (
    input.pairEvidence
      .vulnerableCommitSha !==
      input.vulnerableCommitSha ||
    input.pairEvidence
      .fixedCommitSha !==
      input.fixedCommitSha
  ) {
    failures.push(
      'COMMIT_PAIR_MISMATCH',
    );
  }

  const fixedLicense =
    input.pairEvidence
      .fixedLicense;

  const validLicense =
    input.licenseSpdxId !==
      null &&
    fixedLicense.state ===
      'SINGLE_ROOT_LICENSE' &&
    fixedLicense.path !==
      null &&
    fixedLicense.contentSha256 !==
      null;

  if (!validLicense) {
    failures.push(
      'INVALID_LICENSE_EVIDENCE',
    );
  }

  const uniqueFailures =
    [...new Set(failures)];

  if (
    uniqueFailures.length > 0 ||
    family.family === null ||
    input.licenseSpdxId ===
      null ||
    fixedLicense.path ===
      null ||
    fixedLicense.contentSha256 ===
      null
  ) {
    return {
      accepted: false,

      failureCodes:
        uniqueFailures,

      candidate: null,
    };
  }

  const candidateBase = {
    provider:
      input.advisory.provider,

    advisoryId:
      input.advisory.advisoryId,

    sourceUrl:
      input.advisory.sourceUrl,

    family:
      family.family,

    matchedCwes:
      family.matchedCwes,

    repository:
      input.repository,

    vulnerableCommitSha:
      input.vulnerableCommitSha,

    fixedCommitSha:
      input.fixedCommitSha,

    diffSha256:
      input.pairEvidence
        .diffSha256,

    diffByteLength:
      input.pairEvidence
        .diffByteLength,

    changedFiles:
      [...input.pairEvidence
        .changedFiles]
        .sort(),

    licenseSpdxId:
      input.licenseSpdxId,

    licensePath:
      fixedLicense.path,

    licenseContentSha256:
      fixedLicense
        .contentSha256,

    createdAtUtc:
      input.createdAtUtc,
  };

  const candidate:
    CorpusReviewCandidate = {
    schemaVersion:
      FULGOR_REVIEW_CANDIDATE_VERSION,

    trustState:
      'CORPUS_REVIEW_CANDIDATE',

    trainingAdmission:
      false,

    vulnerabilityTruthAuthority:
      false,

    provider:
      candidateBase.provider,

    advisoryId:
      candidateBase.advisoryId,

    sourceUrl:
      candidateBase.sourceUrl,

    family:
      candidateBase.family,

    matchedCwes:
      candidateBase.matchedCwes,

    repository:
      candidateBase.repository,

    vulnerableCommitSha:
      candidateBase
        .vulnerableCommitSha,

    fixedCommitSha:
      candidateBase
        .fixedCommitSha,

    diffSha256:
      candidateBase.diffSha256,

    diffByteLength:
      candidateBase
        .diffByteLength,

    changedFiles:
      candidateBase.changedFiles,

    license: {
      spdxId:
        candidateBase
          .licenseSpdxId,

      path:
        candidateBase
          .licensePath,

      contentSha256:
        candidateBase
          .licenseContentSha256,
    },

    evidence: {
      exactIdentityAccepted:
        true,

      pairEvidenceAccepted:
        true,

      licenseReviewEligible:
        true,

      directParent:
        true,

      licenseContinuity:
        'MATCH',
    },

    createdAtUtc:
      candidateBase
        .createdAtUtc,

    candidateSha256:
      digestCandidate(
        candidateBase,
      ),
  };

  return {
    accepted: true,
    failureCodes: [],
    candidate,
  };
}