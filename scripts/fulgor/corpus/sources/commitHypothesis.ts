import {
  parseGithubCommitReference,
} from './githubCommitReference';

import type {
  FulgorAdvisoryCandidate,
} from './advisoryCandidate';

export const FULGOR_COMMIT_HYPOTHESIS_VERSION =
  'FULGOR_COMMIT_HYPOTHESIS_V1' as const;

export interface FulgorCommitHypothesis {
  schemaVersion:
    typeof FULGOR_COMMIT_HYPOTHESIS_VERSION;

  trustState:
    'UNTRUSTED_COMMIT_HYPOTHESIS';

  provider:
    FulgorAdvisoryCandidate['provider'];

  advisoryId: string;

  repository: string;

  commitSha: string;

  referenceUrl: string;

  semanticRole:
    'UNCLASSIFIED_COMMIT_REFERENCE';
}

export function extractCommitHypotheses(
  candidate: FulgorAdvisoryCandidate,
): readonly FulgorCommitHypothesis[] {
  const seen =
    new Set<string>();

  const result:
    FulgorCommitHypothesis[] = [];

  for (
    const reference of
    candidate.references
  ) {
    const parsed =
      parseGithubCommitReference(
        reference,
      );

    if (!parsed) {
      continue;
    }

    const key =
      `${parsed.repository.toLowerCase()}:${parsed.commitSha}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);

    result.push({
      schemaVersion:
        FULGOR_COMMIT_HYPOTHESIS_VERSION,

      trustState:
        'UNTRUSTED_COMMIT_HYPOTHESIS',

      provider:
        candidate.provider,

      advisoryId:
        candidate.advisoryId,

      repository:
        parsed.repository,

      commitSha:
        parsed.commitSha,

      referenceUrl:
        parsed.canonicalUrl,

      semanticRole:
        'UNCLASSIFIED_COMMIT_REFERENCE',
    });
  }

  return result.sort(
    (left, right) =>
      (
        left.repository +
        left.commitSha
      ).localeCompare(
        right.repository +
        right.commitSha,
      ),
  );
}