import {
  FULGOR_ADVISORY_CANDIDATE_VERSION,
} from './advisoryCandidate';

import {
  defaultFulgorHttpFetch,
} from './http';

import type {
  FulgorAdvisoryCandidate,
  FulgorAffectedPackage,
} from './advisoryCandidate';

import type {
  FulgorHttpFetch,
} from './http';

export interface GithubAdvisoryFetchOptions {
  perPage?: number;
  ghsaId?: string;
  cwes?: readonly string[];
  severity?:
    | 'unknown'
    | 'low'
    | 'medium'
    | 'high'
    | 'critical';
  token?: string;
  fetchImpl?: FulgorHttpFetch;
  now?: () => Date;
}

function record(
  value: unknown,
): Record<string, unknown> | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value)
  ) {
    return null;
  }

  return value as Record<string, unknown>;
}

function stringValue(
  value: unknown,
): string | null {
  return (
    typeof value === 'string' &&
    value.trim().length > 0
  )
    ? value
    : null;
}

function stringArray(
  value: unknown,
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(
      (entry): entry is string =>
        typeof entry === 'string' &&
        entry.trim().length > 0,
    );
}

function unique(
  values: readonly string[],
): string[] {
  return [...new Set(values)];
}

function parseCwes(
  value: unknown,
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: string[] = [];

  for (const entry of value) {
    const item = record(entry);

    if (!item) {
      continue;
    }

    const cwe =
      stringValue(item.cwe_id);

    if (cwe) {
      result.push(cwe);
    }
  }

  return unique(result);
}

function parseReferences(
  value: unknown,
): string[] {
  return unique(
    stringArray(value)
      .filter(
        (url) =>
          url.startsWith('https://'),
      ),
  );
}

function parseAliases(
  advisory:
    Record<string, unknown>,
): string[] {
  const aliases: string[] = [];

  const cve =
    stringValue(advisory.cve_id);

  if (cve) {
    aliases.push(cve);
  }

  const identifiers =
    advisory.identifiers;

  if (Array.isArray(identifiers)) {
    for (const raw of identifiers) {
      const identifier =
        record(raw);

      if (!identifier) {
        continue;
      }

      const value =
        stringValue(
          identifier.value,
        );

      if (value) {
        aliases.push(value);
      }
    }
  }

  return unique(aliases);
}

function parsePackages(
  value: unknown,
): FulgorAffectedPackage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const packages:
    FulgorAffectedPackage[] = [];

  for (const raw of value) {
    const vulnerability =
      record(raw);

    if (!vulnerability) {
      continue;
    }

    const packageRecord =
      record(
        vulnerability.package,
      );

    if (!packageRecord) {
      continue;
    }

    const name =
      stringValue(
        packageRecord.name,
      );

    if (!name) {
      continue;
    }

    const ecosystem =
      stringValue(
        packageRecord.ecosystem,
      );

    const ranges: string[] = [];

    const vulnerableRange =
      stringValue(
        vulnerability
          .vulnerable_version_range,
      );

    if (vulnerableRange) {
      ranges.push(
        `vulnerable:${vulnerableRange}`,
      );
    }

    const patched =
      record(
        vulnerability
          .first_patched_version,
      );

    const patchedVersion =
      patched
        ? stringValue(
            patched.identifier,
          )
        : null;

    if (patchedVersion) {
      ranges.push(
        `first_patched:${patchedVersion}`,
      );
    }

    packages.push({
      ecosystem,
      name,
      ranges,
    });
  }

  return packages;
}

function parseGithubAdvisory(
  raw: unknown,
  fetchedAtUtc: string,
): FulgorAdvisoryCandidate {
  const advisory =
    record(raw);

  if (!advisory) {
    throw new Error(
      'GHSA_MALFORMED_ADVISORY',
    );
  }

  const advisoryId =
    stringValue(advisory.ghsa_id);

  if (
    !advisoryId ||
    !/^GHSA-[A-Za-z0-9-]+$/.test(
      advisoryId,
    )
  ) {
    throw new Error(
      'GHSA_INVALID_ADVISORY_ID',
    );
  }

  const sourceUrl =
    stringValue(
      advisory.html_url,
    ) ??
    `https://github.com/advisories/${advisoryId}`;

  if (
    !sourceUrl.startsWith(
      'https://',
    )
  ) {
    throw new Error(
      'GHSA_INVALID_SOURCE_URL',
    );
  }

  return {
    schemaVersion:
      FULGOR_ADVISORY_CANDIDATE_VERSION,

    trustState:
      'UNTRUSTED_SOURCE_CANDIDATE',

    provider:
      'GHSA',

    advisoryId,

    aliases:
      parseAliases(advisory)
        .filter(
          (alias) =>
            alias !== advisoryId,
        ),

    summary:
      stringValue(
        advisory.summary,
      ) ?? '',

    details:
      stringValue(
        advisory.description,
      ) ?? '',

    severity:
      stringValue(
        advisory.severity,
      ),

    cwes:
      parseCwes(
        advisory.cwes,
      ),

    references:
      parseReferences(
        advisory.references,
      ),

    affectedPackages:
      parsePackages(
        advisory.vulnerabilities,
      ),

    publishedAtUtc:
      stringValue(
        advisory.published_at,
      ),

    modifiedAtUtc:
      stringValue(
        advisory.updated_at,
      ),

    withdrawnAtUtc:
      stringValue(
        advisory.withdrawn_at,
      ),

    sourceUrl,

    fetchedAtUtc,
  };
}

export async function fetchGithubAdvisoryCandidates(
  options:
    GithubAdvisoryFetchOptions = {},
): Promise<
  readonly FulgorAdvisoryCandidate[]
> {
  const perPage =
    options.perPage ?? 30;

  if (
    !Number.isInteger(perPage) ||
    perPage < 1 ||
    perPage > 100
  ) {
    throw new Error(
      'GHSA_INVALID_PER_PAGE',
    );
  }

  const url =
    new URL(
      'https://api.github.com/advisories',
    );

  url.searchParams.set(
    'type',
    'reviewed',
  );

  url.searchParams.set(
    'per_page',
    String(perPage),
  );

  url.searchParams.set(
    'direction',
    'desc',
  );

  url.searchParams.set(
    'sort',
    'updated',
  );

  if (options.ghsaId) {
    if (
      !/^GHSA-[A-Za-z0-9-]+$/.test(
        options.ghsaId,
      )
    ) {
      throw new Error(
        'GHSA_INVALID_FILTER_ID',
      );
    }

    url.searchParams.set(
      'ghsa_id',
      options.ghsaId,
    );
  }

  if (options.severity) {
    url.searchParams.set(
      'severity',
      options.severity,
    );
  }

  if (
    options.cwes &&
    options.cwes.length > 0
  ) {
    url.searchParams.set(
      'cwes',
      options.cwes.join(','),
    );
  }

  const headers:
    Record<string, string> = {
      Accept:
        'application/vnd.github+json',

      'X-GitHub-Api-Version':
        '2022-11-28',

      'User-Agent':
        'VELNAR-FULGOR-CorpusFactory/1',
    };

  if (options.token) {
    headers.Authorization =
      `Bearer ${options.token}`;
  }

  const fetchImpl =
    options.fetchImpl ??
    defaultFulgorHttpFetch;

  const response =
    await fetchImpl(
      url.toString(),
      {
        method: 'GET',
        headers,
      },
    );

  if (!response.ok) {
    throw new Error(
      `GHSA_HTTP_${response.status}`,
    );
  }

  const payload =
    await response.json();

  if (!Array.isArray(payload)) {
    throw new Error(
      'GHSA_MALFORMED_RESPONSE',
    );
  }

  const fetchedAtUtc =
    (
      options.now?.() ??
      new Date()
    ).toISOString();

  return payload.map(
    (entry) =>
      parseGithubAdvisory(
        entry,
        fetchedAtUtc,
      ),
  );
}