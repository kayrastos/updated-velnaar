import {
  createHash,
} from 'node:crypto';

import type {
  KeyObject,
} from 'node:crypto';

import {
  verifySignedCorpusRegistry,
} from '../corpus/registry/signedCorpusRegistry';

import type {
  SignedCorpusRegistry,
  CorpusRegistryEntry,
} from '../corpus/registry/signedCorpusRegistry';

import {
  verifySealedCorpusSplitBundle,
} from '../corpus/registry/sealedSplitManifest';

import type {
  CorpusSplitBundle,
} from '../corpus/registry/sealedSplitManifest';

import type {
  FulgorCorpusFamily,
  FulgorCorpusRole,
  FulgorCorpusVerdict,
} from '../corpus/corpusRecord';

export const FULGOR_TRAINING_MATERIALIZATION_MANIFEST_VERSION =
  'FULGOR_TRAINING_MATERIALIZATION_MANIFEST_V1' as const;

export const FULGOR_TRAINING_MATERIALIZATION_REQUEST_VERSION =
  'FULGOR_TRAINING_MATERIALIZATION_REQUEST_V1' as const;

export type FulgorTrainingVisibleSplit =
  | 'TRAIN'
  | 'DEV';

export interface FulgorTrainingMaterializationRequest {
  schemaVersion:
    typeof FULGOR_TRAINING_MATERIALIZATION_REQUEST_VERSION;

  split:
    FulgorTrainingVisibleSplit;

  recordId:
    string;

  recordSha256:
    string;

  pairGroupKey:
    string;

  family:
    FulgorCorpusFamily;

  role:
    FulgorCorpusRole;

  verdict:
    FulgorCorpusVerdict;

  repository:
    string;

  advisoryId:
    string | null;

  sourceImmutableRevision:
    string;

  sourceCommitSha:
    string;

  vulnerableCommitSha:
    string;

  fixedCommitSha:
    string;

  sourceContentSha256:
    string;

  prompt:
    string;

  expectedEvidence:
    readonly string[];

  expectedRemediation:
    readonly string[];
}

export interface FulgorTrainingMaterializationManifest {
  schemaVersion:
    typeof FULGOR_TRAINING_MATERIALIZATION_MANIFEST_VERSION;

  state:
    'VERIFIED_MATERIALIZATION_MANIFEST_REQUIRES_EXECUTION_AUTHORIZATION';

  sourceRegistryPayloadSha256:
    string;

  sourceTrainingManifestSha256:
    string;

  sourceFinalHoldoutCommitmentSha256:
    string;

  trainRequests:
    readonly FulgorTrainingMaterializationRequest[];

  devRequests:
    readonly FulgorTrainingMaterializationRequest[];

  finalHoldoutRecordCount:
    number;

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

export type TrainingMaterializationManifestFailureCode =
  | 'REGISTRY_REJECTED'
  | 'SPLIT_BUNDLE_REJECTED'
  | 'REGISTRY_BINDING_MISMATCH'
  | 'TRAINING_MANIFEST_BINDING_MISMATCH'
  | 'HOLDOUT_BINDING_MISMATCH'
  | 'FINAL_HOLDOUT_EXPOSED'
  | 'SPLIT_OVERLAP'
  | 'AUTHORITY_ESCAPE'
  | 'MANIFEST_DIGEST_MISMATCH'
  | 'MANIFEST_DERIVATION_MISMATCH'
  | 'TRAINING_RECORD_INVALID_SOURCE_IDENTITY';

export interface TrainingMaterializationManifestVerification {
  accepted:
    boolean;

  failureCodes:
    readonly TrainingMaterializationManifestFailureCode[];
}

const SHA =
  /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

const SHA256 =
  /^[a-f0-9]{64}$/;

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

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(
        'TRAINING_MANIFEST_NON_CANONICAL_NUMBER',
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

    const target:
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
          'TRAINING_MANIFEST_NON_CANONICAL_UNDEFINED',
        );
      }

      target[key] =
        normalize(item);
    }

    return target;
  }

  throw new Error(
    'TRAINING_MANIFEST_NON_CANONICAL_VALUE',
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

function requestFromEntry(
  entry:
    CorpusRegistryEntry,

  split:
    FulgorTrainingVisibleSplit,
): FulgorTrainingMaterializationRequest {
  const record =
    entry.record;

  const sourceCommitSha =
    record.provenance
      .sourceCommitSha;

  const vulnerableCommitSha =
    record.provenance
      .vulnerableCommitSha;

  const fixedCommitSha =
    record.provenance
      .fixedCommitSha;

  if (
    sourceCommitSha === null ||
    vulnerableCommitSha === null ||
    fixedCommitSha === null ||
    !SHA.test(sourceCommitSha) ||
    !SHA.test(vulnerableCommitSha) ||
    !SHA.test(fixedCommitSha) ||
    record.source
      .immutableRevision !==
      sourceCommitSha ||
    !SHA256.test(
      record.provenance
        .sourceContentSha256,
    )
  ) {
    throw new Error(
      [
        'TRAINING_RECORD_INVALID_SOURCE_IDENTITY',
        record.recordId,
      ].join(':'),
    );
  }

  return {
    schemaVersion:
      FULGOR_TRAINING_MATERIALIZATION_REQUEST_VERSION,

    split,

    recordId:
      record.recordId,

    recordSha256:
      entry.recordSha256,

    pairGroupKey:
      entry.pairGroupKey,

    family:
      record.family,

    role:
      record.role,

    verdict:
      record.verdict,

    repository:
      record.source.repository,

    advisoryId:
      record.source.advisoryId,

    sourceImmutableRevision:
      record.source
        .immutableRevision,

    sourceCommitSha,

    vulnerableCommitSha,

    fixedCommitSha,

    sourceContentSha256:
      record.provenance
        .sourceContentSha256,

    prompt:
      record.prompt,

    expectedEvidence:
      [...record.expectedEvidence],

    expectedRemediation:
      [...record.expectedRemediation],
  };
}

function derive(
  registry:
    SignedCorpusRegistry,

  splitBundle:
    CorpusSplitBundle,
): FulgorTrainingMaterializationManifest {
  const entryByRecordId =
    new Map(
      registry.entries.map(
        (entry) => [
          entry.record.recordId,
          entry,
        ],
      ),
    );

  const trainIds =
    [...splitBundle
      .trainingView
      .trainRecordIds]
      .sort();

  const devIds =
    [...splitBundle
      .trainingView
      .devRecordIds]
      .sort();

  const holdoutIds =
    new Set(
      splitBundle
        .sealedFinalHoldout
        .recordIds,
    );

  const trainSet =
    new Set(
      trainIds,
    );

  if (
    trainIds.some(
      (id) =>
        holdoutIds.has(id),
    ) ||
    devIds.some(
      (id) =>
        holdoutIds.has(id),
    ) ||
    devIds.some(
      (id) =>
        trainSet.has(id),
    )
  ) {
    throw new Error(
      'TRAINING_MATERIALIZATION_SPLIT_OVERLAP',
    );
  }

  const resolve =
    (
      recordId: string,
      split:
        FulgorTrainingVisibleSplit,
    ) => {
      const entry =
        entryByRecordId.get(
          recordId,
        );

      if (!entry) {
        throw new Error(
          [
            'TRAINING_RECORD_MISSING',
            recordId,
          ].join(':'),
        );
      }

      return requestFromEntry(
        entry,
        split,
      );
    };

  const trainRequests =
    trainIds.map(
      (recordId) =>
        resolve(
          recordId,
          'TRAIN',
        ),
    );

  const devRequests =
    devIds.map(
      (recordId) =>
        resolve(
          recordId,
          'DEV',
        ),
    );

  const core = {
    schemaVersion:
      FULGOR_TRAINING_MATERIALIZATION_MANIFEST_VERSION,

    state:
      'VERIFIED_MATERIALIZATION_MANIFEST_REQUIRES_EXECUTION_AUTHORIZATION' as const,

    sourceRegistryPayloadSha256:
      registry
        .registryPayloadSha256,

    sourceTrainingManifestSha256:
      splitBundle
        .trainingView
        .manifestSha256,

    sourceFinalHoldoutCommitmentSha256:
      splitBundle
        .sealedFinalHoldout
        .holdoutCommitmentSha256,

    trainRequests,

    devRequests,

    finalHoldoutRecordCount:
      splitBundle
        .trainingView
        .finalHoldoutRecordCount,

    finalHoldoutRecordIdsExposed:
      false as const,

    trainingExecutionAuthorized:
      false as const,

    promotionAuthorized:
      false as const,

    deploymentAuthorized:
      false as const,
  };

  return deepFreeze({
    ...core,

    manifestSha256:
      digest(core),
  });
}

export function createTrainingMaterializationManifest(
  registry:
    SignedCorpusRegistry,

  splitBundle:
    CorpusSplitBundle,

  registryPublicKey:
    KeyObject,
): FulgorTrainingMaterializationManifest {
  const registryVerification =
    verifySignedCorpusRegistry(
      registry,
      registryPublicKey,
    );

  if (!registryVerification.accepted) {
    throw new Error(
      [
        'TRAINING_MATERIALIZATION_REGISTRY_REJECTED',
        ...registryVerification
          .failureCodes,
      ].join(':'),
    );
  }

  const splitVerification =
    verifySealedCorpusSplitBundle(
      splitBundle,
      registry,
      registryPublicKey,
    );

  if (!splitVerification.accepted) {
    throw new Error(
      [
        'TRAINING_MATERIALIZATION_SPLIT_REJECTED',
        ...splitVerification
          .failureCodes,
      ].join(':'),
    );
  }

  return derive(
    registry,
    splitBundle,
  );
}

export function verifyTrainingMaterializationManifest(
  manifest:
    FulgorTrainingMaterializationManifest,

  registry:
    SignedCorpusRegistry,

  splitBundle:
    CorpusSplitBundle,

  registryPublicKey:
    KeyObject,
): TrainingMaterializationManifestVerification {
  const failures:
    TrainingMaterializationManifestFailureCode[] = [];

  if (
    !verifySignedCorpusRegistry(
      registry,
      registryPublicKey,
    ).accepted
  ) {
    return {
      accepted: false,
      failureCodes: [
        'REGISTRY_REJECTED',
      ],
    };
  }

  if (
    !verifySealedCorpusSplitBundle(
      splitBundle,
      registry,
      registryPublicKey,
    ).accepted
  ) {
    return {
      accepted: false,
      failureCodes: [
        'SPLIT_BUNDLE_REJECTED',
      ],
    };
  }

  if (
    manifest
      .sourceRegistryPayloadSha256 !==
    registry
      .registryPayloadSha256
  ) {
    failures.push(
      'REGISTRY_BINDING_MISMATCH',
    );
  }

  if (
    manifest
      .sourceTrainingManifestSha256 !==
    splitBundle
      .trainingView
      .manifestSha256
  ) {
    failures.push(
      'TRAINING_MANIFEST_BINDING_MISMATCH',
    );
  }

  if (
    manifest
      .sourceFinalHoldoutCommitmentSha256 !==
    splitBundle
      .sealedFinalHoldout
      .holdoutCommitmentSha256
  ) {
    failures.push(
      'HOLDOUT_BINDING_MISMATCH',
    );
  }

  const {
    manifestSha256:
      _manifestSha256,
    ...core
  } = manifest;

  const manifestCoreSha256 =
    digest(core);

  if (
    manifestCoreSha256 !==
    manifest.manifestSha256
  ) {
    failures.push(
      'MANIFEST_DIGEST_MISMATCH',
    );
  }

  const holdoutIds =
    new Set(
      splitBundle
        .sealedFinalHoldout
        .recordIds,
    );

  const visibleIds =
    [
      ...manifest
        .trainRequests
        .map(
          (request) =>
            request.recordId,
        ),

      ...manifest
        .devRequests
        .map(
          (request) =>
            request.recordId,
        ),
    ];

  if (
    visibleIds.some(
      (id) =>
        holdoutIds.has(id),
    )
  ) {
    failures.push(
      'FINAL_HOLDOUT_EXPOSED',
    );
  }

  const trainIds =
    new Set(
      manifest
        .trainRequests
        .map(
          (request) =>
            request.recordId,
        ),
    );

  if (
    manifest
      .devRequests
      .some(
        (request) =>
          trainIds.has(
            request.recordId,
          ),
      )
  ) {
    failures.push(
      'SPLIT_OVERLAP',
    );
  }

  if (
    manifest
      .finalHoldoutRecordIdsExposed !==
      false ||
    manifest
      .trainingExecutionAuthorized !==
      false ||
    manifest
      .promotionAuthorized !==
      false ||
    manifest
      .deploymentAuthorized !==
      false
  ) {
    failures.push(
      'AUTHORITY_ESCAPE',
    );
  }

  try {
    const expected =
      derive(
        registry,
        splitBundle,
      );

    if (
      expected.manifestSha256 !==
      manifestCoreSha256
    ) {
      failures.push(
        'MANIFEST_DERIVATION_MISMATCH',
      );
    }
  }
  catch {
    failures.push(
      'TRAINING_RECORD_INVALID_SOURCE_IDENTITY',
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
