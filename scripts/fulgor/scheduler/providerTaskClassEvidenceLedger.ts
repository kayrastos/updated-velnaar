import {
  emptyProviderQualityCounters,
  recordWorkOutcome,
  type ProviderQualityCounters,
  type WorkOutcome,
} from '../orchestration/providerWorkAccounting';

import type {
  Provider,
} from './verified8x8Scheduler';

import {
  PROVIDER_TASK_CLASSES,
  PROVIDER_TASK_ROUTER_POLICY,
  type ProviderTaskClass,
  type ProviderTaskLaneEvidence,
} from './providerTaskRouter';

export const PROVIDER_TASK_CLASS_EVIDENCE_LEDGER_SCHEMA =
  'VELNAR_PROVIDER_TASK_CLASS_EVIDENCE_LEDGER_V1' as const;

export const HOST_TASK_CLASS_OUTCOME_SCHEMA =
  'VELNAR_HOST_TASK_CLASS_OUTCOME_V1' as const;

const WORK_OUTCOMES =
  Object.freeze([
    'TRANSPORT_FAILURE',
    'PROTOCOL_REJECTED',
    'CONTRACT_REJECTED',
    'BLOCKED',
    'USEFUL_DUPLICATE',
    'USEFUL_UNIQUE',
  ] as const);

export interface HostTaskClassOutcomeInput {
  readonly jobId:
    string;

  readonly baseline:
    string;

  readonly provider:
    Provider;

  readonly taskClass:
    ProviderTaskClass;

  readonly outcome:
    WorkOutcome;

  readonly observedAtMs:
    number;
}

export interface HostTaskClassOutcomeRecord {
  readonly schemaVersion:
    typeof HOST_TASK_CLASS_OUTCOME_SCHEMA;

  /*
   * This field is generated inside the host-owned ledger.
   * Provider/model output is never accepted as its source.
   */
  readonly source:
    'HOST_RUNTIME';

  readonly jobId:
    string;

  readonly baseline:
    string;

  readonly provider:
    Provider;

  readonly taskClass:
    ProviderTaskClass;

  readonly outcome:
    WorkOutcome;

  readonly observedAtMs:
    number;
}

export interface ProviderTaskClassEvidenceLedger {
  readonly schemaVersion:
    typeof PROVIDER_TASK_CLASS_EVIDENCE_LEDGER_SCHEMA;

  readonly baseline:
    string;

  readonly records:
    readonly HostTaskClassOutcomeRecord[];
}

export interface ProviderTaskClassRuntimeState {
  readonly qualityCircuit:
    'CLOSED' |
    'OPEN';

  readonly quotaCircuit:
    'CLOSED' |
    'OPEN';

  readonly availableSlots:
    number;
}

export interface ProviderTaskClassRecoveryEvidence {
  readonly baseline:
    string;

  readonly provider:
    Provider;

  readonly taskClass:
    ProviderTaskClass;

  /*
   * Most recent transport uncertainty for this exact
   * baseline + provider + task-class lane.
   *
   * Null means there is no transport recovery event.
   */
  readonly latestTransportFailureObservedAtMs:
    number | null;

  /*
   * Recovery is eligible only when the immediately
   * preceding bounded certification window was healthy.
   *
   * A recovery path must never convert an historically
   * unproven lane into a trusted lane.
   */
  readonly certifiedImmediatelyBeforeLatestTransportFailure:
    boolean;

  /*
   * Fresh outcomes after the latest transport failure.
   *
   * These are host-recorded evidence only. They are not
   * provider claims and grant no execution authority.
   */
  readonly postFailureAttempts:
    number;

  readonly postFailureUsefulUnique:
    number;

  readonly postFailureNonUseful:
    number;
}

function validBaseline(
  value:
    string,
): boolean {
  return /^[0-9a-f]{40}$/i
    .test(value);
}

function validProvider(
  value:
    string,
): value is Provider {
  return (
    value === 'codex' ||
    value === 'antigravity'
  );
}

function validTaskClass(
  value:
    string,
): value is ProviderTaskClass {
  return (
    PROVIDER_TASK_CLASSES as
      readonly string[]
  ).includes(value);
}

function validOutcome(
  value:
    string,
): value is WorkOutcome {
  return (
    WORK_OUTCOMES as
      readonly string[]
  ).includes(value);
}

function validateJobId(
  value:
    string,
): void {
  if (
    value.length < 1 ||
    value.length > 200 ||
    !/^[A-Za-z0-9._:/-]+$/
      .test(value)
  ) {
    throw new Error(
      'TASK_CLASS_EVIDENCE_JOB_ID_INVALID',
    );
  }
}

function validateRuntimeState(
  state:
    ProviderTaskClassRuntimeState,
): void {
  if (
    state.qualityCircuit !==
      'CLOSED' &&
    state.qualityCircuit !==
      'OPEN'
  ) {
    throw new Error(
      'TASK_CLASS_EVIDENCE_QUALITY_CIRCUIT_INVALID',
    );
  }

  if (
    state.quotaCircuit !==
      'CLOSED' &&
    state.quotaCircuit !==
      'OPEN'
  ) {
    throw new Error(
      'TASK_CLASS_EVIDENCE_QUOTA_CIRCUIT_INVALID',
    );
  }

  if (
    !Number.isSafeInteger(
      state.availableSlots,
    ) ||
    state.availableSlots < 0 ||
    state.availableSlots >
      PROVIDER_TASK_ROUTER_POLICY
        .maxAvailableSlotsPerProvider
  ) {
    throw new Error(
      'TASK_CLASS_EVIDENCE_AVAILABLE_SLOTS_INVALID',
    );
  }
}

export function createProviderTaskClassEvidenceLedger(
  baseline:
    string,
): ProviderTaskClassEvidenceLedger {
  if (
    !validBaseline(
      baseline,
    )
  ) {
    throw new Error(
      'TASK_CLASS_EVIDENCE_BASELINE_INVALID',
    );
  }

  return Object.freeze({
    schemaVersion:
      PROVIDER_TASK_CLASS_EVIDENCE_LEDGER_SCHEMA,

    baseline,

    records:
      Object.freeze([]),
  });
}

export function recordHostTaskClassOutcome(
  ledger:
    ProviderTaskClassEvidenceLedger,

  input:
    HostTaskClassOutcomeInput,
): ProviderTaskClassEvidenceLedger {
  if (
    ledger.schemaVersion !==
      PROVIDER_TASK_CLASS_EVIDENCE_LEDGER_SCHEMA
  ) {
    throw new Error(
      'TASK_CLASS_EVIDENCE_LEDGER_SCHEMA_INVALID',
    );
  }

  if (
    !validBaseline(
      ledger.baseline,
    ) ||
    !validBaseline(
      input.baseline,
    ) ||
    input.baseline !==
      ledger.baseline
  ) {
    throw new Error(
      'TASK_CLASS_EVIDENCE_BASELINE_MISMATCH',
    );
  }

  validateJobId(
    input.jobId,
  );

  if (
    !validProvider(
      input.provider,
    )
  ) {
    throw new Error(
      'TASK_CLASS_EVIDENCE_PROVIDER_INVALID',
    );
  }

  if (
    !validTaskClass(
      input.taskClass,
    )
  ) {
    throw new Error(
      'TASK_CLASS_EVIDENCE_CLASS_INVALID',
    );
  }

  if (
    !validOutcome(
      input.outcome,
    )
  ) {
    throw new Error(
      'TASK_CLASS_EVIDENCE_OUTCOME_INVALID',
    );
  }

  if (
    !Number.isSafeInteger(
      input.observedAtMs,
    ) ||
    input.observedAtMs < 0
  ) {
    throw new Error(
      'TASK_CLASS_EVIDENCE_TIME_INVALID',
    );
  }

  /*
   * A host job cannot be replayed under another provider,
   * class or outcome merely to improve routing evidence.
   */
  if (
    ledger.records.some(
      record =>
        record.jobId ===
          input.jobId,
    )
  ) {
    throw new Error(
      'TASK_CLASS_EVIDENCE_JOB_ALREADY_RECORDED',
    );
  }

  const record:
    HostTaskClassOutcomeRecord =
      Object.freeze({
        schemaVersion:
          HOST_TASK_CLASS_OUTCOME_SCHEMA,

        source:
          'HOST_RUNTIME' as const,

        jobId:
          input.jobId,

        baseline:
          input.baseline,

        provider:
          input.provider,

        taskClass:
          input.taskClass,

        outcome:
          input.outcome,

        observedAtMs:
          input.observedAtMs,
      });

  return Object.freeze({
    schemaVersion:
      PROVIDER_TASK_CLASS_EVIDENCE_LEDGER_SCHEMA,

    baseline:
      ledger.baseline,

    records:
      Object.freeze([
        ...ledger.records,
        record,
      ]),
  });
}

export function providerTaskClassCounters(
  ledger:
    ProviderTaskClassEvidenceLedger,

  provider:
    Provider,

  taskClass:
    ProviderTaskClass,
): ProviderQualityCounters {
  if (
    !validProvider(
      provider,
    )
  ) {
    throw new Error(
      'TASK_CLASS_EVIDENCE_PROVIDER_INVALID',
    );
  }

  if (
    !validTaskClass(
      taskClass,
    )
  ) {
    throw new Error(
      'TASK_CLASS_EVIDENCE_CLASS_INVALID',
    );
  }

  /*
   * Task-class routing evidence is a bounded recent
   * certification window, not a lifetime reputation.
   *
   * This is intentionally the same canonical minimum
   * sample count required by the router.
   *
   * A historical failure remains visible until it is
   * displaced by a complete fresh window. One success
   * can therefore never erase one failure.
   */
  const records =
    ledger.records
      .filter(
        record =>
          record.provider ===
            provider &&
          record.taskClass ===
            taskClass,
      )
      .slice()
      .sort(
        (
          left,
          right,
        ) => {
          if (
            left.observedAtMs !==
              right.observedAtMs
          ) {
            return (
              left.observedAtMs -
              right.observedAtMs
            );
          }

          if (
            left.jobId <
              right.jobId
          ) {
            return -1;
          }

          if (
            left.jobId >
              right.jobId
          ) {
            return 1;
          }

          return 0;
        },
      )
      .slice(
        -PROVIDER_TASK_ROUTER_POLICY
          .minimumAttemptsPerTaskClass,
      );

  let counters =
    emptyProviderQualityCounters(
      provider,
    );

  for (
    const record
    of records
  ) {
    counters =
      recordWorkOutcome(
        counters,
        record.outcome,
      );
  }

  return counters;
}

export function
buildProviderTaskClassRecoveryEvidenceFromHostLedger(
  ledger:
    ProviderTaskClassEvidenceLedger,

  provider:
    Provider,

  taskClass:
    ProviderTaskClass,
): ProviderTaskClassRecoveryEvidence {
  if (
    !validProvider(
      provider,
    )
  ) {
    throw new Error(
      'TASK_CLASS_RECOVERY_PROVIDER_INVALID',
    );
  }

  if (
    !validTaskClass(
      taskClass,
    )
  ) {
    throw new Error(
      'TASK_CLASS_RECOVERY_CLASS_INVALID',
    );
  }

  const records =
    ledger.records
      .filter(
        record =>
          record.provider ===
            provider &&
          record.taskClass ===
            taskClass,
      )
      .slice()
      .sort(
        (
          left,
          right,
        ) => {
          if (
            left.observedAtMs !==
              right.observedAtMs
          ) {
            return (
              left.observedAtMs -
              right.observedAtMs
            );
          }

          if (
            left.jobId <
              right.jobId
          ) {
            return -1;
          }

          if (
            left.jobId >
              right.jobId
          ) {
            return 1;
          }

          return 0;
        },
      );

  let failureIndex =
    -1;

  for (
    let index =
      records.length - 1;
    index >= 0;
    index -= 1
  ) {
    if (
      records[index]?.outcome ===
        'TRANSPORT_FAILURE'
    ) {
      failureIndex =
        index;

      break;
    }
  }

  if (
    failureIndex < 0
  ) {
    return Object.freeze({
      baseline:
        ledger.baseline,

      provider,

      taskClass,

      latestTransportFailureObservedAtMs:
        null,

      certifiedImmediatelyBeforeLatestTransportFailure:
        false,

      postFailureAttempts:
        0,

      postFailureUsefulUnique:
        0,

      postFailureNonUseful:
        0,
    });
  }

  const failure =
    records[
      failureIndex
    ];

  if (
    failure ===
      undefined
  ) {
    throw new Error(
      'TASK_CLASS_RECOVERY_FAILURE_RECORD_MISSING',
    );
  }

  const priorWindow =
    records
      .slice(
        0,
        failureIndex,
      )
      .slice(
        -PROVIDER_TASK_ROUTER_POLICY
          .minimumAttemptsPerTaskClass,
      );

  const certifiedBefore =
    priorWindow.length ===
      PROVIDER_TASK_ROUTER_POLICY
        .minimumAttemptsPerTaskClass &&
    priorWindow.every(
      record =>
        record.outcome ===
          'USEFUL_UNIQUE',
    );

  const postFailure =
    records.slice(
      failureIndex + 1,
    );

  const postFailureUsefulUnique =
    postFailure.filter(
      record =>
        record.outcome ===
          'USEFUL_UNIQUE',
    ).length;

  return Object.freeze({
    baseline:
      ledger.baseline,

    provider,

    taskClass,

    latestTransportFailureObservedAtMs:
      failure.observedAtMs,

    certifiedImmediatelyBeforeLatestTransportFailure:
      certifiedBefore,

    postFailureAttempts:
      postFailure.length,

    postFailureUsefulUnique,

    postFailureNonUseful:
      postFailure.length -
      postFailureUsefulUnique,
  });
}

/*
 * Certification is derived from host-recorded outcomes only.
 *
 * There is intentionally no caller-controlled
 * `certified` parameter.
 *
 * V1 is deliberately stricter than the router's 90% useful
 * threshold: the bounded recent certification window must
 * contain the canonical minimum sample count and every
 * sample in that exact provider+taskClass window must be
 * USEFUL_UNIQUE.
 */
export function providerTaskClassCertified(
  counters:
    ProviderQualityCounters,
): boolean {
  return (
    counters.attempts >=
      PROVIDER_TASK_ROUTER_POLICY
        .minimumAttemptsPerTaskClass &&
    counters.usefulUnique ===
      counters.attempts
  );
}

export function buildProviderTaskLaneEvidenceFromHostLedger(
  ledger:
    ProviderTaskClassEvidenceLedger,

  provider:
    Provider,

  taskClass:
    ProviderTaskClass,

  runtime:
    ProviderTaskClassRuntimeState,
): ProviderTaskLaneEvidence {
  validateRuntimeState(
    runtime,
  );

  const counters =
    providerTaskClassCounters(
      ledger,
      provider,
      taskClass,
    );

  return Object.freeze({
    provider,

    taskClass,

    counters,

    certified:
      providerTaskClassCertified(
        counters,
      ),

    qualityCircuit:
      runtime.qualityCircuit,

    quotaCircuit:
      runtime.quotaCircuit,

    availableSlots:
      runtime.availableSlots,
  });
}
