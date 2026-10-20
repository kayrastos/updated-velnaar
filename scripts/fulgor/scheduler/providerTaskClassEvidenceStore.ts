import { sameRecoveryTransaction, validateRecoveryTransaction } from '../orchestration/taskClassRecoveryTransaction';
import { TASK_CLASS_RECOVERY_SECURITY_SCHEMA, type TaskClassRecoveryHostOutcome, type TaskClassRecoverySecurityMetadata } from '../orchestration/taskClassRecoveryRunner';
import {
  DatabaseSync,
} from 'node:sqlite';

import type {
  WorkOutcome,
} from '../orchestration/providerWorkAccounting';

import type {
  Provider,
} from './verified8x8Scheduler';

import type {
  ProviderTaskClass,
  ProviderTaskLaneEvidence,
} from './providerTaskRouter';

import {
  buildProviderTaskLaneEvidenceFromHostLedger,
  createProviderTaskClassEvidenceLedger,
  recordHostTaskClassOutcome,
  type HostTaskClassOutcomeInput,
  type ProviderTaskClassEvidenceLedger,
  type ProviderTaskClassRuntimeState,
} from './providerTaskClassEvidenceLedger';

export const PROVIDER_TASK_CLASS_EVIDENCE_STORE_SCHEMA =
  'VELNAR_PROVIDER_TASK_CLASS_EVIDENCE_STORE_V1' as const;

interface MetaRow {
  readonly value:
    string;
}

interface EvidenceRow {
  readonly job_id:
    string;

  readonly baseline:
    string;

  readonly provider:
    string;

  readonly task_class:
    string;

  readonly outcome:
    string;

  readonly observed_at_ms:
    number;

  readonly source:
    string;
}

function validBaseline(
  value:
    string,
): boolean {
  return /^[0-9a-f]{40}$/i
    .test(value);
}

export class ProviderTaskClassEvidenceStore {
  readonly #db:
    DatabaseSync;

  readonly #baseline:
    string;

  constructor(
    dbPath:
      string,

    baseline:
      string,
  ) {
    if (
      typeof dbPath !== 'string' ||
      dbPath.length === 0
    ) {
      throw new Error(
        'TASK_CLASS_EVIDENCE_STORE_PATH_INVALID',
      );
    }

    if (!validBaseline(baseline)) {
      throw new Error(
        'TASK_CLASS_EVIDENCE_STORE_BASELINE_INVALID',
      );
    }

    this.#baseline =
      baseline;

    this.#db =
      new DatabaseSync(
        dbPath,
      );

    try {
      this.#db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS
          task_class_evidence_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
          );

        CREATE TABLE IF NOT EXISTS
          task_class_evidence (
            job_id TEXT PRIMARY KEY,

            baseline TEXT NOT NULL,

            provider TEXT NOT NULL
              CHECK (
                provider IN (
                  'codex',
                  'antigravity'
                )
              ),

            task_class TEXT NOT NULL
              CHECK (
                task_class IN (
                  'GENERAL',
                  'AUTHORITY_BOUNDARY',
                  'SEMANTIC_CONTRACT',
                  'INVOCATION_BOUND',
                  'CONCURRENCY_CONTROL',
                  'TRANSPORT_SAFETY',
                  'PROTOCOL_VALIDATION',
                  'EVIDENCE_BINDING'
                )
              ),

            outcome TEXT NOT NULL
              CHECK (
                outcome IN (
                  'TRANSPORT_FAILURE',
                  'PROTOCOL_REJECTED',
                  'CONTRACT_REJECTED',
                  'BLOCKED',
                  'USEFUL_DUPLICATE',
                  'USEFUL_UNIQUE'
                )
              ),

            observed_at_ms INTEGER NOT NULL
              CHECK (
                observed_at_ms >= 0
              ),

            source TEXT NOT NULL
              CHECK (
                source = 'HOST_RUNTIME'
              )
          );

        CREATE INDEX IF NOT EXISTS
          idx_task_class_evidence_lane
        ON task_class_evidence (
          baseline,
          provider,
          task_class,
          observed_at_ms,
          job_id
        );
      `);

      this.#verifyMeta();
    } catch (error) {
      this.#db.close();
      throw error;
    }
  }

  #verifyMeta():
    void {
    const schemaRaw =
      this.#db
        .prepare(`
          SELECT value
          FROM task_class_evidence_meta
          WHERE key = 'schema'
        `)
        .get();

    const baselineRaw =
      this.#db
        .prepare(`
          SELECT value
          FROM task_class_evidence_meta
          WHERE key = 'baseline'
        `)
        .get();

    /*
     * node:sqlite exposes generic Record<string,
     * SQLOutputValue>. Cross through unknown only after
     * the query has selected the exact expected column.
     */
    const schema =
      schemaRaw === undefined
        ? undefined
        : (
            schemaRaw as unknown
          ) as MetaRow;

    const baseline =
      baselineRaw === undefined
        ? undefined
        : (
            baselineRaw as unknown
          ) as MetaRow;

    if (
      schema === undefined &&
      baseline === undefined
    ) {
      this.#db.exec(
        'BEGIN IMMEDIATE;',
      );

      try {
        this.#db
          .prepare(`
            INSERT INTO task_class_evidence_meta (
              key,
              value
            )
            VALUES (
              'schema',
              ?
            )
          `)
          .run(
            PROVIDER_TASK_CLASS_EVIDENCE_STORE_SCHEMA,
          );

        this.#db
          .prepare(`
            INSERT INTO task_class_evidence_meta (
              key,
              value
            )
            VALUES (
              'baseline',
              ?
            )
          `)
          .run(
            this.#baseline,
          );

        this.#db.exec(
          'COMMIT;',
        );
      } catch (error) {
        this.#db.exec(
          'ROLLBACK;',
        );

        throw error;
      }

      return;
    }

    if (
      schema === undefined ||
      baseline === undefined
    ) {
      throw new Error(
        'TASK_CLASS_EVIDENCE_STORE_META_INCOMPLETE',
      );
    }

    if (
      schema.value !==
        PROVIDER_TASK_CLASS_EVIDENCE_STORE_SCHEMA
    ) {
      throw new Error(
        'TASK_CLASS_EVIDENCE_STORE_SCHEMA_MISMATCH',
      );
    }

    if (
      baseline.value !==
        this.#baseline
    ) {
      throw new Error(
        'TASK_CLASS_EVIDENCE_STORE_BASELINE_MISMATCH',
      );
    }
  }

  appendHostOutcome(input: HostTaskClassOutcomeInput): void {
    this.#appendHostOutcome(input);
  }

  // The ordinary routing evidence and its complete V3 security identity commit
  // together in this same SQLite transaction. No next call can outpace either.
  appendRecoveryHostOutcome(input: TaskClassRecoveryHostOutcome): void {
    input = structuredClone(input);
    const metadata = input.securityMetadata;
    const tx = metadata?.transaction;
    if (!tx) throw new Error('RECOVERY_LEDGER_TRANSACTION_MISSING');
    validateRecoveryTransaction(tx);
    const expectedKeys = ['transaction', 'schemaVersion', 'batchId', 'baseline', 'provider', 'taskClass', 'phase',
      'requestedModel', 'ordinal', 'totalProviderCalls', 'jobId', 'jobDescriptorSha256'];
    if (Object.keys(metadata).length !== expectedKeys.length || Object.keys(metadata).some(key => !expectedKeys.includes(key)) ||
        metadata.schemaVersion !== TASK_CLASS_RECOVERY_SECURITY_SCHEMA ||
        metadata.baseline !== this.#baseline || metadata.baseline !== input.baseline ||
        metadata.jobId !== input.jobId || metadata.provider !== input.provider || metadata.taskClass !== input.taskClass ||
        metadata.baseline !== tx.baseline || metadata.batchId !== tx.batchId || metadata.phase !== tx.phase ||
        metadata.requestedModel !== tx.requestedModel || metadata.totalProviderCalls !== tx.totalProviderCalls ||
        !Number.isSafeInteger(metadata.ordinal) || metadata.ordinal < 1 || metadata.ordinal > tx.totalProviderCalls ||
        typeof metadata.jobDescriptorSha256 !== 'string' || metadata.jobDescriptorSha256.length !== 64 ||
        !/^[0-9a-f]{64}$/.test(metadata.jobDescriptorSha256) || !sameRecoveryTransaction(metadata.transaction, tx)) {
      throw new Error('RECOVERY_LEDGER_METADATA_INVALID');
    }
    this.#appendHostOutcome(input, metadata);
  }

  loadRecoverySecurityMetadata(jobId: string): TaskClassRecoverySecurityMetadata | null {
    const table = this.#db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'recovery_security_metadata_v3'").get();
    if (!table) return null;
    const row = this.#db.prepare('SELECT metadata_json FROM recovery_security_metadata_v3 WHERE job_id = ?').get(jobId);
    if (!row) return null;
    const metadata = JSON.parse(String(row.metadata_json));
    validateRecoveryTransaction(metadata.transaction);
    return Object.freeze({ ...metadata, transaction: Object.freeze(metadata.transaction) });
  }

  #appendHostOutcome(
    input: HostTaskClassOutcomeInput,
    metadata?: TaskClassRecoverySecurityMetadata,
  ): void {
    const validated =
      recordHostTaskClassOutcome(
        createProviderTaskClassEvidenceLedger(
          this.#baseline,
        ),
        input,
      );

    const record =
      validated.records[0];

    if (record === undefined) {
      throw new Error(
        'TASK_CLASS_EVIDENCE_STORE_VALIDATION_EMPTY',
      );
    }

    this.#db.exec(
      'BEGIN IMMEDIATE;',
    );

    try {
      const existing =
        this.#db
          .prepare(`
            SELECT job_id
            FROM task_class_evidence
            WHERE job_id = ?
          `)
          .get(
            record.jobId,
          );

      if (existing !== undefined) {
        throw new Error(
          'TASK_CLASS_EVIDENCE_STORE_JOB_ALREADY_RECORDED',
        );
      }

      this.#db
        .prepare(`
          INSERT INTO task_class_evidence (
            job_id,
            baseline,
            provider,
            task_class,
            outcome,
            observed_at_ms,
            source
          )
          VALUES (
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            'HOST_RUNTIME'
          )
        `)
        .run(
          record.jobId,
          record.baseline,
          record.provider,
          record.taskClass,
          record.outcome,
          record.observedAtMs,
        );

      if (metadata) {
        this.#db.exec(`CREATE TABLE IF NOT EXISTS recovery_security_metadata_v3 (
          job_id TEXT PRIMARY KEY REFERENCES task_class_evidence(job_id),
          authorization_id TEXT NOT NULL, ordinal INTEGER NOT NULL CHECK (ordinal > 0),
          metadata_json TEXT NOT NULL, UNIQUE (authorization_id, ordinal)
        );`);
        this.#db.prepare(`INSERT INTO recovery_security_metadata_v3
          (job_id, authorization_id, ordinal, metadata_json) VALUES (?, ?, ?, ?)`).run(
          record.jobId, metadata.transaction!.authorizationId, metadata.ordinal, JSON.stringify(metadata));
      }
      this.#db.exec(
        'COMMIT;',
      );
    } catch (error) {
      this.#db.exec(
        'ROLLBACK;',
      );

      throw error;
    }
  }

  loadLedger():
    ProviderTaskClassEvidenceLedger {
    let ledger =
      createProviderTaskClassEvidenceLedger(
        this.#baseline,
      );

    const rowsRaw =
      this.#db
        .prepare(`
          SELECT
            job_id,
            baseline,
            provider,
            task_class,
            outcome,
            observed_at_ms,
            source
          FROM task_class_evidence
          ORDER BY
            observed_at_ms ASC,
            job_id ASC
        `)
        .all();

    const rows =
      (
        rowsRaw as unknown
      ) as EvidenceRow[];

    for (
      const row
      of rows
    ) {
      if (
        row.source !==
          'HOST_RUNTIME'
      ) {
        throw new Error(
          'TASK_CLASS_EVIDENCE_STORE_SOURCE_INVALID',
        );
      }

      ledger =
        recordHostTaskClassOutcome(
          ledger,
          {
            jobId:
              row.job_id,

            baseline:
              row.baseline,

            provider:
              row.provider as Provider,

            taskClass:
              row.task_class as
                ProviderTaskClass,

            outcome:
              row.outcome as
                WorkOutcome,

            observedAtMs:
              Number(
                row.observed_at_ms,
              ),
          },
        );
    }

    return ledger;
  }

  laneEvidence(
    provider:
      Provider,

    taskClass:
      ProviderTaskClass,

    runtime:
      ProviderTaskClassRuntimeState,
  ): ProviderTaskLaneEvidence {
    return (
      buildProviderTaskLaneEvidenceFromHostLedger(
        this.loadLedger(),
        provider,
        taskClass,
        runtime,
      )
    );
  }

  count():
    number {
    const raw =
      this.#db
        .prepare(`
          SELECT COUNT(*) AS count
          FROM task_class_evidence
        `)
        .get();

    if (raw === undefined) {
      throw new Error(
        'TASK_CLASS_EVIDENCE_STORE_COUNT_MISSING',
      );
    }

    const row =
      (
        raw as unknown
      ) as {
        readonly count:
          number;
      };

    return Number(
      row.count,
    );
  }

  integrityCheck():
    boolean {
    const raw =
      this.#db
        .prepare(
          'PRAGMA integrity_check;',
        )
        .get();

    if (raw === undefined) {
      return false;
    }

    const row =
      (
        raw as unknown
      ) as {
        readonly integrity_check:
          string;
      };

    return (
      row.integrity_check ===
        'ok'
    );
  }

  close():
    void {
    this.#db.close();
  }
}
