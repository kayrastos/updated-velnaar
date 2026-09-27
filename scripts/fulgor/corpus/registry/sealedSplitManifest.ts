import {
  createHash,
} from 'node:crypto';

import type {
  KeyObject,
} from 'node:crypto';

import {
  verifySignedCorpusRegistry,
} from './signedCorpusRegistry';

import type {
  SignedCorpusRegistry,
  CorpusRegistryEntry,
} from './signedCorpusRegistry';

export const FULGOR_SPLIT_POLICY_VERSION =
  'FULGOR_PAIR_SPLIT_POLICY_V1' as const;

export const FULGOR_TRAINING_VIEW_VERSION =
  'FULGOR_TRAINING_VIEW_V1' as const;

export const FULGOR_FINAL_HOLDOUT_VERSION =
  'FULGOR_SEALED_FINAL_HOLDOUT_V1' as const;

export type CorpusSplit =
  | 'TRAIN'
  | 'DEV'
  | 'FINAL_HOLDOUT';

export interface TrainingSplitView {
  schemaVersion:
    typeof FULGOR_TRAINING_VIEW_VERSION;

  state:
    'TRAINING_VIEW_REQUIRES_EXECUTION_AUTHORIZATION';

  sourceRegistryPayloadSha256:
    string;

  splitPolicyVersion:
    typeof FULGOR_SPLIT_POLICY_VERSION;

  splitRatios: {
    train: 70;
    dev: 15;
    finalHoldout: 15;
  };

  trainPairGroupKeys:
    readonly string[];

  trainRecordIds:
    readonly string[];

  devPairGroupKeys:
    readonly string[];

  devRecordIds:
    readonly string[];

  finalHoldoutPairCount:
    number;

  finalHoldoutRecordCount:
    number;

  finalHoldoutCommitmentSha256:
    string;

  finalHoldoutRecordIdsExposed:
    false;

  trainingExecutionAuthorized:
    false;

  promotionAuthorized:
    false;

  deploymentAuthorized:
    false;

  manifestSha256:
    string;
}

export interface SealedFinalHoldout {
  schemaVersion:
    typeof FULGOR_FINAL_HOLDOUT_VERSION;

  state:
    'SEALED_FINAL_HOLDOUT';

  sourceRegistryPayloadSha256:
    string;

  splitPolicyVersion:
    typeof FULGOR_SPLIT_POLICY_VERSION;

  pairGroupKeys:
    readonly string[];

  recordIds:
    readonly string[];

  trainingVisible:
    false;

  evaluationOnly:
    true;

  trainingExecutionAuthorized:
    false;

  holdoutCommitmentSha256:
    string;
}

export interface CorpusSplitBundle {
  trainingView:
    TrainingSplitView;

  sealedFinalHoldout:
    SealedFinalHoldout;
}

export interface SplitBundleVerification {
  accepted: boolean;

  failureCodes:
    readonly (
      | 'REGISTRY_REJECTED'
      | 'TRAINING_VIEW_TAMPERED'
      | 'HOLDOUT_TAMPERED'
      | 'REGISTRY_BINDING_MISMATCH'
      | 'SPLIT_OVERLAP'
      | 'SPLIT_DERIVATION_MISMATCH'
      | 'AUTHORITY_ESCAPE'
    )[];
}

function normalize(
  value: unknown,
): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (
    typeof value === 'number'
  ) {
    if (!Number.isFinite(value)) {
      throw new Error(
        'SPLIT_NON_CANONICAL_NUMBER',
      );
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.map(
      normalize,
    );
  }

  if (
    typeof value === 'object'
  ) {
    const source =
      value as Record<
        string,
        unknown
      >;

    const result:
      Record<
        string,
        unknown
      > = {};

    for (
      const key of
      Object.keys(source).sort()
    ) {
      const item =
        source[key];

      if (item === undefined) {
        throw new Error(
          'SPLIT_NON_CANONICAL_UNDEFINED',
        );
      }

      result[key] =
        normalize(item);
    }

    return result;
  }

  throw new Error(
    'SPLIT_NON_CANONICAL_VALUE',
  );
}

function digest(
  value: unknown,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        normalize(value),
      ),
      'utf8',
    )
    .digest('hex');
}

function splitForPair(
  pairGroupKey: string,
): CorpusSplit {
  const hash =
    createHash('sha256')
      .update(
        [
          FULGOR_SPLIT_POLICY_VERSION,
          pairGroupKey,
        ].join('\0'),
        'utf8',
      )
      .digest('hex');

  const bucket =
    Number.parseInt(
      hash.slice(0, 8),
      16,
    ) % 100;

  if (bucket < 70) {
    return 'TRAIN';
  }

  if (bucket < 85) {
    return 'DEV';
  }

  return 'FINAL_HOLDOUT';
}

function groupedEntries(
  registry:
    SignedCorpusRegistry,
): Map<
  string,
  CorpusRegistryEntry[]
> {
  const groups =
    new Map<
      string,
      CorpusRegistryEntry[]
    >();

  for (
    const entry of
    registry.entries
  ) {
    const group =
      groups.get(
        entry.pairGroupKey,
      ) ?? [];

    group.push(entry);

    groups.set(
      entry.pairGroupKey,
      group,
    );
  }

  return groups;
}

function sorted(
  values:
    Iterable<string>,
): string[] {
  return [...values].sort();
}

function noOverlap(
  left:
    readonly string[],

  right:
    readonly string[],
): boolean {
  const seen =
    new Set(left);

  return right.every(
    (value) =>
      !seen.has(value),
  );
}

function deepFreeze<T>(
  value: T,
): T {
  if (
    value !== null &&
    typeof value === 'object'
  ) {
    for (
      const child of
      Object.values(
        value as Record<
          string,
          unknown
        >,
      )
    ) {
      deepFreeze(child);
    }

    Object.freeze(value);
  }

  return value;
}

function derive(
  registry:
    SignedCorpusRegistry,
): CorpusSplitBundle {
  const groups =
    groupedEntries(
      registry,
    );

  const trainGroups:
    string[] = [];

  const trainRecords:
    string[] = [];

  const devGroups:
    string[] = [];

  const devRecords:
    string[] = [];

  const holdoutGroups:
    string[] = [];

  const holdoutRecords:
    string[] = [];

  for (
    const [
      groupKey,
      entries,
    ] of groups
  ) {
    const split =
      splitForPair(
        groupKey,
      );

    const recordIds =
      entries.map(
        (entry) =>
          entry.record.recordId,
      );

    if (split === 'TRAIN') {
      trainGroups.push(
        groupKey,
      );

      trainRecords.push(
        ...recordIds,
      );

      continue;
    }

    if (split === 'DEV') {
      devGroups.push(
        groupKey,
      );

      devRecords.push(
        ...recordIds,
      );

      continue;
    }

    holdoutGroups.push(
      groupKey,
    );

    holdoutRecords.push(
      ...recordIds,
    );
  }

  const sealedCore = {
    schemaVersion:
      FULGOR_FINAL_HOLDOUT_VERSION,

    state:
      'SEALED_FINAL_HOLDOUT' as const,

    sourceRegistryPayloadSha256:
      registry
        .registryPayloadSha256,

    splitPolicyVersion:
      FULGOR_SPLIT_POLICY_VERSION,

    pairGroupKeys:
      sorted(
        holdoutGroups,
      ),

    recordIds:
      sorted(
        holdoutRecords,
      ),

    trainingVisible:
      false as const,

    evaluationOnly:
      true as const,

    trainingExecutionAuthorized:
      false as const,
  };

  const holdoutCommitmentSha256 =
    digest(
      sealedCore,
    );

  const sealedFinalHoldout:
    SealedFinalHoldout = {
    ...sealedCore,

    holdoutCommitmentSha256,
  };

  const trainingCore = {
    schemaVersion:
      FULGOR_TRAINING_VIEW_VERSION,

    state:
      'TRAINING_VIEW_REQUIRES_EXECUTION_AUTHORIZATION' as const,

    sourceRegistryPayloadSha256:
      registry
        .registryPayloadSha256,

    splitPolicyVersion:
      FULGOR_SPLIT_POLICY_VERSION,

    splitRatios: {
      train: 70 as const,
      dev: 15 as const,
      finalHoldout:
        15 as const,
    },

    trainPairGroupKeys:
      sorted(
        trainGroups,
      ),

    trainRecordIds:
      sorted(
        trainRecords,
      ),

    devPairGroupKeys:
      sorted(
        devGroups,
      ),

    devRecordIds:
      sorted(
        devRecords,
      ),

    finalHoldoutPairCount:
      holdoutGroups.length,

    finalHoldoutRecordCount:
      holdoutRecords.length,

    finalHoldoutCommitmentSha256:
      holdoutCommitmentSha256,

    finalHoldoutRecordIdsExposed:
      false as const,

    trainingExecutionAuthorized:
      false as const,

    promotionAuthorized:
      false as const,

    deploymentAuthorized:
      false as const,
  };

  const trainingView:
    TrainingSplitView = {
    ...trainingCore,

    manifestSha256:
      digest(
        trainingCore,
      ),
  };

  return deepFreeze({
    trainingView,
    sealedFinalHoldout,
  });
}

export function createSealedCorpusSplitBundle(
  registry:
    SignedCorpusRegistry,

  registryPublicKey:
    KeyObject,
): CorpusSplitBundle {
  const verified =
    verifySignedCorpusRegistry(
      registry,
      registryPublicKey,
    );

  if (!verified.accepted) {
    throw new Error(
      [
        'SPLIT_REGISTRY_REJECTED',
        ...verified.failureCodes,
      ].join(':'),
    );
  }

  return derive(registry);
}

export function verifySealedCorpusSplitBundle(
  bundle:
    CorpusSplitBundle,

  registry:
    SignedCorpusRegistry,

  registryPublicKey:
    KeyObject,
): SplitBundleVerification {
  const failures:
    SplitBundleVerification[
      'failureCodes'
    ][number][] = [];

  const registryVerified =
    verifySignedCorpusRegistry(
      registry,
      registryPublicKey,
    );

  if (!registryVerified.accepted) {
    failures.push(
      'REGISTRY_REJECTED',
    );

    return {
      accepted: false,
      failureCodes:
        failures,
    };
  }

  if (
    bundle.trainingView
      .sourceRegistryPayloadSha256 !==
      registry
        .registryPayloadSha256 ||
    bundle.sealedFinalHoldout
      .sourceRegistryPayloadSha256 !==
      registry
        .registryPayloadSha256
  ) {
    failures.push(
      'REGISTRY_BINDING_MISMATCH',
    );
  }

  const {
    manifestSha256:
      _manifestSha256,
    ...trainingCore
  } =
    bundle.trainingView;

  if (
    digest(
      trainingCore,
    ) !==
      bundle.trainingView
        .manifestSha256
  ) {
    failures.push(
      'TRAINING_VIEW_TAMPERED',
    );
  }

  const {
    holdoutCommitmentSha256:
      _holdoutCommitment,
    ...holdoutCore
  } =
    bundle
      .sealedFinalHoldout;

  if (
    digest(
      holdoutCore,
    ) !==
      bundle
        .sealedFinalHoldout
        .holdoutCommitmentSha256
  ) {
    failures.push(
      'HOLDOUT_TAMPERED',
    );
  }

  if (
    bundle.trainingView
      .finalHoldoutCommitmentSha256 !==
      bundle
        .sealedFinalHoldout
        .holdoutCommitmentSha256
  ) {
    failures.push(
      'HOLDOUT_TAMPERED',
    );
  }

  if (
    !noOverlap(
      bundle.trainingView
        .trainRecordIds,
      bundle.trainingView
        .devRecordIds,
    ) ||
    !noOverlap(
      bundle.trainingView
        .trainRecordIds,
      bundle
        .sealedFinalHoldout
        .recordIds,
    ) ||
    !noOverlap(
      bundle.trainingView
        .devRecordIds,
      bundle
        .sealedFinalHoldout
        .recordIds,
    )
  ) {
    failures.push(
      'SPLIT_OVERLAP',
    );
  }

  if (
    bundle.trainingView
      .trainingExecutionAuthorized !==
      false ||
    bundle.trainingView
      .promotionAuthorized !==
      false ||
    bundle.trainingView
      .deploymentAuthorized !==
      false ||
    bundle
      .sealedFinalHoldout
      .trainingVisible !==
      false ||
    bundle
      .sealedFinalHoldout
      .trainingExecutionAuthorized !==
      false
  ) {
    failures.push(
      'AUTHORITY_ESCAPE',
    );
  }

  const expected =
    derive(registry);

  if (
    expected.trainingView
      .manifestSha256 !==
      bundle.trainingView
        .manifestSha256 ||
    expected
      .sealedFinalHoldout
      .holdoutCommitmentSha256 !==
      bundle
        .sealedFinalHoldout
        .holdoutCommitmentSha256
  ) {
    failures.push(
      'SPLIT_DERIVATION_MISMATCH',
    );
  }

  return {
    accepted:
      failures.length === 0,

    failureCodes:
      [...new Set(
        failures,
      )],
  };
}