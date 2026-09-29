import type {
  FulgorCorpusFamily,
  FulgorCorpusRole,
  FulgorCorpusVerdict,
} from '../corpusRecord';

import type {
  FulgorAdvisoryProvider,
} from '../sources/advisoryCandidate';

export const FULGOR_CORPUS_DRAFT_VERSION =
  'FULGOR_CORPUS_DRAFT_V1' as const;

export const FULGOR_HARD_NEGATIVE_REQUEST_VERSION =
  'FULGOR_HARD_NEGATIVE_REQUEST_V1' as const;

export interface FulgorCorpusDraft {
  schemaVersion:
    typeof FULGOR_CORPUS_DRAFT_VERSION;

  trustState:
    'CORPUS_DRAFT_REQUIRES_VERIFICATION';

  trainingAdmission:
    false;

  vulnerabilityTruthAuthority:
    false;

  sourceCandidateSha256:
    string;

  corpusGroupKey:
    string;

  provider:
    FulgorAdvisoryProvider;

  advisoryId:
    string;

  family:
    FulgorCorpusFamily;

  repository:
    string;

  role:
    Extract<
      FulgorCorpusRole,
      'VULNERABLE' | 'FIXED'
    >;

  expectedVerdict:
    Extract<
      FulgorCorpusVerdict,
      'CONFIRMED_RISK'
        | 'REJECT_CANDIDATE'
    >;

  materializedCommitSha:
    string;

  counterpartCommitSha:
    string;

  diffSha256:
    string;

  changedFiles:
    readonly string[];

  license: {
    spdxId: string;
    path: string;
    contentSha256: string;
  };

  verificationRequirements:
    readonly string[];

  draftSha256:
    string;
}

export interface FulgorHardNegativeRequest {
  schemaVersion:
    typeof FULGOR_HARD_NEGATIVE_REQUEST_VERSION;

  trustState:
    'HARD_NEGATIVE_GENERATION_REQUEST';

  trainingAdmission:
    false;

  generationAuthority:
    false;

  vulnerabilityTruthAuthority:
    false;

  requiresIndependentVerification:
    true;

  sourceCandidateSha256:
    string;

  corpusGroupKey:
    string;

  provider:
    FulgorAdvisoryProvider;

  advisoryId:
    string;

  family:
    FulgorCorpusFamily;

  repository:
    string;

  vulnerableCommitSha:
    string;

  fixedCommitSha:
    string;

  changedFiles:
    readonly string[];

  permittedTargets:
    readonly [
      'SEMANTICALLY_NEAR_SAFE_VARIANT',
      'INSUFFICIENT_EVIDENCE_VARIANT',
    ];

  requestSha256:
    string;
}

export interface CorpusDraftBundle {
  corpusGroupKey:
    string;

  vulnerableDraft:
    FulgorCorpusDraft;

  fixedDraft:
    FulgorCorpusDraft;

  hardNegativeRequest:
    FulgorHardNegativeRequest;
}