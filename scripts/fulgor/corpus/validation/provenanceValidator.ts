import {
  FULGOR_CORPUS_FAMILIES,
  FULGOR_CORPUS_SCHEMA_VERSION,
} from '../corpusRecord';

import {
  isStrictUtcTimestamp,
} from './strictUtcTimestamp';

import type {
  FulgorCorpusProofType,
  FulgorCorpusRecord,
} from '../corpusRecord';

export type CorpusValidationFailureCode =
  | 'INVALID_SCHEMA_VERSION'
  | 'INVALID_RECORD_ID'
  | 'INVALID_FAMILY'
  | 'BLACK_DATA_FORBIDDEN'
  | 'INVALID_SOURCE_URL'
  | 'INVALID_REPOSITORY'
  | 'MISSING_ADVISORY_ID'
  | 'MISSING_LICENSE'
  | 'INVALID_IMMUTABLE_REVISION'
  | 'INVALID_COMMIT_SHA'
  | 'MISSING_FIX_PAIR'
  | 'INVALID_VERDICT_ROLE_PAIR'
  | 'INSUFFICIENT_VERIFICATION'
  | 'INVALID_CONTENT_HASH'
  | 'EMPTY_PROMPT'
  | 'EMPTY_EXPECTED_EVIDENCE'
  | 'EMPTY_EXPECTED_REMEDIATION'
  | 'INVALID_CREATED_AT';

export interface CorpusValidationResult {
  accepted: boolean;
  failureCodes:
    readonly CorpusValidationFailureCode[];
}

const RECORD_ID =
  /^FCV1-[A-Z0-9][A-Z0-9._-]{1,127}$/;

const REPOSITORY =
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const GIT_SHA =
  /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

const SHA256 =
  /^[a-f0-9]{64}$/;

function nonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

function validSourceUrl(
  record: FulgorCorpusRecord,
): boolean {
  if (
    record.source.sourceKind === 'SYNTHETIC'
  ) {
    return (
      record.source.sourceUrl.startsWith(
        'synthetic://',
      ) ||
      record.source.sourceUrl.startsWith(
        'https://',
      )
    );
  }

  return record.source.sourceUrl.startsWith(
    'https://',
  );
}

function hasProof(
  record: FulgorCorpusRecord,
  proof: FulgorCorpusProofType,
): boolean {
  return record.verification.proofTypes
    .includes(proof);
}

function hasStrongVerification(
  record: FulgorCorpusRecord,
): boolean {
  return (
    hasProof(record, 'EXECUTABLE') ||
    hasProof(record, 'STATIC_ANALYSIS') ||
    hasProof(record, 'ADVISORY_LINKAGE')
  );
}

function add(
  failures: CorpusValidationFailureCode[],
  condition: boolean,
  code: CorpusValidationFailureCode,
): void {
  if (condition) {
    failures.push(code);
  }
}

export function validateCorpusRecord(
  record: FulgorCorpusRecord,
): CorpusValidationResult {
  const failures:
    CorpusValidationFailureCode[] = [];

  add(
    failures,
    record.schemaVersion !==
      FULGOR_CORPUS_SCHEMA_VERSION,
    'INVALID_SCHEMA_VERSION',
  );

  add(
    failures,
    !RECORD_ID.test(record.recordId),
    'INVALID_RECORD_ID',
  );

  add(
    failures,
    !FULGOR_CORPUS_FAMILIES.includes(
      record.family,
    ),
    'INVALID_FAMILY',
  );

  add(
    failures,
    !(
      record.classification ===
        'WHITE_PUBLIC' ||
      record.classification ===
        'WHITE_SYNTHETIC'
    ),
    'BLACK_DATA_FORBIDDEN',
  );

  add(
    failures,
    !validSourceUrl(record),
    'INVALID_SOURCE_URL',
  );

  add(
    failures,
    !REPOSITORY.test(
      record.source.repository,
    ),
    'INVALID_REPOSITORY',
  );

  const advisoryRequired =
    record.source.sourceKind === 'GHSA' ||
    record.source.sourceKind === 'OSV';

  add(
    failures,
    advisoryRequired &&
      (
        record.source.advisoryId === null ||
        !nonEmpty(record.source.advisoryId)
      ),
    'MISSING_ADVISORY_ID',
  );

  add(
    failures,
    !nonEmpty(record.source.license),
    'MISSING_LICENSE',
  );

  add(
    failures,
    !GIT_SHA.test(
      record.source.immutableRevision,
    ),
    'INVALID_IMMUTABLE_REVISION',
  );

  const commitValues = [
    record.provenance.vulnerableCommitSha,
    record.provenance.fixedCommitSha,
    record.provenance.sourceCommitSha,
  ].filter(
    (value): value is string =>
      value !== null,
  );

  add(
    failures,
    commitValues.some(
      (value) => !GIT_SHA.test(value),
    ),
    'INVALID_COMMIT_SHA',
  );

  const pairedRole =
    record.role === 'VULNERABLE' ||
    record.role === 'FIXED';

  const vulnerableSha =
    record.provenance.vulnerableCommitSha;

  const fixedSha =
    record.provenance.fixedCommitSha;

  add(
    failures,
    pairedRole &&
      (
        vulnerableSha === null ||
        fixedSha === null ||
        vulnerableSha === fixedSha
      ),
    'MISSING_FIX_PAIR',
  );

  const invalidVerdictRole =
    (
      record.role === 'VULNERABLE' &&
      record.verdict !== 'CONFIRMED_RISK'
    ) ||
    (
      record.role === 'FIXED' &&
      record.verdict !== 'REJECT_CANDIDATE'
    ) ||
    (
      record.role === 'HARD_NEGATIVE' &&
      record.verdict === 'CONFIRMED_RISK'
    );

  add(
    failures,
    invalidVerdictRole,
    'INVALID_VERDICT_ROLE_PAIR',
  );

  const pairedVerificationInvalid =
    pairedRole &&
    (
      !hasProof(record, 'PATCH_DIFF') ||
      !hasStrongVerification(record)
    );

  const hardNegativeVerificationInvalid =
    record.role === 'HARD_NEGATIVE' &&
    !(
      hasStrongVerification(record) ||
      hasProof(record, 'MANUAL_REVIEW')
    );

  add(
    failures,
    pairedVerificationInvalid ||
      hardNegativeVerificationInvalid,
    'INSUFFICIENT_VERIFICATION',
  );

  add(
    failures,
    !SHA256.test(
      record.provenance.sourceContentSha256,
    ),
    'INVALID_CONTENT_HASH',
  );

  add(
    failures,
    !nonEmpty(record.prompt),
    'EMPTY_PROMPT',
  );

  add(
    failures,
    record.expectedEvidence.length === 0 ||
      record.expectedEvidence.some(
        (entry) => !nonEmpty(entry),
      ),
    'EMPTY_EXPECTED_EVIDENCE',
  );

  add(
    failures,
    record.expectedRemediation.length === 0 ||
      record.expectedRemediation.some(
        (entry) => !nonEmpty(entry),
      ),
    'EMPTY_EXPECTED_REMEDIATION',
  );

  add(
    failures,
    !isStrictUtcTimestamp(
      record.createdAtUtc,
    ),
    'INVALID_CREATED_AT',
  );

  return {
    accepted: failures.length === 0,
    failureCodes: [...new Set(failures)],
  };
}
