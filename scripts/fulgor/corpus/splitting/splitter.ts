import {
  createHash,
} from 'node:crypto';

import type {
  FulgorCorpusRecord,
} from '../corpusRecord';

import type {
  CorpusAssignment,
  CorpusSplit,
} from './leakageGuard';

export interface CorpusSplitPolicy {
  train: number;
  dev: number;
  challenge: number;
  holdout: number;
}

export const DEFAULT_CORPUS_SPLIT_POLICY:
  CorpusSplitPolicy = {
    train: 0.70,
    dev: 0.10,
    challenge: 0.10,
    holdout: 0.10,
  };

function validatePolicy(
  policy: CorpusSplitPolicy,
): void {
  const values = [
    policy.train,
    policy.dev,
    policy.challenge,
    policy.holdout,
  ];

  if (
    values.some(
      (value) =>
        !Number.isFinite(value) ||
        value < 0 ||
        value > 1,
    )
  ) {
    throw new Error(
      'INVALID_CORPUS_SPLIT_POLICY',
    );
  }

  const total =
    values.reduce(
      (sum, value) => sum + value,
      0,
    );

  if (Math.abs(total - 1) > 1e-9) {
    throw new Error(
      'INVALID_CORPUS_SPLIT_POLICY',
    );
  }
}

function deterministicBucket(
  key: string,
): number {
  const digest =
    createHash('sha256')
      .update(key, 'utf8')
      .digest('hex');

  const prefix =
    digest.slice(0, 8);

  return (
    Number.parseInt(prefix, 16) /
    0xffffffff
  );
}

function bucketToSplit(
  bucket: number,
  policy: CorpusSplitPolicy,
): CorpusSplit {
  const trainEnd =
    policy.train;

  const devEnd =
    trainEnd + policy.dev;

  const challengeEnd =
    devEnd + policy.challenge;

  if (bucket < trainEnd) {
    return 'TRAIN';
  }

  if (bucket < devEnd) {
    return 'DEV';
  }

  if (bucket < challengeEnd) {
    return 'CHALLENGE';
  }

  return 'HOLDOUT';
}

class DisjointSet {
  private readonly parent =
    new Map<string, string>();

  add(value: string): void {
    if (!this.parent.has(value)) {
      this.parent.set(value, value);
    }
  }

  find(value: string): string {
    this.add(value);

    const parent =
      this.parent.get(value);

    if (!parent) {
      throw new Error(
        'CORPUS_DSU_INVARIANT_FAILED',
      );
    }

    if (parent === value) {
      return value;
    }

    const root =
      this.find(parent);

    this.parent.set(value, root);

    return root;
  }

  union(
    left: string,
    right: string,
  ): void {
    const leftRoot =
      this.find(left);

    const rightRoot =
      this.find(right);

    if (leftRoot === rightRoot) {
      return;
    }

    const [first, second] =
      [leftRoot, rightRoot].sort();

    this.parent.set(second, first);
  }
}

export function splitCorpusDeterministically(
  records: readonly FulgorCorpusRecord[],
  policy: CorpusSplitPolicy =
    DEFAULT_CORPUS_SPLIT_POLICY,
): readonly CorpusAssignment[] {
  validatePolicy(policy);

  const dsu =
    new DisjointSet();

  const advisoryRepository =
    new Map<string, string>();

  for (const record of records) {
    const repository =
      record.source.repository.toLowerCase();

    dsu.add(repository);

    const advisory =
      record.source.advisoryId
        ?.toUpperCase();

    if (!advisory) {
      continue;
    }

    const existing =
      advisoryRepository.get(advisory);

    if (existing) {
      dsu.union(
        existing,
        repository,
      );
    } else {
      advisoryRepository.set(
        advisory,
        repository,
      );
    }
  }

  const componentRepositories =
    new Map<string, Set<string>>();

  for (const record of records) {
    const repository =
      record.source.repository.toLowerCase();

    const root =
      dsu.find(repository);

    const repositories =
      componentRepositories.get(root) ??
      new Set<string>();

    repositories.add(repository);

    componentRepositories.set(
      root,
      repositories,
    );
  }

  const componentSplit =
    new Map<string, CorpusSplit>();

  for (
    const [
      root,
      repositories,
    ] of componentRepositories
  ) {
    const isolationKey =
      [...repositories]
        .sort()
        .join('|');

    componentSplit.set(
      root,
      bucketToSplit(
        deterministicBucket(
          isolationKey,
        ),
        policy,
      ),
    );
  }

  return records
    .map((record) => {
      const repository =
        record.source.repository
          .toLowerCase();

      const root =
        dsu.find(repository);

      const split =
        componentSplit.get(root);

      if (!split) {
        throw new Error(
          'CORPUS_SPLIT_INVARIANT_FAILED',
        );
      }

      return {
        split,
        record,
      };
    })
    .sort(
      (left, right) =>
        left.record.recordId.localeCompare(
          right.record.recordId,
        ),
    );
}