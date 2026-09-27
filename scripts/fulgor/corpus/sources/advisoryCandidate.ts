export const FULGOR_ADVISORY_CANDIDATE_VERSION =
  'FULGOR_ADVISORY_CANDIDATE_V1' as const;

export type FulgorAdvisoryProvider =
  | 'GHSA'
  | 'OSV';

export interface FulgorAffectedPackage {
  ecosystem: string | null;
  name: string;
  ranges: readonly string[];
}

export interface FulgorAdvisoryCandidate {
  schemaVersion:
    typeof FULGOR_ADVISORY_CANDIDATE_VERSION;

  trustState:
    'UNTRUSTED_SOURCE_CANDIDATE';

  provider:
    FulgorAdvisoryProvider;

  advisoryId: string;

  aliases:
    readonly string[];

  summary: string;
  details: string;

  severity: string | null;

  cwes:
    readonly string[];

  references:
    readonly string[];

  affectedPackages:
    readonly FulgorAffectedPackage[];

  publishedAtUtc: string | null;
  modifiedAtUtc: string | null;
  withdrawnAtUtc: string | null;

  sourceUrl: string;
  fetchedAtUtc: string;
}