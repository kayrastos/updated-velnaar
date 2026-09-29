import {
  FULGOR_CORPUS_SCHEMA_VERSION,
} from '../corpusRecord';

import {
  recomputeDraftVerificationReceiptSha256,
} from './verificationReceipt';

import {
  recomputeCorpusDraftSha256,
} from '../factory/reviewCandidateToDrafts';

import {
  validateCorpusRecord,
} from '../validation/provenanceValidator';

import type {
  FulgorCorpusRecord,
  FulgorCorpusVerdict,
  FulgorCorpusProofType,
} from '../corpusRecord';

import type {
  FulgorCorpusDraft,
} from '../factory/corpusDraft';

import type {
  DraftVerificationReceipt,
} from './verificationReceipt';

export type DraftAdmissionFailureCode =
  | 'INVALID_DRAFT_STATE'
  | 'DRAFT_DIGEST_MISMATCH'
  | 'RECEIPT_DRAFT_MISMATCH'
  | 'RECEIPT_PAIR_MISMATCH'
  | 'RECEIPT_DIFF_MISMATCH'
  | 'RECEIPT_DIGEST_MISMATCH'
  | 'VERDICT_MISMATCH'
  | 'COUNTERPART_VERDICT_MISMATCH'
  | 'VERIFICATION_NOT_INDEPENDENT'
  | 'EXACT_MATERIALIZATION_NOT_VERIFIED'
  | 'PAIR_CONTRAST_NOT_VERIFIED'
  | 'VERIFICATION_FAILED'
  | 'INSUFFICIENT_VERIFICATION_METHOD'
  | 'INVALID_SOURCE_ARTIFACT'
  | 'SOURCE_SCOPE_MISMATCH'
  | 'INVALID_VERIFICATION_ARTIFACT'
  | 'INVALID_VERIFICATION_TIME'
  | 'INVALID_AUTHORED_CONTENT'
  | 'CANONICAL_RECORD_REJECTED';

export interface DraftAdmissionAuthoredContent {
  prompt: string;

  expectedEvidence:
    readonly string[];

  expectedRemediation:
    readonly string[];
}

export interface VerifiedDraftAdmissionResult {
  accepted: boolean;

  state:
    | 'VERIFIED_CORPUS_RECORD_REQUIRES_MANIFEST_ADMISSION'
    | 'REJECTED';

  trainingManifestAdmission:
    false;

  failureCodes:
    readonly DraftAdmissionFailureCode[];

  canonicalValidationFailures:
    readonly string[];

  record:
    FulgorCorpusRecord | null;
}

const SHA256 =
  /^[a-f0-9]{64}$/;

const SHA =
  /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

const ALLOWED_METHODS =
  new Set([
    'EXECUTABLE',
    'STATIC_ANALYSIS',
  ]);

function nonEmpty(
  value: string,
): boolean {
  return value.trim().length > 0;
}

function validAuthoredContent(
  content:
    DraftAdmissionAuthoredContent,
): boolean {
  return (
    nonEmpty(content.prompt) &&
    content.expectedEvidence.length > 0 &&
    content.expectedEvidence.every(
      nonEmpty,
    ) &&
    content.expectedRemediation.length > 0 &&
    content.expectedRemediation.every(
      nonEmpty,
    )
  );
}

function oppositeVerdict(
  draft:
    FulgorCorpusDraft,
): Extract<
  FulgorCorpusVerdict,
  'CONFIRMED_RISK'
    | 'REJECT_CANDIDATE'
> {
  return (
    draft.role ===
      'VULNERABLE'
  )
    ? 'REJECT_CANDIDATE'
    : 'CONFIRMED_RISK';
}

function canonicalSourceUrl(
  draft:
    FulgorCorpusDraft,
): string {
  if (
    draft.provider ===
      'GHSA'
  ) {
    return (
      `https://github.com/advisories/${draft.advisoryId}`
    );
  }

  return (
    `https://osv.dev/vulnerability/${encodeURIComponent(draft.advisoryId)}`
  );
}

function recordId(
  draft:
    FulgorCorpusDraft,
): string {
  return [
    'FCV1',
    draft.role,
    draft.draftSha256
      .slice(0, 24)
      .toUpperCase(),
  ].join('-');
}

export function admitVerifiedDraft(
  draft:
    FulgorCorpusDraft,

  receipt:
    DraftVerificationReceipt,

  authored:
    DraftAdmissionAuthoredContent,
): VerifiedDraftAdmissionResult {
  const failures:
    DraftAdmissionFailureCode[] = [];

  if (
    draft.schemaVersion !==
      'FULGOR_CORPUS_DRAFT_V1' ||
    draft.trustState !==
      'CORPUS_DRAFT_REQUIRES_VERIFICATION' ||
    (
      draft as unknown as {
        trainingAdmission:
          boolean;
      }
    ).trainingAdmission !==
      false ||
    (
      draft as unknown as {
        vulnerabilityTruthAuthority:
          boolean;
      }
    ).vulnerabilityTruthAuthority !==
      false
  ) {
    failures.push(
      'INVALID_DRAFT_STATE',
    );
  }

  if (
    draft.draftSha256 !==
      recomputeCorpusDraftSha256(
        draft,
      )
  ) {
    failures.push(
      'DRAFT_DIGEST_MISMATCH',
    );
  }
  if (
    receipt.draftSha256 !==
      draft.draftSha256
  ) {
    failures.push(
      'RECEIPT_DRAFT_MISMATCH',
    );
  }

  if (
    receipt
      .materializedCommitSha !==
      draft
        .materializedCommitSha ||
    receipt
      .counterpartCommitSha !==
      draft
        .counterpartCommitSha
  ) {
    failures.push(
      'RECEIPT_PAIR_MISMATCH',
    );
  }

  if (
    receipt
      .pairDiffSha256 !==
      draft.diffSha256
  ) {
    failures.push(
      'RECEIPT_DIFF_MISMATCH',
    );
  }

  if (
    receipt.receiptSha256 !==
      recomputeDraftVerificationReceiptSha256(
        receipt,
      )
  ) {
    failures.push(
      'RECEIPT_DIGEST_MISMATCH',
    );
  }

  if (
    receipt.observedVerdict !==
      draft.expectedVerdict
  ) {
    failures.push(
      'VERDICT_MISMATCH',
    );
  }

  if (
    receipt
      .counterpartObservedVerdict !==
      oppositeVerdict(draft)
  ) {
    failures.push(
      'COUNTERPART_VERDICT_MISMATCH',
    );
  }

  if (
    receipt
      .independentVerifier !==
      true
  ) {
    failures.push(
      'VERIFICATION_NOT_INDEPENDENT',
    );
  }

  if (
    receipt
      .executedAgainstExactMaterialization !==
      true
  ) {
    failures.push(
      'EXACT_MATERIALIZATION_NOT_VERIFIED',
    );
  }

  if (
    receipt
      .pairContrastVerified !==
      true
  ) {
    failures.push(
      'PAIR_CONTRAST_NOT_VERIFIED',
    );
  }

  if (
    receipt
      .verificationPassed !==
      true
  ) {
    failures.push(
      'VERIFICATION_FAILED',
    );
  }

  const methods =
    [
      ...new Set(
        receipt
          .verificationMethods,
      ),
    ];

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
      receipt
        .sourceArtifactSha256,
    ) ||
    receipt
      .sourceArtifactPaths
      .length === 0 ||
    new Set(
      receipt.sourceArtifactPaths,
    ).size !==
      receipt
        .sourceArtifactPaths
        .length
  ) {
    failures.push(
      'INVALID_SOURCE_ARTIFACT',
    );
  }

  const changedFiles =
    new Set(
      draft.changedFiles,
    );

  if (
    receipt
      .sourceArtifactPaths
      .some(
        (path) =>
          !changedFiles.has(
            path,
          ),
      )
  ) {
    failures.push(
      'SOURCE_SCOPE_MISMATCH',
    );
  }

  if (
    !SHA256.test(
      receipt
        .verificationArtifactSha256,
    ) ||
    receipt.notes.length === 0 ||
    receipt.notes.some(
      (note) =>
        !nonEmpty(note),
    )
  ) {
    failures.push(
      'INVALID_VERIFICATION_ARTIFACT',
    );
  }

  if (
    !nonEmpty(
      receipt.verifiedAtUtc,
    ) ||
    Number.isNaN(
      Date.parse(
        receipt.verifiedAtUtc,
      ),
    )
  ) {
    failures.push(
      'INVALID_VERIFICATION_TIME',
    );
  }

  if (
    !validAuthoredContent(
      authored,
    )
  ) {
    failures.push(
      'INVALID_AUTHORED_CONTENT',
    );
  }

  if (
    !SHA.test(
      draft
        .materializedCommitSha,
    ) ||
    !SHA.test(
      draft
        .counterpartCommitSha,
    )
  ) {
    failures.push(
      'RECEIPT_PAIR_MISMATCH',
    );
  }

  const uniqueFailures =
    [...new Set(failures)];

  if (
    uniqueFailures.length >
      0
  ) {
    return {
      accepted: false,

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

  const vulnerableCommitSha =
    draft.role ===
      'VULNERABLE'
      ? draft
          .materializedCommitSha
      : draft
          .counterpartCommitSha;

  const fixedCommitSha =
    draft.role ===
      'FIXED'
      ? draft
          .materializedCommitSha
      : draft
          .counterpartCommitSha;

  const proofTypes:
    FulgorCorpusProofType[] = [
      'PATCH_DIFF',
      ...methods,
    ];

  const record:
    FulgorCorpusRecord = {
    schemaVersion:
      FULGOR_CORPUS_SCHEMA_VERSION,

    recordId:
      recordId(draft),

    family:
      draft.family,

    verdict:
      draft.expectedVerdict,

    role:
      draft.role,

    classification:
      'WHITE_PUBLIC',

    source: {
      sourceKind:
        draft.provider,

      sourceUrl:
        canonicalSourceUrl(
          draft,
        ),

      repository:
        draft.repository,

      advisoryId:
        draft.advisoryId,

      immutableRevision:
        draft
          .materializedCommitSha,

      license:
        draft.license.spdxId,

      licenseUrl:
        null,
    },

    provenance: {
      vulnerableCommitSha,

      fixedCommitSha,

      sourceCommitSha:
        draft
          .materializedCommitSha,

      sourceContentSha256:
        receipt
          .sourceArtifactSha256,
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

      notes:
        [
          ...receipt.notes,
          `verification-artifact-sha256:${receipt.verificationArtifactSha256}`,
          `receipt-sha256:${receipt.receiptSha256}`,
        ],
    },

    prompt:
      authored.prompt,

    expectedEvidence:
      authored
        .expectedEvidence,

    expectedRemediation:
      authored
        .expectedRemediation,

    createdAtUtc:
      receipt.verifiedAtUtc,
  };

  const canonical =
    validateCorpusRecord(
      record,
    );

  if (!canonical.accepted) {
    return {
      accepted: false,

      state:
        'REJECTED',

      trainingManifestAdmission:
        false,

      failureCodes: [
        'CANONICAL_RECORD_REJECTED',
      ],

      canonicalValidationFailures:
        [...canonical
          .failureCodes],

      record:
        null,
    };
  }

  return {
    accepted: true,

    state:
      'VERIFIED_CORPUS_RECORD_REQUIRES_MANIFEST_ADMISSION',

    trainingManifestAdmission:
      false,

    failureCodes: [],

    canonicalValidationFailures:
      [],

    record,
  };
}
