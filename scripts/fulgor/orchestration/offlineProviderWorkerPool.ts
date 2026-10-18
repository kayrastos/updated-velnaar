import type {
  Provider,
} from '../scheduler/verified8x8Scheduler';

import {
  parseProviderWorkProduct,
  type HostEvidenceCapsule,
} from './providerWorkProductGate';

import {
  workProductFingerprint,
  type WorkOutcome,
} from './providerWorkAccounting';

import type {
  ProviderWorkRecord,
} from './providerWorkOrder';

import {
  TransactionalProviderQueue,
} from './transactionalProviderQueue';

export const OFFLINE_PROVIDER_POOL_SCHEMA =
  'VELNAR_OFFLINE_PROVIDER_POOL_V1' as const;

export type OfflineFakeProviderResult =
  | Readonly<{
      source:
        'OFFLINE_FAKE';

      transport:
        'OK';

      raw: string;
    }>
  | Readonly<{
      source:
        'OFFLINE_FAKE';

      transport:
        'FAILURE';
    }>;

export interface OfflineFakeProviderInput {
  readonly provider:
    Provider;

  readonly slotId:
    string;

  readonly record:
    ProviderWorkRecord;

  readonly capsule:
    HostEvidenceCapsule;
}

export type OfflineFakeProviderInvoker =
  (
    input:
      OfflineFakeProviderInput,
  ) =>
    Promise<
      OfflineFakeProviderResult
    >;

export type OfflineCapsuleLoader =
  (
    record:
      ProviderWorkRecord,
  ) =>
    HostEvidenceCapsule;

export interface OfflineProviderPoolOptions {
  readonly queuePath:
    string;

  readonly codexSlots:
    number;

  readonly antigravitySlots:
    number;

  readonly leaseDurationMs:
    number;

  /*
   * Bounds every offline slot and prevents a faulty
   * fixture from creating an infinite worker loop.
   */
  readonly maxClaimsPerSlot:
    number;

  readonly loadCapsule:
    OfflineCapsuleLoader;

  readonly invokeFakeProvider:
    OfflineFakeProviderInvoker;
}

export interface OfflineProviderPoolStats {
  readonly provider:
    Provider;

  readonly slots:
    number;

  readonly claims:
    number;

  readonly fakeProviderCalls:
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
}

export interface OfflineProviderPoolResult {
  readonly schemaVersion:
    typeof OFFLINE_PROVIDER_POOL_SCHEMA;

  readonly codex:
    OfflineProviderPoolStats;

  readonly antigravity:
    OfflineProviderPoolStats;

  readonly totalSlots:
    number;

  readonly totalFakeProviderCalls:
    number;

  readonly totalUsefulUnique:
    number;

  readonly totalUsefulDuplicate:
    number;

  readonly liveProviderCalled:
    false;

  readonly fulgorCalled:
    false;
}

interface MutableStats {
  provider: Provider;

  slots: number;

  claims: number;
  fakeProviderCalls: number;

  usefulUnique: number;
  usefulDuplicate: number;

  blocked: number;

  protocolRejected: number;
  contractRejected: number;

  transportFailures: number;

  stoppedByQualityCircuit:
    number;
}

function validatePositiveInteger(
  value: number,
  name: string,
  max: number,
): void {
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > max
  ) {
    throw new Error(
      `OFFLINE_POOL_${name}_INVALID`,
    );
  }
}

function sortedUnique(
  values: readonly string[],
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
      'OFFLINE_POOL_CAPSULE_TASK_MISMATCH',
    );
  }

  if (
    capsule.baseline !==
      record.order.baseline
  ) {
    throw new Error(
      'OFFLINE_POOL_CAPSULE_BASELINE_MISMATCH',
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
      'OFFLINE_POOL_CAPSULE_EVIDENCE_MISMATCH',
    );
  }
}

/*
 * Protocol failure means the provider failed to return
 * the requested wrapper/schema at all.
 *
 * Contract failure means a parseable protocol response
 * violated task/baseline/evidence/candidate constraints.
 */
export function classifyWorkProductFailure(
  error: unknown,
): Extract<
  WorkOutcome,
  | 'PROTOCOL_REJECTED'
  | 'CONTRACT_REJECTED'
> {
  const message =
    error instanceof Error
      ? error.message
      : String(error);

  const protocolMarkers =
    [
      'WORK_PRODUCT_RAW_SIZE_INVALID',
      'WORK_PRODUCT_INVALID_JSON',
      'WORK_PRODUCT_ROOT_INVALID',
      'WORK_PRODUCT_ROOT_KEYS_INVALID',
      'WORK_PRODUCT_SCHEMA_INVALID',
    ];

  if (
    protocolMarkers.some(
      marker =>
        message.includes(marker),
    )
  ) {
    return 'PROTOCOL_REJECTED';
  }

  return 'CONTRACT_REJECTED';
}

function emptyStats(
  provider: Provider,
  slots: number,
): MutableStats {
  return {
    provider,
    slots,

    claims: 0,
    fakeProviderCalls: 0,

    usefulUnique: 0,
    usefulDuplicate: 0,

    blocked: 0,

    protocolRejected: 0,
    contractRejected: 0,

    transportFailures: 0,

    stoppedByQualityCircuit:
      0,
  };
}

function freezeStats(
  value:
    MutableStats,
): OfflineProviderPoolStats {
  return Object.freeze({
    provider:
      value.provider,

    slots:
      value.slots,

    claims:
      value.claims,

    fakeProviderCalls:
      value.fakeProviderCalls,

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
      value.stoppedByQualityCircuit,
  });
}

function isQualityOpenError(
  error: unknown,
  provider: Provider,
): boolean {
  return (
    error instanceof Error &&
    error.message.includes(
      `QUEUE_PROVIDER_QUALITY_OPEN=${provider}`,
    )
  );
}

async function runSlot(
  options:
    OfflineProviderPoolOptions,

  provider:
    Provider,

  slotId:
    string,
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
            Date.now(),
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

      if (record.lease === null) {
        throw new Error(
          'OFFLINE_POOL_CLAIM_WITHOUT_LEASE',
        );
      }

      /*
       * Resolve and validate host evidence before any
       * fake provider invocation.
       */
      const capsule =
        options.loadCapsule(
          record,
        );

      validateCapsuleBinding(
        record,
        capsule,
      );

      stats.fakeProviderCalls +=
        1;

      let transport:
        OfflineFakeProviderResult;

      try {
        transport =
          await options
            .invokeFakeProvider({
              provider,
              slotId,
              record,
              capsule,
            });
      } catch {
        transport =
          Object.freeze({
            source:
              'OFFLINE_FAKE',

            transport:
              'FAILURE',
          });
      }

      if (
        transport.source !==
        'OFFLINE_FAKE'
      ) {
        throw new Error(
          'OFFLINE_POOL_NON_FAKE_SOURCE',
        );
      }

      if (
        transport.transport ===
        'FAILURE'
      ) {
        queue.settle(
          provider,
          record.lease.leaseId,
          'TRANSPORT_FAILURE',
          null,
          Date.now(),
        );

        stats.transportFailures +=
          1;

        /*
         * No blind storm after an uncertain transport
         * failure. Stop this slot.
         */
        break;
      }

      let accepted;

      try {
        accepted =
          parseProviderWorkProduct(
            transport.raw,
            capsule,
            provider,
          );
      } catch (error) {
        const outcome =
          classifyWorkProductFailure(
            error,
          );

        queue.settle(
          provider,
          record.lease.leaseId,
          outcome,
          null,
          Date.now(),
        );

        if (
          outcome ===
          'PROTOCOL_REJECTED'
        ) {
          stats.protocolRejected +=
            1;
        } else {
          stats.contractRejected +=
            1;
        }

        /*
         * settle() atomically opened this provider's
         * persistent quality circuit.
         */
        break;
      }

      if (!accepted.usable) {
        queue.settle(
          provider,
          record.lease.leaseId,
          'BLOCKED',
          null,
          Date.now(),
        );

        stats.blocked += 1;

        continue;
      }

      const fingerprint =
        workProductFingerprint(
          accepted,
        );

      const settled =
        queue.settleUseful(
          provider,
          record.lease.leaseId,
          fingerprint,
          Date.now(),
        );

      /*
       * Throughput authority is the persisted queue
       * result, not an in-memory pre-classification.
       */
      if (
        settled.lastOutcome ===
        'USEFUL_UNIQUE'
      ) {
        stats.usefulUnique += 1;
      } else if (
        settled.lastOutcome ===
        'USEFUL_DUPLICATE'
      ) {
        stats.usefulDuplicate +=
          1;
      } else {
        throw new Error(
          'OFFLINE_POOL_USEFUL_SETTLE_INVALID',
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
): OfflineProviderPoolStats {
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

    total.fakeProviderCalls +=
      value.fakeProviderCalls;

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
      value.stoppedByQualityCircuit;
  }

  return freezeStats(
    total,
  );
}

export async function runOfflineProviderWorkerPool(
  options:
    OfflineProviderPoolOptions,
): Promise<OfflineProviderPoolResult> {
  validatePositiveInteger(
    options.codexSlots,
    'CODEX_SLOTS',
    64,
  );

  validatePositiveInteger(
    options.antigravitySlots,
    'ANTIGRAVITY_SLOTS',
    64,
  );

  validatePositiveInteger(
    options.leaseDurationMs,
    'LEASE_DURATION',
    30 * 60_000,
  );

  if (
    options.leaseDurationMs <
    5_000
  ) {
    throw new Error(
      'OFFLINE_POOL_LEASE_DURATION_INVALID',
    );
  }

  validatePositiveInteger(
    options.maxClaimsPerSlot,
    'MAX_CLAIMS',
    10_000,
  );

  const codexPromises:
    Promise<MutableStats>[] = [];

  const antigravityPromises:
    Promise<MutableStats>[] = [];

  /*
   * This is deliberately configurable.
   * 8+8 is the current certified baseline,
   * not an architectural ceiling.
   */
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
        `codex-${String(slot)
          .padStart(2, '0')}`,
      ),
    );
  }

  for (
    let slot = 1;
    slot <=
      options.antigravitySlots;
    slot += 1
  ) {
    antigravityPromises.push(
      runSlot(
        options,
        'antigravity',
        `antigravity-${String(slot)
          .padStart(2, '0')}`,
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

      Promise.all(
        antigravityPromises,
      ),
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
      OFFLINE_PROVIDER_POOL_SCHEMA,

    codex,
    antigravity,

    totalSlots:
      options.codexSlots +
      options.antigravitySlots,

    totalFakeProviderCalls:
      codex.fakeProviderCalls +
      antigravity
        .fakeProviderCalls,

    totalUsefulUnique:
      codex.usefulUnique +
      antigravity.usefulUnique,

    totalUsefulDuplicate:
      codex.usefulDuplicate +
      antigravity
        .usefulDuplicate,

    liveProviderCalled:
      false,

    fulgorCalled:
      false,
  });
}
