import {
  existsSync,
} from 'node:fs';

import {
  isAbsolute,
} from 'node:path';

import {
  TransactionalProviderQueue,
} from './transactionalProviderQueue';

import {
  runLiveTransactionalProviderWorkerPool,
  type LiveProviderInvoker,
  type LiveTransactionalPoolOptions,
  type LiveTransactionalPoolResult,
} from './liveTransactionalProviderWorkerPool';

import type {
  HostEvidenceCapsule,
} from './providerWorkProductGate';

import type {
  ProviderWorkOrder,
} from './providerWorkOrder';

export const LIVE_8X8_ONE_SHOT_SCHEMA =
  'VELNAR_LIVE_8X8_ONE_SHOT_V1' as const;

export interface Live8x8OneShotJob {
  readonly order:
    ProviderWorkOrder;

  readonly capsule:
    HostEvidenceCapsule;
}

export interface Live8x8OneShotInput {
  readonly queuePath:
    string;

  readonly jobs:
    readonly Live8x8OneShotJob[];

  readonly invokeProvider:
    LiveProviderInvoker;

  readonly nowMs:
    () => number;

  readonly leaseDurationMs?:
    number;
}

export interface Live8x8OneShotDependencies {
  readonly runPool?:
    (
      options:
        LiveTransactionalPoolOptions,
    ) =>
      Promise<LiveTransactionalPoolResult>;
}

export interface Live8x8OneShotResult {
  readonly schemaVersion:
    typeof LIVE_8X8_ONE_SHOT_SCHEMA;

  readonly baseline:
    string;

  readonly startedAtMs:
    number;

  readonly completedAtMs:
    number;

  readonly elapsedMs:
    number;

  readonly expectedProviderCalls:
    16;

  readonly pool:
    LiveTransactionalPoolResult;

  readonly fulgorCalled:
    false;

  readonly verificationGranted:
    false;

  readonly authorityGranted:
    false;
}

function safeClock(
  nowMs:
    () => number,
): number {
  const value =
    nowMs();

  if (
    !Number.isSafeInteger(
      value,
    ) ||
    value < 0
  ) {
    throw new Error(
      'LIVE_8X8_CLOCK_INVALID',
    );
  }

  return value;
}

function sortedUnique(
  values:
    readonly string[],
): readonly string[] {
  return [
    ...new Set(
      values,
    ),
  ].sort();
}

function validateJobs(
  jobs:
    readonly Live8x8OneShotJob[],
): string {
  if (
    jobs.length !==
      16
  ) {
    throw new Error(
      'LIVE_8X8_EXACT_JOB_COUNT_REQUIRED',
    );
  }

  const ids =
    new Set<string>();

  let baseline:
    string | null =
      null;

  let codex =
    0;

  let antigravity =
    0;

  for (
    const item
    of jobs
  ) {
    const order =
      item.order;

    const capsule =
      item.capsule;

    if (
      ids.has(
        order.jobId,
      )
    ) {
      throw new Error(
        'LIVE_8X8_DUPLICATE_JOB_ID',
      );
    }

    ids.add(
      order.jobId,
    );

    if (
      order.affinity ===
        'codex'
    ) {
      codex += 1;
    } else if (
      order.affinity ===
        'antigravity'
    ) {
      antigravity += 1;
    } else {
      throw new Error(
        'LIVE_8X8_EXACT_PROVIDER_AFFINITY_REQUIRED',
      );
    }

    if (
      baseline ===
        null
    ) {
      baseline =
        order.baseline;
    } else if (
      baseline !==
        order.baseline
    ) {
      throw new Error(
        'LIVE_8X8_BASELINE_MISMATCH',
      );
    }

    if (
      capsule.taskId !==
        order.jobId ||
      capsule.baseline !==
        order.baseline
    ) {
      throw new Error(
        'LIVE_8X8_CAPSULE_BINDING_MISMATCH',
      );
    }

    const expectedEvidence =
      sortedUnique(
        order.evidenceIds,
      );

    const capsuleEvidence =
      sortedUnique(
        capsule.evidence.map(
          evidence =>
            evidence.id,
        ),
      );

    if (
      expectedEvidence.length !==
        capsuleEvidence.length ||
      expectedEvidence.some(
        (
          id,
          index,
        ) =>
          id !==
            capsuleEvidence[
              index
            ],
      )
    ) {
      throw new Error(
        'LIVE_8X8_CAPSULE_EVIDENCE_MISMATCH',
      );
    }
  }

  if (
    codex !== 8 ||
    antigravity !== 8
  ) {
    throw new Error(
      'LIVE_8X8_EXACT_8_PLUS_8_REQUIRED',
    );
  }

  if (
    baseline ===
      null
  ) {
    throw new Error(
      'LIVE_8X8_BASELINE_MISSING',
    );
  }

  return baseline;
}

export async function
runLive8x8OneShot(
  input:
    Live8x8OneShotInput,

  dependencies:
    Live8x8OneShotDependencies =
      {},
): Promise<Live8x8OneShotResult> {
  if (
    !isAbsolute(
      input.queuePath,
    )
  ) {
    throw new Error(
      'LIVE_8X8_QUEUE_PATH_NOT_ABSOLUTE',
    );
  }

  /*
   * A one-shot run may never inherit stale queue state.
   */
  if (
    existsSync(
      input.queuePath,
    )
  ) {
    throw new Error(
      'LIVE_8X8_QUEUE_ALREADY_EXISTS',
    );
  }

  const baseline =
    validateJobs(
      input.jobs,
    );

  const capsules =
    new Map<
      string,
      HostEvidenceCapsule
    >();

  const queue =
    new TransactionalProviderQueue(
      input.queuePath,
    );

  try {
    for (
      const item
      of input.jobs
    ) {
      capsules.set(
        item.order.jobId,
        item.capsule,
      );

      queue.enqueue(
        item.order,
        safeClock(
          input.nowMs,
        ),
      );
    }
  } finally {
    queue.close();
  }

  const startedAtMs =
    safeClock(
      input.nowMs,
    );

  const runPool =
    dependencies.runPool ??
    runLiveTransactionalProviderWorkerPool;

  const pool =
    await runPool({
      queuePath:
        input.queuePath,

      mode:
        'DUAL',

      /*
       * This runner is intentionally pinned to the
       * currently certified live envelope.
       */
      codexSlots:
        8,

      antigravitySlots:
        8,

      leaseDurationMs:
        input.leaseDurationMs ??
        600_000,

      /*
       * Exactly one claim per slot:
       * at most sixteen provider invocations.
       * No blind retry.
       */
      maxClaimsPerSlot:
        1,

      loadCapsule:
        record => {
          const capsule =
            capsules.get(
              record.order.jobId,
            );

          if (
            capsule ===
              undefined
          ) {
            throw new Error(
              'LIVE_8X8_CAPSULE_NOT_FOUND',
            );
          }

          return capsule;
        },

      invokeProvider:
        input.invokeProvider,

      nowMs:
        input.nowMs,
    });

  const completedAtMs =
    safeClock(
      input.nowMs,
    );

  if (
    completedAtMs <
      startedAtMs
  ) {
    throw new Error(
      'LIVE_8X8_CLOCK_REVERSED',
    );
  }

  if (
    pool.totalSlots !==
      16 ||
    pool.codex.slots !==
      8 ||
    pool.antigravity.slots !==
      8
  ) {
    throw new Error(
      'LIVE_8X8_POOL_ENVELOPE_MISMATCH',
    );
  }

  if (
    pool.totalLiveProviderCalls >
      16
  ) {
    throw new Error(
      'LIVE_8X8_PROVIDER_CALL_BOUND_EXCEEDED',
    );
  }

  if (
    pool.fulgorCalled !==
      false ||
    pool.verificationGranted !==
      false ||
    pool.authorityGranted !==
      false
  ) {
    throw new Error(
      'LIVE_8X8_AUTHORITY_BOUNDARY_VIOLATED',
    );
  }

  return Object.freeze({
    schemaVersion:
      LIVE_8X8_ONE_SHOT_SCHEMA,

    baseline,

    startedAtMs,

    completedAtMs,

    elapsedMs:
      completedAtMs -
      startedAtMs,

    expectedProviderCalls:
      16,

    pool,

    fulgorCalled:
      false,

    verificationGranted:
      false,

    authorityGranted:
      false,
  });
}
