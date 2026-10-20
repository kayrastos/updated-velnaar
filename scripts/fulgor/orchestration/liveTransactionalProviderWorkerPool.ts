import {
  VERIFIED_8X8_POLICY,
  targetsForMode,
  type Provider,
  type SchedulerMode,
} from '../scheduler/verified8x8Scheduler';

import {
  livePlanFitsCurrentCertifiedEnvelope,
} from '../scheduler/liveProviderTierGate';

import {
  parseProviderWorkProduct,
  type HostEvidenceCapsule,
} from './providerWorkProductGate';

import type {
  ProviderWorkRecord,
} from './providerWorkOrder';

import {
  TransactionalProviderQueue,
} from './transactionalProviderQueue';

export const LIVE_TRANSACTIONAL_PROVIDER_POOL_SCHEMA =
  'VELNAR_LIVE_TRANSACTIONAL_PROVIDER_POOL_V1' as const;

/*
 * Provider transport and provider protocol are separate.
 *
 * transport=OK does NOT imply protocol=PASS.
 * protocol=PASS does NOT imply useful work.
 */
export type LiveProviderInvocation =
  | Readonly<{
      source:
        'LIVE_PROVIDER';

      transport:
        'FAILURE';
    }>
  | Readonly<{
      source:
        'LIVE_PROVIDER';

      transport:
        'OK';

      protocol:
        'REJECTED';
    }>
  | Readonly<{
      source:
        'LIVE_PROVIDER';

      transport:
        'OK';

      protocol:
        'PASS';

      raw:
        string;
    }>;

export interface LiveProviderInput {
  readonly provider:
    Provider;

  readonly slotId:
    string;

  readonly record:
    ProviderWorkRecord;

  readonly capsule:
    HostEvidenceCapsule;
}

export type LiveProviderInvoker =
  (
    input:
      LiveProviderInput,
  ) =>
    Promise<
      LiveProviderInvocation
    >;

export type LiveCapsuleLoader =
  (
    record:
      ProviderWorkRecord,
  ) =>
    HostEvidenceCapsule;

export interface LiveTransactionalPoolOptions {
  readonly queuePath:
    string;

  readonly mode:
    SchedulerMode;

  readonly codexSlots:
    number;

  readonly antigravitySlots:
    number;

  /*
   * Physical Antigravity process concurrency.
   *
   * Logical slots and physical concurrency are
   * intentionally separate:
   *
   *   antigravitySlots       = admitted logical work
   *   antigravityConcurrency = simultaneous AGY work
   *
   * Omitted => conservative legacy default:
   *   0 when there are zero AGY slots
   *   1 otherwise.
   *
   * V1 hard maximum remains 8.
   */
  readonly antigravityConcurrency?:
    number;

  readonly leaseDurationMs:
    number;

  /*
   * Explicit hard bound against accidental infinite
   * draining by one worker invocation.
   */
  readonly maxClaimsPerSlot:
    number;

  /*
   * Host-issued evidence only.
   */
  readonly loadCapsule:
    LiveCapsuleLoader;

  /*
   * The core does not know or trust CLI implementation
   * details. Concrete Codex / Antigravity bindings are
   * added outside this accounting boundary.
   */
  readonly invokeProvider:
    LiveProviderInvoker;

  /*
   * Required clock injection makes lease/accounting
   * behavior deterministic under test.
   */
  readonly nowMs:
    () => number;
}

export interface LiveProviderPoolStats {
  readonly provider:
    Provider;

  readonly slots:
    number;

  readonly claims:
    number;

  readonly liveProviderCalls:
    number;

  readonly usefulUnique:
    number;

  readonly usefulDuplicate:
    number;

  readonly blocked:
    number;

  readonly protocolRejected:
    number;

  readonly contractRejected:
    number;

  readonly transportFailures:
    number;

  readonly stoppedByQualityCircuit:
    number;

  /*
   * Run-local fail-closed stop caused by uncertain
   * transport. This is deliberately separate from
   * provider output-quality state.
   */
  readonly stoppedByTransportCircuit:
    number;
}

export interface LiveTransactionalPoolResult {
  readonly schemaVersion:
    typeof LIVE_TRANSACTIONAL_PROVIDER_POOL_SCHEMA;

  readonly codex:
    LiveProviderPoolStats;

  readonly antigravity:
    LiveProviderPoolStats;

  readonly totalSlots:
    number;

  readonly totalLiveProviderCalls:
    number;

  readonly totalUsefulUnique:
    number;

  readonly totalUsefulDuplicate:
    number;

  /*
   * Useful work is still not verification authority.
   */
  readonly fulgorCalled:
    false;

  readonly verificationGranted:
    false;

  readonly authorityGranted:
    false;
}

interface MutableStats {
  provider:
    Provider;

  slots:
    number;

  claims:
    number;

  liveProviderCalls:
    number;

  usefulUnique:
    number;

  usefulDuplicate:
    number;

  blocked:
    number;

  protocolRejected:
    number;

  contractRejected:
    number;

  transportFailures:
    number;

  stoppedByQualityCircuit:
    number;

  stoppedByTransportCircuit:
    number;
}

function validateInteger(
  value: number,
  name: string,
  minimum: number,
  maximum: number,
): void {
  if (
    !Number.isSafeInteger(
      value,
    ) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(
      `LIVE_POOL_${name}_INVALID`,
    );
  }
}

function sortedUnique(
  values:
    readonly string[],
): readonly string[] {
  return [
    ...new Set(values),
  ].sort();
}

function validateCapsuleBinding(
  record:
    ProviderWorkRecord,

  capsule:
    HostEvidenceCapsule,
): void {
  if (
    capsule.taskId !==
      record.order.jobId
  ) {
    throw new Error(
      'LIVE_POOL_CAPSULE_TASK_MISMATCH',
    );
  }

  if (
    capsule.baseline !==
      record.order.baseline
  ) {
    throw new Error(
      'LIVE_POOL_CAPSULE_BASELINE_MISMATCH',
    );
  }

  const expectedIds =
    sortedUnique(
      record.order.evidenceIds,
    );

  const capsuleIds =
    sortedUnique(
      capsule.evidence.map(
        evidence =>
          evidence.id,
      ),
    );

  if (
    expectedIds.length !==
      capsuleIds.length ||
    expectedIds.some(
      (
        id,
        index,
      ) =>
        id !==
        capsuleIds[index],
    )
  ) {
    throw new Error(
      'LIVE_POOL_CAPSULE_EVIDENCE_MISMATCH',
    );
  }
}

function now(
  options:
    LiveTransactionalPoolOptions,
): number {
  const value =
    options.nowMs();

  if (
    !Number.isSafeInteger(
      value,
    ) ||
    value < 0
  ) {
    throw new Error(
      'LIVE_POOL_CLOCK_INVALID',
    );
  }

  return value;
}

function emptyStats(
  provider:
    Provider,

  slots:
    number,
): MutableStats {
  return {
    provider,
    slots,
    claims: 0,
    liveProviderCalls: 0,
    usefulUnique: 0,
    usefulDuplicate: 0,
    blocked: 0,
    protocolRejected: 0,
    contractRejected: 0,
    transportFailures: 0,
    stoppedByQualityCircuit:
      0,

    stoppedByTransportCircuit:
      0,
  };
}

function freezeStats(
  value:
    MutableStats,
): LiveProviderPoolStats {
  return Object.freeze({
    provider:
      value.provider,

    slots:
      value.slots,

    claims:
      value.claims,

    liveProviderCalls:
      value.liveProviderCalls,

    usefulUnique:
      value.usefulUnique,

    usefulDuplicate:
      value.usefulDuplicate,

    blocked:
      value.blocked,

    protocolRejected:
      value.protocolRejected,

    contractRejected:
      value.contractRejected,

    transportFailures:
      value.transportFailures,

    stoppedByQualityCircuit:
      value
        .stoppedByQualityCircuit,

    stoppedByTransportCircuit:
      value
        .stoppedByTransportCircuit,
  });
}

function isQualityOpenError(
  error: unknown,
  provider: Provider,
): boolean {
  return (
    error instanceof Error &&
    error.message ===
      `QUEUE_PROVIDER_QUALITY_OPEN=${provider}`
  );
}

/*
 * No automatic retry occurs inside a slot after
 * TRANSPORT_FAILURE, PROTOCOL_REJECTED or
 * CONTRACT_REJECTED.
 */
async function runSlot(
  options:
    LiveTransactionalPoolOptions,

  provider:
    Provider,

  slotId:
    string,

  transportStoppedProviders:
    Set<Provider>,
): Promise<MutableStats> {
  const stats =
    emptyStats(
      provider,
      1,
    );

  const queue =
    new TransactionalProviderQueue(
      options.queuePath,
    );

  try {
    for (
      let claimIndex = 0;
      claimIndex <
        options.maxClaimsPerSlot;
      claimIndex += 1
    ) {
      /*
       * A transport failure is uncertain execution.
       *
       * It must not poison the independent output-quality
       * circuit, but the same bounded run must not blindly
       * issue later calls for that provider.
       */
      if (
        transportStoppedProviders.has(
          provider,
        )
      ) {
        stats
          .stoppedByTransportCircuit +=
          1;

        break;
      }

      if (
        !queue.canLaunchProvider(
          provider,
        )
      ) {
        stats
          .stoppedByQualityCircuit +=
          1;

        break;
      }

      let record:
        ProviderWorkRecord | null;

      try {
        record =
          queue.claimNext(
            provider,
            slotId,
            now(options),
            options.leaseDurationMs,
          );
      } catch (error) {
        if (
          isQualityOpenError(
            error,
            provider,
          )
        ) {
          stats
            .stoppedByQualityCircuit +=
            1;

          break;
        }

        throw error;
      }

      if (record === null) {
        break;
      }

      stats.claims += 1;

      if (
        record.lease === null
      ) {
        throw new Error(
          'LIVE_POOL_CLAIM_WITHOUT_LEASE',
        );
      }

      /*
       * Host evidence is resolved and bound before any
       * provider call.
       *
       * If this trusted host operation throws, the pool
       * itself fails rather than inventing a provider
       * verdict or retrying the work.
       */
      const capsule =
        options.loadCapsule(
          record,
        );

      validateCapsuleBinding(
        record,
        capsule,
      );

      stats.liveProviderCalls +=
        1;

      let invocation:
        LiveProviderInvocation;

      try {
        invocation =
          await options
            .invokeProvider({
              provider,
              slotId,
              record,
              capsule,
            });
      } catch {
        /*
         * No reliable provider result exists.
         * Hold the work for recovery; never retry blindly.
         */
        queue.settle(
          provider,
          record.lease.leaseId,
          'TRANSPORT_FAILURE',
          null,
          now(options),
        );

        transportStoppedProviders.add(
          provider,
        );

        stats.transportFailures +=
          1;

        break;
      }

      if (
        invocation === null ||
        typeof invocation !==
          'object' ||
        invocation.source !==
          'LIVE_PROVIDER'
      ) {
        queue.settle(
          provider,
          record.lease.leaseId,
          'TRANSPORT_FAILURE',
          null,
          now(options),
        );

        transportStoppedProviders.add(
          provider,
        );

        stats.transportFailures +=
          1;

        break;
      }

      if (
        invocation.transport ===
          'FAILURE'
      ) {
        queue.settle(
          provider,
          record.lease.leaseId,
          'TRANSPORT_FAILURE',
          null,
          now(options),
        );

        transportStoppedProviders.add(
          provider,
        );

        stats.transportFailures +=
          1;

        break;
      }

      if (
        invocation.protocol ===
          'REJECTED'
      ) {
        /*
         * Persistent queue transaction opens only this
         * provider's quality circuit.
         */
        queue.settle(
          provider,
          record.lease.leaseId,
          'PROTOCOL_REJECTED',
          null,
          now(options),
        );

        stats.protocolRejected +=
          1;

        break;
      }

      if (
        invocation.protocol !==
          'PASS' ||
        typeof invocation.raw !==
          'string'
      ) {
        queue.settle(
          provider,
          record.lease.leaseId,
          'PROTOCOL_REJECTED',
          null,
          now(options),
        );

        stats.protocolRejected +=
          1;

        break;
      }

      let accepted;

      try {
        /*
         * Protocol success still has no useful-work
         * authority. Exact work-product contract is
         * independently validated here.
         */
        accepted =
          parseProviderWorkProduct(
            invocation.raw,
            capsule,
            provider,
          );
      } catch {
        queue.settle(
          provider,
          record.lease.leaseId,
          'CONTRACT_REJECTED',
          null,
          now(options),
        );

        stats.contractRejected +=
          1;

        break;
      }

      if (!accepted.usable) {
        queue.settleBlocked(
          provider,
          record.lease.leaseId,
          accepted,
          capsule,
          now(options),
        );

        stats.blocked +=
          1;

        continue;
      }

      /*
       * Only SQLite decides unique vs duplicate and
       * durably persists the exact accepted work
       * product in the same transaction.
       */
      const settled =
        queue.settleUseful(
          provider,
          record.lease.leaseId,
          accepted,
          now(options),
        );

      if (
        settled.lastOutcome ===
          'USEFUL_UNIQUE'
      ) {
        stats.usefulUnique +=
          1;
      } else if (
        settled.lastOutcome ===
          'USEFUL_DUPLICATE'
      ) {
        stats.usefulDuplicate +=
          1;
      } else {
        throw new Error(
          'LIVE_POOL_USEFUL_SETTLE_INVALID',
        );
      }
    }

    return stats;
  } finally {
    queue.close();
  }
}

function aggregateStats(
  provider:
    Provider,

  slots:
    number,

  values:
    readonly MutableStats[],
): LiveProviderPoolStats {
  const total =
    emptyStats(
      provider,
      slots,
    );

  for (
    const value
    of values
  ) {
    total.claims +=
      value.claims;

    total.liveProviderCalls +=
      value.liveProviderCalls;

    total.usefulUnique +=
      value.usefulUnique;

    total.usefulDuplicate +=
      value.usefulDuplicate;

    total.blocked +=
      value.blocked;

    total.protocolRejected +=
      value.protocolRejected;

    total.contractRejected +=
      value.contractRejected;

    total.transportFailures +=
      value.transportFailures;

    total.stoppedByQualityCircuit +=
      value
        .stoppedByQualityCircuit;

    total.stoppedByTransportCircuit +=
      value
        .stoppedByTransportCircuit;
  }

  return freezeStats(
    total,
  );
}

function resolvedAntigravityConcurrency(
  options:
    LiveTransactionalPoolOptions,
): number {
  const value =
    options.antigravityConcurrency ??
    (
      options.antigravitySlots === 0
        ? 0
        : 1
    );

  validateInteger(
    value,
    'ANTIGRAVITY_CONCURRENCY',
    0,
    VERIFIED_8X8_POLICY
      .targetAntigravity,
  );

  if (
    options.antigravitySlots === 0
  ) {
    if (value !== 0) {
      throw new Error(
        'LIVE_POOL_ANTIGRAVITY_CONCURRENCY_WITHOUT_SLOTS',
      );
    }

    return 0;
  }

  if (
    value < 1 ||
    value >
      options.antigravitySlots
  ) {
    throw new Error(
      'LIVE_POOL_ANTIGRAVITY_CONCURRENCY_INVALID',
    );
  }

  return value;
}

function validatePlan(
  options:
    LiveTransactionalPoolOptions,
): void {
  if (
    options.mode !== 'DUAL' &&
    options.mode !==
      'CODEX_ONLY' &&
    options.mode !==
      'ANTIGRAVITY_ONLY'
  ) {
    throw new Error(
      'LIVE_POOL_MODE_INVALID',
    );
  }

  validateInteger(
    options.codexSlots,
    'CODEX_SLOTS',
    0,
    64,
  );

  validateInteger(
    options.antigravitySlots,
    'ANTIGRAVITY_SLOTS',
    0,
    64,
  );

  validateInteger(
    options.leaseDurationMs,
    'LEASE_DURATION',
    5_000,
    30 * 60_000,
  );

  validateInteger(
    options.maxClaimsPerSlot,
    'MAX_CLAIMS',
    1,
    10_000,
  );

  resolvedAntigravityConcurrency(
    options,
  );

  const total =
    options.codexSlots +
    options.antigravitySlots;

  const targets =
    targetsForMode(
      options.mode,
    );

  if (
    options.codexSlots >
      targets.codex ||
    options.antigravitySlots >
      targets.antigravity
  ) {
    throw new Error(
      'LIVE_POOL_PROVIDER_TARGET_EXCEEDED',
    );
  }

  if (
    total < 1 ||
    total >
      VERIFIED_8X8_POLICY
        .globalEffectiveMax
  ) {
    throw new Error(
      'LIVE_POOL_GLOBAL_SLOT_LIMIT_EXCEEDED',
    );
  }

  if (
    !livePlanFitsCurrentCertifiedEnvelope(
      options.mode,
      options.codexSlots,
      options.antigravitySlots,
    )
  ) {
    throw new Error(
      'LIVE_POOL_HARD_ENVELOPE_REJECTED',
    );
  }
}

export async function
runLiveTransactionalProviderWorkerPool(
  options:
    LiveTransactionalPoolOptions,
): Promise<LiveTransactionalPoolResult> {
  validatePlan(
    options,
  );

  const codexPromises:
    Promise<MutableStats>[] = [];

  /*
   * Shared only within this bounded pool invocation.
   *
   * This prevents blind later calls after uncertain
   * transport without conflating transport health with
   * provider output quality.
   */
  const transportStoppedProviders =
    new Set<Provider>();

  /*
   * Antigravity logical slot count and physical process
   * concurrency are independent.
   *
   * No more than antigravityConcurrency runSlot calls
   * are active simultaneously.
   *
   * Each worker re-enters runSlot before claiming the
   * next logical slot, so the run-local transport stop
   * and persistent quality circuit are re-checked before
   * later work is launched.
   */
  const runAntigravitySlotsBounded =
    async (): Promise<MutableStats[]> => {
      const concurrency =
        resolvedAntigravityConcurrency(
          options,
        );

      if (
        options.antigravitySlots === 0
      ) {
        return [];
      }

      const values:
        MutableStats[] =
          new Array(
            options.antigravitySlots,
          );

      let nextSlot =
        1;

      const worker =
        async (): Promise<void> => {
          while (true) {
            /*
             * JavaScript executes this allocation
             * synchronously between awaits, making each
             * logical slot unique within this invocation.
             */
            const slot =
              nextSlot;

            if (
              slot >
                options.antigravitySlots
            ) {
              return;
            }

            nextSlot +=
              1;

            values[
              slot - 1
            ] =
              await runSlot(
                options,
                'antigravity',
                `live-antigravity-${String(slot)
                  .padStart(2, '0')}`,
                transportStoppedProviders,
              );
          }
        };

      await Promise.all(
        Array.from(
          {
            length:
              concurrency,
          },
          () =>
            worker(),
        ),
      );

      return values;
    };

  for (
    let slot = 1;
    slot <=
      options.codexSlots;
    slot += 1
  ) {
    codexPromises.push(
      runSlot(
        options,
        'codex',
        `live-codex-${String(slot)
          .padStart(2, '0')}`,

        transportStoppedProviders,
      ),
    );
  }


  const [
    codexValues,
    antigravityValues,
  ] =
    await Promise.all([
      Promise.all(
        codexPromises,
      ),

      runAntigravitySlotsBounded(),
    ]);

  const codex =
    aggregateStats(
      'codex',
      options.codexSlots,
      codexValues,
    );

  const antigravity =
    aggregateStats(
      'antigravity',
      options.antigravitySlots,
      antigravityValues,
    );

  return Object.freeze({
    schemaVersion:
      LIVE_TRANSACTIONAL_PROVIDER_POOL_SCHEMA,

    codex,
    antigravity,

    totalSlots:
      options.codexSlots +
      options.antigravitySlots,

    totalLiveProviderCalls:
      codex.liveProviderCalls +
      antigravity
        .liveProviderCalls,

    totalUsefulUnique:
      codex.usefulUnique +
      antigravity
        .usefulUnique,

    totalUsefulDuplicate:
      codex.usefulDuplicate +
      antigravity
        .usefulDuplicate,

    fulgorCalled:
      false,

    verificationGranted:
      false,

    authorityGranted:
      false,
  });
}
