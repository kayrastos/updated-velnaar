import {
  isStrictUtcTimestamp,
} from '../validation/strictUtcTimestamp';

import {
  createHash,
} from 'node:crypto';

import {
  FULGOR_CORPUS_SCHEMA_VERSION,
} from '../corpusRecord';

import {
  FULGOR_HARD_NEGATIVE_REQUEST_VERSION,
} from '../factory/corpusDraft';

import {
  evaluateLicenseEvidence,
} from '../validation/licenseGate';

import {
  validateCorpusRecord,
} from '../validation/provenanceValidator';

import type {
  FulgorCorpusProofType,
  FulgorCorpusRecord,
  FulgorCorpusVerdict,
} from '../corpusRecord';

import type {
  FulgorHardNegativeRequest,
} from '../factory/corpusDraft';

export const FULGOR_HARD_NEGATIVE_CANDIDATE_VERSION =
  'FULGOR_HARD_NEGATIVE_CANDIDATE_V1' as const;

export const FULGOR_HARD_NEGATIVE_VERIFICATION_RECEIPT_VERSION =
  'FULGOR_HARD_NEGATIVE_VERIFICATION_RECEIPT_V1' as const;

const SHA =
  /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

const SHA256 =
  /^[a-f0-9]{64}$/;

const ALLOWED_METHODS =
  new Set([
    'EXECUTABLE',
    'STATIC_ANALYSIS',
  ]);

export type HardNegativeTarget =
  FulgorHardNegativeRequest[
    'permittedTargets'
  ][number];

export type HardNegativeVerificationMethod =
  | 'EXECUTABLE'
  | 'STATIC_ANALYSIS';

export type HardNegativeObservedVerdict =
  Extract<
    FulgorCorpusVerdict,
    'REJECT_CANDIDATE'
      | 'NEEDS_MORE_EVIDENCE'
  >;

export interface HardNegativeCandidatePayload {
  target:
    HardNegativeTarget;

  materializedCommitSha:
    string;

  sourceArtifactPaths:
    readonly string[];

  sourceArtifactSha256:
    string;

  license: {
    spdxId:
      string;

    path:
      string;

    contentSha256:
      string;

    detectedFromMaterializedRevision:
      true;
  };
}

export interface FulgorHardNegativeCandidate {
  schemaVersion:
    typeof FULGOR_HARD_NEGATIVE_CANDIDATE_VERSION;

  trustState:
    'HARD_NEGATIVE_CANDIDATE_REQUIRES_INDEPENDENT_VERIFICATION';

  trainingAdmission:
    false;

  generationAuthority:
    false;

  vulnerabilityTruthAuthority:
    false;

  requiresIndependentVerification:
    true;

  requestSha256:
    string;

  sourceCandidateSha256:
    string;

  corpusGroupKey:
    string;

  repository:
    string;

  family:
    FulgorHardNegativeRequest['family'];

  target:
    HardNegativeTarget;

  materializedCommitSha:
    string;

  sourceArtifactPaths:
    readonly string[];

  sourceArtifactSha256:
    string;

  license:
    HardNegativeCandidatePayload['license'];

  candidateSha256:
    string;
}

export interface HardNegativeVerificationReceiptPayload {
  observedVerdict:
    HardNegativeObservedVerdict;

  verificationMethods:
    readonly HardNegativeVerificationMethod[];

  verificationPassed:
    true;

  independentVerifier:
    true;

  executedAgainstExactMaterialization:
    true;

  referencePairContrastVerified:
    true;

  verificationArtifactSha256:
    string;

  notes:
    readonly string[];

  verifiedAtUtc:
    string;
}

export interface HardNegativeVerificationReceipt
extends HardNegativeVerificationReceiptPayload {
  schemaVersion:
    typeof FULGOR_HARD_NEGATIVE_VERIFICATION_RECEIPT_VERSION;

  trustState:
    'INDEPENDENT_HARD_NEGATIVE_VERIFICATION_RECEIPT';

  requestSha256:
    string;

  candidateSha256:
    string;

  materializedCommitSha:
    string;

  sourceArtifactSha256:
    string;

  receiptSha256:
    string;
}

export interface HardNegativeAuthoredContent {
  prompt:
    string;

  expectedEvidence:
    readonly string[];

  expectedRemediation:
    readonly string[];
}

export type HardNegativeAdmissionFailureCode =
  | 'INVALID_REQUEST_STATE'
  | 'REQUEST_DIGEST_MISMATCH'
  | 'INVALID_CANDIDATE_STATE'
  | 'REQUEST_BINDING_MISMATCH'
  | 'TARGET_NOT_PERMITTED'
  | 'INVALID_MATERIALIZED_COMMIT'
  | 'REFERENCE_PAIR_REUSE'
  | 'INVALID_SOURCE_ARTIFACT'
  | 'SOURCE_SCOPE_MISMATCH'
  | 'INVALID_LICENSE_EVIDENCE'
  | 'CANDIDATE_DIGEST_MISMATCH'
  | 'INVALID_RECEIPT_STATE'
  | 'RECEIPT_BINDING_MISMATCH'
  | 'RECEIPT_DIGEST_MISMATCH'
  | 'INVALID_HARD_NEGATIVE_VERDICT'
  | 'VERIFICATION_NOT_INDEPENDENT'
  | 'EXACT_MATERIALIZATION_NOT_VERIFIED'
  | 'REFERENCE_PAIR_CONTRAST_NOT_VERIFIED'
  | 'VERIFICATION_FAILED'
  | 'INSUFFICIENT_VERIFICATION_METHOD'
  | 'INVALID_VERIFICATION_ARTIFACT'
  | 'INVALID_VERIFICATION_TIME'
  | 'INVALID_AUTHORED_CONTENT'
  | 'CANONICAL_RECORD_REJECTED';

export interface HardNegativeAdmissionResult {
  accepted:
    boolean;

  state:
    | 'VERIFIED_HARD_NEGATIVE_REQUIRES_MANIFEST_ADMISSION'
    | 'REJECTED';

  trainingManifestAdmission:
    false;

  failureCodes:
    readonly HardNegativeAdmissionFailureCode[];

  canonicalValidationFailures:
    readonly string[];

  record:
    FulgorCorpusRecord | null;
}

function digest(
  value: unknown,
): string {
  return createHash(
    'sha256',
  )
    .update(
      JSON.stringify(
        value,
      ),
      'utf8',
    )
    .digest(
      'hex',
    );
}

function nonEmpty(
  value: string,
): boolean {
  return value
    .trim()
    .length > 0;
}

function sortedUnique(
  values:
    readonly string[],
): string[] {
  return [
    ...new Set(
      values,
    ),
  ].sort();
}

export function recomputeHardNegativeRequestSha256(
  request:
    FulgorHardNegativeRequest,
): string {
  const {
    requestSha256:
      _requestSha256,
    ...core
  } = request;

  return digest(
    core,
  );
}

function validRequestState(
  request:
    FulgorHardNegativeRequest,
): boolean {
  return (
    request.schemaVersion ===
      FULGOR_HARD_NEGATIVE_REQUEST_VERSION &&
    request.trustState ===
      'HARD_NEGATIVE_GENERATION_REQUEST' &&
    (
      request as unknown as {
        trainingAdmission:
          boolean;
      }
    ).trainingAdmission ===
      false &&
    (
      request as unknown as {
        generationAuthority:
          boolean;
      }
    ).generationAuthority ===
      false &&
    (
      request as unknown as {
        vulnerabilityTruthAuthority:
          boolean;
      }
    ).vulnerabilityTruthAuthority ===
      false &&
    (
      request as unknown as {
        requiresIndependentVerification:
          boolean;
      }
    ).requiresIndependentVerification ===
      true
  );
}

export function recomputeHardNegativeCandidateSha256(
  candidate:
    FulgorHardNegativeCandidate,
): string {
  const {
    candidateSha256:
      _candidateSha256,
    ...core
  } = candidate;

  return digest(
    core,
  );
}

export function createHardNegativeCandidate(
  request:
    FulgorHardNegativeRequest,

  payload:
    HardNegativeCandidatePayload,
): FulgorHardNegativeCandidate {
  if (
    !validRequestState(
      request,
    ) ||
    recomputeHardNegativeRequestSha256(
      request,
    ) !== request.requestSha256
  ) {
    throw new Error(
      'HARD_NEGATIVE_INVALID_REQUEST',
    );
  }

  if (
    !request.permittedTargets
      .includes(
        payload.target,
      )
  ) {
    throw new Error(
      'HARD_NEGATIVE_TARGET_NOT_PERMITTED',
    );
  }

  if (
    !SHA.test(
      payload.materializedCommitSha,
    )
  ) {
    throw new Error(
      'HARD_NEGATIVE_INVALID_MATERIALIZED_COMMIT',
    );
  }

  /*
   * The hard negative must be a third exact revision.
   * Re-labelling the already-paired vulnerable or fixed revision
   * would not create an independent hard negative.
   */
  if (
    payload.materializedCommitSha ===
      request.vulnerableCommitSha ||
    payload.materializedCommitSha ===
      request.fixedCommitSha
  ) {
    throw new Error(
      'HARD_NEGATIVE_REFERENCE_PAIR_REUSE',
    );
  }

  const sourceArtifactPaths =
    sortedUnique(
      payload.sourceArtifactPaths,
    );

  if (
    sourceArtifactPaths.length === 0 ||
    sourceArtifactPaths.some(
      (path) =>
        !nonEmpty(
          path,
        ),
    )
  ) {
    throw new Error(
      'HARD_NEGATIVE_INVALID_SOURCE_ARTIFACT',
    );
  }

  /*
   * V1 keeps hard-negative evidence inside the exact changed-file
   * scope of the verified reference pair.
   */
  if (
    sourceArtifactPaths.some(
      (path) =>
        !request.changedFiles
          .includes(
            path,
          ),
    )
  ) {
    throw new Error(
      'HARD_NEGATIVE_SOURCE_SCOPE_MISMATCH',
    );
  }

  if (
    !SHA256.test(
      payload.sourceArtifactSha256,
    )
  ) {
    throw new Error(
      'HARD_NEGATIVE_INVALID_SOURCE_ARTIFACT',
    );
  }

  const license =
    evaluateLicenseEvidence({
      spdxId:
        payload.license.spdxId,

      licenseFilePath:
        payload.license.path,

      licenseContentSha256:
        payload.license
          .contentSha256,

      detectedFromMaterializedRevision:
        payload.license
          .detectedFromMaterializedRevision,
    });

  if (
    license.decision !==
    'ELIGIBLE_FOR_CORPUS_REVIEW'
  ) {
    throw new Error(
      'HARD_NEGATIVE_INVALID_LICENSE_EVIDENCE',
    );
  }

  const core = {
    schemaVersion:
      FULGOR_HARD_NEGATIVE_CANDIDATE_VERSION,

    trustState:
      'HARD_NEGATIVE_CANDIDATE_REQUIRES_INDEPENDENT_VERIFICATION' as const,

    trainingAdmission:
      false as const,

    generationAuthority:
      false as const,

    vulnerabilityTruthAuthority:
      false as const,

    requiresIndependentVerification:
      true as const,

    requestSha256:
      request.requestSha256,

    sourceCandidateSha256:
      request.sourceCandidateSha256,

    corpusGroupKey:
      request.corpusGroupKey,

    repository:
      request.repository,

    family:
      request.family,

    target:
      payload.target,

    materializedCommitSha:
      payload.materializedCommitSha,

    sourceArtifactPaths,

    sourceArtifactSha256:
      payload.sourceArtifactSha256,

    license: {
      spdxId:
        payload.license.spdxId,

      path:
        payload.license.path,

      contentSha256:
        payload.license
          .contentSha256,

      detectedFromMaterializedRevision:
        true as const,
    },
  };

  return {
    ...core,

    candidateSha256:
      digest(
        core,
      ),
  };
}

export function recomputeHardNegativeVerificationReceiptSha256(
  receipt:
    HardNegativeVerificationReceipt,
): string {
  const {
    receiptSha256:
      _receiptSha256,
    ...core
  } = receipt;

  return digest(
    core,
  );
}

export function createHardNegativeVerificationReceipt(
  candidate:
    FulgorHardNegativeCandidate,

  payload:
    HardNegativeVerificationReceiptPayload,
): HardNegativeVerificationReceipt {
  const core = {
    schemaVersion:
      FULGOR_HARD_NEGATIVE_VERIFICATION_RECEIPT_VERSION,

    trustState:
      'INDEPENDENT_HARD_NEGATIVE_VERIFICATION_RECEIPT' as const,

    requestSha256:
      candidate.requestSha256,

    candidateSha256:
      candidate.candidateSha256,

    materializedCommitSha:
      candidate.materializedCommitSha,

    sourceArtifactSha256:
      candidate.sourceArtifactSha256,

    observedVerdict:
      payload.observedVerdict,

    verificationMethods:
      sortedUnique(
        payload.verificationMethods,
      ) as HardNegativeVerificationMethod[],

    verificationPassed:
      payload.verificationPassed,

    independentVerifier:
      payload.independentVerifier,

    executedAgainstExactMaterialization:
      payload
        .executedAgainstExactMaterialization,

    referencePairContrastVerified:
      payload
        .referencePairContrastVerified,

    verificationArtifactSha256:
      payload
        .verificationArtifactSha256,

    notes:
      sortedUnique(
        payload.notes,
      ),

    verifiedAtUtc:
      payload.verifiedAtUtc,
  };

  return {
    ...core,

    receiptSha256:
      digest(
        core,
      ),
  };
}

function validAuthored(
  authored:
    HardNegativeAuthoredContent,
): boolean {
  return (
    nonEmpty(
      authored.prompt,
    ) &&
    authored.expectedEvidence.length >
      0 &&
    authored.expectedEvidence.every(
      nonEmpty,
    ) &&
    authored.expectedRemediation.length >
      0 &&
    authored.expectedRemediation.every(
      nonEmpty,
    )
  );
}

function recordId(
  candidate:
    FulgorHardNegativeCandidate,
): string {
  return [
    'FCV1',
    'HARD_NEGATIVE',
    candidate.candidateSha256
      .slice(
        0,
        24,
      )
      .toUpperCase(),
  ].join(
    '-',
  );
}

export function admitVerifiedHardNegative(
  request:
    FulgorHardNegativeRequest,

  candidate:
    FulgorHardNegativeCandidate,

  receipt:
    HardNegativeVerificationReceipt,

  authored:
    HardNegativeAuthoredContent,
): HardNegativeAdmissionResult {
  const failures:
    HardNegativeAdmissionFailureCode[] = [];

  if (
    !validRequestState(
      request,
    )
  ) {
    failures.push(
      'INVALID_REQUEST_STATE',
    );
  }

  if (
    recomputeHardNegativeRequestSha256(
      request,
    ) !== request.requestSha256
  ) {
    failures.push(
      'REQUEST_DIGEST_MISMATCH',
    );
  }

  if (
    candidate.schemaVersion !==
      FULGOR_HARD_NEGATIVE_CANDIDATE_VERSION ||
    candidate.trustState !==
      'HARD_NEGATIVE_CANDIDATE_REQUIRES_INDEPENDENT_VERIFICATION' ||
    (
      candidate as unknown as {
        trainingAdmission:
          boolean;
      }
    ).trainingAdmission !==
      false ||
    (
      candidate as unknown as {
        generationAuthority:
          boolean;
      }
    ).generationAuthority !==
      false ||
    (
      candidate as unknown as {
        vulnerabilityTruthAuthority:
          boolean;
      }
    ).vulnerabilityTruthAuthority !==
      false ||
    (
      candidate as unknown as {
        requiresIndependentVerification:
          boolean;
      }
    ).requiresIndependentVerification !==
      true
  ) {
    failures.push(
      'INVALID_CANDIDATE_STATE',
    );
  }

  if (
    candidate.requestSha256 !==
      request.requestSha256 ||
    candidate.sourceCandidateSha256 !==
      request.sourceCandidateSha256 ||
    candidate.corpusGroupKey !==
      request.corpusGroupKey ||
    candidate.repository !==
      request.repository ||
    candidate.family !==
      request.family
  ) {
    failures.push(
      'REQUEST_BINDING_MISMATCH',
    );
  }

  if (
    !request.permittedTargets
      .includes(
        candidate.target,
      )
  ) {
    failures.push(
      'TARGET_NOT_PERMITTED',
    );
  }

  if (
    !SHA.test(
      candidate.materializedCommitSha,
    )
  ) {
    failures.push(
      'INVALID_MATERIALIZED_COMMIT',
    );
  }

  if (
    candidate.materializedCommitSha ===
      request.vulnerableCommitSha ||
    candidate.materializedCommitSha ===
      request.fixedCommitSha
  ) {
    failures.push(
      'REFERENCE_PAIR_REUSE',
    );
  }

  if (
    candidate.sourceArtifactPaths.length ===
      0 ||
    candidate.sourceArtifactPaths.some(
      (path) =>
        !nonEmpty(
          path,
        ),
    ) ||
    !SHA256.test(
      candidate.sourceArtifactSha256,
    )
  ) {
    failures.push(
      'INVALID_SOURCE_ARTIFACT',
    );
  }

  if (
    candidate.sourceArtifactPaths.some(
      (path) =>
        !request.changedFiles
          .includes(
            path,
          ),
    )
  ) {
    failures.push(
      'SOURCE_SCOPE_MISMATCH',
    );
  }

  const license =
    evaluateLicenseEvidence({
      spdxId:
        candidate.license.spdxId,

      licenseFilePath:
        candidate.license.path,

      licenseContentSha256:
        candidate.license
          .contentSha256,

      detectedFromMaterializedRevision:
        candidate.license
          .detectedFromMaterializedRevision,
    });

  if (
    license.decision !==
    'ELIGIBLE_FOR_CORPUS_REVIEW'
  ) {
    failures.push(
      'INVALID_LICENSE_EVIDENCE',
    );
  }

  if (
    recomputeHardNegativeCandidateSha256(
      candidate,
    ) !== candidate.candidateSha256
  ) {
    failures.push(
      'CANDIDATE_DIGEST_MISMATCH',
    );
  }

  if (
    receipt.schemaVersion !==
      FULGOR_HARD_NEGATIVE_VERIFICATION_RECEIPT_VERSION ||
    receipt.trustState !==
      'INDEPENDENT_HARD_NEGATIVE_VERIFICATION_RECEIPT'
  ) {
    failures.push(
      'INVALID_RECEIPT_STATE',
    );
  }

  if (
    receipt.requestSha256 !==
      request.requestSha256 ||
    receipt.candidateSha256 !==
      candidate.candidateSha256 ||
    receipt.materializedCommitSha !==
      candidate.materializedCommitSha ||
    receipt.sourceArtifactSha256 !==
      candidate.sourceArtifactSha256
  ) {
    failures.push(
      'RECEIPT_BINDING_MISMATCH',
    );
  }

  if (
    recomputeHardNegativeVerificationReceiptSha256(
      receipt,
    ) !== receipt.receiptSha256
  ) {
    failures.push(
      'RECEIPT_DIGEST_MISMATCH',
    );
  }

  if (
    !(
      receipt.observedVerdict ===
        'REJECT_CANDIDATE' ||
      receipt.observedVerdict ===
        'NEEDS_MORE_EVIDENCE'
    )
  ) {
    failures.push(
      'INVALID_HARD_NEGATIVE_VERDICT',
    );
  }

  if (
    (
      receipt as unknown as {
        independentVerifier:
          boolean;
      }
    ).independentVerifier !==
      true
  ) {
    failures.push(
      'VERIFICATION_NOT_INDEPENDENT',
    );
  }

  if (
    (
      receipt as unknown as {
        executedAgainstExactMaterialization:
          boolean;
      }
    ).executedAgainstExactMaterialization !==
      true
  ) {
    failures.push(
      'EXACT_MATERIALIZATION_NOT_VERIFIED',
    );
  }

  if (
    (
      receipt as unknown as {
        referencePairContrastVerified:
          boolean;
      }
    ).referencePairContrastVerified !==
      true
  ) {
    failures.push(
      'REFERENCE_PAIR_CONTRAST_NOT_VERIFIED',
    );
  }

  if (
    (
      receipt as unknown as {
        verificationPassed:
          boolean;
      }
    ).verificationPassed !==
      true
  ) {
    failures.push(
      'VERIFICATION_FAILED',
    );
  }

  const methods =
    sortedUnique(
      receipt.verificationMethods,
    );

  if (
    methods.length === 0 ||
    methods.some(
      (method) =>
        !ALLOWED_METHODS.has(
          method,
        ),
    )
  ) {
    failures.push(
      'INSUFFICIENT_VERIFICATION_METHOD',
    );
  }

  if (
    !SHA256.test(
      receipt.verificationArtifactSha256,
    )
  ) {
    failures.push(
      'INVALID_VERIFICATION_ARTIFACT',
    );
  }

  if (
    !isStrictUtcTimestamp(
      receipt.verifiedAtUtc,
    )
  ) {
    failures.push(
      'INVALID_VERIFICATION_TIME',
    );
  }

  if (
    !validAuthored(
      authored,
    )
  ) {
    failures.push(
      'INVALID_AUTHORED_CONTENT',
    );
  }

  const uniqueFailures =
    [...new Set(
      failures,
    )];

  if (
    uniqueFailures.length >
    0
  ) {
    return {
      accepted:
        false,

      state:
        'REJECTED',

      trainingManifestAdmission:
        false,

      failureCodes:
        uniqueFailures,

      canonicalValidationFailures:
        [],

      record:
        null,
    };
  }

  const proofTypes =
    methods as FulgorCorpusProofType[];

  const record:
    FulgorCorpusRecord = {
    schemaVersion:
      FULGOR_CORPUS_SCHEMA_VERSION,

    recordId:
      recordId(
        candidate,
      ),

    family:
      request.family,

    verdict:
      receipt.observedVerdict,

    role:
      'HARD_NEGATIVE',

    /*
     * V1 hard negatives are accepted only from an independently
     * materialized exact public Git revision. Generated text/code
     * alone is never corpus authority.
     */
    classification:
      'WHITE_PUBLIC',

    source: {
      sourceKind:
        'PUBLIC_REPOSITORY',

      sourceUrl:
        `https://github.com/${request.repository}/commit/${candidate.materializedCommitSha}`,

      repository:
        request.repository,

      advisoryId:
        request.advisoryId,

      immutableRevision:
        candidate.materializedCommitSha,

      license:
        candidate.license.spdxId,

      licenseUrl:
        null,
    },

    provenance: {
      vulnerableCommitSha:
        request.vulnerableCommitSha,

      fixedCommitSha:
        request.fixedCommitSha,

      sourceCommitSha:
        candidate.materializedCommitSha,

      sourceContentSha256:
        candidate.sourceArtifactSha256,
    },

    verification: {
      proofTypes:
        [...new Set(
          proofTypes,
        )],

      executableVerified:
        methods.includes(
          'EXECUTABLE',
        ),

      staticAnalysisVerified:
        methods.includes(
          'STATIC_ANALYSIS',
        ),

      notes: [
        ...receipt.notes,

        `hard-negative-target:${candidate.target}`,
        `hard-negative-request-sha256:${request.requestSha256}`,
        `hard-negative-candidate-sha256:${candidate.candidateSha256}`,
        `verification-artifact-sha256:${receipt.verificationArtifactSha256}`,
        `hard-negative-receipt-sha256:${receipt.receiptSha256}`,
      ],
    },

    prompt:
      authored.prompt,

    expectedEvidence:
      authored.expectedEvidence,

    expectedRemediation:
      authored.expectedRemediation,

    createdAtUtc:
      receipt.verifiedAtUtc,
  };

  const canonical =
    validateCorpusRecord(
      record,
    );

  if (!canonical.accepted) {
    return {
      accepted:
        false,

      state:
        'REJECTED',

      trainingManifestAdmission:
        false,

      failureCodes: [
        'CANONICAL_RECORD_REJECTED',
      ],

      canonicalValidationFailures:
        [...canonical.failureCodes],

      record:
        null,
    };
  }

  return {
    accepted:
      true,

    state:
      'VERIFIED_HARD_NEGATIVE_REQUIRES_MANIFEST_ADMISSION',

    trainingManifestAdmission:
      false,

    failureCodes: [],

    canonicalValidationFailures: [],

    record,
  };
}
