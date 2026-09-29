export const FULGOR_ADVISORY_CANDIDATE_VERSION =
  'FULGOR_ADVISORY_CANDIDATE_V1' as const;

export type FulgorAdvisoryProvider =
  | 'GHSA'
  | 'OSV';

export type FulgorGitRangeEventKind =
  | 'INTRODUCED'
  | 'FIXED'
  | 'LAST_AFFECTED'
  | 'LIMIT';

export interface FulgorGitRangeEvent {
  kind:
    FulgorGitRangeEventKind;

  /*
   * For INTRODUCED only, "0" means beginning of repository history.
   * Every other accepted value is an exact 40-hex Git object name.
   */
  commit: string;
}

export interface FulgorGitRange {
  /*
   * Source metadata only. This URL is untrusted until repository
   * identity is independently canonicalized and materialized.
   */
  repositoryUrl:
    string | null;

  events:
    readonly FulgorGitRangeEvent[];
}

export interface FulgorAffectedPackage {
  ecosystem: string | null;
  name: string;

  /*
   * Legacy/raw deterministic representation retained for provenance
   * and backwards compatibility.
   */
  ranges: readonly string[];

  /*
   * Structured OSV GIT semantics.
   * Absence means the source did not provide a usable GIT range.
   */
  gitRanges?:
    readonly FulgorGitRange[];
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
