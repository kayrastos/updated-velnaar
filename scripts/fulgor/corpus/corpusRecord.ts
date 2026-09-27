export const FULGOR_CORPUS_SCHEMA_VERSION =
  'FULGOR_CORPUS_RECORD_V1' as const;

export const FULGOR_CORPUS_FAMILIES = [
  'AUTHORIZATION',
  'CACHE_BEHAVIOR',
  'COMMAND_EXECUTION',
  'CORS',
  'DESERIALIZATION',
  'PATH_TRAVERSAL',
  'QUERY_INJECTION',
  'SECRET_EXPOSURE',
  'SSRF',
  'XSS',
] as const;

export type FulgorCorpusFamily =
  typeof FULGOR_CORPUS_FAMILIES[number];

export type FulgorCorpusVerdict =
  | 'CONFIRMED_RISK'
  | 'REJECT_CANDIDATE'
  | 'NEEDS_MORE_EVIDENCE';

export type FulgorCorpusRole =
  | 'VULNERABLE'
  | 'FIXED'
  | 'HARD_NEGATIVE';

export type FulgorCorpusDataClassification =
  | 'WHITE_PUBLIC'
  | 'WHITE_SYNTHETIC';

export type FulgorCorpusSourceKind =
  | 'GHSA'
  | 'OSV'
  | 'PUBLIC_REPOSITORY'
  | 'SYNTHETIC';

export type FulgorCorpusProofType =
  | 'EXECUTABLE'
  | 'STATIC_ANALYSIS'
  | 'PATCH_DIFF'
  | 'ADVISORY_LINKAGE'
  | 'MANUAL_REVIEW';

export interface FulgorCorpusSource {
  sourceKind: FulgorCorpusSourceKind;
  sourceUrl: string;
  repository: string;
  advisoryId: string | null;
  immutableRevision: string;
  license: string;
  licenseUrl: string | null;
}

export interface FulgorCorpusProvenance {
  vulnerableCommitSha: string | null;
  fixedCommitSha: string | null;
  sourceCommitSha: string | null;
  sourceContentSha256: string;
}

export interface FulgorCorpusVerification {
  proofTypes: readonly FulgorCorpusProofType[];
  executableVerified: boolean;
  staticAnalysisVerified: boolean;
  notes: readonly string[];
}

export interface FulgorCorpusRecord {
  schemaVersion:
    typeof FULGOR_CORPUS_SCHEMA_VERSION;

  recordId: string;

  family: FulgorCorpusFamily;
  verdict: FulgorCorpusVerdict;
  role: FulgorCorpusRole;

  classification:
    FulgorCorpusDataClassification;

  source: FulgorCorpusSource;
  provenance: FulgorCorpusProvenance;
  verification: FulgorCorpusVerification;

  prompt: string;

  expectedEvidence: readonly string[];
  expectedRemediation: readonly string[];

  createdAtUtc: string;
}