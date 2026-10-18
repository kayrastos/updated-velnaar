import {
  createHash,
} from 'node:crypto';

import type {
  Provider,
} from '../scheduler/verified8x8Scheduler';

import type {
  WorkOutcome,
} from './providerWorkAccounting';

export const PROVIDER_WORK_ORDER_SCHEMA =
  'VELNAR_PROVIDER_WORK_ORDER_V1' as const;

export const PROVIDER_WORK_RECORD_SCHEMA =
  'VELNAR_PROVIDER_WORK_RECORD_V1' as const;

export type ProviderAffinity =
  | Provider
  | 'either';

export type ProviderWorkState =
  | 'PENDING'
  | 'LEASED'
  | 'USEFUL_COMPLETE'
  | 'BLOCKED'
  | 'QUALITY_HOLD'
  | 'RECOVERY_HOLD';

export type RecoveryHoldReason =
  | 'TRANSPORT_FAILURE'
  | 'LEASE_EXPIRED';

export interface ProviderWorkOrder {
  readonly schemaVersion:
    typeof PROVIDER_WORK_ORDER_SCHEMA;

  readonly jobId: string;
  readonly baseline: string;

  readonly task: string;

  readonly evidenceIds:
    readonly string[];

  readonly affinity:
    ProviderAffinity;
}

export interface ProviderWorkLease {
  readonly leaseId: string;

  readonly provider:
    Provider;

  readonly slotId:
    string;

  readonly attempt:
    number;

  readonly leasedAtMs:
    number;

  readonly expiresAtMs:
    number;
}

export interface ProviderWorkRecord {
  readonly schemaVersion:
    typeof PROVIDER_WORK_RECORD_SCHEMA;

  readonly order:
    ProviderWorkOrder;

  readonly state:
    ProviderWorkState;

  readonly attempts:
    number;

  readonly lease:
    ProviderWorkLease | null;

  readonly lastOutcome:
    WorkOutcome | null;

  readonly fingerprint:
    string | null;

  readonly recoveryHoldReason:
    RecoveryHoldReason | null;

  readonly createdAtMs:
    number;

  readonly updatedAtMs:
    number;
}

const MAX_TASK_BYTES = 8_192;
const MAX_EVIDENCE_IDS = 32;

const MIN_LEASE_MS = 5_000;
const MAX_LEASE_MS =
  30 * 60_000;

const JOB_ID_RE =
  /^[A-Za-z0-9._-]{1,80}$/;

const SLOT_ID_RE =
  /^[A-Za-z0-9._-]{1,64}$/;

const EVIDENCE_ID_RE =
  /^[A-Za-z0-9._-]{1,128}$/;

const SHA40_RE =
  /^[0-9a-f]{40}$/;

const SHA64_RE =
  /^[0-9a-f]{64}$/;

const WORK_OUTCOMES =
  new Set<WorkOutcome>([
    'TRANSPORT_FAILURE',
    'PROTOCOL_REJECTED',
    'CONTRACT_REJECTED',
    'BLOCKED',
    'USEFUL_DUPLICATE',
    'USEFUL_UNIQUE',
  ]);

function sha256(
  value: string,
): string {
  return createHash('sha256')
    .update(value, 'utf8')
    .digest('hex');
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual =
    Object.keys(value).sort();

  const want =
    [...expected].sort();

  return (
    actual.length === want.length &&
    actual.every(
      (key, index) =>
        key === want[index],
    )
  );
}

function validTimestamp(
  value: unknown,
): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function validCounter(
  value: unknown,
): value is number {
  return validTimestamp(value);
}

function boundedText(
  value: unknown,
  maxBytes: number,
): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    !value.includes('\0') &&
    Buffer.byteLength(
      value,
      'utf8',
    ) <= maxBytes
  );
}

function providerAllowed(
  affinity: ProviderAffinity,
  provider: Provider,
): boolean {
  return (
    affinity === 'either' ||
    affinity === provider
  );
}

export function createProviderWorkOrder(
  input: {
    jobId: string;
    baseline: string;
    task: string;
    evidenceIds:
      readonly string[];
    affinity:
      ProviderAffinity;
  },
): ProviderWorkOrder {
  if (
    !JOB_ID_RE.test(
      input.jobId,
    )
  ) {
    throw new Error(
      'WORK_ORDER_JOB_ID_INVALID',
    );
  }

  if (
    !SHA40_RE.test(
      input.baseline,
    )
  ) {
    throw new Error(
      'WORK_ORDER_BASELINE_INVALID',
    );
  }

  if (
    !boundedText(
      input.task,
      MAX_TASK_BYTES,
    )
  ) {
    throw new Error(
      'WORK_ORDER_TASK_INVALID',
    );
  }

  if (
    input.affinity !== 'codex' &&
    input.affinity !== 'antigravity' &&
    input.affinity !== 'either'
  ) {
    throw new Error(
      'WORK_ORDER_AFFINITY_INVALID',
    );
  }

  if (
    !Array.isArray(
      input.evidenceIds,
    ) ||
    input.evidenceIds.length < 1 ||
    input.evidenceIds.length >
      MAX_EVIDENCE_IDS
  ) {
    throw new Error(
      'WORK_ORDER_EVIDENCE_INVALID',
    );
  }

  const evidenceIds =
    [...input.evidenceIds];

  for (
    const id
    of evidenceIds
  ) {
    if (
      !EVIDENCE_ID_RE.test(id)
    ) {
      throw new Error(
        'WORK_ORDER_EVIDENCE_ID_INVALID',
      );
    }
  }

  if (
    new Set(evidenceIds).size !==
    evidenceIds.length
  ) {
    throw new Error(
      'WORK_ORDER_EVIDENCE_DUPLICATE',
    );
  }

  return Object.freeze({
    schemaVersion:
      PROVIDER_WORK_ORDER_SCHEMA,

    jobId:
      input.jobId,

    baseline:
      input.baseline,

    task:
      input.task,

    evidenceIds:
      Object.freeze(
        evidenceIds,
      ),

    affinity:
      input.affinity,
  });
}

function freezeRecord(
  record: ProviderWorkRecord,
): ProviderWorkRecord {
  const order =
    Object.freeze({
      ...record.order,

      evidenceIds:
        Object.freeze([
          ...record.order
            .evidenceIds,
        ]),
    });

  const lease =
    record.lease === null
      ? null
      : Object.freeze({
          ...record.lease,
        });

  return Object.freeze({
    ...record,
    order,
    lease,
  });
}

export function createProviderWorkRecord(
  order: ProviderWorkOrder,
  nowMs: number,
): ProviderWorkRecord {
  if (!validTimestamp(nowMs)) {
    throw new Error(
      'WORK_RECORD_TIME_INVALID',
    );
  }

  /*
   * Reconstruct through the validated constructor.
   * Serialized caller objects cannot silently
   * introduce extra semantics.
   */
  const checked =
    createProviderWorkOrder({
      jobId:
        order.jobId,

      baseline:
        order.baseline,

      task:
        order.task,

      evidenceIds:
        order.evidenceIds,

      affinity:
        order.affinity,
    });

  return freezeRecord({
    schemaVersion:
      PROVIDER_WORK_RECORD_SCHEMA,

    order:
      checked,

    state:
      'PENDING',

    attempts:
      0,

    lease:
      null,

    lastOutcome:
      null,

    fingerprint:
      null,

    recoveryHoldReason:
      null,

    createdAtMs:
      nowMs,

    updatedAtMs:
      nowMs,
  });
}

function validateLease(
  lease: unknown,
  attempts: number,
  order: ProviderWorkOrder,
): ProviderWorkLease | null {
  if (lease === null) {
    return null;
  }

  if (
    !isRecord(lease) ||
    !exactKeys(
      lease,
      [
        'leaseId',
        'provider',
        'slotId',
        'attempt',
        'leasedAtMs',
        'expiresAtMs',
      ],
    )
  ) {
    throw new Error(
      'WORK_RECORD_LEASE_INVALID',
    );
  }

  if (
    typeof lease.leaseId !==
      'string' ||
    !SHA64_RE.test(
      lease.leaseId,
    ) ||
    (
      lease.provider !==
        'codex' &&
      lease.provider !==
        'antigravity'
    ) ||
    typeof lease.slotId !==
      'string' ||
    !SLOT_ID_RE.test(
      lease.slotId,
    ) ||
    !validCounter(
      lease.attempt,
    ) ||
    lease.attempt !==
      attempts ||
    !validTimestamp(
      lease.leasedAtMs,
    ) ||
    !validTimestamp(
      lease.expiresAtMs,
    ) ||
    lease.expiresAtMs <=
      lease.leasedAtMs ||
    !providerAllowed(
      order.affinity,
      lease.provider,
    )
  ) {
    throw new Error(
      'WORK_RECORD_LEASE_INVALID',
    );
  }

  return Object.freeze({
    leaseId:
      lease.leaseId,

    provider:
      lease.provider,

    slotId:
      lease.slotId,

    attempt:
      lease.attempt,

    leasedAtMs:
      lease.leasedAtMs,

    expiresAtMs:
      lease.expiresAtMs,
  });
}

export function parseProviderWorkRecord(
  raw: string,
): ProviderWorkRecord {
  if (
    !boundedText(
      raw,
      65_536,
    )
  ) {
    throw new Error(
      'WORK_RECORD_RAW_INVALID',
    );
  }

  let parsed: unknown;

  try {
    parsed =
      JSON.parse(raw);
  } catch {
    throw new Error(
      'WORK_RECORD_JSON_INVALID',
    );
  }

  if (
    !isRecord(parsed) ||
    !exactKeys(
      parsed,
      [
        'schemaVersion',
        'order',
        'state',
        'attempts',
        'lease',
        'lastOutcome',
        'fingerprint',
        'recoveryHoldReason',
        'createdAtMs',
        'updatedAtMs',
      ],
    ) ||
    parsed.schemaVersion !==
      PROVIDER_WORK_RECORD_SCHEMA
  ) {
    throw new Error(
      'WORK_RECORD_SCHEMA_INVALID',
    );
  }

  if (
    !isRecord(parsed.order) ||
    !exactKeys(
      parsed.order,
      [
        'schemaVersion',
        'jobId',
        'baseline',
        'task',
        'evidenceIds',
        'affinity',
      ],
    ) ||
    parsed.order.schemaVersion !==
      PROVIDER_WORK_ORDER_SCHEMA
  ) {
    throw new Error(
      'WORK_RECORD_ORDER_INVALID',
    );
  }

  const order =
    createProviderWorkOrder({
      jobId:
        String(
          parsed.order.jobId,
        ),

      baseline:
        String(
          parsed.order.baseline,
        ),

      task:
        String(
          parsed.order.task,
        ),

      evidenceIds:
        Array.isArray(
          parsed.order.evidenceIds,
        )
          ? parsed.order
              .evidenceIds
              .map(String)
          : [],

      affinity:
        parsed.order.affinity as
          ProviderAffinity,
    });

  if (
    !validCounter(
      parsed.attempts,
    ) ||
    !validTimestamp(
      parsed.createdAtMs,
    ) ||
    !validTimestamp(
      parsed.updatedAtMs,
    ) ||
    parsed.updatedAtMs <
      parsed.createdAtMs
  ) {
    throw new Error(
      'WORK_RECORD_COUNTER_INVALID',
    );
  }

  const state =
    parsed.state;

  if (
    state !== 'PENDING' &&
    state !== 'LEASED' &&
    state !== 'USEFUL_COMPLETE' &&
    state !== 'BLOCKED' &&
    state !== 'QUALITY_HOLD' &&
    state !== 'RECOVERY_HOLD'
  ) {
    throw new Error(
      'WORK_RECORD_STATE_INVALID',
    );
  }

  const lease =
    validateLease(
      parsed.lease,
      parsed.attempts,
      order,
    );

  const lastOutcome =
    parsed.lastOutcome === null
      ? null
      : parsed.lastOutcome;

  if (
    lastOutcome !== null &&
    !WORK_OUTCOMES.has(
      lastOutcome as
        WorkOutcome,
    )
  ) {
    throw new Error(
      'WORK_RECORD_OUTCOME_INVALID',
    );
  }

  const fingerprint =
    parsed.fingerprint;

  if (
    fingerprint !== null &&
    (
      typeof fingerprint !==
        'string' ||
      !SHA64_RE.test(
        fingerprint,
      )
    )
  ) {
    throw new Error(
      'WORK_RECORD_FINGERPRINT_INVALID',
    );
  }

  const recoveryHoldReason =
    parsed.recoveryHoldReason;

  if (
    recoveryHoldReason !== null &&
    recoveryHoldReason !==
      'TRANSPORT_FAILURE' &&
    recoveryHoldReason !==
      'LEASE_EXPIRED'
  ) {
    throw new Error(
      'WORK_RECORD_RECOVERY_REASON_INVALID',
    );
  }

  /*
   * State invariants.
   */
  if (
    state === 'PENDING'
  ) {
    if (
      lease !== null ||
      lastOutcome !== null ||
      fingerprint !== null ||
      recoveryHoldReason !== null
    ) {
      throw new Error(
        'WORK_RECORD_PENDING_INVALID',
      );
    }
  }

  if (
    state === 'LEASED'
  ) {
    if (
      lease === null ||
      lastOutcome !== null ||
      fingerprint !== null ||
      recoveryHoldReason !== null
    ) {
      throw new Error(
        'WORK_RECORD_LEASED_INVALID',
      );
    }
  }

  if (
    state ===
      'USEFUL_COMPLETE'
  ) {
    if (
      lease !== null ||
      lastOutcome !==
        'USEFUL_UNIQUE' ||
      typeof fingerprint !==
        'string' ||
      recoveryHoldReason !== null
    ) {
      throw new Error(
        'WORK_RECORD_COMPLETE_INVALID',
      );
    }
  }

  if (
    state === 'BLOCKED'
  ) {
    if (
      lease !== null ||
      lastOutcome !==
        'BLOCKED' ||
      fingerprint !== null ||
      recoveryHoldReason !== null
    ) {
      throw new Error(
        'WORK_RECORD_BLOCKED_INVALID',
      );
    }
  }

  if (
    state ===
      'QUALITY_HOLD'
  ) {
    const qualityOutcome =
      lastOutcome ===
        'PROTOCOL_REJECTED' ||
      lastOutcome ===
        'CONTRACT_REJECTED' ||
      lastOutcome ===
        'USEFUL_DUPLICATE';

    if (
      lease !== null ||
      !qualityOutcome ||
      recoveryHoldReason !== null ||
      (
        lastOutcome ===
          'USEFUL_DUPLICATE'
          ? typeof fingerprint !==
              'string'
          : fingerprint !== null
      )
    ) {
      throw new Error(
        'WORK_RECORD_QUALITY_HOLD_INVALID',
      );
    }
  }

  if (
    state ===
      'RECOVERY_HOLD'
  ) {
    const transport =
      lastOutcome ===
        'TRANSPORT_FAILURE' &&
      recoveryHoldReason ===
        'TRANSPORT_FAILURE';

    const expired =
      lastOutcome === null &&
      recoveryHoldReason ===
        'LEASE_EXPIRED';

    if (
      lease !== null ||
      fingerprint !== null ||
      (!transport &&
       !expired)
    ) {
      throw new Error(
        'WORK_RECORD_RECOVERY_HOLD_INVALID',
      );
    }
  }

  return freezeRecord({
    schemaVersion:
      PROVIDER_WORK_RECORD_SCHEMA,

    order,

    state,

    attempts:
      parsed.attempts,

    lease,

    lastOutcome:
      lastOutcome as
        WorkOutcome | null,

    fingerprint:
      fingerprint as
        string | null,

    recoveryHoldReason:
      recoveryHoldReason as
        RecoveryHoldReason | null,

    createdAtMs:
      parsed.createdAtMs,

    updatedAtMs:
      parsed.updatedAtMs,
  });
}

export function serializeProviderWorkRecord(
  record: ProviderWorkRecord,
): string {
  /*
   * Re-validate before persistence.
   */
  const checked =
    parseProviderWorkRecord(
      JSON.stringify(record),
    );

  return JSON.stringify(
    checked,
  );
}

export function claimProviderWork(
  record: ProviderWorkRecord,
  provider: Provider,
  slotId: string,
  nowMs: number,
  leaseDurationMs: number,
): ProviderWorkRecord {
  const checked =
    parseProviderWorkRecord(
      JSON.stringify(record),
    );

  if (
    checked.state !==
      'PENDING'
  ) {
    throw new Error(
      'WORK_NOT_PENDING',
    );
  }

  if (
    !providerAllowed(
      checked.order.affinity,
      provider,
    )
  ) {
    throw new Error(
      'WORK_PROVIDER_NOT_ALLOWED',
    );
  }

  if (
    !SLOT_ID_RE.test(
      slotId,
    )
  ) {
    throw new Error(
      'WORK_SLOT_INVALID',
    );
  }

  if (
    !validTimestamp(
      nowMs,
    ) ||
    !Number.isSafeInteger(
      leaseDurationMs,
    ) ||
    leaseDurationMs <
      MIN_LEASE_MS ||
    leaseDurationMs >
      MAX_LEASE_MS
  ) {
    throw new Error(
      'WORK_LEASE_TIME_INVALID',
    );
  }

  const attempt =
    checked.attempts + 1;

  const expiresAtMs =
    nowMs +
    leaseDurationMs;

  const leaseId =
    sha256(
      JSON.stringify({
        schema:
          'VELNAR_PROVIDER_LEASE_V1',

        jobId:
          checked.order.jobId,

        provider,
        slotId,
        attempt,
        nowMs,
        expiresAtMs,
      }),
    );

  return freezeRecord({
    ...checked,

    state:
      'LEASED',

    attempts:
      attempt,

    lease:
      Object.freeze({
        leaseId,
        provider,
        slotId,
        attempt,
        leasedAtMs:
          nowMs,
        expiresAtMs,
      }),

    updatedAtMs:
      nowMs,
  });
}

export function settleProviderWork(
  record: ProviderWorkRecord,
  provider: Provider,
  leaseId: string,
  outcome: WorkOutcome,
  fingerprint: string | null,
  nowMs: number,
): ProviderWorkRecord {
  const checked =
    parseProviderWorkRecord(
      JSON.stringify(record),
    );

  if (
    checked.state !==
      'LEASED' ||
    checked.lease === null
  ) {
    throw new Error(
      'WORK_NOT_LEASED',
    );
  }

  if (
    checked.lease.provider !==
      provider ||
    checked.lease.leaseId !==
      leaseId
  ) {
    throw new Error(
      'WORK_LEASE_MISMATCH',
    );
  }

  if (
    !validTimestamp(
      nowMs,
    ) ||
    nowMs <
      checked.lease.leasedAtMs
  ) {
    throw new Error(
      'WORK_SETTLE_TIME_INVALID',
    );
  }

  /*
   * Late provider output is not accepted.
   * It may correspond to a lease already considered lost.
   */
  if (
    nowMs >
      checked.lease.expiresAtMs
  ) {
    throw new Error(
      'WORK_LEASE_EXPIRED',
    );
  }

  if (
    !WORK_OUTCOMES.has(
      outcome,
    )
  ) {
    throw new Error(
      'WORK_OUTCOME_INVALID',
    );
  }

  const requireFingerprint =
    outcome ===
      'USEFUL_UNIQUE' ||
    outcome ===
      'USEFUL_DUPLICATE';

  if (
    requireFingerprint
      ? (
          typeof fingerprint !==
            'string' ||
          !SHA64_RE.test(
            fingerprint,
          )
        )
      : fingerprint !== null
  ) {
    throw new Error(
      'WORK_FINGERPRINT_INVALID',
    );
  }

  let state:
    ProviderWorkState;

  let recoveryHoldReason:
    RecoveryHoldReason | null =
      null;

  switch (outcome) {
    case 'USEFUL_UNIQUE':
      state =
        'USEFUL_COMPLETE';
      break;

    case 'BLOCKED':
      state =
        'BLOCKED';
      break;

    case 'PROTOCOL_REJECTED':
    case 'CONTRACT_REJECTED':
    case 'USEFUL_DUPLICATE':
      state =
        'QUALITY_HOLD';
      break;

    case 'TRANSPORT_FAILURE':
      state =
        'RECOVERY_HOLD';

      recoveryHoldReason =
        'TRANSPORT_FAILURE';
      break;
  }

  return freezeRecord({
    ...checked,

    state,

    lease:
      null,

    lastOutcome:
      outcome,

    fingerprint:
      requireFingerprint
        ? fingerprint
        : null,

    recoveryHoldReason,

    updatedAtMs:
      nowMs,
  });
}

export function expireProviderLease(
  record: ProviderWorkRecord,
  nowMs: number,
): ProviderWorkRecord {
  const checked =
    parseProviderWorkRecord(
      JSON.stringify(record),
    );

  if (
    checked.state !==
      'LEASED' ||
    checked.lease === null
  ) {
    throw new Error(
      'WORK_NOT_LEASED',
    );
  }

  if (
    !validTimestamp(
      nowMs,
    ) ||
    nowMs <
      checked.lease.expiresAtMs
  ) {
    throw new Error(
      'WORK_LEASE_NOT_EXPIRED',
    );
  }

  /*
   * Critical anti-waste behavior:
   *
   * expired lease DOES NOT automatically return to
   * PENDING. We cannot prove whether the provider call
   * consumed quota before the worker disappeared.
   */
  return freezeRecord({
    ...checked,

    state:
      'RECOVERY_HOLD',

    lease:
      null,

    lastOutcome:
      null,

    fingerprint:
      null,

    recoveryHoldReason:
      'LEASE_EXPIRED',

    updatedAtMs:
      nowMs,
  });
}

export function countsAsCompletedBacklog(
  record: ProviderWorkRecord,
): boolean {
  return (
    record.state ===
      'USEFUL_COMPLETE' &&
    record.lastOutcome ===
      'USEFUL_UNIQUE'
  );
}

export function requiresOperatorReview(
  record: ProviderWorkRecord,
): boolean {
  return (
    record.state ===
      'BLOCKED' ||
    record.state ===
      'QUALITY_HOLD' ||
    record.state ===
      'RECOVERY_HOLD'
  );
}

export function isAutomaticallyLeaseable(
  record: ProviderWorkRecord,
): boolean {
  return (
    record.state ===
    'PENDING'
  );
}
