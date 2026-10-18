import {
  join,
} from 'node:path';

import {
  materializeNextAcceptedWorkForFulgor,
  type MaterializedFulgorCandidate,
} from './acceptedWorkGitMaterializer';

import type {
  FulgorBridgePolicy,
} from './acceptedWorkFulgorBridge';

import {
  readAcceptedWorkLatestPointer,
  type AcceptedWorkLatestPointer,
} from './acceptedWorkLatestPointer';

import {
  TransactionalProviderQueue,
  type PersistedAcceptedWorkProduct,
} from './transactionalProviderQueue';

import {
  createAcceptedWorkFulgorPermit,
  persistActiveAcceptedWorkFulgorPermit,
  type AcceptedWorkFulgorPermit,
} from './acceptedWorkFulgorPermit';

export const ACCEPTED_WORK_FULGOR_PERMIT_PUBLISHER_SCHEMA =
  'VELNAR_ACCEPTED_WORK_FULGOR_PERMIT_PUBLISHER_V1' as const;

const HEX40 =
  /^[0-9a-f]{40}$/;

const HEX64 =
  /^[0-9a-f]{64}$/;

const JOB =
  /^VF-[0-9a-f]{32}$/;

const BLINDED =
  /^blind-[0-9a-f]{24}$/;

const REQUEST =
  /^[A-Za-z0-9._-]{1,120}$/;

export const ACCEPTED_WORK_FULGOR_PUBLISHER_POLICY:
FulgorBridgePolicy =
  Object.freeze({
    forbiddenPaths:
      Object.freeze([
        '.git',
        '.github/workflows',
        '.env',
        'secrets',
        'scripts/fulgor/corpus/holdout',
      ]),

    maxHunks:
      64,

    maxChangedLines:
      10_000,
  });

export interface AcceptedWorkFulgorPermitPreview {
  readonly schemaVersion:
    typeof ACCEPTED_WORK_FULGOR_PERMIT_PUBLISHER_SCHEMA;

  readonly requestId:
    string;

  readonly providerRunCompletedAtMs:
    number;

  readonly baseline:
    string;

  readonly bridgeIdentity:
    string;

  readonly jobId:
    string;

  readonly blindedId:
    string;

  readonly candidateIdentity:
    string;

  readonly candidatePath:
    string;

  readonly candidateSha256:
    string;

  readonly patchSha256:
    string;

  readonly sourceJobId:
    string;

  readonly sourceAcceptedSha256:
    string;

  readonly sourceFingerprint:
    string;

  readonly providerSupport:
    readonly string[];

  readonly memberJobIds:
    readonly string[];

  readonly evidenceCount:
    number;

  readonly maxFulgorCalls:
    1;

  readonly queueMutation:
    false;

  readonly controllerStateMutation:
    false;

  readonly providerCalled:
    false;

  readonly fulgorCalled:
    false;

  readonly authorityGranted:
    false;

  readonly automaticPromotionAllowed:
    false;
}

export interface AcceptedWorkFulgorPermitPublishExpectation {
  readonly requestId:
    string;

  readonly baseline:
    string;

  readonly bridgeIdentity:
    string;

  readonly jobId:
    string;

  readonly blindedId:
    string;

  readonly candidateIdentity:
    string;

  readonly candidatePath:
    string;

  readonly candidateSha256:
    string;

  readonly patchSha256:
    string;
}

export interface AcceptedWorkFulgorPermitPublisherOptions {
  readonly stateRoot:
    string;

  readonly repoRoot:
    string;

  readonly permitRoot:
    string;
}

export interface AcceptedWorkFulgorPermitPublisherDependencies {
  readonly readPointer?:
    (
      pointerPath:
        string,

      stateRoot:
        string,
    ) =>
      Promise<AcceptedWorkLatestPointer>;

  readonly loadAccepted?:
    (
      queuePath:
        string,
    ) =>
      Promise<
        readonly PersistedAcceptedWorkProduct[]
      >;

  readonly materialize?:
    typeof materializeNextAcceptedWorkForFulgor;

  readonly persistPermit?:
    typeof persistActiveAcceptedWorkFulgorPermit;

  readonly nowMs?:
    () => number;
}

export interface AcceptedWorkFulgorPermitPublishResult {
  readonly preview:
    AcceptedWorkFulgorPermitPreview;

  readonly permit:
    AcceptedWorkFulgorPermit;

  readonly permitPath:
    string;

  readonly maxFulgorCalls:
    1;

  readonly queueMutation:
    false;

  readonly controllerStateMutation:
    false;

  readonly providerCalled:
    false;

  readonly fulgorCalled:
    false;

  readonly authorityGranted:
    false;

  readonly automaticPromotionAllowed:
    false;
}

async function loadAcceptedProduction(
  queuePath:
    string,
): Promise<
  readonly PersistedAcceptedWorkProduct[]
> {
  const queue =
    new TransactionalProviderQueue(
      queuePath,
    );

  try {
    return queue
      .listAcceptedWorkProducts(
        64,
      );
  } finally {
    queue.close();
  }
}

function validateExpectation(
  value:
    AcceptedWorkFulgorPermitPublishExpectation,
): void {
  if (
    !REQUEST.test(
      value.requestId,
    ) ||
    !HEX40.test(
      value.baseline,
    ) ||
    !HEX64.test(
      value.bridgeIdentity,
    ) ||
    !JOB.test(
      value.jobId,
    ) ||
    !BLINDED.test(
      value.blindedId,
    ) ||
    !HEX64.test(
      value.candidateIdentity,
    ) ||
    typeof value.candidatePath !==
      'string' ||
    value.candidatePath.length <
      1 ||
    value.candidatePath.length >
      2048 ||
    !HEX64.test(
      value.candidateSha256,
    ) ||
    !HEX64.test(
      value.patchSha256,
    )
  ) {
    throw new Error(
      'FULGOR_PERMIT_PUBLISH_EXPECTATION_INVALID',
    );
  }
}

function previewFrom(
  pointer:
    AcceptedWorkLatestPointer,

  materialized:
    MaterializedFulgorCandidate,
): AcceptedWorkFulgorPermitPreview {
  const selection =
    materialized
      .plan
      .selection;

  return Object.freeze({
    schemaVersion:
      ACCEPTED_WORK_FULGOR_PERMIT_PUBLISHER_SCHEMA,

    requestId:
      pointer.requestId,

    providerRunCompletedAtMs:
      pointer.completedAtMs,

    baseline:
      pointer.baseline,

    bridgeIdentity:
      materialized
        .plan
        .bridgeIdentity,

    jobId:
      materialized
        .plan
        .job
        .jobId,

    blindedId:
      materialized
        .plan
        .job
        .candidate
        .blindedId,

    candidateIdentity:
      selection
        .candidateIdentity,

    candidatePath:
      selection
        .candidatePath,

    candidateSha256:
      selection
        .candidateSha256,

    patchSha256:
      materialized
        .plan
        .patchSha256,

    sourceJobId:
      materialized
        .sourceJobId,

    sourceAcceptedSha256:
      materialized
        .sourceAcceptedSha256,

    sourceFingerprint:
      materialized
        .sourceFingerprint,

    providerSupport:
      Object.freeze([
        ...selection.providerSupport,
      ]),

    memberJobIds:
      Object.freeze([
        ...selection.memberJobIds,
      ]),

    evidenceCount:
      selection.evidenceCount,

    maxFulgorCalls:
      1,

    queueMutation:
      false,

    controllerStateMutation:
      false,

    providerCalled:
      false,

    fulgorCalled:
      false,

    authorityGranted:
      false,

    automaticPromotionAllowed:
      false,
  });
}

function assertPreviewMatchesExpectation(
  preview:
    AcceptedWorkFulgorPermitPreview,

  expected:
    AcceptedWorkFulgorPermitPublishExpectation,
): void {
  validateExpectation(
    expected,
  );

  if (
    preview.requestId !==
      expected.requestId ||
    preview.baseline !==
      expected.baseline ||
    preview.bridgeIdentity !==
      expected.bridgeIdentity ||
    preview.jobId !==
      expected.jobId ||
    preview.blindedId !==
      expected.blindedId ||
    preview.candidateIdentity !==
      expected.candidateIdentity ||
    preview.candidatePath !==
      expected.candidatePath ||
    preview.candidateSha256 !==
      expected.candidateSha256 ||
    preview.patchSha256 !==
      expected.patchSha256
  ) {
    throw new Error(
      'FULGOR_PERMIT_PUBLISH_EXPECTATION_MISMATCH',
    );
  }
}

async function resolveCandidate(
  options:
    AcceptedWorkFulgorPermitPublisherOptions,

  dependencies:
    AcceptedWorkFulgorPermitPublisherDependencies,
): Promise<{
  readonly pointer:
    AcceptedWorkLatestPointer;

  readonly materialized:
    MaterializedFulgorCandidate;

  readonly preview:
    AcceptedWorkFulgorPermitPreview;
}> {
  const pointerPath =
    join(
      options.stateRoot,
      'accepted-work-latest.json',
    );

  const readPointer =
    dependencies.readPointer ??
    readAcceptedWorkLatestPointer;

  const pointer =
    await readPointer(
      pointerPath,
      options.stateRoot,
    );

  const loadAccepted =
    dependencies.loadAccepted ??
    loadAcceptedProduction;

  const accepted =
    await loadAccepted(
      pointer.queuePath,
    );

  if (
    accepted.length !==
      pointer.usefulUnique ||
    accepted.some(
      item =>
        item.baseline !==
          pointer.baseline,
    )
  ) {
    throw new Error(
      'FULGOR_PERMIT_PUBLISH_POINTER_QUEUE_MISMATCH',
    );
  }

  const materialize =
    dependencies.materialize ??
    materializeNextAcceptedWorkForFulgor;

  const materialized =
    await materialize(
      options.repoRoot,
      accepted,
      ACCEPTED_WORK_FULGOR_PUBLISHER_POLICY,
    );

  if (
    materialized ===
      null
  ) {
    throw new Error(
      'FULGOR_PERMIT_PUBLISH_NO_CANDIDATE',
    );
  }

  return Object.freeze({
    pointer,
    materialized,

    preview:
      previewFrom(
        pointer,
        materialized,
      ),
  });
}

export async function previewAcceptedWorkFulgorPermitCandidate(
  options:
    AcceptedWorkFulgorPermitPublisherOptions,

  dependencies:
    AcceptedWorkFulgorPermitPublisherDependencies =
      {},
): Promise<AcceptedWorkFulgorPermitPreview> {
  const resolved =
    await resolveCandidate(
      options,
      dependencies,
    );

  return resolved.preview;
}

export async function publishAcceptedWorkFulgorPermit(
  options:
    AcceptedWorkFulgorPermitPublisherOptions,

  expected:
    AcceptedWorkFulgorPermitPublishExpectation,

  dependencies:
    AcceptedWorkFulgorPermitPublisherDependencies =
      {},
): Promise<AcceptedWorkFulgorPermitPublishResult> {
  const resolved =
    await resolveCandidate(
      options,
      dependencies,
    );

  assertPreviewMatchesExpectation(
    resolved.preview,
    expected,
  );

  const nowMs =
    dependencies.nowMs ??
    (() => Date.now());

  const issuedAtMs =
    nowMs();

  if (
    !Number.isSafeInteger(
      issuedAtMs,
    ) ||
    issuedAtMs <
      0
  ) {
    throw new Error(
      'FULGOR_PERMIT_PUBLISH_TIME_INVALID',
    );
  }

  const permit =
    createAcceptedWorkFulgorPermit(
      resolved.pointer,
      resolved.materialized,
      issuedAtMs,
    );

  const persistPermit =
    dependencies.persistPermit ??
    persistActiveAcceptedWorkFulgorPermit;

  const permitPath =
    await persistPermit(
      options.permitRoot,
      permit,
    );

  return Object.freeze({
    preview:
      resolved.preview,

    permit,
    permitPath,

    maxFulgorCalls:
      1,

    queueMutation:
      false,

    controllerStateMutation:
      false,

    providerCalled:
      false,

    fulgorCalled:
      false,

    authorityGranted:
      false,

    automaticPromotionAllowed:
      false,
  });
}

export function acceptedWorkFulgorPermitPreviewSummary(
  value:
    AcceptedWorkFulgorPermitPreview,
): string {
  return [
    `REQUEST_ID=${value.requestId}`,
    `PROVIDER_RUN_COMPLETED_AT_MS=${value.providerRunCompletedAtMs}`,
    `BASELINE=${value.baseline}`,
    `BRIDGE_IDENTITY=${value.bridgeIdentity}`,
    `JOB_ID=${value.jobId}`,
    `BLINDED_ID=${value.blindedId}`,
    `CANDIDATE_IDENTITY=${value.candidateIdentity}`,
    `CANDIDATE_PATH=${value.candidatePath}`,
    `CANDIDATE_SHA256=${value.candidateSha256}`,
    `PATCH_SHA256=${value.patchSha256}`,
    `SOURCE_JOB_ID=${value.sourceJobId}`,
    `SOURCE_ACCEPTED_SHA256=${value.sourceAcceptedSha256}`,
    `SOURCE_FINGERPRINT=${value.sourceFingerprint}`,
    `PROVIDER_SUPPORT=${value.providerSupport.join(',')}`,
    `MEMBER_JOB_IDS=${value.memberJobIds.join(',')}`,
    `EVIDENCE_COUNT=${value.evidenceCount}`,
    'MAX_FULGOR_CALLS=1',
    'QUEUE_MUTATION=False',
    'CONTROLLER_STATE_MUTATION=False',
    'PROVIDER_CALLED=False',
    'FULGOR_CALLED=False',
    'AUTHORITY_GRANTED=False',
    'AUTOMATIC_PROMOTION=False',
  ].join('\n') + '\n';
}

export function acceptedWorkFulgorPermitPublishSummary(
  value:
    AcceptedWorkFulgorPermitPublishResult,
): string {
  return (
    acceptedWorkFulgorPermitPreviewSummary(
      value.preview,
    ) +
    `PERMIT_ID=${value.permit.permitId}\n` +
    `PERMIT_SHA256=${value.permit.permitSha256}\n` +
    `PERMIT_PATH=${value.permitPath}\n` +
    'PERMIT_PUBLISHED=True\n'
  );
}
