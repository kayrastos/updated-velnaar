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

function removeSelectionMembers(
  input:
    readonly PersistedAcceptedWorkProduct[],

  materialized:
    MaterializedFulgorCandidate,
): readonly PersistedAcceptedWorkProduct[] {
  const ids =
    new Set(
      materialized
        .plan
        .selection
        .memberJobIds,
    );

  return input.filter(
    item =>
      !ids.has(
        item.jobId,
      ),
  );
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
    !Number.isInteger(
      maxEnqueue,
    ) ||
    maxEnqueue < 1 ||
    maxEnqueue > 16
  ) {
    throw new Error(
      'ACCEPTED_WORK_FEEDER_MAX_ENQUEUE_INVALID',
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

  let remaining:
    readonly PersistedAcceptedWorkProduct[] =
      accepted;

  let duplicateSkipped =
    0;

  let enqueued =
    0;

  while (
    remaining.length >
      0 &&
    enqueued <
      maxEnqueue
  ) {
    const materialized =
      await materialize(
        options.repoRoot,
        remaining,
        options.policy,
      );

    if (
      materialized ===
        null
    ) {
      break;
    }

    const jobId =
      materialized
        .plan
        .job
        .jobId;

    /*
     * Deterministic VF-* identity is candidate-bound,
     * not provider-run-bound.
     *
     * A later provider run may legitimately rediscover
     * the exact same baseline/candidate/patch. In that
     * case its request ID, source job ID, fingerprint,
     * provider support count and accepted SHA can differ
     * while the FULGOR job remains identical.
     *
     * Reuse is therefore permitted only when the
     * existing immutable binding proves the exact same
     * stable bridge identity.
     */
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

    if (
      knownJobIds.has(
        jobId,
      )
    ) {
      /*
       * A controller-known VF-* job must already have
       * its immutable source binding. Never backfill a
       * known job from a later provider run.
       */
      if (
        existingBinding ===
          null
      ) {
        throw new Error(
          'ACCEPTED_WORK_FEEDER_KNOWN_JOB_BINDING_MISSING',
        );
      }

      duplicateSkipped +=
        1;

      remaining =
        removeSelectionMembers(
          remaining,
          materialized,
        );

      continue;
    }

    if (
      existingBinding ===
        null
    ) {
      /*
       * New jobs persist source authority BEFORE queue
       * admission. If enqueue then fails, this binding
       * remains harmless and may be reused on retry.
       */
      await persistAcceptedWorkSourceBinding(
        options.sourceBindingRoot,
        sourceBinding,
      );
    }

    await store.enqueue(
      materialized
        .plan
        .job,
    );

    knownJobIds.add(
      jobId,
    );

    enqueued +=
      1;

    remaining =
      removeSelectionMembers(
        remaining,
        materialized,
      );
  }

  return Object.freeze({
    schemaVersion:
      ACCEPTED_WORK_CONTROLLER_FEEDER_SCHEMA,

    pointerFound:
      true,

    acceptedRows:
      accepted.length,

    duplicateSkipped,
    enqueued,

    noCandidate:
      enqueued ===
        0,
  });
}
