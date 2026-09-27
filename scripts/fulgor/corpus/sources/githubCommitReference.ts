export interface GithubCommitReference {
  repository: string;
  commitSha: string;
  canonicalUrl: string;
}

const NAME =
  /^[A-Za-z0-9_.-]+$/;

const SHA =
  /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

export function parseGithubCommitReference(
  input: string,
): GithubCommitReference | null {
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
    url.port !== '' ||
    url.username !== '' ||
    url.password !== ''
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
            decodeURIComponent(part),
        );
  } catch {
    return null;
  }

  if (
    parts.length !== 4 ||
    parts[2] !== 'commit'
  ) {
    return null;
  }

  const [
    owner,
    rawRepository,
    ,
    rawSha,
  ] = parts;

  const repository =
    rawRepository.endsWith('.git')
      ? rawRepository.slice(0, -4)
      : rawRepository;

  const commitSha =
    rawSha.toLowerCase();

  if (
    !NAME.test(owner) ||
    !NAME.test(repository) ||
    !SHA.test(commitSha)
  ) {
    return null;
  }

  const canonicalRepository =
    `${owner}/${repository}`;

  return {
    repository:
      canonicalRepository,

    commitSha,

    canonicalUrl:
      `https://github.com/${canonicalRepository}/commit/${commitSha}`,
  };
}