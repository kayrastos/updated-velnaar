import {
  createHash,
} from 'node:crypto';

import type {
  FulgorCorpusVerdict,
} from '../corpusRecord';

export const FULGOR_DRAFT_VERIFICATION_RECEIPT_VERSION =
  'FULGOR_DRAFT_VERIFICATION_RECEIPT_V1' as const;

export type IndependentVerificationMethod =
  | 'EXECUTABLE'
  | 'STATIC_ANALYSIS';

export interface DraftVerificationReceiptPayload {
  draftSha256: string;

  materializedCommitSha:
    string;

  counterpartCommitSha:
    string;

  pairDiffSha256:
    string;

  observedVerdict:
    Extract<
      FulgorCorpusVerdict,
      'CONFIRMED_RISK'
        | 'REJECT_CANDIDATE'
    >;

  counterpartObservedVerdict:
    Extract<
      FulgorCorpusVerdict,
      'CONFIRMED_RISK'
        | 'REJECT_CANDIDATE'
    >;

  verificationMethods:
    readonly IndependentVerificationMethod[];

  verificationPassed:
    true;

  independentVerifier:
    true;

  executedAgainstExactMaterialization:
    true;

  pairContrastVerified:
    true;

  sourceArtifactPaths:
    readonly string[];

  sourceArtifactSha256:
    string;

  verificationArtifactSha256:
    string;

  notes:
    readonly string[];

  verifiedAtUtc:
    string;
}

export interface DraftVerificationReceipt
extends DraftVerificationReceiptPayload {
  schemaVersion:
    typeof FULGOR_DRAFT_VERIFICATION_RECEIPT_VERSION;

  trustState:
    'INDEPENDENT_VERIFICATION_RECEIPT';

  receiptSha256:
    string;
}

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

function sortedUnique(
  values: readonly string[],
): string[] {
  return [
    ...new Set(values),
  ].sort();
}

export function createDraftVerificationReceipt(
  payload:
    DraftVerificationReceiptPayload,
): DraftVerificationReceipt {
  const core = {
    schemaVersion:
      FULGOR_DRAFT_VERIFICATION_RECEIPT_VERSION,

    trustState:
      'INDEPENDENT_VERIFICATION_RECEIPT' as const,

    draftSha256:
      payload.draftSha256,

    materializedCommitSha:
      payload
        .materializedCommitSha,

    counterpartCommitSha:
      payload
        .counterpartCommitSha,

    pairDiffSha256:
      payload.pairDiffSha256,

    observedVerdict:
      payload.observedVerdict,

    counterpartObservedVerdict:
      payload
        .counterpartObservedVerdict,

    verificationMethods:
      sortedUnique(
        payload
          .verificationMethods,
      ) as IndependentVerificationMethod[],

    verificationPassed:
      payload.verificationPassed,

    independentVerifier:
      payload.independentVerifier,

    executedAgainstExactMaterialization:
      payload
        .executedAgainstExactMaterialization,

    pairContrastVerified:
      payload
        .pairContrastVerified,

    sourceArtifactPaths:
      sortedUnique(
        payload
          .sourceArtifactPaths,
      ),

    sourceArtifactSha256:
      payload
        .sourceArtifactSha256,

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
      digest(core),
  };
}

export function recomputeDraftVerificationReceiptSha256(
  receipt:
    DraftVerificationReceipt,
): string {
  const {
    receiptSha256:
      _receiptSha256,
    ...core
  } = receipt;

  return digest(core);
}