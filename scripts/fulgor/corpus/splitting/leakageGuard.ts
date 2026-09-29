import type {
  FulgorCorpusRecord,
} from '../corpusRecord';

export type CorpusSplit =
  | 'TRAIN'
  | 'DEV'
  | 'CHALLENGE'
  | 'HOLDOUT';

export interface CorpusAssignment {
  split: CorpusSplit;
  record: FulgorCorpusRecord;
}

export type CorpusLeakType =
  | 'REPOSITORY'
  | 'ADVISORY'
  | 'CONTENT_HASH';

export interface CorpusLeak {
  type: CorpusLeakType;
  key: string;
  firstSplit: CorpusSplit;
  secondSplit: CorpusSplit;
}

export interface CorpusLeakageResult {
  accepted: boolean;
  leaks: readonly CorpusLeak[];
}

function observe(
  map: Map<string, CorpusSplit>,
  leaks: CorpusLeak[],
  type: CorpusLeakType,
  key: string,
  split: CorpusSplit,
): void {
  const first = map.get(key);

  if (first && first !== split) {
    leaks.push({
      type,
      key,
      firstSplit: first,
      secondSplit: split,
    });

    return;
  }

  map.set(key, split);
}

export function evaluateCorpusLeakage(
  assignments: readonly CorpusAssignment[],
): CorpusLeakageResult {
  const leaks: CorpusLeak[] = [];

  const repositories =
    new Map<string, CorpusSplit>();

  const advisories =
    new Map<string, CorpusSplit>();

  const contentHashes =
    new Map<string, CorpusSplit>();

  for (const assignment of assignments) {
    const record = assignment.record;

    observe(
      repositories,
      leaks,
      'REPOSITORY',
      record.source.repository.toLowerCase(),
      assignment.split,
    );

    if (record.source.advisoryId) {
      observe(
        advisories,
        leaks,
        'ADVISORY',
        record.source.advisoryId.toUpperCase(),
        assignment.split,
      );
    }

    observe(
      contentHashes,
      leaks,
      'CONTENT_HASH',
      record.provenance.sourceContentSha256,
      assignment.split,
    );
  }

  const uniqueLeaks =
    new Map<string, CorpusLeak>();

  for (const leak of leaks) {
    const id = [
      leak.type,
      leak.key,
      leak.firstSplit,
      leak.secondSplit,
    ].join(':');

    uniqueLeaks.set(id, leak);
  }

  return {
    accepted: uniqueLeaks.size === 0,
    leaks: [...uniqueLeaks.values()],
  };
}