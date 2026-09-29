import type {
  FulgorAdvisoryCandidate,
} from './advisoryCandidate';

export const FULGOR_SEMANTIC_FIXED_BOUNDARY_VERSION =
  'FULGOR_SEMANTIC_FIXED_BOUNDARY_V1' as const;

const EXACT_GIT_SHA =
  /^[0-9a-f]{40}$/;

const GITHUB_NAME =
  /^[A-Za-z0-9_.-]+$/;

export interface FulgorSemanticFixedBoundaryHypothesis {
  schemaVersion:
    typeof FULGOR_SEMANTIC_FIXED_BOUNDARY_VERSION;

  trustState:
    'UNTRUSTED_FIXED_RANGE_BOUNDARY';

  provider:
    'OSV';

  advisoryId:
    string;

  packageName:
    string;

  repository:
    string;

  repositoryUrl:
    string;

  fixedCommitSha:
    string;

  introducedCommitSha:
    string | null;

  introducedFromRepositoryRoot:
    boolean;

  semanticRole:
    'OSV_GIT_FIXED_RANGE_BOUNDARY';
}

export type MaterializedFixedRelationshipDecision =
  | 'PATCH_EQUALS_FIXED_RANGE_BOUNDARY'
  | 'PATCH_PRECEDES_FIXED_RANGE_BOUNDARY'
  | 'REQUIRES_FURTHER_REVIEW';

export interface MaterializedFixedRelationshipEvidence {
  vulnerableCommitSha:
    string;

  patchCommitSha:
    string;

  fixedBoundaryCommitSha:
    string;

  patchParentCommitShas:
    readonly string[];

  patchIsAncestorOfFixedBoundary:
    boolean;

  fixedBoundaryIsAncestorOfPatch:
    boolean;
}

function canonicalGithubRepository(
  raw: string | null,
): {
  repository: string;
  repositoryUrl: string;
} | null {
  if (!raw) {
    return null;
  }

  let url: URL;

  try {
    url =
      new URL(
        raw,
      );
  }
  catch {
    return null;
  }

  if (
    url.protocol !== 'https:' ||
    url.hostname.toLowerCase() !==
      'github.com' ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    return null;
  }

  let parts: string[];

  try {
    parts =
      url.pathname
        .split('/')
        .filter(Boolean)
        .map(
          (part) =>
            decodeURIComponent(
              part,
            ),
        );
  }
  catch {
    return null;
  }

  if (parts.length !== 2) {
    return null;
  }

  const owner =
    parts[0];

  const repositoryName =
    parts[1].endsWith(
      '.git',
    )
      ? parts[1].slice(
          0,
          -4,
        )
      : parts[1];

  if (
    !GITHUB_NAME.test(
      owner,
    ) ||
    !GITHUB_NAME.test(
      repositoryName,
    )
  ) {
    return null;
  }

  const repository =
    `${owner}/${repositoryName}`;

  return {
    repository,

    repositoryUrl:
      `https://github.com/${repository}`,
  };
}

export function extractSemanticFixedBoundaries(
  candidate: FulgorAdvisoryCandidate,
): readonly FulgorSemanticFixedBoundaryHypothesis[] {
  if (
    candidate.provider !==
    'OSV'
  ) {
    return [];
  }

  const result:
    FulgorSemanticFixedBoundaryHypothesis[] = [];

  const seen =
    new Set<string>();

  for (
    const affected of
    candidate.affectedPackages
  ) {
    for (
      const range of
      affected.gitRanges ?? []
    ) {
      const repository =
        canonicalGithubRepository(
          range.repositoryUrl,
        );

      if (!repository) {
        continue;
      }

      let activeIntroduced:
        string | null = null;

      let introducedSeen =
        false;

      let fromRepositoryRoot =
        false;

      for (
        const event of
        range.events
      ) {
        if (
          event.kind ===
          'INTRODUCED'
        ) {
          introducedSeen =
            true;

          fromRepositoryRoot =
            event.commit ===
            '0';

          activeIntroduced =
            fromRepositoryRoot
              ? null
              : event.commit;

          continue;
        }

        if (
          event.kind ===
          'FIXED'
        ) {
          /*
           * A bare FIXED event without a preceding INTRODUCED event
           * is not enough for automatic semantic range reasoning.
           */
          if (
            !introducedSeen ||
            !EXACT_GIT_SHA.test(
              event.commit,
            )
          ) {
            introducedSeen =
              false;

            activeIntroduced =
              null;

            fromRepositoryRoot =
              false;

            continue;
          }

          const key =
            [
              repository.repository
                .toLowerCase(),
              event.commit,
              affected.name
                .toLowerCase(),
            ].join(':');

          if (!seen.has(key)) {
            seen.add(key);

            result.push({
              schemaVersion:
                FULGOR_SEMANTIC_FIXED_BOUNDARY_VERSION,

              trustState:
                'UNTRUSTED_FIXED_RANGE_BOUNDARY',

              provider:
                'OSV',

              advisoryId:
                candidate.advisoryId,

              packageName:
                affected.name,

              repository:
                repository.repository,

              repositoryUrl:
                repository.repositoryUrl,

              fixedCommitSha:
                event.commit,

              introducedCommitSha:
                activeIntroduced,

              introducedFromRepositoryRoot:
                fromRepositoryRoot,

              /*
               * This is deliberately NOT a patch-commit role.
               */
              semanticRole:
                'OSV_GIT_FIXED_RANGE_BOUNDARY',
            });
          }

          introducedSeen =
            false;

          activeIntroduced =
            null;

          fromRepositoryRoot =
            false;

          continue;
        }

        /*
         * LAST_AFFECTED/LIMIT have different semantics and terminate
         * this V1 fixed-boundary segment rather than being promoted
         * into a fixed commit.
         */
        introducedSeen =
          false;

        activeIntroduced =
          null;

        fromRepositoryRoot =
          false;
      }
    }
  }

  return result.sort(
    (left, right) =>
      (
        left.repository +
        left.fixedCommitSha +
        left.packageName
      ).localeCompare(
        right.repository +
        right.fixedCommitSha +
        right.packageName,
      ),
  );
}

function exactSha(
  value: string,
): boolean {
  return EXACT_GIT_SHA.test(
    value,
  );
}

export function classifyMaterializedFixedRelationship(
  evidence:
    MaterializedFixedRelationshipEvidence,
): MaterializedFixedRelationshipDecision {
  if (
    !exactSha(
      evidence.vulnerableCommitSha,
    ) ||
    !exactSha(
      evidence.patchCommitSha,
    ) ||
    !exactSha(
      evidence.fixedBoundaryCommitSha,
    ) ||
    evidence.patchParentCommitShas
      .some(
        (parent) =>
          !exactSha(
            parent,
          ),
      )
  ) {
    return 'REQUIRES_FURTHER_REVIEW';
  }

  const patchIsDirectChild =
    evidence.patchParentCommitShas.length ===
      1 &&
    evidence.patchParentCommitShas[0] ===
      evidence.vulnerableCommitSha;

  if (!patchIsDirectChild) {
    return 'REQUIRES_FURTHER_REVIEW';
  }

  if (
    evidence.patchCommitSha ===
      evidence.fixedBoundaryCommitSha
  ) {
    return 'PATCH_EQUALS_FIXED_RANGE_BOUNDARY';
  }

  if (
    evidence.patchIsAncestorOfFixedBoundary &&
    !evidence.fixedBoundaryIsAncestorOfPatch
  ) {
    return 'PATCH_PRECEDES_FIXED_RANGE_BOUNDARY';
  }

  return 'REQUIRES_FURTHER_REVIEW';
}
