import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readdirSync,
} from 'node:fs';

import {
  join,
} from 'node:path';

import {
  DatabaseSync,
} from 'node:sqlite';

import type {
  HostTaskClassOutcomeRecord,
} from '../scheduler/providerTaskClassEvidenceLedger';

import {
  ProviderTaskClassEvidenceStore,
} from '../scheduler/providerTaskClassEvidenceStore';

import type {
  DurableProviderTaskClassOutcome,
} from './transactionalProviderQueue';

import {
  TRANSACTIONAL_PROVIDER_QUEUE_SCHEMA,
  TransactionalProviderQueue,
} from './transactionalProviderQueue';


export const PROVIDER_TASK_CLASS_RECONCILIATION_SCHEMA =
  'VELNAR_PROVIDER_TASK_CLASS_RECONCILIATION_V1' as const;


export interface ProviderTaskClassReconciliationResult {
  readonly schemaVersion:
    typeof PROVIDER_TASK_CLASS_RECONCILIATION_SCHEMA;

  readonly examined:
    number;

  readonly appended:
    number;

  readonly alreadyExact:
    number;
}


function sameOutcome(
  existing:
    HostTaskClassOutcomeRecord,

  candidate:
    DurableProviderTaskClassOutcome,
): boolean {
  return (
    existing.source ===
      'HOST_RUNTIME' &&
    existing.jobId ===
      candidate.jobId &&
    existing.baseline ===
      candidate.baseline &&
    existing.provider ===
      candidate.provider &&
    existing.taskClass ===
      candidate.taskClass &&
    existing.outcome ===
      candidate.outcome &&
    existing.observedAtMs ===
      candidate.observedAtMs
  );
}


function duplicateStoreError(
  error:
    unknown,
): boolean {
  return (
    error instanceof Error &&
    error.message ===
      'TASK_CLASS_EVIDENCE_STORE_JOB_ALREADY_RECORDED'
  );
}


/*
 * Queue V6 owns the authoritative durable tuple:
 *
 *   jobId
 *   baseline
 *   provider
 *   taskClass
 *   terminal outcome
 *   observedAtMs
 *
 * The sidecar store is only a derived projection.
 *
 * Reconciliation intentionally has two phases:
 *
 * 1. validate ALL existing rows and baselines;
 * 2. append only genuinely missing exact rows.
 *
 * Therefore a detected mismatch cannot cause new partial
 * projection writes before the process fails closed.
 *
 * If a process dies during phase 2, a later restart sees
 * the already-appended exact subset and resumes safely.
 */
export function reconcileProviderTaskClassEvidence(
  queue:
    TransactionalProviderQueue,

  store:
    ProviderTaskClassEvidenceStore,
): ProviderTaskClassReconciliationResult {
  const durable =
    queue
      .terminalTaskClassOutcomes(
        4096,
      );

  /*
   * LIMIT 4096 must never silently become a complete scan.
   */
  if (
    durable.length >=
      4096
  ) {
    throw new Error(
      'TASK_CLASS_RECONCILIATION_SCAN_LIMIT_REACHED',
    );
  }

  const ledger =
    store.loadLedger();

  const existingByJob =
    new Map(
      ledger.records.map(
        record => [
          record.jobId,
          record,
        ] as const,
      ),
    );

  const missing:
    DurableProviderTaskClassOutcome[] =
      [];

  let alreadyExact =
    0;

  /*
   * PHASE 1 — fail closed before new projection writes.
   */
  for (
    const candidate
    of durable
  ) {
    if (
      candidate.baseline !==
        ledger.baseline
    ) {
      throw new Error(
        'TASK_CLASS_RECONCILIATION_BASELINE_MISMATCH',
      );
    }

    const existing =
      existingByJob.get(
        candidate.jobId,
      );

    if (
      existing ===
        undefined
    ) {
      missing.push(
        candidate,
      );

      continue;
    }

    if (
      !sameOutcome(
        existing,
        candidate,
      )
    ) {
      throw new Error(
        'TASK_CLASS_RECONCILIATION_EXISTING_MISMATCH',
      );
    }

    alreadyExact +=
      1;
  }

  /*
   * PHASE 2 — append missing exact queue facts.
   *
   * The evidence store itself rejects duplicate job IDs.
   * A duplicate observed here can only be accepted if
   * re-reading the store proves that the concurrently
   * persisted row is byte-semantically the same fact.
   */
  let appended =
    0;

  for (
    const candidate
    of missing
  ) {
    try {
      store.appendHostOutcome(
        candidate,
      );

      appended +=
        1;

      continue;
    } catch (
      error
    ) {
      if (
        !duplicateStoreError(
          error,
        )
      ) {
        throw error;
      }

      const refreshed =
        store
          .loadLedger()
          .records
          .find(
            record =>
              record.jobId ===
                candidate.jobId,
          );

      if (
        refreshed ===
          undefined ||
        !sameOutcome(
          refreshed,
          candidate,
        )
      ) {
        throw new Error(
          'TASK_CLASS_RECONCILIATION_DUPLICATE_MISMATCH',
        );
      }

      alreadyExact +=
        1;
    }
  }

  if (
    appended +
      alreadyExact !==
    durable.length
  ) {
    throw new Error(
      'TASK_CLASS_RECONCILIATION_ACCOUNTING_MISMATCH',
    );
  }

  return Object.freeze({
    schemaVersion:
      PROVIDER_TASK_CLASS_RECONCILIATION_SCHEMA,

    examined:
      durable.length,

    appended,

    alreadyExact,
  });
}


export interface ProviderTaskClassQueueRecoveryResult {
  readonly baseline:
    string | null;

  readonly examined:
    number;

  readonly appended:
    number;

  readonly alreadyExact:
    number;
}


export interface ProviderTaskClassStateRecoveryResult {
  readonly scannedRunDirectories:
    number;

  readonly eligibleV6Queues:
    number;

  readonly legacyQueuesSkipped:
    number;

  readonly reconciledQueues:
    number;

  readonly examined:
    number;

  readonly appended:
    number;

  readonly alreadyExact:
    number;
}


function readPersistedQueueSchema(
  queuePath:
    string,
): string {
  let db:
    DatabaseSync;

  try {
    db =
      new DatabaseSync(
        queuePath,
        {
          readOnly:
            true,
        },
      );
  } catch {
    throw new Error(
      'TASK_CLASS_RECOVERY_QUEUE_OPEN_FAILED',
    );
  }

  try {
    const row =
      db
        .prepare(`
          SELECT value
          FROM queue_meta
          WHERE key = 'schema'
          LIMIT 1
        `)
        .get() as
          | {
              value:
                unknown;
            }
          | undefined;

    if (
      row === undefined ||
      typeof row.value !==
        'string'
    ) {
      throw new Error(
        'TASK_CLASS_RECOVERY_QUEUE_SCHEMA_MISSING',
      );
    }

    return row.value;
  } finally {
    db.close();
  }
}


export function reconcileProviderTaskClassEvidenceQueuePath(
  queuePath:
    string,

  evidenceDirectory:
    string,
): ProviderTaskClassQueueRecoveryResult {
  const queue =
    new TransactionalProviderQueue(
      queuePath,
    );

  try {
    const durable =
      queue
        .terminalTaskClassOutcomes(
          4096,
        );

    if (
      durable.length >=
        4096
    ) {
      throw new Error(
        'TASK_CLASS_RECOVERY_QUEUE_SCAN_LIMIT_REACHED',
      );
    }

    if (
      durable.length ===
        0
    ) {
      return Object.freeze({
        baseline:
          null,

        examined:
          0,

        appended:
          0,

        alreadyExact:
          0,
      });
    }

    const baseline =
      durable[0]!.baseline;

    if (
      !/^[0-9a-f]{40}$/i
        .test(
          baseline,
        ) ||
      durable.some(
        candidate =>
          candidate.baseline !==
            baseline,
      )
    ) {
      throw new Error(
        'TASK_CLASS_RECOVERY_QUEUE_BASELINE_INVALID',
      );
    }

    mkdirSync(
      evidenceDirectory,
      {
        recursive:
          true,

        mode:
          0o700,
      },
    );

    chmodSync(
      evidenceDirectory,
      0o700,
    );

    const store =
      new ProviderTaskClassEvidenceStore(
        join(
          evidenceDirectory,
          `${baseline}.sqlite`,
        ),
        baseline,
      );

    try {
      const result =
        reconcileProviderTaskClassEvidence(
          queue,
          store,
        );

      return Object.freeze({
        baseline,

        examined:
          result.examined,

        appended:
          result.appended,

        alreadyExact:
          result.alreadyExact,
      });
    } finally {
      store.close();
    }
  } finally {
    queue.close();
  }
}


/*
 * Startup recovery opens only current V6 queues.
 *
 * Historical V1-V5 queues are inspected read-only and
 * skipped without migration or task-class invention.
 */
export function recoverProviderTaskClassEvidenceStateRoot(
  stateRoot:
    string,
): ProviderTaskClassStateRecoveryResult {
  const evidenceDirectory =
    join(
      stateRoot,
      'task-class-evidence',
    );

  const entries =
    readdirSync(
      stateRoot,
      {
        withFileTypes:
          true,
      },
    )
      .filter(
        entry =>
          entry.isDirectory() &&
          /^live-8x8-[A-Za-z0-9_-]{1,80}$/
            .test(
              entry.name,
            ),
      )
      .sort(
        (
          left,
          right,
        ) =>
          left.name.localeCompare(
            right.name,
          ),
      );

  let scannedRunDirectories =
    0;

  let eligibleV6Queues =
    0;

  let legacyQueuesSkipped =
    0;

  let reconciledQueues =
    0;

  let examined =
    0;

  let appended =
    0;

  let alreadyExact =
    0;

  for (
    const entry
    of entries
  ) {
    scannedRunDirectories +=
      1;

    const queuePath =
      join(
        stateRoot,
        entry.name,
        'queue.sqlite',
      );

    let stat:
      ReturnType<
        typeof lstatSync
      >;

    try {
      stat =
        lstatSync(
          queuePath,
        );
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
        continue;
      }

      throw error;
    }

    if (
      !stat.isFile() ||
      stat.isSymbolicLink()
    ) {
      throw new Error(
        'TASK_CLASS_RECOVERY_QUEUE_FILE_INVALID',
      );
    }

    const getuid =
      process.getuid;

    if (
      getuid !==
        undefined &&
      stat.uid !==
        getuid()
    ) {
      throw new Error(
        'TASK_CLASS_RECOVERY_QUEUE_OWNER_INVALID',
      );
    }

    const schema =
      readPersistedQueueSchema(
        queuePath,
      );

    if (
      /^VELNAR_TRANSACTIONAL_PROVIDER_QUEUE_V[1-5]$/
        .test(
          schema,
        )
    ) {
      legacyQueuesSkipped +=
        1;

      continue;
    }

    if (
      schema !==
        TRANSACTIONAL_PROVIDER_QUEUE_SCHEMA
    ) {
      throw new Error(
        'TASK_CLASS_RECOVERY_QUEUE_SCHEMA_UNEXPECTED',
      );
    }

    eligibleV6Queues +=
      1;

    const result =
      reconcileProviderTaskClassEvidenceQueuePath(
        queuePath,
        evidenceDirectory,
      );

    reconciledQueues +=
      1;

    examined +=
      result.examined;

    appended +=
      result.appended;

    alreadyExact +=
      result.alreadyExact;
  }

  return Object.freeze({
    scannedRunDirectories,
    eligibleV6Queues,
    legacyQueuesSkipped,
    reconciledQueues,
    examined,
    appended,
    alreadyExact,
  });
}

