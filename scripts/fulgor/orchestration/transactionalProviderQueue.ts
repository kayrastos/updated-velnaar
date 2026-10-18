import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
} from 'node:fs';

import {
  dirname,
  isAbsolute,
  resolve,
} from 'node:path';

import {
  DatabaseSync,
} from 'node:sqlite';

import type {
  Provider,
} from '../scheduler/verified8x8Scheduler';

import type {
  WorkOutcome,
} from './providerWorkAccounting';

import {
  claimProviderWork,
  createProviderWorkRecord,
  expireProviderLease,
  parseProviderWorkRecord,
  serializeProviderWorkRecord,
  settleProviderWork,
  type ProviderWorkOrder,
  type ProviderWorkRecord,
} from './providerWorkOrder';

export const TRANSACTIONAL_PROVIDER_QUEUE_SCHEMA =
  'VELNAR_TRANSACTIONAL_PROVIDER_QUEUE_V1' as const;

const REQUIRED_OBJECTS =
  Object.freeze([
    'jobs',
    'idx_jobs_pending',
    'idx_jobs_lease_expiry',
    'ux_jobs_active_slot',
    'ux_jobs_active_lease',
  ]);

type DbRow =
  Record<string, unknown>;

function requireRow(
  value: unknown,
  name: string,
): DbRow {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new Error(
      `QUEUE_${name}_INVALID`,
    );
  }

  return value as DbRow;
}

function asString(
  value: unknown,
  name: string,
): string {
  if (typeof value !== 'string') {
    throw new Error(
      `QUEUE_${name}_INVALID`,
    );
  }

  return value;
}

function asNullableString(
  value: unknown,
  name: string,
): string | null {
  if (value === null) {
    return null;
  }

  return asString(
    value,
    name,
  );
}

function asNumber(
  value: unknown,
  name: string,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value)
  ) {
    throw new Error(
      `QUEUE_${name}_INVALID`,
    );
  }

  return value;
}

function asNullableNumber(
  value: unknown,
  name: string,
): number | null {
  if (value === null) {
    return null;
  }

  return asNumber(
    value,
    name,
  );
}

function providerOrNull(
  value: unknown,
): Provider | null {
  if (value === null) {
    return null;
  }

  if (
    value !== 'codex' &&
    value !== 'antigravity'
  ) {
    throw new Error(
      'QUEUE_ASSIGNED_PROVIDER_INVALID',
    );
  }

  return value;
}

function journalValue(
  row: unknown,
): string {
  const value =
    requireRow(
      row,
      'JOURNAL_ROW',
    );

  const first =
    Object.values(value)[0];

  return String(first ?? '');
}

export class TransactionalProviderQueue {
  readonly dbPath: string;

  private readonly db:
    DatabaseSync;

  constructor(
    dbPath: string,
  ) {
    if (!isAbsolute(dbPath)) {
      throw new Error(
        'QUEUE_PATH_MUST_BE_ABSOLUTE',
      );
    }

    this.dbPath =
      resolve(dbPath);

    const parent =
      dirname(this.dbPath);

    mkdirSync(
      parent,
      {
        recursive: true,
        mode: 0o700,
      },
    );

    const parentStat =
      lstatSync(parent);

    if (
      !parentStat.isDirectory() ||
      parentStat.isSymbolicLink()
    ) {
      throw new Error(
        'QUEUE_PARENT_UNSAFE',
      );
    }

    if (
      existsSync(this.dbPath)
    ) {
      const stat =
        lstatSync(
          this.dbPath,
        );

      if (
        !stat.isFile() ||
        stat.isSymbolicLink()
      ) {
        throw new Error(
          'QUEUE_DB_PATH_UNSAFE',
        );
      }
    }

    this.db =
      new DatabaseSync(
        this.dbPath,
      );

    chmodSync(
      this.dbPath,
      0o600,
    );

    this.configure();

    this.initializeSchema();
  }

  private configure(): void {
    const journal =
      this.db
        .prepare(
          'PRAGMA journal_mode=WAL',
        )
        .get();

    if (
      journalValue(journal)
        .toLowerCase() !== 'wal'
    ) {
      throw new Error(
        'QUEUE_WAL_UNAVAILABLE',
      );
    }

    this.db.exec(`
      PRAGMA synchronous=FULL;
      PRAGMA foreign_keys=ON;
      PRAGMA busy_timeout=5000;
    `);
  }

  private transaction<T>(
    fn: () => T,
  ): T {
    this.db.exec(
      'BEGIN IMMEDIATE',
    );

    try {
      const result = fn();

      this.db.exec(
        'COMMIT',
      );

      return result;
    } catch (error) {
      try {
        this.db.exec(
          'ROLLBACK',
        );
      } catch {
        /*
         * Never mask the primary error.
         */
      }

      throw error;
    }
  }

  private initializeSchema():
  void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS queue_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    const schemaRow =
      this.db
        .prepare(`
          SELECT value
          FROM queue_meta
          WHERE key = 'schema'
        `)
        .get();

    const existingJobs =
      this.db
        .prepare(`
          SELECT name
          FROM sqlite_master
          WHERE
            type = 'table'
            AND name = 'jobs'
        `)
        .get();

    if (!schemaRow) {
      if (existingJobs) {
        throw new Error(
          'QUEUE_UNVERSIONED_EXISTING_SCHEMA',
        );
      }

      this.transaction(
        () => {
          this.db.exec(`
            CREATE TABLE jobs (
              job_id TEXT
                PRIMARY KEY,

              affinity TEXT
                NOT NULL
                CHECK(
                  affinity IN (
                    'codex',
                    'antigravity',
                    'either'
                  )
                ),

              state TEXT
                NOT NULL
                CHECK(
                  state IN (
                    'PENDING',
                    'LEASED',
                    'USEFUL_COMPLETE',
                    'BLOCKED',
                    'QUALITY_HOLD',
                    'RECOVERY_HOLD'
                  )
                ),

              assigned_provider TEXT
                CHECK(
                  assigned_provider IS NULL
                  OR
                  assigned_provider IN (
                    'codex',
                    'antigravity'
                  )
                ),

              slot_id TEXT,
              lease_id TEXT,

              lease_expires_at_ms INTEGER,

              created_seq INTEGER
                NOT NULL
                UNIQUE,

              updated_ms INTEGER
                NOT NULL,

              record_json TEXT
                NOT NULL,

              CHECK(
                (
                  state = 'LEASED'
                  AND
                  assigned_provider IS NOT NULL
                  AND
                  slot_id IS NOT NULL
                  AND
                  lease_id IS NOT NULL
                  AND
                  lease_expires_at_ms IS NOT NULL
                )
                OR
                (
                  state <> 'LEASED'
                  AND
                  assigned_provider IS NULL
                  AND
                  slot_id IS NULL
                  AND
                  lease_id IS NULL
                  AND
                  lease_expires_at_ms IS NULL
                )
              )
            );

            CREATE INDEX
              idx_jobs_pending
            ON jobs(
              state,
              affinity,
              created_seq
            );

            CREATE INDEX
              idx_jobs_lease_expiry
            ON jobs(
              state,
              lease_expires_at_ms
            );

            CREATE UNIQUE INDEX
              ux_jobs_active_slot
            ON jobs(
              assigned_provider,
              slot_id
            )
            WHERE
              state = 'LEASED';

            CREATE UNIQUE INDEX
              ux_jobs_active_lease
            ON jobs(
              lease_id
            )
            WHERE
              lease_id IS NOT NULL;
          `);

          this.db
            .prepare(`
              INSERT INTO queue_meta(
                key,
                value
              )
              VALUES(
                'schema',
                ?
              )
            `)
            .run(
              TRANSACTIONAL_PROVIDER_QUEUE_SCHEMA,
            );
        },
      );
    } else {
      const schema =
        asString(
          requireRow(
            schemaRow,
            'SCHEMA_ROW',
          ).value,
          'SCHEMA_VALUE',
        );

      if (
        schema !==
        TRANSACTIONAL_PROVIDER_QUEUE_SCHEMA
      ) {
        throw new Error(
          'QUEUE_SCHEMA_VERSION_MISMATCH',
        );
      }

      const objects =
        this.db
          .prepare(`
            SELECT name
            FROM sqlite_master
            WHERE name IN (
              'jobs',
              'idx_jobs_pending',
              'idx_jobs_lease_expiry',
              'ux_jobs_active_slot',
              'ux_jobs_active_lease'
            )
          `)
          .all()
          .map(
            row =>
              asString(
                requireRow(
                  row,
                  'OBJECT_ROW',
                ).name,
                'OBJECT_NAME',
              ),
          );

      const found =
        new Set(objects);

      for (
        const required
        of REQUIRED_OBJECTS
      ) {
        if (!found.has(required)) {
          throw new Error(
            `QUEUE_REQUIRED_OBJECT_MISSING=${required}`,
          );
        }
      }
    }
  }

  private indexedFields(
    record:
      ProviderWorkRecord,
  ): {
    state: string;
    assignedProvider:
      Provider | null;
    slotId: string | null;
    leaseId: string | null;
    expiresAtMs: number | null;
  } {
    if (
      record.state ===
      'LEASED'
    ) {
      if (record.lease === null) {
        throw new Error(
          'QUEUE_DOMAIN_LEASE_MISSING',
        );
      }

      return {
        state:
          record.state,

        assignedProvider:
          record.lease.provider,

        slotId:
          record.lease.slotId,

        leaseId:
          record.lease.leaseId,

        expiresAtMs:
          record.lease.expiresAtMs,
      };
    }

    return {
      state:
        record.state,

      assignedProvider: null,
      slotId: null,
      leaseId: null,
      expiresAtMs: null,
    };
  }

  private parsePersistedRow(
    rowValue: unknown,
  ): ProviderWorkRecord {
    const row =
      requireRow(
        rowValue,
        'JOB_ROW',
      );

    const record =
      parseProviderWorkRecord(
        asString(
          row.record_json,
          'RECORD_JSON',
        ),
      );

    const indexed =
      this.indexedFields(
        record,
      );

    const rowJobId =
      asString(
        row.job_id,
        'JOB_ID',
      );

    const rowAffinity =
      asString(
        row.affinity,
        'AFFINITY',
      );

    const rowState =
      asString(
        row.state,
        'STATE',
      );

    const rowProvider =
      providerOrNull(
        row.assigned_provider,
      );

    const rowSlot =
      asNullableString(
        row.slot_id,
        'SLOT_ID',
      );

    const rowLease =
      asNullableString(
        row.lease_id,
        'LEASE_ID',
      );

    const rowExpires =
      asNullableNumber(
        row.lease_expires_at_ms,
        'LEASE_EXPIRES',
      );

    const rowUpdated =
      asNumber(
        row.updated_ms,
        'UPDATED_MS',
      );

    if (
      rowJobId !==
        record.order.jobId ||

      rowAffinity !==
        record.order.affinity ||

      rowState !==
        indexed.state ||

      rowProvider !==
        indexed.assignedProvider ||

      rowSlot !==
        indexed.slotId ||

      rowLease !==
        indexed.leaseId ||

      rowExpires !==
        indexed.expiresAtMs ||

      rowUpdated !==
        record.updatedAtMs
    ) {
      throw new Error(
        'QUEUE_ROW_RECORD_MISMATCH',
      );
    }

    return record;
  }

  enqueue(
    order:
      ProviderWorkOrder,

    nowMs: number,
  ): ProviderWorkRecord {
    return this.transaction(
      () => {
        const existing =
          this.db
            .prepare(`
              SELECT job_id
              FROM jobs
              WHERE job_id = ?
            `)
            .get(
              order.jobId,
            );

        if (existing) {
          throw new Error(
            'QUEUE_JOB_ALREADY_EXISTS',
          );
        }

        const sequenceRow =
          requireRow(
            this.db
              .prepare(`
                SELECT
                  COALESCE(
                    MAX(created_seq),
                    0
                  ) + 1
                  AS next_seq
                FROM jobs
              `)
              .get(),
            'SEQUENCE_ROW',
          );

        const sequence =
          asNumber(
            sequenceRow.next_seq,
            'SEQUENCE',
          );

        const record =
          createProviderWorkRecord(
            order,
            nowMs,
          );

        this.db
          .prepare(`
            INSERT INTO jobs(
              job_id,
              affinity,
              state,
              assigned_provider,
              slot_id,
              lease_id,
              lease_expires_at_ms,
              created_seq,
              updated_ms,
              record_json
            )
            VALUES(
              ?,
              ?,
              'PENDING',
              NULL,
              NULL,
              NULL,
              NULL,
              ?,
              ?,
              ?
            )
          `)
          .run(
            record.order.jobId,
            record.order.affinity,
            sequence,
            record.updatedAtMs,
            serializeProviderWorkRecord(
              record,
            ),
          );

        return record;
      },
    );
  }

  get(
    jobId: string,
  ): ProviderWorkRecord | null {
    const row =
      this.db
        .prepare(`
          SELECT *
          FROM jobs
          WHERE job_id = ?
        `)
        .get(jobId);

    if (!row) {
      return null;
    }

    return this.parsePersistedRow(
      row,
    );
  }

  claimNext(
    provider: Provider,
    slotId: string,
    nowMs: number,
    leaseDurationMs: number,
  ): ProviderWorkRecord | null {
    return this.transaction(
      () => {
        /*
         * An active slot may own exactly one job.
         */
        const occupied =
          this.db
            .prepare(`
              SELECT job_id
              FROM jobs
              WHERE
                state = 'LEASED'
                AND assigned_provider = ?
                AND slot_id = ?
              LIMIT 1
            `)
            .get(
              provider,
              slotId,
            );

        if (occupied) {
          throw new Error(
            'QUEUE_SLOT_ALREADY_LEASED',
          );
        }

        const row =
          this.db
            .prepare(`
              SELECT *
              FROM jobs
              WHERE
                state = 'PENDING'
                AND (
                  affinity = ?
                  OR
                  affinity = 'either'
                )
              ORDER BY
                created_seq
              LIMIT 1
            `)
            .get(provider);

        if (!row) {
          return null;
        }

        const current =
          this.parsePersistedRow(
            row,
          );

        const leased =
          claimProviderWork(
            current,
            provider,
            slotId,
            nowMs,
            leaseDurationMs,
          );

        const indexed =
          this.indexedFields(
            leased,
          );

        const result =
          this.db
            .prepare(`
              UPDATE jobs
              SET
                state = ?,
                assigned_provider = ?,
                slot_id = ?,
                lease_id = ?,
                lease_expires_at_ms = ?,
                updated_ms = ?,
                record_json = ?
              WHERE
                job_id = ?
                AND state = 'PENDING'
            `)
            .run(
              indexed.state,
              indexed.assignedProvider,
              indexed.slotId,
              indexed.leaseId,
              indexed.expiresAtMs,
              leased.updatedAtMs,
              serializeProviderWorkRecord(
                leased,
              ),
              leased.order.jobId,
            );

        if (
          Number(
            result.changes,
          ) !== 1
        ) {
          throw new Error(
            'QUEUE_ATOMIC_CLAIM_LOST',
          );
        }

        return leased;
      },
    );
  }

  settle(
    provider: Provider,
    leaseId: string,
    outcome: WorkOutcome,
    fingerprint: string | null,
    nowMs: number,
  ): ProviderWorkRecord {
    return this.transaction(
      () => {
        const row =
          this.db
            .prepare(`
              SELECT *
              FROM jobs
              WHERE
                state = 'LEASED'
                AND lease_id = ?
              LIMIT 1
            `)
            .get(
              leaseId,
            );

        if (!row) {
          throw new Error(
            'QUEUE_ACTIVE_LEASE_NOT_FOUND',
          );
        }

        const current =
          this.parsePersistedRow(
            row,
          );

        const settled =
          settleProviderWork(
            current,
            provider,
            leaseId,
            outcome,
            fingerprint,
            nowMs,
          );

        const indexed =
          this.indexedFields(
            settled,
          );

        const result =
          this.db
            .prepare(`
              UPDATE jobs
              SET
                state = ?,
                assigned_provider = NULL,
                slot_id = NULL,
                lease_id = NULL,
                lease_expires_at_ms = NULL,
                updated_ms = ?,
                record_json = ?
              WHERE
                job_id = ?
                AND state = 'LEASED'
                AND lease_id = ?
            `)
            .run(
              indexed.state,
              settled.updatedAtMs,
              serializeProviderWorkRecord(
                settled,
              ),
              settled.order.jobId,
              leaseId,
            );

        if (
          Number(
            result.changes,
          ) !== 1
        ) {
          throw new Error(
            'QUEUE_ATOMIC_SETTLE_LOST',
          );
        }

        return settled;
      },
    );
  }

  expireDueLeases(
    nowMs: number,
    limit = 256,
  ): ProviderWorkRecord[] {
    if (
      !Number.isSafeInteger(
        limit,
      ) ||
      limit < 1 ||
      limit > 1024
    ) {
      throw new Error(
        'QUEUE_EXPIRY_LIMIT_INVALID',
      );
    }

    return this.transaction(
      () => {
        const rows =
          this.db
            .prepare(`
              SELECT *
              FROM jobs
              WHERE
                state = 'LEASED'
                AND lease_expires_at_ms <= ?
              ORDER BY
                lease_expires_at_ms,
                created_seq
              LIMIT ?
            `)
            .all(
              nowMs,
              limit,
            );

        const expired:
          ProviderWorkRecord[] = [];

        for (
          const row
          of rows
        ) {
          const current =
            this.parsePersistedRow(
              row,
            );

          const held =
            expireProviderLease(
              current,
              nowMs,
            );

          const result =
            this.db
              .prepare(`
                UPDATE jobs
                SET
                  state = 'RECOVERY_HOLD',
                  assigned_provider = NULL,
                  slot_id = NULL,
                  lease_id = NULL,
                  lease_expires_at_ms = NULL,
                  updated_ms = ?,
                  record_json = ?
                WHERE
                  job_id = ?
                  AND state = 'LEASED'
                  AND lease_id = ?
              `)
              .run(
                held.updatedAtMs,
                serializeProviderWorkRecord(
                  held,
                ),
                held.order.jobId,
                current.lease!.leaseId,
              );

          if (
            Number(
              result.changes,
            ) !== 1
          ) {
            throw new Error(
              'QUEUE_ATOMIC_EXPIRY_LOST',
            );
          }

          expired.push(
            held,
          );
        }

        return expired;
      },
    );
  }

  stateCounts():
  Readonly<Record<string, number>> {
    const rows =
      this.db
        .prepare(`
          SELECT
            state,
            COUNT(*) AS count
          FROM jobs
          GROUP BY state
          ORDER BY state
        `)
        .all();

    const result:
      Record<string, number> = {};

    for (
      const rowValue
      of rows
    ) {
      const row =
        requireRow(
          rowValue,
          'COUNT_ROW',
        );

      result[
        asString(
          row.state,
          'COUNT_STATE',
        )
      ] =
        asNumber(
          row.count,
          'COUNT_VALUE',
        );
    }

    return Object.freeze(
      result,
    );
  }

  pendingFor(
    provider: Provider,
  ): number {
    const row =
      requireRow(
        this.db
          .prepare(`
            SELECT
              COUNT(*) AS count
            FROM jobs
            WHERE
              state = 'PENDING'
              AND (
                affinity = ?
                OR
                affinity = 'either'
              )
          `)
          .get(provider),
        'PENDING_COUNT_ROW',
      );

    return asNumber(
      row.count,
      'PENDING_COUNT',
    );
  }

  integrityCheck(): boolean {
    const row =
      this.db
        .prepare(
          'PRAGMA integrity_check',
        )
        .get();

    return (
      journalValue(row)
        .toLowerCase() ===
      'ok'
    );
  }

  close(): void {
    this.db.close();
  }
}
