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

export interface OsvSourceOptions {
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

function unique(
  values: readonly string[],
): string[] {
  return [...new Set(values)];
}

function parseReferences(
  value: unknown,
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const urls: string[] = [];

  for (const raw of value) {
    const reference =
      record(raw);

    if (!reference) {
      continue;
    }

    const url =
      stringValue(
        reference.url,
      );

    if (
      url &&
      url.startsWith('https://')
    ) {
      urls.push(url);
    }
  }

  return unique(urls);
}

function serializeRange(
  raw: unknown,
): string | null {
  const range =
    record(raw);

  if (!range) {
    return null;
  }

  const type =
    stringValue(range.type) ??
    'UNKNOWN';

  const events =
    Array.isArray(range.events)
      ? range.events
      : [];

  return `${type}:${JSON.stringify(events)}`;
}

function parsePackages(
  value: unknown,
): FulgorAffectedPackage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result:
    FulgorAffectedPackage[] = [];

  for (const raw of value) {
    const affected =
      record(raw);

    if (!affected) {
      continue;
    }

    const packageRecord =
      record(affected.package);

    const name =
      packageRecord
        ? stringValue(
            packageRecord.name,
          )
        : null;

    if (!name) {
      continue;
    }

    const ecosystem =
      packageRecord
        ? stringValue(
            packageRecord.ecosystem,
          )
        : null;

    const ranges =
      Array.isArray(
        affected.ranges,
      )
        ? affected.ranges
            .map(serializeRange)
            .filter(
              (
                entry,
              ): entry is string =>
                entry !== null,
            )
        : [];

    result.push({
      ecosystem,
      name,
      ranges,
    });
  }

  return result;
}

function parseCwes(
  vulnerability:
    Record<string, unknown>,
): string[] {
  const databaseSpecific =
    record(
      vulnerability
        .database_specific,
    );

  if (!databaseSpecific) {
    return [];
  }

  const raw =
    databaseSpecific.cwe_ids;

  if (!Array.isArray(raw)) {
    return [];
  }

  return unique(
    raw.filter(
      (entry): entry is string =>
        typeof entry === 'string' &&
        /^CWE-\d+$/.test(entry),
    ),
  );
}

function parseSeverity(
  vulnerability:
    Record<string, unknown>,
): string | null {
  const databaseSpecific =
    record(
      vulnerability
        .database_specific,
    );

  const direct =
    databaseSpecific
      ? stringValue(
          databaseSpecific.severity,
        )
      : null;

  if (direct) {
    return direct;
  }

  const severity =
    vulnerability.severity;

  if (!Array.isArray(severity)) {
    return null;
  }

  for (const raw of severity) {
    const item =
      record(raw);

    if (!item) {
      continue;
    }

    const score =
      stringValue(item.score);

    if (score) {
      return score;
    }
  }

  return null;
}

function parseOsv(
  raw: unknown,
  fetchedAtUtc: string,
): FulgorAdvisoryCandidate {
  const vulnerability =
    record(raw);

  if (!vulnerability) {
    throw new Error(
      'OSV_MALFORMED_VULNERABILITY',
    );
  }

  const id =
    stringValue(
      vulnerability.id,
    );

  if (!id) {
    throw new Error(
      'OSV_INVALID_ID',
    );
  }

  const aliases =
    Array.isArray(
      vulnerability.aliases,
    )
      ? vulnerability.aliases
          .filter(
            (
              entry,
            ): entry is string =>
              typeof entry ===
                'string' &&
              entry.trim().length > 0,
          )
      : [];

  return {
    schemaVersion:
      FULGOR_ADVISORY_CANDIDATE_VERSION,

    trustState:
      'UNTRUSTED_SOURCE_CANDIDATE',

    provider:
      'OSV',

    advisoryId:
      id,

    aliases:
      unique(aliases),

    summary:
      stringValue(
        vulnerability.summary,
      ) ?? '',

    details:
      stringValue(
        vulnerability.details,
      ) ?? '',

    severity:
      parseSeverity(
        vulnerability,
      ),

    cwes:
      parseCwes(
        vulnerability,
      ),

    references:
      parseReferences(
        vulnerability.references,
      ),

    affectedPackages:
      parsePackages(
        vulnerability.affected,
      ),

    publishedAtUtc:
      stringValue(
        vulnerability.published,
      ),

    modifiedAtUtc:
      stringValue(
        vulnerability.modified,
      ),

    withdrawnAtUtc:
      stringValue(
        vulnerability.withdrawn,
      ),

    sourceUrl:
      `https://osv.dev/vulnerability/${encodeURIComponent(id)}`,

    fetchedAtUtc,
  };
}

function fetcher(
  options: OsvSourceOptions,
): FulgorHttpFetch {
  return (
    options.fetchImpl ??
    defaultFulgorHttpFetch
  );
}

function fetchedAt(
  options: OsvSourceOptions,
): string {
  return (
    options.now?.() ??
    new Date()
  ).toISOString();
}

export async function fetchOsvById(
  id: string,
  options:
    OsvSourceOptions = {},
): Promise<FulgorAdvisoryCandidate> {
  if (
    id.trim().length === 0
  ) {
    throw new Error(
      'OSV_INVALID_ID',
    );
  }

  const response =
    await fetcher(options)(
      `https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`,
      {
        method: 'GET',
        headers: {
          Accept:
            'application/json',
          'User-Agent':
            'VELNAR-FULGOR-CorpusFactory/1',
        },
      },
    );

  if (!response.ok) {
    throw new Error(
      `OSV_HTTP_${response.status}`,
    );
  }

  return parseOsv(
    await response.json(),
    fetchedAt(options),
  );
}

export async function queryOsvByCommit(
  commitSha: string,
  options:
    OsvSourceOptions = {},
): Promise<
  readonly FulgorAdvisoryCandidate[]
> {
  if (
    !/^[a-f0-9]{40,64}$/.test(
      commitSha,
    )
  ) {
    throw new Error(
      'OSV_INVALID_COMMIT_SHA',
    );
  }

  const response =
    await fetcher(options)(
      'https://api.osv.dev/v1/query',
      {
        method: 'POST',
        headers: {
          Accept:
            'application/json',
          'Content-Type':
            'application/json',
          'User-Agent':
            'VELNAR-FULGOR-CorpusFactory/1',
        },
        body:
          JSON.stringify({
            commit: commitSha,
          }),
      },
    );

  if (!response.ok) {
    throw new Error(
      `OSV_HTTP_${response.status}`,
    );
  }

  const payload =
    record(
      await response.json(),
    );

  if (!payload) {
    throw new Error(
      'OSV_MALFORMED_QUERY_RESPONSE',
    );
  }

  const vulns =
    payload.vulns;

  if (
    vulns === undefined ||
    vulns === null
  ) {
    return [];
  }

  if (!Array.isArray(vulns)) {
    throw new Error(
      'OSV_MALFORMED_QUERY_RESPONSE',
    );
  }

  const results:
    FulgorAdvisoryCandidate[] = [];

  for (const raw of vulns) {
    const summary =
      record(raw);

    const id =
      summary
        ? stringValue(
            summary.id,
          )
        : null;

    if (!id) {
      throw new Error(
        'OSV_INVALID_ID',
      );
    }

    results.push(
      await fetchOsvById(
        id,
        options,
      ),
    );
  }

  return results;
}