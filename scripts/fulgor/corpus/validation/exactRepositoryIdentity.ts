export interface DeclaredCommitPair {
  repository: string;
  vulnerableCommitSha: string;
  fixedCommitSha: string;
}

export interface RepositoryMaterializationEvidence {
  repository: string;

  resolvedOriginUrl: string;

  requestedVulnerableCommitSha:
    string;

  requestedFixedCommitSha:
    string;

  materializedVulnerableHead:
    string;

  materializedFixedHead:
    string;

  vulnerableCommitExists:
    boolean;

  fixedCommitExists:
    boolean;

  cleanMaterialization:
    boolean;
}

export type ExactIdentityFailureCode =
  | 'INVALID_DECLARED_REPOSITORY'
  | 'INVALID_DECLARED_COMMIT'
  | 'REPOSITORY_IDENTITY_MISMATCH'
  | 'ORIGIN_IDENTITY_MISMATCH'
  | 'REQUESTED_COMMIT_MISMATCH'
  | 'VULNERABLE_COMMIT_MISSING'
  | 'FIXED_COMMIT_MISSING'
  | 'VULNERABLE_HEAD_MISMATCH'
  | 'FIXED_HEAD_MISMATCH'
  | 'DIRTY_MATERIALIZATION';

export interface ExactIdentityResult {
  accepted: boolean;

  failureCodes:
    readonly ExactIdentityFailureCode[];
}

const REPOSITORY =
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const SHA =
  /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

function canonicalRepositoryFromOrigin(
  input: string,
): string | null {
  const ssh =
    /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/
      .exec(input);

  if (ssh) {
    return `${ssh[1]}/${ssh[2]}`;
  }

  let url: URL;

  try {
    url = new URL(input);
  } catch {
    return null;
  }

  if (
    url.protocol !== 'https:' ||
    url.hostname.toLowerCase() !==
      'github.com' ||
    url.port !== ''
  ) {
    return null;
  }

  const parts =
    url.pathname
      .split('/')
      .filter(Boolean);

  if (parts.length !== 2) {
    return null;
  }

  const repository =
    parts[1].endsWith('.git')
      ? parts[1].slice(0, -4)
      : parts[1];

  if (
    !repository ||
    !parts[0]
  ) {
    return null;
  }

  return `${parts[0]}/${repository}`;
}

export function validatePostMaterializationIdentity(
  declared: DeclaredCommitPair,
  evidence:
    RepositoryMaterializationEvidence,
): ExactIdentityResult {
  const failures:
    ExactIdentityFailureCode[] = [];

  const repositoryValid =
    REPOSITORY.test(
      declared.repository,
    );

  if (!repositoryValid) {
    failures.push(
      'INVALID_DECLARED_REPOSITORY',
    );
  }

  if (
    !SHA.test(
      declared.vulnerableCommitSha,
    ) ||
    !SHA.test(
      declared.fixedCommitSha,
    ) ||
    declared.vulnerableCommitSha ===
      declared.fixedCommitSha
  ) {
    failures.push(
      'INVALID_DECLARED_COMMIT',
    );
  }

  if (
    evidence.repository
      .toLowerCase() !==
    declared.repository
      .toLowerCase()
  ) {
    failures.push(
      'REPOSITORY_IDENTITY_MISMATCH',
    );
  }

  const originRepository =
    canonicalRepositoryFromOrigin(
      evidence.resolvedOriginUrl,
    );

  if (
    originRepository === null ||
    originRepository.toLowerCase() !==
      declared.repository.toLowerCase()
  ) {
    failures.push(
      'ORIGIN_IDENTITY_MISMATCH',
    );
  }

  if (
    evidence
      .requestedVulnerableCommitSha !==
      declared.vulnerableCommitSha ||
    evidence
      .requestedFixedCommitSha !==
      declared.fixedCommitSha
  ) {
    failures.push(
      'REQUESTED_COMMIT_MISMATCH',
    );
  }

  if (
    !evidence
      .vulnerableCommitExists
  ) {
    failures.push(
      'VULNERABLE_COMMIT_MISSING',
    );
  }

  if (
    !evidence.fixedCommitExists
  ) {
    failures.push(
      'FIXED_COMMIT_MISSING',
    );
  }

  if (
    evidence
      .materializedVulnerableHead !==
    declared.vulnerableCommitSha
  ) {
    failures.push(
      'VULNERABLE_HEAD_MISMATCH',
    );
  }

  if (
    evidence
      .materializedFixedHead !==
    declared.fixedCommitSha
  ) {
    failures.push(
      'FIXED_HEAD_MISMATCH',
    );
  }

  if (
    !evidence.cleanMaterialization
  ) {
    failures.push(
      'DIRTY_MATERIALIZATION',
    );
  }

  return {
    accepted:
      failures.length === 0,

    failureCodes:
      [...new Set(failures)],
  };
}