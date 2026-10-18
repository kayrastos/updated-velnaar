import {
  join,
} from 'node:path';

import type {
  FulgorAutomationJob,
} from '../automation/types';

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
  createAcceptedWorkSourceBinding,
  persistAcceptedWorkSourceBinding,
  readAcceptedWorkSourceBinding,
  type AcceptedWorkSourceBinding,
} from './acceptedWorkSourceBinding';

import {
  authorizeAcceptedWorkCandidateWithPermit,
  type AcceptedWorkFulgorPermitAdmission,
} from './acceptedWorkFulgorPermit';

export const ACCEPTED_WORK_CONTROLLER_FEEDER_SCHEMA =
  'VELNAR_ACCEPTED_WORK_CONTROLLER_FEEDER_V1' as const;

export interface AcceptedWorkControllerStore {
  snapshot(): Promise<{
    jobs:
      Array<{
        job: {
          jobId:
            string;
        };
      }>;
  }>;

  enqueue(
    job:
      FulgorAutomationJob,
  ): Promise<void>;
}

export interface AcceptedWorkControllerFeederOptions {
  readonly stateRoot:
    string;

  readonly repoRoot:
    string;

  readonly sourceBindingRoot:
    string;

  readonly permitRoot:
    string;

  readonly policy:
    FulgorBridgePolicy;

  readonly maxEnqueuePerScan?:
    number;
}

export interface AcceptedWorkControllerFeederSummary {
  readonly schemaVersion:
    typeof ACCEPTED_WORK_CONTROLLER_FEEDER_SCHEMA;

  readonly pointerFound:
    boolean;

  readonly acceptedRows:
    number;

  readonly duplicateSkipped:
    number;

  readonly enqueued:
    number;

  readonly noCandidate:
    boolean;
}

export interface AcceptedWorkControllerFeederDependencies {
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

  readonly authorizeCandidate?:
    (
      permitRoot:
        string,

      pointer:
        AcceptedWorkLatestPointer,

      materialized:
        MaterializedFulgorCandidate,

      sourceBinding:
        AcceptedWorkSourceBinding,
    ) =>
      Promise<AcceptedWorkFulgorPermitAdmission>;
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

function sameStableBridgeBinding(
  existing:
    AcceptedWorkSourceBinding,

  expected:
    AcceptedWorkSourceBinding,
): boolean {
  return (
    existing.schemaVersion ===
      expected.schemaVersion &&
    existing.jobId ===
      expected.jobId &&
    existing.blindedId ===
      expected.blindedId &&
    existing.bridgeIdentity ===
      expected.bridgeIdentity &&
    existing.baseline ===
      expected.baseline &&
    existing.candidateIdentity ===
      expected.candidateIdentity &&
    existing.candidatePath ===
      expected.candidatePath &&
    existing.candidateSha256 ===
      expected.candidateSha256 &&
    existing.patchSha256 ===
      expected.patchSha256 &&
    existing.automaticPromotionAllowed ===
      false &&
    existing.authorityGranted ===
      false
  );
}

async function readExistingSourceBinding(
  root:
    string,

  jobId:
    string,
): Promise<AcceptedWorkSourceBinding | null> {
  try {
    return (
      await readAcceptedWorkSourceBinding(
        root,
        jobId,
      )
    ).binding;
  } catch (
    error
  ) {
    if (
      (
        error as
          NodeJS.ErrnoException
      ).code ===
        'ENOENT'
    ) {
      return null;
    }

    throw error;
  }
}

export async function
scanAcceptedWorkForFulgorOnce(
  options:
    AcceptedWorkControllerFeederOptions,

  store:
    AcceptedWorkControllerStore,

  dependencies:
    AcceptedWorkControllerFeederDependencies =
      {},
): Promise<AcceptedWorkControllerFeederSummary> {
  const maxEnqueue =
    options.maxEnqueuePerScan ??
    1;

  if (
    maxEnqueue !==
      1
  ) {
    throw new Error(
      'ACCEPTED_WORK_FEEDER_MAX_ENQUEUE_MUST_BE_ONE',
    );
  }

  const pointerPath =
    join(
      options.stateRoot,
      'accepted-work-latest.json',
    );

  const readPointer =
    dependencies.readPointer ??
    readAcceptedWorkLatestPointer;

  let pointer:
    AcceptedWorkLatestPointer;

  try {
    pointer =
      await readPointer(
        pointerPath,
        options.stateRoot,
      );
  } catch (
    error
  ) {
    if (
      error instanceof Error &&
      (
        error.message.includes(
          'ENOENT',
        ) ||
        error.message ===
          'ACCEPTED_WORK_POINTER_FILE_INVALID'
      )
    ) {
      return Object.freeze({
        schemaVersion:
          ACCEPTED_WORK_CONTROLLER_FEEDER_SCHEMA,

        pointerFound:
          false,

        acceptedRows:
          0,

        duplicateSkipped:
          0,

        enqueued:
          0,

        noCandidate:
          true,
      });
    }

    throw error;
  }

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
      'ACCEPTED_WORK_FEEDER_POINTER_QUEUE_MISMATCH',
    );
  }

  const snapshot =
    await store.snapshot();

  const knownJobIds =
    new Set(
      snapshot.jobs.map(
        record =>
          record.job.jobId,
      ),
    );

  const materialize =
    dependencies.materialize ??
    materializeNextAcceptedWorkForFulgor;

  /*
   * Exactly one deterministic top candidate is examined
   * per explicit authorization. No duplicate, rejection
   * or materialization failure may widen the authority
   * to a fallback candidate.
   */
  const materialized =
    await materialize(
      options.repoRoot,
      accepted,
      options.policy,
    );

  if (
    materialized ===
      null
  ) {
    return Object.freeze({
      schemaVersion:
        ACCEPTED_WORK_CONTROLLER_FEEDER_SCHEMA,

      pointerFound:
        true,

      acceptedRows:
        accepted.length,

      duplicateSkipped:
        0,

      enqueued:
        0,

      noCandidate:
        true,
    });
  }

  const jobId =
    materialized
      .plan
      .job
      .jobId;

  const sourceBinding =
    createAcceptedWorkSourceBinding(
      pointer,
      materialized,
    );

  const existingBinding =
    await readExistingSourceBinding(
      options.sourceBindingRoot,
      jobId,
    );

  if (
    existingBinding !==
      null &&
    !sameStableBridgeBinding(
      existingBinding,
      sourceBinding,
    )
  ) {
    throw new Error(
      'ACCEPTED_WORK_FEEDER_SOURCE_BINDING_MISMATCH',
    );
  }

  const bindingForAdmission =
    existingBinding ??
    sourceBinding;

  const authorizeCandidate =
    dependencies.authorizeCandidate ??
    authorizeAcceptedWorkCandidateWithPermit;

  const admission =
    await authorizeCandidate(
      options.permitRoot,
      pointer,
      materialized,
      bindingForAdmission,
    );

  if (
    admission ===
      'NO_PERMIT' ||
    admission ===
      'ALREADY_CONSUMED'
  ) {
    return Object.freeze({
      schemaVersion:
        ACCEPTED_WORK_CONTROLLER_FEEDER_SCHEMA,

      pointerFound:
        true,

      acceptedRows:
        accepted.length,

      duplicateSkipped:
        knownJobIds.has(jobId)
          ? 1
          : 0,

      enqueued:
        0,

      noCandidate:
        true,
    });
  }

  /*
   * No source-binding filesystem mutation occurs before
   * an exact explicit FULGOR admission permit has been
   * validated and durably consumed.
   */
  if (
    existingBinding ===
      null
  ) {
    await persistAcceptedWorkSourceBinding(
      options.sourceBindingRoot,
      sourceBinding,
    );
  }

  if (
    knownJobIds.has(
      jobId,
    )
  ) {
    return Object.freeze({
      schemaVersion:
        ACCEPTED_WORK_CONTROLLER_FEEDER_SCHEMA,

      pointerFound:
        true,

      acceptedRows:
        accepted.length,

      duplicateSkipped:
        1,

      enqueued:
        0,

      noCandidate:
        true,
    });
  }

  await store.enqueue(
    materialized
      .plan
      .job,
  );

  return Object.freeze({
    schemaVersion:
      ACCEPTED_WORK_CONTROLLER_FEEDER_SCHEMA,

    pointerFound:
      true,

    acceptedRows:
      accepted.length,

    duplicateSkipped:
      0,

    enqueued:
      1,

    noCandidate:
      false,
  });
}
