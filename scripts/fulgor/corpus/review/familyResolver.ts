import type {
  FulgorCorpusFamily,
} from '../corpusRecord';

const CWE_FAMILY =
  new Map<
    string,
    FulgorCorpusFamily
  >([
    [
      'CWE-22',
      'PATH_TRAVERSAL',
    ],

    [
      'CWE-78',
      'COMMAND_EXECUTION',
    ],

    [
      'CWE-79',
      'XSS',
    ],

    [
      'CWE-89',
      'QUERY_INJECTION',
    ],

    [
      'CWE-502',
      'DESERIALIZATION',
    ],

    [
      'CWE-862',
      'AUTHORIZATION',
    ],

    [
      'CWE-863',
      'AUTHORIZATION',
    ],

    [
      'CWE-918',
      'SSRF',
    ],

    [
      'CWE-942',
      'CORS',
    ],

    [
      'CWE-798',
      'SECRET_EXPOSURE',
    ],
  ]);

export interface FamilyResolution {
  family:
    FulgorCorpusFamily | null;

  matchedCwes:
    readonly string[];

  decision:
    | 'RESOLVED'
    | 'UNRESOLVED'
    | 'AMBIGUOUS';
}

export function resolveFamilyFromCwes(
  cwes: readonly string[],
): FamilyResolution {
  const families =
    new Map<
      FulgorCorpusFamily,
      string[]
    >();

  for (const raw of cwes) {
    const cwe =
      raw.toUpperCase();

    const family =
      CWE_FAMILY.get(cwe);

    if (!family) {
      continue;
    }

    const existing =
      families.get(family) ??
      [];

    existing.push(cwe);

    families.set(
      family,
      existing,
    );
  }

  if (families.size === 0) {
    return {
      family: null,
      matchedCwes: [],
      decision:
        'UNRESOLVED',
    };
  }

  if (families.size > 1) {
    return {
      family: null,

      matchedCwes:
        [...families.values()]
          .flat()
          .sort(),

      decision:
        'AMBIGUOUS',
    };
  }

  const [
    family,
    matchedCwes,
  ] =
    [...families.entries()][0];

  return {
    family,

    matchedCwes:
      [...matchedCwes].sort(),

    decision:
      'RESOLVED',
  };
}